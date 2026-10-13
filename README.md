# Demir Eurorepar Car Service

Demir Eurorepar Car Service için React tabanlı stok ve servis yönetim uygulaması. E-posta/şifre ile giriş yapar, stok/iş emri/fatura verilerini yetkili kullanıcılarla ortak Firebase Firestore veritabanında saklar. Fatura satırları Excel'den kopyalanıp yapıştırılabilir.

## Firebase kurulumu (zorunlu)

Uygulama demo giriş veya örnek servis verisi kullanmaz. Çalıştırmadan önce Firebase projesi oluşturup şu adımları tamamlayın:

1. Firebase Console'da bir proje oluşturun.
2. **Authentication → Sign-in method** altında **Email/Password** sağlayıcısını etkinleştirin.
3. **Authentication → Settings → Authorized domains** bölümüne `localhost` ve Vercel alan adınızı ekleyin.
4. **Firestore Database** oluşturun.
5. Firebase Console'daki **Firestore → Rules** bölümüne bu projedeki [`firestore.rules`](./firestore.rules) içeriğini kopyalayıp yayınlayın. Kurallar yalnızca doğrulanmış ve izin verilmiş e-posta adreslerine izin verir; `tektas590@gmail.com` yönetici hesabıdır.
6. Firebase proje ayarlarında bir Web App ekleyip web yapılandırma değerlerini alın. Proje kökünde `.env.local` oluşturun ve [`.env.example`](./.env.example) içindeki `VITE_FIREBASE_*` alanlarını doldurun.
7. Vercel projesinin **Settings → Environment Variables** bölümüne aynı `VITE_FIREBASE_*` değerlerini ekleyip yeni bir deployment başlatın. Bu istemci yapılandırma değerleri gizli anahtar değildir; gerçek yetkilendirme Firestore Security Rules tarafından yapılır.

Sonra Node.js 18+ ve npm ile proje klasöründe:

```sh
npm install
npm run dev
```

Üretim derlemesi için `npm run build`; derlemeyi yerelde görüntülemek için `npm run preview` komutlarını kullanın. Vercel build komutu `npm run build`, çıktı klasörü `dist` olmalıdır.

## Modüller

- E-posta/şifre ile oturum açma; doğrulanmamış ve yetki verilmemiş hesaplar servis verilerine erişemez
- `serkan.tektas` kullanıcı adı `tektas590@gmail.com` yönetici hesabına yönlenir; diğer kullanıcılar e-posta adresleriyle giriş yapar
- Yönetici, **Yetkili Kullanıcılar** ekranından diğer hesaplara erişim verir veya erişimi kaldırır
- Firestore kurallarıyla sunucu tarafında yetki kontrolü; yetkili hesaplar farklı cihazlarda aynı servis verilerini kullanır
- SKU, marka, alış/satış fiyatı, stok ve kritik seviye yönetimi
- Plaka, marka, model ve müşteriyle eşleştirilen iş emirleri; kullanılan parçalar stoktan otomatik düşer
- İş emri parça satırlarında ad, SKU veya kodun sonuyla arama; Excel'den parça kodu satırlarını yapıştırarak toplu eşleştirme
- Araç Servis Geçmişi sayfasında plakaya göre ziyaret, tarih, müşteri ve kullanılan parçaları görüntüleme
- Parça–Araç Uyumluluğu sayfasında geçmiş iş emirlerinde parçanın kullanıldığı marka/model kayıtlarını görme; liste yalnızca kaydedilmiş kullanımı gösterir, katalog verisi olmadan uyum garantisi vermez
- Stok Hareketleri sayfasında fatura girişi, iş emri çıkışı, sipariş teslimi ve stok düzeltmelerini kullanıcı, kaynak belge ve stok bakiyesiyle izleme
- Dashboard'da son 7 günlük ve 6 aylık ciro grafikleri ile birleşik son hareket akışı
- Parçayı silmek yerine arşivleme; kısa süreli bildirimden işlemi geri alma
- Parça seçerek veya Excel/faturadan kopyala-yapıştır ile alış faturası girişi; stok otomatik artar
- Kritik seviyedeki stoklardan sipariş taslağı oluşturma ve teslim alındığında stoğa işleme
- En çok satan parçalar, servis cirosu ve iş emri raporları
- Gösterge panelinde canlı saat/tarih, düşük dikkat dağıtan araç animasyonu ve açık/koyu tema

## Yetki ve fatura kullanımı

İlk kullanımda **Hesap oluşturun** bölümünden `tektas590@gmail.com` adresiyle yönetici hesabı oluşturun ve gelen doğrulama bağlantısını açın. İlk başarılı yönetici girişinde yeni parola belirleme ekranı zorunlu olarak açılır. Firebase parola şartı nedeniyle geçici parola da en az 6 karakter olmalıdır; `1234` Firebase tarafından kabul edilmez ve kod içine hiçbir parola gömülmez. Daha sonra `serkan.tektas` kullanıcı adı veya yönetici e-posta adresiyle giriş yapılabilir.

Yönetici olarak **Yetkili Kullanıcılar** sayfasından erişim verilecek kişilerin e-posta adreslerini ekleyin. Bu kişiler hesap oluşturup e-posta adreslerini doğrular; yönetici onayı olmadan servis verileri açılamaz. Erişimi kaldırmak için listedeki hesabı silin. İzin listesi ve uygulama verileri Firestore'da tutulur. Güvenli ilk parola değişiminden sonra yönetici giriş bilgilerini paylaşmak yerine kullanıcı kendi hesabını oluşturmalıdır.

Fatura eklerken **Kopyala / yapıştır** sekmesini seçin. Excel veya tedarikçi tablosundan satırları doğrudan metin kutusuna yapıştırın. Başlıklar tanınır (`SKU`/`Parça Kodu`, `Adet`/`Miktar`, `Alış Fiyatı`/`Birim Fiyatı`); başlıksız sütun sırası `SKU, Parça Adı, Adet, Birim Alış Fiyatı` veya `SKU, Adet, Birim Alış Fiyatı` olmalıdır. TSV, CSV ve noktalı virgülle ayrılmış metin desteklenir. Yapıştırılan satırların stok kartları önceden envanterde bulunmalıdır; eşleşmeyen parçalar hata olarak gösterilir, kayıt sessizce atlanmaz.

İş emrinde bir aracın plakası, marka/modeli ve kullanılan parçaları kaydedildikçe araç geçmişi ve parça/model uyumluluk listeleri oluşur. Stok hareketleri yeni işlemlerden itibaren ilgili parçanın alt koleksiyonunda aktör ve stok öncesi/sonrası değerlerini saklar; var olan Firestore kuralları bu koleksiyon yollarını mevcut yetkili parça erişimi kapsamında korur. Önceden kayıtlı iş emirleri ve alış faturaları hareket ekranında geçmiş işlem olarak görünür; bu eski kayıtlar için işlem yapan kullanıcı bilgisi mevcut olmadığından **Geçmiş kayıt** şeklinde işaretlenir.

Firebase kurulumu yapılana kadar e-posta/şifre girişi ve bulut kayıtları kullanılamaz. Daha önce tarayıcıda oluşturulmuş yerel demo kayıtları otomatik olarak Firestore'a taşınmaz; Firestore başlangıçta boş olur.
