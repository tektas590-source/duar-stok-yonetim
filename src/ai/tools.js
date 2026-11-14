// Asistanın kullandığı salt-okunur veri araçları. Uygulamanın canlı verisi
// üzerinde çalışır; sonuçları modele kısa JSON olarak döner.
import { level, LEVEL_LABEL, summarize, usageMap, reorderSuggestions } from "../core/stock.js";
import { looseKey, round, skuKey, todayKey } from "../core/format.js";
import { MOVE_LABEL } from "../core/ledger.js";
import { buildCompat } from "../core/vehicles.js";
import { buildPricing } from "../core/pricing.js";

const DAY = 86400000;
const r2 = (v) => round(Number(v) || 0, 2);

function range(from, to) {
  const end = to || todayKey();
  const start = from || `${end.slice(0, 7)}-01`;
  return [start, end];
}
const inRange = (d, [a, b]) => String(d.date) >= a && String(d.date) <= b;
const live = (docs) => (docs || []).filter((d) => !d.cancelled);

function itemBrief(item, usage) {
  const u = usage?.get(item.id);
  return {
    sku: item.sku, ad: item.name, stok: Number(item.stock) || 0, birim: item.unit, kritik: Number(item.minimum) || 0,
    durum: LEVEL_LABEL[level(item)], ortMaliyet: r2(item.cost), sonAlis: r2(item.lastCost), satisFiyati: item.price ?? null,
    stokDegeri: r2(Math.max(0, Number(item.stock) || 0) * (Number(item.cost) || 0)), raf: item.location || null,
    kategori: item.category || null, marka: item.brand || null,
    ...(u ? { gun90Cikis: u.used, kacGunYeter: u.cover } : {}),
  };
}

function findItems(items, query, limit = 15) {
  const n = String(query || "").trim().toLocaleLowerCase("tr");
  const l = looseKey(query);
  if (!n) return [];
  const exact = items.filter((i) => skuKey(i.sku) === skuKey(query) || (l.length >= 3 && looseKey(i.sku) === l));
  if (exact.length) return exact;
  const words = n.split(/\s+/).filter(Boolean);
  return items.filter((i) => {
    const hay = `${i.sku} ${i.name} ${i.category || ""} ${i.brand || ""} ${i.location || ""}`.toLocaleLowerCase("tr");
    return words.every((w) => hay.includes(w)) || (l.length >= 3 && looseKey(i.sku).includes(l));
  }).slice(0, limit);
}

function salesAgg(issues, rng) {
  const docs = live(issues).filter((d) => inRange(d, rng));
  const t = { belge: docs.length, ciroKdvHaric: 0, parcaSatisi: 0, iscilik: 0, kartsizParca: 0, kdv: 0, ciroKdvDahil: 0, parcaMaliyeti: 0, brutKar: 0 };
  docs.forEach((d) => {
    t.ciroKdvHaric += d.totals.net; t.iscilik += d.totals.laborNet || 0; t.kartsizParca += d.totals.otherNet || 0;
    t.parcaSatisi += d.totals.partsNet ?? d.totals.net; t.kdv += d.totals.vat; t.ciroKdvDahil += d.totals.gross;
    t.parcaMaliyeti += d.totals.cost || 0; t.brutKar += d.totals.profit || 0;
  });
  Object.keys(t).forEach((k) => { if (k !== "belge") t[k] = r2(t[k]); });
  t.karMarji = t.ciroKdvHaric ? `%${Math.round((t.brutKar / t.ciroKdvHaric) * 100)}` : null;
  return { t, docs };
}


