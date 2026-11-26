import type { CheckInEventPage } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { read } from "../../../../api";
import { Alert, Container, PageHeader, Pairs, ui } from "../../../ui";
import { Act } from "../../act";
import { undoCheckIn } from "../../actions";
import { time } from "../../requests/status";

// One event's door (X5; API: GET /galaxy/check-in/:id): who's in, latest first, each with an Undo that lowers the count
// to 0 or to a number, logged with a reason. The API refuses staff on the host's own team.
export const metadata: Metadata = { title: "Check-in" };

export default function CheckInEvent({ params }: PageProps<"/check-in/[id]">) {
  return (
    <Suspense fallback={null}>
      <Body params={params} />
    </Suspense>
  );
}

async function Body({ params }: Pick<PageProps<"/check-in/[id]">, "params">) {
  const { id } = await params;
  const r = await read<CheckInEventPage>(`/galaxy/check-in/${encodeURIComponent(id)}`);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const { event: e, guests } = r.data;

  return (
    <div className={ui.page}>
      <PageHeader title={e.title} description={`${e.hostName}, ${time(e.startsAt)}`} />

      <Container title="Door">
        <Pairs
          pairs={[
            // No prefetch: opening a host's page is written to the audit log.
            ["Host", <Link key="h" href={`/hosts/${e.hostId}`} prefetch={false}>{e.hostName}</Link>],
            ["Starts", time(e.startsAt)],
            ["Ends", time(e.endsAt)],
            ["Booked", String(e.booked)],
            ["In", String(e.in)],
          ]}
        />
      </Container>

      <Container title="Checked in" count={guests.length}>
        {guests.length === 0 ? (
          <p className={ui.secondary}>Nobody&rsquo;s checked in yet.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Guest</th>
                <th>In</th>
                <th>First in</th>
                <th>Let in by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {guests.map((g) => (
                <tr key={g.id}>
                  <td>{g.name ?? "No name yet"}</td>
                  <td>
                    {g.admitted} of {g.quantity}
                  </td>
                  <td>{g.checkedInAt && time(g.checkedInAt)}</td>
                  <td>{g.by ?? ""}</td>
                  <td>
                    <Act label="Undo" action={undoCheckIn} hidden={{ id: g.id }} who="Staff see this; the host doesn't">
                      <label>
                        Leave in <span className={ui.secondary}>(0 checks everyone out)</span>
                        <input className={ui.input} type="number" name="total" min={0} max={g.admitted - 1} defaultValue={0} />
                      </label>
                    </Act>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Container>
    </div>
  );
}
