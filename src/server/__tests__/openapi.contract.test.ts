// Contract tests: the OpenAPI document is the published promise, so every real
// response is validated against its schema. If the API and the docs disagree,
// this suite fails, which keeps the documentation honest.
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import mongoose from 'mongoose';
import request from 'supertest';
import {
  agentEscalationReasons,
  agentModes,
  agentOutcomes,
  proposalStatuses,
} from '../../shared/agent-constants';
import {
  actorRoles,
  agentCategories,
  assigneeGroups,
  auditTypes,
  priorities,
  roles,
  slaFilters,
  sortFields,
  statuses,
} from '../../shared/ticket-constants';
import app from '../app';
import { connectToDatabase } from '../db';
import AgentRun from '../models/AgentRun';
import AgentStep from '../models/AgentStep';
import KbArticle from '../models/KbArticle';
import OutboxEvent from '../models/OutboxEvent';
import Ticket from '../models/Ticket';
import { issueServiceToken } from '../security/accessToken';
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
    schemas: Record<string, { enum?: string[]; properties?: Record<string, { enum?: string[] }> }>;
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
  await KbArticle.init();
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
    expect(schemas.ActorRole.enum).toEqual([...actorRoles]);
    expect(schemas.ProposalStatus.enum).toEqual([...proposalStatuses]);
    expect(schemas.AgentMode.enum).toEqual([...agentModes]);
    expect(schemas.AgentOutcome.enum).toEqual([...agentOutcomes]);
    expect(schemas.AuditType.enum).toEqual([...auditTypes]);
    expect(schemas.AgentEscalation.properties?.reason?.enum).toEqual([...agentEscalationReasons]);
    expect(schemas.AgentEscalation.properties?.assigneeGroup?.enum).toEqual([...assigneeGroups]);
    expect(schemas.KbCategory.enum).toEqual([...agentCategories]);
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

    const comment = await request(app)
      .post(`/api/tickets/${id}/comments`)
      .set(as('tech'))
      .send({ body: 'Checking the switch.', visibility: 'internal' })
      .expect(201);
    conforms('CommentEnvelope', comment.body);
    used('addComment');

    const thread = await request(app)
      .get(`/api/tickets/${id}/comments`)
      .set(as('admin'))
      .expect(200);
    conforms('CommentList', thread.body);
    expect(thread.body.comments).toHaveLength(1);
    used('listComments');

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

    const trends = await request(app)
      .get('/api/tickets/stats/trends?days=7&tz=America/Toronto')
      .set(as('admin'))
      .expect(200);
    conforms('Trends', trends.body);
    expect(trends.body.series).toHaveLength(7);
    used('getTicketTrends');

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

  test('scheduled jobs and the outbox match their schemas', async () => {
    // Turn notifications on so events are recorded; nothing is delivered (the address is
    // never called) because the events are only listed here.
    process.env.WEBHOOK_URL = 'http://127.0.0.1:9/hook';
    process.env.CRON_SECRET = 'contract-test-cron-secret-of-32-plus-characters';
    try {
      await request(app)
        .post('/api/tickets')
        .set(as('admin'))
        .send({ title: 'Outbox contract check' })
        .expect(201);
      await OutboxEvent.updateOne(
        {},
        { $set: { status: 'dead', lastError: 'The webhook answered HTTP 500.' } }
      );

      const listed = await request(app).get('/api/outbox?status=dead').set(as('admin')).expect(200);
      conforms('OutboxList', listed.body);
      expect(listed.body.events).toHaveLength(1);
      used('listOutbox');

      const retried = await request(app)
        .post(`/api/outbox/${listed.body.events[0]._id}/retry`)
        .set(as('admin'))
        .expect(200);
      conforms('OutboxEventEnvelope', retried.body);
      used('retryOutboxEvent');

      const auth = { Authorization: `Bearer ${process.env.CRON_SECRET}` };
      const escalation = await request(app).post('/api/jobs/sla-escalation').set(auth).expect(200);
      conforms('EscalationResult', escalation.body);
      used('runSlaEscalation');

      // With no webhook configured the delivery job reports that and does nothing.
      delete process.env.WEBHOOK_URL;
      const delivery = await request(app).post('/api/jobs/outbox-delivery').set(auth).expect(200);
      conforms('DeliveryResult', delivery.body);
      expect(delivery.body.configured).toBe(false);
      used('runOutboxDelivery');

      // With the agent off (the default) the job reports that and does nothing.
      const agentJob = await request(app).post('/api/jobs/agent-runs').set(auth).expect(200);
      conforms('AgentRunsResult', agentJob.body);
      expect(agentJob.body).toMatchObject({ configured: false, reason: 'disabled' });
      used('runAgentRuns');

      const unauthorised = await request(app).post('/api/jobs/sla-escalation').expect(401);
      conforms('Error', unauthorised.body);
    } finally {
      delete process.env.WEBHOOK_URL;
      delete process.env.CRON_SECRET;
    }
  });

  test('metrics are served as Prometheus text only with the token', async () => {
    process.env.METRICS_TOKEN = 'contract-test-metrics-token-of-32-plus-characters';
    try {
      const metrics = await request(app)
        .get('/api/metrics')
        .set('Authorization', `Bearer ${process.env.METRICS_TOKEN}`)
        .expect(200);
      expect(metrics.headers['content-type']).toContain('text/plain');
      expect(metrics.text).toContain('http_requests_total');
      used('getMetrics');

      const refused = await request(app).get('/api/metrics').expect(401);
      conforms('Error', refused.body);
    } finally {
      delete process.env.METRICS_TOKEN;
    }
    conforms('Error', (await request(app).get('/api/metrics').expect(404)).body);
  });

  test('a ticket the SLA job has touched still conforms', async () => {
    const created = await request(app)
      .post('/api/tickets')
      .set(as('admin'))
      .send({ title: 'Overdue for the contract', priority: 'low', dueAt: '2020-01-01T00:00:00Z' })
      .expect(201);
    process.env.CRON_SECRET = 'contract-test-cron-secret-of-32-plus-characters';
    try {
      await request(app)
        .post('/api/jobs/sla-escalation')
        .set('Authorization', `Bearer ${process.env.CRON_SECRET}`)
        .expect(200);
    } finally {
      delete process.env.CRON_SECRET;
    }

    const fetched = await request(app)
      .get(`/api/tickets/${created.body.ticket._id}`)
      .set(as('admin'))
      .expect(200);

    conforms('TicketEnvelope', fetched.body);
    expect(fetched.body.ticket.slaBreachedAt).toBeDefined();
    expect(fetched.body.ticket.activity.at(-1).actorRole).toBe('system');
  });

  test('the knowledge base matches its schemas', async () => {
    await KbArticle.create({
      articleId: 'KB-006',
      title: 'VPN keeps disconnecting',
      category: 'Network',
      body: ['The VPN connects, then drops every few minutes.', '', '1. Restart the router.'].join(
        '\n'
      ),
      lastReviewed: new Date('2026-09-01T00:00:00Z'),
      appliesTo: ['Windows', 'macOS'],
    });

    const found = await request(app).get('/api/kb?search=vpn').set(as('tech')).expect(200);
    conforms('KbSearchResponse', found.body);
    expect(found.body.articles).toHaveLength(1);
    used('searchKb');

    const article = await request(app).get('/api/kb/KB-006').set(as('tech')).expect(200);
    conforms('KbArticleEnvelope', article.body);
    used('getKbArticle');

    conforms('Error', (await request(app).get('/api/kb/KB-999').set(as('tech')).expect(404)).body);
    conforms('Error', (await request(app).get('/api/kb/nope').set(as('tech')).expect(400)).body);
    conforms('Error', (await request(app).get('/api/kb').set(as('user')).expect(403)).body);
    conforms('Error', (await request(app).get('/api/kb').expect(401)).body);
  });

  test('the agent endpoints match their schemas', async () => {
    const newTicket = async (title: string, category?: string) =>
      (
        await request(app)
          .post('/api/tickets')
          .set(as('user'))
          .send({ title, description: 'It keeps dropping.', ...(category ? { category } : {}) })
          .expect(201)
      ).body.ticket._id as string;

    // A run that ended with a proposal, as the worker leaves it, and a ticket waiting on it.
    const withProposal = async (title: string) => {
      const id = await newTicket(title);
      const run = await AgentRun.create({
        ticketId: id,
        ticketVersion: 0,
        idempotencyKey: `${id}:v0`,
        mode: 'assist',
        model: 'claude-sonnet-5',
        promptVersion: 'triage.v1',
        outcome: 'proposed',
        ticketNumber: 'TKT-0001',
        steps: 2,
        inputTokens: 3000,
        outputTokens: 300,
        costUsd: 0.009,
        latencyMs: 4200,
        triage: { category: 'Network', priority: 'high', assigneeGroup: 'Network Support' },
        proposal: {
          replyMarkdown: 'Reconnect the VPN, then restart your laptop if it still drops.',
          citedKbIds: ['KB-006'],
          confidence: 'high',
          reasoningSummary: 'The article covers this.',
        },
        startedAt: new Date(),
        finishedAt: new Date(),
      });
      await Ticket.updateOne(
        { _id: id },
        {
          $set: {
            'agent.lastRunId': run._id,
            'agent.proposalStatus': 'pending',
            'agent.triageSource': 'agent',
          },
        }
      );
      return { id, run };
    };
    const get = (path: string, who: Account) => request(app).get(path).set(as(who));
    const post = (path: string, who: Account, body: object = {}) =>
      request(app).post(path).set(as(who)).send(body);

    // The proposal, and the ticket that carries the agent's state (for staff only).
    const first = await withProposal('VPN drops');
    const view = await get(`/api/tickets/${first.id}/proposal`, 'tech').expect(200);
    conforms('ProposalEnvelope', view.body);
    used('getProposal');
    const seen = await get(`/api/tickets/${first.id}`, 'tech').expect(200);
    conforms('TicketEnvelope', seen.body);
    expect(seen.body.ticket.agent.proposalStatus).toBe('pending');
    conforms('Error', (await get(`/api/tickets/${first.id}/proposal`, 'user').expect(403)).body);
    const plain = await newTicket('No proposal');
    conforms('Error', (await get(`/api/tickets/${plain}/proposal`, 'tech').expect(404)).body);

    // Rejecting, then trying again.
    const rejected = await post(`/api/tickets/${first.id}/proposal/reject`, 'tech', {
      reason: 'Not the right article.',
    }).expect(200);
    conforms('ProposalDecision', rejected.body);
    used('rejectProposal');
    const twice = await post(`/api/tickets/${first.id}/proposal/reject`, 'tech').expect(409);
    conforms('Error', twice.body);
    expect(twice.body.code).toBe('NO_PENDING_PROPOSAL');

    // Approving, and what the requester then reads.
    const second = await withProposal('Wi-Fi drops');
    const approved = await post(`/api/tickets/${second.id}/proposal/approve`, 'tech').expect(200);
    conforms('ProposalDecision', approved.body);
    used('approveProposal');
    const thread = await get(`/api/tickets/${second.id}/comments`, 'user').expect(200);
    conforms('CommentList', thread.body);
    expect(thread.body.comments[0]).toMatchObject({ source: 'agent', author: { role: 'agent' } });
    const afterwards = await get(`/api/tickets/${second.id}`, 'tech').expect(200);
    conforms('TicketEnvelope', afterwards.body);
    conforms(
      'Error',
      (await post(`/api/tickets/${second.id}/proposal/approve`, 'user').expect(403)).body
    );
    conforms(
      'Error',
      (
        await post(`/api/tickets/${plain}/proposal/approve`, 'tech', {
          replyMarkdown: 'no',
        }).expect(400)
      ).body
    );

    // The agent handing a ticket over, with its own token.
    const target = await newTicket('Suspicious email');
    const token = await issueServiceToken({ ticketId: target, runId: String(first.run._id) });
    const handed = await request(app)
      .post('/api/agent/escalations')
      .set({ Authorization: `Bearer ${token}` })
      .send({
        ticketId: target,
        assigneeGroup: 'Security Team',
        reason: 'security_incident',
        summary: 'Reported: a phishing email.',
      })
      .expect(201);
    conforms('TicketEnvelope', handed.body);
    used('agentEscalate');
    conforms('Error', (await post('/api/agent/escalations', 'tech').expect(403)).body);

    // The agent answering a ticket itself, where auto mode is on for its category.
    await request(app)
      .put('/api/agent/settings')
      .set(as('admin'))
      .send({ defaultMode: 'auto', autoAllowlist: ['Network'] })
      .expect(200);
    const answerable = await newTicket('VPN drops again', 'Network');
    const answerToken = await issueServiceToken({
      ticketId: answerable,
      runId: String(first.run._id),
    });
    const answerBody = {
      ticketId: answerable,
      replyMarkdown: 'Reconnect the VPN, then restart your laptop if it still drops.',
      citedKbIds: ['KB-006'],
      confidence: 'high',
    };
    const answered = await request(app)
      .post('/api/agent/resolutions')
      .set({ Authorization: `Bearer ${answerToken}` })
      .send(answerBody)
      .expect(201);
    conforms('TicketEnvelope', answered.body);
    expect(answered.body.ticket.agent.proposalStatus).toBe('posted');
    used('agentResolve');
    const posted = await get(`/api/tickets/${answerable}/comments`, 'user').expect(200);
    conforms('CommentList', posted.body);
    expect(posted.body.comments[0]).toMatchObject({ source: 'agent' });
    expect(posted.body.comments[0].approvedBy).toBeUndefined();
    const refused = await request(app)
      .post('/api/agent/resolutions')
      .set({ Authorization: `Bearer ${answerToken}` })
      .send(answerBody);
    conforms('Error', refused.body);
    expect(refused.status).toBe(409);
    conforms('Error', (await post('/api/agent/resolutions', 'tech').expect(403)).body);

    // Settings and runs.
    const settings = await get('/api/agent/settings', 'tech').expect(200);
    conforms('AgentSettingsEnvelope', settings.body);
    used('getAgentSettings');
    const changed = await request(app)
      .put('/api/agent/settings')
      .set(as('admin'))
      .send({ defaultMode: 'assist', modeByCategory: { Email: 'shadow' }, dailyCostCapUsd: 2 })
      .expect(200);
    conforms('AgentSettingsEnvelope', changed.body);
    used('updateAgentSettings');
    const forbidden = await request(app)
      .put('/api/agent/settings')
      .set(as('tech'))
      .send({ killSwitch: true });
    conforms('Error', forbidden.body);
    expect(forbidden.status).toBe(403);
    const unknown = await request(app)
      .put('/api/agent/settings')
      .set(as('admin'))
      .send({ nope: 1 });
    conforms('Error', unknown.body);
    expect(unknown.status).toBe(400);

    await AgentStep.create({
      runId: first.run._id,
      attempt: 1,
      index: 0,
      kind: 'model',
      stopReason: 'tool_use',
      latencyMs: 800,
    });
    const runs = await get('/api/agent/runs?outcome=proposed', 'admin').expect(200);
    conforms('AgentRunList', runs.body);
    used('listAgentRuns');
    const one = await get(`/api/agent/runs/${first.run._id}`, 'admin').expect(200);
    conforms('AgentRunDetailEnvelope', one.body);
    used('getAgentRun');
    conforms('Error', (await get('/api/agent/runs', 'tech').expect(403)).body);
    conforms('Error', (await get('/api/agent/runs/nope', 'admin').expect(400)).body);
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
