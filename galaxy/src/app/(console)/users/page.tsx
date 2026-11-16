import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { me, read } from "../../../api";
import { Alert, ui } from "../../ui";
import { People } from "../people";
import { type Listing, PeopleSearch } from "./search";

// Users (Galaxy flow, People; API: GET /galaxy/people, suspend, lift). Holders of People see every account and search
// by name, phone or email; holders of Staff alone search by exact phone or email, to give someone access.
export const metadata: Metadata = { title: "Users" };

export default function Users({ searchParams }: PageProps<"/users">) {
  return (
    <div className={ui.page}>
      <People current="users" description="Every account on Orbit, newest first. Search by name, or by their exact phone number or email." />
      <Suspense fallback={null}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/users">, "searchParams">) {
  await connection(); // the list is written to the audit log: never for a prefetch
  const r = await me();
  const features = r.ok ? [...(r.data.staff?.features ?? [])] : [];
  const raw = (await searchParams).page;
  const page = Array.isArray(raw) ? raw[0] : raw; // the API answers page 1 for anything it can't read
  const list = features.includes("people") ? await read<Listing>(`/galaxy/people?page=${encodeURIComponent(page ?? "1")}`) : null;
  return (
    <>
      {list && !list.ok && <Alert>{list.error.message}</Alert>}
      <PeopleSearch features={features} self={r.ok ? r.data.id : null} list={list?.ok ? list.data : null} />
    </>
  );
}
