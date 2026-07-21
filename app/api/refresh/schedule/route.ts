// The SLOW half of the refresh pipeline — leagues, tournaments, and the match
// schedule itself. Separate from /api/refresh so it can run on its own, less
// frequent cadence (this does dozens of external API calls even after
// parallelizing them, so it's meaningfully slower than the fast endpoint).
//
// Call with:  GET /api/refresh/schedule?secret=<REFRESH_SECRET>
// or:         GET /api/refresh/schedule  with header  x-refresh-secret: <REFRESH_SECRET>

import { NextRequest, NextResponse } from "next/server";
import { runScheduleIngest } from "@/scripts/ingest.mts";
import { checkRefreshSecret } from "@/lib/refreshAuth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby's ceiling

export async function GET(req: NextRequest) {
  const unauthorized = checkRefreshSecret(req);
  if (unauthorized) return unauthorized;

  const startedAt = Date.now();
  try {
    const schedule = await runScheduleIngest();
    return NextResponse.json({ ok: true, tookMs: Date.now() - startedAt, schedule });
  } catch (err) {
    return NextResponse.json(
      { ok: false, tookMs: Date.now() - startedAt, error: String(err) },
      { status: 500 }
    );
  }
}
