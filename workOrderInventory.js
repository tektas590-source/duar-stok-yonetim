export function aggregateWorkOrderQuantities(items) {
  if (!Array.isArray(items)) throw new Error("İş emri parça listesi geçersiz.");
  const quantities = new Map();
  items.forEach((item) => {
    const partId = String(item?.partId || "").trim();
    const qty = Number(item?.qty);
    if (!partId || !Number.isInteger(qty) || qty <= 0) {
      throw new Error("İş emrindeki her parça için geçerli stok kodu ve pozitif adet girin.");
    }
    quantities.set(partId, (quantities.get(partId) || 0) + qty);
  });
  return quantities;
}

export function calculateWorkOrderReversal(part, quantity) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("İade edilecek iş emri adedi geçersiz.");
  const stockBefore = Number(part.stock || 0);
  return {
    stockBefore,
    stockAfter: stockBefore + qty,
    soldAfter: Math.max(0, Number(part.sold || 0) - qty),
  };
}

export function calculateWorkOrderQuantityDeltas(previousItems, nextItems) {
  const previous = aggregateWorkOrderQuantities(previousItems);
  const next = aggregateWorkOrderQuantities(nextItems);
  const partIds = new Set([...previous.keys(), ...next.keys()]);
  return [...partIds].map((partId) => ({
    partId,
    previousQty: previous.get(partId) || 0,
    nextQty: next.get(partId) || 0,
    delta: (next.get(partId) || 0) - (previous.get(partId) || 0),
  }));
}
