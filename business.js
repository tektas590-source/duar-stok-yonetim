import React, { createContext, useContext, useEffect, useState } from "react";
import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "./firebase.js";

// İşletme kimliği: isim, kısa etiket, slogan ve baş harf koddan değil buradan okunur.
// Sistem başka bir servise satıldığında "İşletme Ayarları" ekranından değiştirilir;
// kod hiçbir yerde "Demir" adını sabit tutmaz.
export const defaultBusiness = {
  fullName: "Demir Eurorepar Car Service",
  shortName: "Demir Service",
  brandWord: "DEMİR",
  tagline: "EUROREPAR CAR SERVICE",
  initial: "D",
};

const BusinessContext = createContext(defaultBusiness);

export function useBusiness() {
  return useContext(BusinessContext) || defaultBusiness;
}

function deriveInitial(fullName) {
  const trimmed = String(fullName || "").trim();
  return trimmed ? trimmed[0].toLocaleUpperCase("tr") : "D";
}

export async function saveBusinessSettings(values) {
  if (!db) throw new Error("Sunucu bağlantısı kurulamadı. Lütfen sayfayı yenileyip tekrar deneyin.");
  const fullName = String(values.fullName || "").trim();
  const shortName = String(values.shortName || "").trim();
  const tagline = String(values.tagline || "").trim();
  if (!fullName) throw new Error("İşletme adı boş bırakılamaz.");
  const record = { fullName, shortName: shortName || fullName, tagline, brandWord: deriveInitial(fullName) === fullName[0] ? fullName.split(" ")[0].toLocaleUpperCase("tr") : values.brandWord || defaultBusiness.brandWord, initial: deriveInitial(fullName) };
  await setDoc(doc(db, "settings", "business"), record, { merge: true });
  return record;
}

export function BusinessProvider({ children }) {
  const [business, setBusiness] = useState(defaultBusiness);
  useEffect(() => {
    if (!db) return undefined;
    const unsubscribe = onSnapshot(doc(db, "settings", "business"), (snapshot) => {
      if (snapshot.exists()) setBusiness({ ...defaultBusiness, ...snapshot.data() });
    }, () => { /* ayar okunamazsa varsayılan marka kullanılır */ });
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (business.shortName) document.title = `${business.shortName} — Servis Yönetimi`;
  }, [business.shortName]);
  return React.createElement(BusinessContext.Provider, { value: business }, children);
}
