# Part G — End-to-end acceptance (29)

**Status:** Not executed in this session. Do not mark any scenario passed without a recorded run.

| ID | Scenario | Environment | Result | Notes |
|----|----------|-------------|--------|-------|
| A | Cart MOQ recover + checkout | staging | **NOT RUN** | Needs authenticated customer + live offer |
| B | Production OTP bypass rejection | staging/prod API | **NOT RUN** | Unit coverage exists (`auth.otp-production.spec.ts`); login attempt not executed here |
| C | Seller finance payout/due date | staging DB + Seller + Admin UI | **NOT RUN** | |
| D | Dashboard counts vs list APIs | staging | **NOT RUN** | |
| E | Validation (letters, negative, MOQ 0) | staging | **NOT RUN** | Unit coverage for quantity rules |
| F | Import USD offer visibility | staging | **NOT RUN** | |
| G | Product manufacturer/grade/MFI | staging | **NOT RUN** | |
| H | KYC status propagation | staging | **NOT RUN** | |
| I | Guest browse + protected auth | staging | **NOT RUN** | Public marketplace unit smoke only |
| J | TDS/invoice/tracking | staging | **NOT RUN** | |
| K | Cross-platform sync | staging | **NOT RUN** | |

## How to execute

1. Point clients at the DigitalOcean staging API.
2. Use real test accounts (customer/seller/admin) — never fixed OTP in production.
3. Record pass/fail + evidence (screenshot or API response) per row above.
