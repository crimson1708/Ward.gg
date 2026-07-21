// CHAMPION DATA — pulls id -> proper display name from Riot's public Data
// Dragon CDN (the same static asset host that ships in-game icons; distinct
// from the private esports/news APIs — this one's meant for exactly this).
// Also gives us icon URLs for free: https://ddragon.leagueoflegends.com/cdn/
// {version}/img/champion/{id}.png — no need to host the images ourselves.
//
// This fixes two things at once: outdated names (Riot's internal id for
// Wukong is still "MonkeyKing" from before the rework) and unspaced ids
// ("XinZhao" -> "Xin Zhao") — both come out right once we key off ddragon's
// own name field instead of the raw id.
//
// Run:  npx tsx scripts/ingest-champions.mts

import { writeFileSync } from "node:fs";

const DDRAGON = "https://ddragon.leagueoflegends.com";

async function main() {
  const versions: string[] = await (await fetch(`${DDRAGON}/api/versions.json`)).json();
  const version = versions[0];

  const res = await fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`);
  const json = await res.json();

  const names: Record<string, string> = {};
  for (const [id, champ] of Object.entries(json.data as Record<string, { name: string }>)) {
    names[id] = champ.name;
  }

  const out = { version, names };
  writeFileSync(
    new URL("../lib/champion-data.json", import.meta.url),
    JSON.stringify(out, null, 2) + "\n"
  );

  console.log(`Champion data written: version ${version}, ${Object.keys(names).length} champions.`);
}

main().catch((err) => {
  console.error("Champion ingestion failed:", err);
  process.exit(1);
});
