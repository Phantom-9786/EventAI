import { Injectable, NotFoundException } from '../../common/exceptions';
import { PrismaService } from '../../prisma/prisma.service';

// ═══════════════════════════════════════════════════
// Public venue discovery: browse by city/name and
// view venue details with seat sections.
// ═══════════════════════════════════════════════════

@Injectable()
export class VenuesService {
  constructor(private readonly prisma: PrismaService) {}

  async search(input: { city?: string; query?: string; page: number; limit: number }) {
    const where = {
      events: { some: { status: 'PUBLISHED' as const } },
      ...(input.city && { city: { contains: input.city, mode: 'insensitive' as const } }),
      ...(input.query && {
        OR: [
          { name: { contains: input.query, mode: 'insensitive' as const } },
          { city: { contains: input.query, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [venues, total] = await this.prisma.$transaction([
      this.prisma.venue.findMany({
        where,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          city: true,
          state: true,
          address: true,
          zipCode: true,
          country: true,
          latitude: true,
          longitude: true,
          capacity: true,
          images: true,
          amenities: true,
          _count: {
            select: { events: { where: { status: 'PUBLISHED' } } },
          },
        },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.prisma.venue.count({ where }),
    ]);

    return {
      venues,
      total,
      page: input.page,
      limit: input.limit,
      pages: Math.ceil(total / input.limit),
    };
  }

  async getVenue(id: string) {
    const venue = await this.prisma.venue.findFirst({
      where: { id, events: { some: { status: 'PUBLISHED' } } },
      include: {
        organizer: { select: { id: true, organizationName: true, isVerified: true } },
        seatSections: {
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            rows: true,
            seatsPerRow: true,
            totalSeats: true,
          },
        },
        _count: { select: { events: { where: { status: 'PUBLISHED' } } } },
      },
    });
    if (!venue) {
      throw new NotFoundException('Venue not found');
    }
    return venue;
  }
}
