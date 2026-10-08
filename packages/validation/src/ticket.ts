import { z } from 'zod';

export const createTicketTypeSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(500).optional(),
  price: z.number().int().min(0, 'Price must be non-negative'), // in paise
  totalQuantity: z.number().int().min(1),
  maxPerBooking: z.number().int().min(1).max(10).default(5),
  saleStartDate: z.string().datetime().optional(),
  saleEndDate: z.string().datetime().optional(),
  sectionId: z.string().uuid().optional(),
});

export const updateTicketTypeSchema = createTicketTypeSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type CreateTicketTypeInput = z.infer<typeof createTicketTypeSchema>;
export type UpdateTicketTypeInput = z.infer<typeof updateTicketTypeSchema>;
