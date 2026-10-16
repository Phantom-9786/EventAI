import { ExpressModerationService } from './moderation.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../common/exceptions';

describe('ExpressModerationService Unit Tests', () => {
  let service: ExpressModerationService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      organizer: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      auditLog: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      user: {
        update: jest.fn(),
      },
      event: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((promises) => {
        if (Array.isArray(promises)) {
          return Promise.all(promises);
        }
        return Promise.resolve(promises);
      }),
    };

    service = new ExpressModerationService(mockPrisma);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Workflow 1: Organizer Application
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Workflow 1: Organizer Application', () => {
    it('creates a new organizer application with isVerified=false and PENDING status without changing user role', async () => {
      mockPrisma.organizer.findUnique.mockResolvedValue(null);
      mockPrisma.organizer.create.mockResolvedValue({
        id: 'org-1',
        userId: 'usr-1',
        organizationName: 'Acme Corp',
        description: 'Tech conferences',
        website: 'https://acme.test',
        phone: '+919876543210',
        logo: null,
        isVerified: false,
      });
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });

      const result = await service.applyToBecomeOrganizer('usr-1', {
        organizationName: 'Acme Corp',
        description: 'Tech conferences',
        website: 'https://acme.test',
        phone: '+919876543210',
      });

      expect(result.id).toBe('org-1');
      expect(result.isVerified).toBe(false);
      expect(result.status).toBe('PENDING');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'usr-1',
            action: 'ORGANIZER_APPLICATION_SUBMITTED',
            entity: 'Organizer',
            entityId: 'org-1',
          }),
        }),
      );
    });

    it('rejects duplicate application if organizer is already verified', async () => {
      mockPrisma.organizer.findUnique.mockResolvedValue({
        id: 'org-1',
        userId: 'usr-1',
        isVerified: true,
      });

      await expect(
        service.applyToBecomeOrganizer('usr-1', { organizationName: 'Acme Again' }),
      ).rejects.toThrow(new ConflictException('You already have an approved organizer profile'));
    });

    it('rejects duplicate application if an existing application is currently pending', async () => {
      mockPrisma.organizer.findUnique
        .mockResolvedValueOnce({
          id: 'org-1',
          userId: 'usr-1',
          isVerified: false,
        })
        .mockResolvedValueOnce({
          id: 'org-1',
          isVerified: false,
        });

      mockPrisma.auditLog.findFirst.mockResolvedValue({
        action: 'ORGANIZER_APPLICATION_SUBMITTED',
        createdAt: new Date(),
      });

      await expect(
        service.applyToBecomeOrganizer('usr-1', { organizationName: 'Acme Again' }),
      ).rejects.toThrow(new ConflictException('You already have a pending organizer application'));
    });

    it('allows re-application if previous application was rejected', async () => {
      mockPrisma.organizer.findUnique
        .mockResolvedValueOnce({
          id: 'org-1',
          userId: 'usr-1',
          isVerified: false,
        })
        .mockResolvedValueOnce({
          id: 'org-1',
          isVerified: false,
        });

      mockPrisma.auditLog.findFirst.mockResolvedValue({
        action: 'ORGANIZER_APPLICATION_REJECTED',
        details: { reason: 'Incomplete documents' },
        createdAt: new Date(),
      });

      mockPrisma.organizer.update.mockResolvedValue({
        id: 'org-1',
        userId: 'usr-1',
        organizationName: 'Acme Corp Updated',
        description: 'Valid documentation provided',
        website: 'https://acme.test',
        phone: '+919876543210',
        logo: null,
        isVerified: false,
      });
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit-2' });

      const result = await service.applyToBecomeOrganizer('usr-1', {
        organizationName: 'Acme Corp Updated',
        description: 'Valid documentation provided',
        website: 'https://acme.test',
        phone: '+919876543210',
      });

      expect(result.status).toBe('PENDING');
      expect(result.organizationName).toBe('Acme Corp Updated');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'ORGANIZER_APPLICATION_SUBMITTED',
            details: expect.objectContaining({ isReapplication: true }),
          }),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Workflow 2: Admin Approval & Rejection
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Workflow 2: Admin Approval and Rejection', () => {
    it('listPendingOrganizerApplications filters out approved and rejected applicants', async () => {
      mockPrisma.organizer.findMany.mockResolvedValue([
        {
          id: 'org-pending',
          userId: 'usr-p',
          organizationName: 'Pending Org',
          description: null,
          phone: null,
          website: null,
          logo: null,
          isVerified: false,
        },
        {
          id: 'org-rejected',
          userId: 'usr-r',
          organizationName: 'Rejected Org',
          description: null,
          phone: null,
          website: null,
          logo: null,
          isVerified: false,
        },
      ]);

      mockPrisma.organizer.findUnique
        .mockResolvedValueOnce({ id: 'org-pending', isVerified: false })
        .mockResolvedValueOnce({ id: 'org-rejected', isVerified: false });

      mockPrisma.auditLog.findFirst
        .mockResolvedValueOnce({ action: 'ORGANIZER_APPLICATION_SUBMITTED', createdAt: new Date() })
        .mockResolvedValueOnce({
          action: 'ORGANIZER_APPLICATION_REJECTED',
          details: { reason: 'Unverified ID' },
          createdAt: new Date(),
        });

      const list = await service.listPendingOrganizerApplications();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('org-pending');
      expect(list[0].status).toBe('PENDING');
    });

    it('approves organizer application, setting isVerified=true and user.role=ORGANIZER', async () => {
      mockPrisma.organizer.findUnique.mockResolvedValue({
        id: 'org-1',
        userId: 'usr-1',
        organizationName: 'Acme Corp',
        description: null,
        phone: null,
        website: null,
        logo: null,
        user: { id: 'usr-1', role: 'CUSTOMER' },
      });
      mockPrisma.organizer.update.mockResolvedValue({ id: 'org-1', isVerified: true });
      mockPrisma.user.update.mockResolvedValue({ id: 'usr-1', role: 'ORGANIZER' });
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit-approve' });

      const res = await service.approveOrganizerApplication('admin-1', 'org-1');
      expect(res.organizer.status).toBe('APPROVED');
      expect(res.organizer.isVerified).toBe(true);
      expect(mockPrisma.organizer.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { isVerified: true },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'usr-1' },
        data: { role: 'ORGANIZER' },
      });
    });

    it('rejects organizer application with reason, keeping isVerified=false and user.role=CUSTOMER', async () => {
      mockPrisma.organizer.findUnique.mockResolvedValue({
        id: 'org-1',
        userId: 'usr-1',
        organizationName: 'Spam Org',
        description: null,
        phone: null,
        website: null,
        logo: null,
      });
      mockPrisma.organizer.update.mockResolvedValue({ id: 'org-1', isVerified: false });
      mockPrisma.user.update.mockResolvedValue({ id: 'usr-1', role: 'CUSTOMER' });
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit-reject' });

      const res = await service.rejectOrganizerApplication('admin-1', 'org-1', 'Invalid business address');
      expect(res.organizer.status).toBe('REJECTED');
      expect(res.organizer.rejectionReason).toBe('Invalid business address');
      expect(res.organizer.isVerified).toBe(false);
      expect(mockPrisma.organizer.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { isVerified: false },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'usr-1' },
        data: { role: 'CUSTOMER' },
      });
    });

    it('rejects empty or whitespace reason on rejection with BadRequestException', async () => {
      await expect(
        service.rejectOrganizerApplication('admin-1', 'org-1', '   '),
      ).rejects.toThrow(new BadRequestException('Rejection reason is required'));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Workflow 3: Organizer Permissions & Access Guards
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Workflow 3: Organizer Permissions & Access Guards', () => {
    it('requireApprovedOrganizer returns organizerId for verified organizers', async () => {
      mockPrisma.organizer.findUnique.mockResolvedValue({
        id: 'org-1',
        isVerified: true,
      });

      const organizerId = await service.requireApprovedOrganizer('usr-1');
      expect(organizerId).toBe('org-1');
    });

    it('requireApprovedOrganizer throws ForbiddenException if user has no organizer profile', async () => {
      mockPrisma.organizer.findUnique.mockResolvedValue(null);

      await expect(service.requireApprovedOrganizer('usr-unknown')).rejects.toThrow(
        new ForbiddenException('You must have an approved organizer profile to perform this action'),
      );
    });

    it('requireApprovedOrganizer throws ForbiddenException with pending note when review is pending', async () => {
      mockPrisma.organizer.findUnique
        .mockResolvedValueOnce({ id: 'org-1', isVerified: false })
        .mockResolvedValueOnce({ id: 'org-1', isVerified: false });

      mockPrisma.auditLog.findFirst.mockResolvedValue({
        action: 'ORGANIZER_APPLICATION_SUBMITTED',
      });

      await expect(service.requireApprovedOrganizer('usr-1')).rejects.toThrow(
        new ForbiddenException('Your organizer application is pending administrator review'),
      );
    });

    it('requireApprovedOrganizer throws ForbiddenException with rejection reason when rejected', async () => {
      mockPrisma.organizer.findUnique
        .mockResolvedValueOnce({ id: 'org-1', isVerified: false })
        .mockResolvedValueOnce({ id: 'org-1', isVerified: false });

      mockPrisma.auditLog.findFirst.mockResolvedValue({
        action: 'ORGANIZER_APPLICATION_REJECTED',
        details: { reason: 'Invalid phone number' },
      });

      await expect(service.requireApprovedOrganizer('usr-1')).rejects.toThrow(
        new ForbiddenException('Your organizer application was rejected: Invalid phone number'),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Workflow 4: Event Creation, Submission, Review, and Material Edits
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Workflow 4: Event Creation & Moderation Lifecycle', () => {
    it('submitEventForReview enforces DRAFT status, future start date, and active ticket types', async () => {
      // 1. Non-existent event
      mockPrisma.event.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.submitEventForReview('org-1', 'evt-ghost'),
      ).rejects.toThrow(NotFoundException);

      // 2. Non-draft status
      mockPrisma.event.findFirst.mockResolvedValueOnce({
        id: 'evt-1',
        status: 'PUBLISHED',
        startDate: new Date(Date.now() + 86400000),
        ticketTypes: [{ id: 'tt-1' }],
      });
      await expect(
        service.submitEventForReview('org-1', 'evt-1'),
      ).rejects.toThrow(ConflictException);

      // 3. Past start date
      mockPrisma.event.findFirst.mockResolvedValueOnce({
        id: 'evt-1',
        status: 'DRAFT',
        startDate: new Date(Date.now() - 3600000),
        ticketTypes: [{ id: 'tt-1' }],
      });
      await expect(
        service.submitEventForReview('org-1', 'evt-1'),
      ).rejects.toThrow(new ConflictException('Event start date must be in the future'));

      // 4. No active ticket types
      mockPrisma.event.findFirst.mockResolvedValueOnce({
        id: 'evt-1',
        status: 'DRAFT',
        startDate: new Date(Date.now() + 86400000),
        ticketTypes: [],
      });
      await expect(
        service.submitEventForReview('org-1', 'evt-1'),
      ).rejects.toThrow(
        new ConflictException('Event must have at least one active ticket type before submission'),
      );

      // 5. Valid submission
      mockPrisma.event.findFirst.mockResolvedValueOnce({
        id: 'evt-1',
        status: 'DRAFT',
        startDate: new Date(Date.now() + 86400000),
        ticketTypes: [{ id: 'tt-1', isActive: true }],
      });
      mockPrisma.organizer.findUnique.mockResolvedValueOnce({ userId: 'usr-1' });
      mockPrisma.auditLog.create.mockResolvedValueOnce({ id: 'audit-sub' });

      const subResult = await service.submitEventForReview('org-1', 'evt-1');
      expect(subResult.status).toBe('PENDING_APPROVAL');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'EVENT_SUBMITTED',
            entityId: 'evt-1',
          }),
        }),
      );
    });

    it('reviewEvent allows admin to approve event', async () => {
      mockPrisma.event.findUnique.mockResolvedValue({ id: 'evt-1' });
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit-appr' });

      const result = await service.reviewEvent('admin-1', 'evt-1', { action: 'APPROVE' });
      expect(result.status).toBe('APPROVED');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'EVENT_APPROVED',
            entityId: 'evt-1',
            userId: 'admin-1',
          }),
        }),
      );
    });

    it('reviewEvent allows admin to reject event with required reason and reverts published status', async () => {
      mockPrisma.event.findUnique.mockResolvedValue({ id: 'evt-1' });
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit-rej' });
      mockPrisma.event.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.reviewEvent('admin-1', 'evt-1', {
        action: 'REJECT',
        reason: 'Violates venue safety standards',
      });

      expect(result.status).toBe('REJECTED');
      expect(result.rejectionReason).toBe('Violates venue safety standards');
      expect(mockPrisma.event.updateMany).toHaveBeenCalledWith({
        where: { id: 'evt-1', status: 'PUBLISHED' },
        data: { status: 'DRAFT' },
      });
    });

    it('reviewEvent rejects invalid actions or missing rejection reasons', async () => {
      await expect(
        service.reviewEvent('admin-1', 'evt-1', { action: 'UNKNOWN' as any }),
      ).rejects.toThrow(BadRequestException);

      mockPrisma.event.findUnique.mockResolvedValue({ id: 'evt-1' });
      await expect(
        service.reviewEvent('admin-1', 'evt-1', { action: 'REJECT', reason: '   ' }),
      ).rejects.toThrow(new BadRequestException('Rejection reason is required'));
    });

    it('assertEventApprovedForPublishing prevents unapproved events from being published', async () => {
      // 1. Rejected
      mockPrisma.auditLog.findFirst.mockResolvedValueOnce({
        action: 'EVENT_REJECTED',
        details: { reason: 'Inadequate safety precautions' },
      });
      await expect(service.assertEventApprovedForPublishing('evt-1')).rejects.toThrow(
        ForbiddenException,
      );

      // 2. Pending approval
      mockPrisma.auditLog.findFirst.mockResolvedValueOnce({
        action: 'EVENT_SUBMITTED',
      });
      await expect(service.assertEventApprovedForPublishing('evt-1')).rejects.toThrow(
        new ForbiddenException('Cannot publish event: administrator approval is currently pending'),
      );

      // 3. Draft
      mockPrisma.auditLog.findFirst.mockResolvedValueOnce(null);
      mockPrisma.event.findUnique.mockResolvedValueOnce({ status: 'DRAFT' });
      await expect(service.assertEventApprovedForPublishing('evt-1')).rejects.toThrow(
        new ForbiddenException(
          'Event must be submitted and approved by an administrator before it can be published',
        ),
      );

      // 4. Approved
      mockPrisma.auditLog.findFirst.mockResolvedValueOnce({
        action: 'EVENT_APPROVED',
      });
      await expect(service.assertEventApprovedForPublishing('evt-1')).resolves.toBeUndefined();
    });

    it('handleMaterialEventChange resets previously approved event to DRAFT and triggers re-review', async () => {
      mockPrisma.auditLog.findFirst.mockResolvedValueOnce({
        action: 'EVENT_APPROVED',
      });
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit-mat' });
      mockPrisma.event.updateMany.mockResolvedValue({ count: 1 });

      await service.handleMaterialEventChange('usr-1', 'evt-1', ['title', 'startDate']);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'EVENT_MATERIAL_CHANGE',
            entityId: 'evt-1',
            details: expect.objectContaining({
              changedFields: ['title', 'startDate'],
              reReviewRequired: true,
            }),
          }),
        }),
      );
      expect(mockPrisma.event.updateMany).toHaveBeenCalledWith({
        where: { id: 'evt-1', status: 'PUBLISHED' },
        data: { status: 'DRAFT' },
      });
    });
  });
});
