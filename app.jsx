import React, { useCallback, useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { cancelWorkOrder, completeWorkOrder, createMissingEdmsJobs, createPurchaseInvoice, deletePurchaseInvoice, createStockDraft, createWorkOrder, deleteFitment, deleteManualWorkOrders, deleteStaleOpenWorkOrders, deletePart, deletePersonnel, deleteCustomer, deleteAppointment, deleteNotification, deleteReturnItem, enrichEdmsJobsWithInvoiceLines, fetchServiceData, fixKdvDoublingTotals, fixKnownEdmsInvoiceGaps, getPersonnelPerformance, grantUserAccess, importEdmsBankoSales, importEdmsPurchaseInvoices, importEdmsWorkOrders, listAppointments, listAuthorizedUsers, listCustomers, listNotifications, listPersonnel, listReturns, markNotificationRead, receiveStockDraft, restorePart, revokeUserAccess, saveAppointment, saveCustomer, saveFitment, savePart, savePersonnel, saveReturnItem, sendChatMessage, subscribeToChat, subscribeToServiceData, togglePartFavorite, undoPlannedEdmsJobStockRestoration, updateAppointmentStatus, updateReturnStatus, updateWorkOrder, adjustStock } from "./data.js";
import * as XLSX from "xlsx";
import { parseEdmsWorkOrderReport, selectEdmsRecordsToImport } from "./edmsImport.js";
import { parseFaturaRaporuReport, splitFaturaRaporuByType, splitSalesByKaynak } from "./faturaRaporuImport.js";
import { buildEdmsJobEnrichments, selectPurchaseInvoicesToImport, selectBankoSalesToImport, buildInvoiceReconciliationReport } from "./edmsInvoiceReconcile.js";
import { selectManualWorkOrders, summarizeManualWorkOrders } from "./manualJobCleanup.js";
import { selectStaleOpenWorkOrders, selectOpenWorkOrdersNeedingReview, summarizeStaleOpenWorkOrders } from "./staleOpenJobCleanup.js";
import { selectMissingOctoberJobDefs, summarizeMissingOctoberJobs, buildMissingOctoberJobRecords } from "./missingOctoberJobs.js";
import { CinematicCar } from "./carScene.jsx";
import { GearScene } from "./gearScene.jsx";
import { LoginStory } from "./loginStory.jsx";
import { StockCinema, AccentPicker } from "./stockCinema.jsx";
import { BusinessProvider, useBusiness, saveBusinessSettings } from "./business.js";
import { WorkOrdersCinema, InvoicesCinema } from "./pageCinema.jsx";
import { installFitScreen } from "./fitScreen.js";
import { buildPlannedEdmsJobStockRestorationUndo, computePartSalesFromJobs, getOpenWorkOrders, getRevenueEligibleWorkOrders, getWorkOrderStatusClass, WORK_ORDER_STATUS } from "./workOrderLifecycle.js";
import { formatFitmentSpec, formatFitmentVehicle, FUEL_TYPES, searchFitments, searchVehiclePartUsage } from "./vehicleCompatibility.js";
import { parseInvoicePaste } from "./invoiceImport.js";
import { findPartMatches, parsePastedPartQueries } from "./partSearch.js";
import { changeInitialPassword, firebaseConfigured, OWNER_EMAIL, registerWithPassword, requestPasswordReset, signInWithPassword, signOutUser, subscribeToAuth } from "./firebase.js";
import { calculateVat, VAT_RATE, vatIncludedAmount } from "./vat.js";
import { calculateWorkOrderNetTotal, calculateWorkOrderPriceBreakdown, normalizeLaborAmount, normalizeDiscount } from "./workOrderPricing.js";

// Kullanıcının isteğiyle: aylardır "Devam ediyor" kalmış, hiç parça/işçilik
// girilmemiş eski açık iş emirlerini temizlerken dokunulmayacak ay (içinde
// bulunulan iş ayı — Ekim 2026). Gerçek içinde veri olan açık kayıtlara,
// tarihi ne olursa olsun, bu temizlik hiçbir zaman dokunmaz (bkz.
// staleOpenJobCleanup.js).
const STALE_OPEN_JOB_KEEP_MONTH = "2026-10";

const JOB_STATUS_IN_PROGRESS = "Devam ediyor";
const JOB_STATUS_COMPLETED = "Tamamlandı";
const JOB_STATUS_CANCELLED = "İptal edildi";

// eDMS'in kendi Fatura Raporu'nda (WDMR010) satış faturası olarak görünen
// ama uygulamada hiçbir iş emri karşılığı olmayan, kullanıcıyla birlikte
// TEK TEK teyit edilmiş kayıtlar. Otomatik/toplu bir eşleştirme değildir —
// her satır burada elle listelenir; yeni bir "eksik" keşfedilirse buraya
// yeni bir girdi eklenir. `label`, önizlemede gösterilecek açıklama.
const KNOWN_INVOICE_GAPS = [
  { invoiceNo: "5001000030", action: "newJob", externalId: "1016001", label: "Mustafa Burak Yıldırım · 06DP8243 — iş emri hiç oluşturulmamış" },
  { invoiceNo: "5001000038", action: "newJob", externalId: "1020001", label: "Ferit Borası · 55DL170 — iş emri hiç oluşturulmamış" },
  { invoiceNo: "5001000040", action: "newJob", externalId: "1027001", label: "Mesut Karaman · 06BEV560 — iş emri hiç oluşturulmamış" },
  { invoiceNo: "5001000006", action: "appendToJob", jobCode: "EDMS-831002", label: "Burhan Gençbay · 55ASU020 (31 Ağu) — açık ve boş iş emrine 1. fatura" },
  { invoiceNo: "5001000007", action: "appendToJob", jobCode: "EDMS-831002", label: "Burhan Gençbay · 55ASU020 (31 Ağu) — açık ve boş iş emrine 2. fatura" },
  // NOT: Burada daha önce "5001000016 → EDMS-922002 (ikinci fatura)" diye bir
  // girdi vardı. 30.10.2026'da kullanıcının "DERYA ŞENYERİN İŞ EMRİ TUTARI
  // YANLIŞ" bildirimi üzerine eDMS Satış Faturası ekranından 5001000016
  // numaralı fatura tek tek açılıp incelendi: bu fatura EDMS-922002'nin
  // İKİNCİ bir faturası DEĞİL, TEK ve asıl faturasıydı — 6 parça + 1 işçilik
  // satırı, uygulamada zaten kayıtlı olan satırlarla (kod/miktar/fiyat)
  // birebir aynı (Net 4.361,54 / KDV 872,31 / KDV Dahil 5.233,85). Yani bu
  // fatura zaten doğru şekilde otomatik eşleşmişti; "şasi no hatalı uzunlukta"
  // varsayımı yanlıştı. Bu hatalı girdi, iş emrinin tutarını KNOWN_KDV_DOUBLING_FIXES'teki
  // EDMS-922002 kaydına yol açan (aynı faturanın tutarının bir kez daha
  // eklenmesi gibi davranan) sorunun kök nedeniydi; kalıcı olarak kaldırıldı.
];

// edmsImport.js'teki eski "Müşteri Listeleme" (WDMU050) içe aktarma kodu,
// hiç zenginleştirilmemiş (parça/işçilik satırı hiç eklenmemiş) kapalı iş
// emirlerinde eDMS'in KDV DAHİL fatura tutarını doğrudan `job.total`'a
// yazıyordu; uygulama her yerde `job.total`'ı KDV HARİÇ kabul edip tekrar
// +%20 KDV uyguladığından bu kayıtlarda KDV iki kez uygulanmış oluyordu.
// `correctTotal`, eDMS'teki gerçek (KDV dahil) fatura tutarından geri
// hesaplanan doğru NET (KDV hariç) tutardır — kullanıcıyla birlikte, eDMS
// Satış Faturası ekranındaki gerçek faturalar tek tek açılarak teyit
// edilmiştir. Otomatik/toplu bir tarama DEĞİLDİR.
const KNOWN_KDV_DOUBLING_FIXES = [
  { jobCode: "EDMS-626001", correctTotal: 2475.00, label: "Kaan Mert Erat · 55APH941 — ekranda ₺3.564,00 (olması gereken ₺2.970,00)" },
  { jobCode: "EDMS-626005", correctTotal: 2250.00, label: "\"DENEME SADECE\" (test kaydı) · AAAA — ekranda ₺3.240,00 (olması gereken ₺2.700,00)" },
  { jobCode: "EDMS-626006", correctTotal: 8593.33, label: "Kaan Mert Erat · 55APH941, \"ÖRNEK FATURA\" — ekranda ₺12.374,40 (olması gereken ₺10.312,00)" },
  { jobCode: "EDMS-817001", correctTotal: 5285.00, label: "Mustafa Erhan Bakırhan · 55AKB245 — ekranda ₺7.610,40 (olması gereken ₺6.342,00)" },
  { jobCode: "EDMS-902001", correctTotal: 8310.00, label: "Nihan Altunay · 55VA957 — ekranda ₺11.966,40 (olması gereken ₺9.972,00)" },
  { jobCode: "EDMS-909001", correctTotal: 3122.50, label: "Ayhan Bozdoğan · 55AJD693 — ekranda ₺4.496,40 (olması gereken ₺3.747,00)" },
  { jobCode: "EDMS-909003", correctTotal: 201.67, label: "Ayhan Bozdoğan · 55AJD693 (2. iş emri) — ekranda ₺290,40 (olması gereken ₺242,00)" },
  { jobCode: "EDMS-912001", correctTotal: 7470.00, label: "Fatih Akçay · 05AK022 — ekranda ₺10.756,80 (olması gereken ₺8.964,00)" },
  { jobCode: "EDMS-925002", correctTotal: 185.83, label: "Demir İnş. Akaryakıt · 34BCF450 — ekranda ₺267,60 (olması gereken ₺223,00; fatura eDMS'te bulunamadı, WDMU050'den hesaplandı)" },
  // EDMS-922002 farklı bir nedenden: KDV'nin basitçe iki kez uygulanması değil,
  // yukarıdaki (artık kaldırılmış) hatalı KNOWN_INVOICE_GAPS girdisi yüzünden
  // tek bir gerçek faturanın (5001000016) tutarı iş emrine BİR KEZ DAHA
  // eklenmişti. Sonuç olarak ekrandaki tutar da aynı şekilde "olması
  // gerekenin" üzerinde göründüğü için düzeltme mekanizması buraya uyuyor.
  { jobCode: "EDMS-922002", correctTotal: 4361.54, label: "Derya Şenyer · 55ARE725 — ekranda ₺11.514,65 (olması gereken ₺5.233,85; eDMS Satış Faturası 5001000016 ile birebir doğrulandı — 'ikinci fatura' yoktu, aynı faturanın tutarı KNOWN_INVOICE_GAPS'teki hatalı appendToJob girdisiyle bir kez daha eklenmişti)" },
];

// Kullanıcının isteğiyle: eDMS'in canlı "İş Emri" ekranında (Menü → İş Emri;
// Fatura Raporu'nun kapsamadığı, henüz faturalanmamış açık kayıtlar) hâlâ
// açık görünen ama uygulamada hiç karşılığı olmayan 3 Ekim 2026 iş emri,
// 30.10.2026'da eDMS'teki "YP & İşçilik" ekranından tek tek okunup buraya
// elle girilmiştir — otomatik/toplu bir tarama DEĞİLDİR. `lines`'daki
// fiyat/miktar değerleri eDMS'in "Planlanan" (ve 1030001'in 5 parçasından
// 4'ünde ayrıca "Kullanılan") sütunundan birebir alınmıştır; "Kullanılan"
// farkı kasıtlı olarak yok sayılır (bkz. missingOctoberJobs.js — stok
// düşümü burada değil, gerçek fatura geldiğinde yapılır). LTRS200134
// kodu eDMS'te "(ACC) PLASTİK ONARIM KİTİ" olarak görünüyor; uygulamanın
// envanterinde aynı kod zaten "BALATA SPREYİ" adıyla kayıtlı (fiyat
// ₺175,79 birebir eşleşiyor) — buildJobEnrichmentPatch'in yerleşik
// kuralı gereği var olan kartın adı esas alınır, eDMS'teki isim
// kullanılmaz (bu isim farkı kullanıcıya ayrıca raporlanmalı). BSG
// 90-135-011 ("HAVA FİLTRESİ") envanterde hiç yok; 0 stokla yeni kart
// olarak önerilecek.
const MISSING_OCTOBER_JOBS = [
  {
    externalId: "1026001",
    header: {
      plate: "34KAE761", vin: "ZFA2500002Y11828", customer: "DMR YEDEK PARÇA OTOMOTİV PETROL SAN.TİC. A.Ş.",
      phone: "0(532)133 84 73", make: "FIAT", bodyType: "DUCATO", model: "DUCATO KAMYONET 2800DC 2.2 140 KASALI",
      modelYear: "2025", date: "2026-10-26", arrivalKm: 71623,
    },
    lines: [
      { kind: "Stok", kod: "LTRS200134", name: "(ACC) PLASTİK ONARIM KİTİ", unitPrice: 175.79, qty: 10, discountPercent: 0 },
    ],
  },
  {
    externalId: "1028001",
    header: {
      plate: "34DGP143", vin: "1888A900000085554", customer: "DMR YEDEK PARÇA OTOMOTİV PETROL SAN.TİC. A.Ş.",
      phone: "0(532)133 84 73", make: "TOFAS-FIAT", bodyType: "PALIO", model: "PALIO SOLE 1.3 MULTIJET DYNAMIC",
      modelYear: "2004", date: "2026-10-28", arrivalKm: 252000,
    },
    lines: [
      { kind: "Stok", kod: "LTRS200134", name: "(ACC) PLASTİK ONARIM KİTİ", unitPrice: 175.79, qty: 8, discountPercent: 0 },
      { kind: "Stok", kod: "75W803L", name: "ŞANZIMAN YAĞ 75W80 3 LİTRE", unitPrice: 542.35, qty: 3, discountPercent: 0 },
      { kind: "Stok", kod: "LTR1610725580OEM", name: "FREN HİDROLİK YAĞI DOT4 500 ML", unitPrice: 350.00, qty: 1, discountPercent: 0 },
    ],
  },
  {
    externalId: "1030001",
    header: {
      plate: "67AAH484", vin: "WVWZZZ16ZCM142437", customer: "CAN BEKTAŞ",
      phone: "0(546)644 09 99", make: "VOLKSWAGEN", bodyType: "JETTA", model: "JETTA 1.6 TDI PRIMELINE T.TRONIC DSG 105",
      modelYear: "2012", date: "2026-10-30", arrivalKm: 234000,
    },
    lines: [
      { kind: "Stok", kod: "BSG 90-145-008", name: "POLEN FİLTRESİ", unitPrice: 163.30, qty: 1, discountPercent: 0 },
      { kind: "Stok", kod: "BCH F026407023", name: "YAĞ FİLTRESİ", unitPrice: 198.09, qty: 1, discountPercent: 0 },
      { kind: "Stok", kod: "ERP-5W30", name: "MOTOR YAĞI EUROREPAR 5W30", unitPrice: 305.30, qty: 4, discountPercent: 0 },
      { kind: "Stok", kod: "BSG 90-135-011", name: "HAVA FİLTRESİ", unitPrice: 211.20, qty: 1, discountPercent: 0 },
      { kind: "Stok", kod: "LTRS200134", name: "(ACC) PLASTİK ONARIM KİTİ", unitPrice: 175.79, qty: 1, discountPercent: 0 },
      { kind: "Hizmet", kod: "ERT001", name: "Bakım İşçiliği", unitPrice: 2750.00, qty: 1, discountPercent: 25 },
    ],
  },
];

const h = React.createElement;

// ── Para birimi yardımcıları ─────────────────────────────────────────────────
// "1.356,46" → 1356.46 | "1356.46" → 1356.46 | "1356" → 1356
function parseCurrencyInput(raw) {
  if (raw === null || raw === undefined) return NaN;
  const str = String(raw).trim();
  if (str === "" || str === "-") return NaN;
  // Hem nokta hem virgül varsa: hangisi binlik, hangisi ondalık?
  const hasDot = str.includes(".");
  const hasComma = str.includes(",");
  if (hasDot && hasComma) {
    const lastDot = str.lastIndexOf(".");
    const lastComma = str.lastIndexOf(",");
    if (lastComma > lastDot) {
      // Türkçe/Avrupa: 1.356,46 → binlik=nokta, ondalık=virgül
      return parseFloat(str.replace(/\./g, "").replace(",", "."));
    } else {
      // Anglo: 1,356.46 → binlik=virgül, ondalık=nokta
      return parseFloat(str.replace(/,/g, ""));
    }
  }
  if (hasComma && !hasDot) {
    // Sadece virgül: ondalık ayracı olarak kullanılmış (456,50)
    const parts = str.split(",");
    if (parts.length === 2 && parts[1].length <= 3) {
      return parseFloat(str.replace(",", "."));
    }
    // Binlik virgül (Anglo tarzı 1,356) — ondalık yok
    return parseFloat(str.replace(/,/g, ""));
  }
  // Sadece nokta veya hiç yok → direkt parse
  return parseFloat(str.replace(/\./g, match => {
    // Eğer son 3 karakterden daha önce tek nokta varsa binlik ayraç
    const idx = str.lastIndexOf(".");
    return str.indexOf(".") === idx ? "." : "";
  }));
}

// Türkçe para formatı: 1356.46 → "1.356,46"
function formatCurrencyDisplay(num) {
  if (!Number.isFinite(num)) return "";
  return num.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Kontrollü para input bileşeni
function CurrencyInput({ value, onChange = () => {}, id, name, placeholder = "0,00", required = false, className = "", "aria-describedby": ariaDescribedby }) {
  // value: ham sayı (number veya string), display: kullanıcının gördüğü string
  const toDisplay = (v) => {
    const n = parseCurrencyInput(String(v ?? ""));
    return Number.isFinite(n) ? formatCurrencyDisplay(n) : (v === "" || v === undefined || v === null ? "" : String(v));
  };
  const [display, setDisplay] = useState(() => toDisplay(value));
  const [numericValue, setNumericValue] = useState(() => {
    const n = parseCurrencyInput(String(value ?? ""));
    return Number.isFinite(n) ? String(n) : "";
  });
  const [focused, setFocused] = useState(false);

  // Dışarıdan value değişince (ör. parça seçilince) display'i güncelle
  const prevValue = React.useRef(value);
  useEffect(() => {
    if (!focused && prevValue.current !== value) {
      setDisplay(toDisplay(value));
      const n = parseCurrencyInput(String(value ?? ""));
      setNumericValue(Number.isFinite(n) ? String(n) : "");
    }
    prevValue.current = value;
  }, [value, focused]);

  function handleChange(e) {
    const raw = e.target.value;
    // Yazarken sadece: rakam, nokta, virgül, eksi işareti
    if (raw !== "" && !/^-?[\d.,]*$/.test(raw)) return;
    setDisplay(raw);
    const num = parseCurrencyInput(raw);
    const nv = Number.isFinite(num) ? String(num) : raw;
    setNumericValue(nv);
    onChange(nv);
  }

  function handlePaste(e) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").trim();
    const num = parseCurrencyInput(pasted);
    if (Number.isFinite(num)) {
      setDisplay(formatCurrencyDisplay(num));
      setNumericValue(String(num));
      onChange(String(num));
    } else {
      setDisplay(pasted);
      setNumericValue(pasted);
      onChange(pasted);
    }
  }

  function handleFocus(e) {
    setFocused(true);
    // Odaklanınca ham sayıyı göster (kolay düzenleme için)
    const num = parseCurrencyInput(display);
    if (Number.isFinite(num)) {
      const raw = num % 1 === 0 ? String(num) : String(num).replace(".", ",");
      setDisplay(raw);
    }
    e.target.select();
  }

  function handleBlur() {
    setFocused(false);
    const num = parseCurrencyInput(display);
    if (Number.isFinite(num)) {
      setDisplay(formatCurrencyDisplay(num));
      setNumericValue(String(num));
      onChange(String(num));
    } else if (display.trim() === "") {
      setDisplay("");
      setNumericValue("");
      onChange("");
    }
  }

  return h(React.Fragment, null,
    // Hidden input: FormData tarafından okunur (form.get(name))
    name ? h("input", { type: "hidden", name, value: numericValue, readOnly: true }) : null,
    h("input", {
      id,
      type: "text",
      inputMode: "decimal",
      value: display,
      placeholder,
      required,
      className,
      "aria-describedby": ariaDescribedby,
      onChange: handleChange,
      onPaste: handlePaste,
      onFocus: handleFocus,
      onBlur: handleBlur,
      autoComplete: "off",
    })
  );
}
// ────────────────────────────────────────────────────────────────────────────
const iconPaths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",
  box: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.3 7 12 12l8.7-5 M12 22V12",
  wrench: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.2-3.2a6 6 0 0 1-7.9 7.9L7 20a2.1 2.1 0 0 1-3-3l6-6a6 6 0 0 1 7.9-7.9z",
  receipt: "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z M8 8h8 M8 12h8 M8 16h4",
  cart: "M3 3h2l2.4 12.4a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L22 7H6 M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2 M18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
  chart: "M3 3v18h18 M18 17V9 M13 17V5 M8 17v-3",
  search: "m21 21-4.3-4.3 M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
  sun: "M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.64 5.64l1.42 1.42 M16.94 16.94l1.42 1.42 M18.36 5.64l-1.42 1.42 M7.06 16.94l-1.42 1.42 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
  moon: "M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13z",
  plus: "M12 5v14 M5 12h14", arrow: "M5 12h14 M12 5l7 7-7 7",
  close: "M18 6 6 18 M6 6l12 12", logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  car: "M5 17h14l1-5-2-5H6l-2 5z M5 17v2h2v-2 M17 17v2h2v-2 M4 12h16 M7 15h.01 M17 15h.01",
  calendar: "M4 7V2h16v5 M3 17h18 M3 6v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v11z",
};
function Icon({ name, size = 18, className = "" }) {
  return h("svg", { className, width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, h("path", { d: iconPaths[name] || iconPaths.grid }));
}
function money(amount) { return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0); }
function dateLabel(value) { return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }

