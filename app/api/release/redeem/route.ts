import { NextResponse } from "next/server";
import { redeemRelease } from "@/lib/db";
import {
  ATTENDANT_COOKIE,
  attendantPin,
  isValidAttendantSession,
  readCookie,
} from "@/lib/security";

export const dynamic = "force-dynamic";

type Body = { code?: string; attendant?: string };

export async function POST(req: Request) {
  if (!attendantPin()) {
    return NextResponse.json({ error: "Attendant PIN is not configured." }, { status: 503 });
  }
  if (!isValidAttendantSession(readCookie(req, ATTENDANT_COOKIE))) {
    return NextResponse.json({ error: "Attendant PIN is required." }, { status: 401 });
  }

  const { code, attendant } = (await req.json()) as Body;
  if (!code || !attendant?.trim()) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }

  const result = await redeemRelease(code, attendant.trim());
  if (result.status === "not_found") {
    return NextResponse.json({ error: "Release not found." }, { status: 404 });
  }
  if (result.status === "already_released") {
    return NextResponse.json(
      { error: "This vehicle has already been released." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, release: result.release });
}
