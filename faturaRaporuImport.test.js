import test from "node:test";
import assert from "node:assert/strict";
import { parseFaturaRaporuReport, splitFaturaRaporuByType, splitSalesByKaynak } from "./faturaRaporuImport.js";

// Aşağıdaki satırlar, gerçek eDMS "Fatura Raporu" (WDMR010) Excel çıktısından
// (sheet_to_json(sheet, { header: 1 }) formatında) birebir alınmıştır: iki tam
// "Satış" faturası (aynı araç, art arda, ilkinde iş emri no eksik), bir
// "Satın Alma" faturası (iskontolu tek satır) ve iş emri referansı taşımayan
// bir düzeltme faturası.
const SALE_BLOCK_ROWS = [
  ["Tarih/No:", null, "2026-09-16T00:00:00.000", null, null, "/", "5001000012", null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  ["Vade:", null, "2026-09-16T00:00:00.000"],
  ["Firma:", null, "DEMİR İNŞ. MİMARLIK AKARYAKIT OTOMOTİV SAN. VE TİC.LDT.ŞTİ."],
  ["Açıklama:", null, "NM0EXXTTREMG61162 / 34EMH581 / E-TRANSIT CUSTOM VAN 320S 160KW DELUXE\n\nKM:138700"],
  ["Tip:", null, "Satış"],
  ["Kaynak:", null, "Servis"],
  ["Stok/Hizmet", null, "Kod", null, null, null, null, "Açıklama", null, null, null, null, "İndex", "Birim Fiyat", null, null, "Miktar", null, "İskonto(%)", "Kdv (%)", null, "Toplam", "İskonto", "Kdv", "Fatura Tutarı", null],
  ["Hizmet", null, "ERT001", null, null, null, null, "Bakım İşçiliği", null, null, null, null, null, "2750.0", null, null, "1.0", null, null, "20.0", null, "2750.0", "0", "550.0", "3300.0"],
  ["Stok", null, "0164.88ALT", null, null, null, null, "CONTA KAUÇUK-KARTER TAPA PULU 47,7X24X1,50", null, null, null, null, null, "70.0", null, null, "1.0", null, null, "20.0", null, "70.0", "0", "14.0", "84.0"],
  ["Stok", null, "LTRS200134", null, null, null, null, "(ACC) PLASTİK ONARIM KİTİ", null, null, null, null, "0006", "210.0", null, null, "1.0", null, null, "20.0", null, "210.0", "0", "42.0", "252.0"],
  ["Stok", null, "BSG-30-145-020", null, null, null, null, "POLEN FİLTRESİ -TRANSİT-", null, null, null, null, null, "410.0", null, null, "1.0", null, null, "20.0", null, "410.0", "0", "82.0", "492.0"],
  ["Stok", null, "BSG-30-140-013", null, null, null, null, "YAĞ FİLTRESİ -TRANSİT-", null, null, null, null, null, "205.0", null, null, "1.0", null, null, "20.0", null, "205.0", "0", "41.0", "246.0"],
  ["Stok", null, "BSG-30-135-050", null, null, null, null, "HAVA FİLTRESİ -TRANSİT-", null, null, null, null, null, "205.0", null, null, "1.0", null, null, "20.0", null, "205.0", "0", "41.0", "246.0"],
  ["Stok", null, "BSG-30-135-043", null, null, null, null, "HAVA FİLTRESİ -TRANSİT-", null, null, null, null, null, "155.0", null, null, "1.0", null, null, "20.0", null, "155.0", "0", "31.0", "186.0"],
  ["Stok", null, "GDY 301030", null, null, null, null, "MOTOR YAĞI 0W-30 10,50 LİTRE", null, null, null, null, null, "347.82", null, null, "11.5", null, null, "20.0", null, "3999.93", "0", "799.99", "4799.92"],
  ["Stok", null, "97JM 6730 CA N", null, null, null, null, "KARTER YAĞ TAPASI", null, null, null, null, null, "443.0", null, null, "1.0", null, null, "20.0", null, "443.0", "0", "88.6", "531.6"],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "19.5", null, null, null, null, "8447.93", "0.0", "1689.59", "10137.52"],
  ["Tarih/No:", null, "2026-09-18T00:00:00.000", null, null, "/", "5001000013"],
  ["Vade:", null, "2026-09-18T00:00:00.000"],
  ["Firma:", null, "DEMİR İNŞ. MİMARLIK AKARYAKIT OTOMOTİV SAN. VE TİC.LDT.ŞTİ."],
  ["Açıklama:", null, "NM0EXXTTREMG61162 / 34EMH581 / E-TRANSIT CUSTOM VAN 320S 160KW DELUXE / 917001 KM:138700"],
  ["Tip:", null, "Satış"],
  ["Kaynak:", null, "Servis"],
  ["Stok/Hizmet", null, "Kod", null, null, null, null, "Açıklama", null, null, null, null, "İndex", "Birim Fiyat", null, null, "Miktar", null, "İskonto(%)", "Kdv (%)", null, "Toplam", "İskonto", "Kdv", "Fatura Tutarı", null],
  ["Hizmet", null, "KAPORTA", null, null, null, null, "KAPORTA İŞÇİLİĞİ", null, null, null, null, null, "2000.0", null, null, "1.0", null, null, "20.0", null, "2000.0", "0", "400.0", "2400.0"],
  ["Stok", null, "BK31 V254A16 AG5CND N", null, null, null, null, "SURGULU KAPI BANDI SAG", null, null, null, null, null, "6200.0", null, null, "1.0", null, null, "20.0", null, "6200.0", "0", "1240.0", "7440.0"],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "2.0", null, null, null, null, "8200.0", "0.0", "1640.0", "9840.0"],
];

