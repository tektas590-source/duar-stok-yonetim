import test from "node:test";
import assert from "node:assert/strict";
import { searchVehiclePartUsage } from "./vehicleCompatibility.js";

const jobs = [
  {
    id: "job-new",
    code: "IS-NEW",
    date: "2026-10-12",
    plate: "34 ABC 123",
    make: "Peugeot",
    model: "3008",
    items: [
      { partId: "oil-filter", sku: "OF-1", name: "Yağ filtresi", qty: 2 },
      { partId: "brake-pad", sku: "BP-2", name: "Fren balatası", qty: 1 },
    ],
  },
  {
    id: "job-old",
    code: "IS-OLD",
    date: "2026-08-01",
    plate: "34ABC123",
    make: "Peugeot",
    model: "3008",
    items: [{ partId: "oil-filter", sku: "OF-1", name: "Yağ filtresi", qty: 1 }],
  },
  {
    id: "job-other-car",
    code: "IS-OTHER",
    date: "2026-10-14",
    plate: "06 XYZ 456",
    make: "Renault",
    model: "Clio",
    items: [{ partId: "oil-filter", sku: "OF-1", name: "Yağ filtresi", qty: 1 }],
  },
  {
    id: "job-cancelled",
    code: "IS-CANCELLED",
    date: "2026-10-15",
    status: "İptal edildi",
    plate: "34 ABC 123",
    make: "Peugeot",
    model: "3008",
    items: [{ partId: "oil-filter", sku: "OF-1", name: "Yağ filtresi", qty: 50 }, { partId: "cancelled-only", sku: "CANCEL-1", name: "İptal edilen satır", qty: 4 }],
  },
];

test("searches vehicles by whitespace-insensitive plate and aggregates part use", () => {
  const [vehicle] = searchVehiclePartUsage(jobs, "34abc 123");
  assert.equal(vehicle.plate, "34 ABC 123");
  assert.equal(vehicle.jobs.length, 2);
  const oilFilter = vehicle.parts.find((part) => part.partId === "oil-filter");
  assert.equal(oilFilter.quantity, 3);
  assert.equal(oilFilter.visits, 2);
  assert.equal(oilFilter.lastDate, "2026-10-12");
  assert.equal(vehicle.parts.some((part) => part.partId === "cancelled-only"), false);
});

test("searches by make/model and returns separate vehicle histories", () => {
  assert.deepEqual(searchVehiclePartUsage(jobs, "peugeot 3008").map((vehicle) => vehicle.plate), ["34 ABC 123"]);
  assert.deepEqual(searchVehiclePartUsage(jobs, "clio").map((vehicle) => vehicle.plate), ["06 XYZ 456"]);
});

test("returns no vehicles until a search is entered", () => {
  assert.deepEqual(searchVehiclePartUsage(jobs, "  "), []);
});
