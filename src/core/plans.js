// Ön tespitler: araç gelmeden belirlenen parçalar ve işçilik.
import { looseKey, round, VAT_RATE } from "./format.js";

export const PLAN_STATUS = { open: "Bekliyor", done: "Satışa döndü", cancelled: "İptal" };

export function planTotals(plan) {
  const parts = round((plan.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0));
  const labor = round((plan.labor || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0));
  const net = round(parts + labor);
  return { parts, labor, net, vat: round(net * VAT_RATE), gross: round(net * (1 + VAT_RATE)) };
}

// Açık tespitlerde ayrılan miktarlar: itemId → { qty, plans: [{ id, plate, customer, qty }] }
export function reservedMap(plans, items) {
  const bySku = new Map((items || []).map((i) => [looseKey(i.sku), i]));
  const map = new Map();
  (plans || []).filter((p) => p.status === "open").forEach((p) => (p.lines || []).forEach((l) => {
    const id = l.itemId || bySku.get(looseKey(l.sku))?.id;
    if (!id) return;
    const r = map.get(id) || { qty: 0, plans: [] };
    r.qty = round(r.qty + (Number(l.qty) || 0), 3);
    r.plans.push({ id: p.id, plate: p.plate, customer: p.customer, qty: l.qty });
    map.set(id, r);
  }));
  return map;
}

// Tespitteki her parçanın stok durumu: hazır / eksik / kart yok.
export function planReadiness(plan, items, reserved) {
  const bySku = new Map((items || []).map((i) => [looseKey(i.sku), i]));
  const byId = new Map((items || []).map((i) => [i.id, i]));
  return (plan.lines || []).map((l) => {
    const item = (l.itemId && byId.get(l.itemId)) || bySku.get(looseKey(l.sku)) || null;
    if (!item) return { ...l, item: null, state: "nocard" };
    const stock = Number(item.stock) || 0;
    // Bu tespit dışındaki açık tespitlerin ayırdığı miktar.
    const others = (reserved?.get(item.id)?.plans || []).filter((x) => x.id !== plan.id).reduce((s, x) => s + (Number(x.qty) || 0), 0);
    const free = round(stock - others, 3);
    return { ...l, item, stock, free, state: free >= l.qty ? "ready" : "short" };
  });
}

export function nextPlanNo(plans) {
  const n = (plans || []).map((p) => Number(String(p.no || "").replace(/\D/g, "")) || 0).reduce((a, b) => Math.max(a, b), 0);
  return `T-${String(n + 1).padStart(4, "0")}`;
}