// ---- Esnek sorgu motoru: modelin önceden tanımlanmamış her soruyu verinin
// kendisi üzerinde süzüp gruplayarak yanıtlayabilmesi için. ----
function datasets(data, usage) {
  const items = (data.items || []).filter((i) => !i.archived);
  const sales = live(data.issues);
  const buys = live(data.invoices);
  return {
    parcalar: () => {
      const pr = buildPricing(items, data.invoices, data.issues);
      return items.map((i) => { const p = pr.get(i.id); return { ...itemBrief(i, usage), sonAlisTarihi: p?.lastBuy?.date || null, sonAlisTedarikci: p?.lastBuy?.supplier || null, alisDegisimYuzde: p?.costChangePct ?? null, sonSatisFiyati: p?.lastSale ? r2(p.lastSale.unit) : null, sonSatisTarihi: p?.lastSale?.date || null, onerilenFiyat: p?.suggested ?? null, onerilenKdvDahil: p?.suggestedGross ?? null, hedefKarYuzde: p?.markup ?? null, fiyatGuncellenmeli: Boolean(p?.needsUpdate) }; });
    },
    satis_belgeleri: () => sales.map((d) => ({ no: d.no, tarih: d.date, ay: String(d.date).slice(0, 7), musteri: d.customer || "Tezgah", plaka: d.plate || null, arac: [d.brand, d.vehicleModel].filter(Boolean).join(" ") || null, sase: d.vin || null, kaynak: d.source || null, ciro: r2(d.totals.net), parca: r2(d.totals.partsNet ?? d.totals.net), iscilik: r2(d.totals.laborNet || 0), kartsizParca: r2(d.totals.otherNet || 0), kdvDahil: r2(d.totals.gross), maliyet: r2(d.totals.cost || 0), kar: r2(d.totals.profit || 0), kalemSayisi: d.lines.length })),
    satis_kalemleri: () => sales.flatMap((d) => d.lines.map((l) => ({ tarih: d.date, ay: String(d.date).slice(0, 7), belge: d.no, musteri: d.customer || "Tezgah", plaka: d.plate || null, sku: l.sku, ad: l.name, adet: r2(l.qty), birimFiyat: r2(l.unitPrice), iskonto: l.discountPct || 0, net: r2(l.net), maliyet: r2(l.cost || 0), kar: r2(l.net - (l.cost || 0)) }))),
    iscilikler: () => sales.flatMap((d) => (d.services || []).map((l) => ({ tarih: d.date, ay: String(d.date).slice(0, 7), belge: d.no, musteri: d.customer || "Tezgah", plaka: d.plate || null, tur: l.kind === "labor" ? "işçilik" : "kartsız parça", kod: l.code || null, ad: l.name, adet: r2(l.qty), net: r2(l.net) }))),
    alis_faturalari: () => buys.map((d) => ({ no: d.no, tarih: d.date, ay: String(d.date).slice(0, 7), tedarikci: d.supplier, kdvHaric: r2(d.totals.net), kdv: r2(d.totals.vat), kdvDahil: r2(d.totals.gross), kalemSayisi: d.lines.length, edmsTutari: d.edmsGross ?? null })),
    alis_kalemleri: () => buys.flatMap((d) => d.lines.map((l) => ({ tarih: d.date, ay: String(d.date).slice(0, 7), fatura: d.no, tedarikci: d.supplier, sku: l.sku, ad: l.name, adet: r2(l.qty), birimFiyat: r2(l.unitPrice), iskonto: l.discountPct || 0, net: r2(l.net), birimMaliyet: r2(l.qty ? l.net / l.qty : 0) }))),
    hareketler: () => (data.movements || []).map((m) => ({ tarih: m.date, ay: String(m.date).slice(0, 7), sku: m.sku, ad: m.name, islem: MOVE_LABEL[m.type] || m.type, miktar: r2(m.qty), once: m.stockBefore, sonra: m.stockAfter, belge: m.refNo || null, not: m.note || null, kullanici: m.actor || null })),
    arac_parca: () => {
      const c = buildCompat(data.issues, data.items || []);
      return [...c.vehicles.values()].flatMap((v) => [...v.parts.values()].map((p) => {
        const item = p.itemId ? c.itemsById.get(p.itemId) : null;
        return { arac: v.label, marka: v.brand || null, model: v.model || null, plakalar: [...v.plates].join(", "), sku: p.sku, ad: item?.name || p.name, kullanim: p.times, toplamAdet: r2(p.qty), sonTarih: p.lastDate || null, sonFiyat: p.lastPrice ? r2(p.lastPrice) : null, stok: item ? Number(item.stock) || 0 : null, kaynak: [...p.sources].join("+") };
      }));
    },
    iptaller: () => [...(data.invoices || []).filter((d) => d.cancelled).map((d) => ({ tur: "alış", no: d.no, tarih: d.date, kim: d.supplier, kdvHaric: r2(d.totals.net) })), ...(data.issues || []).filter((d) => d.cancelled).map((d) => ({ tur: "satış", no: d.no, tarih: d.date, kim: d.customer || "Tezgah", kdvHaric: r2(d.totals.net) }))],
  };
}

const norm = (v) => String(v ?? "").toLocaleLowerCase("tr");
const isNum = (v) => v !== null && v !== "" && v !== undefined && Number.isFinite(Number(v));

