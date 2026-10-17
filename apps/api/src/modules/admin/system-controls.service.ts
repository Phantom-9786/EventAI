import { Injectable, Logger } from '../../common/exceptions';
import type { PrismaClient } from '@prisma/client';
import type { CacheService } from '../../common/cache/cache.service';
import type { SystemControls, AdminUpdateSystemControlsInput } from '@eventai/validation';

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
};

const REDIS_KEY = 'eventai:system_controls';
const SETTING_DB_KEY = 'system_controls';

@Injectable()
export class SystemControlsService {
  private readonly logger = new Logger(SystemControlsService.name);
  private tableEnsured = false;
  private inMemoryCache: { settings: SystemControls; expiresAt: number } | null = null;

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
}
