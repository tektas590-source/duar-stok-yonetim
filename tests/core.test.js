import test from "node:test";
import assert from "node:assert/strict";
import { itemIdFromSku, toNumber, dateKeyFromCell, looseKey } from "../src/core/format.js";
import { planPurchase, planIssue, planAdjust, planCount, planReverse, newItem } from "../src/core/ledger.js";
import { level, summarize, filterItems, usageMap, stockSeries, reorderSuggestions } from "../src/core/stock.js";
import { parseFaturaRaporu, analyzeInvoice, toPurchaseInput, toIssueInput } from "../src/core/edms.js";
import { parseCountSheet, compareCount } from "../src/core/countSheet.js";

const ctx = () => { let n = 0; return { actor: "test@x.com", now: "2026-11-09T10:00:00.000Z", makeId: () => `m${++n}` }; };

// Gerçek eDMS WDMR010 çıktısından alınmış satırlar (başlık satırı tam haliyle).
const HEADER = ["Stok/Hizmet", null, "Kod", null, null, null, null, "Açıklama", null, null, null, null, "İndex", "Birim Fiyat", null, null, "Miktar", null, "İskonto(%)", "Kdv (%)", null, "Toplam", "İskonto", "Kdv", "Fatura Tutarı", null];
const ROWS = [
  ["Tarih/No:", null, "2026-10-23T00:00:00.000", null, null, "/", "DM22026000006913"],
  ["Vade:", null, "2026-10-23T00:00:00.000"],
  ["Firma:", null, "DEMPAR İNŞAAT OTOMOTİV YEDEK PARÇA SANAYİ TİCARET LİMİTED ŞİTKETİ"],
  ["Açıklama:", null, null],
  ["Tip:", null, "Satın Alma"],
  ["Kaynak:", null, "YP Banko"],
  HEADER,
  ["Stok", null, "LTR1610725580OEM", null, null, null, null, "FREN HIDROLIK YAĞI DOT4 500 ML", null, null, null, null, null, "291.67", null, null, "10.0", null, "20.0", "20.0", null, "2916.7", "583.34", "466.67", "2800.0299999999997"],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "10.0", null, null, null, null, "2916.7", "583.34", "466.67", "2800.0299999999997"],
  ["Tarih/No:", null, "2026-09-16T00:00:00.000", null, null, "/", "5001000012"],
  ["Firma:", null, "DEMİR İNŞ. MİMARLIK AKARYAKIT OTOMOTİV SAN. VE TİC.LDT.ŞTİ."],
  ["Açıklama:", null, "NM0EXXTTREMG61162 / 34EMH581 / E-TRANSIT CUSTOM VAN KM:138700"],
  ["Tip:", null, "Satış"],
  ["Kaynak:", null, "Servis"],
  HEADER,
  ["Hizmet", null, "ERT001", null, null, null, null, "Bakım İşçiliği", null, null, null, null, null, "2750.0", null, null, "1.0", null, null, "20.0", null, "2750.0", "0", "550.0", "3300.0"],
  ["Stok", null, "GDY 301030", null, null, null, null, "MOTOR YAĞI 0W-30 10,50 LİTRE", null, null, null, null, null, "347.82", null, null, "11.5", null, null, "20.0", null, "3999.93", "0", "799.99", "4799.92"],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "12.5", null, null, null, null, "6749.93", "0.0", "1349.99", "8099.92"],
];

test("format helpers", () => {
  assert.equal(toNumber("1.234,56"), 1234.56);
  assert.equal(toNumber("2800.0299999999997"), 2800.0299999999997);
  assert.equal(dateKeyFromCell("23.10.2026"), "2026-10-23");
  assert.equal(dateKeyFromCell(new Date(2026, 9, 23)), "2026-10-23");
  assert.equal(itemIdFromSku(" GDY 301030 "), itemIdFromSku("gdy 301030"));
  assert.ok(!itemIdFromSku("a/b.c").includes("/"));
  assert.equal(looseKey("GDY-301 030"), "gdy301030");
});

