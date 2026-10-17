import { getApp, getApps, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from "firebase/auth";
import { doc, getDoc, getFirestore, setDoc } from "firebase/firestore";

export const OWNER_EMAIL = "tektas590@gmail.com";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyB64r0lgvQ6WVfEH3p8_AjUjl43ChnrJKE",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "stok-16ef3.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "stok-16ef3",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "stok-16ef3.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "63997599395",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:63997599395:web:5a1adcff28bf74c5ea2916",
};

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);

const app = firebaseConfigured ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

function requireAuth() {
  if (!auth) throw new Error("Sunucu bağlantısı kurulamadı. Lütfen sayfayı yenileyip tekrar deneyin.");
  return auth;
}

export async function signInWithPassword(username, password) {
  const email = resolveLoginEmail(username);
  return signInWithEmailAndPassword(requireAuth(), email, password);
}

export async function requestPasswordReset(usernameOrEmail) {
  return sendPasswordResetEmail(requireAuth(), resolveLoginEmail(usernameOrEmail));
}

function resolveLoginEmail(usernameOrEmail) {
  const normalizedUsername = usernameOrEmail.trim().toLowerCase();
  return normalizedUsername === "serkan.tektas" ? OWNER_EMAIL : normalizedUsername;
}

export async function registerWithPassword(email, password) {
  const authInstance = requireAuth();
  const credential = await createUserWithEmailAndPassword(authInstance, email.trim().toLowerCase(), password);
  await sendEmailVerification(credential.user);
  await signOut(authInstance);
}

export async function changeInitialPassword(newPassword) {
  const authInstance = requireAuth();
  const currentUser = authInstance.currentUser;
  if (!currentUser || currentUser.email?.toLowerCase() !== OWNER_EMAIL || !currentUser.emailVerified) {
    throw new Error("Yönetici hesabı doğrulanmış olarak oturum açmış olmalı.");
  }
  await updatePassword(currentUser, newPassword);
  await setDoc(doc(getFirestore(), "authorizedUsers", OWNER_EMAIL), {
    email: OWNER_EMAIL,
    role: "admin",
    mustChangePassword: false,
  });
}

export function signOutUser() {
  return signOut(requireAuth());
}

export function subscribeToAuth(onUser, onError) {
  if (!auth || !db) {
    onError(new Error("Sunucu bağlantısı kurulamadı. Lütfen sayfayı yenileyip tekrar deneyin."));
    return () => {};
  }

  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      onUser(null);
      return;
    }

    try {
      const email = firebaseUser.email?.trim().toLowerCase();
      if (!email || !firebaseUser.emailVerified) {
        await signOut(auth);
        onUser(null);
        onError(new Error("Devam etmek için e-posta adresinizi gelen doğrulama bağlantısıyla doğrulayın."));
        return;
      }
      const access = await getDoc(doc(db, "authorizedUsers", email));
      if (email !== OWNER_EMAIL && !access.exists()) {
        await signOut(auth);
        onUser(null);
        onError(new Error(`${email} hesabına henüz erişim verilmemiş. Servis yöneticisinden yetki isteyin.`));
        return;
      }
      onUser({
        ...firebaseUser,
        mustChangePassword: email === OWNER_EMAIL && (!access.exists() || access.data().mustChangePassword === true),
      });
    } catch (error) {
      onUser(null);
      onError(error);
    }
  }, onError);
}
