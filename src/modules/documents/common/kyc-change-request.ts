/**
 * Admin "request changes" record shared by seller onboarding and customer KYC.
 * Stored in admin-owned JSON (seller verification metadata / customer KYC
 * metadata) so client draft saves can never overwrite it.
 */
export type KycChangeRequest = {
  reason: string;
  documentIds: string[];
  slots: string[];
  requestedAt: string;
  requestedById: string;
  resolvedAt: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function readChangeRequest(value: unknown): KycChangeRequest | null {
  const raw = asObject(value);
  if (!raw || typeof raw.reason !== 'string') return null;
  return {
    reason: raw.reason,
    documentIds: stringList(raw.documentIds),
    slots: stringList(raw.slots),
    requestedAt: typeof raw.requestedAt === 'string' ? raw.requestedAt : '',
    requestedById:
      typeof raw.requestedById === 'string' ? raw.requestedById : '',
    resolvedAt: typeof raw.resolvedAt === 'string' ? raw.resolvedAt : null,
  };
}

/** Change request the user still has to act on, if any. */
export function openChangeRequest(value: unknown): KycChangeRequest | null {
  const request = readChangeRequest(value);
  return request && !request.resolvedAt ? request : null;
}

export function resolvedChangeRequest(
  value: unknown,
  at = new Date(),
): KycChangeRequest | null {
  const request = readChangeRequest(value);
  if (!request) return null;
  return request.resolvedAt
    ? request
    : { ...request, resolvedAt: at.toISOString() };
}
