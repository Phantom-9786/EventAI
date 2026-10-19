import { Injectable, Logger, NotFoundException, Optional } from '../../common/exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationType } from '@prisma/client';

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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character]!;
  });
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

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  private readonly inFlightCreation = new Map<string, Promise<any>>();

  async createInAppNotification(input: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    data?: Record<string, unknown>;
  }) {
    const prisma = this.prisma;
    if (!prisma) {
      this.logger.debug('In-app notification skipped: Prisma not injected');
      return null;
    }

    const data = input.data ?? {};
    const action = data.action as string | undefined;
    const hasIdentifiers = Boolean(
      data.bookingId || data.key || data.eventId || data.organizerId,
    );

    const concurrencyKey = hasIdentifiers
      ? `${input.userId}:${input.type}:${action ?? ''}:${String(data.bookingId ?? '')}:${String(data.eventId ?? '')}:${String(data.organizerId ?? '')}:${String(data.key ?? '')}`
      : null;

    if (concurrencyKey) {
      const active = this.inFlightCreation.get(concurrencyKey);
      if (active) {
        return await active;
      }
    }

    const task = (async () => {
      try {
        if (hasIdentifiers) {
          const recent = await prisma.notification.findMany({
            where: {
              userId: input.userId,
              type: input.type,
              isRead: false,
              createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
            take: 20,
          });

          const match = recent.find((n) => {
            if (!n.data || typeof n.data !== 'object') return false;
            const d = n.data as Record<string, unknown>;

            // When an action is supplied, the existing notification action must match
            if (action !== undefined && d.action !== action) {
              return false;
            }

            let hasSharedIdentifier = false;

            // Compare all supported identifiers. Any identifier present in both must match exactly;
            // conflicting values between incoming and existing notifications prevent a match.
            for (const idKey of ['bookingId', 'key', 'eventId', 'organizerId'] as const) {
              const incomingVal = data[idKey];
              const existingVal = d[idKey];

              if (incomingVal !== undefined && existingVal !== undefined) {
                if (existingVal !== incomingVal) {
                  return false;
                }
                hasSharedIdentifier = true;
              }
            }

            return hasSharedIdentifier;
          });

          if (match) return match;
        }

        return await prisma.notification.create({
          data: {
            userId: input.userId,
            type: input.type,
            title: input.title,
            message: input.message,
            data: input.data ? JSON.parse(JSON.stringify(input.data)) : undefined,
          },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to persist in-app notification: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    })();

    if (concurrencyKey) {
      this.inFlightCreation.set(concurrencyKey, task);
    }

    try {
      return await task;
    } finally {
      if (concurrencyKey) {
        this.inFlightCreation.delete(concurrencyKey);
      }
    }
  }

  async getUserNotifications(userId: string, limit = 30) {
    if (!this.prisma) return { notifications: [], unreadCount: 0 };
    const [notifications, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.notification.count({
        where: { userId, isRead: false },
      }),
    ]);
    return { notifications, unreadCount };
  }

  async markAsRead(userId: string, id: string) {
    if (!this.prisma) return null;
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllAsRead(userId: string) {
    if (!this.prisma) return { success: true };
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { success: true };
  }

  async clearRead(userId: string) {
    if (!this.prisma) return { success: true, count: 0 };
    const result = await this.prisma.notification.deleteMany({ where: { userId, isRead: true } });
    return { success: true, count: result.count };
  }

  async clearAll(userId: string) {
    if (!this.prisma) return { success: true, count: 0 };
    const result = await this.prisma.notification.deleteMany({
      where: { userId },
    });
    return { success: true, count: result.count };
  }

  async clearNotification(userId: string, id: string) {
    if (!this.prisma) return { success: true };
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }
    await this.prisma.notification.delete({ where: { id } });
    return { success: true };
  }

  async sendEmail(input: SendEmailInput, retries = 2, backoffMs = 100): Promise<boolean> {
    const apiKey = process.env.BREVO_API_KEY;
    const sender = parseEmailSender(
      process.env.EMAIL_FROM ?? 'EventAI <noreply@eventai.dev>',
    );
    if (!apiKey || apiKey.startsWith('xkeysib-xxxx')) {
      this.logger.log('Email skipped because the email provider is not configured');
      return false;
    }

    let attempt = 0;
    while (attempt <= retries) {
      attempt++;
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

        if (res.ok) {
          await res.json().catch(() => ({}));
          this.logger.log('Email sent successfully');
          return true;
        }

        // Non-retryable permanent client errors (400, 401, 403, 404, etc.)
        // 429 Too Many Requests is transient rate-limiting and eligible for retry.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          this.logger.warn(`Brevo send failed with non-retryable error (HTTP ${res.status})`);
          return false;
        }

        this.logger.warn(
          `Brevo send failed (HTTP ${res.status}), attempt ${attempt}/${retries + 1}`,
        );
      } catch (err) {
        this.logger.warn(
          `Brevo request network error: ${err instanceof Error ? err.message : String(err)}, attempt ${attempt}/${retries + 1}`,
        );
      }

      if (attempt <= retries) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs * Math.pow(2, attempt - 1)));
      }
    }

    return false;
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

  async sendEmailVerificationOtp(input: {
    to: string;
    holderName: string;
    otp: string;
  }): Promise<boolean> {
    return this.sendEmail({
      to: input.to,
      subject: 'Your EventAI verification code',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #18181b;">
          <h2 style="font-size: 20px; font-weight: 700; color: #09090b; margin-bottom: 12px;">Verify your EventAI email</h2>
          <p style="font-size: 15px; line-height: 1.5; color: #3f3f46; margin: 0 0 16px;">Hi ${input.holderName},</p>
          <p style="font-size: 15px; line-height: 1.5; color: #3f3f46; margin: 0 0 20px;">
            Thank you for creating an account with EventAI. Use the 6-digit verification code below to verify your email address:
          </p>
          <div style="background-color: #f4f4f5; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
            <span style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #09090b;">
              ${input.otp}
            </span>
          </div>
          <p style="font-size: 14px; line-height: 1.5; color: #71717a; margin: 0 0 8px;">
            This verification code expires in 10 minutes and can only be used once.
          </p>
          <p style="font-size: 14px; line-height: 1.5; color: #71717a; margin: 0 0 24px;">
            If you did not request this verification code, please ignore this email.
          </p>
          <p style="font-size: 14px; color: #a1a1aa; margin: 0;">— The EventAI Team</p>
        </div>
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

  async sendAdminInvitationEmail(input: {
    to: string;
    inviterName: string;
    role: string;
    invitationToken: string;
    frontendUrl: string;
    expiresInHours?: number;
  }): Promise<boolean> {
    const inviteUrl = `${input.frontendUrl.replace(/\/$/, '')}/admin/accept-invitation?token=${input.invitationToken}`;
    return this.sendEmail({
      to: input.to,
      subject: 'You have been invited to join the EventPoint Admin Team',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #18181b;">
          <h2 style="font-size: 20px; font-weight: 700; color: #09090b; margin-bottom: 12px;">EventPoint Administrator Invitation</h2>
          <p style="font-size: 15px; line-height: 1.5; color: #3f3f46; margin: 0 0 16px;">Hello,</p>
          <p style="font-size: 15px; line-height: 1.5; color: #3f3f46; margin: 0 0 20px;">
            <strong>${escapeHtml(input.inviterName)}</strong> has invited you to join the EventPoint administrative team as a <strong>${escapeHtml(input.role)}</strong>.
          </p>
          <div style="margin: 24px 0;">
            <a href="${inviteUrl}" style="background-color: #6366f1; color: #ffffff; padding: 12px 24px; font-weight: 600; text-decoration: none; border-radius: 6px; display: inline-block;">
              Accept Invitation
            </a>
          </div>
          <p style="font-size: 14px; line-height: 1.5; color: #71717a; margin: 0 0 8px;">
            This invitation link is valid for ${input.expiresInHours ?? 48} hours and can only be accepted by this email address (${escapeHtml(input.to)}).
          </p>
          <p style="font-size: 14px; line-height: 1.5; color: #71717a; margin: 0 0 24px;">
            If you do not have an EventPoint account yet, please sign up using this email first, then click Accept.
          </p>
          <p style="font-size: 14px; color: #a1a1aa; margin: 0;">— The EventPoint Team</p>
        </div>
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

  async sendEventCancellationNotice(input: {
    to: string;
    holderName: string;
    eventTitle: string;
    bookingId: string;
    paymentStatus: string | null;
    refundRequestStatus: string | null;
  }): Promise<boolean> {
    const holderName = escapeHtml(input.holderName);
    const eventTitle = escapeHtml(input.eventTitle);
    const bookingId = escapeHtml(input.bookingId);
    const paymentMessage =
      input.refundRequestStatus === 'APPROVED' || input.paymentStatus === 'REFUND_PENDING'
        ? '<p>Your refund has been approved and is awaiting payment-provider confirmation.</p>'
        : input.paymentStatus === 'REFUNDED'
          ? '<p>Your payment has already been refunded.</p>'
          : input.paymentStatus === 'CAPTURED'
            ? '<p>Your captured payment is awaiting organizer refund approval. No Razorpay refund has been initiated yet; you can follow its status under My Tickets.</p>'
            : '<p>No captured payment was found for this booking.</p>';
    return this.sendEmail({
      to: input.to,
      subject: `Event cancelled — ${input.eventTitle}`,
      html: `
        <p>Hi ${holderName},</p>
        <p>The organizer has cancelled <strong>${eventTitle}</strong>. Your booking and tickets are no longer valid.</p>
        <p><strong>Booking:</strong> ${bookingId}</p>
        ${paymentMessage}
        <p>— EventAI</p>
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
