import { agentModes, agentToolTiers, type AgentRunMode } from '../../shared/agent-constants';
import {
  autoModeAvailable,
  disposition,
  effectiveMode,
  mayPostAlone,
  postingRefusal,
  type AgentPolicySettings,
} from './agentPolicy';

const settings = (overrides: Partial<AgentPolicySettings> = {}): AgentPolicySettings => ({
  killSwitch: false,
  defaultMode: 'shadow',
  modeByCategory: {},
  autoAllowlist: [],
  ...overrides,
});

describe('effectiveMode', () => {
  test('is the default when a category has none of its own', () => {
    expect(effectiveMode(settings({ defaultMode: 'assist' }), 'Network')).toBe('assist');
  });

  test('a category with its own mode uses it, in either direction', () => {
    const s = settings({
      defaultMode: 'assist',
      modeByCategory: { Security: 'off', Email: 'auto' },
    });
    expect(effectiveMode(s, 'Security')).toBe('off');
    expect(effectiveMode(s, 'Email')).toBe('auto');
    expect(effectiveMode(s, 'Network')).toBe('assist');
  });

  test.each(agentModes)('the kill switch beats a %s default and every category', (mode) => {
    const s = settings({ killSwitch: true, defaultMode: mode, modeByCategory: { Email: 'auto' } });
    expect(effectiveMode(s, 'Email')).toBe('off');
    expect(effectiveMode(s, 'Network')).toBe('off');
  });

  test('a category name is matched exactly, so it cannot be widened by casing or a prefix', () => {
    const s = settings({ defaultMode: 'shadow', modeByCategory: { Email: 'auto' } });
    expect(effectiveMode(s, 'email')).toBe('shadow');
    expect(effectiveMode(s, 'Email ')).toBe('shadow');
  });

  // A ticket's category is free text a requester types. These must never look anything up on the
  // object's prototype, or pick a mode nobody configured.
  test.each(['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf'])(
    'the category "%s" gets the default, not something inherited',
    (category) => {
      expect(effectiveMode(settings({ defaultMode: 'shadow' }), category)).toBe('shadow');
      expect(effectiveMode(settings({ defaultMode: 'assist' }), category)).toBe('assist');
    }
  );

  test('a mode that is only inherited, not listed, is not used even if it is a real mode', () => {
    // As if something had polluted the prototype: `Email` is not an own key of the settings.
    const inherited = Object.create({ Email: 'auto' }) as Record<string, never>;
    const s = settings({ defaultMode: 'shadow', modeByCategory: inherited });
    expect(effectiveMode(s, 'Email')).toBe('shadow');
  });

  test('a mode in the settings that is not a real mode is ignored, not obeyed', () => {
    const s = settings({
      defaultMode: 'shadow',
      modeByCategory: { Email: 'yolo' as never, Network: 42 as never, Access: null as never },
    });
    expect(effectiveMode(s, 'Email')).toBe('shadow');
    expect(effectiveMode(s, 'Network')).toBe('shadow');
    expect(effectiveMode(s, 'Access')).toBe('shadow');
  });
});

describe('disposition', () => {
  // The whole table, written out by hand so a change to the rules is a deliberate edit here.
  const expected: Record<AgentRunMode, Record<(typeof agentToolTiers)[number], string>> = {
    shadow: {
      read: 'run',
      'write-low': 'dry-run',
      'write-draft': 'dry-run',
      'write-high': 'dry-run',
    },
    assist: { read: 'run', 'write-low': 'run', 'write-draft': 'run', 'write-high': 'refuse' },
    auto: { read: 'run', 'write-low': 'run', 'write-draft': 'run', 'write-high': 'run' },
  };

  for (const mode of ['shadow', 'assist', 'auto'] as const) {
    test.each(agentToolTiers)(`${mode} mode, %s tool`, (tier) => {
      expect(disposition(mode, tier)).toBe(expected[mode][tier]);
    });
  }

  test('reading always runs, in every mode', () => {
    for (const mode of ['shadow', 'assist', 'auto'] as const) {
      expect(disposition(mode, 'read')).toBe('run');
    }
  });

  test('nothing changes a ticket in shadow mode: every write is only recorded', () => {
    for (const tier of agentToolTiers) {
      if (tier !== 'read') expect(disposition('shadow', tier)).toBe('dry-run');
    }
  });

  test.each(['off', 'yolo', 'constructor', '', undefined])(
    'a mode that is not a run mode (%s) fails closed: nothing that writes runs',
    (mode) => {
      for (const tier of ['write-low', 'write-draft', 'write-high'] as const) {
        expect(disposition(mode as never, tier)).toBe('refuse');
      }
      expect(disposition(mode as never, 'read')).toBe('run');
    }
  );

  test('posting a reply is refused in assist mode, so the agent must propose or escalate', () => {
    expect(disposition('assist', 'write-high')).toBe('refuse');
  });
});

