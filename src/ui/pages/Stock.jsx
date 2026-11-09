import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Drawer, Empty, Icon, PageHead, Ring, Sparkline, useCountUp, useReady } from "../kit.jsx";
import { useApp } from "../context.js";
import { ItemForm } from "../ItemForm.jsx";
import { LEVEL_LABEL, abcClasses, filterItems, level, stockSeries, summarize, usageMap } from "../../core/stock.js";
import { MOVE_LABEL } from "../../core/ledger.js";
import { dateLabel, money, moneyShort, qty } from "../../core/format.js";
import { downloadRows } from "../excel.js";

const SORTS = [["level", "Duruma göre"], ["name", "Parça adı"], ["sku", "Stok kodu"], ["stock", "Stok miktarı"], ["value", "Stok değeri"], ["price", "Satış fiyatı"], ["updated", "Son işlem"]];
const PAGE = 100;

function StockHero({ summary, lvl, setLvl }) {
  const ready = useReady(60);
  const units = useCountUp(summary.units);
  const cost = useCountUp(summary.costValue);
  const sale = useCountUp(summary.saleValue);
  const pct = (n) => (summary.total ? (n / summary.total) * 100 : 0);
  const segs = [["out", summary.out], ["critical", summary.critical], ["low", summary.low], ["good", summary.good]];
  return (
    <section className={`hero ${ready ? "is-ready" : ""}`}>
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-scan" aria-hidden="true" />
      <div className="curtain curtain-top" aria-hidden="true" />
      <div className="curtain curtain-bottom" aria-hidden="true" />
      <div className="hero-body">
        <div className="hero-main">
          <p className="eyebrow"><i />CANLI STOK</p>
          <div className="hero-big"><strong>{qty(Math.round(units))}</strong><span>birim rafta · {summary.total} çeşit</span></div>
          <div className="hero-kpis">
            <div style={{ "--i": 0 }}><span>Stok değeri · maliyet</span><strong>{moneyShort(cost)}</strong></div>
            <div style={{ "--i": 1 }}><span>Satış karşılığı</span><strong>{moneyShort(sale)}</strong></div>
            <div style={{ "--i": 2 }}><span>Potansiyel brüt kâr</span><strong>{moneyShort(summary.saleValue - summary.costValue)}</strong></div>
            <div style={{ "--i": 3 }} className={summary.noPrice ? "is-warn" : ""}><span>Fiyatsız kart</span><strong>{summary.noPrice}</strong></div>
          </div>
        </div>
        <Ring value={summary.health} label="Stok sağlığı" sub="stok sağlığı" />
      </div>
      <div className="levelbar" aria-hidden="true">{segs.map(([k, n]) => <i key={k} className={`seg seg-${k}`} style={{ width: ready ? `${pct(n)}%` : 0 }} />)}</div>
      <div className="chips" role="group" aria-label="Stok durumu filtresi">
        {[["all", "Tümü", summary.total], ...segs.map(([k, n]) => [k, LEVEL_LABEL[k], n])].map(([k, label, n]) => {
          const active = lvl === k || (lvl === "attention" && (k === "out" || k === "critical"));
          return <button key={k} type="button" className={`chip chip-${k} ${active ? "active" : ""}`} aria-pressed={active} onClick={() => setLvl(lvl === k && k !== "all" ? "all" : k)}><i />{label}<b>{n}</b></button>;
        })}
      </div>
    </section>
  );
}

function Meter({ item }) {
  const stock = Number(item.stock) || 0, min = Number(item.minimum) || 0;
  const scale = Math.max(1, min * 3, stock);
  return <span className={`meter meter-${level(item)}`} aria-hidden="true"><u style={{ width: `${Math.max(3, (stock / scale) * 100)}%` }} /><em style={{ left: `${(min / scale) * 100}%` }} /></span>;
}

