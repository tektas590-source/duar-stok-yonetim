import { readFileSync } from "node:fs";
import { createServer } from "vite";

const testEnvPath = ".env.e2e";
const requiredKeys = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "KOMBAI_E2E_EXPECTED_PROJECT_ID",
];
const productionProjectId = "stok-16ef3";

function parseEnvFile(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const separator = trimmed.indexOf("=");
    if (separator < 0) return [];
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return [[key, value]];
  }));
}

let testEnv;
try {
  testEnv = parseEnvFile(readFileSync(testEnvPath, "utf8"));
} catch {
  console.error("E2E sunucusu açılmadı: .env.e2e bulunamadı. Ayrı test Firebase projesinin ayarlarını ekleyin.");
  process.exit(1);
}

const missingKeys = requiredKeys.filter((key) => !testEnv[key]);
if (missingKeys.length) {
  console.error(`E2E sunucusu açılmadı: .env.e2e içinde gerekli alanlar eksik (${missingKeys.join(", ")}).`);
  process.exit(1);
}
if (testEnv.VITE_FIREBASE_PROJECT_ID.toLowerCase() === productionProjectId || testEnv.KOMBAI_E2E_EXPECTED_PROJECT_ID.toLowerCase() === productionProjectId) {
  console.error("E2E sunucusu açılmadı: production Firebase projesi kullanılamaz.");
  process.exit(1);
}
if (testEnv.VITE_FIREBASE_PROJECT_ID !== testEnv.KOMBAI_E2E_EXPECTED_PROJECT_ID) {
  console.error("E2E sunucusu açılmadı: Firebase project id beklenen test project id ile eşleşmiyor.");
  process.exit(1);
}
if (testEnv.VITE_FIREBASE_AUTH_DOMAIN.toLowerCase().includes(productionProjectId)) {
  console.error("E2E sunucusu açılmadı: production Firebase Auth domain kullanılamaz.");
  process.exit(1);
}

const server = await createServer({
  configFile: false,
  mode: "e2e",
  server: { host: "127.0.0.1" },
});
await server.listen();
server.printUrls();
console.info("E2E sunucusu ayrı Firebase proje ayarlarıyla hazır; gizli değerler gösterilmedi.");

let shuttingDown = false;
async function closeServer() {
  if (shuttingDown) return;
  shuttingDown = true;
  await server.close();
  process.exit(0);
}
process.once("SIGINT", closeServer);
process.once("SIGTERM", closeServer);
