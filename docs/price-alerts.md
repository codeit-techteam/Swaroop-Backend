# Price alerts

## What exists

- Table `price_alerts` and customer APIs:
  - `GET/POST /api/v1/customer/price-alerts`
  - `PATCH/DELETE /api/v1/customer/price-alerts/:id`
- Ownership is enforced via the authenticated customer profile.
- Responses include `evaluation.supported: false` until a worker is configured.

## What is missing (do not simulate)

There is **no authoritative continuous price feed** and **no background evaluation worker** that compares live offer/grade prices to alert thresholds.

Until that infrastructure exists:

- Do not claim real-time alerts in product copy.
- Do not fabricate trigger notifications from the client.
- Prefer event-driven hooks on offer/grade price updates (same pattern as `PrSourcingWorker`) rather than inventing prices.

## Recommended next step

1. On offer price change (seller revise / admin publish), enqueue evaluation for matching `price_alerts`.
2. Deduplicate with `lastTriggeredAt` + last crossed threshold.
3. Deliver via existing `Notification` / preference `PRICE_ALERT` event key.
