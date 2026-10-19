import { AdminService } from './admin.service';
import { ConflictException } from '../../common/exceptions';

function setup(status = 'PUBLISHED') {
  const notification = { create: jest.fn().mockResolvedValue({ id: 'notice' }) };
  const event = {
    findUnique: jest
      .fn()
      .mockResolvedValue({
        id: 'event',
        title: 'Music night',
        status,
        endDate: new Date('2099-01-01'),
        organizer: { userId: 'organizer-user' },
      }),
    update: jest
      .fn()
      .mockImplementation(async ({ data }) => ({
        id: 'event',
        title: 'Music night',
        status: data.status,
      })),
  };
  const tx = {
    event,
    notification,
    auditLog: { create: jest.fn() },
    payment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    booking: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ticket: { updateMany: jest.fn() },
  };
  const prisma = { ...tx, $transaction: jest.fn(async (fn) => fn(tx)) };
  const cache = { invalidateEventCache: jest.fn() };
  return { service: new AdminService(prisma as never, cache as never), tx, cache };
}

describe('Event pause and organizer notifications', () => {
  it.each([
    ['PUBLISHED', 'PAUSE', 'PAUSED'],
    ['PAUSED', 'RESUME', 'PUBLISHED'],
  ] as const)(
    '%s → %s stores the state and organizer notice together',
    async (status, action, next) => {
      const { service, tx, cache } = setup(status);
      await service.moderateEvent('admin', 'event', { action, reason: 'Review' });
      expect(tx.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'event', status },
          data: { status: next },
        }),
      );
      expect(tx.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'organizer-user',
          type: 'EVENT_UPDATED',
          message: expect.stringContaining('Review'),
        }),
      });
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
      expect(tx.ticket.updateMany).not.toHaveBeenCalled();
      expect(tx.payment.updateMany).not.toHaveBeenCalled();
      expect(cache.invalidateEventCache).toHaveBeenCalled();
    },
  );
  it('rejects resuming a cancelled event', async () => {
    const { service, tx } = setup('CANCELLED');
    await expect(
      service.moderateEvent('admin', 'event', { action: 'RESUME' }),
    ).rejects.toThrow(ConflictException);
    expect(tx.event.update).not.toHaveBeenCalled();
  });
  it('notifies the organizer when a paused event is cancelled', async () => {
    const { service, tx } = setup('PAUSED');
    await service.moderateEvent('admin', 'event', {
      action: 'CANCEL',
      reason: 'Weather',
    });
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'organizer-user',
        type: 'EVENT_CANCELLED',
        message: expect.stringContaining('Weather'),
      }),
    });
    expect(tx.ticket.updateMany).toHaveBeenCalled();
  });
  it('does not invalidate cache or report success if the transaction fails', async () => {
    const { service, tx, cache } = setup();
    tx.notification.create.mockRejectedValue(new Error('storage failed'));
    await expect(
      service.moderateEvent('admin', 'event', { action: 'PAUSE' }),
    ).rejects.toThrow('storage failed');
    expect(cache.invalidateEventCache).not.toHaveBeenCalled();
  });
});
