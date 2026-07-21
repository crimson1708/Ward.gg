// INGESTION JOB — reconciles matches Riot's schedule feed has "aged out" of.
// Run:  npx tsx scripts/ingest-stale.mts
//
// getSchedule() (used by ingest.mts) only returns a rolling window of events —
// once a match ages out of that window, ingest.mts can never update its status
// again. A match that flips to inProgress and then finishes AFTER it has
// already left the window gets stuck there forever, with zero Game rows,
// since ingest-games.mts only processes matches already marked "completed".
//
// getEventDetails(id), by contrast, is looked up directly by id and has no
// such window — so for any old-enough not-yet-completed match, we ask it
// directly whether the series is actually done.

import { pathToFileURL } from "node:url";
import { prisma } from "../lib/prisma.ts";
import { getEventDetails } from "../lib/lolEsports.ts";

// Give a series generous room to actually finish (delays, Bo5s) before we
// bother double-checking it against getEventDetails.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function runStaleReconciliation() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const candidates = await prisma.match.findMany({
    where: { status: { in: ["unstarted", "inProgress"] }, startTime: { lt: cutoff } },
    include: { teamA: true, teamB: true },
  });

  console.log(`${candidates.length} stale unresolved match(es) to double-check.`);

  let fixed = 0;
  for (const match of candidates) {
    const details = await getEventDetails(match.externalId);
    if (!details.games.length) continue;

    const resolved = details.games.every((g) => g.state === "completed" || g.state === "unneeded");
    if (!resolved) continue;

    const winsByCode = new Map(details.teams.map((t) => [t.code, t.result?.gameWins ?? 0]));
    const scoreA = winsByCode.get(match.teamA.code) ?? 0;
    const scoreB = winsByCode.get(match.teamB.code) ?? 0;
    const winnerTeamId = scoreA > scoreB ? match.teamAId : scoreB > scoreA ? match.teamBId : null;

    await prisma.match.update({
      where: { id: match.id },
      data: { status: "completed", scoreA, scoreB, winnerTeamId },
    });
    fixed++;
    console.log(`  fixed: ${match.teamA.code} vs ${match.teamB.code} (${match.startTime.toISOString()}) -> ${scoreA}-${scoreB}`);
  }

  console.log(`Reconciled ${fixed} match(es). (Their games/stats will be picked up by the next ingest:games run.)`);
  return { checked: candidates.length, fixed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStaleReconciliation()
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error("Stale reconciliation failed:", err);
      process.exit(1);
    });
}
