// AUTO-REFRESH WORKER — keeps the database fresh on an interval.
// Run:  npm run watch        (every 5 minutes)
//       npm run watch 2      (every 2 minutes)
// Leave it running in its own terminal. Ctrl+C to stop.
//
// It just runs the ingestion scripts on a loop. Because ingest-games is now
// incremental, each cycle is cheap unless a match actually finished.

import { spawn } from "node:child_process";

const INTERVAL_MIN = Number(process.argv[2] ?? 5);

// Run a shell command and resolve when it finishes (streaming its output to us).
function run(cmd: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { shell: true, stdio: "inherit" });
    child.on("exit", () => resolve());
  });
}

async function refreshOnce() {
  console.log(`\n[${new Date().toLocaleTimeString()}] refreshing...`);
  await run("npx tsx scripts/ingest.mts");
  await run("npx tsx scripts/ingest-games.mts");
  await run("npx tsx scripts/ingest-news.mts");
  console.log(`[${new Date().toLocaleTimeString()}] done — next run in ${INTERVAL_MIN} min.`);
}

// Recursive setTimeout (not setInterval) so a slow run never overlaps the next.
async function loop() {
  await refreshOnce();
  setTimeout(loop, INTERVAL_MIN * 60_000);
}

console.log(`Ward auto-refresh running every ${INTERVAL_MIN} min. Press Ctrl+C to stop.`);
loop();
