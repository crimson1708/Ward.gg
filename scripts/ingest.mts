// INGESTION JOB — the bridge from API → database.
// Run:  npx tsx scripts/ingest.mts
//
// It is IDEMPOTENT: every write is an "upsert" (insert if new, update if it
// already exists), keyed on the API's own id. Run it 100 times → no duplicates,
// just fresh data. That's the whole trick to a re-runnable data pipeline.
//
// Split into two independently-callable pieces (see app/api/refresh*) because
// they have very different natural update cadences: leagues/tournaments
// barely ever change, while match status (unstarted -> inProgress ->
// completed) needs to be checked often to catch a match going live promptly.
// runScheduleIngest() below just runs both, for the CLI/GitHub Actions path
// where that distinction doesn't matter.

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

// ── LEAGUES + TOURNAMENTS — the slow, external-API-heavy half (40+ calls to
//    Riot, one per league). Rarely changes, so this can run on a long cadence. ──
export async function runLeagueSync() {
  const leagues = await getLeagues();
  for (const l of leagues) {
    await prisma.league.upsert({
      where: { externalId: l.id },
      update: { name: l.name, region: l.region, slug: l.slug, logoUrl: l.image },
      create: { externalId: l.id, name: l.name, region: l.region, slug: l.slug, logoUrl: l.image },
    });
  }
  console.log(`Leagues upserted: ${leagues.length}`);

  const leagueRows = await prisma.league.findMany();

  // The API returns a league's ENTIRE tournament history (some go back to
  // 2013), newest first, so we stop as soon as we reach ones that ended a
  // while ago rather than re-upserting a decade of irrelevant splits.
  const TOURNAMENT_CUTOFF_MS = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60 days ago

  // The fetches themselves are read-only and independent, so fire them all
  // concurrently — sequential was 44+ round trips adding up to over a minute.
  // Each one now has its own timeout (see lib/lolEsports.ts), but a rejection
  // from even one league would otherwise fail the entire Promise.all — catch
  // per-league so one flaky/slow league just contributes nothing this run
  // instead of taking every other league's data down with it.
  const tournamentLists = await Promise.all(
    leagueRows.map(async (l) => {
      try {
        return { league: l, tournaments: await getTournamentsForLeague(l.externalId) };
      } catch (err) {
        console.warn(`Skipping tournaments for league ${l.slug}: ${err}`);
        return { league: l, tournaments: [] };
      }
    })
  );

  let tournamentCount = 0;
  for (const { league: l, tournaments } of tournamentLists) {
    for (const t of tournaments) {
      if (new Date(t.endDate).getTime() < TOURNAMENT_CUTOFF_MS) break;
      await prisma.tournament.upsert({
        where: { externalId: t.id },
        update: { name: t.slug, startDate: new Date(t.startDate), endDate: new Date(t.endDate) },
        create: {
          externalId: t.id,
          name: t.slug,
          slug: t.slug,
          leagueId: l.id,
          startDate: new Date(t.startDate),
          endDate: new Date(t.endDate),
        },
      });
      tournamentCount++;
    }
  }
  console.log(`Tournaments upserted: ${tournamentCount}`);

  return { leagues: leagues.length, tournaments: tournamentCount };
}

