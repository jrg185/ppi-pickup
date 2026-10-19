import { randomBytes } from "node:crypto";
import type Stripe from "stripe";
import { generateReleaseCode } from "@/lib/codes";
import {
  consumePendingPickup,
  createPendingPickup,
  createRelease,
  findActiveRelease,
  getPendingPickup,
  getReleaseBySession,
  releaseCheckout,
  reserveCheckout,
} from "@/lib/db";
import type { DocumentUploads, Impound } from "@/lib/types";

/**
 * Stripe rejects a Checkout `expires_at` sooner than 30 minutes. Stay above
 * that floor so unpaid sessions expire instead of lingering for the default
 * day. The vehicle is not locked for this interval.
 */
export const CHECKOUT_SESSION_TTL_SEC = 35 * 60;

export type PaidCheckoutSessionParams = {
  mode: "payment";
  payment_method_types: ["card"];
  payment_intent_data: { capture_method: "manual" };
  expires_at: number;
  line_items: Array<{
    quantity: number;
    price_data: {
      currency: "usd";
      unit_amount: number;
      product_data: { name: string; description: string };
    };
  }>;
  metadata: { pickupId: string; impoundId: string };
  success_url: string;
  cancel_url: string;
};

export type PaidSessionSnapshot = {
  id: string;
  paymentStatus: string;
  amountTotal: number | null;
  impoundId: string | null;
  pickupId: string | null;
  paymentIntent: {
    id: string;
    status: "requires_capture" | "succeeded" | "open";
    amount: number;
  } | null;
};

export type PaidCheckoutActions = {
  capture(paymentIntentId: string): Promise<void>;
  voidAuthorization(paymentIntentId: string): Promise<void>;
  refund(paymentIntentId: string): Promise<void>;
};

type Authorization = "none" | "hold" | "captured";

function authorizationState(session: PaidSessionSnapshot): Authorization {
  const status = session.paymentIntent?.status;
  if (status === "requires_capture") return "hold";
  if (status === "succeeded" || session.paymentStatus === "paid") return "captured";
  return "none";
}

/**
 * Stripe throws when a second success-page request captures a PaymentIntent
 * the first request already captured. That failure must not be treated as an
 * abandoned authorization.
 */
function authorizationAlreadyCaptured(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const record = err as {
    code?: unknown;
    message?: unknown;
    payment_intent?: { status?: unknown } | null;
    raw?: { payment_intent?: { status?: unknown } | null } | null;
  };
  const status = record.payment_intent?.status ?? record.raw?.payment_intent?.status;
  if (status === "succeeded") return true;
  if (record.code === "charge_already_captured") return true;
  if (record.code !== "payment_intent_unexpected_state") return false;
  const message = typeof record.message === "string" ? record.message : "";
  return /succeeded|already been captured|already captured/i.test(message);
}

/** Release code already issued to this Checkout Session, if any. */
async function releaseCodeForSession(
  sessionId: string,
  impoundId: string,
): Promise<string | null> {
  const bySession = await getReleaseBySession(sessionId);
  if (bySession) return bySession.code;
  const active = await findActiveRelease(impoundId);
  if (active?.stripeSessionId === sessionId) return active.code;
  return null;
}

let finalizeBarrier: (() => Promise<void>) | null = null;

/** Test-only pause so two success-page visits can overlap at a chosen point. */
export function setFinalizeBarrierForTests(
  barrier: (() => Promise<void>) | null,
): void {
  finalizeBarrier = barrier;
}

async function waitForFinalizeBarrier(): Promise<void> {
  if (finalizeBarrier) await finalizeBarrier();
}

function intentStatus(
  status: string,
): "requires_capture" | "succeeded" | "open" {
  if (status === "requires_capture" || status === "succeeded") return status;
  return "open";
}

export function paidSessionSnapshot(session: {
  id: string;
  payment_status: string;
  amount_total: number | null;
  metadata: Stripe.Metadata | null;
  payment_intent: Stripe.PaymentIntent | string | null;
}): PaidSessionSnapshot {
  const paymentIntent =
    session.payment_intent && typeof session.payment_intent !== "string"
      ? {
          id: session.payment_intent.id,
          status: intentStatus(session.payment_intent.status),
          amount: session.payment_intent.amount,
        }
      : null;
  return {
    id: session.id,
    paymentStatus: session.payment_status,
    amountTotal: session.amount_total,
    impoundId: session.metadata?.impoundId ?? null,
    pickupId: session.metadata?.pickupId ?? null,
    paymentIntent,
  };
}

/**
 * Open a Stripe Checkout session without reserving the impound. An unpaid
 * caller must not be able to block the vehicle.
 */
