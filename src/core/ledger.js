// Stok işlemlerinin saf "plan" fonksiyonları. Veritabanına dokunmazlar:
// mevcut stok kartlarını alır, yazılacak kartları, hareketleri ve belgeyi
// döndürür. Firestore ve bellek (demo) deposu aynı planları kullanır; böylece
// stok hesabı tek yerde ve test edilebilir durumdadır.

import { docIdFromNumber, itemIdFromSku, round, skuKey, VAT_RATE } from "./format.js";

export const MOVE = {
  PURCHASE: "purchase",
  ISSUE: "issue",
  ADJUST: "adjust",
  COUNT: "count",
  REVERSAL: "reversal",
};

export const MOVE_LABEL = {
  purchase: "Alış faturası",
  issue: "Satış / çıkış",
  adjust: "Düzeltme",
  count: "Sayım farkı",
  reversal: "İptal",
};

const QTY_DIGITS = 3;

function cleanQty(value) {
  const n = round(Number(value) || 0, QTY_DIGITS);
  return n;
}

function baseMovement({ item, qty, type, ref, actor, now, date, unitCost = null, unitPrice = null, note = "" }) {
  return {
    itemId: item.id,
    sku: item.sku,
    name: item.name,
    qty,
    type,
    refType: ref?.type || null,
    refId: ref?.id || null,
    refNo: ref?.no || null,
    unitCost,
    unitPrice,
    note,
    actor,
    date,
    createdAt: now,
  };
}

