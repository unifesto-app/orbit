import { createHmac, timingSafeEqual } from "node:crypto";

// Razorpay over plain fetch with Basic auth (no SDK). Keys come only from the environment (server.ts): RAZORPAY_KEY_ID,
// RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET. Never logged; errors carry Razorpay's status and code, never the keys.
// `fetch` is injectable so tests answer for Razorpay and never reach the network.

export type RazorpayConfig = { keyId: string; keySecret: string; webhookSecret: string; fetch?: typeof fetch };
export type RzPayment = { id: string; order_id: string; status: string; amount: number; fee?: number | null; tax?: number | null };
export type RzRefund = { id: string; payment_id: string; amount: number; status: string; receipt?: string | null; notes?: Record<string, string> };

const API = "https://api.razorpay.com/v1";

// HMAC-SHA256 of `data`, compared in constant time with the hex `signature`.
const signed = (secret: string, data: string, signature: string) => {
  const want = createHmac("sha256", secret).update(data).digest();
  const got = Buffer.from(signature, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
};

export function razorpay(cfg: RazorpayConfig) {
  const f = cfg.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}`;
  const call = async <T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> => {
    const res = await f(`${API}${path}`, {
      method,
      headers: { authorization: auth, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (!res.ok) throw new Error(`razorpay ${method} ${path.split("/")[1]}: ${res.status} ${json?.error?.code ?? ""}`.trim());
    return json as T;
  };
  return {
    keyId: cfg.keyId,
    // An order for `amount` paise; `receipt` is our payment id. Razorpay orders don't lapse on their own: ours do after
    // 30 minutes (the poller), and money landing on one after that is late money (settle).
    // Captured on its own as soon as it's authorized (payment_capture 1), so no payment sits authorized but not ours.
    createOrder: (amount: number, receipt: string) => call<{ id: string }>("POST", "/orders", { amount, currency: "INR", receipt, payment_capture: 1 }),
    payment: (paymentId: string) => call<RzPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`),
    orderPayments: async (orderId: string) => (await call<{ items: RzPayment[] }>("GET", `/orders/${encodeURIComponent(orderId)}/payments`)).items,
    // `receipt` is our refund id: refundsOf finds it again, so a retry never sends twice.
    refund: (paymentId: string, amount: number, receipt: string) =>
      call<RzRefund>("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, { amount, speed: "normal", receipt, notes: { refund_id: receipt } }),
    refundsOf: async (paymentId: string) => (await call<{ items: RzRefund[] }>("GET", `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`)).items,
    // Checkout's answer: HMAC of "order_id|payment_id" with the key secret.
    paymentSigned: (orderId: string, paymentId: string, signature: string) => signed(cfg.keySecret, `${orderId}|${paymentId}`, signature),
    // A webhook: HMAC of the raw body with the webhook secret.
    webhookSigned: (body: string, signature: string) => signed(cfg.webhookSecret, body, signature),
  };
}
export type Razorpay = ReturnType<typeof razorpay>;
