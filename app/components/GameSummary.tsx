import type { CSSProperties } from "react";
import { getChampionInfo } from "@/lib/champions";

export type GameSummaryData = {
  teamASide: string | null; // "BLUE" | "RED" | null
  teamBSide: string | null;
  teamAKills: number;
  teamBKills: number;
  teamADragons: string[];
  teamBDragons: string[];
  teamABarons: number;
  teamBBarons: number;
  teamAGold: number;
  teamBGold: number;
  // null = never checked or not found on Leaguepedia — hide rather than show a
  // misleading "0". A real 0 is only ever shown once we've actually looked it up.
  teamAVoidGrubs: number | null;
  teamBVoidGrubs: number | null;
  teamARiftHeralds: number | null;
  teamBRiftHeralds: number | null;
  teamABans: string[]; // champion ids; empty = no ban data for this game
  teamBBans: string[];
};

// Data Dragon only covers champions/items, not neutral monsters — these come
// from Community Dragon instead, which mirrors the game client's own minimap
// ping icons (the same art the in-client HUD uses for these objectives).
const CDRAGON_ICONS = "https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons";

const DRAGON_ICON_FILE: Record<string, string> = {
  cloud: "dragon_cloud",
  infernal: "dragon_infernal",
  mountain: "dragon_mountain",
  ocean: "dragon_ocean",
  hextech: "dragon_hextech",
  chemtech: "dragon_chemtech",
  elder: "dragon_elder",
};

const SIDE_COLORS: Record<string, string> = {
  BLUE: "#3b82f6",
  RED: "#e23742",
};

// Used only for the Dragon Soul glow — the icons themselves already carry
// their own color, this is just the ring color once a soul's been secured.
const DRAGON_GLOW_COLOR: Record<string, string> = {
  cloud: "#8ecae6",
  infernal: "#e85d3c",
  mountain: "#a97142",
  ocean: "#4a90d9",
  hextech: "#3ddbd9",
  chemtech: "#6fcf3c",
};

function dragonName(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1) + " Dragon";
}

// Soul locks in on the 4th elemental dragon (Elder doesn't count toward it,
// it's a separate buff on top of an already-secured soul), determined by
// whichever type is most common among the first 4 kills — ties go to
// whichever of the tied types was taken most recently.
function computeDragonSoul(dragons: string[]): string | null {
  const elemental = dragons.filter((d) => d !== "elder");
  if (elemental.length < 4) return null;
  const first4 = elemental.slice(0, 4);
  const counts: Record<string, number> = {};
  const lastIndex: Record<string, number> = {};
  first4.forEach((d, i) => {
    counts[d] = (counts[d] ?? 0) + 1;
    lastIndex[d] = i;
  });
  const maxCount = Math.max(...Object.values(counts));
  const tied = Object.keys(counts).filter((t) => counts[t] === maxCount);
  return tied.length === 1 ? tied[0] : tied.reduce((a, b) => (lastIndex[a] > lastIndex[b] ? a : b));
}

