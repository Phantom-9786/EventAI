import { SystemControlsService, DEFAULT_SYSTEM_CONTROLS } from './system-controls.service';

describe('SystemControlsService', () => {
  let service: SystemControlsService;
  let mockPrisma: any;
  let mockCache: any;

  beforeEach(() => {
    mockPrisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };

    mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    service = new SystemControlsService(mockPrisma, mockCache);
  });

  it('returns default system controls when cache and DB are empty', async () => {
    const settings = await service.getSettings();
    expect(settings).toEqual(DEFAULT_SYSTEM_CONTROLS);
    expect(settings.websiteMaintenance).toBe(false);
    expect(settings.aiMaintenance).toBe(false);
    expect(settings.eventCreationMaintenance).toBe(false);
  });

  it('reads system controls from Redis cache when available', async () => {
    const cachedSettings = {
      ...DEFAULT_SYSTEM_CONTROLS,
      aiMaintenance: true,
      aiMaintenanceMessage: 'Custom AI offline message',
    };
    mockCache.get.mockResolvedValueOnce(cachedSettings);

    const settings = await service.getSettings();
    expect(settings.aiMaintenance).toBe(true);
    expect(settings.aiMaintenanceMessage).toBe('Custom AI offline message');
    expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('falls back to database when Redis cache is cold and updates cache', async () => {
    const dbSettings = {
      websiteMaintenance: true,
      websiteMaintenanceMessage: 'Upgrading servers',
      aiMaintenance: false,
      aiMaintenanceMessage: 'Offline',
      eventCreationMaintenance: true,
      eventCreationMaintenanceMessage: 'Creation paused',
    };
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ key: 'system_controls', value: dbSettings }]);

    const settings = await service.getSettings();
    expect(settings.websiteMaintenance).toBe(true);
    expect(settings.websiteMaintenanceMessage).toBe('Upgrading servers');
    expect(settings.eventCreationMaintenance).toBe(true);
    expect(mockCache.set).toHaveBeenCalledWith('eventai:system_controls', expect.objectContaining({ websiteMaintenance: true }), 1800);
  });

  it('updates settings, writes to database, propagates to Redis, and writes an AuditLog', async () => {
    const updates = {
      websiteMaintenance: true,
      websiteMaintenanceMessage: 'Scheduled maintenance in progress',
    };

    const result = await service.updateSettings('admin-1', updates, {
      ipAddress: '127.0.0.1',
      userAgent: 'Jest/Test',
    });

    expect(result.websiteMaintenance).toBe(true);
    expect(result.websiteMaintenanceMessage).toBe('Scheduled maintenance in progress');
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO system_settings'),
      'system_controls',
      expect.any(String),
    );
    expect(mockCache.set).toHaveBeenCalledWith('eventai:system_controls', expect.objectContaining({ websiteMaintenance: true }), 1800);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'admin-1',
        action: 'SYSTEM_CONTROLS_UPDATE',
        entity: 'SystemControls',
        entityId: 'system_controls',
      }),
    });
  });

  it('fails open to safe defaults if database query throws', async () => {
    mockPrisma.$queryRawUnsafe.mockRejectedValueOnce(new Error('Database connection failed'));
    const settings = await service.getSettings();
    expect(settings).toEqual(DEFAULT_SYSTEM_CONTROLS);
    expect(settings.websiteMaintenance).toBe(false);
  });

  it('does not wake PostgreSQL on repeated minute polls when Redis is unavailable', async () => {
    jest.useFakeTimers();
    try {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ value: DEFAULT_SYSTEM_CONTROLS }]);
      await service.getSettings();
      for (let minute = 0; minute < 29; minute++) {
        jest.advanceTimersByTime(60_000);
        await service.getSettings();
      }
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(60_000);
      await service.getSettings();
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    } finally { jest.useRealTimers(); }
  });

  it('caches an empty settings table and applies admin changes immediately', async () => {
    jest.useFakeTimers();
    try {
      await service.getSettings();
      jest.advanceTimersByTime(5 * 60_000);
      await service.getSettings();
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
      await service.updateSettings('admin-1', { websiteMaintenance: true });
      expect((await service.getSettings()).websiteMaintenance).toBe(true);
      jest.advanceTimersByTime(4000);
      expect((await service.getSettings()).websiteMaintenance).toBe(true);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });

  describe('isAuthorizedMaintenanceTester', () => {
    it('authorizes any active ADMIN user inherently', async () => {
      mockPrisma.user = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin-user-id',
          email: 'admin@eventpoint.test',
          role: 'ADMIN',
          isActive: true,
        }),
      };

      const isTester = await service.isAuthorizedMaintenanceTester('admin-user-id');
      expect(isTester).toBe(true);
    });

    it('authorizes plus-addressed user linked to an active admin', async () => {
      mockPrisma.user = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'attendee-plus-id',
          email: 'admin+testattendee@eventpoint.test',
          role: 'CUSTOMER',
          isActive: true,
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: 'admin-id',
          email: 'admin@eventpoint.test',
          role: 'ADMIN',
          isActive: true,
        }),
      };

      const isTester = await service.isAuthorizedMaintenanceTester('attendee-plus-id');
      expect(isTester).toBe(true);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: { equals: 'admin@eventpoint.test', mode: 'insensitive' }, role: 'ADMIN', isActive: true },
        select: { id: true },
      });
    });

    it('authorizes user listed in maintenanceTesters with legacy { email, linkedBy } schema', async () => {
      mockPrisma.user = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'legacy-tester-id',
          email: 'tester.attendee@external.test',
          role: 'CUSTOMER',
          isActive: true,
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: 'owner-admin-id',
          role: 'ADMIN',
          isActive: true,
        }),
      };

      // Mock database returning maintenanceTesters with { email, linkedBy }
      const dbSettings = {
        ...DEFAULT_SYSTEM_CONTROLS,
        websiteMaintenance: true,
        maintenanceTesters: [
          {
            email: 'tester.attendee@external.test',
            linkedBy: 'owner-admin-id',
            linkedAt: '2026-10-18T00:00:00.000Z',
            allowedRoles: ['CUSTOMER', 'ORGANIZER'],
          },
        ],
      };
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ key: 'system_controls', value: dbSettings }]);

      const isTester = await service.isAuthorizedMaintenanceTester('legacy-tester-id');
      expect(isTester).toBe(true);
    });

    it('authorizes user listed in maintenanceTesters with standard { testEmail, adminId } schema', async () => {
      mockPrisma.user = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'standard-tester-id',
          email: 'standard.tester@external.test',
          role: 'CUSTOMER',
          isActive: true,
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: 'owner-admin-id',
          role: 'ADMIN',
          isActive: true,
        }),
      };

      const dbSettings = {
        ...DEFAULT_SYSTEM_CONTROLS,
        websiteMaintenance: true,
        maintenanceTesters: [
          {
            testEmail: 'standard.tester@external.test',
            adminId: 'owner-admin-id',
            allowedRoles: ['CUSTOMER'],
          },
        ],
      };
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ key: 'system_controls', value: dbSettings }]);

      const isTester = await service.isAuthorizedMaintenanceTester('standard-tester-id');
      expect(isTester).toBe(true);
    });

    it('blocks user when their role is not included in allowedRoles', async () => {
      mockPrisma.user = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'organizer-tester-id',
          email: 'org.tester@external.test',
          role: 'ORGANIZER',
          isActive: true,
        }),
      };

      const dbSettings = {
        ...DEFAULT_SYSTEM_CONTROLS,
        websiteMaintenance: true,
        maintenanceTesters: [
          {
            email: 'org.tester@external.test',
            linkedBy: 'owner-admin-id',
            allowedRoles: ['CUSTOMER'], // only CUSTOMER permitted
          },
        ],
      };
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ key: 'system_controls', value: dbSettings }]);

      const isTester = await service.isAuthorizedMaintenanceTester('organizer-tester-id');
      expect(isTester).toBe(false);
    });

    it('strictly blocks ordinary unlinked users and inactive accounts', async () => {
      mockPrisma.user = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'unlinked-customer-id',
          email: 'ordinary.attendee@gmail.com',
          role: 'CUSTOMER',
          isActive: true,
        }),
      };
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ key: 'system_controls', value: DEFAULT_SYSTEM_CONTROLS }]);

      const isTester = await service.isAuthorizedMaintenanceTester('unlinked-customer-id');
      expect(isTester).toBe(false);

      // Inactive user
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'inactive-user-id',
        email: 'inactive@gmail.com',
        role: 'CUSTOMER',
        isActive: false,
      });
      const isInactiveTester = await service.isAuthorizedMaintenanceTester('inactive-user-id');
      expect(isInactiveTester).toBe(false);
    });
  });

  describe('linkMaintenanceTester and listMaintenanceTesters', () => {
    it('links a tester safely without TypeError when existing list has mixed schema', async () => {
      mockPrisma.user = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin-owner-id',
          email: 'owner@eventpoint.test',
          role: 'ADMIN',
          isActive: true,
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: 'target-user-id',
          email: 'new.tester@external.test',
          role: 'CUSTOMER',
          isActive: true,
        }),
      };

      const existingSettings = {
        ...DEFAULT_SYSTEM_CONTROLS,
        maintenanceTesters: [
          {
            email: 'legacy.tester@external.test', // no testEmail property
            linkedBy: 'admin-owner-id',
          },
        ],
      };
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ key: 'system_controls', value: existingSettings }]);

      const entry = await service.linkMaintenanceTester('admin-owner-id', 'new.tester@external.test');
      expect(entry.testEmail).toBe('new.tester@external.test');
      expect(entry.adminId).toBe('admin-owner-id');
    });

    it('lists maintenance testers normalized regardless of stored schema format', async () => {
      mockPrisma.user = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin-owner-id',
          email: 'owner@eventpoint.test',
          role: 'ADMIN',
          adminRole: 'OWNER',
          isActive: true,
        }),
      };

      const dbSettings = {
        ...DEFAULT_SYSTEM_CONTROLS,
        maintenanceTesters: [
          {
            email: 'legacy.tester@external.test',
            linkedBy: 'admin-owner-id',
            linkedAt: '2026-10-18T00:00:00.000Z',
          },
          {
            testEmail: 'standard.tester@external.test',
            adminId: 'admin-owner-id',
            createdAt: '2026-10-18T01:00:00.000Z',
          },
        ],
      };
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ key: 'system_controls', value: dbSettings }]);

      const list = await service.listMaintenanceTesters('admin-owner-id');
      expect(list).toHaveLength(2);
      expect(list[0].testEmail).toBe('legacy.tester@external.test');
      expect(list[0].adminId).toBe('admin-owner-id');
      expect(list[1].testEmail).toBe('standard.tester@external.test');
      expect(list[1].adminId).toBe('admin-owner-id');
    });

    it('verifyTesterSessionAcquisition authorizes linked tester and rejects unlinked accounts', async () => {
      mockPrisma.user = {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 'admin-1') {
            return Promise.resolve({
              id: 'admin-1',
              email: 'admin@eventpoint.test',
              role: 'ADMIN',
              adminRole: 'MANAGER',
              isActive: true,
            });
          }
          return Promise.resolve(null);
        }),
        findFirst: jest.fn().mockImplementation(({ where }) => {
          const email = where.email?.equals?.toLowerCase();
          if (email === 'linked.tester@external.test') {
            return Promise.resolve({
              id: 'target-1',
              email: 'linked.tester@external.test',
              role: 'CUSTOMER',
              isActive: true,
            });
          }
          return Promise.resolve(null);
        }),
      };

      const dbSettings = {
        ...DEFAULT_SYSTEM_CONTROLS,
        maintenanceTesters: [
          {
            email: 'linked.tester@external.test',
            linkedBy: 'admin-1',
            allowedRoles: ['CUSTOMER'],
          },
        ],
      };
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ key: 'system_controls', value: dbSettings }]);

      // 1. Authorized linked tester succeeds
      const target = await service.verifyTesterSessionAcquisition('admin-1', 'linked.tester@external.test');
      expect(target.id).toBe('target-1');
      expect(target.email).toBe('linked.tester@external.test');

      // 2. Unlinked tester fails
      await expect(
        service.verifyTesterSessionAcquisition('admin-1', 'unlinked@external.test'),
      ).rejects.toThrow('is not registered as an authorized maintenance tester');
    });

    it('purgeTesterEntitlementsForUser prunes both tester matching user and testers sponsored by the revoked admin', async () => {
      const dbSettings = {
        ...DEFAULT_SYSTEM_CONTROLS,
        websiteMaintenance: true,
        maintenanceTesters: [
          {
            testEmail: 'owner.attendee@external.test',
            testUserId: 'owner-attendee-id',
            adminId: 'owner-id',
            allowedRoles: ['CUSTOMER'],
          },
          {
            testEmail: 'delegated.admin@external.test',
            testUserId: 'delegated-admin-id',
            adminId: 'owner-id',
            allowedRoles: ['CUSTOMER', 'ORGANIZER'],
          },
          {
            testEmail: 'sponsored.by.delegated@external.test',
            testUserId: 'sponsored-id',
            adminId: 'delegated-admin-id',
            allowedRoles: ['CUSTOMER'],
          },
        ],
      };
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ key: 'system_controls', value: dbSettings }]);

      const result = await service.purgeTesterEntitlementsForUser('owner-id', {
        id: 'delegated-admin-id',
        email: 'delegated.admin@external.test',
      });

      expect(result.removedCount).toBe(2);
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO system_settings'),
        'system_controls',
        expect.stringMatching(/"owner\.attendee@external\.test"/),
      );
      const insertCall = mockPrisma.$executeRawUnsafe.mock.calls.find((call: any[]) =>
        typeof call[0] === 'string' && call[0].includes('INSERT INTO system_settings'),
      );
      expect(insertCall).toBeDefined();
      const savedPayload = JSON.parse(insertCall[2]);
      expect(savedPayload.maintenanceTesters).toHaveLength(1);
      expect(savedPayload.maintenanceTesters[0].testEmail).toBe('owner.attendee@external.test');
    });
  });
});
