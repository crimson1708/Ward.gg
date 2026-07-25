import spellData from "./summoner-spell-data.json";

const { version, names, icons } = spellData as {
  version: string;
  names: Record<string, string>;
  icons: Record<string, string>;
};

export interface SummonerSpellInfo {
  name: string;
  iconUrl: string;
}

export function getSummonerSpellInfo(id: number): SummonerSpellInfo | null {
  const name = names[String(id)];
  const icon = icons[String(id)];
  if (!name || !icon) return null;
  return { name, iconUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${icon}` };
}

// Leaguepedia's SummonerSpells field comes back as display names ("Flash",
// "Ignite") — the reverse of `names`, for converting those back to the
// numeric id at ingest time. A couple of names collide across game modes
// (e.g. two different ids both display as "Flash") — the standard
// Summoner's Rift id wins since that's the only mode we ever ingest.
const PREFERRED_ID_ON_NAME_COLLISION: Record<string, number> = {
  Flash: 4,
};
const idByName: Record<string, number> = {};
for (const [id, name] of Object.entries(names)) {
  if (idByName[name.toLowerCase()] !== undefined && !(name in PREFERRED_ID_ON_NAME_COLLISION)) continue;
  idByName[name.toLowerCase()] = PREFERRED_ID_ON_NAME_COLLISION[name] ?? Number(id);
}

export function getSummonerSpellIdByName(name: string): number | null {
  return idByName[name.trim().toLowerCase()] ?? null;
}
