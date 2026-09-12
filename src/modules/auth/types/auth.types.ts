export enum AuthErrorCode {
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_ACCOUNT_BLOCKED = 'AUTH_ACCOUNT_BLOCKED',
  AUTH_ACCOUNT_SUSPENDED = 'AUTH_ACCOUNT_SUSPENDED',
  AUTH_ACCOUNT_DEACTIVATED = 'AUTH_ACCOUNT_DEACTIVATED',
  AUTH_ACCOUNT_PENDING = 'AUTH_ACCOUNT_PENDING',
  AUTH_INVALID_OTP = 'AUTH_INVALID_OTP',
  AUTH_OTP_EXPIRED = 'AUTH_OTP_EXPIRED',
  AUTH_OTP_MAX_ATTEMPTS = 'AUTH_OTP_MAX_ATTEMPTS',
  AUTH_OTP_RATE_LIMITED = 'AUTH_OTP_RATE_LIMITED',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_INVALID_REFRESH_TOKEN = 'AUTH_INVALID_REFRESH_TOKEN',
  AUTH_SESSION_REVOKED = 'AUTH_SESSION_REVOKED',
  AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',
  AUTH_FORBIDDEN = 'AUTH_FORBIDDEN',
  AUTH_PASSWORD_WEAK = 'AUTH_PASSWORD_WEAK',
  AUTH_PASSWORD_MISMATCH = 'AUTH_PASSWORD_MISMATCH',
  AUTH_USER_NOT_FOUND = 'AUTH_USER_NOT_FOUND',
  AUTH_IDENTIFIER_REQUIRED = 'AUTH_IDENTIFIER_REQUIRED',
}

export type JwtAccessPayload = {
  sub: string;
  sessionId: string;
  roles: string[];
  type: 'access';
};

export type JwtRefreshPayload = {
  sub: string;
  sessionId: string;
  familyId: string;
  type: 'refresh';
};

export type AuthenticatedUser = {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  status: string;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  roles: string[];
  sessionId: string;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type PublicUser = {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  status: string;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  roles: string[];
  lastLoginAt: Date | null;
};
