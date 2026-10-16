import test from "node:test";
import assert from "node:assert/strict";
import { isValidBusinessDate, localDateKey, resolveBusinessDate } from "./businessDate.js";

test("validates real YYYY-MM-DD calendar dates", () => {
  assert.equal(isValidBusinessDate("2026-02-28"), true);
  assert.equal(isValidBusinessDate("2024-02-29"), true);
  assert.equal(isValidBusinessDate("2026-02-29"), false);
  assert.equal(isValidBusinessDate("2026-13-01"), false);
  assert.equal(isValidBusinessDate("26-01-01"), false);
});

test("resolves provided and omitted business dates", () => {
  assert.equal(resolveBusinessDate("2025-12-31"), "2025-12-31");
  assert.equal(resolveBusinessDate(""), localDateKey());
  assert.throws(() => resolveBusinessDate("2025-02-30"), /geçerli bir işlem tarihi/i);
});
