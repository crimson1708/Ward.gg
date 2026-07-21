import { NextRequest, NextResponse } from "next/server";

// Shared secret check for the /api/refresh* endpoints — extracted so both
// routes enforce it identically instead of copy-pasting the same check.
export function checkRefreshSecret(req: NextRequest): NextResponse | null {
  const secret = process.env.REFRESH_SECRET;
  const provided = req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-refresh-secret");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