function App() {
  const business = useBusiness();
  const [theme, setTheme] = useState(() => localStorage.getItem("demir-service-theme") === "light" ? "light" : "dark");
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState({ parts: [], jobs: [], invoices: [], drafts: [], fitments: [], movements: [], customers: [], personnel: [], appointments: [], notifications: [], returns: [] });
  const [chatMessages, setChatMessages] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [page, setPage] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [query, setQuery] = useState("");
  const [inventoryFilterIntent, setInventoryFilterIntent] = useState(null);
  const [workOrderSelectionIntent, setWorkOrderSelectionIntent] = useState(null);
  const [workOrderStatusFilterIntent, setWorkOrderStatusFilterIntent] = useState(null);
  const [vehicleQueryIntent, setVehicleQueryIntent] = useState(null);
  const [toast, setToast] = useState("");
  const [toastAction, setToastAction] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [accent, setAccentState] = useState(() => { try { const saved = localStorage.getItem("demir-service-accent"); return ["indigo", "amber", "teal"].includes(saved) ? saved : "indigo"; } catch { return "indigo"; } });
  const setAccent = (value) => { setAccentState(value); try { localStorage.setItem("demir-service-accent", value); } catch { /* tercih saklanamadı */ } };
  useEffect(() => { document.documentElement.dataset.accent = accent; }, [accent]);
  const toggleTheme = (event) => {
    const next = theme === "dark" ? "light" : "dark";
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const x = event?.clientX ?? window.innerWidth / 2;
    const y = event?.clientY ?? window.innerHeight / 2;
    if (!reduced && document.startViewTransition) {
      document.documentElement.style.setProperty("--theme-x", `${x}px`);
      document.documentElement.style.setProperty("--theme-y", `${y}px`);
      document.startViewTransition(() => setTheme(next));
    } else {
      setTheme(next);
    }
  };

  // Global arama
  const globalSearchResults = React.useMemo(() => {
    if (!globalSearchQuery.trim()) return [];
    const q = globalSearchQuery.toLocaleLowerCase("tr").replace(/ı/g, "i");
    const results = [];
    data.parts.forEach(part => {
      if (part.name.toLocaleLowerCase("tr").replace(/ı/g, "i").includes(q) ||
          part.sku.toLocaleLowerCase("tr").replace(/ı/g, "i").includes(q)) {
        results.push({ type: "part", item: part, label: part.name, sublabel: part.sku });
      }
    });
    data.jobs.forEach(job => {
      if (job.plate?.toLocaleLowerCase("tr").replace(/ı/g, "i").includes(q) ||
          job.customer?.toLocaleLowerCase("tr").replace(/ı/g, "i").includes(q) ||
          job.code?.toLocaleLowerCase("tr").replace(/ı/g, "i").includes(q)) {
        results.push({ type: "job", item: job, label: job.plate, sublabel: job.customer });
      }
    });
    return results.slice(0, 8);
  }, [globalSearchQuery, data]);

  // Klavye kısayolları
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setGlobalSearchOpen(true);
      }
      if (e.key === "Escape") {
        setGlobalSearchOpen(false);
        setModal(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("demir-service-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (!firebaseConfigured) {
      setAuthReady(true);
      return undefined;
    }
    return subscribeToAuth((nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    }, (error) => {
      console.error("Firebase oturum doğrulaması başarısız:", error);
      setErrorMessage(error.message || "Güvenli oturum doğrulanamadı.");
      setAuthReady(true);
    });
  }, []);
  const reloadData = useCallback(async () => {
    setData(await fetchServiceData());
  }, []);
  useEffect(() => {
    if (!user) {
      setData({ parts: [], jobs: [], invoices: [], drafts: [], fitments: [], movements: [] });
      setChatMessages([]);
      setDataLoading(false);
      return undefined;
    }
    let active = true;
    let timer;
    setDataLoading(true);
    const load = async () => {
      try {
        const currentData = await fetchServiceData();
        if (active) { setData(currentData); setErrorMessage(""); }
      } catch (error) {
        console.error("Bulut servis verileri yüklenemedi:", error);
        if (active) setErrorMessage(`Bulut verileri yüklenemedi: ${error.message || "Bilinmeyen hata"}`);
      } finally {
        if (active) setDataLoading(false);
      }
    };
    load();
    const unsubscribe = subscribeToServiceData(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        load().catch((error) => {
          console.error("Canlı veri yenilenemedi:", error);
          if (active) setErrorMessage(error.message || "Bulut verileri yenilenemedi.");
        });
      }, 180);
    }, (error) => {
      console.error("Bulut veri aboneliği başarısız:", error);
      if (active) setErrorMessage(error.message || "Canlı veri bağlantısı kurulamadı.");
    });
    const chatUnsubscribe = subscribeToChat((messages) => {
      if (active) setChatMessages(messages);
    }, (error) => {
      console.error("Sohbet aboneliği başarısız:", error);
    });
    return () => { active = false; window.clearTimeout(timer); unsubscribe(); chatUnsubscribe(); };
  }, [user, reloadData]);

  const lowStock = data.parts.filter((part) => part.stock <= part.minimum);
  const revenueEligibleJobs = getRevenueEligibleWorkOrders(data.jobs);
  // Kullanıcının isteğiyle: iş emri bazlı ciroya, hiçbir iş emrine bağlı
  // olmayan eDMS Banko (tezgah) satışları da (KDV dahil, bkz. bankoSales
  // koleksiyonu) eklenir — Toplam Ciro'nun eDMS'in kendi "Genel Toplam"ıyla
  // uyuşabilmesi için.
  const bankoRevenue = (data.bankoSales || []).reduce((sum, sale) => sum + Number(sale.grossTotal || 0), 0);
  const jobRevenue = vatIncludedAmount(revenueEligibleJobs.reduce((sum, job) => sum + Number(job.total || 0), 0));
  const revenue = jobRevenue + bankoRevenue;
  useEffect(() => { if (toast) { const timer = setTimeout(() => { setToast(""); setToastAction(null); }, toastAction ? 8000 : 3200); return () => clearTimeout(timer); } }, [toast, toastAction]);

  const nav = [
    { id: "dashboard", label: "Genel Bakış", icon: "grid" },
    { id: "inventory", label: "Parça Envanteri", icon: "box", badge: lowStock.length },
    { id: "workorders", label: "İş Emirleri", icon: "wrench" },
    { id: "vehicles", label: "Araç Geçmişi", icon: "car" },
    { id: "compatibility", label: "Araç Uyumluluğu", icon: "car" },
    { id: "movements", label: "Stok Hareketleri", icon: "receipt" },
    { id: "invoices", label: "Alış Faturaları", icon: "receipt" },
    { id: "orders", label: "Taslak Siparişler", icon: "cart", badge: data.drafts.length || null },
    { id: "reports", label: "Raporlar", icon: "chart" },
    { id: "stockcompare", label: "Stok Karşılaştır", icon: "chart" },
    { id: "edmsimport", label: "eDMS'ten İçe Aktar", icon: "box" },
    { id: "returns", label: "İade Parçalar", icon: "receipt", badge: data.returns?.filter((r) => r.status === "pending").length || null },
    { id: "chat", label: "Sohbet", icon: "bell", badge: chatMessages.length || null },
    { id: "servicebox", label: "ServiceBox", icon: "search", external: true, url: "https://idfed.mpsa.com/as/authorization.oauth2?response_type=code&client_id=CIDHBJGJWDTBSTEPFPFESQQNEIOJKOUQ&redirect_uri=https%3A%2F%2Fservicebox.mpsa.com%2Fdo%2Foauth2Callback&scope=openid+prd%3Ajbn+profile&state=T_uiRpnctUziudhxhzOiQs3FnICKHQLg5r4UKy9F8ZHLfk_8YUirCf4cB6z9sPjeoUoT4aL1_rf1OHVHLsUgExJBPXNRHqNP&code_challenge=bpZaD0Od0siQfVjM9C0NRHF0n-jSaAWzINuDL8W97BU&code_challenge_method=S256" },
    { id: "b2b", label: "B2B Demir", icon: "box", external: true, url: "https://www.b2bdemirotomotiv.com.tr/" },
    { id: "customers", label: "Müşteriler", icon: "grid" },
    { id: "personnel", label: "Personel", icon: "grid" },
    { id: "appointments", label: "Randevular", icon: "calendar" },
    { id: "notifications", label: "Bildirimler", icon: "bell", badge: data.notifications?.filter((n) => !n.read).length || null },
    { id: "backup", label: "Yedekleme", icon: "cart" },
  ];
  const isOwner = user?.email?.toLowerCase() === OWNER_EMAIL;
  if (isOwner) nav.push({ id: "access", label: "Yetkili Kullanıcılar", icon: "grid" });
  if (isOwner) nav.push({ id: "settings", label: "İşletme Ayarları", icon: "wrench" });
  const titles = { settings: ["İşletme Ayarları", "İşletme adını, kısa etiketini ve sloganını düzenleyin."], dashboard: ["Genel Bakış", "Servisinizin bugünkü durumuna göz atın."], inventory: ["Parça Envanteri", "Stoklarınızı ve parça fiyatlarınızı yönetin."], workorders: ["İş Emirleri", "Araç servis geçmişini ve devam eden işleri takip edin."], vehicles: ["Araç Servis Geçmişi", "Plakaya göre servis ziyaretlerini ve kullanılan parçaları bulun."], compatibility: ["Araç Uyumluluğu", "Marka, model, yakıt ve motor için uyumlu parçaları kaydedin; iş emri kullanımını da görün."], movements: ["Stok Hareketleri", "Giriş, çıkış ve düzeltmeleri kaynak ve kullanıcıyla izleyin."], invoices: ["Alış Faturaları", "Faturaları kaydedin, stok girişlerini anında işleyin."], orders: ["Taslak Siparişler", "Azalan parçalar için oluşturduğunuz sipariş önerileri."], reports: ["Raporlar", "Satış performansı ve iş emri cironuz."], stockcompare: ["Stok Karşılaştır", "Excel ile stok karşılaştırma yapın."], edmsimport: ["eDMS'ten İçe Aktar", "EUROREPAR eDMS'ten aldığınız \"Müşteri Listeleme\" Excel raporunu iş emri kayıtlarına aktarın."], returns: ["İade Parçalar", "İade edilecek parçaları takip edin ve yönetin."], access: ["Yetkili Kullanıcılar", "Hesap ekleyin veya servis erişimini kaldırın."], chat: ["Sohbet", "Ekibinizle iletişim kurun."], servicebox: ["Peugeot ServiceBox", "Parça tespiti için Peugeot ServiceBox'a gidin."], customers: ["Müşteri Yönetimi", "Müşteri kayıtlarını, araçlarını ve iletişim bilgilerini yönetin."], personnel: ["Personel Yönetimi", "Çalışan kayıtlarını, rollerini ve performanslarını takip edin."], appointments: ["Randevu Takvimi", "Müşteri randevularını planlayın ve servis tarihlerini yönetin."], notifications: ["Bildirimler", "Düşük stok, randevu ve sistem bildirimlerini yönetin."], backup: ["Yedekleme", "Verilerinizi Excel/PDF olarak dışa aktarın ve yedekleyin."] };
  const openModal = (type, item = null) => setModal({ type, item });
  const openCriticalInventory = () => {
    setQuery("");
    setInventoryFilterIntent("low");
    setPage("inventory");
  };
  const openWorkOrder = (jobId) => {
    setQuery("");
    setWorkOrderSelectionIntent(jobId);
    setPage("workorders");
  };
  const openWorkOrderList = () => {
    setQuery("");
    setWorkOrderSelectionIntent(null);
    setWorkOrderStatusFilterIntent(null);
    setPage("workorders");
  };
  const openOpenWorkOrders = () => {
    setQuery("");
    setWorkOrderSelectionIntent(null);
    setWorkOrderStatusFilterIntent(WORK_ORDER_STATUS.IN_PROGRESS);
    setPage("workorders");
  };
  const openVehicleHistory = (plate) => {
    setVehicleQueryIntent(plate);
    setPage("vehicles");
  };
  const runAction = async (action, success) => {
    setErrorMessage("");
    setSaving(true);
    try {
      await action();
      if (success) { setToast(success); setToastAction(null); }
    } catch (error) {
      console.error("Bulut veri işlemi başarısız:", error);
      setErrorMessage(error.message || "İşlem tamamlanamadı.");
    } finally {
      setSaving(false);
    }
  };
  const persistPart = async (part) => {
    if (data.parts.some((entry) => entry.sku.toLocaleLowerCase("tr") === part.sku.toLocaleLowerCase("tr") && entry.id !== part.id)) {
      setErrorMessage("Bu SKU kodu başka bir parçada kullanılıyor.");
      return;
    }
    await runAction(async () => { await savePart(part, user.email); await reloadData(); setModal(null); }, "Parça kaydedildi.");
  };
  const persistFitment = async (fitment) => {
    await runAction(async () => { await saveFitment(fitment); await reloadData(); setModal(null); }, "Araç uyumluluğu kaydedildi.");
  };
  const persistCustomer = async (customer) => {
    await runAction(async () => { await saveCustomer(customer, user.email); await reloadData(); setModal(null); }, "Müşteri kaydedildi.");
  };
  const persistPersonnel = async (personnel) => {
    await runAction(async () => { await savePersonnel(personnel, user.email); await reloadData(); setModal(null); }, "Personel kaydedildi.");
  };
  const persistAppointment = async (appointment) => {
    await runAction(async () => { await saveAppointment(appointment, user.email); await reloadData(); setModal(null); }, "Randevu kaydedildi.");
  };
  const persistNotification = async (notification) => {
    await runAction(async () => { await createNotification(notification, user.email); await reloadData(); setModal(null); }, "Bildirim oluşturuldu.");
  };
  const persistReturnItem = async (returnItem) => {
    await runAction(async () => { await saveReturnItem(returnItem, user.email); await reloadData(); setModal(null); }, "İade parça kaydedildi.");
  };
  const toggleFavorite = async (partId) => {
    await runAction(async () => { await togglePartFavorite(partId); await reloadData(); }, "Favori durumu güncellendi.");
  };
  const removeFitment = async (fitment) => {
    const label = formatFitmentVehicle(fitment) || "bu kayıt";
    if (!window.confirm(`${label} uyumluluk kaydını silmek istiyor musunuz?`)) return;
    await runAction(async () => { await deleteFitment(fitment.id); await reloadData(); }, "Uyumluluk kaydı silindi.");
  };
  const removePart = async (part) => {
    if (!window.confirm(`"${part.name}" parçasını envanterden silmek istiyor musunuz? Geçmiş işlem satırları korunur.`)) return;
    await runAction(async () => {
      await deletePart(part.id);
      await reloadData();
      setToast(`${part.name} arşivlendi.`);
      setToastAction({ label: "Geri al", run: async () => {
        await restorePart(part.id);
        await reloadData();
        setToast(`${part.name} geri yüklendi.`);
        setToastAction(null);
      } });
    });
  };
  const adjustPartStock = async (part, deltaQty, type = "Düzeltme") => {
    if (!window.confirm(`${part.name} stoğuna ${deltaQty > 0 ? "+" : ""}${deltaQty} adet eklemek istiyor musunuz?`)) return;
    await runAction(async () => {
      await adjustStock(part.id, deltaQty, user.email, type);
      await reloadData();
      setToast(`${part.name} stoğu güncellendi.`);
    });
  };
  const persistJob = async (job) => {
    const isEditing = Boolean(job.id);
    await runAction(async () => {
      if (isEditing) await updateWorkOrder(job.id, job, user.email);
      else await createWorkOrder(job, user.email);
      await reloadData();
      setModal(null);
    }, isEditing
      ? (job.status === JOB_STATUS_COMPLETED ? "İş emri güncellendi ve tamamlandı; parçalar stoktan düşüldü." : "İş emri güncellendi.")
      : "İş emri oluşturuldu. İş emri açık kaldığı sürece stok düşülmez; \"Tamamlandı\" olarak işaretlendiğinde parçalar stoktan düşülür.");
  };
  const persistInvoice = async (invoice) => {
    const isEditing = Boolean(invoice.id);
    await runAction(async () => { await createPurchaseInvoice(invoice, user.email, isEditing ? invoice.id : null); await reloadData(); setModal(null); }, isEditing ? "Fatura güncellendi, stok hareketleri düzeltildi." : "Fatura kaydedildi, stoklar ve hareket geçmişi güncellendi.");
  };
  const removeInvoice = async (invoice) => {
    const confirmed = window.confirm(`"${invoice.code || invoice.id}" faturasını silmek istiyor musunuz? Faturadaki parça adetleri stoktan düşülür.`);
    if (!confirmed) return;
    await runAction(async () => { await deletePurchaseInvoice(invoice.id, user.email); await reloadData(); }, "Fatura silindi; stoklar geri alındı.");
  };
  const markJobComplete = async (job) => {
    await runAction(async () => { await completeWorkOrder(job.id, user.email); await reloadData(); }, "İş emri tamamlandı.");
  };
  const cancelJob = async (job) => {
    const confirmed = window.confirm("İş emrini iptal etmek istiyor musunuz? Kullanılan parçalar stoğa iade edilir. Kayıt geçmişte kalır; ciro ve araç parça sonuçlarından çıkarılır.");
    if (!confirmed) return;
    await runAction(async () => { await cancelWorkOrder(job.id, user.email); await reloadData(); }, "İş emri iptal edildi; stok iade edildi ve kayıt denetim için saklandı.");
  };
  const createDraft = async () => {
    await runAction(async () => { await createStockDraft(); await reloadData(); setPage("orders"); }, "Kritik stoklar için sipariş taslağı oluşturuldu.");
  };
  const receiveDraft = async (id) => {
    await runAction(async () => { await receiveStockDraft(id, user.email); await reloadData(); }, "Sipariş stoğa işlendi ve hareket geçmişi güncellendi.");
  };
  const persistEdmsImport = async (records, onDone) => {
    await runAction(async () => {
      const result = await importEdmsWorkOrders(records, data.jobs, user.email);
      await reloadData();
      setToast(result.added
        ? `${result.added} iş emri eklendi${result.skipped ? `, ${result.skipped} kayıt zaten vardı` : ""}.`
        : `Eklenecek yeni kayıt yok (${result.skipped} kayıt zaten uygulamada mevcut).`);
      if (onDone) onDone(result);
    });
  };
  const persistFaturaRaporuImport = async ({ purchaseRecords, salesRecords, bankoRecords }, onDone) => {
    await runAction(async () => {
      const purchaseResult = purchaseRecords.length
        ? await importEdmsPurchaseInvoices(purchaseRecords, data.invoices, data.parts, user.email)
        : { imported: 0, skipped: 0, failed: [], warnings: [] };
      // Alış faturaları stoğu güncelledikten sonra, satış satırlarını en güncel
      // parça listesiyle eşleştirmek için veriyi taze olarak tekrar çekiyoruz
      // (reloadData, React state güncellemesini bu kapanış içinde senkron
      // yansıtmaz; bu yüzden doğrudan fetchServiceData kullanılıyor).
      const freshAfterPurchase = await fetchServiceData();
      setData(freshAfterPurchase);
      const enrichResult = salesRecords.length
        ? await enrichEdmsJobsWithInvoiceLines(freshAfterPurchase.jobs, salesRecords, freshAfterPurchase.parts, user.email)
        : { updated: 0, newParts: 0, warnings: [], ambiguous: [], unmatchedInvoices: [], skippedJobs: [] };
      const bankoResult = bankoRecords && bankoRecords.length
        ? await importEdmsBankoSales(bankoRecords, freshAfterPurchase.bankoSales, user.email)
        : { imported: 0, skipped: 0, sales: [] };
      await reloadData();
      const summary = [
        purchaseResult.imported ? `${purchaseResult.imported} alış faturası (stok güncellendi)` : null,
        purchaseResult.skipped ? `${purchaseResult.skipped} alış faturası zaten vardı` : null,
        enrichResult.updated ? `${enrichResult.updated} iş emrine satır eklendi` : null,
        enrichResult.newParts ? `${enrichResult.newParts} yeni stok kartı önerildi` : null,
        bankoResult.imported ? `${bankoResult.imported} banko satışı eklendi` : null,
        bankoResult.skipped ? `${bankoResult.skipped} banko satışı zaten vardı` : null,
      ].filter(Boolean).join(", ");
      setToast(summary || "İçe aktarılacak yeni kayıt bulunamadı.");
      if (onDone) onDone({ purchaseResult, enrichResult, bankoResult });
    });
  };
  const persistManualJobCleanup = async (jobIds, onDone) => {
    await runAction(async () => {
      const targetJobs = data.jobs.filter((job) => jobIds.includes(job.id));
      const result = await deleteManualWorkOrders(targetJobs, user.email);
      await reloadData();
      setToast(`${result.deleted} elle girilmiş iş emri silindi${result.failed.length ? `, ${result.failed.length} kayıt silinemedi` : ""}.`);
      if (onDone) onDone(result);
    });
  };
  const persistStaleOpenJobCleanup = async (onDone) => {
    await runAction(async () => {
      const result = await deleteStaleOpenWorkOrders(data.jobs, user.email, { keepMonthPrefix: STALE_OPEN_JOB_KEEP_MONTH });
      await reloadData();
      setToast(`${result.deleted} eski açık iş emri silindi${result.failed.length ? `, ${result.failed.length} kayıt silinemedi` : ""}.`);
      if (onDone) onDone(result);
    });
  };
  const persistMissingOctoberJobs = async (onDone) => {
    await runAction(async () => {
      const result = await createMissingEdmsJobs(MISSING_OCTOBER_JOBS, data.jobs, data.parts, user.email);
      await reloadData();
      setToast(`${result.created} eksik Ekim iş emri eklendi${result.newParts ? `, ${result.newParts} yeni parça kartı oluşturuldu` : ""}.`);
      if (onDone) onDone(result);
    });
  };
  const persistInvoiceGapFixes = async (salesRecords, onDone) => {
    await runAction(async () => {
      const result = await fixKnownEdmsInvoiceGaps(KNOWN_INVOICE_GAPS, data.jobs, data.parts, salesRecords, user.email);
      await reloadData();
      setToast([
        result.createdJobs ? `${result.createdJobs} eksik iş emri oluşturuldu` : null,
        result.appendedInvoices ? `${result.appendedInvoices} fatura mevcut iş emrine eklendi` : null,
        result.skipped.length ? `${result.skipped.length} kayıt atlandı (zaten uygulanmış)` : null,
      ].filter(Boolean).join(", ") || "Uygulanacak eksik kayıt bulunamadı.");
      if (onDone) onDone(result);
    });
  };
  const persistKdvDoublingFix = async (onDone) => {
    await runAction(async () => {
      const result = await fixKdvDoublingTotals(KNOWN_KDV_DOUBLING_FIXES, data.jobs, user.email);
      await reloadData();
      setToast(result.fixed.length
        ? `${result.fixed.length} iş emrinin tutarı düzeltildi.`
        : "Düzeltilecek kayıt bulunamadı (tüm iş emirleri zaten düzeltilmiş).");
      if (onDone) onDone(result);
    });
  };
  const persistUndoPlannedEdmsRestoration = async (onDone) => {
    await runAction(async () => {
      const result = await undoPlannedEdmsJobStockRestoration(data.jobs, data.parts, user.email);
      await reloadData();
      setToast(result.correctedJobs
        ? `${result.correctedJobs} planlanan eDMS iş emrindeki ${result.correctedParts} parça için hatalı stok iadesi geri alındı.`
        : "Düzeltilecek kayıt bulunamadı.");
      if (onDone) onDone(result);
    });
  };
  async function authenticate(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setErrorMessage(""); setAuthNotice(""); setToast(""); setAuthBusy(true);
    try {
      if (form.get("mode") === "register") {
        await registerWithPassword(String(form.get("email") || ""), String(form.get("password") || ""));
        setAuthNotice("Hesabınız oluşturuldu. E-posta kutunuzdaki doğrulama bağlantısını açın; erişiminiz yönetici tarafından onaylandıktan sonra giriş yapabilirsiniz.");
      } else if (form.get("mode") === "reset") {
        await requestPasswordReset(String(form.get("username") || ""));
        setAuthNotice("Parola sıfırlama bağlantısı kayıtlı e-posta adresine gönderildi. Gelen kutunuzu ve spam klasörünü kontrol edin.");
      } else {
        await signInWithPassword(String(form.get("username") || ""), String(form.get("password") || ""));
      }
    } catch (error) {
      console.error("E-posta/şifre işlemi başarısız:", error);
      setErrorMessage(error.code === "auth/invalid-credential" || error.code === "auth/wrong-password"
        ? "Kullanıcı adı veya şifre doğru değil. Şifreyi yenilemek için “Şifremi unuttum” seçeneğini kullanın."
        : error.code === "auth/user-not-found"
          ? "Bu hesap bulunamadı. Önce hesap oluşturun veya kullanıcı adını kontrol edin."
          : error.code === "auth/too-many-requests"
            ? "Çok sayıda başarısız deneme yapıldı. Bir süre bekleyip tekrar deneyin veya şifrenizi sıfırlayın."
            : error.message || "Giriş işlemi tamamlanamadı.");
    } finally { setAuthBusy(false); }
  }
  async function updateAdminPassword(password) {
    setErrorMessage("");
    setAuthBusy(true);
    try {
      await changeInitialPassword(password);
      setUser((current) => current ? { ...current, mustChangePassword: false } : current);
      setToast("Yeni yönetici parolanız kaydedildi.");
    } catch (error) {
      console.error("Yönetici parolası güncellenemedi:", error);
      setErrorMessage(error.message || "Parola güncellenemedi.");
    } finally { setAuthBusy(false); }
  }
  const downloadStockExcel = () => {
    const parts = data.parts.filter((part) => part.archived !== true).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "tr"));
    if (!parts.length) { setToast("İndirilecek stok kaydı yok."); return; }
    const rows = parts.map((part) => ({
      SKU: part.sku,
      "Parça Adı": part.name,
      Kategori: part.category,
      Marka: part.brand,
      "Mevcut Stok": Number(part.stock || 0),
      "Minimum": Number(part.minimum || 0),
      "Alış Fiyatı (KDV hariç)": Number(part.cost || 0),
      "Satış Fiyatı (KDV hariç)": Number(part.price || 0),
      "Stok Değeri (alış)": Math.round(Number(part.stock || 0) * Number(part.cost || 0) * 100) / 100,
      Durum: Number(part.stock || 0) <= Number(part.minimum || 0) ? "Kritik" : "Yeterli",
    }));
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = [{ wch: 18 }, { wch: 40 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(workbook, sheet, "Mevcut Stok");
    XLSX.writeFile(workbook, `demir-mevcut-stok-${new Date().toISOString().slice(0, 10)}.xlsx`);
    setToast(`${rows.length} parçalık mevcut stok Excel olarak indirildi.`);
  };
  const logout = async () => {
    try { await signOutUser(); setPage("dashboard"); }
    catch (error) { console.error("Oturum kapatılamadı:", error); setErrorMessage(error.message || "Oturum kapatılamadı."); }
  };
  if (!authReady) return h(LoadingScreen, { message: "Güvenli oturum doğrulanıyor..." });
  if (!user) return h(Login, { onSubmit: authenticate, busy: authBusy, error: errorMessage, notice: authNotice, theme, toggleTheme, configured: firebaseConfigured });
  if (user.mustChangePassword) return h(PasswordChange, { onSubmit: updateAdminPassword, busy: authBusy, error: errorMessage, theme, toggleTheme });
  if (dataLoading && !data.parts.length && !data.jobs.length && !data.invoices.length) return h(LoadingScreen, { message: "Bulut servis kayıtları yükleniyor..." });
  return h("div", { className: "app-shell" },
    !firebaseConfigured ? h("div", { className: "panel", style: { borderColor: "rgba(255,107,107,0.3)" } },
      h("div", { className: "panel-heading" }, h("strong", null, "Firebase yapılandırılmamış"), h("span", null, "Bulut bağlantısı kapalı")),
      h("div", { style: { padding: "16px 24px", fontSize: "13px", lineHeight: "1.6" } },
        h("p", null, "Personel, müşteri, randevu ve diğer kayıtları oluşturmak için bir Firebase projesi gereklidir.")),
      h("div", { style: { padding: "0 24px 20px", fontSize: "12px", color: "var(--text-muted)" } },
        h("p", { style: { margin: "0 0 10px" } }, "Yapılması gerekenler:"),
        h("ul", { style: { margin: "0 0 12px", paddingLeft: "18px" } },
          h("li", null, "Firebase Console'da bir proje oluşturun (Firestore etkinleştirin)."),
          h("li", null, "Proje Ayarları → Genel → Uygulamalar → Web yapılandırmasını kopyalayın."),
          h("li", null, "Proje kökünde .env.local dosyası oluşturun ve VITE_FIREBASE_* değerlerini yapıştırın."),
          h("li", null, "Sayfayı yenileyin."))),
      h("div", { style: { padding: "0 24px 16px", fontSize: "11px", color: "var(--text-muted)" } },
        h("code", null, "VITE_FIREBASE_API_KEY=...\nVITE_FIREBASE_AUTH_DOMAIN=...\nVITE_FIREBASE_PROJECT_ID=...\nVITE_FIREBASE_STORAGE_BUCKET=...\nVITE_FIREBASE_MESSAGING_SENDER_ID=...\nVITE_FIREBASE_APP_ID=...")))
    : null,
    h("aside", { className: "sidebar" },
      h("div", { className: "brand" }, h("div", { className: "brand-mark" }, business.initial), h("div", null, h("strong", null, business.brandWord), h("span", null, business.tagline))),
      h("div", { className: "side-label" }, "ÇALIŞMA ALANI"),
      h("nav", { className: "navigation" }, nav.map((item) => h("button", { key: item.id, className: `nav-item ${page === item.id ? "active" : ""}`, onClick: () => item.external ? window.open(item.url, "_blank") : (setPage(item.id), setQuery("")) }, h(Icon, { name: item.icon }), h("span", null, item.label), item.badge ? h("span", { className: "nav-badge" }, item.badge) : null))),
      h("div", { className: "sidebar-bottom" }, h("div", { className: "sidebar-help" }, h("div", { className: "help-icon" }, h(Icon, { name: "wrench", size: 17 })), h("strong", null, "Servis yönetimi"), h("span", null, "Tüm operasyonlarınız tek yerde.")), h("div", { className: "profile" }, h("div", { className: "avatar" }, (user.displayName || user.email || "ST").split(/\s+/).map((name) => name[0]).join("").slice(0, 2)), h("div", { className: "profile-info" }, h("strong", null, user.displayName || "Yetkili kullanıcı"), h("span", null, user.email)), h("button", { className: "icon-button logout", onClick: logout, title: "Oturumu kapat" }, h(Icon, { name: "logout", size: 17 })))),
    ),
    h("main", { className: "main-area" },
      h("div", { className: "car-animation" },
        h("svg", { viewBox: "0 0 200 100" },
          h("path", { d: "M20 70h160l10-25-10-25H30l-10 25z", stroke: "var(--accent)", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" }),
          h("path", { d: "M20 70v10h20v-10" }),
          h("path", { d: "M170 70v10h20v-10" }),
          h("path", { d: "M10 60h180" }),
          h("circle", { cx: 40, cy: 75, r: 9, className: "car-wheel", stroke: "var(--accent)", strokeWidth: 2.5 }),
          h("circle", { cx: 160, cy: 75, r: 9, className: "car-wheel", stroke: "var(--accent)", strokeWidth: 2.5 }),
          h("path", { d: "M60 50h60v20H60z", stroke: "var(--accent)", strokeWidth: 2, strokeLinecap: "round", fill: "none" }),
          h("path", { d: "M80 50l-5 15" }),
          h("path", { d: "M100 50l5 15" })
        )
      ),
      h("header", { className: "topbar" }, h("div", { className: "breadcrumbs" }, business.shortName, h("span", null, "/"), titles[page][0]), h("div", { className: "topbar-right" }, h("button", { className: "icon-button", onClick: () => setGlobalSearchOpen(true), title: "Global ara (Ctrl+K)" }, h(Icon, { name: "search" })), h(LiveClock, { compact: true }), h(AccentPicker, { accent, setAccent }), h("button", { className: "icon-button theme-toggle", onClick: toggleTheme, title: theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç", "aria-label": theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç" }, h(Icon, { name: theme === "dark" ? "sun" : "moon" })), h("button", { className: `icon-button notification ${lowStock.length ? "notification-alert" : ""}`, onClick: () => { if (lowStock.length) openCriticalInventory(); else { setQuery(""); setPage("inventory"); } setToast(`${lowStock.length} parçada kritik stok uyarısı var.`); }, title: "Stok uyarıları" }, h(Icon, { name: "bell" }), lowStock.length ? h("i", null) : null), h("button", { className: "button button-quiet topbar-download", onClick: downloadStockExcel, title: "Mevcut stoğu Excel olarak indir" }, h(Icon, { name: "box", size: 14 }), "Stok Excel"), h("div", { className: "top-avatar" }, "ST"), h("button", { className: "icon-button logout", onClick: logout, title: "Oturumu kapat", "aria-label": "Oturumu kapat" }, h(Icon, { name: "logout" })))),
      h("section", { className: "page-content", key: page },
        h("div", { className: "page-heading" }, h("div", null, h("p", { className: "eyebrow" }, business.fullName.toLocaleUpperCase("tr")), h("h1", null, titles[page][0]), h("p", { className: "page-subtitle" }, titles[page][1])), h("div", { className: "heading-actions" },
          page === "dashboard" ? h("button", { className: "button button-primary", onClick: () => openModal("job"), disabled: saving }, h(Icon, { name: "plus", size: 16 }), "Yeni iş emri") :
          page === "inventory" ? h("button", { className: "button button-primary", onClick: () => openModal("part"), disabled: saving }, h(Icon, { name: "plus", size: 16 }), "Parça ekle") :
          page === "workorders" ? h("button", { className: "button button-primary", onClick: () => openModal("job"), disabled: saving }, h(Icon, { name: "plus", size: 16 }), "İş emri oluştur") :
          page === "invoices" ? h("button", { className: "button button-primary", onClick: () => openModal("invoice"), disabled: saving }, h(Icon, { name: "plus", size: 16 }), "Fatura ekle") :
          page === "orders" ? h("button", { className: "button button-primary", onClick: createDraft, disabled: saving }, h(Icon, { name: "plus", size: 16 }), "Sipariş taslağı oluştur") :
          page === "compatibility" ? h("button", { className: "button button-primary", onClick: () => openModal("fitment"), disabled: saving }, h(Icon, { name: "plus", size: 16 }), "Uyumluluk ekle") :
          page === "returns" ? h("button", { className: "button button-primary", onClick: () => openModal("return"), disabled: saving }, h(Icon, { name: "plus", size: 16 }), "İade parça ekle") : null)),
        page === "dashboard" ? h(Dashboard, {
          data,
          lowStock,
          revenue,
          setPage,
          openModal,
          createDraft,
          openCriticalInventory,
          openWorkOrder,
          openWorkOrderList,
          onOpenVehicle: openVehicleHistory,
          onOpenOpenJobs: openOpenWorkOrders,
          onOpenTotalCiro: () => setPage("reports"),
          onOpenInventory: () => { setQuery(""); setInventoryFilterIntent("all"); setPage("inventory"); },
          onOpenLowStockPart: (part) => { setQuery(part.sku || part.name); setInventoryFilterIntent("all"); setPage("inventory"); },
          onOpenTopPart: (part) => { setQuery(part.sku || part.name); setInventoryFilterIntent("all"); setPage("inventory"); },
          onOpenInvoice: () => setPage("invoices"),
          onOpenMovement: () => setPage("movements"),
        }) :
        page === "inventory" ? h(Inventory, { parts: data.parts, query, setQuery, openModal, removePart, saving, filterIntent: inventoryFilterIntent, clearFilterIntent: () => setInventoryFilterIntent(null), toggleFavorite, adjustPartStock }) :
        page === "workorders" ? h(WorkOrders, { jobs: data.jobs, query, setQuery, openModal, markJobComplete, cancelJob, saving, selectionIntent: workOrderSelectionIntent, clearSelectionIntent: () => setWorkOrderSelectionIntent(null), statusFilterIntent: workOrderStatusFilterIntent, clearStatusFilterIntent: () => setWorkOrderStatusFilterIntent(null) }) :
        page === "vehicles" ? h(VehicleHistory, { jobs: data.jobs, queryIntent: vehicleQueryIntent, clearQueryIntent: () => setVehicleQueryIntent(null) }) :
        page === "compatibility" ? h(PartCompatibility, { jobs: data.jobs, fitments: data.fitments || [], openModal, removeFitment, saving }) :
        page === "movements" ? h(StockMovements, { movements: data.movements }) :
        page === "invoices" ? h(Invoices, { invoices: data.invoices, openModal, removeInvoice, saving }) :
        page === "orders" ? h(Orders, { drafts: data.drafts, lowStock, receiveDraft, createDraft }) :
        page === "stockcompare" ? h(StockCompare, { parts: data.parts, openModal }) :
        page === "edmsimport" ? h(EdmsImport, { jobs: data.jobs, parts: data.parts, invoices: data.invoices, bankoSales: data.bankoSales, saving, onImport: persistEdmsImport, onImportFaturaRaporu: persistFaturaRaporuImport, onCleanupManualJobs: persistManualJobCleanup, onCleanupStaleOpenJobs: persistStaleOpenJobCleanup, onCreateMissingOctoberJobs: persistMissingOctoberJobs, onUndoPlannedEdmsRestoration: persistUndoPlannedEdmsRestoration, onFixInvoiceGaps: persistInvoiceGapFixes, onFixKdvDoubling: persistKdvDoublingFix }) :
        page === "returns" ? h(ReturnsPage, { returns: data.returns, openModal, saving }) :
        page === "chat" ? h(ChatPage, { messages: chatMessages, user, sendMessage: async (text) => { await sendChatMessage(user.email, user.displayName, text); }, saving, configured: firebaseConfigured }) :
        page === "servicebox" ? h(ServiceBoxPage) :
        page === "access" && isOwner ? h(AccessManagement, {
          onError: (error) => setErrorMessage(error.message || "Kullanıcı erişimi güncellenemedi."),
          onSuccess: (message) => setToast(message),
        }) :
        page === "settings" && isOwner ? h(BusinessSettingsPage, {
          onError: (error) => setErrorMessage(error.message || "İşletme ayarları kaydedilemedi."),
          onSuccess: (message) => setToast(message),
        }) :
        page === "customers" ? h(CustomersPage, { customers: data.customers, openModal, saving }) :
        page === "personnel" ? h(PersonnelPage, { personnel: data.personnel, jobs: data.jobs, openModal, saving }) :
        page === "appointments" ? h(AppointmentsPage, { appointments: data.appointments, customers: data.customers, personnel: data.personnel, jobs: data.jobs, openModal, saving }) :
        page === "notifications" ? h(NotificationsPage, { notifications: data.notifications, openModal, saving }) :
        page === "backup" ? h(BackupPage, { data }) :
        h(Reports, { data, revenue, bankoRevenue })
      )
    ),
    globalSearchOpen ? h("div", { className: "global-search-overlay", onClick: () => setGlobalSearchOpen(false) },
      h("div", { className: "global-search-modal", onClick: (e) => e.stopPropagation() },
        h("div", { className: "global-search-header" },
          h(Icon, { name: "search", size: 20 }),
          h("input", {
            type: "text",
            placeholder: "Parça, plaka veya müşteri ara...",
            value: globalSearchQuery,
            onChange: (e) => setGlobalSearchQuery(e.target.value),
            autoFocus: true,
            onKeyDown: (e) => { if (e.key === "Escape") setGlobalSearchOpen(false); }
          }),
          h("kbd", null, "ESC")
        ),
        globalSearchResults.length ? h("div", { className: "global-search-results" },
          globalSearchResults.map((result, index) =>
            h("button", {
              key: index,
              className: "global-search-result",
              onClick: () => {
                if (result.type === "part") {
                  setQuery(result.item.sku);
                  setPage("inventory");
                } else if (result.type === "job") {
                  openWorkOrder(result.item.id);
                }
                setGlobalSearchOpen(false);
                setGlobalSearchQuery("");
              }
            },
              h("span", { className: "global-search-icon" }, h(Icon, { name: result.type === "part" ? "box" : "wrench", size: 16 })),
              h("div", { className: "global-search-content" },
                h("strong", null, result.label),
                h("small", null, result.sublabel)
              )
            )
          )
        ) : globalSearchQuery ? h("div", { className: "global-search-empty" }, "Sonuç bulunamadı") : h("div", { className: "global-search-hint" }, "Ctrl+K ile hızlı arama")
      )
    ) : null,
    modal ? h(Modal, { modal, parts: data.parts, customers: data.customers, personnel: data.personnel, onClose: () => setModal(null), onSavePart: persistPart, onSaveJob: persistJob, onSaveInvoice: persistInvoice, onSaveFitment: persistFitment, onSaveCustomer: persistCustomer, onSavePersonnel: persistPersonnel, onSaveAppointment: persistAppointment, onSaveNotification: persistNotification, onSaveReturnItem: persistReturnItem, saving }) : null,
    errorMessage ? h("div", { className: "toast toast-error", role: "alert" }, h("span", { className: "toast-check" }, "!"), errorMessage) : toast ? h("div", { className: "toast" }, h("span", { className: "toast-check" }, "✓"), toast, toastAction ? h("button", { className: "toast-action", onClick: () => toastAction.run().catch((error) => { console.error("Geri alma başarısız:", error); setErrorMessage(error.message || "Geri alma tamamlanamadı."); }) }, toastAction.label) : null) : null,
    h(AIAssistant, { personnel: data.personnel, customers: data.customers, appointments: data.appointments, parts: data.parts, jobs: data.jobs })
  );
}

function LoadingScreen({ message }) {
  return h("main", { className: "login-screen" }, h("section", { className: "login-card loading-card" }, h("div", { className: "loading-spinner" }), h("p", null, message)));
}
function ThemeToggle({ theme, toggleTheme, className = "" }) {
  const isDark = theme === "dark";
  return h("button", { className: `icon-button theme-toggle ${className}`, onClick: toggleTheme, type: "button", title: isDark ? "Açık temaya geç" : "Koyu temaya geç", "aria-label": isDark ? "Açık temaya geç" : "Koyu temaya geç" }, h(Icon, { name: isDark ? "sun" : "moon" }));
}
function Login({ onSubmit, busy, error, notice, theme, toggleTheme, configured }) {
  const business = useBusiness();
  const [mode, setMode] = useState("login");
  const registering = mode === "register";
  const resetting = mode === "reset";
  return h("main", { className: "login-screen login-story-screen" }, h(GearScene, { variant: "login" }), h("div", { className: "login-decoration decoration-one" }), h("div", { className: "login-decoration decoration-two" }), h(ThemeToggle, { theme, toggleTheme, className: "standalone-theme-toggle" }), h("section", { className: "login-card" },
    h("div", { className: "login-brand" }, h("div", { className: "brand-mark large" }, business.initial), h("div", null, h("strong", null, business.brandWord), h("span", null, business.tagline))),
    h("div", { className: "login-copy" }, h("div", { className: "login-chip" }, h("span", { className: "status-dot" }), `${business.brandWord} SERVICE YÖNETİMİ`), h("h1", null, registering ? "Hesap oluşturun." : resetting ? "Şifrenizi yenileyin." : "Güvenli giriş"), h("p", null, registering ? "E-posta doğrulamasından sonra servis yöneticiniz erişim izni verebilir." : resetting ? "Kullanıcı adınızı veya hesabınızın e-posta adresini yazın." : "Yalnızca servis yöneticisinin yetkilendirdiği hesaplar giriş yapabilir.")),
    h("form", { className: "login-form", onSubmit },
      h("input", { type: "hidden", name: "mode", value: mode }),
      registering
        ? h("label", null, "E-posta adresi", h("input", { name: "email", type: "email", placeholder: "adiniz@gmail.com", required: true, autoComplete: "email" }))
        : h("label", null, "Kullanıcı adı veya e-posta", h("input", { name: "username", type: "text", placeholder: "serkan.tektas", required: true, autoComplete: "username" })),
      !resetting ? h("label", null, "Şifre", h("input", { name: "password", type: "password", placeholder: registering ? "En az 6 karakter" : "Şifreniz", minLength: 6, required: true, autoComplete: registering ? "new-password" : "current-password" })) : null,
      error ? h("p", { className: "form-error", role: "alert" }, error) : null,
      notice ? h("p", { className: "form-notice", role: "status" }, notice) : null,
      h("button", { className: "button button-primary login-submit", type: "submit", disabled: busy }, busy ? "İşleniyor..." : registering ? "Hesap oluştur" : resetting ? "Sıfırlama bağlantısı gönder" : "Giriş yap", h(Icon, { name: "arrow", size: 17 })),
      resetting ? null : h("button", { className: "auth-mode-button", type: "button", disabled: busy, onClick: () => setMode(registering ? "login" : "register") }, registering ? "Zaten hesabınız var mı? Giriş yapın" : "İlk kez mi kullanıyorsunuz? Hesap oluşturun"),
      !registering && !resetting ? h("button", { className: "auth-mode-button", type: "button", disabled: busy, onClick: () => { setMode("reset"); } }, "Şifremi unuttum") : null,
      resetting ? h("button", { className: "auth-mode-button", type: "button", disabled: busy, onClick: () => setMode("login") }, "Giriş ekranına dön") : null
    ),
    h("div", { className: "login-foot" }, h("span", null, "E-posta doğrulama · yönetici onayı"), h("span", null, business.shortName))
  ), h(LoginStory, null));
}
function PasswordChange({ onSubmit, busy, error, theme, toggleTheme }) {
  const business = useBusiness();
  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (password.length < 6) return;
    if (password !== form.get("confirmPassword")) {
      event.currentTarget.elements.confirmPassword.setCustomValidity("Şifreler eşleşmiyor.");
      event.currentTarget.reportValidity();
      return;
    }
    onSubmit(password);
  }
  return h("main", { className: "login-screen" },
    h(ThemeToggle, { theme, toggleTheme, className: "standalone-theme-toggle" }),
    h("section", { className: "login-card" },
      h("div", { className: "login-brand" }, h("div", { className: "brand-mark large" }, business.initial), h("div", null, h("strong", null, business.brandWord), h("span", null, business.tagline))),
      h("div", { className: "login-copy" }, h("div", { className: "login-chip" }, h("span", { className: "status-dot" }), "YÖNETİCİ GÜVENLİĞİ"), h("h1", null, "Yeni şifre belirleyin."), h("p", null, "İlk girişte geçici şifreyi değiştirmeniz gerekir.")),
      h("form", { className: "login-form", onSubmit: submit },
        h("label", null, "Yeni şifre (en az 6 karakter)", h("input", { name: "password", type: "password", minLength: 6, required: true, autoComplete: "new-password" })),
        h("label", null, "Yeni şifreyi tekrar girin", h("input", { name: "confirmPassword", type: "password", minLength: 6, required: true, autoComplete: "new-password", onChange: (event) => event.currentTarget.setCustomValidity("") })),
        error ? h("p", { className: "form-error", role: "alert" }, error) : null,
        h("button", { className: "button button-primary login-submit", type: "submit", disabled: busy }, busy ? "Kaydediliyor..." : "Şifreyi değiştir", h(Icon, { name: "arrow", size: 17 }))
      )
    )
  );
}
function BusinessSettingsPage({ onError, onSuccess }) {
  const business = useBusiness();
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState(business.fullName);
  const [shortName, setShortName] = useState(business.shortName);
  const [tagline, setTagline] = useState(business.tagline);
  useEffect(() => { setFullName(business.fullName); setShortName(business.shortName); setTagline(business.tagline); }, [business.fullName, business.shortName, business.tagline]);
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await saveBusinessSettings({ fullName, shortName, tagline });
      onSuccess?.("İşletme ayarları kaydedildi. Değişiklik tüm ekranlara anında yansır.");
    } catch (error) { onError?.(error); }
    finally { setSaving(false); }
  };
  return h("section", { className: "panel settings-panel" },
    h("p", { className: "settings-intro" }, "Bu bilgiler giriş ekranında, menüde ve raporlarda görünür. Sistemi başka bir işletmeye devrederken yalnızca burayı güncellemeniz yeterlidir."),
    h("form", { className: "settings-form", onSubmit: submit },
      h("label", null, "İşletme adı (tam)", h("input", { value: fullName, onChange: (event) => setFullName(event.target.value), placeholder: "Demir Eurorepar Car Service", required: true })),
      h("label", null, "Kısa ad", h("input", { value: shortName, onChange: (event) => setShortName(event.target.value), placeholder: "Demir Service" })),
      h("label", null, "Slogan / etiket", h("input", { value: tagline, onChange: (event) => setTagline(event.target.value), placeholder: "EUROREPAR CAR SERVICE" })),
      h("div", { className: "settings-preview" },
        h("span", { className: "settings-preview-mark" }, (fullName.trim()[0] || "D").toLocaleUpperCase("tr")),
        h("div", null, h("strong", null, (fullName.split(" ")[0] || "DEMİR").toLocaleUpperCase("tr")), h("span", null, tagline || business.tagline))),
      h("button", { className: "button button-primary", type: "submit", disabled: saving }, saving ? "Kaydediliyor..." : "Kaydet"))
  );
}
function AccessManagement({ onError, onSuccess }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    listAuthorizedUsers().then((records) => {
      if (active) setUsers(records);
    }).catch((error) => {
      if (active) onError(error);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);
  async function grant(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get("email") || "");
    setBusy(true);
    try {
      await grantUserAccess(email);
      setUsers(await listAuthorizedUsers());
      formElement.reset();
      onSuccess(`${email.trim().toLowerCase()} hesabına erişim verildi.`);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(email) {
    if (!window.confirm(`${email} hesabının servis erişimini kaldırmak istiyor musunuz?`)) return;
    setBusy(true);
    try {
      await revokeUserAccess(email);
      setUsers(await listAuthorizedUsers());
      onSuccess(`${email} hesabının erişimi kaldırıldı.`);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return h(React.Fragment, null,
    h("section", { className: "panel access-panel" },
      h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "Kullanıcıya erişim ver"), h("p", null, "E-posta adresine erişim verin; kullanıcı e-postasını doğrulayıp parola hesabı oluşturarak ortak servise katılabilir."))),
      h("form", { className: "access-form", onSubmit: grant },
        h("label", null, "Yetki verilecek Gmail adresi", h("input", { name: "email", type: "email", placeholder: "calisan@gmail.com", required: true })),
        h("button", { className: "button button-primary", type: "submit", disabled: busy }, "Erişim ver")
      )
    ),
    h("section", { className: "panel access-panel" },
      h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "Yetkili hesaplar"), h("p", null, "Yalnızca servis yöneticisi bu listeyi değiştirebilir."))),
      loading ? h("p", { className: "empty-state" }, "Yetkiler yükleniyor...") :
        h("div", { className: "access-user-list" },
          h("div", { className: "access-user-row" }, h("div", null, h("strong", null, OWNER_EMAIL), h("span", null, "Servis yöneticisi")), h("span", { className: "access-badge" }, "Sahip")),
          users.map((entry) => h("div", { className: "access-user-row", key: entry.id }, h("div", null, h("strong", null, entry.email), h("span", null, "E-posta/şifre ile giriş yetkisi")), h("button", { className: "button button-quiet", type: "button", disabled: busy, onClick: () => revoke(entry.email) }, "Erişimi kaldır")))
        )
    )
  );
}
function AIAssistant({ personnel, customers, appointments, parts, jobs }) {
  const business = useBusiness();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    { id: "1", sender: "ai", text: `Merhaba! Ben ${business.shortName} AI asistanınız. Personel, müşteri, randevu, parça stoku veya iş emirleri hakkında sorularınıza yardımcı olabilirim. Nasıl yardımcı olabilirim?` }
  ]);
  const [typing, setTyping] = useState(false);
  const messagesEndRef = React.useRef(null);

  function money(v) {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(Number(v || 0));
  }

  function answer(question) {
    const q = question.toLocaleLowerCase("tr");
    const pCount = personnel.length;
    const cCount = customers.length;
    const aCount = appointments.length;
    const partCount = parts.length;
    const jobCount = jobs.length;
    const activeJobs = jobs.filter((j) => (j.status || "").toLocaleLowerCase("tr") !== "tamamlandı" && (j.status || "").toLocaleLowerCase("tr") !== "iptal").length;
    const totalRevenue = jobs.reduce((s, j) => s + Number(j.total || 0), 0);
    const lowStock = parts.filter((p) => Number(p.stock || 0) <= Number(p.minimum || 0)).length;
    const completedJobs = jobs.filter((j) => (j.status || "").toLocaleLowerCase("tr") === "tamamlandı").length;
    const cancelledJobs = jobs.filter((j) => (j.status || "").toLocaleLowerCase("tr") === "iptal").length;
    const pendingAppts = appointments.filter((a) => a.status === "pending").length;
    const activePersonnel = personnel.filter((p) => p.active !== false).length;
    const completedRevenue = jobs.filter((j) => (j.status || "").toLocaleLowerCase("tr") === "tamamlandı").reduce((s, j) => s + Number(j.total || 0), 0);

    const summary = `Sistem özetiniz: ${pCount} personel (${activePersonnel} aktif), ${cCount} müşteri, ${aCount} randevu (${pendingAppts} beklemede), ${partCount} parça (${lowStock} kritik), ${jobCount} iş emri (${activeJobs} açık, ${completedJobs} tamamlandı, ${cancelledJobs} iptal), toplam ciro ${money(totalRevenue)} (tamamlananlardan ${money(completedRevenue)}).`;

    if (q.includes("merhaba") || q.includes("selam") || q.includes("nasılsın") || q.includes("günaydın") || q.includes("iyi akşamlar") || q.includes("selamın aleyküm")) {
      return `Merhaba! Ben ${business.shortName} AI asistanınız. ${summary} Size nasıl yardımcı olabilirim?`;
    }
    if (q.includes("yardım") || q.includes("ne yapabilir") || q.includes("nasıl kullanılır") || q.includes("özellikler") || q.includes("komutlar")) {
      return `Şunlar hakkında soru sorabilirsiniz:\n\n• PERSONEL: kayıt, maaş, komisyon, performans, aktif/pasif durum\n• MÜŞTERİ: kayıt, araç, plaka, iletişim, en aktif müşteri\n• RANDEVU: planlama, durum, bekleyenler, müşteri eşleştirme\n• PARÇA/STOK: envanter, stok seviyesi, minimum stok, kritik uyarı, SKU, fiyat\n• FATURA: alış faturaları, stok girişi, tedarikçi\n• İŞ EMRİ: servis işlemleri, ciro, durum takibi, araç geçmişi\n• GENEL: sistem özeti, raporlar, yedekleme, araç servis geçmişi\n\n${summary}`;
    }
    if (q.includes("özet") || q.includes("durum") || q.includes("rapor") || q.includes("genel") || q.includes("sistem") || q.includes("tüm") || q.includes("hepsi") || q.includes("kapasite") || q.includes("bölge")) {
      return `${summary}\n\nDetaylı bilgi için belirli bir konu hakkında soru sorabilirsiniz: personel, müşteri, randevu, parça/stok, fatura, iş emri veya araç servis geçmişi.`;
    }
    if (q.includes("personel") || q.includes("çalışan") || q.includes("eleman") || q.includes("memur") || q.includes("teknisyen") || q.includes("işçi")) {
      if (q.includes("maaş") || q.includes("komisyon") || q.includes("gelir")) {
        const top = [...personnel].sort((a, b) => Number(b.commissionRate || 0) - Number(a.commissionRate || 0))[0];
        return `${summary}\n\nPERSONEL DETAYI:\n${personnel.map((p) => `- ${p.name} · ${p.role} · Komisyon: %${Number(p.commissionRate || 0)} · Maaş: ${money(Number(p.baseSalary || 0))} · ${p.active !== false ? "Aktif" : "Pasif"}`).join("\n")}\n\nEn yüksek komisyon: ${top?.name || "yok"} (%${top?.commissionRate || 0}).`;
      }
      const perf = getPersonnelPerformance(jobs, personnel);
      return `${summary}\n\nPERSONEL DETAYI:\n${personnel.map((p) => { const perfItem = perf.find((x) => x.id === p.id) || {}; return `- ${p.name} · ${p.role} · ${perfItem.jobs || 0} iş · ${money(perfItem.revenue || 0)} ciro · ${money(perfItem.commission || 0)} komisyon · ${p.active !== false ? "Aktif" : "Pasif"}`; }).join("\n")}`;
    }
    if (q.includes("müşteri") || q.includes("arac") || q.includes("plaka") || q.includes("araba") || q.includes("otomobil") || q.includes("araç")) {
      const custDetail = customers.map((c) => { const cJobs = jobs.filter((j) => j.customerId === c.id); return `- ${c.name} · Telefon: ${c.phone || "yok"} · Şehir: ${c.city || "belirtilmemiş"} · ${cJobs.length} iş emri · ${cJobs.reduce((s, j) => s + Number(j.total || 0), 0) > 0 ? money(cJobs.reduce((s, j) => s + Number(j.total || 0), 0)) : "0 TL"} ciro`; }).join("\n");
      const topCustomer = [...customers].sort((a, b) => { const aJobs = jobs.filter((j) => j.customerId === a.id).length; const bJobs = jobs.filter((j) => j.customerId === b.id).length; return bJobs - aJobs; })[0];
      return `${summary}\n\nMÜŞTERİ DETAYI (${cCount} kayıt):\n${custDetail}\n\nEn aktif müşteri: ${topCustomer?.name || "yok"} (${jobs.filter((j) => j.customerId === topCustomer?.id).length} iş emri).`;
    }
    if (q.includes("randevu") || q.includes("takvim") || q.includes("planla") || q.includes("görüşme") || q.includes("randevular")) {
      const apptDetail = appointments.map((a) => { const cust = customers.find((c) => c.id === a.customerId); const pers = personnel.find((p) => p.id === a.personnelId); return `- ${a.date || "tarih yok"} ${a.time || ""} · ${cust?.name || "Müşteri yok"} · ${a.vehiclePlate || "Plaka yok"} · ${a.status || "durum yok"} · ${pers?.name || "Personel atanmamış"}`; }).join("\n");
      return `${summary}\n\nRANDEVU DETAYI (${aCount} kayıt, ${pendingAppts} beklemede):\n${apptDetail}`;
    }
    if (q.includes("parça") || q.includes("stok") || q.includes("envanter") || q.includes("malzeme") || q.includes("yedek parça") || q.includes("sku")) {
      const partDetail = parts.map((p) => { const low = Number(p.stock || 0) <= Number(p.minimum || 0); return `- ${p.name} · ${p.sku || "SKU yok"} · ${p.category || "Genel"} · ${p.brand || "Marka yok"} · Stok: ${p.stock} / Min: ${p.minimum} ${low ? "⚠ KRİTİK" : ""} · Alış: ${money(p.cost)} · Satış: ${money(p.price)}`; }).join("\n");
      const topPart = [...parts].sort((a, b) => Number(b.stock || 0) - Number(a.stock || 0))[0];
      return `${summary}\n\nPARÇA/STOK DETAYI (${partCount} kayıt, ${lowStock} kritik):\n${partDetail}\n\nEn yüksek stok: ${topPart?.name || "yok"} (${Number(topPart?.stock || 0)} adet).`;
    }
    if (q.includes("fatura") || q.includes("alış") || q.includes("satış") || q.includes("tedarikçi") || q.includes("ödeme") || q.includes("faturalar")) {
      return `${summary}\n\nFATURA DETAYI: Alış faturalarını "Alış Faturaları" sekmesinden kaydedebilir, stok girişlerini anında işleyebilirsiniz. Yeni fatura eklemek için "Fatura ekle" butonunu kullanın. Fatura kayıtlarıyla birlikte stok hareketleri de otomatik oluşturulur.`;
    }
    if (q.includes("iş emri") || q.includes("servis") || q.includes("çiro") || q.includes("işlem") || q.includes("arız") || q.includes("bakım") || q.includes("iş emirleri")) {
      const jobDetail = jobs.map((j) => { const cust = customers.find((c) => c.id === j.customerId); return `- ${j.code || j.id} · ${j.plate || "Plaka yok"} · ${cust?.name || "Müşteri yok"} · ${j.make || ""} ${j.model || ""} · ${money(Number(j.total || 0))} · ${j.status || "durum yok"} · ${dateLabel(j.date)}`; }).join("\n");
      return `${summary}\n\nİŞ EMRİ DETAYI (${jobCount} kayıt):\n${jobDetail}\n\nToplam ciro: ${money(totalRevenue)}`;
    }
    if ((q.includes("araç") && (q.includes("geçmiş") || q.includes("servis geçmişi") || q.includes("plakaya göre") || q.includes("ziyaret"))) || q.includes("arac servis")) {
      const vehicleMap = new Map();
      [...jobs].sort((a, b) => (b.date || "").localeCompare(a.date || "")).forEach((job) => { const key = job.plate.trim().toLocaleUpperCase(); const entry = vehicleMap.get(key) || { plate: key, make: job.make, model: job.model, customer: job.customer, jobs: [] }; entry.jobs.push(job); vehicleMap.set(key, entry); });
      const vehicleDetail = [...vehicleMap.entries()].map(([plate, v]) => { const total = v.jobs.reduce((s, j) => s + Number(j.total || 0), 0); return `- ${plate} · ${v.make || ""} ${v.model || ""} · ${v.customer || "Müşteri yok"} · ${v.jobs.length} ziyaret · ${money(total)} toplam · Son: ${dateLabel(v.jobs[0]?.date || "")}`; }).join("\n");
      return `${summary}\n\nARAÇ SERVİS GEÇMİŞİ (${vehicleMap.size} farklı araç):\n${vehicleDetail}`;
    }
    if (q.includes("yedek") || q.includes("excel") || q.includes("dışa aktar") || q.includes("indir")) {
      return `YEDEKLEME: Tüm verilerinizi (parçalar, iş emirleri, faturalar, müşteriler, personel, randevular, bildirimler) Excel veya metin raporu olarak indirebilirsiniz. "Yedekleme" sekmesine gidin ve "Excel'e Aktar" veya "Rapor İndir" butonlarını kullanın.`;
    }
    if (q.includes("bildirim") || q.includes("uyarı") || q.includes("stok düşük") || q.includes("kritik") || q.includes("bildirimler")) {
      const lowParts = parts.filter((p) => Number(p.stock || 0) <= Number(p.minimum || 0));
      const lowDetail = lowParts.map((p) => `- ${p.name} (${p.stock} / min ${p.minimum})`).join("\n");
      return `BİLDİRİMLER: Düşük stok, randevu ve sistem bildirimlerini "Bildirimler" sekmesinden yönetebilirsiniz. Şu anda ${lowStock} parça kritik stok seviyesinde:\n${lowDetail || "Kritik stokta parça yok."}`;
    }
    if (q.includes("kayıt et") || q.includes("ekle") || q.includes("yeni") || q.includes("oluştur")) {
      return `YENİ KAYIT: İlgili sekmedeki "+" butonunu kullanın: "Personel ekle", "Müşteri ekle", "Parça ekle", "İş emri oluştur", "Fatura ekle", "Randevu ekle". Hangi konuda kayıt yapmak istiyorsanız o sekmeye gidin.`;
    }
    if (q.includes("sil") || q.includes("kaldır") || q.includes("güncelle") || q.includes("düzenle")) {
      return `KAYIT DÜZENLEME: İlgili listedeki kaydın yanındaki "Düzenle" butonuna tıklayarak değişiklik yapabilirsiniz. Silme işlemi için listedeki silme/arşivle seçeneğini kullanın.`;
    }
    if (q.includes("giriş") || q.includes("çıkış") || q.includes("şifre") || q.includes("hesap") || q.includes("kullanıcı") || q.includes("yetki")) {
      return `HESAP YÖNETİMİ: Giriş yapmak için giriş ekranını kullanın. Şifre değiştirmek veya hesap erişimi yönetmek için "Yetkili Kullanıcılar" sekmesine gidin (yalnızca yönetici).`;
    }
    if (q.includes("teşekkür") || q.includes("sağ ol") || q.includes("güle güle") || q.includes("hoşça kal") || q.includes("bye")) {
      return "Rica ederim! Başka bir sorunuz olduğunda buradayım. İyi çalışmalar dilerim.";
    }
    return `${summary}\n\nBu konuda doğrudan bilgi yokum, ama sisteminizdeki temel veriler yukarıdaki özetde yer alıyor. "Personel", "Müşteri", "Randevu", "Parça/Stok", "Fatura", "İş Emri", "Araç Geçmişi", "Yedekleme" veya "Bildirim" hakkında daha spesifik bir soru sorabilirsiniz.`;
  }


  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() || typing) return;
    const userMsg = { id: Date.now().toString(), sender: "user", text: input };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      const reply = answer(input);
      setMessages((m) => [...m, { id: (Date.now() + 1).toString(), sender: "ai", text: reply }]);
      setTyping(false);
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 800);
  }

  return h("div", { className: "ai-assistant" },
    h("button", {
      className: "ai-toggle " + (open ? "ai-open" : ""),
      "aria-label": open ? "Asistanı kapat" : "AI asistanı aç",
      onClick: () => setOpen(!open)
    }, h(Icon, { name: "help", size: 18 }), open ? h("span", null, "Kapat") : h("span", null, "AI")),
    open ? h("div", { className: "ai-panel" },
      h("div", { className: "ai-header" },
        h("div", { className: "ai-avatar" }, "AI"),
        h("div", null, h("strong", null, "AI Asistan"), h("small", null, business.shortName))),
      h("div", { className: "ai-messages" },
        messages.map((msg) => h("div", {
          key: msg.id,
          className: `ai-msg ${msg.sender === "ai" ? "ai-msg-ai" : "ai-msg-user"}`
        }, h("div", { className: "ai-msg-bubble" }, msg.text), typing && msg.sender === "ai" ? h("span", { className: "ai-typing" }, "yazıyor...") : null)),
        typing ? h("div", { className: "ai-msg ai-msg-ai", style: { marginBottom: 8 } }, h("div", { className: "ai-msg-bubble" }, h("span", { className: "ai-typing" }, "Asistan yazıyor..."))) : null,
        h("div", { ref: messagesEndRef })
      ),
      h("form", { className: "ai-form", onSubmit: handleSend },
        h("input", {
          type: "text",
          value: input,
          onChange: (e) => setInput(e.target.value),
          placeholder: "Sorunuzu yazın...",
          disabled: typing
        }),
        h("button", { type: "submit", className: "button button-primary", disabled: !input.trim() || typing }, h(Icon, { name: "arrow", size: 14 })))
    ) : null
  );
}

