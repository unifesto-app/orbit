import { CLIENT_HEADER } from "@orbit/contract";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { ACCESS, API_URL } from "../../../../../session";

// An applicant's résumé (API: GET /galaxy/applications/:id/resume, for holders of People), passed through as the
// API sends it: an attachment that's never cached. Galaxy's own API helper reads JSON only, so the file comes through
// here. proxy.ts has already renewed the access token; signed out goes to sign-in. Each download is in the audit log.
export async function GET(req: NextRequest, ctx: RouteContext<"/careers/resume/[id]">) {
  const { id } = await ctx.params;
  const access = (await cookies()).get(ACCESS)?.value;
  if (!access) return Response.redirect(new URL("/login", req.url), 303);
  const xff = req.headers.get("x-forwarded-for");
  const res = await fetch(`${API_URL}/galaxy/applications/${encodeURIComponent(id)}/resume`, {
    headers: { authorization: `Bearer ${access}`, [CLIENT_HEADER]: "galaxy", ...(xff ? { "x-forwarded-for": xff } : {}) },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (res?.status === 401) return Response.redirect(new URL("/login", req.url), 303);
  if (!res?.ok || !res.body) return new Response(res ? "There's nothing here." : "Can't reach the API. Try again.", { status: res ? 404 : 502 });
  const keep = ["content-type", "content-disposition", "content-length"].flatMap((h) => {
    const v = res.headers.get(h);
    return v ? [[h, v] as [string, string]] : [];
  });
  return new Response(res.body, { headers: [...keep, ["cache-control", "private, no-store"], ["x-content-type-options", "nosniff"]] });
}
