// INGESTION JOB — the bridge from API → database.
// Run:  npx tsx scripts/ingest.mts
//
// It is IDEMPOTENT: every write is an "upsert" (insert if new, update if it
// already exists), keyed on the API's own id. Run it 100 times → no duplicates,
// just fresh data. That's the whole trick to a re-runnable data pipeline.

import { pathToFileURL } from "node:url";
import { prisma } from "../lib/prisma.ts";
import { getLeagues, getSchedule, getTournamentsForLeague } from "../lib/lolEsports.ts";

// Turn "Unicorns of Love Sexy Edition" -> "unicorns-of-love-sexy-edition".
// We need our own stable key for teams because the schedule gives them no id.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function runScheduleIngest() {
  // ── 1. LEAGUES ──────────────────────────────────────────────────────────
  const leagues = await getLeagues();
  for (const l of leagues) {
    await prisma.league.upsert({
      where: { externalId: l.id },
      update: { name: l.name, region: l.region, slug: l.slug, logoUrl: l.image },
      create: { externalId: l.id, name: l.name, region: l.region, slug: l.slug, logoUrl: l.image },
    });
  }
  console.log(`Leagues upserted: ${leagues.length}`);

  // Build slug -> our leagueId map so we can link matches without re-querying.
  const leagueRows = await prisma.league.findMany();
  const leagueIdBySlug = new Map(leagueRows.map((l) => [l.slug, l.id]));

  // ── 2. TOURNAMENTS (splits/stages, with their date ranges) ────────────────
  // Only their date range matters to us right now — it's what lets the
  // homepage show "ongoing events" the way VLR does. The API returns a
  // league's ENTIRE tournament history (some go back to 2013), newest first,
  // so we stop as soon as we reach ones that ended a while ago rather than
  // re-upserting a decade of irrelevant splits on every run.
  const TOURNAMENT_CUTOFF_MS = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60 days ago
  // Also keep each league's tournament date ranges around in memory so the
  // match loop below can figure out which split/tournament a match belongs
  // to (the schedule feed gives no tournament id directly — just a league).
  // The fetches themselves are the slow part (44+ sequential external calls
  // added up to over a minute) — they're independent read-only requests, so
  // fire them all concurrently. The upserts that follow stay sequential,
  // since SQLite/libSQL serializes writes anyway and there's no benefit to
  // parallelizing those.
  const tournamentLists = await Promise.all(
    leagueRows.map(async (l) => ({ league: l, tournaments: await getTournamentsForLeague(l.externalId) }))
  );

  const tournamentsByLeague = new Map<number, { id: number; startDate: Date; endDate: Date }[]>();
  let tournamentCount = 0;
  for (const { league: l, tournaments } of tournamentLists) {
    const list: { id: number; startDate: Date; endDate: Date }[] = [];
    for (const t of tournaments) {
      if (new Date(t.endDate).getTime() < TOURNAMENT_CUTOFF_MS) break;
      const startDate = new Date(t.startDate);
      const endDate = new Date(t.endDate);
      const row = await prisma.tournament.upsert({
        where: { externalId: t.id },
        update: { name: t.slug, startDate, endDate },
        create: { externalId: t.id, name: t.slug, slug: t.slug, leagueId: l.id, startDate, endDate },
      });
      list.push({ id: row.id, startDate, endDate });
      tournamentCount++;
    }
    tournamentsByLeague.set(l.id, list);
  }
  console.log(`Tournaments upserted: ${tournamentCount}`);

  // Tournament dates are day-only, so give the end date a day of slack —
  // otherwise a match played late on the split's last calendar day could
  // fall just outside the range.
  function findTournamentId(leagueId: number, matchStart: Date): number | null {
    const list = tournamentsByLeague.get(leagueId);
    if (!list) return null;
    const hit = list.find(
      (t) => matchStart >= t.startDate && matchStart.getTime() <= t.endDate.getTime() + 24 * 60 * 60 * 1000
    );
    return hit ? hit.id : null;
  }

  // ── 3. MATCHES (and the teams inside them) ────────────────────────────────
  const events = await getSchedule();
  let matchCount = 0;
  let skipped = 0;

  // The same team shows up across many events in one schedule window (a
  // popular team might play several matches) — cache upserts per run so
  // repeats reuse the row instead of hitting Turso again for identical data.
  const teamCache = new Map<string, Awaited<ReturnType<typeof upsertTeam>>>();
  async function upsertTeamCached(t: { name: string; code: string; image: string }) {
    const slug = slugify(t.name);
    const cached = teamCache.get(slug);
    if (cached) return cached;
    const row = await upsertTeam(t);
    teamCache.set(slug, row);
    return row;
  }

  for (const e of events) {
    // Skip non-match rows (e.g. "show" segments) and unknown leagues.
    if (e.type !== "match" || !e.match) { skipped++; continue; }
    const leagueId = leagueIdBySlug.get(e.league.slug);
    if (!leagueId) { skipped++; continue; }

    const [a, b] = e.match.teams;
    // Skip placeholder matchups (e.g. "TBD vs TBD" for future bracket slots).
    if (!a || !b || a.code === "TBD" || b.code === "TBD") { skipped++; continue; }

    // Upsert both teams, keyed by a slug we derive from their name.
    const teamA = await upsertTeamCached(a);
    const teamB = await upsertTeamCached(b);

    const scoreA = a.result?.gameWins ?? 0;
    const scoreB = b.result?.gameWins ?? 0;
    let winnerTeamId: number | null = null;
    if (e.state === "completed") {
      if (a.result?.outcome === "win") winnerTeamId = teamA.id;
      else if (b.result?.outcome === "win") winnerTeamId = teamB.id;
    }

    const startTime = new Date(e.startTime);
    const tournamentId = findTournamentId(leagueId, startTime);
    const blockName = e.blockName ?? null;

    await prisma.match.upsert({
      where: { externalId: e.match.id },
      // On update we refresh only the things that change over a match's life.
      update: { status: e.state, scoreA, scoreB, winnerTeamId, startTime, tournamentId, blockName },
      create: {
        externalId: e.match.id,
        leagueId,
        tournamentId,
        startTime,
        status: e.state,
        bestOf: e.match.strategy.count,
        blockName,
        teamAId: teamA.id,
        teamBId: teamB.id,
        scoreA,
        scoreB,
        winnerTeamId,
      },
    });
    matchCount++;
  }

  console.log(`Matches upserted: ${matchCount}  (skipped ${skipped} non-match/placeholder rows)`);
  const teamCount = await prisma.team.count();
  console.log(`Teams in DB now: ${teamCount}`);

  return { leagues: leagues.length, tournaments: tournamentCount, matches: matchCount, skipped, teams: teamCount };
}

async function upsertTeam(t: { name: string; code: string; image: string }) {
  const slug = slugify(t.name);
  return prisma.team.upsert({
    where: { externalId: slug }, // no API id for schedule teams, so slug IS the key
    update: { name: t.name, code: t.code, logoUrl: t.image },
    create: { externalId: slug, slug, name: t.name, code: t.code, logoUrl: t.image },
  });
}

// Only run as a CLI entrypoint when invoked directly (`tsx scripts/ingest.mts`) —
// not when imported by the API route, which calls runScheduleIngest() itself
// and manages its own process lifecycle.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScheduleIngest()
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error("Ingestion failed:", err);
      process.exit(1);
    });
}
