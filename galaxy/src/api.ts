import type { Me } from "@orbit/contract";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ACCESS, apiFetch, type Result } from "./session";

// A signed-in call to the Orbit API, from a page or a Server Action. proxy.ts has already renewed the access token.
// Signed out or suspended goes to sign-in. Every Galaxy route answers 404 to staff without its feature, as if it
// didn't exist (api/src/roles/access.ts, requireFeature).
export async function galaxy<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<Result<T>> {
  const access = (await cookies()).get(ACCESS)?.value;
  if (!access) redirect("/login");
  const r = await apiFetch<T>(method, path, { body, access, xff: (await headers()).get("x-forwarded-for") });
  if (!r.ok && (r.status === 401 || r.error.error === "suspended")) redirect("/login");
  return r;
}

// A page's read: what isn't there, or isn't theirs to see, is "Page not found".
export async function read<T>(path: string): Promise<Result<T>> {
  const r = await galaxy<T>("GET", path);
  if (!r.ok && r.status === 404) notFound();
  return r;
}

export const me = () => read<Me>("/me");