const PURCHASE_BLOCK_ROWS = [
  ["Tarih/No:", null, "2026-10-23T00:00:00.000", null, null, "/", "DM22026000006913"],
  ["Vade:", null, "2026-10-23T00:00:00.000"],
  ["Firma:", null, "DEMPAR İNŞAAT OTOMOTİV YEDEK PARÇA SANAYİ TİCARET LİMİTED ŞİTKETİ"],
  ["Açıklama:", null, null],
  ["Tip:", null, "Satın Alma"],
  ["Kaynak:", null, "YP Banko"],
  ["Stok/Hizmet", null, "Kod", null, null, null, null, "Açıklama", null, null, null, null, "İndex", "Birim Fiyat", null, null, "Miktar", null, "İskonto(%)", "Kdv (%)", null, "Toplam", "İskonto", "Kdv", "Fatura Tutarı", null],
  ["Stok", null, "LTR1610725580OEM", null, null, null, null, "FREN HIDROLIK YAĞI DOT4 500 ML", null, null, null, null, null, "291.67", null, null, "10.0", null, "20.0", "20.0", null, "2916.7", "583.34", "466.67", "2800.0299999999997"],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "10.0", null, null, null, null, "2916.7", "583.34", "466.67", "2800.0299999999997"],
];

// Gerçek eDMS Fatura Raporu'ndan: "Kaynak: YP Banko" olan, hiçbir araç/iş
// emri bilgisi taşımayan bir tezgah satışı (5000000002).
const BANKO_SALE_BLOCK_ROWS = [
  ["Tarih/No:", null, "2026-09-15T00:00:00.000", null, null, "/", "5000000002"],
  ["Vade:", null, "2026-09-15T00:00:00.000"],
  ["Firma:", null, "DMR YEDEK PARÇA OTOMOTİV PETROL SAN.TİC.LTD.ŞTİ."],
  ["Açıklama:", null, null],
  ["Tip:", null, "Satış"],
  ["Kaynak:", null, "YP Banko"],
  ["Stok/Hizmet", null, "Kod", null, null, null, null, "Açıklama", null, null, null, null, "İndex", "Birim Fiyat", null, null, "Miktar", null, "İskonto(%)", "Kdv (%)", null, "Toplam", "İskonto", "Kdv", "Fatura Tutarı", null],
  ["Stok", null, "E1005048", null, null, null, null, "RADYATÖR TEMİZLEYİCİ 300 ML", null, null, null, null, null, "170.0", null, null, "10.0", null, null, "20.0", null, "1700.0", "0", "340.0", "2040.0"],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "10.0", null, null, null, null, "1700.0", "0.0", "340.0", "2040.0"],
];

const NOTE_ONLY_BLOCK_ROWS = [
  ["Tarih/No:", null, "2026-09-25T00:00:00.000", null, null, "/", "5001000019"],
  ["Vade:", null, "2026-09-25T00:00:00.000"],
  ["Firma:", null, "DEMİR İNŞ. MİMARLIK AKARYAKIT OTOMOTİV SAN. VE TİC.LDT.ŞTİ."],
  ["Açıklama:", null, "YAĞ FİLTRESİ EKLENMEDİĞİ İÇİN TEKRAR OLUŞTURULDU"],
  ["Tip:", null, "Satış"],
  ["Kaynak:", null, "Servis"],
  ["Stok/Hizmet", null, "Kod", null, null, null, null, "Açıklama", null, null, null, null, "İndex", "Birim Fiyat", null, null, "Miktar", null, "İskonto(%)", "Kdv (%)", null, "Toplam", "İskonto", "Kdv", "Fatura Tutarı", null],
  ["Hizmet", null, "ERT001", null, null, null, null, "Bakım İşçiliği", null, null, null, null, null, "1.0", null, null, "1.0", null, null, "20.0", null, "1.0", "0", "0.2", "1.2"],
  ["Stok", null, "BSG-30-140-013", null, null, null, null, "YAĞ FİLTRESİ -TRANSİT-", null, null, null, null, null, "205.0", null, null, "1.0", null, "10.0", "20.0", null, "205.0", "20.5", "36.9", "221.4"],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "2.0", null, null, null, null, "206.0", "20.5", "37.1", "222.6"],
];

test("rejects empty input", () => {
  const result = parseFaturaRaporuReport([]);
  assert.equal(result.invoices.length, 0);
  assert.match(result.errors[0], /kayıt bulunamadı/);
  assert.equal(parseFaturaRaporuReport(null).invoices.length, 0);
});

