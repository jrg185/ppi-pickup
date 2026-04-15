import { NextResponse } from "next/server";
import { redeemRelease } from "@/lib/db";

export const dynamic = "force-dynamic";

type Body = { code?: string; pin?: string; attendant?: string };

export async function POST(req: Request) {
  const { code, pin, attendant } = (await req.json()) as Body;
  const requiredPin = process.env.ATTENDANT_PIN ?? "8421";
  if (pin !== requiredPin) {
    return NextResponse.json({ error: "Attendant PIN is incorrect." }, { status: 401 });
  }
  if (!code || !attendant) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }
  const release = redeemRelease(code, attendant);
  if (!release) {
    return NextResponse.json({ error: "Release not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, release });
}
