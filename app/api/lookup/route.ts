import { NextResponse } from "next/server";
import { findImpound } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { query } = (await req.json()) as { query?: string };
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "Missing query." }, { status: 400 });
  }
  const impound = await findImpound(query);
  if (!impound) {
    return NextResponse.json(
      {
        error:
          "No impound record matched that plate, VIN, or impound number. Double-check your notice or call the lot.",
      },
      { status: 404 },
    );
  }
  if (impound.status === "released") {
    return NextResponse.json(
      { error: "This vehicle has already been released." },
      { status: 409 },
    );
  }
  return NextResponse.json({ impoundId: impound.id });
}
