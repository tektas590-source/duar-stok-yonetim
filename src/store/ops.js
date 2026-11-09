// Depo bağımsız stok işlemleri. `runTx(fn)` bir işlem (transaction) açar ve
// fn'e { get(col, id), set(col, id, data) } verir; tüm okumalar yazmalardan
// önce yapılır (Firestore kuralı). Firestore ve bellek deposu bunu sağlar.

import { planAdjust, planCount, planIssue, planPurchase, planReverse, newItem } from "../core/ledger.js";
import { itemIdFromSku, todayKey } from "../core/format.js";
import { toIssueInput, toPurchaseInput } from "../core/edms.js";

const makeId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

async function readItems(tx, ids) {
  const map = {};
  for (const id of [...new Set(ids)]) {
    const doc = await tx.get("items", id);
    if (doc) map[id] = doc;
  }
  return map;
}

function writeResult(tx, { items = [], movements = [] }) {
  items.forEach((item) => tx.set("items", item.id, item));
  movements.forEach((m) => tx.set("movements", m.id, m));
}

export function createOps(runTx, getActor) {
  const meta = () => ({ actor: getActor(), now: new Date().toISOString(), makeId });

  return {
    async saveItem(input, { isNew }) {
      return runTx(async (tx) => {
        const id = input.id || itemIdFromSku(input.sku);
        const existing = await tx.get("items", id);
        const { now } = meta();
        if (isNew && existing) throw new Error(`${input.sku} stok kodu zaten kayıtlı.`);
        const base = existing || newItem(input, now);
        const next = {
          ...base,
          name: String(input.name || base.name).trim(),
          category: String(input.category ?? base.category ?? "").trim(),
          brand: String(input.brand ?? base.brand ?? "").trim(),
          unit: input.unit === "lt" ? "lt" : "adet",
          location: String(input.location ?? base.location ?? "").trim(),
          minimum: Math.max(0, Number(input.minimum) || 0),
          price: input.price === "" || input.price === null || input.price === undefined ? null : Math.max(0, Number(input.price) || 0),
          updatedAt: now,
        };
        if (!existing && Number(input.cost) > 0) { next.cost = Number(input.cost); next.lastCost = Number(input.cost); }
        tx.set("items", id, next);
        return next;
      });
    },

    async patchItem(id, patch) {
      return runTx(async (tx) => {
        const existing = await tx.get("items", id);
        if (!existing) throw new Error("Stok kartı bulunamadı.");
        const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
        tx.set("items", id, next);
        return next;
      });
    },

    async purchase(input) {
      return runTx(async (tx) => {
        const ids = (input.lines || []).filter((l) => Number(l.qty) > 0).map((l) => itemIdFromSku(l.sku));
        const items = await readItems(tx, ids);
        const plan = planPurchase(input, items, meta());
        if (await tx.get("invoices", plan.invoiceDoc.id)) throw new Error(`${input.no} numaralı fatura zaten kayıtlı.`);
        writeResult(tx, plan);
        tx.set("invoices", plan.invoiceDoc.id, plan.invoiceDoc);
        return plan.invoiceDoc;
      });
    },

    async issue(input, options = {}) {
      return runTx(async (tx) => {
        const ids = (input.lines || []).map((l) => l.itemId || itemIdFromSku(l.sku));
        const items = await readItems(tx, ids);
        const plan = planIssue(input, items, { ...meta(), ...options });
        if (await tx.get("issues", plan.issueDoc.id)) throw new Error(`${input.no} numaralı belge zaten kayıtlı.`);
        writeResult(tx, plan);
        tx.set("issues", plan.issueDoc.id, plan.issueDoc);
        return plan.issueDoc;
      });
    },

    async adjust(itemId, delta, note) {
      return runTx(async (tx) => {
        const item = await tx.get("items", itemId);
        if (!item) throw new Error("Stok kartı bulunamadı.");
        const plan = planAdjust(item, delta, { ...meta(), note, date: todayKey() });
        writeResult(tx, plan);
        return plan.items[0];
      });
    },

    async count(lines, countNo) {
      return runTx(async (tx) => {
        const items = await readItems(tx, lines.map((l) => l.itemId));
        const m = meta();
        const plan = planCount(lines, items, { ...m, date: todayKey(), countNo });
        writeResult(tx, plan);
        tx.set("counts", countNo, { id: countNo, date: todayKey(), actor: m.actor, createdAt: m.now, lines: plan.movements.map((x) => ({ itemId: x.itemId, sku: x.sku, name: x.name, before: x.stockBefore, after: x.stockAfter, diff: x.qty })) });
        return plan;
      });
    },

    async reverse(col, docId) {
      return runTx(async (tx) => {
        const doc = await tx.get(col, docId);
        if (!doc) throw new Error("Belge bulunamadı.");
        const items = await readItems(tx, doc.lines.map((l) => l.itemId));
        const plan = planReverse(doc, items, { ...meta(), date: todayKey() });
        writeResult(tx, plan);
        tx.set(col, docId, plan.doc);
        return plan.doc;
      });
    },

    // Analiz edilmiş eDMS faturalarını sırayla işler; biri hata verse diğerleri devam eder.
    async importEdms(analyzedList, { allowNegative = false } = {}) {
      const results = [];
      for (const a of analyzedList) {
        try {
          const doc = a.type === "purchase" ? await this.purchase(toPurchaseInput(a)) : await this.issue(toIssueInput(a), { allowNegative });
          results.push({ no: a.no, ok: true, doc });
        } catch (error) {
          results.push({ no: a.no, ok: false, error: error.message || String(error) });
        }
      }
      return results;
    },
  };
}
