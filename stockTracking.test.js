import test from "node:test";
import assert from "node:assert/strict";
import { parseFaturaRaporuReport, splitFaturaRaporuByType } from "./faturaRaporuImport.js";
import {
  stockLevel, summarizeStock, classifyAbc, consumptionStats, stockHistorySeries, filterAndSortParts,
  analyzeEdmsPurchaseInvoice, analyzeEdmsPurchaseBatch, alignInvoiceSkusToParts, partPurchaseHistory,
} from "./stockTracking.js";

// Gerçek eDMS "Fatura Raporu" (WDMR010) Satın Alma bloğu (faturaRaporuImport.test.js ile aynı).
const PURCHASE_ROWS = [
  ["Tarih/No:", null, "2026-10-23T00:00:00.000", null, null, "/", "DM22026000006913"],
  ["Vade:", null, "2026-10-23T00:00:00.000"],
  ["Firma:", null, "DEMPAR İNŞAAT OTOMOTİV YEDEK PARÇA SANAYİ TİCARET LİMİTED ŞİTKETİ"],
  ["Açıklama:", null, null],
  ["Tip:", null, "Satın Alma"],
  ["Kaynak:", null, "YP Banko"],
  ["Stok/Hizmet", null, "Kod", null, null, null, null, "Açıklama", null, null, null, null, "İndex", "Birim Fiyat", null, null, "Miktar", null, "İskonto(%)", "Kdv (%)", null, "Toplam", "İskonto", "Kdv", "Fatura Tutarı", null],
  ["Stok", null, "LTR1610725580OEM", null, null, null, null, "FREN HIDROLIK YAĞI DOT4 500 ML", null, null, null, null, null, "291.67", null, null, "10.0", null, "20.0", "20.0", null, "2916.7", "583.34", "466.67", "2800.0299999999997"],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "10.0", null, null, null, null, "2916.7", "583.34", "466.67", "2800.0299999999997"],
  ["Tarih/No:", null, "2026-10-24T00:00:00.000", null, null, "/", "DM22026000007001"],
  ["Firma:", null, "DEMPAR"],
  ["Tip:", null, "Satın Alma"],
  ["Kaynak:", null, "YP Banko"],
  ["Stok/Hizmet"],
  ["Stok", null, "GDY 301030", null, null, null, null, "MOTOR YAĞI 0W-30", null, null, null, null, null, "300.0", null, null, "11.5", null, null, "20.0", null, "3450.0", "0", "690.0", "4140.0"],
  ["Stok", null, "YENİ-KOD-1", null, null, null, null, "YENİ PARÇA", null, null, null, null, null, "100.0", null, null, "2.0", null, null, "20.0", null, "200.0", "0", "40.0", "240.0"],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "13.5", null, null, null, null, "3650.0", "0.0", "730.0", "4380.0"],
];

const parts = [
  { id: "p1", sku: "LTR1610725580OEM", name: "Fren yağı", stock: 3, minimum: 4, cost: 200, price: 300, category: "Sıvı", brand: "Total" },
  { id: "p2", sku: "GDY-301030", name: "Motor yağı", stock: 20, minimum: 5, cost: 280, price: 380, category: "Sıvı", brand: "Goodyear" },
  { id: "p3", sku: "BSG-30-145-020", name: "Polen filtresi", stock: 0, minimum: 1, cost: 300, price: 410, category: "Filtre", brand: "BSG", favorite: true },
  { id: "p4", sku: "ARC-1", name: "Arşivli", stock: 9, minimum: 1, cost: 10, price: 20, archived: true },
];

function purchases() {
  const { invoices } = parseFaturaRaporuReport(PURCHASE_ROWS);
  return splitFaturaRaporuByType(invoices).purchases;
}

test("stock levels: out, critical, low, good", () => {
  assert.equal(stockLevel({ stock: 0, minimum: 2 }), "out");
  assert.equal(stockLevel({ stock: 2, minimum: 2 }), "critical");
  assert.equal(stockLevel({ stock: 4, minimum: 2 }), "low");
  assert.equal(stockLevel({ stock: 5, minimum: 2 }), "good");
});

test("summary ignores archived parts and computes values", () => {
  const summary = summarizeStock(parts);
  assert.equal(summary.total, 3);
  assert.equal(summary.units, 23);
  assert.equal(summary.costValue, 3 * 200 + 20 * 280);
  assert.equal(summary.out, 1);
  assert.equal(summary.critical, 1);
  assert.equal(summary.good, 1);
  assert.equal(summary.health, 33);
});