describe('mayPostAlone', () => {
  const allow = { autoAllowlist: ['Email', 'Software'] };

  test('only in auto mode, and only for an allowlisted category', () => {
    expect(mayPostAlone(allow, 'auto', 'Email')).toBe(true);
    expect(mayPostAlone(allow, 'auto', 'Network')).toBe(false);
    expect(mayPostAlone(allow, 'assist', 'Email')).toBe(false);
    expect(mayPostAlone(allow, 'shadow', 'Email')).toBe(false);
  });

  test('an empty allowlist means never', () => {
    expect(mayPostAlone({ autoAllowlist: [] }, 'auto', 'Email')).toBe(false);
  });
});

describe('autoModeAvailable', () => {
  test('is available locally and in Docker, and not on Vercel', () => {
    expect(autoModeAvailable({})).toBe(true);
    expect(autoModeAvailable({ PORT: '5000' })).toBe(true);
    expect(autoModeAvailable({ VERCEL: '1' })).toBe(false);
  });

  test('can be allowed on Vercel by saying so, and only by saying exactly true', () => {
    expect(autoModeAvailable({ VERCEL: '1', AGENT_ALLOW_AUTO: 'true' })).toBe(true);
    for (const value of ['1', 'yes', 'TRUE', '', 'false']) {
      expect(autoModeAvailable({ VERCEL: '1', AGENT_ALLOW_AUTO: value })).toBe(false);
    }
  });
});

describe('postingRefusal', () => {
  const allowed = settings({ defaultMode: 'auto', autoAllowlist: ['Email'] });

  test('lets a high-confidence reply through where auto is on and the category is listed', () => {
    expect(postingRefusal(allowed, 'Email', 'high', {})).toBeNull();
  });

  test('refuses while the kill switch is on, before anything else', () => {
    expect(postingRefusal({ ...allowed, killSwitch: true }, 'Email', 'high', {})).toMatch(
      /stopped/
    );
  });

  test('refuses where the deployment does not allow auto mode', () => {
    expect(postingRefusal(allowed, 'Email', 'high', { VERCEL: '1' })).toMatch(/not available/);
    expect(
      postingRefusal(allowed, 'Email', 'high', { VERCEL: '1', AGENT_ALLOW_AUTO: 'true' })
    ).toBeNull();
  });

  test.each(['off', 'shadow', 'assist'] as const)(
    'refuses a category whose own mode is %s, even though it is listed',
    (mode) => {
      const s = settings({ ...allowed, modeByCategory: { Email: mode } });
      expect(postingRefusal(s, 'Email', 'high', {})).toMatch(/not on for the Email category/);
    }
  );

  test('refuses a category that is not on the list, though auto is the mode', () => {
    expect(postingRefusal(allowed, 'Network', 'high', {})).toMatch(/not on the list/);
    expect(postingRefusal(settings({ defaultMode: 'auto' }), 'Email', 'high', {})).toMatch(
      /not on the list/
    );
  });

  test('never answers Security alone, even if it is wrongly on the list', () => {
    const s = settings({ defaultMode: 'auto', autoAllowlist: ['Security'] });
    expect(postingRefusal(s, 'Security', 'high', {})).toMatch(/never answers a Security ticket/);
  });

  test.each(['medium', 'low', '', 'HIGH', 'certain'])('refuses confidence %j', (confidence) => {
    expect(postingRefusal(allowed, 'Email', confidence, {})).toMatch(/high confidence/);
  });

  test('a category that only looks like a setting name gets the default, not an inherited value', () => {
    expect(
      postingRefusal(
        settings({ defaultMode: 'assist', autoAllowlist: ['constructor'] }),
        'constructor',
        'high',
        {}
      )
    ).toMatch(/not on for/);
  });
});
