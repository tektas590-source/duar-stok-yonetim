import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  where,
} from "firebase/firestore";
import { db, OWNER_EMAIL } from "./firebase.js";

const COLLECTIONS = ["parts", "jobs", "invoices", "drafts"];

function requireDatabase() {
  if (!db) throw new Error("Firebase bağlantısı ayarlı değil. Firebase web ayarlarını ekleyip uygulamayı yeniden başlatın.");
  return db;
}

function day(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function makeId() {
  return crypto.randomUUID();
}

function nextCode(prefix) {
  const now = new Date();
  const suffix = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}${String(now.getMilliseconds()).padStart(3, "0")}`;
  return `${prefix}-${now.getFullYear()}-${suffix}`;
}

function readCollection(snapshot) {
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

export async function fetchServiceData() {
  const database = requireDatabase();
  const snapshots = await Promise.all(COLLECTIONS.map((name) => getDocs(collection(database, name))));
  return Object.fromEntries(COLLECTIONS.map((name, index) => [name, readCollection(snapshots[index])]));
}

export function subscribeToServiceData(onChange, onError) {
  const database = requireDatabase();
  const unsubscribe = COLLECTIONS.map((name) =>
    onSnapshot(collection(database, name), onChange, onError)
  );
  return () => unsubscribe.forEach((stop) => stop());
}

export async function savePart(part) {
  const database = requireDatabase();
  const sku = part.sku.trim();
  const duplicateQuery = query(collection(database, "parts"), where("skuNormalized", "==", sku.toLocaleLowerCase("tr")));
  const matches = await getDocs(duplicateQuery);
  const duplicate = matches.docs.find((entry) => entry.id !== part.id);
  if (duplicate) throw new Error("Bu SKU kodu başka bir parçada kullanılıyor.");

  const id = part.id || makeId();
  const updated = { ...part, id, sku, skuNormalized: sku.toLocaleLowerCase("tr"), sold: part.sold || 0 };
  await setDoc(doc(database, "parts", id), updated);
  return updated;
}

export async function deletePart(partId) {
  await deleteDoc(doc(requireDatabase(), "parts", partId));
}

export async function createWorkOrder(job) {
  const database = requireDatabase();
  const quantities = new Map();
  job.items.forEach((item) => quantities.set(item.partId, (quantities.get(item.partId) || 0) + item.qty));
  const partReferences = [...quantities.keys()].map((id) => doc(database, "parts", id));
  const jobId = makeId();
  const jobReference = doc(database, "jobs", jobId);
  let record;

  await runTransaction(database, async (transaction) => {
    const snapshots = await Promise.all(partReferences.map((reference) => transaction.get(reference)));
    const parts = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot.exists() ? snapshot.data() : null]));
    for (const [partId, quantity] of quantities) {
      const part = parts.get(partId);
      if (!part) throw new Error("İş emrindeki parça envanterde bulunamadı.");
      if (quantity > part.stock) throw new Error(`${part.name} için yeterli stok bulunmuyor.`);
    }

    const items = job.items.map((item) => {
      const part = parts.get(item.partId);
      return { ...item, name: part.name, price: part.price };
    });
    record = {
      ...job,
      id: jobId,
      code: nextCode("IS"),
      date: day(),
      status: "Devam ediyor",
      items,
      total: items.reduce((sum, item) => sum + item.qty * item.price, 0),
    };
    for (const [partId, quantity] of quantities) {
      const part = parts.get(partId);
      transaction.update(doc(database, "parts", partId), { stock: part.stock - quantity, sold: (part.sold || 0) + quantity });
    }
    transaction.set(jobReference, record);
  });

  return record;
}

export async function createPurchaseInvoice(invoice) {
  const database = requireDatabase();
  const aggregated = new Map();
  invoice.items.forEach((item) => {
    const previous = aggregated.get(item.partId);
    if (previous) {
      const totalQty = previous.qty + item.qty;
      previous.cost = (previous.cost * previous.qty + item.cost * item.qty) / totalQty;
      previous.qty = totalQty;
    } else aggregated.set(item.partId, { ...item });
  });
  const items = [...aggregated.values()];
  for (const item of items) {
    if (!Number.isInteger(item.qty) || item.qty <= 0 || !Number.isFinite(item.cost) || item.cost < 0) {
      throw new Error("Faturadaki adet veya alış fiyatı geçersiz.");
    }
  }

  const invoiceId = makeId();
  const invoiceReference = doc(database, "invoices", invoiceId);
  const partReferences = items.map((item) => doc(database, "parts", item.partId));
  let record;
  await runTransaction(database, async (transaction) => {
    const snapshots = await Promise.all(partReferences.map((reference) => transaction.get(reference)));
    const parts = snapshots.map((snapshot) => snapshot.exists() ? snapshot.data() : null);
    if (parts.some((part) => !part)) throw new Error("Faturadaki parça envanterde bulunamadı.");

    const savedItems = items.map((item, index) => {
      const part = parts[index];
      return { ...item, name: part.name, sku: part.sku };
    });
    savedItems.forEach((item, index) => {
      transaction.update(partReferences[index], { stock: parts[index].stock + item.qty, cost: item.cost });
    });
    record = {
      id: invoiceId,
      code: nextCode("AL"),
      supplier: invoice.supplier,
      date: day(),
      total: savedItems.reduce((sum, item) => sum + item.qty * item.cost, 0),
      status: "Ödendi",
      lines: savedItems.length,
      items: savedItems,
    };
    transaction.set(invoiceReference, record);
  });
  return record;
}

export async function createStockDraft() {
  const database = requireDatabase();
  const parts = readCollection(await getDocs(collection(database, "parts")));
  const items = parts
    .filter((part) => part.stock <= part.minimum)
    .map((part) => ({ partId: part.id, name: part.name, sku: part.sku, qty: Math.max(part.minimum * 2 - part.stock, part.minimum), cost: part.cost }));
  if (!items.length) throw new Error("Kritik seviyede parça bulunmuyor.");

  const id = makeId();
  const draft = { id, code: nextCode("SIP"), date: day(), status: "Taslak", items };
  await setDoc(doc(database, "drafts", id), draft);
  return draft;
}

export async function receiveStockDraft(draftId) {
  const database = requireDatabase();
  const draftReference = doc(database, "drafts", draftId);
  await runTransaction(database, async (transaction) => {
    const draftSnapshot = await transaction.get(draftReference);
    if (!draftSnapshot.exists()) throw new Error("Taslak sipariş bulunamadı veya daha önce stoğa işlendi.");
    const draft = draftSnapshot.data();
    const references = draft.items.map((item) => doc(database, "parts", item.partId));
    const snapshots = await Promise.all(references.map((reference) => transaction.get(reference)));
    if (snapshots.some((snapshot) => !snapshot.exists())) {
      const missing = snapshots.findIndex((snapshot) => !snapshot.exists());
      throw new Error(`${draft.items[missing].name} envanterde bulunamadı; sipariş stoğa aktarılamadı.`);
    }
    snapshots.forEach((snapshot, index) => {
      transaction.update(references[index], { stock: snapshot.data().stock + draft.items[index].qty });
    });
    transaction.delete(draftReference);
  });
}

export async function listAuthorizedUsers() {
  const database = requireDatabase();
  const snapshot = await getDocs(collection(database, "authorizedUsers"));
  return readCollection(snapshot).sort((first, second) => first.email.localeCompare(second.email));
}

export async function grantUserAccess(email) {
  const database = requireDatabase();
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("Geçerli bir e-posta adresi girin.");
  if (normalizedEmail === OWNER_EMAIL) throw new Error("Servis yöneticisi zaten tam yetkiye sahip.");
  await setDoc(doc(database, "authorizedUsers", normalizedEmail), { email: normalizedEmail, grantedAt: new Date().toISOString() });
}

export async function revokeUserAccess(email) {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail === OWNER_EMAIL) throw new Error("Servis yöneticisinin erişimi kaldırılamaz.");
  await deleteDoc(doc(requireDatabase(), "authorizedUsers", normalizedEmail));
}
