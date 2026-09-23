// Contract tests: the OpenAPI document is the published promise, so every real
// response is validated against its schema. If the API and the docs disagree,
// this suite fails, which keeps the documentation honest.
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const constants = require('../../shared/ticket-constants.json');
const spec = require('../openapi.json');

jest.setTimeout(60000);

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(spec, 'api');

const validators = new Map();
function conforms(schemaName, body) {
  if (!validators.has(schemaName)) {
    validators.set(schemaName, ajv.compile({ $ref: `api#/components/schemas/${schemaName}` }));
  }
  const validate = validators.get(schemaName);
  const valid = validate(body);
  expect({ valid, errors: valid ? [] : validate.errors, body: valid ? undefined : body }).toEqual({
    valid: true,
    errors: [],
    body: undefined,
  });
}

const documentedOperations = Object.values(spec.paths)
  .flatMap((pathItem) => Object.values(pathItem))
  .filter((operation) => operation && operation.operationId)
  .map((operation) => operation.operationId);
const exercised = new Set();
const used = (operationId) => exercised.add(operationId);

let mongod;
let app;
let tokens;
const as = (role) => ({ Authorization: `Bearer ${tokens[role]}` });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  app = require('../app');
  await require('../db').connectToDatabase();
  await require('../models/Ticket').init();

  tokens = {};
  const accounts = {
    admin: ['admin@demo.local', 'AdminPass123!'],
    tech: ['tech@demo.local', 'TechPass123!'],
    user: ['user@demo.local', 'UserPass123!'],
  };
  for (const [role, [email, password]] of Object.entries(accounts)) {
    tokens[role] = (
      await request(app).post('/api/auth/login').send({ email, password })
    ).body.token;
  }
}, 300000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('the document stays in step with the code', () => {
  test('enums match the constants the API validates against', () => {
    const { schemas, parameters } = spec.components;
    expect(schemas.Status.enum).toEqual(constants.statuses);
    expect(schemas.Priority.enum).toEqual(constants.priorities);
    expect(schemas.Role.enum).toEqual(constants.roles);
    expect(parameters.SortBy.schema.enum).toEqual(constants.sortFields);
    expect(parameters.SlaFilter.schema.enum).toEqual(constants.slaFilters);
  });

  test('every operation has a unique id and at least one documented response', () => {
    expect(new Set(documentedOperations).size).toBe(documentedOperations.length);
    for (const pathItem of Object.values(spec.paths)) {
      for (const operation of Object.values(pathItem).filter((item) => item.operationId)) {
        expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
      }
    }
  });

  test('every schema and reference in the document compiles', () => {
    for (const name of Object.keys(spec.components.schemas)) {
      expect(() => ajv.compile({ $ref: `api#/components/schemas/${name}` })).not.toThrow();
    }
  });
});

describe('responses match their documented schemas', () => {
  test('operations and auth', async () => {
    const health = await request(app).get('/api/health').expect(200);
    conforms('Health', health.body);
    used('getHealth');

    const ready = await request(app).get('/api/ready').expect(200);
    conforms('Readiness', ready.body);
    used('getReadiness');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@demo.local', password: 'AdminPass123!' })
      .expect(200);
    conforms('LoginResponse', login.body);
    used('login');

    const me = await request(app).get('/api/auth/me').set(as('tech')).expect(200);
    conforms('SessionUser', me.body.user);
    used('getSession');

    const demoUsers = await request(app).get('/api/auth/demo-users').expect(200);
    demoUsers.body.users.forEach((user) => conforms('DemoUser', user));
    used('listDemoUsers');
  });

  test('the ticket lifecycle', async () => {
    const created = await request(app)
      .post('/api/tickets')
      .set(as('admin'))
      .send({ title: 'Contract check', priority: 'high', category: 'Network' })
      .expect(201);
    conforms('TicketEnvelope', created.body);
    used('createTicket');
    const id = created.body.ticket._id;

    const fetched = await request(app).get(`/api/tickets/${id}`).set(as('admin')).expect(200);
    conforms('TicketEnvelope', fetched.body);
    used('getTicket');

    const updated = await request(app)
      .patch(`/api/tickets/${id}`)
      .set(as('tech'))
      .send({ status: 'assigned', assignee: 'Theo Technician' })
      .expect(200);
    conforms('TicketEnvelope', updated.body);
    expect(updated.body.ticket.activity.length).toBeGreaterThan(1);
    used('updateTicket');

    const list = await request(app)
      .get('/api/tickets?limit=5&sortBy=priority')
      .set(as('admin'))
      .expect(200);
    conforms('TicketList', list.body);
    used('listTickets');

    const stats = await request(app).get('/api/tickets/stats').set(as('admin')).expect(200);
    conforms('Stats', stats.body);
    used('getTicketStats');

    const csv = await request(app).get('/api/tickets/export').set(as('admin')).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toBe(
      'Ticket ID,Title,Status,Priority,Requester,Assigned To,Created At,Updated At,SLA Due At,SLA Breached'
    );
    used('exportTickets');

    await request(app).delete(`/api/tickets/${id}`).set(as('admin')).expect(204);
    used('deleteTicket');
  });

  test('a requester-created ticket also conforms', async () => {
    const created = await request(app)
      .post('/api/tickets')
      .set(as('user'))
      .send({ title: 'From a requester' })
      .expect(201);

    conforms('TicketEnvelope', created.body);
  });

  test('errors share one documented shape and always carry a request id', async () => {
    const responses = [
      await request(app).get('/api/tickets?limit=1000').set(as('admin')).expect(400),
      await request(app).post('/api/tickets').set(as('admin')).send({}).expect(400),
      await request(app).get('/api/tickets').expect(401),
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@demo.local', password: 'nope' })
        .expect(401),
      await request(app)
        .delete('/api/tickets/665f0f40d5d4f541f8ef1234')
        .set(as('tech'))
        .expect(403),
      await request(app).get('/api/tickets/665f0f40d5d4f541f8ef1234').set(as('admin')).expect(404),
    ];

    for (const response of responses) {
      conforms('Error', response.body);
      expect(response.body.requestId).toBe(response.headers['x-request-id']);
    }
    expect(responses[1].body.errors[0]).toMatchObject({ field: 'title' });
  });

  test('every documented operation is exercised above', () => {
    expect([...exercised].sort()).toEqual([...documentedOperations].sort());
  });
});

describe('interactive documentation', () => {
  test('serves the raw OpenAPI document for client generators', async () => {
    const response = await request(app).get('/api/openapi.json').expect(200);
    expect(response.body.openapi).toBe('3.1.0');
    expect(response.body.info.title).toBe('IT Ticketing System API');
  });

  test('redirects /api/docs to the trailing-slash URL its assets need', async () => {
    const response = await request(app).get('/api/docs').expect(301);
    expect(response.headers.location).toBe('/api/docs/');
  });

  test('serves Swagger UI and its assets without a database or sign-in', async () => {
    const page = await request(app).get('/api/docs/').expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('IT Ticketing System API');

    await request(app).get('/api/docs/swagger-ui-bundle.js').expect(200);
    await request(app).get('/api/docs/swagger-ui.css').expect(200);
  });
});
