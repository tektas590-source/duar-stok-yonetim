// Gemini (Firebase AI Logic) ile sohbet: model araç çağırır, araçlar uygulama
// verisinde tarayıcıda çalışır, sonuç modele geri verilir.
import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from "firebase/ai";
import { app } from "../firebase.js";
import { runTool, systemPrompt, TOOL_SPECS } from "./tools.js";

const MODELS = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"];
let modelIndex = 0;

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
    generationConfig: { temperature: 0.2 },
  });
}

const TOOL_LABEL = {
  genel_durum: "Genel durum okunuyor", parca_ara: "Parça aranıyor", parca_detay: "Parça detayı inceleniyor", kritik_stoklar: "Kritik stoklar taranıyor",
  satis_raporu: "Satışlar hesaplanıyor", alis_raporu: "Alışlar hesaplanıyor", belge_ara: "Belgeler aranıyor", hareketler: "Hareketler okunuyor",
  en_cok_satanlar: "En çok satanlar sıralanıyor", olu_stok: "Ölü stok taranıyor", kategori_dagilimi: "Kategori dağılımı hesaplanıyor",
};

export function friendlyError(error) {
  const m = String(error?.message || error || "");
  if (/api.*not.*enabled|SERVICE_DISABLED|firebasevertexai|AI Logic|PERMISSION_DENIED/i.test(m)) return "Yapay zekâ servisi Firebase projesinde henüz açık değil.";
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(m)) return "Ücretsiz yapay zekâ kotası şu an dolu; bir dakika sonra tekrar deneyin.";
  if (/network|fetch|Failed to fetch/i.test(m)) return "İnternet bağlantısı kurulamadı.";
  return `Asistan yanıt veremedi: ${m.slice(0, 160)}`;
}

// history: [{ role: "user" | "model", text }]; getData(): uygulamanın güncel verisi.
export async function ask(history, question, getData, onStep) {
  for (let attempt = 0; attempt < MODELS.length; attempt += 1) {
    try {
      const chat = makeModel().startChat({
        history: history.filter((h) => h.text).map((h) => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.text }] })),
      });
      let result = await chat.sendMessage(question);
      for (let round = 0; round < 6; round += 1) {
        const calls = result.response.functionCalls?.() || [];
        if (!calls.length) break;
        const responses = calls.map((call) => {
          onStep?.(TOOL_LABEL[call.name] || call.name);
          let output;
          try { output = runTool(call.name, call.args || {}, getData()); } catch (error) { output = { hata: error.message }; }
          return { functionResponse: { name: call.name, response: { sonuc: output } } };
        });
        result = await chat.sendMessage(responses);
      }
      return result.response.text();
    } catch (error) {
      const m = String(error?.message || "");
      if (/not found|404|is not supported|unsupported model/i.test(m) && modelIndex < MODELS.length - 1) { modelIndex += 1; continue; }
      throw error;
    }
  }
  throw new Error("Uygun yapay zekâ modeli bulunamadı.");
}
