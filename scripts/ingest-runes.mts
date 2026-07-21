// RUNE DATA — same idea as ingest-champions.mts/ingest-items.mts: pull
// perk id -> name/icon from Data Dragon's rune tree data. We only care about
// keystones right now (the 4 options in each tree's first slot), but this
// flattens every perk in every tree/slot since it's the same one-time fetch
// either way and costs nothing extra to keep around.
//
// Icon paths here are NOT versioned like champion/item images — they live
// under the unversioned /cdn/img/ path, not /cdn/{version}/img/.
//
// Run:  npx tsx scripts/ingest-runes.mts

import { writeFileSync } from "node:fs";

const DDRAGON = "https://ddragon.leagueoflegends.com";

interface RuneEntry {
  id: number;
  key: string;
  icon: string;
  name: string;
}

interface RuneTree {
  id: number;
  key: string;
  icon: string;
  name: string;
  slots: { runes: RuneEntry[] }[];
}

async function main() {
  const versions: string[] = await (await fetch(`${DDRAGON}/api/versions.json`)).json();
  const version = versions[0];

  const res = await fetch(`${DDRAGON}/cdn/${version}/data/en_US/runesReforged.json`);
  const trees = (await res.json()) as RuneTree[];

  const names: Record<string, string> = {};
  const icons: Record<string, string> = {};
  for (const tree of trees) {
    names[tree.id] = tree.name;
    icons[tree.id] = tree.icon;
    for (const slot of tree.slots) {
      for (const rune of slot.runes) {
        names[rune.id] = rune.name;
        icons[rune.id] = rune.icon;
      }
    }
  }

  const out = { version, names, icons };
  writeFileSync(new URL("../lib/rune-data.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");

  console.log(`Rune data written: version ${version}, ${Object.keys(names).length} entries.`);
}

main().catch((err) => {
  console.error("Rune ingestion failed:", err);
  process.exit(1);
});
