import { KbFormatError, MIN_BODY_LENGTH, assertUniqueIds, parseArticle, snippetFor } from './kb';

const BODY = `# VPN keeps disconnecting

The VPN connects, then drops every few minutes.

## Steps

1. Check your home internet first.
2. Move closer to the router or use a cable.
3. Fully disconnect the VPN, close the client, and reconnect.
4. Restart the laptop.
`;

const article = (front: Record<string, string | undefined> = {}, body: string = BODY) => {
  const fields: Record<string, string | undefined> = {
    id: 'KB-006',
    title: 'VPN keeps disconnecting',
    category: 'Network',
    last_reviewed: '2026-09-01',
    applies_to: '[Windows, macOS]',
    ...front,
  };
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
};

describe('parseArticle', () => {
  test('reads a valid article', () => {
    expect(parseArticle(article())).toEqual({
      articleId: 'KB-006',
      title: 'VPN keeps disconnecting',
      category: 'Network',
      lastReviewed: new Date('2026-09-01T00:00:00.000Z'),
      appliesTo: ['Windows', 'macOS'],
      body: BODY.trim(),
    });
  });

  test('accepts Windows line endings', () => {
    const parsed = parseArticle(article().replace(/\n/g, '\r\n'));
    expect(parsed.articleId).toBe('KB-006');
    expect(parsed.body).not.toContain('\r');
  });

  test.each([
    ['[Windows, macOS]', ['Windows', 'macOS']],
    ['Windows, macOS', ['Windows', 'macOS']],
    ['[All devices]', ['All devices']],
    ['[ Windows ,  macOS , ]', ['Windows', 'macOS']],
  ])('reads applies_to %s', (value, expected) => {
    expect(parseArticle(article({ applies_to: value })).appliesTo).toEqual(expected);
  });

  test('a key with a value that contains a colon keeps all of it', () => {
    expect(parseArticle(article({ title: 'Reset: the short way' })).title).toBe(
      'Reset: the short way'
    );
  });

  describe('refuses', () => {
    const fails = (markdown: string, message: RegExp) => {
      expect(() => parseArticle(markdown)).toThrow(KbFormatError);
      expect(() => parseArticle(markdown)).toThrow(message);
    };

    test('a file with no front matter', () => {
      fails(BODY, /front-matter block/);
    });

    test('front matter that is never closed', () => {
      fails(`---\nid: KB-006\n\n${BODY}`, /front-matter block/);
    });

    test.each(['id', 'title', 'category', 'last_reviewed', 'applies_to'])(
      'a missing %s',
      (field) => {
        fails(article({ [field]: undefined }), new RegExp(`"${field}" is required`));
      }
    );

    test('an empty value', () => {
      fails(article({ title: '' }), /"title" is required/);
    });

    test('a field it does not know, so a typo is not silently ignored', () => {
      fails(article({ categroy: 'Network' }), /Unknown front-matter field "categroy"/);
    });

    test('a field given twice', () => {
      fails(article().replace('title:', 'id: KB-007\ntitle:'), /appears twice/);
    });

    test('a line that is not key: value', () => {
      fails(article().replace('title:', 'nonsense\ntitle:'), /not "key: value"/);
    });

    test.each(['KB-6', 'kb-006', 'KB-0006', 'ART-006', '006'])('the id %s', (id) => {
      fails(article({ id }), /id must look like KB-006/);
    });

    test('a category that is not one the agent can choose', () => {
      fails(article({ category: 'Endpoint' }), /category must be one of/);
    });

    test.each(['2026-13-01', '2026-02-30', '01/09/2026', '2026-9-1', 'yesterday'])(
      'the date %s',
      (date) => {
        fails(article({ last_reviewed: date }), /real date written YYYY-MM-DD/);
      }
    );

    test('an empty applies_to list', () => {
      fails(article({ applies_to: '[]' }), /applies_to/);
    });

    test('a title that is too long', () => {
      fails(article({ title: 'x'.repeat(121) }), /title must be 120/);
    });

    test('an article that is a stub', () => {
      fails(article({}, 'Just restart it.'), /too short/);
    });

    test('an article that is far too long', () => {
      fails(article({}, `${BODY}\n${'word '.repeat(2000)}`), /longer than 8000/);
    });
  });

  test('the minimum length is a real threshold, not a typo', () => {
    const exact = 'x'.repeat(MIN_BODY_LENGTH);
    expect(() => parseArticle(article({}, exact))).not.toThrow();
    expect(() => parseArticle(article({}, exact.slice(1)))).toThrow(/too short/);
  });
});

describe('assertUniqueIds', () => {
  test('accepts distinct ids', () => {
    expect(() => assertUniqueIds([{ articleId: 'KB-001' }, { articleId: 'KB-002' }])).not.toThrow();
  });

  test('refuses a repeated id, naming it', () => {
    expect(() =>
      assertUniqueIds([{ articleId: 'KB-001' }, { articleId: 'KB-002' }, { articleId: 'KB-001' }])
    ).toThrow(/KB-001/);
  });
});

describe('snippetFor', () => {
  const long =
    '# Title line\n\nFirst paragraph explains the problem in a couple of sentences. ' +
    'It goes on for a while so the article is longer than one snippet. '.repeat(3) +
    '\n\n## Steps\n\n1. Restart the router and wait two minutes.\n2. Reconnect the printer cable firmly.\n';

  test('a short article is returned whole, without markdown marks or its title', () => {
    expect(snippetFor('# Title\n\n- **Restart** the `router`.\n1. Wait.')).toBe(
      'Restart the router. Wait.'
    );
  });

  test('without a search, starts at the beginning of the article', () => {
    const snippet = snippetFor(long);
    expect(snippet.startsWith('First paragraph')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(202);
  });

  test('with a search, shows the text around the first word that matches', () => {
    const snippet = snippetFor(long, 'printer cable');
    expect(snippet).toContain('printer cable');
    expect(snippet.startsWith('…')).toBe(true);
  });

  test('starts and ends on whole words', () => {
    const snippet = snippetFor(long, 'router');
    const inner = snippet.replace(/^…/, '').replace(/…$/, '');
    for (const word of inner.split(' ')) expect(long).toContain(word);
  });

  test('when no search word appears, it starts at the beginning', () => {
    expect(snippetFor(long, 'zebra').startsWith('First paragraph')).toBe(true);
  });

  test('ignores short words and search syntax', () => {
    expect(snippetFor(long, '"to" -printer').startsWith('…')).toBe(true);
    expect(snippetFor(long, 'to it').startsWith('First paragraph')).toBe(true);
  });

  test('does not drop a heading that is not the first line', () => {
    const body = `Intro text that comes first and is fairly long so that this is not a tiny article, ${'padding '.repeat(30)}\n\n## Steps\n\n1. Do it.`;
    expect(snippetFor(body, 'steps')).toContain('Steps');
  });
});
