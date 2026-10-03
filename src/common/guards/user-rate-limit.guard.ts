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

/**
 * In-memory, per-instance counters, same trade-off as RateLimitGuard. Must run
 * after JwtAuthGuard so request.user is populated.
 */
@Injectable()
export class UserRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, HitBucket>();

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
      .getRequest<Request & { user?: { id?: string } }>();
    const userId = request.user?.id;
    if (!userId) return true;

    const limit =
      this.config.get<number>(options.limitConfigKey) ?? options.defaultLimit;
    const key = `${options.bucket}:${userId}`;
    const now = Date.now();
    const existing = this.hits.get(key);

    if (!existing || existing.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + options.windowMs });
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

  private prune(now: number) {
    if (this.hits.size < 10_000) return;
    for (const [key, bucket] of this.hits) {
      if (bucket.resetAt <= now) this.hits.delete(key);
    }
  }
}
