# Duar Stok Yönetim

Oto yedek parça deposu için stok yönetimi. EUROREPAR **eDMS Fatura Raporu (WDMR010)** Excel çıktısıyla birebir uyumlu.

## Özellikler
- **Stok:** kart listesi, Tükendi/Kritik/Azalıyor/Yeterli filtreleri, ABC sınıfı, 90 günlük çıkışa göre "kaç gün yeter", ağırlıklı ortalama maliyet, marj, raf konumu, favori/arşiv, Excel dışa aktarım, parça detay paneli (60 gün grafik, alış geçmişi, hareket çizelgesi).
- **Alış faturaları:** eDMS WDMR010 Excel'ini sürükle-bırak; her satırın net/KDV tutarı ve fatura toplamı eDMS değerleriyle kontrol edilir, stok kodları kartlarla eşleşir (boşluk/tire farkları dahil), yeni kodlar için kart açılır, kayıtlı faturalar atlanır. Elle fatura girişi ve Excel'den yapıştırma.
- **Satış / çıkış:** tezgah veya servis çıkışı, stok yetersizse engeller, maliyet ve kâr hesaplar; eDMS satış faturaları da stoktan düşülebilir.
- **İptal:** faturalar ve çıkışlar silinmez, iptal edilir; stok otomatik geri alınır.
- **Sayım:** sayım veya eDMS stok listesi Excel'i yükle (ya da ekranda say), farkları gör, tek tıkla eşitle.
- **Sipariş listesi, hareket defteri, raporlar**, açık/koyu tema, mobil uyum.
- Litre gibi ondalıklı miktarlar desteklenir.

## Teknik
React + Vite, Firebase Auth (e-posta/şifre, doğrulama zorunlu) ve Firestore. Tüm stok işlemleri tek bir Firestore transaction'ında yapılır (`src/store/ops.js`), hesaplar saf fonksiyonlardadır (`src/core/`).

```bash
npm install
npm test      # çekirdek mantık testleri
npm run dev   # http://localhost:5173/?demo ile örnek verili önizleme
npm run build
```

Firebase yapılandırması `src/firebase.js` içindedir (veya `VITE_FIREBASE_*` ortam değişkenleri). Güvenlik kuralları `firestore.rules`; yönetici e-postası iki dosyada da tanımlıdır.
