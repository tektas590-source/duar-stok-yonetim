// Fiyat politikası: müşteriye hem kârlı hem uygun fiyat vermek için.
// Ucuz parçada kâr oranı yüksek, pahalı parçada düşük olur (fiyat-kademe).
// Kategoriye özel oran verilebilir. Her parça için üç seviye hesaplanır:
// Uygun (rekabetçi), Dengeli (önerilen), Kârlı. Alt sınırın altı zarar sayılır.
import { round } from "./format.js";

export const DEFAULT_POLICY = {
  bands: [
    { upTo: 100, markup: 70 },
    { upTo: 500, markup: 50 },
    { upTo: 2000, markup: 35 },
    { upTo: 10000, markup: 25 },
    { upTo: null, markup: 18 },
  ],
  categories: {},
  spread: 12, // Uygun = dengeli − 12 puan, Kârlı = dengeli + 12 puan
  minProfit: 40, // parça başına en az kâr (₺, KDV hariç)
  floorPct: 8, // alt sınır: alış + %8 (masraf payı)
  keepLastSale: true, // son satış fiyatı aralıktaysa korunur (müşteri tutarlılığı)
  laborRate: 2750, // saatlik işçilik ücreti (₺, KDV hariç)
  // Sık yapılan işler ve standart süreleri (saat). Atölyeye göre düzenlenebilir.
  laborJobs: [
    { name: "Periyodik bakım", hours: 1 },
    { name: "Arıza tespiti / diyagnoz", hours: 0.5 },
    { name: "Ön balata değişimi", hours: 0.75 },
    { name: "Arka balata değişimi", hours: 0.75 },
    { name: "Ön disk + balata değişimi", hours: 1.5 },
    { name: "Buji değişimi", hours: 0.5 },
    { name: "Polen filtresi değişimi", hours: 0.25 },
    { name: "Devirdaim değişimi", hours: 2 },
    { name: "Triger seti değişimi", hours: 3.5 },
    { name: "Debriyaj seti değişimi", hours: 5 },
    { name: "Ön amortisör değişimi (çift)", hours: 2 },
    { name: "Rot ayarı", hours: 0.75 },
  ],
};

export function normalizePolicy(p) {
  const d = DEFAULT_POLICY;
  const bands = Array.isArray(p?.bands) && p.bands.length ? p.bands : d.bands;
  return {
    bands: bands.map((b) => ({ upTo: b.upTo === null || b.upTo === "" || b.upTo === undefined ? null : Number(b.upTo), markup: Math.max(0, Number(b.markup) || 0) }))
      .sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity)),
    categories: Object.fromEntries(Object.entries(p?.categories || {}).filter(([, v]) => v !== "" && v !== null && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])),
    spread: Number.isFinite(Number(p?.spread)) ? Math.max(0, Number(p.spread)) : d.spread,
    minProfit: Number.isFinite(Number(p?.minProfit)) ? Math.max(0, Number(p.minProfit)) : d.minProfit,
    floorPct: Number.isFinite(Number(p?.floorPct)) ? Math.max(0, Number(p.floorPct)) : d.floorPct,
    keepLastSale: p?.keepLastSale !== undefined ? Boolean(p.keepLastSale) : d.keepLastSale,
    laborRate: Number(p?.laborRate) > 0 ? Number(p.laborRate) : d.laborRate,
    laborJobs: (Array.isArray(p?.laborJobs) ? p.laborJobs : d.laborJobs).map((j) => ({ name: String(j.name || "").trim(), hours: Math.max(0, Number(j.hours) || 0) })).filter((j) => j.name),
  };
}

// Okunur fiyata yukarı yuvarla.
export function roundPrice(v) {
  const x = Number(v) || 0;
  if (x <= 0) return 0;
  const step = x < 50 ? 0.5 : x < 500 ? 1 : x < 5000 ? 5 : 10;
  return round(Math.ceil(x / step - 1e-9) * step, 2);
}

export function baseMarkup(cost, category, policy) {
  const p = normalizePolicy(policy);
  if (category && p.categories[category] !== undefined) return p.categories[category];
  const band = p.bands.find((b) => b.upTo === null || cost <= b.upTo) || p.bands[p.bands.length - 1];
  return band.markup;
}

const priceAt = (cost, markup, minProfit) => roundPrice(Math.max(cost * (1 + markup / 100), cost + minProfit));

