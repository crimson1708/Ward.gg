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
