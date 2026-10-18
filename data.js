import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  where,
} from "firebase/firestore";
import { resolveBusinessDate } from "./businessDate.js";
import { aggregateWorkOrderQuantities, calculateWorkOrderQuantityDeltas, calculateWorkOrderReversal } from "./workOrderInventory.js";
import { WORK_ORDER_STATUS } from "./workOrderLifecycle.js";
import { calculateWorkOrderNetTotal, normalizeLaborAmount } from "./workOrderPricing.js";
import { db, OWNER_EMAIL } from "./firebase.js";

const COLLECTIONS = ["parts", "jobs", "invoices", "drafts"];
const OPTIONAL_COLLECTIONS = ["fitments", "chat", "customers", "personnel", "appointments", "notifications"];

function requireDatabase() {
  if (!db) throw new Error("Sunucu bağlantısı kurulamadı. Lütfen sayfayı yenileyip tekrar deneyin.");
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
  await Promise.all(OPTIONAL_COLLECTIONS.map(async (name) => {
    try {
      result[name] = readCollection(await getDocs(collection(database, name)));
    } catch (error) {
      console.error(`${name} koleksiyonu okunamadı:`, error);
      result[name] = [];
    }
  }));
  const allParts = result.parts;
  result.parts = result.parts.filter((part) => !part.archived);
  const movementSnapshots = await Promise.all(allParts.map((part) => getDocs(collection(database, "parts", part.id, "movements"))));
  result.movements = movementSnapshots.flatMap(readCollection);
  const knownMovements = new Set(result.movements.map((movement) => `${movement.referenceCode}|${movement.partId}|${movement.type}`));
  const legacyMovements = [];
  result.jobs.filter((job) => !job.movementLedgerVersion).forEach((job) => job.items.forEach((item) => {
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
  const unsubscribe = [
    ...COLLECTIONS.map((name) => onSnapshot(collection(database, name), onChange, onError)),
    ...OPTIONAL_COLLECTIONS.map((name) => onSnapshot(collection(database, name), onChange, (error) => {
      console.error(`${name} canlı aboneliği başarısız:`, error);
    })),
  ];
  return () => unsubscribe.forEach((stop) => stop());
}

function movementRecord(part, { qty, type, reference, referenceCode, actor, stockBefore, stockAfter, date }) {
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
    date: date || day(),
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
    updated = { ...part, id, sku, skuNormalized: sku.toLocaleLowerCase("tr"), sold: part.sold || 0, archived: false, favorite: part.favorite || false };
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

export async function togglePartFavorite(partId) {
  const database = requireDatabase();
  const reference = doc(database, "parts", partId);
  const snapshot = await getDoc(reference);
  if (!snapshot.exists()) throw new Error("Parça bulunamadı.");
  const part = snapshot.data();
  const updated = { favorite: !part.favorite };
  await setDoc(reference, updated, { merge: true });
  return { ...part, ...updated };
}

export async function deletePart(partId) {
  await setDoc(doc(requireDatabase(), "parts", partId), { archived: true }, { merge: true });
}

export async function restorePart(partId) {
  await setDoc(doc(requireDatabase(), "parts", partId), { archived: false }, { merge: true });
}

function normalizeFitmentRecord(fitment, id, timestamps = {}) {
  return {
    id,
    make: String(fitment.make || "").trim(),
    model: String(fitment.model || "").trim(),
    year: String(fitment.year || "").trim(),
    fuel: String(fitment.fuel || "").trim(),
    engine: String(fitment.engine || "").trim(),
    parts: (fitment.parts || []).map((part) => ({
      partId: part.partId || "",
      sku: String(part.sku || "").trim(),
      name: String(part.name || "").trim(),
    })).filter((part) => part.name),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  };
}

export async function saveFitment(fitment) {
  const database = requireDatabase();
  const id = fitment.id || makeId();
  const now = new Date().toISOString();
  const reference = doc(database, "fitments", id);
  const snapshot = await getDoc(reference);
  const existing = snapshot.exists() ? snapshot.data() : null;
  const record = normalizeFitmentRecord(fitment, id, {
    createdAt: existing?.createdAt || fitment.createdAt || now,
    updatedAt: now,
  });
  if (!record.make || !record.model || !record.year || !record.fuel || !record.engine) {
    throw new Error("Marka, model, yıl, yakıt tipi ve motor hacmi zorunludur.");
  }
  if (!record.parts.length) throw new Error("En az bir uyumlu parça ekleyin.");
  await setDoc(reference, record);
  return record;
}

export async function deleteFitment(fitmentId) {
  await deleteDoc(doc(requireDatabase(), "fitments", fitmentId));
}

export async function createWorkOrder(job, actor) {
  const database = requireDatabase();
  const businessDate = resolveBusinessDate(job.date);
  const laborAmount = normalizeLaborAmount(job.laborAmount);
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
      date: businessDate,
      status: "Devam ediyor",
      movementLedgerVersion: 1,
      updatedAt: new Date().toISOString(),
      items,
      laborAmount,
      total: calculateWorkOrderNetTotal(items, laborAmount),
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
        date: businessDate,
      });
    }
    transaction.set(jobReference, record);
  });

  return record;
}

