// INGESTION JOB — the bridge from API → database.
// Run:  npx tsx scripts/ingest.mts
//
// It is IDEMPOTENT: every write is an "upsert" (insert if new, update if it
// already exists), keyed on the API's own id. Run it 100 times → no duplicates,
// just fresh data. That's the whole trick to a re-runnable data pipeline.

import { prisma } from "../lib/prisma.ts";
import { getLeagues, getSchedule } from "../lib/lolEsports.ts";

// Turn "Unicorns of Love Sexy Edition" -> "unicorns-of-love-sexy-edition".
// We need our own stable key for teams because the schedule gives them no id.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function main() {
  // ── 1. LEAGUES ──────────────────────────────────────────────────────────
  const leagues = await getLeagues();
  for (const l of leagues) {
    await prisma.league.upsert({
      where: { externalId: l.id },
      update: { name: l.name, region: l.region, slug: l.slug },
      create: { externalId: l.id, name: l.name, region: l.region, slug: l.slug },
    });
  }
  console.log(`Leagues upserted: ${leagues.length}`);

  // Build slug -> our leagueId map so we can link matches without re-querying.
  const leagueRows = await prisma.league.findMany();
  const leagueIdBySlug = new Map(leagueRows.map((l) => [l.slug, l.id]));

  // ── 2. MATCHES (and the teams inside them) ────────────────────────────────
  const events = await getSchedule();
  let matchCount = 0;
  let skipped = 0;

  for (const e of events) {
    // Skip non-match rows (e.g. "show" segments) and unknown leagues.
    if (e.type !== "match" || !e.match) { skipped++; continue; }
    const leagueId = leagueIdBySlug.get(e.league.slug);
    if (!leagueId) { skipped++; continue; }

    const [a, b] = e.match.teams;
    // Skip placeholder matchups (e.g. "TBD vs TBD" for future bracket slots).
    if (!a || !b || a.code === "TBD" || b.code === "TBD") { skipped++; continue; }

    // Upsert both teams, keyed by a slug we derive from their name.
    const teamA = await upsertTeam(a);
    const teamB = await upsertTeam(b);

    const scoreA = a.result?.gameWins ?? 0;
    const scoreB = b.result?.gameWins ?? 0;
    let winnerTeamId: number | null = null;
    if (e.state === "completed") {
      if (a.result?.outcome === "win") winnerTeamId = teamA.id;
      else if (b.result?.outcome === "win") winnerTeamId = teamB.id;
    }

    await prisma.match.upsert({
      where: { externalId: e.match.id },
      // On update we refresh only the things that change over a match's life.
      update: { status: e.state, scoreA, scoreB, winnerTeamId, startTime: new Date(e.startTime) },
      create: {
        externalId: e.match.id,
        leagueId,
        startTime: new Date(e.startTime),
        status: e.state,
        bestOf: e.match.strategy.count,
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
  console.log(`Teams in DB now: ${await prisma.team.count()}`);

  await prisma.$disconnect();
}

async function upsertTeam(t: { name: string; code: string; image: string }) {
  const slug = slugify(t.name);
  return prisma.team.upsert({
    where: { externalId: slug }, // no API id for schedule teams, so slug IS the key
    update: { name: t.name, code: t.code, logoUrl: t.image },
    create: { externalId: slug, slug, name: t.name, code: t.code, logoUrl: t.image },
  });
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
