import React, { useEffect, useMemo, useState } from "react";

const e = React.createElement;

export function useCountUp(target, duration = 1400) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !Number.isFinite(target)) { setValue(target); return undefined; }
    let frame = 0;
    const start = performance.now();
    const from = 0;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(from + (target - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

function gearPath(teeth, outer, root) {
  const step = (Math.PI * 2) / teeth;
  let d = "";
  for (let i = 0; i < teeth; i++) {
    [[root, -0.5], [outer, -0.22], [outer, 0.22], [root, 0.5]].forEach(([radius, offset], k) => {
      const angle = i * step + offset * step * 0.5;
      d += `${i === 0 && k === 0 ? "M" : "L"}${(Math.cos(angle) * radius).toFixed(2)} ${(Math.sin(angle) * radius).toFixed(2)} `;
    });
  }
  return `${d}Z`;
}

const BIG_GEAR = gearPath(30, 150, 128);
const SMALL_GEAR = gearPath(18, 90, 74);

export const number = (value) => Math.round(value).toLocaleString("tr-TR");

export function StockCinema({ parts }) {
  const stats = useMemo(() => {
    const active = parts.filter((part) => part.archived !== true);
    let units = 0, value = 0, critical = 0, low = 0, good = 0;
    active.forEach((part) => {
      const stock = Number(part.stock || 0), minimum = Number(part.minimum || 0);
      units += stock; value += stock * Number(part.cost || 0);
      if (stock <= minimum) critical += 1; else if (stock <= minimum * 2) low += 1; else good += 1;
    });
    const total = active.length;
    return { total, units, value, critical, low, good, health: total ? Math.round(((total - critical) / total) * 100) : 0 };
  }, [parts]);

  const units = useCountUp(stats.units);
  const value = useCountUp(stats.value);
  const health = useCountUp(stats.health);
  const [ready, setReady] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(id); }, []);

  const radius = 52, circumference = 2 * Math.PI * radius;
  const pct = (count) => (stats.total ? (count / stats.total) * 100 : 0);

  return e("section", { className: "sc-hero", "aria-label": "Anlık stok durumu" },
    e("svg", { className: "sc-gears", viewBox: "-200 -200 400 400", "aria-hidden": "true" },
      e("g", { className: "sc-gear sc-gear-big", transform: "translate(0 0)" }, e("path", { d: BIG_GEAR }), e("circle", { r: 40 }), e("circle", { r: 14 })),
      e("g", { transform: "translate(-196 120)" }, e("g", { className: "sc-gear sc-gear-small" }, e("path", { d: SMALL_GEAR }), e("circle", { r: 26 })))),
    e("div", { className: "sc-sweep", "aria-hidden": "true" }),
    e("div", { className: "sc-bar sc-bar-top", "aria-hidden": "true" }),
    e("div", { className: "sc-bar sc-bar-bottom", "aria-hidden": "true" }),
    e("div", { className: "sc-body" },
      e("div", { className: "sc-main" },
        e("p", { className: "sc-eyebrow" }, "ANLIK STOK DURUMU"),
        e("div", { className: "sc-units" }, e("strong", null, number(units)), e("span", null, "adet parça rafta")),
        e("dl", { className: "sc-facts" },
          e("div", null, e("dt", null, "Parça çeşidi"), e("dd", null, number(stats.total))),
          e("div", null, e("dt", null, "Stok değeri · alış"), e("dd", null, `₺${number(value)}`)),
          e("div", { className: stats.critical ? "sc-alert" : "" }, e("dt", null, "Kritik seviye"), e("dd", null, number(stats.critical))))),
      e("div", { className: "sc-gauge", role: "img", "aria-label": `Stok sağlığı yüzde ${stats.health}` },
        e("svg", { viewBox: "0 0 120 120" },
          e("circle", { className: "sc-gauge-track", cx: 60, cy: 60, r: radius }),
          e("circle", { className: "sc-gauge-value", cx: 60, cy: 60, r: radius, strokeDasharray: circumference, strokeDashoffset: ready ? circumference * (1 - stats.health / 100) : circumference, transform: "rotate(-90 60 60)" })),
        e("div", { className: "sc-gauge-text" }, e("strong", null, `%${Math.round(health)}`), e("span", null, "stok sağlığı")))),
    e("div", { className: "sc-strip", "aria-hidden": "true" },
      e("i", { className: "sc-seg sc-seg-bad", style: { width: ready ? `${pct(stats.critical)}%` : "0%" } }),
      e("i", { className: "sc-seg sc-seg-mid", style: { width: ready ? `${pct(stats.low)}%` : "0%" } }),
      e("i", { className: "sc-seg sc-seg-good", style: { width: ready ? `${pct(stats.good)}%` : "0%" } })),
    e("ul", { className: "sc-legend" },
      e("li", { className: "sc-key-bad" }, `Kritik ${stats.critical}`),
      e("li", { className: "sc-key-mid" }, `Azalıyor ${stats.low}`),
      e("li", { className: "sc-key-good" }, `Yeterli ${stats.good}`)));
}

const ACCENTS = [["green", "Yeşil"], ["ember", "Kor"], ["ice", "Buz"]];

export function AccentPicker({ accent, setAccent }) {
  return e("div", { className: "accent-picker", role: "group", "aria-label": "Vurgu rengi" },
    ACCENTS.map(([id, label]) => e("button", { key: id, type: "button", className: `accent-dot accent-${id} ${accent === id ? "active" : ""}`, onClick: () => setAccent(id), title: `${label} teması`, "aria-label": `${label} teması`, "aria-pressed": accent === id })));
}
