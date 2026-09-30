# Location & address platform

One shared location service serves Customer Web, Customer App, Seller Web and
Seller App. Every Google Maps Platform lookup (autocomplete, place details,
reverse geocoding) goes through the backend, so no client ships a key that can
call Places or Geocoding.

```
Client (web / Expo)  ──JWT──▶  /api/v1/locations/*  ──server key──▶  Google Places API (New) / Geocoding API
        │                             │
        │                             └─ normalize → NormalizedLocation (line1, line2, locality, city,
        │                                district, state, postalCode, country, lat/lng, placeId, …)
        ▼
/api/v1/customer/addresses · /api/v1/seller/addresses · /api/v1/seller/locations/from-geo
        (ownership derived from JWT; PR/PO keep immutable address snapshots)
```

## Google Cloud setup

1. Create (or reuse) a Google Cloud project and attach billing.
2. Enable only these APIs:
   - **Places API (New)** — autocomplete + place details (server key).
   - **Geocoding API** — reverse geocoding for "Use current location" / map pin (server key).
   - **Maps JavaScript API** — only for the confirmation map on Customer Web and Seller Web (browser key).
   - Maps SDK for Android / iOS — _only_ if a native map is added to the Expo app later. Not used today.
3. Create separate keys and restrict each one:

| Key | Env var | Application restriction | API restriction |
| --- | --- | --- | --- |
| Server | `GOOGLE_MAPS_SERVER_API_KEY` (backend) | IP addresses of the backend hosts | Places API (New), Geocoding API |
| Browser | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Customer Web, Seller Web) | HTTP referrers: production + preview domains of both web apps, `http://localhost:3000/*`, `http://localhost:3001/*` | Maps JavaScript API |
| Android / iOS (optional) | `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (Expo) | Android package / iOS bundle id `com.swaroop.app` (+ SHA-1) | Maps SDK for Android / iOS |

4. Set a daily quota cap and a billing budget alert on the project.
5. Put the real values in the hosting provider's environment settings (Vercel,
   EAS secrets, backend host). `.env.example` files contain placeholders only —
   never commit a real key.

If `GOOGLE_MAPS_SERVER_API_KEY` is empty the backend reports
`LOCATION_SERVICE_NOT_CONFIGURED`; clients hide search and keep GPS + manual
entry working. If the browser key is empty the web confirmation map is simply
not rendered.

## Backend environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `GOOGLE_MAPS_SERVER_API_KEY` | _(empty)_ | Server key for Places (New) + Geocoding |
| `GOOGLE_MAPS_TIMEOUT_MS` | `6000` | Per-request timeout to Google |
| `GOOGLE_MAPS_REGION_CODE` | `IN` | Region bias / country filter |

## API

All routes require an authenticated customer or seller session.

| Route | Notes |
| --- | --- |
| `GET /api/v1/locations/config` | `{ provider, autocompleteEnabled, reverseGeocodeEnabled, regionCode, minQueryLength, attribution }` |
| `GET /api/v1/locations/autocomplete?input&sessionToken&lat&lng` | `input` ≥ 2 chars; `sessionToken` matches `^[A-Za-z0-9_-]{8,36}$` |
| `GET /api/v1/locations/places/:placeId?sessionToken&name` | Ends the billing session; returns `NormalizedLocation` |
| `GET /api/v1/locations/reverse-geocode?lat&lng&source=GPS\|MAP_PIN` | Returns `NormalizedLocation` |

Error bodies follow the global shape with a stable `code`:
`LOCATION_SERVICE_NOT_CONFIGURED`, `GOOGLE_API_UNAVAILABLE`,
`AUTOCOMPLETE_FAILED`, `PLACE_NOT_FOUND`, `GEOCODING_FAILED`,
`INVALID_COORDINATES`, `LOCATION_RATE_LIMITED`. Google's raw status and error
text are logged server-side only.

## Cost controls

- Clients debounce input (300 ms), require ≥ 2 characters, abort stale
  requests and cache results per session.
- One session token per search: autocomplete keystrokes + the single place
  details call are billed as one session; the token rotates after a pick.
- Place details request Essentials-tier fields only
  (`id, formattedAddress, addressComponents, location, types`).
- Backend TTL caches: place details 5 min, reverse geocode 10 min (coordinates
  rounded so GPS jitter reuses a lookup), with in-flight coalescing.
- Per-user rate limits per minute: autocomplete 120, details 40, reverse geocode 30.
- The web map only reverse-geocodes after the pin moves more than 8 m.

## Accuracy rules

- GPS accuracy above 100 m shows a warning and asks the user to confirm or adjust.
- Above 1000 m the coordinates are not saved silently: web asks for a pin
  adjustment, the customer app saves the address without coordinates, and the
  seller flows block the save until an exact address is chosen.
