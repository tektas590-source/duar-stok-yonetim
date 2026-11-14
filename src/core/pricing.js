// Fiyatlandırma: her parçanın son alış ve son satış fiyatı, alış fiyatındaki
// değişim ve güncel alışa göre önerilen satış fiyatı. Tutarlar KDV hariç.
import { round, VAT_RATE } from "./format.js";

export const DEFAULT_MARKUP = 35; // %

// Müşteriye verilecek fiyatı okunur bir sayıya yukarı yuvarlar.
export function roundPrice(v) {
  const x = Number(v) || 0;
  if (x <= 0) return 0;
  const step = x < 50 ? 0.5 : x < 500 ? 1 : x < 5000 ? 5 : 10;
  return round(Math.ceil(x / step - 1e-9) * step, 2);
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// itemId → { purchases: [...yeniden eskiye], sales: [...yeniden eskiye] }
export function priceHistory(invoices, issues) {
  const map = new Map();
  const get = (id) => { if (!map.has(id)) map.set(id, { purchases: [], sales: [] }); return map.get(id); };
  (invoices || []).filter((d) => !d.cancelled).forEach((d) => d.lines.forEach((l) => {
    if (!l.itemId || !(l.qty > 0)) return;
    get(l.itemId).purchases.push({ date: d.date, at: d.createdAt || "", no: d.no, supplier: d.supplier, qty: l.qty, unit: round(l.net / l.qty, 4) });
  }));
  (issues || []).filter((d) => !d.cancelled).forEach((d) => d.lines.forEach((l) => {
    if (!l.itemId || !(l.qty > 0)) return;
    get(l.itemId).sales.push({ date: d.date, at: d.createdAt || "", no: d.no, customer: d.customer || "Tezgah", plate: d.plate || "", qty: l.qty, unit: round(l.net / l.qty, 4), costUnit: round((l.cost || 0) / l.qty, 4) });
  }));
  const order = (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.at).localeCompare(String(a.at));
  map.forEach((h) => {
    h.purchases.sort(order); h.sales.sort(order);
    // Satış anındaki alış fiyatı: o tarihte veya önce yapılan son alış (yoksa kayıtlı maliyet).
    // Ortalama maliyet sayım/düzeltmelerle sapabildiği için kâr oranı buna göre hesaplanır.
    h.sales.forEach((sale) => {
      const buy = h.purchases.find((p) => String(p.date) <= String(sale.date));
      sale.buyUnit = buy ? buy.unit : (sale.costUnit || 0);
    });
  });
  return map;
}

// Tek parça için fiyat özeti.
export function itemPricing(item, history, defaultMarkup = DEFAULT_MARKUP) {
  const h = history || { purchases: [], sales: [] };
  const lastBuy = h.purchases[0] || null;
  const prevBuy = h.purchases.find((p) => lastBuy && Math.abs(p.unit - lastBuy.unit) > 0.0001) || null;
  const lastCost = round(Number(lastBuy?.unit ?? item.lastCost ?? item.cost) || 0, 4);
  const lastSale = h.sales[0] || null;
  const costChangePct = lastBuy && prevBuy && prevBuy.unit > 0 ? round(((lastBuy.unit - prevBuy.unit) / prevBuy.unit) * 100, 1) : null;

  // Hedef kâr: bu parçanın geçmiş satışlarındaki kâr oranı (son 5 satış medyanı), yoksa varsayılan.
  const markups = h.sales.slice(0, 5).filter((s) => s.buyUnit > 0 && s.unit > 0).map((s) => (s.unit / s.buyUnit - 1) * 100);
  const historical = markups.length ? Math.min(150, Math.max(5, median(markups))) : null;
  const markup = round(historical ?? (Number(defaultMarkup) || DEFAULT_MARKUP), 1);
  const base = lastCost || Number(item.cost) || 0;
  const suggested = base > 0 ? roundPrice(base * (1 + markup / 100)) : null;

  // Son satıştan bu yana alış fiyatı arttı mı?
  const saleCost = lastSale?.buyUnit || 0;
  const costRiseSinceSale = lastSale && saleCost > 0 && lastCost > saleCost * 1.01 ? round(((lastCost - saleCost) / saleCost) * 100, 1) : null;
  const price = item.price === null || item.price === undefined ? null : Number(item.price);
  const priceLow = price !== null && suggested !== null && price < suggested * 0.97;
  const lastSaleMarginNow = lastSale && lastSale.unit > 0 && lastCost > 0 ? round(((lastSale.unit - lastCost) / lastSale.unit) * 100, 1) : null;
  return {
    lastCost, lastBuy, prevBuy, costChangePct,
    lastSale, lastSaleMarginNow,
    markup, markupSource: historical !== null ? "geçmiş satışlar" : "varsayılan",
    suggested, suggestedGross: suggested !== null ? roundPrice(suggested * (1 + VAT_RATE)) : null,
    costRiseSinceSale, priceLow,
    needsUpdate: Boolean(costRiseSinceSale !== null || priceLow || (costChangePct !== null && costChangePct > 1 && (!lastSale || lastSale.date < lastBuy.date))),
  };
}

export function buildPricing(items, invoices, issues, defaultMarkup = DEFAULT_MARKUP) {
  const history = priceHistory(invoices, issues);
  return new Map((items || []).map((i) => [i.id, { ...itemPricing(i, history.get(i.id), defaultMarkup), history: history.get(i.id) || { purchases: [], sales: [] } }]));
}
