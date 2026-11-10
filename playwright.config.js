// ============================================================
// Configurazione dei test end-to-end (Playwright).
//
//   npm run e2e      ricompila dist/sandcastle.js ed esegue i test
//   npm run e2e:ui   come sopra, con l'interfaccia grafica di Playwright
//
// I test aprono index.html, che carica lo stesso file da incollare in
// Sandcastle, servito da scripts/server.mjs.
// ============================================================

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT) || 5173;

// Browser usato dai test:
// - su Windows, per impostazione predefinita, Microsoft Edge già
//   installato nel sistema: non serve scaricare nulla con
//   "npm run e2e:install" (utile se il PC non permette di eseguire
//   programmi scaricati, es. con BeyondTrust);
// - altrove, il Chromium di Playwright ("npm run e2e:install").
// Si può forzare con PW_CHANNEL (es. "chrome", "msedge") oppure
// indicare un eseguibile con PW_CHROME_PATH.
const channel = process.env.PW_CHANNEL ||
    (process.platform === "win32" && !process.env.PW_CHROME_PATH ? "msedge" : undefined);

// Opzionale: WebGL software (per macchine senza GPU, es. integrazione
// continua). Su un PC Windows normale non serve.
const softwareGL = process.env.PW_SOFTWARE_GL === "1"
    ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    : [];

export default defineConfig({
    testDir: "e2e",
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    reporter: [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: `http://localhost:${PORT}`,
        viewport: { width: 1400, height: 900 },
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
        launchOptions: {
            args: softwareGL,
            // Opzionale: usare un Chrome già installato.
            executablePath: process.env.PW_CHROME_PATH || undefined
        }
    },
    projects: [
        {
            name: channel || "chromium",
            use: {
                ...devices["Desktop Chrome"],
                channel: channel,
                viewport: { width: 1400, height: 900 }
            }
        }
    ],
    webServer: {
        command: "node scripts/server.mjs",
        port: PORT,
        reuseExistingServer: true
    }
});
