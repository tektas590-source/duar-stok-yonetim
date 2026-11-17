import { useEffect, useMemo, useState } from "react";
import { buildPricing, DEFAULT_MARKUP } from "../core/pricing.js";
import { normalizePolicy } from "../core/pricePolicy.js";

const KEY = "duar-markup";
const read = () => { try { const v = Number(localStorage.getItem(KEY)); return Number.isFinite(v) && v > 0 ? v : DEFAULT_MARKUP; } catch { return DEFAULT_MARKUP; } };

// Varsayılan kâr oranı (geçmiş satışı olmayan parçalar için). Tarayıcıda saklanır.
export function useMarkup() {
  const [markup, setMarkup] = useState(read);
  useEffect(() => {
    const sync = () => setMarkup(read());
    window.addEventListener("duar-markup", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("duar-markup", sync); window.removeEventListener("storage", sync); };
  }, []);
  const update = (v) => {
    const n = Math.min(300, Math.max(1, Number(v) || DEFAULT_MARKUP));
    try { localStorage.setItem(KEY, String(n)); } catch { /* yoksay */ }
    setMarkup(n);
    window.dispatchEvent(new Event("duar-markup"));
  };
  return [markup, update];
}

// Ortak fiyat politikası (Firestore settings/pricing), yoksa varsayılan.
export function usePolicy(data) {
  const saved = (data.settings || []).find((x) => x.id === "pricing")?.policy;
  return useMemo(() => normalizePolicy(saved), [saved]);
}

export function usePricing(data) {
  const policy = usePolicy(data);
  return useMemo(() => buildPricing(data.items, data.invoices, data.issues, policy), [data.items, data.invoices, data.issues, policy]);
}
