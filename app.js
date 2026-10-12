import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { supabase, isSupabaseConfigured } from "./supabase.js";
import { createPurchaseInvoice, createStockDraft, createWorkOrder, deletePart, fetchServiceData, receiveStockDraft, savePart, subscribeToServiceData } from "./data.js";
import { parseInvoicePaste } from "./invoiceImport.js";

const h = React.createElement;
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
};
function Icon({ name, size = 18, className = "" }) {
  return h("svg", { className, width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, h("path", { d: iconPaths[name] || iconPaths.grid }));
}
function money(amount) { return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(amount || 0); }
function dateLabel(value) { return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("demir-service-theme") === "light" ? "light" : "dark");
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState({ parts: [], jobs: [], invoices: [], drafts: [] });
  const [dataLoading, setDataLoading] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [page, setPage] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const userId = user?.id;
  const toggleTheme = () => setTheme((current) => current === "dark" ? "light" : "dark");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("demir-service-theme", theme);
  }, [theme]);
  const reloadData = useCallback(async () => {
    if (!userId) return;
    setData(await fetchServiceData());
  }, [userId]);
  useEffect(() => {
    if (!supabase) return undefined;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) setErrorMessage(error.message);
      setUser(session?.user ?? null);
      setAuthReady(true);
    }).catch((error) => {
      console.error("Supabase oturumu okunamadı:", error);
      setErrorMessage(error.message || "Oturum doğrulanamadı.");
      setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!userId) {
      setData({ parts: [], jobs: [], invoices: [], drafts: [] });
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
        console.error("Supabase verileri yüklenemedi:", error);
        if (active) setErrorMessage(`Bulut verileri yüklenemedi: ${error.message || "Bilinmeyen hata"}`);
      } finally {
        if (active) setDataLoading(false);
      }
    };
    load();
    const unsubscribe = subscribeToServiceData(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        load().catch((error) => console.error("Canlı veri yenilenemedi:", error));
      }, 180);
    });
    return () => { active = false; window.clearTimeout(timer); unsubscribe(); };
  }, [userId]);

  const lowStock = data.parts.filter((part) => part.stock <= part.minimum);
  const revenue = data.jobs.reduce((sum, job) => sum + Number(job.total || 0), 0);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(""), 3200); return () => clearTimeout(timer); } }, [toast]);

  const nav = [
    { id: "dashboard", label: "Genel Bakış", icon: "grid" },
    { id: "inventory", label: "Parça Envanteri", icon: "box", badge: lowStock.length },
    { id: "workorders", label: "İş Emirleri", icon: "wrench" },
    { id: "invoices", label: "Alış Faturaları", icon: "receipt" },
    { id: "orders", label: "Taslak Siparişler", icon: "cart", badge: data.drafts.length || null },
    { id: "reports", label: "Raporlar", icon: "chart" },
  ];
  const titles = { dashboard: ["Genel Bakış", "Servisinizin bugünkü durumuna göz atın."], inventory: ["Parça Envanteri", "Stoklarınızı ve parça fiyatlarınızı yönetin."], workorders: ["İş Emirleri", "Araç servis geçmişini ve devam eden işleri takip edin."], invoices: ["Alış Faturaları", "Faturaları kaydedin, stok girişlerini anında işleyin."], orders: ["Taslak Siparişler", "Azalan parçalar için oluşturduğunuz sipariş önerileri."], reports: ["Raporlar", "Satış performansı ve servis cironuz."] };
  const openModal = (type, item = null) => setModal({ type, item });
  const runAction = async (action, success) => {
    setErrorMessage("");
    try {
      await action();
      if (success) setToast(success);
    } catch (error) {
      console.error("Supabase işlemi başarısız:", error);
      setErrorMessage(error.message || "İşlem tamamlanamadı.");
    }
  };
  const persistPart = async (part) => {
    if (data.parts.some((entry) => entry.sku.toLocaleLowerCase("tr") === part.sku.toLocaleLowerCase("tr") && entry.id !== part.id)) {
      setErrorMessage("Bu SKU kodu başka bir parçada kullanılıyor.");
      return;
    }
    await runAction(async () => { await savePart(part, userId); await reloadData(); setModal(null); }, "Parça buluta kaydedildi.");
  };
  const removePart = async (part) => {
    if (!window.confirm(`"${part.name}" parçasını envanterden silmek istiyor musunuz? Geçmiş işlem satırları korunur.`)) return;
    await runAction(async () => { await deletePart(part.id); await reloadData(); }, "Parça envanterden silindi.");
  };
  const persistJob = async (job) => {
    await runAction(async () => { await createWorkOrder(job); await reloadData(); setModal(null); }, "İş emri oluşturuldu; stoklar bulutta güncellendi.");
  };
  const persistInvoice = async (invoice) => {
    await runAction(async () => { await createPurchaseInvoice(invoice); await reloadData(); setModal(null); }, "Fatura buluta kaydedildi, stoklar artırıldı.");
  };
  const createDraft = async () => {
    await runAction(async () => { await createStockDraft(); await reloadData(); setPage("orders"); }, "Kritik stoklar için bulutta sipariş taslağı oluşturuldu.");
  };
  const receiveDraft = async (id) => {
    await runAction(async () => { await receiveStockDraft(id); await reloadData(); }, "Sipariş stoğa işlendi.");
  };
  async function authenticate(event, mode) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setErrorMessage(""); setToast(""); setAuthBusy(true);
    try {
      const credentials = { email: String(form.get("email")), password: String(form.get("password")) };
      const result = mode === "signup"
        ? await supabase.auth.signUp({ ...credentials, options: { data: { full_name: "Serkan TEKTAŞ", service_name: "Demir Eurorepar Car Service" } } })
        : await supabase.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      if (mode === "signup" && !result.data.session) setToast("Hesabınız oluşturuldu. Giriş yapmadan önce e-postanızı doğrulayın.");
    } catch (error) {
      console.error("Supabase kimlik doğrulaması başarısız:", error);
      setErrorMessage(error.message || "Giriş yapılamadı.");
    } finally { setAuthBusy(false); }
  }
  if (!isSupabaseConfigured) return h(ConfigurationNotice, { theme, toggleTheme });
  if (!authReady) return h(LoadingScreen, { message: "Supabase oturumu doğrulanıyor..." });
  if (!user) return h(Login, { onSubmit: authenticate, busy: authBusy, error: errorMessage, notice: toast, theme, toggleTheme });
  if (dataLoading && !data.parts.length && !data.jobs.length && !data.invoices.length) return h(LoadingScreen, { message: "Servis verileri buluttan yükleniyor..." });
  return h("div", { className: "app-shell" },
    h("aside", { className: "sidebar" },
      h("div", { className: "brand" }, h("div", { className: "brand-mark" }, "D"), h("div", null, h("strong", null, "DEMİR"), h("span", null, "EUROREPAR CAR SERVICE"))),
      h("div", { className: "side-label" }, "ÇALIŞMA ALANI"),
      h("nav", { className: "navigation" }, nav.map((item) => h("button", { key: item.id, className: `nav-item ${page === item.id ? "active" : ""}`, onClick: () => { setPage(item.id); setQuery(""); } }, h(Icon, { name: item.icon }), h("span", null, item.label), item.badge ? h("span", { className: "nav-badge" }, item.badge) : null))),
      h("div", { className: "sidebar-bottom" }, h("div", { className: "sidebar-help" }, h("div", { className: "help-icon" }, h(Icon, { name: "wrench", size: 17 })), h("strong", null, "Servis yönetimi"), h("span", null, "Tüm operasyonlarınız tek yerde.")), h("div", { className: "profile" }, h("div", { className: "avatar" }, (user.user_metadata?.full_name || "Serkan TEKTAŞ").split(/\s+/).map((name) => name[0]).join("").slice(0, 2)), h("div", { className: "profile-info" }, h("strong", null, user.user_metadata?.full_name || "Serkan TEKTAŞ"), h("span", null, user.email)), h("button", { className: "icon-button logout", onClick: () => runAction(async () => { const { error } = await supabase.auth.signOut(); if (error) throw error; setUser(null); }, "Oturum kapatıldı."), title: "Oturumu kapat" }, h(Icon, { name: "logout", size: 17 })))),
    ),
    h("main", { className: "main-area" },
      h("header", { className: "topbar" }, h("div", { className: "breadcrumbs" }, "Demir Service", h("span", null, "/"), titles[page][0]), h("div", { className: "topbar-right" }, h("span", { className: "today-label" }, dateLabel(new Date().toISOString().slice(0, 10))), h("button", { className: "icon-button theme-toggle", onClick: toggleTheme, title: theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç", "aria-label": theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç" }, h(Icon, { name: theme === "dark" ? "sun" : "moon" })), h("button", { className: "icon-button notification", onClick: () => { setPage("inventory"); setToast(`${lowStock.length} parçada kritik stok uyarısı var.`); }, title: "Stok uyarıları" }, h(Icon, { name: "bell" }), lowStock.length ? h("i", null) : null), h("div", { className: "top-avatar" }, "ST"))),
      h("section", { className: "page-content", key: page },
        h("div", { className: "page-heading" }, h("div", null, h("p", { className: "eyebrow" }, "DEMİR EUROREPAR CAR SERVICE"), h("h1", null, titles[page][0]), h("p", { className: "page-subtitle" }, titles[page][1])), h("div", { className: "heading-actions" },
          page === "dashboard" ? h("button", { className: "button button-primary", onClick: () => openModal("job") }, h(Icon, { name: "plus", size: 16 }), "Yeni iş emri") :
          page === "inventory" ? h("button", { className: "button button-primary", onClick: () => openModal("part") }, h(Icon, { name: "plus", size: 16 }), "Parça ekle") :
          page === "workorders" ? h("button", { className: "button button-primary", onClick: () => openModal("job") }, h(Icon, { name: "plus", size: 16 }), "İş emri oluştur") :
          page === "invoices" ? h("button", { className: "button button-primary", onClick: () => openModal("invoice") }, h(Icon, { name: "plus", size: 16 }), "Fatura ekle") :
          page === "orders" ? h("button", { className: "button button-primary", onClick: createDraft }, h(Icon, { name: "plus", size: 16 }), "Sipariş taslağı oluştur") : null)),
        page === "dashboard" ? h(Dashboard, { data, lowStock, revenue, setPage, openModal, createDraft }) :
        page === "inventory" ? h(Inventory, { parts: data.parts, query, setQuery, openModal, removePart }) :
        page === "workorders" ? h(WorkOrders, { jobs: data.jobs, query, setQuery }) :
        page === "invoices" ? h(Invoices, { invoices: data.invoices }) :
        page === "orders" ? h(Orders, { drafts: data.drafts, lowStock, receiveDraft, createDraft }) :
        h(Reports, { data, revenue })
      )
    ),
    modal ? h(Modal, { modal, parts: data.parts, onClose: () => setModal(null), onSavePart: persistPart, onSaveJob: persistJob, onSaveInvoice: persistInvoice }) : null,
    errorMessage ? h("div", { className: "toast toast-error", role: "alert" }, h("span", { className: "toast-check" }, "!"), errorMessage) : toast ? h("div", { className: "toast" }, h("span", { className: "toast-check" }, "✓"), toast) : null
  );
}