function Dashboard({ data, lowStock, revenue, setPage, openModal, createDraft, openCriticalInventory, openWorkOrder, openWorkOrderList, onOpenVehicle, onOpenLowStockPart, onOpenTopPart, onOpenOpenJobs, onOpenTotalCiro, onOpenInventory, onOpenMovement, onOpenInvoice }) {
  const business = useBusiness();
  const openJobs = getOpenWorkOrders(data.jobs).length;
  const recentJobs = [...data.jobs].sort((first, second) => (second.updatedAt || second.date || "").localeCompare(first.updatedAt || first.date || "")).slice(0, 5);
  const metrics = [
    { label: "Toplam ciro", value: money(revenue), caption: "Parça + işçilik + banko · KDV dahil", onClick: onOpenTotalCiro || (() => setPage("reports")), title: "Ciro raporlarını görüntüle" },
    { label: "Açık iş emirleri", value: String(openJobs).padStart(2, "0"), caption: "Devam eden işler", onClick: onOpenOpenJobs || openWorkOrderList, title: "Devam eden iş emirlerini listele" },
    { label: "Envanter kalemi", value: String(data.parts.length).padStart(2, "0"), caption: `${data.parts.reduce((sum, part) => sum + Number(part.stock || 0), 0)} toplam adet`, onClick: onOpenInventory || (() => setPage("inventory")), title: "Tüm envanteri görüntüle" },
    { label: "Kritik stok", value: String(lowStock.length).padStart(2, "0"), caption: "Minimum seviyede veya altında", onClick: openCriticalInventory, title: "Kritik stoktaki parçaları filtrele" },
  ];
  return h(React.Fragment, null,
    h(CinematicCar, { variant: "hero" }, h("div", { className: "car-hero-copy" }, h("span", null, business.tagline), h("strong", null, business.shortName.toLocaleUpperCase("tr")))),
    h(ServiceStatusLead, { openJobs, lowStock: lowStock.length, onOpenJobs: onOpenOpenJobs || openWorkOrderList, onOpenLowStock: openCriticalInventory }),
    h("div", { className: "metric-grid dashboard-metric-grid" }, metrics.map((metric) =>
      h("article", {
        className: "metric-card metric-card-interactive",
        key: metric.label,
        tabIndex: 0,
        role: "button",
        onClick: metric.onClick,
        onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); metric.onClick(); } },
        title: metric.title,
        "aria-label": `${metric.label}: ${metric.value}. ${metric.title}`
      },
        h("span", { className: "metric-top" }, metric.label, h(Icon, { name: "arrow", size: 13, className: "metric-arrow-icon" })),
        h("strong", { className: "metric-value" }, metric.value),
        h("span", { className: "metric-bottom" }, metric.caption)
      )
    )),
    h("div", { className: "dashboard-secondary-actions" },
      h("span", null, "Sık kullanılan işlem"),
      h("button", { className: "text-button", onClick: () => openModal("invoice") }, h(Icon, { name: "receipt", size: 15 }), "Alış faturası ekle", h(Icon, { name: "arrow", size: 14 }))
    ),
    h("div", { className: "dashboard-operations-grid" },
      h("section", { className: "panel recent-panel" },
        h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "Son iş emirleri"), h("p", null, "En son kaydedilen servis işleri")), h("button", { className: "text-button", onClick: openWorkOrderList }, "Tüm iş emirleri", h(Icon, { name: "arrow", size: 15 }))),
        recentJobs.length ? h(DashboardJobTable, { jobs: recentJobs, onOpenJob: openWorkOrder, onEditJob: (job) => openModal("job", job), onOpenVehicle }) : h("div", { className: "empty-state compact-empty" }, "Henüz iş emri bulunmuyor.")
      ),
      h("section", { className: "panel lowstock-panel" },
        h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "Stok uyarıları"), h("p", null, "Minimum seviyede veya altında")), h("button", { className: "text-button", onClick: openCriticalInventory }, "Kritik parçalar", h(Icon, { name: "arrow", size: 15 }))),
        lowStock.length ? h(React.Fragment, null,
          h("div", { className: "alert-list" }, lowStock.slice(0, 5).map((part) =>
            h("div", {
              className: "alert-item alert-item-interactive",
              key: part.id,
              tabIndex: 0,
              role: "button",
              onClick: () => onOpenLowStockPart ? onOpenLowStockPart(part) : openCriticalInventory(),
              onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (onOpenLowStockPart) onOpenLowStockPart(part); else openCriticalInventory(); } },
              title: `${part.name} parçasına git`
            },
              h("span", { className: "part-avatar" }, part.name.slice(0, 1)),
              h("div", { className: "alert-name" }, h("strong", null, part.name), h("span", null, part.sku)),
              h("span", { className: "stock-alert" }, `${part.stock} / ${part.minimum} adet`),
              h(Icon, { name: "arrow", size: 13, className: "row-arrow-icon" })
            )
          )),
          h("button", { className: "button button-small stock-draft-action", onClick: createDraft }, h(Icon, { name: "cart", size: 14 }), "Sipariş taslağı oluştur")
        ) : h("div", { className: "empty-state compact-empty" }, "Kritik stok uyarısı bulunmuyor.")
      )
    ),
    h(DashboardInsights, { data, setPage, openWorkOrder, onOpenTopPart, onOpenMovement, onOpenInvoice })
  );
}

