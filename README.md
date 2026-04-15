# Valor Vehicle Pickup Portal &mdash; Prototype

A working end-to-end prototype for self-service impound pickup:

1. Customer looks up their vehicle by plate / VIN / impound number
2. Uploads photo ID, proof of ownership (title or registration), proof of insurance
3. Pays via Stripe Checkout (test mode)
4. Receives a QR code + release code
5. Lot attendant scans the QR, reviews the uploaded documents, and marks the vehicle released

Scoped for **private-property impounds**. This is a demo, not production.

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>.

### Demo mode (no Stripe keys)

If `STRIPE_SECRET_KEY` is unset, the portal skips Stripe Checkout and jumps straight
from the payment form to the release QR. Best for live walkthroughs.

### With real Stripe test mode

1. Grab the test keys from <https://dashboard.stripe.com/test/apikeys>.
2. Put the secret key in `.env.local`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   NEXT_PUBLIC_BASE_URL=http://localhost:3000
   ```
3. Pay with card `4242 4242 4242 4242`, any future expiry, any CVC.

## Deploying to Vercel (recommended for cross-device demos)

The prototype uses a JSON file locally but automatically switches to Vercel KV
when `KV_REST_API_URL` is present, so the same code runs in both places.

### One-time setup

1. Push this branch to GitHub (already done if you&rsquo;re reading this).
2. Go to <https://vercel.com/new>, click **Import Git Repository**, pick this repo,
   and on the import screen select the branch `claude/vehicle-pickup-portal-084iJ`.
   Click **Deploy**.
3. The first deploy will succeed but the app won&rsquo;t be able to persist anything
   because KV isn&rsquo;t attached yet. That&rsquo;s expected &mdash; fix it next.
4. In your new project: **Storage &rarr; Create Database &rarr; KV** (or pick any
   Redis-compatible option from the marketplace). Connect it to this project.
   Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` into the env
   automatically.
5. Go to **Settings &rarr; Environment Variables** and add:
   - `NEXT_PUBLIC_BASE_URL` = your Vercel URL, e.g. `https://valor-pickup.vercel.app`
   - `ATTENDANT_PIN` = `8421` (or whatever you want to demo with)
   - `STRIPE_SECRET_KEY` = `sk_test_...` *(optional; omit to keep demo mode)*
6. Redeploy (**Deployments &rarr; latest &rarr; &hellip; &rarr; Redeploy**).
7. Hit <https://your-url/api/admin/reset> via curl to ensure the three demo
   vehicles are seeded (they&rsquo;re also seeded automatically on first lookup):
   ```bash
   curl -X POST https://your-url/api/admin/reset
   ```

You now have a public HTTPS URL. Open it on your laptop to run the customer
flow and on your phone to scan the QR and run the attendant flow.

### Resetting the hosted demo between runs

```bash
curl -X POST https://your-url/api/admin/reset
```

## Running the attendant side from your phone (local-only alternative)

If you&rsquo;d rather stay on your laptop, you can still get phone access on the
same Wi-Fi without deploying:

### 1. Find your Mac&rsquo;s LAN IP

```bash
ipconfig getifaddr en0
```

Output will look like `192.168.1.47`. (If that returns nothing, try `en1`.)

### 2. Tell the app to use it, and bind the server to your LAN

In `.env.local`:

```
NEXT_PUBLIC_BASE_URL=http://192.168.1.47:3000
```

Then start the server bound to all interfaces:

```bash
npm run dev -- -H 0.0.0.0
```

Now make sure your phone is on the same Wi-Fi. On your phone, visit
`http://192.168.1.47:3000` &mdash; you should see the portal. Then scanning the QR code
from your laptop screen will open the attendant verify page on your phone.

> Using Stripe test mode? Stripe will redirect back to `NEXT_PUBLIC_BASE_URL`, so
> change that too when switching between localhost and LAN IP.

## Demo script (3 minutes)

1. On your laptop, open <http://192.168.1.47:3000/> (or localhost if demoing on one
   screen). Click **Start pickup**.
2. Enter plate `7KLM342` &mdash; resolves to a 2019 Honda Civic with a live per-day fee
   breakdown.
3. Enter a name + phone.
4. Upload the three required documents (any photo from your phone works for the demo;
   images are compressed in the browser before upload).
5. Check the acknowledgement and click pay.
6. (Stripe mode only) complete checkout with `4242 4242 4242 4242`.
7. Success page shows the QR + release code like `ABCD-1234`.
8. On your phone, point the camera at the QR. Tap the notification &mdash; your phone
   opens the attendant verify page.
9. Enter PIN `8421`. The page shows the vehicle, who paid, payment timestamp, and
   thumbnails of all three uploaded documents. Tap any document to view full size.
10. Type a badge number in the "Your name or badge" field and tap **Release vehicle**.
11. The page flips to "Already redeemed". Trying to re-scan the QR shows the same.
    Going back to `/pickup` and re-looking-up the plate now rejects the vehicle as
    already released.

## Three demo vehicles

| Plate | Impound | Vehicle | Lot |
|-|-|-|-|
| `7KLM342` | `IMP-24081` | 2019 Honda Civic, Silver | Alexandria |
| `XTR-889` | `IMP-24082` | 2021 Tesla Model 3, White | Arlington |
| `GOVOL1` | `IMP-24083` | 2017 Ford F-150, Black  | Springfield |

Attendant PIN: `8421` (override with `ATTENDANT_PIN` in `.env.local`).

## Resetting the demo

In a second terminal:

```bash
curl -X POST http://localhost:3000/api/admin/reset
```

Clears all pending pickups and releases; impounds return to `awaiting`.

## What would still need to happen for production

- Replace the JSON store with Postgres; move release code issuance behind a signed
  `checkout.session.completed` webhook rather than the success page, to avoid the
  "customer closes the tab" edge case.
- SMS delivery of the QR (Twilio) so the release survives a lost browser session.
- Integration with Valor&rsquo;s dispatch / tow-ticket system for impound record lookup
  and fee sourcing.
- Attendant app hardening: offline-tolerant PWA, per-lot scoping, per-attendant SSO.
- Move document uploads out of JSON blobs into object storage (S3) with per-release
  signed URLs; set retention rules.
- Refund / chargeback / dispute flow.
- Structured audit log of every release event.

## File map

```
app/
  page.tsx                            landing
  pickup/page.tsx                     step 1: lookup
  pickup/[id]/page.tsx                step 2: review + upload + pay
  pickup/[id]/CheckoutForm.tsx        upload widget + submit
  pickup/success/page.tsx             step 3: QR + receipt
  attendant/page.tsx                  attendant console
  attendant/verify/page.tsx           release verify + redeem
  attendant/verify/DocThumb.tsx       tap-to-enlarge doc thumbnail
  api/
    lookup/route.ts
    checkout/route.ts
    release/redeem/route.ts
    admin/reset/route.ts
lib/
  db.ts       JSON-backed store (data/store.json, auto-seeded)
  fees.ts     fee breakdown + USD formatting
  codes.ts    release code generator
  stripe.ts   Stripe helper + demo-mode detection
  image.ts    client-side image compression
  types.ts
data/
  impounds.json   seed records
```
