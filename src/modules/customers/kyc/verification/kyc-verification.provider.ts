import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KycProviderConfig } from '../../../../config/configuration.js';

export type KycVerificationKind = 'PAN' | 'GST';

/** Normalized result fields. Only these are persisted and shown to users. */
export type KycVerificationDetails = {
  legalName?: string | null;
  tradeName?: string | null;
  gstStatus?: string | null;
  registrationDate?: string | null;
  taxpayerType?: string | null;
  constitution?: string | null;
  address?: string | null;
  state?: string | null;
  pincode?: string | null;
  nameOnPan?: string | null;
  panStatus?: string | null;
  panCategory?: string | null;
};

export type KycProviderOutcome =
  | { outcome: 'VERIFIED'; details: KycVerificationDetails }
  | {
      outcome: 'FAILED';
      code: string;
      reason: string;
      details?: KycVerificationDetails;
    }
  | { outcome: 'UNAVAILABLE'; code: string; reason: string }
  | { outcome: 'NOT_CONFIGURED' };

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

/** Vendors wrap the record in data / result / response (sometimes twice). */
function unwrap(body: unknown): Json {
  let current = obj(body);
  for (let depth = 0; depth < 3; depth++) {
    const next = obj(current.data ?? current.result ?? current.response);
    if (!Object.keys(next).length) break;
    current = next;
  }
  return current;
}

function explicitFailure(body: unknown): boolean {
  const root = obj(body);
  const inner = unwrap(body);
  return [root.success, root.valid, inner.valid, inner.success].some(
    (flag) => flag === false,
  );
}

function formatGstAddress(record: Json): {
  address: string | null;
  state: string | null;
  pincode: string | null;
} {
  const pradr = obj(record.pradr ?? record.principal_place_of_business);
  if (typeof pradr.adr === 'string') {
    return {
      address: pradr.adr.trim() || null,
      state: text(obj(pradr.addr).stcd, record.state),
      pincode: text(obj(pradr.addr).pncd, record.pincode),
    };
  }
  const addr = obj(pradr.addr ?? pradr.address);
  const parts = [
    addr.bno,
    addr.flno,
    addr.bnm,
    addr.st,
    addr.loc,
    addr.city,
    addr.dst,
  ]
    .map((part) => text(part))
    .filter((part): part is string => Boolean(part));
  const state = text(addr.stcd, record.state, record.state_jurisdiction);
  const pincode = text(addr.pncd, record.pincode);
  const joined = [...parts, state, pincode].filter(Boolean).join(', ');
  return {
    address:
      joined ||
      text(
        record.address,
        record.principal_place_address,
        record.registered_address,
      ),
    state,
    pincode,
  };
}

export function normalizeGstResponse(body: unknown): KycVerificationDetails {
  const record = unwrap(body);
  return {
    legalName: text(
      record.lgnm,
      record.legal_name,
      record.legalName,
      record.legal_name_of_business,
      record.business_name,
    ),
    tradeName: text(record.tradeNam, record.trade_name, record.tradeName),
    gstStatus: text(
      record.sts,
      record.gstin_status,
      record.gstStatus,
      record.status,
    ),
    registrationDate: text(
      record.rgdt,
      record.date_of_registration,
      record.registrationDate,
      record.registration_date,
    ),
    taxpayerType: text(record.dty, record.taxpayer_type, record.taxpayerType),
    constitution: text(
      record.ctb,
      record.constitution_of_business,
      record.constitution,
    ),
    ...formatGstAddress(record),
  };
}

export function normalizePanResponse(body: unknown): KycVerificationDetails {
  const record = unwrap(body);
  return {
    nameOnPan: text(
      record.full_name,
      record.registered_name,
      record.name_on_pan,
      record.nameOnPan,
      record.name,
    ),
    panStatus: text(record.pan_status, record.panStatus, record.status),
    panCategory: text(record.category, record.pan_type, record.type),
  };
}

const INACTIVE_PAN =
  /invalid|deleted|fake|deactivated|not\s*found|inoperative/i;

