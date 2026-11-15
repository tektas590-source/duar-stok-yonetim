import React, { useMemo, useState } from "react";
import { Button, Empty, Field, Icon, Modal, PageHead } from "../kit.jsx";
import { useApp } from "../context.js";
import { dateLabel, looseKey, money, qty, todayKey, toNumber } from "../../core/format.js";
import { nextPlanNo, PLAN_STATUS, planReadiness, planTotals, reservedMap } from "../../core/plans.js";
import { buildCompat, splitBrandModel } from "../../core/vehicles.js";
import { usePricing } from "../pricing.jsx";

const key = () => Math.random().toString(36).slice(2);
const emptyLine = () => ({ key: key(), sku: "", name: "", qty: "1", unitPrice: "" });
const emptyLabor = (name = "") => ({ key: key(), name, qty: "1", unitPrice: "" });
const norm = (s) => String(s || "").replace(/\s+/g, "").toLocaleUpperCase("tr");

function PlanForm({ plan, onClose }) {
  const { data, store, run } = useApp();
  const pricing = usePricing(data);
  const items = data.items.filter((i) => !i.archived);
  const plateModels = useMemo(() => buildCompat(data.issues, []).plateModels, [data.issues]);
  const [head, setHead] = useState(() => ({
    customer: plan?.customer || "", phone: plan?.phone || "", plate: plan?.plate || "",
    vehicle: [plan?.brand, plan?.vehicleModel].filter(Boolean).join(" "), expected: plan?.expected || "", note: plan?.note || "",
  }));
  const [lines, setLines] = useState(() => (plan?.lines?.length ? plan.lines.map((l) => ({ ...l, key: key(), qty: String(l.qty), unitPrice: String(l.unitPrice || "") })) : [emptyLine()]));
  const [labor, setLabor] = useState(() => (plan?.labor || []).map((l) => ({ ...l, key: key(), qty: String(l.qty), unitPrice: String(l.unitPrice || "") })));
  const find = (sku) => { const k = looseKey(sku); return k ? items.find((i) => looseKey(i.sku) === k) : null; };

  const setPlate = (plate) => {
    const known = [...plateModels.entries()].find(([p]) => norm(p) === norm(plate))?.[1];
    const lastDoc = data.issues.find((d) => norm(d.plate) === norm(plate) && d.customer);
    setHead((h) => ({ ...h, plate, vehicle: !h.vehicle && known ? [known.brand, known.model].filter(Boolean).join(" ") : h.vehicle, customer: !h.customer && lastDoc ? lastDoc.customer : h.customer }));
  };
  const setLine = (k, patch) => setLines((ls) => ls.map((l) => {
    if (l.key !== k) return l;
    const next = { ...l, ...patch };
    if (patch.sku !== undefined) {
      const item = find(patch.sku);
      if (item) { next.name = item.name; next.itemId = item.id; if (!next.unitPrice) next.unitPrice = String(item.price ?? pricing.get(item.id)?.suggested ?? ""); } else next.itemId = null;
    }
    return next;
  }));
  const draft = { lines: lines.map((l) => ({ ...l, qty: toNumber(l.qty) || 1, unitPrice: toNumber(l.unitPrice) })), labor: labor.map((l) => ({ ...l, qty: toNumber(l.qty) || 1, unitPrice: toNumber(l.unitPrice) })) };
  const totals = planTotals(draft);

  const save = async () => {
    const { brand, model } = splitBrandModel(head.vehicle);
    const ok = await run(() => store.savePlan({
      id: plan?.id, no: plan?.no || nextPlanNo(data.plans), customer: head.customer, phone: head.phone, plate: head.plate, brand, vehicleModel: model,
      expected: head.expected, note: head.note, lines: draft.lines, labor: draft.labor,
    }), plan ? "Tespit güncellendi." : "Ön tespit kaydedildi; parçalar bu araca ayrıldı.");
    if (ok) onClose();
  };

  return (
    <Modal wide title={plan ? `${plan.no} · tespiti düzenle` : "Yeni ön tespit"} subtitle="Araç gelmeden belirlediğin parçaları ve işçiliği kaydet; araç gelince tek tıkla satışa dönüştür." onClose={onClose}
      footer={<><span className="plan-total">Toplam {money(totals.net)} <small>KDV dahil {money(totals.gross)}</small></span><Button onClick={onClose}>Vazgeç</Button><Button variant="primary" icon="check" onClick={save}>Kaydet</Button></>}>
      <div className="form-grid cols-3">
        <Field label="Plaka"><input value={head.plate} onChange={(e) => setPlate(e.target.value)} placeholder="55 ABC 123" autoFocus /></Field>
        <Field label="Müşteri"><input value={head.customer} onChange={(e) => setHead({ ...head, customer: e.target.value })} placeholder="Ad soyad / firma" /></Field>
        <Field label="Telefon"><input value={head.phone} onChange={(e) => setHead({ ...head, phone: e.target.value })} placeholder="05xx xxx xx xx" inputMode="tel" /></Field>
        <Field label="Araç (marka model)"><input value={head.vehicle} onChange={(e) => setHead({ ...head, vehicle: e.target.value })} placeholder="Peugeot 3008 1.6 HDi" /></Field>
        <Field label="Geliş tarihi"><input type="date" value={head.expected} onChange={(e) => setHead({ ...head, expected: e.target.value })} /></Field>
        <Field label="Not"><input value={head.note} onChange={(e) => setHead({ ...head, note: e.target.value })} placeholder="Şikâyet, tespit notu…" /></Field>
      </div>
      <h4 className="plan-h">Parçalar</h4>
      <div className="table-scroll">
        <table className="table plan-lines">
          <thead><tr><th>STOK KODU</th><th>PARÇA</th><th className="num">ADET</th><th className="num">BİRİM FİYAT</th><th className="num">TUTAR</th><th /></tr></thead>
          <tbody>{lines.map((l) => {
            const item = l.itemId ? items.find((i) => i.id === l.itemId) : find(l.sku);
            return (
              <tr key={l.key}>
                <td><input className="mono" list="plan-skus" value={l.sku} onChange={(e) => setLine(l.key, { sku: e.target.value })} placeholder="Kod (stoktan seç)" aria-label="Stok kodu" />
                  {item ? <small className={Number(item.stock) >= (toNumber(l.qty) || 1) ? "muted" : "warn"}>Stok {qty(item.stock)} {item.unit}</small> : l.sku ? <small className="warn">Stokta kart yok · sipariş gerekir</small> : null}</td>
                <td><input value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} placeholder="Parça adı" disabled={Boolean(item)} aria-label="Parça adı" /></td>
                <td className="num"><input type="number" min="0" step="any" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} aria-label="Adet" /></td>
                <td className="num"><input type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} aria-label="Birim fiyat" />{item && pricing.get(item.id)?.suggested ? <small className="muted">öneri {money(pricing.get(item.id).suggested)}</small> : null}</td>
                <td className="num">{money((toNumber(l.qty) || 1) * toNumber(l.unitPrice))}</td>
                <td><button type="button" className="icon-btn sm danger" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [emptyLine()]))} aria-label="Satırı sil"><Icon name="close" size={14} /></button></td>
              </tr>
            );
          })}</tbody>
        </table>
        <datalist id="plan-skus">{items.map((i) => <option key={i.id} value={i.sku}>{i.name} · stok {qty(i.stock)}</option>)}</datalist>
      </div>
      <Button icon="plus" onClick={() => setLines([...lines, emptyLine()])}>Parça ekle</Button>
      <h4 className="plan-h">İşçilik</h4>
      {labor.map((l) => (
        <div key={l.key} className="plan-labor">
          <input value={l.name} onChange={(e) => setLabor((ls) => ls.map((x) => (x.key === l.key ? { ...x, name: e.target.value } : x)))} placeholder="İşçilik adı" aria-label="İşçilik adı" />
          <input type="number" min="0" step="any" value={l.qty} onChange={(e) => setLabor((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))} aria-label="Miktar" />
          <input type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => setLabor((ls) => ls.map((x) => (x.key === l.key ? { ...x, unitPrice: e.target.value } : x)))} placeholder="Tutar" aria-label="Tutar" />
          <button type="button" className="icon-btn sm danger" onClick={() => setLabor((ls) => ls.filter((x) => x.key !== l.key))} aria-label="İşçiliği sil"><Icon name="close" size={14} /></button>
        </div>
      ))}
      <div className="chips">
        <Button icon="plus" onClick={() => setLabor([...labor, emptyLabor()])}>İşçilik ekle</Button>
        {["Bakım işçiliği", "Mekanik işçilik", "Balata değişim işçiliği"].map((n) => <button key={n} type="button" className="chip" onClick={() => setLabor([...labor, emptyLabor(n)])}>+ {n}</button>)}
      </div>
    </Modal>
  );
}

