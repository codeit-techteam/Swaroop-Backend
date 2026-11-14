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
 *
 * Catalogue browsing and auth/OTP use separate IP buckets so marketplace traffic
 * cannot starve OTP, and OTP abuse cannot wipe catalogue budget.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, HitBucket>();

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const ttlMs =
      this.configService.get<number>('security.throttleTtlMs') ?? 60_000;
    const request = context.switchToHttp().getRequest<Request>();
    const limit = this.resolveLimit(request);
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

  private resolveLimit(request: Request): number {
    const defaultLimit =
      this.configService.get<number>('security.throttleLimit') ?? 300;
    const marketplaceLimit =
      this.configService.get<number>('security.throttleMarketplaceLimit') ??
      Math.max(defaultLimit * 2, 600);
    const path = (
      request.originalUrl ||
      request.url ||
      request.path ||
      ''
    ).toLowerCase();
    const method = (request.method || 'GET').toUpperCase();

    if (
      path.includes('/auth/') ||
      path.includes('/otp') ||
      path.includes('/login')
    ) {
      // Dedicated OTP limiters still apply; keep global auth bucket tight.
      return Math.min(defaultLimit, 60);
    }

    if (
      method === 'GET' &&
      (path.includes('/public/marketplace') ||
        path.includes('/customer/marketplace') ||
        path.includes('/public/offers') ||
        path.includes('/customer/offers') ||
        path.includes('/grades'))
    ) {
      return marketplaceLimit;
    }

    return defaultLimit;
  }

  private resolveKey(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'];
    const forwardedIp =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : Array.isArray(forwarded)
          ? forwarded[0]
          : undefined;

    const ip =
      forwardedIp || request.ip || request.socket.remoteAddress || 'unknown';
    const path = (request.originalUrl || request.url || '').toLowerCase();
    const bucket =
      path.includes('/auth/') || path.includes('/otp')
        ? 'auth'
        : path.includes('/marketplace') || path.includes('/grades')
          ? 'catalogue'
          : 'general';
    return `${bucket}:${ip}`;
  }
}
