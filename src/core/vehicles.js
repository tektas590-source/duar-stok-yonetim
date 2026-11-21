// Araç – parça uyumluluk hafızası. Satışlardan otomatik çıkarılır: her satış
// belgesinin aracı (marka/model, plaka, şase no) ile o belgede kullanılan
// parçalar eşleştirilir. Kullanıcının elle eklediği uyumluluklar (item.fits)
// da birleştirilir.
import { looseKey, round } from "./format.js";

// Şase numarasının ilk 3 hanesi (WMI) → marka. Atölyede sık görülenler.
const WMI = {
  VF3: "PEUGEOT", VR3: "PEUGEOT", VF7: "CITROEN", VR7: "CITROEN", VR1: "DS", VF1: "RENAULT", VF6: "RENAULT", UU1: "DACIA",
  ZFA: "FIAT", ZFC: "FIAT", NM4: "FIAT", W0L: "OPEL", W0V: "OPEL", VXK: "OPEL", WVW: "VOLKSWAGEN", WV1: "VOLKSWAGEN", WV2: "VOLKSWAGEN",
  WAU: "AUDI", TMB: "SKODA", VSS: "SEAT", WBA: "BMW", WDD: "MERCEDES", WDB: "MERCEDES", NMT: "TOYOTA", JTD: "TOYOTA", SB1: "TOYOTA",
  NLH: "HYUNDAI", KMH: "HYUNDAI", TMA: "HYUNDAI", KNA: "KIA", KNE: "KIA", JHM: "HONDA", NLA: "HONDA", SHH: "HONDA", JN1: "NISSAN", SJN: "NISSAN",
  WF0: "FORD", NM0: "FORD", JMZ: "MAZDA", JS3: "SUZUKI", TSM: "SUZUKI", YV1: "VOLVO", LSJ: "MG", VNK: "TOYOTA",
};
const BRANDS = ["PEUGEOT", "CITROEN", "CITROËN", "DS", "RENAULT", "DACIA", "FIAT", "OPEL", "VOLKSWAGEN", "VW", "AUDI", "SKODA", "SEAT", "BMW", "MERCEDES", "TOYOTA", "HYUNDAI", "KIA", "HONDA", "NISSAN", "FORD", "MAZDA", "SUZUKI", "VOLVO", "MG", "CHERY", "TOGG", "JEEP", "ALFA ROMEO", "MINI", "TESLA"];
const ALIAS = { VW: "VOLKSWAGEN", "CITROËN": "CITROEN" };

const up = (s) => String(s || "").trim().replace(/\s+/g, " ").toLocaleUpperCase("tr").replace(/İ/g, "I");

export function brandFromVin(vin) {
  const v = up(vin).replace(/\s/g, "");
  return v.length >= 11 ? WMI[v.slice(0, 3)] || "" : "";
}

// "Marka Model" serbest metninden marka ve modeli ayırır.
export function splitBrandModel(text, fallbackBrand = "") {
  let model = up(text);
  let brand = "";
  for (const b of BRANDS) {
    if (model === b || model.startsWith(`${b} `)) { brand = ALIAS[b] || b; model = model.slice(b.length).trim(); break; }
  }
  return { brand: brand || up(fallbackBrand), model };
}

// eDMS satış faturası "Açıklama": "VIN / plaka / model" (bazen eksik parçalı).
export function parseVehicleNote(note) {
  const parts = String(note || "").split("/").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { vin: "", plate: "", brand: "", model: "" };
  let vin = "";
  if (/^[A-HJ-NPR-Z0-9]{11,17}$/i.test(parts[0].replace(/\s/g, ""))) vin = up(parts.shift()).replace(/\s/g, "");
  let plate = "";
  if (parts.length && /^\d{2}\s*[A-ZÇĞİÖŞÜ]{1,3}\s*\d{2,5}$/i.test(parts[0].replace(/\s+/g, " "))) plate = up(parts.shift());
  else if (vin && parts.length > 1) plate = up(parts.shift());
  const { brand, model } = splitBrandModel(parts.join(" "), brandFromVin(vin));
  return { vin, plate, brand, model };
}

export function vehicleKey(brand, model) {
  const b = up(brand);
  const m = up(model);
  if (!b && !m) return "";
  return `${b}|${m}`;
}

export function vehicleLabel(brand, model) {
  return [up(brand), up(model)].filter(Boolean).join(" ") || "Model bilinmiyor";
}

