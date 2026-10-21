import { ServiceUnavailableException } from '../../common/exceptions';
import { Test } from '../../common/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { AiService } from './ai.service';

const KEY_A = 'grok-test-key-aaaaaaaaaaaa';
const KEY_B = 'groq-test-key-bbbbbbbbbbbb';

function groqResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

const CATALOG_ROW = {
  id: 'evt-1',
  title: 'Mumbai Indie Night',
  slug: 'mumbai-indie-night',
  shortDescription: 'An evening of indie music by the sea.',
  startDate: new Date('2026-10-24T18:00:00Z'),
  endDate: new Date('2026-10-24T22:00:00Z'),
  images: [],
  coverImage: 'https://cdn.example.test/indie-night.jpg',
  isFeatured: false,
  category: { id: 'cat-1', name: 'Music', slug: 'music' },
  venue: { id: 'ven-1', name: 'Demo Arena', city: 'Mumbai' },
  organizer: { id: 'org-1', organizationName: 'Indie Collective' },
  ticketTypes: [{ price: 49900 }, { price: 149700 }],
};

function makePrismaMock(catalog: unknown[] = [], matched: unknown[] = []) {
  return {
    category: { findMany: jest.fn().mockResolvedValue([{ name: 'Music', slug: 'music' }]) },
    event: {
      findMany: jest
        .fn()
        .mockImplementation((args: { where: Record<string, unknown> }) =>
          'slug' in args.where ? Promise.resolve(matched) : Promise.resolve(catalog),
        ),
    },
  };
}

async function makeService(
  env: {
    key?: string;
    keys?: string;
    simple?: string;
    moderate?: string;
    complex?: string;
  },
  prisma = makePrismaMock(),
) {
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEYS;
  delete process.env.GROQ_MODEL;
  delete process.env.GROQ_SIMPLE_MODEL;
  delete process.env.GROQ_MODERATE_MODEL;
  delete process.env.GROQ_COMPLEX_MODEL;
  if (env.key) process.env.GROQ_API_KEY = env.key;
  if (env.keys) process.env.GROQ_API_KEYS = env.keys;
  if (env.simple) process.env.GROQ_SIMPLE_MODEL = env.simple;
  if (env.moderate) process.env.GROQ_MODERATE_MODEL = env.moderate;
  if (env.complex) process.env.GROQ_COMPLEX_MODEL = env.complex;
  const moduleRef = await Test.createTestingModule({
    providers: [
      AiService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: CacheService,
        useValue: {
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue(undefined),
          providerCooldownMs: jest.fn().mockResolvedValue(0),
          setProviderCooldown: jest.fn().mockResolvedValue(undefined),
        },
      },
    ],
  }).compile();
  return moduleRef.get(AiService);
}

const authHeaderOf = (call: [string, RequestInit]) => {
  const headers = call[1].headers as Record<string, string>;
  return headers.Authorization;
};

