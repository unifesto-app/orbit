import { test } from "node:test";
import assert from "node:assert/strict";
import { codeEmail, codeSender, emailSender, NotSent, type SesSend, whatsappSender } from "./senders.ts";

type Call = { url: string; init: RequestInit };
const fakeFetch = (respond: () => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { f, calls };
};
const reject = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof NotSent, String(e));
    return e;
  }
  assert.fail("should have rejected");
};
const OK = () => new Response(JSON.stringify({ messages: [{ id: "wamid.x" }] }), { status: 200 });
const wa = { phoneNumberId: "12345", token: "tok-wa" };

test("WhatsApp posts the otp template, the code in body and button", async () => {
  const { f, calls } = fakeFetch(OK);
  await whatsappSender(wa, f)("+919876543210", "123456");
  const { url, init } = calls[0]!;
  assert.equal(url, "https://graph.facebook.com/v18.0/12345/messages");
  assert.equal(init.method, "POST");
  assert.equal((init.headers as Record<string, string>).authorization, "Bearer tok-wa");
  assert.deepEqual(JSON.parse(init.body as string), {
    messaging_product: "whatsapp",
    to: "+919876543210",
    type: "template",
    template: {
      name: "otp",
      language: { code: "en" },
      components: [
        { type: "body", parameters: [{ type: "text", text: "123456" }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] },
      ],
    },
  });
});

test("WhatsApp outcomes", async () => {
  const send = (f: typeof fetch) => whatsappSender(wa, f)("+919876543210", "123456");
  const status = (n: number) => fakeFetch(() => new Response("x", { status: n })).f;
  const reasons = {
    400: "refused", 429: "throttled", 401: "notSetUp", 403: "notSetUp", 500: "unknown",
  } as const;
  for (const [n, r] of Object.entries(reasons)) assert.equal((await reject(send(status(Number(n))))).reason, r, n);
  assert.equal((await reject(send(fakeFetch(() => new Response("{}", { status: 200 })).f))).reason, "unknown");
  const boom = (async () => Promise.reject(new TypeError("network down"))) as unknown as typeof fetch;
  assert.equal((await reject(send(boom))).reason, "unknown");
  const slow = (async () => Promise.reject(new DOMException("timed out", "TimeoutError"))) as unknown as typeof fetch;
  assert.equal((await reject(send(slow))).reason, "unknown");
});

const sesErr = (name: string, status?: number) => Object.assign(new Error("boom"), { name }, status ? { $metadata: { httpStatusCode: status } } : {});

test("SES gets the source, destination, subject and both bodies", async () => {
  const inputs: any[] = [];
  const send: SesSend = async (i) => (inputs.push(i), { MessageId: "m1" });
  await emailSender({ from: "Orbit <hi@example.com>", send })("riya@example.com", "654321");
  const i = inputs[0];
  assert.equal(i.Source, "Orbit <hi@example.com>");
  assert.deepEqual(i.Destination.ToAddresses, ["riya@example.com"]);
  assert.ok(i.Message.Subject.Data.includes("654321"));
  const m = codeEmail("654321");
  assert.deepEqual(i.Message.Body.Html, { Data: m.html, Charset: "UTF-8" });
  assert.deepEqual(i.Message.Body.Text, { Data: m.text, Charset: "UTF-8" });
  assert.ok(i.Message.Body.Html.Data.includes("654321") && i.Message.Body.Text.Data.includes("654321"));
});

test("SES outcomes", async () => {
  const sender = (send: SesSend) => emailSender({ from: "f", send })("a@example.com", "654321");
  assert.equal((await reject(sender(async () => ({})))).reason, "unknown");
  const cases: [Error, string][] = [
    [sesErr("Throttling"), "throttled"],
    [sesErr("AccessDenied"), "notSetUp"],
    [sesErr("MessageRejected", 400), "refused"],
    [new Error("socket hang up"), "unknown"],
  ];
  for (const [e, r] of cases) assert.equal((await reject(sender(async () => Promise.reject(e)))).reason, r, e.name);
});

test("a channel with no keys is notSetUp", async () => {
  const send = codeSender({});
  assert.equal((await reject(send({ kind: "phone", e164: "+919876543210" }, "123456"))).reason, "notSetUp");
  assert.equal((await reject(send({ kind: "email", email: "a@example.com" }, "123456"))).reason, "notSetUp");
});

test("a NotSent message never contains the code", async () => {
  const code = "424242";
  const cases = [
    () => new Response("denied", { status: 400 }),
    () => new Response("oops", { status: 500 }),
  ];
  for (const r of cases) {
    const e = await reject(whatsappSender(wa, fakeFetch(r).f)("+919876543210", code));
    assert.ok(!e.message.includes(code));
    
  }
  const m = await reject(emailSender({ from: "f", send: async () => Promise.reject(sesErr("MessageRejected", 400)) })("a@example.com", code));
  assert.ok(!m.message.includes(code));
  assert.ok(!(await reject(codeSender({})({ kind: "phone", e164: "+919876543210" }, code))).message.includes(code));
});
