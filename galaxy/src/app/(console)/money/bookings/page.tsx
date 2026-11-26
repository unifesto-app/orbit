import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { me } from "../../../../api";
import { ui } from "../../../ui";
import { MoneyHeader } from "../tabs";
import { BookingSearch } from "./search";

// Money › Bookings and tickets (API: GET /galaxy/bookings, POST /galaxy/bookings/:id/cancel), for holders of Money;
// finding a person also needs People. Every search is written to the audit log.
// ponytail: no Resend ticket; Orbit sends no ticket email yet, add it here when one exists.
export const metadata: Metadata = { title: "Bookings and tickets" };

export default function Bookings() {
  return (
    <div className={ui.page}>
      <MoneyHeader current="bookings" description="Find a booking by person or event. Cancelling a paid booking refunds it in full. Times are India's." />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

// Nothing here without Money, as the API answers.
async function Body() {
  const r = await me();
  const features = r.ok ? (r.data.staff?.features ?? []) : [];
  if (!features.includes("money")) notFound();
  return <BookingSearch people={features.includes("people")} />;
}
