import { NextResponse } from "next/server";
import {
  ATTENDANT_COOKIE,
  PIN_ATTEMPT_LIMIT,
  PIN_ATTEMPT_WINDOW_MS,
  attendantPin,
  attendantSessionToken,
  clientIp,
  pinMatches,
  rateLimitStatus,
  recordRateLimitFailure,
} from "@/lib/security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const pin = attendantPin();
  if (!pin) {
    return NextResponse.json({ error: "Attendant PIN is not configured." }, { status: 503 });
  }

  const bucket = `attendant-pin:${clientIp(req)}`;
  const limit = rateLimitStatus(bucket, PIN_ATTEMPT_LIMIT, PIN_ATTEMPT_WINDOW_MS);
  if (limit.blocked) {
    return NextResponse.json(
      { error: "Too many PIN attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let provided = "";
  try {
    const body = (await req.json()) as { pin?: unknown };
    if (typeof body.pin === "string") provided = body.pin;
  } catch {
    provided = "";
  }

  if (!pinMatches(provided)) {
    recordRateLimitFailure(bucket, PIN_ATTEMPT_WINDOW_MS);
    return NextResponse.json({ error: "Attendant PIN is incorrect." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ATTENDANT_COOKIE, attendantSessionToken(pin), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return res;
}
