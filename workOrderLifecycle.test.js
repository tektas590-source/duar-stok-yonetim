import test from "node:test";
import assert from "node:assert/strict";
import {
  computePartSalesFromJobs,
  getOpenWorkOrders,
  getRevenueEligibleWorkOrders,
  getWorkOrderStatusClass,
  WORK_ORDER_STATUS,
} from "./workOrderLifecycle.js";

const jobs = [
  { id: "open", status: WORK_ORDER_STATUS.IN_PROGRESS },
  { id: "done", status: WORK_ORDER_STATUS.COMPLETED },
  { id: "cancelled", status: WORK_ORDER_STATUS.CANCELLED },
];

test("completed work orders remain in revenue while cancelled ones are excluded", () => {
  assert.deepEqual(getRevenueEligibleWorkOrders(jobs).map((job) => job.id), ["open", "done"]);
});

test("open work-order totals exclude completed and cancelled records", () => {
  assert.deepEqual(getOpenWorkOrders(jobs).map((job) => job.id), ["open"]);
});

test("maps each lifecycle status to a distinct badge style", () => {
  assert.equal(getWorkOrderStatusClass(WORK_ORDER_STATUS.IN_PROGRESS), "status-progress");
  assert.equal(getWorkOrderStatusClass(WORK_ORDER_STATUS.COMPLETED), "status-done");
  assert.equal(getWorkOrderStatusClass(WORK_ORDER_STATUS.CANCELLED), "status-cancelled");
});

test("computePartSalesFromJobs recomputes usage from job items instead of trusting the stored part.sold counter", () => {
  // Gerçek senaryo: bir parçanın `sold` alanı (ör. "Geriye Dönük Stok
  // Düzeltmesi" gibi sadece stoğu düzelten bir yol yüzünden) 0'da kalmış
  // olsa bile, iş emirlerinde gerçekten kullanılmışsa doğru adet
  // hesaplanmalı; iptal edilen iş emirleri ise sayılmamalı.
  const parts = [
    { id: "oil-filter", name: "Yağ filtresi", sold: 0 },
    { id: "brake-pad", name: "Fren balatası", sold: 999 }, // stored sayaç bilerek yanlış/eski
    { id: "unused", name: "Hiç kullanılmamış parça", sold: 0 },
  ];
  const jobs = [
    { id: "j1", status: WORK_ORDER_STATUS.COMPLETED, items: [{ partId: "oil-filter", qty: 2 }, { partId: "brake-pad", qty: 1 }] },
    { id: "j2", status: WORK_ORDER_STATUS.IN_PROGRESS, items: [{ partId: "oil-filter", qty: 1 }] },
    { id: "j3", status: WORK_ORDER_STATUS.CANCELLED, items: [{ partId: "oil-filter", qty: 50 }] },
  ];
  const result = computePartSalesFromJobs(jobs, parts);
  const byId = Object.fromEntries(result.map((part) => [part.id, part.sold]));
  assert.deepEqual(byId, { "oil-filter": 3, "brake-pad": 1, unused: 0 });
});
