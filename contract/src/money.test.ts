import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPrice } from "./money.ts";

test("formatPrice", () => {
  assert.equal(formatPrice(0), "Free");
  assert.equal(formatPrice(49900), "₹499");
  assert.equal(formatPrice(149900), "₹1,499");
  assert.equal(formatPrice(4950), "₹49.50");
  assert.equal(formatPrice(5), "₹0.05");
});
