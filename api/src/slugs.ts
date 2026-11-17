import { randomBytes } from "node:crypto";

// "Punchline Collective" → "punchline-collective-k3f9a1". The ending drops at the first published event (Hosts flow);
// an event's is its title plus 6 random characters (Discover flow). The base stops at 90, inside HostSlug and EventSlug's limits.
// ponytail: a name with no Latin letters (Hindi, Telugu) gets the fallback as its base; transliterating waits for a need.
export const slugFor = (name: string, fallback = "host") => {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // accents: "café" → "cafe"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90)
    .replace(/-+$/, "");
  return `${base || fallback}-${randomBytes(3).toString("hex")}`;
};
