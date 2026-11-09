// Stok seviyesi, özet metrikler, tüketim ve listeleme mantığı.
import { looseKey, round } from "./format.js";

export const LEVEL_LABEL = { out: "Tükendi", critical: "Kritik", low: "Azalıyor", good: "Yeterli" };
const LEVEL_ORDER = ["out", "critical", "low", "good"];
const DAY = 86400000;

export function level(item) {
  const stock = Number(item?.stock) || 0;
  const min = Number(item?.minimum) || 0;
  if (stock <= 0) return "out";
  if (stock <= min) return "critical";
  if (stock <= min * 2) return "low";
  return "good";
}

export function activeItems(items) {
  return (items || []).filter((item) => !item.archived);
}

export function summarize(items) {
  const list = activeItems(items);
  const s = { total: list.length, units: 0, costValue: 0, saleValue: 0, out: 0, critical: 0, low: 0, good: 0, noPrice: 0 };
  list.forEach((item) => {
    const stock = Math.max(0, Number(item.stock) || 0);
    s.units += stock;
    s.costValue += stock * (Number(item.cost) || 0);
    if (item.price === null || item.price === undefined) s.noPrice += 1;
    else s.saleValue += stock * Number(item.price);
    s[level(item)] += 1;
  });
  s.units = round(s.units, 3);
  s.costValue = round(s.costValue);
  s.saleValue = round(s.saleValue);
  s.health = s.total ? Math.round(((s.total - s.out - s.critical) / s.total) * 100) : 100;
  return s;
}

export function abcClasses(items) {
  const list = activeItems(items).map((item) => ({ id: item.id, value: Math.max(0, Number(item.stock) || 0) * (Number(item.cost) || 0) })).sort((a, b) => b.value - a.value);
  const total = list.reduce((s, x) => s + x.value, 0);
  const map = new Map();
  let run = 0;
  list.forEach((x) => {
    map.set(x.id, !total || x.value <= 0 ? "C" : run / total < 0.8 ? "A" : run / total < 0.95 ? "B" : "C");
    run += x.value;
  });
  return map;
}

// Son `days` gündeki çıkışlara göre günlük tüketim ve stoğun kaç gün yeteceği.
export function usageMap(items, movements, { days = 90, now = Date.now() } = {}) {
  const cutoff = new Date(now - days * DAY).toISOString().slice(0, 10);
  const out = new Map();
  (movements || []).forEach((m) => {
    if (m.type !== "issue" || (m.date || "") < cutoff) return;
    out.set(m.itemId, (out.get(m.itemId) || 0) - Number(m.qty || 0));
  });
  const map = new Map();
  (items || []).forEach((item) => {
    const used = round(out.get(item.id) || 0, 3);
    const daily = used / days;
    map.set(item.id, { used, daily, cover: daily > 0 ? Math.floor(Math.max(0, Number(item.stock) || 0) / daily) : null });
  });
  return map;
}

// Mevcut stoktan geriye sararak son `days` günün gün sonu stok serisi.
export function stockSeries(item, movements, { days = 60, now = Date.now() } = {}) {
  const byDay = new Map();
  (movements || []).forEach((m) => {
    if (m.itemId !== item.id) return;
    byDay.set(m.date, (byDay.get(m.date) || 0) + Number(m.qty || 0));
  });
  const series = [];
  let lvl = Number(item.stock) || 0;
  for (let i = 0; i < days; i += 1) {
    const day = new Date(now - i * DAY).toISOString().slice(0, 10);
    series.push({ date: day, value: round(lvl, 3) });
    lvl -= byDay.get(day) || 0;
  }
  return series.reverse();
}

// Gün bazında giriş/çıkış değeri (rapor grafiği).
export function flowSeries(movements, { days = 30, now = Date.now() } = {}) {
  const map = new Map();
  for (let i = days - 1; i >= 0; i -= 1) map.set(new Date(now - i * DAY).toISOString().slice(0, 10), { inValue: 0, outValue: 0 });
  (movements || []).forEach((m) => {
    const bucket = map.get(m.date);
    if (!bucket) return;
    const value = Math.abs(Number(m.qty || 0)) * Number(m.unitCost || 0);
    if (m.type === "purchase") bucket.inValue += value;
    if (m.type === "issue") bucket.outValue += value;
  });
  return [...map.entries()].map(([date, v]) => ({ date, inValue: round(v.inValue), outValue: round(v.outValue) }));
}

const SORTERS = {
  level: (a, b) => LEVEL_ORDER.indexOf(level(a)) - LEVEL_ORDER.indexOf(level(b)),
  name: (a, b) => String(a.name).localeCompare(String(b.name), "tr"),
  sku: (a, b) => String(a.sku).localeCompare(String(b.sku), "tr"),
  stock: (a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0),
  value: (a, b) => (Number(a.stock) || 0) * (Number(a.cost) || 0) - (Number(b.stock) || 0) * (Number(b.cost) || 0),
  cost: (a, b) => (Number(a.cost) || 0) - (Number(b.cost) || 0),
  price: (a, b) => (Number(a.price) || 0) - (Number(b.price) || 0),
  updated: (a, b) => String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")),
};

export function filterItems(items, { query = "", lvl = "all", category = "all", brand = "all", favorites = false, archived = false, sort = "level", dir = "asc" } = {}) {
  const needle = String(query).trim().toLocaleLowerCase("tr");
  const loose = looseKey(query);
  const list = (items || []).filter((item) => {
    if (Boolean(item.archived) !== archived) return false;
    if (favorites && !item.favorite) return false;
    if (lvl === "attention") { const l = level(item); if (l !== "out" && l !== "critical") return false; }
    else if (lvl !== "all" && level(item) !== lvl) return false;
    if (category !== "all" && (item.category || "") !== category) return false;
    if (brand !== "all" && (item.brand || "") !== brand) return false;
    if (!needle) return true;
    const hay = `${item.name} ${item.sku} ${item.category || ""} ${item.brand || ""} ${item.location || ""}`.toLocaleLowerCase("tr");
    return hay.includes(needle) || (loose.length >= 3 && looseKey(item.sku).includes(loose));
  });
  const sorter = SORTERS[sort] || SORTERS.level;
  return list.sort((a, b) => {
    const r = sorter(a, b);
    return r ? (dir === "desc" ? -r : r) : SORTERS.name(a, b);
  });
}

// Kritik stok için sipariş önerisi: minimumun 2 katına tamamla, tüketim varsa 30 günlük ihtiyaç.
export function reorderSuggestions(items, usage) {
  return activeItems(items)
    .filter((item) => (Number(item.stock) || 0) <= (Number(item.minimum) || 0))
    .map((item) => {
      const stock = Math.max(0, Number(item.stock) || 0);
      const min = Number(item.minimum) || 0;
      const u = usage?.get(item.id);
      const target = Math.max(min * 2, u ? Math.ceil(u.daily * 30) : 0, 1);
      const suggest = Math.max(1, Math.ceil(target - stock));
      return { item, stock, suggest, value: round(suggest * (Number(item.lastCost || item.cost) || 0)) };
    })
    .sort((a, b) => a.stock - b.stock || String(a.item.name).localeCompare(String(b.item.name), "tr"));
}
