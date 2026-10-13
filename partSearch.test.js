import test from "node:test";
import assert from "node:assert/strict";
import { findPartMatches, parsePastedPartQueries } from "./partSearch.js";

const parts = [
  { id: "part-a", sku: "OE-9812", name: "Yağ filtresi" },
  { id: "part-b", sku: "BR-2048", name: "Ön fren balatası" },
  { id: "part-c", sku: "OE-2048", name: "Hava filtresi" },
];

test("finds part codes by their ending and prefers exact matches", () => {
  assert.deepEqual(findPartMatches("9812", parts).map((part) => part.id), ["part-a"]);
  assert.deepEqual(findPartMatches("2048", parts).map((part) => part.id), ["part-c", "part-b"]);
  assert.deepEqual(findPartMatches("BR-2048", parts).map((part) => part.id), ["part-b"]);
});

test("matches Turkish part names without case or diacritic differences", () => {
  assert.deepEqual(findPartMatches("yag filtresi", parts).map((part) => part.id), ["part-a"]);
});

test("extracts the part code from pasted tabular and delimited rows", () => {
  assert.deepEqual(parsePastedPartQueries("OE-9812\tYağ filtresi\t4\nBR-2048;Fren balatası;2\nOE-2048,1"), ["OE-9812", "BR-2048", "OE-2048"]);
});
