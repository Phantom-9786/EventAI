import { z } from 'zod';
import { paginationSchema } from './common';

const userRoleEnum = z.enum(['CUSTOMER', 'ORGANIZER', 'ADMIN']);
const eventStatusEnum = z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED', 'SOLDOUT']);

// ── Admin: user management ─────────────────────────
export const adminUserListSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  role: userRoleEnum.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type AdminUserListInput = z.infer<typeof adminUserListSchema>;

export const adminSetUserStatusSchema = z.object({
  isActive: z.boolean(),
});
export type AdminSetUserStatusInput = z.infer<typeof adminSetUserStatusSchema>;

// ── Admin: event moderation ────────────────────────
export const adminEventListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: eventStatusEnum.optional(),
});
export type AdminEventListInput = z.infer<typeof adminEventListSchema>;

export const adminModerateEventSchema = z.object({
  action: z.literal('CANCEL'),
  reason: z.string().trim().max(500).optional(),
});
export type AdminModerateEventInput = z.infer<typeof adminModerateEventSchema>;

// ── Admin: organizer management ────────────────────
export const adminOrganizerListSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  isVerified: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type AdminOrganizerListInput = z.infer<typeof adminOrganizerListSchema>;

export const adminSetOrganizerVerificationSchema = z.object({
  isVerified: z.boolean(),
});
export type AdminSetOrganizerVerificationInput = z.infer<
  typeof adminSetOrganizerVerificationSchema
>;
