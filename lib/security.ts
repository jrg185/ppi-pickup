import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isDemoMode } from "@/lib/stripe";
import { lookupAttendantSession, persistAttendantSession } from "@/lib/db";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Compare two strings without leaking length or content through timing. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return LOOPBACK_HOSTS.has(host);
}

/**
 * Explicit server opt-in for unpaid codes. Host and X-Forwarded-Host are not
 * consulted: both are chosen by the caller.
 */
function unpaidDemoOptIn(): boolean {
  const flag = process.env.ALLOW_UNPAID_DEMO?.trim().toLowerCase() ?? "";
  return flag === "1" || flag === "true";
}

/**
 * Unpaid release codes are allowed only when the server operator opts in for
 * loopback `next dev`. Production, Vercel, a configured Stripe key, and a
 * non-loopback base URL fail closed. The request is accepted so callers can
 * pass it through, and is ignored on purpose.
 */
export function unpaidDemoReleaseAllowed(_req: Request): boolean {
  if (!unpaidDemoOptIn()) return false;
  if (!isDemoMode()) return false;
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.VERCEL) return false;

  const base = process.env.NEXT_PUBLIC_BASE_URL;
  if (!base) return true;
  try {
    return isLoopbackHostname(new URL(base).hostname);
  } catch {
    return false;
  }
}

/** Reset is disabled unless ADMIN_RESET_SECRET is set and the header matches. */
export function adminResetAuthorized(provided: string | null): boolean {
  const secret = process.env.ADMIN_RESET_SECRET?.trim() ?? "";
  if (!secret) {
    timingSafeEqualString(provided ?? "", "disabled");
    return false;
  }
  return timingSafeEqualString(provided ?? "", secret);
}

/** Required attendant PIN. There is no default. */
export function attendantPin(): string | null {
  const pin = process.env.ATTENDANT_PIN?.trim() ?? "";
  return pin.length > 0 ? pin : null;
}

export const ATTENDANT_COOKIE = "valor_attendant";
export const ATTENDANT_SESSION_TTL_SEC = 8 * 60 * 60;

/** Opaque cookie value — 32 random bytes, not derived from the PIN. */
export function mintAttendantSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAttendantSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function issueAttendantSession(): Promise<string> {
  const token = mintAttendantSessionToken();
  await persistAttendantSession(hashAttendantSessionToken(token), ATTENDANT_SESSION_TTL_SEC);
  return token;
}

export async function isValidAttendantSession(
  token: string | undefined | null,
): Promise<boolean> {
  const pin = attendantPin();
  if (!pin || !token) return false;
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return false;
  return lookupAttendantSession(hashAttendantSessionToken(token));
}

export function pinMatches(provided: string): boolean {
  const pin = attendantPin();
  if (!pin) return false;
  return timingSafeEqualString(provided, pin);
}

type HeaderGetter = { get(name: string): string | null };

export function clientIpFromHeaders(h: HeaderGetter): string {
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}

export function clientIp(req: Request): string {
  return clientIpFromHeaders(req.headers);
}

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function pruneBuckets(now: number): void {
  if (buckets.size <= 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimitStatus(
  key: string,
  limit: number,
  windowMs: number,
): { blocked: boolean; retryAfterSec: number } {
  const now = Date.now();
  pruneBuckets(now);
  const cur = buckets.get(key);
  if (!cur || cur.resetAt <= now) return { blocked: false, retryAfterSec: 0 };
  if (cur.count >= limit) {
    return {
      blocked: true,
      retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)),
    };
  }
  return { blocked: false, retryAfterSec: 0 };
}

export function recordRateLimitFailure(key: string, windowMs: number): void {
  const now = Date.now();
  pruneBuckets(now);
  const cur = buckets.get(key);
  if (!cur || cur.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  cur.count += 1;
}

export const PIN_ATTEMPT_LIMIT = 5;
export const PIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

export function pinAttemptBucket(ip: string): string {
  return `attendant-pin:${ip}`;
}

export const CHECKOUT_IP_LIMIT = 20;
export const CHECKOUT_IMPOUND_LIMIT = 8;
export const CHECKOUT_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Count a checkout attempt against the caller and the impound.
 * The impound bucket does not depend on forwarded headers, so a spoofed
 * X-Forwarded-For cannot reset it.
 */
export function takeCheckoutRateLimit(
  ip: string,
  impoundId: string,
): { blocked: boolean; retryAfterSec: number } {
  const ipKey = `checkout-ip:${ip}`;
  const impoundKey = `checkout-impound:${impoundId}`;
  const ipStatus = rateLimitStatus(ipKey, CHECKOUT_IP_LIMIT, CHECKOUT_ATTEMPT_WINDOW_MS);
  if (ipStatus.blocked) return ipStatus;
  const impoundStatus = rateLimitStatus(
    impoundKey,
    CHECKOUT_IMPOUND_LIMIT,
    CHECKOUT_ATTEMPT_WINDOW_MS,
  );
  if (impoundStatus.blocked) return impoundStatus;
  recordRateLimitFailure(ipKey, CHECKOUT_ATTEMPT_WINDOW_MS);
  recordRateLimitFailure(impoundKey, CHECKOUT_ATTEMPT_WINDOW_MS);
  return { blocked: false, retryAfterSec: 0 };
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}
