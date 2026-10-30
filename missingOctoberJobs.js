// Kullanıcının isteğiyle: eDMS'in canlı "İş Emri" ekranında hâlâ açık olan
// ama uygulamada hiç karşılığı olmayan Ekim 2026 iş emirlerini (1026001,
// 1028001, 1030001), eDMS'teki "Planlanan" parça/işçilik verileriyle birlikte
// uygulamaya ekler. Bu GERÇEK bir fatura DEĞİLDİR (iş emirleri henüz
// faturalanmamış, eDMS'te hâlâ "Devam ediyor" durumda); bu yüzden normal
// buildJobFromInvoice/KNOWN_INVOICE_GAPS akışı (ki gerçek bir Satış Faturası
// satırı gerektirir) burada kullanılamaz. Bunun yerine, eDMS İş Emri
// ekranından elle okunan satırlar invoice.items ile AYNI şekle
// (kind/kod/name/unitPrice/qty/discountPercent) dönüştürülüp
// buildJobEnrichmentPatch'e "sahte fatura" olarak verilir — böylece parça
// eşleştirme (var olan parçaya partId bağlama; SKU envanterde yoksa 0
// stoklu yeni kart önerme; mevcut parçanın kendi kanonik adını kullanma)
// ve tutar hesaplama mantığı GERÇEK fatura akışıyla birebir aynı kalır.
//
// `total` kasıtlı olarak 0 bırakılır (bu veriler "Planlanan"dır, henüz
// faturalanmamıştır) ve HİÇBİR stok düşülmez — eDMS'in kendi "Kullanılan"
// sütunu bazı parçalarda şu an 0'dan büyük olsa bile (fiilen tüketilmiş
// görünse de), gerçek ve tek seferlik stok etkisini, ileride gerçek fatura
// geldiğinde çalışacak olan `enrichEdmsJobsWithInvoiceLines`'a bırakıyoruz —
// aksi halde (burada da düşüp, fatura geldiğinde tekrar düşülürse) stok iki
// kez düşülmüş olur. Bu jobun tekrar işlenebilmesi için `plannedFromEdmsAt`
// alanı eklenir; bkz. edmsInvoiceReconcile.js: selectEdmsJobsInScope.
import { WORK_ORDER_STATUS } from "./workOrderLifecycle.js";
import { buildJobEnrichmentPatch } from "./edmsInvoiceReconcile.js";

// `defs`, app.jsx'teki sabit (hardcoded) MISSING_OCTOBER_JOBS listesinden
// gelir — otomatik/toplu bir tarama DEĞİLDİR, her kayıt kullanıcıyla
// birlikte tek tek teyit edilmiştir. Zaten eklenmiş olanlar (id eşleşirse)
// tekrar oluşturulmaz — idempotenttir.
export function selectMissingOctoberJobDefs(defs, existingJobs) {
  const existingIds = new Set((Array.isArray(existingJobs) ? existingJobs : []).map((job) => job.id));
  return (Array.isArray(defs) ? defs : []).filter((def) => !existingIds.has(`edms-job-${def.externalId}`));
}

export function buildMissingOctoberJobRecords(defs, parts) {
  const now = new Date().toISOString();
  const jobs = [];
  const newParts = [];
  const warnings = [];

  defs.forEach((def) => {
    const syntheticInvoice = { invoiceNo: null, items: def.lines };
    const { patch, newParts: jobNewParts, warnings: jobWarnings } = buildJobEnrichmentPatch(null, syntheticInvoice, parts);
    jobNewParts.forEach((part) => {
      if (!newParts.some((p) => p.id === part.id)) newParts.push(part);
    });
    jobWarnings.forEach((warning) => warnings.push(`[EDMS-${def.externalId}] ${warning}`));

    jobs.push({
      id: `edms-job-${def.externalId}`,
      code: `EDMS-${def.externalId}`,
      source: "eDMS",
      externalId: def.externalId,
      status: WORK_ORDER_STATUS.IN_PROGRESS,
      ...def.header,
      items: patch.items,
      laborAmount: patch.laborAmount,
      laborDiscountType: null,
      laborDiscountValue: 0,
      externalLabor: [],
      edmsLaborLines: patch.edmsLaborLines,
      total: 0,
      plannedFromEdmsAt: now,
      movementLedgerVersion: 1,
      createdFromMissingOctoberJobFixAt: now,
    });
  });

  return { jobs, newParts, warnings };
}

export function summarizeMissingOctoberJobs(defs) {
  const list = Array.isArray(defs) ? defs : [];
  return {
    count: list.length,
    partLineCount: list.reduce((sum, def) => sum + def.lines.filter((line) => line.kind === "Stok").length, 0),
    laborLineCount: list.reduce((sum, def) => sum + def.lines.filter((line) => line.kind === "Hizmet").length, 0),
  };
}
