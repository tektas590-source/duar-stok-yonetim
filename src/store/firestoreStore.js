// Firestore deposu: canlı abonelik + transaction ile atomik stok işlemleri.
import { collection, doc, limit, onSnapshot, orderBy, query, runTransaction } from "firebase/firestore";
import { db } from "../firebase.js";
import { createOps } from "./ops.js";

const MOVEMENT_LIMIT = 5000;

export function createFirestoreStore(getActor) {
  async function runTx(fn) {
    return runTransaction(db, async (t) => {
      const writes = [];
      const tx = {
        get: async (col, id) => {
          const snap = await t.get(doc(db, col, id));
          return snap.exists() ? { id: snap.id, ...snap.data() } : null;
        },
        set: (col, id, data) => writes.push([col, id, data]),
      };
      const result = await fn(tx);
      writes.forEach(([col, id, data]) => {
        const { id: _omit, ...rest } = data;
        t.set(doc(db, col, id), stripUndefined(rest));
      });
      return result;
    });
  }

  return {
    kind: "firestore",
    subscribe(onState, onError) {
      const state = { ready: false, items: [], movements: [], invoices: [], issues: [] };
      const loaded = new Set();
      const emit = () => onState({ ...state, ready: loaded.size >= 4 });
      const listen = (key, ref, sorter) => onSnapshot(ref, (snap) => {
        state[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (sorter) state[key].sort(sorter);
        loaded.add(key);
        emit();
      }, (error) => { console.error(`${key} okunamadı`, error); onError?.(error); });
      const byDate = (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt));
      const stops = [
        listen("items", collection(db, "items")),
        listen("movements", query(collection(db, "movements"), orderBy("createdAt", "desc"), limit(MOVEMENT_LIMIT))),
        listen("invoices", collection(db, "invoices"), byDate),
        listen("issues", collection(db, "issues"), byDate),
      ];
      return () => stops.forEach((stop) => stop());
    },
    ...createOps(runTx, getActor),
  };
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, stripUndefined(v)]));
  }
  return value;
}
