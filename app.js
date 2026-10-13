import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { createPurchaseInvoice, createStockDraft, createWorkOrder, deletePart, fetchServiceData, grantUserAccess, listAuthorizedUsers, receiveStockDraft, restorePart, revokeUserAccess, savePart, subscribeToServiceData } from "./data.js";
import { parseInvoicePaste } from "./invoiceImport.js";
import { findPartMatches, parsePastedPartQueries } from "./partSearch.js";
import { changeInitialPassword, firebaseConfigured, OWNER_EMAIL, registerWithPassword, requestPasswordReset, signInWithPassword, signOutUser, subscribeToAuth } from "./firebase.js";
import { calculateVat, VAT_RATE, vatIncludedAmount } from "./vat.js";

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
function money(amount) { return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0); }
function dateLabel(value) { return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("demir-service-theme") === "light" ? "light" : "dark");
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState({ parts: [], jobs: [], invoices: [], drafts: [], movements: [] });
  const [dataLoading, setDataLoading] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [page, setPage] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [toastAction, setToastAction] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const toggleTheme = () => setTheme((current) => current === "dark" ? "light" : "dark");
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
      setData({ parts: [], jobs: [], invoices: [], drafts: [], movements: [] });
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
    return () => { active = false; window.clearTimeout(timer); unsubscribe(); };
  }, [user, reloadData]);

  const lowStock = data.parts.filter((part) => part.stock <= part.minimum);
  const revenue = vatIncludedAmount(data.jobs.reduce((sum, job) => sum + Number(job.total || 0), 0));
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
  ];
  const isOwner = user?.email?.toLowerCase() === OWNER_EMAIL;
  if (isOwner) nav.push({ id: "access", label: "Yetkili Kullanıcılar", icon: "grid" });
  const titles = { dashboard: ["Genel Bakış", "Servisinizin bugünkü durumuna göz atın."], inventory: ["Parça Envanteri", "Stoklarınızı ve parça fiyatlarınızı yönetin."], workorders: ["İş Emirleri", "Araç servis geçmişini ve devam eden işleri takip edin."], vehicles: ["Araç Servis Geçmişi", "Plakaya göre servis ziyaretlerini ve kullanılan parçaları bulun."], compatibility: ["Parça–Araç Uyumluluğu", "İş emirlerinde kullanılan parçalara göre araç eşleşmelerini görün."], movements: ["Stok Hareketleri", "Giriş, çıkış ve düzeltmeleri kaynak ve kullanıcıyla izleyin."], invoices: ["Alış Faturaları", "Faturaları kaydedin, stok girişlerini anında işleyin."], orders: ["Taslak Siparişler", "Azalan parçalar için oluşturduğunuz sipariş önerileri."], reports: ["Raporlar", "Satış performansı ve iş emri cironuz."], access: ["Yetkili Kullanıcılar", "Hesap ekleyin veya servis erişimini kaldırın."] };
  const openModal = (type, item = null) => setModal({ type, item });
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
    await runAction(async () => { await createWorkOrder(job, user.email); await reloadData(); setModal(null); }, "İş emri oluşturuldu, stoklar ve hareket geçmişi güncellendi.");
  };
  const persistInvoice = async (invoice) => {
    await runAction(async () => { await createPurchaseInvoice(invoice, user.email); await reloadData(); setModal(null); }, "Fatura kaydedildi, stoklar ve hareket geçmişi güncellendi.");
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
    h("aside", { className: "sidebar" },
      h("div", { className: "brand" }, h("div", { className: "brand-mark" }, "D"), h("div", null, h("strong", null, "DEMİR"), h("span", null, "EUROREPAR CAR SERVICE"))),
      h("div", { className: "side-label" }, "ÇALIŞMA ALANI"),
      h("nav", { className: "navigation" }, nav.map((item) => h("button", { key: item.id, className: `nav-item ${page === item.id ? "active" : ""}`, onClick: () => { setPage(item.id); setQuery(""); } }, h(Icon, { name: item.icon }), h("span", null, item.label), item.badge ? h("span", { className: "nav-badge" }, item.badge) : null))),
      h("div", { className: "sidebar-bottom" }, h("div", { className: "sidebar-help" }, h("div", { className: "help-icon" }, h(Icon, { name: "wrench", size: 17 })), h("strong", null, "Servis yönetimi"), h("span", null, "Tüm operasyonlarınız tek yerde.")), h("div", { className: "profile" }, h("div", { className: "avatar" }, (user.displayName || user.email || "ST").split(/\s+/).map((name) => name[0]).join("").slice(0, 2)), h("div", { className: "profile-info" }, h("strong", null, user.displayName || "Yetkili kullanıcı"), h("span", null, user.email)), h("button", { className: "icon-button logout", onClick: logout, title: "Oturumu kapat" }, h(Icon, { name: "logout", size: 17 })))),
    ),
    h("main", { className: "main-area" },
      h("header", { className: "topbar" }, h("div", { className: "breadcrumbs" }, "Demir Service", h("span", null, "/"), titles[page][0]), h("div", { className: "topbar-right" }, h(LiveClock, { compact: true }), h("button", { className: "icon-button theme-toggle", onClick: toggleTheme, title: theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç", "aria-label": theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç" }, h(Icon, { name: theme === "dark" ? "sun" : "moon" })), h("button", { className: "icon-button notification", onClick: () => { setPage("inventory"); setToast(`${lowStock.length} parçada kritik stok uyarısı var.`); }, title: "Stok uyarıları" }, h(Icon, { name: "bell" }), lowStock.length ? h("i", null) : null), h("div", { className: "top-avatar" }, "ST"))),
      h("section", { className: "page-content", key: page },
        h("div", { className: "page-heading" }, h("div", null, h("p", { className: "eyebrow" }, "DEMİR EUROREPAR CAR SERVICE"), h("h1", null, titles[page][0]), h("p", { className: "page-subtitle" }, titles[page][1])), h("div", { className: "heading-actions" },
          page === "dashboard" ? h("button", { className: "button button-primary", onClick: () => openModal("job"), disabled: saving }, h(Icon, { name: "plus", size: 16 }), "Yeni iş emri") :
          page === "inventory" ? h("button", { className: "button button-primary", onClick: () => openModal("part"), disabled: saving }, h(Icon, { name: "plus", size: 16 }), "Parça ekle") :
          page === "workorders" ? h("button", { className: "button button-primary", onClick: () => openModal("job"), disabled: saving }, h(Icon, { name: "plus", size: 16 }), "İş emri oluştur") :
          page === "invoices" ? h("button", { className: "button button-primary", onClick: () => openModal("invoice"), disabled: saving }, h(Icon, { name: "plus", size: 16 }), "Fatura ekle") :
          page === "orders" ? h("button", { className: "button button-primary", onClick: createDraft, disabled: saving }, h(Icon, { name: "plus", size: 16 }), "Sipariş taslağı oluştur") : null)),
        page === "dashboard" ? h(Dashboard, { data, lowStock, revenue, setPage, openModal, createDraft }) :
        page === "inventory" ? h(Inventory, { parts: data.parts, query, setQuery, openModal, removePart, saving }) :
        page === "workorders" ? h(WorkOrders, { jobs: data.jobs, query, setQuery }) :
        page === "vehicles" ? h(VehicleHistory, { jobs: data.jobs }) :
        page === "compatibility" ? h(PartCompatibility, { jobs: data.jobs, parts: data.parts }) :
        page === "movements" ? h(StockMovements, { movements: data.movements }) :
        page === "invoices" ? h(Invoices, { invoices: data.invoices }) :
        page === "orders" ? h(Orders, { drafts: data.drafts, lowStock, receiveDraft, createDraft }) :
        page === "access" && isOwner ? h(AccessManagement, {
          onError: (error) => setErrorMessage(error.message || "Kullanıcı erişimi güncellenemedi."),
          onSuccess: (message) => setToast(message),
        }) : h(Reports, { data, revenue })
      )
    ),
    modal ? h(Modal, { modal, parts: data.parts, onClose: () => setModal(null), onSavePart: persistPart, onSaveJob: persistJob, onSaveInvoice: persistInvoice, saving }) : null,
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
      h("button", { className: "button button-primary login-submit", type: "submit", disabled: busy || !configured }, busy ? "İşleniyor..." : registering ? "Hesap oluştur" : resetting ? "Sıfırlama bağlantısı gönder" : "Giriş yap", h(Icon, { name: "arrow", size: 17 })),
      resetting ? null : h("button", { className: "auth-mode-button", type: "button", disabled: busy, onClick: () => setMode(registering ? "login" : "register") }, registering ? "Zaten hesabınız var mı? Giriş yapın" : "İlk kez mi kullanıyorsunuz? Hesap oluşturun"),
      !registering && !resetting ? h("button", { className: "auth-mode-button", type: "button", disabled: busy, onClick: () => { setMode("reset"); } }, "Şifremi unuttum") : null,
      resetting ? h("button", { className: "auth-mode-button", type: "button", disabled: busy, onClick: () => setMode("login") }, "Giriş ekranına dön") : null,
      !configured ? h("p", { className: "form-error", role: "status" }, "Firebase yapılandırması gerekli. Kurulum adımları README.md dosyasında.") : null
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
  );
}
function Dashboard({ data, lowStock, revenue, setPage, openModal, createDraft }) {
  const openJobs = data.jobs.filter((job) => job.status !== "Tamamlandı").length;
  const top = [...data.parts].sort((a, b) => b.sold - a.sold).slice(0, 4);
  const max = Math.max(...top.map((part) => part.sold), 1);
  const metrics = [
    ["Toplam ciro", money(revenue), "KDV dahil · tüm iş emirleri", "chart", "green", "%20 KDV dahil"],
    ["Açık iş emirleri", String(openJobs).padStart(2, "0"), "İşlem bekleyen araçlar", "wrench", "blue", `${data.jobs.length} toplam iş emri`],
    ["Envanter kalemi", String(data.parts.length).padStart(2, "0"), "Takip edilen parça çeşidi", "box", "purple", `${data.parts.reduce((sum, part) => sum + part.stock, 0)} toplam adet`],
    ["Kritik stok", String(lowStock.length).padStart(2, "0"), "Minimum seviyenin altında", "bell", "orange", "Yeniden sipariş gerekli"],
  ];
  return h(React.Fragment, null,
    h(ServiceHero, { openJobs, lowStock: lowStock.length }),
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
    ),
    h(DashboardInsights, { data, setPage })
  );
}
function DashboardInsights({ data, setPage }) {
  const today = new Date();
  const recentDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (6 - index));
    const key = dateKey(date);
    const amount = vatIncludedAmount(data.jobs.filter((job) => job.date === key).reduce((sum, job) => sum + Number(job.total || 0), 0));
    return { label: new Intl.DateTimeFormat("tr-TR", { weekday: "short" }).format(date), amount };
  });
  const recentMonths = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - (5 - index), 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const amount = vatIncludedAmount(data.jobs.filter((job) => job.date?.startsWith(key)).reduce((sum, job) => sum + Number(job.total || 0), 0));
    return { label: new Intl.DateTimeFormat("tr-TR", { month: "short" }).format(date), amount };
  });
  const movementReferences = new Set(data.movements.map((movement) => movement.referenceCode).filter(Boolean));
  const recentItems = [
    ...data.movements.map((movement) => ({ id: movement.id, date: movement.createdAt, title: movement.name, detail: `${movement.type} · ${movement.referenceCode || ""}`, amount: movement.qty, kind: "movement" })),
    ...data.jobs.filter((job) => !movementReferences.has(job.code)).map((job) => ({ id: `job-${job.id}`, date: `${job.date}T12:00:00`, title: `${job.plate} · ${job.make} ${job.model}`, detail: `İş emri · ${job.customer}`, amount: null, total: job.total, kind: "job" })),
    ...data.invoices.filter((invoice) => !movementReferences.has(invoice.code)).map((invoice) => ({ id: `invoice-${invoice.id}`, date: `${invoice.date}T12:00:00`, title: invoice.supplier, detail: `Alış faturası · ${invoice.code}`, amount: null, total: invoice.total, kind: "invoice" })),
  ].sort((first, second) => (second.date || "").localeCompare(first.date || "")).slice(0, 6);
  return h("div", { className: "dashboard-insights" },
    h("section", { className: "panel trend-panel" },
      h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "Ciro akışı"), h("p", null, "Günlük ve aylık iş emri toplamları · %20 KDV dahil")), h("span", { className: "report-period" }, "TRY · KDV dahil")),
      h("div", { className: "trend-sections" },
        h(RevenueBars, { title: "Son 7 gün", values: recentDays }),
        h(RevenueBars, { title: "Son 6 ay", values: recentMonths })
      )
    ),
    h("section", { className: "panel activity-panel" },
      h("div", { className: "panel-heading" }, h("div", null, h("h2", null, "Son hareketler"), h("p", null, "Stok giriş/çıkışları ve servis işlemleri")), h("button", { className: "text-button", onClick: () => setPage("movements") }, "Tüm hareketler", h(Icon, { name: "arrow", size: 14 }))),
      recentItems.length ? h("div", { className: "activity-list" }, recentItems.map((item) => h("div", { className: "activity-item", key: item.id },
        h("span", { className: `activity-mark ${item.kind}` }, item.kind === "movement" ? (item.amount > 0 ? "+" : "−") : item.kind === "job" ? "İŞ" : "AL"),
        h("div", null, h("strong", null, item.title), h("small", null, item.detail)),
        h("span", { className: `activity-amount ${item.kind === "movement" ? (item.amount > 0 ? "positive" : "negative") : ""}` }, item.kind === "movement" ? `${item.amount > 0 ? "+" : ""}${item.amount} adet` : money(vatIncludedAmount(item.total)))
      ))) : h("div", { className: "empty-state compact-empty" }, "Henüz işlem kaydı yok.")
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
function ServiceHero({ openJobs, lowStock }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const greeting = now.getHours() < 12 ? "Günaydın, Serkan Bey" : now.getHours() < 18 ? "İyi günler, Serkan Bey" : "İyi akşamlar, Serkan Bey";
  return h("section", { className: "service-hero", "aria-label": "Servis canlı özeti" },
    h("div", { className: "hero-copy" }, h("span", { className: "hero-kicker" }, h("i", null), "DEMİR EUROREPAR · CANLI SERVİS"), h("h2", null, greeting), h("p", null, `${openJobs} açık iş emri · ${lowStock} kritik stok uyarısı`)),
    h("div", { className: "hero-time" }, h("time", null, now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })), h("span", null, new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now))),
    h("div", { className: "hero-road", "aria-hidden": true }, h("span", { className: "road-stripe" }), h("span", { className: "hero-car" }, h(Icon, { name: "car", size: 66 })))
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
function QuickAction({ icon, color, title, subtitle, onClick }) {
  return h("button", { className: "quick-action", onClick }, h("span", { className: `quick-icon quick-${color}` }, h(Icon, { name: icon })), h("span", null, h("strong", null, title), h("small", null, subtitle)), h(Icon, { name: "arrow", size: 16, className: "quick-arrow" }));
}
function Inventory({ parts, query, setQuery, openModal, removePart, saving }) {
  const [stockFilter, setStockFilter] = useState("all");
  const filtered = parts.filter((part) => `${part.name} ${part.sku} ${part.category} ${part.brand}`.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")) && (stockFilter === "all" || (stockFilter === "low" ? part.stock <= part.minimum : part.stock > part.minimum)));
  return h(React.Fragment, null,
    h("div", { className: "list-toolbar" },
      h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Parça adı, SKU veya kategori ara..." })),
      h("select", { className: "filter-select", value: stockFilter, onChange: (event) => setStockFilter(event.target.value), "aria-label": "Stok durumu filtresi" }, h("option", { value: "all" }, "Tüm stoklar"), h("option", { value: "low" }, "Kritik stok"), h("option", { value: "good" }, "Stok yeterli")),
      h("span", { className: "result-count" }, `${filtered.length} parça gösteriliyor`)
    ),
    h("section", { className: "panel table-panel" }, filtered.length ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["PARÇA", "KATEGORİ", "STOK DURUMU", "ALIŞ FİYATI · KDV HARİÇ", "SATIŞ FİYATI · KDV HARİÇ", ""].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, filtered.map((part) => h("tr", { key: part.id },
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
        h("td", null, h("span", { className: `job-status ${job.status === "Tamamlandı" ? "status-done" : "status-progress"}` }, h("i", null), job.status))
      )))
    )
  );
}
function WorkOrders({ jobs, query, setQuery }) {
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("all");
  const filtered = jobs.filter((job) => `${job.code || job.id} ${job.plate} ${job.customer} ${job.make} ${job.model}`.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")) && (status === "all" || job.status === status));
  return h(React.Fragment, null,
    h("div", { className: "list-toolbar" },
      h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Plaka, müşteri veya iş emri ara..." })),
      h("select", { className: "filter-select", value: status, onChange: (event) => setStatus(event.target.value), "aria-label": "İş emri durumu filtresi" }, h("option", { value: "all" }, "Tüm durumlar"), h("option", { value: "Devam ediyor" }, "Devam ediyor"), h("option", { value: "Tamamlandı" }, "Tamamlandı")),
      h("span", { className: "result-count" }, `${filtered.length} iş emri`)
    ),
    h("section", { className: "panel table-panel" }, filtered.length ? h("div", { className: "table-scroll" },
      h("table", null,
        h("thead", null, h("tr", null, ["İŞ EMRİ", "ARAÇ", "MÜŞTERİ", "İŞLEM / PARÇALAR", "TUTAR · KDV DAHİL", "DURUM"].map((label) => h("th", { key: label }, label)))),
        h("tbody", null, filtered.map((job) => h(React.Fragment, { key: job.id },
          h("tr", { className: "clickable-row", onClick: () => setSelected(selected === job.id ? null : job.id) },
            h("td", null, h("strong", { className: "job-id" }, job.code || job.id), h("small", { className: "table-date" }, dateLabel(job.date))),
            h("td", null, h("div", { className: "vehicle-cell" }, h("strong", null, job.plate), h("small", null, `${job.make} ${job.model}`))),
            h("td", null, h("div", { className: "vehicle-cell" }, h("strong", null, job.customer), h("small", null, job.phone || "Telefon belirtilmedi"))),
            h("td", null, h("span", { className: "muted-cell" }, `${job.items.length} parça kalemi`)),
            h("td", { className: "price-cell" }, money(vatIncludedAmount(job.total))),
            h("td", null, h("span", { className: `job-status ${job.status === "Tamamlandı" ? "status-done" : "status-progress"}` }, h("i", null), job.status))
          ),
          selected === job.id ? h("tr", { className: "job-detail-row" }, h("td", { colSpan: 6 }, h("div", { className: "job-detail" }, h("strong", null, "Araç servis geçmişi / kullanılan parçalar"), job.items.map((item, index) => h("span", { key: `${item.name}-${index}` }, `${item.name} · ${item.qty} adet · ${money(vatIncludedAmount(item.price * item.qty))}`))))) : null
        )))
      )
    ) : h("div", { className: "empty-state" }, "Henüz iş emri bulunmuyor."))
  );
}
function VehicleHistory({ jobs }) {
  const [query, setQuery] = useState("");
  const [selectedPlate, setSelectedPlate] = useState("");
  const vehicles = new Map();
  [...jobs].sort((first, second) => (second.date || "").localeCompare(first.date || "")).forEach((job) => {
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
    ))) : h("section", { className: "panel empty-state" }, jobs.length ? "Aramanızla eşleşen araç bulunamadı." : "Araç geçmişi, iş emri kaydedildikçe burada oluşur."));
}
function PartCompatibility({ jobs, parts }) {
  const [query, setQuery] = useState("");
  const fitments = new Map();
  jobs.forEach((job) => job.items.forEach((item) => {
    const entry = fitments.get(item.partId) || new Map();
    const modelKey = `${job.make.trim().toLocaleLowerCase("tr")}|${job.model.trim().toLocaleLowerCase("tr")}`;
    const model = entry.get(modelKey) || { make: job.make, model: job.model, count: 0, plates: new Set(), lastDate: job.date };
    model.count += item.qty;
    model.plates.add(job.plate);
    if (job.date > model.lastDate) model.lastDate = job.date;
    entry.set(modelKey, model);
    fitments.set(item.partId, entry);
  }));
  const filtered = parts.filter((part) => `${part.name} ${part.sku} ${part.category} ${part.brand}`.toLocaleLowerCase("tr").includes(query.trim().toLocaleLowerCase("tr")));
  return h(React.Fragment, null,
    h("div", { className: "list-toolbar" }, h("div", { className: "search-wrap" }, h(Icon, { name: "search", size: 17 }), h("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Parça adı veya SKU ara..." })), h("span", { className: "result-count" }, `${filtered.length} parça`)),
    h("p", { className: "page-hint" }, "Uyumluluk, mevcut iş emirlerinde bu parçanın takıldığı marka/model kayıtlarından çıkarılır; kayıtlı olmayan araçlar için uyum varsayımı yapılmaz."),
    filtered.length ? h("section", { className: "fitment-grid" }, filtered.map((part) => {
      const models = [...(fitments.get(part.id)?.values() || [])].sort((first, second) => second.count - first.count);
      return h("article", { className: "panel fitment-card", key: part.id },
        h("div", { className: "fitment-part" }, h("span", { className: "part-avatar" }, part.name.slice(0, 1)), h("div", null, h("strong", null, part.name), h("small", null, `${part.sku} · Stok ${part.stock}`))),
        h("div", { className: "fitment-models" }, models.length ? models.map((model) => h("div", { className: "fitment-model", key: `${model.make}-${model.model}` }, h("span", null, h("strong", null, `${model.make} ${model.model}`), h("small", null, `${model.plates.size} araçta · son kullanım ${dateLabel(model.lastDate)}`)), h("b", null, `${model.count} adet`))) : h("p", { className: "empty-state compact-empty" }, "Henüz iş emrinde kullanılmadı.")),
        h("span", { className: "fitment-foot" }, models.length ? `${models.length} kayıtlı model` : "Uyumluluk verisi bekleniyor")
      );
    })) : h("section", { className: "panel empty-state" }, "Aramanızla eşleşen parça yok."));
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
  const cogs = vatIncludedAmount(data.jobs.reduce((sum, job) => sum + job.items.reduce((subtotal, item) => subtotal + (data.parts.find((part) => part.id === item.partId)?.cost || 0) * item.qty, 0), 0));
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

