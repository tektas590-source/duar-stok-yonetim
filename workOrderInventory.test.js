import test from "node:test";
import assert from "node:assert/strict";
import { aggregateWorkOrderQuantities, calculateWorkOrderQuantityDeltas, calculateWorkOrderReversal } from "./workOrderInventory.js";

test("aggregates duplicate part lines and computes stock deltas", () => {
  const result = calculateWorkOrderQuantityDeltas(
    [{ partId: "part-a", qty: 2 }, { partId: "part-a", qty: 1 }, { partId: "part-b", qty: 2 }],
    [{ partId: "part-a", qty: 4 }, { partId: "part-c", qty: 1 }],
  );
  assert.deepEqual(result, [
    { partId: "part-a", previousQty: 3, nextQty: 4, delta: 1 },
    { partId: "part-b", previousQty: 2, nextQty: 0, delta: -2 },
    { partId: "part-c", previousQty: 0, nextQty: 1, delta: 1 },
  ]);
});

test("returns cancelled work-order stock and sales counters", () => {
  assert.deepEqual(calculateWorkOrderReversal({ stock: 4, sold: 9 }, 3), {
    stockBefore: 4,
    stockAfter: 7,
    soldAfter: 6,
  });
  assert.deepEqual(calculateWorkOrderReversal({ stock: 2, sold: 1 }, 3), {
    stockBefore: 2,
    stockAfter: 5,
    soldAfter: 0,
  });
});

test("rejects invalid part quantities", () => {
  assert.throws(() => aggregateWorkOrderQuantities([{ partId: "part-a", qty: 0 }]), /pozitif adet/i);
  assert.throws(() => aggregateWorkOrderQuantities([{ partId: "", qty: 1 }]), /stok kodu/i);
});
