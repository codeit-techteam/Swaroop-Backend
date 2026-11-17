const FCM_TOKEN_RE = /^[A-Za-z0-9_:-]{32,4096}$/;
const EXPO_TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;
const INSTALLATION_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

/** Native Android FCM registration token. Expo push tokens are rejected. */
export const isFcmRegistrationToken = (token: string): boolean =>
  FCM_TOKEN_RE.test(token) && !EXPO_TOKEN_RE.test(token);

/** Legacy Expo token, accepted only so logout can revoke a previously stored row. */
export const isLegacyExpoPushToken = (token: string): boolean =>
  EXPO_TOKEN_RE.test(token);

export const isRevocableDeviceToken = (token: string): boolean =>
  isFcmRegistrationToken(token) || isLegacyExpoPushToken(token);

export const isInstallationId = (value: string): boolean =>
  INSTALLATION_RE.test(value);
