import React, { useState } from "react";
import { Button, Field, Modal } from "./kit.jsx";
import { useApp } from "./context.js";

export function ItemForm({ item, onClose, prefill }) {
  const { store, run, data } = useApp();
  const isNew = !item;
  const base = item || prefill || {};
  const [form, setForm] = useState({
    sku: base.sku || "",
    name: base.name || "",
    category: base.category || "",
    brand: base.brand || "",
    unit: base.unit || "adet",
    location: base.location || "",
    minimum: base.minimum ?? 1,
    cost: base.cost ?? "",
    price: base.price ?? "",
  });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const categories = [...new Set(data.items.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr"));
  const brands = [...new Set(data.items.map((i) => i.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr"));

  const submit = async (e) => {
    e.preventDefault();
    const ok = await run(() => store.saveItem({ ...form, id: item?.id }, { isNew }), isNew ? "Stok kartı oluşturuldu." : "Stok kartı güncellendi.");
    if (ok !== false) onClose();
  };

  return (
    <Modal
      title={isNew ? "Yeni stok kartı" : "Stok kartını düzenle"}
      subtitle={isNew ? "Stok miktarı alış faturası, sayım veya düzeltme ile girilir." : `${item.sku} · stok ${item.stock} ${item.unit}`}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Vazgeç</Button><Button variant="primary" icon="check" type="submit" form="item-form">Kaydet</Button></>}
    >
      <form id="item-form" className="form-grid" onSubmit={submit}>
        <Field label="Stok kodu *"><input value={form.sku} onChange={set("sku")} required disabled={!isNew} placeholder="Örn. 1609414480" autoFocus={isNew} /></Field>
        <Field label="Parça adı *"><input value={form.name} onChange={set("name")} required placeholder="Örn. Yağ filtresi 1.5 BlueHDi" /></Field>
        <Field label="Kategori"><input value={form.category} onChange={set("category")} list="cat-list" placeholder="Filtre, Fren, Sıvı…" /><datalist id="cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Marka"><input value={form.brand} onChange={set("brand")} list="brand-list" placeholder="Peugeot, Bosch…" /><datalist id="brand-list">{brands.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Birim"><select value={form.unit} onChange={set("unit")}><option value="adet">Adet</option><option value="lt">Litre</option></select></Field>
        <Field label="Raf / konum"><input value={form.location} onChange={set("location")} placeholder="A-3" /></Field>
        <Field label="Kritik seviye" hint="Stok bu değere inince kritik sayılır."><input type="number" min="0" step="any" value={form.minimum} onChange={set("minimum")} /></Field>
        <Field label="Satış fiyatı (KDV hariç)"><input type="number" min="0" step="0.01" value={form.price} onChange={set("price")} placeholder="Boş bırakılabilir" /></Field>
        {isNew ? <Field label="Başlangıç maliyeti (KDV hariç)" hint="Alış faturası geldiğinde ortalama maliyet otomatik güncellenir."><input type="number" min="0" step="0.01" value={form.cost} onChange={set("cost")} /></Field> : null}
      </form>
    </Modal>
  );
}
