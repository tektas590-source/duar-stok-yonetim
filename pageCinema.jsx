import React, { useEffect, useMemo, useState } from "react";
import { useCountUp, number } from "./stockCinema.jsx";
import { WORK_ORDER_STATUS } from "./workOrderLifecycle.js";

const e = React.createElement;

// İş Emirleri: gösterge saati temalı özet. Açık/tamamlanan/iptal oranını bir ibre ile gösterir.
export function WorkOrdersCinema({ jobs }) {
  const stats = useMemo(() => {
    let open = 0, completed = 0, cancelled = 0, revenue = 0;
    jobs.forEach((job) => {
      if (job.status === WORK_ORDER_STATUS.CANCELLED) cancelled += 1;
      else if (job.status === WORK_ORDER_STATUS.COMPLETED) { completed += 1; revenue += Number(job.total || 0); }
      else open += 1;
    });
    const total = open + completed + cancelled;
    const completion = total ? Math.round((completed / total) * 100) : 0;
    return { open, completed, cancelled, revenue, total, completion };
  }, [jobs]);

  const open = useCountUp(stats.open);
  const completed = useCountUp(stats.completed);
  const revenue = useCountUp(stats.revenue);
  const [ready, setReady] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(id); }, []);

  // Yarım daire ibre: -120deg (boş) ile 120deg (tam) arasında, tamamlanma oranına göre döner.
  const needleAngle = -120 + (ready ? stats.completion : 0) * 2.4;

  return e("section", { className: "wc-hero", "aria-label": "İş emri özeti" },
    e("div", { className: "wc-sweep", "aria-hidden": "true" }),
    e("div", { className: "wc-bar wc-bar-top", "aria-hidden": "true" }),
    e("div", { className: "wc-bar wc-bar-bottom", "aria-hidden": "true" }),
    e("div", { className: "wc-body" },
      e("div", { className: "wc-main" },
        e("p", { className: "wc-eyebrow" }, "ATÖLYE DURUMU"),
        e("div", { className: "wc-units" }, e("strong", null, number(open)), e("span", null, "açık iş emri")),
        e("dl", { className: "wc-facts" },
          e("div", null, e("dt", null, "Tamamlanan"), e("dd", null, number(completed))),
          e("div", null, e("dt", null, "İptal"), e("dd", null, number(stats.cancelled))),
          e("div", null, e("dt", null, "Tamamlanan ciro"), e("dd", null, `₺${number(revenue)}`)))),
      e("div", { className: "wc-gauge", role: "img", "aria-label": `Tamamlanma oranı yüzde ${stats.completion}` },
        e("svg", { viewBox: "0 0 140 90" },
          e("path", { className: "wc-gauge-track", d: "M14 84 A 60 60 0 0 1 126 84" }),
          e("path", { className: "wc-gauge-value", d: "M14 84 A 60 60 0 0 1 126 84", style: { strokeDasharray: 188.5, strokeDashoffset: ready ? 188.5 * (1 - stats.completion / 100) : 188.5 } }),
          e("g", { className: "wc-needle", style: { transform: `rotate(${needleAngle}deg)`, transformOrigin: "70px 84px" } }, e("path", { d: "M70 84 L70 30" }), e("circle", { cx: 70, cy: 84, r: 5 }))),
        e("div", { className: "wc-gauge-text" }, e("strong", null, `%${Math.round(ready ? stats.completion : 0)}`), e("span", null, "tamamlandı")))));
}

// Faturalar: istiflenmiş fiş/kayıt temalı özet; onaylı kaşe ve tedarikçi sayacı.
export function InvoicesCinema({ invoices }) {
  const stats = useMemo(() => {
    const suppliers = new Set();
    let total = 0, parts = 0;
    invoices.forEach((invoice) => {
      if (invoice.supplier) suppliers.add(invoice.supplier.trim().toLocaleLowerCase("tr"));
      total += Number(invoice.total || 0);
      parts += Number(invoice.lines || 0);
    });
    return { count: invoices.length, suppliers: suppliers.size, total, parts };
  }, [invoices]);

  const total = useCountUp(stats.total);
  const count = useCountUp(stats.count);

  return e("section", { className: "ic-hero", "aria-label": "Alış faturaları özeti" },
    e("div", { className: "ic-stack", "aria-hidden": "true" }, e("i", null), e("i", null), e("i", null)),
    e("div", { className: "ic-stamp" }, "KAYITLI"),
    e("div", { className: "ic-body" },
      e("p", { className: "ic-eyebrow" }, "ALIŞ FATURALARI"),
      e("div", { className: "ic-units" }, e("strong", null, `₺${number(total)}`), e("span", null, "toplam alış · KDV hariç")),
      e("dl", { className: "ic-facts" },
        e("div", null, e("dt", null, "Fatura sayısı"), e("dd", null, number(count))),
        e("div", null, e("dt", null, "Tedarikçi"), e("dd", null, number(stats.suppliers))),
        e("div", null, e("dt", null, "Toplam kalem"), e("dd", null, number(stats.parts))))));
}
