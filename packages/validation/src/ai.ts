import { z } from 'zod';
import { aiEventFilterSchema } from './event';

export const aiChatSchema = z.object({
  eventId: z.string().uuid().optional(),
  discoveryContext: aiEventFilterSchema.optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(2000),
        eventSlugs: z.array(z.string().min(1).max(250)).max(6).optional(),
      }),
    )
    .min(1)
    .max(12)
    .refine(messages => messages[messages.length - 1]?.role === 'user', 'The last message must be from the user.'),
});

export type AiChatInput = z.infer<typeof aiChatSchema>;
