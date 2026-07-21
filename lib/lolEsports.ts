// Thin client for the LoL Esports API. Its only job is to fetch + return JSON.
// It knows nothing about our database — that separation keeps things testable
// and means we could swap data sources later without touching ingestion logic.

const API_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"; // public shared key
const ESPORTS = "https://esports-api.lolesports.com/persisted/gw";

async function get(path: string) {
  const res = await fetch(`${ESPORTS}/${path}`, {
    headers: { "x-api-key": API_KEY },
  });
  if (!res.ok) {
    throw new Error(`LoL Esports API ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
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
  const m = data.data.event.match;
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
  participants: WindowPlayerStat[];
}

export interface GameWindow {
  gameMetadata: {
    blueTeamMetadata: { participantMetadata: WindowPlayerMeta[] };
    redTeamMetadata: { participantMetadata: WindowPlayerMeta[] };
  };
  frames: {
    gameState: string;
    blueTeam: WindowTeamStats;
    redTeam: WindowTeamStats;
  }[];
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

export async function getGameWindow(gameId: string, seriesStartMs: number): Promise<GameWindowResult | null> {
  let lastGood: GameWindowResult | null = null;
  for (const hours of OFFSET_HOURS_LADDER) {
    const startingTime = roundTo10s(seriesStartMs + hours * 3_600_000);
    const res = await fetch(`${FEED}/window/${gameId}?startingTime=${startingTime}`);
    if (res.status === 204) continue; // time was before this game started — try later
    if (!res.ok) break; // no feed for this game
    const text = await res.text();
    try {
      const json = JSON.parse(text) as GameWindow;
      if (!json.frames?.length) continue;
      lastGood = { data: json, startingTime };
      if (json.frames.some((f) => f.gameState === "finished")) return lastGood;
    } catch {
      break;
    }
  }
  return lastGood; // best-effort: never saw "finished", but return whatever we've got
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
  const res = await fetch(`${FEED}/details/${gameId}?startingTime=${startingTime}`);
  if (!res.ok) return null;
  const text = await res.text();
  try {
    const json = JSON.parse(text) as GameDetails;
    return json.frames?.length ? json : null;
  } catch {
    return null;
  }
}
