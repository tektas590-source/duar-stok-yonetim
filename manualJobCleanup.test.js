import test from "node:test";
import assert from "node:assert/strict";
import { selectManualWorkOrders, summarizeManualWorkOrders } from "./manualJobCleanup.js";

test("selectManualWorkOrders: keeps only non-eDMS jobs", () => {
  const jobs = [
    { id: "1", source: "eDMS", total: 100 },
    { id: "2", total: 200 }, // source yok -> elle girilmiş
    { id: "3", source: "manual", total: 300 },
  ];
  const manual = selectManualWorkOrders(jobs);
  assert.equal(manual.length, 2);
  assert.deepEqual(manual.map((j) => j.id), ["2", "3"]);
});

test("summarizeManualWorkOrders: totals, date range and out-of-range flag", () => {
  const jobs = [
    { id: "1", date: "2026-05-01", total: 1000 },
    { id: "2", date: "2026-09-20", total: 2000 },
  ];
  const summary = summarizeManualWorkOrders(jobs, { edmsDataFrom: "2026-06-25", edmsDataTo: "2026-10-30" });
  assert.equal(summary.count, 2);
  assert.equal(summary.totalRevenue, 3000);
  assert.equal(summary.dateFrom, "2026-05-01");
  assert.equal(summary.dateTo, "2026-09-20");
  assert.equal(summary.outsideEdmsRange.length, 1);
  assert.equal(summary.outsideEdmsRange[0].id, "1");
});

test("summarizeManualWorkOrders: no range check when eDMS bounds are not given", () => {
  const jobs = [{ id: "1", date: "2020-01-01", total: 100 }];
  const summary = summarizeManualWorkOrders(jobs);
  assert.equal(summary.outsideEdmsRange.length, 0);
});
