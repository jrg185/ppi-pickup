import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isDemoMode } from "@/lib/stripe";

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

function hostnameFromAuthority(authority: string): string | null {
  const trimmed = authority.trim();
  if (!trimmed) return null;
  try {
    return new URL(`http://${trimmed}`).hostname;
  } catch {
    return null;
  }
}

/**
 * Unpaid release codes are allowed only for loopback `next dev`.
 * Production, Vercel, and any non-local host fail closed.
 */
export function unpaidDemoReleaseAllowed(req: Request): boolean {
  if (!isDemoMode()) return false;
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.VERCEL) return false;

  const base = process.env.NEXT_PUBLIC_BASE_URL;
  if (base) {
    try {
      if (!isLoopbackHostname(new URL(base).hostname)) return false;
    } catch {
      return false;
    }
  }

  const authority = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const hostname = hostnameFromAuthority(authority);
  if (!hostname) return false;
  return isLoopbackHostname(hostname);
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

export function attendantSessionToken(pin: string): string {
  return createHmac("sha256", pin).update("valor-attendant-session-v1").digest("base64url");
}

export function isValidAttendantSession(token: string | undefined | null): boolean {
  const pin = attendantPin();
  if (!pin || !token) return false;
  return timingSafeEqualString(token, attendantSessionToken(pin));
}

export function pinMatches(provided: string): boolean {
  const pin = attendantPin();
  if (!pin) return false;
  return timingSafeEqualString(provided, pin);
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
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
