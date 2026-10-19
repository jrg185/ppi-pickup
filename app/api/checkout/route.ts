import { NextResponse } from "next/server";
import { startPaidCheckout } from "@/lib/checkout";
import { createRelease, findActiveRelease, getCheckoutLock, getImpound } from "@/lib/db";
import { computeFees } from "@/lib/fees";
import { generateReleaseCode } from "@/lib/codes";
import { baseUrl, createCheckoutSession, getStripe } from "@/lib/stripe";
import {
  clientIp,
  takeCheckoutRateLimit,
  unpaidDemoReleaseAllowed,
} from "@/lib/security";
import type { DocumentUploads } from "@/lib/types";

export const dynamic = "force-dynamic";
// Base64 docs can push request bodies past default limits; lift it.
export const maxDuration = 60;

type Body = {
  impoundId?: string;
  name?: string;
  phone?: string;
  docs?: Partial<DocumentUploads>;
};

function validDocs(docs: Body["docs"]): docs is DocumentUploads {
  if (!docs) return false;
  const keys: Array<keyof DocumentUploads> = ["photoId", "ownership"];
  return keys.every(
    (k) => typeof docs[k] === "string" && (docs[k] as string).startsWith("data:image/"),
  );
}

export async function POST(req: Request) {
  const { impoundId, name, phone, docs } = (await req.json()) as Body;
  if (!impoundId || !name || !phone) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }
  if (!validDocs(docs)) {
    return NextResponse.json(
      { error: "Both required document images must be uploaded." },
      { status: 400 },
    );
  }
  const impound = await getImpound(impoundId);
  if (!impound) {
    return NextResponse.json({ error: "Impound not found." }, { status: 404 });
  }
  if (impound.status === "released") {
    return NextResponse.json({ error: "Vehicle already released." }, { status: 409 });
  }
  const active = await findActiveRelease(impound.id);
  if (active) {
    return NextResponse.json(
      { error: "A release code has already been issued for this vehicle." },
      { status: 409 },
    );
  }
  // A lock exists only while an authorized payment is being finalized.
  if (await getCheckoutLock(impound.id)) {
    return NextResponse.json(
      { error: "A payment is already in progress for this vehicle." },
      { status: 409 },
    );
  }

  const limited = takeCheckoutRateLimit(clientIp(req), impound.id);
  if (limited.blocked) {
    return NextResponse.json(
      { error: "Too many checkout attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  const fees = computeFees(impound);

  // Unpaid demo codes require an explicit server flag. Public and production
  // deploys must not mint a release without a verified payment.
  if (!process.env.STRIPE_SECRET_KEY) {
    if (!unpaidDemoReleaseAllowed(req)) {
      return NextResponse.json(
        { error: "Payment is required before a release code can be issued." },
        { status: 403 },
      );
    }
    const code = generateReleaseCode();
    const created = await createRelease({
      code,
      impoundId: impound.id,
      customerName: name,
      customerPhone: phone,
      docs,
      amountPaidCents: fees.total,
      paidAt: new Date().toISOString(),
      issuedAt: new Date().toISOString(),
      redeemedAt: null,
      redeemedBy: null,
      stripeSessionId: null,
      demo: true,
    });
    if (created === "active_exists") {
      return NextResponse.json(
        { error: "A release code has already been issued for this vehicle." },
        { status: 409 },
      );
    }
    if (created !== "created") {
      return NextResponse.json({ error: "Vehicle already released." }, { status: 409 });
    }
    return NextResponse.json({ code });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Payment processor misconfigured." }, { status: 500 });
  }

  const session = await startPaidCheckout({
    impound,
    customerName: name,
    customerPhone: phone,
    docs,
    amountCents: fees.total,
    successUrl: `${baseUrl()}/pickup/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${baseUrl()}/pickup/${impound.id}`,
    createSession: (params) => createCheckoutSession(params),
  });

  return NextResponse.json({ url: session.url });
}
