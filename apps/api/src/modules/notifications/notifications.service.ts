import { Injectable, Logger } from '@nestjs/common';

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

interface BrevoSendResponse {
  messageId?: string;
  message?: string;
}

interface BrevoSender {
  name: string;
  email: string;
}

/**
 * Parse an RFC-style sender value ("Name <addr@host>" or "addr@host")
 * into Brevo's { name, email } sender object.
 */
export function parseEmailSender(raw: string, fallbackName = 'EventAI'): BrevoSender {
  const match = raw.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (match) {
    return {
      name: match[1] || fallbackName,
      email: match[2].trim(),
    };
  }
  return { name: fallbackName, email: raw.trim() };
}

/**
 * Transactional email via the Brevo (ex-Sendinblue) REST API. Degrades
 * gracefully: without BREVO_API_KEY the send is skipped with a dev log
 * so local flows (booking, payment, refunds) never fail because of email.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  async sendEmail(input: SendEmailInput): Promise<boolean> {
    const apiKey = process.env.BREVO_API_KEY;
    const sender = parseEmailSender(
      process.env.EMAIL_FROM ?? 'EventAI <noreply@eventai.dev>',
    );
    if (!apiKey || apiKey.startsWith('xkeysib-xxxx')) {
      this.logger.log('Email skipped because the email provider is not configured');
      return false;
    }

    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender,
          to: [{ email: input.to }],
          subject: input.subject,
          htmlContent: input.html,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as BrevoSendResponse;
        this.logger.warn(`Brevo send failed (HTTP ${res.status})`);
        return false;
      }
      const body = (await res.json()) as BrevoSendResponse;
      this.logger.log('Email sent successfully');
      return true;
    } catch {
      this.logger.warn('Brevo request failed');
      return false;
    }
  }

  async sendBookingConfirmation(input: {
    to: string;
    holderName: string;
    eventTitle: string;
    eventStart: Date;
    bookingId: string;
    totalAmount: number;
    ticketCodes: string[];
  }): Promise<boolean> {
    const tickets = input.ticketCodes
      .map((code) => `<li style="font-family:monospace">${code}</li>`)
      .join('');
    return this.sendEmail({
      to: input.to,
      subject: `Your tickets for ${input.eventTitle}`,
      html: `
        <p>Hi ${input.holderName},</p>
        <p>Your booking is confirmed! Here are your details:</p>
        <ul>
          <li><strong>Event:</strong> ${input.eventTitle}</li>
          <li><strong>Starts:</strong> ${input.eventStart.toLocaleString('en-IN')}</li>
          <li><strong>Booking:</strong> ${input.bookingId}</li>
          <li><strong>Paid:</strong> ₹${(input.totalAmount / 100).toLocaleString('en-IN')}</li>
        </ul>
        <p>Your tickets (QR codes are available in the app under My Tickets):</p>
        <ul>${tickets}</ul>
        <p>See you there! — EventAI</p>
      `,
    });
  }

  async sendEmailVerificationEmail(input: {
    to: string;
    holderName: string;
    verificationToken: string;
    frontendUrl: string;
  }): Promise<boolean> {
    const verifyUrl = `${input.frontendUrl.replace(/\/$/, '')}/verify-email?token=${input.verificationToken}`;
    return this.sendEmail({
      to: input.to,
      subject: 'Verify your EventAI email',
      html: `
        <p>Hi ${input.holderName},</p>
        <p>Welcome to EventAI! Please confirm your email address. This link is valid for 24 hours:</p>
        <p><a href="${verifyUrl}">Verify my email</a></p>
        <p>If you didn't create an account, you can safely ignore this email.</p>
        <p>— EventAI</p>
      `,
    });
  }

  async sendPasswordResetEmail(input: {
    to: string;
    holderName: string;
    resetToken: string;
    frontendUrl: string;
  }): Promise<boolean> {
    const resetUrl = `${input.frontendUrl.replace(/\/$/, '')}/reset-password?token=${input.resetToken}`;
    return this.sendEmail({
      to: input.to,
      subject: 'Reset your EventAI password',
      html: `
        <p>Hi ${input.holderName},</p>
        <p>We received a request to reset your EventAI password. This link is valid for 1 hour:</p>
        <p><a href="${resetUrl}">Reset your password</a></p>
        <p>If you didn't request this, you can safely ignore this email — your password will not change.</p>
        <p>— EventAI</p>
      `,
    });
  }

  async sendBookingCancellation(input: {
    to: string;
    holderName: string;
    eventTitle: string;
    bookingId: string;
    reason?: string;
  }): Promise<boolean> {
    return this.sendEmail({
      to: input.to,
      subject: `Booking cancelled — ${input.eventTitle}`,
      html: `
        <p>Hi ${input.holderName},</p>
        <p>Your booking for <strong>${input.eventTitle}</strong> has been cancelled and any reserved seats have been released.</p>
        <ul>
          <li><strong>Event:</strong> ${input.eventTitle}</li>
          <li><strong>Booking:</strong> ${input.bookingId}</li>
          ${input.reason ? `<li><strong>Reason:</strong> ${input.reason}</li>` : ''}
        </ul>
        <p>No payment was taken for this booking. — EventAI</p>
      `,
    });
  }

  async sendRefundConfirmation(input: {
    to: string;
    holderName: string;
    eventTitle: string;
    bookingId: string;
    refundAmount: number;
    refundId: string;
    reason?: string;
  }): Promise<boolean> {
    return this.sendEmail({
      to: input.to,
      subject: `Refund processed — ${input.eventTitle}`,
      html: `
        <p>Hi ${input.holderName},</p>
        <p>Your booking for <strong>${input.eventTitle}</strong> has been cancelled and your payment is being refunded.</p>
        <ul>
          <li><strong>Event:</strong> ${input.eventTitle}</li>
          <li><strong>Booking:</strong> ${input.bookingId}</li>
          <li><strong>Refund amount:</strong> ₹${(input.refundAmount / 100).toLocaleString('en-IN')}</li>
          <li><strong>Refund reference:</strong> ${input.refundId}</li>
          ${input.reason ? `<li><strong>Reason:</strong> ${input.reason}</li>` : ''}
        </ul>
        <p>Refunds typically appear on your statement within 5–7 business days. — EventAI</p>
      `,
    });
  }
}
