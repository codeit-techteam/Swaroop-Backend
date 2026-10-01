import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EntityOwnerType,
  ImportListingStatus,
  ImportNegotiationStatus,
  ImportSide,
} from '../../generated/prisma/client.js';
import type { AppConfig } from '../../config/configuration.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  ImportLifecycleService,
  SYSTEM_ACTOR,
} from './common/import-lifecycle.service.js';
import { ImportNotifierService } from './common/import-notifier.service.js';
import { ImportSettingsService } from './common/import-settings.service.js';
import {
  IMPORT_NOTIFICATION_EVENTS,
  OPEN_LISTING_STATUSES,
} from './domain/import.constants.js';

const BATCH = 200;
const EXPIRABLE: ImportListingStatus[] = [
  ...OPEN_LISTING_STATUSES,
  ImportListingStatus.PAUSED,
];

/**
 * Server-clock expiry for Import listings and negotiations, plus one-time
 * near-expiry reminders. Safe with several app instances: every transition is
 * claimed under a row lock / conditional update, so work is never doubled.
 */
@Injectable()
export class ImportExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportExpiryWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: ImportLifecycleService,
    private readonly notifier: ImportNotifierService,
    private readonly settings: ImportSettingsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const env = this.config.get<AppConfig['app']>('app')?.env;
    if (env === 'test') return;
    if (this.config.get<boolean>('import.enabled') === false) {
      this.logger.log('ImportExpiryWorker idle (IMPORT_FEATURE_ENABLED=false)');
      return;
    }
    const interval = Math.max(
      5_000,
      this.config.get<number>('import.sweepIntervalMs') ?? 60_000,
    );
    void this.safeSweep();
    this.timer = setInterval(() => void this.safeSweep(), interval);
    this.timer.unref?.();
    this.logger.log(`ImportExpiryWorker started (interval=${interval}ms)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async safeSweep() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.sweep();
      if (
        result.expiredListings ||
        result.expiredNegotiations ||
        result.nearExpiryNotices
      ) {
        this.logger.debug(`Import sweep ${JSON.stringify(result)}`);
      }
    } catch (error) {
      this.logger.error(
        'Import sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }

  async sweep(now = new Date()) {
    let expiredListings = 0;
    let expiredNegotiations = 0;
    let nearExpiryNotices = 0;

    const overdue = await this.prisma.importListing.findMany({
      where: {
        status: { in: EXPIRABLE },
        deletedAt: null,
        validUntil: { lte: now },
      },
      select: { id: true },
      take: BATCH,
    });
    for (const { id } of overdue) {
      if (
        await this.lifecycle.endListing(id, 'EXPIRED', SYSTEM_ACTOR, {
          validateTransition: false,
        })
      ) {
        expiredListings += 1;
      }
    }

    const lapsed = await this.prisma.importNegotiation.findMany({
      where: { status: ImportNegotiationStatus.OPEN, expiresAt: { lte: now } },
      select: { id: true },
      take: BATCH,
    });
    for (const { id } of lapsed) {
      if (await this.lifecycle.expireNegotiation(id)) expiredNegotiations += 1;
    }

    const { nearExpiryHours } = await this.settings.get();
    if (nearExpiryHours > 0) {
      const soon = new Date(now.getTime() + nearExpiryHours * 3600_000);
      const expiring = await this.prisma.importListing.findMany({
        where: {
          status: { in: OPEN_LISTING_STATUSES },
          deletedAt: null,
          nearExpiryNotifiedAt: null,
          validUntil: { gt: now, lte: soon },
        },
        select: {
          id: true,
          side: true,
          ownerOrgId: true,
          referenceNumber: true,
          validUntil: true,
        },
        take: BATCH,
      });
      for (const l of expiring) {
        const claimed = await this.prisma.importListing.updateMany({
          where: { id: l.id, nearExpiryNotifiedAt: null },
          data: { nearExpiryNotifiedAt: now },
        });
        if (claimed.count === 0) continue;
        const label = l.side === ImportSide.BUY ? 'RFQ' : 'offer';
        await this.notifier.notify({
          organizationId: l.ownerOrgId,
          event: IMPORT_NOTIFICATION_EVENTS.NEAR_EXPIRY,
          title: `Import ${label} expiring soon`,
          body: `Your ${label} ${l.referenceNumber} expires at ${l.validUntil!.toISOString()} (server time). Extend validity to keep it live.`,
          entityType: EntityOwnerType.IMPORT_LISTING,
          entityId: l.id,
          metadata: {
            listingId: l.id,
            referenceNumber: l.referenceNumber,
            side: l.side,
            validUntil: l.validUntil,
          },
        });
        nearExpiryNotices += 1;
      }
    }

    return { expiredListings, expiredNegotiations, nearExpiryNotices };
  }
}
