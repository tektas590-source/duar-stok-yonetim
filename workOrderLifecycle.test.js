import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlannedEdmsJobStockRestorationUndo,
  buildWorkOrderStockPolicyMigration,
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

test("buildWorkOrderStockPolicyMigration restores stock for open jobs and flags already-completed ones", () => {
  // Gerçek senaryo: stok artık bir iş emri "Tamamlandı" olduğunda düşülüyor,
  // "Devam ediyor" haldeyken parça girişinde değil. Bu değişiklikten önce
  // oluşturulmuş açık iş emirlerinin parçaları eski davranışla zaten
  // düşülmüştü; bunların stoğu geri yatırılmalı. Zaten tamamlanmış iş
  // emirlerinin stoğu doğru düşülmüş olduğundan sadece bayraklanmalı
  // (stok değişmemeli). `stockApplied` zaten set edilmiş kayıtlar atlanır.
  const parts = [
    { id: "oil-filter", name: "Yağ filtresi", sku: "OF-1", stock: 10, sold: 5 },
    { id: "brake-pad", name: "Fren balatası", sku: "BP-2", stock: 4, sold: 2 },
  ];
  const jobs = [
    { id: "open-legacy", code: "IS-1", status: WORK_ORDER_STATUS.IN_PROGRESS, items: [{ partId: "oil-filter", qty: 2 }] },
    { id: "open-already-migrated", code: "IS-2", status: WORK_ORDER_STATUS.IN_PROGRESS, stockApplied: false, items: [{ partId: "oil-filter", qty: 1 }] },
    { id: "open-new-policy", code: "IS-3", status: WORK_ORDER_STATUS.IN_PROGRESS, stockApplied: false, items: [{ partId: "brake-pad", qty: 1 }] },
    { id: "done-legacy", code: "IS-4", status: WORK_ORDER_STATUS.COMPLETED, items: [{ partId: "brake-pad", qty: 1 }] },
    { id: "done-already-flagged", code: "IS-5", status: WORK_ORDER_STATUS.COMPLETED, stockApplied: true, items: [{ partId: "brake-pad", qty: 1 }] },
    { id: "cancelled", code: "IS-6", status: WORK_ORDER_STATUS.CANCELLED, items: [{ partId: "oil-filter", qty: 50 }] },
    // eDMS'in "Planlanan" ekranından elle aktarılmış, henüz faturalanmamış
    // bir iş emri (missingOctoberJobs.js): tasarım gereği hiç stok
    // düşülmeden oluşturulur, bu yüzden restoreTargets'a dahil EDİLMEMELİ
    // (aksi halde stoğa hayalet bir miktar eklenir).
    { id: "planned-edms", code: "EDMS-123", status: WORK_ORDER_STATUS.IN_PROGRESS, plannedFromEdmsAt: "2026-10-20T00:00:00.000Z", items: [{ partId: "oil-filter", qty: 7 }] },
  ];
  const result = buildWorkOrderStockPolicyMigration(jobs, parts);
  assert.deepEqual(result.restoreJobIds, ["open-legacy"]);
  assert.deepEqual(result.flagJobIds, ["done-legacy"]);
  assert.equal(result.corrections.length, 1);
  assert.deepEqual(result.corrections[0], {
    partId: "oil-filter",
    sku: "OF-1",
    name: "Yağ filtresi",
    qty: 2,
    stockBefore: 10,
    stockAfter: 12,
    soldBefore: 5,
    soldAfter: 3,
    jobCodes: ["IS-1"],
  });
});

test("buildPlannedEdmsJobStockRestorationUndo reverses the erroneous restoration applied to plannedFromEdmsAt jobs", () => {
  // Gerçek hata: migrateWorkOrderStockPolicy'nin ilk sürümü, eDMS'in
  // "Planlanan" ekranından elle aktarılmış (plannedFromEdmsAt) ve tasarım
  // gereği hiç stok düşülmeden oluşturulmuş iş emirlerini de "eski
  // davranışla stoğu düşülmüş" sayıp parçalarını stoğa geri yatırmıştı —
  // bu da stoğa hayalet bir miktar ekledi. Bu fonksiyon o hatayı geri alır.
  const parts = [{ id: "oil-filter", name: "Yağ filtresi", sku: "OF-1", stock: 12, sold: 3 }];
  const jobs = [
    { id: "planned-edms", code: "EDMS-123", status: WORK_ORDER_STATUS.IN_PROGRESS, plannedFromEdmsAt: "2026-10-20T00:00:00.000Z", stockApplied: false, items: [{ partId: "oil-filter", qty: 7 }] },
    // Zaten düzeltilmiş bir kayıt tekrar işlenmemeli.
    { id: "planned-edms-fixed", code: "EDMS-456", status: WORK_ORDER_STATUS.IN_PROGRESS, plannedFromEdmsAt: "2026-10-20T00:00:00.000Z", stockApplied: false, stockRestorationCorrectedAt: "2026-10-31T00:00:00.000Z", items: [{ partId: "oil-filter", qty: 3 }] },
    // Hiç bu geçişten etkilenmemiş (stockApplied set edilmemiş) bir planlanan kayıt da hariç tutulmalı.
    { id: "planned-edms-untouched", code: "EDMS-789", status: WORK_ORDER_STATUS.IN_PROGRESS, plannedFromEdmsAt: "2026-10-20T00:00:00.000Z", items: [{ partId: "oil-filter", qty: 1 }] },
  ];
  const result = buildPlannedEdmsJobStockRestorationUndo(jobs, parts);
  assert.deepEqual(result.jobIds, ["planned-edms"]);
  assert.equal(result.corrections.length, 1);
  assert.deepEqual(result.corrections[0], {
    partId: "oil-filter",
    sku: "OF-1",
    name: "Yağ filtresi",
    qty: 7,
    stockBefore: 12,
    stockAfter: 5,
    soldBefore: 3,
    soldAfter: 10,
    jobCodes: ["EDMS-123"],
  });
});
