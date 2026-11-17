import React, { useEffect, useMemo, useState } from "react";
import { Button, Empty, Field, Icon, PageHead } from "../kit.jsx";
import { useApp } from "../context.js";
import { looseKey, money, qty, round, toNumber } from "../../core/format.js";
import { DEFAULT_POLICY, fitToTarget, normalizePolicy, quoteTotals, roundPrice, tierPrices, TIERS } from "../../core/pricePolicy.js";
import { CATEGORY_NAMES } from "../../core/categorize.js";
import { nextPlanNo } from "../../core/plans.js";
import { buildCompat, splitBrandModel } from "../../core/vehicles.js";
import { usePolicy, usePricing } from "../pricing.jsx";

const KEY = "duar-quote";
const k = () => Math.random().toString(36).slice(2);
const norm = (s) => String(s || "").replace(/\s+/g, "").toLocaleUpperCase("tr");
const blankHead = { customer: "", plate: "", vehicle: "", phone: "" };

function loadDraft() {
  try { return JSON.parse(sessionStorage.getItem(KEY)) || null; } catch { return null; }
}

// Kâr kuralları: fiyat kademeleri, kategori oranları, alt sınır.
function PolicyEditor({ policy, onClose }) {
  const { store, run } = useApp();
  const [p, setP] = useState(() => JSON.parse(JSON.stringify(policy)));
  const setBand = (i, patch) => setP({ ...p, bands: p.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const example = (cost) => tierPrices(cost, { policy: p });
  return (
    <section className="panel pad policy">
      <div className="panel-head"><h3>Kâr kuralları</h3><span className="muted">Tüm cihazlarda ortak · KDV hariç</span></div>
      <div className="policy-grid">
        <div>
          <h4>Alış fiyatına göre kâr oranı (Dengeli)</h4>
          <p className="muted">Ucuz parçada oran yüksek, pahalı parçada düşük olmalı; böylece hem kâr edilir hem fiyat makul kalır.</p>
          <table className="table policy-bands">
            <thead><tr><th>Alış fiyatı</th><th className="num">Kâr %</th><th className="num">Örnek</th></tr></thead>
            <tbody>{p.bands.map((b, i) => {
              const from = i ? p.bands[i - 1].upTo : 0;
              const sample = b.upTo ? (Number(from) + Number(b.upTo)) / 2 : Number(from) * 1.5;
              const ex = example(sample);
              return (
                <tr key={i}>
                  <td>{b.upTo === null ? `${money(from)} üstü` : <span className="band-in">{money(from)} – <input type="number" min="1" value={b.upTo} onChange={(e) => setBand(i, { upTo: e.target.value })} aria-label="Üst sınır" /></span>}</td>
                  <td className="num"><input type="number" min="0" max="300" value={b.markup} onChange={(e) => setBand(i, { markup: e.target.value })} aria-label="Kâr oranı" /></td>
                  <td className="num muted">{ex ? `${money(sample)} → ${money(ex.dengeli)}` : "—"}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <div>
          <h4>Genel ayarlar</h4>
          <div className="form-grid cols-2">
            <Field label="Uygun / Kârlı farkı (puan)" hint="Uygun = Dengeli − fark, Kârlı = Dengeli + fark"><input type="number" min="0" max="80" value={p.spread} onChange={(e) => setP({ ...p, spread: e.target.value })} /></Field>
            <Field label="Parça başı en az kâr (₺)" hint="Çok ucuz parçada bile en az bu kadar kazan"><input type="number" min="0" value={p.minProfit} onChange={(e) => setP({ ...p, minProfit: e.target.value })} /></Field>
            <Field label="Alt sınır (alış + %)" hint="Bunun altı zarar sayılır; uyarı verir"><input type="number" min="0" max="50" value={p.floorPct} onChange={(e) => setP({ ...p, floorPct: e.target.value })} /></Field>
            <Field label="Son satış fiyatını koru" hint="Aralıktaysa müşteriye aynı fiyatı ver"><select value={p.keepLastSale ? "1" : "0"} onChange={(e) => setP({ ...p, keepLastSale: e.target.value === "1" })}><option value="1">Evet</option><option value="0">Hayır</option></select></Field>
          </div>
          <h4>Kategoriye özel kâr % <small className="muted">(boş = kademe)</small></h4>
          <div className="policy-cats">{CATEGORY_NAMES.filter((c) => c !== "Diğer").map((c) => (
            <label key={c}><span>{c}</span><input type="number" min="0" max="300" value={p.categories[c] ?? ""} placeholder="—" onChange={(e) => setP({ ...p, categories: { ...p.categories, [c]: e.target.value } })} /></label>
          ))}</div>
        </div>
      </div>
      <div className="policy-foot">
        <Button onClick={() => setP(JSON.parse(JSON.stringify(DEFAULT_POLICY)))}>Varsayılana dön</Button>
        <Button onClick={onClose}>Kapat</Button>
        <Button variant="primary" icon="check" onClick={async () => { if (await run(() => store.savePricePolicy(normalizePolicy(p)).catch((error) => { if (/permission|insufficient/i.test(error?.message || "")) throw new Error("Kâr kuralları kaydedilemedi: Firebase kuralına \"settings\" izni eklenmeli (Firestore → Kurallar)."); throw error; }), "Kâr kuralları kaydedildi; tüm öneriler güncellendi.")) onClose(); }}>Kaydet</Button>
      </div>
    </section>
  );
}

export function QuotePage({ params }) {
  const { data, store, run, toast, go } = useApp();
  const policy = usePolicy(data);
  const pricing = usePricing(data);
  const items = data.items.filter((i) => !i.archived);
  const draft = loadDraft();
  const [head, setHead] = useState(draft?.head || blankHead);
  const [lines, setLines] = useState(draft?.lines || []);
  const [labor, setLabor] = useState(draft?.labor || []);
  const [pick, setPick] = useState("");
  const [target, setTarget] = useState("");
  const [showPolicy, setShowPolicy] = useState(Boolean(params?.policy));
  const plateModels = useMemo(() => buildCompat(data.issues, []).plateModels, [data.issues]);

  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify({ head, lines, labor })); } catch { /* yoksay */ } }, [head, lines, labor]);

  // Satırın güncel seviyeleri (stok kartından ya da elle girilen alıştan).
  const calc = (l) => {
    const item = l.itemId ? items.find((i) => i.id === l.itemId) : null;
    const pr = item ? pricing.get(item.id) : null;
    const cost = item ? (pr?.lastCost || Number(item.cost) || 0) : toNumber(l.cost);
    const t = tierPrices(cost, { category: item?.category || l.category, lastSale: pr?.lastSale, policy });
    const price = l.tier === "manual" ? toNumber(l.price) : t ? (l.tier === "rec" ? t.recommended : t[l.tier] ?? t.recommended) : toNumber(l.price);
    return { ...l, item, pr, cost, t, price, floor: t?.floor || cost, q: toNumber(l.qty) || 1 };
  };
  const rows = lines.map(calc);
  const laborRows = labor.map((l) => ({ ...l, q: toNumber(l.qty) || 1, price: toNumber(l.price) }));
  const totals = quoteTotals(rows.map((r) => ({ qty: r.q, price: r.price, cost: r.cost })), laborRows.map((l) => ({ qty: l.q, price: l.price })));
  const below = rows.filter((r) => r.cost > 0 && r.price < r.floor - 0.009);

  const addItem = (text) => {
    const kk = looseKey(text);
    const item = items.find((i) => looseKey(i.sku) === kk) || items.find((i) => `${i.sku} · ${i.name}` === text);
    if (!item) return false;
    setLines((ls) => [...ls, { key: k(), itemId: item.id, sku: item.sku, name: item.name, qty: "1", tier: "rec" }]);
    setPick("");
    return true;
  };
  const addManual = () => setLines((ls) => [...ls, { key: k(), itemId: null, sku: "", name: "", brand: "", category: "", cost: "", qty: "1", tier: "dengeli" }]);
  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const setAll = (tier) => { setLines((ls) => ls.map((l) => ({ ...l, tier }))); setTarget(""); };
  const setPlate = (plate) => {
    const known = [...plateModels.entries()].find(([p]) => norm(p) === norm(plate))?.[1];
    const lastDoc = data.issues.find((d) => norm(d.plate) === norm(plate) && d.customer);
    setHead((h) => ({ ...h, plate, vehicle: !h.vehicle && known ? [known.brand, known.model].filter(Boolean).join(" ") : h.vehicle, customer: !h.customer && lastDoc ? lastDoc.customer : h.customer }));
  };
  const applyTarget = () => {
    const tg = toNumber(target);
    if (!tg) return;
    const res = fitToTarget(rows.map((r) => ({ key: r.key, qty: r.q, price: r.price, cost: r.cost, floor: r.floor })), laborRows.map((l) => ({ qty: l.q, price: l.price })), tg);
    setLines((ls) => ls.map((l) => { const f = res.lines.find((x) => x.key === l.key); return f ? { ...l, tier: "manual", price: String(f.price) } : l; }));
    if (!res.reachable) toast(`Bu toplam alt sınırın altında. Zarar etmeden en düşük: ${money(res.minGross)} (KDV dahil).`, "bad");
  };
  const reset = () => { setHead(blankHead); setLines([]); setLabor([]); setTarget(""); };

  const text = () => {
    const ls = [
      `*Fiyat teklifi*${head.plate ? ` · ${head.plate}` : ""}${head.vehicle ? ` (${head.vehicle})` : ""}`,
      ...rows.map((r) => `• ${r.item?.name || r.name}${r.brand ? ` (${r.brand})` : ""}${r.q !== 1 ? ` x${qty(r.q)}` : ""}: ${money(r.price * r.q * 1.2)}`),
      ...laborRows.filter((l) => l.name).map((l) => `• ${l.name}: ${money(l.price * l.q * 1.2)}`),
      `*Toplam (KDV dahil): ${money(totals.gross)}*`,
    ];
    return ls.join("\n");
  };
  const copy = async () => { try { await navigator.clipboard.writeText(text()); toast("Teklif metni kopyalandı; WhatsApp'a yapıştırabilirsiniz."); } catch { toast("Kopyalanamadı.", "bad"); } };
  const toPlan = async () => {
    const { brand, model } = splitBrandModel(head.vehicle);
    const ok = await run(() => store.savePlan({
      no: nextPlanNo(data.plans), customer: head.customer, phone: head.phone, plate: head.plate, brand, vehicleModel: model, note: "Fiyat teklifinden",
      lines: rows.map((r) => ({ source: r.item ? "stock" : "manual", itemId: r.item?.id || null, sku: r.item?.sku || r.sku, name: r.item?.name || r.name, brand: r.brand || "", qty: r.q, unitPrice: r.price })),
      labor: laborRows.filter((l) => l.name).map((l) => ({ name: l.name, qty: l.q, unitPrice: l.price })),
    }), "Teklif ön tespit olarak kaydedildi.");
    if (ok) { reset(); go("tespit"); }
  };
  const print = () => {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const body = [...rows.map((r) => [r.item?.sku || r.sku, [r.item?.name || r.name, r.brand].filter(Boolean).join(" · "), r.q, r.price]), ...laborRows.filter((l) => l.name).map((l) => ["", l.name, l.q, l.price])]
      .map(([s, n, q, p]) => `<tr><td>${esc(s)}</td><td>${esc(n)}</td><td class="r">${esc(qty(q))}</td><td class="r">${esc(money(p))}</td><td class="r">${esc(money(p * q))}</td></tr>`).join("");
    w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Fiyat teklifi</title><style>body{font:14px system-ui,sans-serif;margin:32px;color:#111}h1{font-size:20px;margin:0 0 6px}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border-bottom:1px solid #ddd;padding:7px 6px;text-align:left}th{font-size:11px;color:#666;text-transform:uppercase}.r{text-align:right}.tot{margin-top:14px;text-align:right;font-size:15px}.muted{color:#666}</style></head><body>
      <h1>Fiyat teklifi</h1><div class="muted">${esc(new Date().toLocaleDateString("tr-TR"))}</div>
      <p><b>${esc(head.plate)}</b> ${esc(head.vehicle)}<br>${esc(head.customer)} ${esc(head.phone)}</p>
      <table><thead><tr><th>Kod</th><th>Parça / işçilik</th><th class="r">Adet</th><th class="r">Birim (KDV hariç)</th><th class="r">Tutar</th></tr></thead><tbody>${body}</tbody></table>
      <div class="tot">Ara toplam ${esc(money(totals.net))}<br>KDV %20 ${esc(money(totals.vat))}<br><b>Genel toplam ${esc(money(totals.gross))}</b></div>
      <script>setTimeout(()=>print(),300)</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="page">
      <PageHead eyebrow="FİYAT" title="Fiyat teklifi" text="Parçaları ekle; her biri için Uygun, Dengeli ve Kârlı fiyatı gör. Kârını ve zarar sınırını anında takip et, müşteriye söyleyeceğin toplama göre ayarla."
        actions={<><Button icon="edit" onClick={() => setShowPolicy(!showPolicy)}>Kâr kuralları</Button>{lines.length || labor.length ? <Button icon="undo" onClick={reset}>Temizle</Button> : null}</>} />
      {showPolicy ? <PolicyEditor policy={policy} onClose={() => setShowPolicy(false)} /> : null}

      <div className="quote-layout">
        <div className="quote-main">
          <section className="panel pad">
            <div className="form-grid cols-4">
              <Field label="Plaka"><input value={head.plate} onChange={(e) => setPlate(e.target.value)} placeholder="55 ABC 123" /></Field>
              <Field label="Müşteri"><input value={head.customer} onChange={(e) => setHead({ ...head, customer: e.target.value })} /></Field>
              <Field label="Araç"><input value={head.vehicle} onChange={(e) => setHead({ ...head, vehicle: e.target.value })} placeholder="Marka model" /></Field>
              <Field label="Telefon"><input value={head.phone} onChange={(e) => setHead({ ...head, phone: e.target.value })} inputMode="tel" /></Field>
            </div>
            <form className="quote-add" onSubmit={(e) => { e.preventDefault(); if (!addItem(pick)) toast("Stokta bu kodla parça yok; 'Elle parça' ile ekleyin.", "bad"); }}>
              <Icon name="search" size={16} />
              <input list="quote-skus" value={pick} onChange={(e) => { setPick(e.target.value); if (items.some((i) => `${i.sku} · ${i.name}` === e.target.value)) addItem(e.target.value); }} placeholder="Stoktan parça ekle: kod veya ad yazın, listeden seçin" aria-label="Parça ekle" />
              <datalist id="quote-skus">{items.map((i) => <option key={i.id} value={`${i.sku} · ${i.name}`} />)}</datalist>
              <Button type="submit" icon="plus">Ekle</Button>
              <Button icon="edit" onClick={addManual}>Elle parça</Button>
            </form>
          </section>

          {rows.length ? (
            <div className="quote-lines">
              {rows.map((r) => {
                const profit = r.price - r.cost;
                const pct = r.cost > 0 ? Math.round((profit / r.cost) * 100) : null;
                const low = r.cost > 0 && r.price < r.floor - 0.009;
                return (
                  <article key={r.key} className={`ql ${low ? "is-low" : ""}`}>
                    <header>
                      {r.item ? <div className="ql-name"><strong>{r.item.name}</strong><small className="mono">{r.item.sku} · stok {qty(r.item.stock)} · {r.item.category || "kategorisiz"}{r.pr?.lastSale ? ` · son satış ${money(r.pr.lastSale.unit)}` : ""}</small></div>
                        : <div className="ql-manual">
                            <input value={r.name} onChange={(e) => setLine(r.key, { name: e.target.value })} placeholder="Parça adı" aria-label="Parça adı" />
                            <input value={r.brand} onChange={(e) => setLine(r.key, { brand: e.target.value })} placeholder="Marka" aria-label="Marka" />
                            <input type="number" min="0" step="0.01" value={r.cost} onChange={(e) => setLine(r.key, { cost: e.target.value })} placeholder="Alış ₺ (KDV hariç)" aria-label="Alış fiyatı" />
                            <select value={r.category} onChange={(e) => setLine(r.key, { category: e.target.value })} aria-label="Kategori"><option value="">Kategori (isteğe bağlı)</option>{CATEGORY_NAMES.map((c) => <option key={c}>{c}</option>)}</select>
                          </div>}
                      <label className="ql-qty"><span>Adet</span><input type="number" min="0" step="any" value={r.qty} onChange={(e) => setLine(r.key, { qty: e.target.value })} /></label>
                      <button type="button" className="icon-btn sm danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== r.key))} aria-label="Kaldır"><Icon name="close" size={14} /></button>
                    </header>
                    {r.t ? (
                      <div className="tier-row">
                        {TIERS.map((t) => (
                          <button key={t.id} type="button" className={`tier is-${t.id} ${r.tier === t.id || (r.tier === "rec" && r.t.recommended === r.t[t.id]) ? "on" : ""}`} onClick={() => setLine(r.key, { tier: t.id })} title={t.hint}>
                            <span>{t.label}{r.t.recommended === r.t[t.id] && r.t.reason !== "son satış fiyatı korunuyor" && t.id === "dengeli" ? " ★" : ""}</span><strong>{money(r.t[t.id])}</strong><small>%{r.t.markups[t.id]} kâr · +{money(r.t[t.id] - r.cost)}</small>
                          </button>
                        ))}
                        <label className={`tier is-manual ${r.tier === "manual" || (r.tier === "rec" && ![r.t.uygun, r.t.dengeli, r.t.karli].includes(r.t.recommended)) ? "on" : ""}`}>
                          <span>{r.tier === "rec" && r.t.reason === "son satış fiyatı korunuyor" ? "Son satış ★" : "Kendi fiyatın"}</span>
                          <input type="number" min="0" step="0.01" value={r.tier === "manual" ? r.price || "" : ""} placeholder={money(r.price)} onChange={(e) => setLine(r.key, { tier: "manual", price: e.target.value })} aria-label="Kendi fiyatın" />
                        </label>
                      </div>
                    ) : <p className="muted ql-need">Fiyat önerisi için alış fiyatını girin{!r.item ? "" : " (bu kartta alış kaydı yok)"}.</p>}
                    <footer>
                      <span>Alış <b>{money(r.cost)}</b></span>
                      <span>Satış <b>{money(r.price)}</b> <small>KDV dahil {money(round(r.price * 1.2, 2))}</small></span>
                      <span className={profit < 0 ? "bad" : "ok"}>Kâr <b>{money(profit * r.q)}</b>{pct !== null ? ` · %${pct}` : ""}</span>
                      {low ? <span className="bad"><Icon name="alert" size={13} /> Alt sınır {money(r.floor)}</span> : null}
                    </footer>
                  </article>
                );
              })}
            </div>
          ) : <section className="panel pad"><Empty icon="receipt" title="Teklife parça ekleyin" text="Yukarıdan stoktaki parçayı seçin ya da sistemde olmayan parçayı alış fiyatıyla elle girin." /></section>}

          <section className="panel pad">
            <div className="panel-head"><h3>İşçilik</h3><span className="muted">Maliyeti yok, tamamı kâr</span></div>
            {labor.map((l) => (
              <div key={l.key} className="plan-labor">
                <input value={l.name} onChange={(e) => setLabor((ls) => ls.map((x) => (x.key === l.key ? { ...x, name: e.target.value } : x)))} placeholder="İşçilik adı" aria-label="İşçilik adı" />
                <input type="number" min="0" step="any" value={l.qty} onChange={(e) => setLabor((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))} aria-label="Adet / saat" />
                <input type="number" min="0" step="0.01" value={l.price} onChange={(e) => setLabor((ls) => ls.map((x) => (x.key === l.key ? { ...x, price: e.target.value } : x)))} placeholder="Tutar (KDV hariç)" aria-label="Tutar" />
                <button type="button" className="icon-btn sm danger" onClick={() => setLabor((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Sil"><Icon name="close" size={14} /></button>
              </div>
            ))}
            <div className="chips">
              <Button icon="plus" onClick={() => setLabor([...labor, { key: k(), name: "", qty: "1", price: "" }])}>İşçilik ekle</Button>
              {["Bakım işçiliği", "Mekanik işçilik", "Balata değişim işçiliği"].map((n) => <button key={n} type="button" className="chip" onClick={() => setLabor([...labor, { key: k(), name: n, qty: "1", price: "" }])}>+ {n}</button>)}
            </div>
          </section>
        </div>

        <aside className="quote-side">
          <section className="panel pad quote-sum">
            <h3>Teklif özeti</h3>
            <div className="qs-big"><span>Müşteriye (KDV dahil)</span><strong>{money(totals.gross)}</strong></div>
            <dl>
              <div><dt>Parça</dt><dd>{money(totals.parts)}</dd></div>
              <div><dt>İşçilik</dt><dd>{money(totals.labor)}</dd></div>
              <div><dt>KDV %20</dt><dd>{money(totals.vat)}</dd></div>
              <div><dt>Parça alış maliyeti</dt><dd>{money(totals.cost)}</dd></div>
              <div className="qs-profit"><dt>Toplam kâr</dt><dd className={totals.profit < 0 ? "bad" : "ok"}>{money(totals.profit)} <small>marj %{totals.margin}</small></dd></div>
            </dl>
            {below.length ? <p className="price-warn"><Icon name="alert" size={15} />{below.length} parça alt sınırın altında; zarar riski.</p> : null}
            <div className="qs-tiers">
              <span>Tümünü:</span>
              {TIERS.map((t) => <button key={t.id} type="button" onClick={() => setAll(t.id)}>{t.label}</button>)}
              <button type="button" onClick={() => setAll("rec")}>Önerilen</button>
            </div>
            <form className="qs-target" onSubmit={(e) => { e.preventDefault(); applyTarget(); }}>
              <label><span>Müşteriye söyleyeceğin toplam (KDV dahil)</span>
                <input type="number" min="0" step="1" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={String(Math.round(totals.gross))} /></label>
              <Button type="submit" disabled={!toNumber(target) || !rows.length}>Fiyatları buna göre ayarla</Button>
              {rows.length ? <small className="muted">Zarar etmeden en düşük toplam: {money(roundPrice(quoteTotals(rows.map((r) => ({ qty: r.q, price: r.floor, cost: r.cost })), laborRows.map((l) => ({ qty: l.q, price: l.price }))).gross))}</small> : null}
            </form>
            <div className="qs-actions">
              <Button variant="primary" icon="clipboard" disabled={!rows.length && !labor.length} onClick={toPlan}>Ön tespit olarak kaydet</Button>
              <Button icon="receipt" disabled={!rows.length && !labor.length} onClick={print}>Yazdır</Button>
              <Button icon="out" disabled={!rows.length && !labor.length} onClick={copy}>WhatsApp metni kopyala</Button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