function ItemDrawer({ item, onClose, onEdit }) {
  const { data, store, run, go } = useApp();
  const [amount, setAmount] = useState(1);
  const series = useMemo(() => stockSeries(item, data.movements, { days: 60 }).map((p) => p.value), [item, data.movements]);
  const moves = useMemo(() => data.movements.filter((m) => m.itemId === item.id).slice(0, 50), [item, data.movements]);
  const usage = useMemo(() => usageMap([item], data.movements).get(item.id), [item, data.movements]);
  const purchases = useMemo(() => data.invoices.filter((inv) => !inv.cancelled && inv.lines.some((l) => l.itemId === item.id)).slice(0, 8), [item, data.invoices]);
  const lvl = level(item);
  const q = Math.max(0.001, Number(amount) || 1);
  const cost = Number(item.cost) || 0, price = item.price === null || item.price === undefined ? null : Number(item.price);
  return (
    <Drawer onClose={onClose} label={`${item.name} detayı`}>
      {(close) => (
        <>
          <header className={`drawer-head head-${lvl}`}>
            <div>
              <p className="eyebrow mono"><i />{item.sku}</p>
              <h2>{item.name}</h2>
              <div className="tag-row">
                <span className={`badge badge-${lvl}`}><i />{LEVEL_LABEL[lvl]}</span>
                {item.category ? <span className="tag">{item.category}</span> : null}
                {item.brand ? <span className="tag">{item.brand}</span> : null}
                {item.location ? <span className="tag">Raf {item.location}</span> : null}
              </div>
            </div>
            <button type="button" className="icon-btn" onClick={close} aria-label="Kapat"><Icon name="close" /></button>
          </header>
          <div className="drawer-body">
            <div className="mini-stats">
              {[["Stok", `${qty(item.stock)} ${item.unit}`], ["Kritik seviye", `${qty(item.minimum)} ${item.unit}`], ["Ort. maliyet", money(cost)], ["Son alış", money(item.lastCost)], ["Satış fiyatı", price === null ? "Girilmemiş" : money(price)], ["Marj", price ? `%${Math.round(((price - cost) / price) * 100)}` : "—"]].map(([l, v], i) => (
                <div key={l} style={{ "--i": i }}><span>{l}</span><strong>{v}</strong></div>
              ))}
            </div>
            <section className="dsec">
              <div className="dsec-head"><h3>Son 60 gün stok seyri</h3><span>{usage?.cover === null || !usage ? "Son 90 günde çıkış yok" : `Günlük ort. ${qty(usage.daily)} · ≈ ${usage.cover} gün yeter`}</span></div>
              <Sparkline values={series} height={80} />
            </section>
            <section className="dsec">
              <h3>Hızlı işlem</h3>
              <div className="quick-row">
                <input type="number" min="0.001" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Miktar" />
                <Button icon="minus" disabled={Number(item.stock) < q} onClick={() => run(() => store.adjust(item.id, -q, "Elle düzeltme"), `${qty(q)} ${item.unit} düşüldü.`)}>Düş</Button>
                <Button icon="plus" onClick={() => run(() => store.adjust(item.id, q, "Elle düzeltme"), `${qty(q)} ${item.unit} eklendi.`)}>Ekle</Button>
                <Button variant="primary" icon="out" onClick={() => { close(); go("satis", { itemId: item.id }); }}>Satış yap</Button>
                <Button icon="edit" onClick={() => { close(); onEdit(item); }}>Düzenle</Button>
              </div>
              <small className="muted">Düş/Ekle fatura dışı düzeltmedir; hareket geçmişine adınızla kaydedilir.</small>
            </section>
            <section className="dsec">
              <div className="dsec-head"><h3>Alış geçmişi</h3><span>{purchases.length} fatura</span></div>
              {purchases.length ? (
                <ul className="plist">
                  {purchases.map((inv, i) => {
                    const line = inv.lines.find((l) => l.itemId === item.id);
                    return <li key={inv.id} style={{ "--i": i }}><div><strong className="mono">{inv.no}</strong><small>{inv.supplier} · {dateLabel(inv.date)}</small></div><div className="right"><strong className="pos">+{qty(line.qty)}</strong><small>{money(line.net / line.qty)}</small></div></li>;
                  })}
                </ul>
              ) : <p className="muted">Kayıtlı alış faturası yok.</p>}
            </section>
            <section className="dsec">
              <div className="dsec-head"><h3>Hareket zaman çizelgesi</h3><span>{moves.length} kayıt</span></div>
              {moves.length ? (
                <ol className="timeline">
                  {moves.map((m, i) => (
                    <li key={m.id} className={m.qty > 0 ? "is-in" : "is-out"} style={{ "--i": Math.min(i, 20) }}>
                      <i />
                      <div><strong>{MOVE_LABEL[m.type] || m.type}</strong><small>{dateLabel(m.date)} · {m.refNo || m.note || "—"} · {m.actor}</small></div>
                      <b>{m.qty > 0 ? "+" : ""}{qty(m.qty)}<small>→ {qty(m.stockAfter)}</small></b>
                    </li>
                  ))}
                </ol>
              ) : <p className="muted">Henüz hareket yok.</p>}
            </section>
          </div>
        </>
      )}
    </Drawer>
  );
}

