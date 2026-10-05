# Valor PPI Vehicle Pickup Portal — Build Specification

## Overview

A self-service web portal for customers retrieving vehicles impounded from private property (PPI). The customer completes the entire pickup process online — vehicle lookup, document upload, fee payment — and receives a QR code. The lot attendant scans the QR, reviews the documents, and releases the vehicle. The goal is to replace the current multi-step in-person process with a ~2-minute phone flow.

## Scope

- **Private-property impounds only.** ID verification and proof-of-ownership requirements are minimal compared to police/municipal impounds.
- **Prototype quality** suitable for team presentation and live demo, not production hardening.

---

## User Flows

### Customer Flow

1. **Landing page** — explains the process, lists what documents to have ready, provides a "Start pickup" button.
2. **Vehicle lookup** — customer enters license plate, VIN, or impound number. System does a normalized fuzzy match (case-insensitive, ignores dashes/spaces). Returns vehicle details or a clear error.
3. **Review & upload** — single page showing:
   - Vehicle details (year/make/model/color, plate, VIN)
   - Tow details (towed from, date, current lot name + address)
   - Itemized fee breakdown: towing + per-day storage × days elapsed + admin fee
   - Customer info form: full name, mobile phone
   - **Two document uploads:**
     - Government-issued photo ID (driver's license, passport, state ID)
     - Proof of ownership (title, current registration, **or** insurance card — insurance qualifies as proof of ownership for PPI)
   - Acknowledgement checkbox
   - Pay button (disabled until both docs uploaded + checkbox checked)
4. **Payment** — Stripe Checkout (test mode). A release code is created only after Stripe reports the session as paid. Unpaid demo issuance is refused on production, Vercel, and any non-loopback host. Loopback `next dev` may still issue a demo code when `STRIPE_SECRET_KEY` is unset.
5. **Success page** — displays:
   - QR code encoding a URL to the attendant verification page
   - Human-readable release code (e.g., `ABCD-1234`) as fallback
   - Receipt summary (vehicle, lot, amount paid, customer name)

### Attendant Flow

1. **Attendant console** (`/attendant`) — text input for release code + attendant PIN. QR codes issued to customers encode a direct URL to the verify page, so scanning with a phone camera opens it directly.
2. **PIN gate** — shared PIN from `ATTENDANT_PIN`. There is no default; if the variable is unset the console stays locked. The PIN is submitted with POST to `/api/attendant/session` and stored in an httpOnly cookie. It is never put in the URL. If a `pin` query parameter is present, middleware redirects to the same page without it. Failed attempts are rate limited.
3. **Verify page** — shows:
   - Vehicle details (plate, VIN, year/make/model/color)
   - Customer name, phone, payment amount, payment timestamp
   - **Two document thumbnails** (Photo ID + Ownership) — tap to view full size
   - Yellow SOP reminder: "Before releasing: confirm (1) person matches photo ID, (2) name on ID matches ownership document, (3) vehicle on lot matches plate and VIN"
   - Attendant name/badge input + "Release vehicle" button
4. **Redemption** — one active (unredeemed) release per impound. A second code is not issued while one is outstanding or after the impound is released. Redeem rejects a code that was already redeemed and rejects any code once the vehicle is released. After release, the page shows "Already released" with who released it and when. Re-scanning the QR or re-looking-up the plate shows the vehicle as already released.

### Admin

- `POST /api/admin/reset` — clears all releases and pending pickups, resets impound records to `awaiting` status. Requires header `X-Admin-Secret` matching `ADMIN_RESET_SECRET` (timing-safe compare). If the secret is unset, every call is rejected and nothing is deleted.

---

## Technical Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | Next.js 14 (App Router) | TypeScript, React Server Components |
| Styling | Tailwind CSS | Custom color palette: `valor-navy`, `valor-steel`, `valor-accent`, `valor-bg` |
| Payments | Stripe Checkout | Test mode. Unpaid demo codes only on loopback dev; public deploys fail closed |
| QR codes | `qrcode` npm package | Server-side generation as data URL |
| Storage (local) | JSON file (`data/store.json`) | Auto-seeded from `data/impounds.json` |
| Storage (Vercel) | Vercel KV (Upstash Redis) | Activated when `KV_REST_API_URL` env var is present |
| Image compression | Client-side canvas | Max 1200px long edge, JPEG q=0.72, keeps each doc ~150-250 KB |
| Deployment | Vercel | Free tier, auto-deploys from GitHub |

---

## Data Model

### Impound
```typescript
type Impound = {
  id: string;           // e.g., "IMP-24081"
  plate: string;
  state: string;
  vin: string;
  year: number;
  make: string;
  model: string;
  color: string;
  lotName: string;
  lotAddress: string;
  towedFrom: string;
  towedAt: string;      // ISO datetime
  fees: {
    towing: number;     // cents
    storageDaily: number; // cents per day
    admin: number;      // cents
  };
  status: "awaiting" | "released";
};
```

### DocumentUploads
```typescript
type DocumentUploads = {
  photoId: string;    // base64 data URL (compressed JPEG)
  ownership: string;  // base64 data URL (compressed JPEG)
};
```

### Release
```typescript
type Release = {
  code: string;              // e.g., "ABCD-1234"
  impoundId: string;
  customerName: string;
  customerPhone: string;
  docs: DocumentUploads;
  amountPaidCents: number;
  paidAt: string;
  issuedAt: string;
  redeemedAt: string | null;
  redeemedBy: string | null;
  stripeSessionId: string | null;
  demo: boolean;
};
```

### PendingPickup
Used to persist customer info + docs across the Stripe Checkout redirect:
```typescript
type PendingPickup = {
  id: string;
  impoundId: string;
  customerName: string;
  customerPhone: string;
  docs: DocumentUploads;
  createdAt: string;
};
```

---

## Fee Calculation

- Storage is billed per calendar day, tow date = day 1.
- `storageDays = max(1, ceil((now - towedAt) / MS_PER_DAY))`
- `total = towing + (storageDaily × storageDays) + admin`
- All values in cents. Display as USD with `formatUSD()`.

---

## Release Code Format

- 8 characters, split as `XXXX-XXXX`
- Alphabet excludes ambiguous characters: `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O, 1/I/L)
- Generated with `crypto.getRandomValues` when available

---

## Dual Storage Backend

The data layer (`lib/db.ts`) must support two backends behind the same async interface:

1. **File backend** (local dev): reads/writes `data/store.json`. Auto-seeds from `data/impounds.json` on first access.
2. **Vercel KV backend** (production): activated when `KV_REST_API_URL` is set. Uses these key patterns:
   - `valor:impounds` — full impound array
   - `valor:release:<CODE>` — release metadata (without docs)
   - `valor:release_docs:<CODE>` — document uploads (split from release to stay under 1 MB per-key Upstash limit)
   - `valor:release_by_session:<SESSION_ID>` — maps Stripe session to release code
   - `valor:release_codes` — set of all release codes (for reset cleanup)
   - `valor:active_release:<IMPOUND_ID>` — code of the single unredeemed release for that impound
   - `valor:pending:<ID>` — pending pickup (1-hour TTL)
   - `valor:pending_ids` — set of pending IDs
   - `valor:seeded` — boolean flag for auto-seeding

All public db functions are async. The backend is chosen at call time via `Boolean(process.env.KV_REST_API_URL)`.

---

## Stripe Integration

- Uses Stripe Checkout (hosted page), not Elements.
- `mode: "payment"`, single line item with the total fee.
- Metadata carries `pickupId` and `impoundId`.
- Success URL: `/pickup/success?session_id={CHECKOUT_SESSION_ID}`
- Cancel URL: `/pickup/{impoundId}` (back to the review page)
- On the success page, the app retrieves the Stripe session, confirms `payment_status === "paid"`, consumes the pending pickup, and creates the release. Creation is refused when that impound already has an active release or is already released.
- **Local demo**: when `STRIPE_SECRET_KEY` is unset, checkout may create a release immediately only if the process is not production, not Vercel, and the request host is loopback. Otherwise checkout returns an error and does not issue a code.

---

## Image Handling

- Client-side compression before upload (not server-side).
- `createImageBitmap(file)` → draw to canvas at max 1200px long edge → `canvas.toDataURL("image/jpeg", 0.72)`
- Typical output: 150-250 KB per document
- File inputs use `accept="image/*"` (no `capture` attribute — let the OS show the camera/library/file chooser)
- Compressed data URLs are sent as JSON in the checkout POST body

---

## Seed Data

Three demo vehicles for testing:

| Plate | Impound # | Vehicle | Lot |
|-------|-----------|---------|-----|
| `7KLM342` | `IMP-24081` | 2019 Honda Civic, Silver | Valor Lot 2 - Alexandria |
| `XTR-889` | `IMP-24082` | 2021 Tesla Model 3, White | Valor Lot 1 - Arlington |
| `GOVOL1` | `IMP-24083` | 2017 Ford F-150, Black | Valor Lot 3 - Springfield |

Fee structure per vehicle: towing ($195-210), storage ($65-75/day), admin ($25).

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STRIPE_SECRET_KEY` | Yes on public deploys | unset allows unpaid codes on loopback dev only | Stripe test secret key |
| `STRIPE_PUBLISHABLE_KEY` | No | — | Not currently used (Checkout is server-side redirect) |
| `NEXT_PUBLIC_BASE_URL` | Yes (Vercel) | `http://localhost:3000` | Used for QR code URLs and Stripe redirects. A non-local value disables unpaid demo codes |
| `ATTENDANT_PIN` | Yes | (none) | Attendant PIN. No default. Submitted via POST, never in the URL |
| `ADMIN_RESET_SECRET` | Yes to reset | (unset disables reset) | Compared timing-safely to the `X-Admin-Secret` header |
| `KV_REST_API_URL` | Auto (Vercel) | — | Injected by Vercel when KV is attached |
| `KV_REST_API_TOKEN` | Auto (Vercel) | — | Injected by Vercel when KV is attached |

---

## Route Map

```
app/
  page.tsx                            Landing page
  pickup/page.tsx                     Step 1: vehicle lookup (client component)
  pickup/[id]/page.tsx                Step 2: review + upload + pay (server component)
  pickup/[id]/CheckoutForm.tsx        Upload widget + submit (client component)
  pickup/success/page.tsx             Step 3: QR + receipt (server component)
  attendant/page.tsx                  Attendant console (client component)
  attendant/verify/page.tsx           Release verify + redeem (server component)
  attendant/verify/DocThumb.tsx       Tap-to-enlarge doc thumbnail (client component)
  attendant/verify/RedeemButton.tsx   Release button (client component)
  api/
    lookup/route.ts                   POST: find impound by plate/VIN/ID
    checkout/route.ts                 POST: create Stripe session; unpaid demo only on loopback dev
    release/redeem/route.ts           POST: mark release as redeemed (rejects already released)
    attendant/session/route.ts        POST: check attendant PIN, set httpOnly cookie
    admin/reset/route.ts              POST: reset all data; requires X-Admin-Secret
lib/
  db.ts        Dual-backend storage (file + Vercel KV)
  fees.ts      Fee calculation + USD formatting
  codes.ts     Release code generator
  stripe.ts    Stripe client + demo-mode detection
  security.ts  timing-safe secret compare, public demo gate, PIN session + rate limit
  image.ts     Client-side image compression utility
middleware.ts  Redirects /attendant/verify?pin=... to the same path without pin
  types.ts     TypeScript types
data/
  impounds.json   Seed records (3 demo vehicles)
```

---

## UI Design Notes

- Mobile-first (most customers will use this from a phone in a parking lot)
- Color palette: navy (`#0b1f3a`), steel (`#2c3e5d`), gold accent (`#c8a24b`), light bg (`#f5f7fa`)
- Component classes defined in `globals.css`: `.btn-primary`, `.btn-secondary`, `.card`, `.label`, `.input`, `.kvp` (key-value pair row)
- QR codes render in navy-on-white for contrast
- Attendant verify page uses green border for valid releases, amber for already-redeemed
- Document thumbnails use a tap-to-enlarge full-screen overlay

---

## Deployment (Vercel)

1. Push repo to GitHub.
2. Import into Vercel (vercel.com/new).
3. In Vercel project: Storage → Create Database → KV. Connect to project.
4. Settings → Environment Variables: set `NEXT_PUBLIC_BASE_URL` to the Vercel URL.
5. Redeploy.
6. Impounds seed on first lookup. `POST /api/admin/reset` with header `X-Admin-Secret` only works when `ADMIN_RESET_SECRET` is set; unauthenticated calls are rejected.

---

## What This Prototype Does NOT Include (Production Backlog)

- Real database (Postgres) instead of JSON file / KV
- Stripe webhook (`checkout.session.completed`) for bulletproof release issuance
- SMS delivery of the QR code (Twilio)
- Integration with tow management systems (TOPS, Tow Magic, RanSoft, etc.)
- Attendant PWA with offline scanning support
- Per-attendant auth (SSO) instead of shared PIN
- Object storage (S3) for documents with signed URLs and retention policies
- Structured audit logging
- Refund / chargeback / dispute flow
- Multilingual support
- Admin dashboard with release history and reporting