test("purchase: new card, weighted average cost, decimal qty", () => {
  const c = ctx();
  const first = planPurchase({ no: "F1", supplier: "Dempar", date: "2026-11-01", lines: [{ sku: "X1", name: "Yağ", qty: 2, unitPrice: 100 }] }, {}, c);
  assert.equal(first.items[0].stock, 2);
  assert.equal(first.items[0].cost, 100);
  assert.equal(first.invoiceDoc.totals.gross, 240);
  const byId = { [first.items[0].id]: first.items[0] };
  const second = planPurchase({ no: "F2", supplier: "Dempar", date: "2026-11-02", lines: [{ sku: "x1", qty: 1.5, unitPrice: 200, discountPct: 10 }] }, byId, c);
  assert.equal(second.items[0].stock, 3.5);
  assert.equal(second.items[0].lastCost, 180);
  assert.equal(second.items[0].cost, round4((2 * 100 + 1.5 * 180) / 3.5));
  assert.equal(second.movements[0].stockBefore, 2);
  assert.equal(second.movements[0].stockAfter, 3.5);
});
function round4(v) { return Math.round(v * 10000) / 10000; }

test("issue: blocks overselling, computes profit, reverse restores", () => {
  const c = ctx();
  const item = { ...newItem({ sku: "A", name: "Balata", cost: 100, price: 150 }, c.now), stock: 3 };
  assert.throws(() => planIssue({ no: "S1", date: "2026-11-09", lines: [{ itemId: item.id, qty: 4 }] }, { [item.id]: item }, c), /çıkılamaz/);
  const r = planIssue({ no: "S1", date: "2026-11-09", lines: [{ itemId: item.id, qty: 2 }] }, { [item.id]: item }, c);
  assert.equal(r.items[0].stock, 1);
  assert.equal(r.issueDoc.totals.net, 300);
  assert.equal(r.issueDoc.totals.profit, 100);
  assert.equal(r.movements[0].qty, -2);
  const back = planReverse(r.issueDoc, { [item.id]: r.items[0] }, { ...c, date: "2026-11-09" });
  assert.equal(back.items[0].stock, 3);
  assert.ok(back.doc.cancelled);
  assert.throws(() => planReverse(back.doc, {}, c), /zaten/);
});

test("adjust and count", () => {
  const c = ctx();
  const item = { ...newItem({ sku: "B", name: "Filtre" }, c.now), stock: 5 };
  assert.equal(planAdjust(item, -2, { ...c, date: "2026-11-09" }).items[0].stock, 3);
  assert.throws(() => planAdjust(item, -6, { ...c, date: "2026-11-09" }), /eksi/);
  const counted = planCount([{ itemId: item.id, counted: 7 }], { [item.id]: item }, { ...c, date: "2026-11-09", countNo: "SAY-1" });
  assert.equal(counted.movements[0].qty, 2);
  assert.equal(planCount([{ itemId: item.id, counted: 5 }], { [item.id]: item }, { ...c, date: "x", countNo: "S" }).movements.length, 0);
});

test("stock levels, summary, filter, usage, reorder", () => {
  const items = [
    { id: "1", sku: "GDY-301030", name: "Yağ", stock: 0, minimum: 2, cost: 10, price: 20 },
    { id: "2", sku: "B", name: "Balata", stock: 2, minimum: 2, cost: 100, price: null, favorite: true },
    { id: "3", sku: "C", name: "Silecek", stock: 9, minimum: 2, cost: 50, price: 80 },
    { id: "4", sku: "D", name: "Arşiv", stock: 9, minimum: 2, cost: 50, archived: true },
  ];
  assert.equal(level(items[0]), "out");
  const s = summarize(items);
  assert.equal(s.total, 3);
  assert.equal(s.noPrice, 1);
  assert.equal(s.health, 33);
  assert.deepEqual(filterItems(items, { query: "gdy 301030" }).map((i) => i.id), ["1"]);
  assert.deepEqual(filterItems(items, { lvl: "attention" }).map((i) => i.id), ["1", "2"]);
  assert.deepEqual(filterItems(items, { archived: true }).map((i) => i.id), ["4"]);
  const now = Date.parse("2026-11-09T12:00:00Z");
  const moves = [{ itemId: "3", type: "issue", qty: -9, date: "2026-11-01" }];
  const usage = usageMap(items, moves, { now });
  assert.equal(usage.get("3").cover, 90);
  const series = stockSeries(items[2], moves, { days: 10, now });
  assert.equal(series[0].value, 18);
  const sugg = reorderSuggestions(items, usage);
  assert.deepEqual(sugg.map((x) => x.item.id), ["1", "2"]);
  assert.equal(sugg[0].suggest, 4);
});

