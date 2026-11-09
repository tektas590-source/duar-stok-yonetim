import React, { useMemo, useState } from "react";
import { Button, Empty, Icon, PageHead, Ring, useCountUp, useReady } from "../kit.jsx";
import { useApp } from "../context.js";
import { flowSeries, level, LEVEL_LABEL, summarize } from "../../core/stock.js";
import { MOVE_LABEL } from "../../core/ledger.js";
import { dateLabel, money, moneyShort, qty, round, timeLabel } from "../../core/format.js";

function FlowChart({ series }) {
  const ready = useReady(150);
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...series.map((d) => Math.max(d.inValue, d.outValue)));
  const w = 720, h = 200, gap = 4;
  const bw = (w / series.length - gap) / 2;
  const tip = hover !== null ? series[hover] : null;
  return (
    <div className="flow">
      <svg viewBox={`0 0 ${w} ${h + 22}`} role="img" aria-label="Son 30 gün giriş ve çıkış değeri">
        {[0.25, 0.5, 0.75, 1].map((p) => <line key={p} x1="0" x2={w} y1={h - h * p} y2={h - h * p} className="gridline" />)}
        {series.map((d, i) => {
          const x = i * (w / series.length);
          const hi = (d.inValue / max) * (h - 6);
          const ho = (d.outValue / max) * (h - 6);
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y="0" width={w / series.length} height={h} fill="transparent" />
              <rect className="bar bar-in" x={x + gap / 2} width={bw} y={h - (ready ? hi : 0)} height={ready ? hi : 0} rx="2" style={{ transitionDelay: `${i * 18}ms` }} />
              <rect className="bar bar-out" x={x + gap / 2 + bw} width={bw} y={h - (ready ? ho : 0)} height={ready ? ho : 0} rx="2" style={{ transitionDelay: `${i * 18 + 60}ms` }} />
              {i % 5 === 0 ? <text x={x + 2} y={h + 16} className="axis">{d.date.slice(8, 10)}.{d.date.slice(5, 7)}</text> : null}
            </g>
          );
        })}
      </svg>
      <div className="flow-legend">
        <span><i className="dot dot-in" />Giriş (alış maliyeti)</span>
        <span><i className="dot dot-out" />Çıkış (satılan maliyet)</span>
        {tip ? <span className="flow-tip">{dateLabel(tip.date)} · giriş {moneyShort(tip.inValue)} · çıkış {moneyShort(tip.outValue)}</span> : null}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone, onClick, i, format = moneyShort }) {
  const v = useCountUp(value);
  return (
    <button type="button" className={`kpi ${tone ? `is-${tone}` : ""}`} style={{ "--i": i }} onClick={onClick}>
      <span>{label}</span>
      <strong>{format(v)}</strong>
      {sub ? <small>{sub}</small> : null}
    </button>
  );
}

