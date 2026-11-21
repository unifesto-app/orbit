import type { OpeningCard, OpeningPage } from "@orbit/contract";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { API_URL } from "../../api";

// The open openings, read from the API on each visit, never at build time (as the waitlist's count is), so a change
// saved in Galaxy shows within the API's minute of caching. Once per request: the page and its metadata share a read.
// Null when the API can't be reached, so the page says so instead of "no openings".

const get = async (path: string) => {
  await connection();
  return fetch(`${API_URL}${path}`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
};

export const openings = cache(async (): Promise<OpeningCard[] | null> => {
  const res = await get("/public/openings");
  const r: { openings?: OpeningCard[] } | null = res?.ok ? await res.json().catch(() => null) : null;
  return r?.openings ?? null;
});

// A draft, closed or made-up link is the site's 404.
export const opening = cache(async (slug: string): Promise<OpeningPage | null> => {
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) notFound();
  const res = await get(`/public/openings/${slug}`);
  if (res?.status === 404) notFound();
  return res?.ok ? await res.json().catch(() => null) : null;
});
