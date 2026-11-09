# Demir Eurorepar Car Service

Demir Eurorepar Car Service için React tabanlı stok ve servis yönetim uygulaması. E-posta/şifre ile giriş yapar, stok/iş emri/fatura verilerini yetkili kullanıcılarla ortak Firebase Firestore veritabanında saklar. Fatura satırları Excel'den kopyalanıp yapıştırılabilir.

## Firebase kurulumu (zorunlu)

Uygulama demo giriş veya örnek servis verisi kullanmaz. Çalıştırmadan önce Firebase projesi oluşturup şu adımları tamamlayın. Browser E2E testleri için ayrı test projesinin `VITE_FIREBASE_*` değerlerini `.env.example` yapısını izleyerek `.env.e2e` içine ekleyin; `KOMBAI_E2E_EXPECTED_PROJECT_ID` değerini de test projesinin `VITE_FIREBASE_PROJECT_ID` değeriyle aynı yapın. `npm run dev:e2e`, kimliği doğrulamadan sunucu açmaz ve `stok-16ef3` production projesini reddeder. `.env.e2e` dosyasını Git'e eklemeyin:

1. Firebase Console'da bir proje oluşturun.
2. **Authentication → Sign-in method** altında **Email/Password** sağlayıcısını etkinleştirin.
3. **Authentication → Settings → Authorized domains** bölümüne `localhost` ve Vercel alan adınızı ekleyin.
4. **Firestore Database** oluşturun.
5. Firebase Console'daki **Firestore → Rules** bölümüne bu projedeki [`firestore.rules`](./firestore.rules) içeriğini kopyalayıp yayınlayın. Kurallar yalnızca doğrulanmış ve izin verilmiş e-posta adreslerine izin verir; `tektas590@gmail.com` yönetici hesabıdır. Araç uyumluluğu kayıtları `fitments` koleksiyonunda tutulur; bu koleksiyon kural listesine eklendiğinden kuralları yeniden yayınlamanız gerekir.
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
- **Stok Takip** sayfası: sinematik stok özeti (adet, alış/satış değeri, stok sağlığı), Tükendi/Kritik/Azalıyor/Yeterli filtreleri, kategori/marka/favori/arşiv filtreleri, sıralama, ABC sınıfı, 90 günlük tüketime göre "kaç gün yeter" hesabı ve parça detay çekmecesi (60 günlük stok grafiği, alış geçmişi, hareket zaman çizelgesi, hızlı stok düzeltme)
- **eDMS Alış Faturası** sekmesi: eDMS "Fatura Raporu" (WDMR010) Excel çıktısını sürükle-bırak ile yükleyin; yalnızca "Satın Alma" faturaları alınır, her satırın net/KDV tutarı ve fatura toplamı eDMS değerleriyle birebir kontrol edilir, stok kodları sistemdeki kartlarla eşleştirilir (boşluk/tire farkları dahil), zaten kayıtlı faturalar atlanır; onaylanan faturalar stoğa ve hareket geçmişine işlenir
- **eDMS Sayım Mutabakatı** sekmesi: eDMS stok listesi veya sayım Excel'i ile sistem stoğunu karşılaştırma (eski "Stok Karşılaştır" sayfası bu sekmeye taşındı)
- Plaka, marka, model ve müşteriyle eşleştirilen iş emirleri; tarihleri düzenlenebilir, tamamlanabilir ve iptal edilebilir. Düzenleme/iptalde stok farkları denetim hareketleriyle atomik uygulanır; iptal kaydı denetim için saklanır
- Alış faturalarında belge tarihi seçilebilir; tarih, faturaya bağlı stok hareketlerine iş tarihi olarak kaydedilir
- İş emri parça satırlarında ad, SKU veya kodun sonuyla arama; Excel'den parça kodu satırlarını yapıştırarak toplu eşleştirme
- Araç Servis Geçmişi sayfasında plakaya göre ziyaret, tarih, müşteri ve kullanılan parçaları görüntüleme
- Araç Uyumluluğu sayfasında marka, model, Dizel/Benzin, motor hacmi ve uyumlu parçaları elle kaydetme; arama ve düzenleme. Ayrıca marka, model veya plakayla iş emirlerinde kullanılan parçaları görme
- Stok Hareketleri sayfasında fatura girişi, iş emri çıkışı, sipariş teslimi ve stok düzeltmelerini kullanıcı, kaynak belge ve stok bakiyesiyle izleme
- Dashboard'da son 7 günlük ve 6 aylık ciro grafikleri ile birleşik son hareket akışı
- Parçayı silmek yerine arşivleme; kısa süreli bildirimden işlemi geri alma
- Parça seçerek, stok kodunu yazarak veya Excel'den kopyalayarak alış faturası girişi; yeni kodlarda parça kartı otomatik oluşur, stok ve satış fiyatı güncellenir
- Alış, parça satış ve işçilik fiyatları KDV hariç saklanır; iş emrinde parça ara toplamına tek işçilik tutarı eklenir ve birleşik tutara bir kez %20 KDV uygulanır. İş emri cirosu KDV dahil gösterilir; stok hareketleri ve parça maliyeti yalnızca parça satırlarından hesaplanır
- Kritik seviyedeki stoklardan sipariş taslağı oluşturma ve teslim alındığında stoğa işleme
- En çok satan parçalar, servis cirosu ve iş emri raporları
- Gösterge panelinde açık iş emirleri ve kritik stoklara hızlı erişim, son işler, parça performansı ve ciro akışı; açık/koyu tema

