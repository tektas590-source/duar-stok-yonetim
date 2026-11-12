import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store/memoryStore.js";
import { runTool, TOOL_SPECS, systemPrompt } from "../src/ai/tools.js";

async function seed() {
  const store = createMemoryStore();
  await store.purchase({ no: "A1", supplier: "DEMPAR", date: "2026-11-02", lines: [{ sku: "GDY 301030", name: "Motor yağı", qty: 20, unitPrice: 300 }, { sku: "1609414480", name: "Yağ filtresi", qty: 5, unitPrice: 190 }, { sku: "OLU-1", name: "Eski parça", qty: 2, unitPrice: 1000 }] });
  await store.saveItem({ sku: "1609414480", name: "Yağ filtresi", minimum: 4, price: 290 }, { isNew: false });
  await store.issue({ no: "5001", date: "2026-11-05", customer: "Ahmet", plate: "55 ABC 1", lines: [{ sku: "GDY 301030", qty: 4.5, unitPrice: 400 }, { sku: "1609414480", qty: 2, unitPrice: 290 }], services: [{ name: "Bakım işçiliği", unitPrice: 1500 }] });
  let data; store.subscribe((d) => { data = d; })();
  return data;
}
const NOW = Date.parse("2026-11-09T12:00:00Z");

test("tool specs and prompt", () => {
  assert.ok(TOOL_SPECS.length >= 10);
  assert.ok(systemPrompt(new Date(NOW)).includes("2026-11-09"));
});

test("overview, search, detail, sales, purchases, critical, dead stock", async () => {
  const data = await seed();
  const o = runTool("genel_durum", {}, data, NOW);
  assert.equal(o.buAySatis.ciroKdvHaric, 1800 + 580 + 1500);
  assert.equal(o.buAySatis.iscilik, 1500);
  assert.equal(o.buAyAlis.kdvHaric, 6000 + 950 + 2000);
  assert.equal(runTool("parca_ara", { sorgu: "gdy-301030" }, data, NOW).parcalar[0].stok, 15.5);
  const d = runTool("parca_detay", { sku: "1609414480" }, data, NOW);
  assert.equal(d.toplamSatilan, 2);
  assert.equal(d.parca.durum, "Kritik");
  const s = runTool("satis_raporu", { baslangic: "2026-11-01", bitis: "2026-11-30" }, data, NOW);
  assert.equal(s.brutKar, 1800 - 1350 + 580 - 380 + 1500);
  assert.equal(s.musteriler[0].musteri, "Ahmet");
  assert.equal(runTool("alis_raporu", {}, data, NOW).tedarikciler[0].tedarikci, "DEMPAR");
  assert.equal(runTool("kritik_stoklar", {}, data, NOW).parcalar[0].sku, "1609414480");
  assert.equal(runTool("olu_stok", { gun: 30 }, data, NOW).parcalar[0].sku, "OLU-1");
  assert.equal(runTool("en_cok_satanlar", { olcu: "adet" }, data, NOW).parcalar[0].sku, "GDY 301030");
  assert.equal(runTool("belge_ara", { sorgu: "55 abc" }, data, NOW).sonuc[0].iscilik, 1500);
  assert.equal(runTool("hareketler", { tur: "satis" }, data, NOW).adet, 2);
  assert.ok(runTool("yok", {}, data, NOW).hata);
});

test("flexible query: filter, search, group, sort, errors", async () => {
  const data = await seed();
  const q = (a) => runTool("veri_sorgula", a, data, NOW);
  assert.equal(q({ koleksiyon: "parcalar", filtre: "stok>2" }).eslesenKayit, 2);
  assert.equal(q({ koleksiyon: "parcalar", filtre: "ad~filtre" }).kayitlar[0].sku, "1609414480");
  assert.equal(q({ koleksiyon: "satis_kalemleri", ara: "gdy301030" }).toplamlar.net, 1800);
  const g = q({ koleksiyon: "satis_kalemleri", grupla: "musteri" });
  assert.equal(g.gruplar[0].musteri, "Ahmet");
  assert.equal(g.gruplar[0].net, 2380);
  assert.equal(q({ koleksiyon: "iscilikler", filtre: "plaka~55 abc" }).toplamlar.net, 1500);
  assert.equal(q({ koleksiyon: "alis_kalemleri", sirala: "net asc" }).kayitlar[0].sku, "1609414480");
  assert.equal(q({ koleksiyon: "satis_belgeleri", grupla: "ay" }).gruplar[0].ciro, 3880);
  assert.equal(q({ koleksiyon: "hareketler", filtre: "islem~satış", baslangic: "2026-11-05" }).eslesenKayit, 2);
  assert.ok(q({ koleksiyon: "yok" }).hata);
  assert.ok(q({ koleksiyon: "parcalar", filtre: "fiyatt>3" }).alanlar);
  assert.throws(() => q({ koleksiyon: "parcalar", filtre: "saçma" }));
});
