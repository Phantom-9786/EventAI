import { z } from 'zod';

const eventImageUrlSchema = z
  .string()
  .max(2048)
  .refine(
    (value) => /^https?:\/\//i.test(value) || /^\/uploads\/[\w.-]+$/i.test(value),
    'Image URL must use HTTP, HTTPS, or a valid /uploads path',
  );

export const createEventSchema = z
  .object({
    title: z.string().min(3, 'Title must be at least 3 characters').max(200).trim(),
    description: z
      .string()
      .min(20, 'Description must be at least 20 characters')
      .max(10000)
      .trim(),
    shortDescription: z.string().max(300).optional(),
    categoryId: z.string().uuid('Invalid category'),
    venueId: z.string().uuid('Invalid venue'),
    startDate: z.string().datetime('Invalid start date'),
    endDate: z.string().datetime('Invalid end date'),
    tags: z.array(z.string().max(50)).max(10).optional(),
    coverImage: eventImageUrlSchema.optional(),
    images: z.array(eventImageUrlSchema).max(10).optional(),
    policies: z.string().max(5000).optional(),
    cancellationPolicy: z.string().max(2000).optional(),
  })
  .refine((data) => new Date(data.endDate) > new Date(data.startDate), {
    message: 'End date must be after start date',
    path: ['endDate'],
  });

export const updateEventSchema = z.object({
  title: z.string().min(3).max(200).trim().optional(),
  description: z.string().min(20).max(10000).trim().optional(),
  shortDescription: z.string().max(300).optional(),
  categoryId: z.string().uuid().optional(),
  venueId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  coverImage: eventImageUrlSchema.nullable().optional(),
  images: z.array(eventImageUrlSchema).max(10).optional(),
  policies: z.string().max(5000).optional(),
  cancellationPolicy: z.string().max(2000).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']).optional(),
});

export const aiEventFilterSchema = z.object({
  excludedKeywords: z.array(z.string().trim().min(1).max(50)).max(5).optional(),
  partySize: z.number().int().min(1).max(100).optional(),
  query: z.string().trim().max(200).optional(),
  category: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  priceMin: z.number().int().min(0).optional(),
  priceMax: z.number().int().min(0).optional(),
}).strict();

export const eventSearchSchema = z.object({
  aiFilters: z.string().max(2000).refine((value) => {
    try { return aiEventFilterSchema.safeParse(JSON.parse(value)).success; } catch { return false; }
  }, 'Invalid AI event filter').optional(),
  venueId: z.string().uuid().optional(),
  query: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  category: z.string().max(100).optional(), // category slug
  city: z.string().max(100).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  priceMin: z.coerce.number().min(0).optional(),
  priceMax: z.coerce.number().min(0).optional(),
  status: z
    .enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED', 'SOLDOUT', 'PAUSED'])
    .optional(),
  sortBy: z.enum(['date', 'price', 'popularity', 'createdAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  isFeatured: z
    .preprocess((v) => v === true || v === 'true' || v === '1', z.boolean())
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const createCategorySchema = z.object({
  name: z.string().min(2).max(50).trim(),
  description: z.string().max(200).optional(),
  icon: z.string().max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color')
    .optional(),
});

export const updateCategorySchema = createCategorySchema
  .partial()
  .extend({ isActive: z.boolean().optional() });

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type EventSearchInput = z.infer<typeof eventSearchSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