export function DashboardPage() {
  const { data, go, user } = useApp();
  const summary = useMemo(() => summarize(data.items), [data.items]);
  const flow = useMemo(() => flowSeries(data.movements, { days: 30 }), [data.movements]);
  const month = new Date().toISOString().slice(0, 7);
  const monthIn = data.invoices.filter((d) => !d.cancelled && String(d.date).startsWith(month)).reduce((s, d) => s + d.totals.net, 0);
  const monthIssues = data.issues.filter((d) => !d.cancelled && String(d.date).startsWith(month));
  const monthOut = monthIssues.reduce((s, d) => s + d.totals.net, 0);
  const monthProfit = monthIssues.reduce((s, d) => s + (d.totals.profit || 0), 0);
  const critical = data.items.filter((i) => !i.archived && ["out", "critical"].includes(level(i))).sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0)).slice(0, 7);
  const recent = data.movements.slice(0, 9);
  const hour = new Date().getHours();
  const hello = hour < 6 ? "İyi geceler" : hour < 12 ? "Günaydın" : hour < 18 ? "İyi günler" : "İyi akşamlar";
  const name = (user?.email || "").split("@")[0];

  return (
    <div className="page">
      <PageHead eyebrow={new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(new Date()).toLocaleUpperCase("tr")} title={`${hello}${name ? `, ${name}` : ""}`} text="Deponuzun bugünkü durumu." actions={<>
        <Button icon="upload" onClick={() => go("alis", { tab: "edms" })}>eDMS faturası yükle</Button>
        <Button variant="primary" icon="out" onClick={() => go("satis")}>Satış / çıkış</Button>
      </>} />
      <div className="kpis">
        <Kpi i={0} label="Stok değeri · maliyet" value={summary.costValue} sub={`${summary.total} kart · ${qty(summary.units)} birim`} onClick={() => go("stok")} />
        <Kpi i={1} label="Bu ay alış · KDV hariç" value={monthIn} sub={`${data.invoices.filter((d) => !d.cancelled && String(d.date).startsWith(month)).length} fatura`} onClick={() => go("alis")} />
        <Kpi i={2} label="Bu ay satış · KDV hariç" value={monthOut} sub={`${monthIssues.length} belge`} onClick={() => go("satis", { tab: "list" })} />
        <Kpi i={3} label="Bu ay brüt kâr" value={monthProfit} tone={monthProfit >= 0 ? "ok" : "bad"} sub={monthOut ? `marj %${Math.round((monthProfit / monthOut) * 100)}` : "—"} onClick={() => go("rapor")} />
        <Kpi i={4} label="Kritik / tükenen" value={summary.critical + summary.out} tone={summary.critical + summary.out ? "bad" : "ok"} format={(v) => String(Math.round(v))} sub={`${summary.out} tükendi`} onClick={() => go("stok", { lvl: "attention" })} />
      </div>
      <div className="dash-grid">
        <section className="panel pad span-2">
          <div className="panel-head"><h3>Son 30 gün stok akışı</h3><Button onClick={() => go("rapor")}>Raporlar <Icon name="chevron" size={14} /></Button></div>
          <FlowChart series={flow} />
        </section>
        <section className="panel pad health-panel">
          <div className="panel-head"><h3>Stok sağlığı</h3></div>
          <Ring value={summary.health} sub="sağlıklı kart" size={150} />
          <ul className="health-list">{["out", "critical", "low", "good"].map((k) => <li key={k}><i className={`dot dot-${k}`} />{LEVEL_LABEL[k]}<b>{summary[k]}</b></li>)}</ul>
        </section>
        <section className="panel pad">
          <div className="panel-head"><h3>Kritik stoklar</h3><Button onClick={() => go("siparis")}>Sipariş listesi <Icon name="chevron" size={14} /></Button></div>
          {critical.length ? <ul className="mini-list">{critical.map((item, i) => (
            <li key={item.id} style={{ "--i": i }} onClick={() => go("stok", { itemId: item.id })}>
              <span className={`avatar sm avatar-${level(item)}`}>{item.name.slice(0, 1)}</span>
              <div><strong>{item.name}</strong><small className="mono">{item.sku}</small></div>
              <b className={Number(item.stock) <= 0 ? "neg" : "warn"}>{qty(item.stock)}<small>/ {qty(item.minimum)}</small></b>
            </li>
          ))}</ul> : <Empty icon="check" title="Kritik stok yok" />}
        </section>
        <section className="panel pad span-2">
          <div className="panel-head"><h3>Son hareketler</h3><Button onClick={() => go("hareket")}>Tümü <Icon name="chevron" size={14} /></Button></div>
          {recent.length ? <ol className="timeline compact">{recent.map((m, i) => (
            <li key={m.id} className={m.qty > 0 ? "is-in" : "is-out"} style={{ "--i": i }}>
              <i />
              <div><strong>{m.name}</strong><small>{MOVE_LABEL[m.type]} · {m.refNo || m.note || "—"} · {dateLabel(m.date)} {timeLabel(m.createdAt)}</small></div>
              <b>{m.qty > 0 ? "+" : ""}{qty(m.qty)}</b>
            </li>
          ))}</ol> : <Empty icon="swap" title="Henüz hareket yok" text="İlk eDMS alış faturanızı yükleyerek başlayın." action={<Button variant="primary" icon="upload" onClick={() => go("alis", { tab: "edms" })}>eDMS faturası yükle</Button>} />}
        </section>
      </div>
    </div>
  );
}

