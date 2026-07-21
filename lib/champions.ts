import championData from "./champion-data.json";

const { version, names } = championData as { version: string; names: Record<string, string> };

// The esports live-stats feed's championId casing doesn't always match Data
// Dragon's id exactly. Known mismatches go here rather than silently falling
// back to plain text for an otherwise perfectly valid champion.
const ID_ALIASES: Record<string, string> = {
  FiddleSticks: "Fiddlesticks",
};

export interface ChampionInfo {
  name: string;
  iconUrl: string | null;
}

// Looks up a champion by its raw API id (e.g. "MonkeyKing", "XinZhao"). Ids
// we don't recognize (a champion added after the last `ingest:champions` run,
// or a placeholder in test data) fall back to showing the raw id as text with
// no icon, rather than a broken image.
export function getChampionInfo(rawId: string): ChampionInfo {
  const id = ID_ALIASES[rawId] ?? rawId;
  const name = names[id];
  if (!name) return { name: rawId, iconUrl: null };
  return { name, iconUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${id}.png` };
}

// Leaguepedia's ban data comes back as display names ("Wukong", "Xin Zhao"),
// not the raw ids the esports feed uses — this is the reverse of `names`, for
// converting those back to a ddragon id at ingest time.
const idByName: Record<string, string> = {};
for (const [id, name] of Object.entries(names)) idByName[name.toLowerCase()] = id;

export function getChampionIdByName(name: string): string | null {
  return idByName[name.trim().toLowerCase()] ?? null;
}
