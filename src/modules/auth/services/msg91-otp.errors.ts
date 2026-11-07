/**
 * Safe MSG91 failure taxonomy for logs and API `details.reason`.
 * Never includes OTP values, auth keys, or full phone numbers.
 */
export type Msg91FailureReason =
  | 'INVALID_AUTHKEY'
  | 'IP_NOT_WHITELISTED'
  | 'INVALID_TEMPLATE'
  | 'INVALID_SENDER'
  | 'DLT_MISMATCH'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_MOBILE'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export class Msg91ProviderError extends Error {
  readonly reason: Msg91FailureReason;
  readonly providerCode?: string;

  constructor(
    message: string,
    reason: Msg91FailureReason,
    providerCode?: string,
  ) {
    super(message);
    this.name = 'Msg91ProviderError';
    this.reason = reason;
    this.providerCode = providerCode;
  }
}

export function classifyMsg91Failure(
  message: string | undefined,
  code?: string | number,
): Msg91FailureReason {
  const text = (message ?? '').toLowerCase();
  const codeStr = String(code ?? '').toLowerCase();

  if (codeStr === '201' || /invalid authkey|authkey|authentication/i.test(text)) {
    return 'INVALID_AUTHKEY';
  }
  if (
    /ip\b.*(?:whitelist|white list|not allowed|blocked|restrict)/i.test(text) ||
    /whitelist/i.test(text) ||
    /unauthorized ip/i.test(text)
  ) {
    return 'IP_NOT_WHITELISTED';
  }
  if (/template/i.test(text)) {
    return 'INVALID_TEMPLATE';
  }
  if (/sender|header/i.test(text) && /dlt/i.test(text)) {
    return 'DLT_MISMATCH';
  }
  if (/sender/i.test(text)) {
    return 'INVALID_SENDER';
  }
  if (/dlt/i.test(text)) {
    return 'DLT_MISMATCH';
  }
  if (/balance|credit|insufficient/i.test(text)) {
    return 'INSUFFICIENT_BALANCE';
  }
  if (/mobile|phone|number/i.test(text) && /invalid|incorrect/i.test(text)) {
    return 'INVALID_MOBILE';
  }
  if (/rate.?limit|too many|throttle/i.test(text) || codeStr === '429') {
    return 'RATE_LIMITED';
  }
  if (/timeout|timed out|abort/i.test(text)) {
    return 'TIMEOUT';
  }
  if (/unavailable|maintenance|down|5\d\d/i.test(text)) {
    return 'UNAVAILABLE';
  }
  return 'UNKNOWN';
}

/** Mask E.164 / MSG91 digit phones for logs: +91******0242 */
export function maskPhoneForLog(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  const suffix = digits.slice(-4);
  if (digits.startsWith('91') && digits.length >= 12) {
    return `+91******${suffix}`;
  }
  if (phone.trim().startsWith('+')) {
    const ccMatch = phone.trim().match(/^\+(\d{1,3})/);
    const cc = ccMatch?.[1] ?? '';
    return `+${cc}******${suffix}`;
  }
  return `******${suffix}`;
}
