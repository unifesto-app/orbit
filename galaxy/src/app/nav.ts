// Galaxy's side navigation. Sections are the v1 "Platform admins" rows in
// docs/context/artifacts/orbit-rebuild-plan.md (section 4), plus the admin
// sides of custom domains and the support queue from the Hosts table.
// Broadcasts are Later and traffic/OTA screens are dropped, so they're absent.
// Pages that aren't built yet land on not-found.tsx.

export type NavItem = { label: string; href: string };

export const home: NavItem = { label: "Dashboard", href: "/" };
export const tokens: NavItem = { label: "Design tokens", href: "/tokens" };

export const sections: { title: string; items: NavItem[] }[] = [
  {
    title: "Community",
    items: [
      { label: "Users", href: "/users" },
      { label: "Hosts", href: "/hosts" },
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

export const isActive = (href: string, path: string) =>
  href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);

const all = [home, ...sections.flatMap((s) => s.items), tokens];

/** The nav item a path belongs to, for the breadcrumb. */
export const crumbFor = (path: string) => all.find((item) => isActive(item.href, path));
