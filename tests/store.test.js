import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store/memoryStore.js";
import { parseFaturaRaporu, analyzeInvoice } from "../src/core/edms.js";

const H = ["Stok/Hizmet", null, "Kod", null, null, null, null, "Açıklama", null, null, null, null, "İndex", "Birim Fiyat", null, null, "Miktar", null, "İskonto(%)", "Kdv (%)", null, "Toplam", "İskonto", "Kdv", "Fatura Tutarı"];
const row = (code, name, price, qty, total, vat, gross) => ["Stok", null, code, null, null, null, null, name, null, null, null, null, null, price, null, null, qty, null, null, 20, null, total, 0, vat, gross];
const REPORT = [
  ["Tarih/No:", null, "01.11.2026", null, null, "/", "A-1"], ["Firma:", null, "DEMPAR"], ["Tip:", null, "Satın Alma"], H,
  row("K1", "Balata", 1000, 4, 4000, 800, 4800),
  ["Tarih/No:", null, "05.11.2026", null, null, "/", "5001"], ["Firma:", null, "Müşteri"], ["Açıklama:", null, "VF3ABCDEFGH123456 / 55 ABC 123 / 208"], ["Tip:", null, "Satış"], H,
  row("K1", "Balata", 1500, 1, 1500, 300, 1800),
];

function state(store) { let s; store.subscribe((x) => { s = x; })(); return s; }

test("memory store: eDMS import end-to-end, idempotent, reversible", async () => {
  const store = createMemoryStore();
  const analyze = () => parseFaturaRaporu(REPORT).invoices.map((inv) => {
    const s = state(store);
    return analyzeInvoice(inv, s.items, new Set([...s.invoices, ...s.issues].map((d) => d.id)));
  });
  const [purchase] = analyze();
  const r1 = await store.importEdms([purchase]);
  assert.ok(r1[0].ok, r1[0].error);
  const [, sale] = analyze();
  assert.equal(sale.lines[0].match, "exact");
  const r2 = await store.importEdms([sale]);
  assert.ok(r2[0].ok, r2[0].error);
  let s = state(store);
  assert.equal(s.items[0].stock, 3);
  assert.equal(s.issues[0].plate, "55 ABC 123");
  assert.equal(s.issues[0].totals.profit, 500);
  assert.equal(s.movements.length, 2);
  const again = analyze();
  assert.ok(again.every((a) => a.already));
  await assert.rejects(() => store.purchase({ no: "A-1", supplier: "x", date: "2026-11-01", lines: [{ sku: "K1", qty: 1, unitPrice: 1 }] }), /zaten/);
  await store.reverse("issues", s.issues[0].id);
  s = state(store);
  assert.equal(s.items[0].stock, 4);
  assert.ok(s.issues[0].cancelled);
});

test("memory store: card save, adjust, count", async () => {
  const store = createMemoryStore();
  const item = await store.saveItem({ sku: "Z9", name: "Silecek", minimum: 2, price: 250 }, { isNew: true });
  await assert.rejects(() => store.saveItem({ sku: "z9", name: "x" }, { isNew: true }), /zaten/);
  await store.adjust(item.id, 5, "Açılış");
  await store.count([{ itemId: item.id, counted: 4 }], "SAY-1");
  const s = state(store);
  assert.equal(s.items[0].stock, 4);
  assert.deepEqual(s.movements.map((m) => m.type).sort(), ["adjust", "count"]);
});

test("sale before purchase: shortage settles when stock arrives; cancelled docs can be re-imported", async () => {
  const store = createMemoryStore();
  const analyze = () => {
    const s = state(store);
    const existing = new Map([...s.invoices, ...s.issues].map((d) => [d.id, d]));
    return parseFaturaRaporu(REPORT).invoices.map((inv) => analyzeInvoice(inv, s.items, existing));
  };
  // 1) Önce satış: K1 kartı yok → kartsız parça ama eksik olarak izlenir.
  let [, sale] = analyze();
  assert.equal(sale.lines[0].match, "new");
  let r = await store.importEdms([sale]);
  assert.ok(r[0].ok, r[0].error);
  let s = state(store);
  assert.equal(s.issues[0].shortages[0].missing, 1);
  assert.equal(s.issues[0].totals.otherNet, 1500);
  // 2) Sonra alış: 4 adet girer; eksik kapatılınca stok 3 olur, satış kartlı parçaya döner.
  const [purchase] = analyze();
  r = await store.importEdms([purchase]);
  assert.ok(r[0].ok, r[0].error);
  const settled = await store.settleShortages([s.issues[0].id]);
  assert.equal(settled[0].items[0].qty, 1);
  s = state(store);
  assert.equal(s.items[0].stock, 3);
  const doc = s.issues[0];
  assert.equal(doc.shortages.length, 0);
  assert.equal(doc.lines[0].qty, 1);
  assert.equal(doc.totals.partsNet, 1500);
  assert.equal(doc.totals.otherNet, 0);
  assert.equal(doc.totals.net, 1500);
  assert.equal(doc.totals.profit, 500);
  // 3) Satış iptal edilir ve yeniden yüklenebilir (s_5001_r2).
  await store.reverse("issues", doc.id);
  s = state(store);
  assert.equal(s.items[0].stock, 4);
  [, sale] = analyze();
  assert.equal(sale.already, false);
  assert.equal(sale.reimport, true);
  assert.ok(sale.importable);
  r = await store.importEdms([sale]);
  assert.ok(r[0].ok, r[0].error);
  s = state(store);
  assert.equal(s.items[0].stock, 3);
  assert.ok(s.issues.some((d) => d.id.endsWith("_r2") && !d.cancelled && d.totals.profit === 500));
  assert.ok(analyze()[1].already);
  // 4) Aynı yüklemede satış önce gelse bile alış önce işlenir.
  const store2 = createMemoryStore();
  const s2 = state(store2);
  const both = parseFaturaRaporu(REPORT).invoices.map((inv) => analyzeInvoice(inv, s2.items, new Map()));
  const res2 = await store2.importEdms([both[1], both[0]]);
  assert.ok(res2.every((x) => x.ok));
  const after2 = state(store2);
  assert.equal(after2.items[0].stock, 3);
  assert.equal(after2.issues[0].shortages.length, 0);
});
