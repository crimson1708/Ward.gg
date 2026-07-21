import { prisma } from "@/lib/prisma";
import { NewsCard } from "@/app/components/NewsCard";
import { SidebarMatchRow } from "@/app/components/SidebarMatchRow";
import { EventRow } from "@/app/components/EventRow";
import { newsDayGroup } from "@/lib/format";

// Always render fresh from the DB on each request — news and match times
// change frequently and this is a low-traffic hobby site, so simplicity beats
// caching for now.
export const dynamic = "force-dynamic";

const NEWS_PREVIEW_COUNT = 9;
const MATCH_COUNT = 8;
const RESULT_COUNT = 8;
const EVENT_COUNT = 5;

async function getHomeData() {
  const now = new Date();

  const [articles, live, upcoming, finishedMatches, ongoingEvents, upcomingEvents, finishedEvents] =
    await Promise.all([
      prisma.newsArticle.findMany({
        orderBy: { publishedAt: "desc" },
        take: NEWS_PREVIEW_COUNT,
      }),
      prisma.match.findMany({
        where: { status: "inProgress" },
        orderBy: { startTime: "asc" },
        include: { teamA: true, teamB: true },
      }),
      prisma.match.findMany({
        // startTime >= now as well as status "unstarted": some minor-league
        // matches never get their status flipped to "completed" upstream, so
        // status alone can surface stale, already-past matches here.
        where: { status: "unstarted", startTime: { gte: now } },
        orderBy: { startTime: "asc" },
        take: MATCH_COUNT,
        include: { teamA: true, teamB: true },
      }),
      prisma.match.findMany({
        where: { status: "completed" },
        orderBy: { startTime: "desc" },
        take: RESULT_COUNT,
        include: { teamA: true, teamB: true },
      }),
      prisma.tournament.findMany({
        where: { startDate: { lte: now }, endDate: { gte: now } },
        orderBy: { endDate: "asc" },
        include: { league: true },
      }),
      prisma.tournament.findMany({
        where: { startDate: { gt: now } },
        orderBy: { startDate: "asc" },
        take: EVENT_COUNT,
        include: { league: true },
      }),
      prisma.tournament.findMany({
        where: { endDate: { lt: now } },
        orderBy: { endDate: "desc" },
        take: EVENT_COUNT,
        include: { league: true },
      }),
    ]);

  // Live matches first, then soonest-upcoming, capped at MATCH_COUNT total.
  const upcomingMatches = [...live, ...upcoming].slice(0, MATCH_COUNT);

  return { articles, upcomingMatches, finishedMatches, ongoingEvents, upcomingEvents, finishedEvents };
}

export default async function Home() {
  const { articles, upcomingMatches, finishedMatches, ongoingEvents, upcomingEvents, finishedEvents } =
    await getHomeData();
  const [hero, ...rest] = articles;

  return (
    <main className="home-layout">
      <section className="news-feed">
        {hero && <NewsCard article={hero} hero />}
        <NewsList articles={rest} />
        {articles.length === 0 && <p className="empty">No news yet — run `npm run ingest:news`.</p>}
        {articles.length > 0 && (
          <a className="view-all-link" href="/news">
            View all news →
          </a>
        )}
      </section>

      <aside className="matches-col">
        <div className="sidebar-panel">
          <h2 className="section-title">Matches</h2>
          {upcomingMatches.length > 0 ? (
            upcomingMatches.map((m) => <SidebarMatchRow key={m.id} match={m} />)
          ) : (
            <p className="empty">No live or upcoming matches right now.</p>
          )}
          <a className="view-all-link" href="/matches">
            All matches →
          </a>
        </div>

        <div className="sidebar-panel">
          <h2 className="section-title">Results</h2>
          {finishedMatches.length > 0 ? (
            finishedMatches.map((m) => <SidebarMatchRow key={m.id} match={m} />)
          ) : (
            <p className="empty">No finished matches yet.</p>
          )}
        </div>
      </aside>

      <aside className="events-col">
        <div className="sidebar-panel">
          <h2 className="section-title">Ongoing Events</h2>
          {ongoingEvents.length > 0 ? (
            ongoingEvents.map((t) => <EventRow key={t.id} tournament={t} />)
          ) : (
            <p className="empty">Nothing ongoing right now.</p>
          )}
        </div>

        <div className="sidebar-panel">
          <h2 className="section-title">Upcoming Events</h2>
          {upcomingEvents.length > 0 ? (
            upcomingEvents.map((t) => <EventRow key={t.id} tournament={t} />)
          ) : (
            <p className="empty">Nothing scheduled yet.</p>
          )}
        </div>

        <div className="sidebar-panel">
          <h2 className="section-title">Recent Events</h2>
          {finishedEvents.length > 0 ? (
            finishedEvents.map((t) => <EventRow key={t.id} tournament={t} />)
          ) : (
            <p className="empty">Nothing finished yet.</p>
          )}
        </div>
      </aside>
    </main>
  );
}

// Groups the remaining (non-hero) articles under "JULY 20 · TODAY"-style
// headers, one per calendar day, in the order they already arrive (newest first).
function NewsList({ articles }: { articles: Awaited<ReturnType<typeof getHomeData>>["articles"] }) {
  const groups: { label: string; isToday: boolean; items: typeof articles }[] = [];
  for (const a of articles) {
    const g = newsDayGroup(a.publishedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === g.label) {
      last.items.push(a);
    } else {
      groups.push({ label: g.label, isToday: g.isToday, items: [a] });
    }
  }

  return (
    <>
      {groups.map((g) => (
        <div key={g.label} className="news-day-group">
          <h3 className="news-day-header">
            {g.label} {g.isToday && <span className="today-tag">TODAY</span>}
          </h3>
          {g.items.map((a) => (
            <NewsCard key={a.id} article={a} />
          ))}
        </div>
      ))}
    </>
  );
}
