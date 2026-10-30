import test from "node:test";
import assert from "node:assert/strict";
import { parseEdmsWorkOrderReport, selectEdmsRecordsToImport } from "./edmsImport.js";

const BASE_ROW = {
  "Müşteri": "AKIN ALBAYRAK",
  "Telefon 1": "05312561466",
  "Adres": "",
  "İl": "",
  "İlçe": "",
  "İş Emri No": "826001",
  "Şasi No": "VR3EDYHZ9RJ925720",
  "Plaka": "55 alb 88",
  "Marka": "PEUGEOT",
  "Gövde": "RIFTER",
  "Model": "RIFTER ALLURE 1.5 BLUEHDI 130 6MT E6.3",
  "Model Yılı": "2024",
  "Geliş Tarihi": "26/08/2026",
  "Geliş Km": "20.000",
  "Genel Kapama": null,
  "Fatura Tutarı": null,
  "İş Emri Türü": "MEKANİK",
  "Servis Danışmanı Adı": "KAAN MERT ARAT",
};

test("rejects a file missing required headers", () => {
  const result = parseEdmsWorkOrderReport([{ Foo: "bar" }]);
  assert.equal(result.records.length, 0);
  assert.match(result.errors[0], /eksik sütun/);
});

test("rejects empty input", () => {
  assert.equal(parseEdmsWorkOrderReport([]).errors[0], "Excel dosyasında kayıt bulunamadı.");
  assert.equal(parseEdmsWorkOrderReport(null).records.length, 0);
});

test("skips rows missing İş Emri No, Plaka or Müşteri and reports the line", () => {
  const rows = [
    { ...BASE_ROW, "İş Emri No": "" },
    { ...BASE_ROW, "Plaka": "" },
    { ...BASE_ROW, "Müşteri": "" },
  ];
  const result = parseEdmsWorkOrderReport(rows);
  assert.equal(result.records.length, 0);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors[0], /2\. satır/);
});

test("skips a row with no usable arrival date", () => {
  const result = parseEdmsWorkOrderReport([{ ...BASE_ROW, "Geliş Tarihi": "", "Ekleme Tarihi": "" }]);
  assert.equal(result.records.length, 0);
  assert.match(result.errors[0], /geliş tarihi/);
});

test("parses a Date object for Geliş Tarihi", () => {
  const result = parseEdmsWorkOrderReport([{ ...BASE_ROW, "Geliş Tarihi": new Date(2026, 7, 26) }]);
  assert.equal(result.records[0].date, "2026-08-26");
});

test("parses dd/mm/yyyy and dd.mm.yyyy string dates", () => {
  const slash = parseEdmsWorkOrderReport([{ ...BASE_ROW, "Geliş Tarihi": "26/08/2026" }]);
  assert.equal(slash.records[0].date, "2026-08-26");
  const dotted = parseEdmsWorkOrderReport([{ ...BASE_ROW, "Geliş Tarihi": "26.08.2026" }]);
  assert.equal(dotted.records[0].date, "2026-08-26");
});

test("falls back to Ekleme Tarihi when Geliş Tarihi is missing", () => {
  const result = parseEdmsWorkOrderReport([{ ...BASE_ROW, "Geliş Tarihi": "", "Ekleme Tarihi": "01/01/2026" }]);
  assert.equal(result.records[0].date, "2026-01-01");
});

test("an open work order (no Genel Kapama) has status open and total 0", () => {
  const result = parseEdmsWorkOrderReport([{ ...BASE_ROW, "Genel Kapama": null, "Fatura Tutarı": 1234.56 }]);
  assert.equal(result.records[0].status, "open");
  assert.equal(result.records[0].closedAt, null);
  assert.equal(result.records[0].total, 0);
});

