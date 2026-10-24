import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateWorkOrderNetTotal,
  calculateWorkOrderPriceBreakdown,
  calculateWorkOrderPartsSubtotal,
  normalizeLaborAmount,
} from "./workOrderPricing.js";

const parts = [
  { partId: "filter", qty: 2, price: 125.5 },
  { partId: "oil", qty: 1, price: 300 },
];

test("normalizes missing and blank legacy labor amounts to zero", () => {
  assert.equal(normalizeLaborAmount(undefined), 0);
  assert.equal(normalizeLaborAmount(null), 0);
  assert.equal(normalizeLaborAmount(""), 0);
  assert.equal(normalizeLaborAmount("   "), 0);
  assert.equal(normalizeLaborAmount(0), 0);
});

test("rounds valid labor amounts to kuruş", () => {
  assert.equal(normalizeLaborAmount("18.235"), 18.24);
  assert.equal(normalizeLaborAmount(18.2), 18.2);
});

test("rejects negative and non-finite labor amounts", () => {
  for (const value of [-0.01, Number.NaN, Number.POSITIVE_INFINITY, "not money", true]) {
    assert.throws(() => normalizeLaborAmount(value), /İşçilik tutarı/);
  }
});

test("calculates parts-only, labor-only, and combined net work-order totals", () => {
  assert.equal(calculateWorkOrderPartsSubtotal(parts), 551);
  assert.equal(calculateWorkOrderNetTotal(parts, 0), 551);
  assert.equal(calculateWorkOrderNetTotal([], 99.99), 99.99);
  assert.equal(calculateWorkOrderNetTotal(parts, 99.99), 650.99);
});

test("applies the existing 20 percent VAT once to the combined net amount", () => {
  assert.deepEqual(calculateWorkOrderPriceBreakdown(parts, 99.99), {
    partsSubtotal: 551,
    laborAmount: 99.99,
    externalLaborSubtotal: 0,
    externalLaborCost: 0,
    externalLaborProfit: 0,
    subtotal: 650.99,
    vat: 130.2,
    total: 781.19,
  });
});

test("folds external labor into the subtotal and reports its own profit", () => {
  const externalLabor = [
    { cost: 200, price: 300 },
    { cost: 50, price: 100 },
  ];
  assert.deepEqual(calculateWorkOrderPriceBreakdown(parts, 99.99, externalLabor), {
    partsSubtotal: 551,
    laborAmount: 99.99,
    externalLaborSubtotal: 400,
    externalLaborCost: 250,
    externalLaborProfit: 150,
    subtotal: 1050.99,
    vat: 210.2,
    total: 1261.19,
  });
  assert.equal(calculateWorkOrderNetTotal(parts, 99.99, externalLabor), 1050.99);
});

test("rejects invalid part lines rather than persisting an inaccurate net total", () => {
  assert.throws(() => calculateWorkOrderNetTotal([{ qty: 0, price: 10 }], 0), /parça miktarı/);
  assert.throws(() => calculateWorkOrderPartsSubtotal(null), /parça listesi/);
});
