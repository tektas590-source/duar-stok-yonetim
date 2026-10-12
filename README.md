# Demir Eurorepar Car Service

Supabase veya sunucu ayarı gerektirmeyen; tarayıcıda çalışan React servis, iş emri ve stok yönetimi demo uygulaması. Arayüz koyu ve açık temaları destekler.

## Çalıştırma

Node.js 18+ ve npm ile proje klasöründe:

```sh
npm install
npm run dev
```

Herhangi bir `.env` dosyası, API anahtarı veya Vercel Environment Variable gerekmez. Üretim derlemesi için `npm run build`; derlemeyi yerelde görüntülemek için `npm run preview` komutlarını kullanın. Vercel'e standart Vite projesi olarak aktarabilirsiniz: build komutu `npm run build`, çıktı klasörü `dist`.

## Modüller

- Demo e-posta/şifre giriş ekranı (sunucu tarafı kimlik doğrulaması yoktur)
- SKU, marka, alış/satış fiyatı, stok ve kritik seviye yönetimi
- Plaka, marka, model ve müşteriyle eşleştirilen iş emirleri; kullanılan parçalar stoktan otomatik düşer
- Parça seçerek veya Excel/faturadan kopyala-yapıştır ile alış faturası girişi; stok otomatik artar
- Kritik seviyedeki stoklardan sipariş taslağı oluşturma ve teslim alındığında stoğa işleme
- En çok satan parçalar, servis cirosu ve iş emri raporları

## Demo girişi ve verilerin saklanması

Giriş ekranında geçerli biçimde bir e-posta ve boş olmayan herhangi bir şifre girip **Demo giriş yap** düğmesine basın. Demo oturumu ve örnek servis kayıtları tarayıcının `localStorage` alanında saklanır. İlk girişte örnek envanter, iş emirleri ve faturalar hazırlanır; sonrasında eklediğiniz/değiştirdiğiniz kayıtlar aynı tarayıcıda korunur. Bu demo gerçek parola doğrulaması yapmaz; veriler sunucuya gönderilmez veya cihazlar arasında paylaşılmaz. Tarayıcı depolaması temizlenirse demo kayıtları silinir.

Faturaya Excel veya benzer tablodan satır kopyalayıp yapıştırın. Başlıklar tanınır (`SKU`/`Parça Kodu`, `Adet`/`Miktar`, `Alış Fiyatı`/`Birim Fiyatı`); başlıksız yapıştırmada sütun sırası `SKU, Parça Adı, Adet, Birim Alış Fiyatı` veya `SKU, Adet, Birim Alış Fiyatı` olmalıdır. Satırlar mevcut SKU ya da parça adıyla eşleşmelidir; eşleşmeyen kalemleri önce envantere ekleyin.
