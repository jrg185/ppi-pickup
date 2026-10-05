import { NextResponse } from "next/server";
import { resetStore } from "@/lib/db";
import { adminResetAuthorized } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!adminResetAuthorized(req.headers.get("x-admin-secret"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  await resetStore();
  return NextResponse.json({ ok: true });
}
