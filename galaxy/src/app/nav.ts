// Galaxy's side navigation. Sections are the v1 "Platform admins" rows in
// docs/context/artifacts/orbit-rebuild-plan.md (section 4), plus the admin
// sides of custom domains and the support queue from the Hosts table.
// Broadcasts are Later and traffic/OTA screens are dropped, so they're absent.
// Pages that aren't built yet land on not-found.tsx.

// Text only, as the AWS console's side nav is (owner, 17 Nov 2026: "dont use icons always. same like aws").
// `also`: more paths that count as this item, for the current link and the breadcrumb.
export type NavItem = { label: string; href: string; also?: string[] };

export const home: NavItem = { label: "Dashboard", href: "/" };
export const tokens: NavItem = { label: "Design tokens", href: "/tokens" };

export const sections: { title: string; items: NavItem[] }[] = [
  {
    title: "Community",
    // Every kind of person on one People screen, a tab each (owner, 17 Nov 2026: "One People screen"; the tabs are in
    // (console)/people.tsx), then their events.
    items: [
      { label: "People", href: "/users", also: ["/hosts", "/teams", "/staff"] },
      { label: "Events", href: "/events" },
    ],
  },
  {
    title: "Queues",
    items: [
      { label: "Requests", href: "/requests" },
      { label: "Support", href: "/support" },
      { label: "Content reports", href: "/reports" },
    ],
  },
  {
    title: "Money",
    items: [
      { label: "Transactions", href: "/transactions" },
      { label: "Refunds", href: "/refunds" },
      { label: "Payouts", href: "/payouts" },
      { label: "Orphaned payments", href: "/orphaned-payments" },
      { label: "Reconciliation", href: "/reconciliation" },
      { label: "Fees", href: "/fees" },
    ],
  },
  {
    title: "Platform",
    items: [
      { label: "Custom domains", href: "/domains" },
      { label: "Legal documents", href: "/legal" },
      { label: "App settings", href: "/settings" },
      // Galaxy flow (15 Nov): the audit log of every staff action. Staff moved to Community (17 Nov).
      { label: "Audit log", href: "/audit" },
    ],
  },
  {
    title: "Content",
    items: [
      { label: "Blog", href: "/blog" },
      { label: "Help", href: "/help" },
      { label: "Careers", href: "/careers" },
      { label: "Company", href: "/company" },
      { label: "PM board", href: "/pm-board" },
      { label: "WeGoBeyond", href: "/wegobeyond" },
      { label: "Encore", href: "/encore" },
    ],
  },
];

export const isActive = (item: NavItem, path: string) =>
  [item.href, ...(item.also ?? [])].some((href) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`)));

const all = [home, ...sections.flatMap((s) => s.items), tokens];

/** The nav item a path belongs to, for the breadcrumb. */
export const crumbFor = (path: string) => all.find((item) => isActive(item, path));
