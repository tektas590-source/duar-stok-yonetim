import React, { useCallback, useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { cancelWorkOrder, completeWorkOrder, createPurchaseInvoice, createStockDraft, createWorkOrder, deleteFitment, deletePart, deletePersonnel, deleteCustomer, deleteAppointment, deleteNotification, fetchServiceData, getPersonnelPerformance, grantUserAccess, listAppointments, listAuthorizedUsers, listCustomers, listNotifications, listPersonnel, markNotificationRead, receiveStockDraft, restorePart, revokeUserAccess, saveAppointment, saveCustomer, saveFitment, savePart, savePersonnel, sendChatMessage, subscribeToChat, subscribeToServiceData, togglePartFavorite, updateAppointmentStatus, updateWorkOrder } from "./data.js";
import * as XLSX from "xlsx";
import { getOpenWorkOrders, getRevenueEligibleWorkOrders, getWorkOrderStatusClass, WORK_ORDER_STATUS } from "./workOrderLifecycle.js";
import { formatFitmentSpec, formatFitmentVehicle, FUEL_TYPES, searchFitments, searchVehiclePartUsage } from "./vehicleCompatibility.js";
import { parseInvoicePaste } from "./invoiceImport.js";
import { findPartMatches, parsePastedPartQueries } from "./partSearch.js";
import { changeInitialPassword, firebaseConfigured, OWNER_EMAIL, registerWithPassword, requestPasswordReset, signInWithPassword, signOutUser, subscribeToAuth } from "./firebase.js";
import { calculateVat, VAT_RATE, vatIncludedAmount } from "./vat.js";
import { calculateWorkOrderNetTotal, calculateWorkOrderPriceBreakdown, normalizeLaborAmount } from "./workOrderPricing.js";

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
  const [theme, setTheme] = useState(() => localStorage.getItem("demir-service-theme") === "light" ? "light" : "dark");
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState({ parts: [], jobs: [], invoices: [], drafts: [], fitments: [], movements: [], customers: [], personnel: [], appointments: [], notifications: [] });
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
  const toggleTheme = () => setTheme((current) => current === "dark" ? "light" : "dark");

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
  const revenue = vatIncludedAmount(revenueEligibleJobs.reduce((sum, job) => sum + Number(job.total || 0), 0));
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
  const titles = { dashboard: ["Genel Bakış", "Servisinizin bugünkü durumuna göz atın."], inventory: ["Parça Envanteri", "Stoklarınızı ve parça fiyatlarınızı yönetin."], workorders: ["İş Emirleri", "Araç servis geçmişini ve devam eden işleri takip edin."], vehicles: ["Araç Servis Geçmişi", "Plakaya göre servis ziyaretlerini ve kullanılan parçaları bulun."], compatibility: ["Araç Uyumluluğu", "Marka, model, yakıt ve motor için uyumlu parçaları kaydedin; iş emri kullanımını da görün."], movements: ["Stok Hareketleri", "Giriş, çıkış ve düzeltmeleri kaynak ve kullanıcıyla izleyin."], invoices: ["Alış Faturaları", "Faturaları kaydedin, stok girişlerini anında işleyin."], orders: ["Taslak Siparişler", "Azalan parçalar için oluşturduğunuz sipariş önerileri."], reports: ["Raporlar", "Satış performansı ve iş emri cironuz."], stockcompare: ["Stok Karşılaştır", "Excel ile stok karşılaştırma yapın."], access: ["Yetkili Kullanıcılar", "Hesap ekleyin veya servis erişimini kaldırın."], chat: ["Sohbet", "Ekibinizle iletişim kurun."], servicebox: ["Peugeot ServiceBox", "Parça tespiti için Peugeot ServiceBox'a gidin."], customers: ["Müşteri Yönetimi", "Müşteri kayıtlarını, araçlarını ve iletişim bilgilerini yönetin."], personnel: ["Personel Yönetimi", "Çalışan kayıtlarını, rollerini ve performanslarını takip edin."], appointments: ["Randevu Takvimi", "Müşteri randevularını planlayın ve servis tarihlerini yönetin."], notifications: ["Bildirimler", "Düşük stok, randevu ve sistem bildirimlerini yönetin."], backup: ["Yedekleme", "Verilerinizi Excel/PDF olarak dışa aktarın ve yedekleyin."] };
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
  const persistJob = async (job) => {
    const isEditing = Boolean(job.id);
    await runAction(async () => {
      if (isEditing) await updateWorkOrder(job.id, job, user.email);
      else await createWorkOrder(job, user.email);
      await reloadData();
      setModal(null);
    }, isEditing ? "İş emri güncellendi; stok farkları ve hareket kayıtları işlendi." : "İş emri oluşturuldu, stoklar ve hareket geçmişi güncellendi.");
  };
  const persistInvoice = async (invoice) => {
    await runAction(async () => { await createPurchaseInvoice(invoice, user.email); await reloadData(); setModal(null); }, "Fatura kaydedildi, stoklar ve hareket geçmişi güncellendi.");
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
      h("div", { className: "brand" }, h("div", { className: "brand-mark" }, "D"), h("div", null, h("strong", null, "DEMİR"), h("span", null, "EUROREPAR CAR SERVICE"))),
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
      h("header", { className: "topbar" }, h("div", { className: "breadcrumbs" }, "Demir Service", h("span", null, "/"), titles[page][0]), h("div", { className: "topbar-right" }, h("button", { className: "icon-button", onClick: () => setGlobalSearchOpen(true), title: "Global ara (Ctrl+K)" }, h(Icon, { name: "search" })), h(LiveClock, { compact: true }), h("button", { className: "icon-button theme-toggle", onClick: toggleTheme, title: theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç", "aria-label": theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç" }, h(Icon, { name: theme === "dark" ? "sun" : "moon" })), h("button", { className: "icon-button notification", onClick: () => { if (lowStock.length) openCriticalInventory(); else { setQuery(""); setPage("inventory"); } setToast(`${lowStock.length} parçada kritik stok uyarısı var.`); }, title: "Stok uyarıları" }, h(Icon, { name: "bell" }), lowStock.length ? h("i", null) : null), h("div", { className: "top-avatar" }, "ST"))),
      h("section", { className: "page-content", key: page },
        h("div", { className: "page-heading" }, h("div", null, h("p", { className: "eyebrow" }, "DEMİR EUROREPAR CAR SERVICE"), h("h1", null, titles[page][0]), h("p", { className: "page-subtitle" }, titles[page][1])), h("div", { className: "heading-actions" },
          page === "dashboard" ? h("button", { className: "button button-primary", onClick: () => openModal("job"), disabled: saving }, h(Icon, { name: "plus", size: 16 }), "Yeni iş emri") :
          page === "inventory" ? h("button", { className: "button button-primary", onClick: () => openModal("part"), disabled: saving }, h(Icon, { name: "plus", size: 16 }), "Parça ekle") :
          page === "workorders" ? h("button", { className: "button button-primary", onClick: () => openModal("job"), disabled: saving }, h(Icon, { name: "plus", size: 16 }), "İş emri oluştur") :
          page === "invoices" ? h("button", { className: "button button-primary", onClick: () => openModal("invoice"), disabled: saving }, h(Icon, { name: "plus", size: 16 }), "Fatura ekle") :
          page === "orders" ? h("button", { className: "button button-primary", onClick: createDraft, disabled: saving }, h(Icon, { name: "plus", size: 16 }), "Sipariş taslağı oluştur") :
          page === "compatibility" ? h("button", { className: "button button-primary", onClick: () => openModal("fitment"), disabled: saving }, h(Icon, { name: "plus", size: 16 }), "Uyumluluk ekle") : null)),
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
        page === "inventory" ? h(Inventory, { parts: data.parts, query, setQuery, openModal, removePart, saving, filterIntent: inventoryFilterIntent, clearFilterIntent: () => setInventoryFilterIntent(null), toggleFavorite }) :
        page === "workorders" ? h(WorkOrders, { jobs: data.jobs, query, setQuery, openModal, markJobComplete, cancelJob, saving, selectionIntent: workOrderSelectionIntent, clearSelectionIntent: () => setWorkOrderSelectionIntent(null), statusFilterIntent: workOrderStatusFilterIntent, clearStatusFilterIntent: () => setWorkOrderStatusFilterIntent(null) }) :
        page === "vehicles" ? h(VehicleHistory, { jobs: data.jobs, queryIntent: vehicleQueryIntent, clearQueryIntent: () => setVehicleQueryIntent(null) }) :
        page === "compatibility" ? h(PartCompatibility, { jobs: data.jobs, fitments: data.fitments || [], openModal, removeFitment, saving }) :
        page === "movements" ? h(StockMovements, { movements: data.movements }) :
        page === "invoices" ? h(Invoices, { invoices: data.invoices }) :
        page === "orders" ? h(Orders, { drafts: data.drafts, lowStock, receiveDraft, createDraft }) :
        page === "stockcompare" ? h(StockCompare, { parts: data.parts, openModal }) :
        page === "chat" ? h(ChatPage, { messages: chatMessages, user, sendMessage: async (text) => { await sendChatMessage(user.email, user.displayName, text); }, saving, configured: firebaseConfigured }) :
        page === "servicebox" ? h(ServiceBoxPage) :
        page === "access" && isOwner ? h(AccessManagement, {
          onError: (error) => setErrorMessage(error.message || "Kullanıcı erişimi güncellenemedi."),
          onSuccess: (message) => setToast(message),
        }) :
        page === "customers" ? h(CustomersPage, { customers: data.customers, openModal, saving }) :
        page === "personnel" ? h(PersonnelPage, { personnel: data.personnel, jobs: data.jobs, openModal, saving }) :
        page === "appointments" ? h(AppointmentsPage, { appointments: data.appointments, customers: data.customers, personnel: data.personnel, jobs: data.jobs, openModal, saving }) :
        page === "notifications" ? h(NotificationsPage, { notifications: data.notifications, openModal, saving }) :
        page === "backup" ? h(BackupPage, { data }) :
        h(Reports, { data, revenue })
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
    modal ? h(Modal, { modal, parts: data.parts, customers: data.customers, personnel: data.personnel, onClose: () => setModal(null), onSavePart: persistPart, onSaveJob: persistJob, onSaveInvoice: persistInvoice, onSaveFitment: persistFitment, onSaveCustomer: persistCustomer, onSavePersonnel: persistPersonnel, onSaveAppointment: persistAppointment, onSaveNotification: persistNotification, saving }) : null,
    errorMessage ? h("div", { className: "toast toast-error", role: "alert" }, h("span", { className: "toast-check" }, "!"), errorMessage) : toast ? h("div", { className: "toast" }, h("span", { className: "toast-check" }, "✓"), toast, toastAction ? h("button", { className: "toast-action", onClick: () => toastAction.run().catch((error) => { console.error("Geri alma başarısız:", error); setErrorMessage(error.message || "Geri alma tamamlanamadı."); }) }, toastAction.label) : null) : null
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
  const [mode, setMode] = useState("login");
  const registering = mode === "register";
  const resetting = mode === "reset";
  return h("main", { className: "login-screen" }, h("div", { className: "login-decoration decoration-one" }), h("div", { className: "login-decoration decoration-two" }), h(ThemeToggle, { theme, toggleTheme, className: "standalone-theme-toggle" }), h("section", { className: "login-card" },
    h("div", { className: "login-brand" }, h("div", { className: "brand-mark large" }, "D"), h("div", null, h("strong", null, "DEMİR"), h("span", null, "EUROREPAR CAR SERVICE"))),
    h("div", { className: "login-copy" }, h("div", { className: "login-chip" }, h("span", { className: "status-dot" }), "DEMİR SERVICE YÖNETİMİ"), h("h1", null, registering ? "Hesap oluşturun." : resetting ? "Şifrenizi yenileyin." : "Güvenli giriş"), h("p", null, registering ? "E-posta doğrulamasından sonra servis yöneticiniz erişim izni verebilir." : resetting ? "Kullanıcı adınızı veya hesabınızın e-posta adresini yazın." : "Yalnızca servis yöneticisinin yetkilendirdiği hesaplar giriş yapabilir.")),
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
    h("div", { className: "login-foot" }, h("span", null, "E-posta doğrulama · yönetici onayı"), h("span", null, "Demir Eurorepar"))
  ));
}
function PasswordChange({ onSubmit, busy, error, theme, toggleTheme }) {
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
      h("div", { className: "login-brand" }, h("div", { className: "brand-mark large" }, "D"), h("div", null, h("strong", null, "DEMİR"), h("span", null, "EUROREPAR CAR SERVICE"))),
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
    ,
    h(AIAssistant, { personnel: data.personnel, customers: data.customers, appointments: data.appointments, parts: data.parts, jobs: data.jobs })
  );
}
function AIAssistant({ personnel, customers, appointments, parts, jobs }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    { id: "1", sender: "ai", text: "Merhaba! Ben Demir Service AI asistanınız. Personel, müşteri, randevu, parça stoku veya iş emirleri hakkında sorularınıza yardımcı olabilirim. Nasıl yardımcı olabilirim?" }
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

    if (q.includes("personel") || q.includes("çalışan")) {
      if (q.includes("maaş") || q.includes("komisyon")) {
        const top = [...personnel].sort((a, b) => Number(b.commissionRate || 0) - Number(a.commissionRate || 0))[0];
        return `Toplam ${pCount} personel kaydı var. En yüksek komisyon oranına sahip personel: ${top?.name || "yok"} (%${top?.commissionRate || 0}). Tüm personeli "Personel" sekmesinden görüntüleyebilirsiniz.`;
      }
      return `Sisteminizde toplam ${pCount} personel kaydı bulunuyor. Personel eklemek için "Personel" sekmesine gidin ve "Personel ekle" butonuna tıklayın.`;
    }
    if (q.includes("müşteri") || q.includes("arac") || q.includes("plaka")) {
      return `Toplam ${cCount} müşteri kaydı var. Müşteri ve araç kayıtlarını "Müşteri Yönetimi" sekmesinden yönetebilirsiniz.`;
    }
    if (q.includes("randevu")) {
      const pending = appointments.filter((a) => a.status === "pending").length;
      return `Toplam ${aCount} randevu var, ${pending} tanesi beklemede. Randevuları "Randevu Takvimi" sekmesinden planlayabilirsiniz.`;
    }
    if (q.includes("parça") || q.includes("stok") || q.includes("envanter")) {
      return `Toplam ${partCount} parça kaydı var, ${lowStock} tanesi Kritik stok seviyesinde (stok ≤ minimum). Parçaları "Parça Envanteri" sekmesinden görüntüleyebilirsiniz.`;
    }
    if (q.includes("fatura") || q.includes("alış") || q.includes("satış")) {
      return `Fatura kayıtlarını "Alış Faturaları" sekmesinden yönetebilirsiniz. Yeni fatura eklemek için "Fatura ekle" butonunu kullanın.`;
    }
    if (q.includes("iş emri") || q.includes("servis") || q.includes("çiro")) {
      return `Toplam ${jobCount} iş emri var, ${activeJobs} tanesi devam etmekte. Toplam ciro: ${money(totalRevenue)}. İş emirlerini "İş Emirleri" sekmesinden takip edebilirsiniz.`;
    }
    if (q.includes("merhaba") || q.includes("selam") || q.includes("nasılsın")) {
      return "Merhaba! Demir Service AI asistanınız olarak size yardımcı olmaya hazırım. Personel, müşteri, randevu, stok, fatura veya iş emirleri hakkında sorunuzu sorabilirsiniz.";
    }
    if (q.includes("yardım") || q.includes("ne yapabilir")) {
      return "Şunlar hakkında bilgi verebilirim: personel yönetimi, müşteri kayıtları, randevu planlama, parça stoku, fatura takibi ve iş emri ciro raporları. Sorunuzu yazın!";
    }
    return `Üzgünüm, bu konuda bilgi yokum. "Personel", "Müşteri", "Randevu", "Parça/Stok", "Fatura" veya "İş Emri" hakkında soru sorabilirsiniz. Toplam: ${pCount} personel, ${cCount} müşteri, ${aCount} randevu, ${partCount} parça, ${jobCount} iş emri.`;
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
        h("div", null, h("strong", null, "AI Asistan"), h("small", null, "Demir Service"))),
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
  const openJobs = getOpenWorkOrders(data.jobs).length;
  const recentJobs = [...data.jobs].sort((first, second) => (second.updatedAt || second.date || "").localeCompare(first.updatedAt || first.date || "")).slice(0, 5);
  const metrics = [
    { label: "Toplam ciro", value: money(revenue), caption: "Parça + işçilik · KDV dahil", onClick: onOpenTotalCiro || (() => setPage("reports")), title: "Ciro raporlarını görüntüle" },
    { label: "Açık iş emirleri", value: String(openJobs).padStart(2, "0"), caption: "Devam eden işler", onClick: onOpenOpenJobs || openWorkOrderList, title: "Devam eden iş emirlerini listele" },
    { label: "Envanter kalemi", value: String(data.parts.length).padStart(2, "0"), caption: `${data.parts.reduce((sum, part) => sum + Number(part.stock || 0), 0)} toplam adet`, onClick: onOpenInventory || (() => setPage("inventory")), title: "Tüm envanteri görüntüle" },
    { label: "Kritik stok", value: String(lowStock.length).padStart(2, "0"), caption: "Minimum seviyede veya altında", onClick: openCriticalInventory, title: "Kritik stoktaki parçaları filtrele" },
  ];
  return h(React.Fragment, null,
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
  const topParts = [...data.parts].sort((first, second) => Number(second.sold || 0) - Number(first.sold || 0)).slice(0, 5);
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
function Inventory({ parts, query, setQuery, openModal, removePart, saving, filterIntent, clearFilterIntent, toggleFavorite }) {
  const [stockFilter, setStockFilter] = useState(() => filterIntent || "all");
  useEffect(() => {
    if (!filterIntent) return;
    setStockFilter(filterIntent);
    clearFilterIntent();
  }, [filterIntent, clearFilterIntent]);
  const filtered = parts.filter((part) => `${part.name} ${part.sku} ${part.category} ${part.brand}`.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")) && (stockFilter === "all" || (stockFilter === "low" ? part.stock <= part.minimum : stockFilter === "good" ? part.stock > part.minimum : stockFilter === "favorite" ? part.favorite : true)));
  return h(React.Fragment, null,
    h("div", { className: "list-toolbar" },
      h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Parça adı, SKU veya kategori ara..." })),
      h("select", { className: "filter-select", value: stockFilter, onChange: (event) => setStockFilter(event.target.value), "aria-label": "Stok durumu filtresi" }, h("option", { value: "all" }, "Tüm stoklar"), h("option", { value: "low" }, "Kritik stok"), h("option", { value: "good" }, "Stok yeterli"), h("option", { value: "favorite" }, "Favoriler")),
      h("span", { className: "result-count" }, `${filtered.length} parça gösteriliyor`)
    ),
    h("section", { className: "panel table-panel" }, filtered.length ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["", "PARÇA", "KATEGORİ", "STOK DURUMU", "ALIŞ FİYATI · KDV HARİÇ", "SATIŞ FİYATI · KDV HARİÇ", ""].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, filtered.map((part) => h("tr", { key: part.id },
          h("td", null, h("button", { className: "icon-button favorite-button", type: "button", onClick: () => toggleFavorite(part.id), disabled: saving, title: part.favorite ? "Favoriden kaldır" : "Favorilere ekle" }, h(Icon, { name: part.favorite ? "bell" : "car", size: 14, className: part.favorite ? "favorite-active" : "" }))),
          h("td", null, h("div", { className: "table-part" }, h("span", { className: "part-avatar" }, part.name.slice(0, 1)), h("span", null, h("strong", null, part.name), h("small", null, part.sku)))),
          h("td", null, h("span", { className: "category-tag" }, part.category)),
          h("td", null, h(StockStatus, { part })),
          h("td", { className: "muted-cell" }, money(part.cost)),
          h("td", { className: "price-cell" }, money(part.price)),
          h("td", null, h("div", { className: "row-actions" },
            h("button", { className: "button button-small", disabled: saving, onClick: () => openModal("part", part) }, "Düzenle"),
            h("button", { className: "button button-small button-danger", disabled: saving, onClick: () => removePart(part), "aria-label": `${part.name} parçasını sil` }, "Arşivle")
          ))
        )))
      )
    ) : h("div", { className: "empty-state" }, "Aramanızla eşleşen parça bulunamadı."))
  );
}
function StockStatus({ part }) {
  const low = part.stock <= part.minimum;
  return h("span", { className: `stock-status ${low ? "stock-low" : "stock-good"}` }, h("i", null), `${part.stock} adet`, h("small", null, ` / min. ${part.minimum}`));
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
          selected === job.id ? h("tr", { className: "job-detail-row" }, h("td", { colSpan: 7 }, h("div", { className: "job-detail" }, h("strong", null, "Araç servis geçmişi / kullanılan parçalar"), job.items.map((item, index) => h("span", { key: `${item.partId || item.sku || item.name}-${index}` }, `${item.name} · ${item.qty} adet · ${money(Number(item.price || 0) * Number(item.qty || 0))} KDV hariç`)), h("span", null, `İşçilik · ${money(normalizeLaborAmount(job.laborAmount))} KDV hariç`), h("span", null, `Ara toplam · ${money(Number(job.total || 0))} KDV hariç`), h("span", null, `%${VAT_RATE * 100} KDV · ${money(calculateVat(Number(job.total || 0)).vat)}`), h("span", { className: "job-detail-total" }, `İş emri toplamı · ${money(vatIncludedAmount(job.total))} KDV dahil`), job.status === WORK_ORDER_STATUS.CANCELLED ? h("span", { className: "job-cancelled-note" }, "Kayıt iptal edildi; stok hareketleri korunuyor.") : h("div", { className: "job-lifecycle-actions" }, job.status === WORK_ORDER_STATUS.IN_PROGRESS ? h("button", { className: "button button-small", type: "button", disabled: saving, onClick: () => markJobComplete(job) }, "Tamamlandı") : null, h("button", { className: "button button-small button-danger", type: "button", disabled: saving, onClick: () => cancelJob(job) }, "İş emrini iptal et"), h("button", { className: "button button-small job-edit-action", type: "button", disabled: saving, onClick: () => openModal("job", job), "aria-label": `${job.code || "İş emri"} kaydını düzenle` }, "İş emrini düzenle"))))) : null
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
    query.trim() ? vehicles.length ? h(React.Fragment, null,
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
    ) : h("section", { className: "panel empty-state compact-empty" }, "Aramanızla eşleşen iş emri aracı bulunamadı.") : null
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
function Invoices({ invoices }) {
  return h("section", { className: "panel table-panel" }, invoices.length ? h("div", { className: "table-scroll" },
    h("table", null,
      h("thead", null, h("tr", null, ["FATURA NO", "TEDARİKÇİ", "TARİH", "KALEM", "TOPLAM · KDV DAHİL", "DURUM"].map((label) => h("th", { key: label }, label)))),
      h("tbody", null, invoices.map((invoice) => h("tr", { key: invoice.id },
        h("td", null, h("strong", { className: "job-id" }, invoice.code || invoice.id)),
        h("td", { className: "muted-cell" }, invoice.supplier),
        h("td", { className: "muted-cell" }, dateLabel(invoice.date)),
        h("td", null, `${invoice.lines} parça`),
        h("td", { className: "price-cell" }, money(vatIncludedAmount(invoice.total))),
        h("td", null, h("span", { className: "job-status status-done" }, h("i", null), invoice.status))
      )))
    )
  ) : h("div", { className: "empty-state" }, "Henüz alış faturası eklenmedi."));
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
function Reports({ data, revenue }) {
  const best = [...data.parts].sort((a, b) => b.sold - a.sold);
  const total = data.parts.reduce((sum, part) => sum + part.sold, 0);
  const cogs = vatIncludedAmount(getRevenueEligibleWorkOrders(data.jobs).reduce((sum, job) => sum + job.items.reduce((subtotal, item) => subtotal + (data.parts.find((part) => part.id === item.partId)?.cost || 0) * item.qty, 0), 0));
  const max = Math.max(...best.map((part) => part.sold), 1);
  return h(React.Fragment, null, h("div", { className: "metric-grid report-metrics" },
    h(ReportMetric, { label: "Toplam ciro", value: money(revenue), caption: "KDV dahil · kaydedilen iş emirleri", icon: "chart", color: "green" }),
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
  return h("div", { className: "vat-summary work-order-price-summary", "aria-label": "İş emri toplam özeti" },
    h("div", null, h("span", null, "Parça ara toplamı (KDV hariç)"), h("strong", null, money(values.partsSubtotal))),
    h("div", null, h("span", null, "İşçilik (KDV hariç)"), h("strong", null, money(values.laborAmount))),
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

function Modal({ modal, parts, customers, personnel, onClose, onSavePart, onSaveJob, onSaveInvoice, onSaveFitment, onSaveCustomer, onSavePersonnel, onSaveAppointment, onSaveNotification, saving }) {
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
          archived: !matchingPart
        };
      })
    : modal.type === "fitment" && modal.item
      ? (modal.item.parts || []).map((item) => ({ partId: item.partId || "", search: `${item.name || ""}${item.sku ? ` · ${item.sku}` : ""}`, name: item.name || "", sku: item.sku || "" }))
    : [{ partId: "", qty: 1, search: "" }]);
  const [status, setStatus] = useState(() => modal.item?.status || "IN_PROGRESS");
  const [businessDate, setBusinessDate] = useState(() => modal.item?.date || dateKey(new Date()));
  const [laborAmount, setLaborAmount] = useState(() => String(modal.item?.laborAmount ?? 0));
  const [error, setError] = useState("");
  const [pasteMessage, setPasteMessage] = useState("");
  const [invoiceMode, setInvoiceMode] = useState("code");
  const [pastedText, setPastedText] = useState("");
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [newInvoicePart, setNewInvoicePart] = useState({ sku: "", name: "", qty: "1", cost: "", price: "", category: "Genel", brand: "", minimum: "5" });
  const title = modal.type === "part" ? modal.item ? "Parçayı düzenle" : "Yeni parça ekle" : modal.type === "job" ? modal.item ? "İş emrini düzenle" : "Yeni iş emri" : modal.type === "fitment" ? modal.item ? "Uyumluluğu düzenle" : "Araç uyumluluğu ekle" : modal.type === "customer" ? modal.item ? "Müşteriyi düzenle" : "Yeni müşteri ekle" : modal.type === "personnel" ? modal.item ? "Personeli düzenle" : "Yeni personel ekle" : modal.type === "appointment" ? modal.item ? "Randevuyu düzenle" : "Yeni randevu ekle" : modal.type === "notification" ? modal.item ? "Bildirimi düzenle" : "Yeni bildirim ekle" : "Alış faturası ekle";
  const updateLine = (index, key, value) => setLines((current) => current.map((line, i) => i === index ? { ...line, [key]: value } : line));
  const addLine = () => setLines((current) => [...current, { partId: "", qty: 1, search: "" }]);
  const updateNewInvoicePart = (key, value) => setNewInvoicePart((current) => ({ ...current, [key]: value }));
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
    return line.partId && Number.isInteger(qty) && qty > 0 && Number.isFinite(price) && price >= 0 ? [{ qty, price }] : [];
  });
  let jobPricing = null;
  try {
    jobPricing = calculateWorkOrderPriceBreakdown(jobPreviewItems, parseCurrencyInput(laborAmount));
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
    if (modal.type === "invoice" && invoiceMode === "code") {
      if (!invoiceItems.length) {
        setError("Faturaya eklemek için yan bölümden en az bir stok kodu ekleyin.");
        return;
      }
      onSaveInvoice({ invoiceNumber: String(form.get("invoiceNumber")).trim(), supplier: String(form.get("supplier")).trim(), date: businessDate, items: invoiceItems, total: invoiceItems.reduce((sum, item) => sum + item.qty * item.cost, 0) });
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
      let total;
      try {
        normalizedLaborAmount = normalizeLaborAmount(parseCurrencyInput(laborAmount));
        total = calculateWorkOrderNetTotal(items, normalizedLaborAmount);
      } catch (pricingError) {
        setError(pricingError.message || "İş emri tutarlarını kontrol edin.");
        return;
      }
      if (!items.length && normalizedLaborAmount <= 0) {
        setError("İş emri için en az bir parça veya işçilik tutarı girmelisiniz.");
        return;
      }
      const previousByPart = new Map();
      (modal.item?.items || []).forEach((item) => previousByPart.set(item.partId, (previousByPart.get(item.partId) || 0) + Number(item.qty || 0)));
      const requiredByPart = items.reduce((totals, item) => ({ ...totals, [item.partId]: (totals[item.partId] || 0) + item.qty }), {});
      const insufficientPart = Object.entries(requiredByPart).find(([id, qty]) => {
        const delta = qty - (previousByPart.get(id) || 0);
        return delta > (parts.find((part) => part.id === id)?.stock ?? 0);
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
        total,
        status: modal.item ? status : "IN_PROGRESS"
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
      h("label", null, index === 0 ? "Adet" : " ", h("input", { type: "number", min: 1, max: type === "job" ? line.archived ? line.originalQty : part ? part.stock + (line.originalQty || 0) : undefined : undefined, value: line.qty, onChange: (event) => updateLine(index, "qty", event.target.value), required: true })),
      type === "job" ? h("label", null, index === 0 ? "Birim satış (₺)" : " ", h(CurrencyInput, { value: String(line.price !== undefined && line.price !== null ? line.price : (part?.price ?? "")), onChange: (val) => updateLine(index, "price", val), placeholder: "0,00" })) : null,
      type === "job" ? h("button", { className: "button button-small button-danger job-line-remove", type: "button", onClick: () => setLines((current) => { const next = current.filter((_, lineIndex) => lineIndex !== index); return next.length ? next : [{ partId: "", qty: 1, search: "" }]; }), "aria-label": `${line.name || part?.name || `Parça ${index + 1}`} satırını kaldır` }, h(Icon, { name: "close", size: 14 })) : null,
      type === "invoice" ? h("label", null, index === 0 ? "Birim alış · KDV hariç (₺)" : " ", h(CurrencyInput, { value: line.cost ?? part?.cost ?? "", onChange: (val) => updateLine(index, "cost", val), required: true })) : null,
      type === "invoice" ? h("label", null, index === 0 ? "Satış fiyatı · KDV hariç (₺)" : " ", h(CurrencyInput, { value: line.price ?? part?.price ?? "", onChange: (val) => updateLine(index, "price", val), required: true })) : null
    );
  }
  return h("div", { className: "modal-backdrop", onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); } }, h("section", { className: `modal-card ${modal.type === "invoice" ? "invoice-modal" : ""}`, role: "dialog", "aria-modal": "true", "aria-labelledby": "modal-title" },
    h("div", { className: "modal-header" }, h("div", null, h("p", { className: "eyebrow" }, "DEMİR SERVICE"), h("h2", { id: "modal-title" }, title)), h("button", { className: "icon-button", onClick: onClose, type: "button", title: "Kapat" }, h(Icon, { name: "close" }))),
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
          modal.item ? h("label", null, "İş emri durumu",
            h("select", {
              value: status,
              onChange: (e) => setStatus(e.target.value)
            },
              h("option", { value: "IN_PROGRESS" }, "Devam ediyor"),
              h("option", { value: "COMPLETED" }, "Tamamlandı")
            )
          ) : null
        ),
        h("div", { className: "modal-section-title" }, "Kullanılan parçalar", h("span", null, "Stok farkları kayıtta uygulanır")), h("p", { className: "part-paste-hint" }, "Satış fiyatları KDV hariçtir. Kodun sonundan arayabilir ya da Excel'den birden fazla satırı doğrudan yapıştırabilirsiniz.", pasteMessage ? h("strong", null, ` ${pasteMessage}`) : null), h("div", { className: "modal-lines" }, lines.map((line, index) => partLine(line, index, "job"))), h("button", { className: "add-line-button", type: "button", onClick: addLine }, h(Icon, { name: "plus", size: 15 }), "Parça satırı ekle"),
        h("div", { className: "labor-amount-field" }, h("label", { htmlFor: "work-order-labor" }, "İşçilik tutarı · KDV hariç (₺)"), h(CurrencyInput, { id: "work-order-labor", value: laborAmount, onChange: (val) => { setLaborAmount(val); setError(""); }, "aria-describedby": "work-order-labor-hint" }), h("small", { id: "work-order-labor-hint" }, "Tek işçilik tutarı. Boş bırakılırsa 0 ₺ kaydedilir."))
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
      ) : h(React.Fragment, null,
        h("div", { className: "form-grid invoice-meta-grid" },
          h("label", null, "Fatura numarası", h("input", { name: "invoiceNumber", placeholder: "Tedarikçi fatura numarası", required: true })),
          h("label", null, "Tedarikçi", h("input", { name: "supplier", placeholder: "Tedarikçi firma adı", required: true })),
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
      h("div", { className: "modal-footer" }, h("button", { className: "button button-quiet", onClick: onClose, type: "button", disabled: saving }, "Vazgeç"), h("button", { className: "button button-primary", type: "submit", disabled: saving }, saving ? "Kaydediliyor..." : modal.type === "part" ? "Kaydet" : modal.type === "job" ? modal.item ? "İş emrini güncelle" : "İş emrini oluştur" : modal.type === "fitment" ? "Uyumluluğu kaydet" : modal.type === "customer" ? "Müşteriyi kaydet" : modal.type === "personnel" ? "Personeli kaydet" : modal.type === "appointment" ? "Randevuyu kaydet" : modal.type === "notification" ? "Bildirimi oluştur" : "Faturayı kaydet", saving ? null : h(Icon, { name: "arrow", size: 15 })))
    )
  ));
}

createRoot(document.getElementById("root")).render(h(React.StrictMode, null, h(App)));

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

/* ─── Yedekleme Sayfası ────────────────────────────────────────────────────── */
function BackupPage({ data }) {
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
    const content = `# Demir Service Yedek Raporu\nTarih: ${new Date().toLocaleString("tr-TR")}\n\n## Özet\n- Parça: ${data.parts.length}\n- İş Emri: ${data.jobs.length}\n- Fatura: ${data.invoices.length}\n- Müşteri: ${data.customers.length}\n- Personel: ${data.personnel.length}\n- Randevu: ${data.appointments.length}\n- Bildirim: ${data.notifications.length}`;
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