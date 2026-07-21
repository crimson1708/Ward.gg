// Small display-formatting helpers shared by the homepage sidebar widgets.

// "27m", "1h27m", "1d7h" — VLR-style countdown to a future timestamp.
export function formatCountdown(target: Date): string {
  const diffMin = Math.round((target.getTime() - Date.now()) / 60_000);
  if (diffMin <= 0) return "now";

  const days = Math.floor(diffMin / 1440);
  const hours = Math.floor((diffMin % 1440) / 60);
  const minutes = diffMin % 60;

  if (days >= 1) return `${days}d${hours}h`;
  if (hours >= 1) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

// "Jul 17" — used for event date-range display.
export function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// "JULY 20" news-feed section header, plus whether that day is today — the
// list groups articles by publish day the way VLR's front-page feed does.
export function newsDayGroup(date: Date): { key: string; label: string; isToday: boolean } {
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const label = date.toLocaleDateString("en-US", { month: "long", day: "numeric" }).toUpperCase();
  return { key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`, label, isToday };
}

// Known league/tournament short codes that should render fully capitalized
// ("lpl" -> "LPL") rather than merely title-cased ("lpl" -> "Lpl"). Slug words
// not in this set fall back to plain title case.
const KNOWN_ACRONYMS = new Set([
  "lpl", "lec", "lcs", "lck", "msi", "ewc", "vcs", "ljl", "lfl", "les", "lrn",
  "lrs", "nacl", "nlc", "lcp", "emea", "hll", "lms", "cblol", "lla", "pcs",
  "tcl", "lco", "opl", "ldl",
]);

// Turns a raw tournament slug like "lcs_split_3_2026" into "LCS Split 3 2026".
export function humanizeTournamentSlug(slug: string): string {
  return slug
    .split("_")
    .map((w) => {
      if (/^\d+$/.test(w)) return w;
      if (KNOWN_ACRONYMS.has(w.toLowerCase())) return w.toUpperCase();
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(" ");
}
