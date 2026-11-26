import { categories, type ContentAdmin, type StaffEvent } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { read } from "../../../../api";
import { Alert, Container, PageHeader, Pairs, ui } from "../../../ui";
import { Act } from "../../act";
import { cancelEvent, unpublishEvent } from "../../actions";
import { time } from "../../requests/status";
import { Promote } from "../promote";
import { EventBadge } from "../status";

// One event (X1; API: GET /galaxy/events/:id): its details and ticket types with seats sold. Unpublish takes it back to
// draft while nobody has booked; Cancel tells every ticket holder the reason; Promote puts it in App content's Promoted
// list (needs Platform too). The API refuses staff an event of a host they're on.
export const metadata: Metadata = { title: "Event" };

const rupees = (paise: number) => (paise === 0 ? "Free" : `₹${(paise / 100).toLocaleString("en-IN")}`);

export default function EventPage({ params }: PageProps<"/events/[id]">) {
  return (
    <Suspense fallback={null}>
      <Event params={params} />
    </Suspense>
  );
}

async function Event({ params }: Pick<PageProps<"/events/[id]">, "params">) {
  const { id } = await params;
  const [r, content] = await Promise.all([read<StaffEvent>(`/galaxy/events/${encodeURIComponent(id)}`), read<ContentAdmin>("/galaxy/app-content")]);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const { event: e, host, tickets, bookings } = r.data;
  const promoted = content.ok ? content.data.content.promoted.some((p) => p.href === `/event/${e.slug}`) : null; // null: no Platform
  const place = e.place && `${e.place.venue}, ${e.place.address}, ${e.place.area}, ${e.place.city}`;
  const toldThem = "Every ticket holder sees this";

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

      {e.status === "published" && (
        <Container title="Actions">
          <div className={ui.page}>
            {promoted !== null && <Promote slug={e.slug} on={promoted} />}
            {bookings === 0 && <Act label="Unpublish" action={unpublishEvent} hidden={{ id: e.id }} who="Staff see this; the host doesn't" />}
            <Act label="Cancel event" action={cancelEvent} hidden={{ id: e.id }} who={toldThem} />
          </div>
        </Container>
      )}
    </div>
  );
}
