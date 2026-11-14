import type { Metadata } from "next";
import Link from "next/link";
import { sections } from "./nav";
import { Container, PageHeader, ui } from "./ui";

// The layout's "%s | Galaxy" template skips its own segment, so spell it out.
export const metadata: Metadata = { title: { absolute: "Dashboard | Galaxy" } };

export default function Dashboard() {
  return (
    <div className={ui.page}>
      <PageHeader title="Dashboard" description="Platform admin for Orbit by Unifesto." />
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
