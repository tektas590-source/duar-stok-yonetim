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