function Modal({ modal, parts, onClose, onSavePart, onSaveJob, onSaveInvoice, saving }) {
  const [lines, setLines] = useState([{ partId: "", qty: 1, search: "" }]);
  const [error, setError] = useState("");
  const [pasteMessage, setPasteMessage] = useState("");
  const [invoiceMode, setInvoiceMode] = useState("code");
  const [pastedText, setPastedText] = useState("");
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [newInvoicePart, setNewInvoicePart] = useState({ sku: "", name: "", qty: "1", cost: "", price: "", category: "Genel", brand: "", minimum: "5" });
  const title = modal.type === "part" ? modal.item ? "Parçayı düzenle" : "Yeni parça ekle" : modal.type === "job" ? "Yeni iş emri" : "Alış faturası ekle";
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
      cost: Number(newInvoicePart.cost),
      price: Number(newInvoicePart.price),
    };
    if (!item.sku || !Number.isInteger(item.qty) || item.qty <= 0 ||
      !newInvoicePart.cost.trim() || !Number.isFinite(item.cost) || item.cost < 0 ||
      !newInvoicePart.price.trim() || !Number.isFinite(item.price) || item.price < 0 ||
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
      ? [{ qty: Number(line.qty), cost: Number(line.cost ?? part.cost) }]
      : [];
  });
  const invoicePreviewItems = invoiceMode === "code" ? invoiceItems : invoiceMode === "paste" ? [...invoiceItems, ...pastedInvoice.items] : [...invoiceItems, ...selectedInvoiceLines];
  const invoiceVat = calculateVat(invoicePreviewItems.reduce((sum, item) => sum + item.qty * item.cost, 0));
  const jobNetSubtotal = lines.reduce((sum, line) => {
    const part = parts.find((entry) => entry.id === line.partId);
    return part && Number.isInteger(Number(line.qty)) && Number(line.qty) > 0 ? sum + Number(line.qty) * part.price : sum;
  }, 0);
  const jobVat = calculateVat(jobNetSubtotal);
  function selectPart(index, part) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, partId: part.id, search: `${part.name} · ${part.sku}` } : line));
    setError("");
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
    if (modal.type === "part") {
      const part = { ...(modal.item || {}), sku: String(form.get("sku")).trim(), name: String(form.get("name")).trim(), category: String(form.get("category")).trim(), brand: String(form.get("brand")).trim(), stock: Number(form.get("stock")), minimum: Number(form.get("minimum")), price: Number(form.get("price")), cost: Number(form.get("cost")) };
      if (!part.sku || !part.name || [part.stock, part.minimum, part.price, part.cost].some((value) => !Number.isFinite(value) || value < 0)) {
        setError("Alanları kontrol edin. Sayısal değerler sıfır veya daha büyük olmalı.");
        return;
      }
      onSavePart(part); return;
    }
    if (modal.type === "invoice" && invoiceMode === "code") {
      if (!invoiceItems.length) {
        setError("Faturaya eklemek için yan bölümden en az bir stok kodu ekleyin.");
        return;
      }
      onSaveInvoice({ invoiceNumber: String(form.get("invoiceNumber")).trim(), supplier: String(form.get("supplier")).trim(), items: invoiceItems, total: invoiceItems.reduce((sum, item) => sum + item.qty * item.cost, 0) });
      return;
    }
    const rawItems = lines.map((line) => {
      const part = parts.find((entry) => entry.id === line.partId);
      return part && Number.isInteger(Number(line.qty)) && Number(line.qty) > 0 ? { partId: part.id, sku: part.sku, name: part.name, category: part.category, brand: part.brand, qty: Number(line.qty), price: modal.type === "invoice" ? Number(line.price ?? part.price) : part.price, cost: Number(line.cost ?? part.cost) } : null;
    }).filter(Boolean);
    if (modal.type === "job" && lines.some((line) => !line.partId)) {
      setError("Her parça satırı için arama sonuçlarından bir parça seçin.");
      return;
    }
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
      onSaveInvoice({ invoiceNumber: String(form.get("invoiceNumber")).trim(), supplier: String(form.get("supplier")).trim(), items, total: items.reduce((sum, item) => sum + item.qty * item.cost, 0) });
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
    } else {
      const invoiceItemsToSave = [...invoiceItems, ...items];
      onSaveInvoice({ invoiceNumber: String(form.get("invoiceNumber")).trim(), supplier: String(form.get("supplier")).trim(), items: invoiceItemsToSave, total: invoiceItemsToSave.reduce((sum, item) => sum + item.qty * item.cost, 0) });
    }
  }
  function partLine(line, index, type) {
    const part = parts.find((entry) => entry.id === line.partId);
    const matches = type === "job" && !line.partId ? findPartMatches(line.search, parts).slice(0, 8) : [];
    return h("div", { className: "modal-item-line", key: index },
      type === "job" ? h("label", { className: "part-search-label" }, index === 0 ? "Parça adı veya kodu" : " ", h("div", { className: "part-search-wrap" },
        h("input", { type: "search", value: line.search || "", placeholder: "Parça adı, SKU veya sonu… yapıştırın", autoComplete: "off", onChange: (event) => { setLines((current) => current.map((entry, lineIndex) => lineIndex === index ? { ...entry, partId: "", search: event.target.value } : entry)); setError(""); setPasteMessage(""); }, onPaste: (event) => pastePartCodes(event, index), "aria-label": `Parça ${index + 1} ara` }),
        matches.length ? h("div", { className: "part-search-results", role: "listbox" }, matches.map((entry) => h("button", { key: entry.id, type: "button", role: "option", disabled: entry.stock < 1, onClick: () => selectPart(index, entry) }, h("span", null, h("strong", null, entry.name), h("small", null, `${entry.sku} · stok ${entry.stock}`)), h("span", { className: entry.stock < 1 ? "part-result-empty" : "part-result-stock" }, entry.stock < 1 ? "Stok yok" : `${entry.stock} adet`)))) :
          line.search && !line.partId ? h("div", { className: "part-search-empty" }, "Eşleşme yok. Kodu, adını veya kodun sonunu deneyin.") : null
      )) : h("label", null, index === 0 ? "Parça" : " ", h("select", { value: line.partId, onChange: (event) => updateLine(index, "partId", event.target.value), required: index === 0 }, h("option", { value: "" }, "Parça seçin"), parts.map((entry) => h("option", { key: entry.id, value: entry.id }, `${entry.name} · ${entry.sku}`)))),
      h("label", null, index === 0 ? "Adet" : " ", h("input", { type: "number", min: 1, max: type === "job" && part ? part.stock : undefined, value: line.qty, onChange: (event) => updateLine(index, "qty", event.target.value), required: true })),
      type === "invoice" ? h("label", null, index === 0 ? "Birim alış · KDV hariç (₺)" : " ", h("input", { type: "number", min: 0, step: "0.01", value: line.cost ?? part?.cost ?? "", onChange: (event) => updateLine(index, "cost", event.target.value), required: true })) : null,
      type === "invoice" ? h("label", null, index === 0 ? "Satış fiyatı · KDV hariç (₺)" : " ", h("input", { type: "number", min: 0, step: "0.01", value: line.price ?? part?.price ?? "", onChange: (event) => updateLine(index, "price", event.target.value), required: true })) : null
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
        h("label", null, "Alış fiyatı · KDV hariç (₺)", h("input", { name: "cost", type: "number", min: 0, step: "0.01", defaultValue: modal.item?.cost ?? 0, required: true })),
        h("label", null, "Satış fiyatı · KDV hariç (₺)", h("input", { name: "price", type: "number", min: 0, step: "0.01", defaultValue: modal.item?.price ?? 0, required: true }))
      ) : modal.type === "job" ? h(React.Fragment, null,
        h("div", { className: "form-grid" }, h("label", null, "Araç plakası", h("input", { name: "plate", placeholder: "34 ABC 123", required: true })), h("label", null, "Müşteri adı", h("input", { name: "customer", placeholder: "Ad soyad", required: true })), h("label", null, "Marka", h("input", { name: "make", placeholder: "Örn. Peugeot", required: true })), h("label", null, "Model", h("input", { name: "model", placeholder: "Örn. 3008", required: true })), h("label", { className: "form-span" }, "Telefon", h("input", { name: "phone", type: "tel", placeholder: "05xx xxx xx xx" }))),
        h("div", { className: "modal-section-title" }, "Kullanılan parçalar", h("span", null, "Stok, iş emri kaydedilince düşer")), h("p", { className: "part-paste-hint" }, "Satış fiyatları KDV hariçtir. Kodun sonundan arayabilir ya da Excel'den birden fazla satırı doğrudan yapıştırabilirsiniz.", pasteMessage ? h("strong", null, ` ${pasteMessage}`) : null), h("div", { className: "modal-lines" }, lines.map((line, index) => partLine(line, index, "job"))), h("button", { className: "add-line-button", type: "button", onClick: addLine }, h(Icon, { name: "plus", size: 15 }), "Parça satırı ekle")
      ) : h(React.Fragment, null,
        h("div", { className: "form-grid invoice-meta-grid" },
          h("label", null, "Fatura numarası", h("input", { name: "invoiceNumber", placeholder: "Tedarikçi fatura numarası", required: true })),
          h("label", null, "Tedarikçi", h("input", { name: "supplier", placeholder: "Tedarikçi firma adı", required: true }))
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
              h("label", null, "Alış fiyatı · KDV hariç (₺)", h("input", { type: "number", min: 0, step: "0.01", value: newInvoicePart.cost, onChange: (event) => updateNewInvoicePart("cost", event.target.value) })),
              h("label", null, "Satış fiyatı · KDV hariç (₺)", h("input", { type: "number", min: 0, step: "0.01", value: newInvoicePart.price, onChange: (event) => updateNewInvoicePart("price", event.target.value) }))
            ),
            h("div", { className: "form-grid" },
              h("label", null, "Kategori", h("input", { value: newInvoicePart.category, onChange: (event) => updateNewInvoicePart("category", event.target.value), placeholder: "Genel" })),
              h("label", null, "Marka", h("input", { value: newInvoicePart.brand, onChange: (event) => updateNewInvoicePart("brand", event.target.value), placeholder: "Parça markası" }))
            ),
            h("button", { className: "button button-primary invoice-add-part", type: "button", onClick: addInvoicePart }, h(Icon, { name: "plus", size: 15 }), "Faturaya ekle")
          )
        ) : h("div", { className: "invoice-paste-panel" },
          h("label", null, "Fatura satırları", h("textarea", { value: pastedText, onChange: (event) => { setPastedText(event.target.value); setError(""); }, placeholder: "SKU\tParça Adı\tAdet\tAlış Fiyatı\tSatış Fiyatı\nOE-9812\tYağ filtresi\t4\t310\t450\nNEW-301\tHava filtresi\t2\t220\t390", rows: 7 })),
          h("p", { className: "paste-hint" }, "Fiyatları KDV hariç girin. Excel'den veya faturadan satırları doğrudan yapıştırın. Başlıklı sütun önerisi: SKU, Parça Adı, Adet, Alış Fiyatı, Satış Fiyatı. Yeni stok kodu için ad ve satış fiyatı zorunludur; yeni stok kartı fatura kaydedilince otomatik oluşur. TSV, CSV ve noktalı virgül desteklenir."),
          pastedInvoice.rows ? h("div", { className: `paste-result ${pastedInvoice.errors.length ? "paste-result-error" : ""}` },
            h("strong", null, pastedInvoice.errors.length ? `${pastedInvoice.errors.length} satır kontrol edilmeli` : `${pastedInvoice.items.length} fatura satırı hazır`),
            pastedInvoice.errors.length ? h("ul", null, pastedInvoice.errors.slice(0, 5).map((message) => h("li", { key: message }, message))) : h("p", null, `${pastedInvoice.items.filter((item) => !item.partId).length} yeni stok kartı oluşturulacak; mevcut parçaların stoğu güncellenecek.`)
          ) : null
        )
      ),
      modal.type === "invoice" && invoicePreviewItems.length ? h(VatSummary, { values: invoiceVat, title: "Fatura toplamı · KDV dahil" }) :
        modal.type === "job" && jobNetSubtotal ? h(VatSummary, { values: jobVat, title: "Satış toplamı · KDV dahil" }) : null,
      error ? h("p", { className: "form-error", role: "alert" }, error) : null,
      h("div", { className: "modal-footer" }, h("button", { className: "button button-quiet", onClick: onClose, type: "button", disabled: saving }, "Vazgeç"), h("button", { className: "button button-primary", type: "submit", disabled: saving }, saving ? "Kaydediliyor..." : modal.type === "part" ? "Kaydet" : modal.type === "job" ? "İş emrini oluştur" : "Faturayı kaydet", saving ? null : h(Icon, { name: "arrow", size: 15 })))
    )
  ));
}

createRoot(document.getElementById("root")).render(h(React.StrictMode, null, h(App)));