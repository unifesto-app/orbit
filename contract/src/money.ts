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
