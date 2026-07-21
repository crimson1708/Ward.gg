// Externally-pingable refresh endpoint — lets a real cron service (GitHub
// Actions' own schedule trigger is unreliable at sub-hourly intervals) keep
// Turso up to date. Guarded by REFRESH_SECRET so this can't be hammered by
// randoms; the ingestion functions themselves live in scripts/*.mts and are
// shared between this route and their CLI entrypoints.
//
// This is the FASTEST/most frequent tier — stale-match reconciliation (fixes
// matches that fell out of Riot's schedule-feed window while still
// unresolved) and box scores for newly completed games, plus news. Match
// status/schedule syncing itself (catching a match going live) lives in
// /api/refresh/matches instead — it's too slow on its own (~30s) to also
// bundle into a 2-minute cadence. Leagues/tournaments are slower still and
// live in /api/refresh/schedule, on the slowest cadence of the three.
//
// Call with:  GET /api/refresh?secret=<REFRESH_SECRET>
// or:         GET /api/refresh  with header  x-refresh-secret: <REFRESH_SECRET>

import { NextRequest, NextResponse } from "next/server";
import { runStaleReconciliation } from "@/scripts/ingest-stale.mts";
import { runGamesIngest } from "@/scripts/ingest-games.mts";
import { runNewsIngest } from "@/scripts/ingest-news.mts";
import { checkRefreshSecret } from "@/lib/refreshAuth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby's ceiling

export async function GET(req: NextRequest) {
  const unauthorized = checkRefreshSecret(req);
  if (unauthorized) return unauthorized;

  const startedAt = Date.now();
  try {
    const stale = await runStaleReconciliation();
    const games = await runGamesIngest();
    const news = await runNewsIngest();

    return NextResponse.json({ ok: true, tookMs: Date.now() - startedAt, stale, games, news });
  } catch (err) {
    return NextResponse.json(
      { ok: false, tookMs: Date.now() - startedAt, error: String(err) },
      { status: 500 }
    );
  }
}