export async function updateWorkOrder(jobId, job, actor) {
  const database = requireDatabase();
  const businessDate = resolveBusinessDate(job.date);
  const laborAmount = normalizeLaborAmount(job.laborAmount);
  const jobReference = doc(database, "jobs", jobId);
  const baselineSnapshot = await getDoc(jobReference);
  if (!baselineSnapshot.exists()) throw new Error("Düzenlenecek iş emri bulunamadı.");
  const baselineJob = { id: baselineSnapshot.id, ...baselineSnapshot.data() };
  if (baselineJob.status === WORK_ORDER_STATUS.CANCELLED) throw new Error("İptal edilmiş iş emri düzenlenemez.");
  const oldItems = Array.isArray(baselineJob.items) ? baselineJob.items : [];

  // Sadece geçerli partId olan satırlar için stok deltasını hesapla
  const oldStockItems = oldItems.filter((item) => Boolean(item.partId));
  const newStockItems = (job.items || []).filter((item) => Boolean(item.partId));

  const partDeltas = new Map(calculateWorkOrderQuantityDeltas(oldStockItems, newStockItems).map((entry) => [entry.partId, entry]));
  const oldQuantities = new Map([...partDeltas].map(([partId, entry]) => [partId, entry.previousQty]));
  const partIds = [...partDeltas.keys()];
  const partReferences = new Map(partIds.map((partId) => [partId, doc(database, "parts", partId)]));
  const code = baselineJob.code || jobId;
  const baselineMovements = new Map();
  if (!baselineJob.movementLedgerVersion && partIds.length) {
    const snapshots = await Promise.all(partIds.map((partId) => getDocs(collection(database, "parts", partId, "movements"))));
    snapshots.forEach((snapshot, index) => {
      const partId = partIds[index];
      const hasOriginalMovement = snapshot.docs.some((entry) => {
        const movement = entry.data();
        return movement.referenceCode === code && movement.type === "İş emri";
      });
      if (!hasOriginalMovement && oldQuantities.has(partId)) {
        baselineMovements.set(partId, doc(database, "parts", partId, "movements", makeId()));
      }
    });
  }

  let updatedRecord;
  await runTransaction(database, async (transaction) => {
    const jobSnapshot = await transaction.get(jobReference);
    if (!jobSnapshot.exists()) throw new Error("Düzenlenecek iş emri bulunamadı.");
    const currentJob = jobSnapshot.data();

    if (currentJob.status === WORK_ORDER_STATUS.CANCELLED) {
      throw new Error("İptal edilmiş iş emri düzenlenemez.");
    }

    const partSnapshots = await Promise.all(partIds.map((partId) => transaction.get(partReferences.get(partId))));
    const currentParts = new Map(partSnapshots.map((snapshot) => [snapshot.id, snapshot.exists() ? snapshot.data() : null]));

    for (const partId of partIds) {
      const part = currentParts.get(partId);
      const delta = partDeltas.get(partId).delta;
      if (!part) {
        if (delta !== 0) throw new Error("İş emrindeki bir parça envanterde bulunamadı; stok farkları uygulanamadı.");
        continue;
      }
      if (delta > 0 && part.archived) throw new Error(`${part.name} arşivlenmiş olduğu için miktarı artırılamaz.`);
      if (delta > Number(part.stock || 0)) throw new Error(`${part.name} için değişiklik sonrası yeterli stok bulunmuyor.`);
    }

    if (baselineMovements.size) {
      const historicalDate = baselineJob.date || day();
      for (const [partId, movementReference] of baselineMovements) {
        const part = currentParts.get(partId);
        if (!part) continue;
        const movement = movementRecord({ id: partId, name: part.name, sku: part.sku }, {
          qty: -oldQuantities.get(partId),
          type: "İş emri",
          reference: "job",
          referenceCode: code,
          actor: "Geçmiş kayıt",
          stockBefore: null,
          stockAfter: null,
          date: historicalDate,
        });
        movement.id = movementReference.id;
        movement.createdAt = `${historicalDate}T12:00:00`;
        transaction.set(movementReference, movement);
      }
    }

    for (const partId of partIds) {
      const part = currentParts.get(partId);
      if (!part) continue;
      const delta = partDeltas.get(partId).delta;
      if (!delta) continue;
      const stockBefore = Number(part.stock || 0);
      const stockAfter = stockBefore - delta;
      transaction.update(partReferences.get(partId), {
        stock: stockAfter,
        sold: Math.max(0, Number(part.sold || 0) + delta),
      });
      writeMovement(transaction, database, { id: partId, name: part.name, sku: part.sku }, {
        qty: -delta,
        type: "İş emri düzenleme",
        reference: "job",
        referenceCode: code,
        actor,
        stockBefore,
        stockAfter,
        date: businessDate,
      });
    }

    const items = (job.items || []).map((item) => {
      const part = item.partId ? currentParts.get(item.partId) : null;
      const oldItem = oldItems.find((entry) => entry.partId === item.partId);
      const price = Number.isFinite(Number(item.price))
        ? Number(item.price)
        : (oldItem && Number.isFinite(Number(oldItem.price)))
          ? Number(oldItem.price)
          : (part?.price ?? 0);
      return {
        ...item,
        name: part?.name || item.name || oldItem?.name || "Parça",
        sku: part?.sku || item.sku || oldItem?.sku || "",
        category: part?.category || item.category || oldItem?.category || "Genel",
        brand: part?.brand || item.brand || oldItem?.brand || "",
        price,
      };
    });

    const nextStatus = job.status && [WORK_ORDER_STATUS.IN_PROGRESS, WORK_ORDER_STATUS.COMPLETED].includes(job.status)
      ? job.status
      : currentJob.status;
    const isNowCompleted = nextStatus === WORK_ORDER_STATUS.COMPLETED && currentJob.status !== WORK_ORDER_STATUS.COMPLETED;
    const isReopened = nextStatus === WORK_ORDER_STATUS.IN_PROGRESS && currentJob.status === WORK_ORDER_STATUS.COMPLETED;

    updatedRecord = {
      ...currentJob,
      status: nextStatus,
      plate: String(job.plate || "").trim().toLocaleUpperCase("tr"),
      make: String(job.make || "").trim(),
      model: String(job.model || "").trim(),
      customer: String(job.customer || "").trim(),
      phone: String(job.phone || "").trim(),
      date: businessDate,
      items,
      laborAmount,
      total: calculateWorkOrderNetTotal(items, laborAmount),
      movementLedgerVersion: 1,
      updatedAt: new Date().toISOString(),
      ...(isNowCompleted ? { completedAt: new Date().toISOString(), completedBy: actor || OWNER_EMAIL } : {}),
      ...(isReopened ? { completedAt: null, completedBy: null } : {}),
    };
    transaction.set(jobReference, updatedRecord);
  });
  return updatedRecord;
}