export function ReportsPage() {
  const { data } = useApp();
  const [range, setRange] = useState("30");
  const cutoff = range === "all" ? "" : new Date(Date.now() - Number(range) * 86400000).toISOString().slice(0, 10);
  const issues = data.issues.filter((d) => !d.cancelled && (!cutoff || d.date >= cutoff));
  const invoices = data.invoices.filter((d) => !d.cancelled && (!cutoff || d.date >= cutoff));
  const top = useMemo(() => {
    const map = new Map();
    issues.forEach((d) => d.lines.forEach((l) => {
      const row = map.get(l.itemId) || { sku: l.sku, name: l.name, qty: 0, net: 0, cost: 0 };
      row.qty += l.qty; row.net += l.net; row.cost += l.cost || 0;
      map.set(l.itemId, row);
    }));
    return [...map.values()].map((r) => ({ ...r, profit: round(r.net - r.cost) })).sort((a, b) => b.net - a.net).slice(0, 12);
  }, [issues]);
  const suppliers = useMemo(() => {
    const map = new Map();
    invoices.forEach((d) => { const r = map.get(d.supplier) || { name: d.supplier, count: 0, net: 0 }; r.count += 1; r.net += d.totals.net; map.set(d.supplier, r); });
    return [...map.values()].sort((a, b) => b.net - a.net).slice(0, 8);
  }, [invoices]);
  const categories = useMemo(() => {
    const map = new Map();
    data.items.filter((i) => !i.archived).forEach((i) => { const k = i.category || "Kategorisiz"; map.set(k, (map.get(k) || 0) + Math.max(0, Number(i.stock) || 0) * (Number(i.cost) || 0)); });
    const total = [...map.values()].reduce((a, b) => a + b, 0) || 1;
    return [...map.entries()].map(([name, value]) => ({ name, value, pct: (value / total) * 100 })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [data.items]);
  const ready = useReady(100);
  const sales = issues.reduce((s, d) => s + d.totals.net, 0);
  const profit = issues.reduce((s, d) => s + (d.totals.profit || 0), 0);
  const maxTop = Math.max(1, ...top.map((t) => t.net));
  const maxSup = Math.max(1, ...suppliers.map((t) => t.net));
  return (
    <div className="page">
      <PageHead eyebrow="ANALİZ" title="Raporlar" text="Satış, kârlılık, tedarikçi ve kategori dağılımı." actions={
        <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Dönem"><option value="7">Son 7 gün</option><option value="30">Son 30 gün</option><option value="90">Son 90 gün</option><option value="365">Son 1 yıl</option><option value="all">Tüm zamanlar</option></select>} />
      <div className="kpis">
        <Kpi i={0} label="Satış · KDV hariç" value={sales} sub={`${issues.length} belge`} />
        <Kpi i={1} label="Brüt kâr" value={profit} tone={profit >= 0 ? "ok" : "bad"} sub={sales ? `marj %${Math.round((profit / sales) * 100)}` : "—"} />
        <Kpi i={2} label="Alış · KDV hariç" value={invoices.reduce((s, d) => s + d.totals.net, 0)} sub={`${invoices.length} fatura`} />
      </div>
      <div className="dash-grid">
        <section className="panel pad span-2">
          <div className="panel-head"><h3>En çok satan parçalar</h3></div>
          {top.length ? <ul className="hbars">{top.map((t, i) => (
            <li key={t.sku} style={{ "--i": i }}>
              <div className="hbar-label"><strong>{t.name}</strong><small className="mono">{t.sku} · {qty(t.qty)} birim · kâr {moneyShort(t.profit)}</small></div>
              <div className="hbar"><u style={{ width: ready ? `${(t.net / maxTop) * 100}%` : 0, transitionDelay: `${i * 50}ms` }} /></div>
              <b>{moneyShort(t.net)}</b>
            </li>
          ))}</ul> : <Empty icon="chart" title="Bu dönemde satış yok" />}
        </section>
        <section className="panel pad">
          <div className="panel-head"><h3>Kategoriye göre stok değeri</h3></div>
          {categories.length ? <ul className="hbars slim">{categories.map((c, i) => (
            <li key={c.name} style={{ "--i": i }}>
              <div className="hbar-label"><strong>{c.name}</strong><small>%{Math.round(c.pct)}</small></div>
              <div className="hbar alt"><u style={{ width: ready ? `${c.pct}%` : 0, transitionDelay: `${i * 50}ms` }} /></div>
              <b>{moneyShort(c.value)}</b>
            </li>
          ))}</ul> : <Empty icon="box" title="Stok yok" />}
        </section>
        <section className="panel pad span-3">
          <div className="panel-head"><h3>Tedarikçiler</h3></div>
          {suppliers.length ? <ul className="hbars">{suppliers.map((s, i) => (
            <li key={s.name} style={{ "--i": i }}>
              <div className="hbar-label"><strong>{s.name}</strong><small>{s.count} fatura</small></div>
              <div className="hbar alt2"><u style={{ width: ready ? `${(s.net / maxSup) * 100}%` : 0, transitionDelay: `${i * 50}ms` }} /></div>
              <b>{money(s.net)}</b>
            </li>
          ))}</ul> : <Empty icon="inbox" title="Bu dönemde alış yok" />}
        </section>
      </div>
    </div>
  );
}
