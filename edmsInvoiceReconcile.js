// eDMS "Fatura Raporu" (WDMR010) üzerinden alınan Satış/Satın Alma fatura
// kayıtlarını, uygulamanın iş emirleri ve parça envanteriyle eşleştirip
// (mevcut iş emirlerine parça/işçilik satırları ekleme; alış faturalarını
// stok güncelleyecek şekilde içe aktarma) ilgili "patch"leri üreten saf
// (Firestore'a dokunmayan) mantık. Gerçek yazma işlemleri data.js'te yapılır.

import { WORK_ORDER_STATUS } from "./workOrderLifecycle.js";
import { normalizeDiscount, calculateDiscountAmount } from "./workOrderPricing.js";

// NOT: calculateWorkOrderNetTotal/calculateLinePricing bilerek kullanılmıyor —
// onlar canlı iş emri girişinde tam sayı adet (bütün parça) şartı koyar, ama
// eDMS'teki gerçek satış faturalarında litre ile satılan kalemler (ör. 11,5
// litre motor yağı) kesirli miktar taşıyabiliyor. Burada toplamı eDMS'in
// kendi satır hesabıyla birebir aynı (tutar = adet × birim fiyat − iskonto)
// biçimde kendimiz hesaplıyoruz; iş emri şemasındaki `total` alanı yine KDV
// hariç net tutardır.

const OPEN_SCOPE_CUTOFF = "2026-10-01"; // Kullanıcının talimatı: açık iş emirlerinde yalnızca bu tarihten sonrası
const PLATE_MATCH_WINDOW_DAYS = 10; // İş emri no eksikse plaka+tarih yakınlığıyla eşleştirme penceresi

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizePlate(value) {
  return String(value || "").trim().toLocaleUpperCase("tr").replace(/\s+/g, " ");
}

// Eşleştirme amaçlı: eDMS'in iki ayrı raporu plakayı farklı boşluklandırmayla
// yazabildiği için ("34EMH581" / "34 EMH 581"), karşılaştırmada boşlukları
// tamamen yok sayıyoruz. Görüntüleme/saklama için normalizePlate kullanılır.
function normalizePlateForMatch(value) {
  return normalizePlate(value).replace(/\s+/g, "");
}

function normalizeSku(value) {
  return String(value || "").trim().toLocaleLowerCase("tr");
}

