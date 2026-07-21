import { getChampionInfo } from "@/lib/champions";
import { getItemInfo, arrangeItemSlots } from "@/lib/items";
import { getRuneInfo } from "@/lib/runes";

export type StatRow = {
  id: number | string;
  role: string;
  champions: string[]; // raw champion ids; usually one, but "All Maps" can have several
  keystone: number | null; // perk id; null for combined "All Matches" rows (a player may run different keystones per game)
  secondaryTree: number | null; // secondary rune tree id, shown as a small badge on the keystone
  items: number[]; // final inventory (0 = empty slot); omitted (empty array) for combined rows
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  totalGold: number;
  player: { handle: string };
};

export function BoxScore({ teamName, side, rows }: { teamName: string; side?: string | null; rows: StatRow[] }) {
  return (
    <table className="boxscore">
      {/* Explicit column widths so the two teams' tables (each its own <table>)
          line up with each other instead of each auto-sizing to its own content. */}
      <colgroup>
        <col style={{ width: "17%" }} />
        <col style={{ width: "12%" }} />
        <col style={{ width: "11%" }} />
        <col style={{ width: "27%" }} />
        <col style={{ width: "12%" }} />
        <col style={{ width: "10.5%" }} />
        <col style={{ width: "10.5%" }} />
      </colgroup>
      <thead>
        <tr className="team-caption">
          <th colSpan={4}>
            {teamName}
            {side && <span className={`side-tag ${side.toLowerCase()}`}>{side}</span>}
          </th>
          <th className="num">K / D / A</th>
          <th className="num">CS</th>
          <th className="num">Gold</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id}>
            <td>
              <div>{s.player.handle}</div>
              <div className="role">{s.role}</div>
            </td>
            <td>
              <div className="champ-icons">
                {s.champions.map((champ) => {
                  const info = getChampionInfo(champ);
                  return info.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={champ} className="champ-icon" src={info.iconUrl} alt={info.name} title={info.name} />
                  ) : (
                    <span key={champ} className="champ-fallback">
                      {info.name}
                    </span>
                  );
                })}
              </div>
            </td>
            <td>
              {/* Keystone + secondary tree badge now, summoner spells join
                  here once that data source is wired up — same slot. */}
              {s.keystone !== null && (
                <div className="loadout-icons">
                  {(() => {
                    const rune = getRuneInfo(s.keystone);
                    const secondary = s.secondaryTree !== null ? getRuneInfo(s.secondaryTree) : null;
                    if (!rune) return null;
                    return (
                      <span className="rune-icon-wrap">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="rune-icon" src={rune.iconUrl} alt={rune.name} title={rune.name} />
                        {secondary && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className="rune-icon-secondary"
                            src={secondary.iconUrl}
                            alt={secondary.name}
                            title={`Secondary: ${secondary.name}`}
                          />
                        )}
                      </span>
                    );
                  })()}
                </div>
              )}
            </td>
            <td>
              {s.items.length > 0 && (
                <div className="item-slots">
                  {arrangeItemSlots(s.items, s.role).map((slot, i) => {
                    const info = slot ? getItemInfo(slot.id) : null;
                    if (!info) return <span key={i} className="item-icon empty" />;
                    return (
                      <span key={i} className="item-icon-wrap">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="item-icon"
                          src={info.iconUrl}
                          alt={info.name}
                          title={slot!.count > 1 ? `${info.name} ×${slot!.count}` : info.name}
                        />
                        {slot!.count > 1 && <span className="item-count">×{slot!.count}</span>}
                      </span>
                    );
                  })}
                </div>
              )}
            </td>
            <td className="num">
              {s.kills} / {s.deaths} / {s.assists}
            </td>
            <td className="num">{s.creepScore}</td>
            <td className="num">{s.totalGold.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
