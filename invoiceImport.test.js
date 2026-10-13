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

test("accepts a new stock code and sale price to create its part card", () => {
  const result = parseInvoicePaste("SKU\tParça Adı\tAdet\tAlış Fiyatı\tSatış Fiyatı\nNEW-301\tHava filtresi\t3\t220\t390", parts);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.items, [{
    sku: "NEW-301",
    name: "Hava filtresi",
    category: "Genel",
    brand: "",
    minimum: 5,
    qty: 3,
    cost: 220,
    price: 390,
  }]);
});

test("requires name and sale price for a new stock code", () => {
  const missingName = parseInvoicePaste("SKU\tParça Adı\tAdet\tAlış Fiyatı\tSatış Fiyatı\nNEW-301\t\t3\t220\t390", parts);
  assert.deepEqual(missingName.errors, ["2. satır: yeni stok kartı için stok kodu ve parça adı gereklidir."]);
  const missingPrice = parseInvoicePaste("SKU\tParça Adı\tAdet\tAlış Fiyatı\nNEW-301\tHava filtresi\t3\t220", parts);
  assert.deepEqual(missingPrice.errors, ["2. satır: yeni parça için satış fiyatı gereklidir."]);
});
