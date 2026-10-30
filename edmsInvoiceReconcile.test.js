import test from "node:test";
import assert from "node:assert/strict";
import {
  selectEdmsJobsInScope,
  matchSalesInvoicesToJobs,
  buildJobEnrichmentPatch,
  buildEdmsJobEnrichments,
  selectPurchaseInvoicesToImport,
  buildPurchaseInvoicePayload,
} from "./edmsInvoiceReconcile.js";
import { WORK_ORDER_STATUS } from "./workOrderLifecycle.js";

function job(overrides) {
  return {
    id: "job1",
    source: "eDMS",
    externalId: "917001",
    plate: "34 EMH 581",
    vin: "NM0EXXTTREMG61162",
    date: "2026-09-18",
    status: WORK_ORDER_STATUS.COMPLETED,
    items: [],
    code: "EDMS-917001",
    ...overrides,
  };
}

function saleInvoice(overrides) {
  return {
    invoiceNo: "5001000013",
    date: "2026-09-18",
    firma: "DEMİR İNŞ. MİMARLIK AKARYAKIT OTOMOTİV SAN. VE TİC.LDT.ŞTİ.",
    vin: "NM0EXXTTREMG61162",
    plate: "34EMH581",
    externalId: "917001",
    tip: { isSale: true, isPurchase: false, isReturn: false },
    kaynak: "Servis",
    items: [
      { kind: "Hizmet", kod: "KAPORTA", name: "KAPORTA İŞÇİLİĞİ", unitPrice: 2000, qty: 1, discountPercent: 0, vatPercent: 20, lineTotal: 2000, discountAmount: 0, vatAmount: 400, grossTotal: 2400 },
      { kind: "Stok", kod: "BK31 V254A16 AG5CND N", name: "SURGULU KAPI BANDI SAG", unitPrice: 6200, qty: 1, discountPercent: 0, vatPercent: 20, lineTotal: 6200, discountAmount: 0, vatAmount: 1240, grossTotal: 7440 },
    ],
    totalGross: 9840,
    ...overrides,
  };
}

test("selectEdmsJobsInScope: keeps closed eDMS jobs regardless of date", () => {
  const jobs = [job({ status: WORK_ORDER_STATUS.COMPLETED, date: "2026-01-05" })];
  assert.equal(selectEdmsJobsInScope(jobs).length, 1);
});

test("selectEdmsJobsInScope: keeps open eDMS jobs only after the cutoff", () => {
  const early = job({ status: WORK_ORDER_STATUS.IN_PROGRESS, date: "2026-09-15" });
  const late = job({ id: "job2", status: WORK_ORDER_STATUS.IN_PROGRESS, date: "2026-10-05" });
  const result = selectEdmsJobsInScope([early, late]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "job2");
});

test("selectEdmsJobsInScope: ignores non-eDMS and already-enriched jobs", () => {
  const manual = job({ id: "manual1", source: undefined });
  const alreadyDone = job({ id: "job3", items: [{ partId: "p1", qty: 1 }] });
  assert.equal(selectEdmsJobsInScope([manual, alreadyDone]).length, 0);
});

test("matchSalesInvoicesToJobs: matches by externalId first", () => {
  const jobs = [job()];
  const invoices = [saleInvoice()];
  const { matches, unmatchedInvoices } = matchSalesInvoicesToJobs(jobs, invoices);
  assert.equal(matches.get("job1").invoiceNo, "5001000013");
  assert.equal(unmatchedInvoices.length, 0);
});

test("matchSalesInvoicesToJobs: falls back to plate+nearest date when externalId is missing", () => {
  const theJob = job({ externalId: null });
  const invoice = saleInvoice({ externalId: null, date: "2026-09-16" }); // 2 gün önce
  const farInvoice = saleInvoice({ invoiceNo: "far", externalId: null, date: "2026-01-01" });
  const { matches } = matchSalesInvoicesToJobs([theJob], [invoice, farInvoice]);
  assert.equal(matches.get("job1").invoiceNo, "5001000013");
});

test("matchSalesInvoicesToJobs: flags ambiguous same-externalId collisions instead of guessing", () => {
  const theJob = job();
  const invoiceA = saleInvoice({ invoiceNo: "A" });
  const invoiceB = saleInvoice({ invoiceNo: "B" });
  const { matches, ambiguous } = matchSalesInvoicesToJobs([theJob], [invoiceA, invoiceB]);
  assert.equal(matches.size, 0);
  assert.equal(ambiguous.length, 1);
});

test("buildJobEnrichmentPatch: builds items + labor and totals reconcile with the invoice", () => {
  const parts = [{ id: "part-1", sku: "BK31 V254A16 AG5CND N", name: "SURGULU KAPI BANDI SAG", category: "Kaporta", brand: "OEM" }];
  const { patch, newParts, warnings, reconciled } = buildJobEnrichmentPatch(job(), saleInvoice(), parts);
  assert.equal(patch.items.length, 1);
  assert.equal(patch.items[0].partId, "part-1");
  assert.equal(patch.laborAmount, 2000);
  assert.equal(patch.total, 8200); // KDV hariç: 2000 işçilik + 6200 parça
  assert.equal(reconciled, true);
  assert.equal(newParts.length, 0);
  assert.equal(warnings.length, 0);
});

