import React, { useState } from "react";
import { Button, Icon } from "./kit.jsx";
import { authMessage, logOut, reloadUser, resendVerification, resetPassword, signIn, signUp } from "../firebase.js";

function Brand() {
  return (
    <div className="brand big">
      <span className="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 6h9a10 10 0 0 1 0 20H7z" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M12 12h4a4 4 0 0 1 0 8h-4z" fill="currentColor" /></svg></span>
      <span><strong>DUAR</strong><small>STOK YÖNETİM</small></span>
    </div>
  );
}

function Stage({ children }) {
  return (
    <div className="auth">
      <div className="auth-bg" aria-hidden="true">
        <div className="auth-grid" />
        <div className="auth-glow" />
        {Array.from({ length: 14 }).map((_, i) => <span key={i} className="crate" style={{ "--x": `${(i * 53) % 100}%`, "--d": `${(i % 7) * 1.3}s`, "--s": `${0.6 + (i % 4) * 0.25}` }} />)}
      </div>
      <section className="auth-story">
        <Brand />
        <h1><span>Her parça</span><span className="accent">yerli yerinde.</span></h1>
        <p>eDMS faturalarından otomatik stok girişi, anlık kritik uyarılar, sayım mutabakatı ve kârlılık — tek ekranda.</p>
        <ul className="auth-points">
          <li><Icon name="upload" size={16} />eDMS Fatura Raporu ile birebir alış girişi</li>
          <li><Icon name="bolt" size={16} />Ortalama maliyet ve kâr otomatik</li>
          <li><Icon name="clipboard" size={16} />Excel ile sayım ve fark eşitleme</li>
        </ul>
      </section>
      <section className="auth-card">{children}</section>
    </div>
  );
}

export function LoginScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "login") await signIn(email, password);
      else if (mode === "register") await signUp(email, password);
      else { await resetPassword(email); setNotice("Şifre sıfırlama bağlantısı e-postanıza gönderildi."); setMode("login"); }
    } catch (err) { setError(authMessage(err)); }
    finally { setBusy(false); }
  }
  const titles = { login: ["Giriş yap", "Hesabınızla devam edin."], register: ["Hesap oluştur", "Kayıttan sonra e-postanıza doğrulama bağlantısı gelir."], reset: ["Şifremi unuttum", "Sıfırlama bağlantısı gönderelim."] };
  return (
    <Stage>
      <form className="auth-form" onSubmit={submit} key={mode}>
        <h2>{titles[mode][0]}</h2>
        <p className="muted">{titles[mode][1]}</p>
        <label className="field"><span className="field-label">E-posta</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus /></label>
        {mode !== "reset" ? <label className="field"><span className="field-label">Şifre</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label> : null}
        {error ? <p className="form-error"><Icon name="alert" size={15} />{error}</p> : null}
        {notice ? <p className="form-ok"><Icon name="check" size={15} />{notice}</p> : null}
        <Button variant="primary" type="submit" icon={mode === "login" ? "chevron" : "check"} disabled={busy} className="wide">{busy ? "Bekleyin…" : titles[mode][0]}</Button>
        <div className="auth-links">
          {mode !== "login" ? <button type="button" onClick={() => setMode("login")}>Girişe dön</button> : <button type="button" onClick={() => setMode("register")}>Hesap oluştur</button>}
          {mode === "login" ? <button type="button" onClick={() => setMode("reset")}>Şifremi unuttum</button> : null}
        </div>
      </form>
    </Stage>
  );
}

export function VerifyScreen({ user, onChecked }) {
  const [msg, setMsg] = useState("");
  return (
    <Stage>
      <div className="auth-form">
        <h2>E-postanızı doğrulayın</h2>
        <p className="muted"><strong>{user.email}</strong> adresine doğrulama bağlantısı gönderdik. Bağlantıya tıkladıktan sonra aşağıdaki düğmeye basın. (Gelen kutusunda yoksa spam klasörüne bakın.)</p>
        {msg ? <p className="form-ok"><Icon name="check" size={15} />{msg}</p> : null}
        <Button variant="primary" icon="check" className="wide" onClick={async () => { const u = await reloadUser(); if (u?.emailVerified) onChecked(u); else setMsg("Henüz doğrulanmamış görünüyor."); }}>Doğruladım, devam et</Button>
        <div className="auth-links">
          <button type="button" onClick={async () => { try { await resendVerification(); setMsg("Bağlantı tekrar gönderildi."); } catch (e) { setMsg(authMessage(e)); } }}>Tekrar gönder</button>
          <button type="button" onClick={logOut}>Çıkış</button>
        </div>
      </div>
    </Stage>
  );
}

export function NoAccessScreen({ user }) {
  return (
    <Stage>
      <div className="auth-form">
        <h2>Erişim bekleniyor</h2>
        <p className="muted"><strong>{user.email}</strong> hesabı henüz yetkilendirilmedi. Yöneticinin bu e-postayı <em>Ayarlar → Yetkili kullanıcılar</em> bölümünden eklemesi gerekiyor.</p>
        <Button icon="logout" className="wide" onClick={logOut}>Çıkış yap</Button>
      </div>
    </Stage>
  );
}

export function SetupScreen() {
  return (
    <Stage>
      <div className="auth-form">
        <h2>Kurulum tamamlanmadı</h2>
        <p className="muted">Firebase bağlantı ayarları bu yayına eklenmemiş. Ön izleme için adresin sonuna <code>?demo</code> ekleyerek örnek verilerle deneyebilirsiniz.</p>
        <Button variant="primary" className="wide" onClick={() => { window.location.search = "?demo"; }}>Demo ile aç</Button>
      </div>
    </Stage>
  );
}
