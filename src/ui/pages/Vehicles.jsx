import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, Icon, Modal, PageHead, Stat } from "../kit.jsx";
import { readSheetRows } from "../excel.js";
import { parseDetailReport, summarizeOrders } from "../../core/workorders.js";
import { useApp } from "../context.js";
import { buildCompat, partVehicles, searchVehicles, splitBrandModel, vehicleKey, vehicleParts } from "../../core/vehicles.js";
import { level, LEVEL_LABEL } from "../../core/stock.js";
import { dateLabel, looseKey, money, qty } from "../../core/format.js";

const LEVEL_TONE = { out: "is-bad", critical: "is-bad", low: "is-warn", good: "is-ok" };

export function VehiclesPage({ params }) {
  const { data, store, run, go } = useApp();
  const [query, setQuery] = useState(params?.q || "");
  const [selKey, setSelKey] = useState(params?.key || null);
  const [adding, setAdding] = useState("");
  const [modelText, setModelText] = useState("");
  const [woPreview, setWoPreview] = useState(null);
  const fileRef = useRef(null);
  // eDMS sekmesinden (Detay Faaliyet Raporu) tarayıcı içinde gelen satırlar. Yalnızca eDMS adresinden kabul edilir; kaydetmeden önce önizleme gösterilir.
  useEffect(() => {
    const EDMS = "https://eurorepar.echo.com.tr";
    const onMsg = (e) => {
      if (e.origin !== EDMS || e.data?.type !== "duar-wdmr003" || !Array.isArray(e.data.rows)) return;
      try { setWoPreview(parseDetailReport(e.data.rows)); } catch (error) { run(async () => { throw error; }); }
    };
    window.addEventListener("message", onMsg);
    if (window.opener) { try { window.opener.postMessage({ type: "duar-ready" }, EDMS); } catch { /* yoksay */ } }
    return () => window.removeEventListener("message", onMsg);
  }, [run]);
  const onFile = async (f) => {
    if (!f) return;
    try { setWoPreview(parseDetailReport(await readSheetRows(f))); } catch (error) { run(async () => { throw error; }); }
    if (fileRef.current) fileRef.current.value = "";
  };
  const saveOrders = async () => {
    if (await run(() => store.importWorkOrders(woPreview).catch((error) => { if (/permission|insufficient/i.test(error?.message || "")) throw new Error("Kaydedilemedi: Firebase kuralına \"workorders\" izni eklenmeli."); throw error; }), `${woPreview.length} iş emri araç hafızasına alındı.`)) setWoPreview(null);
  };
  const compat = useMemo(() => buildCompat(data.issues, data.items.filter((i) => !i.archived), data.workorders), [data.issues, data.items, data.workorders]);
  const list = useMemo(() => searchVehicles(compat, query), [compat, query]);
  const known = list.filter((v) => !v.key.startsWith("PLAKA|"));
  const unknown = list.filter((v) => v.key.startsWith("PLAKA|"));
  const selected = compat.vehicles.get(selKey) || (query ? list[0] : null) || null;
  const parts = useMemo(() => (selected ? vehicleParts(selected, compat.itemsById) : []), [selected, compat]);

  // Sorgu bir parçaya benziyorsa: bu parça hangi araçlarda kullanıldı?
  const partHits = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    if (q.length < 3) return [];
    const l = looseKey(q);
    return data.items.filter((i) => !i.archived && (looseKey(i.sku).includes(l) || i.name.toLocaleLowerCase("tr").includes(q)))
      .map((i) => ({ item: i, vehicles: partVehicles(compat, i.id) })).filter((x) => x.vehicles.length).slice(0, 6);
  }, [query, data.items, compat]);

  const total = [...compat.vehicles.values()];
  const models = total.filter((v) => !v.key.startsWith("PLAKA|"));
  const links = models.reduce((s, v) => s + v.parts.size, 0);

  const addFit = async () => {
    if (!selected || selected.key.startsWith("PLAKA|")) return;
    const q = adding.trim();
    const l = looseKey(q);
    const item = data.items.find((i) => looseKey(i.sku) === l) || data.items.find((i) => i.name.toLocaleLowerCase("tr") === q.toLocaleLowerCase("tr"));
    if (!item) { run(async () => { throw new Error(`"${q}" stok kartı bulunamadı.`); }); return; }
    const fits = [...(item.fits || [])];
    if (fits.some((f) => vehicleKey(f.brand, f.model) === selected.key)) return;
    fits.push({ brand: selected.brand, model: selected.model });
    if (await run(() => store.patchItem(item.id, { fits }), `${item.sku} → ${selected.label} uyumluluğu kaydedildi.`)) setAdding("");
  };
  // Modeli bilinmeyen plaka: plakanın en son satışına model yazılır; hafıza aynı plakalı tüm satışlara uygular.
  const setPlateModel = async () => {
    const plate = selected ? [...selected.plates][0] : "";
    const { brand, model } = splitBrandModel(modelText);
    if (!plate || (!brand && !model)) return;
    const norm = (x) => String(x || "").replace(/\s+/g, "").toLocaleUpperCase("tr");
    const doc = data.issues.filter((d) => !d.cancelled && norm(d.plate) === norm(plate)).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (!doc) return;
    if (await run(() => store.setIssueVehicle(doc.id, { brand, model }), `${plate} → ${[brand, model].filter(Boolean).join(" ")} kaydedildi.`)) { setModelText(""); setSelKey(vehicleKey(brand, model)); }
  };
  const removeFit = (itemId) => {
    const item = compat.itemsById.get(itemId);
    if (!item) return;
    run(() => store.patchItem(item.id, { fits: (item.fits || []).filter((f) => vehicleKey(splitBrandModel(f.model ? `${f.brand || ""} ${f.model}` : f, f.brand).brand, splitBrandModel(f.model ? `${f.brand || ""} ${f.model}` : f, f.brand).model) !== selected.key) }), "Elle eklenen uyumluluk kaldırıldı.");
  };

  return (
    <div className="page">
      <PageHead eyebrow="HAFIZA" title="Araç & parça uyumu" text="eDMS iş emirlerinden ve satışlardan hangi parçanın hangi araca takıldığı hafızaya alınır. Marka, model, gövde, yıl, plaka, şase no ya da parça yazın; o araca uyan parçaları stok durumuyla görün."
        actions={<><input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => onFile(e.target.files?.[0])} /><Button icon="upload" onClick={() => fileRef.current?.click()} title="eDMS → Servis → Raporlar → Detay Faaliyet Raporu (Detaylar görüntülensin) Excel'i">eDMS iş emri raporu yükle</Button></>} />
      {woPreview ? (
        <Modal wide title="eDMS iş emirleri → araç hafızası" subtitle="Detay Faaliyet Raporu okundu. Kontrol edip kaydedin; aynı iş emri tekrar gelirse güncellenir." onClose={() => setWoPreview(null)}
          footer={<><Button onClick={() => setWoPreview(null)}>Vazgeç</Button><Button variant="primary" icon="check" disabled={!woPreview.length} onClick={saveOrders}>{woPreview.length} iş emrini kaydet</Button></>}>
          {(() => { const sm = summarizeOrders(woPreview); return <div className="mini-stats veh-stats"><Stat label="İş emri" value={sm.orders} /><Stat label="Araç modeli" value={sm.models} /><Stat label="Şasi" value={sm.vins} /><Stat label="Parça satırı" value={sm.partLines} tone="ok" /></div>; })()}
          <div className="table-scroll cat-table">
            <table className="table">
              <thead><tr><th>İŞ EMRİ</th><th>ARAÇ</th><th>PLAKA · ŞASİ</th><th className="num">PARÇA</th><th className="num">İŞ</th></tr></thead>
              <tbody>{woPreview.slice(0, 300).map((o) => (
                <tr key={o.no}><td className="stack"><span className="mono">{o.no}</span><small>{dateLabel(o.date)}</small></td><td className="stack"><span className="strong">{o.brand} {o.model}</span><small>{[o.body, o.year].filter(Boolean).join(" · ")}</small></td><td className="stack"><span>{o.plate}</span><small className="mono">{o.vin}</small></td><td className="num">{o.lines.filter((l) => l.kind === "part").length}</td><td className="num">{o.lines.filter((l) => l.kind === "job").length}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Modal>
      ) : null}
      <div className="mini-stats veh-stats">
        <Stat label="Araç modeli" value={models.length} style={{ "--i": 0 }} />
        <Stat label="Kayıtlı plaka" value={compat.plates.size} style={{ "--i": 1 }} />
        <Stat label="Parça – araç eşleşmesi" value={links} tone="ok" style={{ "--i": 2 }} />
        <Stat label="Modeli bilinmeyen" value={unknown.length} tone={unknown.length ? "warn" : ""} sub="eDMS raporunu tekrar yükleyince dolar" style={{ "--i": 3 }} />
      </div>
      <div className="toolbar">
        <label className="search veh-search">
          <Icon name="search" size={17} />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setSelKey(null); }} placeholder="Örn: 3008, Peugeot 208, 55 ABC 123, VF3…, balata" autoFocus aria-label="Araç veya parça ara" />
          {query ? <button type="button" className="icon-btn sm" onClick={() => setQuery("")} aria-label="Temizle"><Icon name="close" size={14} /></button> : null}
        </label>
      </div>

      {partHits.length ? (
        <section className="panel pad veh-parthits">
          <div className="panel-head"><h3>Bu parça hangi araçlarda kullanıldı?</h3></div>
          {partHits.map(({ item, vehicles }) => (
            <div key={item.id} className="veh-hit">
              <button type="button" className="link-btn" onClick={() => go("stok", { itemId: item.id })}><strong>{item.name}</strong> <small className="mono">{item.sku}</small></button>
              <div className="chips">{vehicles.map((v) => <button key={v.key} type="button" className="chip" onClick={() => setSelKey(v.key)}>{v.label}<b>{v.parts.get(item.id)?.times || "elle"}</b></button>)}</div>
            </div>
          ))}
        </section>
      ) : null}

      {!total.length ? (
        <section className="panel pad"><Empty icon="car" title="Henüz araç kaydı yok" text="eDMS satış faturalarını yükledikçe araçlar ve kullanılan parçalar burada birikir. Mevcut satışların araç bilgisini doldurmak için Fatura Raporu'nu Satış ekranından tekrar yükleyin." action={<Button variant="primary" icon="upload" onClick={() => go("satis", { tab: "edms" })}>eDMS satış faturası yükle</Button>} /></section>
      ) : (
        <div className="veh-grid">
          <section className="panel veh-list">
            {known.length ? known.slice(0, 80).map((v, i) => (
              <button key={v.key} type="button" className={`veh-row ${selected?.key === v.key ? "active" : ""}`} style={{ "--i": Math.min(i, 12) }} onClick={() => setSelKey(v.key)}>
                <span className="veh-ico"><Icon name="car" size={18} /></span>
                <span className="veh-name"><strong>{v.label}</strong><small>{v.plates.size} plaka · {v.parts.size} parça · son {dateLabel(v.lastDate)}</small></span>
                <b>{v.services}</b>
              </button>
            )) : <p className="muted veh-none">Modele göre eşleşme yok.</p>}
            {unknown.length ? <>
              <p className="veh-sep">Modeli bilinmeyen plakalar</p>
              {unknown.slice(0, 40).map((v) => (
                <button key={v.key} type="button" className={`veh-row is-unknown ${selected?.key === v.key ? "active" : ""}`} onClick={() => setSelKey(v.key)}>
                  <span className="veh-ico"><Icon name="car" size={18} /></span>
                  <span className="veh-name"><strong>{[...v.plates][0]}</strong><small>{[...v.customers][0] || "—"} · {v.parts.size} parça</small></span>
                  <b>{v.services}</b>
                </button>
              ))}
            </> : null}
          </section>
          <section className="panel pad veh-detail">
            {selected ? <>
              <div className="veh-head">
                <span className="veh-ico big"><Icon name="car" size={26} /></span>
                <div>
                  <h2>{selected.label}</h2>
                  <p className="muted">{[...(selected.bodies || [])].join(", ")}{selected.years?.size ? ` · ${[...selected.years].sort().join(", ")} model` : ""}{selected.bodies?.size || selected.years?.size ? " · " : ""}{selected.services} servis · {[...selected.customers].slice(0, 3).join(", ") || "—"}</p>
                </div>
              </div>
              {selected.plates.size || selected.vins.size ? <div className="chips veh-plates">{[...selected.plates].map((p) => <span key={p} className="chip"><i />{p}</span>)}{[...selected.vins].slice(0, 4).map((v) => <span key={v} className="chip mono">{v}</span>)}</div> : null}
              {parts.length ? (
                <div className="table-scroll">
                  <table className="table">
                    <thead><tr><th>PARÇA</th><th className="num">KULLANIM</th><th className="num">SON FİYAT</th><th>SON</th><th className="num">STOK</th><th /></tr></thead>
                    <tbody>{parts.map((p, i) => (
                      <tr key={p.itemId || p.sku} className="row" style={{ "--d": `${Math.min(i, 20) * 15}ms` }} onClick={() => (p.itemId ? go("stok", { itemId: p.itemId }) : go("stok", { q: p.sku }))}>
                        <td className="stack"><span className="strong">{p.item?.name || p.name}</span><small className="mono">{p.sku}{p.sources.includes("iş emri") ? " · eDMS iş emri" : ""}{p.sources.includes("elle") ? " · elle eklendi" : ""}</small></td>
                        <td className="num">{p.times ? `${p.times} kez · ${qty(p.qty)}` : "—"}</td>
                        <td className="num">{p.lastPrice ? money(p.lastPrice) : "—"}</td>
                        <td className="muted">{p.lastDate ? dateLabel(p.lastDate) : "—"}</td>
                        <td className="num">{p.item ? <span className={`pill ${LEVEL_TONE[level(p.item)]}`}>{qty(p.stock)} · {LEVEL_LABEL[level(p.item)]}</span> : <span className="pill">kart yok</span>}</td>
                        <td>{p.sources.includes("elle") && !p.times ? <button type="button" className="icon-btn sm" onClick={(e) => { e.stopPropagation(); removeFit(p.itemId); }} aria-label="Uyumluluğu kaldır"><Icon name="close" size={13} /></button> : null}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <Empty icon="box" title="Bu araçta parça kaydı yok" />}
              {selected.jobs?.size ? (
                <div className="veh-jobs"><b>Bu modelde yapılan işler</b>{[...selected.jobs.values()].sort((a, b) => b.times - a.times).map((j) => <span key={j.name} className="chip">{j.name}<b>{j.times}×</b></span>)}</div>
              ) : null}
              {!selected.key.startsWith("PLAKA|") ? (
                <form className="veh-add" onSubmit={(e) => { e.preventDefault(); addFit(); }}>
                  <input list="veh-skus" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Bu araca uyan bir parçanın stok kodunu ekle…" aria-label="Uyumlu parça ekle" />
                  <datalist id="veh-skus">{data.items.slice(0, 400).map((i) => <option key={i.id} value={i.sku}>{i.name}</option>)}</datalist>
                  <Button type="submit" icon="plus" disabled={!adding.trim()}>Uyumlu parça ekle</Button>
                </form>
              ) : (
                <form className="veh-add" onSubmit={(e) => { e.preventDefault(); setPlateModel(); }}>
                  <input value={modelText} onChange={(e) => setModelText(e.target.value)} placeholder="Bu plakanın aracı: örn. Peugeot 3008 1.6 HDi" aria-label="Plakanın araç modeli" />
                  <Button type="submit" variant="primary" icon="check" disabled={!modelText.trim()}>Modeli kaydet</Button>
                  <small className="muted veh-note">Ya da eDMS Fatura Raporu'nu Satış ekranından tekrar yükleyin; araç bilgisi otomatik dolar.</small>
                </form>
              )}
            </> : <Empty icon="car" title="Bir araç seçin" text="Soldan bir model seçin veya yukarıdan arayın." />}
          </section>
        </div>
      )}
    </div>
  );
}
