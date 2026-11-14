import type { ReactNode } from "react";
import ui from "./ui.module.css";

export { ui };

export function PageHeader({ title, count, description }: { title: string; count?: number; description?: string }) {
  return (
    <header className={ui.pageHeader}>
      <h1 className={ui.h1}>
        {title}
        {count !== undefined && <span className={ui.counter}> ({count})</span>}
      </h1>
      {description && <p className={ui.secondary}>{description}</p>}
    </header>
  );
}

export function Container({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className={ui.container}>
      <h2 className={ui.containerHeader}>
        {title}
        {count !== undefined && <span className={ui.counter}> ({count})</span>}
      </h2>
      <div className={ui.containerBody}>{children}</div>
    </section>
  );
}
