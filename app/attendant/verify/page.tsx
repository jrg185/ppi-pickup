import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getImpound, getRelease } from "@/lib/db";
import { formatUSD } from "@/lib/fees";
import { ATTENDANT_COOKIE, attendantPin, isValidAttendantSession } from "@/lib/security";
import DocThumb from "./DocThumb";
import PinForm from "./PinForm";
import RedeemButton from "./RedeemButton";

export const dynamic = "force-dynamic";

type SearchParams = { code?: string; pin?: string };

export default async function AttendantVerify({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Old links put the PIN in the query string. Drop it before rendering so it
  // is not reflected into the page or the Next.js payload.
  if (typeof searchParams.pin === "string") {
    const cleaned = (searchParams.code ?? "").trim().toUpperCase();
    redirect(cleaned ? `/attendant/verify?code=${encodeURIComponent(cleaned)}` : "/attendant");
  }

  const code = (searchParams.code ?? "").toUpperCase();

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

  if (!attendantPin()) {
    return (
      <div className="card">
        <h1 className="text-xl font-bold">Attendant access is not configured</h1>
        <p className="mt-2 text-sm text-valor-steel">
          Set <span className="font-mono">ATTENDANT_PIN</span> before using this page. There is
          no default PIN.
        </p>
      </div>
    );
  }

  // PIN is posted to /api/attendant/session and kept in an httpOnly cookie.
  // A PIN in the query string is ignored so it never lives in the URL.
  const token = cookies().get(ATTENDANT_COOKIE)?.value;
  if (!isValidAttendantSession(token)) {
    return <PinForm code={code} />;
  }

  const release = await getRelease(code);
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
  const impound = await getImpound(release.impoundId);
  if (!impound) return null;

  const alreadyRedeemed = Boolean(release.redeemedAt) || impound.status === "released";

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
          {alreadyRedeemed ? "Already released" : "Valid release"}
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
          {release.redeemedAt && (
            <>
              <div className="kvp">
                <dt>Redeemed at</dt>
                <dd>{new Date(release.redeemedAt).toLocaleString()}</dd>
              </div>
              <div className="kvp">
                <dt>Redeemed by</dt>
                <dd>{release.redeemedBy}</dd>
              </div>
            </>
          )}
          {alreadyRedeemed && !release.redeemedAt && (
            <div className="kvp">
              <dt>Status</dt>
              <dd>Vehicle already released</dd>
            </div>
          )}
        </dl>

        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-valor-steel">
            Customer documents
          </h2>
          <p className="mt-1 text-xs text-valor-steel">
            Tap any image to view full size. Compare the ID photo to the person at the
            window and confirm the name matches the ownership document.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DocThumb label="Photo ID" src={release.docs.photoId} />
            <DocThumb label="Ownership" src={release.docs.ownership} />
          </div>
        </div>

        <div className="mt-4 rounded-md bg-amber-50 p-3 text-xs text-amber-900">
          <b>Before releasing:</b> confirm (1) the person at the window matches the photo
          ID, (2) the name on the ID matches the ownership document (title, registration,
          or insurance), and (3) the vehicle on the lot matches the plate and VIN above.
        </div>

        {!alreadyRedeemed && <RedeemButton code={release.code} />}
      </div>

      <div className="text-center">
        <Link href="/attendant" className="btn-secondary">
          Next customer
        </Link>
      </div>
    </div>
  );
}