describe('AiService key management', () => {
  afterEach(() => {
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEYS;
    delete process.env.GROQ_MODEL;
    delete process.env.GROQ_SIMPLE_MODEL;
    delete process.env.GROQ_MODERATE_MODEL;
    delete process.env.GROQ_COMPLEX_MODEL;
    delete process.env.AI_REQUEST_TIMEOUT_MS;
    delete process.env.AI_MAX_OUTPUT_TOKENS;
    jest.restoreAllMocks();
  });

  it('treats missing, placeholder, and junk keys as unconfigured (no external call)', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    for (const env of [{}, { key: 'gsk_xxxxxxxxxxxxxxxxxxxxxxxx' }, { key: 'short' }]) {
      const service = await makeService(env);
      expect(service.isConfigured()).toBe(false);
      await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
        ServiceUnavailableException,
      );
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts a comma-separated GROQ_API_KEYS list and succeeds on the first key', async () => {
    process.env.GROQ_API_KEYS = `${KEY_A},${KEY_B}`;
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        groqResponse(200, { choices: [{ message: { content: 'Hello!' } }] }),
      );
    const service = await makeService({ keys: process.env.GROQ_API_KEYS });
    expect(service.isConfigured()).toBe(true);
    const result = await service.chat([{ role: 'user', content: 'hi' }]);
    expect(result.reply).toBe('Hello!');
    expect(result.events).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(authHeaderOf(fetchSpy.mock.calls[0] as unknown as [string, RequestInit])).toBe(
      `Bearer ${KEY_A}`,
    );
  });

  it('rotates to the next key on 401 and succeeds', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(groqResponse(401, { error: { message: 'Invalid API Key' } }))
      .mockResolvedValueOnce(
        groqResponse(200, { choices: [{ message: { content: 'Fallback!' } }] }),
      );
    const service = await makeService({ keys: `${KEY_A},${KEY_B}` });

    const result = await service.chat([{ role: 'user', content: 'hi' }]);

    expect(result.reply).toBe('Fallback!');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(authHeaderOf(fetchSpy.mock.calls[0] as unknown as [string, RequestInit])).toBe(
      `Bearer ${KEY_A}`,
    );
    expect(authHeaderOf(fetchSpy.mock.calls[1] as unknown as [string, RequestInit])).toBe(
      `Bearer ${KEY_B}`,
    );
  });

  it('fails with 503 when every key is rejected', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(groqResponse(403, { error: { message: 'revoked' } }));
    const service = await makeService({ keys: `${KEY_A},${KEY_B}` });

    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      new ServiceUnavailableException(
        'The AI assistant is temporarily unavailable (all API keys exhausted). Please retry shortly.',
      ),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects on 429 with a retry hint and never rotates keys', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        groqResponse(
          429,
          { error: { message: 'Rate limit reached' } },
          { 'retry-after': '20' },
        ),
      );
    const service = await makeService({ keys: `${KEY_A},${KEY_B}` });

    const err = await service
      .chat([{ role: 'user', content: 'hi' }])
      .catch((e: any) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.response.retryAfterSeconds).toBe(20);
    // Only ONE fetch: the same-org quota means rotation must not happen.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('stops retrying after a key was rate-limited within the same cooldown window', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        groqResponse(
          429,
          { error: { message: 'Rate limit reached' } },
          { 'retry-after': '30' },
        ),
      );
    const service = await makeService({ key: KEY_A });

    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(service.chat([{ role: 'user', content: 'hi again' }])).rejects.toThrow(
      new ServiceUnavailableException(
        'The AI assistant is temporarily unavailable (all API keys exhausted). Please retry shortly.',
      ),
    );
    // The second request must not even reach the provider while cooling down.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries a transient provider error once, then escalates once and 503s', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(groqResponse(503, { error: { message: 'upstream' } }));
    const service = await makeService({ key: KEY_A });

    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      new ServiceUnavailableException(
        'The AI assistant could not process this request. Please try again later.',
      ),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('recovers when the transient retry succeeds', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(groqResponse(500, { error: { message: 'boom' } }))
      .mockResolvedValueOnce(
        groqResponse(200, { choices: [{ message: { content: 'Recovered' } }] }),
      );
    const service = await makeService({ key: KEY_A });

    await expect(service.chat([{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      reply: 'Recovered',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('escalates a simple request once after bounded transient retries', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(groqResponse(503, {}))
      .mockResolvedValueOnce(groqResponse(503, {}))
      .mockResolvedValueOnce(
        groqResponse(200, { choices: [{ message: { content: 'Recovered' } }] }),
      );
    const service = await makeService({ key: KEY_A });
    await expect(
      service.chat([{ role: 'user', content: 'Hello' }]),
    ).resolves.toMatchObject({ reply: 'Recovered' });
    const models = fetchSpy.mock.calls.map(
      (call) => JSON.parse(String((call[1] as RequestInit).body)).model,
    );
    expect(models).toEqual([
      'openai/gpt-oss-20b',
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
    ]);
  });

  it('fails closed without querying Groq when shared cooldown storage is unavailable', async () => {
    process.env.GROQ_API_KEY = KEY_A;
    const service = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: PrismaService, useValue: makePrismaMock() },
        {
          provide: CacheService,
          useValue: {
            providerCooldownMs: jest.fn().mockRejectedValue(new Error('redis')),
          },
        },
      ],
    })
      .compile()
      .then((moduleRef) => moduleRef.get(AiService));
    const fetchSpy = jest.spyOn(global, 'fetch');
    await expect(service.chat([{ role: 'user', content: 'Hello' }])).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps network failures to 503 after one retry and one model escalation', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('The operation was aborted due to timeout'));
    const service = await makeService({ key: KEY_A });

    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      new ServiceUnavailableException('The AI assistant is unreachable right now.'),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('does not retry permanent 4xx errors (e.g. unknown model)', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(groqResponse(404, { error: { message: 'model not found' } }));
    const service = await makeService({ key: KEY_A });

    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      new ServiceUnavailableException(
        'The AI assistant could not process this request. Please try again later.',
      ),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries an empty reply once before returning 503', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () =>
        groqResponse(200, { choices: [{ message: { content: '   ' } }] }),
      );
    const service = await makeService({ key: KEY_A });

    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      new ServiceUnavailableException('The AI assistant returned an empty reply.'),
    );
  });
});

