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
