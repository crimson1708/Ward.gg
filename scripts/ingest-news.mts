// NEWS INGESTION — pulls headline cards (title, thumbnail, excerpt, date,
// link) from lolesports.com's news index and upserts them. We deliberately
// never store full article bodies; NewsArticle.sourceUrl just links back to
// the real article on lolesports.com. See lib/lolEsportsNews.ts for how the
// scrape works and why there's no official API for this.
//
// Run:  npx tsx scripts/ingest-news.mts

import { pathToFileURL } from "node:url";
import { prisma } from "../lib/prisma.ts";
import { getNewsArticles } from "../lib/lolEsportsNews.ts";

// Each article is its own row (keyed by externalId), so upserts are safe to
// run concurrently — but not ALL at once, to stay gentle on Turso/libSQL's
// write handling. A small batch size trades a little safety margin for a
// large chunk of the wall-clock time these ~100 sequential upserts used to cost.
const UPSERT_CONCURRENCY = 10;

export async function runNewsIngest() {
  const articles = await getNewsArticles();

  let upserted = 0;
  for (let i = 0; i < articles.length; i += UPSERT_CONCURRENCY) {
    const batch = articles.slice(i, i + UPSERT_CONCURRENCY);
    await Promise.all(
      batch.map((a) =>
        prisma.newsArticle.upsert({
          where: { externalId: a.id },
          update: {
            title: a.title,
            excerpt: a.excerpt,
            imageUrl: a.imageUrl,
            sourceUrl: a.sourceUrl,
            publishedAt: new Date(a.publishedAt),
          },
          create: {
            externalId: a.id,
            slug: a.slug,
            title: a.title,
            excerpt: a.excerpt,
            imageUrl: a.imageUrl,
            sourceUrl: a.sourceUrl,
            publishedAt: new Date(a.publishedAt),
          },
        })
      )
    );
    upserted += batch.length;
  }

  console.log(`News articles upserted: ${upserted}`);
  return { upserted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runNewsIngest()
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error("News ingestion failed:", err);
      process.exit(1);
    });
}
