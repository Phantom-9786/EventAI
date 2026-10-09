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
      const result = await service.sendEmail({ to: 'a@b.c', subject: 'S', html: 'H' });

      expect(result).toBe(false);
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
});