describe('AiService structured event recommendations', () => {
  afterEach(() => {
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEYS;
    delete process.env.GROQ_MODEL;
    delete process.env.GROQ_SIMPLE_MODEL;
    delete process.env.GROQ_MODERATE_MODEL;
    delete process.env.GROQ_COMPLEX_MODEL;
    delete process.env.AI_REQUEST_TIMEOUT_MS;
    delete process.env.AI_MAX_OUTPUT_TOKENS;
    jest.restoreAllMocks();
  });

  it('strips the EVENTS trailer (even when the model bolds it) and maps slugs to real catalog records', async () => {
    const prisma = makePrismaMock([], [CATALOG_ROW]);
    const service = await makeService({ key: KEY_A }, prisma);
    jest.spyOn(global, 'fetch').mockResolvedValue(
      groqResponse(200, {
        choices: [
          {
            message: {
              content:
                'You could catch **Mumbai Indie Night** by the sea this month.\n\n**EVENTS:** mumbai-indie-night',
            },
          },
        ],
      }),
    );

    const result = await service.chat([{ role: 'user', content: 'recommend something' }]);

    expect(result.reply).toBe(
      'Here are events matching your request. Select a card to explore.',
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: 'evt-1',
      title: 'Mumbai Indie Night',
      slug: 'mumbai-indie-night',
      startDate: '2026-10-24T18:00:00.000Z',
      minPrice: 49900,
      maxPrice: 149700,
      images: ['https://cdn.example.test/indie-night.jpg'],
      venue: { name: 'Demo Arena', city: 'Mumbai' },
    });
    // The mapping query must be slug-scoped to real, published, upcoming rows.
    const mappingCall = (prisma.event.findMany as jest.Mock).mock.calls.find(
      (c) => 'slug' in c[0].where,
    );
    expect(mappingCall[0].where).toMatchObject({
      slug: { in: ['mumbai-indie-night'] },
      status: 'PUBLISHED',
    });
  });

  it('returns no events when the reply has no EVENTS trailer', async () => {
    const service = await makeService({ key: KEY_A });
    jest.spyOn(global, 'fetch').mockResolvedValue(
      groqResponse(200, {
        choices: [{ message: { content: 'Plan with **bold** and - lists' } }],
      }),
    );

    const result = await service.chat([{ role: 'user', content: 'hi' }]);

    expect(result.reply).toBe('Plan with **bold** and - lists');
    expect(result.events).toEqual([]);
  });

  it('drops invented/unknown slugs instead of fabricating events', async () => {
    const prisma = makePrismaMock([], []); // DB knows nothing about the slugs
    const service = await makeService({ key: KEY_A }, prisma);
    jest.spyOn(global, 'fetch').mockResolvedValue(
      groqResponse(200, {
        choices: [
          {
            message: {
              content: 'Check out **Fake Fest**!\n\nEVENTS: fake-fest, never-happened',
            },
          },
        ],
      }),
    );

    const result = await service.chat([{ role: 'user', content: 'hi' }]);

    expect(result.reply).toBe('Check out **Fake Fest**!');
    expect(result.events).toEqual([]);
  });
});