function DashboardJobTable({ jobs, onOpenJob, onEditJob, onOpenVehicle }) {
  return h("div", { className: "table-scroll dashboard-job-table" },
    h("table", null,
      h("thead", null, h("tr", null, ["İŞ EMRİ", "ARAÇ", "MÜŞTERİ", "TUTAR · KDV DAHİL", "DURUM", "İŞLEM"].map((label) => h("th", { key: label }, label)))),
      h("tbody", null, jobs.map((job) => h("tr", {
        key: job.id,
        className: "clickable-row",
        onClick: () => onOpenJob(job.id),
      },
        h("td", null, h("button", { className: "dashboard-job-link", type: "button", onClick: (event) => { event.stopPropagation(); onOpenJob(job.id); }, "aria-label": `${job.code || "İş emri"}, ${job.plate}, ${job.status}. İş emrini aç` },
          h("span", { className: "dashboard-job-desktop" }, h("strong", { className: "job-id" }, job.code || job.id), h("small", { className: "table-date" }, dateLabel(job.date))),
          h("span", { className: "dashboard-job-mobile" }, h("span", { className: "dashboard-mobile-top" }, h("strong", { className: "dashboard-mobile-plate" }, job.plate), h("span", { className: `job-status ${getWorkOrderStatusClass(job.status)}` }, h("i", null), job.status), h("strong", { className: "dashboard-mobile-amount" }, money(vatIncludedAmount(job.total)))), h("small", null, `${job.code || "İş emri"} · ${dateLabel(job.date)} · ${job.customer}`))
        )),
        h("td", null, h("div", {
          className: "vehicle-cell vehicle-cell-interactive",
          role: "button",
          tabIndex: 0,
          onClick: (e) => {
            if (onOpenVehicle) {
              e.stopPropagation();
              onOpenVehicle(job.plate);
            }
          },
          title: `${job.plate} araç geçmişine git`
        }, h("strong", null, job.plate), h("small", null, `${job.make} ${job.model}`))),
        h("td", { className: "muted-cell" }, job.customer),
        h("td", { className: "price-cell" }, money(vatIncludedAmount(job.total))),
        h("td", null, h("span", { className: `job-status ${getWorkOrderStatusClass(job.status)}` }, h("i", null), job.status)),
        h("td", { className: "action-cell", onClick: (e) => e.stopPropagation() },
          h("button", {
            className: "button button-small button-outline",
            type: "button",
            onClick: () => onEditJob(job),
            title: "İş emrini düzenle"
          }, "Düzenle")
        )
      )))
    )
  );
}
function DashboardInsights({ data, setPage, openWorkOrder, onOpenTopPart, onOpenMovement, onOpenInvoice }) {
  const today = new Date();
  const revenueJobs = getRevenueEligibleWorkOrders(data.jobs);
  const topParts = [...computePartSalesFromJobs(data.jobs, data.parts)].sort((first, second) => Number(second.sold || 0) - Number(first.sold || 0)).slice(0, 5);
  const maxPartSales = Math.max(...topParts.map((part) => Number(part.sold || 0)), 1);
  const recentDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (6 - index));
    const key = dateKey(date);
    const amount = vatIncludedAmount(revenueJobs.filter((job) => job.date === key).reduce((sum, job) => sum + Number(job.total || 0), 0));
    return { label: new Intl.DateTimeFormat("tr-TR", { weekday: "short" }).format(date), amount };
  });
  const recentMonths = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - (5 - index), 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const amount = vatIncludedAmount(revenueJobs.filter((job) => job.date?.startsWith(key)).reduce((sum, job) => sum + Number(job.total || 0), 0));
    return { label: new Intl.DateTimeFormat("tr-TR", { month: "short" }).format(date), amount };
  });
  const movementReferences = new Set(data.movements.map((movement) => movement.referenceCode).filter(Boolean));
  const recentItems = [
    ...data.movements.map((movement) => ({ id: movement.id, date: movement.createdAt, title: movement.name, detail: `${movement.type} · ${movement.referenceCode || ""}`, amount: movement.qty, kind: "movement", raw: movement })),
    ...revenueJobs.filter((job) => !movementReferences.has(job.code)).map((job) => ({ id: `job-${job.id}`, jobId: job.id, date: job.updatedAt || `${job.date}T12:00:00`, title: `${job.plate} · ${job.make} ${job.model}`, detail: `İş emri · ${job.customer}`, amount: null, total: job.total, kind: "job" })),
    ...data.invoices.filter((invoice) => !movementReferences.has(invoice.code)).map((invoice) => ({ id: `invoice-${invoice.id}`, invoiceId: invoice.id, date: `${invoice.date}T12:00:00`, title: invoice.supplier, detail: `Alış faturası · ${invoice.code}`, amount: null, total: invoice.total, kind: "invoice" })),
  ].sort((first, second) => (second.date || "").localeCompare(first.date || "")).slice(0, 6);
  return h("div", { className: "dashboard-insights" },
    h("section", { className: "panel parts-performance-panel" },
      h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "En çok işlem gören parçalar"), h("p", null, "İş emirlerindeki adet · tüm dönemler")), h("button", { className: "text-button", onClick: () => setPage("reports") }, "Raporlar", h(Icon, { name: "arrow", size: 14 }))),
      topParts.length ? h("div", { className: "top-parts-list" }, topParts.map((part, index) =>
        h("div", {
          className: "top-part-row top-part-interactive",
          key: part.id,
          tabIndex: 0,
          role: "button",
          onClick: () => onOpenTopPart ? onOpenTopPart(part) : setPage("inventory"),
          onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (onOpenTopPart) onOpenTopPart(part); else setPage("inventory"); } },
          title: `${part.name} envanterde ara`
        },
          h("span", { className: "top-part-rank" }, String(index + 1).padStart(2, "0")),
          h("div", { className: "top-part-data" },
            h("div", { className: "top-part-label" }, h("strong", null, part.name), h("span", null, `${Number(part.sold || 0)} adet`)),
            h("div", { className: "bar-track" }, h("div", { className: "bar-fill", style: { width: `${Math.max(4, Number(part.sold || 0) / maxPartSales * 100)}%` } }))
          )
        )
      )) : h("div", { className: "empty-state compact-empty" }, "Parça kullanımı, iş emirleri kaydedildikçe burada görünür.")
    ),
    h("section", { className: "panel trend-panel", style: { cursor: "pointer" }, onClick: () => setPage("reports"), title: "Ciro raporlarını görüntüle" },
      h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "Ciro akışı"), h("p", null, "Parça ve işçilik toplamı · KDV dahil")), h("span", { className: "report-period" }, "TRY · KDV dahil")),
      h("div", { className: "trend-sections" },
        h(RevenueBars, { title: "Son 7 gün", values: recentDays }),
        h(RevenueBars, { title: "Son 6 ay", values: recentMonths })
      )
    ),
    h("section", { className: "panel activity-panel" },
      h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "Son hareketler"), h("p", null, "Kaynak ve gerçek stok miktarları")), h("button", { className: "text-button", onClick: () => setPage("movements") }, "Stok hareketleri", h(Icon, { name: "arrow", size: 14 }))),
      recentItems.length ? h("div", { className: "activity-list" }, recentItems.map((item) =>
        h("div", {
          className: "activity-item activity-item-interactive",
          key: item.id,
          tabIndex: 0,
          role: "button",
          onClick: () => {
            if (item.kind === "job") {
              const jId = item.jobId || item.id.replace(/^job-/, "");
              openWorkOrder(jId);
            } else if (item.kind === "invoice") {
              if (onOpenInvoice) onOpenInvoice(); else setPage("invoices");
            } else {
              if (onOpenMovement) onOpenMovement(); else setPage("movements");
            }
          },
          title: `${item.title} detayına git`
        },
          h("span", { className: `activity-mark ${item.kind}` }, item.kind === "movement" ? (item.amount > 0 ? "+" : "−") : item.kind === "job" ? "İŞ" : "AL"),
          h("div", null, h("strong", null, item.title), h("small", null, item.detail)),
          h("span", { className: `activity-amount ${item.kind === "movement" ? (item.amount > 0 ? "positive" : "negative") : ""}` }, item.kind === "movement" ? `${item.amount > 0 ? "+" : ""}${item.amount} adet` : money(vatIncludedAmount(item.total))),
          h(Icon, { name: "arrow", size: 13, className: "row-arrow-icon" })
        )
      )) : h("div", { className: "empty-state compact-empty" }, "Henüz işlem kaydı yok.")
    )
  );
}
function RevenueBars({ title, values }) {
  const maximum = Math.max(...values.map((value) => value.amount), 1);
  return h("div", { className: "mini-trend" }, h("strong", null, title), h("div", { className: "mini-bars" }, values.map((value, index) => h("div", { className: "mini-bar-column", key: `${value.label}-${index}`, title: `${value.label}: ${money(value.amount)}` },
    h("span", { className: "mini-bar-value" }, value.amount ? money(value.amount) : "—"),
    h("div", { className: "mini-bar-track" }, h("i", { style: { height: `${Math.max(4, value.amount / maximum * 100)}%` } })),
    h("small", null, value.label)
  ))));
}
function ServiceStatusLead({ openJobs, lowStock, onOpenJobs, onOpenLowStock }) {
  return h("section", { className: "service-lead", "aria-label": "Servis iş durumu" },
    h("button", { className: "service-lead-link", type: "button", onClick: onOpenJobs },
      h("span", { className: "service-lead-label" }, "Açık iş emirleri"),
      h("strong", { className: "service-lead-count" }, String(openJobs).padStart(2, "0")),
      h("span", { className: "service-lead-action" }, "İş emirlerini gör", h(Icon, { name: "arrow", size: 15 }))
    ),
    h("span", { className: "service-lead-divider", "aria-hidden": true }),
    h("button", { className: `service-lead-link ${lowStock ? "has-exceptions" : ""}`, type: "button", onClick: onOpenLowStock },
      h("span", { className: "service-lead-label" }, "Kritik stok"),
      h("strong", { className: "service-lead-count" }, String(lowStock).padStart(2, "0")),
      h("span", { className: "service-lead-action" }, "Kritik parçaları gör", h(Icon, { name: "arrow", size: 15 }))
    )
  );
}
function LiveClock({ compact }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return h("span", { className: compact ? "today-label" : "hero-time" }, now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }), compact ? " · " : null, compact ? new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(now) : null);
}
function categoryHue(name) {
  const text = String(name || "Genel");
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  return hash;
}
function Inventory({ parts, query, setQuery, openModal, removePart, saving, filterIntent, clearFilterIntent, toggleFavorite, adjustPartStock }) {
  const [stockFilter, setStockFilter] = useState(() => filterIntent || "all");
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => {
    if (!filterIntent) return;
    setStockFilter(filterIntent);
    clearFilterIntent();
  }, [filterIntent, clearFilterIntent]);
  const allParts = showArchived ? parts : parts.filter((p) => p.archived !== true);
  const filtered = allParts.filter((part) => `${part.name} ${part.sku} ${part.category} ${part.brand}`.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")) && (stockFilter === "all" || (stockFilter === "low" ? part.stock <= part.minimum : stockFilter === "good" ? part.stock > part.minimum : stockFilter === "favorite" ? part.favorite : true)));
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(filtered.map((p) => ({
      SKU: p.sku,
      "Parça Adı": p.name,
      Kategori: p.category,
      Marka: p.brand,
      Stok: p.stock,
      "Minimum": p.minimum,
      "Alış Fiyatı": p.cost,
      "Satış Fiyatı": p.price,
      Durum: p.stock <= p.minimum ? "Kritik" : "Yeterli",
      Favorisi: p.favorite ? "Evet" : "Hayır",
      Arşivli: p.archived ? "Evet" : "Hayır",
    })));
    XLSX.utils.book_append_sheet(wb, ws, "Parçalar");
    XLSX.writeFile(wb, `demir-parca-envanteri-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const tableContent = filtered.length ? h("div", { className: "table-scroll" },
    h("table", null,
      h("thead", null, h("tr", null, ["", "PARÇA", "KATEGORİ", "STOK", "ALIŞ FİYATI · KDV HARİÇ", "SATIŞ FİYATI · KDV HARİÇ", "DURUM", "İŞLEM"].map((label) => h("th", { key: label }, label)))),
      h("tbody", null, filtered.map((part, index) => {
        const low = part.stock <= part.minimum;
        return h("tr", { key: part.id, className: low ? "row-critical" : "", style: { "--row-delay": `${Math.min(index, 24) * 18}ms` } },
          h("td", null, h("button", { className: "icon-button favorite-button", type: "button", onClick: () => toggleFavorite(part.id), disabled: saving, title: part.favorite ? "Favoriden kaldır" : "Favorilere ekle" }, h(Icon, { name: part.favorite ? "bell" : "car", size: 14, className: part.favorite ? "favorite-active" : "" }))),
          h("td", null, h("div", { className: "table-part" }, h("span", { className: "part-avatar", style: { "--cat-hue": categoryHue(part.category) } }, part.name.slice(0, 1)), h("span", null, h("strong", null, part.name), h("small", null, part.sku)))),
          h("td", null, h("span", { className: "category-tag", style: { "--cat-hue": categoryHue(part.category) } }, part.category)),
          h("td", null, h("div", { className: "stock-control" },
            h("button", { className: "button button-small button-outline stock-minus", type: "button", disabled: saving || part.stock <= 0, onClick: () => adjustPartStock(part, -1, "Çıkış"), title: "Stoktan 1 adet düşür" }, "-"),
            h("span", { className: `stock-value ${low ? "stock-low" : "stock-good"}` }, part.stock),
            h("button", { className: "button button-small button-outline stock-plus", type: "button", disabled: saving, onClick: () => adjustPartStock(part, 1, "Giriş"), title: "Stoğa 1 adet ekle" }, "+")))
          ,
          h("td", { className: "muted-cell" }, money(part.cost)),
          h("td", { className: "price-cell" }, money(part.price)),
          h("td", null, h(StockStatus, { part })),
          h("td", null, h("div", { className: "row-actions" },
            h("button", { className: "button button-small", disabled: saving, onClick: () => openModal("part", part) }, "Düzenle"),
            h("button", { className: "button button-small button-danger", disabled: saving, onClick: () => removePart(part), "aria-label": `${part.name} parçasını sil` }, part.archived ? "Geri Yükle" : "Arşivle")
            ))
          );
        }
      )))
      )
    : h("div", { className: "empty-state" }, showArchived ? "Arşivli parça bulunamadı." : "Aramanızla eşleşen parça bulunamadı.");
  return h("div", null,
    h(StockCinema, { parts }),
    h("div", { className: "list-toolbar" }, [
      h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Parça adı, SKU veya kategori ara..." })),
      h("select", { className: "filter-select", value: stockFilter, onChange: (event) => setStockFilter(event.target.value), "aria-label": "Stok durumu filtresi" }, h("option", { value: "all" }, "Tüm stoklar"), h("option", { value: "low" }, "Kritik stok"), h("option", { value: "good" }, "Stok yeterli"), h("option", { value: "favorite" }, "Favoriler")),
      h("label", { style: { display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" } }, h("input", { type: "checkbox", checked: showArchived, onChange: () => setShowArchived(!showArchived) }), showArchived ? "Arşivli parçaları gizle" : "Arşivli parçaları göster"),
      h("span", { className: "result-count" }, `${filtered.length} parça gösteriliyor`),
      h("div", { className: "heading-actions" }, [
        h("button", { className: "button button-quiet", onClick: exportExcel, disabled: saving || !filtered.length }, h(Icon, { name: "box", size: 14 }), "Excel'e Aktar"),
        h("button", { className: "button button-primary", onClick: () => openModal("part"), disabled: saving }, h(Icon, { name: "plus", size: 14 }), "Parça ekle")
      ])
    ]),
    h("section", { className: "panel table-panel" }, tableContent)
  );
}
function StockStatus({ part }) {
  const low = part.stock <= part.minimum;
  return h("span", { className: `stock-status ${low ? "stock-low" : "stock-good"}` }, h("i", null), `${part.stock} adet`, h("small", null, ` / min. ${part.minimum}`), h("b", { className: "stock-meter", "aria-hidden": "true" }, h("u", { style: { width: `${Math.max(4, Math.min(100, (part.stock / Math.max(1, part.minimum * 2)) * 100))}%` } })));
}
function JobTable({ jobs, compact }) {
  return h("div", { className: `table-scroll ${compact ? "compact-table" : ""}` },
    h("table", null,
      h("thead", null, h("tr", null, ["İŞ EMRİ", "ARAÇ", "MÜŞTERİ", "TUTAR · KDV DAHİL", "DURUM"].map((label) => h("th", { key: label }, label)))),
      h("tbody", null, jobs.map((job) => h("tr", { key: job.id },
        h("td", null, h("strong", { className: "job-id" }, job.code || job.id), h("small", { className: "table-date" }, dateLabel(job.date))),
        h("td", null, h("div", { className: "vehicle-cell" }, h("strong", null, job.plate), h("small", null, `${job.make} ${job.model}`))),
        h("td", { className: "muted-cell" }, job.customer),
        h("td", { className: "price-cell" }, money(vatIncludedAmount(job.total))),
        h("td", null, h("span", { className: `job-status ${getWorkOrderStatusClass(job.status)}` }, h("i", null), job.status))
      )))
    )
  );
}
function WorkOrders({ jobs, query, setQuery, openModal, markJobComplete, cancelJob, saving, selectionIntent, clearSelectionIntent, statusFilterIntent, clearStatusFilterIntent }) {
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState(() => statusFilterIntent || "all");
  useEffect(() => {
    if (statusFilterIntent) {
      setStatus(statusFilterIntent);
      clearStatusFilterIntent?.();
    }
  }, [statusFilterIntent, clearStatusFilterIntent]);
  useEffect(() => {
    if (!selectionIntent) return;
    setStatus("all");
    setSelected(selectionIntent);
    clearSelectionIntent();
    setTimeout(() => {
      const el = document.getElementById(`job-row-${selectionIntent}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  }, [selectionIntent, clearSelectionIntent]);
  const filtered = jobs.filter((job) => `${job.code || job.id} ${job.plate} ${job.customer} ${job.make} ${job.model}`.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")) && (status === "all" || job.status === status));
  return h(React.Fragment, null,
    h(WorkOrdersCinema, { jobs }),
    h("div", { className: "list-toolbar" },
      h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Plaka, müşteri veya iş emri ara..." })),
      h("select", { className: "filter-select", value: status, onChange: (event) => setStatus(event.target.value), "aria-label": "İş emri durumu filtresi" }, h("option", { value: "all" }, "Tüm durumlar"), h("option", { value: WORK_ORDER_STATUS.IN_PROGRESS }, WORK_ORDER_STATUS.IN_PROGRESS), h("option", { value: WORK_ORDER_STATUS.COMPLETED }, WORK_ORDER_STATUS.COMPLETED), h("option", { value: WORK_ORDER_STATUS.CANCELLED }, WORK_ORDER_STATUS.CANCELLED)),
      h("span", { className: "result-count" }, `${filtered.length} iş emri`)
    ),
    h("section", { className: "panel table-panel" }, filtered.length ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["İŞ EMRİ", "ARAÇ", "MÜŞTERİ", "İŞLEM / PARÇALAR", "TUTAR · KDV DAHİL", "DURUM", "İŞLEM"].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, filtered.map((job) => h(React.Fragment, { key: job.id },
          h("tr", {
            id: `job-row-${job.id}`,
            className: `clickable-row ${selected === job.id ? "selected-row" : ""}`,
            tabIndex: 0,
            "aria-expanded": selected === job.id,
            onClick: () => setSelected(selected === job.id ? null : job.id),
            onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(selected === job.id ? null : job.id); } }
          },
            h("td", null, h("strong", { className: "job-id" }, job.code || job.id), h("small", { className: "table-date" }, dateLabel(job.date))),
            h("td", null, h("div", { className: "vehicle-cell" }, h("strong", null, job.plate), h("small", null, `${job.make} ${job.model}`))),
            h("td", null, h("div", { className: "vehicle-cell" }, h("strong", null, job.customer), h("small", null, job.phone || "Telefon belirtilmedi"))),
            h("td", null, h("span", { className: "muted-cell" }, `${job.items.length} parça kalemi`)),
            h("td", { className: "price-cell" }, money(vatIncludedAmount(job.total))),
            h("td", null, h("span", { className: `job-status ${getWorkOrderStatusClass(job.status)}` }, h("i", null), job.status)),
            h("td", { className: "action-cell", onClick: (e) => e.stopPropagation() },
              h("button", {
                className: "button button-small button-outline job-quick-edit",
                type: "button",
                disabled: saving,
                onClick: () => openModal("job", job),
                "aria-label": `${job.code || "İş emri"} kaydını düzenle`
              }, "Düzenle")
            )
          ),
          selected === job.id ? h("tr", { className: "job-detail-row" }, h("td", { colSpan: 7 }, h("div", { className: "job-detail" }, h("strong", null, "Araç servis geçmişi / kullanılan parçalar"), job.items.map((item, index) => h("span", { key: `${item.partId || item.sku || item.name}-${index}` }, `${item.name} · ${item.qty} adet · ${money(Number(item.price || 0) * Number(item.qty || 0))} KDV hariç${item.discountType && item.discountType !== "none" && Number(item.discountValue) > 0 ? ` (iskonto ${item.discountType === "percent" ? `%${item.discountValue}` : money(item.discountValue)})` : ""}`)), h("span", null, `İşçilik · ${money(normalizeLaborAmount(job.laborAmount))} KDV hariç`), (job.externalLabor || []).length ? h("span", null, `Harici işçilik · ${money((job.externalLabor || []).reduce((sum, el) => sum + (Number(el.price) || 0), 0))} KDV hariç`) : null, job.laborDiscountType && job.laborDiscountType !== "none" && Number(job.laborDiscountValue) > 0 ? h("span", { className: "job-detail-discount" }, job.laborDiscountType === "percent" ? `İşçilik iskontosu · %${job.laborDiscountValue}` : `İşçilik iskontosu · ${money(job.laborDiscountValue)}`) : null, h("span", null, `Ara toplam · ${money(Number(job.total || 0))} KDV hariç`), h("span", null, `%${VAT_RATE * 100} KDV · ${money(calculateVat(Number(job.total || 0)).vat)}`), h("span", { className: "job-detail-total" }, `İş emri toplamı · ${money(vatIncludedAmount(job.total))} KDV dahil`), job.status === WORK_ORDER_STATUS.CANCELLED ? h("span", { className: "job-cancelled-note" }, "Kayıt iptal edildi; stok hareketleri korunuyor.") : h("div", { className: "job-lifecycle-actions" }, job.status === WORK_ORDER_STATUS.IN_PROGRESS ? h("button", { className: "button button-small", type: "button", disabled: saving, onClick: () => markJobComplete(job) }, "Tamamlandı") : null, h("button", { className: "button button-small button-danger", type: "button", disabled: saving, onClick: () => cancelJob(job) }, "İş emrini iptal et"), h("button", { className: "button button-small job-edit-action", type: "button", disabled: saving, onClick: () => openModal("job", job), "aria-label": `${job.code || "İş emri"} kaydını düzenle` }, "İş emrini düzenle"))))) : null
        )))
      )
    ) : h("div", { className: "empty-state" }, "Henüz iş emri bulunmuyor."))
  );
}
function VehicleHistory({ jobs, queryIntent, clearQueryIntent }) {
  const [query, setQuery] = useState(() => queryIntent || "");
  const [selectedPlate, setSelectedPlate] = useState(() => queryIntent ? queryIntent.trim().toLocaleUpperCase("tr") : "");
  useEffect(() => {
    if (queryIntent) {
      setQuery(queryIntent);
      setSelectedPlate(queryIntent.trim().toLocaleUpperCase("tr"));
      clearQueryIntent?.();
    }
  }, [queryIntent, clearQueryIntent]);
  const activeJobs = jobs.filter((job) => job.status !== WORK_ORDER_STATUS.CANCELLED);
  const vehicles = new Map();
  [...activeJobs].sort((first, second) => (second.date || "").localeCompare(first.date || "")).forEach((job) => {
    const key = job.plate.trim().toLocaleUpperCase("tr");
    const entry = vehicles.get(key) || { plate: key, make: job.make, model: job.model, customer: job.customer, jobs: [] };
    entry.jobs.push(job);
    if (!entry.lastDate || job.date > entry.lastDate) {
      entry.lastDate = job.date;
      entry.customer = job.customer;
      entry.make = job.make;
      entry.model = job.model;
    }
    vehicles.set(key, entry);
  });
  const filtered = [...vehicles.values()].filter((vehicle) => `${vehicle.plate} ${vehicle.make} ${vehicle.model} ${vehicle.customer}`.toLocaleLowerCase("tr").includes(query.trim().toLocaleLowerCase("tr")));
  const selected = vehicles.get(selectedPlate);
  return h(React.Fragment, null,
    h("div", { className: "list-toolbar" }, h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Plakayı veya müşteri adını yazın..." })), h("span", { className: "result-count" }, `${filtered.length} araç`)),
    selected ? h("section", { className: "vehicle-profile panel" },
      h("div", { className: "vehicle-profile-heading" }, h("div", null, h("span", { className: "eyebrow" }, "ARAÇ SERVİS KARTI"), h("h2", null, selected.plate), h("p", null, `${selected.make} ${selected.model} · ${selected.customer}`)), h("button", { className: "button button-quiet", onClick: () => setSelectedPlate("") }, "Araç listesine dön")),
      h("div", { className: "vehicle-profile-metrics" }, h("div", null, h("strong", null, selected.jobs.length), h("span", null, "servis ziyareti")), h("div", null, h("strong", null, dateLabel(selected.lastDate)), h("span", null, "son servis"))),
      h("div", { className: "vehicle-timeline" }, selected.jobs.map((job) => h("article", { className: "vehicle-visit", key: job.id },
        h("span", { className: "timeline-dot" }),
        h("div", null, h("div", { className: "vehicle-visit-heading" }, h("strong", null, job.code || job.id), h("time", null, dateLabel(job.date))), h("p", null, `${job.make} ${job.model} · ${job.customer} · ${money(vatIncludedAmount(job.total))} (KDV dahil)`), h("div", { className: "vehicle-part-list" }, job.items.map((item, index) => h("span", { key: `${item.partId}-${index}` }, `${item.name} × ${item.qty}`))))
      )))
    ) : filtered.length ? h("section", { className: "vehicle-card-grid" }, filtered.map((vehicle) => h("button", { className: "vehicle-card panel", key: vehicle.plate, onClick: () => setSelectedPlate(vehicle.plate) },
      h("span", { className: "vehicle-card-icon" }, h(Icon, { name: "car", size: 21 })),
      h("span", { className: "vehicle-card-copy" }, h("strong", null, vehicle.plate), h("small", null, `${vehicle.make} ${vehicle.model} · ${vehicle.customer}`)),
      h("span", { className: "vehicle-card-meta" }, `${vehicle.jobs.length} ziyaret · son ${dateLabel(vehicle.lastDate)}`)
    ))) : h("section", { className: "panel empty-state" }, activeJobs.length ? "Aramanızla eşleşen araç bulunamadı." : "Araç geçmişi, iş emri kaydedildikçe burada oluşur."));
}
function PartCompatibility({ jobs, fitments, openModal, removeFitment, saving }) {
  const [query, setQuery] = useState("");
  const [fuel, setFuel] = useState("all");
  const catalog = searchFitments(fitments, query, fuel);
  const vehicles = searchVehiclePartUsage(jobs, query);
  return h(React.Fragment, null,
    h("div", { className: "list-toolbar" },
      h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Marka, model, motor, yakıt veya parça ara...", "aria-label": "Uyumluluk kaydı ara" })),
      h("select", { className: "filter-select", value: fuel, onChange: (event) => setFuel(event.target.value), "aria-label": "Yakıt tipi filtresi" }, h("option", { value: "all" }, "Tüm yakıtlar"), FUEL_TYPES.map((type) => h("option", { key: type, value: type }, type))),
      h("span", { className: "result-count" }, `${catalog.length} uyumluluk kaydı`)
    ),
    h("p", { className: "page-hint" }, "Kendi girdiğiniz marka, model, Dizel/Benzin ve motor bilgisine göre uyumlu parçaları kaydedin. Aşağıdaki servis kullanımı yalnızca iş emirlerinden gelir."),
    catalog.length ? h("section", { className: "vehicle-fitment-grid" }, catalog.map((fitment) =>
      h("article", { className: "panel fitment-card vehicle-fitment-card", key: fitment.id },
        h("div", { className: "vehicle-fitment-heading" },
          h("span", { className: "vehicle-card-icon" }, h(Icon, { name: "car", size: 20 })),
          h("div", { className: "vehicle-fitment-title" }, h("strong", null, formatFitmentVehicle(fitment) || "Araç"), h("small", null, formatFitmentSpec(fitment))),
          h("span", { className: `category-tag fuel-tag fuel-${normalizeFuelClass(fitment.fuel)}` }, fitment.fuel)
        ),
        h("h3", { className: "vehicle-fitment-label" }, "Uyumlu parçalar"),
        fitment.parts?.length ? h("div", { className: "vehicle-fitment-parts" }, fitment.parts.map((part, index) => h("div", { className: "vehicle-fitment-part", key: part.partId || `${part.sku || part.name}-${index}` },
          h("span", null, h("strong", null, part.name), h("small", null, part.sku || (part.partId ? "Stok kodu yok" : "Elle eklenen parça")))
        ))) : h("p", { className: "empty-state compact-empty" }, "Bu kayıtta henüz parça yok."),
        h("div", { className: "fitment-card-actions row-actions" },
          h("button", { className: "button button-small", type: "button", disabled: saving, onClick: () => openModal("fitment", fitment) }, "Düzenle"),
          h("button", { className: "button button-small button-danger", type: "button", disabled: saving, onClick: () => removeFitment(fitment), "aria-label": `${formatFitmentVehicle(fitment)} kaydını sil` }, "Sil")
        )
      )
    )) : h("section", { className: "panel empty-state vehicle-search-prompt" },
      h("h3", null, fitments.length ? "Aramanızla eşleşen kayıt yok" : "Henüz uyumluluk kaydı yok"),
      h("p", null, fitments.length ? "Marka, model, yakıt, motor veya parça adını değiştirerek tekrar arayın." : "Sağ üstten “Uyumluluk ekle” ile marka, model, Dizel veya Benzin, motor hacmi ve uyumlu parçaları kaydedin.")
    ),
    vehicles.length ? h(React.Fragment, null,
      h("h2", { className: "fitment-usage-heading" }, "Serviste kullanılan parçalar"),
      h("p", { className: "page-hint" }, "Bu bölüm iş emirlerindeki gerçek kullanımdır; katalog kaydı değildir."),
      h("section", { className: "vehicle-fitment-grid" }, vehicles.map((vehicle) =>
        h("article", { className: "panel fitment-card vehicle-fitment-card", key: vehicle.plate },
          h("div", { className: "vehicle-fitment-heading" },
            h("span", { className: "vehicle-card-icon" }, h(Icon, { name: "car", size: 20 })),
            h("div", { className: "vehicle-fitment-title" }, h("strong", null, `${vehicle.make} ${vehicle.model}`), h("small", null, vehicle.plate)),
            h("span", { className: "vehicle-card-meta" }, `${vehicle.jobs.length} servis ziyareti`)
          ),
          h("div", { className: "vehicle-profile-metrics vehicle-fitment-metrics" },
            h("div", null, h("strong", null, vehicle.parts.length), h("span", null, "kullanılan parça")),
            h("div", null, h("strong", null, dateLabel(vehicle.latestDate)), h("span", null, "son servis"))
          ),
          h("h3", { className: "vehicle-fitment-label" }, "Bu araçta kullanılan parçalar"),
          vehicle.parts.length ? h("div", { className: "vehicle-fitment-parts" }, vehicle.parts.map((part) => h("div", { className: "vehicle-fitment-part", key: part.partId || part.sku || part.name },
            h("span", null, h("strong", null, part.name), h("small", null, part.sku || "Stok kodu yok")),
            h("span", { className: "vehicle-fitment-usage" }, `${part.quantity} adet · ${part.visits} ziyarette`),
            h("small", { className: "vehicle-fitment-last-use" }, `Son kullanım ${dateLabel(part.lastDate)}`)
          ))) : h("p", { className: "empty-state compact-empty" }, "Bu araç için parça kaydı bulunamadı.")
        )
      ))
    ) : h("section", { className: "panel empty-state compact-empty" }, query.trim() ? "Aramanızla eşleşen iş emri aracı bulunamadı." : "Henüz plakaya bağlı bir iş emri kaydı yok.")
  );
}
function normalizeFuelClass(fuel) {
  return String(fuel || "").toLocaleLowerCase("tr").replace(/\s+/g, "-");
}
function StockMovements({ movements }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [period, setPeriod] = useState("all");
  const cutoff = period === "all" ? "" : new Date(Date.now() - Number(period) * 86400000).toISOString();
  const filtered = movements.filter((movement) =>
    `${movement.name} ${movement.sku} ${movement.type} ${movement.referenceCode} ${movement.actor}`.toLocaleLowerCase("tr").includes(query.trim().toLocaleLowerCase("tr")) &&
    (type === "all" || movement.type === type) &&
    (!cutoff || (movement.createdAt || "") >= cutoff)
  );
  const types = [...new Set(movements.map((movement) => movement.type).filter(Boolean))];
  return h(React.Fragment, null,
    h("div", { className: "list-toolbar movement-toolbar" },
      h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Parça, SKU, işlem no veya kullanıcı ara..." })),
      h("select", { className: "filter-select", value: type, onChange: (event) => setType(event.target.value), "aria-label": "Hareket türü" }, h("option", { value: "all" }, "Tüm hareketler"), types.map((entry) => h("option", { key: entry, value: entry }, entry))),
      h("select", { className: "filter-select", value: period, onChange: (event) => setPeriod(event.target.value), "aria-label": "Tarih aralığı" }, h("option", { value: "all" }, "Tüm tarihler"), h("option", { value: "7" }, "Son 7 gün"), h("option", { value: "30" }, "Son 30 gün"), h("option", { value: "90" }, "Son 90 gün")),
      h("span", { className: "result-count" }, `${filtered.length} hareket`)
    ),
    h("section", { className: "panel table-panel movement-panel" }, filtered.length ? h("div", { className: "table-scroll" }, h("table", null,
      h("thead", null, h("tr", null, ["TARİH", "PARÇA", "İŞLEM", "KAYNAK", "MİKTAR", "STOK SONRASI", "İŞLEMİ YAPAN"].map((label) => h("th", { key: label }, label)))),
      h("tbody", null, filtered.map((movement) => h("tr", { key: movement.id },
        h("td", null, h("strong", { className: "job-id" }, dateLabel(movement.date)), h("small", { className: "table-date" }, movement.createdAt ? new Date(movement.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "")),
        h("td", null, h("div", { className: "vehicle-cell" }, h("strong", null, movement.name), h("small", null, movement.sku))),
        h("td", null, h("span", { className: "category-tag" }, movement.type)),
        h("td", { className: "muted-cell" }, movement.referenceCode || "—"),
        h("td", { className: movement.qty > 0 ? "movement-positive" : "movement-negative" }, `${movement.qty > 0 ? "+" : ""}${movement.qty}`),
        h("td", null, movement.stockAfter ?? "—"),
        h("td", { className: "muted-cell" }, movement.actor || "—")
      )))
    )) : h("div", { className: "empty-state" }, movements.length ? "Filtrelerle eşleşen hareket bulunamadı." : "Bu ekran açıldıktan sonra gerçekleşen stok hareketleri burada kaydedilir."))
  );
}
function Invoices({ invoices, openModal, removeInvoice, saving }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLocaleLowerCase("tr").replace(/ı/g, "i");
  const filtered = invoices.filter((invoice) => {
    const haystack = `${invoice.code || invoice.id} ${invoice.supplier || ""} ${invoice.date || ""} ${dateLabel(invoice.date) || ""} ${invoice.status || ""}`;
    return haystack.toLocaleLowerCase("tr").replace(/ı/g, "i").includes(q);
  });
  return h(React.Fragment, null,
    h(InvoicesCinema, { invoices }),
    h("section", { className: "panel table-panel" }, [
    h("div", { className: "list-toolbar" }, [
      h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Fatura no, tedarikçi veya tarih ara..." })),
      h("span", { className: "result-count" }, `${filtered.length} fatura`)
    ]),
    filtered.length ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["FATURA NO", "TEDARİKÇİ", "TARİH", "KALEM", "TOPLAM · KDV DAHİL", "DURUM", "İŞLEM"].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, filtered.map((invoice) => h("tr", { key: invoice.id }, [
          h("td", null, h("strong", { className: "job-id" }, invoice.code || invoice.id)),
          h("td", { className: "muted-cell" }, invoice.supplier || "-"),
          h("td", { className: "muted-cell" }, dateLabel(invoice.date) || "-"),
          h("td", null, `${invoice.lines || 0} parça`),
          h("td", { className: "price-cell" }, money(vatIncludedAmount(invoice.total || 0))),
          h("td", null, h("span", { className: `job-status ${invoice.status ? "status-done" : ""}` }, h("i", null), invoice.status || "-")),
          h("td", null, h("div", { className: "row-actions" },
            h("button", { className: "button button-small", disabled: saving, onClick: () => openModal("invoice", invoice) }, "Düzenle"),
            h("button", { className: "button button-small button-danger", disabled: saving, onClick: () => removeInvoice(invoice) }, "Sil")
          ))
        ])))
      )
    ) : h("div", { className: "empty-state" }, q ? "Aramanızla eşleşen fatura bulunamadı." : firebaseConfigured ? "Henüz alış faturası eklenmedi." : "Firebase yapılandırılmadığı için fatura yok. .env.local dosyasını düzenleyin ve sayfayı yenileyin.")
  ]));
}
function Orders({ drafts, lowStock, receiveDraft, createDraft }) {
  const draftCards = drafts.map((draft) => h("section", { className: "panel draft-card", key: draft.id },
    h("div", { className: "draft-heading" }, h("div", null, h("span", { className: "draft-id" }, draft.code || draft.id), h("p", null, dateLabel(draft.date))), h("span", { className: "draft-status" }, draft.status)),
    h("div", { className: "draft-lines" }, draft.items.map((item) => h("div", { className: "draft-line", key: item.partId },
      h("div", null, h("strong", null, item.name), h("small", null, item.sku)),
      h("span", null, `${item.qty} adet`),
      h("strong", null, money(vatIncludedAmount(item.qty * item.cost)))
    ))),
    h("div", { className: "draft-total" }, h("span", null, "Tahmini toplam · KDV dahil"), h("strong", null, money(vatIncludedAmount(draft.items.reduce((sum, item) => sum + item.qty * item.cost, 0))))),
    h("button", { className: "button button-primary draft-receive", onClick: () => receiveDraft(draft.id) }, "Teslim al & stoğa ekle", h(Icon, { name: "arrow", size: 16 }))
  ));
  const empty = h("section", { className: "panel empty-panel" },
    h("div", { className: "empty-illustration" }, h(Icon, { name: "cart", size: 26 })),
    h("h3", null, "Henüz sipariş taslağı yok"),
    h("p", null, lowStock.length ? "Kritik stoklarınız için hemen bir sipariş taslağı oluşturun." : "Stok seviyeleriniz iyi görünüyor. Kritik parça oluştuğunda taslak hazırlayabilirsiniz."),
    lowStock.length ? h("button", { className: "button button-primary", onClick: createDraft }, h(Icon, { name: "plus", size: 15 }), "Sipariş taslağı oluştur") : null
  );
  return h(React.Fragment, null,
    lowStock.length ? h("section", { className: "order-callout" },
      h("span", { className: "callout-icon" }, h(Icon, { name: "bell" })),
      h("div", null, h("strong", null, `${lowStock.length} parça yeniden sipariş bekliyor`), h("p", null, "Mevcut stok, belirlediğiniz minimum seviyeye ulaştı veya altına düştü.")),
      h("button", { className: "button button-dark", onClick: createDraft }, "Öneri oluştur", h(Icon, { name: "arrow", size: 15 }))
    ) : null,
    drafts.length ? h("div", { className: "draft-grid" }, draftCards) : empty
  );
}
function Reports({ data, revenue, bankoRevenue = 0 }) {
  const partsWithSales = computePartSalesFromJobs(data.jobs, data.parts);
  const best = [...partsWithSales].sort((a, b) => b.sold - a.sold);
  const total = partsWithSales.reduce((sum, part) => sum + part.sold, 0);
  const cogs = vatIncludedAmount(getRevenueEligibleWorkOrders(data.jobs).reduce((sum, job) => sum + job.items.reduce((subtotal, item) => subtotal + (data.parts.find((part) => part.id === item.partId)?.cost || 0) * item.qty, 0), 0));
  const max = Math.max(...best.map((part) => part.sold), 1);
  return h(React.Fragment, null, h("div", { className: "metric-grid report-metrics" },
    h(ReportMetric, { label: "Toplam ciro", value: money(revenue), caption: "KDV dahil · iş emirleri + banko satışları", icon: "chart", color: "green" }),
    h(ReportMetric, { label: "Banko satışları", value: money(bankoRevenue), caption: "KDV dahil · iş emrine bağlı olmayan tezgah satışları (eDMS)", icon: "box", color: "orange" }),
    h(ReportMetric, { label: "Parça satış adedi", value: total, caption: "İş emirlerinde kullanılan toplam parça", icon: "box", color: "blue" }),
    h(ReportMetric, { label: "Tahmini parça maliyeti", value: money(cogs), caption: "KDV dahil · güncel alış fiyatları", icon: "receipt", color: "purple" })
  ), h("section", { className: "panel report-panel" }, h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "En çok satan parçalar"), h("p", null, "Satış adetlerine göre sıralama · tüm dönemler")), h("span", { className: "report-period" }, "Tüm dönemler")), h("div", { className: "report-bars" }, best.map((part, index) => h("div", { className: "report-bar-row", key: part.id }, h("span", { className: "rank-number" }, `0${index + 1}`), h("span", { className: "report-part-name" }, part.name), h("div", { className: "bar-track" }, h("div", { className: `bar-fill bar-${index % 4 + 1}`, style: { width: `${Math.max(5, part.sold / max * 100)}%` } })), h("strong", null, `${part.sold} adet`))))), h("section", { className: "report-note" }, h("span", { className: "note-dot" }), "Raporlar, kaydettiğiniz iş emirleri ve envanter hareketlerine göre anlık güncellenir."));
}
function ReportMetric({ label, value, caption, icon, color }) {
  return h("article", { className: "metric-card" }, h("div", { className: "metric-top" }, h("span", null, label), h("span", { className: `metric-icon ${color}` }, h(Icon, { name: icon }))), h("strong", { className: "metric-value" }, value), h("div", { className: "metric-bottom" }, caption));
}
function VatSummary({ values, title = "KDV dahil toplam" }) {
  return h("div", { className: "vat-summary" },
    h("div", null, h("span", null, "KDV hariç"), h("strong", null, money(values.subtotal))),
    h("div", null, h("span", null, `%${VAT_RATE * 100} KDV`), h("strong", null, money(values.vat))),
    h("div", null, h("span", null, title), h("strong", null, money(values.total)))
  );
}