function parseFilters(text) {
  return String(text || "").split(/;|\s+ve\s+|&&/i).map((part) => part.trim()).filter(Boolean).map((part) => {
    const m = part.match(/^([\wçğıöşüÇĞİÖŞÜ]+)\s*(>=|<=|!=|=|>|<|~|!~)\s*(.*)$/);
    if (!m) throw new Error(`Filtre anlaşılamadı: "${part}". Biçim: alan=değer; alan>sayı; alan~metin`);
    return { field: m[1], op: m[2], value: m[3].trim().replace(/^["']|["']$/g, "") };
  });
}

function matches(row, f) {
  const v = row[f.field];
  if (f.op === "~") return norm(v).includes(norm(f.value)) || looseKey(v).includes(looseKey(f.value));
  if (f.op === "!~") return !norm(v).includes(norm(f.value));
  const both = isNum(v) && isNum(f.value);
  const a = both ? Number(v) : norm(v);
  const b = both ? Number(f.value) : norm(f.value === "boş" || f.value === "null" ? "" : f.value);
  switch (f.op) {
    case "=": return a === b;
    case "!=": return a !== b;
    case ">": return a > b;
    case "<": return a < b;
    case ">=": return a >= b;
    default: return a <= b;
  }
}

export function queryData(args, data, now = Date.now()) {
  const items = (data.items || []).filter((i) => !i.archived);
  const sets = datasets(data, usageMap(items, data.movements, { now }));
  const name = String(args.koleksiyon || "").trim();
  if (!sets[name]) return { hata: `Koleksiyon yok: ${name}`, koleksiyonlar: Object.keys(sets) };
  let rows = sets[name]();
  const fields = rows.length ? Object.keys(rows[0]) : [];
  const filters = parseFilters(args.filtre);
  const bad = filters.find((f) => rows.length && !fields.includes(f.field));
  if (bad) return { hata: `"${bad.field}" alanı ${name} içinde yok`, alanlar: fields };
  if (args.baslangic) rows = rows.filter((r) => !r.tarih || String(r.tarih) >= args.baslangic);
  if (args.bitis) rows = rows.filter((r) => !r.tarih || String(r.tarih) <= args.bitis);
  if (args.ara) {
    const words = norm(args.ara).split(/\s+/).filter(Boolean);
    rows = rows.filter((r) => { const hay = norm(Object.values(r).join(" ")); const lk = looseKey(Object.values(r).join(" ")); return words.every((w) => hay.includes(w) || lk.includes(looseKey(w))); });
  }
  rows = rows.filter((r) => filters.every((f) => matches(r, f)));
  const numeric = fields.filter((k) => rows.some((r) => typeof r[k] === "number") && !["once", "sonra", "kritik", "iskonto", "kalemSayisi"].includes(k));
  const sumFields = args.topla ? String(args.topla).split(",").map((x) => x.trim()).filter((k) => fields.includes(k)) : numeric;
  const totals = Object.fromEntries(sumFields.map((k) => [k, r2(rows.reduce((x, r) => x + (Number(r[k]) || 0), 0))]));
  const limit = Math.min(150, Math.max(1, Number(args.limit) || 30));
  const [sortKey, sortDir] = String(args.sirala || "").trim().split(/\s+/);
  const desc = !/^(asc|artan|kucukten)/i.test(sortDir || "");
  const sorter = (k) => (x, y) => {
    const a = x[k]; const b = y[k];
    const c = isNum(a) && isNum(b) ? Number(a) - Number(b) : norm(a).localeCompare(norm(b), "tr");
    return desc ? -c : c;
  };
  if (args.grupla) {
    const keys = String(args.grupla).split(",").map((x) => x.trim());
    const badKey = keys.find((k) => !fields.includes(k));
    if (badKey && rows.length) return { hata: `"${badKey}" ile gruplanamaz`, alanlar: fields };
    const groups = new Map();
    rows.forEach((r) => {
      const id = keys.map((k) => r[k] ?? "—").join(" | ");
      const g = groups.get(id) || { ...Object.fromEntries(keys.map((k) => [k, r[k] ?? "—"])), kayit: 0, ...Object.fromEntries(sumFields.map((k) => [k, 0])) };
      g.kayit += 1; sumFields.forEach((k) => { g[k] += Number(r[k]) || 0; });
      groups.set(id, g);
    });
    let list = [...groups.values()].map((g) => { sumFields.forEach((k) => { g[k] = r2(g[k]); }); return g; });
    const k = sortKey && (sortKey === "kayit" || sumFields.includes(sortKey) || keys.includes(sortKey)) ? sortKey : (sumFields.includes("net") ? "net" : sumFields.includes("ciro") ? "ciro" : "kayit");
    list = list.sort(sorter(k));
    return { koleksiyon: name, eslesenKayit: rows.length, grupSayisi: list.length, toplamlar: totals, gruplar: list.slice(0, limit), ...(list.length > limit ? { not: `İlk ${limit} grup gösterildi` } : {}) };
  }
  if (sortKey && fields.includes(sortKey)) rows = [...rows].sort(sorter(sortKey));
  const pick = args.alanlar ? String(args.alanlar).split(",").map((x) => x.trim()).filter((k) => fields.includes(k)) : null;
  const shown = rows.slice(0, limit).map((r) => (pick?.length ? Object.fromEntries(pick.map((k) => [k, r[k]])) : r));
  return { koleksiyon: name, eslesenKayit: rows.length, toplamlar: totals, kayitlar: shown, ...(rows.length > limit ? { not: `${rows.length} kayıttan ilk ${limit} tanesi gösterildi; daha fazlası için grupla veya filtre kullan` } : {}) };
}

export const COLLECTION_FIELDS = {
  parcalar: "sku, ad, stok, birim, kritik, durum (Tükendi/Kritik/Azalıyor/Yeterli), ortMaliyet, sonAlis (birim alış), sonAlisTarihi, sonAlisTedarikci, alisDegisimYuzde (önceki alışa göre), sonSatisFiyati, sonSatisTarihi, onerilenFiyat (güncel alışa göre, KDV hariç), onerilenKdvDahil, hedefKarYuzde, fiyatGuncellenmeli (true/false), satisFiyati, stokDegeri, raf, kategori, marka, gun90Cikis, kacGunYeter",
  satis_belgeleri: "no, tarih, ay, musteri, plaka, arac (marka model), sase, kaynak, ciro (KDV hariç), parca, iscilik, kartsizParca, kdvDahil, maliyet, kar, kalemSayisi",
  satis_kalemleri: "tarih, ay, belge, musteri, plaka, sku, ad, adet, birimFiyat, iskonto, net, maliyet, kar",
  iscilikler: "tarih, ay, belge, musteri, plaka, tur (işçilik/kartsız parça), kod, ad, adet, net",
  alis_faturalari: "no, tarih, ay, tedarikci, kdvHaric, kdv, kdvDahil, kalemSayisi, edmsTutari",
  alis_kalemleri: "tarih, ay, fatura, tedarikci, sku, ad, adet, birimFiyat, iskonto, net, birimMaliyet",
  hareketler: "tarih, ay, sku, ad, islem (Alış faturası / Satış / çıkış / Düzeltme / Sayım / İptal…), miktar, once, sonra, belge, not, kullanici",
  arac_parca: "Araç–parça uyumluluk hafızası (satışlardan otomatik + elle eklenen): arac, marka, model, plakalar, sku, ad, kullanim (kaç satış), toplamAdet, sonTarih, sonFiyat, stok, kaynak (satış/elle)",
  iptaller: "tur, no, tarih, kim, kdvHaric",
};

export const TOOL_SPECS = [
  { name: "veri_sorgula", description: `Uygulamadaki TÜM veride esnek sorgu: herhangi bir soruyu süzme, gruplama, toplama ve sıralamayla yanıtla. Diğer araçların kapsamadığı her soru için bunu kullan. Koleksiyonlar ve alanları:\n${Object.entries(COLLECTION_FIELDS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`, params: { koleksiyon: { type: "string", description: Object.keys(COLLECTION_FIELDS).join(", ") }, filtre: { type: "string", description: "Noktalı virgülle koşullar. İşleçler = != > < >= <= ~ (içerir) !~ (içermez). Ör: 'stok>0; marka~fiat' veya 'musteri~ahmet; iscilik>1000'" }, ara: { type: "string", description: "Tüm alanlarda serbest metin araması" }, baslangic: { type: "string", description: "YYYY-AA-GG" }, bitis: { type: "string", description: "YYYY-AA-GG" }, grupla: { type: "string", description: "Gruplanacak alan(lar), virgülle. Ör: 'ay', 'tedarikci', 'musteri', 'sku,ad'" }, topla: { type: "string", description: "Toplanacak sayısal alanlar, virgülle (boşsa hepsi)" }, sirala: { type: "string", description: "'alan desc' veya 'alan asc'" }, alanlar: { type: "string", description: "Sadece bu alanları döndür, virgülle" }, limit: { type: "number", description: "En fazla kaç satır (varsayılan 30, en çok 150)" } }, required: ["koleksiyon"] },
  { name: "genel_durum", description: "Deponun ve işletmenin genel özeti: stok değeri, kart sayıları, kritik/tükenen sayısı, bu ayın cirosu, işçilik, kâr ve alışları.", params: {} },
  { name: "parca_ara", description: "Stok kodu, parça adı, marka, kategori veya raf ile parça arar; stok, maliyet, fiyat ve durumunu verir.", params: { sorgu: { type: "string", description: "Stok kodu veya parça adından kelimeler" } }, required: ["sorgu"] },
  { name: "parca_detay", description: "Tek bir parçanın tüm detayı: stok, maliyet, son hareketler, alış geçmişi, satışları, kaç gün yeteceği.", params: { sku: { type: "string", description: "Stok kodu" } }, required: ["sku"] },
  { name: "kritik_stoklar", description: "Tükenen ve kritik seviyedeki parçalar ile sipariş önerileri.", params: {} },
  { name: "satis_raporu", description: "Tarih aralığında satış/ciro raporu: parça satışı, işçilik, KDV, maliyet, brüt kâr, en çok satanlar, müşteriler. Tarih yoksa bu ay.", params: { baslangic: { type: "string", description: "YYYY-AA-GG" }, bitis: { type: "string", description: "YYYY-AA-GG" } } },
  { name: "alis_raporu", description: "Tarih aralığında alış faturaları raporu: toplam, tedarikçilere göre dağılım, en çok alınan parçalar. Tarih yoksa bu ay.", params: { baslangic: { type: "string", description: "YYYY-AA-GG" }, bitis: { type: "string", description: "YYYY-AA-GG" } } },
  { name: "belge_ara", description: "Alış faturası veya satış belgesi arar (belge no, müşteri, plaka, tedarikçi, stok kodu, işçilik adı). Belge kalemlerini döner.", params: { sorgu: { type: "string", description: "Aranacak metin" }, tur: { type: "string", description: "alis, satis veya hepsi" } }, required: ["sorgu"] },
  { name: "hareketler", description: "Stok hareketleri (giriş, çıkış, düzeltme, sayım, iptal). Parça, tür ve tarihe göre süzülebilir.", params: { sku: { type: "string", description: "İsteğe bağlı stok kodu" }, tur: { type: "string", description: "alis, satis, duzeltme, sayim, iptal" }, baslangic: { type: "string", description: "YYYY-AA-GG" }, bitis: { type: "string", description: "YYYY-AA-GG" } } },
  { name: "en_cok_satanlar", description: "Tarih aralığında ciroya, adede veya kâra göre en çok satan parçalar ve en çok yapılan işçilikler.", params: { olcu: { type: "string", description: "ciro, adet veya kar" }, baslangic: { type: "string", description: "YYYY-AA-GG" }, bitis: { type: "string", description: "YYYY-AA-GG" } } },
  { name: "olu_stok", description: "Stokta olup belirli gün sayısıdır hiç satılmayan (ölü) parçalar ve bağlı sermaye.", params: { gun: { type: "number", description: "Gün sayısı, varsayılan 90" } } },
  { name: "kategori_dagilimi", description: "Stok değerinin kategori ve markalara göre dağılımı.", params: {} },
];

const MOVE_KEYS = { alis: "purchase", satis: "issue", duzeltme: "adjust", sayim: "count", iptal: "reversal" };

export function runTool(name, args, data, now = Date.now()) {
  const items = (data.items || []).filter((i) => !i.archived);
  const usage = usageMap(items, data.movements, { now });
  const a = args || {};
  switch (name) {
    case "genel_durum": {
      const s = summarize(items);
      const month = [`${todayKey(new Date(now)).slice(0, 7)}-01`, todayKey(new Date(now))];
      const sales = salesAgg(data.issues, month).t;
      const purchases = live(data.invoices).filter((d) => inRange(d, month));
      return {
        bugun: todayKey(new Date(now)),
        stok: { kartSayisi: s.total, rafdakiBirim: s.units, stokDegeriMaliyet: s.costValue, satisKarsiligi: s.saleValue, fiyatsizKart: s.noPrice, tukenen: s.out, kritik: s.critical, azalan: s.low, yeterli: s.good, stokSagligi: `%${s.health}` },
        buAySatis: sales,
        buAyAlis: { fatura: purchases.length, kdvHaric: r2(purchases.reduce((x, d) => x + d.totals.net, 0)), kdvDahil: r2(purchases.reduce((x, d) => x + d.totals.gross, 0)) },
        toplamBelge: { alisFaturasi: live(data.invoices).length, satisBelgesi: live(data.issues).length, hareket: (data.movements || []).length },
      };
    }
    case "parca_ara": {
      const found = findItems(items, a.sorgu, 20);
      return { bulunan: found.length, parcalar: found.map((i) => itemBrief(i, usage)) };
    }
    case "parca_detay": {
      const [item] = findItems(items, a.sku, 1);
      if (!item) return { hata: `${a.sku} bulunamadı` };
      const moves = (data.movements || []).filter((m) => m.itemId === item.id);
      const buys = live(data.invoices).flatMap((d) => d.lines.filter((l) => l.itemId === item.id).map((l) => ({ tarih: d.date, fatura: d.no, tedarikci: d.supplier, adet: l.qty, birimMaliyet: r2(l.net / l.qty) })));
      const sells = live(data.issues).flatMap((d) => d.lines.filter((l) => l.itemId === item.id).map((l) => ({ tarih: d.date, belge: d.no, musteri: d.customer || null, plaka: d.plate || null, adet: l.qty, birimFiyat: r2(l.unitPrice), net: r2(l.net) })));
      return {
        parca: itemBrief(item, usage),
        sonHareketler: moves.slice(0, 12).map((m) => ({ tarih: m.date, islem: MOVE_LABEL[m.type], miktar: m.qty, sonrakiStok: m.stockAfter, belge: m.refNo || m.note || null, kullanici: m.actor })),
        alislar: buys.slice(0, 10), toplamAlinan: r2(buys.reduce((x, b) => x + b.adet, 0)),
        satislar: sells.slice(0, 10), toplamSatilan: r2(sells.reduce((x, b) => x + b.adet, 0)), satisCirosu: r2(sells.reduce((x, b) => x + b.net, 0)),
      };
    }
    case "kritik_stoklar": {
      const sugg = reorderSuggestions(items, usage);
      return { adet: sugg.length, tahminiSiparisTutari: r2(sugg.reduce((x, s) => x + s.value, 0)), parcalar: sugg.slice(0, 40).map((s) => ({ sku: s.item.sku, ad: s.item.name, stok: s.stock, kritik: s.item.minimum, durum: LEVEL_LABEL[level(s.item)], onerilenSiparis: s.suggest, sonAlis: r2(s.item.lastCost || s.item.cost), tutar: s.value })) };
    }
    case "satis_raporu": {
      const rng = range(a.baslangic, a.bitis);
      const { t, docs } = salesAgg(data.issues, rng);
      const byCustomer = new Map();
      docs.forEach((d) => { const k = d.customer || "Tezgah"; const c = byCustomer.get(k) || { musteri: k, belge: 0, ciro: 0 }; c.belge += 1; c.ciro += d.totals.net; byCustomer.set(k, c); });
      return {
        donem: { baslangic: rng[0], bitis: rng[1] }, ...t,
        musteriler: [...byCustomer.values()].sort((x, y) => y.ciro - x.ciro).slice(0, 10).map((c) => ({ ...c, ciro: r2(c.ciro) })),
        enCokSatanlar: runTool("en_cok_satanlar", { olcu: "ciro", baslangic: rng[0], bitis: rng[1] }, data, now).parcalar.slice(0, 8),
        sonBelgeler: docs.slice(0, 8).map((d) => ({ no: d.no, tarih: d.date, musteri: d.customer || null, plaka: d.plate || null, ciro: r2(d.totals.net), iscilik: r2(d.totals.laborNet || 0), kar: r2(d.totals.profit) })),
      };
    }
    case "alis_raporu": {
      const rng = range(a.baslangic, a.bitis);
      const docs = live(data.invoices).filter((d) => inRange(d, rng));
      const bySup = new Map(); const byItem = new Map();
      docs.forEach((d) => {
        const s = bySup.get(d.supplier) || { tedarikci: d.supplier, fatura: 0, kdvHaric: 0 }; s.fatura += 1; s.kdvHaric += d.totals.net; bySup.set(d.supplier, s);
        d.lines.forEach((l) => { const x = byItem.get(l.sku) || { sku: l.sku, ad: l.name, adet: 0, tutar: 0 }; x.adet += l.qty; x.tutar += l.net; byItem.set(l.sku, x); });
      });
      return {
        donem: { baslangic: rng[0], bitis: rng[1] }, fatura: docs.length,
        kdvHaric: r2(docs.reduce((x, d) => x + d.totals.net, 0)), kdv: r2(docs.reduce((x, d) => x + d.totals.vat, 0)), kdvDahil: r2(docs.reduce((x, d) => x + d.totals.gross, 0)),
        edmsIleBirebir: docs.filter((d) => d.edmsGross !== null && d.edmsGross !== undefined && Math.abs(d.edmsGross - d.totals.gross) < 0.1).length,
        tedarikciler: [...bySup.values()].sort((x, y) => y.kdvHaric - x.kdvHaric).map((s) => ({ ...s, kdvHaric: r2(s.kdvHaric) })),
        enCokAlinan: [...byItem.values()].sort((x, y) => y.tutar - x.tutar).slice(0, 10).map((x) => ({ ...x, adet: r2(x.adet), tutar: r2(x.tutar) })),
      };
    }
    case "belge_ara": {
      const n = String(a.sorgu || "").trim().toLocaleLowerCase("tr");
      const tur = a.tur || "hepsi";
      const pick = (docs, kind) => docs.filter((d) => `${d.no} ${d.supplier || ""} ${d.customer || ""} ${d.plate || ""} ${d.lines.map((l) => `${l.sku} ${l.name}`).join(" ")} ${(d.services || []).map((l) => l.name).join(" ")}`.toLocaleLowerCase("tr").includes(n)).slice(0, 8).map((d) => ({
        tur: kind, no: d.no, tarih: d.date, iptal: Boolean(d.cancelled), kaynak: d.source, kim: d.supplier || d.customer || "Tezgah", plaka: d.plate || null,
        kdvHaric: r2(d.totals.net), kdvDahil: r2(d.totals.gross), ...(kind === "satis" ? { iscilik: r2(d.totals.laborNet || 0), kar: r2(d.totals.profit) } : {}),
        edmsTutari: d.edmsGross ?? null,
        kalemler: d.lines.map((l) => ({ sku: l.sku, ad: l.name, adet: l.qty, net: r2(l.net) })), iscilikler: (d.services || []).map((l) => ({ ad: l.name, tur: l.kind === "labor" ? "işçilik" : "kartsız parça", net: r2(l.net) })),
      }));
      return { sonuc: [...(tur !== "satis" ? pick(data.invoices || [], "alis") : []), ...(tur !== "alis" ? pick(data.issues || [], "satis") : [])] };
    }
    case "hareketler": {
      const [item] = a.sku ? findItems(items, a.sku, 1) : [null];
      const type = MOVE_KEYS[a.tur] || null;
      const from = a.baslangic || "", to = a.bitis || "9999";
      const list = (data.movements || []).filter((m) => (!item || m.itemId === item.id) && (!type || m.type === type) && m.date >= from && m.date <= to);
      return { adet: list.length, toplamGiris: r2(list.filter((m) => m.qty > 0).reduce((x, m) => x + m.qty, 0)), toplamCikis: r2(list.filter((m) => m.qty < 0).reduce((x, m) => x - m.qty, 0)), hareketler: list.slice(0, 30).map((m) => ({ tarih: m.date, sku: m.sku, ad: m.name, islem: MOVE_LABEL[m.type], miktar: m.qty, once: m.stockBefore, sonra: m.stockAfter, belge: m.refNo || m.note || null, kullanici: m.actor })) };
    }
    case "en_cok_satanlar": {
      const rng = range(a.baslangic, a.bitis);
      const docs = live(data.issues).filter((d) => inRange(d, rng));
      const map = new Map(); const labor = new Map();
      docs.forEach((d) => {
        d.lines.forEach((l) => { const x = map.get(l.sku) || { sku: l.sku, ad: l.name, adet: 0, ciro: 0, maliyet: 0 }; x.adet += l.qty; x.ciro += l.net; x.maliyet += l.cost || 0; map.set(l.sku, x); });
        (d.services || []).filter((l) => l.kind === "labor").forEach((l) => { const x = labor.get(l.name) || { iscilik: l.name, adet: 0, ciro: 0 }; x.adet += 1; x.ciro += l.net; labor.set(l.name, x); });
      });
      const key = a.olcu === "adet" ? "adet" : a.olcu === "kar" ? "kar" : "ciro";
      const rows = [...map.values()].map((x) => ({ ...x, adet: r2(x.adet), ciro: r2(x.ciro), kar: r2(x.ciro - x.maliyet), maliyet: undefined }));
      return { donem: { baslangic: rng[0], bitis: rng[1] }, olcu: key, parcalar: rows.sort((x, y) => y[key] - x[key]).slice(0, 15), iscilikler: [...labor.values()].sort((x, y) => y.ciro - x.ciro).slice(0, 10).map((x) => ({ ...x, ciro: r2(x.ciro) })) };
    }
    case "olu_stok": {
      const days = Number(a.gun) || 90;
      const cutoff = new Date(now - days * DAY).toISOString().slice(0, 10);
      const sold = new Set((data.movements || []).filter((m) => m.type === "issue" && m.date >= cutoff).map((m) => m.itemId));
      const dead = items.filter((i) => (Number(i.stock) || 0) > 0 && !sold.has(i.id)).map((i) => ({ sku: i.sku, ad: i.name, stok: i.stock, stokDegeri: r2(i.stock * (Number(i.cost) || 0)) })).sort((x, y) => y.stokDegeri - x.stokDegeri);
      return { gun: days, adet: dead.length, bagliSermaye: r2(dead.reduce((x, d) => x + d.stokDegeri, 0)), parcalar: dead.slice(0, 30) };
    }
    case "kategori_dagilimi": {
      const cat = new Map(); const brand = new Map();
      items.forEach((i) => { const v = Math.max(0, Number(i.stock) || 0) * (Number(i.cost) || 0); cat.set(i.category || "Kategorisiz", (cat.get(i.category || "Kategorisiz") || 0) + v); brand.set(i.brand || "Markasız", (brand.get(i.brand || "Markasız") || 0) + v); });
      const fmt = (m) => [...m.entries()].map(([k, v]) => ({ ad: k, stokDegeri: r2(v) })).sort((x, y) => y.stokDegeri - x.stokDegeri).slice(0, 15);
      return { kategoriler: fmt(cat), markalar: fmt(brand) };
    }
    case "veri_sorgula":
      return queryData(a, data, now);
    default:
      return { hata: `Bilinmeyen araç: ${name}` };
  }
}

export function systemPrompt(now = new Date()) {
  return `Sen "Duar Asistan"sın: Samsun'da bir EUROREPAR oto servisin sahibi ve çalışanlarının yanındaki akıllı yardımcı. Duar Stok Yönetim uygulamasının bütün verisine (parçalar, alış faturaları, satışlar, işçilikler, stok hareketleri, iptaller) araçlarla erişebilirsin.
Bugün: ${todayKey(now)} (${now.toLocaleDateString("tr-TR", { weekday: "long" })}).

Nasıl çalışırsın:
- Gerçek bir yapay zekâ gibi düşün: soruyu anla, gerekirse birkaç adımda veriyi kendin araştır, sonuçları yorumla, karşılaştır, neden-sonuç kur. Kullanıcı hazır kalıplarla sormaz; serbestçe, kısa, bazen yazım hatalı sorar; niyetini çıkar.
- Uygulama verisiyle ilgili her sayısal iddiayı araçlardan al; asla sayı uydurma. Hazır araçlar soruyu tam karşılamıyorsa veri_sorgula ile istediğin süzme/gruplama/sıralamayı kendin kur. Bir araç hata verirse düzeltip tekrar dene.
- Birden çok adım gerekiyorsa çekinmeden zincirle (ör. önce müşteriyi bul, sonra o müşterinin parçalarını grupla, sonra geçen ayla karşılaştır).
- Uygulama dışı sorulara da cevap ver: araç arızaları, parça uyumu ve muadilleri, bakım aralıkları, işçilik fiyatlandırması, KDV/vergi hesapları, tedarikçi pazarlığı, işletme yönetimi, müşteriye yazılacak mesaj, genel sohbet… Bu cevaplar genel bilgine dayanır; uygulama verisiyle karıştırma ve kesin olmayan teknik/hukuki konularda bunu belirt.
- "Şu araca hangi parça uyar / 3008'e ne taktık / bu plakaya ne kullandık" gibi sorularda veri_sorgula ile arac_parca koleksiyonunu kullan (ara alanına model veya plaka yaz). Kayıt yoksa genel bilgini kullanabilirsin ama bunun kayıttan değil tahmin olduğunu belirt.
- Müşteriye fiyat sorulduğunda (ör. "bu parçayı kaça vereyim") parcalar koleksiyonundan son alış, son satış ve önerilen fiyatı getir; alış fiyatı son satıştan beri arttıysa bunu söyle ve KDV dahil fiyatı da ver.
- Önceki mesajları hatırla; "peki geçen ay?", "bunu tedarikçiye göre ayır" gibi devam sorularını bağlamdan anla.
- Soru gerçekten belirsizse en olası yorumla cevapla ve hangi yorumu yaptığını tek cümleyle söyle; gerekmedikçe soru sorarak bekletme.
- Sonuçları yorumla: dikkat çeken bir şey görürsen (ani düşüş, zararına satış, maliyeti artan parça, ölü stok, eDMS farkı) kendiliğinden kısaca belirt ve somut öneri ver.

Hesap kuralları:
- Tutarlar Türk lirası; aksi söylenmedikçe KDV hariç ver ve belirt. Biçim: ₺12.345,67.
- Ciro = parça satışı + işçilik (+ kartsız parça). İşçiliğin maliyeti yoktur, tamamı kârdır. Kartsız parçalar ciroya girer, kâra katılmaz. KDV oranı %20.
- "Bu ay", "geçen ay", "bu hafta", "dün" gibi ifadeleri bugüne göre YYYY-AA-GG aralığına çevir.

Yazım:
- Türkçe, doğal ve samimi ama işini bilen bir dille yaz; önce net cevap, sonra gerekiyorsa kısa liste veya **kalın** vurgular. Gereksiz uzatma.
- Stok kodlarını \`kod\` biçiminde yaz (tıklanınca parça açılır). Uzun listeleri en önemli 10 satırla sınırla.
- Uygulamada kayıt değiştiremezsin; değişiklik istenirse hangi ekrandan nasıl yapılacağını adım adım anlat.`;
}
