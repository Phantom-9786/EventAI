import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateTicketTypeInput,
  UpdateTicketTypeInput,
} from '@eventai/validation';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../../prisma/prisma.service';

// ═══════════════════════════════════════════════════
// Ticket types: organizer-managed inventory per event.
// Prices are integers in paise (INR). availableQuantity
// tracks unsold stock; it is derived on totalQuantity
// changes so booked tickets are never oversold by edits.
// ═══════════════════════════════════════════════════

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  async create(organizerId: string, idOrSlug: string, input: CreateTicketTypeInput) {
    const event = await this.eventsService.requireOwnedEvent(organizerId, idOrSlug);
    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      throw new ConflictException(
        `Cannot add tickets to a ${event.status.toLowerCase()} event`,
      );
    }

    await this.assertSaleWindow(input.saleStartDate, input.saleEndDate, event.startDate);
    if (input.sectionId) {
      await this.assertSectionInVenue(input.sectionId, event.venueId);
    }

    return this.prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: input.name,
        description: input.description,
        price: input.price,
        totalQuantity: input.totalQuantity,
        availableQuantity: input.totalQuantity,
        maxPerBooking: input.maxPerBooking,
        saleStartDate: input.saleStartDate ? new Date(input.saleStartDate) : null,
        saleEndDate: input.saleEndDate ? new Date(input.saleEndDate) : null,
        sectionId: input.sectionId,
      },
      include: { section: { select: { id: true, name: true } } },
    });
  }

  async listForOrganizer(organizerId: string, idOrSlug: string) {
    const event = await this.eventsService.requireOwnedEvent(organizerId, idOrSlug);
    return this.prisma.ticketType.findMany({
      where: { eventId: event.id },
      orderBy: { price: 'asc' },
      include: { section: { select: { id: true, name: true } } },
    });
  }

  async update(
    organizerId: string,
    ticketTypeId: string,
    input: UpdateTicketTypeInput,
  ) {
    const existing = await this.requireOwnedTicketType(organizerId, ticketTypeId);

    if (input.saleStartDate !== undefined || input.saleEndDate !== undefined) {
      await this.assertSaleWindow(
        input.saleStartDate ?? existing.saleStartDate?.toISOString(),
        input.saleEndDate ?? existing.saleEndDate?.toISOString(),
        existing.event.startDate,
      );
    }
    if (input.sectionId !== undefined && input.sectionId !== null) {
      await this.assertSectionInVenue(input.sectionId, existing.event.venueId);
    }

    // Quantity changes keep sold stock: newAvailable = newTotal - sold
    let data: Record<string, unknown> = {};
    if (input.totalQuantity !== undefined && input.totalQuantity !== existing.totalQuantity) {
      const sold = existing.totalQuantity - existing.availableQuantity;
      const newAvailable = input.totalQuantity - sold;
      if (newAvailable < 0) {
        throw new ConflictException(
          `Cannot reduce quantity below the ${sold} already booked`,
        );
      }
      data = { ...data, totalQuantity: input.totalQuantity, availableQuantity: newAvailable };
    }

    try {
      return await this.prisma.ticketType.update({
        where: { id: ticketTypeId },
        data: {
          ...data,
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.price !== undefined && { price: input.price }),
          ...(input.maxPerBooking !== undefined && { maxPerBooking: input.maxPerBooking }),
          ...(input.saleStartDate !== undefined && {
            saleStartDate: input.saleStartDate ? new Date(input.saleStartDate) : null,
          }),
          ...(input.saleEndDate !== undefined && {
            saleEndDate: input.saleEndDate ? new Date(input.saleEndDate) : null,
          }),
          ...(input.sectionId !== undefined && { sectionId: input.sectionId }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
        },
        include: { section: { select: { id: true, name: true } } },
      });
    } catch (error) {
      // P2025: ticket type deleted concurrently
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'P2025'
      ) {
        throw new NotFoundException('Ticket type not found');
      }
      throw error;
    }
  }

  async remove(organizerId: string, ticketTypeId: string) {
    const existing = await this.requireOwnedTicketType(organizerId, ticketTypeId);

    const sold = existing.totalQuantity - existing.availableQuantity;
    if (sold > 0) {
      throw new ConflictException(
        'Ticket type has bookings — deactivate it instead of deleting',
      );
    }

    await this.prisma.ticketType.delete({ where: { id: ticketTypeId } });
    return { message: 'Ticket type deleted' };
  }

  private async requireOwnedTicketType(
    organizerId: string,
    ticketTypeId: string,
  ) {
    const ticketType = await this.prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
      select: {
        id: true,
        totalQuantity: true,
        availableQuantity: true,
        saleStartDate: true,
        saleEndDate: true,
        eventId: true,
        event: {
          select: { organizerId: true, status: true, startDate: true, venueId: true },
        },
      },
    });
    if (!ticketType || ticketType.event.organizerId !== organizerId) {
      throw new NotFoundException('Ticket type not found');
    }
    return ticketType;
  }

  private async assertSectionInVenue(sectionId: string, venueId: string) {
    const section = await this.prisma.seatSection.findFirst({
      where: { id: sectionId, venueId },
      select: { id: true },
    });
    if (!section) {
      throw new ForbiddenException('Seat section does not belong to the event venue');
    }
  }

  private async assertSaleWindow(
    saleStartDate: string | undefined | null,
    saleEndDate: string | undefined | null,
    eventStartDate: Date,
  ) {
    if (saleStartDate && saleEndDate) {
      if (new Date(saleEndDate) <= new Date(saleStartDate)) {
        throw new ConflictException('Sale end must be after sale start');
      }
    }
    if (saleEndDate && new Date(saleEndDate) > eventStartDate) {
      throw new ConflictException('Sale end must not be after the event start');
    }
  }
}