export function GameSummaryPanel({
  teamAName,
  teamBName,
  data,
}: {
  teamAName: string;
  teamBName: string;
  data: GameSummaryData;
}) {
  const hasBans = data.teamABans.length > 0 || data.teamBBans.length > 0;
  const showGrubs = data.teamAVoidGrubs !== null || data.teamBVoidGrubs !== null;
  const showHeralds = data.teamARiftHeralds !== null || data.teamBRiftHeralds !== null;

  const goldTotal = data.teamAGold + data.teamBGold || 1;
  const teamAPct = (data.teamAGold / goldTotal) * 100;
  const goldDiff = Math.abs(data.teamAGold - data.teamBGold);
  const colorA = SIDE_COLORS[data.teamASide ?? ""] ?? "var(--muted)";
  const colorB = SIDE_COLORS[data.teamBSide ?? ""] ?? "var(--muted)";

  return (
    <div className="game-summary">
      <div className="gkh">
        <span className="gkh-team a">{teamAName}</span>
        <span className="gkh-kills">
          {data.teamAKills}
          <span className="gkh-sep">–</span>
          {data.teamBKills}
        </span>
        <span className="gkh-team b">{teamBName}</span>
      </div>

      <div className="gold-bar-wrap">
        <div className="gold-bar-track">
          <div className="gold-bar-seg" style={{ width: `${teamAPct}%`, background: colorA }} />
          <div className="gold-bar-seg" style={{ width: `${100 - teamAPct}%`, background: colorB }} />
        </div>
        <div className="gold-bar-midline" />
        <div className="gold-bar-diff" style={{ left: `${teamAPct}%` }}>
          +{goldDiff.toLocaleString()}
          <svg className="gold-coin-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="currentColor" />
            <circle cx="12" cy="12" r="9" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="5.5" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
          </svg>
        </div>
      </div>

      <div className="summary-block">
        <h3 className="summary-title">Objectives</h3>
        <div className="summary-teams">
          <ObjectiveCol
            teamName={teamAName}
            dragons={data.teamADragons}
            barons={data.teamABarons}
            grubs={data.teamAVoidGrubs}
            heralds={data.teamARiftHeralds}
            showGrubs={showGrubs}
            showHeralds={showHeralds}
            align="right"
          />
          <ObjectiveCol
            teamName={teamBName}
            dragons={data.teamBDragons}
            barons={data.teamBBarons}
            grubs={data.teamBVoidGrubs}
            heralds={data.teamBRiftHeralds}
            showGrubs={showGrubs}
            showHeralds={showHeralds}
            align="left"
          />
        </div>
      </div>

      {hasBans && (
        <div className="summary-block">
          <h3 className="summary-title">Bans</h3>
          <div className="summary-teams">
            <BanCol teamName={teamAName} bans={data.teamABans} align="right" />
            <BanCol teamName={teamBName} bans={data.teamBBans} align="left" />
          </div>
        </div>
      )}
    </div>
  );
}

function BanCol({ teamName, bans, align }: { teamName: string; bans: string[]; align: "left" | "right" }) {
  return (
    <div className={`summary-team-col ${align}`}>
      <div className="summary-team-name">{teamName}</div>
      <div className="ban-icons">
        {bans.map((id) => {
          const info = getChampionInfo(id);
          return info.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} className="ban-icon" src={info.iconUrl} alt={info.name} title={info.name} />
          ) : (
            <span key={id} className="ban-icon-fallback">
              {info.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ObjectiveCol({
  teamName,
  dragons,
  barons,
  grubs,
  heralds,
  showGrubs,
  showHeralds,
  align,
}: {
  teamName: string;
  dragons: string[];
  barons: number;
  grubs: number | null;
  heralds: number | null;
  showGrubs: boolean;
  showHeralds: boolean;
  align: "left" | "right";
}) {
  const empty =
    dragons.length === 0 && barons === 0 && !(showGrubs && grubs) && !(showHeralds && heralds);
  const soulType = computeDragonSoul(dragons);
  const glowColor = soulType ? DRAGON_GLOW_COLOR[soulType] : null;
  return (
    <div className={`summary-team-col ${align}`}>
      <div className="summary-team-name">{teamName}</div>
      <div className="objective-tags">
        {dragons.map((type, i) => {
          const file = DRAGON_ICON_FILE[type];
          const title = soulType ? `${dragonName(type)} — part of ${dragonName(soulType)} Soul` : dragonName(type);
          return file ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              className={glowColor ? "obj-icon soul-glow" : "obj-icon"}
              src={`${CDRAGON_ICONS}/${file}.png`}
              alt=""
              title={title}
              style={glowColor ? ({ "--soul-color": glowColor } as CSSProperties) : undefined}
            />
          ) : (
            <span key={i} className="obj-icon-fallback" title={type}>
              {type[0]?.toUpperCase()}
            </span>
          );
        })}
        {barons > 0 && <CountIcon file="baron" count={barons} name="Baron" />}
        {showHeralds && heralds !== null && heralds > 0 && (
          <CountIcon file="riftherald" count={heralds} name="Rift Herald" />
        )}
        {showGrubs && grubs !== null && grubs > 0 && <CountIcon file="grub" count={grubs} name="Void Grubs" />}
        {empty && <span className="objective-none">None</span>}
      </div>
    </div>
  );
}

function CountIcon({ file, count, name }: { file: string; count: number; name: string }) {
  return (
    <span className="obj-symbol-wrap" title={`${name} ×${count}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="obj-icon" src={`${CDRAGON_ICONS}/${file}.png`} alt="" />
      {count > 1 && <span className="obj-count">×{count}</span>}
    </span>
  );
}
