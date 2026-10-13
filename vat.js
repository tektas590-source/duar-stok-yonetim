export const VAT_RATE = 0.2;

export function calculateVat(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new Error("KDV hesaplaması için geçerli ve sıfırdan büyük/eşit bir tutar gereklidir.");
  const subtotal = Math.round((value + Number.EPSILON) * 100) / 100;
  const vat = Math.round((subtotal * VAT_RATE + Number.EPSILON) * 100) / 100;
  return { subtotal, vat, total: Math.round((subtotal + vat + Number.EPSILON) * 100) / 100 };
}

export function vatIncludedAmount(amount) {
  return calculateVat(amount).total;
}
