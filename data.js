import {
  collection,
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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
  const result = Object.fromEntries(COLLECTIONS.map((name, index) => [name, readCollection(snapshots[index])]));
  const allParts = result.parts;
  result.parts = result.parts.filter((part) => !part.archived);
  const movementSnapshots = await Promise.all(allParts.map((part) => getDocs(collection(database, "parts", part.id, "movements"))));
  result.movements = movementSnapshots.flatMap(readCollection);
  const knownMovements = new Set(result.movements.map((movement) => `${movement.referenceCode}|${movement.partId}|${movement.type}`));
  const legacyMovements = [];
  result.jobs.forEach((job) => job.items.forEach((item) => {
    const key = `${job.code}|${item.partId}|İş emri`;
    if (!knownMovements.has(key)) legacyMovements.push({
      id: `legacy-${job.id}-${item.partId}`,
      partId: item.partId,
      name: item.name,
      sku: item.sku || "",
      qty: -item.qty,
      type: "İş emri",
      reference: "job",
      referenceCode: job.code || job.id,
      actor: "Geçmiş kayıt",
      date: job.date,
      createdAt: `${job.date}T12:00:00`,
    });
  }));
  result.invoices.forEach((invoice) => invoice.items.forEach((item) => {
    const key = `${invoice.code}|${item.partId}|Alış faturası`;
    if (!knownMovements.has(key)) legacyMovements.push({
      id: `legacy-${invoice.id}-${item.partId}`,
      partId: item.partId,
      name: item.name,
      sku: item.sku || "",
      qty: item.qty,
      type: "Alış faturası",
      reference: "invoice",
      referenceCode: invoice.code || invoice.id,
      actor: "Geçmiş kayıt",
      date: invoice.date,
      createdAt: `${invoice.date}T12:00:00`,
    });
  }));
  result.movements.push(...legacyMovements);
  result.movements.sort((first, second) => (second.createdAt || "").localeCompare(first.createdAt || ""));
  return result;
}

export function subscribeToServiceData(onChange, onError) {
  const database = requireDatabase();
  const unsubscribe = COLLECTIONS.map((name) =>
    onSnapshot(collection(database, name), onChange, onError)
  );
  return () => unsubscribe.forEach((stop) => stop());
}

function movementRecord(part, { qty, type, reference, referenceCode, actor, stockBefore, stockAfter }) {
  return {
    id: makeId(),
    partId: part.id,
    name: part.name,
    sku: part.sku,
    qty,
    type,
    reference,
    referenceCode,
    actor: actor || OWNER_EMAIL,
    stockBefore,
    stockAfter,
    date: day(),
    createdAt: new Date().toISOString(),
  };
}

function writeMovement(transaction, database, part, details) {
  const movement = movementRecord(part, details);
  transaction.set(doc(database, "parts", part.id, "movements", movement.id), movement);
}

export async function savePart(part, actor) {
  const database = requireDatabase();
  const sku = part.sku.trim();
  const duplicateQuery = query(collection(database, "parts"), where("skuNormalized", "==", sku.toLocaleLowerCase("tr")));
  const matches = await getDocs(duplicateQuery);
  const duplicate = matches.docs.find((entry) => entry.id !== part.id);
  if (duplicate) throw new Error("Bu SKU kodu başka bir parçada kullanılıyor.");

  const id = part.id || makeId();
  const reference = doc(database, "parts", id);
  const movementReference = doc(database, "parts", id, "movements", makeId());
  let updated;
  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const existing = snapshot.exists() ? snapshot.data() : null;
    updated = { ...part, id, sku, skuNormalized: sku.toLocaleLowerCase("tr"), sold: part.sold || 0, archived: false };
    const previousStock = Number(existing?.stock || 0);
    const difference = Number(updated.stock || 0) - previousStock;
    transaction.set(reference, updated);
    if (difference) {
      const movement = movementRecord(updated, {
        qty: difference,
        type: existing ? "Düzeltme" : "Açılış stoğu",
        reference: "part",
        referenceCode: sku,
        actor,
        stockBefore: previousStock,
        stockAfter: Number(updated.stock || 0),
      });
      movement.id = movementReference.id;
      transaction.set(movementReference, movement);
    }
  });
  return updated;
}

export async function deletePart(partId) {
  await setDoc(doc(requireDatabase(), "parts", partId), { archived: true }, { merge: true });
}

export async function restorePart(partId) {
  await setDoc(doc(requireDatabase(), "parts", partId), { archived: false }, { merge: true });
}

export async function createWorkOrder(job, actor) {
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
      if (part.archived) throw new Error(`${part.name} arşivlenmiş olduğu için iş emrine eklenemez.`);
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
      const stockAfter = part.stock - quantity;
      transaction.update(doc(database, "parts", partId), { stock: stockAfter, sold: (part.sold || 0) + quantity });
      writeMovement(transaction, database, { id: partId, name: part.name, sku: part.sku }, {
        qty: -quantity,
        type: "İş emri",
        reference: "job",
        referenceCode: record.code,
        actor,
        stockBefore: part.stock,
        stockAfter,
      });
    }
    transaction.set(jobReference, record);
  });

  return record;
}

