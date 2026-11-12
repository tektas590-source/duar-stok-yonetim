// Gemini (Firebase AI Logic) ile sohbet: model araç çağırır, araçlar uygulama
// verisinde tarayıcıda çalışır, sonuç modele geri verilir.
import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from "firebase/ai";
import { app } from "../firebase.js";
import { runTool, systemPrompt, TOOL_SPECS } from "./tools.js";
import { cleanHistory } from "./history.js";

// Kasım 2026 itibarıyla bu projede çalıştığı doğrulanan modeller (2.5 serisi kapatıldı).
const MODELS = ["gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-flash-lite-latest"];
const STORE_KEY = "duar-ai-model";
let modelIndex = (() => { try { const i = MODELS.indexOf(localStorage.getItem(STORE_KEY)); return i >= 0 ? i : 0; } catch { return 0; } })();

function declarations() {
  return TOOL_SPECS.map((spec) => {
    const keys = Object.keys(spec.params);
    if (!keys.length) return { name: spec.name, description: spec.description };
    const properties = Object.fromEntries(keys.map((k) => {
      const p = spec.params[k];
      return [k, p.type === "number" ? Schema.number({ description: p.description }) : Schema.string({ description: p.description })];
    }));
    const required = spec.required || [];
    return {
      name: spec.name,
      description: spec.description,
      parameters: Schema.object({ properties, optionalProperties: keys.filter((k) => !required.includes(k)) }),
    };
  });
}

function makeModel() {
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  return getGenerativeModel(ai, {
    model: MODELS[modelIndex],
    systemInstruction: systemPrompt(new Date()),
    tools: [{ functionDeclarations: declarations() }],
  }, { timeout: 60000 });
}

const TOOL_LABEL = {
  genel_durum: "Genel durum okunuyor", parca_ara: "Parça aranıyor", parca_detay: "Parça detayı inceleniyor", kritik_stoklar: "Kritik stoklar taranıyor",
  satis_raporu: "Satışlar hesaplanıyor", alis_raporu: "Alışlar hesaplanıyor", belge_ara: "Belgeler aranıyor", hareketler: "Hareketler okunuyor",
  en_cok_satanlar: "En çok satanlar sıralanıyor", olu_stok: "Ölü stok taranıyor", kategori_dagilimi: "Kategori dağılımı hesaplanıyor",
  veri_sorgula: "Veri analiz ediliyor",
};

export function friendlyError(error) {
  const m = String(error?.message || error || "");
  if (/App Check/i.test(m)) return "Yapay zekâ isteği Firebase App Check (Uygulama Kontrolü) tarafından engellendi. Firebase → Uygulama Kontrolü → Firebase Yapay Zeka Mantığı ayarını kontrol edin.";
  if (/SERVICE_DISABLED|has not been used|is disabled|API_NOT_ENABLED|not been enabled/i.test(m)) return "Yapay zekâ servisi Firebase projesinde henüz açık değil.";
  if (/PERMISSION_DENIED|403/i.test(m)) return "Yapay zekâ servisine erişim izni yok (403).";
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(m)) return "Ücretsiz yapay zekâ kotası şu an dolu; bir dakika sonra tekrar deneyin.";
  if (/network|fetch|Failed to fetch/i.test(m)) return "İnternet bağlantısı kurulamadı.";
  return `Asistan yanıt veremedi: ${m.slice(0, 160)}`;
}

function stepLabel(call) {
  if (call.name !== "veri_sorgula") return TOOL_LABEL[call.name] || call.name;
  const a = call.args || {};
  const what = { parcalar: "parçalar", satis_belgeleri: "satışlar", satis_kalemleri: "satılan parçalar", iscilikler: "işçilikler", alis_faturalari: "alış faturaları", alis_kalemleri: "alınan parçalar", hareketler: "stok hareketleri", iptaller: "iptaller" }[a.koleksiyon] || "veri";
  return `${what[0].toLocaleUpperCase("tr")}${what.slice(1)} ${a.grupla ? `${a.grupla} bazında gruplanıyor` : "inceleniyor"}`;
}

function safeText(response) {
  try { return response.text() || ""; } catch { return ""; }
}

// Bir mesajı akış hâlinde gönderir; metin parçalarını onDelta ile iletir.
async function streamTurn(chat, message, onDelta) {
  if (typeof chat.sendMessageStream !== "function") {
    const r = await chat.sendMessage(message);
    const t = safeText(r.response); if (t) onDelta?.(t);
    return { response: r.response, text: t };
  }
  const r = await chat.sendMessageStream(message);
  let text = "";
  for await (const chunk of r.stream) {
    const t = safeText(chunk);
    if (t) { text += t; onDelta?.(t); }
  }
  const response = await r.response;
  return { response, text: text || safeText(response) };
}

// history: [{ role: "user" | "model", text }]; getData(): uygulamanın güncel verisi.
// onStep(etiket): araç çalışırken; onDelta(metin): yanıt yazılırken.
export async function ask(history, question, getData, onStep, onDelta) {
  for (let attempt = 0; attempt < MODELS.length; attempt += 1) {
    let streamed = false;
    try {
      const chat = makeModel().startChat({
        history: cleanHistory(history),
      });
      let answer = "";
      const emit = (t) => { streamed = true; answer += t; onDelta?.(t); };
      let turn = await streamTurn(chat, question, emit);
      for (let round = 0; round < 10; round += 1) {
        const calls = turn.response.functionCalls?.() || [];
        if (!calls.length) break;
        if (answer) emit("\n\n");
        const responses = calls.map((call) => {
          onStep?.(stepLabel(call));
          let output;
          try { output = runTool(call.name, call.args || {}, getData()); } catch (error) { output = { hata: error.message }; }
          return { functionResponse: { name: call.name, response: { sonuc: output } } };
        });
        turn = await streamTurn(chat, responses, emit);
      }
      try { localStorage.setItem(STORE_KEY, MODELS[modelIndex]); } catch { /* yoksay */ }
      return answer.trim() || turn.text;
    } catch (error) {
      const m = String(error?.message || "");
      const retryable = /not found|404|no longer available|is not supported|unsupported model|timeout|timed out|abort|500|503|overloaded|UNAVAILABLE/i.test(m);
      if (retryable && !streamed && attempt < MODELS.length - 1) { modelIndex = (modelIndex + 1) % MODELS.length; continue; }
      throw error;
    }
  }
  throw new Error("Uygun yapay zekâ modeli bulunamadı.");
}