function printPlan(plan, totals) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rows = [...(plan.lines || []).map((l) => [l.sku, l.name, l.qty, l.unitPrice]), ...(plan.labor || []).map((l) => ["", l.name, l.qty, l.unitPrice])]
    .map(([s, n, q, p]) => `<tr><td>${esc(s)}</td><td>${esc(n)}</td><td class="r">${esc(q)}</td><td class="r">${esc(money(p))}</td><td class="r">${esc(money(q * p))}</td></tr>`).join("");
  w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(plan.no)} · ${esc(plan.plate)}</title><style>body{font:14px system-ui,sans-serif;margin:32px;color:#111}h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:18px}td,th{border-bottom:1px solid #ddd;padding:7px 6px;text-align:left}th{font-size:11px;color:#666;text-transform:uppercase}.r{text-align:right}.tot{margin-top:14px;text-align:right;font-size:15px}.muted{color:#666}</style></head><body>
    <h1>Ön tespit · ${esc(plan.no)}</h1><div class="muted">${esc(dateLabel(todayKey()))}</div>
    <p><b>${esc(plan.plate)}</b> ${esc([plan.brand, plan.vehicleModel].filter(Boolean).join(" "))}<br>${esc(plan.customer)} ${esc(plan.phone)}</p>
    ${plan.note ? `<p class="muted">${esc(plan.note)}</p>` : ""}
    <table><thead><tr><th>Kod</th><th>Parça / işçilik</th><th class="r">Adet</th><th class="r">Birim</th><th class="r">Tutar</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="tot">Ara toplam ${esc(money(totals.net))}<br>KDV %20 ${esc(money(totals.vat))}<br><b>Genel toplam ${esc(money(totals.gross))}</b></div>
    <script>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

export function PlansPage({ params }) {
  const { data, store, run, go } = useApp();
  const plans = data.plans || [];
  const [status, setStatus] = useState("open");
  const [query, setQuery] = useState(params?.q || "");
  const [editing, setEditing] = useState(params?.new ? "new" : null);
  const reserved = useMemo(() => reservedMap(plans, data.items), [plans, data.items]);
  const counts = { open: plans.filter((p) => p.status === "open").length, done: plans.filter((p) => p.status === "done").length, cancelled: plans.filter((p) => p.status === "cancelled").length };
  const list = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    const nq = norm(query);
    return plans.filter((p) => p.status === status).filter((p) => !q || `${p.no} ${p.customer} ${p.plate} ${p.brand} ${p.vehicleModel} ${p.note} ${(p.lines || []).map((l) => `${l.sku} ${l.name}`).join(" ")}`.toLocaleLowerCase("tr").includes(q) || (nq.length >= 3 && norm(p.plate).includes(nq)))
      .sort((a, b) => (status === "open" ? String(a.expected || "9999").localeCompare(String(b.expected || "9999")) : 0) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [plans, status, query]);

  return (
    <div className="page">
      <PageHead eyebrow="ATÖLYE" title="Ön tespit" text="Araç gelmeden belirlediğin parçaları müşteri, plaka ve araca göre kaydet. Parçalar o araca ayrılır, unutulmaz; araç gelince tek tıkla satışa dönüşür." actions={<Button variant="primary" icon="plus" onClick={() => setEditing("new")}>Yeni tespit</Button>} />
      <div className="toolbar">
        <div className="plan-seg">{Object.entries(PLAN_STATUS).map(([k, label]) => <button key={k} type="button" className={status === k ? "on" : ""} onClick={() => setStatus(k)}>{label} <b>{counts[k]}</b></button>)}</div>
        <label className="search"><Icon name="search" size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Plaka, müşteri, araç veya parça ara…" aria-label="Tespit ara" /></label>
      </div>
      {list.length ? (
        <div className="plan-grid">
          {list.map((p, i) => {
            const t = planTotals(p);
            const ready = planReadiness(p, data.items, reserved);
            const short = ready.filter((x) => x.state !== "ready");
            const overdue = p.status === "open" && p.expected && p.expected < todayKey();
            return (
              <article key={p.id} className={`plan-card is-${p.status}`} style={{ "--i": Math.min(i, 12) }}>
                <header>
                  <span className="plate">{p.plate || "—"}</span>
                  <div><strong>{p.customer || "Müşteri yok"}</strong><small>{[p.brand, p.vehicleModel].filter(Boolean).join(" ") || "Araç belirtilmedi"}{p.phone ? ` · ${p.phone}` : ""}</small></div>
                  <span className="mono plan-no">{p.no}</span>
                </header>
                {p.expected || p.status !== "open" ? <p className={`plan-when ${overdue ? "warn" : ""}`}><Icon name="clipboard" size={13} />{p.status === "open" ? `Geliş: ${dateLabel(p.expected)}${overdue ? " · gecikti" : ""}` : `${PLAN_STATUS[p.status]} · ${dateLabel(String(p.statusAt || "").slice(0, 10))}${p.issueNo ? ` · ${p.issueNo}` : ""}`}</p> : null}
                {p.note ? <p className="plan-note">{p.note}</p> : null}
                <ul className="plan-items">
                  {ready.map((l, j) => (
                    <li key={j} className={`is-${l.state}`}>
                      <i />
                      <span><b>{l.item?.name || l.name}</b><small className="mono">{l.sku || "kodsuz"} · {qty(l.qty)} {l.item?.unit || "adet"}</small></span>
                      <em>{p.status !== "open" ? money(l.qty * l.unitPrice) : l.state === "ready" ? "hazır" : l.state === "short" ? `eksik · boşta ${qty(Math.max(0, l.free))}` : "kart yok"}</em>
                    </li>
                  ))}
                  {(p.labor || []).map((l, j) => <li key={`l${j}`} className="is-labor"><i /><span><b>{l.name}</b><small>işçilik</small></span><em>{money(l.qty * l.unitPrice)}</em></li>)}
                </ul>
                <footer>
                  <span className="plan-sum"><strong>{money(t.net)}</strong><small>KDV dahil {money(t.gross)}</small></span>
                  {p.status === "open" ? <>
                    {short.length ? <span className="pill is-warn">{short.length} parça eksik</span> : <span className="pill is-ok">Parçalar hazır</span>}
                    <div className="plan-actions">
                      <button type="button" className="icon-btn sm" onClick={() => printPlan(p, t)} aria-label="Yazdır" title="Müşteriye teklif olarak yazdır"><Icon name="receipt" size={14} /></button>
                      <button type="button" className="icon-btn sm" onClick={() => setEditing(p)} aria-label="Düzenle"><Icon name="edit" size={14} /></button>
                      <button type="button" className="icon-btn sm danger" onClick={() => { if (window.confirm(`${p.no} tespiti iptal edilsin mi? Ayrılan parçalar serbest kalır.`)) run(() => store.setPlanStatus(p.id, "cancelled"), "Tespit iptal edildi."); }} aria-label="İptal" title="İptal et"><Icon name="close" size={14} /></button>
                      <Button variant="primary" icon="out" onClick={() => go("satis", { plan: p.id })}>Satışa dönüştür</Button>
                    </div>
                  </> : p.status === "cancelled" ? <Button icon="undo" onClick={() => run(() => store.setPlanStatus(p.id, "open"), "Tespit yeniden açıldı.")}>Yeniden aç</Button> : null}
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="panel pad"><Empty icon="clipboard" title={status === "open" ? "Bekleyen tespit yok" : "Kayıt yok"} text={status === "open" ? "Gelecek bir araç için parça tespitini kaydet; unutma derdi kalmasın." : null} action={status === "open" ? <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>Yeni tespit</Button> : null} /></section>
      )}
      {editing ? <PlanForm plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