function WorkOrderPriceSummary({ values }) {
  const laborDiscountLabel = values.laborDiscountType === "percent" ? `İşçilik iskontosu (%${values.laborDiscountValue})` : "İşçilik iskontosu";
  return h("div", { className: "vat-summary work-order-price-summary", "aria-label": "İş emri toplam özeti" },
    h("div", null, h("span", null, "Parça ara toplamı (KDV hariç)"), h("strong", null, money(values.partsGross))),
    values.partsDiscountTotal ? h("div", { className: "work-order-price-discount" }, h("span", null, "Parça iskontosu"), h("strong", null, `− ${money(values.partsDiscountTotal)}`)) : null,
    h("div", null, h("span", null, "İşçilik (KDV hariç)"), h("strong", null, money(values.laborAmount))),
    values.laborDiscountAmount ? h("div", { className: "work-order-price-discount" }, h("span", null, laborDiscountLabel), h("strong", null, `− ${money(values.laborDiscountAmount)}`)) : null,
    values.externalLaborSubtotal ? h("div", null, h("span", null, "Harici işçilik (KDV hariç)"), h("strong", null, money(values.externalLaborSubtotal))) : null,
    h("div", null, h("span", null, "Ara toplam (KDV hariç)"), h("strong", null, money(values.subtotal))),
    h("div", null, h("span", null, `%${VAT_RATE * 100} KDV`), h("strong", null, money(values.vat))),
    h("div", { className: "work-order-price-grand-total" }, h("span", null, "İş emri toplamı · KDV dahil"), h("strong", null, money(values.total)))
  );
}

function ServiceBoxPage() {
  const serviceboxUrl = "https://idfed.mpsa.com/as/authorization.oauth2?response_type=code&client_id=CIDHBJGJWDTBSTEPFPFESQQNEIOJKOUQ&redirect_uri=https%3A%2F%2Fservicebox.mpsa.com%2Fdo%2Foauth2Callback&scope=openid+prd%3Ajbn+profile&state=T_uiRpnctUziudhxhzOiQs3FnICKHQLg5r4UKy9F8ZHLfk_8YUirCf4cB6z9sPjeoUoT4aL1_rf1OHVHLsUgExJBPXNRHqNP&code_challenge=bpZaD0Od0siQfVjM9C0NRHF0n-jSaAWzINuDL8W97BU&code_challenge_method=S256";
  const b2bUrl = "https://www.b2bdemirotomotiv.com.tr/";

  return h("section", { className: "panel servicebox-panel" },
    h("div", { className: "panel-heading" },
      h("div", null,
        h("h2", null, "Parça Tedarikçileri"),
        h("p", null, "Parça tespiti ve sipariş için kullanılan portallar")
      )
    ),
    h("div", { className: "servicebox-links-grid" },
      h("div", { className: "servicebox-link-card" },
        h("div", { className: "servicebox-info" },
          h("div", { className: "servicebox-icon" }, h(Icon, { name: "car", size: 48 })),
          h("h3", null, "Peugeot ServiceBox"),
          h("p", null, "Resmi Peugeot parça kataloğu ve teknik bilgiler"),
          h("ul", null,
            h("li", null, "Araç bazlı parça kataloğu"),
            h("li", null, "Orijinal parça numaraları"),
            h("li", null, "Teknik çizimler ve şemalar"),
            h("li", null, "Montaj talimatları")
          )
        ),
        h("div", { className: "servicebox-action" },
          h("button", {
            className: "button button-primary",
            onClick: () => window.open(serviceboxUrl, "_blank")
          }, h(Icon, { name: "arrow", size: 16 }), "ServiceBox'a Git")
        )
      ),
      h("div", { className: "servicebox-link-card" },
        h("div", { className: "servicebox-info" },
          h("div", { className: "servicebox-icon b2b-icon" }, h(Icon, { name: "box", size: 48 })),
          h("h3", null, "B2B Demir Otomotiv"),
          h("p", null, "Orijinal yedek parça sipariş portalı"),
          h("ul", null,
            h("li", null, "Peugeot yedek parça kataloğu"),
            h("li", null, "Çevrimiçi sipariş"),
            h("li", null, "Stok ve fiyat bilgisi"),
            h("li", null, "Hızlı teslimat")
          )
        ),
        h("div", { className: "servicebox-action" },
          h("button", {
            className: "button button-primary",
            onClick: () => window.open(b2bUrl, "_blank")
          }, h(Icon, { name: "arrow", size: 16 }), "B2B'ye Git")
        )
      )
    )
  );
}

function ChatPage({ messages, user, sendMessage, saving, configured }) {
  const [messageText, setMessageText] = useState("");
  const [chatError, setChatError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = React.useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!messageText.trim() || isSending || saving) return;
    if (!configured) {
      setChatError("Sunucu bağlantısı yapılandırılmamış. Lütfen .env.local dosyasındaki VITE_FIREBASE_* değerlerini doldurun ve sayfayı yenileyin.");
      return;
    }
    
    setIsSending(true);
    setChatError("");
    
    try {
      await sendMessage(messageText);
      setMessageText("");
    } catch (error) {
      console.error("Mesaj gönderilemedi:", error);
      setChatError(error.message || "Mesaj gönderilemedi. Lütfen tekrar deneyin.");
    } finally {
      setIsSending(false);
    }
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  return h("section", { className: "chat-container" },
    h("div", { className: "chat-messages" },
      messages.length === 0
        ? h("div", { className: "chat-empty" },
            h("div", { className: "chat-empty-icon" }, h(Icon, { name: "bell", size: 48 })),
            h("h3", null, "Henüz mesaj yok"),
            h("p", null, "Ekibinizle iletişim kurmak için ilk mesajı gönderin.")
          )
        : messages.map((msg) => h("div", {
            key: msg.id,
            className: `chat-message ${msg.senderEmail === user.email ? "chat-message-own" : "chat-message-other"}`
          },
            h("div", { className: "chat-message-header" },
              h("strong", null, msg.senderName),
              h("small", null, formatTime(msg.timestamp))
            ),
            h("div", { className: "chat-message-content" }, msg.text)
          )),
      h("div", { ref: messagesEndRef })
    ),
    chatError ? h("div", { className: "chat-error" }, chatError) : null,
    h("form", { className: "chat-input", onSubmit: handleSubmit },
      h("input", {
        type: "text",
        value: messageText,
        onChange: (e) => setMessageText(e.target.value),
        placeholder: "Mesaj yazın...",
        disabled: isSending || saving
      }),
      h("button", {
        type: "submit",
        className: "button button-primary",
        disabled: !messageText.trim() || isSending || saving
      }, h(Icon, { name: "arrow", size: 16 }), isSending ? "..." : "Gönder")
    )
  );
}

function parseTurkishOrStandardNumber(val) {
  if (typeof val === "number") return val;
  if (!val && val !== 0) return 0;
  let s = String(val).trim();
  if (!s) return 0;
  if (s.includes(".") && s.includes(",")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function cleanSku(s) {
  return String(s || "")
    .trim()
    .toLocaleLowerCase("tr")
    .replace(/[\s\-_./\\#]/g, "");
}

function parseExcelStockRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const skuKeywords = ["sku", "stok kodu", "parca kodu", "parça kodu", "kod", "referans", "ref", "oem", "malzeme kodu", "parca no", "parça no"];
  const nameKeywords = ["parca adi", "parça adı", "parca", "parça", "urun adi", "ürün adı", "urun", "ürün", "aciklama", "açıklama", "tanim", "tanım", "ad", "isim"];
  const qtyKeywords = ["stok", "adet", "miktar", "mevcut", "bakiye", "sayim", "sayım", "kalan", "fiili", "sayılan", "sayilan"];

  let headerRowIndex = -1;
  let skuCol = -1;
  let nameCol = -1;
  let qtyCol = -1;

  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    let foundSku = -1;
    let foundQty = -1;
    let foundName = -1;

    for (let c = 0; c < row.length; c++) {
      const cellVal = String(row[c] || "").trim().toLowerCase();
      if (!cellVal) continue;
      if (foundSku === -1 && skuKeywords.some(k => cellVal === k || cellVal.includes(k))) {
        foundSku = c;
      } else if (foundQty === -1 && qtyKeywords.some(k => cellVal === k || cellVal.includes(k))) {
        foundQty = c;
      } else if (foundName === -1 && nameKeywords.some(k => cellVal === k || cellVal.includes(k))) {
        foundName = c;
      }
    }

    if (foundSku !== -1 || (foundQty !== -1 && foundName !== -1)) {
      headerRowIndex = r;
      skuCol = foundSku;
      nameCol = foundName;
      qtyCol = foundQty;
      break;
    }
  }

  let dataRows = [];
  if (headerRowIndex !== -1) {
    if (skuCol === -1) skuCol = 0;
    if (qtyCol === -1) {
      qtyCol = [0, 1, 2, 3].find(c => c !== skuCol && c !== nameCol) ?? 2;
    }
    dataRows = rows.slice(headerRowIndex + 1);
  } else {
    skuCol = 0;
    let firstValid = rows.find(r => Array.isArray(r) && r.some(v => v !== null && v !== undefined && String(v).trim() !== ""));
    if (firstValid && firstValid.length === 2) {
      const val1 = String(firstValid[1] || "").trim();
      const num1 = parseTurkishOrStandardNumber(val1);
      if (Number.isFinite(num1) && !isNaN(Number(val1.replace(",", ".")))) {
        qtyCol = 1;
        nameCol = -1;
      } else {
        nameCol = 1;
        qtyCol = -1;
      }
    } else {
      nameCol = 1;
      qtyCol = 2;
    }
    dataRows = rows;
  }

  const items = [];
  for (const row of dataRows) {
    if (!Array.isArray(row) || row.length === 0) continue;
    const rawSku = skuCol !== -1 ? String(row[skuCol] || "").trim() : "";
    if (!rawSku) continue;
    if (skuKeywords.some(k => rawSku.toLowerCase() === k)) continue;

    const rawName = nameCol !== -1 && row[nameCol] !== undefined ? String(row[nameCol] || "").trim() : "";
    let rawQtyVal = qtyCol !== -1 ? row[qtyCol] : 0;
    const qty = parseTurkishOrStandardNumber(rawQtyVal);

    items.push({
      sku: rawSku,
      name: rawName,
      stock: Number.isFinite(qty) ? qty : 0,
    });
  }

  return items;
}

function StockCompare({ parts = [], openModal }) {
  const [comparisons, setComparisons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setLoading(true);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

      const rawExcelRows = parseExcelStockRows(jsonData);
      if (!rawExcelRows.length) {
        alert("Excel dosyasında geçerli parça ve stok verisi bulunamadı.");
        setLoading(false);
        return;
      }

      // Aggregate repeated SKUs in Excel
      const aggregatedExcel = new Map();
      for (const item of rawExcelRows) {
        const normKey = cleanSku(item.sku);
        if (!normKey) continue;
        if (aggregatedExcel.has(normKey)) {
          const existing = aggregatedExcel.get(normKey);
          existing.stock += item.stock;
          if (!existing.name && item.name) existing.name = item.name;
        } else {
          aggregatedExcel.set(normKey, { ...item });
        }
      }
      const excelItems = Array.from(aggregatedExcel.values());

      const matchedSystemPartIds = new Set();
      const comparisonList = [];

      // 1. Process Excel items
      for (const excelItem of excelItems) {
        const excelNorm = cleanSku(excelItem.sku);
        let systemPart = parts.find(p => cleanSku(p.sku) === excelNorm);
        if (!systemPart && excelItem.name && excelItem.name.trim().length > 2) {
          systemPart = parts.find(p => p.name.trim().toLocaleLowerCase("tr") === excelItem.name.trim().toLocaleLowerCase("tr"));
        }

        const excelStock = Number(excelItem.stock) || 0;
        if (systemPart) {
          matchedSystemPartIds.add(systemPart.id);
          const systemStock = Number(systemPart.stock) || 0;
          const diff = excelStock - systemStock;
          comparisonList.push({
            sku: excelItem.sku || systemPart.sku,
            name: excelItem.name || systemPart.name,
            excelStock: excelStock,
            systemStock: systemStock,
            diff: diff,
            status: diff === 0 ? "matched" : "diff",
            partId: systemPart.id,
          });
        } else {
          comparisonList.push({
            sku: excelItem.sku,
            name: excelItem.name || "",
            excelStock: excelStock,
            systemStock: null,
            diff: excelStock,
            status: "missing_in_system",
            partId: null,
          });
        }
      }

      // 2. Process system parts missing from Excel
      for (const part of parts) {
        if (!matchedSystemPartIds.has(part.id)) {
          const systemStock = Number(part.stock) || 0;
          comparisonList.push({
            sku: part.sku,
            name: part.name,
            excelStock: null,
            systemStock: systemStock,
            diff: -systemStock,
            status: "missing_in_excel",
            partId: part.id,
          });
        }
      }

      setComparisons(comparisonList);

      const hasDiscrepancy = comparisonList.some(c => c.status !== "matched");
      if (hasDiscrepancy) {
        setActiveTab("unmatched");
      } else {
        setActiveTab("all");
      }
    } catch (error) {
      console.error("Excel okuma hatası:", error);
      alert("Excel dosyası okunamadı. Lütfen dosya formatını kontrol edin.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setComparisons([]);
    setFileName("");
    setSearchQuery("");
    setActiveTab("all");
  }

  const diffParts = comparisons.filter(c => c.status === "diff");
  const missingInSystemParts = comparisons.filter(c => c.status === "missing_in_system");
  const missingInExcelParts = comparisons.filter(c => c.status === "missing_in_excel");
  const matchedParts = comparisons.filter(c => c.status === "matched");
  const unmatchedParts = comparisons.filter(c => c.status !== "matched");

  const query = searchQuery.trim().toLocaleLowerCase("tr");
  const filteredList = comparisons.filter(item => {
    if (activeTab === "unmatched" && item.status === "matched") return false;
    if (activeTab === "diff" && item.status !== "diff") return false;
    if (activeTab === "missing_in_system" && item.status !== "missing_in_system") return false;
    if (activeTab === "missing_in_excel" && item.status !== "missing_in_excel") return false;
    if (activeTab === "matched" && item.status !== "matched") return false;

    if (query) {
      const matchSku = item.sku.toLocaleLowerCase("tr").includes(query) || cleanSku(item.sku).includes(cleanSku(query));
      const matchName = (item.name || "").toLocaleLowerCase("tr").includes(query);
      if (!matchSku && !matchName) return false;
    }
    return true;
  });

  return h("section", { className: "stock-compare" },
    h("div", { className: "compare-header-row" },
      h("div", null,
        h("h2", null, "Stok Karşılaştırma"),
        h("p", null, "Excel dosyasındaki sayım ile sistemdeki stokları karşılaştırın, eşleşmeyenleri ve farkları anında tespit edin.")
      ),
      comparisons.length > 0 ? h("button", {
        className: "button button-secondary button-small",
        onClick: handleReset,
        type: "button"
      }, h(Icon, { name: "close", size: 14 }), "Yeni Dosya Yükle") : null
    ),

    comparisons.length === 0 ? h("div", { className: "upload-section" },
      h("label", { className: "upload-label" },
        h("input", {
          type: "file",
          accept: ".xlsx,.xls,.csv",
          onChange: handleFileUpload,
          disabled: loading
        }),
        h("div", { className: "upload-content" },
          h(Icon, { name: "box", size: 36 }),
          h("span", null, loading ? "Excel okunuyor ve karşılaştırılıyor..." : fileName || "Excel dosyasını seçin veya buraya sürükleyin"),
          h("small", null, ".xlsx, .xls veya .csv formatı (Stok Kodu, Parça Adı, Miktar)")
        )
      )
    ) : null,

    comparisons.length > 0 ? h(React.Fragment, null,
      h("div", { className: "compare-metrics-grid" },
        h("div", {
          className: `compare-metric-card is-unmatched ${activeTab === "unmatched" ? "active" : ""}`,
          onClick: () => setActiveTab("unmatched"),
          style: { cursor: "pointer" }
        },
          h("span", { className: "compare-metric-label" }, "Eşleşmeyen / Farklı"),
          h("strong", { className: "compare-metric-num" }, unmatchedParts.length),
          h("span", { className: "compare-metric-sub" }, "İnceleme gerekenler")
        ),
        h("div", {
          className: `compare-metric-card is-diff ${activeTab === "diff" ? "active" : ""}`,
          onClick: () => setActiveTab("diff"),
          style: { cursor: "pointer" }
        },
          h("span", { className: "compare-metric-label" }, "Stok Farkı Olan"),
          h("strong", { className: "compare-metric-num" }, diffParts.length),
          h("span", { className: "compare-metric-sub" }, "Sayımlar uyuşmuyor")
        ),
        h("div", {
          className: `compare-metric-card is-missing-system ${activeTab === "missing_in_system" ? "active" : ""}`,
          onClick: () => setActiveTab("missing_in_system"),
          style: { cursor: "pointer" }
        },
          h("span", { className: "compare-metric-label" }, "Sistemde Olmayan"),
          h("strong", { className: "compare-metric-num" }, missingInSystemParts.length),
          h("span", { className: "compare-metric-sub" }, "Excel'de var, sistemde yok")
        ),
        h("div", {
          className: `compare-metric-card is-missing-excel ${activeTab === "missing_in_excel" ? "active" : ""}`,
          onClick: () => setActiveTab("missing_in_excel"),
          style: { cursor: "pointer" }
        },
          h("span", { className: "compare-metric-label" }, "Excel'de Olmayan"),
          h("strong", { className: "compare-metric-num" }, missingInExcelParts.length),
          h("span", { className: "compare-metric-sub" }, "Sistemde kayıtlı, Excel'de yok")
        ),
        h("div", {
          className: `compare-metric-card is-matched ${activeTab === "matched" ? "active" : ""}`,
          onClick: () => setActiveTab("matched"),
          style: { cursor: "pointer" }
        },
          h("span", { className: "compare-metric-label" }, "Birebir Eşleşen"),
          h("strong", { className: "compare-metric-num" }, matchedParts.length),
          h("span", { className: "compare-metric-sub" }, "Stok adetleri birebir aynı")
        )
      ),

      h("div", { className: "compare-toolbar" },
        h("div", { className: "compare-tabs" },
          h("button", {
            type: "button",
            className: `compare-tab-btn ${activeTab === "all" ? "active" : ""}`,
            onClick: () => setActiveTab("all")
          }, "Tümü", h("span", { className: "compare-tab-badge" }, comparisons.length)),
          h("button", {
            type: "button",
            className: `compare-tab-btn ${activeTab === "unmatched" ? "active" : ""}`,
            onClick: () => setActiveTab("unmatched")
          }, "Tüm Farklar", h("span", { className: "compare-tab-badge" }, unmatchedParts.length)),
          h("button", {
            type: "button",
            className: `compare-tab-btn ${activeTab === "diff" ? "active" : ""}`,
            onClick: () => setActiveTab("diff")
          }, "Stok Farkı", h("span", { className: "compare-tab-badge" }, diffParts.length)),
          h("button", {
            type: "button",
            className: `compare-tab-btn ${activeTab === "missing_in_system" ? "active" : ""}`,
            onClick: () => setActiveTab("missing_in_system")
          }, "Sistemde Yok", h("span", { className: "compare-tab-badge" }, missingInSystemParts.length)),
          h("button", {
            type: "button",
            className: `compare-tab-btn ${activeTab === "missing_in_excel" ? "active" : ""}`,
            onClick: () => setActiveTab("missing_in_excel")
          }, "Excel'de Yok", h("span", { className: "compare-tab-badge" }, missingInExcelParts.length)),
          h("button", {
            type: "button",
            className: `compare-tab-btn ${activeTab === "matched" ? "active" : ""}`,
            onClick: () => setActiveTab("matched")
          }, "Eşleşen", h("span", { className: "compare-tab-badge" }, matchedParts.length))
        ),
        h("div", { className: "search-input-wrap", style: { minWidth: "220px" } },
          h("input", {
            type: "search",
            value: searchQuery,
            onChange: (e) => setSearchQuery(e.target.value),
            placeholder: "SKU veya parça adı ara...",
            className: "filter-search"
          })
        )
      ),

      h("div", { className: "table-scroll" },
        h("table", null,
          h("thead", null,
            h("tr", null,
              ["DURUM", "STOK KODU (SKU)", "PARÇA ADI", "EXCEL SAYIM", "SİSTEM STOK", "FARK", "İŞLEM"].map((label) => h("th", { key: label }, label))
            )
          ),
          h("tbody", null,
            filteredList.length === 0
              ? h("tr", null, h("td", { colSpan: 7, className: "empty-state compact-empty" }, "Seçili filtre veya aramaya uygun parça bulunamadı."))
              : filteredList.map((item, index) => {
                  const rowClass = item.status === "missing_in_system"
                    ? "compare-row-missing-system"
                    : item.status === "missing_in_excel"
                    ? "compare-row-missing-excel"
                    : item.status === "diff"
                    ? "compare-row-diff"
                    : "";

                  const badgeClass = item.status === "missing_in_system"
                    ? "status-missing-system"
                    : item.status === "missing_in_excel"
                    ? "status-missing-excel"
                    : item.status === "diff"
                    ? "status-diff"
                    : "status-matched";

                  const badgeLabel = item.status === "missing_in_system"
                    ? "Sistemde Yok"
                    : item.status === "missing_in_excel"
                    ? "Excel'de Yok"
                    : item.status === "diff"
                    ? "Stok Farkı"
                    : "Eşleşti";

                  return h("tr", { key: `${item.sku}-${item.status}-${index}`, className: rowClass },
                    h("td", null, h("span", { className: `compare-status-badge ${badgeClass}` }, badgeLabel)),
                    h("td", null, h("strong", null, item.sku)),
                    h("td", null, item.name || h("span", { className: "text-muted" }, "—")),
                    h("td", null, item.excelStock !== null ? `${item.excelStock} adet` : h("span", { className: "text-muted" }, "—")),
                    h("td", null, item.systemStock !== null ? `${item.systemStock} adet` : h("span", { className: "text-muted" }, "—")),
                    h("td", null,
                      item.status === "matched"
                        ? h("span", { className: "diff-zero" }, "0")
                        : item.status === "missing_in_system"
                        ? h("span", { className: "diff-positive" }, `+${item.excelStock} (Yeni)`)
                        : item.status === "missing_in_excel"
                        ? h("span", { className: "diff-negative" }, `-${item.systemStock}`)
                        : item.diff > 0
                        ? h("span", { className: "diff-positive" }, `+${item.diff}`)
                        : h("span", { className: "diff-negative" }, `${item.diff}`)
                    ),
                    h("td", null,
                      item.status === "missing_in_system" && openModal
                        ? h("button", {
                            className: "button button-small button-primary",
                            type: "button",
                            onClick: () => openModal("part", {
                              sku: item.sku,
                              name: item.name || "",
                              stock: item.excelStock || 0,
                              minimum: 5,
                              cost: 0,
                              price: 0
                            })
                          }, h(Icon, { name: "plus", size: 14 }), "Envantere Ekle")
                        : h("span", { className: "text-muted" }, "—")
                    )
                  );
                })
          )
        )
      )
    ) : null
  );
}

// Kullanıcının kendi ekranından elle girdiği (eDMS kökenli OLMAYAN) iş
// emirlerini listeler ve KALICI silme için açık, yazılı bir onayister.
// Geri alınamaz bir işlem olduğu için varsayılan olarak hiçbir kayıt
// seçili/silinebilir değildir; önce önizleme, sonra "SİL" yazarak onay gerekir.
function ManualJobCleanup({ jobs = [], onCleanup, saving }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState(null);

  const manualJobs = selectManualWorkOrders(jobs);
  const summary = summarizeManualWorkOrders(manualJobs, { edmsDataFrom: "2026-06-25", edmsDataTo: "2026-10-30" });
  const canDelete = expanded && confirmText.trim().toLocaleUpperCase("tr") === "SİL" && manualJobs.length > 0;

  async function handleDelete() {
    if (!canDelete) return;
    const confirmed = window.confirm(
      `${manualJobs.length} elle girilmiş iş emri KALICI olarak silinecek (toplam ${summary.totalRevenue.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL ciro). Bu işlem geri alınamaz. Devam edilsin mi?`
    );
    if (!confirmed) return;
    await onCleanup(manualJobs.map((j) => j.id), (res) => { setResult(res); setExpanded(false); setConfirmText(""); });
  }

  return h("div", null,
    h("div", { className: "compare-header-row" },
      h("div", null,
        h("h2", null, "Elle Girilen İş Emirlerini Temizle"),
        h("p", null, "Uygulamanın kendi ekranından (eDMS dışından) girilmiş iş emirleri mükerrer kayıt ve ciro farkına yol açabilir. Aşağıda bu kayıtların önizlemesi var; silmeden önce eDMS verilerinin (Müşteri Listeleme + Fatura Raporu) güncel olduğundan emin olun.")
      )
    ),
    h("div", { className: "compare-metrics-grid" },
      h("div", { className: "compare-metric-card is-unmatched" },
        h("span", { className: "compare-metric-label" }, "Elle Girilmiş İş Emri"),
        h("strong", { className: "compare-metric-num" }, manualJobs.length),
        h("span", { className: "compare-metric-sub" }, "eDMS kökenli değil")
      ),
      h("div", { className: "compare-metric-card is-diff" },
        h("span", { className: "compare-metric-label" }, "Toplam Ciro (KDV hariç)"),
        h("strong", { className: "compare-metric-num" }, summary.totalRevenue.toLocaleString("tr-TR", { minimumFractionDigits: 2 })),
        h("span", { className: "compare-metric-sub" }, "Silinecek kayıtların toplamı")
      ),
      h("div", { className: "compare-metric-card is-missing-system" },
        h("span", { className: "compare-metric-label" }, "Tarih Aralığı"),
        h("strong", { className: "compare-metric-num", style: { fontSize: "16px" } }, summary.dateFrom ? `${summary.dateFrom} → ${summary.dateTo}` : "—"),
        h("span", { className: "compare-metric-sub" }, "")
      )
    ),

    summary.outsideEdmsRange.length > 0 ? h("div", { className: "paste-result paste-result-error" },
      h("strong", null, `${summary.outsideEdmsRange.length} kayıt, eDMS Fatura Raporu'nun kapsadığı tarih aralığının (2026-06-25 → 2026-10-30) DIŞINDA`),
      h("p", null, "Bu kayıtlar silinirse yerine eDMS'ten gelecek bir karşılık olmayabilir — o dönemin verisi eDMS'te yoksa bu iş emirleri kalıcı olarak kaybolur.")
    ) : null,

    manualJobs.length > 0 ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["KOD", "PLAKA", "MÜŞTERİ", "TARİH", "DURUM", "TUTAR"].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, manualJobs.slice(0, 50).map((job) =>
          h("tr", { key: job.id },
            h("td", null, job.code || job.id),
            h("td", null, job.plate),
            h("td", null, job.customer),
            h("td", null, job.date),
            h("td", null, job.status),
            h("td", null, Number(job.total || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 }))
          )
        ))
      )
    ) : h("p", { className: "text-muted" }, "Elle girilmiş iş emri bulunamadı."),
    manualJobs.length > 50 ? h("p", { className: "text-muted" }, `… ve ${manualJobs.length - 50} kayıt daha.`) : null,

    manualJobs.length > 0 ? h("div", { style: { marginTop: "16px" } },
      !expanded ? h("button", { className: "button button-secondary", type: "button", onClick: () => setExpanded(true) }, "Silme İşlemini Başlat") :
        h("div", null,
          h("p", { className: "form-notice" }, `Onaylamak için aşağıya "SİL" yazın. Bu işlem ${manualJobs.length} iş emrini ve ilgili stok hareketlerini geri alınamaz şekilde kaldırır.`),
          h("input", {
            type: "text",
            value: confirmText,
            onChange: (e) => setConfirmText(e.target.value),
            placeholder: "SİL",
            style: { maxWidth: "160px", marginRight: "8px" }
          }),
          h("button", { className: "button button-danger", type: "button", disabled: !canDelete || saving, onClick: handleDelete },
            saving ? "Siliniyor…" : `${manualJobs.length} İş Emrini Kalıcı Sil`),
          h("button", { className: "button button-secondary button-small", type: "button", style: { marginLeft: "8px" }, onClick: () => { setExpanded(false); setConfirmText(""); } }, "Vazgeç")
        )
    ) : null,

    result ? h("p", { className: "form-notice", role: "status" },
      `${result.deleted} iş emri silindi.` + (result.failed.length ? ` ${result.failed.length} kayıt silinemedi.` : "") + (result.warnings.length ? ` ${result.warnings.length} uyarı oluştu (stok iadesi eksik olabilir).` : "")
    ) : null
  );
}

