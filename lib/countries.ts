// Country name -> flag, for the player pages.
//
// Player.country is populated from Leaguepedia, which stores full English
// country names ("South Korea"), not ISO codes — so the lookup is by name.
// Flags are rendered as emoji built from regional-indicator letters rather
// than image assets: no extra requests, and they inherit the text colour and
// size wherever they're used.

// Deliberately partial: the countries that actually appear in LoL esports
// rosters. Anything unmapped falls back to showing the country name as text,
// which is a fine outcome for a rare region and much better than a wrong flag.
const ISO_BY_COUNTRY: Record<string, string> = {
  // Asia-Pacific
  "south korea": "KR", korea: "KR", china: "CN", taiwan: "TW", "hong kong": "HK", macau: "MO",
  japan: "JP", vietnam: "VN", thailand: "TH", philippines: "PH", singapore: "SG",
  malaysia: "MY", indonesia: "ID", india: "IN", australia: "AU", "new zealand": "NZ",
  mongolia: "MN", cambodia: "KH", "sri lanka": "LK", pakistan: "PK",
  // Europe
  denmark: "DK", germany: "DE", france: "FR", spain: "ES", sweden: "SE", poland: "PL",
  belgium: "BE", netherlands: "NL", "united kingdom": "GB", england: "GB", scotland: "GB",
  wales: "GB", "northern ireland": "GB", slovenia: "SI", croatia: "HR", "czech republic": "CZ",
  czechia: "CZ", turkey: "TR", greece: "GR", norway: "NO", finland: "FI", estonia: "EE",
  latvia: "LV", lithuania: "LT", romania: "RO", bulgaria: "BG", hungary: "HU", serbia: "RS",
  "bosnia and herzegovina": "BA", portugal: "PT", italy: "IT", switzerland: "CH", austria: "AT",
  ireland: "IE", iceland: "IS", ukraine: "UA", russia: "RU", belarus: "BY", slovakia: "SK",
  albania: "AL", "north macedonia": "MK", macedonia: "MK", montenegro: "ME", cyprus: "CY",
  malta: "MT", luxembourg: "LU", andorra: "AD", monaco: "MC", armenia: "AM", georgia: "GE",
  kazakhstan: "KZ", azerbaijan: "AZ", moldova: "MD", kosovo: "XK",
  // Americas
  "united states": "US", usa: "US", canada: "CA", mexico: "MX", brazil: "BR", argentina: "AR",
  chile: "CL", peru: "PE", colombia: "CO", uruguay: "UY", ecuador: "EC", bolivia: "BO",
  venezuela: "VE", paraguay: "PY", "costa rica": "CR", panama: "PA", guatemala: "GT",
  honduras: "HN", "el salvador": "SV", nicaragua: "NI", "dominican republic": "DO",
  "puerto rico": "PR", cuba: "CU", jamaica: "JM", "trinidad and tobago": "TT",
  // Middle East & Africa
  israel: "IL", morocco: "MA", tunisia: "TN", algeria: "DZ", egypt: "EG",
  "south africa": "ZA", nigeria: "NG", kenya: "KE", ghana: "GH", "saudi arabia": "SA",
  "united arab emirates": "AE", lebanon: "LB", jordan: "JO", iran: "IR", iraq: "IQ",
};

// Regional indicator letters sit at U+1F1E6 ('A'), so an ISO-3166 pair maps
// straight onto the flag codepoints.
function isoToFlag(iso: string): string {
  return [...iso.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
}

export interface CountryDisplay {
  /** Flag emoji, or null when the country isn't one we map. */
  flag: string | null;
  /** The original country name, for a tooltip or a text fallback. */
  name: string;
}

export function getCountryDisplay(country: string | null | undefined): CountryDisplay | null {
  if (!country) return null;
  const name = country.trim();
  if (!name) return null;
  const iso = ISO_BY_COUNTRY[name.toLowerCase()];
  return { flag: iso ? isoToFlag(iso) : null, name };
}
