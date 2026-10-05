import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  if (!req.nextUrl.searchParams.has("pin")) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.searchParams.delete("pin");
  return NextResponse.redirect(url);
}

export const config = {
  matcher: "/attendant/verify",
};
