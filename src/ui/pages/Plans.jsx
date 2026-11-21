import React, { useMemo, useState } from "react";
import { Button, Empty, Field, Icon, Modal, PageHead } from "../kit.jsx";
import { useApp } from "../context.js";
import { dateLabel, looseKey, qty, todayKey, toNumber } from "../../core/format.js";
import { invoiceReady, nextPlanNo, partReady, PLAN_TABS, planReadiness, planTab, reservedMap } from "../../core/plans.js";
import { buildCompat, splitBrandModel } from "../../core/vehicles.js";

const key = () => Math.random().toString(36).slice(2);
const emptyLine = (source = "stock") => ({ key: key(), source, sku: "", name: "", brand: "", qty: "1", arrived: false, invoiced: false });
const norm = (s) => String(s || "").replace(/\s+/g, "").toLocaleUpperCase("tr");

function PlanForm({ plan, onClose }) {
  const { data, store, run } = useApp();
  const items = data.items.filter((i) => !i.archived);
  const plateModels = useMemo(() => buildCompat(data.issues, [], data.workorders).plateModels, [data.issues, data.workorders]);
  const [head, setHead] = useState(() => ({
    customer: plan?.customer || "", phone: plan?.phone || "", plate: plan?.plate || "",
    vehicle: [plan?.brand, plan?.vehicleModel].filter(Boolean).join(" "), expected: plan?.expected || "", note: plan?.note || "",
  }));
  const [lines, setLines] = useState(() => (plan?.lines?.length ? plan.lines.map((l) => ({ ...l, key: key(), source: l.source || (l.itemId ? "stock" : "manual"), brand: l.brand || "", qty: String(l.qty), arrived: Boolean(l.arrived), invoiced: Boolean(l.invoiced) })) : [emptyLine()]));
  const find = (sku) => { const k = looseKey(sku); return k ? items.find((i) => looseKey(i.sku) === k) : null; };

  const setPlate = (plate) => {
    const known = [...plateModels.entries()].find(([p]) => norm(p) === norm(plate))?.[1];
    const lastDoc = data.issues.find((d) => norm(d.plate) === norm(plate) && d.customer);
    setHead((h) => ({ ...h, plate, vehicle: !h.vehicle && known ? [known.brand, known.model].filter(Boolean).join(" ") : h.vehicle, customer: !h.customer && lastDoc ? lastDoc.customer : h.customer }));
  };
  const setLine = (k, patch) => setLines((ls) => ls.map((l) => {
    if (l.key !== k) return l;
    const next = { ...l, ...patch };
    if (patch.source === "manual") { next.itemId = null; }
    if (patch.source === "stock") { const item = find(next.sku); next.itemId = item?.id || null; if (item) next.name = item.name; }
    if (patch.sku !== undefined && next.source === "stock") {
      const item = find(patch.sku);
      if (item) { next.name = item.name; next.itemId = item.id; } else next.itemId = null;
    }
    return next;
  }));
  // Fiyat/işçilik bu ekranda yok; teklif ekranından gelen değerler korunur.
  const draft = { lines: lines.map((l) => ({ ...l, qty: toNumber(l.qty) || 1, unitPrice: Number(l.unitPrice) || 0 })), labor: plan?.labor || [] };

  const save = async () => {
    const { brand, model } = splitBrandModel(head.vehicle);
    const ok = await run(() => store.savePlan({
      id: plan?.id, no: plan?.no || nextPlanNo(data.plans), customer: head.customer, phone: head.phone, plate: head.plate, brand, vehicleModel: model,
      expected: head.expected, note: head.note, lines: draft.lines, labor: draft.labor,
    }).catch((error) => {
      if (/permission|insufficient/i.test(error?.message || "")) throw new Error("Ön tespit kaydedilemedi: Firebase güvenlik kuralına \"plans\" izni eklenmeli (Firestore → Kurallar).");
      throw error;
    }), plan ? "Tespit güncellendi." : "Ön tespit kaydedildi; parçalar bu araca ayrıldı.");
    if (ok) onClose();
  };

  return (
    <Modal wide title={plan ? `${plan.no} · tespiti düzenle` : "Yeni ön tespit"} subtitle="Araç için belirlediğin parçaları kaydet; parçası ve faturası gelince işaretle." onClose={onClose}
      footer={<><Button onClick={onClose}>Vazgeç</Button><Button variant="primary" icon="check" onClick={save}>Kaydet</Button></>}>
      <div className="form-grid cols-3">
        <Field label="Plaka"><input value={head.plate} onChange={(e) => setPlate(e.target.value)} placeholder="55 ABC 123" autoFocus /></Field>
        <Field label="Müşteri"><input value={head.customer} onChange={(e) => setHead({ ...head, customer: e.target.value })} placeholder="Ad soyad / firma" /></Field>
        <Field label="Telefon"><input value={head.phone} onChange={(e) => setHead({ ...head, phone: e.target.value })} placeholder="05xx xxx xx xx" inputMode="tel" /></Field>
        <Field label="Araç (marka model)"><input value={head.vehicle} onChange={(e) => setHead({ ...head, vehicle: e.target.value })} placeholder="Peugeot 3008 1.6 HDi" /></Field>
        <Field label="Geliş tarihi"><input type="date" value={head.expected} onChange={(e) => setHead({ ...head, expected: e.target.value })} /></Field>
        <Field label="Not"><input value={head.note} onChange={(e) => setHead({ ...head, note: e.target.value })} placeholder="Şikâyet, tespit notu…" /></Field>
      </div>
      <h4 className="plan-h">Parçalar <small>Stoktan seçin ya da sistemde olmayan / başka marka parçayı elle yazın. Parça ve fatura geldikçe işaretleyin.</small></h4>
      <div className="plan-lines2">
        {lines.map((l) => {
          const item = l.source === "stock" ? (l.itemId ? items.find((i) => i.id === l.itemId) : find(l.sku)) : null;
          return (
            <div key={l.key} className={`pl-row is-${l.source}`}>
              <div className="pl-src" role="group" aria-label="Parça kaynağı">
                <button type="button" className={l.source === "stock" ? "on" : ""} onClick={() => setLine(l.key, { source: "stock" })}>Stoktan</button>
                <button type="button" className={l.source === "manual" ? "on" : ""} onClick={() => setLine(l.key, { source: "manual" })}>Elle</button>
              </div>
              {l.source === "stock" ? <>
                <label className="pl-f pl-code"><span>Stok kodu</span><input className="mono" list="plan-skus" value={l.sku} onChange={(e) => setLine(l.key, { sku: e.target.value })} placeholder="Kod yaz / seç" />
                  {item ? <small className={Number(item.stock) >= (toNumber(l.qty) || 1) ? "ok" : "warn"}>Stok {qty(item.stock)} {item.unit}</small> : l.sku ? <small className="warn">Stokta yok — "Elle"ye geçin</small> : null}</label>
                <label className="pl-f pl-name"><span>Parça</span><input value={item?.name || l.name} disabled placeholder="Koddan gelir" /></label>
              </> : <>
                <label className="pl-f pl-code"><span>Kod (isteğe bağlı)</span><input className="mono" value={l.sku} onChange={(e) => setLine(l.key, { sku: e.target.value })} placeholder="Parça no" /></label>
                <label className="pl-f pl-name"><span>Parça adı</span><input value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} placeholder="Ör: Ön fren balatası" /></label>
                <label className="pl-f pl-brand"><span>Marka</span><input value={l.brand} onChange={(e) => setLine(l.key, { brand: e.target.value })} placeholder="Bosch, Valeo…" /></label>
              </>}
              <label className="pl-f pl-qty"><span>Adet</span><input type="number" min="0" step="any" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} /></label>
              <div className="pl-flags">
                <button type="button" className={`pl-arrived ${l.arrived ? "on" : ""}`} onClick={() => setLine(l.key, { arrived: !l.arrived })} aria-pressed={l.arrived}><small>Parça</small>{l.arrived ? <><Icon name="check" size={13} />Geldi</> : "Gelmedi"}</button>
                <button type="button" className={`pl-arrived ${l.invoiced ? "on" : ""}`} onClick={() => setLine(l.key, { invoiced: !l.invoiced })} aria-pressed={l.invoiced}><small>Fatura</small>{l.invoiced ? <><Icon name="check" size={13} />Geldi</> : "Gelmedi"}</button>
              </div>
              <button type="button" className="icon-btn sm danger" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [emptyLine()]))} aria-label="Satırı sil"><Icon name="close" size={14} /></button>
            </div>
          );
        })}
        <datalist id="plan-skus">{items.map((i) => <option key={i.id} value={i.sku}>{i.name} · stok {qty(i.stock)}</option>)}</datalist>
      </div>
      <div className="chips">
        <Button icon="plus" onClick={() => setLines([...lines, emptyLine("stock")])}>Stoktan parça</Button>
        <Button icon="edit" onClick={() => setLines([...lines, emptyLine("manual")])}>Elle parça</Button>
      </div>
    </Modal>
  );
}

