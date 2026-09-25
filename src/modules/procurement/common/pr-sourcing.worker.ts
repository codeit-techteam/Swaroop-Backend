import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../config/configuration.js';
import { PrSellerDispatchService } from './pr-seller-dispatch.service.js';
import { PrSourcingLifecycleService } from './pr-sourcing-lifecycle.service.js';

/** Default sweep cadence for the 15-minute seller finding + response SLA. */
const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

/**
 * Background worker that:
 * 1) matches open purchase requests to the seller offering that grade/product
 * 2) enforces the 15-minute seller response window (warn + expire)
 *
 * Runs independently of customers/sellers hitting read endpoints.
 */
@Injectable()
export class PrSourcingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrSourcingWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly lifecycle: PrSourcingLifecycleService,
    private readonly sellerDispatch: PrSellerDispatchService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const env = this.config.get<AppConfig['app']>('app')?.env;
    if (env === 'test') {
      this.logger.debug('PrSourcingWorker disabled in test env');
      return;
    }

    const intervalMs = Number(
      process.env.PR_SOURCING_SWEEP_INTERVAL_MS ?? DEFAULT_SWEEP_INTERVAL_MS,
    );
    const safeInterval =
      Number.isFinite(intervalMs) && intervalMs >= 5_000
        ? intervalMs
        : DEFAULT_SWEEP_INTERVAL_MS;

    // Kick once shortly after boot so overdue PRs do not wait a full interval.
    void this.safeSweep();
    this.timer = setInterval(() => {
      void this.safeSweep();
    }, safeInterval);
    this.timer.unref?.();
    this.logger.log(
      `PrSourcingWorker started (interval=${safeInterval}ms)`,
    );
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async safeSweep() {
    if (this.running) return;
    this.running = true;
    try {
      const dispatch = await this.sellerDispatch.dispatchPending();
      const sweep = await this.lifecycle.sweep();
      if (
        dispatch.assigned > 0 ||
        dispatch.repairedNotifications > 0 ||
        sweep.expiredPurchaseRequests > 0 ||
        sweep.expiredCounterOffers > 0 ||
        sweep.warnedPurchaseRequests > 0
      ) {
        this.logger.debug(
          `PR sourcing tick: assigned=${dispatch.assigned} repaired=${dispatch.repairedNotifications} expiredPRs=${sweep.expiredPurchaseRequests} warnings=${sweep.warnedPurchaseRequests}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Sourcing sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
