// eDMS "Detay Faaliyet Raporu" (WDMR003, "Detaylar görüntülensin" işaretli):
// her iş emri bir başlık satırı (marka, gövde, model, yıl, plaka, km, müşteri,
// iş emri no, tarih, şasi no) ve altında detay satırları (kod, ad, miktar,
// işçilik / parça tutarı) olarak gelir. Satırlar dizi dizisi olarak verilir.
import { toNumber } from "./format.js";

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const key = (s) => norm(s).toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c").replace(/[^a-z0-9 ]/g, "").trim();

// "01/10/26" veya "01.10.2026" → "2026-10-01"
export function woDate(text) {
  const m = norm(text).match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!m) return "";
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export function parseDetailReport(rows) {
  const clean = (rows || []).map((r) => (r || []).map(norm));
  const hi = clean.findIndex((r) => r.some((c) => key(c) === "marka") && r.some((c) => /sasi no/.test(key(c))));
  if (hi < 0) throw new Error("Detay Faaliyet Raporu başlığı bulunamadı (Marka … Şasi No). Raporu \"Detaylar görüntülensin\" işaretli alın.");
  const h = clean[hi].map(key);
  const col = (...names) => h.findIndex((c) => names.some((n) => c === n || c.startsWith(n)));
  const c = {
    brand: col("marka"), body: col("govde"), model: col("model"), year: col("model yili"), plate: col("plaka"), km: col("gelis km"),
    customer: col("musteri"), wo: col("is emri"), type: col("is emri turu"), date: col("acilis tarihi"),
    vin: h.findIndex((x) => /sasi no/.test(x)), close: col("kapanis tarihi"),
  };
  // Model sütunu "model yılı" ile karışmasın.
  c.model = h.findIndex((x) => x === "model");
  c.wo = h.findIndex((x) => x === "is emri");
  const orders = [];
  let cur = null;
  for (let i = hi + 1; i < clean.length; i += 1) {
    const r = clean[i];
    if (!r.length || r.every((x) => !x)) continue;
    if (r.some((x, j) => key(x) === "marka" && j === c.brand)) continue; // tekrar eden başlık (sayfa başı)
    const woNo = r[c.wo];
    if (r[c.brand] && woNo && /\d/.test(woNo) && r[c.plate] !== undefined) {
      cur = {
        no: woNo, brand: r[c.brand], body: r[c.body] || "", model: r[c.model] || "", year: r[c.year] || "", plate: (r[c.plate] || "").toLocaleUpperCase("tr"),
        km: toNumber(r[c.km]) || null, customer: r[c.customer] || "", type: r[c.type] || "", date: woDate(r[c.date]), vin: (r[c.vin] || "").toUpperCase(),
        closed: woDate(r[c.close]), lines: [],
      };
      orders.push(cur);
      continue;
    }
    // Detay satırı: ilk sütunlar boş; kod müşteri sütununda, ad bir sağında, miktar iş emri sütununda.
    if (cur && !r[c.brand] && r[c.customer]) {
      const labor = toNumber(r[c.wo + 1]);
      const parts = toNumber(r[c.wo + 2]);
      const outside = toNumber(r[c.wo + 3]);
      cur.lines.push({
        code: r[c.customer], name: r[c.customer + 1] || r[c.customer], qty: toNumber(r[c.wo]) || 1,
        kind: labor > 0 && !parts && !outside ? "job" : "part",
        labor, parts, total: toNumber(r[c.wo + 4]), discount: toNumber(r[c.wo + 5]),
      });
    }
  }
  return orders.filter((o) => o.no);
}

export function summarizeOrders(orders) {
  const models = new Set(orders.map((o) => `${o.brand}|${o.model}`));
  const vins = new Set(orders.map((o) => o.vin).filter(Boolean));
  const partLines = orders.reduce((s, o) => s + o.lines.filter((l) => l.kind === "part").length, 0);
  return { orders: orders.length, models: models.size, vins: vins.size, partLines };
}