export async function startPaidCheckout(input: {
  impound: Impound;
  customerName: string;
  customerPhone: string;
  docs: DocumentUploads;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
  createSession: (params: PaidCheckoutSessionParams) => Promise<{ url: string | null }>;
}): Promise<{ url: string | null }> {
  const pickupId = `pickup_${randomBytes(12).toString("hex")}`;
  const impound = input.impound;
  await createPendingPickup({
    id: pickupId,
    impoundId: impound.id,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    docs: input.docs,
    createdAt: new Date().toISOString(),
  });

  try {
    return await input.createSession({
      mode: "payment",
      payment_method_types: ["card"],
      payment_intent_data: { capture_method: "manual" },
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SEC,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: input.amountCents,
            product_data: {
              name: `Valor impound release - ${impound.year} ${impound.make} ${impound.model}`,
              description: `Plate ${impound.plate} (${impound.state}) \u2022 Impound ${impound.id}`,
            },
          },
        },
      ],
      metadata: { pickupId, impoundId: impound.id },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
  } catch (err) {
    await consumePendingPickup(pickupId);
    throw err;
  }
}

async function settleUnusedAuthorization(
  session: PaidSessionSnapshot,
  auth: Exclude<Authorization, "none">,
  actions: PaidCheckoutActions,
  label: string,
): Promise<void> {
  const paymentIntentId = session.paymentIntent?.id;
  if (!paymentIntentId) return;
  try {
    if (auth === "hold") await actions.voidAuthorization(paymentIntentId);
    else await actions.refund(paymentIntentId);
  } catch (err) {
    console.error(label, err);
  }
}

/**
 * Claim the impound only after Stripe reports an authorization or a capture.
 * The first authorized pickup captures (if needed) and receives the release.
 * Any other authorized pickup for that vehicle is voided or refunded.
 */
export async function finalizePaidCheckout(
  session: PaidSessionSnapshot,
  actions: PaidCheckoutActions,
): Promise<string | null> {
  const existing = await getReleaseBySession(session.id);
  if (existing) return existing.code;

  const auth = authorizationState(session);
  if (auth === "none") return null;

  const pickupId = session.pickupId;
  const impoundId = session.impoundId;
  if (!pickupId || !impoundId) return null;

  await waitForFinalizeBarrier();

  const reserved = await reserveCheckout(impoundId, pickupId);
  if (reserved !== "reserved") {
    const owned = await releaseCodeForSession(session.id, impoundId);
    if (owned) return owned;
    await settleUnusedAuthorization(
      session,
      auth,
      actions,
      "Failed to release a duplicate card authorization",
    );
    return null;
  }

  await waitForFinalizeBarrier();

  const pending = await getPendingPickup(pickupId);
  if (!pending) {
    const owned = await releaseCodeForSession(session.id, impoundId);
    if (owned) return owned;
    await releaseCheckout(impoundId, pickupId);
    await settleUnusedAuthorization(
      session,
      auth,
      actions,
      "Failed to release an authorization with no pickup record",
    );
    return null;
  }

  let captured = auth === "captured";
  try {
    if (auth === "hold") {
      if (!session.paymentIntent) throw new Error("Missing payment intent.");
      await actions.capture(session.paymentIntent.id);
      captured = true;
    }

    const code = generateReleaseCode();
    const created = await createRelease(
      {
        code,
        impoundId,
        customerName: pending.customerName,
        customerPhone: pending.customerPhone,
        docs: pending.docs,
        amountPaidCents: session.amountTotal ?? session.paymentIntent?.amount ?? 0,
        paidAt: new Date().toISOString(),
        issuedAt: new Date().toISOString(),
        redeemedAt: null,
        redeemedBy: null,
        stripeSessionId: session.id,
        demo: false,
      },
      { pickupId },
    );
    if (created !== "created") {
      const again = await releaseCodeForSession(session.id, impoundId);
      await releaseCheckout(impoundId, pickupId);
      if (!again && captured) {
        await settleUnusedAuthorization(
          session,
          "captured",
          actions,
          "Failed to refund a checkout that did not receive a release",
        );
      }
      return again;
    }
    await consumePendingPickup(pickupId);
    return code;
  } catch (err) {
    const siblingCaptured = authorizationAlreadyCaptured(err);
    if (!siblingCaptured) {
      console.error("Failed to finalize an authorized checkout", err);
    }
    const owned = await releaseCodeForSession(session.id, impoundId);
    if (owned) return owned;
    // The sibling request captured this PaymentIntent and still holds the
    // lock while it writes the release. Dropping the lock lets that charge
    // be refunded or claimed by another pickup.
    if (!captured && !siblingCaptured) {
      await releaseCheckout(impoundId, pickupId);
    }
    return null;
  }
}
