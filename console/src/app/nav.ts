// The Console's side navigation: built pages only, as in Galaxy (owner, 19 Nov 2026: "remove all the page not founds
// from galaxy"). Events, Team, Money and the rest come in as each page is built.

// Text only, as the AWS console's side nav is. `also`: more paths that count as this item, for the current link and the
// breadcrumb.
export type NavItem = { label: string; href: string; also?: string[] };

export const home: NavItem = { label: "Home", href: "/" };

export const sections: { title: string; items: NavItem[] }[] = [];

export const isActive = (item: NavItem, path: string) =>
  [item.href, ...(item.also ?? [])].some((href) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`)));

const all = [home, ...sections.flatMap((s) => s.items)];

/** The nav item a path belongs to, for the breadcrumb. */
export const crumbFor = (path: string) => all.find((item) => isActive(item, path));
