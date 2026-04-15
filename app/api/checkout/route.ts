import { NextResponse } from "next/server";
import { createRelease, getImpound } from "@/lib/db";
import { computeFees } from "@/lib/fees";
import { generateReleaseCode } from "@/lib/codes";
import { baseUrl, getStripe, isDemoMode } from "@/lib/stripe";

export const dynamic = "force-dynamic";

type Body = { impoundId?: string; name?: string; phone?: string };

export async function POST(req: Request) {
  const { impoundId, name, phone } = (await req.json()) as Body;
  if (!impoundId || !name || !phone) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }
  const impound = getImpound(impoundId);
  if (!impound) {
    return NextResponse.json({ error: "Impound not found." }, { status: 404 });
  }
  if (impound.status === "released") {
    return NextResponse.json({ error: "Vehicle already released." }, { status: 409 });
  }
  const fees = computeFees(impound);

  // Demo mode: skip Stripe, issue the release immediately.
  if (isDemoMode()) {
    const code = generateReleaseCode();
    createRelease({
      code,
      impoundId: impound.id,
      customerName: name,
      customerPhone: phone,
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
    customer_email: undefined,
    metadata: {
      impoundId: impound.id,
      customerName: name,
      customerPhone: phone,
    },
    success_url: `${baseUrl()}/pickup/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl()}/pickup/${impound.id}`,
  });

  return NextResponse.json({ url: session.url });
}
