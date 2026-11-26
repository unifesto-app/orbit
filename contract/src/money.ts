import { z } from "zod";

// Amounts are whole paise everywhere (plan, section 7). 0 means a free event.
const rupees = (fraction: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: fraction, minimumFractionDigits: fraction });
const whole = rupees(0);
const withPaise = rupees(2);

// "Free", "₹499", "₹1,499" or "₹49.50": paise show only when there are some.
export function formatPrice(paise: number): string {
  if (paise === 0) return "Free";
  return (paise % 100 ? withPaise : whole).format(paise / 100);
}

// ---------- Paying (Money flow; X2): fee plans, the fee maths, and the shapes the API, the apps and Galaxy share ----------

// The two fee plans in basis points (owner, 25 Nov 2026): what the buyer pays on top, and the commission from the host.
export const FEE_PLANS = { "3+2": { buyerBps: 300, hostBps: 200 }, "5+0": { buyerBps: 500, hostBps: 0 } } as const;
export type FeePlan = keyof typeof FEE_PLANS;
export const isFeePlan = (s: unknown): s is FeePlan => typeof s === "string" && Object.hasOwn(FEE_PLANS, s);

// n / d rounded half up, for whole non-negative paise: integers only, so no float drift.
const halfUp = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));

// One sale's frozen terms, in whole paise. Per seat: the buyer fee is p × b on top, or p × b ÷ (1 + b) carved out of p
// when the host includes it; the commission is h on what's left after an included fee. Each rounds half up per seat,
// then sums over the seats. The buyer pays the price, plus the fee when it's on top.
export function feeTerms(unitPaise: number, quantity: number, plan: FeePlan, included: boolean) {
  const { buyerBps, hostBps } = FEE_PLANS[plan];
  const fee = included ? halfUp(unitPaise * buyerBps, 10_000 + buyerBps) : halfUp(unitPaise * buyerBps, 10_000);
  const commission = halfUp((included ? unitPaise - fee : unitPaise) * hostBps, 10_000);
  const pricePaise = unitPaise * quantity;
  return {
    plan, feeIncluded: included, unitPricePaise: unitPaise, quantity, pricePaise,
    buyerFeeBps: buyerBps, buyerFeePaise: fee * quantity,
    commissionBps: hostBps, commissionPaise: commission * quantity,
    amountPaise: pricePaise + (included ? 0 : fee * quantity),
  };
}
export type FeeTerms = ReturnType<typeof feeTerms>;

// POST /events/:id/pay: as a booking. Answers PayOrder.
export const PayRequest = z.object({ ticketTypeId: z.uuid(), quantity: z.number().int().min(1).max(10) });
// What the app hands Razorpay's checkout, and the lines it shows. `feePaise` is the fee on top (0 when included).
export type PayOrder = {
  orderId: string;
  amountPaise: number;
  keyId: string;
  already: boolean; // true: "You're already paying for this ticket" (the same order again)
  breakdown: { pricePaise: number; feePaise: number; feeIncluded: boolean; amountPaise: number };
};
// POST /payments/:orderId/verify, with what Razorpay's checkout answered.
export const VerifyPayment = z.object({ paymentId: z.string().min(1).max(64), signature: z.string().min(1).max(256) });
export const PAYMENT_STATUSES = ["created", "paid", "refundPending", "refunded", "expired", "failed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type Verified = { status: PaymentStatus; bookingId: string | null };

// Galaxy's Money pages (staff with Money).
export const REFUND_STATUSES = ["requested", "sent", "processed", "failed"] as const;
export const StaffRefund = z.object({ amountPaise: z.number().int().min(1), reason: z.string().trim().min(3).max(500) });
export const NewPayout = z.object({ eventId: z.uuid(), amountPaise: z.number().int().min(1), reason: z.string().trim().min(3).max(500) });
export const PayoutPaid = z.object({ utr: z.string().trim().regex(/^[A-Za-z0-9]{6,40}$/), reason: z.string().trim().max(500).optional() });
export const MoneyReason = z.object({ reason: z.string().trim().min(3).max(500) });
export const SetFees = z.object({ plan: z.enum(["3+2", "5+0"]), feeIncluded: z.boolean(), reason: z.string().trim().min(3).max(500) });

export type PaymentRow = {
  id: string; kind: "ticket" | "slot"; status: PaymentStatus; userId: string; userName: string | null;
  hostId: string; hostName: string; eventId: string | null; eventTitle: string | null; ticketTypeId: string | null;
  quantity: number; unitPricePaise: number; plan: FeePlan; buyerFeeBps: number; buyerFeePaise: number;
  commissionBps: number; commissionPaise: number; feeIncluded: boolean; gstFeePaise: number; gstCommissionPaise: number;
  amountPaise: number; merchant: string; razorpayOrderId: string; razorpayPaymentId: string | null;
  razorpayFeePaise: number | null; razorpayTaxPaise: number | null; bookingId: string | null; createdAt: string; updatedAt: string;
};
export type RefundRow = {
  id: string; paymentId: string; razorpayPaymentId: string | null; amountPaise: number; reason: string;
  kind: "auto" | "staff" | "request"; status: (typeof REFUND_STATUSES)[number]; razorpayRefundId: string | null;
  attempts: number; nextAttemptAt: string | null; byName: string | null; createdAt: string; updatedAt: string;
};
export type PaymentList = { payments: PaymentRow[]; total: number; page: number; pageSize: number };
export type PaymentDetail = { payment: PaymentRow; refunds: RefundRow[]; refundablePaise: number };
export type RefundQueue = { open: RefundRow[]; failed: RefundRow[] };
export type PayoutRow = {
  id: string; hostId: string; hostName: string; eventId: string; eventTitle: string; amountPaise: number;
  status: "requested" | "paid" | "cancelled"; utr: string | null; reason: string | null; byName: string | null; at: string;
};
// One event's money, worked out once on the server: sales, minus commission (less what refunds handed back), minus any
// fee the host included, minus refunded; then paid out and what's left.
export type EventEarnings = {
  eventId: string; eventTitle: string; hostId: string; hostName: string;
  salesPaise: number; commissionPaise: number; includedPaise: number; refundedPaise: number;
  earningsPaise: number; paidOutPaise: number; requestedPaise: number; availablePaise: number;
};
export type Payouts = { payouts: PayoutRow[]; earnings: EventEarnings[] };
export type HostFees = { hosts: { id: string; name: string; plan: FeePlan; feeIncluded: boolean }[]; total: number; page: number; pageSize: number };
export type FailedWebhook = { id: string; receivedAt: string; reason: string; excerpt: string };
