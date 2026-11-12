import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AppContext } from "./context.js";
import { Icon } from "./kit.jsx";
import { Assistant } from "./Assistant.jsx";
import { LoginScreen, NoAccessScreen, SetupScreen, VerifyScreen } from "./Auth.jsx";
import { DashboardPage, ReportsPage } from "./pages/Overview.jsx";
import { StockPage } from "./pages/Stock.jsx";
import { IssuesPage, PurchasesPage } from "./pages/Docs.jsx";
import { CountPage, MovementsPage, OrdersPage, SettingsPage } from "./pages/Ops.jsx";
import { firebaseConfigured, hasAccess, logOut, OWNER_EMAIL, watchAuth } from "../firebase.js";
import { level } from "../core/stock.js";

const NAV = [
  ["genel", "Genel bakış", "grid"],
  ["stok", "Stok", "box"],
  ["alis", "Alış faturaları", "inbox"],
  ["satis", "Satış / çıkış", "out"],
  ["hareket", "Hareketler", "swap"],
  ["sayim", "Sayım", "clipboard"],
  ["siparis", "Sipariş listesi", "cart"],
  ["rapor", "Raporlar", "chart"],
  ["ayarlar", "Ayarlar", "users"],
];
const PAGES = { genel: DashboardPage, stok: StockPage, alis: PurchasesPage, satis: IssuesPage, hareket: MovementsPage, sayim: CountPage, siparis: OrdersPage, rapor: ReportsPage, ayarlar: SettingsPage };

// Sinematik sayfa geçişi: perde açılır, ışık çizgisi süpürür, sayfa adı
// büyük harflerle belirip kaybolur. Tıklamaları engellemez.
function RouteFx({ page }) {
  const index = NAV.findIndex(([id]) => id === page);
  const label = index >= 0 ? NAV[index][1] : "";
  return (
    <div className="route-fx" aria-hidden="true">
      <i className="fx-shutter fx-top" />
      <i className="fx-shutter fx-bottom" />
      <i className="fx-beam" />
      <span className="fx-title"><small>DUAR · {String(index + 1).padStart(2, "0")}</small>{label}</span>
    </div>
  );
}

function readRoute() {
  const r = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return PAGES[r] ? r : "genel";
}

function useTheme() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("duar-theme") || "dark"; } catch { return "dark"; } });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("duar-theme", theme); } catch { /* yoksay */ }
  }, [theme]);
  return [theme, () => setTheme(theme === "dark" ? "light" : "dark")];
}

