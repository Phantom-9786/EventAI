import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from './ai.service';

describe('AiService', () => {
  let service: AiService;
  let prisma: { event: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { event: { findMany: jest.fn().mockResolvedValue([]) } };
    const moduleRef = await Test.createTestingModule({
      providers: [AiService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AiService);
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_MODEL;
  });

  afterEach(() => {
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_MODEL;
    jest.restoreAllMocks();
  });

  it('treats a missing or placeholder key as unconfigured', () => {
    expect(service.isConfigured()).toBe(false);
    process.env.GROQ_API_KEY = 'gsk_xxxxxxxxxxxxxxxxxxxxxxxx';
    expect(service.isConfigured()).toBe(false);
    process.env.GROQ_API_KEY = 'gsk-real-key-1234567890';
    expect(service.isConfigured()).toBe(true);
  });

  it('rejects with 503 when unconfigured (no external call made)', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the assistant reply grounded in the catalog when configured', async () => {
    process.env.GROQ_API_KEY = 'gsk-real-key-1234567890';
    prisma.event.findMany.mockResolvedValue([
      {
        title: 'Summer Gig',
        slug: 'summer-gig',
        startDate: new Date('2026-12-01T18:00:00Z'),
        category: { name: 'Music' },
        venue: { city: 'Mumbai' },
        ticketTypes: [{ price: 150000 }],
      },
    ]);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'Go to Summer Gig!' } }] }), {
          status: 200,
        }),
      );

    const reply = await service.chat([{ role: 'user', content: 'What should I attend?' }]);

    expect(reply).toBe('Go to Summer Gig!');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: { content: string }[];
    };
    expect(body.model).toBe('llama-3.3-70b-versatile');
    expect(body.messages[0].content).toContain('Summer Gig');
  });

  it('maps provider errors to 503 with a generic message', async () => {
    process.env.GROQ_API_KEY = 'gsk-real-key-1234567890';
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'rate limit exceeded' } }), { status: 429 }),
    );

    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      new ServiceUnavailableException(
        'The AI assistant could not process this request. Please try again later.',
      ),
    );
  });

  it('maps network failures to 503', async () => {
    process.env.GROQ_API_KEY = 'gsk-real-key-1234567890';
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      new ServiceUnavailableException('The AI assistant is unreachable right now.'),
    );
  });

  it('rejects empty replies with 503', async () => {
    process.env.GROQ_API_KEY = 'gsk-real-key-1234567890';
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: '   ' } }] }), {
          status: 200,
        }),
      );

    await expect(service.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      new ServiceUnavailableException('The AI assistant returned an empty reply.'),
    );
  });
});
