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

// Roster assignment (ingest-games.mts) resolves which physical team is
// "blue" for a game by majority-voting player names against each team's
// code — a fix for two independent Riot endpoints (getEventDetails' side
// labels and the live-stats feed's own blue/red rosters) disagreeing about
// which side is which. Seen live: a full IG vs WBG series where every
// player on both sides was attached to the wrong team, all three games,
// consistently. The fix is unlikely to be perfect for every naming
// convention Riot uses across regions, so keep checking for the exact
// signature going forward: a GameStat whose player handle still carries
// the OTHER team's code prefix, not the one it's stored under. Detectable
// cheaply and locally — no external calls needed for the check itself, only
// for the reprocessing that follows once a bad game is found and requeued.
const ROSTER_AUDIT_WINDOW_DAYS = 7;

export async function runRosterSwapAudit() {
  const cutoff = new Date(Date.now() - ROSTER_AUDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const stats = await prisma.gameStat.findMany({
    where: { game: { match: { startTime: { gte: cutoff } } } },
    include: { player: true, game: { include: { match: { include: { teamA: true, teamB: true } } } } },
  });

  const affectedGameIds = new Set<number>();
  for (const s of stats) {
    const { teamA, teamB } = s.game.match;
    const ourCode = s.teamId === teamA.id ? teamA.code : s.teamId === teamB.id ? teamB.code : null;
    const otherCode = s.teamId === teamA.id ? teamB.code : s.teamId === teamB.id ? teamA.code : null;
    if (!ourCode || !otherCode) continue;
    const handle = s.player.handle;
    if (handle.startsWith(otherCode) && !handle.startsWith(ourCode)) {
      affectedGameIds.add(s.gameId);
    }
  }

  if (affectedGameIds.size === 0) return { requeued: 0 };

  // Wipe the (wrong) stats and cached team-level fields for these games and
  // reset statsChecked so runGamesIngest's normal pass redoes them from
  // scratch with the corrected logic, rather than trying to patch rows
  // in place here.
  await prisma.gameStat.deleteMany({ where: { gameId: { in: [...affectedGameIds] } } });
  await prisma.game.updateMany({
    where: { id: { in: [...affectedGameIds] } },
    data: {
      statsChecked: false,
      teamADragons: null,
      teamBDragons: null,
      teamABarons: null,
      teamBBarons: null,
      teamAGold: null,
      teamBGold: null,
    },
  });
  console.log(`[audit] requeued ${affectedGameIds.size} game(s) with team-swapped rosters for reprocessing.`);
  return { requeued: affectedGameIds.size };
}

// GAME-WINNER RECONCILIATION — makes per-game winners agree with the series
// score, which is the one outcome Riot actually reports.
//
// Per-game winners are inferred from the final frame's structure counts (see
// inferGameWinner), and that inference has one real failure mode: a BASE RACE.
// If both teams are pushing and the trailing team reaches the nexus first, the
// LOSER can finish the game having destroyed more towers and inhibitors — seen
// live in ANO vs BCE, where the recorded 0-2 sweep disagreed with the frame on
// game 2. The frame is genuinely ambiguous there: neither team shows the full
// 11 towers a nexus kill implies, so the structure counts are incomplete at the
// moment the feed stops.
//
// The series score has no such ambiguity, so it gets the final say. For each
// fully-resolved series we re-assign winners so the per-game tally matches the
// recorded score exactly, keeping the assignment that the evidence likes best:
// games are ranked by the frame inference first and gold margin second, then
// the top `scoreA` go to team A. A sweep collapses to "every game to the series
// winner"; a 2-1 keeps whichever game team B most plausibly won.
//
// This runs against stored columns only — no external calls — so it is cheap
// enough to re-check continuously, and it is idempotent.
export async function runGameWinnerReconciliation() {
  const matches = await prisma.match.findMany({
    where: { status: "completed" },
    select: {
      id: true, scoreA: true, scoreB: true, teamAId: true, teamBId: true,
      games: {
        where: { state: "completed" },
        select: { id: true, winnerTeamId: true, teamAGold: true, teamBGold: true },
      },
    },
  });

  let checked = 0;
  let fixed = 0;
  for (const m of matches) {
    const games = m.games;
    if (games.length === 0) continue;
    // Only reconcile once every game in the series has an inferred winner AND
    // the game count matches the score; a half-backfilled series would other-
    // wise get "corrected" to fit a score its games can't account for yet.
    if (games.some((g) => g.winnerTeamId === null)) continue;
    if (games.length !== m.scoreA + m.scoreB) continue;
    checked++;

    const tally = games.filter((g) => g.winnerTeamId === m.teamAId).length;
    if (tally === m.scoreA) continue; // already consistent

    const ranked = [...games].sort((x, y) => {
      const inferred = (g: typeof x) => (g.winnerTeamId === m.teamAId ? 1 : 0);
      if (inferred(x) !== inferred(y)) return inferred(y) - inferred(x);
      const margin = (g: typeof x) => (g.teamAGold ?? 0) - (g.teamBGold ?? 0);
      return margin(y) - margin(x);
    });

    for (let i = 0; i < ranked.length; i++) {
      const winnerTeamId = i < m.scoreA ? m.teamAId : m.teamBId;
      if (ranked[i].winnerTeamId !== winnerTeamId) {
        await prisma.game.update({ where: { id: ranked[i].id }, data: { winnerTeamId } });
        fixed++;
      }
    }
  }

  if (fixed > 0) {
    console.log(`[audit] winners: re-assigned ${fixed} game(s) to match their series score.`);
  }
  return { checked, fixed };
}

// MID-GAME SNAPSHOT AUDIT — finds box scores that were saved from a frame the
// game hadn't actually finished on.
//
// getGameWindow can return a best-effort, still-in-progress response when it
// never finds a "finished" frame, and ingest-games used to store that as the
// final box score. The result looks like real data but describes the opening
// minutes: seen live, a completed game saved with 0/0/0 K/D/A, 17 CS and ~15k
// combined team gold, which then fed into that player's averages.
//
// ingest-games no longer writes non-final frames, but games ingested before
// that are still carrying the bad numbers, and the failure can recur any time
// the feed lags. Combined team gold is a reliable tell: no completed pro game
// ends under 30k across BOTH teams — the earliest possible surrender is ~15
// minutes, by which point two teams hold roughly 40-50k between them. Real
// games in this database cluster at 70k+, and the suspect tail sits an order
// of magnitude below that, so the threshold isn't close to any real game.
//
// Two outcomes depending on how old the game is:
//
//   Recent  -> requeue it. ingest-games upserts, so a successful re-run
//              overwrites the bad numbers in place. The failure is usually
//              just the feed lagging behind the game ending, so a retry
//              genuinely fixes it.
//   Stale   -> purge the box score. Past the retry window the feed no longer
//              serves these games at all, so the numbers can never be
//              corrected — and demonstrably wrong stats (0/0/0 with starting
//              gold) are worse than no stats, because they silently drag down
//              every average the player appears in. The Game row itself stays,
//              so matches still list the game; it just has no box score, the
//              same state as a game whose feed never existed.
const IMPLAUSIBLE_COMBINED_GOLD = 30_000;

// Bounds the retry cost: requeueing is cheap, but the re-probe it triggers is
// an offset ladder per game, and a game whose feed has gone for good would
// otherwise be re-probed on every single run forever.
const MID_GAME_AUDIT_WINDOW_DAYS = 7;

export async function runMidGameSnapshotAudit() {
  const cutoff = new Date(Date.now() - MID_GAME_AUDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const games = await prisma.game.findMany({
    where: { state: "completed", teamAGold: { not: null }, teamBGold: { not: null } },
    select: { id: true, teamAGold: true, teamBGold: true, match: { select: { startTime: true } } },
  });

  const suspect = games.filter((g) => (g.teamAGold ?? 0) + (g.teamBGold ?? 0) < IMPLAUSIBLE_COMBINED_GOLD);
  if (suspect.length === 0) return { requeued: 0, purged: 0 };

  const retryable = suspect.filter((g) => g.match.startTime >= cutoff);
  const unrecoverable = suspect.filter((g) => g.match.startTime < cutoff);

  if (retryable.length > 0) {
    await prisma.game.updateMany({
      where: { id: { in: retryable.map((g) => g.id) } },
      data: { statsChecked: false },
    });
    console.log(`[audit] requeued ${retryable.length} game(s) whose stats came from an unfinished frame.`);
  }

  let purged = 0;
  if (unrecoverable.length > 0) {
    const ids = unrecoverable.map((g) => g.id);
    const deleted = await prisma.gameStat.deleteMany({ where: { gameId: { in: ids } } });
    purged = deleted.count;
    // Clear the per-game aggregates too — they came from the same bad frame.
    // Leaving statsChecked true stops the pointless re-probing; if the feed
    // ever does come back, runStatsRecheckAudit picks these up as no-stats
    // games while they are still inside its own window.
    await prisma.game.updateMany({
      where: { id: { in: ids } },
      data: {
        teamAGold: null, teamBGold: null, teamABarons: null, teamBBarons: null,
        teamADragons: null, teamBDragons: null, winnerTeamId: null, patch: null, durationSecs: null,
      },
    });
    console.log(`[audit] purged ${purged} unrecoverable box-score row(s) from ${ids.length} game(s).`);
  }

  return { requeued: retryable.length, purged };
}
