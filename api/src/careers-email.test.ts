import { test } from "node:test";
import assert from "node:assert/strict";
import { WAITLIST_CONTACT } from "@orbit/contract";
import { applicationEmail } from "./careers-email.ts";

const site = "https://example.test";
const mail = (name: string, title = "Designer") => applicationEmail({ name, title, slug: "designer-abc123" }, site);

test("a title is escaped in the HTML and kept as is in the text and subject", () => {
  const title = `A<b>&"Co"`;
  const m = mail("Asha Rao", title);
  assert.ok(!m.html.includes("<b>"));
  assert.ok(m.html.includes("A&#60;b&#62;&#38;&#34;Co&#34;"));
  assert.match(m.html, /<title>[^<]*A&#60;b&#62;&#38;&#34;Co&#34;/);
  assert.ok(m.text.includes(title));
  assert.equal(m.subject, `Your application for ${title}`);
});

test("the greeting takes a first name, never one with a dot", () => {
  assert.ok(mail("Asha Rao").text.startsWith("Thanks, Asha."));
  assert.ok(mail("evil.com Smith").text.startsWith("Thanks for applying."));
  assert.ok(!mail("evil.com Smith").html.includes("evil.com"));
});

test("the role link and reply address", () => {
  const m = mail("Asha Rao");
  assert.ok(m.text.includes(`${site}/careers/designer-abc123`));
  assert.equal(m.replyTo, WAITLIST_CONTACT);
});
