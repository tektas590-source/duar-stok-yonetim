import React, { useMemo, useState } from "react";
import { Button, Field, Icon } from "./kit.jsx";
import { useApp } from "./context.js";
import { looseKey, money, qty, round, skuKey, todayKey, toNumber, VAT_RATE } from "../core/format.js";
import { buildCompat, splitBrandModel } from "../core/vehicles.js";

const emptyLine = () => ({ key: Math.random().toString(36).slice(2), sku: "", name: "", qty: "1", unitPrice: "", discountPct: "" });

function findItem(items, sku) {
  const k = skuKey(sku), l = looseKey(sku);
  return items.find((i) => skuKey(i.sku) === k) || (l.length >= 3 ? items.find((i) => looseKey(i.sku) === l) : null) || null;
}

// mode: "purchase" (alış faturası) | "issue" (satış / çıkış)
export function DocForm({ mode, initialItemId, onDone }) {
  const { data, store, run, toast } = useApp();
  const isPurchase = mode === "purchase";
  const items = useMemo(() => data.items.filter((i) => !i.archived), [data.items]);
  const nextIssueNo = useMemo(() => {
    const n = data.issues.filter((d) => /^S-\d+$/.test(d.no)).map((d) => Number(d.no.slice(2))).reduce((a, b) => Math.max(a, b), 0);
    return `S-${String(n + 1).padStart(5, "0")}`;
  }, [data.issues]);
  const initLines = () => {
    if (!initialItemId) return [emptyLine()];
    const item = items.find((i) => i.id === initialItemId);
    return item ? [{ ...emptyLine(), sku: item.sku, name: item.name, unitPrice: item.price ?? "" }] : [emptyLine()];
  };
  const [head, setHead] = useState({ no: isPurchase ? "" : nextIssueNo, supplier: "", customer: "", plate: "", vehicle: "", note: "", date: todayKey() });
  const plateModels = useMemo(() => (isPurchase ? new Map() : buildCompat(data.issues, []).plateModels), [isPurchase, data.issues]);
  const setPlate = (plate) => { const known = plateModels.get(String(plate).trim().replace(/\s+/g, " ").toLocaleUpperCase("tr")); setHead((h) => ({ ...h, plate, vehicle: !h.vehicle && known ? [known.brand, known.model].filter(Boolean).join(" ") : h.vehicle })); };
  const [lines, setLines] = useState(initLines);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [labor, setLabor] = useState([]);
  const laborNames = useMemo(() => {
    const counts = new Map();
    data.issues.forEach((d) => (d.services || []).forEach((l) => { if (l.kind === "labor") counts.set(l.name, (counts.get(l.name) || 0) + 1); }));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 6);
  }, [data.issues]);
  const addLabor = (name = "") => setLabor((ls) => [...ls, { key: Math.random().toString(36).slice(2), name, qty: "1", unitPrice: "" }]);
  const setLaborLine = (key, patch) => setLabor((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const laborComputed = labor.map((l) => ({ ...l, q: toNumber(l.qty) || 1, price: toNumber(l.unitPrice), net: round((toNumber(l.qty) || 1) * toNumber(l.unitPrice)) }));
  const laborValid = laborComputed.filter((l) => l.name.trim() && l.net > 0);
  const laborNet = round(laborValid.reduce((s, l) => s + l.net, 0));
  const suppliers = useMemo(() => [...new Set(data.invoices.map((d) => d.supplier).filter(Boolean))], [data.invoices]);

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => {
    if (l.key !== key) return l;
    const next = { ...l, ...patch };
    if (patch.sku !== undefined) {
      const item = findItem(items, patch.sku);
      if (item) { next.name = item.name; if (!isPurchase && (next.unitPrice === "" || next.unitPrice === undefined)) next.unitPrice = item.price ?? ""; if (isPurchase && next.unitPrice === "") next.unitPrice = item.lastCost || ""; }
    }
    return next;
  }));

  const computed = lines.map((l) => {
    const item = l.sku ? findItem(items, l.sku) : null;
    const q = toNumber(l.qty);
    const price = toNumber(l.unitPrice);
    const net = round(price * q * (1 - toNumber(l.discountPct) / 100));
    return { ...l, item, q, price, net, short: !isPurchase && item && q > Number(item.stock || 0), missing: !isPurchase && l.sku && !item };
  });
  const valid = computed.filter((l) => l.sku.trim() && l.q > 0);
  const partsNet = round(valid.reduce((s, l) => s + l.net, 0));
  const net = round(partsNet + (isPurchase ? 0 : laborNet));
  const vat = round(net * VAT_RATE);
  const blocked = (!valid.length && (isPurchase || !laborValid.length)) || computed.some((l) => l.missing || l.short) || (isPurchase && (!head.no.trim() || !head.supplier.trim()));

  function applyPaste() {
    const parsed = paste.split(/\r?\n/).map((row) => row.split(/\t|;/).map((c) => c.trim())).filter((r) => r[0]);
    if (!parsed.length) return;
    const rows = parsed.filter((r) => !/kod|sku/i.test(r[0]));
    const next = rows.map((r) => {
      const item = findItem(items, r[0]);
      const numeric = r.slice(1).map((c) => (/^-?[\d.,]+$/.test(c) ? c : null));
      const hasName = r[1] && !numeric[0];
      const [q, p, d] = hasName ? [r[2], r[3], r[4]] : [r[1], r[2], r[3]];
      return { ...emptyLine(), sku: item ? item.sku : r[0], name: hasName ? r[1] : item?.name || "", qty: q || "1", unitPrice: p ?? (isPurchase ? item?.lastCost ?? "" : item?.price ?? ""), discountPct: d || "" };
    });
    setLines((ls) => [...ls.filter((l) => l.sku.trim()), ...next]);
    setPaste(""); setShowPaste(false);
  }

  async function submit(e) {
    e.preventDefault();
    if (blocked) return;
    const payload = isPurchase
      ? { no: head.no, supplier: head.supplier, date: head.date, source: "manual", lines: valid.map((l) => ({ sku: l.item ? l.item.sku : l.sku.trim(), name: l.name || l.sku, qty: l.q, unitPrice: l.price, discountPct: toNumber(l.discountPct), vatPct: 20 })) }
      : { no: head.no, customer: head.customer, plate: head.plate, brand: splitBrandModel(head.vehicle).brand, vehicleModel: splitBrandModel(head.vehicle).model, note: head.note, date: head.date, source: "manual", lines: valid.map((l) => ({ itemId: l.item.id, sku: l.item.sku, name: l.item.name, qty: l.q, unitPrice: l.price, discountPct: toNumber(l.discountPct), vatPct: 20 })), services: laborValid.map((l) => ({ kind: "labor", name: l.name.trim(), qty: l.q, unitPrice: l.price, vatPct: 20 })) };
    const ok = await run(async () => {
      if (!isPurchase) return store.issue(payload);
      await store.purchase(payload);
      const open = data.issues.filter((d) => !d.cancelled && (d.shortages || []).some((x) => x.missing > 0)).map((d) => d.id);
      const settled = open.length ? await store.settleShortages(open) : [];
      if (settled.length) toast(`${settled.length} satıştaki stokta olmayan kalemler stoktan düşüldü.`, "ok");
      return true;
    }, isPurchase ? `${payload.no} faturası stoğa işlendi.` : `${payload.no} kaydedildi${valid.length ? ", stok düşüldü" : ""}.`);
    if (ok !== false) { setLines([emptyLine()]); setLabor([]); setHead({ ...head, no: isPurchase ? "" : `S-${String(Number(head.no.slice(2) || 0) + 1).padStart(5, "0")}`, supplier: isPurchase ? head.supplier : "", customer: "", plate: "", vehicle: "", note: "" }); onDone?.(); }
  }

  return (
    <form className="docform panel" onSubmit={submit}>
      <div className="form-grid cols-4">
        <Field label={isPurchase ? "Fatura no *" : "Belge no *"}><input value={head.no} onChange={(e) => setHead({ ...head, no: e.target.value })} required placeholder={isPurchase ? "DM2202600000…" : ""} /></Field>
        {isPurchase
          ? <Field label="Tedarikçi *"><input value={head.supplier} onChange={(e) => setHead({ ...head, supplier: e.target.value })} required list="supplier-list" placeholder="DEMPAR…" /><datalist id="supplier-list">{suppliers.map((s) => <option key={s} value={s} />)}</datalist></Field>
          : <Field label="Müşteri"><input value={head.customer} onChange={(e) => setHead({ ...head, customer: e.target.value })} placeholder="Tezgah satışı için boş bırakın" /></Field>}
        {!isPurchase ? <Field label="Plaka"><input value={head.plate} onChange={(e) => setPlate(e.target.value)} placeholder="55 ABC 123" /></Field> : null}
        {!isPurchase ? <Field label="Araç (marka model)" hint="Parça–araç hafızasına kaydedilir"><input value={head.vehicle} onChange={(e) => setHead({ ...head, vehicle: e.target.value })} placeholder="Peugeot 3008 1.6 HDi" /></Field> : null}
        <Field label="Tarih *"><input type="date" value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} required /></Field>
      </div>
      <datalist id="sku-list">{items.map((i) => <option key={i.id} value={i.sku}>{i.name}</option>)}</datalist>
      <div className="table-scroll">
        <table className="table lines">
          <thead><tr><th>STOK KODU</th><th>PARÇA ADI</th><th className="num">MİKTAR</th><th className="num">{isPurchase ? "BİRİM ALIŞ" : "BİRİM SATIŞ"}</th><th className="num">İSK. %</th><th className="num">NET</th><th /></tr></thead>
          <tbody>
            {computed.map((l) => (
              <tr key={l.key} className={l.missing || l.short ? "is-bad" : ""}>
                <td><input className="mono" value={l.sku} onChange={(e) => setLine(l.key, { sku: e.target.value })} list="sku-list" placeholder="Kod" aria-label="Stok kodu" />
                  {l.missing ? <small className="bad">Kart yok</small> : l.item ? <small className="muted">Stok {qty(l.item.stock)} {l.item.unit}</small> : l.sku && isPurchase ? <small className="warn">Yeni kart açılır</small> : null}</td>
                <td><input value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} placeholder={isPurchase ? "Parça adı" : ""} disabled={!isPurchase} aria-label="Parça adı" /></td>
                <td className="num"><input type="number" min="0" step="any" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} aria-label="Miktar" />{l.short ? <small className="bad">Stok yetersiz</small> : null}</td>
                <td className="num"><input type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} aria-label="Birim fiyat" /></td>
                <td className="num"><input type="number" min="0" max="100" step="0.01" value={l.discountPct} onChange={(e) => setLine(l.key, { discountPct: e.target.value })} aria-label="İskonto" /></td>
                <td className="num strong">{money(l.net)}</td>
                <td><button type="button" className="icon-btn sm danger" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [emptyLine()]))} aria-label="Satırı sil"><Icon name="close" size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="docform-actions">
        <Button icon="plus" onClick={() => setLines([...lines, emptyLine()])}>Satır ekle</Button>
        <Button icon="clipboard" onClick={() => setShowPaste(!showPaste)}>Excel'den yapıştır</Button>
      </div>
      {showPaste ? (
        <div className="paste">
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} placeholder={"Excel'den kopyalayıp yapıştırın:\nStok kodu ⇥ Parça adı ⇥ Miktar ⇥ Birim fiyat ⇥ İskonto %\n(Parça adı ve iskonto isteğe bağlı)"} />
          <Button variant="primary" onClick={applyPaste} disabled={!paste.trim()}>Satırlara ekle</Button>
        </div>
      ) : null}
      {!isPurchase ? (
        <div className="services">
          <div className="services-head">
            <h4><Icon name="bolt" size={16} />İşçilik / hizmet</h4>
            <small>Stoğa dokunmaz; ciroya ve kâra eklenir.</small>
          </div>
          {laborComputed.map((l) => (
            <div key={l.key} className="service-row">
              <input value={l.name} onChange={(e) => setLaborLine(l.key, { name: e.target.value })} placeholder="Örn. Periyodik bakım işçiliği" aria-label="İşçilik açıklaması" list="labor-list" />
              <input type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => setLaborLine(l.key, { unitPrice: e.target.value })} placeholder="Tutar (KDV hariç)" aria-label="İşçilik tutarı" />
              <input type="number" min="0" step="any" value={l.qty} onChange={(e) => setLaborLine(l.key, { qty: e.target.value })} aria-label="Saat / adet" title="Saat veya adet" />
              <span className="num">{money(l.net)}</span>
              <button type="button" className="icon-btn sm danger" onClick={() => setLabor((ls) => ls.filter((x) => x.key !== l.key))} aria-label="İşçiliği sil"><Icon name="close" size={14} /></button>
            </div>
          ))}
          <datalist id="labor-list">{laborNames.map((n) => <option key={n} value={n} />)}</datalist>
          <div className="quick-labor">
            <Button icon="plus" onClick={() => addLabor()}>İşçilik ekle</Button>
            {laborNames.slice(0, 4).map((n) => <button key={n} type="button" onClick={() => addLabor(n)}>+ {n}</button>)}
          </div>
        </div>
      ) : null}
      {!isPurchase ? <Field label="Not"><input value={head.note} onChange={(e) => setHead({ ...head, note: e.target.value })} placeholder="İsteğe bağlı" /></Field> : null}
      <div className="docform-foot">
        <div className="totals">
          {!isPurchase && laborNet ? <><span>Parça <strong>{money(partsNet)}</strong></span><span>İşçilik <strong>{money(laborNet)}</strong></span></> : null}
          <span>Ara toplam <strong>{money(net)}</strong></span>
          <span>KDV %20 <strong>{money(vat)}</strong></span>
          <span className="grand">Genel toplam <strong>{money(net + vat)}</strong></span>
        </div>
        <Button variant="primary" icon="check" type="submit" disabled={blocked}>{isPurchase ? "Faturayı stoğa işle" : "Satışı kaydet"}</Button>
      </div>
    </form>
  );
}