test("ABC puts the biggest stock value in A", () => {
  const abc = classifyAbc(parts);
  assert.equal(abc.get("p2"), "A");
  assert.equal(abc.get("p3"), "C");
});

test("consumption and cover days from movements", () => {
  const now = Date.parse("2026-11-09T12:00:00Z");
  const movements = [
    { partId: "p2", qty: -9, date: "2026-11-01" },
    { partId: "p2", qty: -9, date: "2026-10-01" },
    { partId: "p2", qty: 12, date: "2026-10-05" },
    { partId: "p2", qty: -50, date: "2025-01-01" },
  ];
  const stats = consumptionStats(parts[1], movements, { days: 90, now });
  assert.equal(stats.consumed, 18);
  assert.equal(stats.received, 12);
  assert.equal(stats.coverDays, 100);
  const series = stockHistorySeries(parts[1], movements, { days: 10, now });
  assert.equal(series.at(-1).stock, 20);
  assert.equal(series[0].stock, 29);
});

test("filter + sort: loose SKU search, favorites, archived", () => {
  assert.deepEqual(filterAndSortParts(parts, { query: "gdy301030" }).map((p) => p.id), ["p2"]);
  assert.deepEqual(filterAndSortParts(parts, { favorites: true }).map((p) => p.id), ["p3"]);
  assert.deepEqual(filterAndSortParts(parts, { archived: true }).map((p) => p.id), ["p4"]);
  assert.deepEqual(filterAndSortParts(parts, { sort: "level" }).map((p) => p.id), ["p3", "p1", "p2"]);
  assert.deepEqual(filterAndSortParts(parts, { sort: "value", direction: "desc" }).map((p) => p.id), ["p2", "p1", "p3"]);
});

test("eDMS purchase invoice matches eDMS line and total amounts one-to-one", () => {
  const [first] = purchases();
  const analysis = analyzeEdmsPurchaseInvoice(first, parts, []);
  assert.equal(analysis.invoiceNo, "DM22026000006913");
  assert.equal(analysis.lines[0].matchType, "exact");
  assert.equal(analysis.lines[0].net, 2333.36);
  assert.equal(analysis.lines[0].edmsNet, 2333.36);
  assert.equal(analysis.lines[0].unitCost, 233.34);
  assert.equal(analysis.lines[0].stockAfter, 13);
  assert.equal(analysis.totals.gross, 2800.03);
  assert.ok(analysis.totalsOk);
  assert.ok(analysis.allLinesOk);
  assert.ok(analysis.importable);
});

test("loose match, new card, fractional qty and already imported", () => {
  const second = purchases()[1];
  const analysis = analyzeEdmsPurchaseInvoice(second, parts, [{ code: "DM22026000007001" }]);
  assert.equal(analysis.lines[0].matchType, "loose");
  assert.equal(analysis.lines[0].part.id, "p2");
  assert.ok(analysis.lines[0].fractional);
  assert.equal(analysis.lines[1].matchType, "new");
  assert.equal(analysis.counts.newCards, 1);
  assert.ok(analysis.alreadyImported);
  assert.equal(analysis.importable, false);
  assert.ok(analysis.totalsOk);
  const aligned = alignInvoiceSkusToParts(second, analysis);
  assert.equal(aligned.items[0].kod, "GDY-301030");
  assert.equal(aligned.items[1].kod, "YENİ-KOD-1");
});

test("batch summary", () => {
  const { summary } = analyzeEdmsPurchaseBatch(purchases(), parts, [{ code: "DM22026000007001" }]);
  assert.equal(summary.count, 2);
  assert.equal(summary.importable, 1);
  assert.equal(summary.alreadyImported, 1);
  assert.equal(summary.mismatched, 0);
});

test("purchase history per part", () => {
  const rows = partPurchaseHistory(parts[1], [
    { id: "i1", code: "A", date: "2026-10-01", items: [{ partId: "p2", qty: 2, cost: 270 }] },
    { id: "i2", code: "B", date: "2026-11-01", items: [{ sku: "gdy-301030", qty: 1, cost: 280 }] },
    { id: "i3", code: "C", date: "2026-11-02", items: [{ partId: "p1", qty: 1, cost: 10 }] },
  ]);
  assert.deepEqual(rows.map((row) => row.code), ["B", "A"]);
});
