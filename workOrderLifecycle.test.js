import test from "node:test";
import assert from "node:assert/strict";
import {
  getOpenWorkOrders,
  getRevenueEligibleWorkOrders,
  getWorkOrderStatusClass,
  WORK_ORDER_STATUS,
} from "./workOrderLifecycle.js";

const jobs = [
  { id: "open", status: WORK_ORDER_STATUS.IN_PROGRESS },
  { id: "done", status: WORK_ORDER_STATUS.COMPLETED },
  { id: "cancelled", status: WORK_ORDER_STATUS.CANCELLED },
];

test("completed work orders remain in revenue while cancelled ones are excluded", () => {
  assert.deepEqual(getRevenueEligibleWorkOrders(jobs).map((job) => job.id), ["open", "done"]);
});

test("open work-order totals exclude completed and cancelled records", () => {
  assert.deepEqual(getOpenWorkOrders(jobs).map((job) => job.id), ["open"]);
});

test("maps each lifecycle status to a distinct badge style", () => {
  assert.equal(getWorkOrderStatusClass(WORK_ORDER_STATUS.IN_PROGRESS), "status-progress");
  assert.equal(getWorkOrderStatusClass(WORK_ORDER_STATUS.COMPLETED), "status-done");
  assert.equal(getWorkOrderStatusClass(WORK_ORDER_STATUS.CANCELLED), "status-cancelled");
});