// Ekim 2026 dışında kalmış, hiç parça/işçilik girilmemiş (tamamen boş) eski
// "Devam ediyor" iş emirlerini listeler ve toplu silme başlatır. Tarihi ne
// olursa olsun GERÇEK veri (parça/işçilik/tutar) içeren açık kayıtlara bu
// panel hiç dokunmaz — onlar ayrı, salt bilgi amaçlı bir listede gösterilir.
function StaleOpenJobCleanup({ jobs = [], onCleanup, saving }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState(null);

  const staleJobs = selectStaleOpenWorkOrders(jobs, { keepMonthPrefix: STALE_OPEN_JOB_KEEP_MONTH });
  const needsReview = selectOpenWorkOrdersNeedingReview(jobs, { keepMonthPrefix: STALE_OPEN_JOB_KEEP_MONTH });
  const summary = summarizeStaleOpenWorkOrders(staleJobs);
  const canDelete = expanded && confirmText.trim().toLocaleUpperCase("tr") === "SİL" && staleJobs.length > 0;

  if (!staleJobs.length && !needsReview.length && !result) return null;

  async function handleDelete() {
    if (!canDelete) return;
    await onCleanup((res) => { setResult(res); setExpanded(false); setConfirmText(""); });
  }

  return h("div", { style: { marginBottom: "28px" } },
    h("div", { className: "compare-header-row" },
      h("div", null,
        h("h2", null, "Eski Açık İş Emirlerini Temizle"),
        h("p", null, `${STALE_OPEN_JOB_KEEP_MONTH} dışında kalmış, hiç parça/işçilik girilmemiş (toplamı da 0 olan) açık iş emirleri — muhtemelen zamanında kapatılmamış eski kayıtlar. Bu panel SADECE tamamen boş kayıtları siler; gerçek veri içeren hiçbir açık iş emrine (tarihi ne olursa olsun) dokunmaz.`)
      )
    ),
    h("div", { className: "compare-metrics-grid" },
      h("div", { className: "compare-metric-card is-unmatched" },
        h("span", { className: "compare-metric-label" }, "Silinecek Boş Açık İş Emri"),
        h("strong", { className: "compare-metric-num" }, staleJobs.length),
        h("span", { className: "compare-metric-sub" }, `${STALE_OPEN_JOB_KEEP_MONTH} dışında, 0 parça / 0 işçilik / ₺0`)
      ),
      h("div", { className: "compare-metric-card is-missing-system" },
        h("span", { className: "compare-metric-label" }, "Tarih Aralığı"),
        h("strong", { className: "compare-metric-num", style: { fontSize: "16px" } }, summary.dateFrom ? `${summary.dateFrom} → ${summary.dateTo}` : "—"),
        h("span", { className: "compare-metric-sub" }, "")
      )
    ),

    needsReview.length > 0 ? h("div", { className: "paste-result paste-result-error" },
      h("strong", null, `${needsReview.length} açık iş emri ${STALE_OPEN_JOB_KEEP_MONTH} dışında ama GERÇEK veri içeriyor — otomatik silinMEDİ, elle gözden geçirin:`),
      h("ul", null, needsReview.map((job) => h("li", { key: job.id },
        `${job.code || job.id} · ${job.date} · ${job.customer || ""} · ${(job.items || []).length} parça kalemi · ₺${Number(job.total || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`
      )))
    ) : null,

    staleJobs.length > 0 ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["KOD", "PLAKA", "MÜŞTERİ", "TARİH"].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, staleJobs.slice(0, 80).map((job) =>
          h("tr", { key: job.id },
            h("td", null, job.code || job.id),
            h("td", null, job.plate),
            h("td", null, job.customer),
            h("td", null, job.date)
          )
        ))
      )
    ) : null,
    staleJobs.length > 80 ? h("p", { className: "text-muted" }, `… ve ${staleJobs.length - 80} kayıt daha.`) : null,

    staleJobs.length > 0 ? h("div", { style: { marginTop: "16px" } },
      !expanded ? h("button", { className: "button button-secondary", type: "button", onClick: () => setExpanded(true) }, "Silme İşlemini Başlat") :
        h("div", null,
          h("p", { className: "form-notice" }, `Onaylamak için aşağıya "SİL" yazın. Bu işlem ${staleJobs.length} boş iş emrini geri alınamaz şekilde kaldırır.`),
          h("input", {
            type: "text",
            value: confirmText,
            onChange: (e) => setConfirmText(e.target.value),
            placeholder: "SİL",
            style: { maxWidth: "160px", marginRight: "8px" }
          }),
          h("button", { className: "button button-danger", type: "button", disabled: !canDelete || saving, onClick: handleDelete },
            saving ? "Siliniyor…" : `${staleJobs.length} İş Emrini Kalıcı Sil`),
          h("button", { className: "button button-secondary button-small", type: "button", style: { marginLeft: "8px" }, onClick: () => { setExpanded(false); setConfirmText(""); } }, "Vazgeç")
        )
    ) : null,

    result ? h("p", { className: "form-notice", role: "status" },
      `${result.deleted} iş emri silindi.` + (result.failed.length ? ` ${result.failed.length} kayıt silinemedi.` : "") + (result.warnings.length ? ` ${result.warnings.length} uyarı oluştu.` : "")
    ) : null
  );
}

// Kullanıcının isteğiyle: eDMS'in canlı İş Emri ekranında hâlâ açık ama
// uygulamada hiç karşılığı olmayan Ekim 2026 iş emirlerini
// (MISSING_OCTOBER_JOBS), eDMS'teki "Planlanan" parça/işçilik verileriyle
// birlikte tek seferlik ekler. Stok düşülmez (bkz. missingOctoberJobs.js);
// bu iş emirleri henüz faturalanmadığı için `total` ₺0 kalır — gerçek fatura
// geldiğinde normal eDMS zenginleştirme akışı bunu otomatik tamamlayacaktır.
// Eklenecek kayıt kalmayınca (hepsi zaten eklenmişse) panel kendiliğinden
// gizlenir.
function MissingOctoberJobsPanel({ jobs = [], parts = [], onCreate, saving }) {
  const [result, setResult] = useState(null);
  const pendingDefs = selectMissingOctoberJobDefs(MISSING_OCTOBER_JOBS, jobs);
  if (!pendingDefs.length && !result) return null;

  const summary = summarizeMissingOctoberJobs(pendingDefs);
  const preview = pendingDefs.length ? buildMissingOctoberJobRecords(pendingDefs, parts) : null;

  async function handleCreate() {
    const confirmed = window.confirm(
      `${pendingDefs.length} eksik iş emri, eDMS'teki "Planlanan" parça/işçilik verileriyle birlikte eklenecek. Bu iş emirleri henüz faturalanmadığı için tutar ₺0 olarak görünecek ve stok düşülmeyecek. Devam edilsin mi?`
    );
    if (!confirmed) return;
    await onCreate((res) => setResult(res));
  }

  return h("div", { style: { marginBottom: "28px" } },
    h("div", { className: "compare-header-row" },
      h("div", null,
        h("h2", null, "Eksik Ekim İş Emirlerini Ekle"),
        h("p", null, "eDMS'in canlı İş Emri ekranında hâlâ açık görünen ama uygulamada hiç kaydı olmayan iş emirleri, eDMS'teki planlanan parça/işçilik satırlarıyla birlikte eklenir. Henüz faturalanmadıkları için tutar ₺0 görünür ve stok düşülmez; gerçek fatura geldiğinde normal eDMS zenginleştirme akışı bunları otomatik tamamlayacaktır.")
      )
    ),

    pendingDefs.length > 0 ? h("div", { className: "compare-metrics-grid" },
      h("div", { className: "compare-metric-card is-missing-system" },
        h("span", { className: "compare-metric-label" }, "Eklenecek İş Emri"),
        h("strong", { className: "compare-metric-num" }, summary.count)
      ),
      h("div", { className: "compare-metric-card is-diff" },
        h("span", { className: "compare-metric-label" }, "Parça Kalemi"),
        h("strong", { className: "compare-metric-num" }, summary.partLineCount)
      ),
      h("div", { className: "compare-metric-card is-matched" },
        h("span", { className: "compare-metric-label" }, "İşçilik Kalemi"),
        h("strong", { className: "compare-metric-num" }, summary.laborLineCount)
      )
    ) : null,

    pendingDefs.length > 0 ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["İŞ EMRİ", "PLAKA", "MÜŞTERİ", "TARİH", "PARÇA", "İŞÇİLİK"].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, pendingDefs.map((def) =>
          h("tr", { key: def.externalId },
            h("td", null, `EDMS-${def.externalId}`),
            h("td", null, def.header.plate),
            h("td", null, def.header.customer),
            h("td", null, def.header.date),
            h("td", null, def.lines.filter((l) => l.kind === "Stok").length),
            h("td", null, def.lines.filter((l) => l.kind === "Hizmet").length ? "Var" : "—")
          )
        ))
      )
    ) : null,

    preview && preview.newParts.length > 0 ? h("div", { className: "paste-result paste-result-error" },
      h("strong", null, `${preview.newParts.length} parça kodu envanterde bulunamadı, 0 stokla yeni kart olarak eklenecek:`),
      h("ul", null, preview.newParts.map((p) => h("li", { key: p.id }, `${p.sku} — ${p.name} (₺${Number(p.price).toLocaleString("tr-TR", { minimumFractionDigits: 2 })})`)))
    ) : null,

    pendingDefs.length > 0 ? h("button", { className: "button button-primary", type: "button", disabled: saving, onClick: handleCreate, style: { marginTop: "12px" } },
      saving ? "Ekleniyor…" : `${pendingDefs.length} Eksik İş Emrini Ekle`) : null,

    result ? h("p", { className: "form-notice", role: "status" },
      `${result.created} iş emri eklendi.` + (result.newParts ? ` ${result.newParts} yeni parça kartı oluşturuldu.` : "") + (result.warnings.length ? ` ${result.warnings.length} uyarı oluştu.` : "")
    ) : null
  );
}

// KNOWN_KDV_DOUBLING_FIXES listesindeki, KDV'nin iki kez uygulandığı tespit
// edilmiş iş emirlerini gösterir ve tek seferlik tutar düzeltmesini
// başlatır. Düzeltilecek kayıt kalmayınca (tüm iş emirlerinin `total`'ı
// zaten doğru değere yakın olunca) panel kendiliğinden gizlenir.
function KdvDoublingFixPanel({ jobs = [], onFix, saving }) {
  const [result, setResult] = useState(null);
  const jobsByCode = new Map(jobs.map((j) => [j.code, j]));
  const pending = KNOWN_KDV_DOUBLING_FIXES.filter((fix) => {
    const job = jobsByCode.get(fix.jobCode);
    if (!job) return false;
    return Math.abs((Number(job.total) || 0) - fix.correctTotal) >= 0.01;
  });
  if (!pending.length && !result) return null;

  async function handleFix() {
    const confirmed = window.confirm(
      `${pending.length} iş emrinin tutarı, eDMS'teki gerçek fatura tutarına göre düzeltilecek (KDV'nin iki kez uygulandığı hata). Devam edilsin mi?`
    );
    if (!confirmed) return;
    await onFix((res) => setResult(res));
  }

  return h("div", { style: { marginBottom: "28px" } },
    h("div", { className: "compare-header-row" },
      h("div", null,
        h("h2", null, "KDV İki Kez Uygulanan Kayıtları Düzelt"),
        h("p", null, "Hiç zenginleştirilmemiş (parça/işçilik satırı eklenmemiş) bazı kapalı iş emirlerinde, eski içe aktarma kodu eDMS'in KDV DAHİL fatura tutarını KDV HARİÇ (net) tutar yerine yazmıştı. Ekranda bu yüzden gerçek tutarın %20 fazlası görünüyordu. Bu panel sadece tutarı düzeltir; parça/işçilik satırı eklemez.")
      )
    ),
    pending.length > 0 ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["İŞ EMRİ", "AÇIKLAMA", "ŞU AN (KDV HARİÇ)", "OLMASI GEREKEN (KDV HARİÇ)"].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, pending.map((fix) => {
          const job = jobsByCode.get(fix.jobCode);
          return h("tr", { key: fix.jobCode },
            h("td", null, fix.jobCode),
            h("td", null, fix.label),
            h("td", null, (Number(job.total) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 })),
            h("td", null, fix.correctTotal.toLocaleString("tr-TR", { minimumFractionDigits: 2 }))
          );
        }))
      )
    ) : null,
    pending.length > 0 ? h("button", { className: "button button-danger", type: "button", disabled: saving, onClick: handleFix, style: { marginTop: "12px" } },
      saving ? "Düzeltiliyor…" : `${pending.length} İş Emrinin Tutarını Düzelt`) : null,
    result ? h("p", { className: "form-notice", role: "status" },
      `${result.fixed.length} iş emrinin tutarı düzeltildi.` + (result.skipped.length ? ` ${result.skipped.length} kayıt atlandı.` : "")
    ) : null
  );
}

// Hata düzeltmesi: açık (Devam ediyor) iş emirlerine eski stok politikasıyla uygulanan bir geçişin ilk sürümü, eDMS'in
// "Planlanan" ekranından elle aktarılmış (plannedFromEdmsAt), henüz
// faturalanmamış iş emirlerini de yanlışlıkla "eski davranışla stoğu
// düşülmüş" sayıp parçalarını stoğa geri yatırmıştı — oysa bu kayıtlar
// zaten hiç düşülmemişti, yani stoğa hayalet bir miktar eklenmiş oldu. Bu
// panel o hatayı geri alır. Düzeltilecek kayıt kalmayınca kendiliğinden
// gizlenir.
function PlannedEdmsStockRestorationUndoPanel({ jobs = [], parts = [], onUndo, saving }) {
  const [result, setResult] = useState(null);
  const preview = buildPlannedEdmsJobStockRestorationUndo(jobs, parts);
  if (!preview.jobCount && !result) return null;

  async function handleUndo() {
    const confirmed = window.confirm(
      `${preview.jobCount} planlanan eDMS iş emrindeki ${preview.corrections.length} parça için hatalı stok iadesi geri alınacak (stoktan tekrar düşülecek). Devam edilsin mi?`
    );
    if (!confirmed) return;
    await onUndo((res) => setResult(res));
  }

  return h("div", { style: { marginBottom: "28px" } },
    h("div", { className: "compare-header-row" },
      h("div", null,
        h("h2", null, "Hatalı Stok İadesini Geri Al (Planlanan eDMS İş Emirleri)"),
        h("p", null, "Yukarıdaki stok politikası geçişi, eDMS'in \"Planlanan\" ekranından elle aktarılmış ve zaten hiç stok düşülmemiş iş emirlerini de yanlışlıkla geri yatırmıştı. Bu panel o hatayı düzeltir.")
      )
    ),
    preview.corrections.length > 0 ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["PARÇA", "SKU", "DÜZELTİLECEK ADET", "STOK (ŞU AN → DÜZELTİLMİŞ)", "İŞ EMİRLERİ"].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, preview.corrections.map((c) =>
          h("tr", { key: c.partId },
            h("td", null, c.name),
            h("td", null, c.sku),
            h("td", null, c.qty),
            h("td", null, `${c.stockBefore} → ${c.stockAfter}`),
            h("td", null, c.jobCodes.join(", "))
          )
        ))
      )
    ) : null,
    preview.jobCount > 0 ? h("button", { className: "button button-danger", type: "button", disabled: saving, onClick: handleUndo, style: { marginTop: "12px" } },
      saving ? "Düzeltiliyor…" : "Hatalı Stok İadesini Geri Al") : null,
    result ? h("p", { className: "form-notice", role: "status" },
      `${result.correctedJobs} iş emrindeki ${result.correctedParts} parça için hatalı stok iadesi geri alındı.`
    ) : null
  );
}

function EdmsImport({ jobs = [], parts = [], invoices = [], bankoSales = [], saving, onImport, onImportFaturaRaporu, onCleanupManualJobs, onCleanupStaleOpenJobs, onCreateMissingOctoberJobs, onUndoPlannedEdmsRestoration, onFixInvoiceGaps, onFixKdvDoubling }) {
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [parseErrors, setParseErrors] = useState([]);
  const [preview, setPreview] = useState(null); // { toAdd, alreadyPresent }
  const [importedCount, setImportedCount] = useState(null);

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    setImportedCount(null);
    setParseErrors([]);
    setPreview(null);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array", cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: null });
      const { records, errors } = parseEdmsWorkOrderReport(rows);
      setParseErrors(errors);
      const { toAdd, alreadyPresent } = selectEdmsRecordsToImport(records, jobs);
      setPreview({ toAdd, alreadyPresent });
    } catch (error) {
      console.error("eDMS Excel okuma hatası:", error);
      alert("Excel dosyası okunamadı. eDMS'teki \"Müşteri Listeleme\" raporundan \"Excel'e Aktar\" ile aldığınız dosyayı seçtiğinizden emin olun.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setFileName("");
    setParseErrors([]);
    setPreview(null);
    setImportedCount(null);
  }

  async function handleConfirm() {
    if (!preview || !preview.toAdd.length) return;
    await onImport(preview.toAdd, (result) => setImportedCount(result.added));
  }

  return h("section", { className: "stock-compare" },
    h(KdvDoublingFixPanel, { jobs, onFix: onFixKdvDoubling, saving }),
    h(PlannedEdmsStockRestorationUndoPanel, { jobs, parts, onUndo: onUndoPlannedEdmsRestoration, saving }),
    h(MissingOctoberJobsPanel, { jobs, parts, onCreate: onCreateMissingOctoberJobs, saving }),
    h(StaleOpenJobCleanup, { jobs, onCleanup: onCleanupStaleOpenJobs, saving }),
    h(ManualJobCleanup, { jobs, onCleanup: onCleanupManualJobs, saving }),
    h("hr", { style: { margin: "28px 0" } }),
    h("div", { className: "compare-header-row" },
      h("div", null,
        h("h2", null, "eDMS'ten İçe Aktar"),
        h("p", null, "EUROREPAR eDMS'teki \"Müşteri Listeleme\" raporunu (Excel'e Aktar) yükleyin; plaka/şasi numarasına göre eşleştirip sadece uygulamada eksik olan iş emirlerini ekler.")
      ),
      (preview || fileName) ? h("button", {
        className: "button button-secondary button-small",
        onClick: handleReset,
        type: "button"
      }, h(Icon, { name: "close", size: 14 }), "Yeni Dosya Yükle") : null
    ),

    !preview ? h("div", { className: "upload-section" },
      h("label", { className: "upload-label" },
        h("input", {
          type: "file",
          accept: ".xlsx,.xls",
          onChange: handleFileUpload,
          disabled: loading
        }),
        h("div", { className: "upload-content" },
          h(Icon, { name: "box", size: 36 }),
          h("span", null, loading ? "Excel okunuyor ve karşılaştırılıyor..." : fileName || "eDMS Excel dosyasını seçin veya buraya sürükleyin"),
          h("small", null, "eDMS → Müşteri Listeleme → Excel'e Aktar ile aldığınız .xlsx dosyası")
        )
      )
    ) : null,

    parseErrors.length > 0 ? h("div", { className: "paste-result paste-result-error" },
      h("strong", null, `${parseErrors.length} satır atlandı`),
      h("ul", null, parseErrors.slice(0, 20).map((message, index) => h("li", { key: index }, message))),
      parseErrors.length > 20 ? h("p", null, `… ve ${parseErrors.length - 20} satır daha.`) : null
    ) : null,

    preview ? h(React.Fragment, null,
      h("div", { className: "compare-metrics-grid" },
        h("div", { className: "compare-metric-card is-missing-system" },
          h("span", { className: "compare-metric-label" }, "Eklenecek Yeni İş Emri"),
          h("strong", { className: "compare-metric-num" }, preview.toAdd.length),
          h("span", { className: "compare-metric-sub" }, "Uygulamada eksik olanlar")
        ),
        h("div", { className: "compare-metric-card is-matched" },
          h("span", { className: "compare-metric-label" }, "Zaten Mevcut"),
          h("strong", { className: "compare-metric-num" }, preview.alreadyPresent.length),
          h("span", { className: "compare-metric-sub" }, "Plaka/şasi ile eşleşti, atlanacak")
        ),
        h("div", { className: "compare-metric-card is-diff" },
          h("span", { className: "compare-metric-label" }, "Kapalı (Faturalı)"),
          h("strong", { className: "compare-metric-num" }, preview.toAdd.filter((r) => r.status === "closed").length),
          h("span", { className: "compare-metric-sub" }, "Ciroya dahil edilecek")
        ),
        h("div", { className: "compare-metric-card is-unmatched" },
          h("span", { className: "compare-metric-label" }, "Halen Açık"),
          h("strong", { className: "compare-metric-num" }, preview.toAdd.filter((r) => r.status === "open").length),
          h("span", { className: "compare-metric-sub" }, "Henüz faturalanmadı")
        )
      ),

      preview.toAdd.length > 0 ? h("div", { className: "table-scroll" },
        h("table", null,
          h("thead", null,
            h("tr", null,
              ["İŞ EMRİ NO", "PLAKA", "MÜŞTERİ", "ARAÇ", "TARİH", "DURUM", "TUTAR (KDV HARİÇ)"].map((label) => h("th", { key: label }, label))
            )
          ),
          h("tbody", null,
            preview.toAdd.slice(0, 50).map((record) =>
              h("tr", { key: record.externalId },
                h("td", null, record.externalId),
                h("td", null, record.plate),
                h("td", null, record.customer),
                h("td", null, [record.make, record.model].filter(Boolean).join(" ")),
                h("td", null, record.date),
                h("td", null, record.status === "closed" ? "Tamamlandı" : "Devam ediyor"),
                h("td", null, record.status === "closed" ? record.total.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : "—")
              )
            )
          )
        )
      ) : null,
      preview.toAdd.length > 50 ? h("p", { className: "text-muted" }, `… ve ${preview.toAdd.length - 50} kayıt daha.`) : null,

      h("div", { style: { marginTop: "16px" } },
        h("button", {
          className: "button button-primary",
          disabled: saving || !preview.toAdd.length,
          type: "button",
          onClick: handleConfirm,
        }, saving ? "Aktarılıyor…" : preview.toAdd.length ? `${preview.toAdd.length} İş Emrini İçe Aktar` : "Eklenecek yeni kayıt yok")
      ),

      importedCount !== null ? h("p", { className: "form-notice", role: "status" }, `${importedCount} iş emri başarıyla eklendi. Araç Geçmişi ve Raporlar sayfalarına hemen yansıdı.`) : null
    ) : null,

    h("hr", { style: { margin: "28px 0" } }),
    h(FaturaRaporuImport, { jobs, parts, invoices, bankoSales, saving, onImport: onImportFaturaRaporu, onFixInvoiceGaps })
  );
}

// eDMS "Fatura Raporu" (WDMR010, Form: FATURA RAPORU(DETAY)) Excel çıktısını
// yükler; Satın Alma faturalarını (stok güncelleyerek) ve Satış faturalarının
// parça/işçilik satırlarını (kapsamdaki iş emirlerine ekleyerek) önizler.
function FaturaRaporuImport({ jobs = [], parts = [], invoices = [], bankoSales = [], saving, onImport, onFixInvoiceGaps }) {
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [parseErrors, setParseErrors] = useState([]);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [gapResult, setGapResult] = useState(null);

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    setResult(null);
    setParseErrors([]);
    setPreview(null);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array", cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: null });
      const { invoices: parsedInvoices, errors } = parseFaturaRaporuReport(rows);
      setParseErrors(errors);
      const { sales, purchases } = splitFaturaRaporuByType(parsedInvoices);
      // "Kaynak: YP Banko" olan satışlar hiçbir iş emrine/araca bağlı olmadığı
      // için normal eşleştirmeye hiç girmez (her zaman "eşleşmeyen" çıkardı);
      // bunlar ayrı bir akışla (bankoSales koleksiyonu) takip edilir.
      const { banko, servis } = splitSalesByKaynak(sales);
      const { toAdd: purchasesToAdd, alreadyPresent: purchasesSkipped } = selectPurchaseInvoicesToImport(purchases, invoices);
      const { toAdd: bankoToAdd, alreadyPresent: bankoSkipped } = selectBankoSalesToImport(banko, bankoSales);
      const enrichmentPreview = buildEdmsJobEnrichments(jobs, servis, parts);
      setPreview({
        purchasesToAdd,
        purchasesSkipped,
        enrichmentPreview,
        salesRecords: servis,
        bankoToAdd,
        bankoSkipped,
      });
    } catch (error) {
      console.error("Fatura Raporu Excel okuma hatası:", error);
      alert("Excel dosyası okunamadı. eDMS'teki \"Fatura Raporu\" (WDMR010) çıktısından \"Excel'e Aktar\" ile aldığınız dosyayı seçtiğinizden emin olun.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setFileName("");
    setParseErrors([]);
    setPreview(null);
    setResult(null);
    setGapResult(null);
  }

  async function handleConfirm() {
    if (!preview) return;
    // enrichEdmsJobsWithInvoiceLines (data.js) eşleştirmeyi kendi içinde
    // yeniden çalıştırır; burada sadece ayrıştırılmış ham satış faturası
    // listesinin TAMAMINI iletiyoruz (önizlemedeki eşleşme sonucu değil).
    await onImport({ purchaseRecords: preview.purchasesToAdd, salesRecords: preview.salesRecords, bankoRecords: preview.bankoToAdd }, (res) => setResult(res));
  }

  async function handleFixGaps() {
    if (!preview || !onFixInvoiceGaps) return;
    await onFixInvoiceGaps(preview.salesRecords, (res) => setGapResult(res));
  }

  const warnings = preview ? preview.enrichmentPreview.warnings : [];
  const ambiguous = preview ? preview.enrichmentPreview.ambiguous : [];

  // Bu yüklemedeki faturalar arasından, bilinen-eksik listesindekilerin
  // (KNOWN_INVOICE_GAPS) halihazırda uygulanmamış olanları önizle.
  const jobsById = new Set(jobs.map((j) => j.id));
  const jobsByCodeMap = new Map(jobs.map((j) => [j.code, j]));
  // Zaten zenginleştirilmiş (parça/işçilik satırları girilmiş) eDMS kökenli
  // iş emirlerini, bu yüklenen dosyadaki KENDİ faturalarıyla yeniden
  // hesaplayıp karşılaştıran salt-okunur denetim (hiçbir şey yazmaz).
  const reconciliation = preview ? buildInvoiceReconciliationReport(jobs, preview.salesRecords, parts) : null;

  const gapsPending = preview ? KNOWN_INVOICE_GAPS.filter((gap) => {
    if (!preview.salesRecords.some((s) => s.invoiceNo === gap.invoiceNo)) return false;
    if (gap.action === "newJob") return !jobsById.has(`edms-job-${gap.externalId}`);
    if (gap.action === "appendToJob") {
      const target = jobsByCodeMap.get(gap.jobCode);
      return target && !String(target.edmsInvoiceNo || "").includes(gap.invoiceNo);
    }
    return false;
  }) : [];

  return h("section", { className: "stock-compare" },
    h("div", { className: "compare-header-row" },
      h("div", null,
        h("h2", null, "Fatura Raporu (Alış + Satış) İçe Aktar"),
        h("p", null, "EUROREPAR eDMS'teki \"Fatura Raporu\" (WDMR010) çıktısını yükleyin: Satın Alma faturaları stoğu güncelleyerek içe aktarılır; Satış faturalarının parça/işçilik satırları, kapalı iş emirlerine ve 01.10.2026 sonrası açık iş emirlerine eklenir; \"Kaynak: YP Banko\" olan (iş emrine bağlı olmayan tezgah) satışlar ise ayrıca kaydedilip Raporlar sayfasındaki Toplam Ciro'ya eklenir.")
      ),
      (preview || fileName) ? h("button", {
        className: "button button-secondary button-small",
        onClick: handleReset,
        type: "button"
      }, h(Icon, { name: "close", size: 14 }), "Yeni Dosya Yükle") : null
    ),

    !preview ? h("div", { className: "upload-section" },
      h("label", { className: "upload-label" },
        h("input", {
          type: "file",
          accept: ".xlsx,.xls",
          onChange: handleFileUpload,
          disabled: loading
        }),
        h("div", { className: "upload-content" },
          h(Icon, { name: "box", size: 36 }),
          h("span", null, loading ? "Excel okunuyor ve karşılaştırılıyor..." : fileName || "eDMS Fatura Raporu Excel dosyasını seçin veya buraya sürükleyin"),
          h("small", null, "eDMS → Fatura Raporu (WDMR010) → Excel'e Aktar ile aldığınız dosya")
        )
      )
    ) : null,

    parseErrors.length > 0 ? h("div", { className: "paste-result paste-result-error" },
      h("strong", null, `${parseErrors.length} satır/fatura atlandı`),
      h("ul", null, parseErrors.slice(0, 20).map((message, index) => h("li", { key: index }, message)))
    ) : null,

    preview ? h(React.Fragment, null,
      h("div", { className: "compare-metrics-grid" },
        h("div", { className: "compare-metric-card is-missing-system" },
          h("span", { className: "compare-metric-label" }, "Eklenecek Alış Faturası"),
          h("strong", { className: "compare-metric-num" }, preview.purchasesToAdd.length),
          h("span", { className: "compare-metric-sub" }, "Stok otomatik güncellenecek")
        ),
        h("div", { className: "compare-metric-card is-matched" },
          h("span", { className: "compare-metric-label" }, "Zaten İçe Aktarılmış"),
          h("strong", { className: "compare-metric-num" }, preview.purchasesSkipped.length),
          h("span", { className: "compare-metric-sub" }, "Fatura no eşleşti, atlanacak")
        ),
        h("div", { className: "compare-metric-card is-diff" },
          h("span", { className: "compare-metric-label" }, "Zenginleşecek İş Emri"),
          h("strong", { className: "compare-metric-num" }, preview.enrichmentPreview.enrichments.length),
          h("span", { className: "compare-metric-sub" }, "Kapalı veya 01.10.2026 sonrası açık")
        ),
        h("div", { className: "compare-metric-card is-unmatched" },
          h("span", { className: "compare-metric-label" }, "Eşleşmeyen Satış Faturası"),
          h("strong", { className: "compare-metric-num" }, preview.enrichmentPreview.unmatchedInvoices.length),
          h("span", { className: "compare-metric-sub" }, "İş emriyle ilişkilendirilemedi")
        ),
        h("div", { className: "compare-metric-card is-missing-system" },
          h("span", { className: "compare-metric-label" }, "Eklenecek Banko Satışı"),
          h("strong", { className: "compare-metric-num" }, preview.bankoToAdd.length),
          h("span", { className: "compare-metric-sub" }, "İş emrine bağlı değil, Raporlar'a eklenecek")
        ),
        h("div", { className: "compare-metric-card is-matched" },
          h("span", { className: "compare-metric-label" }, "Zaten İçe Aktarılmış Banko"),
          h("strong", { className: "compare-metric-num" }, preview.bankoSkipped.length),
          h("span", { className: "compare-metric-sub" }, "Fatura no eşleşti, atlanacak")
        )
      ),

      preview.enrichmentPreview.enrichments.length > 0 ? h("div", { className: "table-scroll" },
        h("table", null,
          h("thead", null,
            h("tr", null,
              ["İŞ EMRİ", "FATURA NO", "PARÇA SATIRI", "İŞÇİLİK", "TOPLAM (KDV HARİÇ)", "DURUM"].map((label) => h("th", { key: label }, label))
            )
          ),
          h("tbody", null,
            preview.enrichmentPreview.enrichments.slice(0, 50).map((e) =>
              h("tr", { key: e.jobId },
                h("td", null, e.job.code || e.job.externalId),
                h("td", null, e.invoice.invoiceNo),
                h("td", null, e.patch.items.length),
                h("td", null, e.patch.laborAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })),
                h("td", null, e.patch.total.toLocaleString("tr-TR", { minimumFractionDigits: 2 })),
                h("td", null, e.reconciled ? "✓ Uyuşuyor" : "⚠ Fark var")
              )
            )
          )
        )
      ) : null,
      preview.enrichmentPreview.enrichments.length > 50 ? h("p", { className: "text-muted" }, `… ve ${preview.enrichmentPreview.enrichments.length - 50} kayıt daha.`) : null,

      (warnings.length > 0 || ambiguous.length > 0) ? h("div", { className: "paste-result paste-result-error", style: { marginTop: "12px" } },
        h("strong", null, `${warnings.length + ambiguous.length} uyarı — gözden geçirin`),
        h("ul", null, [
          ...warnings.slice(0, 15).map((message, index) => h("li", { key: `w${index}` }, message)),
          ...ambiguous.slice(0, 10).map((a, index) => h("li", { key: `a${index}` }, `${a.job.code || a.job.id}: ${a.reason} (${a.invoices.map((i) => i.invoiceNo).join(", ")})`)),
        ])
      ) : null,

      reconciliation ? h("div", { style: { marginTop: "28px", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "20px" } },
        h("h3", null, "Mevcut Kayıtların Yeniden Doğrulanması (parça + işçilik + iskonto)"),
        h("p", { className: "text-muted" }, "Daha önce zenginleştirilmiş iş emirleri, bu yüklenen dosyadaki kendi faturalarının satırlarıyla yeniden hesaplanıp karşılaştırıldı. Hiçbir şey yazılmadı — sadece karşılaştırma."),
        h("div", { className: "compare-metrics-grid" },
          h("div", { className: "compare-metric-card is-matched" },
            h("span", { className: "compare-metric-label" }, "Uyuşan İş Emri"),
            h("strong", { className: "compare-metric-num" }, reconciliation.ok.length)
          ),
          h("div", { className: "compare-metric-card is-diff" },
            h("span", { className: "compare-metric-label" }, "Fark Bulunan İş Emri"),
            h("strong", { className: "compare-metric-num" }, reconciliation.mismatches.length)
          ),
          h("div", { className: "compare-metric-card is-unmatched" },
            h("span", { className: "compare-metric-label" }, "Doğrulanamayan İş Emri"),
            h("strong", { className: "compare-metric-num" }, reconciliation.unresolved.length),
            h("span", { className: "compare-metric-sub" }, "Fatura dosyada yok / referans eksik")
          )
        ),
        reconciliation.mismatches.length > 0 ? h("div", { className: "paste-result paste-result-error", style: { marginTop: "12px" } },
          h("strong", null, `${reconciliation.mismatches.length} iş emrinde fark bulundu`),
          h("ul", null, reconciliation.mismatches.map((r) => h("li", { key: r.job.id },
            h("strong", null, `${r.job.code || r.job.id}`), ` (${r.job.customer || ""}): `,
            h("ul", null, r.diffs.map((d, i) => h("li", { key: i }, d)))
          )))
        ) : null,
        reconciliation.unresolved.length > 0 ? h("div", { className: "paste-result", style: { marginTop: "12px" } },
          h("strong", null, `${reconciliation.unresolved.length} iş emri doğrulanamadı`),
          h("ul", null, reconciliation.unresolved.map((r) => h("li", { key: r.job.id }, `${r.job.code || r.job.id} (${r.job.customer || ""}): ${r.message}`)))
        ) : null,
        reconciliation.mismatches.length === 0 && reconciliation.unresolved.length === 0 ? h("p", { className: "form-notice", role: "status" }, "Bu dosyadaki tüm faturalarla eşleşen iş emirleri, kayıtlı parça/işçilik/iskonto/toplamla birebir uyuşuyor.") : null
      ) : null,

      h("div", { style: { marginTop: "16px" } },
        h("button", {
          className: "button button-primary",
          disabled: saving || (!preview.purchasesToAdd.length && !preview.enrichmentPreview.enrichments.length && !preview.bankoToAdd.length),
          type: "button",
          onClick: handleConfirm,
        }, saving ? "Aktarılıyor…" : "Alış Faturalarını, İş Emri Satırlarını ve Banko Satışlarını İçe Aktar")
      ),

      result ? h("p", { className: "form-notice", role: "status" },
        `${result.purchaseResult.imported} alış faturası içe aktarıldı, ${result.enrichResult.updated} iş emrine satır eklendi` +
        (result.enrichResult.newParts ? `, ${result.enrichResult.newParts} yeni stok kartı oluşturuldu` : "") +
        (result.bankoResult && result.bankoResult.imported ? `, ${result.bankoResult.imported} banko satışı eklendi` : "") + "."
      ) : null,

      gapsPending.length > 0 ? h("div", { style: { marginTop: "28px", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "20px" } },
        h("h3", null, "Bilinen Eksik Kayıtlar"),
        h("p", { className: "text-muted" }, "Daha önce tek tek teyit edilmiş, uygulamada hâlâ karşılığı olmayan faturalar. Bu, genel eşleştirmenin dışında, elle listelenmiş sabit bir listedir."),
        h("ul", null, gapsPending.map((gap) => h("li", { key: gap.invoiceNo }, `${gap.invoiceNo}: ${gap.label}`))),
        h("button", {
          className: "button button-secondary",
          type: "button",
          disabled: saving,
          onClick: handleFixGaps,
        }, saving ? "Uygulanıyor…" : `${gapsPending.length} Eksik Kaydı Tamamla`),
        gapResult ? h("p", { className: "form-notice", role: "status" },
          [
            gapResult.createdJobs ? `${gapResult.createdJobs} iş emri oluşturuldu` : null,
            gapResult.appendedInvoices ? `${gapResult.appendedInvoices} fatura mevcut iş emrine eklendi` : null,
            gapResult.skipped?.length ? `${gapResult.skipped.length} kayıt atlandı` : null,
          ].filter(Boolean).join(", ") + "."
        ) : null
      ) : null
    ) : null
  );
}

