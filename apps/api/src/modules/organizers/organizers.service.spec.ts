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
