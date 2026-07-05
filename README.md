# Ward 🟥

A VLR.gg-style website for **League of Legends esports** — match schedules, results, and detailed per-game box scores (KDA, CS, gold, champions), pulled from the public LoL Esports API into a local database.

Built with **Next.js 16 + TypeScript + Prisma + SQLite**.

---

## What it does

- **Schedule & results** on the homepage — live, upcoming, and completed matches across every league.
- **Match detail pages** — click any completed match to see each game's full box score, per player.
- All data lives in a **local SQLite database** that you populate from the API with a couple of commands.

---

## Running it on your machine

### Prerequisites
- **Node.js 20 or newer** (check with `node --version`)
- **Git**

### 1. Clone the repo
```bash
git clone <THE-REPO-URL>
cd lolesports-site
```

### 2. Install dependencies
```bash
npm install
```
This also auto-generates the Prisma database client (via a `postinstall` step).

### 3. Create the database
```bash
npm run setup:db
```
This creates a local `dev.db` SQLite file and builds all the tables. (The database file is not in git — everyone builds their own.)

### 4. Load real data from the API
```bash
npm run refresh
```
This fetches leagues, teams, matches, and per-game stats from the LoL Esports API and fills your database. Takes a minute or two. **The database starts empty — this step is what puts matches on the site.**

### 5. Start the site
```bash
npm run dev
```
Open **http://localhost:3000**. Click a completed match to see its stats.

---

## Keeping the data fresh

The site reads from your local database, which is a **snapshot** — it does not update on its own. When scores look stale or a finished match shows no stats, re-run:

```bash
npm run refresh
```

| Command | What it updates |
|---|---|
| `npm run ingest` | Matches, scores, statuses, teams (fast) |
| `npm run ingest:games` | Per-game box scores + players (slower) |
| `npm run refresh` | **Both** — use this |

---

## How it's put together

```
app/                     Next.js pages (folder = route)
  page.tsx               homepage: schedule + results
  matches/[id]/page.tsx  match detail: games + box scores
  layout.tsx             site header, shared on every page
  globals.css            styling
lib/
  prisma.ts              the single database connection
  lolEsports.ts          typed client for the LoL Esports API
scripts/
  ingest.mts             fetches schedule -> database
  ingest-games.mts       fetches per-game stats -> database
prisma/
  schema.prisma          the database schema (source of truth)
  migrations/            schema history
```

**How data flows:** `LoL Esports API` → ingestion scripts (`scripts/`) → SQLite database → Next.js pages read the DB and render HTML.

---

## Notes
- The LoL Esports API is **unofficial and undocumented** — endpoints may change without notice. It needs no signup (a public key is baked into `lib/lolEsports.ts`).
- SQLite means zero database setup — the whole DB is the single `dev.db` file. Delete it and re-run steps 3–4 to start fresh.