export async function createPurchaseInvoice(invoice, actor) {
  const database = requireDatabase();
  const aggregated = new Map();
  invoice.items.forEach((item) => {
    const sku = String(item.sku || "").trim();
    const key = sku ? sku.toLocaleLowerCase("tr") : item.partId;
    const previous = aggregated.get(key);
    if (previous) {
      if (previous.price !== undefined && item.price !== undefined && previous.price !== item.price) {
        throw new Error(`Aynı stok kodu (${sku || item.sku}) için farklı satış fiyatları girilmiş.`);
      }
      const totalQty = previous.qty + item.qty;
      previous.cost = (previous.cost * previous.qty + item.cost * item.qty) / totalQty;
      previous.qty = totalQty;
      if (previous.price === undefined) previous.price = item.price;
    } else aggregated.set(key, { ...item, sku });
  });
  const items = [...aggregated.values()];
  for (const item of items) {
    if (!item.sku || !Number.isInteger(item.qty) || item.qty <= 0 || !Number.isFinite(item.cost) || item.cost < 0) {
      throw new Error("Faturadaki stok kodu, adet veya alış fiyatı geçersiz.");
    }
    if (item.price !== undefined && (!Number.isFinite(item.price) || item.price < 0)) {
      throw new Error(`${item.name || item.sku} için satış fiyatı geçersiz.`);
    }
  }

  const invoiceId = makeId();
  const invoiceReference = doc(database, "invoices", invoiceId);
  const skuQueries = items.map((item) => query(
    collection(database, "parts"),
    where("skuNormalized", "==", item.sku.toLocaleLowerCase("tr"))
  ));
  const skuMatches = await Promise.all(skuQueries.map((skuQuery) => getDocs(skuQuery)));
  const partReferences = items.map((item, index) => {
    const matches = skuMatches[index];
    if (matches.size > 1) throw new Error(`${item.sku} stok kodu birden fazla kartta kullanılıyor.`);
    const matched = matches.docs[0];
    if (matched && item.partId && matched.id !== item.partId) {
      throw new Error(`${item.sku} stok kodu başka bir parça kartında kullanılıyor.`);
    }
    const id = matched?.id || item.partId || `sku-${encodeURIComponent(item.sku.toLocaleLowerCase("tr"))}`;
    return doc(database, "parts", id);
  });
  let record;
  await runTransaction(database, async (transaction) => {
    const snapshots = await Promise.all(partReferences.map((reference) => transaction.get(reference)));
    const reads = snapshots.map((snapshot, index) => {
      const item = items[index];
      if (snapshot.exists() && snapshot.data().sku.toLocaleLowerCase("tr") !== item.sku.toLocaleLowerCase("tr")) {
        throw new Error(`${item.sku} stok kodu seçilen parçayla eşleşmiyor.`);
      }
      if (!snapshot.exists() && (!item.name?.trim() || item.price === undefined)) {
        throw new Error(`${item.sku} yeni stok kodu için parça adı ve satış fiyatı girilmelidir.`);
      }
      if (snapshot.exists() && snapshot.data().archived) {
        throw new Error(`${item.sku} arşivlenmiş olduğu için faturaya eklenemez.`);
      }
      return snapshot.exists() ? snapshot : null;
    });
    const savedItems = items.map((item, index) => {
      const snapshot = reads[index];
      const existing = snapshot?.data();
      const partId = snapshot?.id || partReferences[index].id;
      const sku = existing?.sku || item.sku;
      const name = existing?.name || item.name.trim();
      const stockBefore = Number(existing?.stock || 0);
      const stockAfter = stockBefore + item.qty;
      const updatedPart = existing
        ? { stock: stockAfter, cost: item.cost, ...(item.price === undefined ? {} : { price: item.price }) }
        : {
            id: partId,
            sku,
            skuNormalized: sku.toLocaleLowerCase("tr"),
            name,
            category: item.category?.trim() || "Genel",
            brand: item.brand?.trim() || "",
            stock: stockAfter,
            minimum: Number.isFinite(item.minimum) && item.minimum >= 0 ? item.minimum : 5,
            price: item.price,
            cost: item.cost,
            sold: 0,
            archived: false,
          };
      if (existing) transaction.update(doc(database, "parts", partId), updatedPart);
      else transaction.set(partReferences[index], updatedPart);
      return { ...item, partId, name, sku, price: item.price ?? existing?.price, stockBefore, stockAfter };
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
    savedItems.forEach((item) => writeMovement(transaction, database, { id: item.partId, name: item.name, sku: item.sku }, {
      qty: item.qty,
      type: "Alış faturası",
      reference: "invoice",
      referenceCode: record.code,
      actor,
      stockBefore: item.stockBefore,
      stockAfter: item.stockAfter,
    }));
  });
  return record;
}

export async function createStockDraft() {
  const database = requireDatabase();
  const parts = readCollection(await getDocs(collection(database, "parts")));
  const items = parts
    .filter((part) => !part.archived && part.stock <= part.minimum)
    .map((part) => ({ partId: part.id, name: part.name, sku: part.sku, qty: Math.max(part.minimum * 2 - part.stock, part.minimum), cost: part.cost }));
  if (!items.length) throw new Error("Kritik seviyede parça bulunmuyor.");

  const id = makeId();
  const draft = { id, code: nextCode("SIP"), date: day(), status: "Taslak", items };
  await setDoc(doc(database, "drafts", id), draft);
  return draft;
}

export async function receiveStockDraft(draftId, actor) {
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
      const part = snapshot.data();
      const stockAfter = part.stock + draft.items[index].qty;
      transaction.update(references[index], { stock: stockAfter });
      writeMovement(transaction, database, { id: draft.items[index].partId, name: part.name, sku: part.sku }, {
        qty: draft.items[index].qty,
        type: "Sipariş teslimi",
        reference: "draft",
        referenceCode: draft.code,
        actor,
        stockBefore: part.stock,
        stockAfter,
      });
    });
    transaction.delete(draftReference);
  });
}

export async function listAuthorizedUsers() {
  const database = requireDatabase();
  const snapshot = await getDocs(collection(database, "authorizedUsers"));
  return readCollection(snapshot)
    .filter((entry) => entry.email !== OWNER_EMAIL)
    .sort((first, second) => first.email.localeCompare(second.email));
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
