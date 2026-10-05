import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SurepassConfig } from '../../config/configuration.js';
import {
  maskPan,
  normalizeIdentifier,
  PAN_PATTERN,
} from './kyc-identifiers.js';
import type {
  KycProviderOutcome,
  KycVerificationDetails,
  KycVerificationKind,
} from './kyc-verification.types.js';

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

/** Surepass envelope: `{ data, status_code, success, message, message_code }`. */
type SurepassEnvelope = {
  data: Json;
  success: boolean | null;
  messageCode: string | null;
  clientId: string | null;
};

export function readSurepassEnvelope(body: unknown): SurepassEnvelope {
  const root = obj(body);
  const data = obj(root.data);
  return {
    data,
    success: typeof root.success === 'boolean' ? root.success : null,
    messageCode: text(root.message_code),
    clientId: text(data.client_id),
  };
}

/** "State - West Bengal,Zone - Kolkata,..." → "West Bengal". */
function stateFromJurisdiction(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const match = /state\s*-\s*([^,]+)/i.exec(raw);
  return match ? match[1].trim() : null;
}

function gstAddress(data: Json): {
  address: string | null;
  state: string | null;
  pincode: string | null;
} {
  const details = obj(data.address_details ?? data.principal_address);
  const principal = obj(details.principal ?? details);
  const structured = obj(principal.address ?? data.address);
  const structuredText = [
    structured.building_name,
    structured.building_number,
    structured.floor,
    structured.street,
    structured.location,
    structured.city,
    structured.district,
  ]
    .map((part) => text(part))
    .filter((part): part is string => Boolean(part))
    .join(', ');
  const address =
    text(data.address, principal.address) ?? (structuredText || null);
  return {
    address,
    state: text(
      structured.state,
      data.state,
      stateFromJurisdiction(data.state_jurisdiction),
    ),
    pincode: text(structured.pincode, structured.pin_code, data.pincode),
  };
}

export function normalizeSurepassGst(
  body: unknown,
  gstin: string,
): { details: KycVerificationDetails; linkedPan: string | null } {
  const { data } = readSurepassEnvelope(body);
  const providerPan = text(data.pan_number);
  const linkedPan =
    providerPan && PAN_PATTERN.test(normalizeIdentifier(providerPan))
      ? normalizeIdentifier(providerPan)
      : null;
  return {
    linkedPan,
    details: {
      legalName: text(data.legal_name),
      tradeName: text(data.business_name, data.trade_name),
      gstStatus: text(data.gstin_status),
      registrationDate: text(data.date_of_registration),
      cancellationDate: text(data.date_of_cancellation),
      taxpayerType: text(data.taxpayer_type),
      constitution: text(data.constitution_of_business),
      ...gstAddress(data),
      // The first two GSTIN digits are the GST state code by definition.
      stateCode: gstin.slice(0, 2),
      panMasked: linkedPan ? maskPan(linkedPan) : null,
    },
  };
}

export function normalizeSurepassPan(body: unknown): KycVerificationDetails {
  const { data } = readSurepassEnvelope(body);
  const split = obj(data.full_name_split);
  const splitName = [split.first_name, split.middle_name, split.last_name]
    .map((part) => text(part))
    .filter(Boolean)
    .join(' ');
  return {
    nameOnPan:
      text(data.full_name, data.registered_name) ?? (splitName || null),
    panStatus: text(data.status, data.pan_status),
    panCategory: text(data.category),
  };
}

const INACTIVE_PAN =
  /invalid|deleted|fake|deactivated|not\s*found|inoperative/i;

export function classifySurepassPan(
  status: number,
  body: unknown,
): KycProviderOutcome {
  const envelope = readSurepassEnvelope(body);
  if (status === 422 || envelope.success === false) {
    return {
      outcome: 'FAILED',
      code: 'PAN_NOT_FOUND',
      reason: 'This PAN could not be found in Income Tax records.',
      referenceId: envelope.clientId,
    };
  }
  const details = normalizeSurepassPan(body);
  if (details.panStatus && INACTIVE_PAN.test(details.panStatus)) {
    return {
      outcome: 'FAILED',
      code: 'PAN_INACTIVE',
      reason: `PAN status is "${details.panStatus}". Use an active PAN.`,
      details,
      referenceId: envelope.clientId,
    };
  }
  if (!details.nameOnPan) {
    return {
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_MALFORMED_RESPONSE',
      reason: 'The verification service returned an incomplete response.',
    };
  }
  return {
    outcome: 'VERIFIED',
    details,
    referenceId: envelope.clientId,
    linkedPan: null,
  };
}