function Shell({ store, user }) {
  const [data, setData] = useState({ ready: false, items: [], movements: [], invoices: [], issues: [] });
  const [route, setRoute] = useState({ page: readRoute(), params: null, n: 0 });
  const [toasts, setToasts] = useState([]);
  const [navOpen, setNavOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => store.subscribe(setData, (e) => toast(`Veri okunamadı: ${e.message}`, "bad")), [store]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onHash = () => setRoute((r) => (readRoute() === r.page ? r : { page: readRoute(), params: null, n: r.n + 1 }));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const toast = useCallback((message, tone = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "bad" ? 7000 : 3800);
  }, []);
  const run = useCallback(async (fn, success) => {
    try { await fn(); if (success) toast(success, "ok"); return true; }
    catch (error) { console.error(error); toast(error.message || "İşlem tamamlanamadı.", "bad"); return false; }
  }, [toast]);
  const go = useCallback((page, params = null) => {
    setRoute((r) => ({ page, params, n: r.n + 1 }));
    if (window.location.hash !== `#/${page}`) window.history.pushState(null, "", `#/${page}`);
    setNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const isOwner = (user?.email || "").toLowerCase() === OWNER_EMAIL || store.kind === "memory";
  const ctx = useMemo(() => ({ data, store, user, isOwner, toast, run, go }), [data, store, user, isOwner, toast, run, go]);
  const attention = data.items.filter((i) => !i.archived && ["out", "critical"].includes(level(i))).length;
  const Page = PAGES[route.page];

  return (
    <AppContext.Provider value={ctx}>
      <div className={`shell ${navOpen ? "nav-open" : ""}`}>
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 6h9a10 10 0 0 1 0 20H7z" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M12 12h4a4 4 0 0 1 0 8h-4z" fill="currentColor" /></svg></span>
            <span><strong>DUAR</strong><small>STOK YÖNETİM</small></span>
          </div>
          <button type="button" className="ai-nav" onClick={() => { setAiOpen(true); setNavOpen(false); }}><Icon name="spark" size={17} /><span>Duar Asistan</span><kbd>Ctrl K</kbd></button>
          <nav>
            {NAV.map(([id, label, icon]) => (
              <button key={id} type="button" className={`nav ${route.page === id ? "active" : ""}`} onClick={() => go(id)}>
                <Icon name={icon} size={17} /><span>{label}</span>
                {id === "stok" && attention ? <b className="nav-badge">{attention}</b> : null}
                {id === "siparis" && attention ? <b className="nav-dot" /> : null}
              </button>
            ))}
          </nav>
          <div className="side-foot">
            {store.kind === "memory" ? <span className="demo-tag">DEMO · veriler kaydedilmez</span> : null}
            <div className="me"><span className="me-avatar">{(user?.email || "D").slice(0, 1).toUpperCase()}</span><span className="me-mail">{user?.email}</span></div>
            <div className="side-actions">
              <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={theme === "dark" ? "Açık tema" : "Koyu tema"}><Icon name={theme === "dark" ? "sun" : "moon"} size={16} /></button>
              {store.kind === "firestore" ? <button type="button" className="icon-btn" onClick={logOut} aria-label="Çıkış yap"><Icon name="logout" size={16} /></button> : null}
            </div>
          </div>
        </aside>
        <button type="button" className="nav-scrim" aria-label="Menüyü kapat" onClick={() => setNavOpen(false)} />
        <main className="main">
          <header className="mobilebar">
            <button type="button" className="icon-btn" onClick={() => setNavOpen(true)} aria-label="Menü"><Icon name="menu" /></button>
            <strong>DUAR</strong>
            <button type="button" className="icon-btn" onClick={toggleTheme} aria-label="Tema"><Icon name={theme === "dark" ? "sun" : "moon"} size={16} /></button>
          </header>
          {!data.ready ? <div className="loading"><span className="loader" />Veriler yükleniyor…</div> : (
            <>
              <RouteFx key={`fx-${route.page}-${route.n}`} page={route.page} />
              <div className="route" key={`${route.page}-${route.n}`}>
                <Page params={route.params} />
              </div>
            </>
          )}
        </main>
        {data.ready ? <Assistant open={aiOpen} setOpen={setAiOpen} /> : null}
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}><Icon name={t.tone === "bad" ? "alert" : "check"} size={16} />{t.message}</div>)}
        </div>
      </div>
    </AppContext.Provider>
  );
}

export function App({ createStore, demo }) {
  const [auth, setAuth] = useState({ state: demo ? "ready" : "loading", user: demo ? { email: "demo@duar.local" } : null });
  const store = useMemo(() => (auth.state === "ready" ? createStore(auth.user) : null), [auth.state, auth.user, createStore]);

  useEffect(() => {
    if (demo) return undefined;
    if (!firebaseConfigured) { setAuth({ state: "setup", user: null }); return undefined; }
    return watchAuth(async (user) => {
      if (!user) { setAuth({ state: "signedout", user: null }); return; }
      if (!user.emailVerified) { setAuth({ state: "verify", user }); return; }
      setAuth({ state: "checking", user });
      setAuth({ state: (await hasAccess(user)) ? "ready" : "noaccess", user });
    });
  }, [demo]);

  if (auth.state === "loading" || auth.state === "checking") return <div className="splash"><span className="loader" /><strong>DUAR</strong></div>;
  if (auth.state === "setup") return <SetupScreen />;
  if (auth.state === "signedout") return <LoginScreen />;
  if (auth.state === "verify") return <VerifyScreen user={auth.user} onChecked={async (u) => setAuth({ state: (await hasAccess(u)) ? "ready" : "noaccess", user: u })} />;
  if (auth.state === "noaccess") return <NoAccessScreen user={auth.user} />;
  return <Shell store={store} user={auth.user} />;
}
