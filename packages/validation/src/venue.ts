import { z } from 'zod';

export const createVenueSchema = z.object({
  name: z.string().min(2).max(200).trim(),
  description: z.string().max(2000).optional(),
  address: z.string().min(5).max(500).trim(),
  city: z.string().min(2).max(100).trim(),
  state: z.string().min(2).max(100).trim(),
  zipCode: z.string().max(20).optional(),
  country: z.string().min(2).max(100).trim().default('India'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  capacity: z.number().int().min(1).max(100000),
  amenities: z.array(z.string().max(100)).max(20).optional(),
});

export const updateVenueSchema = createVenueSchema.partial();

export const createSeatSectionSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  rows: z.number().int().min(1).max(100),
  seatsPerRow: z.number().int().min(1).max(100),
});

export type CreateVenueInput = z.infer<typeof createVenueSchema>;
export type UpdateVenueInput = z.infer<typeof updateVenueSchema>;
export type CreateSeatSectionInput = z.infer<typeof createSeatSectionSchema>;

export const venueSearchSchema = z.object({
  query: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type VenueSearchInput = z.infer<typeof venueSearchSchema>;
