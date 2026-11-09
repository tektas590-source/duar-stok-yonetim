import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import { useCountUp } from "./stockCinema.jsx";
import { parseFaturaRaporuReport, splitFaturaRaporuByType } from "./faturaRaporuImport.js";
import {
  STOCK_LEVEL_LABEL, stockLevel, summarizeStock, classifyAbc, consumptionStats, stockHistorySeries,
  partPurchaseHistory, filterAndSortParts, analyzeEdmsPurchaseBatch, alignInvoiceSkusToParts,
} from "./stockTracking.js";

const e = React.createElement;

// ── küçük yardımcılar ───────────────────────────────────────────────────────
const tl = (value) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
const tlShort = (value) => `₺${Math.round(Number(value) || 0).toLocaleString("tr-TR")}`;
const qtyText = (value) => (Number.isInteger(Number(value)) ? String(value) : Number(value).toLocaleString("tr-TR", { maximumFractionDigits: 2 }));
const dateText = (value) => {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(date);
};
const ICON = {
  search: "m21 21-4.3-4.3 M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
  upload: "M12 16V4 M7 9l5-5 5 5 M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  download: "M12 4v12 M7 11l5 5 5-5 M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  box: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.3 7 12 12l8.7-5 M12 22V12",
  receipt: "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z M8 8h8 M8 12h8 M8 16h4",
  scale: "M12 3v18 M5 7h14 M5 7l-3 7a3 3 0 0 0 6 0z M19 7l-3 7a3 3 0 0 0 6 0z M8 21h8",
  close: "M18 6 6 18 M6 6l12 12",
  check: "M5 12l5 5L20 7",
  alert: "M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  edit: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  archive: "M3 4h18v4H3z M5 8v12h14V8 M10 12h4",
  chevron: "M9 6l6 6-6 6",
  sort: "M7 4v16 M3 8l4-4 4 4 M17 20V4 M13 16l4 4 4-4",
};
function Ico({ name, size = 16 }) {
  return e("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, e("path", { d: ICON[name] }));
}

function useReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true))); return () => cancelAnimationFrame(id); }, []);
  return ready;
}

// ── Sinematik açılış / özet ─────────────────────────────────────────────────
function StockHero({ summary, level, onLevel }) {
  const ready = useReady();
  const units = useCountUp(summary.units, 1600);
  const cost = useCountUp(summary.costValue, 1800);
  const sale = useCountUp(summary.saleValue, 1800);
  const health = useCountUp(summary.health, 1600);
  const radius = 54, circumference = 2 * Math.PI * radius;
  const pct = (count) => (summary.total ? (count / summary.total) * 100 : 0);
  const segments = [["out", summary.out], ["critical", summary.critical], ["low", summary.low], ["good", summary.good]];
  return e("section", { className: `st-hero ${ready ? "is-ready" : ""}`, "aria-label": "Stok özeti" },
    e("div", { className: "st-hero-grid", "aria-hidden": true }),
    e("div", { className: "st-hero-scan", "aria-hidden": true }),
    e("div", { className: "st-curtain st-curtain-top", "aria-hidden": true }),
    e("div", { className: "st-curtain st-curtain-bottom", "aria-hidden": true }),
    e("div", { className: "st-hero-body" },
      e("div", { className: "st-hero-main" },
        e("p", { className: "st-eyebrow" }, e("i", null), "CANLI STOK TAKİBİ · eDMS UYUMLU"),
        e("div", { className: "st-hero-units" }, e("strong", null, Math.round(units).toLocaleString("tr-TR")), e("span", null, "adet parça rafta")),
        e("div", { className: "st-kpis" },
          [["Parça çeşidi", summary.total.toLocaleString("tr-TR")], ["Stok değeri · alış", tlShort(cost)], ["Satış karşılığı", tlShort(sale)], ["Potansiyel brüt kâr", tlShort(summary.potentialMargin)]]
            .map(([label, value], index) => e("div", { key: label, className: "st-kpi", style: { "--i": index } }, e("span", null, label), e("strong", null, value))))),
      e("div", { className: "st-ring", role: "img", "aria-label": `Stok sağlığı yüzde ${summary.health}` },
        e("svg", { viewBox: "0 0 128 128" },
          e("defs", null, e("linearGradient", { id: "stRingGrad", x1: "0", y1: "0", x2: "1", y2: "1" }, e("stop", { offset: "0%", style: { stopColor: "var(--accent)" } }), e("stop", { offset: "100%", style: { stopColor: "var(--accent-secondary)" } }))),
          e("circle", { className: "st-ring-track", cx: 64, cy: 64, r: radius }),
          e("circle", { className: "st-ring-value", cx: 64, cy: 64, r: radius, strokeDasharray: circumference, strokeDashoffset: ready ? circumference * (1 - summary.health / 100) : circumference, transform: "rotate(-90 64 64)" })),
        e("div", { className: "st-ring-text" }, e("strong", null, `%${Math.round(health)}`), e("span", null, "stok sağlığı")))),
    e("div", { className: "st-levelbar", "aria-hidden": true },
      segments.map(([key, count]) => e("i", { key, className: `st-seg st-seg-${key}`, style: { width: ready ? `${pct(count)}%` : "0%" } }))),
    e("div", { className: "st-level-chips", role: "group", "aria-label": "Stok durumu filtresi" },
      [["all", "Tümü", summary.total], ...segments.map(([key, count]) => [key, STOCK_LEVEL_LABEL[key], count])].map(([key, label, count]) =>
        e("button", { key, type: "button", className: `st-chip st-chip-${key} ${level === key || (level === "attention" && (key === "out" || key === "critical")) ? "active" : ""}`, "aria-pressed": level === key, onClick: () => onLevel(level === key && key !== "all" ? "all" : key) },
          e("i", null), label, e("b", null, count)))));
}

