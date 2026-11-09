// EUROREPAR eDMS "Fatura Raporu" (WDMR010, FATURA RAPORU(DETAY)) Excel çıktısı.
// Rapor tablo değil, art arda fatura bloklarından oluşur:
//   Tarih/No:  <tarih>  /  <fatura no>
//   Vade: / Firma: / Açıklama: / Tip: / Kaynak:
//   Stok/Hizmet | Kod | Açıklama | İndex | Birim Fiyat | Miktar | İskonto(%) | Kdv (%) | Toplam | İskonto | Kdv | Fatura Tutarı
//   Stok|Hizmet satırları...
//   (etiketsiz) toplam satırı
// `rows`: XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) çıktısı.

import { dateKeyFromCell, itemIdFromSku, looseKey, round, skuKey, toNumber } from "./format.js";

const DEFAULT_COLS = { code: 2, name: 7, unitPrice: 13, qty: 16, discountPct: 18, vatPct: 19, total: 21, discount: 22, vat: 23, gross: 24 };
const HEADER_NAMES = {
  code: ["kod"],
  name: ["açıklama", "aciklama"],
  unitPrice: ["birim fiyat"],
  qty: ["miktar"],
  discountPct: ["iskonto(%)", "iskonto (%)"],
  vatPct: ["kdv (%)", "kdv(%)"],
  total: ["toplam"],
  discount: ["iskonto"],
  vat: ["kdv"],
  gross: ["fatura tutarı", "fatura tutari"],
};

const text = (v) => (v === null || v === undefined ? "" : String(v).trim());
const norm = (v) => text(v).toLocaleLowerCase("tr").replace(/\s+/g, " ");

function firstValueAfter(row, start) {
  for (let i = start; i < row.length; i += 1) if (text(row[i])) return row[i];
  return null;
}
function lastValue(row) {
  for (let i = row.length - 1; i >= 0; i -= 1) if (text(row[i])) return row[i];
  return null;
}

function detectCols(row) {
  const cols = { ...DEFAULT_COLS };
  const found = {};
  row.forEach((cell, index) => {
    const n = norm(cell);
    if (!n || index === 0) return;
    Object.entries(HEADER_NAMES).forEach(([key, names]) => {
      if (found[key] === undefined && names.includes(n)) found[key] = index;
    });
  });
  return Object.keys(found).length >= 4 ? { ...cols, ...found } : cols;
}

export function classifyType(tip) {
  const t = norm(tip);
  if (t.includes("iade")) return "return";
  if (/sat[ıi]n\s*al/.test(t)) return "purchase";
  if (/sat[ıi][şs]/.test(t)) return "sale";
  return "other";
}

export function parseFaturaRaporu(rows) {
  const invoices = [];
  const errors = [];
  let current = null;
  let cols = { ...DEFAULT_COLS };
  let sawReport = false;
  const push = () => { if (current) invoices.push(current); current = null; };

  (rows || []).forEach((row, index) => {
    if (!Array.isArray(row)) return;
    const label = norm(row[0]).replace(/\s*:$/, ":");
    if (label === "tarih/no:") {
      sawReport = true;
      push();
      const date = dateKeyFromCell(firstValueAfter(row, 1));
      const no = text(lastValue(row));
      if (!date || !no || no === "/") { errors.push(`${index + 1}. satır: fatura tarihi/numarası okunamadı, blok atlandı.`); return; }
      current = { no, date, due: null, firm: "", note: "", type: "other", typeRaw: "", source: "", lines: [], reportGross: null };
      return;
    }
    if (!current) return;
    const value = firstValueAfter(row, 1);
    if (label === "vade:") current.due = dateKeyFromCell(value);
    else if (label === "firma:") current.firm = text(value);
    else if (label === "açıklama:" || label === "aciklama:") current.note = text(value);
    else if (label === "tip:") { current.typeRaw = text(value); current.type = classifyType(value); }
    else if (label === "kaynak:") current.source = text(value);
    else if (label === "stok/hizmet") cols = detectCols(row);
    else if (label === "stok" || label === "hizmet") {
      current.lines.push({
        kind: label === "stok" ? "Stok" : "Hizmet",
        code: text(row[cols.code]),
        name: text(row[cols.name]),
        unitPrice: toNumber(row[cols.unitPrice]),
        qty: toNumber(row[cols.qty]),
        discountPct: toNumber(row[cols.discountPct]),
        vatPct: row[cols.vatPct] === null || row[cols.vatPct] === undefined || row[cols.vatPct] === "" ? 20 : toNumber(row[cols.vatPct]),
        total: toNumber(row[cols.total]),
        discount: toNumber(row[cols.discount]),
        vat: toNumber(row[cols.vat]),
        gross: toNumber(row[cols.gross]),
      });
    } else if (!label && current.reportGross === null && text(row[cols.gross])) {
      current.reportGross = round(toNumber(row[cols.gross]));
    }
  });
  push();
  if (!sawReport) errors.push("Bu dosya eDMS \"Fatura Raporu\" (WDMR010) formatında görünmüyor.");
  return { invoices, errors };
}

