import React, { useMemo } from "react";
import { Car } from "./CarIntro.jsx";
import { moneyShort, todayKey } from "../core/format.js";

// Ana ekran: canlı atölye sahnesi. Araç liftte kalkar, alttan arıza taraması
// geçer, tekerde anahtar döner ve kıvılcım çıkar, "Onarım tamamlandı" yazar,
// araç iner. Yanında atölyenin günlük/aylık özeti durur. Döngü 10 sn.
function Wrench() {
  return (
    <svg viewBox="0 0 64 64" className="gh-wrench" aria-hidden="true">
      <path d="M44 6a14 14 0 0 0-13 19L8 48a6 6 0 0 0 8 8l23-23a14 14 0 0 0 19-13l-8 8-9-3-3-9z" />
    </svg>
  );
}

export function GarageHero({ data, onOpen }) {
  const stats = useMemo(() => {
    const today = todayKey();
    const month = today.slice(0, 7);
    const live = data.issues.filter((d) => !d.cancelled);
    const monthDocs = live.filter((d) => String(d.date).startsWith(month));
    const plates = new Set(monthDocs.map((d) => d.plate).filter(Boolean));
    const last = [...live].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    return {
      today: live.filter((d) => d.date === today).length,
      month: monthDocs.length,
      vehicles: plates.size,
      labor: monthDocs.reduce((s, d) => s + (d.totals.laborNet || 0), 0),
      last,
    };
  }, [data.issues]);

  return (
    <section className="garage" aria-label="Atölye">
      <div className="gh-scene" aria-hidden="true">
        <div className="gh-wall">
          <i className="gh-lamp" style={{ "--x": "18%" }} /><i className="gh-lamp" style={{ "--x": "50%" }} /><i className="gh-lamp" style={{ "--x": "82%" }} />
          <div className="gh-board">{Array.from({ length: 7 }, (_, i) => <b key={i} style={{ "--i": i }} />)}</div>
        </div>
        <div className="gh-floor" />
        <div className="gh-rig">
          <i className="gh-post gh-post-l" /><i className="gh-post gh-post-r" />
          <div className="gh-lift">
            <i className="gh-arm gh-arm-l" /><i className="gh-arm gh-arm-r" />
            <Car p="gh" className="gh-car" />
            <div className="gh-tool"><Wrench /></div>
            <div className="gh-sparks">{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ "--a": `${-150 + i * 14}deg`, "--d": `${(i % 3) * 0.12}s` }} />)}</div>
            <div className="gh-scan" />
          </div>
          <i className="gh-shadow" />
        </div>
        <div className="gh-status">
          <span className="gh-s1"><i />Arıza taranıyor</span>
          <span className="gh-s2"><i />Onarılıyor</span>
          <span className="gh-s3"><i />Onarım tamamlandı</span>
        </div>
      </div>
      <div className="gh-info">
        <p className="eyebrow"><i />ATÖLYE · CANLI</p>
        <h2><b>{stats.today}</b> iş bugün</h2>
        <p className="gh-sub">Bu ay {stats.month} servis belgesi{stats.vehicles ? ` · ${stats.vehicles} araç` : ""}</p>
        <div className="gh-figs">
          <div><span>Bu ay işçilik</span><strong>{moneyShort(stats.labor)}</strong></div>
          {stats.last ? <div><span>Son iş</span><strong>{stats.last.plate || stats.last.customer || stats.last.no}</strong></div> : null}
        </div>
        <button type="button" className="gh-link" onClick={onOpen}>Servis belgeleri →</button>
      </div>
    </section>
  );
}
