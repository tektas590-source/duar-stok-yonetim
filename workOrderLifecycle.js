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

export function getWorkOrderStatusClass(status) {
  if (status === WORK_ORDER_STATUS.COMPLETED) return "status-done";
  if (status === WORK_ORDER_STATUS.CANCELLED) return "status-cancelled";
  return "status-progress";
}
