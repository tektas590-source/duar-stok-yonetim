import React, { useMemo, useRef, useState } from "react";
import { Button, Empty, Icon, Stat } from "./kit.jsx";
import { useApp } from "./context.js";
import { analyzeInvoice, parseFaturaRaporu } from "../core/edms.js";
import { dateLabel, money, moneyShort, qty } from "../core/format.js";
import { readSheetRows } from "./excel.js";

const TYPE_LABEL = { purchase: "Alış", sale: "Satış", return: "İade", other: "Diğer" };

export function EdmsImport({ defaultTypes = ["purchase"] }) {
  const { data, store, toast } = useApp();
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [types, setTypes] = useState(new Set(defaultTypes));
  const [selected, setSelected] = useState(new Set());
  const [open, setOpen] = useState(new Set());
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const inputRef = useRef(null);

  const existing = useMemo(() => new Map([...data.invoices, ...data.issues].map((d) => [d.id, d])), [data.invoices, data.issues]);
  const analyzed = useMemo(() => (parsed ? parsed.invoices.map((inv) => analyzeInvoice(inv, data.items, existing)) : []), [parsed, data.items, existing]);
  const visible = analyzed.filter((a) => types.has(a.type));
  const selectable = (a) => a.importable || a.backfill;
  const chosen = visible.filter((a) => selectable(a) && selected.has(a.no));
  const counts = analyzed.reduce((acc, a) => { acc[a.type] = (acc[a.type] || 0) + 1; return acc; }, {});

  async function read(f) {
    if (!f) return;
    setFile(f.name); setBusy(true); setResults(null);
    try {
      const rows = await readSheetRows(f);
      const result = parseFaturaRaporu(rows);
      setParsed(result);
      const initial = result.invoices.map((inv) => analyzeInvoice(inv, data.items, existing)).filter((a) => (a.importable && a.type === "purchase") || a.backfill);
      setSelected(new Set(initial.map((a) => a.no)));
      setOpen(new Set(result.invoices.length === 1 ? [result.invoices[0].no] : []));
    } catch (error) {
      console.error(error);
      setParsed({ invoices: [], errors: ["Excel dosyası okunamadı. eDMS → Fatura Raporu (WDMR010) ekranından \"Excel'e Aktar\" ile alınan dosyayı seçin."] });
    } finally { setBusy(false); }
  }

  const toggle = (set, setter, key) => { const next = new Set(set); next.has(key) ? next.delete(key) : next.add(key); setter(next); };
  const reset = () => { setParsed(null); setFile(null); setSelected(new Set()); setResults(null); if (inputRef.current) inputRef.current.value = ""; };

  async function commit() {
    setBusy(true);
    try {
      const res = await store.importEdms(chosen);
      // Alış geldiyse, daha önce "stokta yoktu" diye kaydedilen satış kalemlerini stoktan düş.
      let settled = [];
      if (res.some((r) => r.ok && r.doc?.kind === "purchase")) {
        const open = data.issues.filter((d) => !d.cancelled && (d.shortages || []).some((x) => x.missing > 0)).map((d) => d.id);
        settled = await store.settleShortages(open);
      }
      setResults(res);
      if (settled.length) toast(`${settled.length} satışta stokta olmayan kalemler artık stoktan düşüldü (${settled.flatMap((x) => x.items).map((x) => x.sku).slice(0, 4).join(", ")}${settled.flatMap((x) => x.items).length > 4 ? "…" : ""}).`, "ok");
      const ok = res.filter((r) => r.ok).length;
      const filled = res.filter((r) => r.ok && r.backfill).length;
      toast(ok ? `${ok - filled ? `${ok - filled} fatura işlendi` : ""}${ok - filled && filled ? ", " : ""}${filled ? `${filled} kayıtlı satış güncellendi` : ""}${res.length - ok ? `, ${res.length - ok} hata` : ""}.` : "Faturalar işlenemedi.", ok ? "ok" : "bad");
      setSelected(new Set());
    } finally { setBusy(false); }
  }

  if (!parsed) {
    return (
      <div className="edms">
        <label className={`drop ${drag ? "is-drag" : ""} ${busy ? "is-busy" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); read(e.dataTransfer.files?.[0]); }}>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={(e) => read(e.target.files?.[0])} disabled={busy} />
          <span className="drop-orb"><Icon name="upload" size={30} /></span>
          <strong>{busy ? "eDMS raporu çözümleniyor…" : "eDMS Fatura Raporu Excel'ini bırakın"}</strong>
          <span>{file || "veya tıklayıp seçin · .xlsx / .xls"}</span>
        </label>
        <ol className="howto">
          {[["eDMS'e girin", "Raporlar → Fatura Raporu (WDMR010) ekranını açın."], ["Tarih aralığı seçin", "Tip: Satın Alma (alışlar) veya tümünü seçin."], ["Excel'e Aktar", "İnen dosyayı buraya bırakın; Satış faturaları da okunur."], ["Kontrol et, işle", "Her satır eDMS tutarlarıyla birebir karşılaştırılır; onayladıklarınız stoğa girer."]].map(([t, x], i) => (
            <li key={t} style={{ "--i": i }}><b>{i + 1}</b><div><strong>{t}</strong><span>{x}</span></div></li>
          ))}
        </ol>
      </div>
    );
  }

  const sum = (key) => chosen.reduce((s, a) => s + a.totals[key], 0);
  return (
    <div className="edms">
      <div className="edms-head">
        <div>
          <p className="eyebrow"><i />eDMS · FATURA RAPORU (WDMR010)</p>
          <h2>{file}</h2>
          <span className="muted">{Object.entries(counts).map(([t, n]) => `${n} ${TYPE_LABEL[t].toLocaleLowerCase("tr")}`).join(" · ") || "Fatura bulunamadı"}</span>
        </div>
        <div className="joined-btns">
          {["purchase", "sale"].map((t) => (
            <button key={t} type="button" className={`toggle ${types.has(t) ? "on" : ""}`} aria-pressed={types.has(t)} onClick={() => toggle(types, setTypes, t)}>{t === "purchase" ? "Alış faturaları" : "Satış faturaları (stoktan düş)"}<b>{counts[t] || 0}</b></button>
          ))}
          <Button icon="upload" onClick={reset}>Başka dosya</Button>
        </div>
      </div>
      {parsed.errors.length ? <div className="alert"><Icon name="alert" /><div>{parsed.errors.map((e) => <p key={e}>{e}</p>)}</div></div> : null}
      {results ? (
        <div className={`result ${results.every((r) => r.ok) ? "" : "has-bad"}`}>
          <Icon name="check" size={22} />
          <div>
            <strong>{results.filter((r) => r.ok && !r.backfill).length} fatura işlendi{results.some((r) => r.backfill) ? ` · ${results.filter((r) => r.ok && r.backfill).length} kayıtlı satış güncellendi` : ""}</strong>
            {results.filter((r) => !r.ok).map((r) => <span key={r.no}>{r.no}: {r.error}</span>)}
          </div>
        </div>
      ) : null}
      <div className="stats-row">
        <Stat label="Gösterilen fatura" value={visible.length} style={{ "--i": 0 }} />
        <Stat label="İşlenebilir" value={visible.filter((a) => a.importable).length} tone="ok" style={{ "--i": 1 }} />
        {visible.some((a) => a.backfill) ? <Stat label="Güncellenecek kayıtlı satış" value={visible.filter((a) => a.backfill).length} tone="warn" style={{ "--i": 1 }} /> : null}
        <Stat label="Zaten kayıtlı" value={visible.filter((a) => a.already).length} style={{ "--i": 2 }} />
        <Stat label="Tutar farkı" value={visible.filter((a) => !a.match).length} tone={visible.some((a) => !a.match) ? "bad" : "ok"} style={{ "--i": 3 }} />
        <Stat label="Yeni stok kartı" value={visible.filter((a) => a.type === "purchase").reduce((s, a) => s + a.counts.fresh, 0)} tone="warn" style={{ "--i": 4 }} />
        {visible.some((a) => a.type === "sale") ? <Stat label="İşçilik · KDV hariç" value={moneyShort(visible.reduce((s, a) => s + (a.totals.laborNet || 0), 0))} style={{ "--i": 5 }} /> : null}
        <Stat label="Fatura toplamı · KDV dahil" value={moneyShort(visible.reduce((s, a) => s + a.totals.fullGross, 0))} style={{ "--i": 6 }} />
      </div>
      {visible.length ? (
        <div className="invlist">
          {visible.map((a, index) => {
            const isOpen = open.has(a.no);
            return (
              <article key={`${a.type}-${a.no}`} className={`inv ${isOpen ? "is-open" : ""} ${a.already ? "is-done" : ""}`} style={{ "--i": Math.min(index, 14) }}>
                <header>
                  <input type="checkbox" checked={selectable(a) && selected.has(a.no)} disabled={!selectable(a) || busy} onChange={() => toggle(selected, setSelected, a.no)} aria-label={`${a.no} seç`} />
                  <button type="button" className="inv-toggle" onClick={() => toggle(open, setOpen, a.no)} aria-expanded={isOpen}>
                    <div className="inv-id"><strong className="mono">{a.no}</strong><small>{dateLabel(a.date)} · {a.firm || "—"}</small></div>
                    <div className="inv-meta">
                      <span className={`pill ${a.type === "purchase" ? "is-info" : "is-violet"}`}>{TYPE_LABEL[a.type]}</span>
                      {a.already ? <span className="pill">Zaten kayıtlı</span> : null}
                      {a.reimport ? <span className="pill is-warn" title="Bu fatura daha önce yüklenip iptal edilmiş; yeniden yüklenebilir.">İptal edilmişti · yeniden yüklenecek</span> : null}
                      {a.backfill ? <span className="pill is-warn">{a.needsServices ? "İşçilik eklenecek" : a.needsVehicle ? "Araç bilgisi eklenecek" : "eDMS tutarı işlenecek"}</span> : null}
                      {a.type === "sale" && a.vehicle && (a.vehicle.model || a.vehicle.brand) ? <span className="pill">{[a.vehicle.brand, a.vehicle.model].filter(Boolean).join(" ")}</span> : null}
                      {a.totals.laborNet ? <span className="pill is-violet">İşçilik {money(a.totals.laborNet)}</span> : null}
                      <span className={`pill ${a.match ? "is-ok" : "is-bad"}`}><Icon name={a.match ? "check" : "alert"} size={12} />{a.match ? "eDMS ile birebir" : "Tutar farkı"}</span>
                      {a.type === "purchase" && a.counts.fresh ? <span className="pill is-warn">{a.counts.fresh} yeni kart</span> : null}
                      {a.type === "sale" && a.counts.fresh ? <span className="pill is-warn">{a.counts.fresh} kartsız parça · ciroya girer</span> : null}
                      {a.counts.short ? <span className="pill is-bad">{a.counts.short} kalem stok yetersiz</span> : null}
                      <span className="inv-total"><strong>{money(a.totals.fullGross)}</strong><small>{a.counts.stock} parça · {qty(a.totals.units)} birim{a.counts.service ? ` · ${a.counts.service} hizmet` : ""}</small></span>
                      <span className="chev"><Icon name="chevron" /></span>
                    </div>
                  </button>
                </header>
                {isOpen ? (
                  <div className="inv-body">
                    <div className="table-scroll">
                      <table className="table compact">
                        <thead><tr><th>KOD</th><th>AÇIKLAMA</th><th className="num">MİKTAR</th><th className="num">BİRİM</th><th className="num">İSK.</th><th className="num">NET</th><th className="num">eDMS NET</th><th className="num">KDV</th><th>SİSTEMDE</th><th className="num">STOK</th></tr></thead>
                        <tbody>
                          {a.lines.map((l) => (
                            <tr key={l.index} className={!l.isStock ? "is-service" : !l.amountOk || l.short ? "is-bad" : ""}>
                              <td className="mono strong">{l.code}</td>
                              <td>{l.name}{!l.isStock ? <small className="muted"> · {a.type === "sale" ? "işçilik, ciroya girer" : "hizmet, stoğa girmez"}</small> : null}</td>
                              <td className="num">{qty(l.qty)}</td>
                              <td className="num">{money(l.unitPrice)}</td>
                              <td className="num">{l.discountPct ? `%${qty(l.discountPct)}` : "—"}</td>
                              <td className="num strong">{money(l.net)}</td>
                              <td className={`num ${l.amountOk ? "ok" : "bad"}`}>{money(l.edmsNet)} {l.amountOk ? "✓" : "≠"}</td>
                              <td className="num">{money(l.vatAmount)}</td>
                              <td>{!l.isStock ? (a.type === "sale" ? <span className="pill is-violet">İşçilik</span> : "—") : l.match === "new" ? <span className="pill is-warn">{a.type === "purchase" ? "Yeni kart açılır" : "Kartsız · stoğa dokunmaz"}</span> : <span className="match"><span className={`pill ${l.match === "exact" ? "is-ok" : "is-info"}`}>{l.match === "exact" ? "Birebir" : `≈ ${l.item.sku}`}</span><small>{l.item.name}</small></span>}</td>
                              <td className="num">{l.isStock && (l.item || a.type === "purchase") ? <>{qty(l.stockBefore)} → <strong className={l.short ? "bad" : ""}>{qty(l.stockAfter)}</strong></> : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <footer className="inv-foot">
                      <span>Parça net <strong>{money(a.totals.net)}</strong></span>
                      {a.counts.service ? <span>{a.type === "sale" ? "İşçilik" : "Hizmet"} net <strong>{money(a.lines.filter((l) => !l.isStock).reduce((s, l) => s + l.net, 0))}</strong></span> : null}
                      <span>Toplam · KDV dahil <strong>{money(a.totals.fullGross)}</strong></span>
                      <span className={a.match ? "ok" : "bad"}>eDMS Fatura Tutarı <strong>{money(a.reportGross ?? a.totals.edmsGross)}</strong> {a.match ? "✓" : "≠"}</span>
                    </footer>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : <Empty icon="receipt" title="Seçili türde fatura yok" text="Yukarıdan Alış / Satış filtresini değiştirin veya başka bir rapor yükleyin." />}
      {visible.some(selectable) ? (
        <div className="commit">
          <div><strong>{chosen.length} fatura seçildi</strong><span>{qty(chosen.filter((a) => !a.backfill).reduce((s, a) => s + a.totals.units, 0))} birim stoğa işlenecek · {money(sum("fullNet"))} KDV hariç{chosen.some((a) => a.backfill) ? ` · ${chosen.filter((a) => a.backfill).length} kayıtlı satış güncellenecek (stok değişmez)` : ""}</span></div>
          <Button onClick={() => setSelected(new Set(visible.filter(selectable).map((a) => a.no)))} disabled={busy}>Tümünü seç</Button>
          <Button variant="primary" icon="check" onClick={commit} disabled={busy || !chosen.length}>{busy ? "İşleniyor…" : "Seçilenleri stoğa işle"}</Button>
        </div>
      ) : null}
    </div>
  );
}
