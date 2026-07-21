// Scraper for lolesports.com's news headlines. There is no public API for
// this content — the news pages are backed by a private Sanity CMS dataset —
// but the index page is server-rendered (Next.js App Router), so the article
// metadata for every card on the page ships inline in the HTML as an RSC
// payload. We parse that instead of talking to any Riot-internal API.
//
// On purpose we only ever pull headline-level fields (title, thumbnail,
// excerpt, date, link). We never fetch or store full article bodies — the
// real article stays on lolesports.com and sourceUrl just links out to it.

const NEWS_INDEX_URL = "https://lolesports.com/en-US/news";
const SITE_ROOT = "https://lolesports.com/en-US";

export interface ScrapedArticle {
  id: string; // CMS _id, e.g. "d7033bc4-29ab-4e08-8fee-3d1fe2e06890.en-us"
  slug: string; // e.g. "2026-lcs-summer-primer"
  title: string;
  excerpt: string | null;
  imageUrl: string;
  sourceUrl: string;
  publishedAt: string; // ISO
}

// Matches one article object embedded in the page's RSC payload, e.g.:
//   {"__typename":"Article","_id":"...","externalTitle":"...","description":"...",
//    "externalUrl":null,"path":{"__typename":"Slug","current":"/news/..."},...,
//    "publishingDates":{...,"displayedPublishDate":"..."},...,"url":"<image>"}
const ARTICLE_RE =
  /\{"__typename":"Article","_id":"([^"]+)","externalTitle":"((?:[^"\\]|\\.)*)","description":((?:"(?:[^"\\]|\\.)*")|null),"externalUrl":((?:"(?:[^"\\]|\\.)*")|null),"path":\{"__typename":"Slug","current":"([^"]+)"\}.*?"displayedPublishDate":"([^"]+)".*?"url":"([^"]+)"/gs;

function unescapeJsonString(s: string): string {
  return JSON.parse(s);
}

// Next.js App Router streams the page as a series of
// `self.__next_f.push([1,"<escaped chunk>"])` calls. Concatenating the
// unescaped chunks reassembles one long text blob containing every
// embedded object on the page — including all the article cards.
function extractRscText(html: string): string {
  const chunks = html.matchAll(/self\.__next_f\.push\(\[1,(".*?")\]\)/gs);
  let full = "";
  for (const c of chunks) {
    try {
      full += unescapeJsonString(c[1]);
    } catch {
      // A handful of chunks aren't valid standalone JSON strings (rare,
      // truncated matches) — skip those, the rest still parse fine.
    }
  }
  return full;
}

export async function getNewsArticles(): Promise<ScrapedArticle[]> {
  const res = await fetch(NEWS_INDEX_URL, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; WardBot/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`lolesports.com news index failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const rsc = extractRscText(html);

  const seen = new Set<string>();
  const articles: ScrapedArticle[] = [];

  for (const m of rsc.matchAll(ARTICLE_RE)) {
    const [, id, rawTitle, rawDesc, , rawPath, publishedAt, imageUrl] = m;
    if (seen.has(id)) continue;
    seen.add(id);

    const path = unescapeJsonString(`"${rawPath}"`); // e.g. "/news/2026-lcs-summer-primer"
    const slug = path.replace(/^\/news\//, "");
    const title = unescapeJsonString(`"${rawTitle}"`);
    const excerpt = rawDesc === "null" ? null : unescapeJsonString(rawDesc);

    articles.push({
      id,
      slug,
      title,
      excerpt,
      imageUrl,
      sourceUrl: `${SITE_ROOT}${path}`,
      publishedAt,
    });
  }

  return articles;
}