test("eDMS WDMR010: parses both invoices with header-detected columns", () => {
  const { invoices, errors } = parseFaturaRaporu(ROWS);
  assert.deepEqual(errors, []);
  assert.equal(invoices.length, 2);
  assert.equal(invoices[0].type, "purchase");
  assert.equal(invoices[0].no, "DM22026000006913");
  assert.equal(invoices[0].date, "2026-10-23");
  assert.equal(invoices[0].lines[0].qty, 10);
  assert.equal(invoices[0].reportGross, 2800.03);
  assert.equal(invoices[1].type, "sale");
  assert.equal(invoices[1].lines.length, 2);
});

test("eDMS purchase analysis matches eDMS amounts one-to-one and imports", () => {
  const [purchase] = parseFaturaRaporu(ROWS).invoices;
  const a = analyzeInvoice(purchase, [], new Set());
  assert.ok(a.match);
  assert.equal(a.totals.net, 2333.36);
  assert.equal(a.totals.gross, 2800.03);
  assert.equal(a.counts.fresh, 1);
  assert.ok(a.importable);
  const plan = planPurchase(toPurchaseInput(a), {}, ctx());
  assert.equal(plan.items[0].stock, 10);
  assert.equal(plan.items[0].cost, 233.336);
  assert.equal(plan.invoiceDoc.id, a.docId);
  const again = analyzeInvoice(purchase, plan.items, new Set([plan.invoiceDoc.id]));
  assert.ok(again.already);
  assert.equal(again.importable, false);
  assert.equal(again.lines[0].match, "exact");
});

test("eDMS sale analysis: loose match, service skipped, shortage flagged, decimal qty", () => {
  const sale = parseFaturaRaporu(ROWS).invoices[1];
  const items = [{ id: itemIdFromSku("GDY-301030"), sku: "GDY-301030", name: "Yağ", stock: 20, cost: 300 }];
  const a = analyzeInvoice(sale, items, new Set());
  assert.ok(a.match);
  assert.equal(a.counts.service, 1);
  assert.equal(a.lines[1].match, "loose");
  assert.equal(a.lines[1].stockAfter, 8.5);
  const input = toIssueInput(a);
  assert.equal(input.plate, "34EMH581");
  const plan = planIssue(input, { [items[0].id]: items[0] }, ctx());
  assert.equal(plan.items[0].stock, 8.5);
  const short = analyzeInvoice(sale, [{ ...items[0], stock: 5 }], new Set());
  assert.equal(short.counts.short, 1);
});

test("count sheet: header detection, merge duplicates, compare", () => {
  const { lines, detected } = parseCountSheet([
    ["DEPO SAYIM LİSTESİ"],
    ["Stok Kodu", "Stok Adı", "Bakiye"],
    ["GDY 301030", "Yağ", "5"],
    ["GDY-301030", "Yağ", "2,5"],
    ["ZZZ", "Yok", 1],
  ]);
  assert.ok(detected);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].qty, 7.5);
  const rows = compareCount(lines, [{ id: "a", sku: "GDY-301030", name: "Yağ", stock: 7.5 }, { id: "b", sku: "Q", name: "Q", stock: 3 }]);
  assert.deepEqual(rows.map((r) => r.status), ["ok", "missing", "notcounted"]);
});

test("sale with labor: labor goes to revenue and profit, not stock; totals match eDMS invoice total", () => {
  const sale = parseFaturaRaporu(ROWS).invoices[1];
  const items = [{ id: itemIdFromSku("GDY-301030"), sku: "GDY-301030", name: "Yağ", stock: 20, cost: 300 }];
  const a = analyzeInvoice(sale, items, new Set());
  assert.ok(a.match);
  assert.equal(a.totals.laborNet, 2750);
  assert.equal(a.services.length, 1);
  assert.equal(a.totals.fullGross, 8099.92);
  const plan = planIssue(toIssueInput(a), { [items[0].id]: items[0] }, ctx());
  assert.equal(plan.items[0].stock, 8.5);
  assert.equal(plan.issueDoc.totals.partsNet, 3999.93);
  assert.equal(plan.issueDoc.totals.laborNet, 2750);
  assert.equal(plan.issueDoc.totals.net, 6749.93);
  assert.equal(plan.issueDoc.totals.gross, 8099.92);
  assert.equal(plan.issueDoc.totals.profit, round2(3999.93 - 11.5 * 300 + 2750));
});
function round2(v) { return Math.round(v * 100) / 100; }

