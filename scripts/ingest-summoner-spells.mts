// SUMMONER SPELL DATA — same idea as ingest-champions.mts/ingest-items.mts:
// pull numeric spell id -> name/icon from Data Dragon, once. Small, low-churn
// dataset (about a dozen active spells), but kept as its own generated json
// rather than hardcoded to stay consistent with how champions/items/runes are
// already handled here, and so a future new spell needs no code change.
//
// Run:  npx tsx scripts/ingest-summoner-spells.mts

import { writeFileSync } from "node:fs";

const DDRAGON = "https://ddragon.leagueoflegends.com";

interface SpellEntry {
  id: string; // internal name, e.g. "SummonerFlash" — used in the icon filename
  name: string; // display name, e.g. "Flash"
  key: string; // numeric spell id as a string, e.g. "4"
}

async function main() {
  const versions: string[] = await (await fetch(`${DDRAGON}/api/versions.json`)).json();
  const version = versions[0];

  const res = await fetch(`${DDRAGON}/cdn/${version}/data/en_US/summoner.json`);
  const json = (await res.json()) as { data: Record<string, SpellEntry> };

  const names: Record<string, string> = {};
  const icons: Record<string, string> = {};
  for (const spell of Object.values(json.data)) {
    names[spell.key] = spell.name;
    icons[spell.key] = `${spell.id}.png`;
  }

  const out = { version, names, icons };
  writeFileSync(new URL("../lib/summoner-spell-data.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");

  console.log(`Summoner spell data written: version ${version}, ${Object.keys(names).length} entries.`);
}

main().catch((err) => {
  console.error("Summoner spell ingestion failed:", err);
  process.exit(1);
});
