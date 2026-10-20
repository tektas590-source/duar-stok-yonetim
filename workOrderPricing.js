import { calculateVat } from "./vat.js";

const LABOR_AMOUNT_ERROR = "İşçilik tutarı sıfır veya daha büyük, geçerli bir sayı olmalıdır.";

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizeLaborAmount(value) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return 0;
  if (typeof value !== "number" && typeof value !== "string") throw new Error(LABOR_AMOUNT_ERROR);
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(LABOR_AMOUNT_ERROR);
  return roundCurrency(amount);
}

export function calculateWorkOrderPartsSubtotal(items) {
  if (!Array.isArray(items)) throw new Error("İş emri parça listesi geçersiz.");
  const subtotal = items.reduce((sum, item) => {
    const quantity = Number(item?.qty);
    const rawPrice = item?.price;
    const hasPrice = rawPrice !== undefined && rawPrice !== null && !(typeof rawPrice === "string" && rawPrice.trim() === "");
    const price = Number(rawPrice);
    if (!Number.isInteger(quantity) || quantity <= 0 || !hasPrice || !Number.isFinite(price) || price < 0) {
      throw new Error("İş emrindeki parça miktarı veya satış fiyatı geçersiz.");
    }
    return sum + quantity * price;
  }, 0);
  return roundCurrency(subtotal);
}

export function calculateWorkOrderNetTotal(items, laborAmount = 0, externalLabor = []) {
  const partsSubtotal = calculateWorkOrderPartsSubtotal(items);
  const normalizedLaborAmount = normalizeLaborAmount(laborAmount);
  const externalLaborSubtotal = externalLabor.reduce((sum, el) => {
    const price = Number(el?.price) || 0;
    return sum + price;
  }, 0);
  return roundCurrency(partsSubtotal + normalizedLaborAmount + externalLaborSubtotal);
}

export function calculateWorkOrderPriceBreakdown(items, laborAmount = 0, externalLabor = []) {
  const partsSubtotal = calculateWorkOrderPartsSubtotal(items);
  const normalizedLaborAmount = normalizeLaborAmount(laborAmount);
  const externalLaborSubtotal = externalLabor.reduce((sum, el) => {
    const price = Number(el?.price) || 0;
    return sum + price;
  }, 0);
  const externalLaborCost = externalLabor.reduce((sum, el) => {
    const cost = Number(el?.cost) || 0;
    return sum + cost;
  }, 0);
  const totals = calculateVat(roundCurrency(partsSubtotal + normalizedLaborAmount + externalLaborSubtotal));
  return {
    partsSubtotal,
    laborAmount: normalizedLaborAmount,
    externalLaborSubtotal,
    externalLaborCost,
    externalLaborProfit: roundCurrency(externalLaborSubtotal - externalLaborCost),
    subtotal: totals.subtotal,
    vat: totals.vat,
    total: totals.total,
  };
}
