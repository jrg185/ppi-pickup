# Valor Vehicle Pickup Portal &mdash; Prototype

A working end-to-end prototype for self-service impound pickup:

1. Customer looks up their vehicle by plate / VIN / impound number
2. Confirms fees and contact info
3. Pays via Stripe Checkout (test mode)
4. Receives a QR code + release code
5. Lot attendant scans the QR, verifies details, and marks the vehicle released

Scope is deliberately narrow for **private-property impounds**, where ID verification
and proof of ownership are minimal. This is a demo, not production.

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>.

### Demo mode (no Stripe keys)

If `STRIPE_SECRET_KEY` is unset, the portal skips Stripe Checkout and jumps straight
from the payment form to the release QR. This is useful for live walkthroughs.

### With real Stripe test mode

1. Create a Stripe account and grab the test keys from <https://dashboard.stripe.com/test/apikeys>.
2. Put the secret key in `.env.local`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   NEXT_PUBLIC_BASE_URL=http://localhost:3000
   ```
3. Use card `4242 4242 4242 4242` with any future expiry and any CVC on the Stripe page.

## Demo script (2 minutes)

1. Open <http://localhost:3000>, click **Start pickup**.
2. Enter plate `7KLM342` (or impound `IMP-24081`). The lookup resolves to a 2019 Honda
   Civic with line-item fees computed from days-in-storage.
3. Fill in a name + phone, check the acknowledgement, click pay.
4. (Stripe mode only) pay with the test card. You land on the success page with a QR
   and a human-readable release code like `ABCD-1234`.
5. On a phone (or a second tab), scan the QR &mdash; it opens the attendant verify page.
6. Enter the attendant PIN (default `8421`), review the match, type a badge number, and
   click **Release vehicle**.
7. The impound is marked released; re-visiting the QR shows "Already redeemed".

## Resetting the demo

```bash
curl -X POST http://localhost:3000/api/admin/reset
```

Clears all releases and returns impound records to `awaiting` state.

## What's wired up

- **Lookup** &mdash; `app/api/lookup/route.ts`, normalised plate/VIN/ID matching.
- **Fee calc** &mdash; `lib/fees.ts`, per-day storage + towing + admin.
- **Checkout** &mdash; `app/api/checkout/route.ts`, Stripe Checkout session with metadata.
- **Release issuance** &mdash; on successful Stripe session, or immediately in demo mode.
- **QR** &mdash; `qrcode` encodes an attendant-verify URL with the release code.
- **Attendant verify** &mdash; PIN-gated page showing vehicle/customer/payment details.
- **Redemption** &mdash; single-use, records attendant identity + timestamp.

## What would still need to happen for production

- Replace the JSON store with Postgres; move release code issuance behind a signed
  webhook (`stripe.checkout.session.completed`) rather than the success page, to avoid
  the "customer closes the tab" edge case.
- Add SMS delivery of the QR (Twilio) so the release survives a lost browser session.
- Integration with Valor&rsquo;s dispatch / tow-ticket system for impound record lookup
  and fee sourcing.
- Attendant app hardening: offline-tolerant PWA, camera-based scanner, per-lot scoping.
- Receipts, refund flow, chargeback handling.
- Retention/deletion policy for PII (customer name + phone).

## File map

```
app/
  page.tsx                  landing
  pickup/page.tsx           step 1: lookup
  pickup/[id]/page.tsx      step 2: review + pay
  pickup/success/page.tsx   step 3: QR + receipt
  attendant/page.tsx        attendant console
  attendant/verify/page.tsx release verify + redeem
  api/
    lookup/route.ts
    checkout/route.ts
    release/redeem/route.ts
    admin/reset/route.ts
lib/
  db.ts      JSON-backed store (data/store.json, auto-seeded)
  fees.ts    fee breakdown + USD formatting
  codes.ts   release code generator
  stripe.ts  Stripe helper + demo-mode detection
  types.ts
data/
  impounds.json   seed records
```
