import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { doc, getDoc, getFirestore } from "firebase/firestore";

export const OWNER_EMAIL = "tektas590@gmail.com";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
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

export function signInWithGoogle() {
  if (!auth) throw new Error("Firebase bağlantısı ayarlı değil. README'deki Firebase kurulum adımlarını tamamlayın.");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider);
}

export function signOutUser() {
  if (!auth) throw new Error("Firebase bağlantısı ayarlı değil.");
  return signOut(auth);
}

export function subscribeToAuth(onUser, onError) {
  if (!auth || !db) {
    onError(new Error("Firebase bağlantısı ayarlı değil. Firebase web ayarlarını .env.local dosyasına ve Vercel Environment Variables bölümüne ekleyin."));
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
        onError(new Error("Doğrulanmış bir Google e-posta hesabı gerekli."));
        return;
      }
      if (email !== OWNER_EMAIL) {
        const access = await getDoc(doc(db, "authorizedUsers", email));
        if (!access.exists()) {
          await signOut(auth);
          onUser(null);
          onError(new Error(`${email} hesabına henüz erişim verilmemiş. Servis yöneticisinden yetki isteyin.`));
          return;
        }
      }
      onUser(firebaseUser);
    } catch (error) {
      onUser(null);
      onError(error);
    }
  }, onError);
}