test("buildJobEnrichmentPatch: proposes a new 0-stock part card when the SKU is unknown", () => {
  const { patch, newParts, warnings } = buildJobEnrichmentPatch(job(), saleInvoice(), []);
  assert.equal(newParts.length, 1);
  assert.equal(newParts[0].stock, 0);
  assert.equal(patch.items[0].partId, newParts[0].id);
  assert.equal(warnings.length, 1);
});

test("buildJobEnrichmentPatch: a discounted Stok line nets correctly into items and total", () => {
  const invoice = saleInvoice({
    items: [
      { kind: "Stok", kod: "LTR1610725580OEM", name: "FREN HIDROLIK YAĞI", unitPrice: 291.67, qty: 10, discountPercent: 20, vatPercent: 20, lineTotal: 2916.7, discountAmount: 583.34, vatAmount: 466.67, grossTotal: 2800.03 },
    ],
    totalGross: 2800.03,
  });
  const { patch, reconciled } = buildJobEnrichmentPatch(job(), invoice, []);
  assert.equal(patch.items[0].discountType, "percent");
  assert.equal(patch.items[0].discountValue, 20);
  assert.equal(patch.laborAmount, 0);
  assert.ok(Math.abs(patch.total - 2333.36) < 0.1); // KDV hariç: 2916.7 - %20 iskonto
  assert.equal(reconciled, true);
});

test("buildEdmsJobEnrichments: end to end, skips out-of-scope and unmatched jobs", () => {
  const inScopeJob = job();
  const outOfScopeJob = job({ id: "open-old", status: WORK_ORDER_STATUS.IN_PROGRESS, date: "2026-08-01" });
  const noMatchJob = job({ id: "nomatch", externalId: "999999", plate: "99 ZZ 99" });
  const result = buildEdmsJobEnrichments([inScopeJob, outOfScopeJob, noMatchJob], [saleInvoice()], []);
  assert.equal(result.enrichments.length, 1);
  assert.equal(result.enrichments[0].jobId, "job1");
  assert.equal(result.skippedJobs.length, 1);
  assert.equal(result.skippedJobs[0].id, "nomatch");
});

test("selectPurchaseInvoicesToImport: dedupes by invoice code already in Firestore", () => {
  const purchaseInvoices = [{ invoiceNo: "DM22026000006913" }, { invoiceNo: "NEW-001" }];
  const { toAdd, alreadyPresent } = selectPurchaseInvoicesToImport(purchaseInvoices, [{ code: "DM22026000006913" }]);
  assert.equal(toAdd.length, 1);
  assert.equal(toAdd[0].invoiceNo, "NEW-001");
  assert.equal(alreadyPresent.length, 1);
});

test("buildPurchaseInvoicePayload: maps a discounted Stok line to createPurchaseInvoice's shape and updates stock via cost", () => {
  const invoice = {
    invoiceNo: "DM22026000006913",
    firma: "DEMPAR İNŞAAT OTOMOTİV YEDEK PARÇA SANAYİ TİCARET LİMİTED ŞİTKETİ",
    date: "2026-10-23",
    items: [
      { kind: "Stok", kod: "LTR1610725580OEM", name: "FREN HIDROLIK YAĞI DOT4 500 ML", unitPrice: 291.67, qty: 10, discountPercent: 20, vatPercent: 20, lineTotal: 2916.7, discountAmount: 583.34, vatAmount: 466.67, grossTotal: 2800.03 },
    ],
  };
  const { payload, warnings } = buildPurchaseInvoicePayload(invoice, []);
  assert.equal(payload.invoiceNumber, "DM22026000006913");
  assert.equal(payload.supplier, invoice.firma);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].qty, 10);
  assert.ok(Math.abs(payload.items[0].cost - 233.336) < 0.01); // (2916.7-583.34)/10
  assert.equal(payload.items[0].price, payload.items[0].cost); // yeni kart: fiyat gözden geçirilmeli
  assert.equal(warnings.length, 1);
});

test("buildPurchaseInvoicePayload: skips Hizmet lines (purchase invoices only carry stock)", () => {
  const invoice = {
    invoiceNo: "X",
    firma: "Tedarikçi",
    date: "2026-10-23",
    items: [{ kind: "Hizmet", kod: "H1", name: "Nakliye", unitPrice: 100, qty: 1, discountPercent: 0, grossTotal: 120 }],
  };
  const { payload, warnings } = buildPurchaseInvoicePayload(invoice, []);
  assert.equal(payload.items.length, 0);
  assert.equal(warnings.length, 1);
});
