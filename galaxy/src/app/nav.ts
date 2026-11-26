// Galaxy's side navigation: built pages only (owner, 19 Nov 2026: "remove all the page not founds from galaxy"). The
// rest of the v1 "Platform admins" rows in docs/context/artifacts/orbit-rebuild-plan.md (section 4) — the
// Queues, Money, Platform, and the old company content — come back here as each page is built. The landing page's own
// visits are under Website (owner, 19 Nov 2026: "website and pages analytics in galaxy web").

// Text only, as the AWS console's side nav is (owner, 17 Nov 2026: "dont use icons always. same like aws").
// `also`: more paths that count as this item, for the current link and the breadcrumb.
export type NavItem = { label: string; href: string; also?: string[] };

export const home: NavItem = { label: "Dashboard", href: "/" };
export const tokens: NavItem = { label: "Design tokens", href: "/tokens" };

export const sections: { title: string; items: NavItem[] }[] = [
  {
    title: "Community",
    // Every kind of person on one People screen, a tab each (owner, 17 Nov 2026: "One People screen"; the tabs are in
    // (console)/people.tsx).
    items: [
      { label: "People", href: "/users", also: ["/hosts", "/teams", "/staff"] },
      // Event Requests: people asking to host, answered here (Hosts flow, H1.5).
      { label: "Requests", href: "/requests" },
      // Every host's events: unpublish, cancel, promote (X1).
      { label: "Events", href: "/events" },
      // Every Venue host, Setup pending until Play Partner's setup saves it, with its stations (X9).
      { label: "Venues", href: "/venues" },
      // DAU, WAU, MAU, retention, platforms and versions (owner, 19 Nov 2026: "user analytics, mau, dau etc").
      { label: "Analytics", href: "/analytics" },
      // Coming Soon's waitlist until launch (owner, 17 Nov 2026: "create a page in galaxy web - prelaunch").
      { label: "Prelaunch", href: "/prelaunch" },
      // Visits to heyorbit.in from the site's own log (owner, 19 Nov 2026: "Our own visit log").
      { label: "Website", href: "/website" },
    ],
  },
  {
    title: "Content",
    items: [
      // The words Orbit itself writes in the app: ad strips, Help answers, Ask Orbit (owner, 19 Nov 2026: "build CMS
      // for Orbit App in galaxy web").
      { label: "App content", href: "/app-content" },
      // heyorbit.in/careers' openings and who applied (owner, 22 Nov 2026: "careers page at heyorbit.in/careers, link
      // to galaxy").
      { label: "Careers", href: "/careers" },
      { label: "PM board", href: "/pm-board" },
    ],
  },
  {
    title: "Platform",
    items: [
      // Notification kinds with their kill switches, and the delivery log by person (notifications build plan, PR 7).
      { label: "Notifications", href: "/notifications" },
    ],
  },
];

export const isActive = (item: NavItem, path: string) =>
  [item.href, ...(item.also ?? [])].some((href) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`)));

const all = [home, ...sections.flatMap((s) => s.items), tokens];

/** The nav item a path belongs to, for the breadcrumb. */
export const crumbFor = (path: string) => all.find((item) => isActive(item, path));
