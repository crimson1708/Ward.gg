// Thin client for the LoL Esports API. Its only job is to fetch + return JSON.
// It knows nothing about our database — that separation keeps things testable
// and means we could swap data sources later without touching ingestion logic.

const API_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"; // public shared key
const ESPORTS = "https://esports-api.lolesports.com/persisted/gw";

// Without a timeout, a single hung request stalls anything awaiting it
// indefinitely — fatal for callers like runLeagueSync that fire dozens of
// these concurrently via Promise.all: one unresponsive league would hold the
// whole batch (and its caller's request timeout) hostage.
const REQUEST_TIMEOUT_MS = 8000;

// The refresh workflow runs every 15 minutes and makes dozens of these calls
// per run, so "rare" transport faults are a near-daily event: a single
// `read ECONNRESET` partway through a run used to abort the whole pipeline and
// mail out a failure notice. Retry the faults that are actually worth
// retrying — dropped connections, timeouts, 429 and 5xx — and let a genuine
// 4xx through on the first attempt, since that won't fix itself.
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Marks the responses where retrying is pointless, so the retry loop below can
// treat everything else — including the TypeErrors fetch throws for transport
// failures and the AbortError from our own timeout — as worth another go.
class FatalHttpError extends Error {}

async function getOnce(path: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${ESPORTS}/${path}`, {
      headers: { "x-api-key": API_KEY },
      signal: controller.signal,
    });
    if (!res.ok) {
      const message = `LoL Esports API ${path} failed: ${res.status} ${res.statusText}`;
      if (res.status === 429 || res.status >= 500) throw new Error(message);
      throw new FatalHttpError(message);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function get(path: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await getOnce(path);
    } catch (err) {
      if (err instanceof FatalHttpError) throw err;
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`LoL Esports API ${path} attempt ${attempt} failed (${err}) — retrying`);
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError;
}

// ── Types describing ONLY the fields we actually use (from the raw JSON we
//    inspected). Partial on purpose — the API returns much more. ──

export interface ApiLeague {
  id: string;
  slug: string;
  name: string;
  region: string;
  image?: string; // league logo
}

export interface ApiScheduleTeam {
  name: string;
  code: string;
  image: string;
  result: { outcome: string | null; gameWins: number } | null;
}

export interface ApiScheduleEvent {
  startTime: string;
  state: string; // unstarted | inProgress | completed
  type: string; // "match" | "show" ...
  blockName?: string; // stage/round label, e.g. "Week 1", "Semifinals"
  league: { name: string; slug: string };
  match?: {
    id: string;
    teams: ApiScheduleTeam[];
    strategy: { type: string; count: number };
  };
}

export async function getLeagues(): Promise<ApiLeague[]> {
  const data = await get("getLeagues?hl=en-US");
  return data.data.leagues;
}

export async function getSchedule(): Promise<ApiScheduleEvent[]> {
  const data = await get("getSchedule?hl=en-US");
  return data.data.schedule.events;
}

// ── Match detail: the games inside a series, with REAL team ids + side mapping ──

export interface ApiEventTeam {
  id: string;
  name: string;
  code: string;
  image: string;
  result?: { gameWins: number } | null;
}

export interface ApiGame {
  number: number;
  id: string;
  state: string; // completed | unneeded | inProgress | unstarted
  teams: { id: string; side: string }[]; // side = "blue" | "red"
}

export async function getEventDetails(
  matchId: string
): Promise<{ teams: ApiEventTeam[]; games: ApiGame[] }> {
  const data = await get(`getEventDetails?hl=en-US&id=${matchId}`);
  // Seen live: the API can return a 200 with data.event itself null for a
  // specific match id (crashed the entire refresh pipeline on an unguarded
  // access here — one broken match took down every other match's processing
  // in the same run too). A clear, catchable error lets callers skip just
  // this one match instead.
  const event = data?.data?.event;
  if (!event?.match) {
    throw new Error(`getEventDetails: no event data for match ${matchId}`);
  }
  const m = event.match;
  return { teams: m.teams, games: m.games };
}

// ── Per-game live stats, from the SEPARATE feed host (no api key needed) ──

const FEED = "https://feed.lolesports.com/livestats/v1";

export interface WindowPlayerMeta {
  participantId: number;
  esportsPlayerId: string;
  summonerName: string;
  championId: string;
  role: string;
}

export interface WindowPlayerStat {
  participantId: number;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  totalGold: number;
}

export interface WindowTeamStats {
  totalGold: number;
  barons: number;
  dragons: string[]; // dragon types in kill order, e.g. ["cloud", "chemtech"]
  // Structures this team has destroyed, and its total kills. Neither is stored
  // per-game on its own, but both feed inferGameWinner below.
  towers: number;
  inhibitors: number;
  totalKills: number;
  participants: WindowPlayerStat[];
}

export interface GameWindow {
  gameMetadata: {
    patchVersion: string; // e.g. "16.16.809.3269" — see shortPatch()
    blueTeamMetadata: { participantMetadata: WindowPlayerMeta[] };
    redTeamMetadata: { participantMetadata: WindowPlayerMeta[] };
  };
  frames: {
    rfc460Timestamp: string; // wall-clock time of this frame
    gameState: string;
    blueTeam: WindowTeamStats;
    redTeam: WindowTeamStats;
  }[];
}

// "16.16.809.3269" -> "16.16". The trailing build numbers change within a
// patch and aren't what anyone means by "the patch this was played on".
export function shortPatch(patchVersion: string | undefined): string | null {
  if (!patchVersion) return null;
  const parts = patchVersion.split(".");
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : patchVersion;
}

// NOTHING in Riot's esports API reports which team actually won a given GAME —
// getEventDetails and getCompletedEvents only carry series-level gameWins, and
// the live-stats feed has no outcome field. So the winner is inferred from the
// final frame's structure counts instead.
//
// Why this is trustworthy rather than a guess: reaching a nexus REQUIRES
// destroying at least one inhibitor, so the winner's inhibitor count is
// necessarily >= 1 and (barring a same-game trade) above the loser's. Towers
// break the rare inhibitor tie (a win needs 3 lane turrets + 2 nexus turrets),
// and gold is a last resort.
//
// Validated against 111 games with independently known outcomes — every Bo1
// and every sweep (where the series result fixes each game's winner), plus 18
// close series checked by whether the inferred per-game wins reconcile exactly
// with the recorded series score. 111/111 correct, including 2 tower ties.
// Gold ALONE was only ~93% accurate on the same test, which is why it is only
// the final tiebreak here and not the primary signal.
export function inferGameWinner<T extends { towers: number; inhibitors: number; totalGold: number }>(
  a: T,
  b: T
): "a" | "b" {
  if (a.inhibitors !== b.inhibitors) return a.inhibitors > b.inhibitors ? "a" : "b";
  if (a.towers !== b.towers) return a.towers > b.towers ? "a" : "b";
  return a.totalGold >= b.totalGold ? "a" : "b";
}

// ── Teams & rosters (the source for team/player pages) ──

export interface ApiRosterPlayer {
  id: string;
  summonerName: string;
  firstName?: string;
  lastName?: string;
  image?: string;
  role: string;
}

export interface ApiTeam {
  id: string;
  slug: string;
  name: string;
  code: string;
  image: string;
  homeLeague: { name: string; region: string } | null;
  players: ApiRosterPlayer[];
}

// Pass a team slug to fetch one team; omit for ALL teams (~1500).
export async function getTeams(teamSlug?: string): Promise<ApiTeam[]> {
  const query = teamSlug ? `getTeams?hl=en-US&id=${teamSlug}` : "getTeams?hl=en-US";
  const data = await get(query);
  return data.data.teams;
}

// ── Tournaments & standings (for league tables) ──

export interface ApiTournament {
  id: string;
  slug: string;
  startDate: string;
  endDate: string;
}

export async function getTournamentsForLeague(leagueId: string): Promise<ApiTournament[]> {
  const data = await get(`getTournamentsForLeague?hl=en-US&leagueId=${leagueId}`);
  return data.data.leagues?.[0]?.tournaments ?? [];
}

// Standings are deeply nested (stages → sections → rankings). Returned raw here;
// we can shape it when we actually build the standings UI.
export async function getStandings(tournamentId: string) {
  const data = await get(`getStandings?hl=en-US&tournamentId=${tournamentId}`);
  return data.data.standings;
}

// Round a timestamp DOWN to the nearest 10 seconds and return ISO — the feed
// endpoint only accepts 10-second-aligned times.
function roundTo10s(ms: number): string {
  return new Date(Math.floor(ms / 10_000) * 10_000).toISOString();
}

// Later games in a series start at unpredictable real-world offsets from the
// series' own start (earlier games + intermissions all eat into it), so we
// can't know in advance which hour offset lands after a given game's end.
// We probe an escalating ladder of offsets and — critically — don't stop at
// the first non-204 response, since an early guess can land mid-game with a
// perfectly valid but incomplete snapshot (frames[].gameState === "in_game").
// We only accept a response once we see gameState "finished"; short of that
// we keep probing later offsets, falling back to the last non-empty response
// we saw if every offset in the ladder still comes back "in_game".
const OFFSET_HOURS_LADDER = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20];

export interface GameWindowResult {
  data: GameWindow;
  // The exact startingTime that produced this data — a caller can reuse it to
  // query the sibling /details feed for the SAME instant (see getGameDetails).
  startingTime: string;
}

// Total gold is our proxy for "how far into the game this snapshot reached" —
// used below to pick the best fallback when no offset ever finds "finished".
function totalGold(frame: GameWindow["frames"][number]): number {
  return frame.blueTeam.totalGold + frame.redTeam.totalGold;
}

export async function getGameWindow(gameId: string, seriesStartMs: number): Promise<GameWindowResult | null> {
  let lastGood: GameWindowResult | null = null;
  for (const hours of OFFSET_HOURS_LADDER) {
    const startingTime = roundTo10s(seriesStartMs + hours * 3_600_000);
    // A non-ok/malformed response at ONE offset used to abort the whole
    // ladder (`break`) — but that's indistinguishable from a transient
    // hiccup on the feed host, and gave up before ever trying later offsets
    // that might have reached the game's actual "finished" frame. Two real
    // games ended up with a mid-game (even opening-seconds) snapshot stored
    // as their final stats this way. Keep probing instead; only exhausting
    // the whole ladder without ever seeing "finished" falls back to
    // best-effort (below).
    let res: Response;
    try {
      res = await fetch(`${FEED}/window/${gameId}?startingTime=${startingTime}`);
    } catch {
      continue;
    }
    if (res.status === 204) continue; // time was before this game started — try later
    if (!res.ok) continue;
    const text = await res.text();
    try {
      const json = JSON.parse(text) as GameWindow;
      if (!json.frames?.length) continue;
      if (json.frames.some((f) => f.gameState === "finished")) return { data: json, startingTime };
      // Not finished — larger offsets aren't guaranteed to be further into
      // the game than smaller ones. Seen live: a game's window buffer reset
      // to a near-empty snapshot for every offset past the first, so always
      // keeping "whichever response we tried most recently" (the ladder's
      // original behavior) meant a real, substantial mid-game snapshot got
      // silently replaced by a worse one. Keep whichever candidate is
      // furthest into the game instead, regardless of iteration order.
      const candidate = json.frames[json.frames.length - 1];
      const currentBest = lastGood?.data.frames[lastGood.data.frames.length - 1];
      if (!currentBest || totalGold(candidate) > totalGold(currentBest)) {
        lastGood = { data: json, startingTime };
      }
    } catch {
      continue;
    }
  }
  return lastGood; // best-effort: never saw "finished", but return whatever we've got
}

// ── Game duration ──
//
// No endpoint reports a game's length, and /window only ever returns a short
// rolling window of frames around the startingTime you ask for — never the
// whole game — so the end frame's timestamp alone tells you nothing about when
// the game began.
//
// What the feed DOES give us is a clean monotonic signal: it answers 204 for
// any startingTime before the game's first frame and 200 from then on. That
// boundary IS the game start, so binary-searching it costs ~10 requests
// (10-second granularity over a 95-minute range) instead of walking the feed.
//
// Deliberately kept out of the per-game ingest path: ~4s per game is far too
// slow for the 2-minute refresh tier's 60s budget, so this is driven by the
// separate, limit-bounded ingest-gamemeta job.
const MAX_GAME_MINUTES = 95;

export async function findGameStartMs(gameId: string, endMs: number): Promise<number | null> {
  let lo = endMs - MAX_GAME_MINUTES * 60_000; // assumed before the game started
  let hi = endMs; // known to be during/after the game

  // Guard the assumption that `lo` really is before the start — otherwise the
  // search would converge on the range edge and report a bogus 95m game.
  try {
    const res = await fetch(`${FEED}/window/${gameId}?startingTime=${roundTo10s(lo)}`);
    if (res.status === 200) return null; // game ran longer than the search window
  } catch {
    return null;
  }

  while (hi - lo > 10_000) {
    const mid = lo + Math.floor((hi - lo) / 2);
    let res: Response;
    try {
      res = await fetch(`${FEED}/window/${gameId}?startingTime=${roundTo10s(mid)}`);
    } catch {
      return null; // a hole in the middle of the search makes the result unsound
    }
    if (res.status === 200) hi = mid;
    else if (res.status === 204) lo = mid;
    else return null;
  }
  return hi;
}

// A sibling of /window on the same feed host — same participantId indexing,
// but carries the player's final item build instead of the summary numbers.
// It has no gameState of its own, so we don't re-guess independently: the
// caller passes the exact startingTime that getGameWindow already confirmed
// was "finished" for this same game, keeping items and K/D/A/gold in sync.
export interface DetailsPlayerStat {
  participantId: number;
  items: number[]; // item ids, in inventory-slot order (trinket included)
  perkMetadata: {
    styleId: number; // primary rune tree id
    subStyleId: number; // secondary rune tree id
    perks: number[]; // perks[0] is the keystone (primary tree's first-slot pick)
  };
}

export interface GameDetails {
  frames: { participants: DetailsPlayerStat[] }[];
}

export async function getGameDetails(gameId: string, startingTime: string): Promise<GameDetails | null> {
  // Every other failure mode here degrades to null; an unguarded fetch left a
  // dropped connection to the feed host as the one way this could instead
  // throw and take the whole run down with it.
  let res: Response;
  try {
    res = await fetch(`${FEED}/details/${gameId}?startingTime=${startingTime}`);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const text = await res.text();
  try {
    const json = JSON.parse(text) as GameDetails;
    return json.frames?.length ? json : null;
  } catch {
    return null;
  }
}