// ── Stok listesi ────────────────────────────────────────────────────────────
const SORT_OPTIONS = [["level", "Duruma göre"], ["name", "Parça adı"], ["sku", "Stok kodu"], ["stock", "Stok adedi"], ["value", "Stok değeri"], ["cost", "Alış fiyatı"], ["price", "Satış fiyatı"]];
const PAGE_SIZE = 120;

function StockMeter({ part }) {
  const stock = Number(part.stock || 0), minimum = Number(part.minimum || 0);
  const width = Math.max(3, Math.min(100, (stock / Math.max(1, minimum * 3)) * 100));
  const minMark = Math.min(100, (minimum / Math.max(1, minimum * 3)) * 100);
  return e("span", { className: `st-meter st-meter-${stockLevel(part)}`, "aria-hidden": true }, e("u", { style: { width: `${width}%` } }), e("em", { style: { left: `${minMark}%` } }));
}

function StockList({ parts, movements, query, setQuery, level, setLevel, openModal, removePart, toggleFavorite, adjustPartStock, saving, onOpenPart }) {
  const [category, setCategory] = useState("all");
  const [brand, setBrand] = useState("all");
  const [favorites, setFavorites] = useState(false);
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState("level");
  const [direction, setDirection] = useState("asc");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const searchRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) { event.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { setLimit(PAGE_SIZE); }, [query, level, category, brand, favorites, archived, sort, direction]);

  const categories = useMemo(() => [...new Set(parts.map((part) => part.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr")), [parts]);
  const brands = useMemo(() => [...new Set(parts.map((part) => part.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr")), [parts]);
  const abc = useMemo(() => classifyAbc(parts), [parts]);
  const cover = useMemo(() => new Map(parts.map((part) => [part.id, consumptionStats(part, movements)])), [parts, movements]);
  const filtered = useMemo(() => filterAndSortParts(parts, { query, level, category, brand, favorites, archived, sort, direction }), [parts, query, level, category, brand, favorites, archived, sort, direction]);
  const visible = filtered.slice(0, limit);
  const filteredValue = filtered.reduce((sum, part) => sum + Math.max(0, Number(part.stock || 0)) * Number(part.cost || 0), 0);

  const exportExcel = () => {
    const rows = filtered.map((part) => {
      const stats = cover.get(part.id) || {};
      return {
        "Stok Kodu": part.sku, "Parça Adı": part.name, Kategori: part.category || "", Marka: part.brand || "",
        Stok: Number(part.stock || 0), Minimum: Number(part.minimum || 0),
        "Alış (KDV hariç)": Number(part.cost || 0), "Satış (KDV hariç)": Number(part.price || 0),
        "Stok Değeri (alış)": Math.round(Math.max(0, Number(part.stock || 0)) * Number(part.cost || 0) * 100) / 100,
        "90 Gün Çıkış": stats.consumed || 0, "Yeterlilik (gün)": stats.coverDays ?? "", ABC: abc.get(part.id) || "",
        Durum: STOCK_LEVEL_LABEL[stockLevel(part)],
      };
    });
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = [{ wch: 20 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 9 }, { wch: 15 }, { wch: 15 }, { wch: 16 }, { wch: 12 }, { wch: 15 }, { wch: 5 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(workbook, sheet, "Stok Takip");
    XLSX.writeFile(workbook, `stok-takip-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return e("div", { className: "st-list" },
    e("div", { className: "st-toolbar" },
      e("label", { className: "st-search" }, e(Ico, { name: "search" }),
        e("input", { ref: searchRef, value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Stok kodu, parça adı, marka ara…", "aria-label": "Parça ara" }),
        query ? e("button", { type: "button", className: "st-search-clear", onClick: () => setQuery(""), "aria-label": "Aramayı temizle" }, e(Ico, { name: "close", size: 14 })) : e("kbd", null, "/")),
      e("select", { className: "filter-select", value: category, onChange: (event) => setCategory(event.target.value), "aria-label": "Kategori" }, e("option", { value: "all" }, "Tüm kategoriler"), categories.map((item) => e("option", { key: item, value: item }, item))),
      e("select", { className: "filter-select", value: brand, onChange: (event) => setBrand(event.target.value), "aria-label": "Marka" }, e("option", { value: "all" }, "Tüm markalar"), brands.map((item) => e("option", { key: item, value: item }, item))),
      e("div", { className: "st-sort" },
        e("select", { className: "filter-select", value: sort, onChange: (event) => setSort(event.target.value), "aria-label": "Sıralama" }, SORT_OPTIONS.map(([value, label]) => e("option", { key: value, value }, label))),
        e("button", { type: "button", className: `st-icon-btn ${direction === "desc" ? "is-flipped" : ""}`, onClick: () => setDirection(direction === "asc" ? "desc" : "asc"), title: direction === "asc" ? "Artan" : "Azalan", "aria-label": "Sıralama yönünü değiştir" }, e(Ico, { name: "sort" }))),
      e("button", { type: "button", className: `st-toggle ${favorites ? "active" : ""}`, "aria-pressed": favorites, onClick: () => setFavorites(!favorites) }, e(Ico, { name: "star", size: 14 }), "Favoriler"),
      e("button", { type: "button", className: `st-toggle ${archived ? "active" : ""}`, "aria-pressed": archived, onClick: () => setArchived(!archived) }, e(Ico, { name: "archive", size: 14 }), "Arşiv"),
      e("div", { className: "st-toolbar-end" },
        e("span", { className: "st-count" }, e("strong", null, filtered.length), " parça · ", tlShort(filteredValue)),
        e("button", { type: "button", className: "button button-quiet", onClick: exportExcel, disabled: !filtered.length }, e(Ico, { name: "download", size: 14 }), "Excel"))),
    e("section", { className: "panel st-table-panel" },
      visible.length ? e("div", { className: "table-scroll" },
        e("table", { className: "st-table" },
          e("thead", null, e("tr", null, ["", "PARÇA", "KATEGORİ · MARKA", "STOK", "YETERLİLİK", "ALIŞ", "SATIŞ", "MARJ", "STOK DEĞERİ", "DURUM", ""].map((label, index) => e("th", { key: index }, label)))),
          e("tbody", null, visible.map((part, index) => {
            const lvl = stockLevel(part);
            const stats = cover.get(part.id) || {};
            const cost = Number(part.cost || 0), price = Number(part.price || 0);
            const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : null;
            const grade = abc.get(part.id);
            return e("tr", { key: part.id, className: `st-row st-row-${lvl}`, style: { "--d": `${Math.min(index, 30) * 22}ms` }, onClick: (event) => { if (!event.target.closest("button")) onOpenPart(part); }, tabIndex: 0, onKeyDown: (event) => { if (event.key === "Enter" && event.target === event.currentTarget) onOpenPart(part); } },
              e("td", { className: "st-fav-cell" }, e("button", { type: "button", className: `st-fav ${part.favorite ? "active" : ""}`, onClick: () => toggleFavorite(part.id), disabled: saving, title: part.favorite ? "Favoriden çıkar" : "Favorilere ekle", "aria-label": part.favorite ? "Favoriden çıkar" : "Favorilere ekle" }, e(Ico, { name: "star", size: 15 }))),
              e("td", null, e("div", { className: "st-part" },
                e("span", { className: `st-avatar st-avatar-${lvl}` }, String(part.name || part.sku || "?").slice(0, 1)),
                e("span", null, e("strong", null, part.name), e("small", null, part.sku, grade ? e("b", { className: `st-abc st-abc-${grade}` }, grade) : null)))),
              e("td", { className: "st-muted" }, e("span", null, part.category || "—"), e("small", null, part.brand || "")),
              e("td", null, e("div", { className: "st-stock" },
                e("button", { type: "button", className: "st-step", disabled: saving || Number(part.stock) <= 0, onClick: () => adjustPartStock(part, -1, "Çıkış"), "aria-label": `${part.name} stoğundan 1 düş` }, e(Ico, { name: "minus", size: 12 })),
                e("span", { className: "st-stock-num" }, e("strong", null, qtyText(part.stock)), e("small", null, `min ${part.minimum || 0}`), e(StockMeter, { part })),
                e("button", { type: "button", className: "st-step", disabled: saving, onClick: () => adjustPartStock(part, 1, "Giriş"), "aria-label": `${part.name} stoğuna 1 ekle` }, e(Ico, { name: "plus", size: 12 })))),
              e("td", { className: "st-muted" }, stats.coverDays === null || stats.coverDays === undefined ? e("span", { className: "st-dim" }, "Hareket yok") : e("span", { className: stats.coverDays < 14 ? "st-warn" : "" }, `${stats.coverDays.toLocaleString("tr-TR")} gün`), stats.consumed ? e("small", null, `90g: ${qtyText(stats.consumed)} çıkış`) : null),
              e("td", { className: "st-num" }, tl(cost)),
              e("td", { className: "st-num st-strong" }, tl(price)),
              e("td", { className: `st-num ${margin !== null && margin < 10 ? "st-warn" : ""}` }, margin === null ? "—" : `%${margin}`),
              e("td", { className: "st-num" }, tl(Math.max(0, Number(part.stock || 0)) * cost)),
              e("td", null, e("span", { className: `st-badge st-badge-${lvl}` }, e("i", null), STOCK_LEVEL_LABEL[lvl])),
              e("td", null, e("div", { className: "st-actions" },
                e("button", { type: "button", className: "st-icon-btn", onClick: () => openModal("part", part), disabled: saving, title: "Düzenle", "aria-label": `${part.name} düzenle` }, e(Ico, { name: "edit", size: 14 })),
                e("button", { type: "button", className: "st-icon-btn st-danger", onClick: () => removePart(part), disabled: saving, title: part.archived ? "Geri yükle" : "Arşivle", "aria-label": part.archived ? `${part.name} geri yükle` : `${part.name} arşivle` }, e(Ico, { name: "archive", size: 14 })),
                e("span", { className: "st-row-go", "aria-hidden": true }, e(Ico, { name: "chevron", size: 14 })))));
          }))))
        : e("div", { className: "st-empty" }, e(Ico, { name: "box", size: 34 }), e("strong", null, parts.length ? "Filtreyle eşleşen parça yok" : "Henüz stok kartı yok"), e("span", null, parts.length ? "Aramayı veya filtreleri temizleyin." : "Parça ekleyin ya da eDMS alış faturası yükleyerek stoğu başlatın.")),
      filtered.length > limit ? e("button", { type: "button", className: "st-more", onClick: () => setLimit(limit + PAGE_SIZE) }, `${filtered.length - limit} parça daha göster`) : null));
}

// ── Parça detay çekmecesi ───────────────────────────────────────────────────
function Sparkline({ series }) {
  const width = 320, height = 80, pad = 4;
  if (!series.length) return null;
  const max = Math.max(1, ...series.map((point) => point.stock));
  const min = Math.min(0, ...series.map((point) => point.stock));
  const x = (i) => pad + (i / Math.max(1, series.length - 1)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - min) / Math.max(1, max - min)) * (height - pad * 2);
  const line = series.map((point, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(point.stock).toFixed(1)}`).join(" ");
  const area = `${line} L${x(series.length - 1).toFixed(1)} ${height - pad} L${x(0).toFixed(1)} ${height - pad} Z`;
  return e("svg", { className: "st-spark", viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", role: "img", "aria-label": "Son 60 gün stok seyri" },
    e("defs", null, e("linearGradient", { id: "stSparkFill", x1: 0, y1: 0, x2: 0, y2: 1 }, e("stop", { offset: "0%", style: { stopColor: "var(--accent)", stopOpacity: 0.35 } }), e("stop", { offset: "100%", style: { stopColor: "var(--accent)", stopOpacity: 0 } }))),
    e("path", { className: "st-spark-area", d: area }),
    e("path", { className: "st-spark-line", d: line, pathLength: 1 }));
}

function PartDrawer({ part, movements, invoices, onClose, openModal, adjustPartStock, saving }) {
  const [amount, setAmount] = useState(1);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const close = () => { setClosing(true); setTimeout(onClose, 260); };
  const stats = useMemo(() => consumptionStats(part, movements), [part, movements]);
  const series = useMemo(() => stockHistorySeries(part, movements, { days: 60 }), [part, movements]);
  const history = useMemo(() => partPurchaseHistory(part, invoices).slice(0, 12), [part, invoices]);
  const timeline = useMemo(() => movements.filter((movement) => movement.partId === part.id).slice(0, 40), [part, movements]);
  const lvl = stockLevel(part);
  const cost = Number(part.cost || 0), price = Number(part.price || 0);
  const qty = Math.max(1, Math.floor(Number(amount) || 1));
  return createPortal(e("div", { className: `st-drawer-wrap ${closing ? "is-closing" : ""}`, role: "dialog", "aria-modal": true, "aria-label": `${part.name} stok detayı` },
    e("button", { type: "button", className: "st-drawer-backdrop", onClick: close, "aria-label": "Kapat" }),
    e("aside", { className: "st-drawer" },
      e("header", { className: `st-drawer-head st-head-${lvl}` },
        e("div", null, e("p", { className: "st-eyebrow" }, e("i", null), part.sku), e("h2", null, part.name), e("span", { className: `st-badge st-badge-${lvl}` }, e("i", null), STOCK_LEVEL_LABEL[lvl]), part.category ? e("span", { className: "category-tag" }, part.category) : null, part.brand ? e("span", { className: "category-tag" }, part.brand) : null),
        e("button", { type: "button", className: "st-icon-btn", onClick: close, "aria-label": "Kapat" }, e(Ico, { name: "close" }))),
      e("div", { className: "st-drawer-body" },
        e("div", { className: "st-dkpis" },
          [["Stok", `${qtyText(part.stock)} adet`], ["Minimum", `${part.minimum || 0} adet`], ["Alış", tl(cost)], ["Satış", tl(price)], ["Marj", price > 0 ? `%${Math.round(((price - cost) / price) * 100)}` : "—"], ["Stok değeri", tl(Math.max(0, Number(part.stock || 0)) * cost)]]
            .map(([label, value], index) => e("div", { key: label, style: { "--i": index } }, e("span", null, label), e("strong", null, value)))),
        e("section", { className: "st-dsec" },
          e("div", { className: "st-dsec-head" }, e("h3", null, "Son 60 gün stok seyri"), e("span", null, stats.coverDays === null ? "Son 90 günde çıkış yok" : `Günlük ort. ${stats.dailyUsage.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} · ≈ ${stats.coverDays} gün yeter`)),
          e(Sparkline, { series })),
        e("section", { className: "st-dsec st-adjust" },
          e("h3", null, "Hızlı stok düzeltme"),
          e("div", { className: "st-adjust-row" },
            e("input", { type: "number", min: 1, step: 1, value: amount, onChange: (event) => setAmount(event.target.value), "aria-label": "Adet" }),
            e("button", { type: "button", className: "button button-quiet", disabled: saving || Number(part.stock) < qty, onClick: () => adjustPartStock(part, -qty, "Çıkış") }, e(Ico, { name: "minus", size: 14 }), `${qty} düş`),
            e("button", { type: "button", className: "button button-primary", disabled: saving, onClick: () => adjustPartStock(part, qty, "Giriş") }, e(Ico, { name: "plus", size: 14 }), `${qty} ekle`),
            e("button", { type: "button", className: "button button-quiet", disabled: saving, onClick: () => openModal("part", part) }, e(Ico, { name: "edit", size: 14 }), "Kartı düzenle")),
          e("small", null, "Fatura dışı düzeltmeler hareket geçmişine kullanıcı adıyla işlenir.")),
        e("section", { className: "st-dsec" },
          e("div", { className: "st-dsec-head" }, e("h3", null, "Alış geçmişi"), e("span", null, `${history.length} fatura`)),
          history.length ? e("ul", { className: "st-plist" }, history.map((row, index) => e("li", { key: `${row.invoiceId}-${index}`, style: { "--i": index } },
            e("div", null, e("strong", null, row.code), e("small", null, `${row.supplier || "Tedarikçi yok"} · ${dateText(row.date)}`)),
            e("div", { className: "st-plist-right" }, e("strong", null, `+${qtyText(row.qty)}`), e("small", null, tl(row.cost))))))
            : e("p", { className: "st-dim" }, "Bu parça için kayıtlı alış faturası yok.")),
        e("section", { className: "st-dsec" },
          e("div", { className: "st-dsec-head" }, e("h3", null, "Hareket zaman çizelgesi"), e("span", null, `${timeline.length} kayıt`)),
          timeline.length ? e("ol", { className: "st-timeline" }, timeline.map((movement, index) => e("li", { key: movement.id || index, className: Number(movement.qty) > 0 ? "is-in" : "is-out", style: { "--i": Math.min(index, 20) } },
            e("i", null),
            e("div", null, e("strong", null, movement.type || "Hareket"), e("small", null, `${dateText(movement.date)} · ${movement.referenceCode || "—"} · ${movement.actor || "—"}`)),
            e("b", null, `${Number(movement.qty) > 0 ? "+" : ""}${qtyText(movement.qty)}`, movement.stockAfter !== undefined && movement.stockAfter !== null ? e("small", null, `→ ${qtyText(movement.stockAfter)}`) : null))))
            : e("p", { className: "st-dim" }, "Henüz hareket kaydı yok."))))), document.body);
}

// ── eDMS Alış Faturası yükleme ─────────────────────────────────────────────
function EdmsPurchaseImport({ parts, invoices, saving, onImport, onDone }) {
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [raw, setRaw] = useState(null); // { purchases, otherCounts, errors }
  const [selected, setSelected] = useState(new Set());
  const [open, setOpen] = useState(new Set());
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const analysis = useMemo(() => (raw ? analyzeEdmsPurchaseBatch(raw.purchases, parts, invoices) : null), [raw, parts, invoices]);

  async function readFile(file) {
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    setResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      const { invoices: parsed, errors } = parseFaturaRaporuReport(rows);
      const { purchases, sales, returns, other } = splitFaturaRaporuByType(parsed);
      const batch = analyzeEdmsPurchaseBatch(purchases, parts, invoices);
      setRaw({ purchases, errors, otherCounts: { sales: sales.length, returns: returns.length, other: other.length } });
      setSelected(new Set(batch.invoices.filter((invoice) => invoice.importable).map((invoice) => invoice.invoiceNo)));
      setOpen(new Set(batch.invoices.length === 1 ? [batch.invoices[0].invoiceNo] : []));
    } catch (error) {
      console.error("eDMS alış faturası okunamadı:", error);
      setRaw({ purchases: [], errors: ["Excel dosyası okunamadı. eDMS → Fatura Raporu (WDMR010) ekranından \"Excel'e Aktar\" ile alınan dosyayı seçin."], otherCounts: { sales: 0, returns: 0, other: 0 } });
    } finally {
      setLoading(false);
    }
  }

  const reset = () => { setRaw(null); setFileName(""); setSelected(new Set()); setOpen(new Set()); setResult(null); if (inputRef.current) inputRef.current.value = ""; };
  const toggle = (set, setter, key) => { const next = new Set(set); if (next.has(key)) next.delete(key); else next.add(key); setter(next); };

  const confirm = async () => {
    if (!analysis) return;
    const records = raw.purchases
      .map((invoice, index) => ({ invoice, analyzed: analysis.invoices[index] }))
      .filter(({ analyzed }) => analyzed.importable && selected.has(analyzed.invoiceNo))
      .map(({ invoice, analyzed }) => alignInvoiceSkusToParts(invoice, analyzed));
    if (!records.length) return;
    await onImport(records, (res) => { setResult(res); onDone?.(); });
  };

  const selectedAnalyses = analysis ? analysis.invoices.filter((invoice) => invoice.importable && selected.has(invoice.invoiceNo)) : [];
  const selectedNet = selectedAnalyses.reduce((sum, invoice) => sum + invoice.totals.net, 0);
  const selectedUnits = selectedAnalyses.reduce((sum, invoice) => sum + invoice.totals.stockUnits, 0);

  if (!raw) {
    return e("div", { className: "st-edms" },
      e("label", { className: `st-drop ${drag ? "is-drag" : ""} ${loading ? "is-loading" : ""}`, onDragOver: (event) => { event.preventDefault(); setDrag(true); }, onDragLeave: () => setDrag(false), onDrop: (event) => { event.preventDefault(); setDrag(false); readFile(event.dataTransfer.files?.[0]); } },
        e("input", { ref: inputRef, type: "file", accept: ".xlsx,.xls", onChange: (event) => readFile(event.target.files?.[0]), disabled: loading }),
        e("span", { className: "st-drop-orb", "aria-hidden": true }, e(Ico, { name: "upload", size: 30 })),
        e("strong", null, loading ? "eDMS raporu çözümleniyor…" : "eDMS alış faturası Excel'ini bırakın"),
        e("span", null, fileName || "veya dosya seçmek için tıklayın · .xlsx / .xls")),
      e("ol", { className: "st-howto" },
        [["eDMS'e girin", "Raporlar → Fatura Raporu (WDMR010) ekranını açın."], ["Tip: Satın Alma", "Tarih aralığını seçip Tip olarak \"Satın Alma\" (veya tümü) filtreleyin."], ["Excel'e Aktar", "Raporu \"Excel'e Aktar\" ile indirip buraya bırakın — satış faturaları yok sayılır."], ["Kontrol et, işle", "Her satır eDMS tutarlarıyla birebir kontrol edilir; onayladıklarınız stoğa girer."]]
          .map(([title, text], index) => e("li", { key: title, style: { "--i": index } }, e("b", null, index + 1), e("div", null, e("strong", null, title), e("span", null, text))))));
  }

  const { invoices: rows, summary } = analysis;
  return e("div", { className: "st-edms" },
    e("div", { className: "st-edms-head" },
      e("div", null, e("p", { className: "st-eyebrow" }, e("i", null), "eDMS · FATURA RAPORU (WDMR010)"), e("h2", null, fileName),
        e("span", { className: "st-dim" }, `${summary.count} satın alma faturası`, raw.otherCounts.sales ? ` · ${raw.otherCounts.sales} satış faturası yok sayıldı` : "", raw.otherCounts.returns ? ` · ${raw.otherCounts.returns} iade yok sayıldı` : "")),
      e("button", { type: "button", className: "button button-quiet", onClick: reset }, e(Ico, { name: "upload", size: 14 }), "Başka dosya")),
    raw.errors.length ? e("div", { className: "st-alert" }, e(Ico, { name: "alert" }), e("div", null, raw.errors.map((error) => e("p", { key: error }, error)))) : null,
    result ? e("div", { className: "st-result" }, e(Ico, { name: "check", size: 22 }),
      e("div", null, e("strong", null, `${result.imported} fatura stoğa işlendi`),
        e("span", null, [result.skipped ? `${result.skipped} fatura zaten kayıtlıydı` : null, result.failed?.length ? `${result.failed.length} fatura işlenemedi` : null].filter(Boolean).join(" · ") || "Tüm stok hareketleri faturaya bağlı olarak kaydedildi."),
        result.failed?.length ? e("ul", null, result.failed.map((item) => e("li", { key: item.invoiceNo }, `${item.invoiceNo}: ${item.error}`))) : null)) : null,
    e("div", { className: "st-edms-cards" },
      [["Fatura", summary.count, ""], ["İşlenebilir", summary.importable, "ok"], ["Zaten kayıtlı", summary.alreadyImported, ""], ["Tutar farkı", summary.mismatched, summary.mismatched ? "bad" : "ok"], ["Yeni stok kartı", summary.newCards, summary.newCards ? "warn" : ""], ["Toplam · KDV dahil", tlShort(summary.gross), ""]]
        .map(([label, value, tone], index) => e("div", { key: label, className: `st-ecard ${tone ? `is-${tone}` : ""}`, style: { "--i": index } }, e("span", null, label), e("strong", null, value)))),
    rows.length ? e("div", { className: "st-invoices" }, rows.map((invoice, index) => {
      const isOpen = open.has(invoice.invoiceNo);
      const match = invoice.totalsOk && invoice.allLinesOk;
      return e("article", { key: invoice.invoiceNo, className: `st-inv ${isOpen ? "is-open" : ""} ${invoice.alreadyImported ? "is-done" : ""}`, style: { "--i": Math.min(index, 16) } },
        e("header", null,
          e("input", { type: "checkbox", checked: invoice.importable && selected.has(invoice.invoiceNo), disabled: !invoice.importable || saving, onChange: () => toggle(selected, setSelected, invoice.invoiceNo), "aria-label": `${invoice.invoiceNo} seç` }),
          e("button", { type: "button", className: "st-inv-toggle", onClick: () => toggle(open, setOpen, invoice.invoiceNo), "aria-expanded": isOpen },
            e("div", { className: "st-inv-id" }, e("strong", null, invoice.invoiceNo), e("small", null, `${dateText(invoice.date)} · ${invoice.supplier}`)),
            e("div", { className: "st-inv-meta" },
              invoice.alreadyImported ? e("span", { className: "st-pill" }, "Zaten kayıtlı") : null,
              e("span", { className: `st-pill ${match ? "is-ok" : "is-bad"}` }, e(Ico, { name: match ? "check" : "alert", size: 12 }), match ? "eDMS ile birebir" : "Tutar farkı"),
              invoice.counts.newCards ? e("span", { className: "st-pill is-warn" }, `${invoice.counts.newCards} yeni kart`) : null,
              e("span", { className: "st-inv-total" }, e("strong", null, tl(invoice.totals.gross)), e("small", null, `${invoice.counts.stock} kalem · ${qtyText(invoice.totals.units)} adet`)),
              e("span", { className: "st-inv-chev", "aria-hidden": true }, e(Ico, { name: "chevron" }))))),
        isOpen ? e("div", { className: "st-inv-body" },
          e("div", { className: "table-scroll" }, e("table", { className: "st-table st-inv-table" },
            e("thead", null, e("tr", null, ["STOK KODU", "AÇIKLAMA", "MİKTAR", "BİRİM", "İSK.", "NET (KDV HARİÇ)", "eDMS NET", "KDV", "SİSTEMDE", "STOK SONRASI"].map((label) => e("th", { key: label }, label)))),
            e("tbody", null, invoice.lines.map((line) => e("tr", { key: line.index, className: line.kind !== "Stok" ? "is-service" : line.amountOk ? "" : "is-bad" },
              e("td", null, e("strong", null, line.sku)),
              e("td", null, line.name, line.kind !== "Stok" ? e("small", { className: "st-dim" }, " · hizmet satırı, stoğa girmez") : null),
              e("td", { className: "st-num" }, qtyText(line.qty), line.fractional ? e("small", { className: "st-warn", title: "Stok tam adetle tutulur; bu miktar yuvarlanarak işlenir." }, ` → ${Math.round(line.qty)}`) : null),
              e("td", { className: "st-num" }, tl(line.unitPrice)),
              e("td", { className: "st-num" }, line.discountPercent ? `%${line.discountPercent}` : "—"),
              e("td", { className: "st-num st-strong" }, tl(line.net)),
              e("td", { className: `st-num ${line.amountOk ? "st-ok" : "st-bad"}` }, tl(line.edmsNet), line.amountOk ? " ✓" : " ≠"),
              e("td", { className: "st-num" }, tl(line.vat)),
              e("td", null, line.kind !== "Stok" ? "—"
                : line.matchType === "new" ? e("span", { className: "st-pill is-warn", title: "Satış fiyatı alış fiyatına eşitlenir; kaydettikten sonra kartı düzenleyin." }, "Yeni kart açılır")
                : e("span", { className: "st-match" }, e("span", { className: `st-pill ${line.matchType === "exact" ? "is-ok" : "is-info"}` }, line.matchType === "exact" ? "Birebir eşleşti" : `≈ ${line.part.sku}`), e("small", null, line.part.name))),
              e("td", { className: "st-num" }, line.kind !== "Stok" ? "—" : e(React.Fragment, null, line.part ? `${qtyText(line.part.stock)} → ` : "0 → ", e("strong", null, qtyText(line.stockAfter)),
                line.costChange !== null && Math.abs(line.costChange) >= 1 ? e("small", { className: line.costChange > 0 ? "st-bad" : "st-ok" }, ` alış ${line.costChange > 0 ? "+" : ""}${line.costChange}%`) : null))))))),
          e("footer", { className: "st-inv-foot" },
            e("span", null, "Ara toplam ", e("strong", null, tl(invoice.totals.net))),
            e("span", null, "KDV ", e("strong", null, tl(invoice.totals.vat))),
            e("span", null, "Toplam ", e("strong", null, tl(invoice.totals.gross))),
            e("span", { className: invoice.totalsOk ? "st-ok" : "st-bad" }, "eDMS Fatura Tutarı ", e("strong", null, tl(invoice.totals.reportGross ?? invoice.totals.edmsGross)), invoice.totalsOk ? " ✓" : " ≠"))) : null);
    })) : e("div", { className: "st-empty" }, e(Ico, { name: "receipt", size: 32 }), e("strong", null, "Bu dosyada Satın Alma faturası bulunamadı"), e("span", null, "eDMS Fatura Raporu'nda Tip filtresini \"Satın Alma\" olarak seçip tekrar dışa aktarın.")),
    rows.some((invoice) => invoice.importable) ? e("div", { className: "st-commit" },
      e("div", null, e("strong", null, `${selectedAnalyses.length} fatura seçildi`), e("span", null, `${selectedUnits.toLocaleString("tr-TR")} adet stoğa girecek · ${tl(selectedNet)} KDV hariç`)),
      e("button", { type: "button", className: "button button-quiet", onClick: () => setSelected(new Set(rows.filter((invoice) => invoice.importable).map((invoice) => invoice.invoiceNo))), disabled: saving }, "Tümünü seç"),
      e("button", { type: "button", className: "button button-primary", onClick: confirm, disabled: saving || !selectedAnalyses.length }, e(Ico, { name: "check", size: 14 }), saving ? "İşleniyor…" : "Seçilenleri stoğa işle")) : null);
}

// ── Sayfa ───────────────────────────────────────────────────────────────────
const TABS = [["stock", "Stok Listesi", "box"], ["edms", "eDMS Alış Faturası", "upload"], ["reconcile", "eDMS Sayım Mutabakatı", "scale"]];

export function StockTracking({ parts = [], movements = [], invoices = [], query, setQuery, filterIntent, clearFilterIntent, openModal, removePart, toggleFavorite, adjustPartStock, saving, onImportEdmsPurchases, reconcileView }) {
  const [tab, setTab] = useState("stock");
  const [level, setLevel] = useState("all");
  const [openPartId, setOpenPartId] = useState(null);
  const tabRefs = useRef({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useEffect(() => {
    if (!filterIntent) return;
    setTab("stock");
    setLevel(filterIntent === "low" ? "attention" : filterIntent === "good" ? "good" : "all");
    clearFilterIntent?.();
  }, [filterIntent, clearFilterIntent]);

  useEffect(() => {
    const node = tabRefs.current[tab];
    if (node) setIndicator({ left: node.offsetLeft, width: node.offsetWidth });
  }, [tab]);

  const summary = useMemo(() => summarizeStock(parts), [parts]);
  const openPart = openPartId ? parts.find((part) => part.id === openPartId) : null;
  const savedInvoiceCount = invoices.length;

  return e("div", { className: "st-page" },
    e(StockHero, { summary, level, onLevel: (value) => { setLevel(value); setTab("stock"); } }),
    e("nav", { className: "st-tabs", role: "tablist" },
      e("span", { className: "st-tab-ink", style: { transform: `translateX(${indicator.left}px)`, width: indicator.width }, "aria-hidden": true }),
      TABS.map(([id, label, icon]) => e("button", { key: id, ref: (node) => { tabRefs.current[id] = node; }, type: "button", role: "tab", "aria-selected": tab === id, className: `st-tab ${tab === id ? "active" : ""}`, onClick: () => setTab(id) },
        e(Ico, { name: icon, size: 15 }), label, id === "edms" ? e("small", null, `${savedInvoiceCount} kayıtlı`) : null)),
      e("div", { className: "st-tabs-end" },
        e("button", { type: "button", className: "button button-quiet", onClick: () => openModal("invoice"), disabled: saving }, e(Ico, { name: "receipt", size: 14 }), "Elle alış faturası"))),
    e("div", { className: "st-stage", key: tab },
      tab === "stock" ? e(StockList, { parts, movements, query, setQuery, level, setLevel, openModal, removePart, toggleFavorite, adjustPartStock, saving, onOpenPart: (part) => setOpenPartId(part.id) })
        : tab === "edms" ? e(EdmsPurchaseImport, { parts, invoices, saving, onImport: onImportEdmsPurchases })
        : e("div", { className: "st-reconcile" }, reconcileView)),
    openPart ? e(PartDrawer, { key: openPart.id, part: openPart, movements, invoices, onClose: () => setOpenPartId(null), openModal, adjustPartStock, saving }) : null);
}
