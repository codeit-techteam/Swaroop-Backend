# PolyStoreX OTP — production SMS not arriving

## Root cause (confirmed)

| Layer | Status |
|-------|--------|
| Customer/Seller UI | OK — reaches Verify OTP |
| Backend health | OK — `msg91Configured`, `senderIdConfigured`, `authStrictOtp` all `true` |
| Backend send API | OK — returns `smsDispatched: true` (MSG91 **accepted** the request) |
| Handset / Test DLT | **FAIL** — SMS never delivered |

So this is **not** an app bug. Delivery dies in **MSG91 ↔ Airtel DLT scrubbing**.

MSG91 can approve an API call and still drop the SMS when DLT content does not match.

---

## Critical mismatch to fix in MSG91 panel (do this first)

Open **Update Template** for `OTP_Template1`. Current content shows:

```text
Your PolyStoreX OTP verification code is ##OTP##. This OTP s valid for 10 minutes. Do not share the OTP with anyone.
```

Note the typo: **`OTP s valid`** (missing **`is`**).

### Required action

1. Open **Airtel DLT → SMS Templates → Registered → OTP Template 1** (`1077252360053463958`).
2. Copy the **exact** approved content character-by-character.
3. In MSG91 → Update Template:
   - **Sender ID:** `VELPLY`
   - **DLT Template ID:** `1077252360053463958`
   - **OTP Content:** paste the **exact** Airtel text, using `##OTP##` for the code placeholder  
     (almost certainly: `This OTP is valid` — not `OTP s valid`)
4. Save → wait for **Approved by MSG91** (not Failed by DLT).
5. Click **Test DLT** → send to `8240890242`.
6. Confirm SMS arrives from **VELPLY**.

Until **Test DLT** works, Customer Web / Seller Web / Expo cannot receive SMS either.

---

## Also check in MSG91

1. **SendOTP → Logs** after any send / Test DLT — open the row and read the failure reason  
   (common: `DLT Scrubbing Failed`, `SMS not Matched with DLT Template`, `Header not Associated`).
2. **Authkey IP whitelist** includes DigitalOcean egress:
   - `168.144.127.250`
   - `143.110.253.127`
3. Account has SMS **balance**.
4. Entity / PE ID on MSG91 matches your Airtel DLT entity.

---

## Why mobile shows “Dev: OTP 123456” then Invalid OTP

Expo Metro (`npx expo start`) still pointed at the **production** API.

Production has `AUTH_STRICT_OTP=true`, so demo OTP `123456` is **rejected** (correct).

The Dev hint is now hidden whenever the API host is production (`ondigitalocean.app` / `polystorex.com`).

Reload Metro after pulling the Expo fix. Enter only the OTP from the real SMS (once Test DLT works).

---

## Backend / DO env (already correct when health shows senderIdConfigured: true)

| Variable | Value |
|----------|--------|
| `OTP_PROVIDER` | `msg91` |
| `AUTH_STRICT_OTP` | `true` |
| `MSG91_OTP_TEMPLATE_ID` | `6ae081288c342f46e203bb12` |
| `MSG91_SENDER_ID` | `VELPLY` |
| `MSG91_HEADER` | `VELPLY` |
| `MSG91_DLT_TEMPLATE_ID` | `1077252360053463958` |
| `OTP_EXPIRES_IN_SECONDS` | `600` |

---

## Success criteria

1. MSG91 **Test DLT** SMS arrives on the handset as **VELPLY**.
2. `customer.polystorex.com` / `seller.polystorex.com` Send OTP → same SMS.
3. Enter that 6-digit code → login succeeds.
4. Expo no longer shows fake `123456` against production API.
