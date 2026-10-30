// EUROREPAR eDMS'in "Fatura Raporu" (WDMR010, Form: "FATURA RAPORU(DETAY)")
// çıktısını ayrıştırır. Bu rapor normal bir tablo değil; sayfa/baskı formatında,
// her faturanın kendi başlık bloğu (Tarih/No, Vade, Firma, Açıklama, Tip, Kaynak)
// ve ardından bir Stok/Hizmet satır tablosu (ve son satırda toplamlar) olan,
// art arda tekrarlanan bloklardan oluşur.
//
// `rows` parametresi, bu worksheet'in `XLSX.utils.sheet_to_json(sheet, { header: 1,
// cellDates: true, defval: null })` ile okunmuş, her biri 0-index'li bir hücre
// dizisi olan satırlar dizisidir (Excel'deki sütun pozisyonları korunur).

const COL = {
  LABEL: 0,
  VALUE: 2,
  SLASH: 5,
  INVOICE_NO: 6,
  ITEM_NAME: 7,
  INDEX: 12,
  UNIT_PRICE: 13,
  QTY: 16,
  DISCOUNT_PCT: 18,
  VAT_PCT: 19,
  LINE_TOTAL: 21,
  DISCOUNT_AMOUNT: 22,
  VAT_AMOUNT: 23,
  INVOICE_AMOUNT: 24,
};

function cellText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function cellNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim().replace(/\s/g, "");
  if (!text) return null;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function toDateKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const text = cellText(value);
  if (!text) return null;
  const slashMatch = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];
  return null;
}

function normalizePlate(value) {
  return cellText(value).toLocaleUpperCase("tr").replace(/\s+/g, " ");
}

const VIN_PATTERN = /^[A-Z0-9]{11,17}$/;

// Açıklama alanı "ŞASİ / PLAKA [/ MODEL] [/ İŞ EMRİ NO] KM:xxxx ..." şeklinde,
// "/" ile ayrılmış, sabit olmayan sayıda parçadan oluşur. İş emri no her zaman
// bulunmaz (bazı faturalarda eksik); bulunduğunda "/"den sonraki parçanın en
// başında, kendi başına 5-8 haneli bir sayı olarak görünür.
function parseAciklama(aciklama) {
  const text = cellText(aciklama);
  if (!text) return { vin: null, plate: null, externalId: null, note: null };
  const parts = text.split("/");
  const vinCandidate = cellText(parts[0]).toLocaleUpperCase("tr");
  if (!VIN_PATTERN.test(vinCandidate)) {
    return { vin: null, plate: null, externalId: null, note: text };
  }
  const plate = parts.length > 1 ? normalizePlate(parts[1]) : null;
  let externalId = null;
  for (const part of parts.slice(2)) {
    const match = part.match(/^\s*(\d{5,8})\b/);
    if (match) externalId = match[1];
  }
  return { vin: vinCandidate, plate, externalId, note: text };
}

function classifyTip(tip) {
  const text = cellText(tip);
  const isReturn = /iade/i.test(text);
  const isSale = /sat.ş/i.test(text) && !/sat.n/i.test(text);
  const isPurchase = /sat.n\s*al/i.test(text);
  return { raw: text, isSale, isPurchase, isReturn };
}

export function parseFaturaRaporuReport(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return { invoices: [], errors: ["Excel dosyasında kayıt bulunamadı."], total: 0 };
  }

  const errors = [];
  const invoices = [];
  let current = null;
  let sawHeaderRow = false;

  const pushCurrent = () => {
    if (current) invoices.push(current);
    current = null;
  };

  rows.forEach((row, index) => {
    if (!Array.isArray(row)) return;
    const label = cellText(row[COL.LABEL]);
    const lineNumber = index + 1;

    if (label === "Tarih/No:") {
      pushCurrent();
      const date = toDateKey(row[COL.VALUE]);
      const invoiceNo = cellText(row[COL.INVOICE_NO]);
      if (!date || !invoiceNo) {
        errors.push(`${lineNumber}. satır: fatura tarihi veya numarası okunamadı; bu fatura atlandı.`);
        return;
      }
      current = {
        date,
        invoiceNo,
        vade: null,
        firma: null,
        aciklama: null,
        tip: null,
        kaynak: null,
        vin: null,
        plate: null,
        externalId: null,
        items: [],
        totalGross: null,
      };
      return;
    }

    if (!current) return;

    if (label === "Vade:") {
      current.vade = toDateKey(row[COL.VALUE]);
    } else if (label === "Firma:") {
      current.firma = cellText(row[COL.VALUE]);
    } else if (label === "Açıklama:") {
      const { vin, plate, externalId, note } = parseAciklama(row[COL.VALUE]);
      current.aciklama = note;
      current.vin = vin;
      current.plate = plate;
      current.externalId = externalId;
    } else if (label === "Tip:") {
      current.tip = classifyTip(row[COL.VALUE]);
    } else if (label === "Kaynak:") {
      current.kaynak = cellText(row[COL.VALUE]);
    } else if (label === "Stok/Hizmet") {
      sawHeaderRow = true;
    } else if (label === "Hizmet" || label === "Stok") {
      current.items.push({
        kind: label,
        kod: cellText(row[COL.VALUE]),
        name: cellText(row[COL.ITEM_NAME]),
        unitPrice: cellNumber(row[COL.UNIT_PRICE]) ?? 0,
        qty: cellNumber(row[COL.QTY]) ?? 0,
        discountPercent: cellNumber(row[COL.DISCOUNT_PCT]) ?? 0,
        vatPercent: cellNumber(row[COL.VAT_PCT]) ?? 0,
        lineTotal: cellNumber(row[COL.LINE_TOTAL]) ?? 0,
        discountAmount: cellNumber(row[COL.DISCOUNT_AMOUNT]) ?? 0,
        vatAmount: cellNumber(row[COL.VAT_AMOUNT]) ?? 0,
        grossTotal: cellNumber(row[COL.INVOICE_AMOUNT]) ?? 0,
      });
    } else if (!label && current.totalGross === null && row[COL.INVOICE_AMOUNT] !== undefined && row[COL.INVOICE_AMOUNT] !== null) {
      // Blok sonundaki toplam satırı: etiketsiz, sadece Fatura Tutarı sütununda
      // (ve genelde Miktar sütununda) bir değer taşır.
      current.totalGross = cellNumber(row[COL.INVOICE_AMOUNT]);
    }
  });
  pushCurrent();

  if (!sawHeaderRow && !invoices.length) {
    errors.push("Bu dosya beklenen eDMS \"Fatura Raporu\" formatında görünmüyor.");
  }

  return { invoices, errors, total: invoices.length };
}

export function splitFaturaRaporuByType(invoices) {
  const sales = [];
  const purchases = [];
  const returns = [];
  const other = [];
  (invoices || []).forEach((invoice) => {
    const tip = invoice.tip || {};
    if (tip.isReturn) returns.push(invoice);
    else if (tip.isSale) sales.push(invoice);
    else if (tip.isPurchase) purchases.push(invoice);
    else other.push(invoice);
  });
  return { sales, purchases, returns, other };
}