// Satış belgesindeki araç bilgisi (eski kayıtlarda yalnızca plaka olabilir).
export function docVehicle(doc, plateModels) {
  const plate = up(doc.plate);
  let brand = up(doc.brand || brandFromVin(doc.vin));
  let model = up(doc.vehicleModel);
  if (!model && plate && plateModels?.has(plate)) ({ brand, model } = plateModels.get(plate));
  return { plate, vin: up(doc.vin), brand, model };
}

// Tüm hafıza: araç modelleri → parçalar, parça → araçlar, plaka → araç.
// workorders: eDMS iş emirleri (Detay Faaliyet Raporu) — şasi, model ve kullanılan parçalar.
export function buildCompat(issues, items, workorders = []) {
  const wos = (workorders || []).filter((w) => w.brand || w.model);
  // Aynı işin satış faturası da varsa iki kez sayılmasın: iş emri tarihinden 45 gün içindeki aynı plakalı satış atlanır.
  const woPlates = new Map();
  wos.forEach((w) => { const p = up(w.plate).replace(/\s/g, ""); if (p) woPlates.set(p, [...(woPlates.get(p) || []), w.date]); });
  const dayDiff = (a, b) => (Date.parse(a) - Date.parse(b)) / 864e5;
  const coveredByWo = (d) => (woPlates.get(up(d.plate).replace(/\s/g, "")) || []).some((wd) => wd && d.date && dayDiff(d.date, wd) >= -1 && dayDiff(d.date, wd) <= 45);
  const live = (issues || []).filter((d) => !d.cancelled);
  const itemsById = new Map((items || []).map((i) => [i.id, i]));
  // Plakanın modeli bir belgede biliniyorsa aynı plakalı diğer belgelere de uygula.
  const plateModels = new Map();
  [...live].sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach((d) => {
    const plate = up(d.plate);
    const brand = up(d.brand || brandFromVin(d.vin));
    if (plate && (d.vehicleModel || brand)) plateModels.set(plate, { brand, model: up(d.vehicleModel) });
  });
  wos.forEach((w) => { const plate = up(w.plate); if (plate) { plateModels.set(plate, { brand: up(w.brand), model: up(w.model) }); plateModels.set(plate.replace(/\s/g, ""), { brand: up(w.brand), model: up(w.model) }); } });
  const vehicles = new Map();
  const byPart = new Map();
  const plates = new Map();
  const touch = (v, key) => {
    if (!vehicles.has(key)) vehicles.set(key, { key, brand: v.brand, model: v.model, label: vehicleLabel(v.brand, v.model), plates: new Set(), vins: new Set(), customers: new Set(), bodies: new Set(), years: new Set(), services: 0, lastDate: "", parts: new Map(), jobs: new Map() });
    return vehicles.get(key);
  };
  const addPart = (veh, part, date, source) => {
    const pk = part.itemId || `x_${looseKey(part.sku)}`;
    const row = veh.parts.get(pk) || { itemId: part.itemId || null, sku: part.sku, name: part.name, qty: 0, times: 0, lastDate: "", lastPrice: null, sources: new Set() };
    row.qty = round(row.qty + (Number(part.qty) || 0), 3);
    if (source === "satış" || source === "iş emri") row.times += 1;
    if (date && date >= row.lastDate) { row.lastDate = date; if (part.unitPrice) row.lastPrice = part.unitPrice; }
    row.sources.add(source);
    veh.parts.set(pk, row);
    const list = byPart.get(pk) || new Set();
    list.add(veh.key);
    byPart.set(pk, list);
  };
  // eDMS iş emirleri: araç modeli ve şasi kesin; parçalar ve yapılan işler hafızaya girer.
  wos.forEach((w) => {
    const brand = up(w.brand);
    const model = up(w.model);
    const key = vehicleKey(brand, model);
    const veh = touch({ brand, model }, key);
    const plate = up(w.plate);
    if (plate) { veh.plates.add(plate); plates.set(plate, key); }
    if (w.vin) veh.vins.add(up(w.vin));
    if (w.customer) veh.customers.add(w.customer);
    if (w.body) veh.bodies.add(up(w.body));
    if (w.year) veh.years.add(String(w.year));
    veh.services += 1;
    if (String(w.date) > veh.lastDate) veh.lastDate = String(w.date);
    (w.lines || []).forEach((l) => {
      if (l.kind === "job") {
        const j = veh.jobs.get(l.name) || { name: l.name, code: l.code, times: 0, lastLabor: 0, lastDate: "" };
        j.times += 1;
        if (String(w.date) >= j.lastDate) { j.lastDate = String(w.date); j.lastLabor = l.labor; }
        veh.jobs.set(l.name, j);
        return;
      }
      const item = (items || []).find((i) => looseKey(i.sku) === looseKey(l.code));
      const unit = l.qty ? (Number(l.parts) || Number(l.total) || 0) / l.qty : 0;
      addPart(veh, { itemId: item?.id || null, sku: item?.sku || l.code, name: item?.name || l.name, qty: l.qty, unitPrice: unit ? round(unit, 2) : null }, w.date, "iş emri");
    });
  });
  live.forEach((d) => {
    if (coveredByWo(d)) return;
    const v = docVehicle(d, plateModels);
    const key = vehicleKey(v.brand, v.model) || (v.plate ? `PLAKA|${v.plate}` : "");
    if (!key) return;
    const veh = touch(v.model || v.brand ? v : { brand: "", model: "" }, key);
    if (!v.model && !v.brand) veh.label = `${v.plate} (model bilinmiyor)`;
    if (v.plate) { veh.plates.add(v.plate); plates.set(v.plate, key); }
    if (v.vin) veh.vins.add(v.vin);
    if (d.customer) veh.customers.add(d.customer);
    veh.services += 1;
    if (String(d.date) > veh.lastDate) veh.lastDate = String(d.date);
    d.lines.forEach((l) => addPart(veh, { itemId: l.itemId, sku: l.sku, name: l.name, qty: l.qty, unitPrice: l.unitPrice }, d.date, "satış"));
    (d.services || []).filter((s) => s.kind === "part" && s.code).forEach((s) => {
      const item = (items || []).find((i) => looseKey(i.sku) === looseKey(s.code));
      addPart(veh, { itemId: item?.id || null, sku: item?.sku || s.code, name: (item?.name || s.name).replace(/\s*\(stokta yoktu\)$/, ""), qty: s.qty, unitPrice: s.unitPrice }, d.date, "satış");
    });
  });
  // Elle eklenen uyumluluklar.
  (items || []).forEach((item) => (item.fits || []).forEach((f) => {
    const { brand, model } = splitBrandModel(f.model ? `${f.brand || ""} ${f.model}` : f, f.brand);
    const key = vehicleKey(brand, model);
    if (!key) return;
    const veh = touch({ brand, model }, key);
    addPart(veh, { itemId: item.id, sku: item.sku, name: item.name, qty: 0 }, "", "elle");
  }));
  return { vehicles, byPart, plates, plateModels, itemsById };
}