## Yetki ve fatura kullanımı

İlk kullanımda **Hesap oluşturun** bölümünden `tektas590@gmail.com` adresiyle yönetici hesabı oluşturun ve gelen doğrulama bağlantısını açın. İlk başarılı yönetici girişinde yeni parola belirleme ekranı zorunlu olarak açılır. Firebase parola şartı nedeniyle geçici parola da en az 6 karakter olmalıdır; `1234` Firebase tarafından kabul edilmez ve kod içine hiçbir parola gömülmez. Daha sonra `serkan.tektas` kullanıcı adı veya yönetici e-posta adresiyle giriş yapılabilir.

Yönetici olarak **Yetkili Kullanıcılar** sayfasından erişim verilecek kişilerin e-posta adreslerini ekleyin. Bu kişiler hesap oluşturup e-posta adreslerini doğrular; yönetici onayı olmadan servis verileri açılamaz. Erişimi kaldırmak için listedeki hesabı silin. İzin listesi ve uygulama verileri Firestore'da tutulur. Güvenli ilk parola değişiminden sonra yönetici giriş bilgilerini paylaşmak yerine kullanıcı kendi hesabını oluşturmalıdır.

Alış faturasında fatura numarası ve tedarikçi girilir. **Yeni stok kodu oluştur** bölümünden SKU, adet, alış ve satış fiyatını girip **Faturaya ekle** dediğinizde parça, faturanın yanındaki satır listesine eklenir; nihai kayıtta stok kartı, fatura numarası ve stok hareketi birlikte kaydedilir. Yeni SKU için parça adı gereklidir; kayıtlı SKU için ad otomatik bulunur. Kayıtlı parçalardan seçme ve **Kopyala / yapıştır** girişleri de kullanılabilir. Yapıştırma `SKU, Parça Adı, Adet, Alış Fiyatı, Satış Fiyatı` sütunlarını destekler. Tutarlar KDV hariç girilir; fatura özeti KDV hariç ara toplamı, %20 KDV tutarını ve KDV dahil toplamı gösterir. İş emrinde işçilik tutarı KDV hariç tek bir tutar olarak girilir; parça ara toplamına eklenir ve birleşik ara toplam üzerinden %20 KDV bir kez hesaplanır. Eski kayıtlarda işçilik bulunmuyorsa 0 kabul edilir. İşçilik stok satırı değildir; stok, satılan adet, hareket kayıtları ve tahmini parça maliyeti yalnızca parçalardan hesaplanır. İş emri cirosu birleşik toplamın KDV dahil tutarıdır. TSV, CSV ve noktalı virgülle ayrılmış metin kabul edilir; hatalı satırlar açıkça bildirilir.

İş emrinde bir aracın plakası, marka/modeli ve kullanılan parçaları kaydedildikçe araç geçmişi ve marka/model/plaka aramasıyla araç bazlı parça kullanım listeleri oluşur. Tamamlanan iş emirleri açık iş sayısından çıkar ama ciroda kalır. İptal edilen iş emri kaydı denetim için korunur; parçalar stoğa iade edilir ve iptal kaydı ciro/araç parça sonuçlarından çıkarılır. İş emri düzenlemesinde stok farkları atomik işlemle uygulanır; tarihi veya parça miktarı değişen her düzeltme hareket kaydına eklenir. Stok hareketleri yeni işlemlerden itibaren ilgili parçanın alt koleksiyonunda aktör ve stok öncesi/sonrası değerlerini saklar; var olan Firestore kuralları bu koleksiyon yollarını mevcut yetkili parça erişimi kapsamında korur. Önceden kayıtlı iş emirleri ve alış faturaları hareket ekranında geçmiş işlem olarak görünür; bu eski kayıtlar için işlem yapan kullanıcı bilgisi mevcut olmadığından **Geçmiş kayıt** şeklinde işaretlenir.

