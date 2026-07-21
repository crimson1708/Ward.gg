// NEWS INGESTION — pulls headline cards (title, thumbnail, excerpt, date,
// link) from lolesports.com's news index and upserts them. We deliberately
// never store full article bodies; NewsArticle.sourceUrl just links back to
// the real article on lolesports.com. See lib/lolEsportsNews.ts for how the
// scrape works and why there's no official API for this.
//
// Run:  npx tsx scripts/ingest-news.mts

import { prisma } from "../lib/prisma.ts";
import { getNewsArticles } from "../lib/lolEsportsNews.ts";

async function main() {
  const articles = await getNewsArticles();

  let upserted = 0;
  for (const a of articles) {
    await prisma.newsArticle.upsert({
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
    });
    upserted++;
  }

  console.log(`News articles upserted: ${upserted}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("News ingestion failed:", err);
  process.exit(1);
});
