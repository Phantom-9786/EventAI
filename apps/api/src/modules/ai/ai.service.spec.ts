import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from './ai.service';

const KEY_A = 'grok-test-key-aaaaaaaaaaaa';
const KEY_B = 'groq-test-key-bbbbbbbbbbbb';

function groqResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function makeService(env: { key?: string; keys?: string }) {
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEYS;
  delete process.env.GROQ_MODEL;
  if (env.key) process.env.GROQ_API_KEY = env.key;
  if (env.keys) process.env.GROQ_API_KEYS = env.keys;
  const moduleRef = await Test.createTestingModule({
    providers: [AiService, { provide: PrismaService, useValue: { event: { findMany: jest.fn().mockResolvedValue([]) } } }],
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
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      groqResponse(200, { choices: [{ message: { content: 'Hello!' } }] }),
    );
    const service = await makeService({ keys: process.env.GROQ_API_KEYS });
    expect(service.isConfigured()).toBe(true);
    const reply = await service.chat([{ role: 'user', content: 'hi' }]);
    expect(reply).toBe('Hello!');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(authHeaderOf(fetchSpy.mock.calls[0] as unknown as [string, RequestInit])).toBe(
      `Bearer ${KEY_A}`,
    );
  });

  it('rotates to the next key on 401 and succeeds', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(groqResponse(401, { error: { message: 'Invalid API Key' } }))
      .mockResolvedValueOnce(groqResponse(200, { choices: [{ message: { content: 'Fallback!' } }] }));
    const service = await makeService({ keys: `${KEY_A},${KEY_B}` });

    const reply = await service.chat([{ role: 'user', content: 'hi' }]);

    expect(reply).toBe('Fallback!');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(authHeaderOf(fetchSpy.mock.calls[0] as unknown as [string, RequestInit])).toBe(`Bearer ${KEY_A}`);
    expect(authHeaderOf(fetchSpy.mock.calls[1] as unknown as [string, RequestInit])).toBe(`Bearer ${KEY_B}`);
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
        groqResponse(429, { error: { message: 'Rate limit reached' } }, { 'retry-after': '20' }),
      );
    const service = await makeService({ keys: `${KEY_A},${KEY_B}` });

    const err = await service.chat([{ role: 'user', content: 'hi' }]).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.response.retryAfterSeconds).toBe(20);
    // Only ONE fetch: the same-org quota means rotation must not happen.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('stops retrying after a key was rate-limited within the same cooldown window', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        groqResponse(429, { error: { message: 'Rate limit reached' } }, { 'retry-after': '30' }),
      );
    const service = await makeService({ key: KEY_A });

    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(ServiceUnavailableException);
    await expect(service.chat([{ role: 'user', content: 'hi again' }])).rejects.toThrow(
      new ServiceUnavailableException(
        'The AI assistant is temporarily unavailable (all API keys exhausted). Please retry shortly.',
      ),
    );
    // The second request must not even reach the provider while cooling down.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries transient provider errors (5xx) once on the same key, then 503s', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(groqResponse(503, { error: { message: 'upstream' } }));
    const service = await makeService({ key: KEY_A });

    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      new ServiceUnavailableException(
        'The AI assistant could not process this request. Please try again later.',
      ),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('recovers when the transient retry succeeds', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(groqResponse(500, { error: { message: 'boom' } }))
      .mockResolvedValueOnce(groqResponse(200, { choices: [{ message: { content: 'Recovered' } }] }));
    const service = await makeService({ key: KEY_A });

    await expect(service.chat([{ role: 'user', content: 'hi' }])).resolves.toBe('Recovered');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('maps network failures and timeouts to 503 after one bounded retry', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('The operation was aborted due to timeout'));
    const service = await makeService({ key: KEY_A });

    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      new ServiceUnavailableException('The AI assistant is unreachable right now.'),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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

  it('rejects empty replies with 503', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(groqResponse(200, { choices: [{ message: { content: '   ' } }] }));
    const service = await makeService({ key: KEY_A });

    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      new ServiceUnavailableException('The AI assistant returned an empty reply.'),
    );
  });

  it('returns the assistant reply grounded in the catalog and honors GROQ_MODEL', async () => {
    process.env.GROQ_MODEL = 'openai/gpt-oss-20b';
    const prisma = { event: { findMany: jest.fn().mockResolvedValue([
      {
        title: 'Summer Gig',
        slug: 'summer-gig',
        startDate: new Date('2026-12-01T18:00:00Z'),
        category: { name: 'Music' },
        venue: { city: 'Mumbai' },
        ticketTypes: [{ price: 150000 }],
      },
    ]) } };
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEYS;
    process.env.GROQ_API_KEY = KEY_A;
    const moduleRef = await Test.createTestingModule({
      providers: [AiService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const service = moduleRef.get(AiService);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(groqResponse(200, { choices: [{ message: { content: 'Go to Summer Gig!' } }] }));

    const reply = await service.chat([{ role: 'user', content: 'What should I attend?' }]);

    expect(reply).toBe('Go to Summer Gig!');
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: { content: string }[];
    };
    expect(body.model).toBe('openai/gpt-oss-20b');
    expect(body.messages[0].content).toContain('Summer Gig');
  });
});