function Modal({ modal, parts, customers, personnel, onClose, onSavePart, onSaveJob, onSaveInvoice, onSaveFitment, onSaveCustomer, onSavePersonnel, onSaveAppointment, onSaveNotification, saving }) {
  const business = useBusiness();
  const [lines, setLines] = useState(() => modal.type === "job" && modal.item
    ? (modal.item.items || []).map((item) => {
        const matchingPart = parts.find((part) => part.id === item.partId);
        const resolvedPrice = item.price !== undefined && item.price !== null ? item.price : (matchingPart?.price ?? "");
        return {
          partId: item.partId || "",
          originalPartId: item.partId || "",
          qty: item.qty,
          search: `${item.name || ""}${item.sku ? ` · ${item.sku}` : ""}`,
          name: item.name || "",
          sku: item.sku || "",
          category: item.category || "Genel",
          brand: item.brand || "",
          price: resolvedPrice,
          originalQty: item.qty,
          originalPrice: resolvedPrice,
          archived: !matchingPart,
          discountType: item.discountType || "none",
          discountValue: String(item.discountValue ?? 0)
        };
      })
    : modal.type === "fitment" && modal.item
      ? (modal.item.parts || []).map((item) => ({ partId: item.partId || "", search: `${item.name || ""}${item.sku ? ` · ${item.sku}` : ""}`, name: item.name || "", sku: item.sku || "" }))
    : [{ partId: "", qty: 1, search: "", discountType: "none", discountValue: "0" }]);
  const [status, setStatus] = useState(() => modal.item?.status || JOB_STATUS_IN_PROGRESS);
  // Stok yalnızca iş emri bu kayıtla "Tamamlandı" olacaksa düşülür (bkz.
  // data.js'teki politika). Parça satırlarının üst adet sınırı ve stok
  // yeterlilik kontrolü bu bilgiye göre hesaplanır.
  const willApplyStock = (modal.item ? status : JOB_STATUS_IN_PROGRESS) === JOB_STATUS_COMPLETED;
  const [businessDate, setBusinessDate] = useState(() => modal.item?.date || dateKey(new Date()));
  const [laborAmount, setLaborAmount] = useState(() => String(modal.item?.laborAmount ?? 0));
  const [externalLabor, setExternalLabor] = useState(() => modal.type === "job" && modal.item?.externalLabor ? modal.item.externalLabor : []);
  const [laborDiscountType, setLaborDiscountType] = useState(() => modal.item?.laborDiscountType || "none");
  const [laborDiscountValue, setLaborDiscountValue] = useState(() => String(modal.item?.laborDiscountValue ?? 0));
  const [error, setError] = useState("");
  const [pasteMessage, setPasteMessage] = useState("");
  const [invoiceMode, setInvoiceMode] = useState("code");
  const [pastedText, setPastedText] = useState("");
  const [invoiceItems, setInvoiceItems] = useState(() => modal.type === "invoice" && modal.item
    ? (modal.item.items || []).map((item) => ({
        partId: item.partId || "",
        sku: item.sku || "",
        name: item.name || "",
        category: item.category || "Genel",
        brand: item.brand || "",
        qty: item.qty,
        price: item.price,
        cost: item.cost,
      }))
    : []);
  const [newInvoicePart, setNewInvoicePart] = useState({ sku: "", name: "", qty: "1", cost: "", price: "", category: "Genel", brand: "", minimum: "5" });
  const title = modal.type === "part" ? modal.item ? "Parçayı düzenle" : "Yeni parça ekle" : modal.type === "job" ? modal.item ? "İş emrini düzenle" : "Yeni iş emri" : modal.type === "fitment" ? modal.item ? "Uyumluluğu düzenle" : "Araç uyumluluğu ekle" : modal.type === "customer" ? modal.item ? "Müşteriyi düzenle" : "Yeni müşteri ekle" : modal.type === "personnel" ? modal.item ? "Personeli düzenle" : "Yeni personel ekle" : modal.type === "appointment" ? modal.item ? "Randevuyu düzenle" : "Yeni randevu ekle" : modal.type === "notification" ? modal.item ? "Bildirimi düzenle" : "Yeni bildirim ekle" : modal.type === "invoice" ? modal.item ? "Faturayı düzenle" : "Alış faturası ekle" : modal.type === "return" ? modal.item ? "İade parçayı düzenle" : "İade parça ekle" : "Alış faturası ekle";
  const updateLine = (index, key, value) => setLines((current) => current.map((line, i) => i === index ? { ...line, [key]: value } : line));
  const addLine = () => setLines((current) => [...current, { partId: "", qty: 1, search: "", discountType: "none", discountValue: "0" }]);
  const updateNewInvoicePart = (key, value) => setNewInvoicePart((current) => ({ ...current, [key]: value }));
  const updateExternalLabor = (index, key, value) => setExternalLabor((current) => current.map((item, i) => i === index ? { ...item, [key]: value } : item));
  const addExternalLabor = () => setExternalLabor((current) => [...current, { description: "", cost: "", price: "" }]);
  const removeExternalLabor = (index) => setExternalLabor((current) => current.filter((_, i) => i !== index));
  function addInvoicePart() {
    const sku = newInvoicePart.sku.trim();
    const existing = parts.find((part) => part.sku.toLocaleLowerCase("tr") === sku.toLocaleLowerCase("tr"));
    const item = {
      ...(existing ? { partId: existing.id } : {}),
      sku,
      name: existing?.name || newInvoicePart.name.trim(),
      category: newInvoicePart.category.trim() || "Genel",
      brand: newInvoicePart.brand.trim(),
      minimum: Number(newInvoicePart.minimum),
      qty: Number(newInvoicePart.qty),
      cost: parseCurrencyInput(newInvoicePart.cost),
      price: parseCurrencyInput(newInvoicePart.price),
    };
    if (!item.sku || !Number.isInteger(item.qty) || item.qty <= 0 ||
      !newInvoicePart.cost.trim() || !Number.isFinite(parseCurrencyInput(newInvoicePart.cost)) || parseCurrencyInput(newInvoicePart.cost) < 0 ||
      !newInvoicePart.price.trim() || !Number.isFinite(parseCurrencyInput(newInvoicePart.price)) || parseCurrencyInput(newInvoicePart.price) < 0 ||
      (!item.partId && !item.name)) {
      setError("Stok kodu, adet, alış ve satış fiyatını girin. Yeni stok kodunda parça adı da gereklidir.");
      return;
    }
    if (invoiceItems.some((entry) => entry.sku.toLocaleLowerCase("tr") === sku.toLocaleLowerCase("tr"))) {
      setError(`${sku} kodu bu faturaya zaten eklendi.`);
      return;
    }
    setInvoiceItems((current) => [...current, item]);
    setNewInvoicePart({ sku: "", name: "", qty: "1", cost: "", price: "", category: "Genel", brand: "", minimum: "5" });
    setError("");
  }
  const pastedInvoice = modal.type === "invoice" ? parseInvoicePaste(pastedText, parts) : { items: [], errors: [], rows: 0 };
  const selectedInvoiceLines = lines.flatMap((line) => {
    const part = parts.find((entry) => entry.id === line.partId);
    return part && Number.isInteger(Number(line.qty)) && Number(line.qty) > 0
      ? [{ qty: Number(line.qty), cost: parseCurrencyInput(line.cost ?? part.cost) }]
      : [];
  });
  const invoicePreviewItems = invoiceMode === "code" ? invoiceItems : invoiceMode === "paste" ? [...invoiceItems, ...pastedInvoice.items] : [...invoiceItems, ...selectedInvoiceLines];
  const invoiceVat = calculateVat(invoicePreviewItems.reduce((sum, item) => sum + item.qty * item.cost, 0));
  const jobPreviewItems = lines.flatMap((line) => {
    const part = parts.find((entry) => entry.id === line.partId);
    const rawPrice = line.price !== undefined && line.price !== "" ? line.price : part?.price;
    const price = parseCurrencyInput(rawPrice);
    const qty = Number(line.qty);
    return line.partId && Number.isInteger(qty) && qty > 0 && Number.isFinite(price) && price >= 0
      ? [{ qty, price, discountType: line.discountType || "none", discountValue: parseCurrencyInput(line.discountValue) || 0 }]
      : [];
  });
  let jobPricing = null;
  try {
    jobPricing = calculateWorkOrderPriceBreakdown(
      jobPreviewItems,
      parseCurrencyInput(laborAmount),
      externalLabor.map((el) => ({ cost: parseCurrencyInput(el.cost) || 0, price: parseCurrencyInput(el.price) || 0 })),
      { type: laborDiscountType, value: parseCurrencyInput(laborDiscountValue) }
    );
  } catch {
    jobPricing = null;
  }
  function selectPart(index, part) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? {
      ...line,
      partId: part.id,
      name: part.name,
      sku: part.sku,
      category: part.category || "Genel",
      brand: part.brand || "",
      search: `${part.name} · ${part.sku}`,
      price: line.originalPartId === part.id ? (line.originalPrice ?? line.price ?? part.price) : part.price,
      originalQty: line.originalPartId === part.id ? line.originalQty : 0,
      archived: false
    } : line));
    setError("");
  }
  function selectFitmentPart(index, part) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, partId: part.id, search: `${part.name} · ${part.sku}`, name: part.name, sku: part.sku } : line));
    setError("");
  }
  function addCustomFitmentPart(index) {
    setLines((current) => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      const name = String(line.search || "").split(" · ")[0].trim();
      if (!name) return line;
      return { ...line, partId: "", sku: "", name, search: name };
    }));
    setError("");
    setPasteMessage("Parça envanter dışında, bu adla kaydedilecek.");
  }
  function fitmentPartLine(line, index) {
    const matches = !line.partId && !line.name ? findPartMatches(line.search, parts).slice(0, 8) : [];
    const customName = String(line.search || "").split(" · ")[0].trim();
    return h("div", { className: "modal-item-line fitment-part-line", key: index },
      h("label", { className: "part-search-label" }, index === 0 ? "Uyumlu parça" : " ", h("div", { className: "part-search-wrap" },
        h("input", { type: "search", value: line.search || "", placeholder: "Parça adı, SKU veya elle yazın", autoComplete: "off", onChange: (event) => { setLines((current) => current.map((entry, lineIndex) => lineIndex === index ? { ...entry, partId: "", name: "", sku: "", search: event.target.value } : entry)); setError(""); setPasteMessage(""); }, "aria-label": `Uyumlu parça ${index + 1}` }),
        matches.length ? h("div", { className: "part-search-results", role: "listbox" }, matches.map((entry) => h("button", { key: entry.id, type: "button", role: "option", onClick: () => selectFitmentPart(index, entry) }, h("span", null, h("strong", null, entry.name), h("small", null, `${entry.sku} · stok ${entry.stock}`)), h("span", { className: "part-result-stock" }, `${entry.stock} adet`)))) :
          line.search && !line.partId && !line.name ? h("div", { className: "part-search-empty" }, "Envanterde eşleşme yok. Adı yazdıysanız elle ekleyebilirsiniz.") : null
      )),
      !line.partId && customName && !line.name ? h("button", { className: "button button-small", type: "button", onClick: () => addCustomFitmentPart(index) }, "Elle ekle") : null,
      h("button", { className: "button button-small button-danger job-line-remove", type: "button", onClick: () => setLines((current) => { const next = current.filter((_, lineIndex) => lineIndex !== index); return next.length ? next : [{ partId: "", search: "" }]; }), "aria-label": `${line.name || `Parça ${index + 1}`} satırını kaldır` }, h(Icon, { name: "close", size: 14 }))
    );
  }
  function pastePartCodes(event, index) {
    const queries = parsePastedPartQueries(event.clipboardData.getData("text"));
    if (!queries.length) return;
    event.preventDefault();
    setError("");
    if (queries.length === 1) {
      const matches = findPartMatches(queries[0], parts);
      if (matches.length === 1) {
        selectPart(index, matches[0]);
        setPasteMessage(`${matches[0].name} eşleştirildi.`);
      } else {
        setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, partId: "", search: queries[0] } : line));
        setPasteMessage(matches.length ? `${matches.length} eşleşme bulundu; doğru parçayı seçin.` : "Eşleşme bulunamadı; aramayı düzenleyin veya parça kodunun sonunu yazın.");
      }
      return;
    }
    const pastedLines = queries.map((query) => {
      const matches = findPartMatches(query, parts);
      const part = matches.length === 1 ? matches[0] : null;
      return { partId: part?.id || "", qty: 1, search: part ? `${part.name} · ${part.sku}` : query };
    });
    setLines((current) => [...current.slice(0, index), ...pastedLines, ...current.slice(index + 1)]);
    const unresolved = pastedLines.filter((line) => !line.partId).length;
    setPasteMessage(unresolved ? `${pastedLines.length - unresolved} parça eşleşti, ${unresolved} satır için listeden seçim yapın.` : `${pastedLines.length} satır eklendi; eşleşmeyenleri aramadan seçin.`);
  }
  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (modal.type === "fitment") {
      const items = lines.map((line) => {
        const part = parts.find((entry) => entry.id === line.partId);
        const name = part?.name || line.name || String(line.search || "").split(" · ")[0].trim();
        if (!name) return null;
        return { partId: part?.id || line.partId || "", sku: part?.sku || line.sku || "", name };
      }).filter(Boolean);
      const fitment = {
        ...(modal.item || {}),
        make: String(form.get("make") || "").trim(),
        model: String(form.get("model") || "").trim(),
        year: String(form.get("year") || "").trim(),
        fuel: String(form.get("fuel") || "").trim(),
        engine: String(form.get("engine") || "").trim(),
        parts: items,
      };
      if (!fitment.make || !fitment.model || !fitment.year || !fitment.fuel || !fitment.engine) {
        setError("Marka, model, yıl, yakıt tipi ve motor hacmini girin.");
        return;
      }
      if (!items.length) {
        setError("En az bir uyumlu parça ekleyin. Envanterden seçin veya adı yazıp elle ekleyin.");
        return;
      }
      onSaveFitment(fitment);
      return;
    }
    if (modal.type === "part") {
      const part = { ...(modal.item || {}), sku: String(form.get("sku")).trim(), name: String(form.get("name")).trim(), category: String(form.get("category")).trim(), brand: String(form.get("brand")).trim(), stock: Number(form.get("stock")), minimum: Number(form.get("minimum")), price: parseCurrencyInput(form.get("price")), cost: parseCurrencyInput(form.get("cost")) };
      if (!part.sku || !part.name || [part.stock, part.minimum, part.price, part.cost].some((value) => !Number.isFinite(value) || value < 0)) {
        setError("Alanları kontrol edin. Sayısal değerler sıfır veya daha büyük olmalı.");
        return;
      }
      onSavePart(part); return;
    }
    if (modal.type === "customer") {
      const customer = { ...(modal.item || {}), name: String(form.get("name")).trim(), phone: String(form.get("phone")).trim(), email: String(form.get("email")).trim(), address: String(form.get("address")).trim(), city: String(form.get("city")).trim(), taxNumber: String(form.get("taxNumber")).trim(), active: form.get("active") === "on" };
      if (!customer.name || !customer.phone) { setError("Ad ve telefon zorunludur."); return; }
      onSaveCustomer(customer); return;
    }
    if (modal.type === "personnel") {
      const personnel = { ...(modal.item || {}), name: String(form.get("name")).trim(), role: String(form.get("role")).trim(), phone: String(form.get("phone")).trim(), email: String(form.get("email")).trim(), commissionRate: Number(form.get("commissionRate") || 0), baseSalary: Number(form.get("baseSalary") || 0), active: form.get("active") === "on" };
      if (!personnel.name || !personnel.role) { setError("Ad ve pozisyon zorunludur."); return; }
      onSavePersonnel(personnel); return;
    }
    if (modal.type === "appointment") {
      const appointment = { ...(modal.item || {}), customerId: String(form.get("customerId")).trim(), vehiclePlate: String(form.get("vehiclePlate")).trim().toLocaleUpperCase("tr"), vehicleMake: String(form.get("vehicleMake")).trim(), vehicleModel: String(form.get("vehicleModel")).trim(), serviceType: String(form.get("serviceType")).trim(), description: String(form.get("description")).trim(), date: String(form.get("date")).trim(), time: String(form.get("time")).trim(), status: String(form.get("status") || "pending"), personnelId: String(form.get("personnelId")).trim() };
      if (!appointment.customerId || !appointment.vehiclePlate || !appointment.date || !appointment.time) { setError("Müşteri, plaka, tarih ve saat zorunludur."); return; }
      onSaveAppointment(appointment); return;
    }
    if (modal.type === "notification") {
      const notification = { ...(modal.item || {}), title: String(form.get("title")).trim(), message: String(form.get("message")).trim(), type: String(form.get("type") || "info"), recipientEmail: String(form.get("recipientEmail")).trim(), link: String(form.get("link")).trim() };
      if (!notification.title || !notification.message) { setError("Başlık ve mesaj zorunludur."); return; }
      onSaveNotification(notification); return;
    }
    if (modal.type === "return") {
      const returnItem = { ...(modal.item || {}), name: String(form.get("name")).trim(), sku: String(form.get("sku")).trim(), quantity: Number(form.get("quantity") || 1), reason: String(form.get("reason")).trim(), supplier: String(form.get("supplier")).trim(), returnDate: String(form.get("returnDate")).trim(), status: String(form.get("status") || "pending") };
      if (!returnItem.name) { setError("Parça adı zorunludur."); return; }
      onSaveReturnItem(returnItem); return;
    }
    if (modal.type === "invoice" && invoiceMode === "code") {
      if (!invoiceItems.length) {
        setError("Faturaya eklemek için yan bölümden en az bir stok kodu ekleyin.");
        return;
      }
      onSaveInvoice({ invoiceNumber: String(form.get("invoiceNumber")).trim(), supplier: String(form.get("supplier")).trim(), date: businessDate, items: invoiceItems, total: invoiceItems.reduce((sum, item) => sum + item.qty * item.cost, 0) });
      return;
    }
    if (modal.type === "invoice" && modal.item) {
      if (!invoiceItems.length) {
        setError("Faturaya eklemek için yan bölümden en az bir stok kodu ekleyin.");
        return;
      }
      onSaveInvoice({ ...modal.item, invoiceNumber: String(form.get("invoiceNumber")).trim(), supplier: String(form.get("supplier")).trim(), date: businessDate, items: invoiceItems, total: invoiceItems.reduce((sum, item) => sum + item.qty * item.cost, 0) });
      return;
    }
    let activeJobLines = lines;
    if (modal.type === "job") {
      activeJobLines = lines.filter((line) => line.partId || (line.search && line.search.trim()) || (line.name && line.name.trim()));
      activeJobLines = activeJobLines.map((line) => {
        if (!line.partId && line.search && line.search.trim()) {
          const trimmed = line.search.trim();
          const exact = parts.find(p => p.sku.trim().toLocaleLowerCase("tr") === trimmed.toLocaleLowerCase("tr") || p.name.trim().toLocaleLowerCase("tr") === trimmed.toLocaleLowerCase("tr"));
          if (exact) {
            return { ...line, partId: exact.id, name: exact.name, sku: exact.sku, price: line.price !== undefined && line.price !== "" ? line.price : exact.price };
          }
          const matches = findPartMatches(trimmed, parts);
          if (matches.length === 1) {
            const m = matches[0];
            return { ...line, partId: m.id, name: m.name, sku: m.sku, price: line.price !== undefined && line.price !== "" ? line.price : m.price };
          }
        }
        return line;
      });

      if (activeJobLines.some((line) => !line.partId && !line.archived)) {
        setError("Lütfen parça satırlarında arama listesinden bir parça seçin veya boş satırları kaldırın.");
        return;
      }
    }
    const rawItems = (modal.type === "job" ? activeJobLines : lines).map((line) => {
      const part = parts.find((entry) => entry.id === line.partId);
      if (!line.partId || !Number.isInteger(Number(line.qty)) || Number(line.qty) <= 0 || (!part && !line.archived)) return null;
      const unitPrice = modal.type === "job"
        ? (Number.isFinite(parseCurrencyInput(line.price)) ? parseCurrencyInput(line.price) : (part?.price ?? 0))
        : modal.type === "invoice" ? parseCurrencyInput(line.price ?? part?.price) : (line.price ?? part?.price);
      return {
        partId: line.partId,
        sku: part?.sku || line.sku || "",
        name: part?.name || line.name || line.search.split(" · ")[0] || "Parça",
        category: part?.category || line.category || "Genel",
        brand: part?.brand || line.brand || "",
        qty: Number(line.qty),
        price: unitPrice,
        cost: parseCurrencyInput(line.cost ?? part?.cost ?? 0),
        ...(modal.type === "job" ? { discountType: line.discountType || "none", discountValue: parseCurrencyInput(line.discountValue) || 0 } : {}),
      };
    }).filter(Boolean);
    const groupedItems = new Map();
    rawItems.forEach((item) => {
      const existing = groupedItems.get(item.partId);
      if (existing) {
        const qty = existing.qty + item.qty;
        existing.cost = (existing.cost * existing.qty + item.cost * item.qty) / qty;
        existing.qty = qty;
      } else groupedItems.set(item.partId, { ...item });
    });
    const items = [...groupedItems.values()];
    if (modal.type === "invoice" && invoiceMode === "paste") {
      if (pastedInvoice.errors.length || !pastedInvoice.items.length) {
        setError(pastedInvoice.errors[0] || "Faturaya aktarılacak parça satırı bulunamadı.");
        return;
      }
      const items = [...invoiceItems, ...pastedInvoice.items];
      onSaveInvoice({ invoiceNumber: String(form.get("invoiceNumber")).trim(), supplier: String(form.get("supplier")).trim(), date: businessDate, items, total: items.reduce((sum, item) => sum + item.qty * item.cost, 0) });
      return;
    }
    if (modal.type === "job") {
      let normalizedLaborAmount;
      let normalizedLaborDiscount;
      let total;
      try {
        normalizedLaborAmount = normalizeLaborAmount(parseCurrencyInput(laborAmount));
        normalizedLaborDiscount = normalizeDiscount({ type: laborDiscountType, value: parseCurrencyInput(laborDiscountValue) });
        total = calculateWorkOrderNetTotal(items, normalizedLaborAmount, externalLabor.map(el => ({ cost: parseCurrencyInput(el.cost) || 0, price: parseCurrencyInput(el.price) || 0 })), normalizedLaborDiscount);
      } catch (pricingError) {
        setError(pricingError.message || "İş emri tutarlarını kontrol edin.");
        return;
      }
      if (!items.length && normalizedLaborAmount <= 0 && externalLabor.length === 0) {
        setError("İş emri için en az bir parça, işçilik veya harici işçilik girmelisiniz.");
        return;
      }
      // Stok yalnızca iş emri bu kayıtla "Tamamlandı" olacaksa düşülür
      // (willApplyStock, yukarıda). Açık kalacaksa rafta görünenden fazla
      // miktar girilmesin diye ham adede bakılır; tamamlanıyorsa, zaten
      // tamamlanmış olarak stoğa işlenmiş eski adetler düşülerek gerçek fark
      // kontrol edilir.
      const previousByPart = new Map();
      if (modal.item?.stockApplied) {
        (modal.item?.items || []).forEach((item) => previousByPart.set(item.partId, (previousByPart.get(item.partId) || 0) + Number(item.qty || 0)));
      }
      const requiredByPart = items.reduce((totals, item) => ({ ...totals, [item.partId]: (totals[item.partId] || 0) + item.qty }), {});
      const insufficientPart = Object.entries(requiredByPart).find(([id, qty]) => {
        const stock = parts.find((part) => part.id === id)?.stock ?? 0;
        if (willApplyStock) return (qty - (previousByPart.get(id) || 0)) > stock;
        return qty > stock;
      });
      if (insufficientPart) {
        setError("Eklenen parçalardan en az biri için yeterli stok bulunmuyor.");
        return;
      }
      onSaveJob({
        id: modal.item?.id,
        date: businessDate,
        plate: String(form.get("plate")).trim().toLocaleUpperCase("tr"),
        make: String(form.get("make")).trim(),
        model: String(form.get("model")).trim(),
        customer: String(form.get("customer")).trim(),
        phone: String(form.get("phone")).trim(),
        items,
        laborAmount: normalizedLaborAmount,
        externalLabor: externalLabor.map(el => ({
          description: el.description,
          cost: parseCurrencyInput(el.cost) || 0,
          price: parseCurrencyInput(el.price) || 0
        })),
        laborDiscountType: normalizedLaborDiscount.type,
        laborDiscountValue: normalizedLaborDiscount.value,
        total,
        status: modal.item ? status : JOB_STATUS_IN_PROGRESS,
        ...(!modal.item ? { code: String(form.get("code") || "").trim() } : {})
      });
    } else {
      const invoiceItemsToSave = [...invoiceItems, ...items];
      onSaveInvoice({ invoiceNumber: String(form.get("invoiceNumber")).trim(), supplier: String(form.get("supplier")).trim(), date: businessDate, items: invoiceItemsToSave, total: invoiceItemsToSave.reduce((sum, item) => sum + item.qty * item.cost, 0) });
    }
  }
  function partLine(line, index, type) {
    const part = parts.find((entry) => entry.id === line.partId);
    const matches = type === "job" && !line.partId ? findPartMatches(line.search, parts).slice(0, 8) : [];
    const isJob = type === "job";
    return h("div", { className: `modal-item-line ${isJob ? "job-item-line" : ""}`, key: index },
      type === "job" ? line.archived
        ? h("div", { className: "archived-job-line" }, h("strong", null, line.name || line.search), h("small", null, `${line.sku || "Stok kodu yok"} · Arşivli parça; yalnızca miktarı azaltılabilir`))
        : h("label", { className: "part-search-label" }, index === 0 ? "Parça adı veya kodu" : " ", h("div", { className: "part-search-wrap" },
          h("input", { type: "search", value: line.search || "", placeholder: "Parça adı, SKU veya sonu… yapıştırın", autoComplete: "off", onChange: (event) => { setLines((current) => current.map((entry, lineIndex) => lineIndex === index ? { ...entry, partId: "", search: event.target.value } : entry)); setError(""); setPasteMessage(""); }, onPaste: (event) => pastePartCodes(event, index), "aria-label": `Parça ${index + 1} ara` }),
          matches.length ? h("div", { className: "part-search-results", role: "listbox" }, matches.map((entry) => h("button", { key: entry.id, type: "button", role: "option", disabled: entry.stock < 1, onClick: () => selectPart(index, entry) }, h("span", null, h("strong", null, entry.name), h("small", null, `${entry.sku} · stok ${entry.stock}`)), h("span", { className: entry.stock < 1 ? "part-result-empty" : "part-result-stock" }, entry.stock < 1 ? "Stok yok" : `${entry.stock} adet`)))) :
            line.search && !line.partId ? h("div", { className: "part-search-empty" }, "Eşleşme yok. Kodu, adını veya kodun sonunu deneyin.") : null
        )) : h("label", null, index === 0 ? "Parça" : " ", h("select", { value: line.partId, onChange: (event) => updateLine(index, "partId", event.target.value), required: index === 0 }, h("option", { value: "" }, "Parça seçin"), parts.map((entry) => h("option", { key: entry.id, value: entry.id }, `${entry.name} · ${entry.sku}`)))),
      h("label", null, index === 0 ? "Adet" : " ", h("input", { type: "number", min: 1, max: type === "job" ? line.archived ? line.originalQty : part ? part.stock + (willApplyStock && modal.item?.stockApplied ? (line.originalQty || 0) : 0) : undefined : undefined, value: line.qty, onChange: (event) => updateLine(index, "qty", event.target.value), required: true })),
      type === "job" ? h("label", null, index === 0 ? "Birim satış (₺)" : " ", h(CurrencyInput, { value: String(line.price !== undefined && line.price !== null ? line.price : (part?.price ?? "")), onChange: (val) => updateLine(index, "price", val), placeholder: "0,00" })) : null,
      type === "job" && !line.archived ? h("div", { className: "line-discount" },
        h("label", null, index === 0 ? "İskonto" : " ",
          h("select", { value: line.discountType || "none", "aria-label": `${line.name || part?.name || `Parça ${index + 1}`} iskonto türü`, onChange: (event) => { const val = event.target.value; updateLine(index, "discountType", val); if (val === "none") updateLine(index, "discountValue", "0"); } },
            h("option", { value: "none" }, "Yok"),
            h("option", { value: "percent" }, "%"),
            h("option", { value: "amount" }, "₺")
          )),
        line.discountType && line.discountType !== "none" ? h("label", null, index === 0 ? " " : " ",
          h(CurrencyInput, { value: String(line.discountValue ?? "0"), "aria-label": `${line.name || part?.name || `Parça ${index + 1}`} iskonto tutarı`, onChange: (val) => updateLine(index, "discountValue", val) })) : null
      ) : null,
      type === "job" ? h("button", { className: "button button-small button-danger job-line-remove", type: "button", onClick: () => setLines((current) => { const next = current.filter((_, lineIndex) => lineIndex !== index); return next.length ? next : [{ partId: "", qty: 1, search: "", discountType: "none", discountValue: "0" }]; }), "aria-label": `${line.name || part?.name || `Parça ${index + 1}`} satırını kaldır` }, h(Icon, { name: "close", size: 14 })) : null,
      type === "invoice" ? h("label", null, index === 0 ? "Birim alış · KDV hariç (₺)" : " ", h(CurrencyInput, { value: line.cost ?? part?.cost ?? "", onChange: (val) => updateLine(index, "cost", val), required: true })) : null,
      type === "invoice" ? h("label", null, index === 0 ? "Satış fiyatı · KDV hariç (₺)" : " ", h(CurrencyInput, { value: line.price ?? part?.price ?? "", onChange: (val) => updateLine(index, "price", val), required: true })) : null
    );
  }
  return h("div", { className: "modal-backdrop", onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); } }, h("section", { className: `modal-card ${modal.type === "invoice" ? "invoice-modal" : ""}`, role: "dialog", "aria-modal": "true", "aria-labelledby": "modal-title" },
    h("div", { className: "modal-header" }, h("div", null, h("p", { className: "eyebrow" }, business.shortName.toLocaleUpperCase("tr")), h("h2", { id: "modal-title" }, title)), h("button", { className: "icon-button", onClick: onClose, type: "button", title: "Kapat" }, h(Icon, { name: "close" }))),
    h("form", { onSubmit: submit, className: "modal-form" },
      modal.type === "part" ? h("div", { className: "form-grid" },
        h("label", null, "Parça adı", h("input", { name: "name", defaultValue: modal.item?.name || "", placeholder: "Örn. Yağ filtresi", required: true })),
        h("label", null, "Parça kodu (SKU)", h("input", { name: "sku", defaultValue: modal.item?.sku || "", placeholder: "Örn. OE-9812", required: true })),
        h("label", null, "Kategori", h("input", { name: "category", defaultValue: modal.item?.category || "", placeholder: "Örn. Filtre", required: true })),
        h("label", null, "Marka", h("input", { name: "brand", defaultValue: modal.item?.brand || "", placeholder: "Parça markası" })),
        h("label", null, "Stok adedi", h("input", { name: "stock", type: "number", min: 0, defaultValue: modal.item?.stock ?? 0, required: true })),
        h("label", null, "Kritik stok seviyesi", h("input", { name: "minimum", type: "number", min: 0, defaultValue: modal.item?.minimum ?? 5, required: true })),
        h("label", null, "Alış fiyatı · KDV hariç (₺)", h(CurrencyInput, { name: "cost", value: String(modal.item?.cost ?? ""), required: true, placeholder: "0,00" })),
        h("label", null, "Satış fiyatı · KDV hariç (₺)", h(CurrencyInput, { name: "price", value: String(modal.item?.price ?? ""), required: true, placeholder: "0,00" }))
      ) : modal.type === "fitment" ? h(React.Fragment, null,
        h("div", { className: "form-grid" },
          h("label", null, "Marka", h("input", { name: "make", defaultValue: modal.item?.make || "", placeholder: "Örn. Peugeot", required: true })),
          h("label", null, "Model", h("input", { name: "model", defaultValue: modal.item?.model || "", placeholder: "Örn. 3008", required: true })),
          h("label", null, "Yıl", h("input", { name: "year", type: "number", min: 1990, max: 2100, defaultValue: modal.item?.year || "", placeholder: "Örn. 2020", required: true })),
          h("label", null, "Yakıt", h("select", { name: "fuel", defaultValue: modal.item?.fuel || "Dizel", required: true, "aria-label": "Yakıt tipi" }, FUEL_TYPES.map((type) => h("option", { key: type, value: type }, type)))),
          h("label", null, "Motor", h("input", { name: "engine", defaultValue: modal.item?.engine || "", placeholder: "Örn. 1.6 BlueHDi", required: true }))
        ),
        h("div", { className: "modal-section-title" }, "Uyumlu parçalar", h("span", null, "Envanterden seçin veya adı yazın")),
        h("p", { className: "part-paste-hint" }, "Parça adı veya SKU yazın. Stokta yoksa “Elle ekle” ile kaydedebilirsiniz.", pasteMessage ? h("strong", null, ` ${pasteMessage}`) : null),
        h("div", { className: "modal-lines" }, lines.map((line, index) => fitmentPartLine(line, index))),
        h("button", { className: "add-line-button", type: "button", onClick: addLine }, h(Icon, { name: "plus", size: 15 }), "Parça satırı ekle")
      ) : modal.type === "job" ? h(React.Fragment, null,
        h("div", { className: "form-grid" },
          h("label", null, "İş emri tarihi", h("input", { name: "date", type: "date", value: businessDate, onChange: (event) => setBusinessDate(event.target.value), required: true })),
          h("label", null, "Araç plakası", h("input", { name: "plate", defaultValue: modal.item?.plate || "", placeholder: "34 ABC 123", required: true })),
          h("label", null, "Müşteri adı", h("input", { name: "customer", defaultValue: modal.item?.customer || "", placeholder: "Ad soyad", required: true })),
          h("label", null, "Marka", h("input", { name: "make", defaultValue: modal.item?.make || "", placeholder: "Örn. Peugeot", required: true })),
          h("label", null, "Model", h("input", { name: "model", defaultValue: modal.item?.model || "", placeholder: "Örn. 3008", required: true })),
          h("label", null, "Telefon", h("input", { name: "phone", type: "tel", defaultValue: modal.item?.phone || "", placeholder: "05xx xxx xx xx" })),
          !modal.item ? h("label", null, "İş emri no (opsiyonel)",
            h("input", { name: "code", defaultValue: "", placeholder: "Boş bırakılırsa otomatik numara verilir (örn. eDMS'teki iş emri no'su)" })
          ) : null,
          modal.item ? h("label", null, "İş emri durumu",
            h("select", {
              name: "status",
              value: status,
              onChange: (e) => setStatus(e.target.value)
            },
              h("option", { value: JOB_STATUS_IN_PROGRESS }, "Devam ediyor"),
              h("option", { value: JOB_STATUS_COMPLETED }, "Tamamlandı")
            )
          ) : null
        ),
        h("div", { className: "modal-section-title" }, "Kullanılan parçalar", h("span", null, "Stok farkları kayıtta uygulanır")), h("p", { className: "part-paste-hint" }, "Satış fiyatları KDV hariçtir. Kodun sonundan arayabilir ya da Excel'den birden fazla satırı doğrudan yapıştırabilirsiniz.", pasteMessage ? h("strong", null, ` ${pasteMessage}`) : null), h("div", { className: "modal-lines" }, lines.map((line, index) => partLine(line, index, "job"))), h("button", { className: "add-line-button", type: "button", onClick: addLine }, h(Icon, { name: "plus", size: 15 }), "Parça satırı ekle"),
        h("div", { className: "labor-amount-field" }, h("label", { htmlFor: "work-order-labor" }, "İşçilik tutarı · KDV hariç (₺)"), h(CurrencyInput, { id: "work-order-labor", value: laborAmount, onChange: (val) => { setLaborAmount(val); setError(""); }, "aria-describedby": "work-order-labor-hint" }), h("small", { id: "work-order-labor-hint" }, "Tek işçilik tutarı. Boş bırakılırsa 0 ₺ kaydedilir.")),
        h("div", { className: "modal-section-title" }, "Harici İşçilik", h("span", null, "Dışarıdan yaptırılan işlerin maliyeti ve satış fiyatı")),
        externalLabor.length ? h("div", { className: "modal-lines" }, externalLabor.map((el, index) => h("div", { className: "modal-item-line external-labor-line", key: index },
          h("label", null, index === 0 ? "İş açıklaması" : " ", h("input", { value: el.description, onChange: (e) => updateExternalLabor(index, "description", e.target.value), placeholder: "Örn. Kaporta boyası" })),
          h("label", null, index === 0 ? "Maliyet · KDV hariç (₺)" : " ", h(CurrencyInput, { value: el.cost, onChange: (val) => updateExternalLabor(index, "cost", val), placeholder: "0,00" })),
          h("label", null, index === 0 ? "Satış fiyatı · KDV hariç (₺)" : " ", h(CurrencyInput, { value: el.price, onChange: (val) => updateExternalLabor(index, "price", val), placeholder: "0,00" })),
          h("button", { className: "button button-small button-danger job-line-remove", type: "button", onClick: () => removeExternalLabor(index) }, h(Icon, { name: "close", size: 14 }))
        ))) : null,
        h("button", { className: "add-line-button", type: "button", onClick: addExternalLabor }, h(Icon, { name: "plus", size: 15 }), "Harici işçilik ekle"),
        h("div", { className: "modal-section-title" }, "İşçilik İskontosu", h("span", null, "İşçilik tutarı üzerinden, KDV hesaplanmadan önce uygulanır")),
        h("div", { className: "discount-field" },
          h("label", { htmlFor: "work-order-labor-discount-type" }, "İskonto türü",
            h("select", { id: "work-order-labor-discount-type", value: laborDiscountType, onChange: (e) => { setLaborDiscountType(e.target.value); if (e.target.value === "none") setLaborDiscountValue("0"); setError(""); } },
              h("option", { value: "none" }, "Yok"),
              h("option", { value: "percent" }, "Yüzde (%)"),
              h("option", { value: "amount" }, "Tutar (₺)")
            )),
          laborDiscountType !== "none" ? h("label", { htmlFor: "work-order-labor-discount-value" }, laborDiscountType === "percent" ? "İskonto yüzdesi (%)" : "İskonto tutarı · KDV hariç (₺)",
            h(CurrencyInput, { id: "work-order-labor-discount-value", value: laborDiscountValue, onChange: (val) => { setLaborDiscountValue(val); setError(""); } })) : null
        ),
      ) : modal.type === "customer" ? h(React.Fragment, null,
        h("div", { className: "form-grid" },
          h("label", null, "Müşteri adı", h("input", { name: "name", defaultValue: modal.item?.name || "", placeholder: "Ahmet Yılmaz", required: true })),
          h("label", null, "Telefon", h("input", { name: "phone", type: "tel", defaultValue: modal.item?.phone || "", placeholder: "05xx xxx xx xx", required: true })),
          h("label", null, "E-posta", h("input", { name: "email", type: "email", defaultValue: modal.item?.email || "", placeholder: "ahmet@gmail.com" })),
          h("label", null, "Adres", h("input", { name: "address", defaultValue: modal.item?.address || "", placeholder: "Adres satırı" })),
          h("label", null, "Şehir", h("input", { name: "city", defaultValue: modal.item?.city || "", placeholder: "İstanbul" })),
          h("label", null, "Vergi No", h("input", { name: "taxNumber", defaultValue: modal.item?.taxNumber || "", placeholder: "TCKN/VKN" })),
          h("label", null, "Aktif", h("select", { name: "active", defaultValue: modal.item?.active !== false ? "on" : "off" }, h("option", { value: "on" }, "Aktif"), h("option", { value: "off" }, "Pasif")))
        )
      ) : modal.type === "personnel" ? h(React.Fragment, null,
        h("div", { className: "form-grid" },
          h("label", null, "Ad Soyad", h("input", { name: "name", defaultValue: modal.item?.name || "", placeholder: "Mehmet Demir", required: true })),
          h("label", null, "Pozisyon", h("input", { name: "role", defaultValue: modal.item?.role || "", placeholder: "Servis Memuru", required: true })),
          h("label", null, "Telefon", h("input", { name: "phone", type: "tel", defaultValue: modal.item?.phone || "", placeholder: "05xx xxx xx xx" })),
          h("label", null, "E-posta", h("input", { name: "email", type: "email", defaultValue: modal.item?.email || "", placeholder: "mehmet@gmail.com" })),
          h("label", null, "Komisyon Oranı (%)", h("input", { name: "commissionRate", type: "number", min: 0, step: 0.1, defaultValue: modal.item?.commissionRate ?? 0, placeholder: "5" })),
          h("label", null, "Temel Maaş (₺)", h("input", { name: "baseSalary", type: "number", min: 0, defaultValue: modal.item?.baseSalary ?? 0, placeholder: "0" })),
          h("label", null, "Aktif", h("select", { name: "active", defaultValue: modal.item?.active !== false ? "on" : "off" }, h("option", { value: "on" }, "Aktif"), h("option", { value: "off" }, "Pasif")))
        )
      ) : modal.type === "appointment" ? h(React.Fragment, null,
        h("div", { className: "form-grid" },
          h("label", null, "Müşteri", h("select", { name: "customerId", defaultValue: modal.item?.customerId || "", required: true }, h("option", { value: "" }, "Müşteri seçin"), customers.map((c) => h("option", { key: c.id, value: c.id }, `${c.name} · ${c.phone}`)))),
          h("label", null, "Araç Plakası", h("input", { name: "vehiclePlate", defaultValue: modal.item?.vehiclePlate || "", placeholder: "34 ABC 123", required: true })),
          h("label", null, "Marka", h("input", { name: "vehicleMake", defaultValue: modal.item?.vehicleMake || "", placeholder: "Peugeot" })),
          h("label", null, "Model", h("input", { name: "vehicleModel", defaultValue: modal.item?.vehicleModel || "", placeholder: "3008" })),
          h("label", null, "Hizmet Tipi", h("input", { name: "serviceType", defaultValue: modal.item?.serviceType || "", placeholder: "Bakım / Yağ Değişimi", required: true })),
          h("label", null, "Tarih", h("input", { name: "date", type: "date", defaultValue: modal.item?.date || "", required: true })),
          h("label", null, "Saat", h("input", { name: "time", type: "time", defaultValue: modal.item?.time || "", required: true })),
          h("label", null, "Personel", h("select", { name: "personnelId", defaultValue: modal.item?.personnelId || "" }, h("option", { value: "" }, "Personel seçin"), personnel.map((p) => h("option", { key: p.id, value: p.id }, p.name)))),
          h("label", null, "Durum", h("select", { name: "status", defaultValue: modal.item?.status || "pending" }, h("option", { value: "pending" }, "Beklemede"), h("option", { value: "done" }, "Tamamlandı"), h("option", { value: "cancelled" }, "İptal"))),
          h("label", null, "Açıklama", h("textarea", { name: "description", defaultValue: modal.item?.description || "", placeholder: "Ek notlar", rows: 3 }))
        )
      ) : modal.type === "notification" ? h(React.Fragment, null,
        h("div", { className: "form-grid" },
          h("label", null, "Başlık", h("input", { name: "title", defaultValue: modal.item?.title || "", placeholder: "Düşük stok uyarısı", required: true })),
          h("label", null, "Mesaj", h("input", { name: "message", defaultValue: modal.item?.message || "", placeholder: "Yağ filtresi stoğu kritik seviyede", required: true })),
          h("label", null, "Tür", h("select", { name: "type", defaultValue: modal.item?.type || "info" }, h("option", { value: "info" }, "Bilgi"), h("option", { value: "warning" }, "Uyarı"), h("option", { value: "error" }, "Hata"), h("option", { value: "success" }, "Başarılı"))),
          h("label", null, "Alıcı E-posta", h("input", { name: "recipientEmail", defaultValue: modal.item?.recipientEmail || "", placeholder: "yönetici@gmail.com" })),
          h("label", null, "Link", h("input", { name: "link", defaultValue: modal.item?.link || "", placeholder: "/inventory" }))
        )
      ) : modal.type === "return" ? h(React.Fragment, null,
        h("div", { className: "form-grid" },
          h("label", null, "Parça adı", h("input", { name: "name", defaultValue: modal.item?.name || "", placeholder: "Örn. Yağ filtresi", required: true })),
          h("label", null, "Stok kodu / SKU", h("input", { name: "sku", defaultValue: modal.item?.sku || "", placeholder: "Örn. OE-9812" })),
          h("label", null, "Adet", h("input", { name: "quantity", type: "number", min: 1, defaultValue: modal.item?.quantity || 1, required: true })),
          h("label", null, "İade nedeni", h("input", { name: "reason", defaultValue: modal.item?.reason || "", placeholder: "Örn. Arızalı parça" })),
          h("label", null, "Tedarikçi", h("input", { name: "supplier", defaultValue: modal.item?.supplier || "", placeholder: "Tedarikçi firma adı" })),
          h("label", null, "İade tarihi", h("input", { name: "returnDate", type: "date", defaultValue: modal.item?.returnDate || "", required: true })),
          h("label", null, "Durum", h("select", { name: "status", defaultValue: modal.item?.status || "pending" }, h("option", { value: "pending" }, "Beklemede"), h("option", { value: "completed" }, "Tamamlandı"), h("option", { value: "cancelled" }, "İptal")))
        )
      ) : h(React.Fragment, null,
        h("div", { className: "form-grid invoice-meta-grid" },
          h("label", null, "Fatura numarası", h("input", { name: "invoiceNumber", defaultValue: modal.item?.code || "", placeholder: "Tedarikçi fatura numarası", required: true })),
          h("label", null, "Tedarikçi", h("input", { name: "supplier", defaultValue: modal.item?.supplier || "", placeholder: "Tedarikçi firma adı", required: true })),
          h("label", null, "Fatura tarihi", h("input", { name: "date", type: "date", value: businessDate, onChange: (event) => setBusinessDate(event.target.value), required: true }))
        ),
        h("div", { className: "invoice-input-tabs" },
          h("button", { type: "button", className: invoiceMode === "code" ? "active" : "", onClick: () => { setInvoiceMode("code"); setError(""); } }, "Yeni stok kodu oluştur"),
          h("button", { type: "button", className: invoiceMode === "select" ? "active" : "", onClick: () => { setInvoiceMode("select"); setError(""); } }, "Kayıtlı parçalardan seç"),
          h("button", { type: "button", className: invoiceMode === "paste" ? "active" : "", onClick: () => { setInvoiceMode("paste"); setError(""); } }, "Kopyala / yapıştır")
        ),
        invoiceMode === "select" ? h(React.Fragment, null,
          h("div", { className: "modal-section-title invoice-lines-title" }, "Faturadaki parçalar", h("span", null, "Stok, fatura kaydedilince artar")),
          h("div", { className: "modal-lines" }, lines.map((line, index) => partLine(line, index, "invoice"))),
          h("button", { className: "add-line-button", type: "button", onClick: addLine }, h(Icon, { name: "plus", size: 15 }), "Parça satırı ekle")
        ) : invoiceMode === "code" ? h("div", { className: "invoice-workspace" },
          h("section", { className: "invoice-draft-panel" },
            h("div", { className: "modal-section-title" }, "Faturaya eklenen stoklar", h("span", null, `${invoiceItems.length} satır`)),
            invoiceItems.length ? h("div", { className: "invoice-draft-lines" }, invoiceItems.map((item, index) => h("article", { className: "invoice-draft-line", key: item.sku },
              h("div", null, h("strong", null, item.name), h("small", null, `${item.sku}${item.partId ? " · kayıtlı parça" : " · yeni stok kartı"}`)),
              h("span", null, `${item.qty} adet`),
              h("div", null, h("strong", null, `${money(item.cost)} · KDV hariç`), h("small", null, `Satış ${money(item.price)} · KDV hariç`)),
              h("button", { className: "button button-small button-danger", type: "button", "aria-label": `${item.sku} satırını kaldır`, onClick: () => setInvoiceItems((current) => current.filter((_, itemIndex) => itemIndex !== index)) }, "Kaldır")
            ))) : h("div", { className: "empty-state compact-empty" }, "Sağ taraftan stok kodunu oluşturup bu faturaya ekleyin."),
          ),
          h("aside", { className: "invoice-create-panel" },
            h("div", { className: "modal-section-title" }, "Yeni stok kodu oluştur"),
            h("p", { className: "paste-hint" }, "Kaydet dediğinizde stok kartı, alış faturası ve stok girişi birlikte kaydedilir."),
            h("label", null, "Stok kodu / SKU", h("input", { value: newInvoicePart.sku, onChange: (event) => updateNewInvoicePart("sku", event.target.value), placeholder: "Örn. OE-9812" })),
            h("label", null, "Parça adı", h("input", { value: newInvoicePart.name, onChange: (event) => updateNewInvoicePart("name", event.target.value), placeholder: "Örn. Yağ filtresi" })),
            h("div", { className: "form-grid" },
              h("label", null, "Adet", h("input", { type: "number", min: 1, step: 1, value: newInvoicePart.qty, onChange: (event) => updateNewInvoicePart("qty", event.target.value) })),
              h("label", null, "Kritik stok", h("input", { type: "number", min: 0, step: 1, value: newInvoicePart.minimum, onChange: (event) => updateNewInvoicePart("minimum", event.target.value) })),
              h("label", null, "Alış fiyatı · KDV hariç (₺)", h(CurrencyInput, { value: newInvoicePart.cost, onChange: (val) => updateNewInvoicePart("cost", val) })),
              h("label", null, "Satış fiyatı · KDV hariç (₺)", h(CurrencyInput, { value: newInvoicePart.price, onChange: (val) => updateNewInvoicePart("price", val) }))
            ),
            h("div", { className: "form-grid" },
              h("label", null, "Kategori", h("input", { value: newInvoicePart.category, onChange: (event) => updateNewInvoicePart("category", event.target.value), placeholder: "Genel" })),
              h("label", null, "Marka", h("input", { value: newInvoicePart.brand, onChange: (event) => updateNewInvoicePart("brand", event.target.value), placeholder: "Parça markası" }))
            ),
            h("button", { className: "button button-primary invoice-add-part", type: "button", onClick: addInvoicePart }, h(Icon, { name: "plus", size: 15 }), "Faturaya ekle")
          )
        ) : h("div", { className: "invoice-paste-panel" },
          h("label", null, "Fatura satırları", h("textarea", { value: pastedText, onChange: (event) => { setPastedText(event.target.value); setError(""); }, placeholder: "SKU\tParça Adı\tAdet\tAlış Fiyatı\tSatış Fiyatı\nOE-9812\tYağ filtresi\t4\t310\t450\nNEW-301\tHava filtresi\t2\t220\t390", rows: 7 })),
          h("p", { className: "paste-hint" }, "Fiyatları KDV hariç girin. Excel'den kopyalayıp buraya yapıştırın. Desteklenen sütun başlıkları: SKU/Stok Kodu, Parça Adı, Adet, Alış Fiyatı, Satış Fiyatı, Kategori, Marka. TSV, CSV ve noktalı virgül formatları desteklenir."),
          pastedInvoice.rows ? h("div", { className: `paste-result ${pastedInvoice.errors.length ? "paste-result-error" : ""}` },
            h("strong", null, pastedInvoice.errors.length ? `${pastedInvoice.errors.length} satır kontrol edilmeli` : `${pastedInvoice.items.length} fatura satırı hazır`),
            pastedInvoice.errors.length ? h("ul", null, pastedInvoice.errors.slice(0, 5).map((message) => h("li", { key: message }, message))) : h("p", null, `${pastedInvoice.items.filter((item) => !item.partId).length} yeni stok kartı oluşturulacak; mevcut parçaların stoğu güncellenecek.`)
          ) : null
        )
      ),
      modal.type === "invoice" && invoicePreviewItems.length ? h(VatSummary, { values: invoiceVat, title: "Fatura toplamı · KDV dahil" }) :
        modal.type === "job" && jobPricing ? h(WorkOrderPriceSummary, { values: jobPricing }) : null,
      error ? h("p", { className: "form-error", role: "alert" }, error) : null,
      h("div", { className: "modal-footer" }, h("button", { className: "button button-quiet", onClick: onClose, type: "button", disabled: saving }, "Vazgeç"), h("button", { className: "button button-primary", type: "submit", disabled: saving }, saving ? "Kaydediliyor..." : modal.type === "part" ? "Kaydet" : modal.type === "job" ? modal.item ? "İş emrini güncelle" : "İş emrini oluştur" : modal.type === "fitment" ? "Uyumluluğu kaydet" : modal.type === "customer" ? "Müşteriyi kaydet" : modal.type === "personnel" ? "Personeli kaydet" : modal.type === "appointment" ? "Randevuyu kaydet" : modal.type === "notification" ? "Bildirimi oluştur" : modal.type === "return" ? "İade parçayı kaydet" : "Faturayı kaydet", saving ? null : h(Icon, { name: "arrow", size: 15 })))
    )
  ));
}

