import { NextResponse } from "next/server";
import { createPendingPickup, createRelease, getImpound } from "@/lib/db";
import { computeFees } from "@/lib/fees";
import { generateReleaseCode } from "@/lib/codes";
import { baseUrl, getStripe, isDemoMode } from "@/lib/stripe";
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
  const keys: Array<keyof DocumentUploads> = ["photoId", "ownership", "insurance"];
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
      { error: "All three required document images must be uploaded." },
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
  const fees = computeFees(impound);

  // Demo mode: skip Stripe, issue the release immediately (with docs attached).
  if (isDemoMode()) {
    const code = generateReleaseCode();
    await createRelease({
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
    return NextResponse.json({ code });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Payment processor misconfigured." }, { status: 500 });
  }

  // Stash docs server-side keyed by a pickupId; attach id to the Stripe session
  // metadata so the success page can finalize the release.
  const pickupId = `pickup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await createPendingPickup({
    id: pickupId,
    impoundId: impound.id,
    customerName: name,
    customerPhone: phone,
    docs,
    createdAt: new Date().toISOString(),
  });

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: fees.total,
          product_data: {
            name: `Valor impound release - ${impound.year} ${impound.make} ${impound.model}`,
            description: `Plate ${impound.plate} (${impound.state}) \u2022 Impound ${impound.id}`,
          },
        },
      },
    ],
    metadata: { pickupId, impoundId: impound.id },
    success_url: `${baseUrl()}/pickup/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl()}/pickup/${impound.id}`,
  });

  return NextResponse.json({ url: session.url });
}
