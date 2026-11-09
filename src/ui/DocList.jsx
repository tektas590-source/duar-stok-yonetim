import React, { useMemo, useState } from "react";
import { Button, Empty, Icon } from "./kit.jsx";
import { useApp } from "./context.js";
import { dateLabel, money, qty } from "../core/format.js";

// Alış faturaları ve satış/çıkış belgeleri için ortak liste.
export function DocList({ docs, kind, emptyAction }) {
  const { store, run } = useApp();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const col = kind === "purchase" ? "invoices" : "issues";
  const list = useMemo(() => {
    const n = query.trim().toLocaleLowerCase("tr");
    return docs.filter((d) => (showCancelled || !d.cancelled) && (!n || `${d.no} ${d.supplier || ""} ${d.customer || ""} ${d.plate || ""} ${d.lines.map((l) => `${l.sku} ${l.name}`).join(" ")}`.toLocaleLowerCase("tr").includes(n)));
  }, [docs, query, showCancelled]);

  const cancel = (d) => {
    const what = kind === "purchase" ? "Faturadaki miktarlar stoktan düşülecek." : "Çıkan miktarlar stoğa geri eklenecek.";
    if (!window.confirm(`${d.no} iptal edilsin mi? ${what} Belge silinmez, "iptal" olarak kalır.`)) return;
    run(() => store.reverse(col, d.id), `${d.no} iptal edildi, stok düzeltildi.`);
  };

  return (
    <div className="doclist">
      <div className="toolbar">
        <label className="search"><Icon name="search" size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={kind === "purchase" ? "Fatura no, tedarikçi, stok kodu ara…" : "Belge no, müşteri, plaka, stok kodu ara…"} aria-label="Belge ara" /></label>
        <button type="button" className={`toggle ${showCancelled ? "on" : ""}`} aria-pressed={showCancelled} onClick={() => setShowCancelled(!showCancelled)}>İptalleri göster</button>
        <span className="count"><b>{list.length}</b> belge</span>
      </div>
      {list.length ? (
        <div className="invlist">
          {list.map((d, i) => {
            const isOpen = open === d.id;
            return (
              <article key={d.id} className={`inv ${isOpen ? "is-open" : ""} ${d.cancelled ? "is-cancelled" : ""}`} style={{ "--i": Math.min(i, 14) }}>
                <header>
                  <button type="button" className="inv-toggle" onClick={() => setOpen(isOpen ? null : d.id)} aria-expanded={isOpen}>
                    <div className="inv-id"><strong className="mono">{d.no}</strong><small>{dateLabel(d.date)} · {kind === "purchase" ? d.supplier : [d.customer, d.plate].filter(Boolean).join(" · ") || "Tezgah"}</small></div>
                    <div className="inv-meta">
                      {d.source === "eDMS" ? <span className="pill is-info">eDMS</span> : <span className="pill">Elle</span>}
                      {d.cancelled ? <span className="pill is-bad">İptal</span> : null}
                      {kind === "issue" && !d.cancelled ? <span className={`pill ${d.totals.profit >= 0 ? "is-ok" : "is-bad"}`}>Kâr {money(d.totals.profit)}</span> : null}
                      <span className="inv-total"><strong>{money(d.totals.gross)}</strong><small>{d.lines.length} kalem · {qty(d.totals.qty)} birim</small></span>
                      <span className="chev"><Icon name="chevron" /></span>
                    </div>
                  </button>
                </header>
                {isOpen ? (
                  <div className="inv-body">
                    <div className="table-scroll">
                      <table className="table compact">
                        <thead><tr><th>KOD</th><th>PARÇA</th><th className="num">MİKTAR</th><th className="num">BİRİM FİYAT</th><th className="num">İSK.</th><th className="num">NET</th>{kind === "issue" ? <th className="num">MALİYET</th> : null}</tr></thead>
                        <tbody>{d.lines.map((l, k) => (
                          <tr key={k}><td className="mono strong">{l.sku}</td><td>{l.name}{l.isNew ? <span className="pill is-warn sm">yeni kart</span> : null}</td><td className="num">{qty(l.qty)}</td><td className="num">{money(l.unitPrice)}</td><td className="num">{l.discountPct ? `%${qty(l.discountPct)}` : "—"}</td><td className="num strong">{money(l.net)}</td>{kind === "issue" ? <td className="num">{money(l.cost)}</td> : null}</tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <footer className="inv-foot">
                      {d.note ? <span className="grow">{d.note}</span> : <span className="grow muted">{d.actor}</span>}
                      <span>Net <strong>{money(d.totals.net)}</strong></span>
                      <span>KDV <strong>{money(d.totals.vat)}</strong></span>
                      <span>Toplam <strong>{money(d.totals.gross)}</strong></span>
                      {d.edmsGross ? <span className={Math.abs(d.edmsGross - d.totals.gross) < 0.1 ? "ok" : "bad"}>eDMS <strong>{money(d.edmsGross)}</strong></span> : null}
                      {!d.cancelled ? <Button icon="undo" className="danger" onClick={() => cancel(d)}>İptal et</Button> : null}
                    </footer>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : <Empty icon={kind === "purchase" ? "inbox" : "out"} title={docs.length ? "Aramayla eşleşen belge yok" : kind === "purchase" ? "Henüz alış faturası yok" : "Henüz satış / çıkış yok"} action={docs.length ? null : emptyAction} />}
    </div>
  );
}
