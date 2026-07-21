import { prisma } from "@/lib/prisma";
import { NewsCard } from "@/app/components/NewsCard";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const articles = await prisma.newsArticle.findMany({ orderBy: { publishedAt: "desc" } });

  return (
    <main className="container">
      <h2 className="section-title">News</h2>
      <div className="news-grid">
        {articles.map((a) => (
          <NewsCard key={a.id} article={a} />
        ))}
      </div>
    </main>
  );
}