test("parses two consecutive Satış invoices for the same vehicle", () => {
  const { invoices, errors } = parseFaturaRaporuReport(SALE_BLOCK_ROWS);
  assert.equal(errors.length, 0);
  assert.equal(invoices.length, 2);

  const [first, second] = invoices;
  assert.equal(first.invoiceNo, "5001000012");
  assert.equal(first.date, "2026-09-16");
  assert.equal(first.vin, "NM0EXXTTREMG61162");
  assert.equal(first.plate, "34EMH581");
  assert.equal(first.externalId, null); // bu faturada iş emri no eksik
  assert.equal(first.tip.isSale, true);
  assert.equal(first.tip.isPurchase, false);
  assert.equal(first.items.length, 9);
  assert.equal(first.items[0].kind, "Hizmet");
  assert.equal(first.items[0].kod, "ERT001");
  assert.equal(first.items[0].unitPrice, 2750);
  assert.equal(first.items[0].grossTotal, 3300);
  assert.equal(first.totalGross, 10137.52);

  assert.equal(second.invoiceNo, "5001000013");
  assert.equal(second.externalId, "917001"); // bu faturada iş emri no var
  assert.equal(second.vin, "NM0EXXTTREMG61162");
  assert.equal(second.items.length, 2);
  assert.equal(second.totalGross, 9840);
});

test("parses a discounted Satın Alma invoice and keeps the supplier as firma", () => {
  const { invoices, errors } = parseFaturaRaporuReport(PURCHASE_BLOCK_ROWS);
  assert.equal(errors.length, 0);
  assert.equal(invoices.length, 1);
  const [invoice] = invoices;
  assert.equal(invoice.invoiceNo, "DM22026000006913");
  assert.equal(invoice.firma, "DEMPAR İNŞAAT OTOMOTİV YEDEK PARÇA SANAYİ TİCARET LİMİTED ŞİTKETİ");
  assert.equal(invoice.tip.isPurchase, true);
  assert.equal(invoice.vin, null); // alış faturalarında açıklama/araç bilgisi yok
  assert.equal(invoice.items.length, 1);
  const [item] = invoice.items;
  assert.equal(item.kod, "LTR1610725580OEM");
  assert.equal(item.unitPrice, 291.67);
  assert.equal(item.qty, 10);
  assert.equal(item.discountPercent, 20);
  assert.equal(item.lineTotal, 2916.7);
  assert.equal(item.discountAmount, 583.34);
  assert.ok(Math.abs(invoice.totalGross - 2800.03) < 0.01);
});

test("a note-only Açıklama (no VIN/plate) is parsed without vehicle fields", () => {
  const { invoices, errors } = parseFaturaRaporuReport(NOTE_ONLY_BLOCK_ROWS);
  assert.equal(errors.length, 0);
  assert.equal(invoices.length, 1);
  const [invoice] = invoices;
  assert.equal(invoice.vin, null);
  assert.equal(invoice.plate, null);
  assert.equal(invoice.externalId, null);
  assert.equal(invoice.aciklama, "YAĞ FİLTRESİ EKLENMEDİĞİ İÇİN TEKRAR OLUŞTURULDU");
  assert.equal(invoice.items.length, 2);
});

test("skips a Tarih/No row with no readable date or invoice number", () => {
  const rows = [["Tarih/No:", null, null, null, null, "/", null]];
  const result = parseFaturaRaporuReport(rows);
  assert.equal(result.invoices.length, 0);
  assert.match(result.errors[0], /tarihi veya numarası/);
});

test("splitFaturaRaporuByType groups by Tip", () => {
  const sale = parseFaturaRaporuReport(SALE_BLOCK_ROWS).invoices;
  const purchase = parseFaturaRaporuReport(PURCHASE_BLOCK_ROWS).invoices;
  const { sales, purchases, returns, other } = splitFaturaRaporuByType([...sale, ...purchase]);
  assert.equal(sales.length, 2);
  assert.equal(purchases.length, 1);
  assert.equal(returns.length, 0);
  assert.equal(other.length, 0);
});

test("splitSalesByKaynak separates YP Banko (tezgah) sales from Servis sales", () => {
  // Gerçek senaryo: "YP Banko" kaynaklı satışlar hiçbir iş emrine/araca bağlı
  // değildir (Açıklama alanı boş/şasi-plaka içermez) ve bu yüzden normal
  // eşleştirmeye hiç girmemeli — ayrı bir akışla (bankoSales) takip edilir.
  const servisSales = parseFaturaRaporuReport(SALE_BLOCK_ROWS).invoices;
  const bankoSales = parseFaturaRaporuReport(BANKO_SALE_BLOCK_ROWS).invoices;
  const { sales } = splitFaturaRaporuByType([...servisSales, ...bankoSales]);
  const { banko, servis } = splitSalesByKaynak(sales);
  assert.equal(banko.length, 1);
  assert.equal(banko[0].invoiceNo, "5000000002");
  assert.equal(servis.length, 2);
  assert.deepEqual(servis.map((s) => s.invoiceNo), ["5001000012", "5001000013"]);
});
