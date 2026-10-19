import { z } from 'zod';

export const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(30, 'Username must be at most 30 characters')
  .regex(
    /^[a-zA-Z0-9_]+$/,
    'Username can only contain letters, numbers, and underscores',
  );

export const updateProfileSchema = z.object({
  firstName: z
    .string()
    .min(1, 'First name is required')
    .max(50, 'First name must be at most 50 characters')
    .trim()
    .optional(),
  lastName: z
    .string()
    .min(1, 'Last name is required')
    .max(50, 'Last name must be at most 50 characters')
    .trim()
    .optional(),
  username: usernameSchema.nullable().optional(),
  bio: z.string().max(500, 'Bio must be at most 500 characters').nullable().optional(),
  location: z
    .string()
    .max(100, 'Location must be at most 100 characters')
    .nullable()
    .optional(),
});

export const updatePreferencesSchema = z.object({
  preferences: z.record(
    z.string(),
    z.union([z.string().max(200), z.boolean(), z.number()]),
  ),
});

export const becomeOrganizerSchema = z.object({
  organizationName: z
    .string()
    .min(2, 'Organization name must be at least 2 characters')
    .max(100, 'Organization name must be at most 100 characters')
    .trim(),
  description: z.string().max(2000).optional(),
  website: z.string().url('Invalid website URL').max(500).optional(),
  phone: z.string().max(20).optional(),
});

export const updateOrganizerProfileSchema = z
  .object({
    organizationName: z.string().trim().min(2).max(100).optional(),
    description: z.string().max(2000).nullable().optional(),
    website: z
      .string()
      .url()
      .max(500)
      .refine(
        (value) => /^https?:\/\//i.test(value),
        'Use an HTTPS or HTTP website address',
      )
      .nullable()
      .optional(),
    phone: z.string().max(20).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide profile fields to update');

export const deleteAccountSchema = z.object({
  confirmation: z.literal('DELETE', {
    errorMap: () => ({ message: 'You must type DELETE to confirm account deletion' }),
  }),
});

export type Username = z.infer<typeof usernameSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
