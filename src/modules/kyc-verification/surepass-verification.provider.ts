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
  PanHolderInput,
} from './kyc-verification.types.js';

/*
 * Contract source: Surepass KYC API docs (app.surepass.app/docs/kyc).
 *   PAN Verify       POST /api/v1/pan/pan-verify     { id_number, full_name, dob }
 *   PAN Lite         POST /api/v1/pan/pan            { id_number }
 *   Corporate GSTIN  POST /api/v1/corporate/gstin    { id_number }
 * Auth: `Authorization: Bearer <token>`, JSON body. Every response uses the
 * envelope `{ data, status_code, success, message, message_code }`.
 * PAN Advanced (/api/v1/pan/pan-adv) adds pan_status codes, which are honoured
 * when SUREPASS_PAN_PATH points at it.
 */

/** PAN Verify matches the PAN against the holder's name and date of birth. */
export function isPanVerifyPath(path: string): boolean {
  return /\/pan-verify\/?$/.test(path);
}

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

/** `state_jurisdiction` is documented as "State - Rajasthan,Zone - ...". */
function stateFromJurisdiction(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const match = /state\s*-\s*([^,]+)/i.exec(raw);
  return match ? match[1].trim() : null;
}

function pincodeFromAddress(address: string | null): string | null {
  const matches = address?.match(/\b\d{6}\b/g);
  return matches ? matches[matches.length - 1] : null;
}

/** Surepass returns 1800-01-01 for GSTINs that were never cancelled. */
function cancellationDate(value: unknown): string | null {
  const raw = text(value);
  return raw && !raw.startsWith('1800-') ? raw : null;
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
  const address = text(data.address);
  return {
    linkedPan,
    details: {
      legalName: text(data.legal_name),
      tradeName: text(data.business_name),
      gstStatus: text(data.gstin_status),
      registrationDate: text(data.date_of_registration),
      cancellationDate: cancellationDate(data.date_of_cancellation),
      taxpayerType: text(data.taxpayer_type),
      constitution: text(data.constitution_of_business),
      address,
      state: stateFromJurisdiction(data.state_jurisdiction),
      pincode: pincodeFromAddress(address),
      // The first two GSTIN digits are the GST state code by definition.
      stateCode: gstin.slice(0, 2),
      panMasked: linkedPan ? maskPan(linkedPan) : null,
    },
  };
}

/** PAN Advanced `pan_status` codes, as documented by Surepass. */
const PAN_STATUS_MEANING: Record<string, string> = {
  E: 'Existing and valid',
  F: 'Fake',
  X: 'Deactivated',
  D: 'Deleted',
  N: 'Invalid',
  I: 'Inoperative',
  EA: 'Amalgamation',
  EC: 'Acquisition',
  ED: 'Death',
  EI: 'Dissolution',
  EL: 'Liquidated',
  EM: 'Merger',
  EP: 'Partition',
  ES: 'Split',
  EU: 'Under liquidation',
};
const REJECTED_PAN_STATUS = new Set(['F', 'X', 'D', 'N', 'I']);

export function normalizeSurepassPan(body: unknown): KycVerificationDetails & {
  panStatusCode: string | null;
} {
  const { data } = readSurepassEnvelope(body);
  const split = Array.isArray(data.full_name_split)
    ? data.full_name_split
        .map((part) => text(part))
        .filter(Boolean)
        .join(' ')
    : '';
  const code = text(data.pan_status)?.toUpperCase() ?? null;
  return {
    nameOnPan: text(data.full_name) ?? (split || null),
    panStatus:
      text(data.pan_status_desc) ?? (code ? PAN_STATUS_MEANING[code] : null),
    panCategory: text(data.category),
    panStatusCode: code,
  };
}

const MALFORMED: KycProviderOutcome = {
  outcome: 'UNAVAILABLE',
  code: 'PROVIDER_MALFORMED_RESPONSE',
  reason: 'The verification service returned an incomplete response.',
};

function echoesIdentifier(returned: unknown, requested: string): boolean {
  const value = text(returned);
  return !value || normalizeIdentifier(value) === requested;
}

