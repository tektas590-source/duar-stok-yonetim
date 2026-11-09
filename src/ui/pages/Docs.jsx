import React, { useMemo, useState } from "react";
import { Button, Icon, PageHead, Stat } from "../kit.jsx";
import { useApp } from "../context.js";
import { EdmsImport } from "../EdmsImport.jsx";
import { DocForm } from "../DocForm.jsx";
import { DocList } from "../DocList.jsx";
import { moneyShort } from "../../core/format.js";

function Tabs({ tabs, tab, setTab }) {
  return (
    <nav className="tabs" role="tablist">
      {tabs.map(([id, label, icon, badge]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
          <Icon name={icon} size={15} />{label}{badge !== undefined ? <small>{badge}</small> : null}
        </button>
      ))}
    </nav>
  );
}

function monthStats(docs) {
  const month = new Date().toISOString().slice(0, 7);
  const live = docs.filter((d) => !d.cancelled);
  const thisMonth = live.filter((d) => String(d.date).startsWith(month));
  return {
    count: live.length,
    monthCount: thisMonth.length,
    monthNet: thisMonth.reduce((s, d) => s + d.totals.net, 0),
    monthProfit: thisMonth.reduce((s, d) => s + (d.totals.profit || 0), 0),
    edms: live.filter((d) => d.source === "eDMS").length,
  };
}

export function PurchasesPage({ params }) {
  const { data } = useApp();
  const [tab, setTab] = useState(params?.tab || "list");
  const s = useMemo(() => monthStats(data.invoices), [data.invoices]);
  return (
    <div className="page">
      <PageHead eyebrow="GİRİŞ" title="Alış faturaları" text="eDMS Fatura Raporu Excel'ini yükleyin veya faturayı elle girin; stok ve ortalama maliyet anında güncellenir." />
      <div className="stats-row">
        <Stat label="Kayıtlı fatura" value={s.count} style={{ "--i": 0 }} />
        <Stat label="Bu ay fatura" value={s.monthCount} style={{ "--i": 1 }} />
        <Stat label="Bu ay alış · KDV hariç" value={moneyShort(s.monthNet)} style={{ "--i": 2 }} />
        <Stat label="eDMS'ten gelen" value={s.edms} tone="ok" style={{ "--i": 3 }} />
      </div>
      <Tabs tab={tab} setTab={setTab} tabs={[["list", "Faturalar", "receipt", s.count], ["edms", "eDMS Excel yükle", "upload"], ["manual", "Elle fatura", "edit"]]} />
      <div className="stage" key={tab}>
        {tab === "list" ? <DocList docs={data.invoices} kind="purchase" emptyAction={<Button variant="primary" icon="upload" onClick={() => setTab("edms")}>eDMS faturası yükle</Button>} />
          : tab === "edms" ? <EdmsImport defaultTypes={["purchase"]} />
          : <DocForm mode="purchase" onDone={() => setTab("list")} />}
      </div>
    </div>
  );
}

export function IssuesPage({ params }) {
  const { data } = useApp();
  const [tab, setTab] = useState(params?.itemId ? "new" : params?.tab || "new");
  const s = useMemo(() => monthStats(data.issues), [data.issues]);
  return (
    <div className="page">
      <PageHead eyebrow="ÇIKIŞ" title="Satış / stok çıkışı" text="Tezgah satışı, servise verilen parça veya eDMS satış faturaları — stok anında düşer, kâr hesaplanır." />
      <div className="stats-row">
        <Stat label="Toplam belge" value={s.count} style={{ "--i": 0 }} />
        <Stat label="Bu ay çıkış" value={s.monthCount} style={{ "--i": 1 }} />
        <Stat label="Bu ay satış · KDV hariç" value={moneyShort(s.monthNet)} style={{ "--i": 2 }} />
        <Stat label="Bu ay brüt kâr" value={moneyShort(s.monthProfit)} tone={s.monthProfit >= 0 ? "ok" : "bad"} style={{ "--i": 3 }} />
      </div>
      <Tabs tab={tab} setTab={setTab} tabs={[["new", "Yeni çıkış", "out"], ["list", "Belgeler", "receipt", s.count], ["edms", "eDMS satış faturası", "upload"]]} />
      <div className="stage" key={tab}>
        {tab === "new" ? <DocForm mode="issue" initialItemId={params?.itemId} onDone={() => setTab("list")} />
          : tab === "list" ? <DocList docs={data.issues} kind="issue" emptyAction={<Button variant="primary" icon="out" onClick={() => setTab("new")}>İlk çıkışı yap</Button>} />
          : <EdmsImport defaultTypes={["sale"]} />}
      </div>
    </div>
  );
}

export { Tabs };