test("a closed work order (Genel Kapama present) has status closed and total from Fatura Tutarı (net)", () => {
  const result = parseEdmsWorkOrderReport([
    { ...BASE_ROW, "Genel Kapama": new Date(2026, 8, 1, 10, 30), "Fatura Tutarı": "1.234,56" },
  ]);
  assert.equal(result.records[0].status, "closed");
  assert.ok(result.records[0].closedAt);
  assert.equal(result.records[0].total, 1234.56);
});

test("a closed order with no invoice amount defaults total to 0, never negative", () => {
  const result = parseEdmsWorkOrderReport([
    { ...BASE_ROW, "Genel Kapama": new Date(2026, 8, 1), "Fatura Tutarı": "-50" },
  ]);
  assert.equal(result.records[0].total, 0);
});

test("normalizes the plate (trim, uppercase, collapse spaces)", () => {
  const result = parseEdmsWorkOrderReport([{ ...BASE_ROW, "Plaka": "  55 alb   88 " }]);
  assert.equal(result.records[0].plate, "55 ALB 88");
});

test("falls back to Src. Telefon1 when Telefon 1 is blank", () => {
  const result = parseEdmsWorkOrderReport([{ ...BASE_ROW, "Telefon 1": "", "Src. Telefon1": "05551112233" }]);
  assert.equal(result.records[0].phone, "05551112233");
});

test("parses the full real-world header set without error", () => {
  const result = parseEdmsWorkOrderReport([BASE_ROW, { ...BASE_ROW, "İş Emri No": "826002", "Genel Kapama": new Date(2026, 9, 1), "Fatura Tutarı": 500 }]);
  assert.equal(result.records.length, 2);
  assert.equal(result.errors.length, 0);
  assert.equal(result.total, 2);
});

test("selectEdmsRecordsToImport: everything is new when there are no existing jobs", () => {
  const { records } = parseEdmsWorkOrderReport([BASE_ROW]);
  const { toAdd, alreadyPresent } = selectEdmsRecordsToImport(records, []);
  assert.equal(toAdd.length, 1);
  assert.equal(alreadyPresent.length, 0);
});

test("selectEdmsRecordsToImport: skips a record already imported (same externalId)", () => {
  const { records } = parseEdmsWorkOrderReport([BASE_ROW]);
  const existingJobs = [{ externalId: "826001", plate: "99 ZZ 99", date: "2020-01-01" }];
  const { toAdd, alreadyPresent } = selectEdmsRecordsToImport(records, existingJobs);
  assert.equal(toAdd.length, 0);
  assert.equal(alreadyPresent.length, 1);
});

test("selectEdmsRecordsToImport: skips a record matching an existing manual job by plate+date", () => {
  const { records } = parseEdmsWorkOrderReport([BASE_ROW]);
  const existingJobs = [{ plate: "55 ALB 88", date: "2026-08-26" }];
  const { toAdd, alreadyPresent } = selectEdmsRecordsToImport(records, existingJobs);
  assert.equal(toAdd.length, 0);
  assert.equal(alreadyPresent.length, 1);
});

test("selectEdmsRecordsToImport: skips a record matching an existing job by vin+date", () => {
  const { records } = parseEdmsWorkOrderReport([BASE_ROW]);
  const existingJobs = [{ vin: "VR3EDYHZ9RJ925720", date: "2026-08-26", plate: "DIFFERENT" }];
  const { toAdd, alreadyPresent } = selectEdmsRecordsToImport(records, existingJobs);
  assert.equal(toAdd.length, 0);
  assert.equal(alreadyPresent.length, 1);
});

test("selectEdmsRecordsToImport: keeps a record when plate matches but date differs", () => {
  const { records } = parseEdmsWorkOrderReport([BASE_ROW]);
  const existingJobs = [{ plate: "55 ALB 88", date: "2020-01-01" }];
  const { toAdd, alreadyPresent } = selectEdmsRecordsToImport(records, existingJobs);
  assert.equal(toAdd.length, 1);
  assert.equal(alreadyPresent.length, 0);
});
