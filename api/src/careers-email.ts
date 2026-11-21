import { WAITLIST_CONTACT } from "@orbit/contract";
import { esc, frame, NAME } from "./prelaunch-email.ts";

// The note an applicant gets once their application is in (owner, 22 Nov 2026: "complete", on "No confirmation email
// goes to applicants"): the role, what happens next, and how to have it deleted. Once per application: applying again
// for the same role sends nothing. The address isn't proved, so it says only what the form already showed, never the
// note or links they typed, and the greeting takes their first name only when it looks like a name (as the welcome).

const SITE = "https://heyorbit.in";

export function applicationEmail(p: { name: string; title: string; slug: string }, site = SITE) {
  const token = p.name.trim().split(/\s+/)[0] ?? "";
  // Never a word with a dot: anyone can apply with any address, and "evil.com" would show up as a link.
  const first = NAME.test(token) && !token.includes(".") ? token : null;
  const heading = first ? `Thanks, ${first}.` : "Thanks for applying.";
  const subject = `Your application for ${p.title}`;
  const lead = `Your application for ${p.title} at Orbit is in. We read every one, and if it’s a fit, we’ll write to you here.`;
  const why = `You’re getting this because you applied for a role at heyorbit.in/careers. To withdraw your application and have it deleted, write to ${WAITLIST_CONTACT}.`;
  const role = `${site}/careers/${encodeURIComponent(p.slug)}`;
  const html = frame({ subject, heading, lead: esc(lead), button: { href: role, label: "See the role" }, why }, site);
  const text = [
    heading,
    "",
    lead,
    "",
    "There’s more to live beyond the usual.",
    `The role: ${role}`,
    "",
    why,
    `Terms: ${site}/terms · Privacy: ${site}/privacy`,
    "© 2027 Orbit",
  ].join("\n");
  return { subject, html, text, replyTo: WAITLIST_CONTACT };
}