// Arama: model, marka, plaka, şase no veya parça. Sonuç: eşleşen araçlar.
export function searchVehicles(compat, query) {
  const q = up(query);
  const list = [...compat.vehicles.values()];
  if (!q) return list.sort((a, b) => b.services - a.services || b.lastDate.localeCompare(a.lastDate));
  const qLoose = looseKey(q);
  const words = q.split(" ").filter(Boolean);
  return list.filter((v) => {
    const hay = `${v.label} ${[...(v.bodies || [])].join(" ")} ${[...(v.years || [])].join(" ")} ${[...v.plates].join(" ")} ${[...v.vins].join(" ")} ${[...v.customers].join(" ")}`.toLocaleUpperCase("tr").replace(/İ/g, "I");
    return words.every((w) => hay.includes(w)) || [...v.plates, ...v.vins].some((p) => qLoose.length >= 3 && looseKey(p).includes(qLoose));
  }).sort((a, b) => b.services - a.services);
}

export function vehicleParts(veh, itemsById) {
  return [...veh.parts.values()].map((p) => {
    const item = p.itemId ? itemsById.get(p.itemId) : null;
    return { ...p, item, stock: item ? Number(item.stock) || 0 : null, sources: [...p.sources] };
  }).sort((a, b) => b.times - a.times || b.lastDate.localeCompare(a.lastDate));
}

export function partVehicles(compat, itemId) {
  return [...(compat.byPart.get(itemId) || [])].map((k) => compat.vehicles.get(k)).filter(Boolean).sort((a, b) => b.services - a.services);
}