function daysBetween(dateA, dateB) {
  const a = new Date(`${dateA}T00:00:00`);
  const b = new Date(`${dateB}T00:00:00`);
  return Math.abs((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

// --- 1) Kapsam: kapalı iş emirleri (tarih sınırı yok) + 01.10.2026 sonrası
// açık iş emirleri. Sadece eDMS'ten içe aktarılmış ve henüz satır eklenmemiş
// (items boş) iş emirlerine dokunulur; elle girilmiş veya zaten
// zenginleştirilmiş iş emirleri hiçbir koşulda değiştirilmez.
export function selectEdmsJobsInScope(jobs, { cutoffDate = OPEN_SCOPE_CUTOFF } = {}) {
  return (Array.isArray(jobs) ? jobs : []).filter((job) => {
    if (job.source !== "eDMS") return false;
    if (Array.isArray(job.items) && job.items.length) return false; // zaten zenginleştirilmiş
    const isClosed = job.status === WORK_ORDER_STATUS.COMPLETED;
    if (isClosed) return true;
    const isOpen = job.status === WORK_ORDER_STATUS.IN_PROGRESS;
    return isOpen && Boolean(job.date) && job.date > cutoffDate;
  });
}

// --- 2) Satış faturalarını kapsamdaki iş emirleriyle eşleştirme.
// Öncelik: eDMS İş Emri No (externalId) birebir eşleşmesi. İkincil: plaka +
// en yakın tarih (yalnızca tekil/çakışmasız eşleşmelerde).
export function matchSalesInvoicesToJobs(jobsInScope, salesInvoices, { windowDays = PLATE_MATCH_WINDOW_DAYS } = {}) {
  const jobs = Array.isArray(jobsInScope) ? jobsInScope : [];
  const invoices = Array.isArray(salesInvoices) ? salesInvoices : [];
  const matches = new Map(); // jobId -> invoice
  const usedInvoiceNos = new Set();
  const ambiguous = [];

  const byExternalId = new Map();
  invoices.forEach((inv) => {
    if (inv.externalId) {
      if (!byExternalId.has(inv.externalId)) byExternalId.set(inv.externalId, []);
      byExternalId.get(inv.externalId).push(inv);
    }
  });

  const unmatchedJobs = [];
  jobs.forEach((job) => {
    const candidates = job.externalId ? byExternalId.get(job.externalId) : null;
    if (candidates && candidates.length === 1) {
      matches.set(job.id, candidates[0]);
      usedInvoiceNos.add(candidates[0].invoiceNo);
    } else if (candidates && candidates.length > 1) {
      ambiguous.push({ job, reason: "ayni-is-emri-no-birden-fazla-fatura", invoices: candidates });
    } else {
      unmatchedJobs.push(job);
    }
  });

  // İkincil: plaka + en yakın tarih (sadece eDMS iş emri no'suz, araç bilgisi
  // olan faturalar arasından; zaten kullanılmış faturalar hariç).
  const plateCandidates = invoices.filter((inv) => !inv.externalId && inv.plate && !usedInvoiceNos.has(inv.invoiceNo));
  unmatchedJobs.forEach((job) => {
    const jobPlate = normalizePlateForMatch(job.plate);
    if (!jobPlate) return;
    const sameplate = plateCandidates.filter((inv) => normalizePlateForMatch(inv.plate) === jobPlate && !usedInvoiceNos.has(inv.invoiceNo));
    const withinWindow = sameplate.filter((inv) => daysBetween(inv.date, job.date) <= windowDays);
    if (!withinWindow.length) return;
    withinWindow.sort((a, b) => daysBetween(a.date, job.date) - daysBetween(b.date, job.date));
    const best = withinWindow[0];
    const tiedCount = withinWindow.filter((inv) => daysBetween(inv.date, job.date) === daysBetween(best.date, job.date)).length;
    if (tiedCount > 1) {
      ambiguous.push({ job, reason: "plaka-tarih-esit-uzaklikta-birden-fazla-fatura", invoices: withinWindow });
      return;
    }
    matches.set(job.id, best);
    usedInvoiceNos.add(best.invoiceNo);
  });

  const matchedInvoiceNos = new Set([...matches.values()].map((inv) => inv.invoiceNo));
  const unmatchedInvoices = invoices.filter((inv) => !matchedInvoiceNos.has(inv.invoiceNo));

  return { matches, ambiguous, unmatchedInvoices };
}

// --- 3) Bir faturanın satırlarından, tek bir iş emrine uygulanacak patch'i
// üretir: Stok satırları job.items'a (parça), Hizmet satırları tek bir
// laborAmount toplamına (her satırın kendi iskontosu düşülerek) dönüşür.
// Eşleşen stok kodu parça envanterinde yoksa, 0 stoklu yeni bir kart önerilir
// (stok eDMS alış faturası içe aktarımıyla zaten güncellenmiş olmalı; burada
// stok tekrar artırılmaz — bu sadece geçmiş kayıt zenginleştirmesidir).
export function buildJobEnrichmentPatch(job, invoice, parts) {
  const partBySku = new Map((Array.isArray(parts) ? parts : []).map((part) => [normalizeSku(part.sku), part]));
  const warnings = [];
  const newParts = [];

  const items = [];
  let laborNetSum = 0;
  const laborLines = [];

  (invoice.items || []).forEach((line) => {
    const gross = roundCurrency(line.unitPrice * line.qty);
    const discount = normalizeDiscount({ type: line.discountPercent > 0 ? "percent" : "none", value: line.discountPercent });
    const discountAmount = calculateDiscountAmount(gross, discount);
    const net = roundCurrency(gross - discountAmount);

    if (line.kind === "Hizmet") {
      laborNetSum = roundCurrency(laborNetSum + net);
      laborLines.push({ kod: line.kod, name: line.name, net });
      return;
    }

    // Stok
    const sku = normalizeSku(line.kod);
    const existing = partBySku.get(sku);
    if (existing) {
      items.push({
        partId: existing.id,
        sku: existing.sku,
        name: existing.name,
        category: existing.category || "Genel",
        brand: existing.brand || "",
        qty: line.qty,
        price: line.unitPrice,
        discountType: discount.type,
        discountValue: discount.value,
      });
    } else {
      const partId = `edms-part-${sku}`;
      if (!newParts.some((p) => p.id === partId)) {
        newParts.push({
          id: partId,
          sku: line.kod,
          skuNormalized: sku,
          name: line.name || line.kod,
          category: "Genel",
          brand: "",
          stock: 0,
          minimum: 5,
          price: line.unitPrice,
          cost: line.unitPrice,
          sold: 0,
          archived: false,
        });
        warnings.push(`${line.kod} stok kodu envanterde bulunamadı; 0 stoklu yeni kart önerildi (satış fiyatı/kategori gözden geçirilmeli).`);
      }
      items.push({
        partId,
        sku: line.kod,
        name: line.name || line.kod,
        category: "Genel",
        brand: "",
        qty: line.qty,
        price: line.unitPrice,
        discountType: discount.type,
        discountValue: discount.value,
      });
    }
  });

  const laborAmount = laborNetSum;
  const laborDiscountType = "none";
  const laborDiscountValue = 0;
  // Uygulamadaki iş emri `total` alanı KDV HARİÇ (net) tutardır. Parça
  // satırlarının net toplamı + işçilik net toplamı (kesirli adetler dahil).
  const partsNetSum = items.reduce((sum, item) => {
    const gross = roundCurrency(item.qty * item.price);
    const discount = normalizeDiscount({ type: item.discountType, value: item.discountValue });
    return roundCurrency(sum + roundCurrency(gross - calculateDiscountAmount(gross, discount)));
  }, 0);
  const total = roundCurrency(partsNetSum + laborAmount);

  // Faturanın KDV hariç (net) tutarı: her satırın (Toplam - İskonto) toplamı.
  const invoiceNetTotal = roundCurrency(
    (invoice.items || []).reduce((sum, l) => sum + roundCurrency(l.lineTotal - l.discountAmount), 0)
  );
  const diff = roundCurrency(total - invoiceNetTotal);
  if (Math.abs(diff) > 1) {
    warnings.push(`Hesaplanan toplam (${total}) faturanın KDV hariç tutarından (${invoiceNetTotal}) ${diff > 0 ? "fazla" : "az"}; fark: ${Math.abs(diff).toFixed(2)} TL.`);
  }

  return {
    patch: {
      items,
      laborAmount,
      laborDiscountType,
      laborDiscountValue,
      total,
      edmsInvoiceNo: invoice.invoiceNo,
      edmsLaborLines: laborLines,
    },
    newParts,
    warnings,
    reconciled: Math.abs(diff) <= 1,
  };
}

// --- 4) Tüm iş emirleri + faturalar için üst düzey orkestrasyon.
export function buildEdmsJobEnrichments(jobs, salesInvoices, parts, options = {}) {
  const inScope = selectEdmsJobsInScope(jobs, options);
  const { matches, ambiguous, unmatchedInvoices } = matchSalesInvoicesToJobs(inScope, salesInvoices, options);

  const enrichments = [];
  const allNewParts = new Map();
  const allWarnings = [];
  const skipped = inScope.filter((job) => !matches.has(job.id));

  matches.forEach((invoice, jobId) => {
    const job = inScope.find((j) => j.id === jobId);
    const { patch, newParts, warnings, reconciled } = buildJobEnrichmentPatch(job, invoice, parts);
    newParts.forEach((part) => allNewParts.set(part.id, part));
    warnings.forEach((w) => allWarnings.push(`[${job.code || job.id}] ${w}`));
    enrichments.push({ jobId, job, invoice, patch, reconciled });
  });

  return {
    enrichments,
    newParts: [...allNewParts.values()],
    warnings: allWarnings,
    ambiguous,
    unmatchedInvoices,
    skippedJobs: skipped,
  };
}

// --- 5) Satın Alma faturalarını createPurchaseInvoice'un beklediği şekle
// dönüştürme (dedup, data.js'te invoices koleksiyonundaki code alanına göre
// yapılır — burada sadece eşleşmeyenler elenir).
export function selectPurchaseInvoicesToImport(purchaseInvoices, existingInvoices) {
  const existingCodes = new Set((Array.isArray(existingInvoices) ? existingInvoices : []).map((inv) => String(inv.code || "").trim()));
  const toAdd = [];
  const alreadyPresent = [];
  (Array.isArray(purchaseInvoices) ? purchaseInvoices : []).forEach((invoice) => {
    if (existingCodes.has(invoice.invoiceNo)) alreadyPresent.push(invoice);
    else toAdd.push(invoice);
  });
  return { toAdd, alreadyPresent };
}

export function buildPurchaseInvoicePayload(invoice, parts) {
  const partBySku = new Map((Array.isArray(parts) ? parts : []).map((part) => [normalizeSku(part.sku), part]));
  const warnings = [];
  const items = [];

  (invoice.items || []).forEach((line) => {
    if (line.kind !== "Stok") {
      warnings.push(`${line.kind} satırı ("${line.name}") alış faturasında atlandı; sadece stok satırları içe aktarılır.`);
      return;
    }
    const gross = roundCurrency(line.unitPrice * line.qty);
    const discount = normalizeDiscount({ type: line.discountPercent > 0 ? "percent" : "none", value: line.discountPercent });
    const discountAmount = calculateDiscountAmount(gross, discount);
    const net = roundCurrency(gross - discountAmount);
    const unitCost = line.qty > 0 ? roundCurrency(net / line.qty) : 0;
    const sku = normalizeSku(line.kod);
    const existing = partBySku.get(sku);
    items.push({
      ...(existing ? { partId: existing.id } : {}),
      sku: line.kod,
      name: existing?.name || line.name || line.kod,
      category: existing?.category,
      brand: existing?.brand,
      qty: Math.round(line.qty),
      cost: unitCost,
      ...(existing ? {} : { price: unitCost }), // yeni kart: satış fiyatı girilmemiş, maliyete eşitlenir (gözden geçirilmeli)
    });
    if (!existing) warnings.push(`${line.kod} stok kodu envanterde bulunamadı; satış fiyatı maliyete eşitlendi, gözden geçirilmeli.`);
  });

  return {
    payload: {
      invoiceNumber: invoice.invoiceNo,
      supplier: invoice.firma || "Bilinmeyen tedarikçi",
      date: invoice.date,
      items,
    },
    warnings,
  };
}