Firebase kurulumu yapılana kadar e-posta/şifre girişi ve bulut kayıtları kullanılamaz. Daha önce tarayıcıda oluşturulmuş yerel demo kayıtları otomatik olarak Firestore'a taşınmaz; Firestore başlangıçta boş olur.

## Başka bir işletmeye devretmek (white-label)

Uygulama görünür marka metinlerini (işletme adı, kısa etiket, slogan, giriş ekranı, üst çubuk, AI asistan, yedekleme raporu) koda gömmez; **İşletme Ayarları** sayfasından (yalnızca yönetici hesabına görünür) değiştirilir ve değişiklik anında tüm ekranlara yansır. Sistemi yeni bir işletmeye devrederken kod tarafında yapılması gereken, hesap erişimiyle ilgili iki adımdır:

1. **Yeni Firebase projesi:** Yukarıdaki "Firebase kurulumu" adımlarını yeni işletme için ayrı bir Firebase projesiyle tekrarlayın. Aynı projeyi iki işletme arasında paylaşmayın; aksi halde veriler karışır.
2. **Yönetici hesabını değiştirin:** `firebase.js` dosyasındaki `OWNER_EMAIL` sabitini ve `firestore.rules` dosyasındaki iki `tektas590@gmail.com` referansını yeni işletmenin yönetici e-postasıyla değiştirip Firestore kurallarını yeniden yayınlayın. Bu adım atlanırsa yeni işletme panelde yönetici yetkisi alamaz.
3. **Ortam değişkenlerini ayarlayın:** `.env.local` (yerel) ve Vercel **Environment Variables** (üretim) içindeki `VITE_FIREBASE_*` değerlerini yeni projenin değerleriyle doldurun. `firebase.js` içindeki yedek (fallback) değerler yalnızca bu deponun orijinal geliştirme ortamı içindir; yeni bir dağıtımda bu ortam değişkenlerini mutlaka ayarlayın (aşağıdaki güvenlik notuna bakın).
4. Siteye yeni yönetici hesabıyla girip **Hesap oluşturun** ile ilk kaydı yapın, ardından **İşletme Ayarları**'ndan adı, kısa etiketi ve sloganı girin.

## Satış öncesi güvenlik kontrol listesi

- **`firebase.js` içindeki yedek Firebase değerleri:** `VITE_FIREBASE_*` ortam değişkenleri tanımlı değilse kod bu depodaki orijinal projeye (`stok-16ef3`) bağlanır. Bu, istemci tarafı bir yapılandırma olduğu için tek başına bir sızıntı değildir (gerçek yetkilendirme Firestore kurallarındadır), ama bir alıcı ortam değişkenlerini ayarlamayı unutursa farkında olmadan orijinal işletmenin veritabanına bağlanabilir. Yeni bir kurulumda ortam değişkenlerinin gerçekten ayarlandığını doğrulayın; dağıtımdan önce bu sabit yedek değerleri kaldırmak (ortam değişkeni yoksa bağlantıyı reddetmek) daha güvenlidir.
- **Yönetici e-postası iki yerde sabit:** `firebase.js` → `OWNER_EMAIL` ve `firestore.rules` → `isOwner()`. İkisi birbiriyle tutarlı olmalı; biri güncellenip diğeri unutulursa yönetici erişimi bozulur.
- **Firestore kuralları alan bazlı doğrulama yapmaz:** Yetkili bir kullanıcı `parts`, `invoices` gibi koleksiyonlara herhangi bir alanı yazabilir; sunucu tarafında şema doğrulaması yoktur (tutarlar negatif girilemez gibi kontroller yalnızca istemci kodundadır). Küçük/orta ölçekli kullanım için makul bir risktir, kurumsal bir alıcıya satarken belirtilmesi gereken bir sınırdır.
- **`.env*` dosyaları `.gitignore`'da doğru şekilde hariç tutulmuş**; gerçek anahtarlar repoya işlenmemiş durumda.
- Üretime geçmeden önce Firebase Console'da **App Check** etkinleştirmek, istemci API'lerinin yalnızca gerçek uygulamadan çağrılmasını sağlayarak ek bir katman ekler; bu depoda henüz kurulu değildir.