test("labor-only sale and backfill of labor onto an already imported sale", async () => {
  const { createMemoryStore } = await import("../src/store/memoryStore.js");
  const store = createMemoryStore();
  const labor = planIssue({ no: "S-9", date: "2026-11-09", services: [{ name: "Fren bakım işçiliği", unitPrice: 1000 }] }, {}, ctx());
  assert.equal(labor.issueDoc.totals.net, 1000);
  assert.equal(labor.issueDoc.totals.profit, 1000);
  assert.equal(labor.movements.length, 0);
  // Eski kayıt: işçiliksiz satış
  const sale = parseFaturaRaporu(ROWS).invoices[1];
  await store.purchase({ no: "P1", supplier: "x", date: "2026-09-01", lines: [{ sku: "GDY-301030", qty: 20, unitPrice: 300 }] });
  let st; store.subscribe((x) => { st = x; })();
  const a0 = analyzeInvoice(sale, st.items, new Set());
  await store.issue({ ...toIssueInput(a0), services: [] });
  store.subscribe((x) => { st = x; })();
  const existing = new Map(st.issues.map((d) => [d.id, d]));
  const a1 = analyzeInvoice(sale, st.items, existing);
  assert.ok(a1.already);
  assert.ok(a1.backfill);
  const res = await store.importEdms([a1]);
  assert.ok(res[0].ok && res[0].backfill, res[0].error);
  store.subscribe((x) => { st = x; })();
  assert.equal(st.issues[0].totals.laborNet, 2750);
  assert.equal(st.items[0].stock, 8.5);
  const a2 = analyzeInvoice(sale, st.items, new Map(st.issues.map((d) => [d.id, d])));
  assert.equal(a2.backfill, false);
});

test("eDMS sale with short stock is kept: available qty from stock, rest as uncarded revenue", () => {
  const sale = parseFaturaRaporu(ROWS).invoices[1];
  const items = [{ id: itemIdFromSku("GDY-301030"), sku: "GDY-301030", name: "Yağ", stock: 4, cost: 300 }];
  const a = analyzeInvoice(sale, items, new Set());
  const input = toIssueInput(a);
  assert.throws(() => planIssue(input, { [items[0].id]: items[0] }, ctx()), /çıkılamaz/);
  const plan = planIssue(input, { [items[0].id]: items[0] }, { ...ctx(), clampShort: true });
  assert.equal(plan.items[0].stock, 0);
  assert.equal(plan.movements[0].qty, -4);
  assert.equal(plan.issueDoc.shortages[0].missing, 7.5);
  assert.equal(plan.issueDoc.totals.net, 6749.93);
  assert.equal(plan.issueDoc.totals.gross, 8099.92);
  assert.equal(plan.issueDoc.edmsGross, 8099.92);
});

test("count sheet: eDMS WDMR002 Stok Mevcut Raporu columns", () => {
  const { lines, detected } = parseCountSheet([
    ["DEMİR İNŞ. MİMARLIK"], ["STOK MEVCUT RAPORU"],
    ["Stok Kodu", "Stok Adı", "Stok Grubu", "Ambar", "İşyeri", "Fiili Miktar", "Birim", "Min.Stok", "Maks.Stok", "Lokasyon"],
    ["GDY 301030", "MOTOR YAĞI", "YAĞ", "YEDEK PARÇA AMBARI", "DEMİR", "48,50", "LİTRE", null, null, null],
    ["0164.88ALT", "CONTA", "SARF", "YEDEK PARÇA AMBARI", "DEMİR", "90,00", "ADET", null, null, null],
  ]);
  assert.ok(detected);
  assert.deepEqual(lines.map((l) => [l.sku, l.qty]), [["GDY 301030", 48.5], ["0164.88ALT", 90]]);
});
