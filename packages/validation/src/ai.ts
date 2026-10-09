import { z } from 'zod';

export const aiChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(12),
});

export type AiChatInput = z.infer<typeof aiChatSchema>;
