import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

export type UserRateLimitOptions = {
  /** Requests sharing a bucket share one counter per user. */
  bucket: string;
  /** ConfigService key holding the per-window limit. */
  limitConfigKey: string;
  defaultLimit: number;
  windowMs: number;
  message: string;
};

const USER_RATE_LIMIT = 'userRateLimit';

/** Per-authenticated-user limit for expensive or abuse-prone endpoints. */
export const UserRateLimit = (options: UserRateLimitOptions) =>
  SetMetadata(USER_RATE_LIMIT, options);

type HitBucket = { count: number; resetAt: number };

/** Process-wide so refund() works even when Nest constructs a separate guard instance. */
const USER_RATE_LIMIT_HITS = new Map<string, HitBucket>();

/**
 * In-memory counters (per process), same trade-off as RateLimitGuard. Must run
 * after JwtAuthGuard so request.user is populated.
 *
 * Exposes `refund` so handlers that reject before calling the expensive
 * provider (e.g. 409 VERIFYING-in-progress) do not burn the user's budget.
 */
@Injectable()
export class UserRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.get<UserRateLimitOptions | undefined>(
      USER_RATE_LIMIT,
      context.getHandler(),
    );
    if (!options) return true;

    const request = context
      .switchToHttp()
      .getRequest<
        Request & {
          user?: { id?: string };
          userRateLimitKey?: string;
        }
      >();
    const userId = request.user?.id;
    if (!userId) return true;

    const limit =
      this.config.get<number>(options.limitConfigKey) ?? options.defaultLimit;
    const key = `${options.bucket}:${userId}`;
    request.userRateLimitKey = key;
    const now = Date.now();
    const existing = USER_RATE_LIMIT_HITS.get(key);

    if (!existing || existing.resetAt <= now) {
      USER_RATE_LIMIT_HITS.set(key, { count: 1, resetAt: now + options.windowMs });
      this.prune(now);
      return true;
    }

    if (existing.count >= limit) {
      const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
      context
        .switchToHttp()
        .getResponse<{ setHeader?: (name: string, value: string) => void }>()
        .setHeader?.('Retry-After', String(retryAfterSeconds));
      throw new HttpException(
        {
          success: false,
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: options.message,
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    existing.count += 1;
    return true;
  }

  /** Undo the most recent hit for a key (e.g. after a 409 conflict). */
  refund(key: string | undefined | null): void {
    if (!key) return;
    const bucket = USER_RATE_LIMIT_HITS.get(key);
    if (!bucket) return;
    bucket.count = Math.max(0, bucket.count - 1);
    if (bucket.count === 0) USER_RATE_LIMIT_HITS.delete(key);
  }

  private prune(now: number) {
    if (USER_RATE_LIMIT_HITS.size < 10_000) return;
    for (const [key, bucket] of USER_RATE_LIMIT_HITS) {
      if (bucket.resetAt <= now) USER_RATE_LIMIT_HITS.delete(key);
    }
  }
}
