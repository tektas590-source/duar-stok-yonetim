# Demir Eurorepar Car Service

Demir Eurorepar Car Service için React tabanlı stok ve servis yönetim uygulaması. E-posta/şifre ile giriş yapar, stok/iş emri/fatura verilerini yetkili kullanıcılarla ortak Firebase Firestore veritabanında saklar. Fatura satırları Excel'den kopyalanıp yapıştırılabilir.

## Firebase kurulumu (zorunlu)

Uygulama demo giriş veya örnek servis verisi kullanmaz. Çalıştırmadan önce Firebase projesi oluşturup şu adımları tamamlayın. Browser E2E testleri için ayrı test projesinin `VITE_FIREBASE_*` değerlerini `.env.example` yapısını izleyerek `.env.e2e` içine ekleyin; `KOMBAI_E2E_EXPECTED_PROJECT_ID` değerini de test projesinin `VITE_FIREBASE_PROJECT_ID` değeriyle aynı yapın. `npm run dev:e2e`, kimliği doğrulamadan sunucu açmaz ve `stok-16ef3` production projesini reddeder. `.env.e2e` dosyasını Git'e eklemeyin:

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
- Plaka, marka, model ve müşteriyle eşleştirilen iş emirleri; tarihleri düzenlenebilir, tamamlanabilir ve iptal edilebilir. Düzenleme/iptalde stok farkları denetim hareketleriyle atomik uygulanır; iptal kaydı denetim için saklanır
- Alış faturalarında belge tarihi seçilebilir; tarih, faturaya bağlı stok hareketlerine iş tarihi olarak kaydedilir
- İş emri parça satırlarında ad, SKU veya kodun sonuyla arama; Excel'den parça kodu satırlarını yapıştırarak toplu eşleştirme
- Araç Servis Geçmişi sayfasında plakaya göre ziyaret, tarih, müşteri ve kullanılan parçaları görüntüleme
- Araç Uyumluluğu sayfasında marka, model veya plakayla arama; her araç için iptal edilmemiş geçmiş iş emirlerinde kullanılan parçaları ve kullanım sayılarını görme (katalog uyumluluk garantisi değildir)
- Stok Hareketleri sayfasında fatura girişi, iş emri çıkışı, sipariş teslimi ve stok düzeltmelerini kullanıcı, kaynak belge ve stok bakiyesiyle izleme
- Dashboard'da son 7 günlük ve 6 aylık ciro grafikleri ile birleşik son hareket akışı
- Parçayı silmek yerine arşivleme; kısa süreli bildirimden işlemi geri alma
- Parça seçerek, stok kodunu yazarak veya Excel'den kopyalayarak alış faturası girişi; yeni kodlarda parça kartı otomatik oluşur, stok ve satış fiyatı güncellenir
- Alış ve satış fiyatları KDV hariç saklanır; fatura toplamları, iş emri satışları, dashboard cirosu ve rapor tutarları %20 KDV dahil gösterilir
- Kritik seviyedeki stoklardan sipariş taslağı oluşturma ve teslim alındığında stoğa işleme
- En çok satan parçalar, servis cirosu ve iş emri raporları
- Gösterge panelinde canlı saat/tarih, düşük dikkat dağıtan araç animasyonu ve açık/koyu tema

## Yetki ve fatura kullanımı

İlk kullanımda **Hesap oluşturun** bölümünden `tektas590@gmail.com` adresiyle yönetici hesabı oluşturun ve gelen doğrulama bağlantısını açın. İlk başarılı yönetici girişinde yeni parola belirleme ekranı zorunlu olarak açılır. Firebase parola şartı nedeniyle geçici parola da en az 6 karakter olmalıdır; `1234` Firebase tarafından kabul edilmez ve kod içine hiçbir parola gömülmez. Daha sonra `serkan.tektas` kullanıcı adı veya yönetici e-posta adresiyle giriş yapılabilir.

Yönetici olarak **Yetkili Kullanıcılar** sayfasından erişim verilecek kişilerin e-posta adreslerini ekleyin. Bu kişiler hesap oluşturup e-posta adreslerini doğrular; yönetici onayı olmadan servis verileri açılamaz. Erişimi kaldırmak için listedeki hesabı silin. İzin listesi ve uygulama verileri Firestore'da tutulur. Güvenli ilk parola değişiminden sonra yönetici giriş bilgilerini paylaşmak yerine kullanıcı kendi hesabını oluşturmalıdır.

Alış faturasında fatura numarası ve tedarikçi girilir. **Yeni stok kodu oluştur** bölümünden SKU, adet, alış ve satış fiyatını girip **Faturaya ekle** dediğinizde parça, faturanın yanındaki satır listesine eklenir; nihai kayıtta stok kartı, fatura numarası ve stok hareketi birlikte kaydedilir. Yeni SKU için parça adı gereklidir; kayıtlı SKU için ad otomatik bulunur. Kayıtlı parçalardan seçme ve **Kopyala / yapıştır** girişleri de kullanılabilir. Yapıştırma `SKU, Parça Adı, Adet, Alış Fiyatı, Satış Fiyatı` sütunlarını destekler. Tutarlar KDV hariç girilir; fatura özeti KDV hariç ara toplamı, %20 KDV tutarını ve KDV dahil toplamı gösterir. İş emri satış toplamı ve ciro da %20 KDV dahil hesaplanır. TSV, CSV ve noktalı virgülle ayrılmış metin kabul edilir; hatalı satırlar açıkça bildirilir.

İş emrinde bir aracın plakası, marka/modeli ve kullanılan parçaları kaydedildikçe araç geçmişi ve marka/model/plaka aramasıyla araç bazlı parça kullanım listeleri oluşur. Tamamlanan iş emirleri açık iş sayısından çıkar ama ciroda kalır. İptal edilen iş emri kaydı denetim için korunur; parçalar stoğa iade edilir ve iptal kaydı ciro/araç parça sonuçlarından çıkarılır. İş emri düzenlemesinde stok farkları atomik işlemle uygulanır; tarihi veya parça miktarı değişen her düzeltme hareket kaydına eklenir. Stok hareketleri yeni işlemlerden itibaren ilgili parçanın alt koleksiyonunda aktör ve stok öncesi/sonrası değerlerini saklar; var olan Firestore kuralları bu koleksiyon yollarını mevcut yetkili parça erişimi kapsamında korur. Önceden kayıtlı iş emirleri ve alış faturaları hareket ekranında geçmiş işlem olarak görünür; bu eski kayıtlar için işlem yapan kullanıcı bilgisi mevcut olmadığından **Geçmiş kayıt** şeklinde işaretlenir.

Firebase kurulumu yapılana kadar e-posta/şifre girişi ve bulut kayıtları kullanılamaz. Daha önce tarayıcıda oluşturulmuş yerel demo kayıtları otomatik olarak Firestore'a taşınmaz; Firestore başlangıçta boş olur.