export function classifySurepassPan(
  status: number,
  body: unknown,
  options: { holderMatched?: boolean } = {},
): KycProviderOutcome {
  const envelope = readSurepassEnvelope(body);
  if (status === 422 || envelope.success === false) {
    return options.holderMatched
      ? {
          outcome: 'FAILED',
          code: 'PAN_DETAILS_MISMATCH',
          reason:
            'The PAN, name and date of birth / incorporation do not match Income Tax records. Check them against the PAN card.',
          referenceId: envelope.clientId,
        }
      : {
          outcome: 'FAILED',
          code: 'PAN_NOT_FOUND',
          reason: 'This PAN could not be found in Income Tax records.',
          referenceId: envelope.clientId,
        };
  }
  const { panStatusCode, ...details } = normalizeSurepassPan(body);
  if (!details.nameOnPan) return MALFORMED;
  if (panStatusCode && REJECTED_PAN_STATUS.has(panStatusCode)) {
    return {
      outcome: 'FAILED',
      code: 'PAN_INACTIVE',
      reason: `Income Tax records mark this PAN as "${details.panStatus}". Use an active PAN.`,
      details,
      referenceId: envelope.clientId,
    };
  }
  if (panStatusCode && panStatusCode !== 'E') {
    return {
      outcome: 'REVIEW',
      code: 'PAN_EVENT_MARKED',
      reason: details.panStatus
        ? `Income Tax records mark this PAN with the event "${details.panStatus}". An admin will review it.`
        : 'Income Tax records report an unrecognised PAN status. An admin will review it.',
      details,
      referenceId: envelope.clientId,
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
  if (
    (!details.legalName && !details.tradeName) ||
    !echoesIdentifier(envelope.data.gstin, gstin)
  ) {
    return MALFORMED;
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

/** Transient responses that are safe to retry once (verification is read-only). */
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
const RETRY_DELAY_MS = 400;

const UNAVAILABLE_REASON =
  'The verification service is temporarily unavailable.';

/**
 * Surepass KYC API adapter. The bearer token never leaves this class: it is not
 * logged, persisted, or returned to clients. Response bodies are never logged
 * because they carry the holder's personal details; only `message_code` is.
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
    panHolder?: PanHolderInput,
  ): Promise<KycProviderOutcome> {
    const settings = this.settings();
    if (!settings) return { outcome: 'NOT_CONFIGURED' };

    const path = kind === 'PAN' ? settings.panPath : settings.gstPath;
    const holderMatched = kind === 'PAN' && isPanVerifyPath(path);
    if (holderMatched && !panHolder) {
      return {
        outcome: 'FAILED',
        code: 'PAN_DETAILS_REQUIRED',
        reason:
          'Enter the name and date of birth / incorporation exactly as on the PAN.',
      };
    }
    const payload: Record<string, string> = holderMatched
      ? {
          id_number: identifier,
          full_name: panHolder!.fullName,
          dob: panHolder!.dob,
        }
      : { id_number: identifier };
    const url = new URL(path, `${settings.baseUrl}/`).toString();
    const timeoutMs = this.config.get<number>('kyc.requestTimeoutMs') ?? 10_000;

    let result = await this.post(url, settings.token, payload, timeoutMs);
    if (
      result.kind === 'network' ||
      (result.kind === 'response' && RETRYABLE_STATUSES.has(result.status))
    ) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      result = await this.post(url, settings.token, payload, timeoutMs);
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
    const messageCode = readSurepassEnvelope(body).messageCode ?? 'none';
    switch (status) {
      case 400:
        return {
          outcome: 'FAILED',
          code: kind === 'PAN' ? 'PAN_INVALID' : 'GSTIN_INVALID',
          reason:
            kind === 'PAN'
              ? 'The verification service rejected this PAN as invalid.'
              : 'The verification service rejected this GSTIN as invalid.',
        };
      case 401:
        this.logger.error(
          `Surepass rejected the ${kind} request token (HTTP 401, message_code=${messageCode}). Check SUREPASS_API_TOKEN, SUREPASS_ENVIRONMENT and that the API is subscribed in the Surepass console.`,
        );
        return {
          outcome: 'UNAVAILABLE',
          code: 'PROVIDER_AUTH_FAILED',
          reason: UNAVAILABLE_REASON,
        };
      case 403: {
        const exhausted = messageCode === 'balance_exhausted';
        this.logger.error(
          exhausted
            ? 'Surepass API balance exhausted (HTTP 403). Recharge credits in the Surepass console.'
            : `Surepass refused the ${kind} request (HTTP 403, message_code=${messageCode}).`,
        );
        return {
          outcome: 'UNAVAILABLE',
          code: exhausted ? 'PROVIDER_BALANCE_EXHAUSTED' : 'PROVIDER_FORBIDDEN',
          reason: UNAVAILABLE_REASON,
        };
      }
      case 409:
        return {
          outcome: 'UNAVAILABLE',
          code: 'PROVIDER_CONFLICT',
          reason: 'The verification service is busy. Please try again shortly.',
        };
      case 429:
        this.logger.warn(`Surepass ${kind} verification rate limited`);
        return {
          outcome: 'UNAVAILABLE',
          code: 'PROVIDER_RATE_LIMITED',
          reason: 'The verification service is busy. Please try again shortly.',
        };
      case 422:
        break;
      default:
        if (status < 200 || status >= 300 || body === null) {
          this.logger.warn(
            `Surepass ${kind} verification returned HTTP ${status} (message_code=${messageCode})`,
          );
          return {
            outcome: 'UNAVAILABLE',
            code:
              body === null
                ? 'PROVIDER_MALFORMED_RESPONSE'
                : `PROVIDER_HTTP_${status}`,
            reason: UNAVAILABLE_REASON,
          };
        }
    }

    return kind === 'PAN'
      ? classifySurepassPan(status, body, { holderMatched })
      : classifySurepassGst(status, body, identifier);
  }

  private async post(
    url: string,
    token: string,
    payload: Record<string, string>,
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
        body: JSON.stringify(payload),
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
