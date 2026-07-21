// ITEM DATA — same idea as ingest-champions.mts: pull id -> name from Riot's
// public Data Dragon CDN, which also gives us icon URLs for free
// (https://ddragon.leagueoflegends.com/cdn/{version}/img/item/{id}.png).
// Static reference data — only changes when items get added/reworked, so this
// is a manual/occasional script, not part of the frequent refresh loop.
//
// Run:  npx tsx scripts/ingest-items.mts

import { writeFileSync } from "node:fs";

const DDRAGON = "https://ddragon.leagueoflegends.com";

async function main() {
  const versions: string[] = await (await fetch(`${DDRAGON}/api/versions.json`)).json();
  const version = versions[0];

  const res = await fetch(`${DDRAGON}/cdn/${version}/data/en_US/item.json`);
  const json = await res.json();

  const names: Record<string, string> = {};
  for (const [id, item] of Object.entries(json.data as Record<string, { name: string }>)) {
    names[id] = item.name;
  }

  const out = { version, names };
  writeFileSync(new URL("../lib/item-data.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");

  console.log(`Item data written: version ${version}, ${Object.keys(names).length} items.`);
}

main().catch((err) => {
  console.error("Item ingestion failed:", err);
  process.exit(1);
});
