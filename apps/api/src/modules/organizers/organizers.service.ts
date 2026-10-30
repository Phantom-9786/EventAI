import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '../../common/exceptions';
import type {
  CreateSeatSectionInput,
  CreateVenueInput,
  UpdateVenueInput,
} from '@eventai/validation';
import { PrismaService } from '../../prisma/prisma.service';
import type { CacheService } from '../../common/cache/cache.service';

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

  constructor(private readonly prisma: PrismaService, private readonly cache?: CacheService) {}

  private async invalidatePublicMetadata(): Promise<void> {
    await this.cache?.invalidatePrefix('events:browse:');
    await this.cache?.invalidatePrefix('event:detail:');
    await this.cache?.invalidatePrefix('events:similar:');
  }

  async updateOwnProfile(
    userId: string,
    input: {
      organizationName?: string;
      description?: string | null;
      website?: string | null;
      phone?: string | null;
    },
  ) {
    const profile = await this.prisma.organizer.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Organizer profile not found');
    const updated = await this.prisma.organizer.update({
      where: { id: profile.id },
      data: {
        ...(input.organizationName !== undefined && {
          organizationName: input.organizationName,
        }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.website !== undefined && { website: input.website }),
        ...(input.phone !== undefined && { phone: input.phone }),
      },
    });
    await this.invalidatePublicMetadata();
    return updated;
  }

  async becomeOrganizer(
    userId: string,
    input: {
      organizationName: string;
      description?: string;
      website?: string;
      phone?: string;
    },
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
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (user?.role !== 'ADMIN') {
        await tx.user.update({
          where: { id: userId },
          data: { role: 'ORGANIZER' },
        });
      }
      return created;
    });

    this.logger.log(`User ${userId} became an organizer (${organizer.id})`);
    return organizer;
  }

  async leaveOrganizer(userId: string): Promise<{ message: string }> {
    const organizer = await this.prisma.organizer.findUnique({
      where: { userId },
      select: {
        id: true,
        _count: { select: { events: true, venues: true } },
      },
    });
    if (!organizer) {
      throw new NotFoundException('Organizer profile not found');
    }
    if (organizer._count.events > 0 || organizer._count.venues > 0) {
      throw new ConflictException(
        'Organizer profiles with events or venues cannot be removed; deactivate your account after resolving active events instead',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const txOps: any[] = [this.prisma.organizer.delete({ where: { id: organizer.id } })];
    if (user?.role !== 'ADMIN') {
      txOps.push(
        this.prisma.user.update({ where: { id: userId }, data: { role: 'CUSTOMER' } }),
      );
    }

    await this.prisma.$transaction(txOps);
    return { message: 'Organizer profile removed' };
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

  private normalizeVenueString(val: string): string {
    return val
      .toLowerCase()
      .replace(/[,\-.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async createVenue(organizerId: string, input: CreateVenueInput) {
    const normName = this.normalizeVenueString(input.name);
    const normCity = this.normalizeVenueString(input.city);
    const normAddress = this.normalizeVenueString(input.address);

    const existingVenues = await this.prisma.venue.findMany({
      where: { organizerId },
    });

    const duplicate = existingVenues.find((v) => {
      const vName = this.normalizeVenueString(v.name);
      const vCity = this.normalizeVenueString(v.city);
      const vAddress = this.normalizeVenueString(v.address);
      return vName === normName && vCity === normCity && vAddress === normAddress;
    });

    if (duplicate) {
      return duplicate;
    }

    return this.prisma.venue.create({
      data: {
        organizerId,
        name: input.name.trim().replace(/\s+/g, ' '),
        description: input.description,
        address: input.address.trim().replace(/\s+/g, ' '),
        city: input.city.trim().replace(/\s+/g, ' '),
        state: input.state.trim().replace(/\s+/g, ' '),
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
    const updated = await this.prisma.venue.update({
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
    await this.invalidatePublicMetadata();
    return updated;
  }

  async deleteVenue(organizerId: string, venueId: string) {
    const id = await this.requireOwnedVenue(organizerId, venueId);
    const eventCount = await this.prisma.event.count({ where: { venueId: id } });
    if (eventCount > 0) {
      throw new ConflictException('Venue has events attached and cannot be deleted');
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

  /** Resolves an event owned by the organizer; throws if missing or foreign. */
  private async requireOwnedEvent(organizerId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizerId },
      select: { id: true, title: true },
    });
    if (!event) {
      throw new NotFoundException('Event not found among your events');
    }
    return event;
  }

  /**
   * Validates (checks in) a ticket by its code at the door. Only the
   * organizer of the ticket's event may validate it. Returns the ticket
   * state including the reason when validation is refused.
   */
  async validateTicket(organizerId: string, eventId: string, ticketCode: string) {
    await this.requireOwnedEvent(organizerId, eventId);

    const ticket = await this.prisma.ticket.findUnique({
      where: { ticketCode },
      include: {
        ticketType: { select: { id: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!ticket || ticket.eventId !== eventId) {
      throw new NotFoundException('Ticket not found for this event');
    }

    if (ticket.status === 'USED') {
      throw new ConflictException(
        `Ticket already used${ticket.validatedAt ? ` at ${ticket.validatedAt.toISOString()}` : ''}`,
      );
    }
    if (ticket.status !== 'VALID') {
      throw new ConflictException(
        `Ticket is ${ticket.status.toLowerCase()} and cannot be accepted`,
      );
    }

    const updated = await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'USED', validatedAt: new Date(), validatedBy: organizerId },
      select: {
        id: true,
        ticketCode: true,
        holderName: true,
        status: true,
        validatedAt: true,
        ticketType: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Ticket validated for event ${eventId}`);
    return { ticket: updated, holder: ticket.user };
  }

  /** Door summary: how many tickets per status for one of your events. */
  async eventTicketStats(organizerId: string, eventId: string) {
    await this.requireOwnedEvent(organizerId, eventId);
    const grouped = await this.prisma.ticket.groupBy({
      by: ['status'],
      where: { eventId },
      _count: { _all: true },
    });
    const stats = { VALID: 0, USED: 0, CANCELLED: 0, EXPIRED: 0 };
    for (const g of grouped) {
      stats[g.status] = g._count._all;
    }
    const total = Object.values(stats).reduce((a, b) => a + b, 0);
    return { ...stats, total, checkedIn: stats.USED };
  }

  /** Attendee list (bookings) for one of your events, newest first. */
  async eventAttendees(
    organizerId: string,
    eventId: string,
    page: number,
    limit: number,
  ) {
    await this.requireOwnedEvent(organizerId, eventId);
    const where = { eventId };
    const [bookings, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          items: {
            select: {
              quantity: true,
              unitPrice: true,
              ticketType: { select: { id: true, name: true } },
            },
          },
          tickets: {
            select: {
              id: true,
              ticketCode: true,
              status: true,
              holderName: true,
              ticketType: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);
    return { bookings, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /** Dashboard aggregates across all of the organizer's events. */
  async getDashboardStats(organizerId: string) {
    const eventGroups = await this.prisma.event.groupBy({
      by: ['status'],
      where: { organizerId },
      _count: { _all: true },
    });
    const events: Record<string, number> = {
      total: 0,
      DRAFT: 0,
      PUBLISHED: 0,
      CANCELLED: 0,
      COMPLETED: 0,
      SOLDOUT: 0,
    };
    for (const g of eventGroups) {
      events[g.status] = g._count._all;
      events.total += g._count._all;
    }

    const bookingGroups = await this.prisma.booking.groupBy({
      by: ['status'],
      where: { event: { organizerId }, status: { in: ['CONFIRMED', 'REFUNDED'] } },
      _count: { _all: true },
      _sum: { totalAmount: true },
    });
    let revenue = 0;
    let confirmedBookings = 0;
    let refundedBookings = 0;
    for (const g of bookingGroups) {
      if (g.status === 'CONFIRMED') {
        revenue += g._sum.totalAmount ?? 0;
        confirmedBookings = g._count._all;
      } else {
        refundedBookings = g._count._all;
      }
    }

    const ticketGroups = await this.prisma.ticket.groupBy({
      by: ['status'],
      where: { event: { organizerId } },
      _count: { _all: true },
    });
    let ticketsIssued = 0;
    let checkedIn = 0;
    for (const g of ticketGroups) {
      ticketsIssued += g._count._all;
      if (g.status === 'USED') checkedIn = g._count._all;
    }

    return {
      events,
      revenue,
      confirmedBookings,
      refundedBookings,
      ticketsIssued,
      checkedIn,
    };
  }
}
