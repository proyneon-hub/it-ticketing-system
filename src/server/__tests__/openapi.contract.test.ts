// Contract tests: the OpenAPI document is the published promise, so every real
// response is validated against its schema. If the API and the docs disagree,
// this suite fails, which keeps the documentation honest.
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import mongoose from 'mongoose';
import request from 'supertest';
import { priorities, roles, slaFilters, sortFields, statuses } from '../../shared/ticket-constants';
import app from '../app';
import { connectToDatabase } from '../db';
import Ticket from '../models/Ticket';
import spec from '../openapi.json';
import {
  bearer,
  cookieValue,
  signInAll,
  startTestDatabase,
  type Account,
  type TestDatabase,
  type Tokens,
} from './helpers';

// A loose view of the document: enough structure to walk it, without modelling OpenAPI.
interface Operation {
  operationId?: string;
  responses: Record<string, unknown>;
}
interface OpenApiDocument {
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas: Record<string, { enum?: string[] }>;
    parameters: Record<string, { schema: { enum: string[] } }>;
  };
}
const doc = spec as unknown as OpenApiDocument;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(spec, 'api');

const validators = new Map<string, ReturnType<typeof ajv.compile>>();
function conforms(schemaName: string, body: unknown): void {
  let validate = validators.get(schemaName);
  if (!validate) {
    validate = ajv.compile({ $ref: `api#/components/schemas/${schemaName}` });
    validators.set(schemaName, validate);
  }
  const valid = validate(body);
  expect({ valid, errors: valid ? [] : validate.errors, body: valid ? undefined : body }).toEqual({
    valid: true,
    errors: [],
    body: undefined,
  });
}

const documentedOperations = Object.values(doc.paths)
  .flatMap((pathItem) => Object.values(pathItem))
  .filter((operation) => operation && operation.operationId)
  .map((operation) => operation.operationId as string);
const exercised = new Set<string>();
const used = (operationId: string) => exercised.add(operationId);

let mongod: TestDatabase;
let tokens: Tokens;
const as = (role: Account) => bearer(tokens, role);

beforeAll(async () => {
  mongod = await startTestDatabase();
  await connectToDatabase();
  await Ticket.init();
  tokens = await signInAll(app);
}, 300000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('the document stays in step with the code', () => {
  test('enums match the constants the API validates against', () => {
    const { schemas, parameters } = doc.components;
    expect(schemas.Status.enum).toEqual([...statuses]);
    expect(schemas.Priority.enum).toEqual([...priorities]);
    expect(schemas.Role.enum).toEqual([...roles]);
    expect(parameters.SortBy.schema.enum).toEqual([...sortFields]);
    expect(parameters.SlaFilter.schema.enum).toEqual([...slaFilters]);
  });

  test('every operation has a unique id and at least one documented response', () => {
    expect(new Set(documentedOperations).size).toBe(documentedOperations.length);
    for (const pathItem of Object.values(doc.paths)) {
      for (const operation of Object.values(pathItem).filter((item) => item.operationId)) {
        expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
      }
    }
  });

  test('every schema and reference in the document compiles', () => {
    for (const name of Object.keys(doc.components.schemas)) {
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
    demoUsers.body.users.forEach((user: unknown) => conforms('DemoUser', user));
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
    expect(updated.headers.etag).toBe(`"${updated.body.ticket.__v}"`);
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
    const open = await request(app)
      .post('/api/tickets')
      .set(as('admin'))
      .send({ title: 'For a conflict' })
      .expect(201);

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
      // An edit made against a version that is no longer current.
      await request(app)
        .patch(`/api/tickets/${open.body.ticket._id}`)
        .set(as('admin'))
        .set('If-Match', '"99"')
        .send({ priority: 'high' })
        .expect(409),
      // The only admin cannot be demoted.
      await request(app)
        .patch(
          `/api/users/${(await request(app).get('/api/users').set(as('admin'))).body.users[0].id}`
        )
        .set(as('admin'))
        .send({ role: 'technician' })
        .expect(409),
      // An open ticket cannot jump straight to resolved.
      await request(app)
        .patch(`/api/tickets/${open.body.ticket._id}`)
        .set(as('admin'))
        .send({ status: 'resolved' })
        .expect(409),
    ];

    for (const response of responses) {
      conforms('Error', response.body);
      expect(response.body.requestId).toBe(response.headers['x-request-id']);
    }
    expect(responses[1].body.errors[0]).toMatchObject({ field: 'title' });
    expect(responses[6].body.message).toMatch(/changed since you loaded/i);
  });

  test('sessions, administration and the audit log match their schemas', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tech@demo.local', password: 'TechPass123!' })
      .expect(200);
    conforms('LoginResponse', login.body);

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `rt=${cookieValue(login)}`)
      .expect(200);
    conforms('LoginResponse', refreshed.body);
    used('refreshSession');

    await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `rt=${cookieValue(refreshed)}`)
      .expect(204);
    used('logout');

    const users = await request(app).get('/api/users').set(as('admin')).expect(200);
    conforms('UserList', users.body);
    used('listUsers');

    const una = users.body.users.find(
      (user: { email: string }) => user.email === 'user@demo.local'
    );
    for (const role of ['technician', 'user']) {
      const changed = await request(app)
        .patch(`/api/users/${una.id}`)
        .set(as('admin'))
        .send({ role })
        .expect(200);
      conforms('PublicUser', changed.body.user);
    }
    used('changeUserRole');

    const audit = await request(app).get('/api/audit?limit=5').set(as('admin')).expect(200);
    conforms('AuditList', audit.body);
    expect(audit.body.events.length).toBeGreaterThan(0);
    used('listAudit');
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

  // Vercel never routes a trailing-slash URL (/api/docs/) to the function, so the
  // page has to work at /api/docs itself, with no redirect to the slash form.
  test('serves the page at /api/docs directly and points its assets at /api/docs/', async () => {
    const page = await request(app).get('/api/docs').expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('IT Ticketing System API');
    expect(page.text).toContain('<base href="/api/docs/">');
  });

  test('serves Swagger UI and its assets without a database or sign-in', async () => {
    const page = await request(app).get('/api/docs/').expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('IT Ticketing System API');

    await request(app).get('/api/docs/swagger-ui-bundle.js').expect(200);
    await request(app).get('/api/docs/swagger-ui.css').expect(200);
    await request(app).get('/api/docs/swagger-ui-init.js').expect(200);
  });
});
