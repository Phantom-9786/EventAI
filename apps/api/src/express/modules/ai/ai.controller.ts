import type { Request, Response, NextFunction } from 'express';
import { AiService } from '../../../modules/ai/ai.service';

export class ExpressAiController {
  constructor(private readonly aiService: AiService) {}

  suggestions = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      res.json(await this.aiService.suggestions());
    } catch (error) {
      next(error);
    }
  };

  chat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isStreamRequested =
        req.headers.accept === 'text/event-stream' || req.query.stream === 'true';

      if (isStreamRequested) {
        // SSE streaming mode
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.flushHeaders?.();

        let clientDisconnected = false;
        req.on('close', () => {
          clientDisconnected = true;
        });

        try {
          const result = await this.aiService.chat(req.body.messages, req.body.eventId);
          if (!clientDisconnected) {
            res.write(
              `data: ${JSON.stringify({
                configured: this.aiService.isConfigured(),
                reply: result.reply,
                events: result.events,
                moreEventsUrl: result.moreEventsUrl,
                total: result.total,
              })}\n\n`,
            );
            res.write('data: [DONE]\n\n');
            res.end();
          }
        } catch (streamError: any) {
          if (!clientDisconnected) {
            const safeMessage =
              streamError?.response?.message ||
              streamError?.message ||
              'The AI assistant is temporarily unavailable.';
            res.write(`data: ${JSON.stringify({ error: safeMessage })}\n\n`);
            res.end();
          }
        }
        return;
      }

      // Standard JSON response mode
      const result = await this.aiService.chat(req.body.messages, req.body.eventId);
      res.status(200).json({
        configured: this.aiService.isConfigured(),
        reply: result.reply,
        events: result.events,
                moreEventsUrl: result.moreEventsUrl,
                total: result.total,
      });
    } catch (err) {
      next(err);
    }
  };
}
