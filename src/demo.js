// ?demo ile açıldığında örnek verilerle dolu bellek deposu (kaydedilmez).
import { createMemoryStore } from "./store/memoryStore.js";

const PARTS = [
  ["1609414480", "Yağ filtresi 1.5 BlueHDi", "Filtre", "Peugeot", 190, 290, 4, "A-1"],
  ["1612585980", "Fren balatası ön takım", "Fren", "Peugeot", 1450, 2150, 3, "B-2"],
  ["LTR1610725580OEM", "Fren hidrolik yağı DOT4 500 ml", "Sıvı", "Total", 233.34, 320, 6, "C-1"],
  ["GDY 301030", "Motor yağı 0W-30", "Sıvı", "Goodyear", 300, 395, 20, "C-2"],
  ["BSG-30-145-020", "Polen filtresi Transit", "Filtre", "BSG", 300, 410, 2, "A-2"],
  ["1660728580", "Hava filtresi 1.6 HDi", "Filtre", "Peugeot", 260, 395, 3, "A-1"],
  ["9811155280", "Silecek süpürgesi seti", "Aksesuar", "Citroën", 420, 640, 3, "D-1"],
  ["9820653280", "Akü 70Ah", "Elektrik", "Varta", 3100, 4200, 2, "E-1"],
  ["0986494551", "Fren diski arka", "Fren", "Bosch", 980, 1450, 2, "B-1"],
  ["1606402880", "Buji seti", "Ateşleme", "Peugeot", 520, 790, 4, "A-3"],
];

export function createDemoStore() {
  const store = createMemoryStore({}, "demo@duar.local");
  (async () => {
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    await store.purchase({ no: "DM22026000006001", supplier: "DEMPAR OTOMOTİV", date: day(40), source: "eDMS", lines: PARTS.map(([sku, name, , , cost], i) => ({ sku, name, qty: [8, 6, 12, 40, 4, 6, 9, 3, 4, 6][i], unitPrice: cost })) });
    for (const [sku, name, category, brand, , price, minimum, location] of PARTS) {
      const s = await store.saveItem({ sku, name, category, brand, price, minimum, location, unit: sku.startsWith("GDY") ? "lt" : "adet" }, { isNew: false });
      if (sku === "1612585980") await store.patchItem(s.id, { favorite: true });
    }
    let n = 1;
    const sales = [[35, "1609414480", 2], [30, "GDY 301030", 11.5], [28, "1612585980", 1], [21, "LTR1610725580OEM", 4], [18, "BSG-30-145-020", 4], [14, "GDY 301030", 9], [12, "1660728580", 3], [9, "9811155280", 2], [6, "1609414480", 3], [4, "0986494551", 2], [3, "9820653280", 2], [1, "GDY 301030", 4.5], [1, "1612585980", 2]];
    for (const [d, sku, qty] of sales) {
      const item = PARTS.find((p) => p[0] === sku);
      await store.issue({ no: `S-${String(n++).padStart(5, "0")}`, date: day(d), customer: n % 2 ? "Tezgah" : "Servis", plate: n % 2 ? "" : "55 ABC 12" + n, lines: [{ sku, qty, unitPrice: item[5] }] });
    }
    await store.purchase({ no: "DM22026000006913", supplier: "DEMPAR OTOMOTİV", date: day(16), source: "eDMS", lines: [{ sku: "GDY 301030", name: "Motor yağı 0W-30", qty: 20, unitPrice: 310 }, { sku: "1609414480", qty: 6, unitPrice: 195, discountPct: 5 }] });
    await store.purchase({ no: "BSG-2026-1181", supplier: "BOSCH YETKİLİ", date: day(5), lines: [{ sku: "0986494551", name: "Fren diski arka", qty: 4, unitPrice: 990 }] });
  })();
  return store;
}