export async function completeWorkOrder(jobId, actor) {
  const database = requireDatabase();
  const jobReference = doc(database, "jobs", jobId);
  let completedRecord;
  await runTransaction(database, async (transaction) => {
    const jobSnapshot = await transaction.get(jobReference);
    if (!jobSnapshot.exists()) throw new Error("Tamamlanacak iş emri bulunamadı.");
    const job = jobSnapshot.data();
    if (job.status === WORK_ORDER_STATUS.CANCELLED) throw new Error("İptal edilmiş iş emri tamamlanamaz.");
    if (job.status === WORK_ORDER_STATUS.COMPLETED) throw new Error("Bu iş emri zaten tamamlandı.");
    if (job.status !== WORK_ORDER_STATUS.IN_PROGRESS) throw new Error("Yalnızca devam eden iş emirleri tamamlanabilir.");
    completedRecord = {
      ...job,
      status: WORK_ORDER_STATUS.COMPLETED,
      completedAt: new Date().toISOString(),
      completedBy: actor || OWNER_EMAIL,
      updatedAt: new Date().toISOString(),
    };
    transaction.set(jobReference, completedRecord);
  });
  return completedRecord;
}

export async function cancelWorkOrder(jobId, actor) {
  const database = requireDatabase();
  const jobReference = doc(database, "jobs", jobId);
  const baselineSnapshot = await getDoc(jobReference);
  if (!baselineSnapshot.exists()) throw new Error("İptal edilecek iş emri bulunamadı.");
  const baselineJob = baselineSnapshot.data();
  if (baselineJob.status === WORK_ORDER_STATUS.CANCELLED) throw new Error("Bu iş emri daha önce iptal edilmiş.");
  const items = Array.isArray(baselineJob.items) ? baselineJob.items : [];
  if (items.some((item) => !item.partId)) {
    throw new Error("Bu eski iş emrinde parça bağlantısı eksik. Stok güvenliği için iptal edilemiyor.");
  }
  const quantities = aggregateWorkOrderQuantities(items);
  const partIds = [...quantities.keys()];
  const partReferences = new Map(partIds.map((partId) => [partId, doc(database, "parts", partId)]));
  const code = baselineJob.code || jobId;
  const baselineMovements = new Map();
  if (!baselineJob.movementLedgerVersion) {
    const snapshots = await Promise.all(partIds.map((partId) => getDocs(collection(database, "parts", partId, "movements"))));
    snapshots.forEach((snapshot, index) => {
      const partId = partIds[index];
      const hasOriginalMovement = snapshot.docs.some((entry) => {
        const movement = entry.data();
        return movement.referenceCode === code && movement.type === "İş emri";
      });
      if (!hasOriginalMovement) baselineMovements.set(partId, doc(database, "parts", partId, "movements", makeId()));
    });
  }

  let cancelledRecord;
  await runTransaction(database, async (transaction) => {
    const jobSnapshot = await transaction.get(jobReference);
    if (!jobSnapshot.exists()) throw new Error("İptal edilecek iş emri bulunamadı.");
    const currentJob = jobSnapshot.data();
    if (currentJob.status === WORK_ORDER_STATUS.CANCELLED) throw new Error("Bu iş emri daha önce iptal edilmiş.");
    const snapshots = await Promise.all(partIds.map((partId) => transaction.get(partReferences.get(partId))));
    const parts = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot.exists() ? snapshot.data() : null]));
    for (const [partId] of quantities) {
      if (!parts.get(partId)) throw new Error("İş emrindeki parça envanterde bulunamadı; stok iadesi uygulanamadı.");
    }

    if (baselineMovements.size) {
      const historicalDate = baselineJob.date || day();
      for (const [partId, movementReference] of baselineMovements) {
        const part = parts.get(partId);
        const movement = movementRecord({ id: partId, name: part.name, sku: part.sku }, {
          qty: -quantities.get(partId),
          type: "İş emri",
          reference: "job",
          referenceCode: code,
          actor: "Geçmiş kayıt",
          stockBefore: null,
          stockAfter: null,
          date: historicalDate,
        });
        movement.id = movementReference.id;
        movement.createdAt = `${historicalDate}T12:00:00`;
        transaction.set(movementReference, movement);
      }
    }

    for (const [partId, qty] of quantities) {
      const part = parts.get(partId);
      const reversal = calculateWorkOrderReversal(part, qty);
      transaction.update(partReferences.get(partId), {
        stock: reversal.stockAfter,
        sold: reversal.soldAfter,
      });
      writeMovement(transaction, database, { id: partId, name: part.name, sku: part.sku }, {
        qty,
        type: "İş emri iptali",
        reference: "job",
        referenceCode: code,
        actor,
        stockBefore: reversal.stockBefore,
        stockAfter: reversal.stockAfter,
        date: baselineJob.date || day(),
      });
    }

    cancelledRecord = {
      ...currentJob,
      status: WORK_ORDER_STATUS.CANCELLED,
      cancelledAt: new Date().toISOString(),
      cancelledBy: actor || OWNER_EMAIL,
      movementLedgerVersion: 1,
      updatedAt: new Date().toISOString(),
    };
    transaction.set(jobReference, cancelledRecord);
  });
  return cancelledRecord;
}