// cost: güncel alış (KDV hariç). lastSale: { unit } (KDV hariç), varsa.
export function tierPrices(cost, { category = "", lastSale = null, policy } = {}) {
  const p = normalizePolicy(policy);
  const c = Number(cost) || 0;
  if (c <= 0) return null;
  const m = baseMarkup(c, category, p);
  const floor = roundPrice(c * (1 + p.floorPct / 100));
  const uygun = Math.max(floor, priceAt(c, Math.max(p.floorPct, m - p.spread), p.minProfit * 0.6));
  const dengeli = Math.max(uygun, priceAt(c, m, p.minProfit));
  const karli = Math.max(dengeli, priceAt(c, m + p.spread, p.minProfit * 1.3));
  let recommended = dengeli;
  let reason = `%${m} kâr kuralı`;
  const ls = Number(lastSale?.unit) || 0;
  if (p.keepLastSale && ls > 0 && ls >= uygun && ls <= karli) { recommended = roundPrice(ls); reason = "son satış fiyatı korunuyor"; }
  const pct = (price) => round(((price - c) / c) * 100, 1);
  return { cost: c, markup: m, floor, uygun, dengeli, karli, recommended, reason, markups: { uygun: pct(uygun), dengeli: pct(dengeli), karli: pct(karli), recommended: pct(recommended) } };
}

export const TIERS = [
  { id: "uygun", label: "Uygun", hint: "Rekabetçi, müşteriyi kaçırma" },
  { id: "dengeli", label: "Dengeli", hint: "Önerilen" },
  { id: "karli", label: "Kârlı", hint: "Acil / tek tedarik / özel parça" },
];

// Teklif toplamı: satırlar { qty, price, cost } + işçilik { qty, price }.
export function quoteTotals(lines, labor, vatRate = 0.2) {
  const parts = round(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0));
  const cost = round(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0));
  const laborNet = round(labor.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0));
  const net = round(parts + laborNet);
  const profit = round(parts - cost + laborNet);
  return { parts, cost, labor: laborNet, net, vat: round(net * vatRate), gross: round(net * (1 + vatRate)), profit, partsProfit: round(parts - cost), margin: net > 0 ? round((profit / net) * 100, 1) : 0 };
}

// Müşteriye söylenecek KDV dahil toplama göre parça fiyatlarını orantılı ayarla.
// Hiçbir parça alt sınırın altına inmez. { lines, reachable, minGross }
export function fitToTarget(lines, labor, targetGross, vatRate = 0.2) {
  const laborNet = labor.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const targetParts = targetGross / (1 + vatRate) - laborNet;
  const floors = lines.map((l) => Number(l.floor) || Number(l.cost) || 0);
  const minParts = lines.reduce((s, l, i) => s + floors[i] * (Number(l.qty) || 0), 0);
  const minGross = round((minParts + laborNet) * (1 + vatRate));
  const current = lines.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.qty) || 0), 0);
  if (!lines.length || current <= 0) return { lines, reachable: targetParts >= minParts, minGross };
  // Önce oranla ölçekle, alt sınıra takılanları sabitleyip kalanı yeniden dağıt.
  let fixed = new Set();
  let out = lines.map((l) => ({ ...l }));
  for (let pass = 0; pass < 5; pass += 1) {
    const fixedSum = out.reduce((s, l, i) => s + (fixed.has(i) ? l.price * l.qty : 0), 0);
    const freeSum = lines.reduce((s, l, i) => s + (fixed.has(i) ? 0 : l.price * l.qty), 0);
    const k = freeSum > 0 ? Math.max(0, (targetParts - fixedSum) / freeSum) : 1;
    let changed = false;
    out = out.map((l, i) => {
      if (fixed.has(i)) return l;
      const p = round(lines[i].price * k, 2);
      if (p < floors[i]) { fixed.add(i); changed = true; return { ...l, price: floors[i], tier: "manual" }; }
      return { ...l, price: p, tier: "manual" };
    });
    if (!changed) break;
  }
  return { lines: out, reachable: targetParts >= minParts - 0.01, minGross };
}

// İşçilik tutarı = saat × saatlik ücret (KDV hariç).
export function laborPrice(hours, rate) {
  return Math.round((Number(hours) || 0) * (Number(rate) || 0) * 100) / 100;
}

// eDMS iş emrinde birim fiyat sabittir; fiyat yalnızca iskonto % ile düşürülür.
// discountFor: liste fiyatından teklif fiyatına inmek için gereken iskonto (2 hane).
export function discountFor(list, price) {
  const l = Number(list) || 0;
  const p = Number(price) || 0;
  if (l <= 0 || p <= 0) return null;
  return Math.round((1 - p / l) * 10000) / 100;
}
// priceFromDiscount: eDMS'in hesaplayacağı fiyat (liste × (1 − iskonto)).
export function priceFromDiscount(list, pct) {
  return Math.round((Number(list) || 0) * (1 - (Number(pct) || 0) / 100) * 100) / 100;
}
