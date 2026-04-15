import Link from "next/link";
import { getImpound, getRelease } from "@/lib/db";
import { formatUSD } from "@/lib/fees";
import RedeemButton from "./RedeemButton";

export const dynamic = "force-dynamic";

type SearchParams = { code?: string; pin?: string };

function attendantPin(): string {
  return process.env.ATTENDANT_PIN ?? "8421";
}

export default function AttendantVerify({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const code = (searchParams.code ?? "").toUpperCase();
  const pin = searchParams.pin ?? "";
  const requiredPin = attendantPin();

  if (!code) {
    return (
      <div className="card">
        <h1 className="text-xl font-bold">No code provided</h1>
        <Link href="/attendant" className="btn-secondary mt-4">
          Back
        </Link>
      </div>
    );
  }

  // Gentle PIN gate. If the attendant opened from a QR scan without a PIN,
  // prompt them here instead of rejecting outright.
  if (pin !== requiredPin) {
    return (
      <form action="/attendant/verify" className="card space-y-4">
        <h1 className="text-xl font-bold">Attendant PIN required</h1>
        <p className="text-sm text-valor-steel">
          Enter the lot attendant PIN to view release details for <b>{code}</b>.
        </p>
        <input type="hidden" name="code" value={code} />
        <div>
          <label htmlFor="pin" className="label">
            PIN
          </label>
          <input
            id="pin"
            name="pin"
            className="input"
            inputMode="numeric"
            pattern="[0-9]*"
            autoFocus
            required
          />
        </div>
        <button type="submit" className="btn-primary w-full justify-center">
          Continue
        </button>
      </form>
    );
  }

  const release = getRelease(code);
  if (!release) {
    return (
      <div className="card">
        <h1 className="text-xl font-bold text-red-700">Invalid release code</h1>
        <p className="mt-2 text-sm text-valor-steel">
          No release exists for <span className="font-mono">{code}</span>. The customer may
          have mistyped it, or the payment was never completed.
        </p>
        <Link href="/attendant" className="btn-secondary mt-4">
          Try another code
        </Link>
      </div>
    );
  }
  const impound = getImpound(release.impoundId);
  if (!impound) return null;

  const alreadyRedeemed = Boolean(release.redeemedAt);

  return (
    <div className="space-y-6">
      <div
        className={`card border-2 ${
          alreadyRedeemed ? "border-amber-400" : "border-emerald-500"
        }`}
      >
        <div
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
            alreadyRedeemed
              ? "bg-amber-50 text-amber-700"
              : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {alreadyRedeemed ? "Already redeemed" : "Valid release"}
        </div>
        <h1 className="mt-3 text-2xl font-bold">
          {impound.year} {impound.make} {impound.model}
        </h1>
        <p className="text-sm text-valor-steel">
          Plate <b className="font-mono">{impound.plate}</b> &middot; {impound.color} &middot;{" "}
          VIN <span className="font-mono">{impound.vin}</span>
        </p>

        <dl className="mt-6">
          <div className="kvp">
            <dt>Released to</dt>
            <dd>{release.customerName}</dd>
          </div>
          <div className="kvp">
            <dt>Phone</dt>
            <dd className="font-mono">{release.customerPhone}</dd>
          </div>
          <div className="kvp">
            <dt>Paid</dt>
            <dd>{formatUSD(release.amountPaidCents)}</dd>
          </div>
          <div className="kvp">
            <dt>Paid at</dt>
            <dd>{new Date(release.paidAt).toLocaleString()}</dd>
          </div>
          <div className="kvp">
            <dt>Impound</dt>
            <dd className="font-mono">{impound.id}</dd>
          </div>
          {alreadyRedeemed && (
            <>
              <div className="kvp">
                <dt>Redeemed at</dt>
                <dd>{new Date(release.redeemedAt!).toLocaleString()}</dd>
              </div>
              <div className="kvp">
                <dt>Redeemed by</dt>
                <dd>{release.redeemedBy}</dd>
              </div>
            </>
          )}
        </dl>

        <div className="mt-4 rounded-md bg-amber-50 p-3 text-xs text-amber-900">
          <b>Before releasing:</b> confirm the vehicle on the lot matches the plate and VIN
          above. Photograph the driver&rsquo;s license at the window per Valor SOP.
        </div>

        {!alreadyRedeemed && <RedeemButton code={release.code} pin={pin} />}
      </div>

      <div className="text-center">
        <Link href="/attendant" className="btn-secondary">
          Next customer
        </Link>
      </div>
    </div>
  );
}