installFitScreen();
createRoot(document.getElementById("root")).render(h(React.StrictMode, null, h(BusinessProvider, null, h(App))));

/* ─── Müşteri Sayfası ──────────────────────────────────────────────────────── */
function CustomersPage({ customers, openModal, saving }) {
  const [query, setQuery] = useState("");
  const [openCustomer, setOpenCustomer] = useState(null);
  const filtered = customers.filter((c) => `${c.name} ${c.phone} ${c.email} ${c.city}`.toLocaleLowerCase("tr").includes(query.trim().toLocaleLowerCase("tr")));
  const openCustomerModal = (c = null) => { setOpenCustomer(c); openModal("customer", c); };
  return h(React.Fragment, null,
    h("div", { className: "list-toolbar" },
      h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Müşteri, telefon veya e-posta ara..." })),
      h("button", { className: "button button-primary", type: "button", disabled: saving, onClick: () => openCustomerModal() }, h(Icon, { name: "plus", size: 15 }), "Müşteri ekle")),
    h("section", { className: "panel table-panel" }, filtered.length ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["MÜŞTERİ", "TELEFON", "E-POSTA", "ŞEHİR", "VERİ NO", "İŞLEM"].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, filtered.map((c) => h("tr", { key: c.id },
          h("td", null, h("strong", null, c.name)))))
      )) : h("div", { className: "empty-state" }, "Henüz müşteri kaydı yok.")));
}

/* ─── Personel Sayfası ─────────────────────────────────────────────────────── */
function PersonnelPage({ personnel, jobs, openModal, saving }) {
  const [query, setQuery] = useState("");
  const [openPersonnel, setOpenPersonnel] = useState(null);
  const performance = getPersonnelPerformance(jobs, personnel);
  const filtered = performance.filter((p) => `${p.name} ${p.role}`.toLocaleLowerCase("tr").includes(query.trim().toLocaleLowerCase("tr")));
  const openPersonnelModal = (p = null) => { setOpenPersonnel(p); openModal("personnel", p); };
  return h(React.Fragment, null,
    h("div", { className: "list-toolbar" },
      h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Ad veya pozisyon ara..." })),
      h("button", { className: "button button-primary", type: "button", disabled: saving, onClick: () => openPersonnelModal() }, h(Icon, { name: "plus", size: 15 }), "Personel ekle")
    ),
    h("section", { className: "panel report-panel" },
      h("div", { className: "metric-grid report-metrics" },
        h(ReportMetric, { label: "Toplam personel", value: String(personnel.length), caption: "Aktif çalışan sayısı", icon: "grid", color: "blue" }),
        h(ReportMetric, { label: "Toplam iş emri", value: String(jobs.length), caption: "Kayıtlı iş emirleri", icon: "wrench", color: "green" }),
        h(ReportMetric, { label: "Toplam ciro", value: money(jobs.reduce((s, j) => s + Number(j.total || 0), 0)), caption: "KDV dahil · tüm iş emirleri", icon: "chart", color: "purple" })
      ),
      filtered.length
        ? h("div", { className: "table-scroll" },
          h("table", null,
            h("thead", null, h("tr", null, ["PERSONEL", "POZİSYON", "İŞ EMRI", "CİRO · KDV DAHİL", "KOMİSYON", "İŞLEM"].map((label) => h("th", { key: label }, label)))),
            h("tbody", null, filtered.map((p) => h("tr", { key: p.id },
              h("td", null, h("strong", null, p.name)),
              h("td", { className: "muted-cell" }, p.role),
              h("td", null, String(p.jobs).padStart(2, "0")),
              h("td", { className: "price-cell" }, money(p.revenue)),
              h("td", { className: "price-cell" }, money(p.commission)),
              h("td", { className: "action-cell", onClick: (e) => e.stopPropagation() },
                h("button", { className: "button button-small button-outline", type: "button", disabled: saving, onClick: () => openPersonnelModal(p) }, "Düzenle"))
            )))
          )
        )
        : h("div", { className: "empty-state" }, "Henüz personel kaydı yok.")
    )
  );
}

/* ─── Randevu Sayfası ──────────────────────────────────────────────────────── */
function AppointmentsPage({ appointments, customers, personnel, jobs, openModal, saving }) {
  const [query, setQuery] = useState("");
  const [openAppt, setOpenAppt] = useState(null);
  const customerMap = new Map(customers.map((c) => [c.id, c]));
  const personnelMap = new Map(personnel.map((p) => [p.id, p]));
  const filtered = appointments.filter((a) => {
    const c = customerMap.get(a.customerId);
    return `${a.vehiclePlate} ${a.serviceType} ${c?.name || ""}`.toLocaleLowerCase("tr").includes(query.trim().toLocaleLowerCase("tr"));
  });
  const openApptModal = (a = null) => { setOpenAppt(a); openModal("appointment", a); };
  return h(React.Fragment, null,
    h("div", { className: "list-toolbar" },
      h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Plaka, hizmet tipi veya müşteri ara..." })),
      h("button", { className: "button button-primary", type: "button", disabled: saving, onClick: () => openApptModal() }, h(Icon, { name: "plus", size: 15 }), "Randevu ekle")),
    h("section", { className: "panel table-panel" }, filtered.length ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["TARİH · SAAT", "MÜŞTERİ", "PLAKA", "ARAÇ", "HİZMET", "DURUM", "PERSONEL", "İŞLEM"].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, filtered.map((a) => {
          const c = customerMap.get(a.customerId);
          const p = personnelMap.get(a.personnelId);
          return h("tr", { key: a.id },
            h("td", null, h("strong", null, `${a.date} ${a.time}`)),
            h("td", null, c?.name || "—"),
            h("td", null, h("strong", null, a.vehiclePlate)),
            h("td", { className: "muted-cell" }, `${a.vehicleMake || ""} ${a.vehicleModel || ""}`),
            h("td", null, a.serviceType),
            h("td", null, h("span", { className: `job-status ${a.status === "done" ? "status-done" : a.status === "cancelled" ? "status-cancelled" : "status-progress"}` }, h("i", null), a.status)),
            h("td", { className: "muted-cell" }, p?.name || "—"),
            h("td", { className: "action-cell", onClick: (e) => e.stopPropagation() },
              h("button", { className: "button button-small button-outline", type: "button", disabled: saving, onClick: () => openApptModal(a) }, "Düzenle"))
          );
        }))
      )) : h("div", { className: "empty-state" }, "Henüz randevu kaydı yok.")));
}

/* ─── Bildirim Sayfası ─────────────────────────────────────────────────────── */
function NotificationsPage({ notifications, openModal, saving }) {
  const [query, setQuery] = useState("");
  const filtered = notifications.filter((n) => `${n.title} ${n.message}`.toLocaleLowerCase("tr").includes(query.trim().toLocaleLowerCase("tr")));
  return h(React.Fragment, null,
    h("div", { className: "list-toolbar" },
      h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Bildirim başlığı veya mesajı ara..." })),
      h("button", { className: "button button-primary", type: "button", disabled: saving, onClick: () => openModal("notification") }, h(Icon, { name: "plus", size: 15 }), "Bildirim ekle")),
    h("section", { className: "panel table-panel" }, filtered.length ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["BAŞLIK", "MESAJ", "TÜR", "ALICI", "OKUNDU", "TARİH", "İŞLEM"].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, filtered.map((n) => h("tr", { key: n.id },
          h("td", null, h("strong", null, n.title)),
          h("td", { className: "muted-cell" }, n.message),
          h("td", null, n.type),
          h("td", { className: "muted-cell" }, n.recipientEmail),
          h("td", null, n.read ? "Evet" : "Hayır"),
          h("td", null, new Date(n.createdAt).toLocaleDateString("tr-TR")),
          h("td", { className: "action-cell", onClick: (e) => e.stopPropagation() },
            h("button", { className: "button button-small button-outline", type: "button", disabled: saving, onClick: () => openModal("notification", n) }, n.read ? "Geri al" : "Okundu işaretle"))
        ))
      ))
    ) : h("div", { className: "empty-state" }, "Henüz bildirim yok.")));
}

/* ─── İade Parçalar Sayfası ───────────────────────────────────────────────────── */
function ReturnsPage({ returns, openModal, saving }) {
  const [query, setQuery] = useState("");
  const filtered = returns.filter((r) => `${r.name} ${r.sku} ${r.supplier} ${r.reason}`.toLocaleLowerCase("tr").includes(query.trim().toLocaleLowerCase("tr")));
  const pendingCount = returns.filter((r) => r.status === "pending").length;
  return h(React.Fragment, null,
    h("div", { className: "list-toolbar" },
      h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Parça adı, SKU veya tedarikçi ara..." })),
      h("button", { className: "button button-primary", type: "button", disabled: saving, onClick: () => openModal("return") }, h(Icon, { name: "plus", size: 15 }), "İade parça ekle")),
    h("section", { className: "panel table-panel" }, filtered.length ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["PARÇA ADI", "SKU", "ADET", "İADE NEDENİ", "TEDARİKÇİ", "İADE TARİHİ", "DURUM", "İŞLEM"].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, filtered.map((r) => h("tr", { key: r.id },
          h("td", null, h("strong", null, r.name)),
          h("td", { className: "muted-cell" }, r.sku || "-"),
          h("td", null, r.quantity),
          h("td", { className: "muted-cell" }, r.reason || "-"),
          h("td", { className: "muted-cell" }, r.supplier || "-"),
          h("td", { className: "muted-cell" }, dateLabel(r.returnDate) || "-"),
          h("td", null, h("span", { className: `job-status ${r.status === "completed" ? "status-done" : r.status === "cancelled" ? "status-cancelled" : "status-progress"}` }, h("i", null), r.status === "pending" ? "Beklemede" : r.status === "completed" ? "Tamamlandı" : "İptal")),
          h("td", { className: "action-cell", onClick: (e) => e.stopPropagation() },
            h("button", { className: "button button-small button-outline", type: "button", disabled: saving, onClick: () => openModal("return", r) }, "Düzenle")
          )
        ))
      ))
    ) : h("div", { className: "empty-state" }, query ? "Aramanızla eşleşen iade parça bulunamadı." : `Henüz iade parça kaydı yok. ${pendingCount > 0 ? `${pendingCount} bekleyen iade var.` : ""}`)));
}

/* ─── Yedekleme Sayfası ────────────────────────────────────────────────────── */
function BackupPage({ data }) {
  const business = useBusiness();
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const addSheet = (name, rows) => {
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    addSheet("Parçalar", data.parts);
    addSheet("İş Emirleri", data.jobs);
    addSheet("Faturalar", data.invoices);
    addSheet("Müşteriler", data.customers);
    addSheet("Personel", data.personnel);
    addSheet("Randevular", data.appointments);
    addSheet("Bildirimler", data.notifications);
    XLSX.writeFile(wb, `demir-service-yedek-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const exportPdf = () => {
    const content = `# ${business.shortName} Yedek Raporu\nTarih: ${new Date().toLocaleString("tr-TR")}\n\n## Özet\n- Parça: ${data.parts.length}\n- İş Emri: ${data.jobs.length}\n- Fatura: ${data.invoices.length}\n- Müşteri: ${data.customers.length}\n- Personel: ${data.personnel.length}\n- Randevu: ${data.appointments.length}\n- Bildirim: ${data.notifications.length}`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `demir-service-rapor-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return h(React.Fragment, null,
    h("section", { className: "panel" },
      h("div", { className: "panel-heading" },
        h("div", null, h("h2", null, "Yedekleme ve Dışa Aktarım"), h("p", null, "Tüm verilerinizi Excel veya metin raporu olarak indirebilirsiniz."))),
      h("div", { className: "dashboard-secondary-actions" },
        h("button", { className: "button button-primary", onClick: exportExcel }, h(Icon, { name: "box", size: 16 }), "Excel'e Aktar"),
        h("button", { className: "button button-quiet", onClick: exportPdf }, h(Icon, { name: "receipt", size: 16 }), "Rapor İndir"))));
}
