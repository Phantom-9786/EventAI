import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '../../common/exceptions';
import type { PrismaClient } from '@prisma/client';
import type { CacheService } from '../../common/cache/cache.service';
import type {
  SystemControls,
  AdminUpdateSystemControlsInput,
  MaintenanceTesterEntry,
} from '@eventai/validation';

export const DEFAULT_SYSTEM_CONTROLS: SystemControls = {
  websiteMaintenance: false,
  websiteMaintenanceMessage:
    'EventPoint is temporarily undergoing maintenance. Please check back soon.',
  aiMaintenance: false,
  aiMaintenanceMessage:
    'AI Assistant is temporarily unavailable for maintenance. Please try again later.',
  eventCreationMaintenance: false,
  eventCreationMaintenanceMessage:
    'New event creation is temporarily unavailable. Existing events remain accessible.',
  maintenanceTesters: [],
};

const REDIS_KEY = 'eventai:system_controls';
const SETTING_DB_KEY = 'system_controls';

@Injectable()
export class SystemControlsService {
  private readonly logger = new Logger(SystemControlsService.name);
  private tableEnsured = false;
  private inMemoryCache: { settings: SystemControls; expiresAt: number } | null = null;
  private readonly testerCache = new Map<string, { isTester: boolean; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache?: CacheService,
  ) {}