export async function createPurchaseInvoice(invoice, actor) {
  const database = requireDatabase();
  const businessDate = resolveBusinessDate(invoice.date);
  const invoiceNumber = String(invoice.invoiceNumber || "").trim();
  if (!invoiceNumber) throw new Error("Fatura numarası girilmelidir.");
  if (!String(invoice.supplier || "").trim()) throw new Error("Tedarikçi adı girilmelidir.");
  if (!Array.isArray(invoice.items) || !invoice.items.length) throw new Error("Faturaya en az bir parça eklenmelidir.");
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
      code: invoiceNumber,
      supplier: String(invoice.supplier).trim(),
      date: businessDate,
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
      date: businessDate,
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

export async function sendChatMessage(senderEmail, senderName, text) {
  const database = requireDatabase();
  if (!text.trim()) throw new Error("Mesaj boş olamaz.");
  const messageId = makeId();
  const message = {
    id: messageId,
    senderEmail,
    senderName: senderName || senderEmail.split("@")[0],
    text: text.trim(),
    timestamp: new Date().toISOString(),
  };
  await setDoc(doc(database, "chat", messageId), message);
  return message;
}

export function subscribeToChat(onMessage, onError) {
  const database = requireDatabase();
  return onSnapshot(collection(database, "chat"), (snapshot) => {
    const messages = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
    onMessage(messages);
  }, onError);
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

// ── Personnel (Çalışan) Yönetimi ─────────────────────────────────────────────
export async function savePersonnel(personnel, actor) {
  const database = requireDatabase();
  const id = personnel.id || makeId();
  const now = new Date().toISOString();
  const record = {
    id,
    name: String(personnel.name || "").trim(),
    role: String(personnel.role || "").trim(),
    phone: String(personnel.phone || "").trim(),
    email: String(personnel.email || "").trim(),
    commissionRate: Number.isFinite(Number(personnel.commissionRate)) ? Number(personnel.commissionRate) : 0,
    baseSalary: Number.isFinite(Number(personnel.baseSalary)) ? Number(personnel.baseSalary) : 0,
    active: personnel.active !== false,
    createdAt: personnel.createdAt || now,
    updatedAt: now,
  };
  if (!record.name || !record.role) throw new Error("Ad ve pozisyon zorunludur.");
  await setDoc(doc(database, "personnel", id), record);
  return record;
}

export async function listPersonnel() {
  const database = requireDatabase();
  const snapshot = await getDocs(collection(database, "personnel"));
  return readCollection(snapshot).sort((a, b) => a.name.localeCompare(b.name));
}

export async function deletePersonnel(personnelId) {
  await deleteDoc(doc(requireDatabase(), "personnel", personnelId));
}

export function getPersonnelPerformance(jobs, personnelList) {
  const byPerson = new Map();
  personnelList.forEach((p) => byPerson.set(p.id, { ...p, jobs: 0, revenue: 0, commission: 0 }));
  jobs.forEach((job) => {
    const pid = job.personnelId;
    if (!pid || !byPerson.has(pid)) return;
    const p = byPerson.get(pid);
    p.jobs += 1;
    const total = Number(job.total || 0);
    p.revenue += total;
    p.commission += total * (p.commissionRate / 100);
  });
  return [...byPerson.values()];
}

// ── Müşteri Yönetimi ─────────────────────────────────────────────────────────
export async function saveCustomer(customer, actor) {
  const database = requireDatabase();
  const id = customer.id || makeId();
  const now = new Date().toISOString();
  const record = {
    id,
    name: String(customer.name || "").trim(),
    phone: String(customer.phone || "").trim(),
    email: String(customer.email || "").trim(),
    address: String(customer.address || "").trim(),
    city: String(customer.city || "").trim(),
    taxNumber: String(customer.taxNumber || "").trim(),
    active: customer.active !== false,
    createdAt: customer.createdAt || now,
    updatedAt: now,
  };
  if (!record.name || !record.phone) throw new Error("Ad ve telefon zorunludur.");
  await setDoc(doc(database, "customers", id), record);
  return record;
}

export async function listCustomers() {
  const database = requireDatabase();
  const snapshot = await getDocs(collection(database, "customers"));
  return readCollection(snapshot).sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteCustomer(customerId) {
  await deleteDoc(doc(requireDatabase(), "customers", customerId));
}

// ── Randevu Yönetimi ─────────────────────────────────────────────────────────
export async function saveAppointment(appointment, actor) {
  const database = requireDatabase();
  const id = appointment.id || makeId();
  const now = new Date().toISOString();
  const record = {
    id,
    customerId: String(appointment.customerId || "").trim(),
    vehiclePlate: String(appointment.vehiclePlate || "").trim().toLocaleUpperCase("tr"),
    vehicleMake: String(appointment.vehicleMake || "").trim(),
    vehicleModel: String(appointment.vehicleModel || "").trim(),
    serviceType: String(appointment.serviceType || "").trim(),
    description: String(appointment.description || "").trim(),
    date: String(appointment.date || ""),
    time: String(appointment.time || ""),
    status: appointment.status || "pending",
    personnelId: String(appointment.personnelId || "").trim(),
    createdAt: appointment.createdAt || now,
    updatedAt: now,
  };
  if (!record.customerId || !record.vehiclePlate || !record.date || !record.time) {
    throw new Error("Müşteri, plaka, tarih ve saat zorunludur.");
  }
  await setDoc(doc(database, "appointments", id), record);
  return record;
}

export async function listAppointments() {
  const database = requireDatabase();
  const snapshot = await getDocs(collection(database, "appointments"));
  return readCollection(snapshot).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

export async function deleteAppointment(appointmentId) {
  await deleteDoc(doc(requireDatabase(), "appointments", appointmentId));
}

export async function updateAppointmentStatus(appointmentId, status, actor) {
  const database = requireDatabase();
  await setDoc(doc(database, "appointments", appointmentId), { status, updatedAt: new Date().toISOString() }, { merge: true });
}

// ── Bildirim Yönetimi ────────────────────────────────────────────────────────
export async function createNotification(notification, actor) {
  const database = requireDatabase();
  const id = makeId();
  const record = {
    id,
    title: String(notification.title || "").trim(),
    message: String(notification.message || "").trim(),
    type: notification.type || "info",
    recipientEmail: String(notification.recipientEmail || actor || "").trim(),
    read: false,
    createdAt: new Date().toISOString(),
    link: String(notification.link || ""),
  };
  if (!record.title || !record.message) throw new Error("Başlık ve mesaj zorunludur.");
  await setDoc(doc(database, "notifications", id), record);
  return record;
}

export async function listNotifications() {
  const database = requireDatabase();
  const snapshot = await getDocs(collection(database, "notifications"));
  return readCollection(snapshot).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function markNotificationRead(notificationId) {
  const database = requireDatabase();
  await setDoc(doc(database, "notifications", notificationId), { read: true }, { merge: true });
}

export async function deleteNotification(notificationId) {
  await deleteDoc(doc(requireDatabase(), "notifications", notificationId));
}