describe('AiService model routing', () => {
  afterEach(() => {
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEYS;
    delete process.env.GROQ_MODEL;
    delete process.env.GROQ_SIMPLE_MODEL;
    delete process.env.GROQ_MODERATE_MODEL;
    delete process.env.GROQ_COMPLEX_MODEL;
    jest.restoreAllMocks();
  });

  it.each([
    ['Hello!', 'simple-model'],
    ['Which music events would you recommend?', 'moderate-model'],
    [
      'Create a detailed step-by-step plan that compares options and includes contingencies.',
      'complex-model',
    ],
  ])('routes prompt to the %s task profile', async (prompt, expectedModel) => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      groqResponse(200, {
        choices: [{ message: { content: 'Here are some events.' } }],
      }),
    );
    const service = await makeService({
      key: KEY_A,
      simple: 'simple-model',
      moderate: 'moderate-model',
      complex: 'complex-model',
    });
    await service.chat([{ role: 'user', content: prompt }]);
    const request = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body));
    expect(request.model).toBe(expectedModel);
    expect(request.max_tokens).toBe(1400);
    expect(request.response_format).toEqual({ type: 'json_object' });
    expect(request.messages[0].role).toBe('system');
  });
});

describe('AiService event context', () => {
  it('returns clickable catalog cards even when the model omits its EVENTS trailer', async () => {
    const prisma = makePrismaMock([CATALOG_ROW], [CATALOG_ROW]);
    jest.spyOn(global, 'fetch').mockResolvedValue(
      groqResponse(200, {
        choices: [
          {
            message: {
              content: 'Try these:\n- **Mumbai Indie Night** — live music by the sea.',
            },
          },
        ],
      }),
    );
    const service = await makeService({ key: KEY_A }, prisma);
    const result = await service.chat([{ role: 'user', content: 'Recommend music' }]);
    expect(result.events.map((event: { slug: string }) => event.slug)).toEqual([
      'mumbai-indie-night',
    ]);
    expect(result.reply).not.toContain('- **Mumbai Indie Night**');
  });
  afterEach(() => {
    delete process.env.GROQ_API_KEY;
    jest.restoreAllMocks();
  });
  it('uses compact published event references before retrieving detail passages', async () => {
    const prisma = {
      ...makePrismaMock(),
      event: {
        ...makePrismaMock().event,
        findFirst: jest.fn().mockResolvedValue({
          ...CATALOG_ROW,
          title: 'Context event',
          description: 'Actual event facts',
          policies: 'No outside food',
          cancellationPolicy: 'No refunds',
          ticketTypes: [],
          faqs: [],
        }),
      },
    };
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        groqResponse(200, { choices: [{ message: { content: 'Here are the facts.' } }] }),
      );
    const service = await makeService({ key: KEY_A }, prisma);
    await service.chat([{ role: 'user', content: 'What is allowed?' }], 'event-context');
    expect(prisma.event.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'event-context', status: 'PUBLISHED' } }),
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.messages[1].content).toContain('Context event');
    expect(body.messages[1].content).not.toContain('No outside food');
    expect(body.messages[1].content).not.toContain('No refunds');
  });
  it('does not send missing or unpublished event context to the provider', async () => {
    const prisma = {
      ...makePrismaMock(),
      event: { ...makePrismaMock().event, findFirst: jest.fn().mockResolvedValue(null) },
    };
    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = await makeService({ key: KEY_A }, prisma);
    await expect(
      service.chat([{ role: 'user', content: 'Help' }], 'missing'),
    ).rejects.toThrow('This published event is not available.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('AI catalog shortcuts', () => {
  it('uses only available categories and does not call zero sales popular', async () => {
    const service = await makeService({}, makePrismaMock([CATALOG_ROW]));
    const result = await service.suggestions();
    expect(result.suggestions.map((item: { title: string }) => item.title)).toEqual([
      'Upcoming events',
      'Music',
    ]);
  });
  it('shows no fabricated shortcuts for an empty catalog', async () => {
    const service = await makeService({});
    expect(await service.suggestions()).toEqual({ suggestions: [] });
  });
  it('labels popularity only when paid ticket sales are present', async () => {
    const prisma = makePrismaMock([{ ...CATALOG_ROW, _count: { tickets: 8 } }]);
    const service = await makeService({}, prisma);
    expect((await service.suggestions()).suggestions[0].title).toBe('Popular tickets');
    expect(
      prisma.event.findMany.mock.calls[0][0].select._count.select.tickets.where.booking
        .payment,
    ).toEqual({ status: 'CAPTURED', amount: { gt: 0 } });
  });
});

describe('AI recommendation order', () => {
  afterEach(() => jest.restoreAllMocks());
  it('puts an artist match before a more popular generic music event', async () => {
    const exact = {
      ...CATALOG_ROW,
      title: 'Travis Scott Music Night',
      slug: 'travis-night',
      description: 'Travis Scott hip-hop',
      tags: ['hip-hop'],
      _count: { tickets: 1 },
    };
    const popular = {
      ...CATALOG_ROW,
      title: 'Classical Orchestra',
      slug: 'classical',
      description: 'Classical music',
      tags: ['classical'],
      _count: { tickets: 100 },
    };
    const service = await makeService(
      { key: KEY_A },
      makePrismaMock([popular, exact], [popular, exact]),
    );
    jest.spyOn(global, 'fetch').mockResolvedValue(
      groqResponse(200, {
        choices: [
          { message: { content: 'Choose a card.\nEVENTS: classical, travis-night' } },
        ],
      }),
    );
    const result = await service.chat([{ role: 'user', content: 'Travis Scott music' }]);
    expect(result.events.map((event: { slug: string }) => event.slug)).toEqual([
      'travis-night',
    ]);
  });
});

describe('AI recommendation presentation', () => {
  afterEach(() => jest.restoreAllMocks());
  it('returns one introduction instead of repeating event paragraphs alongside cards', async () => {
    const service = await makeService(
      { key: KEY_A },
      makePrismaMock([CATALOG_ROW], [CATALOG_ROW]),
    );
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        groqResponse(200, {
          choices: [
            {
              message: {
                content:
                  'Here are some ideas.\n\n### Mumbai Indie Night\nAn evening of indie music by the sea.\nEVENTS: mumbai-indie-night',
              },
            },
          ],
        }),
      );
    const result = await service.chat([
      { role: 'user', content: 'Suggest music events' },
    ]);
    expect(result.events).toHaveLength(1);
    expect(result.reply).toBe(
      'Here are events matching your request. Select a card to explore.',
    );
    expect(result.reply).not.toContain('Mumbai Indie Night');
  });
});


