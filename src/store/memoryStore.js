// Bellek içi depo: testler ve önizleme için. Firestore deposuyla aynı arayüz.
import { createOps } from "./ops.js";

const COLLECTIONS = ["items", "movements", "invoices", "issues", "counts"];

export function createMemoryStore(seed = {}, actor = "demo@duar.local") {
  const db = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map((seed[c] || []).map((d) => [d.id, d]))]));
  const listeners = new Set();
  const snapshot = () => ({
    ready: true,
    items: [...db.items.values()],
    movements: [...db.movements.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    invoices: [...db.invoices.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt))),
    issues: [...db.issues.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt))),
  });
  const emit = () => { const s = snapshot(); listeners.forEach((fn) => fn(s)); };

  async function runTx(fn) {
    const writes = [];
    const tx = {
      get: async (col, id) => { const d = db[col].get(id); return d ? structuredClone(d) : null; },
      set: (col, id, data) => writes.push([col, id, structuredClone(data)]),
    };
    const result = await fn(tx);
    writes.forEach(([col, id, data]) => db[col].set(id, data));
    emit();
    return result;
  }

  return {
    kind: "memory",
    subscribe(fn) { listeners.add(fn); fn(snapshot()); return () => listeners.delete(fn); },
    ...createOps(runTx, () => actor),
  };
}
