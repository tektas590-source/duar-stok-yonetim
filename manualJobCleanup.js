// Kullanıcı eDMS'ten içe aktarmadan önce (veya ona ek olarak) bazı iş
// emirlerini uygulamanın kendi ekranından elle girmişti; bu da mükerrer
// kayıtlara ve ciro farklılığına yol açtı. Bu modül, "eDMS kökenli olmayan"
// (elle girilmiş) iş emirlerini seçer — gerçek silme işlemi (ve stok iadesi)
// data.js'te yapılır, burada sadece saf seçim/özet mantığı var.

export function selectManualWorkOrders(jobs) {
  return (Array.isArray(jobs) ? jobs : []).filter((job) => job.source !== "eDMS");
}

// Silinecek kayıtların önizlemesi için özet: toplam adet, toplam ciro (KDV
// hariç `total` alanı toplamı) ve tarih aralığı — eDMS verisinin kapsamadığı
// bir tarih varsa (ör. Fatura Raporu'nun kapsadığı pencerenin dışında), bu
// kayıt için eDMS'ten bir karşılık gelmeyecektir; arayüz bunu ayrıca uyarır.
export function summarizeManualWorkOrders(manualJobs, { edmsDataFrom = null, edmsDataTo = null } = {}) {
  const jobs = Array.isArray(manualJobs) ? manualJobs : [];
  const dates = jobs.map((job) => job.date).filter(Boolean).sort();
  const totalRevenue = jobs.reduce((sum, job) => sum + (Number(job.total) || 0), 0);
  const outsideEdmsRange = (edmsDataFrom && edmsDataTo)
    ? jobs.filter((job) => !job.date || job.date < edmsDataFrom || job.date > edmsDataTo)
    : [];
  return {
    count: jobs.length,
    totalRevenue,
    dateFrom: dates[0] || null,
    dateTo: dates[dates.length - 1] || null,
    outsideEdmsRange,
  };
}
