// Firebase bağlantısı ve oturum işlemleri.
// İstemci yapılandırma değerleri gizli anahtar değildir; gerçek yetki
// firestore.rules içindeki kurallarla sunucuda denetlenir.
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import {
  createUserWithEmailAndPassword, getAuth, onAuthStateChanged, sendEmailVerification,
  sendPasswordResetEmail, signInWithEmailAndPassword, signOut,
} from "firebase/auth";
import { deleteDoc, doc, getDoc, getDocs, collection, getFirestore, setDoc } from "firebase/firestore";

export const OWNER_EMAIL = "tektas590@gmail.com";

const env = import.meta.env || {};
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyB3IlAOjlMjJVcC48hYF5KKEatooNp2byc",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "duar-stok-yonetim.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "duar-stok-yonetim",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "duar-stok-yonetim.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "488689310214",
  appId: env.VITE_FIREBASE_APP_ID || "1:488689310214:web:646c405fceb2c5fce50187",
};

export const firebaseConfigured = Boolean(config.apiKey && config.projectId);
export const app = firebaseConfigured ? initializeApp(config) : null;
// App Check: Yapay zekâ (AI Logic) isteklerinin bu siteden geldiğini kanıtlar.
// Site anahtarı herkese açık bir kimliktir, gizli değildir.
export const RECAPTCHA_SITE_KEY = env.VITE_RECAPTCHA_SITE_KEY || "6LdQGxsuAAAAAKlECsua19ATKWaKBFvsNT5Gs2a2";
export const appCheck = app && typeof window !== "undefined" && RECAPTCHA_SITE_KEY
  ? initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true })
  : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

const AUTH_ERRORS = {
  "auth/invalid-credential": "E-posta veya şifre hatalı.",
  "auth/wrong-password": "E-posta veya şifre hatalı.",
  "auth/user-not-found": "Bu e-posta ile kayıtlı hesap yok.",
  "auth/email-already-in-use": "Bu e-posta ile zaten bir hesap var; giriş yapın.",
  "auth/weak-password": "Şifre en az 6 karakter olmalı.",
  "auth/invalid-email": "Geçerli bir e-posta adresi girin.",
  "auth/too-many-requests": "Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.",
  "auth/network-request-failed": "İnternet bağlantısı yok gibi görünüyor.",
};
export function authMessage(error) {
  return AUTH_ERRORS[error?.code] || error?.message || "İşlem tamamlanamadı.";
}

function requireAuth() {
  if (!auth) throw new Error("Firebase yapılandırılmamış.");
  return auth;
}

export function watchAuth(callback) {
  if (!auth) { callback(null); return () => {}; }
  return onAuthStateChanged(auth, callback);
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(requireAuth(), email.trim(), password);
  await cred.user.reload();
  return cred.user;
}

export async function signUp(email, password) {
  const cred = await createUserWithEmailAndPassword(requireAuth(), email.trim(), password);
  await sendEmailVerification(cred.user);
  return cred.user;
}

export async function resendVerification() {
  const user = requireAuth().currentUser;
  if (user) await sendEmailVerification(user);
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(requireAuth(), email.trim());
}

export async function logOut() {
  if (auth) await signOut(auth);
}

export async function reloadUser() {
  const user = requireAuth().currentUser;
  if (!user) return null;
  await user.reload();
  await user.getIdToken(true);
  return requireAuth().currentUser;
}

// Erişim: yönetici e-postası veya yöneticinin eklediği e-postalar.
export async function hasAccess(user) {
  if (!user?.email || !user.emailVerified) return false;
  const email = user.email.toLowerCase();
  if (email === OWNER_EMAIL) return true;
  try {
    const snap = await getDoc(doc(db, "allowedUsers", email));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function listAllowedUsers() {
  const snap = await getDocs(collection(db, "allowedUsers"));
  return snap.docs.map((d) => d.data()).sort((a, b) => String(a.email).localeCompare(String(b.email)));
}

export async function allowUser(email, actor) {
  const clean = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error("Geçerli bir e-posta girin.");
  await setDoc(doc(db, "allowedUsers", clean), { email: clean, addedBy: actor, addedAt: new Date().toISOString() });
}

export async function removeUser(email) {
  await deleteDoc(doc(db, "allowedUsers", String(email).toLowerCase()));
}