export function classifySurepassGst(
  status: number,
  body: unknown,
  gstin: string,
): KycProviderOutcome {
  const envelope = readSurepassEnvelope(body);
  if (status === 422 || envelope.success === false) {
    return {
      outcome: 'FAILED',
      code: 'GSTIN_NOT_FOUND',
      reason: 'No GST registration was found for this GSTIN.',
      referenceId: envelope.clientId,
    };
  }
  const { details, linkedPan } = normalizeSurepassGst(body, gstin);
  if (!details.legalName && !details.tradeName) {
    return {
      outcome: 'UNAVAILABLE',
      code: 'PROVIDER_MALFORMED_RESPONSE',
      reason: 'The verification service returned an incomplete response.',
    };
  }
  if (details.gstStatus && !/^active/i.test(details.gstStatus)) {
    return {
      outcome: 'FAILED',
      code: 'GSTIN_INACTIVE',
      reason: `GST registration status is "${details.gstStatus}". Only active GSTINs can be used.`,
      details,
      referenceId: envelope.clientId,
    };
  }
  return {
    outcome: 'VERIFIED',
    details,
    referenceId: envelope.clientId,
    linkedPan,
  };
}

/** Gateway / overload responses that are safe to retry once (verification is read-only). */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAY_MS = 400;

/**
 * Surepass KYC API adapter. The bearer token never leaves this class: it is not
 * logged, persisted, or returned to clients.
 */
@Injectable()
export class SurepassVerificationProvider {
  private readonly logger = new Logger(SurepassVerificationProvider.name);

  constructor(private readonly config: ConfigService) {}

  private settings(): SurepassConfig | null {
    const settings = this.config.get<SurepassConfig>('kyc.surepass');
    return settings?.baseUrl && settings.token ? settings : null;
  }

  isConfigured(): boolean {
    return this.settings() !== null;
  }

  async verify(
    kind: KycVerificationKind,
    identifier: string,
  ): Promise<KycProviderOutcome> {
    const settings = this.settings();
    if (!settings) return { outcome: 'NOT_CONFIGURED' };

    const path = kind === 'PAN' ? settings.panPath : settings.gstPath;
    const url = `${settings.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const timeoutMs = this.config.get<number>('kyc.requestTimeoutMs') ?? 10_000;

    let result = await this.post(url, settings.token, identifier, timeoutMs);
    if (
      result.kind === 'network' ||
      (result.kind === 'response' && RETRYABLE_STATUSES.has(result.status))
    ) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      result = await this.post(url, settings.token, identifier, timeoutMs);
    }

    if (result.kind !== 'response') {
      this.logger.warn(
        `Surepass ${kind} verification ${result.kind === 'timeout' ? 'timed out' : 'request failed'}: ${result.message}`,
      );
      return {
        outcome: 'UNAVAILABLE',
        code:
          result.kind === 'timeout'
            ? 'PROVIDER_TIMEOUT'
            : 'PROVIDER_UNREACHABLE',
        reason: 'The verification service did not respond.',
      };
    }

    const { status, body } = result;
    if (status === 401 || status === 403) {
      this.logger.error(
        `Surepass rejected the API token (HTTP ${status}). Check SUREPASS_API_TOKEN and SUREPASS_ENVIRONMENT.`,
      );
      return {
        outcome: 'UNAVAILABLE',
        code: 'PROVIDER_AUTH_FAILED',
        reason: 'The verification service is temporarily unavailable.',
      };
    }
    if (status === 429) {
      this.logger.warn(`Surepass ${kind} verification rate limited`);
      return {
        outcome: 'UNAVAILABLE',
        code: 'PROVIDER_RATE_LIMITED',
        reason: 'The verification service is busy. Please try again shortly.',
      };
    }
    if (status === 400) {
      return {
        outcome: 'FAILED',
        code: kind === 'PAN' ? 'PAN_INVALID' : 'GSTIN_INVALID',
        reason:
          kind === 'PAN'
            ? 'The verification service rejected this PAN as invalid.'
            : 'The verification service rejected this GSTIN as invalid.',
      };
    }
    const decisive =
      status === 422 ||
      (status === 404 && readSurepassEnvelope(body).success === false);
    if (!decisive && (status < 200 || status >= 300 || body === null)) {
      // Never log the response body: it can contain the holder's personal details.
      this.logger.warn(`Surepass ${kind} verification returned HTTP ${status}`);
      return {
        outcome: 'UNAVAILABLE',
        code:
          body === null
            ? 'PROVIDER_MALFORMED_RESPONSE'
            : `PROVIDER_HTTP_${status}`,
        reason: 'The verification service is temporarily unavailable.',
      };
    }

    return kind === 'PAN'
      ? classifySurepassPan(status, body)
      : classifySurepassGst(status, body, identifier);
  }

  private async post(
    url: string,
    token: string,
    identifier: string,
    timeoutMs: number,
  ): Promise<
    | { kind: 'response'; status: number; body: unknown }
    | { kind: 'timeout' | 'network'; message: string }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id_number: identifier }),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      return { kind: 'response', status: response.status, body };
    } catch (error) {
      return {
        kind: controller.signal.aborted ? 'timeout' : 'network',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
