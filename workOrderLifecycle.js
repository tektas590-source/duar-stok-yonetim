export const WORK_ORDER_STATUS = Object.freeze({
  IN_PROGRESS: "Devam ediyor",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal edildi",
});

export function isCancelledWorkOrder(job) {
  return job?.status === WORK_ORDER_STATUS.CANCELLED;
}

export function getRevenueEligibleWorkOrders(jobs) {
  return jobs.filter((job) => !isCancelledWorkOrder(job));
}

export function getOpenWorkOrders(jobs) {
  return jobs.filter((job) => job.status !== WORK_ORDER_STATUS.COMPLETED && !isCancelledWorkOrder(job));
}

// `part.sold` alanı yalnızca BAZI yazma yollarında artırılıyor: elle iş emri
// kaydetme (createWorkOrder/updateWorkOrder), normal eDMS fatura
// zenginleştirmesi (enrichEdmsJobsWithInvoiceLines) ve bilinen-eksik fatura
// düzeltmesi (fixKnownEdmsInvoiceGaps) bunu yapıyor; ama ör. "Geriye Dönük
// Stok Düzeltmesi" (correctEdmsEnrichmentStock, data.js) SADECE stoğu
// düzeltiyor, `sold`'u güncellemiyor. Sonuç: gerçekten kullanılmış bazı
// parçalar "En çok satan parçalar" / "En çok işlem gören parçalar"
// listelerinde eksik veya yanlış görünüyordu. İş emri tutarının her zaman
// items'tan yeniden hesaplanması (calculateWorkOrderNetTotal) gibi, burada
// da `part.sold`'a güvenmek yerine kullanım adedini doğrudan iş emri
// satırlarından (tek doğruluk kaynağı) hesaplıyoruz.
export function computePartSalesFromJobs(jobs, parts) {
  const totals = new Map(); // partId -> qty
  getRevenueEligibleWorkOrders(jobs || []).forEach((job) => {
    (job.items || []).forEach((item) => {
      if (!item.partId) return;
      totals.set(item.partId, (totals.get(item.partId) || 0) + (Number(item.qty) || 0));
    });
  });
  return (parts || []).map((part) => ({ ...part, sold: totals.get(part.id) || 0 }));
}

// Tek seferlik geçiş düzeltmesi: stok artık bir iş emri "Tamamlandı"
// olduğunda düşülüyor, "Devam ediyor" haldeyken parça girişinde değil (bkz.
// data.js: createWorkOrder/updateWorkOrder/completeWorkOrder). Bu politika
// değişikliğinden ÖNCE oluşturulmuş, hâlâ "Devam ediyor" durumundaki iş
// emirlerinin parçaları ise eski davranışla zaten stoktan düşülmüştü. Bu
// fonksiyon iki şeyi hesaplar: (1) o açık iş emirlerinin parçalarını stoğa
// GERİ YATIRMAK için gereken düzeltmeler, (2) zaten "Tamamlandı" olan
// (ve stoğu zaten doğru şekilde düşülmüş olan) iş emirlerine, yeni politikanın
// gerektirdiği `stockApplied: true` bayrağını geriye dönük eklemek (stok
// değişmez, sadece iş emri iptal edildiğinde doğru davranış için işaretlenir).
// `stockApplied` alanı zaten set edilmiş kayıtlar (bu düzeltme uygulanmış
// veya zaten yeni politikayla oluşturulmuş) atlanır.
export function buildWorkOrderStockPolicyMigration(jobs, parts) {
  const restoreTargets = (jobs || []).filter(
    (job) => job.status === WORK_ORDER_STATUS.IN_PROGRESS && job.stockApplied !== false && (job.items || []).some((item) => item.partId)
  );
  const flagTargets = (jobs || []).filter((job) => job.status === WORK_ORDER_STATUS.COMPLETED && job.stockApplied !== true);

  const partById = new Map((parts || []).map((part) => [part.id, part]));
  const totals = new Map(); // partId -> { qty, name, sku, jobCodes: [] }

  restoreTargets.forEach((job) => {
    (job.items || []).forEach((item) => {
      if (!item.partId) return;
      const entry = totals.get(item.partId) || { qty: 0, name: item.name, sku: item.sku, jobCodes: [] };
      entry.qty += Number(item.qty) || 0;
      entry.jobCodes.push(job.code || job.id);
      totals.set(item.partId, entry);
    });
  });

  const corrections = [];
  totals.forEach((entry, partId) => {
    const part = partById.get(partId);
    const stockBefore = Number(part?.stock || 0);
    const soldBefore = Number(part?.sold || 0);
    corrections.push({
      partId,
      sku: part?.sku || entry.sku,
      name: part?.name || entry.name,
      qty: entry.qty,
      stockBefore,
      stockAfter: stockBefore + entry.qty,
      soldBefore,
      soldAfter: Math.max(0, soldBefore - entry.qty),
      jobCodes: entry.jobCodes,
    });
  });

  return {
    corrections,
    restoreJobIds: restoreTargets.map((job) => job.id),
    restoreJobCount: restoreTargets.length,
    flagJobIds: flagTargets.map((job) => job.id),
    flagJobCount: flagTargets.length,
  };
}

export function getWorkOrderStatusClass(status) {
  if (status === WORK_ORDER_STATUS.COMPLETED) return "status-done";
  if (status === WORK_ORDER_STATUS.CANCELLED) return "status-cancelled";
  return "status-progress";
}
