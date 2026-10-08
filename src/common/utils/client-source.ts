import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreditApplicationSource } from '../../generated/prisma/client.js';
import type { AppConfig } from '../../config/configuration.js';

/** Header native apps may send to identify themselves (no Origin is sent). */
export const CLIENT_PLATFORM_HEADER = 'x-swaroop-client';

export type ClientOriginConfig = AppConfig['clientOrigins'];

export type ClientRequestInfo = {
  origin?: string | string[] | undefined;
  clientHeader?: string | string[] | undefined;
};

export type ResolvedClientSource = {
  source: CreditApplicationSource;
  /** Normalized origin the decision was based on, when the caller was a browser. */
  origin: string | null;
  /** True when a browser origin matched no first-party allowlist. */
  unrecognizedOrigin: boolean;
};

const NATIVE_CLIENTS: Record<string, CreditApplicationSource> = {
  CUSTOMER_APP: CreditApplicationSource.CUSTOMER_APP,
  SELLER_APP: CreditApplicationSource.SELLER_APP,
};

const firstValue = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? '';

export function normalizeOrigin(raw: string): string | null {
  if (!raw || raw === 'null') return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Matches an origin against an allowlist entry. A `*` stands for exactly one
 * run of `[a-z0-9-]` characters, so it can never span a `.` and a pattern
 * like `https://app-*.vercel.app` cannot match `https://app-x.evil.vercel.app`.
 */
export function originMatches(origin: string, pattern: string): boolean {
  const normalizedPattern = pattern.trim().toLowerCase().replace(/\/+$/, '');
  if (!normalizedPattern) return false;
  if (!normalizedPattern.includes('*')) return origin === normalizedPattern;
  const escaped = normalizedPattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[a-z0-9-]+');
  return new RegExp(`^${escaped}$`).test(origin);
}

/**
 * Determines which client channel a request came from. Browsers always send an
 * `Origin` header on cross-origin API calls and page scripts cannot override
 * it, so web channels are attributed from the origin allowlists. Requests
 * without an origin are native apps; they may identify as the seller app via
 * {@link CLIENT_PLATFORM_HEADER}, otherwise they count as the customer app.
 *
 * The result is attribution for reporting, not an authorization decision.
 */
export function resolveClientSource(
  request: ClientRequestInfo,
  config: ClientOriginConfig,
): ResolvedClientSource {
  const origin = normalizeOrigin(firstValue(request.origin));
  if (origin) {
    const ordered: Array<[CreditApplicationSource, string[]]> = [
      [CreditApplicationSource.WEBSITE, config.website],
      [CreditApplicationSource.CUSTOMER_WEB, config.customerWeb],
      [CreditApplicationSource.SELLER_WEB, config.sellerWeb],
      [CreditApplicationSource.ADMIN, config.adminWeb],
    ];
    for (const [source, patterns] of ordered) {
      if (patterns.some((pattern) => originMatches(origin, pattern))) {
        return { source, origin, unrecognizedOrigin: false };
      }
    }
    return {
      source: CreditApplicationSource.CUSTOMER_WEB,
      origin,
      unrecognizedOrigin: true,
    };
  }

  const hint = firstValue(request.clientHeader).toUpperCase();
  return {
    source: NATIVE_CLIENTS[hint] ?? CreditApplicationSource.CUSTOMER_APP,
    origin: null,
    unrecognizedOrigin: false,
  };
}

@Injectable()
export class ClientSourceResolver {
  constructor(private readonly config: ConfigService) {}

  resolve(headers: Record<string, string | string[] | undefined>) {
    const origins = this.config.get<ClientOriginConfig>('clientOrigins') ?? {
      website: [],
      customerWeb: [],
      sellerWeb: [],
      adminWeb: [],
    };
    return resolveClientSource(
      {
        origin: headers.origin,
        clientHeader: headers[CLIENT_PLATFORM_HEADER],
      },
      origins,
    );
  }
}
