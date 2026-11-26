"use client";

import type { BookingStatus } from "@orbit/contract";
import Link from "next/link";
import { startTransition, useActionState } from "react";
import { Alert, Badge, Container, ui } from "../../../ui";
import { Act } from "../../act";
import { cancelBooking, searchBookings } from "../actions";
import { inr, STATUS, when } from "../tabs";

const BOOKED: Record<BookingStatus, [string, "success" | "neutral" | "warning"]> = {
  confirmed: ["Booked", "success"],
  cancelled: ["Cancelled", "neutral"],
  cancelledByHost: ["Cancelled by host", "warning"],
};

// Find bookings by person or event, then cancel one. After a cancel the same search runs again so the row shows it.
export function BookingSearch() {
  const [found, search, pending] = useActionState(searchBookings, { person: "", event: "" });
  const again = () => {
    const f = new FormData();
    f.set("person", found.person);
    f.set("event", found.event);
    startTransition(() => search(f));
  };
  return (
    <>
      <form action={search} className={ui.row}>
        <input className={ui.input} name="person" defaultValue={found.person} placeholder="Name, phone or email" aria-label="Person" minLength={3} />
        <input className={ui.input} name="event" defaultValue={found.event} placeholder="Event title or id" aria-label="Event" minLength={3} />
        <button className={`${ui.btn} ${ui.primary}`} disabled={pending}>
          Find
        </button>
      </form>
      <Alert>{found.error}</Alert>
      {found.bookings && (
        <Container title="Bookings" count={found.bookings.length}>
          {found.bookings.length === 0 ? (
            <p className={ui.secondary}>No bookings match.</p>
          ) : (
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Status</th>
                  <th>Person</th>
                  <th>Event</th>
                  <th>Payment</th>
                  <th>Booked</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {found.bookings.map((b) => (
                  <tr key={b.id}>
                    <td>
                      {b.code}
                      <div className={ui.secondary}>
                        {b.quantity} × {b.ticketTypeName}, {b.pricePaise ? inr(b.pricePaise) : "Free"}
                      </div>
                    </td>
                    <td>
                      <Badge tone={BOOKED[b.status][1]}>{BOOKED[b.status][0]}</Badge>
                    </td>
                    <td>{b.userName ?? "No name yet"}</td>
                    <td>
                      {b.eventTitle}
                      <div className={ui.secondary}>{b.hostName}</div>
                    </td>
                    <td>
                      {b.payment ? (
                        <Link href={`/money/payments/${b.payment.id}`} prefetch={false}>
                          {inr(b.payment.amountPaise)}, {STATUS[b.payment.status][0]}
                        </Link>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td>{when(b.createdAt)}</td>
                    <td>
                      {b.status === "confirmed" && (
                        <Act
                          label="Cancel"
                          action={cancelBooking}
                          hidden={{ id: b.id }}
                          who={b.payment ? "Refunded in full. Everyone with Money sees this" : "Everyone with Money sees this"}
                          onDone={again}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Container>
      )}
    </>
  );
}
