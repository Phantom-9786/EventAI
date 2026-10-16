import type { PrismaClient } from '@eventai/database';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '../../common/exceptions';

export type OrganizerApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type EventModerationStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export interface OrganizerApplicationDetails {
  id: string;
  userId: string;
  organizationName: string;
  description: string | null;
  phone: string | null;
  website: string | null;
  logo: string | null;
  isVerified: boolean;
  status: OrganizerApplicationStatus;
  rejectionReason?: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface EventModerationDetails {
  status: EventModerationStatus;
  rejectionReason?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  submittedAt?: string;
}

export class ExpressModerationService {
  constructor(private readonly prisma: PrismaClient) {}

  // ═══════════════════════════════════════════════════
  // Organizer Application Workflow
  // ═══════════════════════════════════════════════════

  async getOrganizerApplicationStatus(organizerId: string): Promise<{
    status: OrganizerApplicationStatus;
    rejectionReason?: string;
    reviewedAt?: string;
    reviewedBy?: string;
  }> {
    const organizer = await this.prisma.organizer.findUnique({
      where: { id: organizerId },
      select: { id: true, isVerified: true },
    });
    if (!organizer) {
      throw new NotFoundException('Organizer not found');
    }

    if (organizer.isVerified) {
      return { status: 'APPROVED' };
    }

    // Find the latest audit log regarding organizer application review
    const latestAudit = await this.prisma.auditLog.findFirst({
      where: {
        entity: 'Organizer',
        entityId: organizerId,
        action: { in: ['ORGANIZER_APPLICATION_REJECTED', 'ORGANIZER_APPLICATION_SUBMITTED', 'ORGANIZER_APPLICATION_APPROVED'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (latestAudit && latestAudit.action === 'ORGANIZER_APPLICATION_REJECTED') {
      const details = (latestAudit.details as Record<string, unknown> | null) ?? {};
      return {
        status: 'REJECTED',
        rejectionReason: (details.reason as string) ?? 'Application was rejected by administrator',
        reviewedAt: latestAudit.createdAt.toISOString(),
        reviewedBy: latestAudit.userId ?? undefined,
      };
    }

    return { status: 'PENDING' };
  }

  async applyToBecomeOrganizer(
    userId: string,
    input: { organizationName: string; description?: string; website?: string; phone?: string },
  ): Promise<OrganizerApplicationDetails> {
    const existing = await this.prisma.organizer.findUnique({
      where: { userId },
    });

    if (existing) {
      if (existing.isVerified) {
        throw new ConflictException('You already have an approved organizer profile');
      }

      // Check if previously rejected (controlled reapplication allowed)
      const currentStatus = await this.getOrganizerApplicationStatus(existing.id);
      if (currentStatus.status === 'PENDING') {
        throw new ConflictException('You already have a pending organizer application');
      }

      // Controlled reapplication after rejection: update details and re-submit
      const updated = await this.prisma.organizer.update({
        where: { id: existing.id },
        data: {
          organizationName: input.organizationName,
          description: input.description,
          website: input.website,
          phone: input.phone,
        },
      });

      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'ORGANIZER_APPLICATION_SUBMITTED',
          entity: 'Organizer',
          entityId: updated.id,
          details: {
            organizationName: input.organizationName,
            isReapplication: true,
            submittedAt: new Date().toISOString(),
          },
        },
      });

      return {
        ...updated,
        status: 'PENDING',
      };
    }

    // Brand new application
    const created = await this.prisma.organizer.create({
      data: {
        userId,
        organizationName: input.organizationName,
        description: input.description,
        website: input.website,
        phone: input.phone,
        isVerified: false,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'ORGANIZER_APPLICATION_SUBMITTED',
        entity: 'Organizer',
        entityId: created.id,
        details: {
          organizationName: input.organizationName,
          submittedAt: new Date().toISOString(),
        },
      },
    });

    return {
      ...created,
      status: 'PENDING',
    };
  }

  async approveOrganizerApplication(
    adminUserId: string,
    organizerId: string,
  ): Promise<{ organizer: OrganizerApplicationDetails; message: string }> {
    const organizer = await this.prisma.organizer.findUnique({
      where: { id: organizerId },
      include: { user: { select: { id: true, role: true } } },
    });
    if (!organizer) {
      throw new NotFoundException('Organizer application not found');
    }

    await this.prisma.$transaction([
      this.prisma.organizer.update({
        where: { id: organizerId },
        data: { isVerified: true },
      }),
      this.prisma.user.update({
        where: { id: organizer.userId },
        data: { role: 'ORGANIZER' },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: adminUserId,
          action: 'ORGANIZER_APPLICATION_APPROVED',
          entity: 'Organizer',
          entityId: organizerId,
          details: {
            approvedAt: new Date().toISOString(),
          },
        },
      }),
    ]);

    return {
      organizer: {
        id: organizer.id,
        userId: organizer.userId,
        organizationName: organizer.organizationName,
        description: organizer.description,
        phone: organizer.phone,
        website: organizer.website,
        logo: organizer.logo,
        isVerified: true,
        status: 'APPROVED',
      },
      message: 'Organizer application approved successfully',
    };
  }

  async rejectOrganizerApplication(
    adminUserId: string,
    organizerId: string,
    reason: string,
  ): Promise<{ organizer: OrganizerApplicationDetails; message: string }> {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Rejection reason is required');
    }

    const organizer = await this.prisma.organizer.findUnique({
      where: { id: organizerId },
    });
    if (!organizer) {
      throw new NotFoundException('Organizer application not found');
    }

    await this.prisma.$transaction([
      this.prisma.organizer.update({
        where: { id: organizerId },
        data: { isVerified: false },
      }),
      this.prisma.user.update({
        where: { id: organizer.userId },
        data: { role: 'CUSTOMER' },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: adminUserId,
          action: 'ORGANIZER_APPLICATION_REJECTED',
          entity: 'Organizer',
          entityId: organizerId,
          details: {
            reason: reason.trim(),
            rejectedAt: new Date().toISOString(),
          },
        },
      }),
    ]);

    return {
      organizer: {
        id: organizer.id,
        userId: organizer.userId,
        organizationName: organizer.organizationName,
        description: organizer.description,
        phone: organizer.phone,
        website: organizer.website,
        logo: organizer.logo,
        isVerified: false,
        status: 'REJECTED',
        rejectionReason: reason.trim(),
      },
      message: 'Organizer application rejected',
    };
  }

  async listPendingOrganizerApplications(): Promise<OrganizerApplicationDetails[]> {
    const unverifiedOrganizers = await this.prisma.organizer.findMany({
      where: { isVerified: false },
      orderBy: { createdAt: 'desc' },
    });

    const applications: OrganizerApplicationDetails[] = [];
    for (const org of unverifiedOrganizers) {
      const appStatus = await this.getOrganizerApplicationStatus(org.id);
      if (appStatus.status === 'PENDING') {
        applications.push({
          id: org.id,
          userId: org.userId,
          organizationName: org.organizationName,
          description: org.description,
          phone: org.phone,
          website: org.website,
          logo: org.logo,
          isVerified: org.isVerified,
          status: 'PENDING',
          reviewedAt: appStatus.reviewedAt,
          reviewedBy: appStatus.reviewedBy,
        });
      }
    }
    return applications;
  }

  async requireApprovedOrganizer(userId: string): Promise<string> {
    const organizer = await this.prisma.organizer.findUnique({
      where: { userId },
      select: { id: true, isVerified: true },
    });

    if (!organizer) {
      throw new ForbiddenException('You must have an approved organizer profile to perform this action');
    }

    if (!organizer.isVerified) {
      const status = await this.getOrganizerApplicationStatus(organizer.id);
      if (status.status === 'REJECTED') {
        throw new ForbiddenException(`Your organizer application was rejected: ${status.rejectionReason ?? 'Please reapply'}`);
      }
      throw new ForbiddenException('Your organizer application is pending administrator review');
    }

    return organizer.id;
  }

  // ═══════════════════════════════════════════════════
  // Event Moderation Workflow
  // ═══════════════════════════════════════════════════

  async getEventModerationStatus(eventId: string): Promise<EventModerationDetails> {
    const latestAudit = await this.prisma.auditLog.findFirst({
      where: {
        entity: 'Event',
        entityId: eventId,
        action: { in: ['EVENT_SUBMITTED', 'EVENT_APPROVED', 'EVENT_REJECTED', 'EVENT_MATERIAL_CHANGE'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestAudit) {
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        select: { status: true },
      });
      if (event && event.status === 'PUBLISHED') {
        return { status: 'APPROVED' };
      }
      return { status: 'DRAFT' };
    }

    const details = (latestAudit.details as Record<string, unknown> | null) ?? {};

    if (latestAudit.action === 'EVENT_APPROVED') {
      return {
        status: 'APPROVED',
        reviewedAt: latestAudit.createdAt.toISOString(),
        reviewedBy: latestAudit.userId ?? undefined,
      };
    }

    if (latestAudit.action === 'EVENT_REJECTED') {
      return {
        status: 'REJECTED',
        rejectionReason: (details.reason as string) ?? 'Event rejected by administrator',
        reviewedAt: latestAudit.createdAt.toISOString(),
        reviewedBy: latestAudit.userId ?? undefined,
      };
    }

    if (latestAudit.action === 'EVENT_SUBMITTED' || latestAudit.action === 'EVENT_MATERIAL_CHANGE') {
      return {
        status: 'PENDING_APPROVAL',
        submittedAt: latestAudit.createdAt.toISOString(),
      };
    }

    return { status: 'DRAFT' };
  }

  async submitEventForReview(organizerId: string, eventId: string): Promise<EventModerationDetails> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizerId },
      include: {
        ticketTypes: { where: { isActive: true } },
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (event.status !== 'DRAFT') {
      throw new ConflictException(`Only draft events can be submitted for review (current status: ${event.status})`);
    }

    if (event.startDate.getTime() <= Date.now()) {
      throw new ConflictException('Event start date must be in the future');
    }

    if (event.ticketTypes.length === 0) {
      throw new ConflictException('Event must have at least one active ticket type before submission');
    }

    const organizer = await this.prisma.organizer.findUnique({
      where: { id: organizerId },
      select: { userId: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: organizer?.userId,
        action: 'EVENT_SUBMITTED',
        entity: 'Event',
        entityId: event.id,
        details: {
          submittedAt: new Date().toISOString(),
          ticketTypeCount: event.ticketTypes.length,
        },
      },
    });

    return {
      status: 'PENDING_APPROVAL',
      submittedAt: new Date().toISOString(),
    };
  }

  async reviewEvent(
    adminUserId: string,
    eventId: string,
    input: { action: 'APPROVE' | 'REJECT'; reason?: string },
  ): Promise<EventModerationDetails> {
    if (input.action !== 'APPROVE' && input.action !== 'REJECT') {
      throw new BadRequestException('Review action must be APPROVE or REJECT');
    }
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { ticketTypes: true },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (input.action === 'REJECT') {
      if (!input.reason || input.reason.trim().length === 0) {
        throw new BadRequestException('Rejection reason is required');
      }

      await this.prisma.$transaction([this.prisma.auditLog.create({
        data: {
          userId: adminUserId,
          action: 'EVENT_REJECTED',
          entity: 'Event',
          entityId: event.id,
          details: {
            reason: input.reason.trim(),
            rejectedAt: new Date().toISOString(),
          },
        },
      }), this.prisma.event.updateMany({
        where: { id: eventId, status: 'PUBLISHED' },
        data: { status: 'DRAFT' },
      })]);

      return {
        status: 'REJECTED',
        rejectionReason: input.reason.trim(),
        reviewedAt: new Date().toISOString(),
        reviewedBy: adminUserId,
      };
    }

    // APPROVE
    await this.prisma.auditLog.create({
      data: {
        userId: adminUserId,
        action: 'EVENT_APPROVED',
        entity: 'Event',
        entityId: event.id,
        details: {
          approvedAt: new Date().toISOString(),
        },
      },
    });

    return {
      status: 'APPROVED',
      reviewedAt: new Date().toISOString(),
      reviewedBy: adminUserId,
    };
  }

  async assertEventApprovedForPublishing(eventId: string): Promise<void> {
    const moderation = await this.getEventModerationStatus(eventId);
    if (moderation.status !== 'APPROVED') {
      if (moderation.status === 'REJECTED') {
        throw new ForbiddenException(
          `Cannot publish event: it was rejected by moderation (${moderation.rejectionReason ?? 'Please update and resubmit'})`,
        );
      }
      if (moderation.status === 'PENDING_APPROVAL') {
        throw new ForbiddenException(
          'Cannot publish event: administrator approval is currently pending',
        );
      }
      throw new ForbiddenException(
        'Event must be submitted and approved by an administrator before it can be published',
      );
    }
  }

  async handleMaterialEventChange(
    organizerUserId: string,
    eventId: string,
    changedFields: string[],
  ): Promise<void> {
    const moderation = await this.getEventModerationStatus(eventId);
    // If the event was previously approved, a material change resets it to require re-review
    if (moderation.status === 'APPROVED') {
      await this.prisma.$transaction([this.prisma.auditLog.create({
        data: {
          userId: organizerUserId,
          action: 'EVENT_MATERIAL_CHANGE',
          entity: 'Event',
          entityId: eventId,
          details: {
            changedFields,
            reReviewRequired: true,
            timestamp: new Date().toISOString(),
          },
        },
      }), this.prisma.event.updateMany({
        where: { id: eventId, status: 'PUBLISHED' },
        data: { status: 'DRAFT' },
      })]);
    }
  }
}
