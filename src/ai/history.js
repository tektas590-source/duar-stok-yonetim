// Gemini sırası katıdır: user → model → user … Cevapsız kalan (hata alan)
// sorular yüzünden art arda gelen aynı rolleri birleştirir; geçmiş user ile
// başlar ve model ile biter (yeni soru user olarak eklenecek).
export function cleanHistory(history) {
  const out = [];
  (history || []).forEach((h) => {
    const text = String(h?.text || "").trim();
    if (!text || h.error) return;
    const role = h.role === "user" ? "user" : "model";
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts[0].text += `\n\n${text}`;
    else out.push({ role, parts: [{ text }] });
  });
  while (out.length && out[0].role !== "user") out.shift();
  while (out.length && out[out.length - 1].role !== "model") out.pop();
  return out;
}
