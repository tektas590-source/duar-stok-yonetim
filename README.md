# Demir Eurorepar Car Service

Dark temalı React servis, iş emri ve stok yönetimi uygulaması.

## Çalıştırma

Node.js 18+ ve npm ile proje klasöründe:

```sh
npm install
npm run dev
```

Önce `.env.example` dosyasını `.env.local` adıyla kopyalayıp Supabase projenizin URL'sini ve **publishable/anon** anahtarını ekleyin. Ardından Supabase Dashboard > SQL Editor bölümünde [`supabase/schema.sql`](./supabase/schema.sql) dosyasını bir kez çalıştırın. Supabase Authentication bölümünden e-posta/şifre sağlayıcısını etkinleştirin. E-posta doğrulaması açıksa yeni hesap, onay e-postasındaki bağlantıya tıklanana kadar oturum açamaz.

Üretim derlemesi için `npm run build`; derlemeyi yerelde görüntülemek için `npm run preview` komutlarını kullanın. Ortam değişkenleri değiştirildiğinde Vite geliştirme sunucusunu yeniden başlatın.

## Modüller

- Supabase Auth ile e-posta/şifre giriş ve hesap oluşturma
- SKU, marka, alış/satış fiyatı, stok ve kritik seviye yönetimi
- Plaka, marka, model ve müşteriyle eşleştirilen iş emirleri; kullanılan parçalar stoktan otomatik düşer
- Parça seçerek veya Excel/faturadan kopyala-yapıştır ile alış faturası girişi; stok otomatik artar
- Kritik seviyedeki stoklardan sipariş taslağı oluşturma ve teslim alındığında stoğa işleme
- En çok satan parçalar, servis cirosu ve iş emri raporları

## Veri, erişim ve ekip kullanımı

Servis verileri Supabase PostgreSQL'e, oturumlar Supabase Auth'a kaydedilir. RLS politikaları parça, iş emri, fatura ve sipariş verilerini oturum açan kullanıcıya göre sınırlar. Aynı hesapla farklı cihazlardan giriş yapıldığında aynı bulut verileri açılır. Ayrı Supabase hesapları birbirlerinin verilerini göremez; birden fazla çalışanın aynı servis kayıtlarını kullanması için ayrıca servis/ekip üyeliği ve davet akışı kurulmalıdır.

İstemci tarafında yalnızca Supabase URL'si ve publishable/anon anahtarı kullanılır; `service_role` anahtarını tarayıcı ortam değişkenlerine koymayın. `VITE_` değişkenleri istemci paketinde herkese açık olacağından erişim kontrolü veritabanındaki RLS politikalarıyla yapılır. Mevcut tarayıcı `localStorage` prototip verileri otomatik buluta taşınmaz; gerçek başlangıç verilerini envanter ekranından ekleyin.

Faturaya Excel veya benzer tablodan satır kopyalayıp yapıştırın. Başlıklar tanınır (`SKU`/`Parça Kodu`, `Adet`/`Miktar`, `Alış Fiyatı`/`Birim Fiyatı`); başlıksız yapıştırmada sütun sırası `SKU, Parça Adı, Adet, Birim Alış Fiyatı` veya `SKU, Adet, Birim Alış Fiyatı` olmalıdır. Satırlar mevcut SKU ya da parça adıyla eşleşmelidir; eşleşmeyen kalemleri önce envantere ekleyin.
