# Phase 3 — Centralized Authentication & Authorization

## Status

**PHASE 3 — AUTHENTICATION COMPLETE**

Customer, Seller, and Admin share one `AuthModule` and one `User` identity. Roles differentiate access.

## Architecture

```text
Client apps → POST /api/v1/auth/* → AuthController → AuthService
                                      │
                         JWT access + refresh (rotated)
                                      │
                         AuthSession / OtpVerification / PasswordResetToken
                                      │
                                   PostgreSQL
```

## Flows

### Customer / Seller (OTP)

1. `POST /api/v1/auth/otp/send` with phone or email
2. User enters OTP
3. `POST /api/v1/auth/otp/verify` → access + refresh tokens
4. Call protected APIs with `Authorization: Bearer <accessToken>`

### Admin (password)

1. `POST /api/v1/auth/login` with email + password
2. Receive tokens
3. Access admin-only routes via `@Roles(ADMIN|SUPER_ADMIN)`

### Refresh

1. `POST /api/v1/auth/refresh` with refresh token
2. Old refresh token is revoked (rotation)
3. Reuse of old refresh token revokes the token family

## Endpoints

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/v1/auth/otp/send` | Public |
| POST | `/api/v1/auth/otp/verify` | Public |
| POST | `/api/v1/auth/login` | Public |
| POST | `/api/v1/auth/refresh` | Public |
| POST | `/api/v1/auth/logout` | Bearer |
| GET | `/api/v1/auth/me` | Bearer |
| POST | `/api/v1/auth/change-password` | Bearer |
| POST | `/api/v1/auth/password/forgot` | Public |
| POST | `/api/v1/auth/password/reset` | Public |
| GET | `/api/v1/auth/admin-check` | Bearer + Admin role |

Swagger: `http://localhost:3000/docs`

## RBAC

- `@Roles('CUSTOMER' | 'SELLER' | 'ADMIN' | ...)`
- `JwtAuthGuard` + `RolesGuard`
- Seeded roles from Phase 2 remain the source of truth

## Database models added

- `AuthSession` (hashed refresh tokens, family rotation)
- `OtpVerification` (hashed OTP, attempts, expiry, purpose)
- `PasswordResetToken` (hashed one-time reset tokens)
- `UserStatus.BLOCKED`

Migration: `20260911140000_phase3_authentication`

## Environment

```bash
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
OTP_LENGTH=6
OTP_EXPIRES_IN_SECONDS=300
OTP_MAX_ATTEMPTS=5
OTP_RESEND_COOLDOWN_SECONDS=60
AUTH_DEV_EXPOSE_OTP=true   # development only
PASSWORD_RESET_EXPIRES_IN_SECONDS=1800
BCRYPT_SALT_ROUNDS=12
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/swaroop?schema=public
```

When `AUTH_DEV_EXPOSE_OTP=true` and `NODE_ENV!=production`:

- OTP send may include `devOtp`
- Forgot password may include `devResetToken`

Never enable in production.

## Development seed users

Password for all: `Test@12345`

| Email | Role |
| --- | --- |
| customer@test.local | CUSTOMER |
| seller@test.local | SELLER |
| admin@test.local | ADMIN |

## Frontend integration

Do not change frontend apps in this phase. Wire them to:

```http
POST /api/v1/auth/otp/send
POST /api/v1/auth/otp/verify
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

Store `accessToken` + `refreshToken` securely and send:

```http
Authorization: Bearer <accessToken>
```

## Testing

```bash
npm run test
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/swaroop?schema=public npm run test:e2e
```

## Security notes

- Passwords / OTPs / refresh tokens are hashed
- OTP and reset tokens are single-use
- Account statuses `SUSPENDED`, `BLOCKED`, `INACTIVE`, `DELETED` cannot authenticate
- Secrets never logged
- SMS/email providers are abstracted (`OtpDeliveryService`) for later integration
