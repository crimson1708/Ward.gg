// Externally-pingable refresh endpoint — lets a real cron service (GitHub
// Actions' own schedule trigger is unreliable at sub-hourly intervals) keep
// Turso up to date. Guarded by REFRESH_SECRET so this can't be hammered by
// randoms; the ingestion functions themselves live in scripts/*.mts and are
// shared between this route and their CLI entrypoints.
//
// This is the FAST half — stale-match reconciliation, box scores for newly
// completed games, and news. It deliberately excludes the league/tournament/
// schedule sync (see /api/refresh/schedule), which is much slower (40+
// sequential-ish external calls) and doesn't need to run every few minutes
// anyway — leagues and tournaments rarely change, and match status/results
// for anything already in the DB are handled here regardless.
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
