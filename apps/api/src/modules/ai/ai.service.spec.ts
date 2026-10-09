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
    delete process.env.GROK_API_KEY;
  });

  afterEach(() => {
    delete process.env.GROK_API_KEY;
    jest.restoreAllMocks();
  });

  it('treats a missing or placeholder key as unconfigured', () => {
    expect(service.isConfigured()).toBe(false);
    process.env.GROK_API_KEY = 'xai-xxxxxxxxxxxxxxxxxxxxxxxx';
    expect(service.isConfigured()).toBe(false);
    process.env.GROK_API_KEY = 'xai-real-key-1234567890';
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
    process.env.GROK_API_KEY = 'xai-real-key-1234567890';
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
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
    expect(body.messages[0].content).toContain('Summer Gig');
  });
});
