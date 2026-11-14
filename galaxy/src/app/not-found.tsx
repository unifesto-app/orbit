import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, ui } from "./ui";

// Every nav section that isn't built yet lands here too, inside the shell.
export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className={ui.page}>
      <PageHeader
        title="Page not found"
        description="This page doesn't exist, or this part of Galaxy isn't built yet."
      />
      <div>
        <Link href="/" className={ui.btn}>
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
