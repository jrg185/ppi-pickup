import Link from "next/link";
import { notFound } from "next/navigation";
import { getImpound } from "@/lib/db";
import { computeFees, formatUSD } from "@/lib/fees";
import CheckoutForm from "./CheckoutForm";

export const dynamic = "force-dynamic";

export default function PickupDetails({ params }: { params: { id: string } }) {
  const impound = getImpound(params.id);
  if (!impound) notFound();
  if (impound.status === "released") {
    return (
      <div className="card">
        <h1 className="text-xl font-bold">Already released</h1>
        <p className="mt-2 text-sm text-valor-steel">
          This vehicle has already been picked up. If you believe this is in error, contact
          the lot.
        </p>
        <Link href="/" className="btn-secondary mt-4">
          Back to home
        </Link>
      </div>
    );
  }
  const fees = computeFees(impound);
  const towedAt = new Date(impound.towedAt).toLocaleString();

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Step 2 &middot; Confirm &amp; pay</h1>
          <span className="rounded-full bg-valor-navy/5 px-3 py-1 text-xs font-semibold text-valor-navy">
            {impound.id}
          </span>
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <dl>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-valor-steel">
              Vehicle
            </h2>
            <div className="kvp">
              <dt>Plate</dt>
              <dd className="font-mono">
                {impound.plate} ({impound.state})
              </dd>
            </div>
            <div className="kvp">
              <dt>VIN</dt>
              <dd className="font-mono text-xs">{impound.vin}</dd>
            </div>
            <div className="kvp">
              <dt>Year / Make / Model</dt>
              <dd>
                {impound.year} {impound.make} {impound.model}
              </dd>
            </div>
            <div className="kvp">
              <dt>Color</dt>
              <dd>{impound.color}</dd>
            </div>
          </dl>
          <dl>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-valor-steel">
              Tow
            </h2>
            <div className="kvp">
              <dt>Towed from</dt>
              <dd className="text-right">{impound.towedFrom}</dd>
            </div>
            <div className="kvp">
              <dt>Date</dt>
              <dd>{towedAt}</dd>
            </div>
            <div className="kvp">
              <dt>Currently at</dt>
              <dd className="text-right">
                {impound.lotName}
                <div className="text-xs text-valor-steel">{impound.lotAddress}</div>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-valor-steel">
          Fees
        </h2>
        <dl className="mt-2">
          <div className="kvp">
            <dt>Towing</dt>
            <dd>{formatUSD(fees.towing)}</dd>
          </div>
          <div className="kvp">
            <dt>Storage &times; {fees.storageDays} day{fees.storageDays === 1 ? "" : "s"}</dt>
            <dd>{formatUSD(fees.storage)}</dd>
          </div>
          <div className="kvp">
            <dt>Admin</dt>
            <dd>{formatUSD(fees.admin)}</dd>
          </div>
          <div className="flex items-baseline justify-between pt-3 text-base font-semibold">
            <dt>Total due</dt>
            <dd>{formatUSD(fees.total)}</dd>
          </div>
        </dl>
      </div>

      <CheckoutForm impoundId={impound.id} total={fees.total} />
    </div>
  );
}