/** Interprets a 2xx provider body. */
export function classifyGst(body: unknown): KycProviderOutcome {
  const details = normalizeGstResponse(body);
  if (explicitFailure(body) || !details.legalName) {
    return {
      outcome: 'FAILED',
      code: 'GSTIN_NOT_FOUND',
      reason: 'No GST registration was found for this GSTIN.',
    };
  }
  if (details.gstStatus && !/^active/i.test(details.gstStatus)) {
    return {
      outcome: 'FAILED',
      code: 'GSTIN_INACTIVE',
      reason: `GST registration status is "${details.gstStatus}". Only active GSTINs can be used.`,
      details,
    };
  }
  return { outcome: 'VERIFIED', details };
}

export function classifyPan(body: unknown): KycProviderOutcome {
  const details = normalizePanResponse(body);
  if (explicitFailure(body)) {
    return {
      outcome: 'FAILED',
      code: 'PAN_NOT_FOUND',
      reason: 'This PAN could not be found in Income Tax records.',
    };
  }
  if (details.panStatus && INACTIVE_PAN.test(details.panStatus)) {
    return {
      outcome: 'FAILED',
      code: 'PAN_INACTIVE',
      reason: `PAN status is "${details.panStatus}". Use an active PAN.`,
      details,
    };
  }
  return { outcome: 'VERIFIED', details };
}

/**
 * Generic HTTP adapter for PAN / GSTIN verification vendors. Credentials stay
 * server-side; the browser and mobile app only ever talk to PetroTrade.
 */
@Injectable()
export class KycVerificationProvider {
  private readonly logger = new Logger(KycVerificationProvider.name);

  constructor(private readonly config: ConfigService) {}

  private settings(kind: KycVerificationKind): KycProviderConfig {
    const key = kind === 'PAN' ? 'kyc.pan' : 'kyc.gst';
    return (
      this.config.get<KycProviderConfig>(key) ?? {
        name: 'http',
        url: '',
        apiKey: '',
        clientId: '',
      }
    );
  }

  isConfigured(kind: KycVerificationKind): boolean {
    return Boolean(this.settings(kind).url);
  }

  providerName(kind: KycVerificationKind): string {
    return this.isConfigured(kind) ? this.settings(kind).name : 'manual';
  }

  async verify(
    kind: KycVerificationKind,
    identifier: string,
  ): Promise<KycProviderOutcome> {
    const settings = this.settings(kind);
    if (!settings.url) return { outcome: 'NOT_CONFIGURED' };

    const timeoutMs = this.config.get<number>('kyc.requestTimeoutMs') ?? 10_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(settings.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(settings.apiKey ? { 'x-api-key': settings.apiKey } : {}),
          ...(settings.clientId ? { 'x-client-id': settings.clientId } : {}),
        },
        body: JSON.stringify(
          kind === 'PAN' ? { pan: identifier } : { gstin: identifier },
        ),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = controller.signal.aborted;
      this.logger.warn(
        `${kind} verification ${timedOut ? 'timed out' : 'request failed'}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        outcome: 'UNAVAILABLE',
        code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNREACHABLE',
        reason: 'The verification service did not respond.',
      };
    } finally {
      clearTimeout(timer);
    }

    const body: unknown = await response.json().catch(() => null);

    if (response.status === 404 || response.status === 422) {
      return kind === 'PAN'
        ? {
            outcome: 'FAILED',
            code: 'PAN_NOT_FOUND',
            reason: 'This PAN could not be found in Income Tax records.',
          }
        : {
            outcome: 'FAILED',
            code: 'GSTIN_NOT_FOUND',
            reason: 'No GST registration was found for this GSTIN.',
          };
    }
    if (response.status === 400) {
      return {
        outcome: 'FAILED',
        code: kind === 'PAN' ? 'PAN_INVALID' : 'GSTIN_INVALID',
        reason:
          kind === 'PAN'
            ? 'The verification service rejected this PAN as invalid.'
            : 'The verification service rejected this GSTIN as invalid.',
      };
    }
    if (!response.ok || body === null) {
      // Never log the response body: it can contain the identifier holder's details.
      this.logger.warn(
        `${kind} verification provider returned HTTP ${response.status}`,
      );
      return {
        outcome: 'UNAVAILABLE',
        code: `PROVIDER_HTTP_${response.status}`,
        reason: 'The verification service is temporarily unavailable.',
      };
    }

    return kind === 'PAN' ? classifyPan(body) : classifyGst(body);
  }
}
