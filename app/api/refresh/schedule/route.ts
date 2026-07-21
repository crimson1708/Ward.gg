// The SLOW half of the refresh pipeline — just leagues + tournaments (40+
// external calls to Riot even parallelized). Separate from /api/refresh so it
// can run on its own, infrequent cadence — this data barely ever changes, and
// match status/schedule syncing (the part that actually needs to be frequent)
// lives in the fast endpoint instead, reading leagues/tournaments back out of
// our own DB rather than depending on this route having just run.
//
// Call with:  GET /api/refresh/schedule?secret=<REFRESH_SECRET>
// or:         GET /api/refresh/schedule  with header  x-refresh-secret: <REFRESH_SECRET>

import { NextRequest, NextResponse } from "next/server";
import { runLeagueSync } from "@/scripts/ingest.mts";
import { checkRefreshSecret } from "@/lib/refreshAuth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby's ceiling

export async function GET(req: NextRequest) {
  const unauthorized = checkRefreshSecret(req);
  if (unauthorized) return unauthorized;

  const startedAt = Date.now();
  try {
    const schedule = await runLeagueSync();
    return NextResponse.json({ ok: true, tookMs: Date.now() - startedAt, schedule });
  } catch (err) {
    return NextResponse.json(
      { ok: false, tookMs: Date.now() - startedAt, error: String(err) },
      { status: 500 }
    );
  }
}
