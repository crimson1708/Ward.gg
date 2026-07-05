# Ward 🟥

A vlr.gg styled website but for LoL esports events. Shows match schedules, results and detailed match statistics like champion drafts, kda, cs etc.

Built with 
- Next.js 16 
- TypeScript 
- Prisma 
- SQLite.

---

## Running it on your machine

### Prerequisites
- **Node.js 20 or newer**
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

### 3. Create the database
```bash
npm run setup:db
```
(This creates a local `dev.db` SQLite file and builds all the tables.)

### 4. Load real data from the API
```bash
npm run refresh
```
This is an important step - it fetches leagues, teams, matches, and per-game stats from the LoL Esports API and fills your database.

### 5. Start the site
```bash
npm run dev
```
Open **http://localhost:3000**. Click a completed match to see its stats.

---

## Keeping the data fresh

The site reads from your local database, which is a **snapshot**, which means that the data doesn't auto update. To update it after a game, use -
```bash
npm run refresh
```

