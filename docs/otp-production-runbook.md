# PolyStoreX OTP — production SMS not arriving

## Which MSG91 API?

**SendOTP (OTP product)** — not SMS Flow.

- Endpoint: `POST https://control.msg91.com/api/v5/otp`
- MSG91 template: `OTP_Template1` → `6ae081288c342f46e203bb12`
- Evidence: failures appear under **OTP → Logs**

Ignore **SMS → Templates** (`PolyStoreX_OTP_Template`) for app OTP. That SMS template showing “Template not matched on DLT” is a separate product path.

---

## Current failure reasons (your logs)

| Time | Template-OTP | Failure |
|------|--------------|---------|
| 12:57 | `-` | Template Not Found (panel Test DLT / unbound send) |
| 12:06 | `-` | Invalid DLT Template ID |
| 10:10 | `6ae08128…` | Invalid DLT Template ID / previously Invalid DLT Entity Id |

Root cause of handset failure: **MSG91 message text does not match Airtel DLT**, plus **PE Entity Id** must be mapped.

### Exact Airtel registered content (must match)

```text
Your PolyStoreX OTP verification code is {#numeric#}. This OTP is valid for 10 minutes. Do not share the OTP with anyone.
```

### What MSG91 currently has (WRONG — typo)

```text
Your PolyStoreX OTP verification code is ##OTP##. This OTP s valid for 10 minutes. Do not share the OTP with anyone.
```

Missing **`is`** → DLT rejects → **Invalid DLT Template ID** / **Template not matched on DLT**.

---

## Fix now (in order)

### A. Fix MSG91 OTP template text (critical)

1. OTP → Templates → `OTP_Template1` → edit (Update Template modal you already have open).
2. Replace content with **exactly**:

```text
Your PolyStoreX OTP verification code is ##OTP##. This OTP is valid for 10 minutes. Do not share the OTP with anyone.
```

3. Keep:
   - Sender ID: `VELPLY`
   - DLT Template ID: `1077252360053463958`
4. Click **Update** → wait for **Approved by MSG91**.
5. Click **Test DLT** → confirm 6-digit (or panel test length) SMS arrives.

### B. Map PE Id to sender VELPLY

1. MSG91 → **SMS** → **Sender Id**
2. Edit **VELPLY**
3. Paste PE Id into the Entity/PE field (UI may say “DLT Template ID”):

```text
1001399554249028657
```

4. Update / Save

### C. DigitalOcean App Platform env

```text
MSG91_DLT_ENTITY_ID=1001399554249028657
MSG91_DLT_TEMPLATE_ID=1077252360053463958
MSG91_OTP_TEMPLATE_ID=6ae081288c342f46e203bb12
MSG91_SENDER_ID=VELPLY
MSG91_HEADER=VELPLY
OTP_LENGTH=6
OTP_EXPIRES_IN_SECONDS=600
AUTH_STRICT_OTP=true
AUTH_DEV_FIXED_OTP=false
AUTH_DEV_EXPOSE_OTP=false
```

Redeploy. Confirm `/api/v1/health` → `otp.dltEntityConfigured: true`.

### D. Ignore for app OTP

- SMS template `PolyStoreX_OTP_Template` “Template not matched on DLT” — not used by the app.
- Log rows with Template-OTP `-` + “Template Not Found” — usually panel Test DLT without a bound OTP template.

---

## ID cheat sheet

```text
PE Id (Entity):     1001399554249028657   → MSG91_DLT_ENTITY_ID + Sender Id mapping
Content Template:   1077252360053463958   → MSG91_DLT_TEMPLATE_ID + OTP template “DLT Template ID”
MSG91 OTP template: 6ae081288c342f46e203bb12 → MSG91_OTP_TEMPLATE_ID
Sender/Header:      VELPLY                → MSG91_SENDER_ID / MSG91_HEADER
```

## Backend note

Pushed `01fe417`: SendOTP body is `{OTP}` only; `DLT_TE_ID` + `PE_ID` go as query params. After you set `MSG91_DLT_ENTITY_ID` and fix the typo, Test DLT + Customer WebApp should deliver 6-digit OTPs.
