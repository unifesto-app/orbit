import type { Metadata } from "next";
import { Suspense } from "react";
import { me } from "../../../api";
import { PageHeader, ui } from "../../ui";
import { PeopleSearch } from "./search";

// People (Galaxy flow, People; API: GET /galaxy/people, suspend, lift). Holders of People search by name, phone or
// email; holders of Staff alone, by exact phone or email, to give someone access.
export const metadata: Metadata = { title: "Users" };

export default function Users() {
  return (
    <div className={ui.page}>
      <PageHeader title="Users" description="Find someone by name, or by their exact phone number or email. Contacts stay masked." />
      <Suspense fallback={null}>
        <Search />
      </Suspense>
    </div>
  );
}

async function Search() {
  const r = await me();
  return <PeopleSearch features={r.ok ? [...(r.data.staff?.features ?? [])] : []} self={r.ok ? r.data.id : null} />;
}