// ── MATCH SCHEDULE — the frequent half. Reads leagues/tournaments back OUT of
//    our own DB (no external calls needed for those — runLeagueSync already
//    keeps them fresh on its own cadence) and syncs teams + match status. ──
export async function runMatchScheduleSync() {
  const leagueRows = await prisma.league.findMany();
  const leagueIdBySlug = new Map(leagueRows.map((l) => [l.slug, l.id]));

  // Tournament dates are day-only, so give the end date a day of slack —
  // otherwise a match played late on the split's last calendar day could
  // fall just outside the range.
  const tournamentRows = await prisma.tournament.findMany({
    where: { startDate: { not: null }, endDate: { not: null } },
  });
  const tournamentsByLeague = new Map<number, { id: number; startDate: Date; endDate: Date }[]>();
  for (const t of tournamentRows) {
    if (!t.startDate || !t.endDate) continue;
    const list = tournamentsByLeague.get(t.leagueId) ?? [];
    list.push({ id: t.id, startDate: t.startDate, endDate: t.endDate });
    tournamentsByLeague.set(t.leagueId, list);
  }
  function findTournamentId(leagueId: number, matchStart: Date): number | null {
    const list = tournamentsByLeague.get(leagueId);
    if (!list) return null;
    const hit = list.find(
      (t) => matchStart >= t.startDate && matchStart.getTime() <= t.endDate.getTime() + 24 * 60 * 60 * 1000
    );
    return hit ? hit.id : null;
  }

  const events = await getSchedule();
  let matchCount = 0;
  let skipped = 0;

  // The same team shows up across many events in one schedule window (a
  // popular team might play several matches) — resolve every DISTINCT team
  // up front, in bounded-concurrency batches, so the match loop below never
  // has to await a team upsert at all (it was ~60-70 sequential round trips
  // otherwise, the single biggest cost in this sync).
  const uniqueTeams = new Map<string, { name: string; code: string; image: string }>();
  for (const e of events) {
    if (e.type !== "match" || !e.match) continue;
    const [a, b] = e.match.teams;
    if (!a || !b || a.code === "TBD" || b.code === "TBD") continue;
    uniqueTeams.set(slugify(a.name), a);
    uniqueTeams.set(slugify(b.name), b);
  }
  // A team's name/code/logo essentially never changes run to run, so writing
  // all ~100 of them every single time (Turso write latency turned out to be
  // the real cost here, not client-side concurrency — batching alone barely
  // moved the needle) is almost entirely wasted work. Fetch what's already
  // there and only actually write teams that are new or genuinely changed.
  const teamCache = new Map<string, Awaited<ReturnType<typeof upsertTeam>>>();
  const teamEntries = [...uniqueTeams.entries()];
  const existingTeams = await prisma.team.findMany({
    where: { externalId: { in: teamEntries.map(([slug]) => slug) } },
  });
  const existingTeamBySlug = new Map(existingTeams.map((t) => [t.externalId, t]));

  const teamsToUpsert: [string, { name: string; code: string; image: string }][] = [];
  for (const [slug, t] of teamEntries) {
    const existing = existingTeamBySlug.get(slug);
    if (existing && existing.name === t.name && existing.code === t.code && existing.logoUrl === t.image) {
      teamCache.set(slug, existing);
    } else {
      teamsToUpsert.push([slug, t]);
    }
  }

  const TEAM_UPSERT_CONCURRENCY = 20;
  for (let i = 0; i < teamsToUpsert.length; i += TEAM_UPSERT_CONCURRENCY) {
    const batch = teamsToUpsert.slice(i, i + TEAM_UPSERT_CONCURRENCY);
    const rows = await Promise.all(batch.map(([, t]) => upsertTeam(t)));
    batch.forEach(([slug], idx) => teamCache.set(slug, rows[idx]));
  }

  // Same idea as teams: most of the ~80 events in any given schedule window
  // are matches that haven't changed since the last run a few minutes ago.
  // Fetch what we already have and skip the write entirely when nothing
  // about the match actually differs.
  const matchExternalIds = events.filter((e) => e.type === "match" && e.match).map((e) => e.match!.id);
  const existingMatches = await prisma.match.findMany({
    where: { externalId: { in: matchExternalIds } },
    select: {
      externalId: true,
      status: true,
      scoreA: true,
      scoreB: true,
      winnerTeamId: true,
      startTime: true,
      tournamentId: true,
      blockName: true,
    },
  });
  const existingMatchByExternalId = new Map(existingMatches.map((m) => [m.externalId, m]));

  // The match upsert itself always targets a distinct row per event, so those
  // are safe to fire in bounded-concurrency batches too.
  const MATCH_UPSERT_CONCURRENCY = 20;
  let pending: Promise<void>[] = [];

  for (const e of events) {
    // Skip non-match rows (e.g. "show" segments) and unknown leagues.
    if (e.type !== "match" || !e.match) { skipped++; continue; }
    const leagueId = leagueIdBySlug.get(e.league.slug);
    if (!leagueId) { skipped++; continue; }

    const [a, b] = e.match.teams;
    // Skip placeholder matchups (e.g. "TBD vs TBD" for future bracket slots).
    if (!a || !b || a.code === "TBD" || b.code === "TBD") { skipped++; continue; }

    // Both teams were already resolved in the prefetch pass above.
    const teamA = teamCache.get(slugify(a.name))!;
    const teamB = teamCache.get(slugify(b.name))!;

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
    const matchId = e.match.id;
    const strategyCount = e.match.strategy.count;
    const state = e.state;

    const existing = existingMatchByExternalId.get(matchId);
    const unchanged =
      existing &&
      existing.status === state &&
      existing.scoreA === scoreA &&
      existing.scoreB === scoreB &&
      existing.winnerTeamId === winnerTeamId &&
      existing.startTime.getTime() === startTime.getTime() &&
      existing.tournamentId === tournamentId &&
      existing.blockName === blockName;
    if (unchanged) {
      matchCount++;
      continue;
    }

    pending.push(
      prisma.match
        .upsert({
          where: { externalId: matchId },
          // On update we refresh only the things that change over a match's life.
          update: { status: state, scoreA, scoreB, winnerTeamId, startTime, tournamentId, blockName },
          create: {
            externalId: matchId,
            leagueId,
            tournamentId,
            startTime,
            status: state,
            bestOf: strategyCount,
            blockName,
            teamAId: teamA.id,
            teamBId: teamB.id,
            scoreA,
            scoreB,
            winnerTeamId,
          },
        })
        .then(() => {
          matchCount++;
        })
    );

    if (pending.length >= MATCH_UPSERT_CONCURRENCY) {
      await Promise.all(pending);
      pending = [];
    }
  }
  if (pending.length) await Promise.all(pending);

  console.log(`Matches upserted: ${matchCount}  (skipped ${skipped} non-match/placeholder rows)`);
  const teamCount = await prisma.team.count();
  console.log(`Teams in DB now: ${teamCount}`);

  return { matches: matchCount, skipped, teams: teamCount };
}

async function upsertTeam(t: { name: string; code: string; image: string }) {
  const slug = slugify(t.name);
  return prisma.team.upsert({
    where: { externalId: slug }, // no API id for schedule teams, so slug IS the key
    update: { name: t.name, code: t.code, logoUrl: t.image },
    create: { externalId: slug, slug, name: t.name, code: t.code, logoUrl: t.image },
  });
}

// Runs both halves — used by the CLI entrypoint and GitHub Actions, neither
// of which cares about splitting the two update cadences apart.
export async function runScheduleIngest() {
  const leagueResult = await runLeagueSync();
  const matchResult = await runMatchScheduleSync();
  return { ...leagueResult, ...matchResult };
}

// Only run as a CLI entrypoint when invoked directly (`tsx scripts/ingest.mts`) —
// not when imported by the API routes, which call the functions above
// themselves and manage their own process lifecycle.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScheduleIngest()
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error("Ingestion failed:", err);
      process.exit(1);
    });
}
