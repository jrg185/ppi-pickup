import { NextResponse } from "next/server";
import { resetStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  await resetStore();
  return NextResponse.json({ ok: true });
}
