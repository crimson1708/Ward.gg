-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GameStat" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gameId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "champion" TEXT NOT NULL,
    "kills" INTEGER NOT NULL,
    "deaths" INTEGER NOT NULL,
    "assists" INTEGER NOT NULL,
    "creepScore" INTEGER NOT NULL,
    "totalGold" INTEGER NOT NULL,
    "items" TEXT,
    "keystone" INTEGER,
    "secondaryTree" INTEGER,
    "summonerSpells" TEXT,
    "leaguepediaChecked" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "GameStat_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GameStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GameStat_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_GameStat" ("assists", "champion", "creepScore", "deaths", "gameId", "id", "items", "keystone", "kills", "playerId", "role", "secondaryTree", "side", "teamId", "totalGold") SELECT "assists", "champion", "creepScore", "deaths", "gameId", "id", "items", "keystone", "kills", "playerId", "role", "secondaryTree", "side", "teamId", "totalGold" FROM "GameStat";
DROP TABLE "GameStat";
ALTER TABLE "new_GameStat" RENAME TO "GameStat";
CREATE UNIQUE INDEX "GameStat_gameId_playerId_key" ON "GameStat"("gameId", "playerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
