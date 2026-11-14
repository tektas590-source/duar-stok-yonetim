import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Açılış sinematiği: gece yolunda özgün bir spor araba farlarıyla gelir, durur,
// farlar parlar ve DUAR yazısı belirir. Oturum başına bir kez oynar; tıklama,
// tuş veya "Geç" ile atlanır. Hareket azaltma açıksa hiç gösterilmez.
const KEY = "duar-intro-seen";
const LENGTH = 4300;

function shouldPlay() {
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
    if (new URLSearchParams(window.location.search).has("intro")) return true;
    return !sessionStorage.getItem(KEY);
  } catch { return false; }
}

function Wheel({ cx }) {
  return (
    <g transform={`translate(${cx} 150)`}>
      <circle r="35" className="ci-tire" />
      <circle r="35" className="ci-tire-edge" />
      <g className="ci-rim">
        <circle r="22" className="ci-rim-face" />
        {[0, 72, 144, 216, 288].map((a) => <path key={a} d="M-3.2 -5 L-2 -20 L2 -20 L3.2 -5 Z" transform={`rotate(${a})`} className="ci-spoke" />)}
        <circle r="5.5" className="ci-hub" />
        <circle r="19" className="ci-disc" />
      </g>
      <path d="M-14 -8 Q-12 -14 -6 -15" className="ci-caliper" />
    </g>
  );
}

export function Car({ p = "ci", className = "" }) {
  return (
    <svg className={`ci-car ${className}`} viewBox="0 0 620 200" aria-hidden="true">
      <defs>
        <linearGradient id={`${p}Body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3f4b" />
          <stop offset="0.45" stopColor="#1b1e25" />
          <stop offset="1" stopColor="#0b0c10" />
        </linearGradient>
        <linearGradient id={`${p}Glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b6578" stopOpacity="0.9" />
          <stop offset="1" stopColor="#11141a" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id={`${p}Shine`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${p}Stripe`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="0.25" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
        <clipPath id={`${p}BodyClip`}><path d="M44 140 L44 120 Q46 106 66 102 L156 94 Q196 64 256 56 L336 54 Q388 56 430 86 L512 96 Q560 102 566 120 L570 140 Q570 148 560 148 L505 148 A45 45 0 0 0 415 148 L205 148 A45 45 0 0 0 115 148 L54 148 Q44 148 44 140 Z" /></clipPath>
      </defs>
      <ellipse cx="310" cy="186" rx="270" ry="10" className="ci-shadow" />
      <path className="ci-body" fill={`url(#${p}Body)`} d="M44 140 L44 120 Q46 106 66 102 L156 94 Q196 64 256 56 L336 54 Q388 56 430 86 L512 96 Q560 102 566 120 L570 140 Q570 148 560 148 L505 148 A45 45 0 0 0 415 148 L205 148 A45 45 0 0 0 115 148 L54 148 Q44 148 44 140 Z" />
      <g clipPath={`url(#${p}BodyClip)`}>
        <rect x="-160" y="40" width="120" height="120" fill={`url(#${p}Shine)`} className="ci-sweep" transform="skewX(-20)" />
        <path d="M60 124 L560 124" stroke={`url(#${p}Stripe)`} strokeWidth="3" />
        <path d="M70 106 Q300 92 540 104" className="ci-crease" />
      </g>
      <path className="ci-glass" fill={`url(#${p}Glass)`} d="M176 97 Q210 72 258 66 L306 65 L306 96 Z" />
      <path className="ci-glass" fill={`url(#${p}Glass)`} d="M318 65 L338 65 Q378 68 410 93 L318 96 Z" />
      <path d="M312 64 L312 97" className="ci-pillar" />
      <path d="M330 104 L352 104" className="ci-handle" />
      <path d="M520 112 Q546 110 562 118 L560 126 Q540 122 518 120 Z" className="ci-headlight" />
      <path d="M46 114 L60 112 L60 122 L46 124 Z" className="ci-tail" />
      <path d="M150 148 L470 148" className="ci-sill" />
      <Wheel cx={160} />
      <Wheel cx={460} />
    </svg>
  );
}

export function CarIntro() {
  const [phase, setPhase] = useState(() => (shouldPlay() ? "play" : "done"));

  useEffect(() => {
    if (phase !== "play") return undefined;
    try { sessionStorage.setItem(KEY, "1"); } catch { /* yoksay */ }
    const out = setTimeout(() => setPhase("out"), LENGTH);
    const skip = () => setPhase("out");
    window.addEventListener("keydown", skip);
    return () => { clearTimeout(out); window.removeEventListener("keydown", skip); };
  }, [phase]);

  useEffect(() => {
    if (phase !== "out") return undefined;
    const end = setTimeout(() => setPhase("done"), 700);
    return () => clearTimeout(end);
  }, [phase]);

  if (phase === "done") return null;
  return createPortal(
    <div className={`car-intro ${phase === "out" ? "is-out" : ""}`} role="presentation" onClick={() => setPhase("out")}>
      <div className="ci-sky" />
      <div className="ci-horizon" />
      <div className="ci-skyline" />
      <div className="ci-road"><i className="ci-lanes" /><i className="ci-edge" /></div>
      <div className="ci-streaks">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ "--i": i }} />)}</div>
      <div className="ci-drive">
        <div className="ci-beam" />
        <div className="ci-flare" />
        <Car />
        <div className="ci-tailglow" />
      </div>
      <div className="ci-title">
        <strong>{"DUAR".split("").map((c, i) => <span key={i} style={{ "--i": i }}>{c}</span>)}</strong>
        <small>STOK YÖNETİM</small>
      </div>
      <button type="button" className="ci-skip" onClick={(e) => { e.stopPropagation(); setPhase("out"); }}>Geç</button>
    </div>,
    document.body,
  );
}
