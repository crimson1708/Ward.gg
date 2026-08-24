// Client for Leaguepedia's public Cargo query API — the same source the
// community's automated "full box score" post-match bots pull from. Riot's
// own feeds (esports-api, live-stats) have no draft/ban data and no Void
// Grub tracking at all, so this is the only place to get either.
//
// IMPORTANT: this API rate-limits aggressively on bursts (a handful of
// requests within a few seconds is enough to get a temporary block that
// lasts a couple of minutes). Every caller MUST space requests out — see
// scripts/ingest-draft.mts for the delay/backoff loop. Nothing in this file
// enforces that itself; it just makes one request and reports what happened.

const CARGO_ENDPOINT = "https://lol.fandom.com/api.php";

export interface LeaguepediaGame {
  gameId: string | null; // ScoreboardGames' own row id — join key into ScoreboardPlayers
  team1Bans: string[]; // champion display names, e.g. "Wukong"
  team2Bans: string[];
  team1VoidGrubs: number;
  team2VoidGrubs: number;
  team1RiftHeralds: number;
  team2RiftHeralds: number;
}

// Cargo's JSON output doesn't consistently use the field names you queried
// with (e.g. "DateTime_UTC" comes back as "DateTime UTC", underscore turned
// to space) — so field lookups are done by a normalized (letters+digits
// only, lowercased) comparison instead of an exact key match.
function normalizeKey(s: string): string {
  return s.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function getField(row: Record<string, string>, name: string): string {
  const target = normalizeKey(name);
  for (const key of Object.keys(row)) {
    if (normalizeKey(key) === target) return row[key];
  }
  return "";
}

function escapeCargoString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export type LeaguepediaResult =
  | { ok: true; game: LeaguepediaGame | null } // null = no matching row found
  | { ok: false; rateLimited: boolean }; // request itself failed

// Looks up one game's bans + Void Grubs by team names, an approximate date,
// and its game number within the series (Leaguepedia's N_GameInMatch) — we
// have no shared id with Riot's own data to join on (RiotGameId is usually
// blank, and RiotPlatformGameId uses a different scheme than our externalId),
// so this is a best-effort match, not a guaranteed one. Returns ok:false only
// when the request itself failed (rate limit or network) so the caller can
// decide whether to retry; a clean "nothing found" is ok:true, game:null.
export async function findLeaguepediaGame(
  team1Name: string,
  team2Name: string,
  approxDate: Date,
  gameNumber: number
): Promise<LeaguepediaResult> {
  const dayBefore = new Date(approxDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dayAfter = new Date(approxDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const t1 = escapeCargoString(team1Name);
  const t2 = escapeCargoString(team2Name);
  const where =
    `((Team1="${t1}" AND Team2="${t2}") OR (Team1="${t2}" AND Team2="${t1}"))` +
    ` AND DateTime_UTC >= "${dayBefore}" AND DateTime_UTC <= "${dayAfter}"`;

  const params = new URLSearchParams({
    action: "cargoquery",
    tables: "ScoreboardGames",
    fields:
      "Team1,Team2,Team1Bans,Team2Bans,Team1VoidGrubs,Team2VoidGrubs,Team1RiftHeralds,Team2RiftHeralds,N_GameInMatch,GameId",
    where,
    format: "json",
    limit: "20",
  });

  let res: Response;
  try {
    res = await fetch(`${CARGO_ENDPOINT}?${params}`, {
      headers: { "User-Agent": "WardLoLStatsBot/1.0 (hobby project; contact via GitHub issues)" },
    });
  } catch {
    return { ok: false, rateLimited: false };
  }
  if (!res.ok) return { ok: false, rateLimited: false };

  const json = await res.json();
  if (json.error) {
    return { ok: false, rateLimited: json.error.code === "ratelimited" };
  }

  const rows: { title: Record<string, string> }[] = json.cargoquery ?? [];
  const row = rows.find((r) => Number(getField(r.title, "N_GameInMatch")) === gameNumber);
  if (!row) return { ok: true, game: null };

  const splitList = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  // Leaguepedia's Team1/Team2 don't necessarily line up with our own
  // team1Name/team2Name argument order — re-check which is which.
  const rowTeam1 = getField(row.title, "Team1");
  const team1IsOurTeam1 = rowTeam1.toLowerCase() === team1Name.trim().toLowerCase();

  const rawTeam1Bans = splitList(getField(row.title, "Team1Bans"));
  const rawTeam2Bans = splitList(getField(row.title, "Team2Bans"));
  const rawTeam1Grubs = Number(getField(row.title, "Team1VoidGrubs")) || 0;
  const rawTeam2Grubs = Number(getField(row.title, "Team2VoidGrubs")) || 0;
  const rawTeam1Heralds = Number(getField(row.title, "Team1RiftHeralds")) || 0;
  const rawTeam2Heralds = Number(getField(row.title, "Team2RiftHeralds")) || 0;
  const gameId = getField(row.title, "GameId") || null;

  return {
    ok: true,
    game: team1IsOurTeam1
      ? {
          gameId,
          team1Bans: rawTeam1Bans,
          team2Bans: rawTeam2Bans,
          team1VoidGrubs: rawTeam1Grubs,
          team2VoidGrubs: rawTeam2Grubs,
          team1RiftHeralds: rawTeam1Heralds,
          team2RiftHeralds: rawTeam2Heralds,
        }
      : {
          gameId,
          team1Bans: rawTeam2Bans,
          team2Bans: rawTeam1Bans,
          team1VoidGrubs: rawTeam2Grubs,
          team2VoidGrubs: rawTeam1Grubs,
          team1RiftHeralds: rawTeam2Heralds,
          team2RiftHeralds: rawTeam1Heralds,
        },
  };
}

export interface LeaguepediaPlayerRow {
  team: string; // this player's own team name, as Leaguepedia has it
  champion: string; // display name, e.g. "Lee Sin" — match against our own GameStat.champion via getChampionIdByName
  items: string[]; // display names, final build, NOT including trinket/role-bound item (those are separate fields below)
  trinket: string | null;
  roleBoundItem: string | null; // support/jungle item line Riot's own feed sometimes misses
  summonerSpells: string[]; // display names, e.g. ["Flash", "Ignite"]
  primaryTree: string | null;
  secondaryTree: string | null;
  keystoneRune: string | null;
}

export type LeaguepediaPlayersResult =
  | { ok: true; players: LeaguepediaPlayerRow[] } // empty array = query succeeded, nothing found for this id
  | { ok: false; rateLimited: boolean };

// All 10 players for one specific game, keyed by the GameId a prior
// findLeaguepediaGame call already resolved — a direct id lookup, not a
// best-effort name/date match, so this is exact once you have a valid id.
export async function findLeaguepediaPlayers(gameId: string): Promise<LeaguepediaPlayersResult> {
  const params = new URLSearchParams({
    action: "cargoquery",
    tables: "ScoreboardPlayers",
    fields: "Team,Champion,Items,Trinket,RoleBoundItem,SummonerSpells,PrimaryTree,SecondaryTree,KeystoneRune",
    where: `GameId="${escapeCargoString(gameId)}"`,
    format: "json",
    limit: "10",
  });

  let res: Response;
  try {
    res = await fetch(`${CARGO_ENDPOINT}?${params}`, {
      headers: { "User-Agent": "WardLoLStatsBot/1.0 (hobby project; contact via GitHub issues)" },
    });
  } catch {
    return { ok: false, rateLimited: false };
  }
  if (!res.ok) return { ok: false, rateLimited: false };

  const json = await res.json();
  if (json.error) {
    return { ok: false, rateLimited: json.error.code === "ratelimited" };
  }

  const splitList = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  const rows: { title: Record<string, string> }[] = json.cargoquery ?? [];
  const players: LeaguepediaPlayerRow[] = rows.map((r) => ({
    team: getField(r.title, "Team"),
    champion: getField(r.title, "Champion"),
    items: splitList(getField(r.title, "Items")),
    trinket: getField(r.title, "Trinket") || null,
    roleBoundItem: getField(r.title, "RoleBoundItem") || null,
    summonerSpells: splitList(getField(r.title, "SummonerSpells")),
    primaryTree: getField(r.title, "PrimaryTree") || null,
    secondaryTree: getField(r.title, "SecondaryTree") || null,
    keystoneRune: getField(r.title, "KeystoneRune") || null,
  }));

  return { ok: true, players };
}

export interface LeaguepediaPlayerProfile {
  /** Leaguepedia's own player id, which is the in-game handle. */
  id: string;
  country: string | null; // full English name, e.g. "South Korea"
}

export type LeaguepediaProfilesResult =
  | { ok: true; profiles: LeaguepediaPlayerProfile[] }
  | { ok: false; rateLimited: boolean };

// Country of origin for a batch of players, looked up by handle.
//
// This is the ONLY source we have for a player's country — the esports API's
// roster endpoint carries names and headshots but no nationality at all.
//
// Batched by handle rather than queried one player at a time: Leaguepedia
// rate-limits hard on bursts, and an IN(...) clause turns ~1300 players into a
// couple of dozen requests. Matching is on Leaguepedia's `ID`, which IS the
// in-game handle, so this is a direct lookup — but handles are only unique on
// their side, and a player who has since renamed may not match at all. A miss
// is a normal outcome, not an error.
export async function findLeaguepediaProfiles(handles: string[]): Promise<LeaguepediaProfilesResult> {
  if (handles.length === 0) return { ok: true, profiles: [] };

  const list = handles.map((h) => `"${escapeCargoString(h)}"`).join(",");
  const params = new URLSearchParams({
    action: "cargoquery",
    tables: "Players",
    fields: "ID,Country",
    where: `ID IN (${list})`,
    format: "json",
    limit: String(Math.max(handles.length * 2, 50)),
  });

  let res: Response;
  try {
    res = await fetch(`${CARGO_ENDPOINT}?${params}`, {
      headers: { "User-Agent": "WardLoLStatsBot/1.0 (hobby project; contact via GitHub issues)" },
    });
  } catch {
    return { ok: false, rateLimited: false };
  }
  if (!res.ok) return { ok: false, rateLimited: false };

  const json = await res.json();
  if (json.error) return { ok: false, rateLimited: json.error.code === "ratelimited" };

  const rows: { title: Record<string, string> }[] = json.cargoquery ?? [];
  return {
    ok: true,
    profiles: rows.map((r) => ({
      id: getField(r.title, "ID"),
      country: getField(r.title, "Country") || null,
    })),
  };
}
