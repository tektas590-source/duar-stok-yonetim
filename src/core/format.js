// Ortak biçimlendirme ve anahtar yardımcıları.

export const VAT_RATE = 0.2;

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

export function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let text = String(value).trim().replace(/\s/g, "").replace(/₺|TL/gi, "");
  if (!text) return 0;
  if (text.includes(",") && text.includes(".")) {
    text = text.lastIndexOf(",") > text.lastIndexOf(".") ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

// Stok kodu: karşılaştırma için küçük harf + kırpılmış.
export function skuKey(sku) {
  return String(sku || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("tr");
}

// Boşluk / tire / nokta farklarını yok sayan gevşek anahtar.
export function looseKey(sku) {
  return skuKey(sku).replace(/[\s\-_./\\#]/g, "");
}

// Firestore belge kimliği: aynı stok kodu her zaman aynı kartı gösterir.
export function itemIdFromSku(sku) {
  const key = skuKey(sku);
  if (!key) throw new Error("Stok kodu boş olamaz.");
  return `sku_${encodeURIComponent(key).replace(/\./g, "%2E")}`.slice(0, 700);
}

export function docIdFromNumber(prefix, number) {
  const key = String(number || "").trim().toLocaleUpperCase("tr");
  if (!key) throw new Error("Belge numarası boş olamaz.");
  return `${prefix}_${encodeURIComponent(key).replace(/\./g, "%2E")}`.slice(0, 700);
}

export function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dateKeyFromCell(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return todayKey(value);
  const text = String(value ?? "").trim();
  if (!text) return null;
  const tr = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (tr) return `${tr[3]}-${tr[2].padStart(2, "0")}-${tr[1].padStart(2, "0")}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  if (/^\d{5}(\.\d+)?$/.test(text)) { // Excel seri tarihi
    const date = new Date(Math.round((Number(text) - 25569) * 86400000));
    return date.toISOString().slice(0, 10);
  }
  return null;
}

const moneyFmt = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function money(value) { return moneyFmt.format(Number(value) || 0); }
export function moneyShort(value) { return `₺${Math.round(Number(value) || 0).toLocaleString("tr-TR")}`; }
export function qty(value) {
  const n = Number(value) || 0;
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 3 });
}
export function dateLabel(value) {
  if (!value) return "—";
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}
export function timeLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}
