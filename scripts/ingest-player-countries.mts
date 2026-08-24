// PLAYER COUNTRY INGESTION — the flags on the player pages.
// Run:  npx tsx scripts/ingest-player-countries.mts [--force]
//
// Split out from ingest-players.mts because the two have completely different
// sources and cost profiles: real names and headshots come from Riot's roster
// endpoint in ONE cheap request, while nationality exists only on Leaguepedia,
// whose API rate-limits aggressively on bursts (see lib/leaguepedia.ts). So
// this is its own slow, deliberately-spaced job, exactly like ingest-draft.
//
// Players are looked up by handle in batches, which keeps ~1300 players down
// to a couple of dozen requests. A player who doesn't match (renamed since, or
// simply not on Leaguepedia) is left alone — by default they're retried on the
// next run, since there's no per-player "checked" marker for this.

import { pathToFileURL } from "node:url";
import { prisma } from "../lib/prisma.ts";
import { findLeaguepediaProfiles } from "../lib/leaguepedia.ts";

const BATCH_SIZE = 50;
const DELAY_MS = 4000; // baseline spacing between requests
const RATE_LIMIT_BACKOFF_MS = 75_000;
const MAX_RETRIES_PER_BATCH = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runPlayerCountriesIngest(options: { force?: boolean } = {}) {
  const { force = false } = options;

  const players = await prisma.player.findMany({
    where: force ? {} : { country: null },
    select: { id: true, handle: true, country: true },
  });
  console.log(`Players needing a country: ${players.length}`);

  // One row per handle — several Player rows can share a handle (a smurf
  // account, or the same person re-created under a new esports id), and they
  // should all get the same country from a single lookup.
  const byHandle = new Map<string, number[]>();
  for (const p of players) {
    const key = p.handle.trim();
    if (!key) continue;
    const ids = byHandle.get(key);
    if (ids) ids.push(p.id);
    else byHandle.set(key, [p.id]);
  }

  const handles = [...byHandle.keys()];
  let matched = 0;
  let updated = 0;

  for (let i = 0; i < handles.length; i += BATCH_SIZE) {
    const batch = handles.slice(i, i + BATCH_SIZE);
    let attempt = 0;

    while (attempt <= MAX_RETRIES_PER_BATCH) {
      const result = await findLeaguepediaProfiles(batch);

      if (!result.ok) {
        if (result.rateLimited && attempt < MAX_RETRIES_PER_BATCH) {
          attempt++;
          console.log(`  rate limited — backing off ${RATE_LIMIT_BACKOFF_MS / 1000}s (attempt ${attempt})`);
          await sleep(RATE_LIMIT_BACKOFF_MS);
          continue;
        }
        console.log(`  batch ${i / BATCH_SIZE + 1} failed (${result.rateLimited ? "rate limited" : "request error"}) — skipping`);
        break;
      }

      for (const profile of result.profiles) {
        if (!profile.country) continue;
        // Leaguepedia's id casing doesn't always match the summoner name the
        // live-stats feed gave us, so resolve case-insensitively.
        const key = [...byHandle.keys()].find((h) => h.toLowerCase() === profile.id.toLowerCase());
        if (!key) continue;
        matched++;
        for (const playerId of byHandle.get(key)!) {
          await prisma.player.update({ where: { id: playerId }, data: { country: profile.country } });
          updated++;
        }
      }
      console.log(`  batch ${i / BATCH_SIZE + 1}/${Math.ceil(handles.length / BATCH_SIZE)}: ${result.profiles.length} rows`);
      break;
    }

    if (i + BATCH_SIZE < handles.length) await sleep(DELAY_MS);
  }

  console.log(`Handles matched: ${matched}, player rows updated: ${updated}`);
  return { considered: handles.length, matched, updated };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPlayerCountriesIngest({ force: process.argv.includes("--force") })
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error("Player country ingestion failed:", err);
      process.exit(1);
    });
}
