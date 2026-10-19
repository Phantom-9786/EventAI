import { NotificationsService, parseEmailSender } from './notifications.service';

// ═══════════════════════════════════════════════════
// Brevo transactional email integration tests.
// global fetch is mocked — no real emails are sent.
// ═══════════════════════════════════════════════════

describe('parseEmailSender', () => {
  it('parses "Name <addr>" format', () => {
    expect(parseEmailSender('EventAI <noreply@eventai.dev>')).toEqual({
      name: 'EventAI',
      email: 'noreply@eventai.dev',
    });
  });

  it('parses a bare address with the fallback name', () => {
    expect(parseEmailSender('noreply@eventai.dev')).toEqual({
      name: 'EventAI',
      email: 'noreply@eventai.dev',
    });
  });

  it('falls back to the default name when the display name is empty', () => {
    expect(parseEmailSender('<noreply@eventai.dev>')).toEqual({
      name: 'EventAI',
      email: 'noreply@eventai.dev',
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseEmailSender('  EventAI  < noreply@eventai.dev >  ')).toEqual({
      name: 'EventAI',
      email: 'noreply@eventai.dev',
    });
  });
});

describe('NotificationsService (Brevo)', () => {
  const ORIGINAL_ENV = { ...process.env };
  let fetchMock: jest.Mock;

  const lastBody = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);
  const lastHeaders = () => (fetchMock.mock.calls[0][1].headers as Record<string, string>);
  const lastUrl = () => fetchMock.mock.calls[0][0] as string;

  const okResponse = () =>
    ({ ok: true, status: 201, json: async () => ({ messageId: '<msg-1@brevo>' }) }) as unknown as Response;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.BREVO_API_KEY = 'xkeysib-live-test-key-0000000000000000000000';
    delete process.env.EMAIL_FROM;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  describe('sendEmail', () => {
    it('posts to the Brevo SMTP endpoint with api-key header and sender object', async () => {
      const service = new NotificationsService();
      const result = await service.sendEmail({
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
      });

      expect(result).toBe(true);
      expect(lastUrl()).toBe('https://api.brevo.com/v3/smtp/email');
      expect(lastHeaders()['api-key']).toBe(process.env.BREVO_API_KEY);
      expect(lastHeaders()['Content-Type']).toBe('application/json');

      const body = lastBody();
      expect(body.sender).toEqual({ name: 'EventAI', email: 'noreply@eventai.dev' });
      expect(body.to).toEqual([{ email: 'user@example.com' }]);
      expect(body.subject).toBe('Hello');
      expect(body.htmlContent).toBe('<p>Hi</p>');
    });

    it('uses EMAIL_FROM when set', async () => {
      process.env.EMAIL_FROM = 'Custom <sender@custom.dev>';
      const service = new NotificationsService();
      await service.sendEmail({ to: 'user@example.com', subject: 'S', html: 'H' });

      expect(lastBody().sender).toEqual({ name: 'Custom', email: 'sender@custom.dev' });
    });

    it('skips the send and returns false without an API key', async () => {
      delete process.env.BREVO_API_KEY;
      const service = new NotificationsService();
      const result = await service.sendEmail({ to: 'a@b.c', subject: 'S', html: 'H' });

      expect(result).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips the send for the placeholder key', async () => {
      process.env.BREVO_API_KEY = 'xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      const service = new NotificationsService();
      const result = await service.sendEmail({ to: 'a@b.c', subject: 'S', html: 'H' });

      expect(result).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns false on provider error responses', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Invalid API key' }),
      } as unknown as Response);
      const service = new NotificationsService();
      const result = await service.sendEmail({ to: 'a@b.c', subject: 'S', html: 'H' });

      expect(result).toBe(false);
    });

    it('returns false when the provider is unreachable', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      const service = new NotificationsService();
      const result = await service.sendEmail({ to: 'a@b.c', subject: 'S', html: 'H' });

      expect(result).toBe(false);
    });

    it('returns false when the error body is unparseable JSON', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('bad json');
        },
      } as unknown as Response);
      const service = new NotificationsService();
      const result = await service.sendEmail({ to: 'a@b.c', subject: 'S', html: 'H' }, 1, 10);

      expect(result).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries on transient 500 error and succeeds on subsequent attempt', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ message: 'Temporary glitch' }),
        } as unknown as Response)
        .mockResolvedValueOnce(okResponse());

      const service = new NotificationsService();
      const result = await service.sendEmail({ to: 'a@b.c', subject: 'S', html: 'H' }, 2, 10);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries on transient 429 rate limit and succeeds on subsequent attempt', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: async () => ({ message: 'Too many requests' }),
        } as unknown as Response)
        .mockResolvedValueOnce(okResponse());

      const service = new NotificationsService();
      const result = await service.sendEmail({ to: 'a@b.c', subject: 'S', html: 'H' }, 2, 10);

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('fails fast on permanent 400 Bad Request without retry', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Malformed recipient address' }),
      } as unknown as Response);

      const service = new NotificationsService();
      const result = await service.sendEmail({ to: 'invalid-email', subject: 'S', html: 'H' }, 2, 10);

      expect(result).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('email flows', () => {
    it('booking confirmation carries event, amount and ticket codes', async () => {
      const service = new NotificationsService();
      const result = await service.sendBookingConfirmation({
        to: 'buyer@example.com',
        holderName: 'Asha',
        eventTitle: 'Indie Night',
        eventStart: new Date('2026-12-01T18:30:00Z'),
        bookingId: 'bk-123',
        totalAmount: 150000,
        ticketCodes: ['TKT-A', 'TKT-B'],
      });

      expect(result).toBe(true);
      const body = lastBody();
      expect(body.to).toEqual([{ email: 'buyer@example.com' }]);
      expect(body.subject).toBe('Your tickets for Indie Night');
      expect(body.htmlContent).toContain('Indie Night');
      expect(body.htmlContent).toContain('₹1,500');
      expect(body.htmlContent).toContain('TKT-A');
      expect(body.htmlContent).toContain('TKT-B');
    });

    it('booking cancellation includes the optional reason when present', async () => {
      const service = new NotificationsService();
      await service.sendBookingCancellation({
        to: 'buyer@example.com',
        holderName: 'Asha',
        eventTitle: 'Indie Night',
        bookingId: 'bk-123',
        reason: 'Venue unavailable',
      });

      const body = lastBody();
      expect(body.subject).toBe('Booking cancelled — Indie Night');
      expect(body.htmlContent).toContain('Venue unavailable');
    });

    it('booking cancellation omits the reason block when absent', async () => {
      const service = new NotificationsService();
      await service.sendBookingCancellation({
        to: 'buyer@example.com',
        holderName: 'Asha',
        eventTitle: 'Indie Night',
        bookingId: 'bk-123',
      });

      expect(lastBody().htmlContent).not.toContain('<strong>Reason:</strong>');
    });

    it('event cancellation explains approval-gated refunds and escapes attendee data', async () => {
      const service = new NotificationsService();
      await service.sendEventCancellationNotice({
        to: 'buyer@example.com',
        holderName: '<Asha>',
        eventTitle: 'Indie <Night>',
        bookingId: 'bk-123',
        paymentStatus: 'CAPTURED',
        refundRequestStatus: 'PENDING',
      });

      const body = lastBody();
      expect(body.htmlContent).toContain('Hi &lt;Asha&gt;');
      expect(body.htmlContent).toContain('Indie &lt;Night&gt;');
      expect(body.htmlContent).toContain('awaiting organizer refund approval');
      expect(body.htmlContent).toContain('No Razorpay refund has been initiated yet');
    });

    it('refund confirmation carries the refund amount and reference', async () => {
      const service = new NotificationsService();
      await service.sendRefundConfirmation({
        to: 'buyer@example.com',
        holderName: 'Asha',
        eventTitle: 'Indie Night',
        bookingId: 'bk-123',
        refundAmount: 100000,
        refundId: 'rfnd-9',
      });

      const body = lastBody();
      expect(body.subject).toBe('Refund processed — Indie Night');
      expect(body.htmlContent).toContain('₹1,000');
      expect(body.htmlContent).toContain('rfnd-9');
    });

    it('password reset email contains the frontend reset link with the token', async () => {
      const service = new NotificationsService();
      await service.sendPasswordResetEmail({
        to: 'buyer@example.com',
        holderName: 'Asha',
        resetToken: 'raw-reset-token',
        frontendUrl: 'http://localhost:3000',
      });

      const body = lastBody();
      expect(body.subject).toBe('Reset your EventAI password');
      expect(body.htmlContent).toContain('http://localhost:3000/reset-password?token=raw-reset-token');
    });

    it('email verification email contains the frontend verify link with the token', async () => {
      const service = new NotificationsService();
      await service.sendEmailVerificationEmail({
        to: 'buyer@example.com',
        holderName: 'Asha',
        verificationToken: 'raw-verify-token',
        frontendUrl: 'http://localhost:3000',
      });

      const body = lastBody();
      expect(body.subject).toBe('Verify your EventAI email');
      expect(body.htmlContent).toContain('http://localhost:3000/verify-email?token=raw-verify-token');
    });
  });

  describe('In-app notifications', () => {
    it('creates and deduplicates in-app notifications within 24 hours', async () => {
      const mockNotification = {
        id: 'notif-1',
        userId: 'usr-1',
        type: 'REFUND_PROCESSED',
        title: 'Refund settled',
        message: 'Your refund of ₹500 is complete.',
        data: { bookingId: 'bk-123' },
        read: false,
        createdAt: new Date(),
      };

      const mockPrisma = {
        notification: {
          create: jest.fn().mockResolvedValue(mockNotification),
          findMany: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([mockNotification]),
          count: jest.fn().mockResolvedValue(1),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as any;

      const service = new NotificationsService(mockPrisma);
      const created = await service.createInAppNotification({
        userId: 'usr-1',
        type: 'REFUND_PROCESSED',
        title: 'Refund settled',
        message: 'Your refund of ₹500 is complete.',
        data: { bookingId: 'bk-123' },
      });

      expect(created).toEqual(mockNotification);
      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);

      // Test deduplication
      const deduped = await service.createInAppNotification({
        userId: 'usr-1',
        type: 'REFUND_PROCESSED',
        title: 'Refund settled',
        message: 'Your refund of ₹500 is complete.',
        data: { bookingId: 'bk-123' },
      });
      expect(deduped).toEqual(mockNotification);
      // create should not be called a second time
      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
    });

    it('allows resubmission after the earlier notification is marked as read', async () => {
      const mockNewNotification = {
        id: 'notif-new-2',
        userId: 'admin-1',
        type: 'SYSTEM',
        title: 'Organizer Application Submitted',
        message: 'Application under review.',
        data: { action: 'ORGANIZER_APPLICATION_SUBMITTED', organizerId: 'org-1' },
        isRead: false,
        createdAt: new Date(),
      };

      const mockPrisma = {
        notification: {
          // Because isRead: false is queried, the read notification is not returned
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue(mockNewNotification),
        },
      } as any;

      const service = new NotificationsService(mockPrisma);
      const resubmitted = await service.createInAppNotification({
        userId: 'admin-1',
        type: 'SYSTEM' as any,
        title: 'Organizer Application Submitted',
        message: 'Application under review.',
        data: { action: 'ORGANIZER_APPLICATION_SUBMITTED', organizerId: 'org-1' },
      });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'admin-1',
            isRead: false,
          }),
        }),
      );
      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
      expect(resubmitted).toEqual(mockNewNotification);
    });

    it('does not suppress distinct actions for the same organizer', async () => {
      const existingSubmissionNotification = {
        id: 'notif-sub-1',
        userId: 'usr-org-1',
        type: 'SYSTEM',
        title: 'Organizer Application Submitted',
        message: 'Your application is submitted.',
        data: { action: 'ORGANIZER_APPLICATION_SUBMITTED', organizerId: 'org-1' },
        isRead: false,
        createdAt: new Date(),
      };

      const mockApprovalNotification = {
        id: 'notif-app-2',
        userId: 'usr-org-1',
        type: 'SYSTEM',
        title: 'Organizer Application Approved',
        message: 'Your application has been approved!',
        data: { action: 'ORGANIZER_APPLICATION_APPROVED', organizerId: 'org-1' },
        isRead: false,
        createdAt: new Date(),
      };

      const mockPrisma = {
        notification: {
          findMany: jest.fn().mockResolvedValue([existingSubmissionNotification]),
          create: jest.fn().mockResolvedValue(mockApprovalNotification),
        },
      } as any;

      const service = new NotificationsService(mockPrisma);
      const approval = await service.createInAppNotification({
        userId: 'usr-org-1',
        type: 'SYSTEM' as any,
        title: 'Organizer Application Approved',
        message: 'Your application has been approved!',
        data: { action: 'ORGANIZER_APPLICATION_APPROVED', organizerId: 'org-1' },
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
      expect(approval).toEqual(mockApprovalNotification);
    });

    it('does not let notifications for two different events of the same organizer suppress each other', async () => {
      const existingEvent1Notification = {
        id: 'notif-evt-1',
        userId: 'admin-1',
        type: 'SYSTEM',
        title: 'Event Submitted for Approval',
        message: '"AI Summit" was submitted for admin approval.',
        data: { action: 'EVENT_SUBMITTED', eventId: 'evt-1', organizerId: 'org-1' },
        isRead: false,
        createdAt: new Date(),
      };

      const mockEvent2Notification = {
        id: 'notif-evt-2',
        userId: 'admin-1',
        type: 'SYSTEM',
        title: 'Event Submitted for Approval',
        message: '"Robotics Workshop" was submitted for admin approval.',
        data: { action: 'EVENT_SUBMITTED', eventId: 'evt-2', organizerId: 'org-1' },
        isRead: false,
        createdAt: new Date(),
      };

      const mockPrisma = {
        notification: {
          findMany: jest.fn().mockResolvedValue([existingEvent1Notification]),
          create: jest.fn().mockResolvedValue(mockEvent2Notification),
        },
      } as any;

      const service = new NotificationsService(mockPrisma);
      const res = await service.createInAppNotification({
        userId: 'admin-1',
        type: 'SYSTEM' as any,
        title: 'Event Submitted for Approval',
        message: '"Robotics Workshop" was submitted for admin approval.',
        data: { action: 'EVENT_SUBMITTED', eventId: 'evt-2', organizerId: 'org-1' },
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
      expect(res).toEqual(mockEvent2Notification);
    });

    it('does not deduplicate when primary identifier matches but event identifier differs in multi-identifier payload', async () => {
      const existingNotification = {
        id: 'notif-refund-1',
        userId: 'usr-org-1',
        type: 'SYSTEM',
        title: 'New refund request',
        message: 'Refund requested for event 1',
        data: { bookingId: 'bk-primary-1', eventId: 'evt-1', link: '/organizer/refunds' },
        isRead: false,
        createdAt: new Date(),
      };

      const newNotification = {
        id: 'notif-refund-2',
        userId: 'usr-org-1',
        type: 'SYSTEM',
        title: 'New refund request',
        message: 'Refund requested for event 2',
        data: { bookingId: 'bk-primary-1', eventId: 'evt-2', link: '/organizer/refunds' },
        isRead: false,
        createdAt: new Date(),
      };

      const mockPrisma = {
        notification: {
          findMany: jest.fn().mockResolvedValue([existingNotification]),
          create: jest.fn().mockResolvedValue(newNotification),
        },
      } as any;

      const service = new NotificationsService(mockPrisma);
      const res = await service.createInAppNotification({
        userId: 'usr-org-1',
        type: 'SYSTEM' as any,
        title: 'New refund request',
        message: 'Refund requested for event 2',
        data: { bookingId: 'bk-primary-1', eventId: 'evt-2', link: '/organizer/refunds' },
      });

      // Because eventId differs ('evt-1' vs 'evt-2'), existing notification cannot suppress it
      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
      expect(res).toEqual(newNotification);
    });

    it('deduplicates multi-identifier payloads when all shared identifiers match', async () => {
      const existingNotification = {
        id: 'notif-refund-1',
        userId: 'usr-org-1',
        type: 'SYSTEM',
        title: 'New refund request',
        message: 'Refund requested for event 1',
        data: { bookingId: 'bk-primary-1', eventId: 'evt-1', link: '/organizer/refunds' },
        isRead: false,
        createdAt: new Date(),
      };

      const mockPrisma = {
        notification: {
          findMany: jest.fn().mockResolvedValue([existingNotification]),
          create: jest.fn(),
        },
      } as any;

      const service = new NotificationsService(mockPrisma);
      const res = await service.createInAppNotification({
        userId: 'usr-org-1',
        type: 'SYSTEM' as any,
        title: 'New refund request',
        message: 'Refund requested for event 1',
        data: { bookingId: 'bk-primary-1', eventId: 'evt-1', link: '/organizer/refunds' },
      });

      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      expect(res).toEqual(existingNotification);
    });

    it('preserves deduplication for generic key and standalone event notifications', async () => {
      const keyNotification = {
        id: 'notif-key-1',
        userId: 'usr-1',
        type: 'SYSTEM',
        title: 'Sync finished',
        message: 'Periodic sync complete.',
        data: { key: 'sync-job-1' },
        isRead: false,
        createdAt: new Date(),
      };

      const eventNotification = {
        id: 'notif-evt-standalone',
        userId: 'usr-1',
        type: 'SYSTEM',
        title: 'Event update',
        message: 'Event time changed.',
        data: { eventId: 'evt-standalone-1' },
        isRead: false,
        createdAt: new Date(),
      };

      const mockPrisma = {
        notification: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([keyNotification])
            .mockResolvedValueOnce([eventNotification]),
          create: jest.fn(),
        },
      } as any;

      const service = new NotificationsService(mockPrisma);

      const resKey = await service.createInAppNotification({
        userId: 'usr-1',
        type: 'SYSTEM' as any,
        title: 'Sync finished',
        message: 'Periodic sync complete.',
        data: { key: 'sync-job-1' },
      });
      expect(resKey).toEqual(keyNotification);

      const resEvt = await service.createInAppNotification({
        userId: 'usr-1',
        type: 'SYSTEM' as any,
        title: 'Event update',
        message: 'Event time changed.',
        data: { eventId: 'evt-standalone-1' },
      });
      expect(resEvt).toEqual(eventNotification);

      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('fetches unread and total notifications, and marks as read', async () => {
      const mockNotification = {
        id: 'notif-1',
        userId: 'usr-1',
        read: false,
      };

      const mockPrisma = {
        notification: {
          findUnique: jest.fn().mockResolvedValue(mockNotification),
          update: jest.fn().mockResolvedValue({ ...mockNotification, read: true }),
          findMany: jest.fn().mockResolvedValue([mockNotification]),
          count: jest.fn().mockResolvedValue(1),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          delete: jest.fn().mockResolvedValue(mockNotification),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as any;

      const service = new NotificationsService(mockPrisma);
      const result = await service.getUserNotifications('usr-1');
      expect(result.unreadCount).toBe(1);
      expect(result.notifications).toHaveLength(1);

      const markOne = await service.markAsRead('usr-1', 'notif-1');
      expect(markOne).toEqual(expect.objectContaining({ id: 'notif-1' }));

      const markAll = await service.markAllAsRead('usr-1');
      expect(markAll).toEqual({ success: true });

      const clearOne = await service.clearNotification('usr-1', 'notif-1');
      expect(clearOne).toEqual({ success: true });
      expect(mockPrisma.notification.delete).toHaveBeenCalledWith({ where: { id: 'notif-1' } });

      const clearAll = await service.clearAll('usr-1');
      expect(clearAll).toEqual({ success: true, count: 1 });
      expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith({ where: { userId: 'usr-1' } });

      mockPrisma.notification.findUnique.mockResolvedValueOnce({ ...mockNotification, userId: 'other-user' });
      await expect(service.clearNotification('usr-1', 'notif-1')).rejects.toThrow();
    });

    it('does not let refund approved and refund settled notifications for the same booking suppress each other', async () => {
      const refundApprovedNotification = {
        id: 'notif-ref-app',
        userId: 'student-1',
        type: 'REFUND_PROCESSED',
        title: 'Refund approved',
        message: 'Your refund for "Tech Conference" was approved and settlement is being processed.',
        data: { action: 'REFUND_APPROVED', bookingId: 'bk-student-1', link: '/tickets' },
        isRead: false,
        createdAt: new Date(),
      };

      const refundSettledNotification = {
        id: 'notif-ref-set',
        userId: 'student-1',
        type: 'REFUND_PROCESSED',
        title: 'Refund settled',
        message: 'Your refund of ₹500 for "Tech Conference" has been settled.',
        data: { action: 'REFUND_SETTLED', bookingId: 'bk-student-1', refundId: 'rf-123', link: '/tickets' },
        isRead: false,
        createdAt: new Date(),
      };

      const mockPrisma = {
        notification: {
          findMany: jest.fn().mockResolvedValue([refundApprovedNotification]),
          create: jest.fn().mockResolvedValue(refundSettledNotification),
        },
      } as any;

      const service = new NotificationsService(mockPrisma);
      const res = await service.createInAppNotification({
        userId: 'student-1',
        type: 'REFUND_PROCESSED' as any,
        title: 'Refund settled',
        message: 'Your refund of ₹500 for "Tech Conference" has been settled.',
        data: { action: 'REFUND_SETTLED', bookingId: 'bk-student-1', refundId: 'rf-123', link: '/tickets' },
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
      expect(res).toEqual(refundSettledNotification);
    });

    it('enforces recipient isolation when marking a notification as read', async () => {
      const mockPrisma = {
        notification: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'notif-other-user',
            userId: 'user-actual-owner',
            isRead: false,
          }),
        },
      } as any;

      const service = new NotificationsService(mockPrisma);
      await expect(service.markAsRead('user-attacker', 'notif-other-user')).rejects.toThrow(
        'Notification not found',
      );
    });

    it('coalesces truly concurrent identical notification requests so only one record is created', async () => {
      const createdNotification = {
        id: 'notif-concurrent-1',
        userId: 'admin-concurrent',
        type: 'SYSTEM',
        title: 'New Organizer Application',
        message: 'New application received.',
        data: { action: 'ORGANIZER_APPLICATION_SUBMITTED', organizerId: 'org-conc-1' },
        isRead: false,
        createdAt: new Date(),
      };

      let findManyDelayResolve!: (val: any[]) => void;
      const delayedFindMany = new Promise<any[]>((resolve) => {
        findManyDelayResolve = resolve;
      });

      const mockPrisma = {
        notification: {
          findMany: jest.fn().mockImplementation(() => delayedFindMany),
          create: jest.fn().mockResolvedValue(createdNotification),
        },
      } as any;

      const service = new NotificationsService(mockPrisma);

      const payload = {
        userId: 'admin-concurrent',
        type: 'SYSTEM' as any,
        title: 'New Organizer Application',
        message: 'New application received.',
        data: { action: 'ORGANIZER_APPLICATION_SUBMITTED', organizerId: 'org-conc-1' },
      };

      const promise1 = service.createInAppNotification(payload);
      const promise2 = service.createInAppNotification(payload);

      findManyDelayResolve([]);

      const [res1, res2] = await Promise.all([promise1, promise2]);

      expect(mockPrisma.notification.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
      expect(res1).toEqual(createdNotification);
      expect(res2).toEqual(createdNotification);
    });
  });
});


describe('clear read notifications', () => {
  it('deletes read items belonging only to the requesting user', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 2 });
    const service = new NotificationsService({ notification: { deleteMany } } as never);
    await expect(service.clearRead('current-user')).resolves.toEqual({ success: true, count: 2 });
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'current-user', isRead: true } });
  });
});
