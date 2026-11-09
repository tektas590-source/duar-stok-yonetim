// Stok Takip sayfasının saf (Firestore'a / React'e dokunmayan) mantığı:
// stok seviyesi sınıflandırması, özet metrikler, parça bazlı tüketim/yeterlilik
// hesabı ve eDMS "Fatura Raporu" (WDMR010) Satın Alma faturalarının sistemdeki
// parça kartları ve faturalarla birebir karşılaştırılması.

export const STOCK_LEVEL = {
  OUT: "out",
  CRITICAL: "critical",
  LOW: "low",
  GOOD: "good",
};

export const STOCK_LEVEL_LABEL = {
  out: "Tükendi",
  critical: "Kritik",
  low: "Azalıyor",
  good: "Yeterli",
};

const DAY_MS = 86400000;
const TOLERANCE = 0.05; // kuruş yuvarlama farkı

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizeSkuKey(value) {
  return String(value || "").trim().toLocaleLowerCase("tr");
}

// Boşluk/tire/nokta farklarını yok sayan gevşek anahtar (ör. "GDY 301030" ↔ "GDY-301030").
export function looseSkuKey(value) {
  return normalizeSkuKey(value).replace(/[\s\-_./\\#]/g, "");
}

export function stockLevel(part) {
  const stock = num(part?.stock);
  const minimum = num(part?.minimum);
  if (stock <= 0) return STOCK_LEVEL.OUT;
  if (stock <= minimum) return STOCK_LEVEL.CRITICAL;
  if (stock <= minimum * 2) return STOCK_LEVEL.LOW;
  return STOCK_LEVEL.GOOD;
}

export function summarizeStock(parts) {
  const active = (Array.isArray(parts) ? parts : []).filter((part) => part.archived !== true);
  const summary = { total: active.length, units: 0, costValue: 0, saleValue: 0, out: 0, critical: 0, low: 0, good: 0, categories: 0, brands: 0 };
  const categories = new Set();
  const brands = new Set();
  active.forEach((part) => {
    const stock = Math.max(0, num(part.stock));
    summary.units += stock;
    summary.costValue += stock * num(part.cost);
    summary.saleValue += stock * num(part.price);
    summary[stockLevel(part)] += 1;
    if (part.category) categories.add(String(part.category).trim().toLocaleLowerCase("tr"));
    if (part.brand) brands.add(String(part.brand).trim().toLocaleLowerCase("tr"));
  });
  summary.costValue = round2(summary.costValue);
  summary.saleValue = round2(summary.saleValue);
  summary.potentialMargin = round2(summary.saleValue - summary.costValue);
  summary.categories = categories.size;
  summary.brands = brands.size;
  // Sağlık: kritik/tükenmiş olmayan parçaların oranı.
  summary.health = summary.total ? Math.round(((summary.total - summary.critical - summary.out) / summary.total) * 100) : 0;
  return summary;
}

// Stok değerine göre ABC sınıfı: değerin ilk %80'i A, sonraki %15'i B, kalanı C.
export function classifyAbc(parts) {
  const active = (Array.isArray(parts) ? parts : []).filter((part) => part.archived !== true);
  const valued = active
    .map((part) => ({ id: part.id, value: Math.max(0, num(part.stock)) * num(part.cost) }))
    .sort((a, b) => b.value - a.value);
  const total = valued.reduce((sum, item) => sum + item.value, 0);
  const result = new Map();
  let running = 0;
  valued.forEach((item) => {
    if (!total || item.value <= 0) { result.set(item.id, "C"); return; }
    const share = running / total;
    result.set(item.id, share < 0.8 ? "A" : share < 0.95 ? "B" : "C");
    running += item.value;
  });
  return result;
}

// Son `days` gündeki stok çıkışlarından (negatif hareketler) ortalama günlük
// tüketim ve mevcut stoğun kaç gün yeteceği.
export function consumptionStats(part, movements, { days = 90, now = Date.now() } = {}) {
  const cutoff = new Date(now - days * DAY_MS).toISOString().slice(0, 10);
  let out = 0;
  let inQty = 0;
  let lastMove = null;
  (Array.isArray(movements) ? movements : []).forEach((movement) => {
    if (movement.partId !== part.id) return;
    const date = String(movement.date || movement.createdAt || "").slice(0, 10);
    if (!lastMove || date > lastMove) lastMove = date;
    if (date < cutoff) return;
    const qty = num(movement.qty);
    if (qty < 0) out += -qty; else inQty += qty;
  });
  const daily = out / days;
  const stock = Math.max(0, num(part.stock));
  return {
    consumed: out,
    received: inQty,
    dailyUsage: daily,
    coverDays: daily > 0 ? Math.floor(stock / daily) : null,
    lastMove,
  };
}

// Mevcut stoktan geriye doğru hareketleri geri sararak son `days` günün
// gün sonu stok serisini üretir (grafik için).
export function stockHistorySeries(part, movements, { days = 60, now = Date.now() } = {}) {
  const relevant = (Array.isArray(movements) ? movements : [])
    .filter((movement) => movement.partId === part.id)
    .map((movement) => ({ date: String(movement.date || movement.createdAt || "").slice(0, 10), qty: num(movement.qty) }));
  const series = [];
  let level = num(part.stock);
  for (let i = 0; i < days; i += 1) {
    const day = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    series.push({ date: day, stock: level });
    relevant.forEach((movement) => { if (movement.date === day) level -= movement.qty; });
  }
  return series.reverse();
}

export function partPurchaseHistory(part, invoices) {
  const key = normalizeSkuKey(part.sku);
  const rows = [];
  (Array.isArray(invoices) ? invoices : []).forEach((invoice) => {
    (invoice.items || []).forEach((item) => {
      if (item.partId === part.id || (key && normalizeSkuKey(item.sku) === key)) {
        rows.push({ invoiceId: invoice.id, code: invoice.code || invoice.id, supplier: invoice.supplier || "", date: invoice.date, qty: num(item.qty), cost: num(item.cost) });
      }
    });
  });
  return rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

const SORTERS = {
  name: (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "tr"),
  sku: (a, b) => String(a.sku || "").localeCompare(String(b.sku || ""), "tr"),
  stock: (a, b) => num(a.stock) - num(b.stock),
  cost: (a, b) => num(a.cost) - num(b.cost),
  price: (a, b) => num(a.price) - num(b.price),
  value: (a, b) => num(a.stock) * num(a.cost) - num(b.stock) * num(b.cost),
  level: (a, b) => ["out", "critical", "low", "good"].indexOf(stockLevel(a)) - ["out", "critical", "low", "good"].indexOf(stockLevel(b)),
};

export function filterAndSortParts(parts, { query = "", level = "all", category = "all", brand = "all", favorites = false, archived = false, sort = "level", direction = "asc" } = {}) {
  const needle = String(query || "").trim().toLocaleLowerCase("tr");
  const looseNeedle = looseSkuKey(query);
  const list = (Array.isArray(parts) ? parts : []).filter((part) => {
    if (archived ? part.archived !== true : part.archived === true) return false;
    if (favorites && !part.favorite) return false;
    if (level === "attention") { const lvl = stockLevel(part); if (lvl !== "out" && lvl !== "critical") return false; }
    else if (level !== "all" && stockLevel(part) !== level) return false;
    if (category !== "all" && String(part.category || "") !== category) return false;
    if (brand !== "all" && String(part.brand || "") !== brand) return false;
    if (!needle) return true;
    const hay = `${part.name || ""} ${part.sku || ""} ${part.category || ""} ${part.brand || ""}`.toLocaleLowerCase("tr");
    return hay.includes(needle) || (looseNeedle.length >= 3 && looseSkuKey(part.sku).includes(looseNeedle));
  });
  const sorter = SORTERS[sort] || SORTERS.level;
  list.sort((a, b) => {
    const primary = sorter(a, b);
    if (primary !== 0) return direction === "desc" ? -primary : primary;
    return SORTERS.name(a, b);
  });
  return list;
}

// --- eDMS Satın Alma faturası birebir kontrolü -----------------------------

// Bir WDMR010 Satın Alma faturasının satırlarını sistemdeki parça kartlarıyla
// eşleştirir ve eDMS'in kendi satır/toplam tutarlarıyla, uygulamanın stoğa
// işleyeceği net tutarı karşılaştırır.
export function analyzeEdmsPurchaseInvoice(invoice, parts, existingInvoices) {
  const partByKey = new Map();
  const partByLoose = new Map();
  (Array.isArray(parts) ? parts : []).forEach((part) => {
    partByKey.set(normalizeSkuKey(part.sku), part);
    const loose = looseSkuKey(part.sku);
    if (loose && !partByLoose.has(loose)) partByLoose.set(loose, part);
  });
  const existingCodes = new Set((Array.isArray(existingInvoices) ? existingInvoices : []).map((inv) => String(inv.code || "").trim()));
  const alreadyImported = existingCodes.has(String(invoice.invoiceNo || "").trim());

  const lines = [];
  let net = 0, vat = 0, gross = 0, edmsNet = 0, edmsVat = 0, edmsGross = 0, units = 0, stockUnits = 0;
  (invoice.items || []).forEach((line, index) => {
    const unitPrice = num(line.unitPrice);
    const qty = num(line.qty);
    const lineGross = round2(unitPrice * qty);
    const discount = line.discountPercent > 0 ? round2(lineGross * num(line.discountPercent) / 100) : num(line.discountAmount);
    const lineNet = round2(lineGross - discount);
    const lineVat = round2(lineNet * num(line.vatPercent) / 100);
    const eNet = round2(num(line.lineTotal) - num(line.discountAmount));
    const isStock = line.kind === "Stok";
    const exact = normalizeSkuKey(line.kod);
    const part = isStock ? (partByKey.get(exact) || partByLoose.get(looseSkuKey(line.kod)) || null) : null;
    const matchType = !isStock ? "service" : part ? (normalizeSkuKey(part.sku) === exact ? "exact" : "loose") : "new";
    const fractional = isStock && !Number.isInteger(qty);
    const amountOk = Math.abs(lineNet - eNet) <= TOLERANCE && Math.abs(lineVat - num(line.vatAmount)) <= TOLERANCE;
    if (isStock) {
      net += lineNet; vat += lineVat; gross += lineNet + lineVat; units += qty; stockUnits += Math.round(qty);
      edmsNet += eNet; edmsVat += num(line.vatAmount); edmsGross += num(line.grossTotal);
    }
    lines.push({
      index,
      kind: line.kind,
      sku: line.kod,
      name: line.name,
      qty,
      unitPrice,
      discountPercent: num(line.discountPercent),
      vatPercent: num(line.vatPercent),
      net: lineNet,
      vat: lineVat,
      unitCost: qty > 0 ? round2(lineNet / qty) : 0,
      edmsNet: eNet,
      edmsVat: num(line.vatAmount),
      edmsGross: num(line.grossTotal),
      amountOk,
      fractional,
      matchType,
      part: part ? { id: part.id, sku: part.sku, name: part.name, stock: num(part.stock), cost: num(part.cost) } : null,
      stockAfter: part ? num(part.stock) + Math.round(qty) : Math.round(qty),
      costChange: part && num(part.cost) > 0 ? round2(((lineNet / Math.max(qty, 1e-9)) - num(part.cost)) / num(part.cost) * 100) : null,
    });
  });
  net = round2(net); vat = round2(vat); gross = round2(gross);
  edmsNet = round2(edmsNet); edmsVat = round2(edmsVat); edmsGross = round2(edmsGross);
  const reportGross = invoice.totalGross === null || invoice.totalGross === undefined ? null : round2(num(invoice.totalGross));
  const stockLines = lines.filter((line) => line.kind === "Stok");
  const totalsOk = Math.abs(gross - edmsGross) <= TOLERANCE * Math.max(1, stockLines.length)
    && (reportGross === null || lines.some((line) => line.kind !== "Stok") || Math.abs(reportGross - edmsGross) <= TOLERANCE * Math.max(1, stockLines.length));
  return {
    invoiceNo: invoice.invoiceNo,
    date: invoice.date,
    supplier: invoice.firma || "Bilinmeyen tedarikçi",
    kaynak: invoice.kaynak || "",
    alreadyImported,
    lines,
    totals: { net, vat, gross, edmsNet, edmsVat, edmsGross, reportGross, units: round2(units), stockUnits },
    totalsOk,
    allLinesOk: stockLines.every((line) => line.amountOk),
    counts: {
      stock: stockLines.length,
      exact: stockLines.filter((line) => line.matchType === "exact").length,
      loose: stockLines.filter((line) => line.matchType === "loose").length,
      newCards: stockLines.filter((line) => line.matchType === "new").length,
      service: lines.length - stockLines.length,
      fractional: stockLines.filter((line) => line.fractional).length,
    },
    importable: !alreadyImported && stockLines.length > 0,
  };
}

export function analyzeEdmsPurchaseBatch(purchaseInvoices, parts, existingInvoices) {
  const invoices = (Array.isArray(purchaseInvoices) ? purchaseInvoices : []).map((invoice) => analyzeEdmsPurchaseInvoice(invoice, parts, existingInvoices));
  const summary = invoices.reduce((acc, invoice) => {
    acc.count += 1;
    if (invoice.alreadyImported) acc.alreadyImported += 1;
    if (invoice.importable) acc.importable += 1;
    if (!invoice.totalsOk || !invoice.allLinesOk) acc.mismatched += 1;
    acc.net += invoice.totals.net;
    acc.gross += invoice.totals.gross;
    acc.lines += invoice.counts.stock;
    acc.newCards += invoice.counts.newCards;
    return acc;
  }, { count: 0, alreadyImported: 0, importable: 0, mismatched: 0, net: 0, gross: 0, lines: 0, newCards: 0 });
  summary.net = round2(summary.net);
  summary.gross = round2(summary.gross);
  return { invoices, summary };
}

// Gevşek eşleşen (ör. boşluk farkı) satırların stok kodunu sistemdeki karta
// eşitler; böylece createPurchaseInvoice yeni bir kopya kart açmaz.
export function alignInvoiceSkusToParts(invoice, analysis) {
  const items = (invoice.items || []).map((line, index) => {
    const analyzed = analysis.lines[index];
    if (analyzed && analyzed.matchType === "loose" && analyzed.part) return { ...line, kod: analyzed.part.sku };
    return line;
  });
  return { ...invoice, items };
}
