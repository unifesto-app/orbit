import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import type { Contact } from "@orbit/contract";
import type { Sender } from "./codes.ts";

// Sign-in codes by WhatsApp (Meta's Cloud API) and by email (Amazon SES), as the Unifesto backend sends them today:
// it keeps codes off Resend because Resend's daily quota is small (email.service.ts). A code is never logged.

// Why a send failed:
// - refused: the provider turned down this message (a malformed number, a rejected address), so it never went.
// - throttled: the provider is rate-limiting us; it never went, and a try a little later may work.
// - notSetUp: this channel has no keys here, or its keys were refused (expired token, revoked key).
// - unknown: a timeout, a provider fault or an unclear answer, so it may yet arrive.
// A WhatsApp number that isn't on WhatsApp is accepted at send time and fails later, on Meta's status callback
// (not read yet), so it shows as sent.
export class NotSent extends Error {
  readonly channel: Contact["kind"];
  readonly reason: "refused" | "throttled" | "notSetUp" | "unknown";
  constructor(channel: Contact["kind"], reason: NotSent["reason"], detail: string) {
    super(`${channel} code not sent (${reason}): ${detail}`);
    this.channel = channel;
    this.reason = reason;
  }
}

type Fetch = typeof fetch;
const TIMEOUT_MS = 10_000;

// HTTP status to reason, the same for every provider.
const byStatus = (status: number): NotSent["reason"] =>
  status === 429 ? "throttled" : status === 401 || status === 403 ? "notSetUp" : status >= 400 && status < 500 ? "refused" : "unknown";

// The approved authentication template "otp" (Meta id 2217845882320700): the code in the body, and again behind its
// "Copy code" button. Same request as Unifesto's whatsapp.service.ts sendOtp, on the Graph version it calls.
export const whatsappSender =
  (c: { phoneNumberId: string; token: string }, fetchImpl: Fetch = fetch) =>
  async (e164: string, code: string) => {
    let res: Response;
    try {
      res = await fetchImpl(`https://graph.facebook.com/v18.0/${c.phoneNumberId}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: e164,
          type: "template",
          template: {
            name: "otp",
            language: { code: "en" },
            components: [
              { type: "body", parameters: [{ type: "text", text: code }] },
              { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
            ],
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new NotSent("phone", "unknown", (e as Error).name === "TimeoutError" ? "timed out" : String(e));
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) throw new NotSent("phone", byStatus(res.status), `${res.status} ${text.slice(0, 300)}`);
    // Accepted means Meta gave the message an id; anything else may or may not have gone.
    const id = (() => {
      try {
        return (JSON.parse(text) as { messages?: { id?: string }[] }).messages?.[0]?.id;
      } catch {
        return undefined;
      }
    })();
    if (!id) throw new NotSent("phone", "unknown", `${res.status} with no message id`);
  };

// "123456 is your Orbit code", in HTML and plain text.
export function codeEmail(code: string) {
  return {
    subject: `${code} is your Orbit code`,
    text: `Your Orbit code is ${code}. It expires in 10 minutes. Don't share it with anyone. If you didn't ask for it, you can ignore this email.`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#121215;color:#ffffff;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<p style="margin:0 0 8px;font-size:16px">Your Orbit sign-in code</p>
<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px">${code}</p>
<p style="margin:0;font-size:13px;color:#b8b8bf">It expires in 10 minutes. Don't share it with anyone. If you didn't ask for it, you can ignore this email.</p>
</body></html>`,
  };
}

// The SES call, so tests can stand in for AWS.
export type SesSend = (input: ConstructorParameters<typeof SendEmailCommand>[0]) => Promise<{ MessageId?: string }>;
export const sesClient = (region: string): SesSend => {
  const ses = new SESClient({ region, maxAttempts: 2, requestHandler: { connectionTimeout: 5_000, requestTimeout: TIMEOUT_MS } });
  return (input) => ses.send(new SendEmailCommand(input));
};

// AWS errors that mean our side is misconfigured, not the address.
const SES_SETUP = /AccessDenied|InvalidClientTokenId|SignatureDoesNotMatch|UnrecognizedClient|ExpiredToken|CredentialsProvider|NotVerified|ConfigurationSet|AccountSendingPaused/i;

// Amazon SES, from the domain Unifesto already sends its codes from.
export const emailSender =
  (c: { from: string; send: SesSend }) =>
  async (email: string, code: string) => {
    const m = codeEmail(code);
    let out: { MessageId?: string };
    try {
      out = await c.send({
        Source: c.from,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: m.subject, Charset: "UTF-8" },
          Body: { Html: { Data: m.html, Charset: "UTF-8" }, Text: { Data: m.text, Charset: "UTF-8" } },
        },
      });
    } catch (e) {
      const err = e as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
      const name = err.name ?? "Error";
      const status = err.$metadata?.httpStatusCode;
      const reason: NotSent["reason"] = SES_SETUP.test(name)
        ? "notSetUp"
        : /Throttl/i.test(name)
          ? "throttled"
          : status
            ? byStatus(status)
            : "unknown";
      throw new NotSent("email", reason, `${name}: ${(err.message ?? "").slice(0, 300)}`);
    }
    if (!out.MessageId) throw new NotSent("email", "unknown", "no message id");
  };

// One Sender for both channels. A channel without keys refuses with notSetUp rather than stopping the API.
export function codeSender(ch: { phone?: (e164: string, code: string) => Promise<void>; email?: (email: string, code: string) => Promise<void> }): Sender {
  return async (to, code) => {
    if (to.kind === "phone") {
      if (!ch.phone) throw new NotSent("phone", "notSetUp", "no WhatsApp keys");
      return ch.phone(to.e164, code);
    }
    if (!ch.email) throw new NotSent("email", "notSetUp", "email codes are off");
    return ch.email(to.email, code);
  };
}
