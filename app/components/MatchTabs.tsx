"use client";

import { useState } from "react";
import { BoxScore, type StatRow } from "./BoxScore";
import { GameSummaryPanel, type GameSummaryData } from "./GameSummary";

export type MapTab = {
  key: string; // "all" or the game's id
  label: string; // "All Matches" or "Match 1"
  teamAStats: StatRow[];
  teamBStats: StatRow[];
  // Side swaps per game, so this only makes sense per-game — null on "All Matches".
  teamASide: string | null;
  teamBSide: string | null;
  // Draft/objectives/gold are per-game concepts too — null on "All Matches".
  summary: GameSummaryData | null;
};

// VLR-style stat tabs: "All Matches" (combined) plus one tab per individual
// game, so you switch between them instead of scrolling past every box score.
export function MatchTabs({
  teamAName,
  teamBName,
  tabs,
}: {
  teamAName: string;
  teamBName: string;
  tabs: MapTab[];
}) {
  const [active, setActive] = useState(tabs[0]?.key);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div>
      <div className="match-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={t.key === active ? "match-tab active" : "match-tab"}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {current?.summary && <GameSummaryPanel teamAName={teamAName} teamBName={teamBName} data={current.summary} />}

      {current && current.teamAStats.length + current.teamBStats.length === 0 ? (
        <p className="empty">No stats recorded for this game.</p>
      ) : (
        current && (
          <div className="game-block">
            <BoxScore teamName={teamAName} side={current.teamASide} rows={current.teamAStats} />
            <BoxScore teamName={teamBName} side={current.teamBSide} rows={current.teamBStats} />
          </div>
        )
      )}
    </div>
  );
}
