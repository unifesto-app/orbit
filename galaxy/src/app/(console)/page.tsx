import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { me } from "../../api";
import { sections } from "../nav";
import { Container, FEATURE_NAMES, PageHeader, ui } from "../ui";

// The layout's "%s | Galaxy" template skips its own segment, so spell it out.
export const metadata: Metadata = { title: { absolute: "Dashboard | Galaxy" } };

export default function Dashboard() {
  return (
    <div className={ui.page}>
      <PageHeader title="Dashboard" description="Platform admin for Orbit by Unifesto." />
      <Suspense fallback={null}>
        <Access />
      </Suspense>
      <Container title="All sections">
        <div className={ui.columns}>
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className={ui.h3}>{section.title}</h3>
              <ul className={ui.list}>
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href}>{item.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Container>
    </div>
  );
}

// What this staff member can open. Built so far: Users (People), Hosts and Staff; the rest land on "Page not found".
async function Access() {
  const r = await me();
  const staff = r.ok ? r.data.staff : null;
  if (!staff) return null;
  return (
    <Container title="Your access">
      <p>{staff.owner ? "Platform owner: every feature." : staff.features.map((f) => FEATURE_NAMES[f]).join(", ")}</p>
    </Container>
  );
}
