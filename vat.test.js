import test from "node:test";
import assert from "node:assert/strict";
import { calculateVat, vatIncludedAmount } from "./vat.js";

test("adds 20 percent VAT to net values and rounds to kuruş", () => {
  assert.deepEqual(calculateVat(100), { subtotal: 100, vat: 20, total: 120 });
  assert.deepEqual(calculateVat(99.99), { subtotal: 99.99, vat: 20, total: 119.99 });
});

test("handles zero and rejects invalid amounts", () => {
  assert.deepEqual(calculateVat(0), { subtotal: 0, vat: 0, total: 0 });
  assert.throws(() => vatIncludedAmount(Number.NaN), /geçerli/);
});
