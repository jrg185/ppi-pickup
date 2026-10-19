import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (_stripe) return _stripe;
  _stripe = new Stripe(key, { apiVersion: "2024-06-20" });
  return _stripe;
}

export function isDemoMode(): boolean {
  return !process.env.STRIPE_SECRET_KEY;
}

export function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
}

type CheckoutSessionFactory = (
  params: Stripe.Checkout.SessionCreateParams,
) => Promise<{ url: string | null }>;

let testSessionFactory: CheckoutSessionFactory | null = null;

/** Test-only. Production leaves this unset so sessions are created at Stripe. */
export function setCheckoutSessionFactoryForTests(factory: CheckoutSessionFactory | null): void {
  testSessionFactory = factory;
}

export async function createCheckoutSession(
  params: Stripe.Checkout.SessionCreateParams,
): Promise<{ url: string | null }> {
  if (testSessionFactory) return testSessionFactory(params);
  const stripe = getStripe();
  if (!stripe) throw new Error("Payment processor misconfigured.");
  const session = await stripe.checkout.sessions.create(params);
  return { url: session.url };
}
