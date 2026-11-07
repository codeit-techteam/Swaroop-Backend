# PolyStoreX OTP — production SMS not arriving

## Root cause (confirmed from MSG91 Logs + backend)

| Layer | Status |
|-------|--------|
| Customer/Seller UI | OK — reaches Verify OTP; toast "An OTP was already sent" is correct cooldown UX |
| Backend health | OK — `msg91Configured`, `senderIdConfigured`, `authStrictOtp` all `true` |
| Backend send API | OK — returns `smsDispatched: true` (MSG91 **accepted** the request; credits 0.25 charged) |
| MSG91 Logs | **Failed** / **Pending** — handset never receives SMS |
| Handset / Test DLT | **FAIL** |

So this is **not** an app contract bug. Delivery dies in **MSG91 ↔ Airtel DLT scrubbing** after API accept.

A MSG91 `request_id` + credit deduction does **not** mean SMS delivery succeeded.

### Why some log rows show Template-OTP `-`

Those rows are **not** from the production SendOTP path that always sends `template_id=6ae081288c342f46e203bb12`.

They come from MSG91 panel actions (Test DLT / retry / incomplete panel send) that do not bind the OTP template. Backend API sends always log with the configured template ID.

### Why Message eye icon shows ciphertext

MSG91 encrypts message bodies in the Logs UI. That is expected panel behaviour, not a malformed backend payload.

---

## Critical mismatch to fix in MSG91 panel (do this first)

Open **Update Template** for `OTP_Template1`. Content must match Airtel DLT **exactly**:

```text
Your PolyStoreX OTP verification code is ##OTP##. This OTP is valid for 10 minutes. Do not share the OTP with anyone.
```

### Required action

1. Open **Airtel DLT → SMS Templates → Registered → OTP Template 1** (`1077252360053463958`).
2. Copy the **exact** approved content character-by-character.
3. In MSG91 → Update Template:
   - **Sender ID:** `VELPLY`
   - **DLT Template ID:** `1077252360053463958`
   - **OTP Content:** paste the **exact** Airtel text, using `##OTP##` for the code placeholder
4. Save → wait for **Approved by MSG91** (not Failed by DLT).
5. Click **Test DLT** → send to your test handset.
6. Confirm SMS arrives from **VELPLY**.
7. Open the Failed row → note `failureReason` (via webhook below or MSG91 support).

Until **Test DLT** works, Customer Web / Seller Web / Expo / Website cannot receive SMS either.

---

## Also check in MSG91

1. **SendOTP → Logs** after any send / Test DLT — open the row and read the failure reason  
   (common: `DLT Scrubbing Failed`, `SMS not Matched with DLT Template`, `Header not Associated`).
2. **Authkey IP whitelist** includes DigitalOcean egress:
   - `168.144.127.250`
   - `143.110.253.127`
3. Account has SMS **balance**.
4. Entity / PE ID on MSG91 matches your Airtel DLT entity.
5. Configure **OTP → Webhook → On Report Received**:
   - `https://swaroop-backend-xzwkz.ondigitalocean.app/api/v1/auth/webhooks/msg91/otp-delivery`
   - Backend logs `msg91.otp.delivery_report` with masked mobile, `providerRequestId`, status (`delivered`/`failed`), and `failureReason` — never OTP or auth key.

---

## Backend API (central — all apps)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v1/auth/otp/send` | Send OTP |
| `POST /api/v1/auth/otp/resend` | Resend |
| `POST /api/v1/auth/otp/verify` | Verify + session |
| `POST /api/v1/auth/webhooks/msg91/otp-delivery` | MSG91 delivery reports |

Provider: MSG91 SendOTP v5 `POST https://control.msg91.com/api/v5/otp` with:
- `template_id` = MSG91 hex id (`MSG91_OTP_TEMPLATE_ID` / `PolyStoreX_OTP_Template`)
- `DLT_TE_ID` = Airtel numeric id (`MSG91_DLT_TEMPLATE_ID=1077252360053463958`)
- `sender=VELPLY`, `mobile`, `otp`, body `{ "OTP": "...", "DLT_TE_ID": "..." }`

Verification is **local HMAC** against the backend-generated OTP (MSG91 Verify is only for legacy challenge refs).

---

## Why mobile shows “Dev: OTP 123456” then Invalid OTP

Expo Metro (`npx expo start`) still pointed at the **production** API.

Production has `AUTH_STRICT_OTP=true`, so demo OTP `123456` is **rejected** (correct).

The Dev hint is hidden whenever the API host is production (`ondigitalocean.app` / `polystorex.com`).

Enter only the OTP from the real SMS (once Test DLT works).

---

## Backend / DO env (already correct when health shows senderIdConfigured: true)

| Variable | Value |
|----------|--------|
| `OTP_PROVIDER` | `msg91` |
| `OTP_ENVIRONMENT` | `production` |
| `AUTH_STRICT_OTP` | `true` |
| `AUTH_DEV_FIXED_OTP` | `false` |
| `AUTH_DEV_EXPOSE_OTP` | `false` |
| `MSG91_OTP_TEMPLATE_ID` | `6ae081288c342f46e203bb12` |
| `MSG91_SENDER_ID` | `VELPLY` |
| `MSG91_HEADER` | `VELPLY` |
| `MSG91_DLT_TEMPLATE_ID` | `1077252360053463958` |
| `OTP_LENGTH` | `6` |
| `OTP_EXPIRES_IN_SECONDS` | `600` |

Never put `MSG91_AUTH_KEY` in frontend code or Git.

---

## Success criteria

1. MSG91 **Test DLT** SMS arrives on the handset as **VELPLY**.
2. `customer.polystorex.com` / `seller.polystorex.com` / `polystorex.com/request-credit` Send OTP → same SMS.
3. Enter that 6-digit code → login / credit flow succeeds.
4. Expo no longer shows fake `123456` against production API.
5. Webhook logs show `status: delivered` for successful sends.
