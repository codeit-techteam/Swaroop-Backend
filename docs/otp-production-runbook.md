# PolyStoreX OTP — what to do next (production)

MSG91 panel (confirmed):

| Field | Value |
|-------|--------|
| Template | `OTP_Template1` |
| Status | **Approved by MSG91** |
| Template ID | `6ae081288c342f46e203bb12` |
| Sender ID | **`VELPLY`** |
| Placeholder | `##OTP##` |

Backend: `https://swaroop-backend-xzwkz.ondigitalocean.app`

---

## Do these 5 steps in order

### 1. DigitalOcean App env (backend)

Set / update:

| Variable | Value |
|----------|--------|
| `OTP_PROVIDER` | `msg91` |
| `AUTH_STRICT_OTP` | `true` |
| `AUTH_DEV_FIXED_OTP` | `false` |
| `AUTH_DEV_EXPOSE_OTP` | `false` |
| `MSG91_AUTH_KEY` | your live key |
| `MSG91_OTP_TEMPLATE_ID` | `6ae081288c342f46e203bb12` |
| `MSG91_SENDER_ID` | **`VELPLY`** |
| `MSG91_HEADER` | `VELPLY` |
| `MSG91_DLT_TEMPLATE_ID` | `1077252360053463958` |
| `OTP_EXPIRES_IN_SECONDS` | `600` (matches template “10 minute”) |
| `OTP_LENGTH` | `6` |

Save → **Force rebuild and deploy**.

Verify:

```bash
curl -s https://swaroop-backend-xzwkz.ondigitalocean.app/api/v1/health | python3 -m json.tool
```

Expect:

```json
"otp": {
  "msg91Configured": true,
  "authStrictOtp": true,
  "templateConfigured": true,
  "senderIdConfigured": true,
  "headerConfigured": true
}
```

### 2. MSG91 Authkey IP whitelist

Add both DO egress IPs:

- `168.144.127.250`
- `143.110.253.127`

### 3. MSG91 Test DLT (must pass before blaming the app)

1. MSG91 → OTP → Templates → `OTP_Template1`
2. Click **Test DLT**
3. Send to `8240890242`
4. Confirm SMS arrives as sender **VELPLY**

If Test DLT fails → open **SendOTP → Logs**, fix the DLT reason with MSG91/Airtel support. App cannot override a DLT reject.

### 4. Live app test

1. `https://customer.polystorex.com/login` → Send OTP  
2. `https://seller.polystorex.com/login` → Send OTP  
3. SMS should arrive → enter code → login  

API success body includes `smsDispatched`, `correlationId`, `providerRequestId` (use `providerRequestId` in MSG91 Logs).

### 5. If still no SMS after Test DLT works

1. MSG91 → SendOTP → **Logs** → find the request  
2. Note failure reason (DLT scrubbing / header / balance)  
3. Confirm Authkey has balance and IP whitelist includes both egress IPs  

---

## ID map (current)

```
MSG91 OTP_Template1 (6ae081288c…)
  └─ Sender ID: VELPLY  ← MSG91_SENDER_ID
       └─ Airtel DLT header: VELPLY
            └─ Airtel content template: 1077252360053463958
```
