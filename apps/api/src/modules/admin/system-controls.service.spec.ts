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
    expect(mockCache.set).toHaveBeenCalledWith('eventai:system_controls', expect.objectContaining({ websiteMaintenance: true }), 60);
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
    expect(mockCache.set).toHaveBeenCalledWith('eventai:system_controls', expect.objectContaining({ websiteMaintenance: true }), 60);
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
});