export function newItem({ sku, name, category = "", brand = "", unit = "adet", location = "", minimum = 0, cost = 0, price = null }, now) {
  const cleanSku = String(sku || "").trim().replace(/\s+/g, " ");
  if (!cleanSku) throw new Error("Stok kodu gerekli.");
  return {
    id: itemIdFromSku(cleanSku),
    sku: cleanSku,
    skuKey: skuKey(cleanSku),
    name: String(name || cleanSku).trim(),
    category: String(category || "").trim(),
    brand: String(brand || "").trim(),
    unit: unit === "lt" ? "lt" : "adet",
    location: String(location || "").trim(),
    minimum: Math.max(0, Number(minimum) || 0),
    cost: round(Math.max(0, Number(cost) || 0), 4),
    lastCost: round(Math.max(0, Number(cost) || 0), 4),
    price: price === null || price === undefined || price === "" ? null : round(Math.max(0, Number(price) || 0), 2),
    stock: 0,
    archived: false,
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
}

function lineTotals(lines, unitKey) {
  let net = 0, vat = 0;
  lines.forEach((line) => {
    net += line.net;
    vat += round(line.net * (line.vatPct ?? VAT_RATE * 100) / 100);
  });
  net = round(net); vat = round(vat);
  return { net, vat, gross: round(net + vat), [unitKey]: round(lines.reduce((s, l) => s + l.qty, 0), QTY_DIGITS) };
}

// Alış faturası: stok artar, ağırlıklı ortalama maliyet güncellenir.
// itemsById: satırlardaki her kartın mevcut hali (yoksa null/undefined).
export function planPurchase(invoice, itemsById, { actor, now, makeId }) {
  const no = String(invoice.no || "").trim();
  if (!no) throw new Error("Fatura numarası gerekli.");
  if (!String(invoice.supplier || "").trim()) throw new Error("Tedarikçi gerekli.");
  if (!invoice.date) throw new Error("Fatura tarihi gerekli.");
  const sourceLines = (invoice.lines || []).filter((line) => cleanQty(line.qty) > 0);
  if (!sourceLines.length) throw new Error("Faturada stoğa girecek satır yok.");

  const items = new Map();
  const movements = [];
  const docLines = [];
  const invoiceId = docIdFromNumber("p", no);
  const ref = { type: "purchase", id: invoiceId, no };

  sourceLines.forEach((line) => {
    const id = itemIdFromSku(line.sku);
    const current = items.get(id) || itemsById[id] || null;
    const item = current ? { ...current } : newItem({ sku: line.sku, name: line.name, category: line.category, brand: line.brand, unit: line.unit || (Number.isInteger(Number(line.qty)) ? "adet" : "lt"), price: line.price ?? null }, now);
    const q = cleanQty(line.qty);
    const discountPct = Math.max(0, Number(line.discountPct) || 0);
    const gross = round(Number(line.unitPrice ?? line.unitCost) * q);
    const net = line.net !== undefined ? round(line.net) : round(gross * (1 - discountPct / 100));
    const unitCost = round(net / q, 4);
    const before = cleanQty(item.stock);
    const after = cleanQty(before + q);
    item.cost = before > 0 ? round((before * Number(item.cost || 0) + q * unitCost) / after, 4) : unitCost;
    item.lastCost = unitCost;
    item.stock = after;
    if (item.archived) item.archived = false;
    if ((item.price === null || item.price === undefined) && line.price !== undefined && line.price !== null && line.price !== "") item.price = round(Number(line.price), 2);
    item.updatedAt = now;
    items.set(id, item);
    movements.push({ id: makeId(), ...baseMovement({ item, qty: q, type: MOVE.PURCHASE, ref, actor, now, date: invoice.date, unitCost }), stockBefore: before, stockAfter: after });
    docLines.push({ itemId: id, sku: item.sku, name: line.name || item.name, qty: q, unitPrice: round(Number(line.unitPrice ?? unitCost), 4), discountPct, vatPct: line.vatPct ?? VAT_RATE * 100, net, isNew: !current });
  });

  const invoiceDoc = {
    id: invoiceId,
    kind: "purchase",
    no,
    supplier: String(invoice.supplier).trim(),
    date: invoice.date,
    source: invoice.source || "manual",
    lines: docLines,
    totals: lineTotals(docLines, "qty"),
    edmsGross: invoice.edmsGross ?? null,
    cancelled: false,
    actor,
    createdAt: now,
  };
  return { invoiceDoc, items: [...items.values()], movements };
}

// Satış / stok çıkışı. Stok yetersizse hata verir (allowNegative ile esnetilebilir).
// clampShort: (eDMS satışları için) stok yetmezse eldeki kadar düşülür, kalan miktar
// "kartsız parça" olarak ciroya yazılır; stok eksiye düşmez, satış kaybolmaz.
export function planIssue(issue, itemsById, { actor, now, makeId, allowNegative = false, clampShort = false }) {
  const no = String(issue.no || "").trim();
  if (!no) throw new Error("Belge numarası gerekli.");
  if (!issue.date) throw new Error("Tarih gerekli.");
  const lines = (issue.lines || []).filter((line) => cleanQty(line.qty) > 0);
  const services = buildServices(issue.services);
  const shortages = [];
  if (!lines.length && !services.length) throw new Error("En az bir parça veya işçilik kalemi ekleyin.");
  const items = new Map();
  const movements = [];
  const docLines = [];
  const issueId = docIdFromNumber("s", no);
  const ref = { type: "issue", id: issueId, no };
  lines.forEach((line) => {
    const id = line.itemId || itemIdFromSku(line.sku);
    const current = items.get(id) || itemsById[id];
    if (!current) throw new Error(`${line.sku || id} stok kartı bulunamadı.`);
    const item = { ...current };
    const fullQty = cleanQty(line.qty);
    const before = cleanQty(item.stock);
    const unitPrice = round(Number(line.unitPrice ?? item.price ?? 0), 4);
    const discountPct = Math.max(0, Number(line.discountPct) || 0);
    const fullNet = line.net !== undefined ? round(line.net) : round(unitPrice * fullQty * (1 - discountPct / 100));
    let q = fullQty;
    let net = fullNet;
    if (before - fullQty < 0 && clampShort) {
      q = Math.max(0, before);
      net = round(fullNet * (q / fullQty));
      const restQty = cleanQty(fullQty - q);
      services.push(...buildServices([{ kind: "part", code: item.sku, name: `${line.name || item.name} (stokta yoktu)`, qty: restQty, unitPrice, discountPct, vatPct: line.vatPct, net: round(fullNet - net) }]));
      shortages.push({ sku: item.sku, name: item.name, missing: restQty });
      if (q <= 0) return;
    }
    const after = cleanQty(before - q);
    if (after < 0 && !allowNegative) throw new Error(`${item.sku} · ${item.name}: stokta ${before} var, ${q} çıkılamaz.`);
    item.stock = after;
    item.updatedAt = now;
    items.set(id, item);
    movements.push({ id: makeId(), ...baseMovement({ item, qty: -q, type: MOVE.ISSUE, ref, actor, now, date: issue.date, unitCost: item.cost, unitPrice }), stockBefore: before, stockAfter: after });
    docLines.push({ itemId: id, sku: item.sku, name: line.name || item.name, qty: q, unitPrice, discountPct, vatPct: line.vatPct ?? VAT_RATE * 100, net, cost: round(Number(item.cost || 0) * q, 2) });
  });
  const totals = issueTotals(docLines, services);
  const issueDoc = {
    id: issueId,
    kind: "issue",
    no,
    date: issue.date,
    customer: String(issue.customer || "").trim(),
    plate: String(issue.plate || "").trim().toLocaleUpperCase("tr"),
    note: String(issue.note || "").trim(),
    source: issue.source || "manual",
    lines: docLines,
    services,
    totals,
    shortages,
    edmsGross: issue.edmsGross ?? null,
    cancelled: false,
    actor,
    createdAt: now,
  };
  return { issueDoc, items: [...items.values()], movements };
}

export function planAdjust(item, delta, { actor, now, makeId, note = "", date }) {
  const d = cleanQty(delta);
  if (!d) throw new Error("Düzeltme miktarı sıfır olamaz.");
  const before = cleanQty(item.stock);
  const after = cleanQty(before + d);
  if (after < 0) throw new Error("Stok eksiye düşemez.");
  const next = { ...item, stock: after, updatedAt: now };
  return { items: [next], movements: [{ id: makeId(), ...baseMovement({ item: next, qty: d, type: MOVE.ADJUST, ref: null, actor, now, date, note, unitCost: item.cost }), stockBefore: before, stockAfter: after }] };
}

// Sayım: sayılan miktar ile sistem farkı kadar hareket üretir.
export function planCount(lines, itemsById, { actor, now, makeId, date, countNo }) {
  const items = [];
  const movements = [];
  const ref = { type: "count", id: countNo, no: countNo };
  lines.forEach((line) => {
    const current = itemsById[line.itemId];
    if (!current) return;
    const counted = cleanQty(line.counted);
    if (counted < 0) throw new Error(`${current.sku}: sayım eksi olamaz.`);
    const before = cleanQty(current.stock);
    const diff = cleanQty(counted - before);
    if (!diff) return;
    const next = { ...current, stock: counted, updatedAt: now };
    items.push(next);
    movements.push({ id: makeId(), ...baseMovement({ item: next, qty: diff, type: MOVE.COUNT, ref, actor, now, date, unitCost: current.cost, note: "Sayım" }), stockBefore: before, stockAfter: counted });
  });
  return { items, movements };
}

// Alış faturası veya çıkış belgesini iptal eder: tüm satırları ters çevirir.
export function planReverse(doc, itemsById, { actor, now, makeId, date }) {
  if (doc.cancelled) throw new Error("Belge zaten iptal edilmiş.");
  const sign = doc.kind === "purchase" ? -1 : 1;
  const items = new Map();
  const movements = [];
  const ref = { type: doc.kind, id: doc.id, no: doc.no };
  doc.lines.forEach((line) => {
    const current = items.get(line.itemId) || itemsById[line.itemId];
    if (!current) return;
    const item = { ...current };
    const before = cleanQty(item.stock);
    const after = cleanQty(before + sign * line.qty);
    if (after < 0) throw new Error(`${item.sku}: iptal sonrası stok eksiye düşer (${before} var, ${line.qty} geri alınacak).`);
    item.stock = after;
    item.updatedAt = now;
    items.set(item.id, item);
    movements.push({ id: makeId(), ...baseMovement({ item, qty: sign * line.qty, type: MOVE.REVERSAL, ref, actor, now, date, note: `${doc.no} iptali` }), stockBefore: before, stockAfter: after });
  });
  return { doc: { ...doc, cancelled: true, cancelledAt: now, cancelledBy: actor }, items: [...items.values()], movements };
}

// İşçilik / hizmet ve stok kartı olmayan parça satırları: stoğa dokunmaz,
// ciroya girer. kind: "labor" (işçilik, kârın tamamı) | "part" (kartsız parça,
// maliyeti bilinmediği için kâra katılmaz).
export function buildServices(list) {
  return (list || []).map((line) => {
    const q = cleanQty(line.qty ?? 1) || 1;
    const unitPrice = round(Number(line.unitPrice) || 0, 4);
    const discountPct = Math.max(0, Number(line.discountPct) || 0);
    const net = line.net !== undefined && line.net !== null ? round(line.net) : round(unitPrice * q * (1 - discountPct / 100));
    return { kind: line.kind === "part" ? "part" : "labor", code: String(line.code || "").trim(), name: String(line.name || "İşçilik").trim(), qty: q, unitPrice, discountPct, vatPct: line.vatPct ?? VAT_RATE * 100, net };
  }).filter((line) => line.net !== 0 || line.name);
}

export function issueTotals(docLines, services = []) {
  const partsNet = round(docLines.reduce((s, l) => s + l.net, 0));
  const laborNet = round(services.filter((l) => l.kind === "labor").reduce((s, l) => s + l.net, 0));
  const otherNet = round(services.filter((l) => l.kind === "part").reduce((s, l) => s + l.net, 0));
  const all = [...docLines, ...services];
  const net = round(partsNet + laborNet + otherNet);
  const vat = round(all.reduce((s, l) => s + round(l.net * (l.vatPct ?? VAT_RATE * 100) / 100), 0));
  const cost = round(docLines.reduce((s, l) => s + (l.cost || 0), 0));
  return {
    qty: round(docLines.reduce((s, l) => s + l.qty, 0), QTY_DIGITS),
    partsNet, laborNet, otherNet, net, vat, gross: round(net + vat), cost,
    profit: round(partsNet - cost + laborNet),
  };
}

// Daha önce işçiliksiz kaydedilmiş bir satışa eDMS'teki işçilik satırlarını ekler.
export function planAddServices(doc, services, { actor, now }) {
  if (doc.cancelled) throw new Error("İptal edilmiş belgeye işçilik eklenemez.");
  if ((doc.services || []).length) throw new Error("Bu belgede işçilik zaten var.");
  const built = buildServices(services);
  if (!built.length) throw new Error("Eklenecek işçilik yok.");
  return { ...doc, services: built, totals: issueTotals(doc.lines, built), servicesAddedAt: now, servicesAddedBy: actor };
}
