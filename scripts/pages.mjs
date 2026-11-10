// ============================================================
// pages.mjs — Prepara la cartella docs/ per GitHub Pages.
//
// Contenuto generato:
//   docs/index.html     pagina con Cesium caricato da CDN (jsDelivr),
//                       nella stessa versione installata da npm
//   docs/sandcastle.js  lo stesso script che si incolla in Sandcastle
//   docs/.nojekyll      dice a GitHub Pages di pubblicare i file
//                       così come sono, senza elaborarli con Jekyll
//
// Titolo, descrizione e token di Cesium ion si impostano in
// pages.config.json.
//
// Uso: npm run pages
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "./build.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs");
const require = createRequire(import.meta.url);

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function readConfig() {
    const file = path.join(ROOT, "pages.config.json");
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
        title: config.title || "Simulazione CesiumJS",
        description: config.description || "",
        cesiumIonToken: (config.cesiumIonToken || "").trim()
    };
}

function pageHtml(config, cesiumVersion) {
    const cdn = `https://cdn.jsdelivr.net/npm/cesium@${cesiumVersion}/Build/Cesium`;

    // Il token è scritto come stringa JSON, con "<" sostituito da \u003c
    // perché un "</script>" nel valore non possa chiudere il blocco.
    const tokenLiteral = JSON.stringify(config.cesiumIonToken).replace(/</g, "\\u003c");
    const tokenScript = config.cesiumIonToken
        ? `    <script>Cesium.Ion.defaultAccessToken = ${tokenLiteral};</script>\n`
        : "";

    return `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(config.title)}</title>
    <meta name="description" content="${escapeHtml(config.description)}">
    <meta property="og:title" content="${escapeHtml(config.title)}">
    <meta property="og:description" content="${escapeHtml(config.description)}">
    <!-- Generato da scripts/pages.mjs: non modificarlo qui.
         CesiumJS ${cesiumVersion} da CDN (jsDelivr). -->
    <link rel="stylesheet" href="${cdn}/Widgets/widgets.css">
    <style>
        html, body, #cesiumContainer {
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
            overflow: hidden;
        }
    </style>
    <script src="${cdn}/Cesium.js"></script>
${tokenScript}</head>
<body>
    <div id="cesiumContainer"></div>
    <script src="sandcastle.js"></script>
</body>
</html>
`;
}

function main() {
    const config = readConfig();
    const cesiumVersion = require("cesium/package.json").version;

    // Script della simulazione, senza il riferimento alla mappa
    // sorgente (che serve solo in locale).
    const script = fs.readFileSync(build(), "utf8")
        .replace(/^\/\/# sourceMappingURL=.*\r?\n?/m, "");

    fs.mkdirSync(DOCS, { recursive: true });
    fs.writeFileSync(path.join(DOCS, "index.html"), pageHtml(config, cesiumVersion), "utf8");
    fs.writeFileSync(path.join(DOCS, "sandcastle.js"), script, "utf8");
    fs.writeFileSync(path.join(DOCS, ".nojekyll"), "", "utf8");

    console.log(`Generata la cartella docs/ (CesiumJS ${cesiumVersion} da CDN).`);
    if (!config.cesiumIonToken) {
        console.warn(
            "ATTENZIONE: nessun token di Cesium ion in pages.config.json.\n" +
            "La pagina funziona con il token predefinito di Cesium, che è solo\n" +
            "per prove: mostra un avviso e può smettere di funzionare.\n" +
            "Crea un token gratuito su https://ion.cesium.com/tokens, limitalo al\n" +
            "dominio del tuo sito e inseriscilo in \"cesiumIonToken\"."
        );
    }
    console.log(
        "Carica il contenuto di docs/ nella cartella docs/ del repository GitHub,\n" +
        "poi Settings -> Pages -> Deploy from a branch -> main, /docs."
    );
}

main();
