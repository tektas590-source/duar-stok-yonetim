// Parça adından kategori tahmini. Kurallar sırayla denenir (ilk eşleşen kazanır),
// bu yüzden "BALATA SPREYİ" önce kimyasala, "RADYATÖR TEMİZLEYİCİ" önce
// kimyasala düşer. Türkçe karakterler ASCII'ye çevrilip aranır.

export const CATEGORIES = [
  { name: "Bakım kimyasalları & katkılar", re: /KATKI|TEMIZLE|SPREY|ONARIM KITI|TIKAMA|ARTTIRICI|TUNAP|DIVORTEX|HIJYENIK|SIVI CONTA|SES KESICI|DUMAN KESICI|SIZINTI/ },
  { name: "Fren sistemi", re: /FREN|BALATA|\bFR BR\b|\bFR DIS|\bFRN\b|\bDISK|\bDSK\b|PADS|KAMPANA|\bDOT ?4/ },
  { name: "Filtreler", re: /F\W?L\W?I?TRE|FILT|FILITRE|POL FILTER|CARBON|KARBON|GAZOL/ },
  { name: "Motor yağları & sıvılar", re: /MOTOR YAGI|\b\d{1,2}W[- ]?\d{2}\b|OLIO|ANTIF|ADBLUE|SANZIMAN YAGI|HIDROLIK YAG|YAG\b.*\bLT\b/ },
  { name: "Ateşleme", re: /BUJI|SPARK|KIZDIRMA|BOBIN|ATESLEME/ },
  { name: "Soğutma sistemi", re: /DEVIRDAIM|SU POMPA|RADYATOR|TERMOSTAT|\bFAN\b|SU DEPO|SOGUTMA/ },
  { name: "Elektrik & aydınlatma", re: /AMPUL|LAMBA|SINYAL|SENSOR|AKU\b|MARS\b|MARS MOTOR|ALTERNATOR RULMAN|ALTERNATOR\b(?!.*KAYIS)|SIGORTA|GOSTERGE|\bFAR\b|ELEK|ROLE\b|KABLO/ },
  { name: "Debriyaj & aktarma", re: /DEBRIYAJ|VOLAN|BASKI|\bAKS\b|SANZIMAN|VITES|KAVRAMA/ },
  { name: "Triger, zincir & kayışlar", re: /TRIGER|TRIGER|KAYIS|KAYISI|GERGI|EKSANTRIK|ZINCIR|DAGITIM|KRANK DISLI|DISLI LASTIG/ },
  { name: "Süspansiyon & direksiyon", re: /\bROT\b|ROTBASI|ROT BASI|ROTIL|SALINCAK|AMORTISOR|VIRAJ|ASKI|BURC|DIREKSIYON|RULMAN|HELEZON|YAY\b/ },
  { name: "Motor parçaları", re: /PISTON|SEGMAN|YATAK|SUBAP|CONTA|KECE|O ?RING|KARTER|KULBUTOR|MANIFOLD|TURBO|EGR|MOTOR TAKOZ|GEZER|SILINDIR|ENJEKTOR|CIVATA|ARA CONTA/ },
  { name: "Kaporta & dış aksam", re: /AYNA|CAMURLUK|TAMPON|DAVLUMBAZ|CERCEVE|KAPI|BANDI|SILECEK|BIJON|KAPUT|IZGARA|PANJUR/ },
];
export const OTHER = "Diğer";
export const CATEGORY_NAMES = [...CATEGORIES.map((c) => c.name), OTHER];

export function normalizeName(text) {
  return String(text || "")
    .toLocaleUpperCase("tr")
    .replace(/[İI]/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function suggestCategory(name) {
  const n = normalizeName(name);
  const hit = CATEGORIES.find((c) => c.re.test(n));
  return hit ? hit.name : OTHER;
}

// eDMS'in genel stok grubu (YPARCA) veya boş kategori → kategorisiz sayılır.
export function isUncategorized(category) {
  const c = String(category || "").trim();
  return !c || /^(YPARCA|YEDEK PARCA|YEDEK PARÇA|KATEGORISIZ|KATEGORİSİZ|-)$/i.test(c);
}
