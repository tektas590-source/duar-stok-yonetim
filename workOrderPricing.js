import { calculateVat } from "./vat.js";

const LABOR_AMOUNT_ERROR = "İşçilik tutarı sıfır veya daha büyük, geçerli bir sayı olmalıdır.";
const DISCOUNT_TYPE_ERROR = "İskonto türü geçersiz.";
const DISCOUNT_PERCENT_ERROR = "İskonto yüzdesi 0 ile 100 arasında olmalıdır.";
const DISCOUNT_AMOUNT_ERROR = "İskonto tutarı sıfır veya daha büyük, geçerli bir sayı olmalıdır.";
const DISCOUNT_EXCEEDS_ERROR = "İskonto tutarı, uygulandığı tutardan büyük olamaz.";

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

// İskonto girdisini normalize eder: tür "none" | "percent" | "amount" olabilir.
// Boş/eksik girdi "none" (iskonto yok) olarak kabul edilir. Hem tek bir parça
// satırına hem işçiliğe uygulanabilir — taban tutar her ikisinde de kendi
// (KDV hariç) tutarıdır.
export function normalizeDiscount(discount) {
  if (discount === undefined || discount === null) return { type: "none", value: 0 };
  const type = discount.type || "none";
  if (type === "none") return { type: "none", value: 0 };
  if (type === "percent") {
    const value = Number(discount.value);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(DISCOUNT_PERCENT_ERROR);
    return { type: "percent", value: roundCurrency(value) };
  }
  if (type === "amount") {
    const value = Number(discount.value);
    if (!Number.isFinite(value) || value < 0) throw new Error(DISCOUNT_AMOUNT_ERROR);
    return { type: "amount", value: roundCurrency(value) };
  }
  throw new Error(DISCOUNT_TYPE_ERROR);
}

// Verilen taban tutar (bir parça satırının veya işçiliğin KDV hariç tutarı)
// üzerinden iskonto tutarını hesaplar.
export function calculateDiscountAmount(baseAmount, discount) {
  const normalized = normalizeDiscount(discount);
  const base = roundCurrency(Math.max(0, Number(baseAmount) || 0));
  if (normalized.type === "none") return 0;
  if (normalized.type === "percent") return roundCurrency(base * (normalized.value / 100));
  // amount
  if (normalized.value > base) throw new Error(DISCOUNT_EXCEEDS_ERROR);
  return normalized.value;
}

// Bir parça satırının brüt (iskontosuz) ve net (iskonto sonrası) tutarını
// hesaplar. İskonto, satırın kendi `item.discount` alanından okunur.
function calculateLinePricing(item) {
  const quantity = Number(item?.qty);
  const rawPrice = item?.price;
  const hasPrice = rawPrice !== undefined && rawPrice !== null && !(typeof rawPrice === "string" && rawPrice.trim() === "");
  const price = Number(rawPrice);
  if (!Number.isInteger(quantity) || quantity <= 0 || !hasPrice || !Number.isFinite(price) || price < 0) {
    throw new Error("İş emrindeki parça miktarı veya satış fiyatı geçersiz.");
  }
  const gross = roundCurrency(quantity * price);
  const discount = normalizeDiscount({ type: item?.discountType, value: item?.discountValue });
  const discountAmount = calculateDiscountAmount(gross, discount);
  return { gross, discount, discountAmount, net: roundCurrency(gross - discountAmount) };
}

function calculateWorkOrderPartsBreakdown(items) {
  if (!Array.isArray(items)) throw new Error("İş emri parça listesi geçersiz.");
  return items.reduce((acc, item) => {
    const line = calculateLinePricing(item);
    acc.gross = roundCurrency(acc.gross + line.gross);
    acc.discountTotal = roundCurrency(acc.discountTotal + line.discountAmount);
    acc.net = roundCurrency(acc.net + line.net);
    return acc;
  }, { gross: 0, discountTotal: 0, net: 0 });
}

// Her parça satırının kendi iskontosu düşüldükten sonraki (net) toplamı.
export function calculateWorkOrderPartsSubtotal(items) {
  return calculateWorkOrderPartsBreakdown(items).net;
}

export function calculateWorkOrderNetTotal(items, laborAmount = 0, externalLabor = [], laborDiscount = { type: "none", value: 0 }) {
  const partsSubtotal = calculateWorkOrderPartsSubtotal(items);
  const normalizedLaborAmount = normalizeLaborAmount(laborAmount);
  const laborDiscountAmount = calculateDiscountAmount(normalizedLaborAmount, laborDiscount);
  const netLabor = roundCurrency(normalizedLaborAmount - laborDiscountAmount);
  const externalLaborSubtotal = externalLabor.reduce((sum, el) => {
    const price = Number(el?.price) || 0;
    return sum + price;
  }, 0);
  return roundCurrency(partsSubtotal + netLabor + externalLaborSubtotal);
}

export function calculateWorkOrderPriceBreakdown(items, laborAmount = 0, externalLabor = [], laborDiscount = { type: "none", value: 0 }) {
  const partsBreakdown = calculateWorkOrderPartsBreakdown(items);
  const normalizedLaborAmount = normalizeLaborAmount(laborAmount);
  const normalizedLaborDiscount = normalizeDiscount(laborDiscount);
  const laborDiscountAmount = calculateDiscountAmount(normalizedLaborAmount, normalizedLaborDiscount);
  const laborNet = roundCurrency(normalizedLaborAmount - laborDiscountAmount);
  const externalLaborSubtotal = externalLabor.reduce((sum, el) => {
    const price = Number(el?.price) || 0;
    return sum + price;
  }, 0);
  const externalLaborCost = externalLabor.reduce((sum, el) => {
    const cost = Number(el?.cost) || 0;
    return sum + cost;
  }, 0);
  const subtotal = roundCurrency(partsBreakdown.net + laborNet + externalLaborSubtotal);
  const totals = calculateVat(subtotal);
  return {
    partsGross: partsBreakdown.gross,
    partsDiscountTotal: partsBreakdown.discountTotal,
    partsSubtotal: partsBreakdown.net,
    laborAmount: normalizedLaborAmount,
    laborDiscountType: normalizedLaborDiscount.type,
    laborDiscountValue: normalizedLaborDiscount.value,
    laborDiscountAmount,
    laborNet,
    externalLaborSubtotal,
    externalLaborCost,
    externalLaborProfit: roundCurrency(externalLaborSubtotal - externalLaborCost),
    subtotal: totals.subtotal,
    vat: totals.vat,
    total: totals.total,
  };
}
