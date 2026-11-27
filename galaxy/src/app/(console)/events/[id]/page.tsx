import { categories, type ContentAdmin, type StaffEvent, type StaffLineup, type StaffPerson } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { galaxy, read } from "../../../../api";
import { Alert, Container, PageHeader, Pairs, ui } from "../../../ui";
import { Act } from "../../act";
import { cancelEvent, unpublishEvent } from "../../actions";
import { time } from "../../requests/status";
import { KindDetails } from "../details";
import { Acts, FestItems, People } from "../lineup";
import { Promote } from "../promote";
import { EventBadge } from "../status";

// One event (X1; API: GET /galaxy/events/:id): its details and ticket types with seats sold. Unpublish takes it back to
// draft while nobody has booked; Cancel cancels its bookings (not until it has ended). Both tell the host's Admins the
// reason; ticket holders aren't told yet (H13.5). Promote puts it in App content's Promoted list (needs Platform too),
// and Unpromote shows whenever it's there, whatever the status. The API refuses staff an event of a host they're on.
// People (who's on its page, with roles, in order) and, on a fest, Inside the fest are edited here too (X14), and so are
// its kind details (what its category's page shows, inRoom and the age).
export const metadata: Metadata = { title: "Event" };

const rupees = (paise: number) => (paise === 0 ? "Free" : `₹${(paise / 100).toLocaleString("en-IN")}`);

export default function EventPage({ params, searchParams }: PageProps<"/events/[id]">) {
  return (
    <Suspense fallback={null}>
      <Event params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Event({ params, searchParams }: Pick<PageProps<"/events/[id]">, "params" | "searchParams">) {
  const { id } = await params;
  const sq = (await searchParams).q;
  const q = (typeof sq === "string" ? sq : "").trim().slice(0, 80); // People's picker search
  const [r, content, lineup, persons] = await Promise.all([
    read<StaffEvent>(`/galaxy/events/${encodeURIComponent(id)}`),
    read<ContentAdmin>("/galaxy/app-content"),
    // `galaxy`, not `read`: if these fail, only People and Inside the fest say so; the rest of the page still shows.
    galaxy<StaffLineup>("GET", `/galaxy/events/${encodeURIComponent(id)}/lineup`),
    galaxy<{ persons: StaffPerson[] }>("GET", `/galaxy/persons${q ? `?q=${encodeURIComponent(q)}` : ""}`), // 50 at most, by name
  ]);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const { event: e, host, tickets, bookings } = r.data;
  const promoted = content.ok ? content.data.content.promoted.some((p) => p.href === `/event/${e.slug}`) : null; // null: no Platform
  const place = e.place && `${e.place.venue}, ${e.place.address}, ${e.place.area}, ${e.place.city}`;
  const ended = Date.parse(e.endsAt ?? e.startsAt ?? "") <= new Date().getTime();
  const published = e.status === "published";
  const toldThem = "The host's Admins get this; ticket holders aren't told yet";

  return (
    <div className={ui.page}>
      <PageHeader title={e.title} description={`heyorbit.in/event/${e.slug}`} />

      <Container title="Details">
        <Pairs
          pairs={[
            ["Status", <EventBadge key="s" status={e.status} />],
            ["Host", <Link key="h" href={`/hosts/${host.id}`} prefetch={false}>{host.name}</Link>],
            ["Category", categories.find((c) => c.slug === e.category)?.label ?? e.category],
            ["Starts", e.startsAt && time(e.startsAt)],
            ["Ends", e.endsAt && time(e.endsAt)],
            ["Where", place ?? (e.online ? "Online" : null)],
            ["Visibility", e.visibility === "public" ? "Public" : "Link only"],
            ["Bookings", bookings.toLocaleString("en-IN")],
            ["Promoted", promoted === null ? null : promoted ? "Yes" : "No"],
            ["Published", e.publishedAt && time(e.publishedAt)],
            ["Cancelled", e.cancelledAt && `${time(e.cancelledAt)}: ${e.cancelReason ?? ""}`],
            ["Made", time(e.createdAt)],
            ["About", e.about],
          ]}
        />
      </Container>

      <Container title="Kind details">
        <KindDetails event={e} />
      </Container>

      <Container title="Tickets" count={tickets.length}>
        {tickets.length === 0 ? (
          <p className={ui.secondary}>No ticket types.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Price</th>
                <th>Sold</th>
                <th>Of</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{rupees(t.pricePaise)}</td>
                  <td>{t.sold.toLocaleString("en-IN")}</td>
                  <td>{t.quantity?.toLocaleString("en-IN") ?? "No limit"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Container>

      <Container title="People" count={lineup.ok ? lineup.data.people.length : undefined}>
        {lineup.ok ? (
          <People eventId={e.id} lineup={lineup.data.people} persons={persons.ok ? persons.data.persons : []} q={q} />
        ) : (
          <Alert>{lineup.error.message}</Alert>
        )}
      </Container>

      <Container title="Acts" count={lineup.ok ? lineup.data.acts.length : undefined}>
        {lineup.ok ? <Acts eventId={e.id} acts={lineup.data.acts} /> : <Alert>{lineup.error.message}</Alert>}
      </Container>

      {e.category === "fests" && (
        <Container title="Inside the fest" count={lineup.ok ? lineup.data.festItems.length : undefined}>
          {lineup.ok ? <FestItems eventId={e.id} items={lineup.data.festItems} /> : <Alert>{lineup.error.message}</Alert>}
        </Container>
      )}

      {(published || promoted) && (
        <Container title="Actions">
          <div className={ui.page}>
            {promoted !== null && <Promote slug={e.slug} on={promoted} />}
            {published && bookings === 0 && <Act label="Unpublish" action={unpublishEvent} hidden={{ id: e.id }} who="The host's Admins get this" />}
            {published && !ended && <Act label="Cancel event" action={cancelEvent} hidden={{ id: e.id }} who={toldThem} />}
          </div>
        </Container>
      )}
    </div>
  );
}
