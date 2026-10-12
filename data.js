const DATA_KEY = "demir-service-local-data-v1";
const CHANGE_EVENT = "demir-service-data-changed";

function day(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function createDemoData() {
  const parts = [
    { id: "part-oil-filter", sku: "OE-9812", name: "Yağ filtresi", category: "Filtre", brand: "Purflux", stock: 18, minimum: 8, price: 485, cost: 310, sold: 32 },
    { id: "part-brake-pad", sku: "BR-2048", name: "Ön fren balatası", category: "Fren", brand: "Brembo", stock: 6, minimum: 8, price: 2450, cost: 1680, sold: 21 },
    { id: "part-engine-oil", sku: "MO-1030", name: "Motor yağı 5W-30 (1L)", category: "Yağ", brand: "TotalEnergies", stock: 42, minimum: 12, price: 390, cost: 255, sold: 48 },
    { id: "part-air-filter", sku: "HA-4011", name: "Hava filtresi", category: "Filtre", brand: "Eurorepar", stock: 3, minimum: 6, price: 720, cost: 460, sold: 16 },
    { id: "part-battery", sku: "BU-7780", name: "Akü 70Ah", category: "Elektrik", brand: "Varta", stock: 9, minimum: 4, price: 4850, cost: 3520, sold: 12 },
    { id: "part-spark-plug", sku: "SP-2209", name: "Buji (tek)", category: "Ateşleme", brand: "NGK", stock: 24, minimum: 10, price: 285, cost: 170, sold: 14 },
    { id: "part-cabin-filter", sku: "PO-3133", name: "Polen filtresi", category: "Filtre", brand: "Mann", stock: 5, minimum: 8, price: 590, cost: 365, sold: 19 },
  ];
  const jobs = [
    { id: "job-041", code: "IS-2026-041", date: day(0), plate: "34 DMR 206", make: "Peugeot", model: "3008", customer: "Mert Demir", phone: "0532 111 20 26", status: "Devam ediyor", items: [{ partId: parts[0].id, name: parts[0].name, qty: 1, price: 485 }, { partId: parts[2].id, name: parts[2].name, qty: 5, price: 390 }], total: 2435 },
    { id: "job-040", code: "IS-2026-040", date: day(-1), plate: "34 SRT 508", make: "Citroën", model: "C4", customer: "Selin Aras", phone: "0554 202 40 18", status: "Tamamlandı", items: [{ partId: parts[1].id, name: parts[1].name, qty: 1, price: 2450 }], total: 2450 },
    { id: "job-039", code: "IS-2026-039", date: day(-2), plate: "34 KRM 112", make: "Opel", model: "Astra", customer: "Kerem Yılmaz", phone: "0530 444 11 29", status: "Tamamlandı", items: [{ partId: parts[3].id, name: parts[3].name, qty: 1, price: 720 }, { partId: parts[0].id, name: parts[0].name, qty: 1, price: 485 }], total: 1205 },
    { id: "job-038", code: "IS-2026-038", date: day(-3), plate: "34 ECE 782", make: "Peugeot", model: "208", customer: "Ece Aydın", phone: "0507 782 20 08", status: "Tamamlandı", items: [{ partId: parts[6].id, name: parts[6].name, qty: 1, price: 590 }], total: 590 },
  ];
  return {
    parts,
    jobs,
    invoices: [
      { id: "invoice-018", code: "AL-2026-018", supplier: "Eurorepar Distribütör", date: day(-1), total: 18240, lines: 4, status: "Ödendi", items: [] },
      { id: "invoice-017", code: "AL-2026-017", supplier: "Martaş Otomotiv", date: day(-4), total: 12480, lines: 3, status: "Ödendi", items: [] },
    ],
    drafts: [],
  };
}

function readData() {
  const stored = localStorage.getItem(DATA_KEY);
  if (!stored) {
    const demo = createDemoData();
    localStorage.setItem(DATA_KEY, JSON.stringify(demo));
    return demo;
  }
  const data = JSON.parse(stored);
  if (!data || !Array.isArray(data.parts) || !Array.isArray(data.jobs) || !Array.isArray(data.invoices) || !Array.isArray(data.drafts)) {
    throw new Error("Yerel servis verileri geçersiz. Tarayıcıdaki servis kayıtlarını kontrol edin.");
  }
  return data;
}

function saveData(data) {
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function nextCode(records, prefix) {
  const year = new Date().getFullYear();
  const sequence = records.reduce((latest, record) => {
    const suffix = Number(String(record.code || "").split("-").at(-1));
    return Number.isFinite(suffix) ? Math.max(latest, suffix) : latest;
  }, 0) + 1;
  return `${prefix}-${year}-${String(sequence).padStart(3, "0")}`;
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export async function fetchServiceData() {
  return readData();
}

export async function savePart(part) {
  const data = readData();
  const duplicate = data.parts.find((entry) => entry.sku.toLocaleLowerCase("tr") === part.sku.toLocaleLowerCase("tr") && entry.id !== part.id);
  if (duplicate) throw new Error("Bu SKU kodu başka bir parçada kullanılıyor.");
  const updated = { ...part, id: part.id || makeId("part"), sold: part.sold || 0 };
  data.parts = part.id ? data.parts.map((entry) => entry.id === part.id ? updated : entry) : [updated, ...data.parts];
  saveData(data);
  return updated;
}

export async function deletePart(partId) {
  const data = readData();
  data.parts = data.parts.filter((part) => part.id !== partId);
  saveData(data);
}

export async function createWorkOrder(job) {
  const data = readData();
  const quantities = new Map();
  job.items.forEach((item) => quantities.set(item.partId, (quantities.get(item.partId) || 0) + item.qty));
  for (const [partId, quantity] of quantities) {
    const part = data.parts.find((entry) => entry.id === partId);
    if (!part) throw new Error("İş emrindeki parça envanterde bulunamadı.");
    if (quantity > part.stock) throw new Error(`${part.name} için yeterli stok bulunmuyor.`);
  }
  const items = job.items.map((item) => {
    const part = data.parts.find((entry) => entry.id === item.partId);
    part.stock -= item.qty;
    part.sold += item.qty;
    return { ...item, name: part.name, price: part.price };
  });
  const record = {
    ...job,
    id: makeId("job"),
    code: nextCode(data.jobs, "IS"),
    date: day(),
    status: "Devam ediyor",
    items,
    total: items.reduce((sum, item) => sum + item.qty * item.price, 0),
  };
  data.jobs.unshift(record);
  saveData(data);
  return record;
}

export async function createPurchaseInvoice(invoice) {
  const data = readData();
  const aggregated = new Map();
  invoice.items.forEach((item) => {
    const previous = aggregated.get(item.partId);
    if (previous) {
      const totalQty = previous.qty + item.qty;
      previous.cost = (previous.cost * previous.qty + item.cost * item.qty) / totalQty;
      previous.qty = totalQty;
    } else aggregated.set(item.partId, { ...item });
  });
  const items = [...aggregated.values()];
  for (const item of items) {
    if (!Number.isInteger(item.qty) || item.qty <= 0 || !Number.isFinite(item.cost) || item.cost < 0) {
      throw new Error("Faturadaki adet veya alış fiyatı geçersiz.");
    }
    if (!data.parts.some((part) => part.id === item.partId)) throw new Error("Faturadaki parça envanterde bulunamadı.");
  }
  items.forEach((item) => {
    const part = data.parts.find((entry) => entry.id === item.partId);
    part.stock += item.qty;
    part.cost = item.cost;
    item.name = part.name;
    item.sku = part.sku;
  });
  const record = {
    id: makeId("invoice"),
    code: nextCode(data.invoices, "AL"),
    supplier: invoice.supplier,
    date: day(),
    total: items.reduce((sum, item) => sum + item.qty * item.cost, 0),
    status: "Ödendi",
    lines: items.length,
    items,
  };
  data.invoices.unshift(record);
  saveData(data);
  return record;
}

export async function createStockDraft() {
  const data = readData();
  const items = data.parts
    .filter((part) => part.stock <= part.minimum)
    .map((part) => ({ partId: part.id, name: part.name, sku: part.sku, qty: Math.max(part.minimum * 2 - part.stock, part.minimum), cost: part.cost }));
  if (!items.length) throw new Error("Kritik seviyede parça bulunmuyor.");
  const draft = { id: makeId("draft"), code: nextCode(data.drafts, "SIP"), date: day(), status: "Taslak", items };
  data.drafts.unshift(draft);
  saveData(data);
  return draft;
}

export async function receiveStockDraft(draftId) {
  const data = readData();
  const draft = data.drafts.find((entry) => entry.id === draftId);
  if (!draft) throw new Error("Taslak sipariş bulunamadı veya daha önce stoğa işlendi.");
  for (const item of draft.items) {
    const part = data.parts.find((entry) => entry.id === item.partId);
    if (!part) throw new Error(`${item.name} envanterde bulunamadı; sipariş stoğa aktarılamadı.`);
    part.stock += item.qty;
  }
  data.drafts = data.drafts.filter((entry) => entry.id !== draftId);
  saveData(data);
}

export function subscribeToServiceData(onChange) {
  const onStorage = (event) => {
    if (event.key === DATA_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
