# PolyStoreX OTP — production SMS not arriving

## Which MSG91 API do we use?

| Product | Used by PolyStoreX? |
|---------|---------------------|
| **OTP / SendOTP v5** `POST https://control.msg91.com/api/v5/otp` | **YES** — this is the live path |
| SMS / Flow (`/api/v5/flow`) | **NO** — ignore SMS Templates for app OTP |

Proof: failures appear under **MSG91 → OTP → Logs** (not SMS Logs), with Flow ID = `6ae081288c342f46e203bb12` (`OTP_Template1`).

SMS Templates (`PolyStoreX_OTP_Template`) is a separate MSG91 product. App OTP does **not** call it.

---

## Exact failure reason (from your MSG91 log)

**Failure Reason: `Invalid DLT Entity Id`**

That is **not** a frontend bug and **not** the wrong API product.

| Id type | Example | Role |
|---------|---------|------|
| MSG91 OTP template id (hex) | `6ae081288c342f46e203bb12` | SendOTP `template_id` |
| Airtel **Content** Template Id | `1077252360053463958` | `DLT_TE_ID` / `MSG91_DLT_TEMPLATE_ID` |
| Airtel **Header** DLT Id | `1005742923759773867` (VELPLY) | Header registration — **not** Entity Id |
| Airtel **PE / Entity Id** | 19-digit, Airtel usually starts with `100` | `PE_ID` / `MSG91_DLT_ENTITY_ID` |

`Invalid DLT Entity Id` means the **PE / Entity Id** is missing or wrong on MSG91 (or in `MSG91_DLT_ENTITY_ID`).

Do **not** put Content Template Id or Header DLT Id into `MSG91_DLT_ENTITY_ID`.

---

## Fix (manual — required for handset delivery)

### 1. Copy the real PE / Entity Id from Airtel

1. Open [Airtel DLT home](https://www.airtel.in/business/commercial-communication/home).
2. Copy the **Entity / Registration / PE Id** from the dashboard (19 digits).
3. It is **not** Header DLT Id `1005742923759773867` and **not** Template Id `1077252360053463958`.

### 2. Map Entity Id on MSG91

1. MSG91 → **SMS → Sender Id** (or OTP template Sender mapping).
2. For **VELPLY**, set the DLT **Entity / PE Id** to the Airtel value from step 1.
3. OTP → Templates → `OTP_Template1` → DLT Template Id = `1077252360053463958`, Sender = `VELPLY`.
4. Click **Re-verify** / **Test DLT** until SMS arrives on the handset.

### 3. Set DigitalOcean env

```text
OTP_PROVIDER=msg91
MSG91_OTP_TEMPLATE_ID=6ae081288c342f46e203bb12
MSG91_SENDER_ID=VELPLY
MSG91_HEADER=VELPLY
MSG91_DLT_TEMPLATE_ID=1077252360053463958
MSG91_DLT_ENTITY_ID=<paste Airtel PE Id here>
OTP_EXPIRES_IN_SECONDS=600
AUTH_STRICT_OTP=true
```

Redeploy after saving. Health must show:

- `dltTemplateConfigured: true`
- `dltEntityConfigured: true`

### 4. Fix template text typo (if Airtel has “is”)

MSG91 currently shows:

```text
This OTP s valid for 10 minutes
```

Airtel registered content must match **character-for-character**. If Airtel has `This OTP is valid`, edit MSG91 OTP_Template1 to match, then Re-verify.

---

## Backend request shape (SendOTP v5)

```http
POST /api/v5/otp?template_id=6ae081288c342f46e203bb12&mobile=91…&otp=…&sender=VELPLY&DLT_TE_ID=1077252360053463958&PE_ID=<entity>&otp_expiry=10
Content-Type: application/json
authkey: <MSG91_AUTH_KEY>

{ "OTP": "<code>" }
```

Body is **only** `OTP`. DLT ids stay in query params (never in JSON/`extra_param`).

---

## Success criteria

1. MSG91 OTP Log → status **Delivered** (not Failed / Invalid DLT Entity Id).
2. Handset receives SMS from **VELPLY**.
3. `customer.polystorex.com` / `seller.polystorex.com` verify with that code.
