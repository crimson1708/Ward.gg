-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Game" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "externalId" TEXT NOT NULL,
    "matchId" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "patch" TEXT,
    "durationSecs" INTEGER,
    "winnerTeamId" INTEGER,
    "statsChecked" BOOLEAN NOT NULL DEFAULT false,
    "teamADragons" TEXT,
    "teamBDragons" TEXT,
    "teamABarons" INTEGER,
    "teamBBarons" INTEGER,
    "teamAGold" INTEGER,
    "teamBGold" INTEGER,
    "teamABans" TEXT,
    "teamBBans" TEXT,
    "teamAVoidGrubs" INTEGER,
    "teamBVoidGrubs" INTEGER,
    "teamARiftHeralds" INTEGER,
    "teamBRiftHeralds" INTEGER,
    CONSTRAINT "Game_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Game" ("durationSecs", "externalId", "id", "matchId", "number", "patch", "state", "teamABans", "teamABarons", "teamADragons", "teamAGold", "teamARiftHeralds", "teamAVoidGrubs", "teamBBans", "teamBBarons", "teamBDragons", "teamBGold", "teamBRiftHeralds", "teamBVoidGrubs", "winnerTeamId") SELECT "durationSecs", "externalId", "id", "matchId", "number", "patch", "state", "teamABans", "teamABarons", "teamADragons", "teamAGold", "teamARiftHeralds", "teamAVoidGrubs", "teamBBans", "teamBBarons", "teamBDragons", "teamBGold", "teamBRiftHeralds", "teamBVoidGrubs", "winnerTeamId" FROM "Game";
DROP TABLE "Game";
ALTER TABLE "new_Game" RENAME TO "Game";
CREATE UNIQUE INDEX "Game_externalId_key" ON "Game"("externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
