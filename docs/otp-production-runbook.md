# PolyStoreX OTP production runbook (MSG91)

Central OTP endpoints (all platforms):

- `POST /api/v1/auth/otp/send`
- `POST /api/v1/auth/otp/resend`
- `POST /api/v1/auth/otp/verify`

Backend: `https://swaroop-backend-xzwkz.ondigitalocean.app`

---

## Current production diagnosis (2026-11-07)

| Check | Result |
|-------|--------|
| Backend health `otp.msg91Configured` | `true` |
| Backend `smsDispatched` on send | `true` (MSG91 **accepted** the API call) |
| Handset SMS | Often missing |
| MSG91 template status | Was **Failed by DLT and Approved by MSG91** → after Re-verify: **Approved by MSG91** |

**Meaning:** This is primarily a **DLT delivery** problem, not a missing Authkey. MSG91 can return success while the operator drops the SMS when DLT mapping/scrubbing fails.

### Immediate DigitalOcean env (set exactly)

| Variable | Value |
|----------|--------|
| `OTP_PROVIDER` | `msg91` |
| `AUTH_STRICT_OTP` | `true` |
| `AUTH_DEV_FIXED_OTP` | `false` |
| `AUTH_DEV_EXPOSE_OTP` | `false` |
| `MSG91_AUTH_KEY` | live Veylorn key |
| `MSG91_OTP_TEMPLATE_ID` | `6ae081288c342f46e203bb12` |
| `MSG91_SENDER_ID` | **`AIR0993093271`** (MSG91 Sender ID column — required) |
| `MSG91_HEADER` | `VELPLY` (DLT header docs only) |
| `MSG91_DLT_TEMPLATE_ID` | `1077252360053463958` |

Then **Force rebuild and deploy** the backend.

After deploy, health should show `senderIdConfigured: true`.

### MSG91 panel — fix "Failed by DLT"

1. Open [OTP Templates](https://control.msg91.com/app/m/l/otp/templates).
2. If status is **Failed by DLT and Approved by MSG91**, click **Re-verify Template**.
3. Wait until status is only **Approved by MSG91** (green).
4. Confirm:
   - Template ID `6ae081288c342f46e203bb12`
   - Sender ID **`AIR0993093271`**
   - Content uses `##OTP##`
5. Click **Test DLT** → send to your handset (`+918240890242`).
   - If Test DLT also fails → DLT mapping is still wrong (Airtel / MSG91 support). Backend cannot fix that alone.
   - If Test DLT succeeds → retry Customer/Seller login Send OTP.

### Airtel DLT cross-check

| Item | Value |
|------|--------|
| Header | `VELPLY` (Header DLT Id `1005742923759773867`) |
| Content template | `OTP Template 1` / Template DLT Id `1077252360053463958` |
| Header on that template | must be **VELPLY** |

Content after OTP substitution must match the Airtel-registered text character-for-character (except the OTP digits).

### MSG91 SendOTP → Logs

After any send from the app:

1. Open MSG91 → OTP → SendOTP → **Logs**
2. Find the row for mobile `…0242` / `providerRequestId` from API response
3. Read delivery reason (e.g. `DLT Scrubbing Failed`, `Header not Associated with Template`)

API response now includes `providerRequestId` + `correlationId` when MSG91 accepts the send.

### Authkey IP whitelist

Add both DigitalOcean dedicated egress IPs:

- `168.144.127.250`
- `143.110.253.127`

---

## How IDs relate

```
MSG91 OTP_Template1 (6ae081288c…)
    └─ MSG91 Sender ID: AIR0993093271   ← set MSG91_SENDER_ID to this
           └─ DLT header shown to user: VELPLY
                  └─ Airtel template 1077252360053463958
```

Never set `MSG91_SENDER_ID=VELPLY`.

---

## Health check

`GET /api/v1/health` (or `/health` if routed):

```json
"otp": {
  "provider": "msg91",
  "msg91Configured": true,
  "authStrictOtp": true,
  "templateConfigured": true,
  "senderIdConfigured": true,
  "headerConfigured": true
}
```

Production is SMS-ready only when `msg91Configured`, `authStrictOtp`, and `senderIdConfigured` are all `true`, **and** MSG91 template is Approved (not Failed by DLT), **and** Test DLT delivers to a real handset.