export function StockPage({ params }) {
  const { data, store, run, go } = useApp();
  const [query, setQuery] = useState(params?.q || "");
  const [lvl, setLvl] = useState(params?.lvl || "all");
  const [category, setCategory] = useState("all");
  const [brand, setBrand] = useState("all");
  const [favorites, setFavorites] = useState(false);
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState("level");
  const [dir, setDir] = useState("asc");
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState(params?.itemId || null);
  const [editing, setEditing] = useState(params?.newSku ? { prefill: { sku: params.newSku } } : null);
  const searchRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => setLimit(PAGE), [query, lvl, category, brand, favorites, archived, sort, dir]);

  const summary = useMemo(() => summarize(data.items), [data.items]);
  const abc = useMemo(() => abcClasses(data.items), [data.items]);
  const usage = useMemo(() => usageMap(data.items, data.movements), [data.items, data.movements]);
  const categories = useMemo(() => [...new Set(data.items.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr")), [data.items]);
  const brands = useMemo(() => [...new Set(data.items.map((i) => i.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr")), [data.items]);
  const list = useMemo(() => filterItems(data.items, { query, lvl, category, brand, favorites, archived, sort, dir }), [data.items, query, lvl, category, brand, favorites, archived, sort, dir]);
  const shown = list.slice(0, limit);
  const listValue = list.reduce((s, i) => s + Math.max(0, Number(i.stock) || 0) * (Number(i.cost) || 0), 0);
  const openItem = openId ? data.items.find((i) => i.id === openId) : null;

  const exportExcel = () => downloadRows(`duar-stok-${new Date().toISOString().slice(0, 10)}.xlsx`, "Stok", list.map((i) => ({
    "Stok Kodu": i.sku, "Parça Adı": i.name, Kategori: i.category, Marka: i.brand, Raf: i.location, Birim: i.unit,
    Stok: Number(i.stock) || 0, "Kritik Seviye": Number(i.minimum) || 0, "Ort. Maliyet": Number(i.cost) || 0, "Son Alış": Number(i.lastCost) || 0,
    "Satış Fiyatı": i.price ?? "", "Stok Değeri": Math.round(Math.max(0, Number(i.stock) || 0) * (Number(i.cost) || 0) * 100) / 100,
    "90 Gün Çıkış": usage.get(i.id)?.used || 0, "Yeterlilik (gün)": usage.get(i.id)?.cover ?? "", ABC: abc.get(i.id) || "", Durum: LEVEL_LABEL[level(i)],
  })), [20, 40, 14, 14, 8, 6, 8, 12, 12, 12, 12, 14, 12, 14, 5, 10]);

  return (
    <div className="page">
      <PageHead eyebrow="STOK TAKİP" title="Stok" text="Tüm stok kartları, seviyeler ve hareketler tek ekranda." actions={<>
        <Button icon="download" onClick={exportExcel} disabled={!list.length}>Excel</Button>
        <Button icon="inbox" onClick={() => go("alis")}>Alış faturası</Button>
        <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>Stok kartı</Button>
      </>} />
      <StockHero summary={summary} lvl={lvl} setLvl={setLvl} />
      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Stok kodu, parça adı, marka, raf ara…" aria-label="Stok ara" />
          {query ? <button type="button" className="search-clear" onClick={() => setQuery("")} aria-label="Temizle"><Icon name="close" size={13} /></button> : <kbd>/</kbd>}
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategori"><option value="all">Tüm kategoriler</option>{categories.map((c) => <option key={c}>{c}</option>)}</select>
        <select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Marka"><option value="all">Tüm markalar</option>{brands.map((c) => <option key={c}>{c}</option>)}</select>
        <div className="joined">
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sıralama">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <button type="button" className={`icon-btn ${dir === "desc" ? "flip" : ""}`} onClick={() => setDir(dir === "asc" ? "desc" : "asc")} aria-label="Sıralama yönü"><Icon name="sort" size={16} /></button>
        </div>
        <button type="button" className={`toggle ${favorites ? "on" : ""}`} aria-pressed={favorites} onClick={() => setFavorites(!favorites)}><Icon name="star" size={14} />Favori</button>
        <button type="button" className={`toggle ${archived ? "on" : ""}`} aria-pressed={archived} onClick={() => setArchived(!archived)}><Icon name="archive" size={14} />Arşiv</button>
        <span className="count"><b>{list.length}</b> kart · {moneyShort(listValue)}</span>
      </div>
      <section className="panel table-panel">
        {shown.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th /><th>PARÇA</th><th>KATEGORİ · MARKA</th><th>STOK</th><th>YETERLİLİK</th><th className="num">ORT. MALİYET</th><th className="num">SATIŞ</th><th className="num">MARJ</th><th className="num">STOK DEĞERİ</th><th>DURUM</th><th /></tr></thead>
              <tbody>
                {shown.map((item, index) => {
                  const lv = level(item);
                  const u = usage.get(item.id);
                  const cost = Number(item.cost) || 0;
                  const price = item.price === null || item.price === undefined ? null : Number(item.price);
                  const margin = price ? Math.round(((price - cost) / price) * 100) : null;
                  return (
                    <tr key={item.id} className={`row row-${lv}`} style={{ "--d": `${Math.min(index, 25) * 20}ms` }} tabIndex={0}
                      onClick={(e) => { if (!e.target.closest("button")) setOpenId(item.id); }}
                      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) setOpenId(item.id); }}>
                      <td className="fav-cell"><button type="button" className={`fav ${item.favorite ? "on" : ""}`} onClick={() => run(() => store.patchItem(item.id, { favorite: !item.favorite }))} aria-label={item.favorite ? "Favoriden çıkar" : "Favorilere ekle"}><Icon name="star" size={15} /></button></td>
                      <td><div className="part"><span className={`avatar avatar-${lv}`}>{String(item.name || "?").slice(0, 1)}</span><span><strong>{item.name}</strong><small className="mono">{item.sku}{abc.get(item.id) ? <b className={`abc abc-${abc.get(item.id)}`}>{abc.get(item.id)}</b> : null}{item.location ? <em>· {item.location}</em> : null}</small></span></div></td>
                      <td className="stack"><span>{item.category || "—"}</span><small>{item.brand}</small></td>
                      <td><div className="stockcell">
                        <button type="button" className="step" disabled={Number(item.stock) < 1} onClick={() => run(() => store.adjust(item.id, -1, "Hızlı düzeltme"))} aria-label={`${item.name} 1 düş`}><Icon name="minus" size={12} /></button>
                        <span className="stocknum"><strong>{qty(item.stock)}</strong><small>{item.unit} · min {qty(item.minimum)}</small><Meter item={item} /></span>
                        <button type="button" className="step" onClick={() => run(() => store.adjust(item.id, 1, "Hızlı düzeltme"))} aria-label={`${item.name} 1 ekle`}><Icon name="plus" size={12} /></button>
                      </div></td>
                      <td className="stack">{u?.cover === null || !u ? <span className="muted">Çıkış yok</span> : <span className={u.cover < 14 ? "warn" : ""}>{u.cover} gün</span>}{u?.used ? <small>90g: {qty(u.used)} çıkış</small> : null}</td>
                      <td className="num">{money(cost)}</td>
                      <td className="num strong">{price === null ? <span className="tag tag-warn">Fiyat yok</span> : money(price)}</td>
                      <td className={`num ${margin !== null && margin < 10 ? "warn" : ""}`}>{margin === null ? "—" : `%${margin}`}</td>
                      <td className="num">{money(Math.max(0, Number(item.stock) || 0) * cost)}</td>
                      <td><span className={`badge badge-${lv}`}><i />{LEVEL_LABEL[lv]}</span></td>
                      <td><div className="row-actions">
                        <button type="button" className="icon-btn sm" onClick={() => setEditing(item)} aria-label={`${item.name} düzenle`}><Icon name="edit" size={14} /></button>
                        <button type="button" className="icon-btn sm danger" onClick={() => run(() => store.patchItem(item.id, { archived: !item.archived }), item.archived ? "Kart arşivden çıkarıldı." : "Kart arşivlendi.")} aria-label={item.archived ? "Arşivden çıkar" : "Arşivle"}><Icon name={item.archived ? "undo" : "archive"} size={14} /></button>
                        <span className="go" aria-hidden="true"><Icon name="chevron" size={14} /></span>
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="box" title={data.items.length ? "Filtreyle eşleşen kart yok" : "Henüz stok kartı yok"} text={data.items.length ? "Aramayı veya filtreleri temizleyin." : "eDMS alış faturası Excel'ini yükleyin; kartlar ve stoklar otomatik oluşur."}
            action={data.items.length ? null : <Button variant="primary" icon="upload" onClick={() => go("alis", { tab: "edms" })}>eDMS faturası yükle</Button>} />
        )}
        {list.length > limit ? <button type="button" className="more" onClick={() => setLimit(limit + PAGE)}>{list.length - limit} kart daha göster</button> : null}
      </section>
      {openItem ? <ItemDrawer key={openItem.id} item={openItem} onClose={() => setOpenId(null)} onEdit={setEditing} /> : null}
      {editing ? <ItemForm item={editing === "new" || editing.prefill ? null : editing} prefill={editing.prefill} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
