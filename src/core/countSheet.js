// Sayım / stok listesi Excel'i (eDMS stok listesi veya elle sayım) okuma ve
// sistem stoğuyla karşılaştırma.
import { looseKey, round, skuKey, toNumber } from "./format.js";

const SKU_WORDS = ["stok kodu", "parça kodu", "parca kodu", "malzeme kodu", "ürün kodu", "urun kodu", "referans", "sku", "kod", "parça no", "parca no"];
const NAME_WORDS = ["stok adı", "stok adi", "parça adı", "parca adi", "ürün adı", "urun adi", "malzeme adı", "açıklama", "aciklama", "tanım", "tanim", "ad"];
const QTY_WORDS = ["sayılan", "sayilan", "sayım", "sayim", "fiili", "bakiye", "mevcut", "miktar", "stok", "adet", "kalan"];

const norm = (v) => String(v ?? "").trim().toLocaleLowerCase("tr");

function score(cell, words) {
  const n = norm(cell);
  if (!n) return -1;
  const idx = words.findIndex((w) => n === w);
  if (idx >= 0) return 100 - idx;
  const part = words.findIndex((w) => n.includes(w));
  return part >= 0 ? 50 - part : -1;
}

function bestCol(row, words, taken) {
  let best = -1, bestScore = -1;
  row.forEach((cell, i) => {
    if (taken.includes(i)) return;
    const s = score(cell, words);
    if (s > bestScore) { bestScore = s; best = i; }
  });
  return bestScore >= 0 ? best : -1;
}

export function parseCountSheet(rows) {
  const data = (rows || []).filter(Array.isArray);
  let header = -1, cols = null;
  for (let r = 0; r < Math.min(data.length, 15); r += 1) {
    const sku = bestCol(data[r], SKU_WORDS, []);
    if (sku < 0) continue;
    const qtyCol = bestCol(data[r], QTY_WORDS, [sku]);
    if (qtyCol < 0) continue;
    const name = bestCol(data[r], NAME_WORDS, [sku, qtyCol]);
    header = r; cols = { sku, qty: qtyCol, name };
    break;
  }
  if (!cols) {
    cols = { sku: 0, name: 1, qty: 2 };
    const first = data.find((r) => r.some((c) => String(c ?? "").trim()));
    if (first && first.length === 2) cols = { sku: 0, name: -1, qty: 1 };
  }
  const merged = new Map();
  data.slice(header + 1).forEach((row) => {
    const sku = String(row[cols.sku] ?? "").trim();
    if (!sku || SKU_WORDS.includes(norm(sku))) return;
    const key = looseKey(sku);
    const prev = merged.get(key);
    const q = toNumber(row[cols.qty]);
    if (prev) prev.qty = round(prev.qty + q, 3);
    else merged.set(key, { sku, name: cols.name >= 0 ? String(row[cols.name] ?? "").trim() : "", qty: round(q, 3) });
  });
  return { lines: [...merged.values()], detected: header >= 0, cols };
}

export function compareCount(lines, items) {
  const byKey = new Map(), byLoose = new Map();
  (items || []).forEach((item) => { byKey.set(skuKey(item.sku), item); byLoose.set(looseKey(item.sku), item); });
  const seen = new Set();
  const rows = lines.map((line) => {
    const item = byKey.get(skuKey(line.sku)) || byLoose.get(looseKey(line.sku)) || null;
    if (item) seen.add(item.id);
    const system = item ? Number(item.stock) || 0 : null;
    const diff = item ? round(line.qty - system, 3) : null;
    return { sku: item ? item.sku : line.sku, name: item ? item.name : line.name, item, counted: line.qty, system, diff, status: !item ? "missing" : diff === 0 ? "ok" : "diff" };
  });
  (items || []).filter((item) => !item.archived && !seen.has(item.id) && (Number(item.stock) || 0) !== 0).forEach((item) => {
    rows.push({ sku: item.sku, name: item.name, item, counted: null, system: Number(item.stock) || 0, diff: null, status: "notcounted" });
  });
  return rows;
}
