import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

type HitBucket = {
  count: number;
  resetAt: number;
};

/**
 * Lightweight in-memory rate-limit foundation.
 * Replaces @nestjs/throttler until it officially supports NestJS 12 peer deps.
 * Can later be swapped for Redis-backed limiting without changing controllers.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, HitBucket>();

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const ttlMs =
      this.configService.get<number>('security.throttleTtlMs') ?? 60_000;
    const limit =
      this.configService.get<number>('security.throttleLimit') ?? 100;

    const request = context.switchToHttp().getRequest<Request>();
    const key = this.resolveKey(request);
    const now = Date.now();
    const existing = this.hits.get(key);

    if (!existing || existing.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + ttlMs });
      return true;
    }

    if (existing.count >= limit) {
      throw new HttpException(
        {
          success: false,
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests',
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    existing.count += 1;
    this.hits.set(key, existing);
    return true;
  }

  private resolveKey(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'];
    const forwardedIp =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : Array.isArray(forwarded)
          ? forwarded[0]
          : undefined;

    return (
      forwardedIp || request.ip || request.socket.remoteAddress || 'unknown'
    );
  }
}
