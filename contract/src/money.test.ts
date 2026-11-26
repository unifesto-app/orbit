import { test } from "node:test";
import assert from "node:assert/strict";
import { feeTerms, formatPrice } from "./money.ts";

test("formatPrice", () => {
  assert.equal(formatPrice(0), "Free");
  assert.equal(formatPrice(49900), "₹499");
  assert.equal(formatPrice(149900), "₹1,499");
  assert.equal(formatPrice(4950), "₹49.50");
  assert.equal(formatPrice(5), "₹0.05");
});

test("feeTerms: 3+2 and 5+0, on top and included, rounding half up per seat", () => {
  // ₹1,200 on top: 3% fee ₹36, 2% commission ₹24, buyer pays ₹1,236. 5+0: fee ₹60, no commission.
  const a = feeTerms(120000, 1, "3+2", false);
  assert.deepEqual([a.buyerFeePaise, a.commissionPaise, a.amountPaise], [3600, 2400, 123600]);
  const b = feeTerms(120000, 1, "5+0", false);
  assert.deepEqual([b.buyerFeePaise, b.commissionPaise, b.amountPaise], [6000, 0, 126000]);
  // Included: fee = 1200 × 0.03 / 1.03 = ₹34.951… → 3495; commission 2% of 116505 = 2330.1 → 2330; buyer pays the price.
  const c = feeTerms(120000, 1, "3+2", true);
  assert.deepEqual([c.buyerFeePaise, c.commissionPaise, c.amountPaise], [3495, 2330, 120000]);
  // 5+0 included: 120000 × 5/105 = 5714.28 → 5714 (Orbit keeps ₹57.14, as host/src/money.ts says).
  assert.equal(feeTerms(120000, 1, "5+0", true).buyerFeePaise, 5714);
  // Half up: ₹0.50 × 3% = 1.5 paise → 2 per seat, × 3 seats = 6 (not round(4.5) = 5 on the total).
  const d = feeTerms(50, 3, "3+2", false);
  assert.deepEqual([d.buyerFeePaise, d.commissionPaise, d.pricePaise, d.amountPaise], [6, 3, 150, 156]);
  // Float drift: 0.29 × 300 bps would be 0.87 in floats; integers give the exact 87/100 → 1 paisa.
  assert.equal(feeTerms(29, 1, "3+2", false).buyerFeePaise, 1);
});