  /**
   * Automatically ensure system_settings key-value table exists in PostgreSQL.
   * Safe to call multiple times; uses IF NOT EXISTS so existing data is never touched.
   */
  async ensureTable(): Promise<void> {
    if (this.tableEnsured) return;
    if (!this.prisma || typeof (this.prisma as any).$executeRawUnsafe !== 'function') {
      return;
    }
    try {
      await (this.prisma as any).$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS system_settings (
          key VARCHAR(100) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
      this.tableEnsured = true;
    } catch (err) {
      this.logger.warn(
        'Could not ensure system_settings table, will retry on next operation: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  /**
   * Retrieves current system control settings with multilayer fallback:
   * 1. Short in-memory cache (3 seconds)
   * 2. Shared Redis cache
   * 3. PostgreSQL system_settings table
   * 4. Safe defaults (fails open so users are never accidentally locked out)
   */
  async getSettings(): Promise<SystemControls> {
    const now = Date.now();
    if (this.inMemoryCache && this.inMemoryCache.expiresAt > now) {
      return this.inMemoryCache.settings;
    }

    // 1. Try Redis
    if (this.cache) {
      try {
        const cached = await this.cache.get<SystemControls>(REDIS_KEY);
        if (cached && typeof cached.websiteMaintenance === 'boolean') {
          this.inMemoryCache = { settings: cached, expiresAt: now + 3000 };
          return cached;
        }
      } catch (err) {
        this.logger.debug('Redis cache read failed for system controls: ' + String(err));
      }
    }

    // 2. Try PostgreSQL
    try {
      await this.ensureTable();
      if (!this.prisma || typeof (this.prisma as any).$queryRawUnsafe !== 'function') {
        this.inMemoryCache = { settings: DEFAULT_SYSTEM_CONTROLS, expiresAt: now + 3000 };
        return { ...DEFAULT_SYSTEM_CONTROLS };
      }
      const rows = await (this.prisma as any).$queryRawUnsafe(
        `SELECT value FROM system_settings WHERE key = $1 LIMIT 1;`,
        SETTING_DB_KEY,
      );

      if (Array.isArray(rows) && rows.length > 0 && rows[0]?.value) {
        const dbValue = rows[0].value;
        const resolved: SystemControls = {
          websiteMaintenance: Boolean(dbValue.websiteMaintenance),
          websiteMaintenanceMessage:
            typeof dbValue.websiteMaintenanceMessage === 'string' && dbValue.websiteMaintenanceMessage.trim()
              ? dbValue.websiteMaintenanceMessage
              : DEFAULT_SYSTEM_CONTROLS.websiteMaintenanceMessage,
          aiMaintenance: Boolean(dbValue.aiMaintenance),
          aiMaintenanceMessage:
            typeof dbValue.aiMaintenanceMessage === 'string' && dbValue.aiMaintenanceMessage.trim()
              ? dbValue.aiMaintenanceMessage
              : DEFAULT_SYSTEM_CONTROLS.aiMaintenanceMessage,
          eventCreationMaintenance: Boolean(dbValue.eventCreationMaintenance),
          eventCreationMaintenanceMessage:
            typeof dbValue.eventCreationMaintenanceMessage === 'string' && dbValue.eventCreationMaintenanceMessage.trim()
              ? dbValue.eventCreationMaintenanceMessage
              : DEFAULT_SYSTEM_CONTROLS.eventCreationMaintenanceMessage,
          maintenanceTesters: Array.isArray(dbValue.maintenanceTesters)
            ? dbValue.maintenanceTesters
            : [],
        };

        // Populate caches
        this.inMemoryCache = { settings: resolved, expiresAt: now + 3000 };
        if (this.cache) {
          void this.cache.set(REDIS_KEY, resolved, 60).catch(() => {});
        }
        return resolved;
      }
    } catch (err) {
      this.logger.error('Failed to query system_settings from database, using safe defaults: ' + (err instanceof Error ? err.message : String(err)));
    }

    // 3. Fallback to safe defaults
    this.inMemoryCache = { settings: DEFAULT_SYSTEM_CONTROLS, expiresAt: now + 3000 };
    return { ...DEFAULT_SYSTEM_CONTROLS };
  }

  /**
   * Updates system control settings, persists to DB, propagates to Redis, and writes an AuditLog.
   */
  async updateSettings(
    userId: string,
    input: AdminUpdateSystemControlsInput,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<SystemControls> {
    const current = await this.getSettings();

    const next: SystemControls = {
      websiteMaintenance:
        typeof input.websiteMaintenance === 'boolean'
          ? input.websiteMaintenance
          : current.websiteMaintenance,
      websiteMaintenanceMessage:
        typeof input.websiteMaintenanceMessage === 'string' && input.websiteMaintenanceMessage.trim()
          ? input.websiteMaintenanceMessage.trim()
          : current.websiteMaintenanceMessage,
      aiMaintenance:
        typeof input.aiMaintenance === 'boolean'
          ? input.aiMaintenance
          : current.aiMaintenance,
      aiMaintenanceMessage:
        typeof input.aiMaintenanceMessage === 'string' && input.aiMaintenanceMessage.trim()
          ? input.aiMaintenanceMessage.trim()
          : current.aiMaintenanceMessage,
      eventCreationMaintenance:
        typeof input.eventCreationMaintenance === 'boolean'
          ? input.eventCreationMaintenance
          : current.eventCreationMaintenance,
      eventCreationMaintenanceMessage:
        typeof input.eventCreationMaintenanceMessage === 'string' && input.eventCreationMaintenanceMessage.trim()
          ? input.eventCreationMaintenanceMessage.trim()
          : current.eventCreationMaintenanceMessage,
      maintenanceTesters: Array.isArray(input.maintenanceTesters)
        ? input.maintenanceTesters
        : current.maintenanceTesters ?? [],
    };

    // 1. Persist to PostgreSQL
    await this.ensureTable();
    try {
      await (this.prisma as any).$executeRawUnsafe(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
        SETTING_DB_KEY,
        JSON.stringify(next),
      );
    } catch (err) {
      this.logger.error('Failed to write system_settings to database: ' + (err instanceof Error ? err.message : String(err)));
      throw err;
    }

    // 2. Propagate to Redis & invalidate local memory
    this.inMemoryCache = { settings: next, expiresAt: Date.now() + 3000 };
    this.testerCache.clear();
    if (this.cache) {
      try {
        await this.cache.set(REDIS_KEY, next, 60);
      } catch (err) {
        this.logger.warn('Failed to update Redis system_controls cache: ' + String(err));
      }
    }

    // 3. Write AuditLog
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'SYSTEM_CONTROLS_UPDATE',
          entity: 'SystemControls',
          entityId: 'system_controls',
          details: {
            previous: current,
            updated: next,
            changedKeys: Object.keys(input),
          },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        },
      });
    } catch (err) {
      this.logger.warn('Failed to write audit log for system controls update: ' + String(err));
    }

    return next;
  }

  /**
   * Evaluates whether a given user is an explicitly authorized maintenance tester.
   * Admins are inherently authorized; non-admins require an explicit association with an active admin.
   */
  async isAuthorizedMaintenanceTester(userId: string): Promise<boolean> {
    if (!userId || typeof userId !== 'string') return false;

    const now = Date.now();
    const cached = this.testerCache.get(userId);
    if (cached && cached.expiresAt > now) {
      return cached.isTester;
    }

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, isActive: true, preferences: true },
      });

      if (!user || !user.isActive) {
        this.testerCache.set(userId, { isTester: false, expiresAt: now + 5000 });
        return false;
      }

      // 1. Any active ADMIN is inherently authorized for maintenance testing
      if (user.role === 'ADMIN') {
        this.testerCache.set(userId, { isTester: true, expiresAt: now + 10000 });
        return true;
      }

      const emailLower = user.email.toLowerCase().trim();

      // 2. Plus-addressing matching against active administrators
      // e.g. tarunkumarsahu2551+eventaitest@gmail.com -> tarunkumarsahu2551@gmail.com
      if (emailLower.includes('+')) {
        const baseEmail = emailLower.replace(/\+[^@]+@/, '@');
        const admin = await this.prisma.user.findFirst({
          where: { email: { equals: baseEmail, mode: 'insensitive' }, role: 'ADMIN', isActive: true },
          select: { id: true },
        });
        if (admin) {
          this.testerCache.set(userId, { isTester: true, expiresAt: now + 10000 });
          return true;
        }
      }

      // 3. User preferences explicit link
      const userPrefs = (user.preferences as Record<string, unknown> | null) ?? {};
      if (userPrefs.linkedAdminId && typeof userPrefs.linkedAdminId === 'string') {
        const linkedAdmin = await this.prisma.user.findFirst({
          where: { id: userPrefs.linkedAdminId, role: 'ADMIN', isActive: true },
          select: { id: true },
        });
        if (linkedAdmin) {
          this.testerCache.set(userId, { isTester: true, expiresAt: now + 10000 });
          return true;
        }
      }

      // 4. System controls maintenanceTesters list
      const settings = await this.getSettings();
      const testers = settings.maintenanceTesters;
      if (Array.isArray(testers)) {
        const match = testers.find((t: any) => {
          if (!t) return false;
          const candidateEmail = String(t.testEmail || t.email || '').toLowerCase().trim();
          const candidateUserId = String(t.testUserId || t.userId || '').trim();
          return (
            (Boolean(candidateEmail) && candidateEmail === emailLower) ||
            (Boolean(candidateUserId) && candidateUserId === userId)
          );
        });
        if (match) {
          // Verify role constraint if specified on tester entry
          const allowed = (match as any).allowedRoles;
          if (Array.isArray(allowed) && allowed.length > 0) {
            if (!allowed.includes(user.role)) {
              this.testerCache.set(userId, { isTester: false, expiresAt: now + 5000 });
              return false;
            }
          }
          const adminIdOrEmail = (match as any).adminId || (match as any).adminEmail || (match as any).linkedBy;
          if (adminIdOrEmail) {
            const admin = await this.prisma.user.findFirst({
              where: {
                OR: [
                  { id: adminIdOrEmail },
                  { email: { equals: adminIdOrEmail, mode: 'insensitive' } },
                ],
                role: 'ADMIN',
                isActive: true,
              },
              select: { id: true },
            });
            if (admin) {
              this.testerCache.set(userId, { isTester: true, expiresAt: now + 10000 });
              return true;
            }
          }
        }
      }

      this.testerCache.set(userId, { isTester: false, expiresAt: now + 5000 });
      return false;
    } catch (err) {
      this.logger.warn(`Failed to verify maintenance tester status for ${userId}: ${String(err)}`);
      return false;
    }
  }

  /**
   * Explicitly associates a test account with an administrator.
   */
  async linkMaintenanceTester(
    callerAdminId: string,
    testEmail: string,
    allowedRoles: ('CUSTOMER' | 'ORGANIZER')[] = ['CUSTOMER', 'ORGANIZER'],
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<MaintenanceTesterEntry> {
    const callerAdmin = await this.prisma.user.findUnique({
      where: { id: callerAdminId },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!callerAdmin || callerAdmin.role !== 'ADMIN' || !callerAdmin.isActive) {
      throw new ForbiddenException('Only active administrators can link maintenance test accounts');
    }

    const normalizedEmail = testEmail.trim().toLowerCase();
    const targetUser = await this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!targetUser || !targetUser.isActive) {
      throw new NotFoundException(
        'Active user account with this email not found. Tester account must be registered first.',
      );
    }
    if (targetUser.role === 'ADMIN') {
      throw new BadRequestException('Target user is already an administrator');
    }

    const current = await this.getSettings();
    const testers = Array.isArray(current.maintenanceTesters) ? [...current.maintenanceTesters] : [];

    const getTesterEmail = (t: any): string =>
      String(t?.testEmail || t?.email || '').trim().toLowerCase();
    const existingIdx = testers.findIndex((t) => getTesterEmail(t) === normalizedEmail);
    const entry: MaintenanceTesterEntry = {
      adminId: callerAdmin.id,
      adminEmail: callerAdmin.email,
      testEmail: normalizedEmail,
      testUserId: targetUser.id,
      allowedRoles,
      createdAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      testers[existingIdx] = entry;
    } else {
      testers.push(entry);
    }

    await this.updateSettings(callerAdminId, { maintenanceTesters: testers }, meta);
    this.testerCache.delete(targetUser.id);

    try {
      await this.prisma.auditLog.create({
        data: {
          userId: callerAdminId,
          action: 'MAINTENANCE_TESTER_LINKED',
          entity: 'User',
          entityId: targetUser.id,
          details: {
            adminEmail: callerAdmin.email,
            testEmail: normalizedEmail,
            allowedRoles,
          },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to create audit log for linking maintenance tester: ${String(err)}`);
    }

    return entry;
  }

  /**
   * Unlinks an associated maintenance tester.
   */
  async unlinkMaintenanceTester(
    callerAdminId: string,
    testEmail: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ success: boolean; message: string }> {
    const callerAdmin = await this.prisma.user.findUnique({
      where: { id: callerAdminId },
      select: { id: true, email: true, role: true, adminRole: true, isActive: true },
    });
    if (!callerAdmin || callerAdmin.role !== 'ADMIN' || !callerAdmin.isActive) {
      throw new ForbiddenException('Only active administrators can manage test accounts');
    }

    const normalizedEmail = testEmail.trim().toLowerCase();
    const current = await this.getSettings();
    const testers = Array.isArray(current.maintenanceTesters) ? [...current.maintenanceTesters] : [];

    const getTesterEmail = (t: any): string =>
      String(t?.testEmail || t?.email || '').trim().toLowerCase();
    const existing = testers.find((t) => getTesterEmail(t) === normalizedEmail);
    if (!existing) {
      throw new NotFoundException('Tester link not found');
    }

    const adminOwnerId = (existing as any).adminId || (existing as any).linkedBy;
    if (callerAdmin.adminRole !== 'OWNER' && adminOwnerId !== callerAdmin.id) {
      throw new ForbiddenException('You can only remove test accounts you linked');
    }

    const updated = testers.filter((t) => getTesterEmail(t) !== normalizedEmail);
    await this.updateSettings(callerAdminId, { maintenanceTesters: updated }, meta);
    const existingUserId = (existing as any).testUserId || (existing as any).userId;
    if (existingUserId) {
      this.testerCache.delete(existingUserId);
    }

    try {
      await this.prisma.auditLog.create({
        data: {
          userId: callerAdminId,
          action: 'MAINTENANCE_TESTER_UNLINKED',
          entity: 'User',
          entityId: existingUserId || normalizedEmail,
          details: {
            adminEmail: callerAdmin.email,
            testEmail: normalizedEmail,
          },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to create audit log for unlinking maintenance tester: ${String(err)}`);
    }

    return { success: true, message: `Test account ${normalizedEmail} unlinked successfully` };
  }

  /**
   * Lists maintenance testers associated with the caller admin (or all if platform owner).
   */
  async listMaintenanceTesters(callerAdminId: string): Promise<MaintenanceTesterEntry[]> {
    const callerAdmin = await this.prisma.user.findUnique({
      where: { id: callerAdminId },
      select: { id: true, email: true, role: true, adminRole: true, isActive: true },
    });
    if (!callerAdmin || callerAdmin.role !== 'ADMIN' || !callerAdmin.isActive) {
      throw new ForbiddenException('Only active administrators can view maintenance test accounts');
    }

    const settings = await this.getSettings();
    const testers = Array.isArray(settings.maintenanceTesters) ? settings.maintenanceTesters : [];

    const normalizeTester = (t: any): MaintenanceTesterEntry => ({
      adminId: t.adminId || t.linkedBy,
      adminEmail: t.adminEmail,
      testEmail: t.testEmail || t.email,
      testUserId: t.testUserId || t.userId,
      allowedRoles: t.allowedRoles,
      createdAt: t.createdAt || t.linkedAt,
    });

    if (callerAdmin.adminRole === 'OWNER') {
      return testers.map(normalizeTester);
    }
    return testers
      .filter((t: any) => (t.adminId || t.linkedBy) === callerAdmin.id || t.adminEmail === callerAdmin.email)
      .map(normalizeTester);
  }

  /**
   * Verifies that the caller admin is authorized to use a linked maintenance testing account
   * and returns the verified target user record for session generation.
   */
  async verifyTesterSessionAcquisition(
    callerAdminId: string,
    targetEmail: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const callerAdmin = await this.prisma.user.findUnique({
      where: { id: callerAdminId },
      select: { id: true, email: true, role: true, adminRole: true, isActive: true },
    });
    if (!callerAdmin || callerAdmin.role !== 'ADMIN' || !callerAdmin.isActive) {
      throw new ForbiddenException('Only active administrators can switch to maintenance test accounts');
    }

    const normalizedEmail = targetEmail.trim().toLowerCase();
    const settings = await this.getSettings();
    const testers = Array.isArray(settings.maintenanceTesters) ? settings.maintenanceTesters : [];

    const getTesterEmail = (t: any): string =>
      String(t?.testEmail || t?.email || '').trim().toLowerCase();
    const match = testers.find((t) => getTesterEmail(t) === normalizedEmail);

    if (!match) {
      throw new NotFoundException(
        `Test account ${normalizedEmail} is not registered as an authorized maintenance tester`,
      );
    }

    const adminOwnerId = (match as any).adminId || (match as any).linkedBy;
    const adminOwnerEmail = (match as any).adminEmail;
    const isOwner = callerAdmin.adminRole === 'OWNER';
    const isDirectLink =
      adminOwnerId === callerAdmin.id ||
      (adminOwnerEmail && adminOwnerEmail.toLowerCase() === callerAdmin.email.toLowerCase());

    if (!isOwner && !isDirectLink) {
      throw new ForbiddenException(
        'You can only access test accounts explicitly linked to your administrator account',
      );
    }

    const targetUser = await this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true, email: true, role: true, isActive: true, isEmailVerified: true },
    });

    if (!targetUser || !targetUser.isActive) {
      throw new NotFoundException('Target test account does not exist or has been deactivated');
    }

    const allowed = (match as any).allowedRoles;
    if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(targetUser.role)) {
      throw new ForbiddenException(
        `Target test account role ${targetUser.role} is not permitted for this tester`,
      );
    }

    try {
      await this.prisma.auditLog.create({
        data: {
          userId: callerAdminId,
          action: 'TESTER_SESSION_ACQUIRED',
          entity: 'User',
          entityId: targetUser.id,
          details: {
            adminEmail: callerAdmin.email,
            targetEmail: targetUser.email,
            targetRole: targetUser.role,
          },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to create audit log for tester session acquisition: ${String(err)}`,
      );
    }

    return targetUser;
  }
}

