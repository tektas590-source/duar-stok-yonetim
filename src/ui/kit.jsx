import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const PATHS = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",
  box: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.3 7 12 12l8.7-5 M12 22V12",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  out: "M16 17l5-5-5-5 M21 12H9 M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
  swap: "M7 4 3 8l4 4 M3 8h18 M17 20l4-4-4-4 M21 16H3",
  clipboard: "M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z M8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2 M9 13l2 2 4-4",
  cart: "M3 3h2l2.4 12.4a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L22 7H6 M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2 M18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
  chart: "M3 3v18h18 M18 17V9 M13 17V5 M8 17v-3",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  search: "m21 21-4.3-4.3 M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  close: "M18 6 6 18 M6 6l12 12",
  check: "M5 12l5 5L20 7",
  alert: "M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  upload: "M12 16V4 M7 9l5-5 5 5 M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  download: "M12 4v12 M7 11l5 5 5-5 M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  edit: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  archive: "M3 4h18v4H3z M5 8v12h14V8 M10 12h4",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
  chevron: "M9 6l6 6-6 6",
  sort: "M7 4v16 M3 8l4-4 4 4 M17 20V4 M13 16l4 4 4-4",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  sun: "M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6l1.4 1.4 M17 17l1.4 1.4 M18.4 5.6 17 7 M7 17l-1.4 1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
  moon: "M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13z",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  undo: "M9 14 4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-1",
  receipt: "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z M8 8h8 M8 12h8 M8 16h4",
  bolt: "M13 2 3 14h9l-1 8 10-12h-9z",
};

export function Icon({ name, size = 18, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] || PATHS.grid} />
    </svg>
  );
}

export function Button({ variant = "ghost", icon, children, className = "", ...rest }) {
  return (
    <button type="button" className={`btn btn-${variant} ${className}`} {...rest}>
      {icon ? <Icon name={icon} size={15} /> : null}
      {children}
    </button>
  );
}

export function useCountUp(target, duration = 1300) {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !Number.isFinite(target)) { setValue(target); from.current = target; return undefined; }
    let raf;
    const start = performance.now();
    const origin = from.current;
    const step = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const v = origin + (target - origin) * (1 - Math.pow(1 - p, 4));
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

export function useReady(delay = 0) {
  const [ready, setReady] = useState(false);
  useEffect(() => { const id = setTimeout(() => requestAnimationFrame(() => setReady(true)), delay); return () => clearTimeout(id); }, [delay]);
  return ready;
}

export function Ring({ value, size = 140, stroke = 10, label, sub }) {
  const ready = useReady(200);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const shown = useCountUp(value);
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${label} yüzde ${Math.round(value)}`}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--accent)" }} />
            <stop offset="100%" style={{ stopColor: "var(--accent-2)" }} />
          </linearGradient>
        </defs>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle className="ring-value" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={ready ? c * (1 - value / 100) : c} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="ring-text"><strong>%{Math.round(shown)}</strong><span>{sub}</span></div>
    </div>
  );
}

export function Sparkline({ values, height = 70, className = "" }) {
  const w = 300;
  if (!values.length) return null;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const x = (i) => (i / Math.max(1, values.length - 1)) * w;
  const y = (v) => height - 4 - ((v - min) / Math.max(1e-9, max - min)) * (height - 8);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className={`spark ${className}`} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--accent)", stopOpacity: 0.32 }} />
          <stop offset="100%" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path className="spark-area" d={`${line} L${w} ${height} L0 ${height} Z`} />
      <path className="spark-line" d={line} pathLength="1" />
    </svg>
  );
}

export function Modal({ title, subtitle, onClose, children, footer, wide = false }) {
  const [closing, setClosing] = useState(false);
  const close = () => { setClosing(true); setTimeout(onClose, 220); };
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return createPortal(
    <div className={`modal-wrap ${closing ? "is-closing" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="modal-backdrop" aria-label="Kapat" onClick={close} />
      <div className={`modal ${wide ? "modal-wide" : ""}`}>
        <header className="modal-head">
          <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Kapat"><Icon name="close" /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ onClose, children, label }) {
  const [closing, setClosing] = useState(false);
  const close = () => { setClosing(true); setTimeout(onClose, 260); };
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return createPortal(
    <div className={`drawer-wrap ${closing ? "is-closing" : ""}`} role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" className="modal-backdrop" aria-label="Kapat" onClick={close} />
      <aside className="drawer">{typeof children === "function" ? children(close) : children}</aside>
    </div>,
    document.body,
  );
}

export function Empty({ icon = "box", title, text, action }) {
  return (
    <div className="empty">
      <span className="empty-orb"><Icon name={icon} size={26} /></span>
      <strong>{title}</strong>
      {text ? <span>{text}</span> : null}
      {action}
    </div>
  );
}

export function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <small className="field-hint">{hint}</small> : null}
    </label>
  );
}

export function Stat({ label, value, sub, tone = "", style }) {
  return (
    <div className={`stat ${tone ? `is-${tone}` : ""}`} style={style}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

export function PageHead({ eyebrow, title, text, actions }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow ? <p className="eyebrow"><i />{eyebrow}</p> : null}
        <h1>{title}</h1>
        {text ? <p className="page-text">{text}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
