import type { Metadata } from "next";
import ui from "./ui.module.css";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <h1 className={ui.h1}>Page not found</h1>
        <p className={ui.secondary}>This page doesn&apos;t exist.</p>
      </header>
    </div>
  );
}
