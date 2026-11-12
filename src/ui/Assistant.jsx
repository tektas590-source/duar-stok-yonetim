import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./kit.jsx";
import { useApp } from "./context.js";
import { itemIdFromSku } from "../core/format.js";


// Basit, güvenli biçimlendirme: **kalın**, `stok kodu`, - liste, satır sonu.
function Rich({ text, onSku }) {
  const lines = String(text || "").split("\n");
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={`${k}-${i}`}>{part.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(part)) { const sku = part.slice(1, -1); return <button key={`${k}-${i}`} type="button" className="ai-sku" onClick={() => onSku(sku)}>{sku}</button>; }
    return <React.Fragment key={`${k}-${i}`}>{part}</React.Fragment>;
  });
  const out = []; let list = [];
  const flush = (k) => { if (list.length) { out.push(<ul key={`ul${k}`}>{list}</ul>); list = []; } };
  lines.forEach((line, i) => {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { list.push(<li key={i}>{inline(m[1], i)}</li>); return; }
    flush(i);
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) out.push(<h4 key={i}>{inline(h[1], i)}</h4>);
    else if (line.trim()) out.push(<p key={i}>{inline(line, i)}</p>);
  });
  flush("end");
  return <div className="ai-rich">{out}</div>;
}

export function Assistant({ open, setOpen }) {
  const { data, go } = useApp();
  const [messages, setMessages] = useState(() => { try { return JSON.parse(sessionStorage.getItem("duar-ai") || "[]"); } catch { return []; } });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [draft, setDraft] = useState("");
  const dataRef = useRef(data);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  dataRef.current = data;

  useEffect(() => { try { sessionStorage.setItem("duar-ai", JSON.stringify(messages.slice(-30))); } catch { /* yoksay */ } }, [messages]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: draft ? "auto" : "smooth" }); }, [messages, step, draft]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 250); }, [open]);
  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(!open); } if (e.key === "Escape" && open) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  async function send(text) {
    const q = String(text || input).trim();
    if (!q || busy) return;
    setInput("");
    const history = messages.filter((m) => !m.error).slice(-20);
    setMessages((m) => [...m, { role: "user", text: q }]);
    setBusy(true); setStep("Düşünüyor"); setDraft("");
    try {
      const { ask } = await import("../ai/assistant.js");
      const answer = await ask(history, q, () => dataRef.current, (s) => setStep(s), (t) => { setStep("Yazıyor"); setDraft((d) => d + t); });
      setMessages((m) => [...m, { role: "model", text: answer || "Bir yanıt üretemedim, soruyu farklı sorar mısın?" }]);
    } catch (error) {
      console.error(error);
      const { friendlyError } = await import("../ai/assistant.js").catch(() => ({ friendlyError: (e) => e.message }));
      setMessages((m) => [...m, { role: "model", text: friendlyError(error), error: true }]);
    } finally { setBusy(false); setStep(""); setDraft(""); }
  }

  const openSku = (sku) => {
    const item = data.items.find((i) => i.sku.toLocaleLowerCase("tr") === sku.toLocaleLowerCase("tr")) || data.items.find((i) => { try { return i.id === itemIdFromSku(sku); } catch { return false; } });
    if (item) { go("stok", { itemId: item.id }); setOpen(false); } else go("stok", { q: sku });
  };

  return createPortal(
    <>
      <button type="button" className={`ai-fab ${open ? "is-open" : ""}`} onClick={() => setOpen(!open)} aria-label="Yapay zekâ asistanını aç" title="Duar Asistan (Ctrl+K)">
        <span className="ai-fab-glow" aria-hidden="true" />
        <Icon name={open ? "close" : "spark"} size={22} />
      </button>
      <section className={`ai-panel ${open ? "is-open" : ""}`} aria-hidden={!open} aria-label="Duar Asistan">
        <header className="ai-head">
          <span className="ai-orb" aria-hidden="true"><Icon name="spark" size={18} /></span>
          <div><strong>Duar Asistan</strong><small>Stok, satış, işçilik ve kârın hakkında her şeyi sor</small></div>
          {messages.length ? <button type="button" className="icon-btn sm" onClick={() => setMessages([])} aria-label="Sohbeti temizle" title="Sohbeti temizle"><Icon name="undo" size={14} /></button> : null}
          <button type="button" className="icon-btn sm" onClick={() => setOpen(false)} aria-label="Kapat"><Icon name="close" size={14} /></button>
        </header>
        <div className="ai-list" ref={listRef}>
          {!messages.length ? (
            <div className="ai-welcome">
              <span className="ai-orb big" aria-hidden="true"><Icon name="spark" size={28} /></span>
              <h3>Merhaba, ben Duar Asistan.</h3>
              <p>Aklına ne gelirse kendi cümlelerinle yaz. Deponun, satışların, işçiliğin ve faturaların tamamına bakıp araştırırım; araç arızası, parça muadili, fiyatlandırma ya da müşteriye yazılacak mesaj gibi konularda da yardımcı olurum.</p>
            </div>
          ) : messages.map((m, i) => (
            <div key={i} className={`ai-msg ai-${m.role} ${m.error ? "is-error" : ""}`}>
              {m.role === "user" ? <p>{m.text}</p> : <Rich text={m.text} onSku={openSku} />}
            </div>
          ))}
          {busy && draft ? <div className="ai-msg ai-model is-streaming"><Rich text={draft} onSku={openSku} /></div> : null}
          {busy ? <div className="ai-msg ai-model ai-thinking"><span className="dots"><i /><i /><i /></span>{step}…</div> : null}
        </div>
        <form className="ai-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea ref={inputRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Bir şey sor ya da yaz…" aria-label="Asistana sor" disabled={busy} />
          <button type="submit" className="ai-send" disabled={busy || !input.trim()} aria-label="Gönder"><Icon name="chevron" size={18} /></button>
        </form>
      </section>
    </>,
    document.body,
  );
}
