# Demir Eurorepar Car Service

Demir Eurorepar Car Service için React tabanlı stok ve servis yönetim uygulaması. Google hesabıyla giriş yapar, stok/iş emri/fatura verilerini yetkili kullanıcılarla ortak Firebase Firestore veritabanında saklar. Fatura satırları Excel'den kopyalanıp yapıştırılabilir.

## Firebase kurulumu (zorunlu)

Uygulama demo giriş veya örnek servis verisi kullanmaz. Çalıştırmadan önce Firebase projesi oluşturup şu adımları tamamlayın:

1. Firebase Console'da bir proje oluşturun.
2. **Authentication → Sign-in method** altında Google sağlayıcısını etkinleştirin.
3. **Authentication → Settings → Authorized domains** bölümüne `localhost` ve Vercel alan adınızı ekleyin.
4. **Firestore Database** oluşturun.
5. Firebase Console'daki **Firestore → Rules** bölümüne bu projedeki [`firestore.rules`](./firestore.rules) içeriğini kopyalayıp yayınlayın. Kurallar yalnızca doğrulanmış Google e-postalarına izin verir; `tektas590@gmail.com` yönetici hesabıdır.
6. Firebase proje ayarlarında bir Web App ekleyip web yapılandırma değerlerini alın. Proje kökünde `.env.local` oluşturun ve [`.env.example`](./.env.example) içindeki `VITE_FIREBASE_*` alanlarını doldurun.
7. Vercel projesinin **Settings → Environment Variables** bölümüne aynı `VITE_FIREBASE_*` değerlerini ekleyip yeni bir deployment başlatın. Bu istemci yapılandırma değerleri gizli anahtar değildir; gerçek yetkilendirme Firestore Security Rules tarafından yapılır.

Sonra Node.js 18+ ve npm ile proje klasöründe:

```sh
npm install
npm run dev
```

Üretim derlemesi için `npm run build`; derlemeyi yerelde görüntülemek için `npm run preview` komutlarını kullanın. Vercel build komutu `npm run build`, çıktı klasörü `dist` olmalıdır.

## Modüller

- Google OAuth ile oturum açma; yetkisiz ve doğrulanmamış hesaplar reddedilir
- Yalnızca `tektas590@gmail.com` servis yöneticisidir; diğer hesaplar uygulamadaki **Yetkili Kullanıcılar** ekranından eklenip kaldırılır
- Firestore kurallarıyla sunucu tarafında yetki kontrolü; yetkili hesaplar farklı cihazlarda aynı servis verilerini kullanır
- SKU, marka, alış/satış fiyatı, stok ve kritik seviye yönetimi
- Plaka, marka, model ve müşteriyle eşleştirilen iş emirleri; kullanılan parçalar stoktan otomatik düşer
- Parça seçerek veya Excel/faturadan kopyala-yapıştır ile alış faturası girişi; stok otomatik artar
- Kritik seviyedeki stoklardan sipariş taslağı oluşturma ve teslim alındığında stoğa işleme
- En çok satan parçalar, servis cirosu ve iş emri raporları

## Yetki ve fatura kullanımı

Yönetici olarak `tektas590@gmail.com` Google hesabıyla giriş yapın. **Yetkili Kullanıcılar** sayfasından erişim verilecek kişilerin Google e-posta adreslerini ekleyin; erişimi kaldırmak için aynı listeden hesabı silin. İzin listesi ve uygulama verileri Firestore'da tutulur, tarayıcıda oturum açma dışında servis verisi saklanmaz. Firestore Rules dosyasını değiştirmeden kullanıcı eklemek/kaldırmak yeterlidir.

Fatura eklerken **Kopyala / yapıştır** sekmesini seçin. Excel veya tedarikçi tablosundan satırları doğrudan metin kutusuna yapıştırın. Başlıklar tanınır (`SKU`/`Parça Kodu`, `Adet`/`Miktar`, `Alış Fiyatı`/`Birim Fiyatı`); başlıksız sütun sırası `SKU, Parça Adı, Adet, Birim Alış Fiyatı` veya `SKU, Adet, Birim Alış Fiyatı` olmalıdır. TSV, CSV ve noktalı virgülle ayrılmış metin desteklenir. Yapıştırılan satırların stok kartları önceden envanterde bulunmalıdır; eşleşmeyen parçalar hata olarak gösterilir, kayıt sessizce atlanmaz.

Firebase kurulumu yapılana kadar Google ile giriş ve bulut kayıtları kullanılamaz. Daha önce tarayıcıda oluşturulmuş yerel demo kayıtları otomatik olarak Firestore'a taşınmaz; Firestore başlangıçta boş olur.