function ConfigurationNotice({ theme, toggleTheme }) {
  return h("main", { className: "login-screen" }, h(ThemeToggle, { theme, toggleTheme, className: "standalone-theme-toggle" }), h("section", { className: "login-card setup-card" },
    h("div", { className: "login-brand" }, h("div", { className: "brand-mark large" }, "D"), h("div", null, h("strong", null, "DEMİR"), h("span", null, "EUROREPAR CAR SERVICE"))),
    h("div", { className: "login-copy" }, h("div", { className: "login-chip" }, "SUPABASE BAĞLANTISI GEREKLİ"), h("h1", null, "Bulut bağlantısını tamamlayın."), h("p", null, "Supabase projenizi oluşturup bağlantı bilgilerini .env.local dosyasına ekleyin.")),
    h("div", { className: "setup-steps" }, h("span", null, "1. Supabase projesi oluşturun"), h("span", null, "2. supabase/schema.sql içeriğini SQL Editor'de çalıştırın"), h("span", null, "3. VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY değerlerini tanımlayın"), h("span", null, "4. Geliştirme sunucusunu yeniden başlatın")),
    h("p", { className: "login-foot" }, "Kurulum ayrıntıları README.md dosyasında.")
  ));
}
function LoadingScreen({ message }) {
  return h("main", { className: "login-screen" }, h("section", { className: "login-card loading-card" }, h("div", { className: "loading-spinner" }), h("p", null, message)));
}
function ThemeToggle({ theme, toggleTheme, className = "" }) {
  const isDark = theme === "dark";
  return h("button", { className: `icon-button theme-toggle ${className}`, onClick: toggleTheme, type: "button", title: isDark ? "Açık temaya geç" : "Koyu temaya geç", "aria-label": isDark ? "Açık temaya geç" : "Koyu temaya geç" }, h(Icon, { name: isDark ? "sun" : "moon" }));
}
function Login({ onSubmit, busy, error, notice, theme, toggleTheme }) {
  const [mode, setMode] = useState("login");
  return h("main", { className: "login-screen" }, h("div", { className: "login-decoration decoration-one" }), h("div", { className: "login-decoration decoration-two" }), h(ThemeToggle, { theme, toggleTheme, className: "standalone-theme-toggle" }), h("section", { className: "login-card" },
    h("div", { className: "login-brand" }, h("div", { className: "brand-mark large" }, "D"), h("div", null, h("strong", null, "DEMİR"), h("span", null, "EUROREPAR CAR SERVICE"))),
    h("div", { className: "login-copy" }, h("div", { className: "login-chip" }, h("span", { className: "status-dot" }), "SUPABASE GÜVENLİ OTURUMU"), h("h1", null, mode === "login" ? "Tekrar hoş geldiniz." : "Servis hesabınızı oluşturun."), h("p", null, mode === "login" ? "Bulut servis verilerinize güvenle erişin." : "Hesabınız açıldığında servis verileriniz bu hesaba özel tutulur.")),
    h("form", { className: "login-form", onSubmit: (event) => onSubmit(event, mode) },
      h("label", null, "E-posta adresi", h("input", { name: "email", type: "email", placeholder: "ornek@demirservis.com", required: true, autoComplete: "username" })),
      h("label", null, "Şifre", h("input", { name: "password", type: "password", placeholder: "En az 6 karakter", minLength: 6, required: true, autoComplete: mode === "login" ? "current-password" : "new-password" })),
      error ? h("p", { className: "form-error", role: "alert" }, error) : null,
      notice ? h("p", { className: "form-notice", role: "status" }, notice) : null,
      h("button", { className: "button button-primary login-submit", type: "submit", disabled: busy }, busy ? "İşleniyor..." : mode === "login" ? "Giriş yap" : "Hesap oluştur", h(Icon, { name: "arrow", size: 17 }))
    ),
    h("button", { className: "auth-mode-button", type: "button", onClick: () => setMode(mode === "login" ? "signup" : "login") }, mode === "login" ? "İlk kez mi kullanıyorsunuz? Hesap oluşturun" : "Hesabınız var mı? Giriş yapın"),
    h("div", { className: "login-foot" }, h("span", null, "Giriş ve hesap işlemleri Supabase ile korunur."), h("span", null, "Demir Eurorepar"))
  ));
}
function Dashboard({ data, lowStock, revenue, setPage, openModal, createDraft }) {
  const openJobs = data.jobs.filter((job) => job.status !== "Tamamlandı").length;
  const top = [...data.parts].sort((a, b) => b.sold - a.sold).slice(0, 4);
  const max = Math.max(...top.map((part) => part.sold), 1);
  const metrics = [
    ["Toplam ciro", money(revenue), "Kaydedilen tüm iş emirleri", "chart", "green", "Servis geliri"],
    ["Açık iş emirleri", String(openJobs).padStart(2, "0"), "İşlem bekleyen araçlar", "wrench", "blue", `${data.jobs.length} toplam iş emri`],
    ["Envanter kalemi", String(data.parts.length).padStart(2, "0"), "Takip edilen parça çeşidi", "box", "purple", `${data.parts.reduce((sum, part) => sum + part.stock, 0)} toplam adet`],
    ["Kritik stok", String(lowStock.length).padStart(2, "0"), "Minimum seviyenin altında", "bell", "orange", "Yeniden sipariş gerekli"],
  ];
  return h(React.Fragment, null,
    h("div", { className: "metric-grid" }, metrics.map(([label, value, caption, icon, color, delta]) =>
      h("article", { className: "metric-card", key: label },
        h("div", { className: "metric-top" }, h("span", null, label), h("span", { className: `metric-icon ${color}` }, h(Icon, { name: icon, size: 18 }))),
        h("strong", { className: "metric-value" }, value),
        h("div", { className: "metric-bottom" }, h("span", null, caption), h("span", { className: "metric-delta" }, delta))
      )
    )),
    h("div", { className: "dashboard-grid" },
      h("section", { className: "panel revenue-panel" }, h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "Servis performansı"), h("p", null, "En çok işlem gören parçalar")), h("button", { className: "text-button", onClick: () => setPage("reports") }, "Raporları gör", h(Icon, { name: "arrow", size: 15 }))), h("div", { className: "bar-chart" }, top.map((part, index) => h("div", { className: "chart-row", key: part.id }, h("div", { className: "chart-label" }, h("span", null, part.name), h("strong", null, `${part.sold} adet`)), h("div", { className: "bar-track" }, h("div", { className: `bar-fill bar-${index + 1}`, style: { width: `${Math.max(8, part.sold / max * 100)}%` } }))))), h("div", { className: "chart-footer" }, h("span", null, "En çok satan parçalar"), h("span", null, "Satış adedi"))),
      h("section", { className: "panel quick-panel" }, h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "Hızlı işlemler"), h("p", null, "Günlük işlerinize hemen başlayın"))), h("div", { className: "quick-actions" },
        h(QuickAction, { icon: "wrench", color: "green", title: "İş emri oluştur", subtitle: "Yeni araç kabulü", onClick: () => openModal("job") }),
        h(QuickAction, { icon: "receipt", color: "blue", title: "Alış faturası ekle", subtitle: "Stoğa parça girişi", onClick: () => openModal("invoice") }),
        h(QuickAction, { icon: "cart", color: "orange", title: "Sipariş listesi hazırla", subtitle: `${lowStock.length} kritik stok kalemi`, onClick: createDraft })
      )),
      h("section", { className: "panel recent-panel" }, h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "Son iş emirleri"), h("p", null, "Servisinizdeki güncel araçlar")), h("button", { className: "text-button", onClick: () => setPage("workorders") }, "Tümünü gör", h(Icon, { name: "arrow", size: 15 }))), h(JobTable, { jobs: data.jobs.slice(0, 4), compact: true })),
      h("section", { className: "panel lowstock-panel" }, h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "Stok uyarıları"), h("p", null, "Yeniden sipariş verilmesi gerekenler")), h("button", { className: "text-button", onClick: () => setPage("inventory") }, "Envantere git", h(Icon, { name: "arrow", size: 15 }))), lowStock.length ? h("div", { className: "alert-list" }, lowStock.slice(0, 4).map((part) => h("div", { className: "alert-item", key: part.id }, h("span", { className: "part-avatar" }, part.name.slice(0, 1)), h("div", { className: "alert-name" }, h("strong", null, part.name), h("span", null, part.sku)), h("span", { className: "stock-alert" }, `${part.stock} / ${part.minimum} adet`)))) : h("div", { className: "empty-state compact-empty" }, "Kritik stok uyarısı bulunmuyor."))
    )
  );
}
function QuickAction({ icon, color, title, subtitle, onClick }) {
  return h("button", { className: "quick-action", onClick }, h("span", { className: `quick-icon quick-${color}` }, h(Icon, { name: icon })), h("span", null, h("strong", null, title), h("small", null, subtitle)), h(Icon, { name: "arrow", size: 16, className: "quick-arrow" }));
}
function Inventory({ parts, query, setQuery, openModal, removePart }) {
  const filtered = parts.filter((part) => `${part.name} ${part.sku} ${part.category} ${part.brand}`.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")));
  return h(React.Fragment, null,
    h("div", { className: "list-toolbar" },
      h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Parça adı, SKU veya kategori ara..." })),
      h("span", { className: "result-count" }, `${filtered.length} parça gösteriliyor`)
    ),
    h("section", { className: "panel table-panel" }, filtered.length ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["PARÇA", "KATEGORİ", "STOK DURUMU", "ALIŞ FİYATI", "SATIŞ FİYATI", ""].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, filtered.map((part) => h("tr", { key: part.id },
          h("td", null, h("div", { className: "table-part" }, h("span", { className: "part-avatar" }, part.name.slice(0, 1)), h("span", null, h("strong", null, part.name), h("small", null, part.sku)))),
          h("td", null, h("span", { className: "category-tag" }, part.category)),
          h("td", null, h(StockStatus, { part })),
          h("td", { className: "muted-cell" }, money(part.cost)),
          h("td", { className: "price-cell" }, money(part.price)),
          h("td", null, h("div", { className: "row-actions" },
            h("button", { className: "button button-small", onClick: () => openModal("part", part) }, "Düzenle"),
            h("button", { className: "button button-small button-danger", onClick: () => removePart(part), "aria-label": `${part.name} parçasını sil` }, "Sil")
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
      h("thead", null, h("tr", null, ["İŞ EMRİ", "ARAÇ", "MÜŞTERİ", "TUTAR", "DURUM"].map((label) => h("th", { key: label }, label)))),
      h("tbody", null, jobs.map((job) => h("tr", { key: job.id },
        h("td", null, h("strong", { className: "job-id" }, job.code || job.id), h("small", { className: "table-date" }, dateLabel(job.date))),
        h("td", null, h("div", { className: "vehicle-cell" }, h("strong", null, job.plate), h("small", null, `${job.make} ${job.model}`))),
        h("td", { className: "muted-cell" }, job.customer),
        h("td", { className: "price-cell" }, money(job.total)),
        h("td", null, h("span", { className: `job-status ${job.status === "Tamamlandı" ? "status-done" : "status-progress"}` }, h("i", null), job.status))
      )))
    )
  );
}
function WorkOrders({ jobs, query, setQuery }) {
  const [selected, setSelected] = useState(null);
  const filtered = jobs.filter((job) => `${job.code || job.id} ${job.plate} ${job.customer} ${job.make} ${job.model}`.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")));
  return h(React.Fragment, null,
    h("div", { className: "list-toolbar" },
      h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Plaka, müşteri veya iş emri ara..." })),
      h("span", { className: "result-count" }, `${filtered.length} iş emri`)
    ),
    h("section", { className: "panel table-panel" }, filtered.length ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["İŞ EMRİ", "ARAÇ", "MÜŞTERİ", "İŞLEM / PARÇALAR", "TUTAR", "DURUM"].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, filtered.map((job) => h(React.Fragment, { key: job.id },
          h("tr", { className: "clickable-row", onClick: () => setSelected(selected === job.id ? null : job.id) },
            h("td", null, h("strong", { className: "job-id" }, job.code || job.id), h("small", { className: "table-date" }, dateLabel(job.date))),
            h("td", null, h("div", { className: "vehicle-cell" }, h("strong", null, job.plate), h("small", null, `${job.make} ${job.model}`))),
            h("td", null, h("div", { className: "vehicle-cell" }, h("strong", null, job.customer), h("small", null, job.phone || "Telefon belirtilmedi"))),
            h("td", null, h("span", { className: "muted-cell" }, `${job.items.length} parça kalemi`)),
            h("td", { className: "price-cell" }, money(job.total)),
            h("td", null, h("span", { className: `job-status ${job.status === "Tamamlandı" ? "status-done" : "status-progress"}` }, h("i", null), job.status))
          ),
          selected === job.id ? h("tr", { className: "job-detail-row" }, h("td", { colSpan: 6 }, h("div", { className: "job-detail" }, h("strong", null, "Araç servis geçmişi / kullanılan parçalar"), job.items.map((item, index) => h("span", { key: `${item.name}-${index}` }, `${item.name} · ${item.qty} adet · ${money(item.price * item.qty)}`))))) : null
        )))
      )
    ) : h("div", { className: "empty-state" }, "Henüz iş emri bulunmuyor."))
  );
}
function Invoices({ invoices }) {
  return h("section", { className: "panel table-panel" }, invoices.length ? h("div", { className: "table-scroll" },
    h("table", null,
      h("thead", null, h("tr", null, ["FATURA NO", "TEDARİKÇİ", "TARİH", "KALEM", "TOPLAM", "DURUM"].map((label) => h("th", { key: label }, label)))),
      h("tbody", null, invoices.map((invoice) => h("tr", { key: invoice.id },
        h("td", null, h("strong", { className: "job-id" }, invoice.code || invoice.id)),
        h("td", { className: "muted-cell" }, invoice.supplier),
        h("td", { className: "muted-cell" }, dateLabel(invoice.date)),
        h("td", null, `${invoice.lines} parça`),
        h("td", { className: "price-cell" }, money(invoice.total)),
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
      h("strong", null, money(item.qty * item.cost))
    ))),
    h("div", { className: "draft-total" }, h("span", null, "Tahmini toplam"), h("strong", null, money(draft.items.reduce((sum, item) => sum + item.qty * item.cost, 0)))),
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
  const cogs = data.jobs.reduce((sum, job) => sum + job.items.reduce((subtotal, item) => subtotal + (data.parts.find((part) => part.id === item.partId)?.cost || 0) * item.qty, 0), 0);
  const max = Math.max(...best.map((part) => part.sold), 1);
  return h(React.Fragment, null, h("div", { className: "metric-grid report-metrics" },
    h(ReportMetric, { label: "Toplam ciro", value: money(revenue), caption: "Kaydedilen servis iş emirleri", icon: "chart", color: "green" }),
    h(ReportMetric, { label: "Parça satış adedi", value: total, caption: "İş emirlerinde kullanılan toplam parça", icon: "box", color: "blue" }),
    h(ReportMetric, { label: "Tahmini parça maliyeti", value: money(cogs), caption: "İş emirlerindeki güncel alış fiyatları", icon: "receipt", color: "purple" })
  ), h("section", { className: "panel report-panel" }, h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "En çok satan parçalar"), h("p", null, "Satış adetlerine göre sıralama · tüm dönemler")), h("span", { className: "report-period" }, "Tüm dönemler")), h("div", { className: "report-bars" }, best.map((part, index) => h("div", { className: "report-bar-row", key: part.id }, h("span", { className: "rank-number" }, `0${index + 1}`), h("span", { className: "report-part-name" }, part.name), h("div", { className: "bar-track" }, h("div", { className: `bar-fill bar-${index % 4 + 1}`, style: { width: `${Math.max(5, part.sold / max * 100)}%` } })), h("strong", null, `${part.sold} adet`))))), h("section", { className: "report-note" }, h("span", { className: "note-dot" }), "Raporlar, kaydettiğiniz iş emirleri ve envanter hareketlerine göre anlık güncellenir."));
}
function ReportMetric({ label, value, caption, icon, color }) {
  return h("article", { className: "metric-card" }, h("div", { className: "metric-top" }, h("span", null, label), h("span", { className: `metric-icon ${color}` }, h(Icon, { name: icon }))), h("strong", { className: "metric-value" }, value), h("div", { className: "metric-bottom" }, caption));
}

function Modal({ modal, parts, onClose, onSavePart, onSaveJob, onSaveInvoice }) {
  const [lines, setLines] = useState([{ partId: "", qty: 1 }]);
  const [error, setError] = useState("");
  const [invoiceMode, setInvoiceMode] = useState("select");
  const [pastedText, setPastedText] = useState("");
  const title = modal.type === "part" ? modal.item ? "Parçayı düzenle" : "Yeni parça ekle" : modal.type === "job" ? "Yeni iş emri" : "Alış faturası ekle";
  const updateLine = (index, key, value) => setLines((current) => current.map((line, i) => i === index ? { ...line, [key]: value } : line));
  const addLine = () => setLines((current) => [...current, { partId: "", qty: 1 }]);
  const pastedInvoice = modal.type === "invoice" ? parseInvoicePaste(pastedText, parts) : { items: [], errors: [], rows: 0 };
  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (modal.type === "part") {
      const part = { ...(modal.item || {}), sku: String(form.get("sku")).trim(), name: String(form.get("name")).trim(), category: String(form.get("category")).trim(), brand: String(form.get("brand")).trim(), stock: Number(form.get("stock")), minimum: Number(form.get("minimum")), price: Number(form.get("price")), cost: Number(form.get("cost")) };
      if (!part.sku || !part.name || [part.stock, part.minimum, part.price, part.cost].some((value) => !Number.isFinite(value) || value < 0)) {
        setError("Alanları kontrol edin. Sayısal değerler sıfır veya daha büyük olmalı.");
        return;
      }
      onSavePart(part); return;
    }
    const rawItems = lines.map((line) => {
      const part = parts.find((entry) => entry.id === line.partId);
      return part && Number(line.qty) > 0 ? { partId: part.id, name: part.name, qty: Math.floor(Number(line.qty)), price: modal.type === "invoice" ? Number(line.cost ?? part.cost) : part.price, cost: Number(line.cost ?? part.cost) } : null;
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
      onSaveInvoice({ supplier: String(form.get("supplier")).trim(), items: pastedInvoice.items, total: pastedInvoice.items.reduce((sum, item) => sum + item.qty * item.cost, 0) });
      return;
    }
    if (!items.length) { setError("En az bir geçerli parça ve adet girmelisiniz."); return; }
    if (modal.type === "job") {
      const requiredByPart = items.reduce((totals, item) => ({ ...totals, [item.partId]: (totals[item.partId] || 0) + item.qty }), {});
      if (Object.entries(requiredByPart).some(([id, qty]) => qty > (parts.find((part) => part.id === id)?.stock ?? 0))) {
        setError("Seçilen parçalardan en az biri için yeterli stok bulunmuyor.");
        return;
      }
      onSaveJob({ plate: String(form.get("plate")).trim().toLocaleUpperCase("tr"), make: String(form.get("make")).trim(), model: String(form.get("model")).trim(), customer: String(form.get("customer")).trim(), phone: String(form.get("phone")).trim(), items, total: items.reduce((sum, item) => sum + item.qty * item.price, 0) });
    } else onSaveInvoice({ supplier: String(form.get("supplier")).trim(), items, total: items.reduce((sum, item) => sum + item.qty * item.cost, 0) });
  }
  function partLine(line, index, type) {
    const part = parts.find((entry) => entry.id === line.partId);
    return h("div", { className: "modal-item-line", key: index },
      h("label", null, index === 0 ? "Parça" : " ", h("select", { value: line.partId, onChange: (event) => updateLine(index, "partId", event.target.value), required: index === 0 }, h("option", { value: "" }, "Parça seçin"), parts.map((entry) => h("option", { key: entry.id, value: entry.id, disabled: type === "job" && entry.stock < 1 }, `${entry.name} · ${entry.sku}${type === "job" ? ` · stok ${entry.stock}` : ""}`)))),
      h("label", null, index === 0 ? "Adet" : " ", h("input", { type: "number", min: 1, max: type === "job" && part ? part.stock : undefined, value: line.qty, onChange: (event) => updateLine(index, "qty", event.target.value), required: true })),
      type === "invoice" ? h("label", null, index === 0 ? "Birim alış (₺)" : " ", h("input", { type: "number", min: 0, step: "0.01", value: line.cost ?? part?.cost ?? "", onChange: (event) => updateLine(index, "cost", event.target.value), required: true })) : null
    );
  }
  return h("div", { className: "modal-backdrop", onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); } }, h("section", { className: "modal-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "modal-title" },
    h("div", { className: "modal-header" }, h("div", null, h("p", { className: "eyebrow" }, "DEMİR SERVICE"), h("h2", { id: "modal-title" }, title)), h("button", { className: "icon-button", onClick: onClose, type: "button", title: "Kapat" }, h(Icon, { name: "close" }))),
    h("form", { onSubmit: submit, className: "modal-form" },
      modal.type === "part" ? h("div", { className: "form-grid" },
        h("label", null, "Parça adı", h("input", { name: "name", defaultValue: modal.item?.name || "", placeholder: "Örn. Yağ filtresi", required: true })),
        h("label", null, "Parça kodu (SKU)", h("input", { name: "sku", defaultValue: modal.item?.sku || "", placeholder: "Örn. OE-9812", required: true })),
        h("label", null, "Kategori", h("input", { name: "category", defaultValue: modal.item?.category || "", placeholder: "Örn. Filtre", required: true })),
        h("label", null, "Marka", h("input", { name: "brand", defaultValue: modal.item?.brand || "", placeholder: "Parça markası" })),
        h("label", null, "Stok adedi", h("input", { name: "stock", type: "number", min: 0, defaultValue: modal.item?.stock ?? 0, required: true })),
        h("label", null, "Kritik stok seviyesi", h("input", { name: "minimum", type: "number", min: 0, defaultValue: modal.item?.minimum ?? 5, required: true })),
        h("label", null, "Alış fiyatı (₺)", h("input", { name: "cost", type: "number", min: 0, step: "0.01", defaultValue: modal.item?.cost ?? 0, required: true })),
        h("label", null, "Satış fiyatı (₺)", h("input", { name: "price", type: "number", min: 0, step: "0.01", defaultValue: modal.item?.price ?? 0, required: true }))
      ) : modal.type === "job" ? h(React.Fragment, null,
        h("div", { className: "form-grid" }, h("label", null, "Araç plakası", h("input", { name: "plate", placeholder: "34 ABC 123", required: true })), h("label", null, "Müşteri adı", h("input", { name: "customer", placeholder: "Ad soyad", required: true })), h("label", null, "Marka", h("input", { name: "make", placeholder: "Örn. Peugeot", required: true })), h("label", null, "Model", h("input", { name: "model", placeholder: "Örn. 3008", required: true })), h("label", { className: "form-span" }, "Telefon", h("input", { name: "phone", type: "tel", placeholder: "05xx xxx xx xx" }))),
        h("div", { className: "modal-section-title" }, "Kullanılan parçalar", h("span", null, "Stok, iş emri kaydedilince düşer")), h("div", { className: "modal-lines" }, lines.map((line, index) => partLine(line, index, "job"))), h("button", { className: "add-line-button", type: "button", onClick: addLine }, h(Icon, { name: "plus", size: 15 }), "Parça satırı ekle")
      ) : h(React.Fragment, null,
        h("label", null, "Tedarikçi", h("input", { name: "supplier", placeholder: "Tedarikçi firma adı", required: true })),
        h("div", { className: "invoice-input-tabs" },
          h("button", { type: "button", className: invoiceMode === "select" ? "active" : "", onClick: () => { setInvoiceMode("select"); setError(""); } }, "Parçaları seç"),
          h("button", { type: "button", className: invoiceMode === "paste" ? "active" : "", onClick: () => { setInvoiceMode("paste"); setError(""); } }, "Kopyala / yapıştır")
        ),
        invoiceMode === "select" ? h(React.Fragment, null,
          h("div", { className: "modal-section-title invoice-lines-title" }, "Faturadaki parçalar", h("span", null, "Stok, fatura kaydedilince artar")),
          h("div", { className: "modal-lines" }, lines.map((line, index) => partLine(line, index, "invoice"))),
          h("button", { className: "add-line-button", type: "button", onClick: addLine }, h(Icon, { name: "plus", size: 15 }), "Parça satırı ekle")
        ) : h("div", { className: "invoice-paste-panel" },
          h("label", null, "Fatura satırları", h("textarea", { value: pastedText, onChange: (event) => { setPastedText(event.target.value); setError(""); }, placeholder: "SKU\tParça Adı\tAdet\tBirim Alış Fiyatı\nOE-9812\tYağ filtresi\t4\t310\nBR-2048\tÖn fren balatası\t2\t1680", rows: 7 })),
          h("p", { className: "paste-hint" }, "Excel'den veya faturadan satırları doğrudan yapıştırın. Sütun sırası: SKU, Parça Adı (isteğe bağlı), Adet, Birim Alış Fiyatı. Başlık satırı kullanılabilir. TSV, CSV ve noktalı virgül desteklenir."),
          pastedInvoice.rows ? h("div", { className: `paste-result ${pastedInvoice.errors.length ? "paste-result-error" : ""}` },
            h("strong", null, pastedInvoice.errors.length ? `${pastedInvoice.errors.length} satır kontrol edilmeli` : `${pastedInvoice.items.length} parça eşleşti`),
            pastedInvoice.errors.length ? h("ul", null, pastedInvoice.errors.slice(0, 5).map((message) => h("li", { key: message }, message))) : h("p", null, "Fatura kaydedildiğinde eşleşen parçaların stokları bulutta artırılır.")
          ) : null
        )
      ),
      error ? h("p", { className: "form-error", role: "alert" }, error) : null,
      h("div", { className: "modal-footer" }, h("button", { className: "button button-quiet", onClick: onClose, type: "button" }, "Vazgeç"), h("button", { className: "button button-primary", type: "submit" }, modal.type === "part" ? "Kaydet" : modal.type === "job" ? "İş emrini oluştur" : "Faturayı kaydet", h(Icon, { name: "arrow", size: 15 })))
    )
  ));
}

createRoot(document.getElementById("root")).render(h(React.StrictMode, null, h(App)));