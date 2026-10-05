import type { Request } from 'express';
import type {
  KycRequestMeta,
  KycVerificationSource,
} from './kyc-verification.types.js';

/** Same client-IP resolution as RateLimitGuard (first X-Forwarded-For hop behind the load balancer). */
function clientIp(request: Request): string | null {
  const forwarded = request.headers['x-forwarded-for'];
  const first =
    typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : Array.isArray(forwarded)
        ? forwarded[0]
        : undefined;
  return (first || request.ip || request.socket?.remoteAddress) ?? null;
}

/** Request id (set by pino-http), client IP and user agent for the audit trail. */
export function kycRequestMeta(
  request: Request,
  source?: KycVerificationSource | null,
): KycRequestMeta {
  const id = (request as Request & { id?: unknown }).id;
  const userAgent = request.headers['user-agent'];
  return {
    source: source ?? null,
    requestId: id == null ? null : String(id),
    ipAddress: clientIp(request)?.slice(0, 64) ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
  };
}