const TOL = 0.05;

// Bir eDMS faturasını stok kartları ve kayıtlı belgelerle karşılaştırır.
export function analyzeInvoice(inv, items, existingIds) {
  const byKey = new Map();
  const byLoose = new Map();
  (items || []).forEach((item) => {
    byKey.set(skuKey(item.sku), item);
    const l = looseKey(item.sku);
    if (l && !byLoose.has(l)) byLoose.set(l, item);
  });
  const prefix = inv.type === "purchase" ? "p" : "s";
  let docId = null;
  try { docId = `${prefix}_${encodeURIComponent(inv.no.toLocaleUpperCase("tr")).replace(/\./g, "%2E")}`; } catch { docId = null; }
  const already = docId ? existingIds.has(docId) : false;
  let net = 0, vat = 0, edmsGross = 0, units = 0;
  const lines = inv.lines.map((line, index) => {
    const isStock = line.kind === "Stok" && line.code && line.qty > 0;
    const gross = round(line.unitPrice * line.qty);
    const lineNet = round(gross - (line.discountPct ? gross * line.discountPct / 100 : line.discount));
    const lineVat = round(lineNet * line.vatPct / 100);
    const edmsNet = round(line.total - line.discount);
    const amountOk = Math.abs(lineNet - edmsNet) <= TOL && Math.abs(lineVat - line.vat) <= TOL;
    let item = null, match = "service";
    if (isStock) {
      item = byKey.get(skuKey(line.code)) || null;
      match = item ? "exact" : (item = byLoose.get(looseKey(line.code)) || null) ? "loose" : "new";
      net += lineNet; vat += lineVat; edmsGross += line.gross; units += line.qty;
    }
    const stockBefore = item ? Number(item.stock) || 0 : 0;
    const stockAfter = round(inv.type === "purchase" ? stockBefore + line.qty : stockBefore - line.qty, 3);
    return { ...line, index, isStock, net: lineNet, vatAmount: lineVat, edmsNet, amountOk, match, item, stockBefore, stockAfter, short: inv.type === "sale" && isStock && stockAfter < 0 };
  });
  net = round(net); vat = round(vat); edmsGross = round(edmsGross);
  const stockLines = lines.filter((l) => l.isStock);
  const hasService = lines.some((l) => !l.isStock);
  const gross = round(net + vat);
  const totalsOk = Math.abs(gross - edmsGross) <= TOL * Math.max(1, stockLines.length) && (hasService || inv.reportGross === null || Math.abs(inv.reportGross - edmsGross) <= TOL * Math.max(1, stockLines.length));
  const linesOk = stockLines.every((l) => l.amountOk);
  return {
    ...inv,
    docId,
    already,
    lines,
    totals: { net, vat, gross, edmsGross, units: round(units, 3) },
    match: totalsOk && linesOk,
    counts: {
      stock: stockLines.length,
      exact: stockLines.filter((l) => l.match === "exact").length,
      loose: stockLines.filter((l) => l.match === "loose").length,
      fresh: stockLines.filter((l) => l.match === "new").length,
      service: lines.length - stockLines.length,
      short: stockLines.filter((l) => l.short).length,
    },
    importable: !already && stockLines.length > 0 && (inv.type === "purchase" || inv.type === "sale"),
  };
}

// Analiz edilmiş alış faturasını planPurchase girdisine çevirir.
// Gevşek eşleşen satırlar sistemdeki kartın stok koduyla işlenir (kopya kart açılmaz).
export function toPurchaseInput(analyzed) {
  return {
    no: analyzed.no,
    supplier: analyzed.firm || "eDMS tedarikçi",
    date: analyzed.date,
    source: "eDMS",
    edmsGross: analyzed.totals.edmsGross,
    lines: analyzed.lines.filter((l) => l.isStock).map((l) => ({
      sku: l.item ? l.item.sku : l.code,
      name: l.name,
      qty: l.qty,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      vatPct: l.vatPct,
      net: l.net,
      unit: Number.isInteger(l.qty) ? "adet" : "lt",
    })),
  };
}

// Analiz edilmiş satış faturasını planIssue girdisine çevirir (yalnızca kartı olan satırlar).
export function toIssueInput(analyzed) {
  const parts = analyzed.note.split("/").map((p) => p.trim());
  return {
    no: analyzed.no,
    date: analyzed.date,
    customer: analyzed.firm,
    plate: parts.length > 1 && /^[A-Z0-9]{11,17}$/i.test(parts[0]) ? parts[1] : "",
    note: analyzed.source ? `eDMS · ${analyzed.source}` : "eDMS",
    source: "eDMS",
    lines: analyzed.lines.filter((l) => l.isStock && l.item).map((l) => ({
      itemId: l.item.id,
      sku: l.item.sku,
      name: l.name,
      qty: l.qty,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      vatPct: l.vatPct,
      net: l.net,
    })),
  };
}

export function itemIdsFor(analyzed) {
  return [...new Set(analyzed.lines.filter((l) => l.isStock).map((l) => (l.item ? l.item.id : itemIdFromSku(l.code))))];
}
