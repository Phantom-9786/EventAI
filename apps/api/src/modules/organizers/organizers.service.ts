import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateSeatSectionInput,
  CreateVenueInput,
  UpdateVenueInput,
} from '@eventai/validation';
import { PrismaService } from '../../prisma/prisma.service';

/** 0-based index to spreadsheet-style letters: 0→A, 25→Z, 26→AA, 27→AB... */
export function excelColumnLabel(index: number): string {
  let label = '';
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

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

  /** Ensures the venue exists and belongs to the organizer; returns its id. */
  async requireOwnedVenue(organizerId: string, venueId: string): Promise<string> {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, organizerId },
      select: { id: true },
    });
    if (!venue) {
      throw new NotFoundException('Venue not found among your venues');
    }
    return venue.id;
  }

  async updateVenue(organizerId: string, venueId: string, input: UpdateVenueInput) {
    const id = await this.requireOwnedVenue(organizerId, venueId);
    return this.prisma.venue.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.city !== undefined && { city: input.city }),
        ...(input.state !== undefined && { state: input.state }),
        ...(input.zipCode !== undefined && { zipCode: input.zipCode }),
        ...(input.country !== undefined && { country: input.country }),
        ...(input.latitude !== undefined && { latitude: input.latitude }),
        ...(input.longitude !== undefined && { longitude: input.longitude }),
        ...(input.capacity !== undefined && { capacity: input.capacity }),
        ...(input.amenities !== undefined && { amenities: input.amenities }),
      },
    });
  }

  async deleteVenue(organizerId: string, venueId: string) {
    const id = await this.requireOwnedVenue(organizerId, venueId);
    const eventCount = await this.prisma.event.count({ where: { venueId: id } });
    if (eventCount > 0) {
      throw new ConflictException(
        'Venue has events attached and cannot be deleted',
      );
    }
    // Seat sections cascade with the venue
    await this.prisma.venue.delete({ where: { id } });
    return { message: 'Venue deleted' };
  }

  async createSeatSection(
    organizerId: string,
    venueId: string,
    input: CreateSeatSectionInput,
  ) {
    const id = await this.requireOwnedVenue(organizerId, venueId);

    const totalSeats = input.rows * input.seatsPerRow;
    const section = await this.prisma.seatSection.create({
      data: {
        venueId: id,
        name: input.name,
        rows: input.rows,
        seatsPerRow: input.seatsPerRow,
        totalSeats,
      },
    });

    await this.generateSeats(section.id, input.rows, input.seatsPerRow);
    return section;
  }

  async listSeatSections(organizerId: string, venueId: string) {
    const id = await this.requireOwnedVenue(organizerId, venueId);
    return this.prisma.seatSection.findMany({
      where: { venueId: id },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { seats: true, ticketTypes: true } },
      },
    });
  }

  /** Bulk-inserts seats with Excel-style row letters (A, B, ..., Z, AA, AB...). */
  private async generateSeats(sectionId: string, rows: number, seatsPerRow: number) {
    const seats: {
      sectionId: string;
      row: string;
      number: number;
      label: string;
    }[] = [];
    for (let r = 0; r < rows; r++) {
      const rowLabel = excelColumnLabel(r);
      for (let n = 1; n <= seatsPerRow; n++) {
        seats.push({ sectionId, row: rowLabel, number: n, label: `${rowLabel}${n}` });
      }
    }
    const CHUNK = 1000;
    for (let i = 0; i < seats.length; i += CHUNK) {
      await this.prisma.seat.createMany({ data: seats.slice(i, i + CHUNK) });
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
