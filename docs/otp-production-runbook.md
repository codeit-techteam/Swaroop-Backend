# PolyStoreX OTP production runbook (MSG91)

Central OTP endpoints (all platforms):

- `POST /api/v1/auth/otp/send`
- `POST /api/v1/auth/otp/resend`
- `POST /api/v1/auth/otp/verify`

Backend: `https://swaroop-backend-xzwkz.ondigitalocean.app`

---

## How to confirm `OTP_Template1` is Approved and mapped to DLT header `VELPLY`

These are **three different IDs**. Do not treat them as interchangeable.

| What | Where you see it | Confirmed value |
|------|------------------|-----------------|
| MSG91 template name | MSG91 → OTP → SendOTP → Templates | `OTP_Template1` |
| MSG91 approval | Same table, Status column | **Approved by MSG91** |
| MSG91 template ID (API) | Same table / Template Code URL `template_id=` | `6ae081288c342f46e203bb12` |
| MSG91 Sender ID (route) | Same table, **Sender ID** column | `AIR0993093271` |
| Airtel DLT header | Airtel DLT → Headers → Registered | `VELPLY` (Header DLT Id `1005742923759773867`) |
| Airtel DLT content template | Airtel DLT → SMS Templates → Registered | `OTP Template 1`, Header **VELPLY**, Template DLT Id `1077252360053463958` |

### Step-by-step in MSG91 (veylorn project)

1. Open [MSG91 OTP Templates](https://control.msg91.com/app/m/l/otp/templates).
2. Confirm row **OTP_Template1** shows green **Approved by MSG91**.
3. Confirm **Template ID** = `6ae081288c342f46e203bb12` (copy icon).
4. Confirm **Sender ID** column = `AIR0993093271`  
   - This is MSG91’s mapped sender for the template.  
   - It is **not** the string `VELPLY`.
5. Open the template’s **Template Code** (⋯ menu). Expected shape:

   ```js
   fetch("https://control.msg91.com/api/v5/otp?template_id=6ae081288c342f46e203bb12&mobile={{mobile}}&authkey={{authkey}}", {
     method: "POST",
     headers: {
       "Content-Type": "application/json",
       authkey: "{{authkey}}",
     },
     body: JSON.stringify({
       OTP: "{{OTP}}",
     }),
   });
   ```

6. Optional: click **Test DLT** on the template row and send to an authorized handset. If Test DLT delivers from header `VELPLY`, the MSG91↔DLT mapping is good.

### Step-by-step in Airtel DLT

1. **Headers → Registered** — find `VELPLY` (Header DLT Id `1005742923759773867`).
2. **SMS Templates → Registered** — find **OTP Template 1** with:
   - Header = **VELPLY**
   - Template DLT Id = `1077252360053463958`
   - Content starts with `Your PolyStoreX OTP verification…`

### Mapping rule (what “mapped” means)

```
MSG91 OTP_Template1 (6ae081288c…)
    └─ MSG91 Sender ID: AIR0993093271   ← what MSG91 uses on the wire
           └─ DLT-linked to header VELPLY  ← what the user sees / TRAI DLT
                  └─ Airtel content template 1077252360053463958
```

**Backend must:**

- Call MSG91 with `template_id=6ae081288c342f46e203bb12`
- Put the OTP in the JSON body as `{ "OTP": "<code>" }` (and `otp` query for `##OTP##`)
- **Leave `MSG91_SENDER_ID` empty** so MSG91 keeps using `AIR0993093271`
- **Never** send `sender=VELPLY` (that breaks the panel mapping)

---

## Required DigitalOcean App Platform env

| Variable | Production value |
|----------|------------------|
| `NODE_ENV` | `production` |
| `OTP_PROVIDER` | `msg91` |
| `AUTH_STRICT_OTP` | `true` |
| `AUTH_DEV_FIXED_OTP` | `false` |
| `AUTH_DEV_EXPOSE_OTP` | `false` |
| `MSG91_AUTH_KEY` | Veylorn MSG91 authkey (server-only) |
| `MSG91_OTP_TEMPLATE_ID` | `6ae081288c342f46e203bb12` |
| `MSG91_SENDER_ID` | **empty** (uses template → `AIR0993093271`) |
| `MSG91_HEADER` | `VELPLY` (docs / ops only — not sent as `sender`) |
| `MSG91_DLT_TEMPLATE_ID` | `1077252360053463958` (Airtel content template; audit) |

## MSG91 Authkey IP whitelist

Dedicated egress IPs for this DO app:

- `168.144.127.250`
- `143.110.253.127`

Add **both** to the Authkey IP whitelist. Redeploy/restart after networking changes.

## Health check (no secrets)

`GET /api/v1/health` → expect:

```json
"otp": {
  "provider": "msg91",
  "msg91Configured": true,
  "authStrictOtp": true,
  "templateConfigured": true,
  "senderIdConfigured": false,
  "headerConfigured": true
}
```

`senderIdConfigured: false` is correct when relying on MSG91 template → `AIR0993093271`.

## Send contract

- Success includes `smsDispatched: true` and `correlationId`
- Never returns the OTP in production
- Provider failure → HTTP `503`, `AUTH_OTP_PROVIDER_ERROR`, safe `details.reason`

## Real SMS checklist

1. Health `otp` block OK  
2. MSG91 Approved + Sender ID `AIR0993093271`; Airtel template Header `VELPLY`  
3. Authkey whitelist includes both DO egress IPs  
4. Send from any PolyStoreX platform → SMS arrives as **VELPLY**  
5. Verify OTP → login / credit flow  
6. Log masked phone + `correlationId` only (never the OTP)
