import { nextAgentState } from './agentTicket';

const RUN = 'a1b2c3d4e5f6a1b2c3d4e5f6';
const agent = { role: 'agent' as const, runId: RUN };
const tech = { role: 'technician' as const };
const admin = { role: 'admin' as const };
const requester = { role: 'user' as const };

describe('nextAgentState', () => {
  describe('when the agent triages', () => {
    test.each([['category'], ['priority'], ['assignee']])(
      'setting %s makes the triage the agent’s, from this run',
      (field) => {
        expect(nextAgentState(undefined, { [field]: 'x' }, agent)).toEqual({
          triageSource: 'agent',
          lastRunId: RUN,
        });
      }
    );

    test('keeps whatever else was recorded, such as a proposal waiting', () => {
      expect(
        nextAgentState(
          { proposalStatus: 'pending', triageSource: 'human' },
          { priority: 'high' },
          agent
        )
      ).toEqual({ proposalStatus: 'pending', triageSource: 'agent', lastRunId: RUN });
    });

    test('takes over from a person’s earlier triage', () => {
      expect(
        nextAgentState({ triageSource: 'human' }, { category: 'Network' }, agent)?.triageSource
      ).toBe('agent');
    });

    test('leaves the run out if its id is not a database id, rather than storing something that cannot be', () => {
      for (const runId of ['run-1', '', 'g'.repeat(24), 'a'.repeat(23), undefined]) {
        const next = nextAgentState(undefined, { priority: 'low' }, { role: 'agent', runId });
        expect(next).toEqual({ triageSource: 'agent' });
      }
    });

    test('a change that is not triage leaves it alone', () => {
      expect(nextAgentState(undefined, { status: 'pending-user' }, agent)).toBeUndefined();
      expect(nextAgentState({ triageSource: 'agent' }, {}, agent)).toBeUndefined();
    });
  });

  describe('when a person edits', () => {
    test.each([['category'], ['priority'], ['assignee']])(
      'changing %s after the agent triaged makes the triage theirs',
      (field) => {
        for (const who of [tech, admin, requester]) {
          expect(
            nextAgentState(
              { triageSource: 'agent', lastRunId: RUN, proposalStatus: 'pending' },
              { [field]: 'x' },
              who
            )
          ).toEqual({ triageSource: 'human', lastRunId: RUN, proposalStatus: 'pending' });
        }
      }
    );

    test('changing something else leaves the agent’s triage as it was', () => {
      expect(
        nextAgentState({ triageSource: 'agent' }, { status: 'in-progress' }, tech)
      ).toBeUndefined();
      expect(
        nextAgentState({ triageSource: 'agent' }, { title: 'New title' }, tech)
      ).toBeUndefined();
    });

    test('a person’s first triage of a ticket the agent never touched records nothing', () => {
      expect(nextAgentState(undefined, { priority: 'high' }, tech)).toBeUndefined();
      expect(
        nextAgentState({ proposalStatus: 'none' }, { priority: 'high' }, tech)
      ).toBeUndefined();
    });

    test('a person changing it again once it is already theirs changes nothing', () => {
      expect(nextAgentState({ triageSource: 'human' }, { priority: 'low' }, tech)).toBeUndefined();
    });
  });
});
