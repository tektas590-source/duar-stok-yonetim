// Uygulamada aylardır "Devam ediyor" durumunda kalmış, hiçbir parça/işçilik
// girilmemiş eski iş emirleri birikmişti (çoğunlukla Temmuz-Ağustos 2026
// tarihli, muhtemelen o dönemde eDMS'ten içe aktarılıp hiç kapatılmamış
// kayıtlar). Kullanıcı bunları toplu temizlemek, ama GERÇEK veri (parça,
// işçilik veya tutar) içeren hiçbir açık kaydı -- tarihi ne olursa olsun --
// yanlışlıkla silmemek istiyor. Bu modül, sadece "tamamen boş" (0 parça,
// 0 işçilik, 0 tutar) ve belirtilen ay dışında kalan "Devam ediyor" iş
// emirlerini seçer; gerçek silme/stok işlemleri data.js'te yapılır.
import { WORK_ORDER_STATUS } from "./workOrderLifecycle.js";

function hasRealContent(job) {
  const items = Array.isArray(job.items) ? job.items : [];
  const laborAmount = Number(job.laborAmount) || 0;
  const total = Number(job.total) || 0;
  const externalLabor = Array.isArray(job.externalLabor) ? job.externalLabor : [];
  return items.length > 0 || laborAmount > 0 || total > 0 || externalLabor.length > 0;
}

// `keepMonthPrefix`: "YYYY-MM" biçiminde, dokunulmayacak ay (ör. "2026-10").
export function selectStaleOpenWorkOrders(jobs, { keepMonthPrefix } = {}) {
  return (Array.isArray(jobs) ? jobs : []).filter((job) => {
    if (job.status !== WORK_ORDER_STATUS.IN_PROGRESS) return false;
    if (hasRealContent(job)) return false;
    const date = String(job.date || "");
    if (keepMonthPrefix && date.startsWith(keepMonthPrefix)) return false;
    return true;
  });
}

// Ay kuralına uyduğu için silinebilecek olsa da, içinde gerçek veri olduğu
// için OTOMATİK silinMEYEN, dikkat çekilmesi gereken açık iş emirleri.
export function selectOpenWorkOrdersNeedingReview(jobs, { keepMonthPrefix } = {}) {
  return (Array.isArray(jobs) ? jobs : []).filter((job) => {
    if (job.status !== WORK_ORDER_STATUS.IN_PROGRESS) return false;
    if (!hasRealContent(job)) return false;
    const date = String(job.date || "");
    if (keepMonthPrefix && date.startsWith(keepMonthPrefix)) return false;
    return true;
  });
}

export function summarizeStaleOpenWorkOrders(staleJobs) {
  const jobs = Array.isArray(staleJobs) ? staleJobs : [];
  const dates = jobs.map((j) => j.date).filter(Boolean).sort();
  return {
    count: jobs.length,
    dateFrom: dates[0] || null,
    dateTo: dates[dates.length - 1] || null,
  };
}