describe('Structured discovery filters', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([
    ['Show me all events', {}],
    ['music', { category: 'music' }],
  ])('keeps a complete Discover link for %s', async (prompt, search) => {
    process.env.GROQ_API_KEY = KEY_A;
    const database = { searchEvents: jest.fn().mockResolvedValue({ events: [CATALOG_ROW], total: 40 }) };
    const service = new AiService(makePrismaMock([CATALOG_ROW]) as never, { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), providerCooldownMs: jest.fn().mockResolvedValue(0) } as never, database as never);
    const provider = jest.spyOn(global, 'fetch').mockResolvedValue(groqResponse(200, { choices: [{ message: { content: JSON.stringify({ reply: 'Here are some ideas.', search, slugs: [] }) } }] }));
    const result = await service.chat([{ role: 'user', content: String(prompt) }]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(40);
    expect(result.moreEventsUrl).toMatch(/^\/events\?/);
    const filters = JSON.parse(new URL(result.moreEventsUrl!, 'http://localhost').searchParams.get('aiFilters')!);
    expect(filters).toMatchObject(search);
    expect(database.searchEvents).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 6, aiFilters: JSON.stringify(filters) }));
  });

  it.each([0, 2, 6])('omits More events when all %s matches fit in chat', async total => {
    process.env.GROQ_API_KEY = KEY_A;
    const database = { searchEvents: jest.fn().mockResolvedValue({ events: Array(total).fill(CATALOG_ROW), total }) };
    const service = new AiService(makePrismaMock([CATALOG_ROW]) as never, { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), providerCooldownMs: jest.fn().mockResolvedValue(0) } as never, database as never);
    jest.spyOn(global, 'fetch').mockResolvedValue(groqResponse(200, { choices: [{ message: { content: JSON.stringify({ reply: 'Found', search: { category: 'music' }, slugs: [] }) } }] }));
    expect((await service.chat([{ role: 'user', content: 'music' }])).moreEventsUrl).toBeUndefined();
  });

  it('searches prior mood after any-city even when the model asks another clarification', async () => {
    process.env.GROQ_API_KEY = KEY_A;
    const database = { searchEvents: jest.fn().mockResolvedValue({ events: [CATALOG_ROW], total: 1, retrievalMode: 'hybrid' }) };
    const service = new AiService(makePrismaMock([CATALOG_ROW]) as never, { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), providerCooldownMs: jest.fn().mockResolvedValue(0) } as never, database as never);
    jest.spyOn(global, 'fetch').mockResolvedValue(groqResponse(200, { choices: [{ message: { content: JSON.stringify({ reply: 'What budget?', search: null, slugs: [] }) } }] }));
    const result = await service.chat([{ role: 'user', content: 'We are three friends wanting a relaxed evening' }, { role: 'assistant', content: 'Which city?' }, { role: 'user', content: 'We are free to choose any city' }]);
    expect(result.events).toHaveLength(1);
    expect(JSON.parse(database.searchEvents.mock.calls[0][0].aiFilters)).toMatchObject({ partySize: 3 });
  });

  it('repairs a Groq JSON-validation rejection once', async () => {
    process.env.GROQ_API_KEY = KEY_A;
    const service = new AiService(makePrismaMock() as never, { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), providerCooldownMs: jest.fn().mockResolvedValue(0) } as never);
    const provider = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(groqResponse(400, { error: { code: 'json_validate_failed' } }))
      .mockResolvedValueOnce(groqResponse(200, { choices: [{ message: { content: JSON.stringify({ reply: 'Hello!', search: null, slugs: [] }) } }] }));
    expect((await service.chat([{ role: 'user', content: 'Hello' }])).reply).toBe('Hello!');
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('recovers a rejected native tool call with a JSON-only turn', async () => {
    process.env.GROQ_API_KEY = KEY_A;
    const service = new AiService(makePrismaMock() as never, { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), providerCooldownMs: jest.fn().mockResolvedValue(0) } as never);
    const provider = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(groqResponse(400, { error: { code: 'tool_use_failed' } }))
      .mockResolvedValueOnce(groqResponse(200, { choices: [{ message: { content: JSON.stringify({ intent: 'answer', reply: 'Hello! What are you in the mood for?', search: null, slugs: [] }) } }] }));
    const result = await service.chat([{ role: 'user', content: 'hi' }]);
    expect(result.reply).toBe('Hello! What are you in the mood for?');
    expect(result.events).toEqual([]);
    expect(provider).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(provider.mock.calls[1][1]!.body as string);
    expect(payload.tool_choice).toBe('none');
    expect(payload.messages.at(-1).content).toContain('Never call a function or tool');
    expect(payload.messages[0].content).toContain('Reply in English by default');
    expect(payload.response_format.type).toBe('json_schema');
    expect(payload.response_format.json_schema.strict).toBe(true);
    expect(payload.response_format.json_schema.schema.properties.search.additionalProperties).toBe(false);
  });

  it('accepts nullable strict-schema fields and retrieves a relaxed group request', async () => {
    process.env.GROQ_API_KEY = KEY_A;
    const database = { searchEvents: jest.fn().mockResolvedValue({ events: [CATALOG_ROW], total: 1, retrievalMode: 'hybrid' }) };
    const service = new AiService(makePrismaMock([CATALOG_ROW]) as never, { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), providerCooldownMs: jest.fn().mockResolvedValue(0) } as never, database as never);
    const search = { query: null, category: null, city: null, dateFrom: null, dateTo: null,
      priceMin: null, priceMax: null, partySize: 3, excludedKeywords: null, semanticQuery: 'relaxed evening with friends' };
    const provider = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(groqResponse(200, { choices: [{ message: { content: JSON.stringify({ intent: 'search', reply: 'Let me find some options.', search, slugs: [], evidenceQuery: null, memory: 'Three friends, relaxed evening, any city.' }) } }] }))
      .mockResolvedValueOnce(groqResponse(200, { choices: [{ message: { content: JSON.stringify({ intent: 'answer', reply: 'Here is an option for your evening.', search: null, slugs: [], evidenceQuery: null, memory: '' }) } }] }));
    const currentQuestion = 'We are three friends looking for a relaxed evening, any city';
    const result = await service.chat([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Namaste, aap kaise hain?' }, { role: 'user', content: currentQuestion }]);
    expect(result.events).toHaveLength(1);
    const filters = JSON.parse(database.searchEvents.mock.calls[0][0].aiFilters);
    expect(filters).toMatchObject({ partySize: 3, semanticQuery: 'relaxed evening with friends' });
    expect(filters).not.toHaveProperty('city');
    expect(filters).not.toHaveProperty('query');
    expect(filters).not.toHaveProperty('filters');
    const grounded = JSON.parse(provider.mock.calls[1][1]!.body as string);
    expect(grounded.messages.filter((message: { role: string }) => message.role === 'user')).toEqual([{ role: 'user', content: currentQuestion }]);
    expect(JSON.stringify(grounded.messages)).not.toContain('Namaste');
    expect(grounded.response_format.json_schema.schema.properties.reply.maxLength).toBe(420);
    expect(grounded.messages.at(-1).content).toContain('startDateLabel');
  });

  it.each([null, { category: 'music', semanticQuery: 'relaxed evening' }])('handles a new conversational category request even with search=%j', async search => {
    process.env.GROQ_API_KEY = KEY_A;
    const database = { searchEvents: jest.fn().mockResolvedValue({ events: [CATALOG_ROW], total: 1 }) };
    const service = new AiService(makePrismaMock([CATALOG_ROW]) as never, { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), providerCooldownMs: jest.fn().mockResolvedValue(0) } as never, database as never);
    jest.spyOn(global, 'fetch').mockResolvedValue(groqResponse(200, { choices: [{ message: { content: JSON.stringify({ reply: 'What budget?', search, slugs: [] }) } }] }));
    await service.chat([{ role: 'user', content: 'We want a relaxed evening' }, { role: 'assistant', content: 'Here are some ideas' }, { role: 'user', content: 'some music events dont u have for us' }]);
    const filters = JSON.parse(database.searchEvents.mock.calls[0][0].aiFilters);
    expect(filters.category).toBe('music');
    expect(filters).not.toHaveProperty('semanticQuery');
  });
});
