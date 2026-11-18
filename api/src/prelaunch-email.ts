import { FEATURES, type Feature, WAITLIST_CONTACT } from "@orbit/contract";
import { channels, palette, radius } from "@orbit/tokens";

// The waitlist's welcome email (owner, 18 Nov 2026: "send them email, after joining the waitlist", "Design the email
// using brand tokens"): the 3D wordmark and the symbols in orbit as pictures (email can't draw the SVG filters), the
// person's name, what they picked, and the footer every list email needs. Colours come from @orbit/tokens; email
// clients don't all take rgba, so the Stone tints are mixed onto Charcoal here. Tables and inline styles, for Outlook.
// The brand fonts lead each stack but aren't loaded (no Google Fonts call from anyone's inbox); most clients show the
// fallback. Replies go to the contact address, not the no-reply sender.

const SITE = "https://heyorbit.in";

// `a` of `top` over `under`, as #rrggbb.
const mix = (top: string, under: string, a: number) =>
  `#${channels(top)
    .map((c, i) => Math.round(c * a + channels(under)[i]! * (1 - a)))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;

const ground = palette.charcoal;
const text = palette.stone;
const text2 = mix(palette.stone, ground, 0.64);
const hairline = mix(palette.stone, ground, 0.12);
const glassBorder = mix(palette.stone, ground, 0.22);
const glassFill = mix(palette.stone, ground, 0.06);
const display = "'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif";
const body = "'DM Sans','Helvetica Neue',Helvetica,Arial,sans-serif";

// Everything a person typed goes into the HTML escaped.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// The greeting uses the first name only when it looks like a name (letters, with . ' ’ -), so a "name" that is a link
// or a sentence can't ride our email to an address nobody proved; anything else gets "You’re in."
const NAME = /^[\p{L}\p{M}][\p{L}\p{M}.'’-]{0,39}$/u;

export function welcomeEmail(p: { name: string; features: Feature[] }, site = SITE) {
  const token = p.name.trim().split(/\s+/)[0] ?? "";
  const first = NAME.test(token) ? token : null;
  const hello = first ? `You’re in, ${first}.` : "You’re in.";
  const wants = p.features.map((f) => FEATURES[f]);
  const subject = "You’re on the Orbit waitlist";
  const lead = "You’re on the Orbit waitlist. We’ll let you know when Orbit opens.";
  const why = `You’re getting this because you joined the Orbit waitlist at heyorbit.in. To leave it, write to ${WAITLIST_CONTACT}.`;

  const chips = wants
    .map(
      (w) =>
        `<span style="display:inline-block;margin:0 6px 8px 0;padding:7px 12px;border-radius:${radius.pill}px;background:${palette.sage};color:${palette.charcoal};font:500 13px/1.2 ${body}">${esc(w)}</span>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${subject}</title>
<style>
body{margin:0;padding:0;background:${ground}}
a{color:${text}}
@media (max-width:620px){.px{padding-left:20px!important;padding-right:20px!important}.h1{font-size:28px!important}}
</style>
</head>
<body style="margin:0;padding:0;background:${ground}" bgcolor="${ground}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${ground}">There’s more to live beyond the usual.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${ground}" style="background:${ground}">
<tr><td align="center" style="padding:32px 12px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td class="px" style="padding:0 32px"><img src="${site}/email/wordmark.png" width="120" alt="Orbit" style="display:block;width:120px;height:auto;border:0"></td></tr>
<tr><td style="padding:28px 16px 0"><img src="${site}/email/orbits.png" width="528" alt="" style="display:block;width:100%;max-width:528px;height:auto;border:0"></td></tr>
<tr><td class="px" style="padding:12px 32px 0">
<h1 class="h1" style="margin:0;color:${text};font:800 34px/1.1 ${display};letter-spacing:-0.03em">${esc(hello)}</h1>
<p style="margin:14px 0 0;color:${text2};font:400 16px/1.6 ${body}">${lead}</p>
</td></tr>
${
  chips
    ? `<tr><td class="px" style="padding:28px 32px 0">
<p style="margin:0 0 12px;color:${text2};font:500 13px/1.4 ${body}">You’d love</p>
${chips}
</td></tr>`
    : ""
}
<tr><td class="px" style="padding:28px 32px 0">
<a href="https://www.instagram.com/heyorbit.in" style="display:inline-block;padding:12px 22px;border:1px solid ${glassBorder};border-radius:${radius.pill}px;background:${glassFill};color:${text};font:600 15px/1.2 ${display};text-decoration:none">Follow Orbit on Instagram</a>
</td></tr>
<tr><td class="px" style="padding:40px 32px 0"><div style="height:1px;line-height:1px;font-size:0;background:${hairline}">&nbsp;</div></td></tr>
<tr><td class="px" style="padding:20px 32px 0;color:${text2};font:400 12px/1.6 ${body}">
${why.replace(WAITLIST_CONTACT, `<a href="mailto:${WAITLIST_CONTACT}" style="color:${text2}">${WAITLIST_CONTACT}</a>`)}<br>
<a href="${site}/terms" style="color:${text2}">Terms</a> &middot; <a href="${site}/privacy" style="color:${text2}">Privacy</a><br>
© 2027 Orbit
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const plain = [
    hello,
    "",
    lead,
    ...(wants.length ? ["", `You’d love: ${wants.join(", ")}.`] : []),
    "",
    "There’s more to live beyond the usual.",
    "Instagram: https://www.instagram.com/heyorbit.in",
    "",
    why,
    `Terms: ${site}/terms · Privacy: ${site}/privacy`,
    "© 2027 Orbit",
  ].join("\n");

  return { subject, html, text: plain, replyTo: WAITLIST_CONTACT };
}
