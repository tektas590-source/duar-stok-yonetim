import { supabase } from "./supabase.js";

function client() {
  if (!supabase) throw new Error("Supabase bağlantısı yapılandırılmamış.");
  return supabase;
}
function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}
function mapPart(row) {
  return { ...row, id: row.id, minimum: row.minimum_stock, cost: Number(row.cost), price: Number(row.price), stock: row.stock, sold: row.sold };
}
function mapJob(row, items) {
  return { ...row, id: row.id, code: row.code, date: row.work_date, plate: row.plate, make: row.make, model: row.model, customer: row.customer, phone: row.phone || "", status: row.status, total: Number(row.total), items: items.filter((item) => item.work_order_id === row.id).map((item) => ({ partId: item.part_id, name: item.part_name, qty: item.quantity, price: Number(item.unit_price) })) };
}
function mapInvoice(row, items) {
  return { ...row, id: row.id, code: row.code, supplier: row.supplier, date: row.invoice_date, total: Number(row.total), status: row.status, lines: items.filter((item) => item.invoice_id === row.id).length, items: items.filter((item) => item.invoice_id === row.id).map((item) => ({ partId: item.part_id, name: item.part_name, sku: item.sku, qty: item.quantity, cost: Number(item.unit_cost) })) };
}
function mapDraft(row, items) {
  return { ...row, id: row.id, code: row.code, date: row.created_at.slice(0, 10), status: "Taslak", items: items.filter((item) => item.draft_id === row.id).map((item) => ({ partId: item.part_id, name: item.part_name, sku: item.sku, qty: item.quantity, cost: Number(item.unit_cost) })) };
}

export async function fetchServiceData() {
  const db = client();
  const [partsResult, jobsResult, jobItemsResult, invoicesResult, invoiceItemsResult, draftsResult, draftItemsResult] = await Promise.all([
    db.from("parts").select("*").order("name"),
    db.from("work_orders").select("*").order("created_at", { ascending: false }),
    db.from("work_order_items").select("*"),
    db.from("purchase_invoices").select("*").order("created_at", { ascending: false }),
    db.from("purchase_invoice_items").select("*"),
    db.from("draft_orders").select("*").eq("status", "draft").order("created_at", { ascending: false }),
    db.from("draft_order_items").select("*"),
  ]);
  const parts = unwrap(partsResult).map(mapPart);
  const jobItems = unwrap(jobItemsResult);
  const invoiceItems = unwrap(invoiceItemsResult);
  const draftItems = unwrap(draftItemsResult);
  return {
    parts,
    jobs: unwrap(jobsResult).map((job) => mapJob(job, jobItems)),
    invoices: unwrap(invoicesResult).map((invoice) => mapInvoice(invoice, invoiceItems)),
    drafts: unwrap(draftsResult).map((draft) => mapDraft(draft, draftItems)),
  };
}

export async function savePart(part, userId) {
  const db = client();
  const values = {
    sku: part.sku, name: part.name, category: part.category, brand: part.brand,
    stock: part.stock, minimum_stock: part.minimum, price: part.price, cost: part.cost,
  };
  const result = part.id
    ? await db.from("parts").update(values).eq("id", part.id).select().single()
    : await db.from("parts").insert({ ...values, user_id: userId }).select().single();
  return mapPart(unwrap(result));
}

export async function deletePart(partId) {
  unwrap(await client().from("parts").delete().eq("id", partId));
}

export async function createWorkOrder(job) {
  return unwrap(await client().rpc("create_work_order", {
    p_plate: job.plate, p_make: job.make, p_model: job.model, p_customer: job.customer,
    p_phone: job.phone || null, p_items: job.items.map((item) => ({ part_id: item.partId, quantity: item.qty })),
  }));
}
export async function createPurchaseInvoice(invoice) {
  return unwrap(await client().rpc("create_purchase_invoice", {
    p_supplier: invoice.supplier,
    p_items: invoice.items.map((item) => ({ part_id: item.partId, quantity: item.qty, unit_cost: item.cost })),
  }));
}
export async function createStockDraft() {
  return unwrap(await client().rpc("create_stock_draft"));
}
export async function receiveStockDraft(draftId) {
  return unwrap(await client().rpc("receive_stock_draft", { p_draft_id: draftId }));
}

export function subscribeToServiceData(onChange) {
  const db = client();
  const channel = db.channel(`service-data-${crypto.randomUUID()}`);
  ["parts", "work_orders", "work_order_items", "purchase_invoices", "purchase_invoice_items", "draft_orders", "draft_order_items"].forEach((table) => {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, onChange);
  });
  channel.subscribe();
  return () => { db.removeChannel(channel); };
}
