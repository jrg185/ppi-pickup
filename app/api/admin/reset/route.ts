import { NextResponse } from "next/server";
import { resetStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  resetStore();
  return NextResponse.json({ ok: true });
}
