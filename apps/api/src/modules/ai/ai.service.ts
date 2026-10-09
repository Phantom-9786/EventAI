import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { AiChatInput } from '@eventai/validation';
import { PrismaService } from '../../prisma/prisma.service';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface XaiCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * EventAI assistant backed by xAI (Grok) via the OpenAI-compatible
 * chat-completions API. The live catalog of upcoming events is injected
 * into the system prompt so recommendations are grounded in real data.
 * Degrades gracefully: without GROK_API_KEY the endpoint returns 503.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly prisma: PrismaService) {}

  isConfigured(): boolean {
    const key = process.env.GROK_API_KEY;
    return !!key && !key.startsWith('xai-xxxx');
  }

  private async loadCatalog() {
    const events = await this.prisma.event.findMany({
      where: { status: 'PUBLISHED', startDate: { gte: new Date() } },
      orderBy: { startDate: 'asc' },
      take: 12,
      select: {
        title: true,
        slug: true,
        startDate: true,
        category: { select: { name: true } },
        venue: { select: { city: true } },
        ticketTypes: {
          where: { isActive: true },
          select: { price: true },
          orderBy: { price: 'asc' },
          take: 1,
        },
      },
    });
    return events.map((e) => ({
      title: e.title,
      slug: e.slug,
      startDate: e.startDate,
      city: e.venue.city,
      category: e.category.name,
      minPrice: e.ticketTypes[0]?.price ?? null,
    }));
  }

  async chat(messages: AiChatInput['messages']): Promise<string> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'The AI assistant is not configured on this server yet (missing GROK_API_KEY).',
      );
    }

    const catalog = await this.loadCatalog();
    const catalogText =
      catalog.length > 0
        ? `\n\nUpcoming events you may recommend (do not invent others):\n${catalog
            .map(
              (e) =>
                `- ${e.title} | ${e.category} | ${new Date(e.startDate).toLocaleString('en-IN')} | ${e.city} | ${
                  e.minPrice !== null ? `from ₹${(e.minPrice / 100).toLocaleString('en-IN')}` : 'price TBD'
                } | /events/${e.slug}`,
            )
            .join('\n')}`
        : '\n\nThere are currently no upcoming events in the catalog.';

    const payload: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are EventAI, a friendly assistant for an event ticketing platform in India. ' +
          'Help users discover events, plan visits, and answer general event questions. ' +
          'Recommend only events from the catalog when asked for suggestions, and mention the event link path. ' +
          'Prices are in INR. Keep answers concise (under 150 words). If you do not know something, say so.' +
          catalogText,
      },
      ...messages,
    ];

    let response: Response;
    try {
      response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GROK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.GROK_MODEL ?? 'grok-3-mini',
          messages: payload,
          temperature: 0.6,
          max_tokens: 600,
        }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      this.logger.warn(
        `xAI request failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw new ServiceUnavailableException('The AI assistant is unreachable right now.');
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      this.logger.warn(`xAI error ${response.status}: ${body.error?.message ?? 'unknown'}`);
      throw new ServiceUnavailableException(
        'The AI assistant could not process this request. Please try again later.',
      );
    }

    const body = (await response.json()) as XaiCompletionResponse;
    const reply = body.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      throw new ServiceUnavailableException('The AI assistant returned an empty reply.');
    }
    return reply;
  }
}
