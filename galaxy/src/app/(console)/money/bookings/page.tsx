import type { Metadata } from "next";
import { ui } from "../../../ui";
import { MoneyHeader } from "../tabs";
import { BookingSearch } from "./search";

// Money › Bookings and tickets (API: GET /galaxy/bookings, POST /galaxy/bookings/:id/cancel), for holders of Money.
// ponytail: no Resend ticket; Orbit sends no ticket email yet, add it here when one exists.
export const metadata: Metadata = { title: "Bookings and tickets" };

export default function Bookings() {
  return (
    <div className={ui.page}>
      <MoneyHeader current="bookings" description="Find a booking by person or event. Cancelling a paid booking refunds it in full. Times are India's." />
      <BookingSearch />
    </div>
  );
}
