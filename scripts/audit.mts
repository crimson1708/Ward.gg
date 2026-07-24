// AUDIT — a standing verification/self-healing layer, not a one-off script.
//
// Every data bug found in this pipeline so far had the same shape: Riot's
// API is internally inconsistent in some way (one field disagreeing with
// another, team ordering that isn't stable across separate calls,
// eventual-consistency lag between its own endpoints), our ingestion trusted
// a single write to be correct forever, and once wrong, nothing downstream
// ever re-examined it. That pattern — not any one instance of it — is what
// this file exists to close off: invariants get re-checked continuously
// instead of once, so drift (known or not-yet-discovered) gets caught and
// self-corrected automatically instead of sitting wrong until someone
// happens to notice it on the live site.
//
// Two tiers, run at different cadences (see app/api/refresh*):
//   - runCheapAudit: pure computation against data already in Turso, no
//     external calls. Cheap enough to run every few minutes indefinitely.
//   - runDeepAudit: re-verifies against Riot's live API, the only way to
//     catch the "our own stored data disagrees with reality" class of bug
//     (e.g. the swapped-scores issue). Scoped to recently-completed matches
//     only — older ones were already fully audited once and don't change
//     upstream, so re-checking them forever would just waste time.

import { prisma } from "../lib/prisma.ts";
import { getEventDetails } from "../lib/lolEsports.ts";

export async function runCheapAudit() {
  const matches = await prisma.match.findMany({
    where: { status: "completed" },
    select: { id: true, scoreA: true, scoreB: true, winnerTeamId: true, teamAId: true, teamBId: true },
  });

  let fixed = 0;
  for (const m of matches) {
    const correctWinner = m.scoreA > m.scoreB ? m.teamAId : m.scoreB > m.scoreA ? m.teamBId : null;
    if (m.winnerTeamId !== correctWinner) {
      await prisma.match.update({ where: { id: m.id }, data: { winnerTeamId: correctWinner } });
      fixed++;
    }
  }
  if (fixed > 0) {
    console.log(`[audit] cheap: fixed ${fixed} match(es) with winnerTeamId inconsistent with their own stored score.`);
  }
  return { checked: matches.length, fixed };
}

const DEEP_AUDIT_WINDOW_DAYS = 7;
const DEEP_AUDIT_CONCURRENCY = 10;

export async function runDeepAudit() {
  const cutoff = new Date(Date.now() - DEEP_AUDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const matches = await prisma.match.findMany({
    where: { status: "completed", startTime: { gte: cutoff } },
    include: { teamA: true, teamB: true },
  });

  let checked = 0;
  let fixed = 0;
  for (let i = 0; i < matches.length; i += DEEP_AUDIT_CONCURRENCY) {
    const batch = matches.slice(i, i + DEEP_AUDIT_CONCURRENCY);
    await Promise.all(
      batch.map(async (m) => {
        let details;
        try {
          details = await getEventDetails(m.externalId);
        } catch {
          return; // transient failure — next run tries again, no need to fail loudly
        }
        checked++;

        const winsByCode = new Map(details.teams.map((t) => [t.code, t.result?.gameWins ?? 0]));
        const liveA = winsByCode.get(m.teamA.code);
        const liveB = winsByCode.get(m.teamB.code);
        if (liveA === undefined || liveB === undefined) return; // team code mismatch, skip

        const liveWinner = liveA > liveB ? m.teamAId : liveB > liveA ? m.teamBId : null;
        if (m.scoreA !== liveA || m.scoreB !== liveB || m.winnerTeamId !== liveWinner) {
          await prisma.match.update({
            where: { id: m.id },
            data: { scoreA: liveA, scoreB: liveB, winnerTeamId: liveWinner },
          });
          fixed++;
          console.log(`[audit] deep: fixed ${m.teamA.code} vs ${m.teamB.code} — stored ${m.scoreA}-${m.scoreB} -> live ${liveA}-${liveB}`);
        }
      })
    );
  }
  if (fixed > 0) {
    console.log(`[audit] deep: fixed ${fixed} of ${checked} recently-completed match(es).`);
  }
  return { checked, fixed };
}

// statsChecked=true with zero GameStat rows is meant to mean "confirmed no
// live-stats feed exists for this game" — but that's not always permanent:
// seen live, a game's feed simply wasn't populated on Riot's side yet at the
// moment we first checked, and showed up hours later. Rather than probing
// forever (expensive — an 11-request offset ladder per game) or giving up
// forever (wrong, as above), periodically un-mark recent candidates so
// runGamesIngest's normal incremental pass gives them one more real attempt.
// Scoped to the same recent window as the deep score audit: an old game
// that's been checked and found empty for months is genuinely gone, not
// delayed — retrying those forever would just waste time for no benefit.
const STATS_RECHECK_WINDOW_DAYS = 7;

export async function runStatsRecheckAudit() {
  const cutoff = new Date(Date.now() - STATS_RECHECK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await prisma.game.findMany({
    where: {
      state: "completed",
      statsChecked: true,
      stats: { none: {} },
      match: { startTime: { gte: cutoff } },
    },
    select: { id: true },
  });
  if (candidates.length === 0) return { requeued: 0 };

  await prisma.game.updateMany({
    where: { id: { in: candidates.map((g) => g.id) } },
    data: { statsChecked: false },
  });
  console.log(`[audit] requeued ${candidates.length} recent no-feed game(s) for one more stats attempt.`);
  return { requeued: candidates.length };
}
