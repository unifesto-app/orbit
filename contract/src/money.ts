import { z } from "zod";
import type { BookingStatus } from "./bookings.ts";
import { FeePlan } from "./hosts.ts";

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

// The two fee plans (`FeePlan`, hosts.ts) in basis points: what the buyer pays on top, and the commission from the host.
const FEE_BPS: Record<FeePlan, { buyerBps: number; hostBps: number }> = { "3+2": { buyerBps: 300, hostBps: 200 }, "5+0": { buyerBps: 500, hostBps: 0 } };

// n / d rounded half up, for whole non-negative paise: integers only, so no float drift.
const halfUp = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));

// One sale's frozen terms, in whole paise. Per seat: the buyer fee is p × b on top, or p × b ÷ (1 + b) carved out of p
// when the host includes it; the commission is h on what's left after an included fee. Each rounds half up per seat,
// then sums over the seats. The buyer pays the price, plus the fee when it's on top.
export function feeTerms(unitPaise: number, quantity: number, plan: FeePlan, included: boolean) {
  const { buyerBps, hostBps } = FEE_BPS[plan];
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
// "confirming": Razorpay hasn't captured it yet (or couldn't be asked); the webhook or the poller settles it.
// `reason`, when it went back with no seat: seatCheck's code (fewLeft is sold out; cancelled, ended, closed, tooMany, booked…).
// "pending" (GET /payments/:orderId only): Razorpay has the attempt open, not paid, not failed (a UPI request unanswered).
export type Verified = { status: PaymentStatus | "confirming" | "pending"; bookingId: string | null; reason?: string };

// Galaxy's Money pages (staff with Money).
export const REFUND_STATUSES = ["requested", "sent", "processed", "failed"] as const;
export const StaffRefund = z.object({ amountPaise: z.number().int().min(1), reason: z.string().trim().min(3).max(500) });
// An event's payout (`eventId`), or a Venue's slot money (`hostId`), never both.
export const NewPayout = z
  .object({ eventId: z.uuid().optional(), hostId: z.uuid().optional(), amountPaise: z.number().int().min(1), reason: z.string().trim().min(3).max(500) })
  .refine((b) => !b.eventId !== !b.hostId);
export const PayoutPaid = z.object({ utr: z.string().trim().regex(/^[A-Za-z0-9]{6,40}$/), reason: z.string().trim().max(500).optional() });
export const MoneyReason = z.object({ reason: z.string().trim().min(3).max(500) });
export const SetFees = z.object({ plan: FeePlan, feeIncluded: z.boolean(), reason: z.string().trim().min(3).max(500) });

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
export type PayoutStatus = "requested" | "paid" | "cancelled";
// `eventId` null: a Venue's slot money. `fromHost`: a host Admin asked (Event Partner, Play Partner), else staff.
export type PayoutRow = {
  id: string; hostId: string; hostName: string; eventId: string | null; eventTitle: string | null; amountPaise: number;
  status: PayoutStatus; utr: string | null; reason: string | null; fromHost: boolean; askedByName: string | null; byName: string | null;
  createdAt: string; at: string;
};
// One event's money, worked out once on the server: sales, minus commission (less what refunds handed back), minus any
// fee the host included, minus refunded; then paid out and what's left.
export type EventEarnings = {
  eventId: string; eventTitle: string; hostId: string; hostName: string;
  salesPaise: number; commissionPaise: number; includedPaise: number; refundedPaise: number;
  earningsPaise: number; paidOutPaise: number; requestedPaise: number; availablePaise: number;
};
// A Venue's slot money (X4), as EventEarnings, with when it can be asked for: a slot's money 3 days after it ends
// (`waitingPaise` till then, the last of it by `opensAt`), and a host's ask at most once a week (`nextAskAt`, null: now).
// `availablePaise`: ready, less paid out and asked for, never below nothing.
export type VenueEarnings = {
  hostId: string; hostName: string; bookings: number;
  salesPaise: number; commissionPaise: number; includedPaise: number; refundedPaise: number; earningsPaise: number;
  paidOutPaise: number; requestedPaise: number; waitingPaise: number; opensAt: string | null; availablePaise: number; nextAskAt: string | null;
};
// `accounts`: each host's bank account state by host id, so staff see it before marking anything paid; none if not added.
export type Payouts = { payouts: PayoutRow[]; earnings: EventEarnings[]; venues: VenueEarnings[]; accounts: Record<string, "checking" | "verified" | "rejected"> };

// ---------- A host's own money (X4): Event Partner and Play Partner, for the host's Admins ----------

const UPI = /^[\w.-]{2,}@[a-z0-9]{2,}$/i;
const Holder = z.string().trim().min(2).max(100);
// PUT /hosts/:id/payout-account: an account number (9 to 18 digits, spaces dropped) and an IFSC, or a UPI ID (the
// holder then defaults to the host's name). As the host apps' bankFrom checks it.
export const SetPayoutAccount = z.union([
  z.strictObject({
    holder: Holder,
    account: z.string().transform((s) => s.replace(/\s/g, "")).pipe(z.string().regex(/^\d{9,18}$/)),
    ifsc: z.string().transform((s) => s.replace(/\s/g, "").toUpperCase()).pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/)),
  }),
  z.strictObject({ holder: Holder.optional(), upi: z.string().trim().max(100).regex(UPI) }),
]);
// The bank's name from the IFSC's first four letters; "Your bank" for the rest.
const BANKS: Record<string, string> = {
  HDFC: "HDFC Bank", ICIC: "ICICI Bank", SBIN: "State Bank of India", UTIB: "Axis Bank", KKBK: "Kotak Mahindra Bank",
  YESB: "Yes Bank", IDIB: "Indian Bank", PUNB: "Punjab National Bank", BARB: "Bank of Baroda", CNRB: "Canara Bank",
};
export const bankName = (ifsc: string) => BANKS[ifsc.slice(0, 4).toUpperCase()] ?? "Your bank";
export type AccountState = "checking" | "verified" | "rejected";
// As the host apps see it: never the number or the UPI ID. `until`: the 72 hours a check takes, while checking.
// `reason`: why staff rejected it.
export type PayoutAccount = { kind: "bank" | "upi"; bankName: string; last4: string; holder: string; state: AccountState; reason: string | null; until: string | null };
// POST /hosts/:id/payouts: an event's money (`eventId`), or with none a Venue's slot money.
export const AskPayout = z.object({ eventId: z.uuid().optional(), amountPaise: z.number().int().min(1) });
// One event's money with its scheduled end; its payout opens 3 days after (`opensAt`, null with no end set).
export type HostEventMoney = EventEarnings & { endsAt: string | null; opensAt: string | null };
export type HostPayout = {
  id: string; eventId: string | null; eventTitle: string | null; amountPaise: number; status: PayoutStatus;
  utr: string | null; reason: string | null; askedAt: string; at: string;
};
// GET /hosts/:id/money. `venue`: Venue hosts only.
export type HostMoney = {
  plan: FeePlan; feeIncluded: boolean; account: PayoutAccount | null; events: HostEventMoney[]; venue: VenueEarnings | null; payouts: HostPayout[];
};
// Galaxy's Payout accounts: every detail, for holders of Money. `seen` on verify and reject: the account's updatedAt as
// staff saw it, so a replacement since then isn't verified unseen.
export type StaffPayoutAccount = {
  hostId: string; hostName: string; kind: "bank" | "upi"; holder: string; accountNumber: string | null; ifsc: string | null; upi: string | null;
  bankName: string; state: AccountState; reason: string | null; checkedByName: string | null; checkedAt: string | null; updatedAt: string;
};
export const CheckAccount = z.object({ reason: z.string().trim().min(3).max(500), seen: z.iso.datetime() });
export type HostFees = { hosts: { id: string; name: string; plan: FeePlan; feeIncluded: boolean }[]; total: number; page: number; pageSize: number };
export type FailedWebhook = { id: string; receivedAt: string; reason: string; excerpt: string };

// The app's Account › Transactions and Refunds (X3): the signed-in person's own. A payment is listed once money moved
// (a Razorpay payment on it); `refundedPaise` is what has reached them so far.
export type MyPayment = {
  id: string; eventId: string | null; eventTitle: string | null; quantity: number; pricePaise: number; feePaise: number;
  amountPaise: number; status: PaymentStatus; razorpayPaymentId: string; refundedPaise: number; refundedAt: string | null; createdAt: string;
};
export type MyRefund = {
  id: string; eventId: string | null; eventTitle: string | null; amountPaise: number; status: (typeof REFUND_STATUSES)[number]; createdAt: string; updatedAt: string;
};

// Galaxy's Bookings and tickets (X3): a booking with its ticket and the payment that paid for it, if any.
export type StaffBooking = {
  id: string; status: BookingStatus; quantity: number; createdAt: string; cancelledAt: string | null;
  userId: string; userName: string | null; eventId: string; eventTitle: string; hostId: string; hostName: string;
  ticketTypeName: string; pricePaise: number; payment: { id: string; status: PaymentStatus; amountPaise: number } | null;
};
