import test from "node:test";
import assert from "node:assert/strict";
import { parseInvoicePaste } from "./invoiceImport.js";

const parts = [
  { id: "part-a", sku: "OE-9812", name: "Yağ filtresi" },
  { id: "part-b", sku: "BR-2048", name: "Ön fren balatası" },
];

test("parses Excel tab-separated rows with Turkish headers", () => {
  const result = parseInvoicePaste("SKU\tParça Adı\tAdet\tBirim Alış Fiyatı\nOE-9812\tYağ filtresi\t4\t310\nBR-2048\tÖn fren balatası\t2\t1680", parts);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows, 2);
  assert.deepEqual(result.items.map(({ partId, qty, cost }) => ({ partId, qty, cost })), [
    { partId: "part-a", qty: 4, cost: 310 },
    { partId: "part-b", qty: 2, cost: 1680 },
  ]);
});

test("parses semicolon-separated Turkish decimal prices", () => {
  const result = parseInvoicePaste("Stok Kodu;Miktar;Alış Fiyatı\nBR-2048;2;1.680,50", parts);
  assert.deepEqual(result.errors, []);
  assert.equal(result.items[0].cost, 1680.5);
});

test("supports headerless SKU, quantity, and unit-cost rows", () => {
  const result = parseInvoicePaste("OE-9812,3,310", parts);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.items.map(({ partId, qty, cost }) => ({ partId, qty, cost })), [
    { partId: "part-a", qty: 3, cost: 310 },
  ]);
});

test("aggregates repeated SKUs and rejects unresolved or invalid lines", () => {
  const result = parseInvoicePaste("SKU\tAdet\tAlış Fiyatı\nOE-9812\t2\t300\nOE-9812\t2\t400\nMISSING\t1\t10\nBR-2048\t0\t100", parts);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].qty, 4);
  assert.equal(result.items[0].cost, 350);
  assert.equal(result.errors.length, 2);
});
