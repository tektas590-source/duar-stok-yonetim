// EUROREPAR eDMS'in "Müşteri Listeleme" (WDMU050) raporunu — müşteri, araç ve
// iş emri bilgilerini bir arada veren Excel çıktısı — uygulamanın kendi iş
// emri kayıtlarına dönüştürür. Satırlar, sheet_to_json ile okunmuş,
// başlıkları eDMS'teki orijinal Türkçe sütun adları olan düz obje dizisidir.

const REQUIRED_HEADERS = ["İş Emri No", "Plaka", "Müşteri"];

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

// Excel'den gelen bir tarih hücresini "YYYY-MM-DD" anahtarına çevirir.
// cellDates:true ile okunduğunda gerçek bir Date nesnesi gelir; bazı sütunlar
// (ör. metin biçimli) "gg/aa/yyyy" veya "gg.aa.yyyy" string olarak da gelebilir.
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

// Excel'den gelen bir tarih(-saat) hücresini ISO zaman damgasına çevirir
// (yalnızca "doldu mu boş mu" ve referans amaçlı saklamak için kullanılır).
function toIsoTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const dateKey = toDateKey(value);
  return dateKey ? new Date(`${dateKey}T00:00:00`).toISOString() : null;
}

function normalizePlate(value) {
  return cellText(value).toLocaleUpperCase("tr").replace(/\s+/g, " ");
}

export function parseEdmsWorkOrderReport(rows) {
  if (!Array.isArray(rows)) return { records: [], errors: ["Excel dosyasından okunabilir satır bulunamadı."], total: 0 };
  if (!rows.length) return { records: [], errors: ["Excel dosyasında kayıt bulunamadı."], total: 0 };

  const sampleHeaders = Object.keys(rows[0] || {});
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !sampleHeaders.includes(header));
  if (missingHeaders.length) {
    return {
      records: [],
      errors: [`Bu dosya beklenen eDMS "Müşteri Listeleme" raporu formatında değil (eksik sütun: ${missingHeaders.join(", ")}).`],
      total: 0,
    };
  }

  const errors = [];
  const records = [];
  rows.forEach((row, index) => {
    const lineNumber = index + 2; // Excel'de 1. satır başlık
    const externalId = cellText(row["İş Emri No"]);
    const plate = normalizePlate(row["Plaka"]);
    const customer = cellText(row["Müşteri"]);
    if (!externalId || !plate || !customer) {
      errors.push(`${lineNumber}. satır: İş Emri No, Plaka veya Müşteri eksik; bu satır atlandı.`);
      return;
    }
    const closedAt = toIsoTimestamp(row["Genel Kapama"]);
    const arrivalDate = toDateKey(row["Geliş Tarihi"]) || toDateKey(row["Ekleme Tarihi"]);
    if (!arrivalDate) {
      errors.push(`${lineNumber}. satır (${externalId}): geçerli bir geliş tarihi bulunamadı; bu satır atlandı.`);
      return;
    }
    records.push({
      externalId,
      plate,
      vin: cellText(row["Şasi No"]),
      customer,
      phone: cellText(row["Telefon 1"]) || cellText(row["Src. Telefon1"]),
      address: cellText(row["Adres"]),
      city: cellText(row["İl"]),
      district: cellText(row["İlçe"]),
      make: cellText(row["Marka"]),
      bodyType: cellText(row["Gövde"]),
      model: cellText(row["Model"]),
      modelYear: cellText(row["Model Yılı"]),
      date: arrivalDate,
      arrivalKm: cellNumber(row["Geliş Km"]),
      jobKind: cellText(row["İş Emri Türü"]),
      serviceAdvisor: cellText(row["Servis Danışmanı Adı"]),
      closedAt,
      status: closedAt ? "closed" : "open",
      // "Fatura Tutarı" talimatımıza göre KDV hariç tutardır; kapalı olmayan
      // iş emirlerinde henüz faturalanmadığı için 0 kabul edilir.
      total: closedAt ? Math.max(0, cellNumber(row["Fatura Tutarı"]) || 0) : 0,
    });
  });

  return { records, errors, total: rows.length };
}

// Mevcut iş emirleriyle plaka/şasi (ve varsa eDMS İş Emri No) üzerinden
// eşleştirir; zaten uygulamada olan kayıtları atlar, eksik olanları
// eklenecek listesine koyar. Tekrar içe aktarmalarda da (externalId sabit
// kaldığı için) idempotent çalışır — aynı iş emri ikinci kez eklenmez.
export function selectEdmsRecordsToImport(records, existingJobs) {
  const jobs = Array.isArray(existingJobs) ? existingJobs : [];
  const existingKeys = new Set();
  jobs.forEach((job) => {
    if (job.externalId) existingKeys.add(`ext:${job.externalId}`);
    const plate = normalizePlate(job.plate);
    if (plate && job.date) existingKeys.add(`plate:${plate}|date:${job.date}`);
    const vin = cellText(job.vin);
    if (vin && job.date) existingKeys.add(`vin:${vin}|date:${job.date}`);
  });

  const toAdd = [];
  const alreadyPresent = [];
  records.forEach((record) => {
    const keys = [`ext:${record.externalId}`, `plate:${record.plate}|date:${record.date}`];
    if (record.vin) keys.push(`vin:${record.vin}|date:${record.date}`);
    if (keys.some((key) => existingKeys.has(key))) alreadyPresent.push(record);
    else toAdd.push(record);
  });

  return { toAdd, alreadyPresent };
}
