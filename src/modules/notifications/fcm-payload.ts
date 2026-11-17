export const FCM_GENERIC_TITLE = 'PolyStoreX';
export const FCM_GENERIC_BODY = 'Open PolyStoreX to view this update.';

const SENSITIVE_RE =
  /[A-Z]{5}\d{4}[A-Z]|\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]\b|\b[6-9]\d{9}\b|\b\d{12}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:pan|aadhaar|aadhar|gstin|ifsc|utr|account)\b/i;

const EVENT_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type FcmPayloadSource = {
  id: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
};

export type FcmContent = {
  title: string;
  body: string;
  data: Record<string, string>;
  collapseKey: string;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const clip = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

const safeText = (value: string, fallback: string, max: number): string => {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed || SENSITIVE_RE.test(trimmed)) return fallback;
  return clip(trimmed, max);
};

const internalRoute = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const route = value.trim();
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('://')) {
    return '';
  }
  if (route.startsWith('/(customer)/') || route.startsWith('/(seller)/')) {
    return clip(route, 180);
  }
  return '';
};

const eventKey = (metadata: Record<string, unknown>): string => {
  for (const key of ['event', 'eventKey', 'type'] as const) {
    const value = metadata[key];
    if (typeof value === 'string' && EVENT_RE.test(value)) return value;
  }
  return '';
};

/**
 * Push copy and data are a whitelist. Payment, KYC, and contact details stay in the inbox.
 */
export const buildFcmContent = (source: FcmPayloadSource): FcmContent => {
  const metadata = asRecord(source.metadata);
  const data: Record<string, string> = {
    notificationId: source.id,
  };
  if (source.entityType) data.entityType = clip(source.entityType, 64);
  if (source.entityId) data.entityId = source.entityId;
  const route = internalRoute(metadata.route);
  if (route) data.route = route;
  if (typeof metadata.category === 'string' && EVENT_RE.test(metadata.category)) {
    data.category = metadata.category;
  }
  const event = eventKey(metadata);
  if (event) data.event = event;

  return {
    title: safeText(source.title, FCM_GENERIC_TITLE, 120),
    body: safeText(source.body, FCM_GENERIC_BODY, 240),
    data,
    collapseKey: source.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64),
  };
};
