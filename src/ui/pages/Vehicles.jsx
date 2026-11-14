import React, { useMemo, useState } from "react";
import { Button, Empty, Icon, PageHead, Stat } from "../kit.jsx";
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
  const compat = useMemo(() => buildCompat(data.issues, data.items.filter((i) => !i.archived)), [data.issues, data.items]);
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
      <PageHead eyebrow="HAFIZA" title="Araç & parça uyumu" text="Her satışta hangi parçanın hangi araca takıldığı otomatik kaydedilir. Marka, model, plaka, şase no ya da parça yazın; o araca uyan parçaları stok durumuyla görün." />
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
                  <p className="muted">{selected.services} servis · {[...selected.customers].slice(0, 3).join(", ") || "—"}</p>
                </div>
              </div>
              {selected.plates.size || selected.vins.size ? <div className="chips veh-plates">{[...selected.plates].map((p) => <span key={p} className="chip"><i />{p}</span>)}{[...selected.vins].slice(0, 4).map((v) => <span key={v} className="chip mono">{v}</span>)}</div> : null}
              {parts.length ? (
                <div className="table-scroll">
                  <table className="table">
                    <thead><tr><th>PARÇA</th><th className="num">KULLANIM</th><th className="num">SON FİYAT</th><th>SON</th><th className="num">STOK</th><th /></tr></thead>
                    <tbody>{parts.map((p, i) => (
                      <tr key={p.itemId || p.sku} className="row" style={{ "--d": `${Math.min(i, 20) * 15}ms` }} onClick={() => (p.itemId ? go("stok", { itemId: p.itemId }) : go("stok", { q: p.sku }))}>
                        <td className="stack"><span className="strong">{p.item?.name || p.name}</span><small className="mono">{p.sku}{p.sources.includes("elle") ? " · elle eklendi" : ""}</small></td>
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
