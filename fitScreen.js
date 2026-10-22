// Arayüzü pencereye sığdırır: küçük ekranlarda otomatik küçültür, böylece elle yakınlaştırma gerekmez.
// Tasarım referansı 1440x820; bunun altındaki pencerelerde ölçek en fazla %70'e kadar iner.
const DESIGN_WIDTH = 1440;
const DESIGN_HEIGHT = 820;
const MIN_SCALE = 0.7;
const MOBILE_BREAKPOINT = 900;

export function computeFitScale(width, height) {
  if (!width || !height || width < MOBILE_BREAKPOINT) return 1;
  const scale = Math.min(1, width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  return Math.max(MIN_SCALE, Math.round(scale * 100) / 100);
}

export function installFitScreen() {
  if (typeof window === "undefined" || !("zoom" in document.documentElement.style)) return;
  const root = document.documentElement;
  const apply = () => {
    const scale = computeFitScale(window.innerWidth, window.innerHeight);
    root.style.zoom = scale === 1 ? "" : String(scale);
    // zoom altında vh birimi belirsiz olduğundan, görünür yüksekliği piksel olarak veriyoruz.
    root.style.setProperty("--app-vh", `${window.innerHeight / scale}px`);
  };
  apply();
  window.addEventListener("resize", apply);
}
