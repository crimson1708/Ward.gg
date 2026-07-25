import runeData from "./rune-data.json";

const { version, names, icons } = runeData as {
  version: string;
  names: Record<string, string>;
  icons: Record<string, string>;
};

export interface RuneInfo {
  name: string;
  iconUrl: string;
}

// Rune icon paths are NOT versioned the way champion/item images are — they
// live under the flat /cdn/img/ path, not /cdn/{version}/img/.
export function getRuneInfo(perkId: number): RuneInfo | null {
  const name = names[String(perkId)];
  const icon = icons[String(perkId)];
  if (!name || !icon) return null;
  return { name, iconUrl: `https://ddragon.leagueoflegends.com/cdn/img/${icon}` };
}

// Leaguepedia's KeystoneRune/PrimaryTree/SecondaryTree fields come back as
// display names ("Electrocute", "Domination") — the reverse of `names` (which
// covers both tree-level and individual-perk entries), for converting those
// back to a ddragon perk id at ingest time.
const idByName: Record<string, number> = {};
for (const [id, name] of Object.entries(names)) idByName[name.toLowerCase()] = Number(id);

export function getRuneIdByName(name: string): number | null {
  return idByName[name.trim().toLowerCase()] ?? null;
}
