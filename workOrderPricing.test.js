import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateWorkOrderNetTotal,
  calculateWorkOrderPriceBreakdown,
  calculateWorkOrderPartsSubtotal,
  normalizeLaborAmount,
  normalizeDiscount,
  calculateDiscountAmount,
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
    partsGross: 551,
    partsDiscountTotal: 0,
    partsSubtotal: 551,
    laborAmount: 99.99,
    laborDiscountType: "none",
    laborDiscountValue: 0,
    laborDiscountAmount: 0,
    laborNet: 99.99,
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
    partsGross: 551,
    partsDiscountTotal: 0,
    partsSubtotal: 551,
    laborAmount: 99.99,
    laborDiscountType: "none",
    laborDiscountValue: 0,
    laborDiscountAmount: 0,
    laborNet: 99.99,
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

test("normalizes missing/none discount input to a zero discount", () => {
  assert.deepEqual(normalizeDiscount(undefined), { type: "none", value: 0 });
  assert.deepEqual(normalizeDiscount(null), { type: "none", value: 0 });
  assert.deepEqual(normalizeDiscount({ type: "none", value: 25 }), { type: "none", value: 0 });
});

test("rejects an out-of-range percent discount and a negative amount discount", () => {
  assert.throws(() => normalizeDiscount({ type: "percent", value: 150 }), /yüzdesi/);
  assert.throws(() => normalizeDiscount({ type: "percent", value: -1 }), /yüzdesi/);
  assert.throws(() => normalizeDiscount({ type: "amount", value: -5 }), /İskonto tutarı/);
  assert.throws(() => normalizeDiscount({ type: "weird", value: 5 }), /türü geçersiz/);
});

test("rejects a fixed-amount discount larger than the base it is applied to", () => {
  assert.throws(() => calculateDiscountAmount(100, { type: "amount", value: 150 }), /büyük olamaz/);
});

test("applies a per-line percent and fixed-amount discount to parts before summing", () => {
  const discounted = [
    { partId: "filter", qty: 2, price: 125.5, discountType: "percent", discountValue: 10 }, // 251 gross, -25.1 → 225.9 net
    { partId: "oil", qty: 1, price: 300, discountType: "amount", discountValue: 30 },        // 300 gross, -30 → 270 net
  ];
  assert.equal(calculateWorkOrderPartsSubtotal(discounted), 495.9);
  assert.deepEqual(calculateWorkOrderPriceBreakdown(discounted, 100), {
    partsGross: 551,
    partsDiscountTotal: 55.1,
    partsSubtotal: 495.9,
    laborAmount: 100,
    laborDiscountType: "none",
    laborDiscountValue: 0,
    laborDiscountAmount: 0,
    laborNet: 100,
    externalLaborSubtotal: 0,
    externalLaborCost: 0,
    externalLaborProfit: 0,
    subtotal: 595.9,
    vat: 119.18,
    total: 715.08,
  });
});

test("rejects a part-line discount larger than that line's own total", () => {
  const overDiscounted = [{ partId: "filter", qty: 1, price: 100, discountType: "amount", discountValue: 150 }];
  assert.throws(() => calculateWorkOrderPartsSubtotal(overDiscounted), /büyük olamaz/);
});

test("applies a discount to labor before VAT, independently of parts", () => {
  assert.deepEqual(calculateWorkOrderPriceBreakdown(parts, 100, [], { type: "percent", value: 20 }), {
    partsGross: 551,
    partsDiscountTotal: 0,
    partsSubtotal: 551,
    laborAmount: 100,
    laborDiscountType: "percent",
    laborDiscountValue: 20,
    laborDiscountAmount: 20,
    laborNet: 80,
    externalLaborSubtotal: 0,
    externalLaborCost: 0,
    externalLaborProfit: 0,
    subtotal: 631,
    vat: 126.2,
    total: 757.2,
  });
  assert.equal(calculateWorkOrderNetTotal(parts, 100, [], { type: "percent", value: 20 }), 631);
});
