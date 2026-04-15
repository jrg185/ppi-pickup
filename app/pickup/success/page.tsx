import Link from "next/link";
import QRCode from "qrcode";
import {
  consumePendingPickup,
  createRelease,
  getImpound,
  getRelease,
  getReleaseBySession,
} from "@/lib/db";
import { computeFees, formatUSD } from "@/lib/fees";
import { generateReleaseCode } from "@/lib/codes";
import { baseUrl, getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

type SearchParams = { code?: string; session_id?: string };

async function resolveCode(sp: SearchParams): Promise<string | null> {
  if (sp.code) return sp.code.toUpperCase();
  if (!sp.session_id) return null;

  // Idempotent: if we've already minted a release for this session, return it.
  const existing = await getReleaseBySession(sp.session_id);
  if (existing) return existing.code;

  const stripe = getStripe();
  if (!stripe) return null;
  const session = await stripe.checkout.sessions.retrieve(sp.session_id);
  if (session.payment_status !== "paid") return null;

  const pickupId = session.metadata?.pickupId;
  const impoundId = session.metadata?.impoundId;
  if (!pickupId || !impoundId) return null;
  const pending = await consumePendingPickup(pickupId);
  if (!pending) return null;

  const code = generateReleaseCode();
  await createRelease({
    code,
    impoundId,
    customerName: pending.customerName,
    customerPhone: pending.customerPhone,
    docs: pending.docs,
    amountPaidCents: session.amount_total ?? 0,
    paidAt: new Date().toISOString(),
    issuedAt: new Date().toISOString(),
    redeemedAt: null,
    redeemedBy: null,
    stripeSessionId: session.id,
    demo: false,
  });
  return code;
}

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const code = await resolveCode(searchParams);
  if (!code) {
    return (
      <div className="card">
        <h1 className="text-xl font-bold">We couldn&rsquo;t confirm your payment</h1>
        <p className="mt-2 text-sm text-valor-steel">
          If you were charged, please contact the lot with your confirmation email.
        </p>
        <Link href="/" className="btn-secondary mt-4">
          Back to home
        </Link>
      </div>
    );
  }

  const release = await getRelease(code);
  if (!release) {
    return (
      <div className="card">
        <h1 className="text-xl font-bold">Release not found</h1>
        <Link href="/" className="btn-secondary mt-4">
          Back to home
        </Link>
      </div>
    );
  }
  const impound = await getImpound(release.impoundId);
  if (!impound) return null;

  const verifyUrl = `${baseUrl()}/attendant/verify?code=${encodeURIComponent(code)}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
    width: 320,
    margin: 1,
    color: { dark: "#0b1f3a", light: "#ffffff" },
  });
  const fees = computeFees(impound);

  return (
    <div className="space-y-6">
      <div className="card text-center">
        <div className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          Payment received
        </div>
        <h1 className="mt-3 text-2xl font-bold">Show this at the lot</h1>
        <p className="mt-1 text-sm text-valor-steel">
          The attendant will scan this code and release your vehicle.
        </p>
        <div className="mt-6 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="Release QR code" className="h-64 w-64" />
        </div>
        <div className="mt-4 font-mono text-2xl tracking-widest text-valor-navy">
          {code}
        </div>
        <p className="mt-1 text-xs text-valor-steel">
          You can also read this code aloud if the scanner fails.
        </p>
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-valor-steel">
          Receipt
        </h2>
        <dl className="mt-2">
          <div className="kvp">
            <dt>Vehicle</dt>
            <dd>
              {impound.year} {impound.make} {impound.model} &middot; {impound.plate}
            </dd>
          </div>
          <div className="kvp">
            <dt>Lot</dt>
            <dd className="text-right">
              {impound.lotName}
              <div className="text-xs text-valor-steel">{impound.lotAddress}</div>
            </dd>
          </div>
          <div className="kvp">
            <dt>Paid</dt>
            <dd>{formatUSD(release.amountPaidCents || fees.total)}</dd>
          </div>
          <div className="kvp">
            <dt>Released to</dt>
            <dd>{release.customerName}</dd>
          </div>
          {release.demo && (
            <div className="kvp">
              <dt>Mode</dt>
              <dd className="text-amber-700">Demo (Stripe disabled)</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="text-center">
        <Link href="/" className="btn-secondary">
          Done
        </Link>
      </div>
    </div>
  );
}
