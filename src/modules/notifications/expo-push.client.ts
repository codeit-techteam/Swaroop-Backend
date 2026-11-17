/**
 * Retired Expo Push client. NotificationService does not call this.
 * Direct FCM is the only push sender. `isExpoPushToken` remains so a
 * previously stored Expo token can be revoked on logout.
 */
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

const EXPO_TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;

export const isExpoPushToken = (token: string): boolean =>
  EXPO_TOKEN_RE.test(token);

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: 'default';
  priority: 'high';
  channelId: 'default';
};

export type ExpoPushTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

export type ExpoPushReceipt = {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
};

type SendOptions = {
  accessToken?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export const isDeviceNotRegistered = (
  details?: { error?: string },
): boolean => details?.error === 'DeviceNotRegistered';

/** Receipt ids whose device Expo has dropped. Tokens themselves are not logged. */
export const tokensForUnregisteredReceipts = (
  receipts: Record<string, ExpoPushReceipt>,
  ticketToToken: ReadonlyMap<string, string>,
): string[] => {
  const tokens: string[] = [];
  for (const [ticketId, receipt] of Object.entries(receipts)) {
    if (!isDeviceNotRegistered(receipt.details)) continue;
    const token = ticketToToken.get(ticketId);
    if (token) tokens.push(token);
  }
  return tokens;
};

const asTicket = (value: unknown): ExpoPushTicket => {
  if (!value || typeof value !== 'object') {
    return { status: 'error', message: 'Unexpected Expo push ticket' };
  }
  const row = value as Record<string, unknown>;
  const details =
    row.details && typeof row.details === 'object'
      ? (row.details as { error?: string })
      : undefined;
  return {
    status: row.status === 'ok' ? 'ok' : 'error',
    id: typeof row.id === 'string' ? row.id : undefined,
    message: typeof row.message === 'string' ? row.message : undefined,
    details,
  };
};

/** Sends one batch to the Expo Push Service. Does not talk to FCM directly. */
export async function sendExpoPush(
  messages: ExpoPushMessage[],
  options: SendOptions = {},
): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];

  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  const accessToken = options.accessToken?.trim();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const tickets: ExpoPushTicket[] = [];
  for (let offset = 0; offset < messages.length; offset += 100) {
    const chunk = messages.slice(offset, offset + 100);
    const response = await fetchImpl(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk),
      signal: options.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        payload &&
        typeof payload === 'object' &&
        'errors' in payload &&
        Array.isArray((payload as { errors: unknown }).errors)
          ? 'Expo push request was rejected'
          : `Expo push request failed (${response.status})`;
      throw new Error(message);
    }
    const data =
      payload &&
      typeof payload === 'object' &&
      'data' in payload &&
      Array.isArray((payload as { data: unknown[] }).data)
        ? (payload as { data: unknown[] }).data
        : [];
    tickets.push(...data.map(asTicket));
  }
  return tickets;
}

/** Loads delivery receipts for tickets returned by sendExpoPush. */
export async function fetchExpoPushReceipts(
  ids: string[],
  options: SendOptions = {},
): Promise<Record<string, ExpoPushReceipt>> {
  if (ids.length === 0) return {};

  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const accessToken = options.accessToken?.trim();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const receipts: Record<string, ExpoPushReceipt> = {};
  for (let offset = 0; offset < ids.length; offset += 300) {
    const chunk = ids.slice(offset, offset + 300);
    const response = await fetchImpl(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: chunk }),
      signal: options.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Expo push receipt request failed (${response.status})`);
    }
    const data =
      payload && typeof payload === 'object' && 'data' in payload
        ? (payload as { data: unknown }).data
        : null;
    if (!data || typeof data !== 'object') continue;
    for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
      receipts[id] = asTicket(value);
    }
  }
  return receipts;
}
