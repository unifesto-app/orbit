"use server";

import { Apply, applyFields, RESUME_MAX_BYTES } from "@orbit/contract";
import { call } from "../../call";

// One application (API: POST /public/openings/:slug/apply), checked here first so a mistyped field is said at once
// instead of after the upload; the API checks it all again, the PDF's own bytes too.

export type Applied = { error?: string; done?: { name: string; email: string } };

// What to say for the first field that's wrong, in the form's own words.
const SAY: Record<string, string> = {
  name: "Enter your name.",
  email: "Enter a valid email address.",
  phone: "Enter your phone number, digits only.",
  linkedin: "Check your LinkedIn link.",
  link: "Check the link to your work.",
  note: "Keep the note under 2,000 characters.",
};

// A link typed without https:// gets it, so "linkedin.com/in/you" works.
const withScheme = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && !/^https?:\/\//i.test(s) ? `https://${s}` : s;
};

export async function apply(slug: string, _: Applied, data: FormData): Promise<Applied> {
  const fields = applyFields((k) => (k === "linkedin" || k === "link" ? withScheme(data.get(k)) : data.get(k)));
  const r = Apply.safeParse(fields);
  if (!r.success) return { error: SAY[String(r.error.issues[0]?.path[0])] ?? "Check what you typed and try again." };
  const resume = data.get("resume");
  if (!(resume instanceof File) || !resume.size) return { error: "Attach your résumé as a PDF." };
  if (resume.size > RESUME_MAX_BYTES) return { error: "That file is over 5 MB. Attach a smaller PDF." };
  // The one box: consent to keep the details for this role, as the Privacy Policy says.
  if (data.get("agree") !== "on") return { error: "Tick the box to agree to the Privacy Policy." };

  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, String(v));
  body.set("resume", resume, "resume.pdf");
  body.set("turnstile", String(data.get("turnstile") ?? ""));
  const sent = await call(`/public/openings/${encodeURIComponent(slug)}/apply`, body);
  if (!sent.ok) return { error: sent.code === "notFound" ? "This role isn’t taking applications any more." : sent.error };
  return { done: { name: r.data.name.split(/\s+/)[0]!, email: r.data.email } };
}
