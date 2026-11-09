import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, Icon, PageHead, Stat } from "../kit.jsx";
import { useApp } from "../context.js";
import { MOVE_LABEL } from "../../core/ledger.js";
import { compareCount, parseCountSheet } from "../../core/countSheet.js";
import { reorderSuggestions, usageMap } from "../../core/stock.js";
import { dateLabel, money, moneyShort, qty, timeLabel, todayKey } from "../../core/format.js";
import { downloadRows, readSheetRows } from "../excel.js";
import { allowUser, listAllowedUsers, OWNER_EMAIL, removeUser } from "../../firebase.js";

// ── Hareketler ──────────────────────────────────────────────────────────────
export function MovementsPage() {
  const { data, go } = useApp();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [period, setPeriod] = useState("30");
  const [limit, setLimit] = useState(150);
  const list = useMemo(() => {
    const cutoff = period === "all" ? "" : new Date(Date.now() - Number(period) * 86400000).toISOString().slice(0, 10);
    const n = query.trim().toLocaleLowerCase("tr");
    return data.movements.filter((m) => (type === "all" || m.type === type) && (!cutoff || m.date >= cutoff) && (!n || `${m.sku} ${m.name} ${m.refNo || ""} ${m.actor} ${m.note || ""}`.toLocaleLowerCase("tr").includes(n)));
  }, [data.movements, query, type, period]);
  const inQty = list.filter((m) => m.qty > 0).reduce((s, m) => s + m.qty, 0);
  const outQty = list.filter((m) => m.qty < 0).reduce((s, m) => s - m.qty, 0);
  const exportExcel = () => downloadRows(`duar-hareketler-${todayKey()}.xlsx`, "Hareketler", list.map((m) => ({ Tarih: m.date, Saat: timeLabel(m.createdAt), "Stok Kodu": m.sku, "Parça Adı": m.name, İşlem: MOVE_LABEL[m.type], Belge: m.refNo || "", Miktar: m.qty, Önce: m.stockBefore, Sonra: m.stockAfter, "Birim Maliyet": m.unitCost ?? "", Not: m.note || "", Kullanıcı: m.actor })));
  return (
    <div className="page">
      <PageHead eyebrow="DEFTER" title="Stok hareketleri" text="Her giriş, çıkış, düzeltme ve sayım; belge, kullanıcı ve öncesi/sonrası stokla birlikte. Hareketler silinemez." actions={<Button icon="download" onClick={exportExcel} disabled={!list.length}>Excel</Button>} />
      <div className="stats-row">
        <Stat label="Hareket" value={list.length} style={{ "--i": 0 }} />
        <Stat label="Toplam giriş" value={qty(inQty)} tone="ok" style={{ "--i": 1 }} />
        <Stat label="Toplam çıkış" value={qty(outQty)} tone="bad" style={{ "--i": 2 }} />
      </div>
      <div className="toolbar">
        <label className="search"><Icon name="search" size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Stok kodu, parça, belge no, kullanıcı ara…" aria-label="Hareket ara" /></label>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="İşlem türü"><option value="all">Tüm işlemler</option>{Object.entries(MOVE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Dönem"><option value="7">Son 7 gün</option><option value="30">Son 30 gün</option><option value="90">Son 90 gün</option><option value="all">Tümü</option></select>
      </div>
      <section className="panel table-panel">
        {list.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>TARİH</th><th>PARÇA</th><th>İŞLEM</th><th>BELGE / NOT</th><th className="num">MİKTAR</th><th className="num">STOK</th><th>KULLANICI</th></tr></thead>
              <tbody>{list.slice(0, limit).map((m, i) => (
                <tr key={m.id} className="row" style={{ "--d": `${Math.min(i, 25) * 15}ms` }} onClick={() => go("stok", { itemId: m.itemId })}>
                  <td className="stack"><span>{dateLabel(m.date)}</span><small>{timeLabel(m.createdAt)}</small></td>
                  <td className="stack"><span className="strong">{m.name}</span><small className="mono">{m.sku}</small></td>
                  <td><span className={`mv mv-${m.type}`}>{MOVE_LABEL[m.type] || m.type}</span></td>
                  <td className="stack"><span className="mono">{m.refNo || "—"}</span>{m.note ? <small>{m.note}</small> : null}</td>
                  <td className={`num strong ${m.qty > 0 ? "pos" : "neg"}`}>{m.qty > 0 ? "+" : ""}{qty(m.qty)}</td>
                  <td className="num muted">{qty(m.stockBefore)} → <strong>{qty(m.stockAfter)}</strong></td>
                  <td className="muted">{m.actor}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty icon="swap" title="Bu filtrede hareket yok" text="Alış faturası, satış, sayım veya düzeltme yapıldıkça burada görünür." />}
        {list.length > limit ? <button type="button" className="more" onClick={() => setLimit(limit + 150)}>{list.length - limit} hareket daha</button> : null}
      </section>
    </div>
  );
}

// ── Sayım ───────────────────────────────────────────────────────────────────
export function CountPage() {
  const { data, store, run, go } = useApp();
  const [rows, setRows] = useState(null);
  const [file, setFile] = useState("");
  const [filter, setFilter] = useState("diff");
  const [manual, setManual] = useState({});
  const [drag, setDrag] = useState(false);
  const [zeroMissing, setZeroMissing] = useState(true);
  const inputRef = useRef(null);
  const fromFile = file && file !== "Elle sayım";

  async function read(f) {
    if (!f) return;
    setFile(f.name);
    const { lines } = parseCountSheet(await readSheetRows(f));
    setRows(compareCount(lines, data.items));
    setFilter("diff");
  }
  const startManual = () => {
    setFile("Elle sayım");
    setRows(data.items.filter((i) => !i.archived).sort((a, b) => String(a.location || "~").localeCompare(String(b.location || "~"), "tr") || a.name.localeCompare(b.name, "tr")).map((item) => ({ sku: item.sku, name: item.name, item, counted: null, system: Number(item.stock) || 0, diff: null, status: "notcounted" })));
    setFilter("all");
  };
  const effective = (rows || []).map((r) => {
    if (fromFile && zeroMissing && r.status === "notcounted" && manual[r.sku] === undefined) return { ...r, counted: 0, diff: -r.system, status: "diff", zeroed: true };
    const m = manual[r.sku];
    if (m === undefined || m === "" || !r.item) return r;
    const counted = Number(m);
    const diff = Math.round((counted - r.system) * 1000) / 1000;
    return { ...r, counted, diff, status: diff === 0 ? "ok" : "diff" };
  });
  const groups = { diff: effective.filter((r) => r.status === "diff"), missing: effective.filter((r) => r.status === "missing"), notcounted: effective.filter((r) => r.status === "notcounted"), ok: effective.filter((r) => r.status === "ok") };
  const shown = filter === "all" ? effective : groups[filter];
  const diffValue = groups.diff.reduce((s, r) => s + r.diff * (Number(r.item.cost) || 0), 0);

  async function apply() {
    if (!groups.diff.length) return;
    if (!window.confirm(`${groups.diff.length} kartın stoğu sayılan miktara eşitlenecek. Devam edilsin mi?`)) return;
    const countNo = `SAY-${todayKey().replace(/-/g, "")}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const ok = await run(() => store.count(groups.diff.map((r) => ({ itemId: r.item.id, counted: r.counted })), countNo), `Sayım işlendi (${countNo}); ${groups.diff.length} kart düzeltildi.`);
    if (ok !== false) { setRows(null); setManual({}); }
  }

  return (
    <div className="page">
      <PageHead eyebrow="SAYIM" title="Sayım ve eDMS mutabakatı" text="eDMS stok listesi Excel'ini veya raf sayımınızı yükleyin; farkları görün, tek tıkla stoğu eşitleyin." />
      {!rows ? (
        <div className="edms">
          <label className={`drop ${drag ? "is-drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); read(e.dataTransfer.files?.[0]); }}>
            <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => read(e.target.files?.[0])} />
            <span className="drop-orb"><Icon name="clipboard" size={30} /></span>
            <strong>eDMS Stok Mevcut Raporu veya sayım Excel'ini bırakın</strong>
            <span>eDMS → Yedek Parça → Raporlar → Stok Mevcut Raporu (WDMR002) → Excel'e aktar. Stok kodu ve miktar (Fiili Miktar, Bakiye, Sayılan…) otomatik bulunur.</span>
          </label>
          <div className="center"><Button icon="edit" onClick={startManual}>Ya da ekranda elle sayım yap</Button></div>
        </div>
      ) : (
        <>
          <div className="edms-head">
            <div>
              <p className="eyebrow"><i />{file}</p><h2>{effective.length} satır karşılaştırıldı</h2>
              {fromFile ? <label className="check-line"><input type="checkbox" checked={zeroMissing} onChange={(e) => setZeroMissing(e.target.checked)} />Dosyada olmayan kartları 0 say <small>(eDMS Stok Mevcut Raporu yalnızca stoğu olanları listeler)</small></label> : null}
            </div>
            <div className="joined-btns">
              <Button icon="close" onClick={() => { setRows(null); setManual({}); }}>Vazgeç</Button>
              <Button variant="primary" icon="check" onClick={apply} disabled={!groups.diff.length}>{groups.diff.length} farkı stoğa işle</Button>
            </div>
          </div>
          <div className="stats-row clickable">
            {[["diff", "Fark var", "bad"], ["missing", "Sistemde kartı yok", "warn"], ["notcounted", "Sayılmadı", ""], ["ok", "Birebir eşleşti", "ok"], ["all", "Tümü", ""]].map(([k, label, tone], i) => (
              <button key={k} type="button" className={`stat ${tone ? `is-${tone}` : ""} ${filter === k ? "active" : ""}`} style={{ "--i": i }} onClick={() => setFilter(k)}><span>{label}</span><strong>{k === "all" ? effective.length : groups[k].length}</strong></button>
            ))}
          </div>
          {groups.diff.length ? <p className="muted">Farkların maliyet etkisi: <strong className={diffValue >= 0 ? "pos" : "neg"}>{money(diffValue)}</strong></p> : null}
          <section className="panel table-panel">
            {shown.length ? (
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>STOK KODU</th><th>PARÇA</th><th className="num">SİSTEM</th><th className="num">SAYILAN</th><th className="num">FARK</th><th /></tr></thead>
                  <tbody>{shown.slice(0, 400).map((r, i) => (
                    <tr key={`${r.sku}-${i}`} className={`row cnt-${r.status}`} style={{ "--d": `${Math.min(i, 25) * 15}ms` }}>
                      <td className="mono strong">{r.sku}</td>
                      <td className="stack"><span>{r.name || "—"}</span>{r.zeroed ? <small>Dosyada yok → 0</small> : r.item?.location ? <small>Raf {r.item.location}</small> : null}</td>
                      <td className="num">{r.system === null ? "—" : qty(r.system)}</td>
                      <td className="num">{r.item ? <input className="count-input" type="number" min="0" step="any" value={manual[r.sku] ?? (r.counted ?? "")} onChange={(e) => setManual({ ...manual, [r.sku]: e.target.value })} aria-label={`${r.sku} sayılan`} /> : qty(r.counted)}</td>
                      <td className={`num strong ${r.diff > 0 ? "pos" : r.diff < 0 ? "neg" : ""}`}>{r.diff === null ? "—" : `${r.diff > 0 ? "+" : ""}${qty(r.diff)}`}</td>
                      <td>{r.status === "missing" ? <Button icon="plus" onClick={() => go("stok", { newSku: r.sku })}>Kart aç</Button> : null}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <Empty icon="check" title="Bu grupta satır yok" />}
          </section>
        </>
      )}
    </div>
  );
}

// ── Sipariş listesi ─────────────────────────────────────────────────────────
export function OrdersPage() {
  const { data, go } = useApp();
  const usage = useMemo(() => usageMap(data.items, data.movements), [data.items, data.movements]);
  const base = useMemo(() => reorderSuggestions(data.items, usage), [data.items, usage]);
  const [qtys, setQtys] = useState({});
  const [skip, setSkip] = useState(new Set());
  const lines = base.filter((l) => !skip.has(l.item.id)).map((l) => ({ ...l, order: Number(qtys[l.item.id] ?? l.suggest) || 0 }));
  const total = lines.reduce((s, l) => s + l.order * (Number(l.item.lastCost || l.item.cost) || 0), 0);
  const exportExcel = () => downloadRows(`duar-siparis-${todayKey()}.xlsx`, "Sipariş", lines.filter((l) => l.order > 0).map((l) => ({ "Stok Kodu": l.item.sku, "Parça Adı": l.item.name, Marka: l.item.brand, "Mevcut Stok": l.stock, "Kritik Seviye": l.item.minimum, "Sipariş Miktarı": l.order, "Son Alış": l.item.lastCost || l.item.cost, Tutar: Math.round(l.order * (l.item.lastCost || l.item.cost || 0) * 100) / 100 })), [20, 40, 14, 12, 12, 14, 12, 12]);
  const copy = async () => {
    const text = lines.filter((l) => l.order > 0).map((l) => `${l.item.sku}\t${l.item.name}\t${l.order}`).join("\n");
    try { await navigator.clipboard.writeText(text); } catch { /* panoya erişim yoksa sessiz geç */ }
  };
  return (
    <div className="page">
      <PageHead eyebrow="TEDARİK" title="Sipariş listesi" text="Kritik seviyedeki kartlar için öneri: kritik seviyenin 2 katına veya 30 günlük tüketime tamamlar. Miktarları düzenleyip Excel olarak tedarikçiye gönderin." actions={<><Button icon="clipboard" onClick={copy} disabled={!lines.length}>Kopyala</Button><Button variant="primary" icon="download" onClick={exportExcel} disabled={!lines.length}>Excel</Button></>} />
      <div className="stats-row">
        <Stat label="Sipariş edilecek kart" value={lines.filter((l) => l.order > 0).length} style={{ "--i": 0 }} />
        <Stat label="Toplam birim" value={qty(lines.reduce((s, l) => s + l.order, 0))} style={{ "--i": 1 }} />
        <Stat label="Tahmini tutar · KDV hariç" value={moneyShort(total)} tone="warn" style={{ "--i": 2 }} />
      </div>
      <section className="panel table-panel">
        {base.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>PARÇA</th><th className="num">STOK</th><th className="num">KRİTİK</th><th className="num">90G ÇIKIŞ</th><th className="num">SİPARİŞ</th><th className="num">SON ALIŞ</th><th className="num">TUTAR</th><th /></tr></thead>
              <tbody>{base.map((l, i) => {
                const skipped = skip.has(l.item.id);
                const order = Number(qtys[l.item.id] ?? l.suggest) || 0;
                return (
                  <tr key={l.item.id} className={`row ${skipped ? "is-skipped" : ""}`} style={{ "--d": `${Math.min(i, 25) * 18}ms` }}>
                    <td className="stack"><span className="strong">{l.item.name}</span><small className="mono">{l.item.sku}{l.item.brand ? ` · ${l.item.brand}` : ""}</small></td>
                    <td className={`num strong ${l.stock <= 0 ? "neg" : "warn"}`}>{qty(l.stock)}</td>
                    <td className="num">{qty(l.item.minimum)}</td>
                    <td className="num muted">{qty(usage.get(l.item.id)?.used || 0)}</td>
                    <td className="num"><input className="count-input" type="number" min="0" step="any" value={qtys[l.item.id] ?? l.suggest} onChange={(e) => setQtys({ ...qtys, [l.item.id]: e.target.value })} disabled={skipped} aria-label="Sipariş miktarı" /></td>
                    <td className="num">{money(l.item.lastCost || l.item.cost)}</td>
                    <td className="num strong">{skipped ? "—" : money(order * (l.item.lastCost || l.item.cost || 0))}</td>
                    <td><button type="button" className="icon-btn sm" onClick={() => { const n = new Set(skip); skipped ? n.delete(l.item.id) : n.add(l.item.id); setSkip(n); }} aria-label={skipped ? "Listeye geri al" : "Listeden çıkar"}><Icon name={skipped ? "undo" : "close"} size={14} /></button></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <Empty icon="check" title="Kritik seviyede kart yok" text="Stoklar yeterli görünüyor." action={<Button onClick={() => go("stok")}>Stoğa git</Button>} />}
      </section>
    </div>
  );
}

// ── Ayarlar / kullanıcılar ──────────────────────────────────────────────────
export function SettingsPage() {
  const { user, isOwner, toast, store } = useApp();
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState("");
  const load = async () => { if (isOwner && store.kind === "firestore") { try { setUsers(await listAllowedUsers()); } catch (e) { toast(e.message, "bad"); } } };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (e) => {
    e.preventDefault();
    try { await allowUser(email, user.email); setEmail(""); toast("Kullanıcıya erişim verildi.", "ok"); load(); } catch (err) { toast(err.message, "bad"); }
  };
  const remove = async (target) => {
    if (!window.confirm(`${target} erişimi kaldırılsın mı?`)) return;
    try { await removeUser(target); toast("Erişim kaldırıldı.", "ok"); load(); } catch (err) { toast(err.message, "bad"); }
  };
  return (
    <div className="page">
      <PageHead eyebrow="AYARLAR" title="Hesap ve erişim" text={`Giriş yapan: ${user?.email || "—"}`} />
      {isOwner ? (
        <section className="panel pad">
          <h3>Yetkili kullanıcılar</h3>
          <p className="muted">Eklediğiniz kişi aynı e-postayla hesap açıp e-postasını doğruladığında sisteme girebilir. Yönetici: {OWNER_EMAIL}</p>
          <form className="inline-form" onSubmit={add}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ornek@mail.com" required aria-label="E-posta" />
            <Button variant="primary" icon="plus" type="submit">Erişim ver</Button>
          </form>
          <ul className="userlist">
            {users.length ? users.map((u) => (
              <li key={u.email}><span><strong>{u.email}</strong><small>{dateLabel(u.addedAt)} · {u.addedBy}</small></span><Button icon="close" className="danger" onClick={() => remove(u.email)}>Kaldır</Button></li>
            )) : <li className="muted">Henüz ek kullanıcı yok.</li>}
          </ul>
        </section>
      ) : <section className="panel pad"><p className="muted">Kullanıcı yönetimi yalnızca yönetici hesabında görünür.</p></section>}
    </div>
  );
}
