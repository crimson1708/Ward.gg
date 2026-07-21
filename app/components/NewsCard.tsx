type Article = {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  imageUrl: string;
  sourceUrl: string;
  publishedAt: Date;
};

// Headline card that links OUT to the real article on lolesports.com — we
// only ever show the title/thumbnail/excerpt we scraped, never the full body.
export function NewsCard({ article, hero }: { article: Article; hero?: boolean }) {
  const date = article.publishedAt.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  if (hero) {
    return (
      <a className="news-hero" href={article.sourceUrl} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="news-hero-img" src={article.imageUrl} alt="" />
        <div className="news-hero-caption">
          <div className="news-hero-title">{article.title}</div>
        </div>
      </a>
    );
  }

  return (
    <a className="news-row" href={article.sourceUrl} target="_blank" rel="noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="news-thumb" src={article.imageUrl} alt="" />
      <div className="news-row-body">
        <div className="news-row-title">{article.title}</div>
        {article.excerpt && <div className="news-row-excerpt">{article.excerpt}</div>}
        <div className="news-row-date">{date}</div>
      </div>
    </a>
  );
}
