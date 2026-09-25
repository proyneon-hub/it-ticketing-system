import { agentEscalationReasons, agentToolTiers } from '../../shared/agent-constants';
import { agentCategories, assigneeGroups, priorities } from '../../shared/ticket-constants';
import { TOOLS, findTool, toolDefinitions } from './tools';

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: string[];
  minItems?: number;
  maxItems?: number;
  maxLength?: number;
  minLength?: number;
  items?: JsonSchema;
  additionalProperties?: unknown;
  $schema?: string;
}

const schemaOf = (name: string): JsonSchema =>
  toolDefinitions().find((tool) => tool.name === name)?.input_schema as JsonSchema;

describe('the tools', () => {
  test('are these nine, in this order, which never changes so the list can be cached', () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual([
      'get_ticket',
      'search_tickets',
      'get_requester_context',
      'search_kb',
      'get_kb_article',
      'set_triage',
      'propose_resolution',
      'post_resolution',
      'escalate',
    ]);
  });

  test('have unique snake_case names and real tiers', () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(agentToolTiers).toContain(tool.tier);
    }
  });

  test('sort into the tiers the mode policy expects', () => {
    const tierOf = (name: string) => findTool(name)?.tier;
    for (const name of [
      'get_ticket',
      'search_tickets',
      'get_requester_context',
      'search_kb',
      'get_kb_article',
    ]) {
      expect(tierOf(name)).toBe('read');
    }
    expect(tierOf('set_triage')).toBe('write-low');
    expect(tierOf('escalate')).toBe('write-low');
    expect(tierOf('propose_resolution')).toBe('write-draft');
    expect(tierOf('post_resolution')).toBe('write-high');
  });

  test('exactly three of them decide the ticket, and reading never does', () => {
    expect(TOOLS.filter((tool) => tool.terminal).map((tool) => [tool.name, tool.terminal])).toEqual(
      [
        ['propose_resolution', 'proposed'],
        ['post_resolution', 'posted'],
        ['escalate', 'escalated'],
      ]
    );
  });

  test('findTool finds one, and only real ones', () => {
    expect(findTool('escalate')?.name).toBe('escalate');
    expect(findTool('toString')).toBeUndefined();
    expect(findTool('')).toBeUndefined();
  });
});

describe('what the model is shown', () => {
  test('is the same every time it is built', () => {
    expect(JSON.stringify(toolDefinitions())).toBe(JSON.stringify(toolDefinitions()));
  });

  test('gives every tool a description that says when to use it, and an object schema', () => {
    for (const tool of toolDefinitions()) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(60);
      expect((tool.input_schema as JsonSchema).type).toBe('object');
      expect((tool.input_schema as JsonSchema).$schema).toBeUndefined();
    }
  });

  test('the choices in the schemas are exactly the ones the API and the constants allow', () => {
    const triage = schemaOf('set_triage').properties;
    expect(triage?.category?.enum).toEqual([...agentCategories]);
    expect(triage?.priority?.enum).toEqual([...priorities]);
    expect(triage?.assignee_group?.enum).toEqual([...assigneeGroups]);

    const escalate = schemaOf('escalate').properties;
    expect(escalate?.reason?.enum).toEqual([...agentEscalationReasons]);
    expect(escalate?.assignee_group?.enum).toEqual([...assigneeGroups]);
    expect(schemaOf('search_kb').properties?.category?.enum).toEqual([...agentCategories]);
  });

  test('require what the checks need: a ticket id, triage fields, at least one citation', () => {
    expect(schemaOf('set_triage').required).toEqual(
      expect.arrayContaining(['ticket_id', 'category', 'priority', 'assignee_group'])
    );
    for (const name of ['propose_resolution', 'post_resolution']) {
      const schema = schemaOf(name);
      expect(schema.required).toEqual(
        expect.arrayContaining(['ticket_id', 'reply_markdown', 'cited_kb_ids', 'confidence'])
      );
      expect(schema.properties?.cited_kb_ids?.minItems).toBe(1);
      expect(schema.properties?.cited_kb_ids?.maxItems).toBe(5);
      expect(schema.properties?.reply_markdown?.maxLength).toBe(4000);
    }
    expect(schemaOf('escalate').properties?.summary?.required).toEqual([
      'reported',
      'checked',
      'ruled_out',
      'why_escalating',
    ]);
  });

  test('no read tool lets the model choose whose tickets to look at', () => {
    // The requester is the ticket's own, from the server. There is nothing to type an address into.
    expect(schemaOf('get_requester_context').properties ?? {}).toEqual({});
    for (const tool of toolDefinitions()) {
      const properties = Object.keys((tool.input_schema as JsonSchema).properties ?? {});
      expect(properties.filter((name) => /email|requester|user/i.test(name))).toEqual([]);
    }
  });

  test('the write tools are the only ones that take a ticket id, and reading tools search or read by id', () => {
    const withTicketId = toolDefinitions()
      .filter((tool) => 'ticket_id' in ((tool.input_schema as JsonSchema).properties ?? {}))
      .map((tool) => tool.name);
    expect(withTicketId).toEqual([
      'get_ticket',
      'set_triage',
      'propose_resolution',
      'post_resolution',
      'escalate',
    ]);
  });
});
