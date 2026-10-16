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

export function getWorkOrderStatusClass(status) {
  if (status === WORK_ORDER_STATUS.COMPLETED) return "status-done";
  if (status === WORK_ORDER_STATUS.CANCELLED) return "status-cancelled";
  return "status-progress";
}
