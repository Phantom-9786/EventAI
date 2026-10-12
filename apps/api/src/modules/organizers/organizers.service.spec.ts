import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { excelColumnLabel, OrganizersService } from './organizers.service';

describe('OrganizersService venue operations', () => {
  let service: OrganizersService;
  let prisma: {
    venue: { findFirst: jest.Mock; update: jest.Mock; delete: jest.Mock };
    event: { count: jest.Mock };
    seatSection: { create: jest.Mock; findMany: jest.Mock };
    seat: { createMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      venue: { findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
      event: { count: jest.fn() },
      seatSection: { create: jest.fn(), findMany: jest.fn() },
      seat: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [OrganizersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(OrganizersService);
    // Silence logger noise
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
  });

  describe('excelColumnLabel', () => {
    it('produces spreadsheet-style row letters', () => {
      expect(excelColumnLabel(0)).toBe('A');
      expect(excelColumnLabel(25)).toBe('Z');
      expect(excelColumnLabel(26)).toBe('AA');
      expect(excelColumnLabel(27)).toBe('AB');
      expect(excelColumnLabel(51)).toBe('AZ');
      expect(excelColumnLabel(52)).toBe('BA');
    });
  });

  describe('updateVenue', () => {
    it('updates only provided fields on an owned venue', async () => {
      prisma.venue.findFirst.mockResolvedValue({ id: 'venue-1' });
      prisma.venue.update.mockImplementation(async ({ data }) => data);

      const result = await service.updateVenue('org-1', 'venue-1', { city: 'Mumbai' });

      expect(result).toEqual({ city: 'Mumbai' });
    });

    it('throws NotFound for a venue the organizer does not own', async () => {
      prisma.venue.findFirst.mockResolvedValue(null);
      await expect(
        service.updateVenue('org-1', 'venue-x', { city: 'Mumbai' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteVenue', () => {
    it('deletes a venue with no events', async () => {
      prisma.venue.findFirst.mockResolvedValue({ id: 'venue-1' });
      prisma.event.count.mockResolvedValue(0);
      const result = await service.deleteVenue('org-1', 'venue-1');
      expect(result.message).toContain('deleted');
      expect(prisma.venue.delete).toHaveBeenCalledWith({ where: { id: 'venue-1' } });
    });

    it('refuses to delete a venue that has events', async () => {
      prisma.venue.findFirst.mockResolvedValue({ id: 'venue-1' });
      prisma.event.count.mockResolvedValue(3);
      await expect(service.deleteVenue('org-1', 'venue-1')).rejects.toThrow(ConflictException);
      expect(prisma.venue.delete).not.toHaveBeenCalled();
    });
  });

  describe('createSeatSection', () => {
    it('creates the section and generates rows*seatsPerRow seats', async () => {
      prisma.venue.findFirst.mockResolvedValue({ id: 'venue-1' });
      prisma.seatSection.create.mockResolvedValue({
        id: 'section-1',
        totalSeats: 12,
      });

      const section = await service.createSeatSection('org-1', 'venue-1', {
        name: 'Balcony',
        rows: 3,
        seatsPerRow: 4,
      });

      expect(section.totalSeats).toBe(12);
      expect(prisma.seat.createMany).toHaveBeenCalledTimes(1);
      const inserted = prisma.seat.createMany.mock.calls[0][0].data;
      expect(inserted).toHaveLength(12);
      expect(inserted[0]).toMatchObject({ row: 'A', number: 1, label: 'A1' });
      expect(inserted[11]).toMatchObject({ row: 'C', number: 4, label: 'C4' });
    });

    it('chunks inserts above 1000 seats', async () => {
      prisma.venue.findFirst.mockResolvedValue({ id: 'venue-1' });
      prisma.seatSection.create.mockResolvedValue({ id: 'section-1', totalSeats: 2500 });

      await service.createSeatSection('org-1', 'venue-1', {
        name: 'Floor',
        rows: 25,
        seatsPerRow: 100,
      });

      expect(prisma.seat.createMany).toHaveBeenCalledTimes(3); // 1000 + 1000 + 500
    });
  });
});

describe('OrganizersService exit', () => {
  let service: OrganizersService;
  let prisma: {
    organizer: { findUnique: jest.Mock; delete: jest.Mock };
    user: { update: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      organizer: { findUnique: jest.fn(), delete: jest.fn() },
      user: { update: jest.fn() },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [OrganizersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(OrganizersService);
  });

  it('removes an empty profile and returns the user to customer role', async () => {
    prisma.organizer.findUnique.mockResolvedValue({
      id: 'org-1',
      _count: { events: 0, venues: 0 },
    });
    prisma.organizer.delete.mockResolvedValue({});
    prisma.user.update.mockResolvedValue({});

    await expect(service.leaveOrganizer('user-1')).resolves.toEqual({
      message: 'Organizer profile removed',
    });
    expect(prisma.organizer.delete).toHaveBeenCalledWith({ where: { id: 'org-1' } });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { role: 'CUSTOMER' },
    });
  });

  it('preserves profiles that own events or venues', async () => {
    prisma.organizer.findUnique.mockResolvedValue({
      id: 'org-1',
      _count: { events: 1, venues: 0 },
    });

    await expect(service.leaveOrganizer('user-1')).rejects.toThrow(ConflictException);
    expect(prisma.organizer.delete).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('returns not found when no profile exists', async () => {
    prisma.organizer.findUnique.mockResolvedValue(null);
    await expect(service.leaveOrganizer('user-1')).rejects.toThrow(NotFoundException);
  });
});

describe('OrganizersService ticket validation', () => {
  let service: OrganizersService;
  let prisma: {
    event: { findFirst: jest.Mock };
    ticket: {
      findUnique: jest.Mock;
      update: jest.Mock;
      groupBy: jest.Mock;
    };
    booking: { findMany: jest.Mock; count: jest.Mock };
  };

  const ownedEvent = { id: 'event-1', title: 'Gig', organizerId: 'org-1' };
  const validTicket = {
    id: 'ticket-1',
    ticketCode: 'TKT-ABC123',
    eventId: 'event-1',
    status: 'VALID',
    validatedAt: null,
    holderName: 'Ada Lovelace',
    ticketType: { id: 'tt-1', name: 'General' },
    user: { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'a@b.c' },
  };

  beforeEach(async () => {
    prisma = {
      event: { findFirst: jest.fn().mockResolvedValue(ownedEvent) },
      ticket: { findUnique: jest.fn(), update: jest.fn(), groupBy: jest.fn() },
      booking: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [OrganizersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(OrganizersService);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
  });

  it('checks in a VALID ticket and stamps the validator', async () => {
    prisma.ticket.findUnique.mockResolvedValue(validTicket);
    prisma.ticket.update.mockImplementation(async ({ data }) => ({
      ...validTicket,
      ...data,
      status: 'USED',
    }));

    const result = await service.validateTicket('org-1', 'event-1', 'TKT-ABC123');

    expect(result.ticket.status).toBe('USED');
    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1' },
        data: expect.objectContaining({ status: 'USED', validatedBy: 'org-1' }),
      }),
    );
    expect(result.holder).toMatchObject({ firstName: 'Ada' });
  });

  it('rejects an already-used ticket', async () => {
    prisma.ticket.findUnique.mockResolvedValue({
      ...validTicket,
      status: 'USED',
      validatedAt: new Date('2026-01-01T10:00:00Z'),
    });

    await expect(
      service.validateTicket('org-1', 'event-1', 'TKT-ABC123'),
    ).rejects.toThrow(/already used/i);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('rejects a ticket belonging to a different event', async () => {
    prisma.ticket.findUnique.mockResolvedValue({ ...validTicket, eventId: 'event-OTHER' });

    await expect(
      service.validateTicket('org-1', 'event-1', 'TKT-ABC123'),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a foreign organizer', async () => {
    prisma.event.findFirst.mockResolvedValue(null);

    await expect(
      service.validateTicket('org-IMPOSTOR', 'event-1', 'TKT-ABC123'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.ticket.findUnique).not.toHaveBeenCalled();
  });

  it('summarises ticket counts per status', async () => {
    prisma.ticket.groupBy.mockResolvedValue([
      { status: 'VALID', _count: { _all: 40 } },
      { status: 'USED', _count: { _all: 10 } },
    ]);

    const stats = await service.eventTicketStats('org-1', 'event-1');

    expect(stats).toMatchObject({ VALID: 40, USED: 10, total: 50, checkedIn: 10 });
  });

  it('lists attendees for an owned event with pagination', async () => {
    prisma.booking.findMany.mockResolvedValue([
      {
        id: 'booking-1',
        status: 'CONFIRMED',
        totalAmount: 99800,
        createdAt: new Date(),
        user: { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'a@b.c' },
        items: [{ quantity: 2, unitPrice: 49900, ticketType: { id: 'tt-1', name: 'General' } }],
        tickets: [{ id: 'ticket-1', ticketCode: 'TKT-ABC123', status: 'USED', holderName: 'Ada', ticketType: { id: 'tt-1', name: 'General' } }],
      },
    ]);
    prisma.booking.count.mockResolvedValue(1);

    const result = await service.eventAttendees('org-1', 'event-1', 1, 20);

    expect(result.total).toBe(1);
    expect(result.pages).toBe(1);
    expect(result.bookings[0].items[0].ticketType.name).toBe('General');
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: 'event-1' },
        skip: 0,
        take: 20,
      }),
    );
  });

  it('refuses the attendee list for a foreign event', async () => {
    prisma.event.findFirst.mockResolvedValue(null);

    await expect(service.eventAttendees('org-1', 'event-OTHER', 1, 20)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });
});
