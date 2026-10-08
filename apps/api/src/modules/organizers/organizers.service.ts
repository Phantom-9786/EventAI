import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { CreateVenueInput } from '@eventai/validation';
import { PrismaService } from '../../prisma/prisma.service';

// ═══════════════════════════════════════════════════
// Organizers: onboarding (user → organizer profile +
// ORGANIZER role), own venues, and own event listing.
// ═══════════════════════════════════════════════════

@Injectable()
export class OrganizersService {
  private readonly logger = new Logger(OrganizersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async becomeOrganizer(
    userId: string,
    input: { organizationName: string; description?: string; website?: string; phone?: string },
  ) {
    const existing = await this.prisma.organizer.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('You already have an organizer profile');
    }

    const organizer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organizer.create({
        data: {
          userId,
          organizationName: input.organizationName,
          description: input.description,
          website: input.website,
          phone: input.phone,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { role: 'ORGANIZER' },
      });
      return created;
    });

    this.logger.log(`User ${userId} became an organizer (${organizer.id})`);
    return organizer;
  }

  async getOwnOrganizerProfile(userId: string) {
    const organizer = await this.prisma.organizer.findUnique({
      where: { userId },
      select: {
        id: true,
        organizationName: true,
        description: true,
        website: true,
        phone: true,
        isVerified: true,
        createdAt: true,
        _count: { select: { events: true, venues: true } },
      },
    });
    if (!organizer) {
      throw new NotFoundException('You do not have an organizer profile yet');
    }
    return organizer;
  }

  /** Resolves the organizer profile for a user; throws if not an organizer. */
  async requireOrganizerId(userId: string): Promise<string> {
    const organizer = await this.prisma.organizer.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!organizer) {
      throw new ForbiddenException('Organizer profile required');
    }
    return organizer.id;
  }

  async createVenue(organizerId: string, input: CreateVenueInput) {
    return this.prisma.venue.create({
      data: {
        organizerId,
        name: input.name,
        description: input.description,
        address: input.address,
        city: input.city,
        state: input.state,
        zipCode: input.zipCode,
        country: input.country,
        latitude: input.latitude,
        longitude: input.longitude,
        capacity: input.capacity,
        amenities: input.amenities ?? [],
      },
    });
  }

  async listOwnVenues(organizerId: string) {
    return this.prisma.venue.findMany({
      where: { organizerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Ensures the venue exists and belongs to the organizer. */
  async requireOwnedVenue(organizerId: string, venueId: string) {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, organizerId },
      select: { id: true },
    });
    if (!venue) {
      throw new NotFoundException('Venue not found among your venues');
    }
  }

  async listOwnEvents(organizerId: string, page: number, limit: number) {
    const [events, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where: { organizerId },
        include: {
          category: { select: { id: true, name: true, slug: true } },
          venue: { select: { id: true, name: true, city: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.event.count({ where: { organizerId } }),
    ]);
    return { events, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
