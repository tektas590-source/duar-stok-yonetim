// Depo bağımsız stok işlemleri. `runTx(fn)` bir işlem (transaction) açar ve
// fn'e { get(col, id), set(col, id, data) } verir; tüm okumalar yazmalardan
// önce yapılır (Firestore kuralı). Firestore ve bellek deposu bunu sağlar.

import { planAddServices, planAdjust, planCount, planIssue, planPurchase, planReverse, planSettleShortages, newItem } from "../core/ledger.js";
import { docIdFromNumber, itemIdFromSku, todayKey } from "../core/format.js";
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

// İptal edilen belgenin numarası yeniden kullanılabilir: p_X iptalse p_X_r2, p_X_r3 …
async function freeDocId(tx, col, prefix, no) {
  const base = docIdFromNumber(prefix, no);
  for (let n = 1; n <= 50; n += 1) {
    const id = n === 1 ? base : `${base}_r${n}`;
    const doc = await tx.get(col, id);
    if (!doc) return id;
    if (!doc.cancelled) throw new Error(`${no} numaralı ${prefix === "p" ? "fatura" : "belge"} zaten kayıtlı.`);
  }
  throw new Error(`${no} numarası çok kez iptal edilmiş.`);
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
        const id = await freeDocId(tx, "invoices", "p", input.no);
        const items = await readItems(tx, ids);
        const plan = planPurchase({ ...input, id }, items, meta());
        writeResult(tx, plan);
        tx.set("invoices", plan.invoiceDoc.id, plan.invoiceDoc);
        return plan.invoiceDoc;
      });
    },

    async issue(input, options = {}) {
      return runTx(async (tx) => {
        const ids = (input.lines || []).map((l) => l.itemId || itemIdFromSku(l.sku));
        const id = await freeDocId(tx, "issues", "s", input.no);
        const items = await readItems(tx, ids);
        const plan = planIssue({ ...input, id }, items, { ...meta(), ...options });
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

    async addServices(docId, services, edmsGross = null, vehicle = null) {
      return runTx(async (tx) => {
        const doc = await tx.get("issues", docId);
        if (!doc) throw new Error("Belge bulunamadı.");
        const next = (doc.services || []).length || !(services || []).length ? { ...doc } : planAddServices(doc, services, meta());
        if (edmsGross && (next.edmsGross === null || next.edmsGross === undefined)) next.edmsGross = edmsGross;
        if (vehicle && !next.vehicleModel && !next.vin) {
          next.vin = vehicle.vin || ""; next.brand = vehicle.brand || ""; next.vehicleModel = vehicle.model || "";
          if (!next.plate && vehicle.plate) next.plate = vehicle.plate;
        }
        tx.set("issues", docId, next);
        return next;
      });
    },

    // Stokta olmadığı için ciroya "stokta yoktu" yazılan satış kalemlerini,
    // stok artık varsa stoktan düşer. docIds: açık eksiği olan satış belgeleri.
    async settleShortages(docIds) {
      const settled = [];
      for (const docId of docIds || []) {
        try {
          const res = await runTx(async (tx) => {
            const doc = await tx.get("issues", docId);
            if (!doc || doc.cancelled || !(doc.shortages || []).some((x) => x.missing > 0)) return null;
            const items = await readItems(tx, doc.shortages.map((x) => x.itemId || itemIdFromSku(x.sku)));
            const plan = planSettleShortages(doc, items, { ...meta(), date: todayKey() });
            if (!plan.settled.length) return null;
            writeResult(tx, plan);
            tx.set("issues", docId, plan.doc);
            return { no: doc.no, items: plan.settled };
          });
          if (res) settled.push(res);
        } catch (error) { console.error(error); }
      }
      return settled;
    },

    // Analiz edilmiş eDMS faturalarını sırayla işler; biri hata verse diğerleri devam eder.
    // Daha önce kaydedilmiş satışlar için yalnızca eksik işçilik satırları eklenir.
    async importEdms(analyzedList, { allowNegative = false } = {}) {
      const results = [];
      // Önce alışlar (tarih sırasıyla), sonra satışlar: aynı yüklemede satış, alışı gelmemiş parçaya takılmasın.
      const ordered = [...analyzedList].sort((x, y) => (x.type === y.type ? String(x.date).localeCompare(String(y.date)) : x.type === "purchase" ? -1 : 1));
      for (const a of ordered) {
        try {
          if (a.backfill) {
            const doc = await this.addServices(a.existingId || a.docId, a.needsServices ? a.services : [], a.reportGross ?? a.totals.fullGross, a.needsVehicle ? a.vehicle : null);
            results.push({ no: a.no, ok: true, doc, backfill: true });
            continue;
          }
          const doc = a.type === "purchase" ? await this.purchase(toPurchaseInput(a)) : await this.issue(toIssueInput(a), { allowNegative, clampShort: true });
          results.push({ no: a.no, ok: true, doc });
        } catch (error) {
          results.push({ no: a.no, ok: false, error: error.message || String(error) });
        }
      }
      // Bu yüklemede stokta/kartı olmadığı için eksik kalan satış kalemleri, aynı yüklemedeki alışlarla kapanır.
      const pending = results.filter((x) => x.ok && x.doc?.kind === "issue" && (x.doc.shortages || []).length).map((x) => x.doc.id);
      if (pending.length && results.some((x) => x.ok && x.doc?.kind === "purchase")) await this.settleShortages(pending);
      return results;
    },
  };
}
