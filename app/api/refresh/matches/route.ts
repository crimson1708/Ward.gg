// The MIDDLE tier of the refresh pipeline — match status/schedule sync
// (catches a match going unstarted -> inProgress -> completed). Split out
// from both /api/refresh (too slow to add to the 2-minute cadence — this
// alone runs ~30s) and /api/refresh/schedule (doesn't need leagues/tournaments
// refreshed first; reads those back out of our own DB instead). Meant to run
// on an intermediate cadence — frequent enough to catch a match going live
// reasonably promptly, without being as tight as the fast endpoint.
//
// Call with:  GET /api/refresh/matches?secret=<REFRESH_SECRET>
// or:         GET /api/refresh/matches  with header  x-refresh-secret: <REFRESH_SECRET>

import { NextRequest, NextResponse } from "next/server";
import { runMatchScheduleSync } from "@/scripts/ingest.mts";
import { checkRefreshSecret } from "@/lib/refreshAuth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby's ceiling

export async function GET(req: NextRequest) {
  const unauthorized = checkRefreshSecret(req);
  if (unauthorized) return unauthorized;

  const startedAt = Date.now();
  try {
    const schedule = await runMatchScheduleSync();
    return NextResponse.json({ ok: true, tookMs: Date.now() - startedAt, schedule });
  } catch (err) {
    return NextResponse.json(
      { ok: false, tookMs: Date.now() - startedAt, error: String(err) },
      { status: 500 }
    );
  }
}