export function PlansPage({ params }) {
  const { data, store, run } = useApp();
  const plans = data.plans || [];
  const [tab, setTab] = useState("waiting");
  const [query, setQuery] = useState(params?.q || "");
  const [editing, setEditing] = useState(params?.new ? "new" : null);
  const reserved = useMemo(() => reservedMap(plans, data.items), [plans, data.items]);
  // Her tespitin parça durumu ve sekmesi (satışı yapılmış olsa da eksik varsa Bekliyor).
  const rows = useMemo(() => plans.map((p) => { const ready = planReadiness(p, data.items, reserved); return { p, ready, tab: planTab(p, ready) }; }), [plans, data.items, reserved]);
  const counts = { waiting: 0, complete: 0, cancelled: 0 };
  rows.forEach((r) => { counts[r.tab] += 1; });
  const list = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    const nq = norm(query);
    return rows.filter((r) => r.tab === tab).filter(({ p }) => !q || `${p.no} ${p.customer} ${p.plate} ${p.brand} ${p.vehicleModel} ${p.note} ${(p.lines || []).map((l) => `${l.sku} ${l.name} ${l.brand || ""}`).join(" ")}`.toLocaleLowerCase("tr").includes(q) || (nq.length >= 3 && norm(p.plate).includes(nq)))
      .sort((a, b) => (tab === "waiting" ? String(a.p.expected || "9999").localeCompare(String(b.p.expected || "9999")) : 0) || String(b.p.createdAt).localeCompare(String(a.p.createdAt)));
  }, [rows, tab, query]);

  return (
    <div className="page">
      <PageHead eyebrow="ATÖLYE" title="Ön tespit" text="Araç için belirlediğin parçaları müşteri, plaka ve araca göre kaydet. Her parçanın kendisi ve faturası geldi mi, buradan takip et. Satışı yapılsa da eksik kalan burada bekler." actions={<Button variant="primary" icon="plus" onClick={() => setEditing("new")}>Yeni tespit</Button>} />
      <div className="toolbar">
        <div className="plan-seg">{Object.entries(PLAN_TABS).map(([k, label]) => <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label} <b>{counts[k]}</b></button>)}</div>
        <label className="search"><Icon name="search" size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Plaka, müşteri, araç veya parça ara…" aria-label="Tespit ara" /></label>
      </div>
      {list.length ? (
        <div className="plan-grid">
          {list.map(({ p, ready }, i) => {
            const partsWaiting = ready.filter((l) => !partReady(l)).length;
            const invWaiting = ready.filter((l) => !invoiceReady(l)).length;
            const overdue = p.status === "open" && p.expected && p.expected < todayKey();
            const toggle = (index, field) => run(() => store.togglePlanLine(p.id, index, field));
            return (
              <article key={p.id} className={`plan-card is-${p.status}`} style={{ "--i": Math.min(i, 12) }}>
                <header>
                  <span className="plate">{p.plate || "—"}</span>
                  <div><strong>{p.customer || "Müşteri yok"}</strong><small>{[p.brand, p.vehicleModel].filter(Boolean).join(" ") || "Araç belirtilmedi"}{p.phone ? ` · ${p.phone}` : ""}</small></div>
                  <span className="mono plan-no">{p.no}</span>
                </header>
                {p.status === "done" ? <p className="plan-when sold"><Icon name="check" size={13} />Satışı yapıldı{p.issueNo ? ` · ${p.issueNo}` : ""}{p.statusAt ? ` · ${dateLabel(String(p.statusAt).slice(0, 10))}` : ""}</p>
                  : p.expected ? <p className={`plan-when ${overdue ? "warn" : ""}`}><Icon name="clipboard" size={13} />Geliş: {dateLabel(p.expected)}{overdue ? " · gecikti" : ""}</p> : null}
                {p.note ? <p className="plan-note">{p.note}</p> : null}
                <ul className="plan-items">
                  {ready.map((l) => (
                    <li key={l.index} className={`is-${partReady(l) && invoiceReady(l) ? "done" : l.state}`}>
                      <i />
                      <span><b>{l.item?.name || l.name}{l.source === "manual" ? <u className="src-tag">elle</u> : null}</b><small className="mono">{l.sku || "kodsuz"}{l.brand ? ` · ${l.brand}` : ""} · {qty(l.qty)} {l.item?.unit || "adet"}{l.state === "short" ? ` · stok boşta ${qty(Math.max(0, l.free))}` : ""}</small></span>
                      <div className="flag-pair">
                        {l.state === "ready" ? <em className="ok">stokta var</em> : (
                          <button type="button" disabled={p.status === "cancelled"} className={`arr-btn ${l.state === "arrived" ? "on" : ""}`} onClick={() => toggle(l.index, "arrived")} title="Parça geldi / gelmedi">
                            <small>Parça</small>{l.state === "arrived" ? <><Icon name="check" size={11} />Geldi</> : "Gelmedi"}
                          </button>
                        )}
                        {l.state === "ready" ? null : (
                          <button type="button" disabled={p.status === "cancelled"} className={`arr-btn ${l.invoiced ? "on" : ""}`} onClick={() => toggle(l.index, "invoiced")} title="Faturası geldi / gelmedi">
                            <small>Fatura</small>{l.invoiced ? <><Icon name="check" size={11} />Geldi</> : "Gelmedi"}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                <footer>
                  {p.status === "cancelled" ? <Button icon="undo" onClick={() => run(() => store.setPlanStatus(p.id, "open"), "Tespit yeniden açıldı.")}>Yeniden aç</Button> : <>
                    {partsWaiting || invWaiting ? <span className="pill is-warn">{[partsWaiting ? `${partsWaiting} parça` : "", invWaiting ? `${invWaiting} fatura` : ""].filter(Boolean).join(" · ")} bekleniyor</span> : <span className="pill is-ok">Parçalar ve faturalar tamam</span>}
                    <div className="plan-actions">
                      <button type="button" className="icon-btn sm" onClick={() => setEditing(p)} aria-label="Düzenle" title="Düzenle"><Icon name="edit" size={14} /></button>
                      <button type="button" className="icon-btn sm danger" onClick={() => { if (window.confirm(`${p.no} tespiti iptal edilsin mi?`)) run(() => store.setPlanStatus(p.id, "cancelled"), "Tespit iptal edildi."); }} aria-label="İptal" title="İptal et"><Icon name="close" size={14} /></button>
                    </div>
                  </>}
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="panel pad"><Empty icon="clipboard" title={tab === "waiting" ? "Bekleyen tespit yok" : "Kayıt yok"} text={tab === "waiting" ? "Gelecek bir araç için parça tespitini kaydet; unutma derdi kalmasın." : null} action={tab === "waiting" ? <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>Yeni tespit</Button> : null} /></section>
      )}
      {editing ? <PlanForm plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
