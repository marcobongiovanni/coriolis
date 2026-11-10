// ============================================================
// build.mjs — Unisce src/physics.js e src/app.js in un unico script
// per Sandcastle: dist/sandcastle.js.
//
// Non usa un bundler: rimuove le istruzioni "import ..." e la parola
// "export" e concatena i file nell'ordine indicato. Così il risultato
// è identico al codice sorgente, commenti compresi, e in Sandcastle
// "Cesium" resta la variabile globale fornita dalla pagina.
//
// Genera anche dist/sandcastle.js.map (mappa sorgente riga per riga):
// nel browser e nel debugger di VS Code i breakpoint e gli errori
// puntano direttamente a src/physics.js e src/app.js.
//
// Uso:
//   node scripts/build.mjs           genera dist/sandcastle.js
//   node scripts/build.mjs --copy    ...e lo copia negli appunti
//   node scripts/build.mjs --watch   rigenera a ogni modifica in src/
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = ["src/physics.js", "src/app.js"]; // ordine di concatenazione
const OUTPUT = path.join(ROOT, "dist", "sandcastle.js");
const MAP_NAME = "sandcastle.js.map";
const MAP_COMMENT = `//# sourceMappingURL=${MAP_NAME}`;

// --------------------------------------------------
// Rimozione della sintassi dei moduli, riga per riga
// --------------------------------------------------
//
// Restituisce le righe da tenere, ciascuna con il proprio numero di
// riga originale (per la mappa sorgente).

function stripModuleSyntax(code, file) {
    const lines = code.split(/\r?\n/);
    const kept = [];
    let insideImport = false;

    lines.forEach(function (line, index) {
        if (insideImport || /^import\s/.test(line)) {
            // Un import può occupare più righe: termina al ";".
            insideImport = !/;\s*$/.test(line);
            return;
        }

        const text = line.replace(/^export\s+(?=(const|let|function|class)\b)/, "");
        if (/^\s*(import|export)\b/.test(text)) {
            throw new Error(
                `${file}:${index + 1}: sintassi di modulo non supportata ` +
                `dalla build: "${text.trim()}". Usa solo ` +
                `"import { ... } from" e "export const/let/function".`
            );
        }
        kept.push({ text: text, sourceLine: index });
    });

    // Elimina le righe vuote iniziali e finali.
    while (kept.length && kept[0].text.trim() === "") {
        kept.shift();
    }
    while (kept.length && kept[kept.length - 1].text.trim() === "") {
        kept.pop();
    }
    return kept;
}

// --------------------------------------------------
// Mappa sorgente (formato v3, una corrispondenza per riga)
// --------------------------------------------------

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlq(value) {
    let v = value < 0 ? (-value << 1) | 1 : value << 1;
    let out = "";
    do {
        let digit = v & 31;
        v >>>= 5;
        if (v > 0) {
            digit |= 32;
        }
        out += BASE64[digit];
    } while (v > 0);
    return out;
}

// outputLines: [{ text, source?: indice in SOURCES, sourceLine? }]
function createSourceMap(outputLines, sourcesContent) {
    let previousSource = 0;
    let previousLine = 0;
    const mappings = outputLines.map(function (line) {
        if (line.source === undefined) {
            return "";
        }
        // [colonna generata, sorgente, riga, colonna]: valori relativi
        // al segmento precedente (la colonna generata riparte da 0).
        const segment =
            vlq(0) +
            vlq(line.source - previousSource) +
            vlq(line.sourceLine - previousLine) +
            vlq(0);
        previousSource = line.source;
        previousLine = line.sourceLine;
        return segment;
    }).join(";");

    return JSON.stringify({
        version: 3,
        file: "sandcastle.js",
        sources: SOURCES.map((file) => "../" + file),
        sourcesContent: sourcesContent,
        names: [],
        mappings: mappings
    });
}

// --------------------------------------------------
// Build
// --------------------------------------------------

export function build() {
    const header = [
        "// ============================================================",
        "// FILE GENERATO da scripts/build.mjs — non modificarlo qui.",
        "// Modifica src/physics.js e src/app.js, poi esegui",
        "// \"npm run sandcastle\" e incolla questo file in Sandcastle.",
        "// ============================================================",
        ""
    ];

    const outputLines = header.map((text) => ({ text }));
    const sourcesContent = [];

    SOURCES.forEach(function (file, sourceIndex) {
        const code = fs.readFileSync(path.join(ROOT, file), "utf8");
        sourcesContent.push(code);

        outputLines.push({
            text: `// ---------------------------------------------------- ${file}`
        });
        stripModuleSyntax(code, file).forEach(function (line) {
            outputLines.push({
                text: line.text,
                source: sourceIndex,
                sourceLine: line.sourceLine
            });
        });
        outputLines.push({ text: "" });
    });

    const code = outputLines.map((line) => line.text).join("\n");

    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, code + MAP_COMMENT + "\n", "utf8");
    fs.writeFileSync(
        path.join(path.dirname(OUTPUT), MAP_NAME),
        createSourceMap(outputLines, sourcesContent),
        "utf8"
    );
    return OUTPUT;
}

// Testo da incollare in Sandcastle: senza il riferimento alla mappa
// sorgente, che lì non esiste.
function sandcastleText(file) {
    return fs.readFileSync(file, "utf8").replace(MAP_COMMENT + "\n", "");
}

// Copia il testo negli appunti con lo strumento del sistema operativo.
function copyToClipboard(file) {
    const text = sandcastleText(file);
    let result;
    if (process.platform === "win32") {
        // Set-Clipboard di PowerShell con input UTF-8: "clip" rovinerebbe
        // i caratteri accentati e i simboli come "°".
        result = spawnSync("powershell.exe", [
            "-NoProfile",
            "-Command",
            "[Console]::InputEncoding = [Text.Encoding]::UTF8; " +
            "Set-Clipboard -Value ([Console]::In.ReadToEnd())"
        ], { input: text, encoding: "utf8" });
    } else if (process.platform === "darwin") {
        result = spawnSync("pbcopy", [], { input: text });
    } else {
        result = spawnSync("xclip", ["-selection", "clipboard"], { input: text });
    }
    if (result.error || result.status !== 0) {
        console.warn(
            "Impossibile copiare negli appunti: apri dist/sandcastle.js e copialo a mano."
        );
        return false;
    }
    return true;
}

function main() {
    const args = process.argv.slice(2);

    const out = build();
    console.log(`Generato ${path.relative(ROOT, out)}`);

    if (args.includes("--copy") && copyToClipboard(out)) {
        console.log("Copiato negli appunti: in Sandcastle premi Ctrl+A, poi Ctrl+V.");
    }

    if (args.includes("--watch")) {
        let timer;
        fs.watch(path.join(ROOT, "src"), function () {
            clearTimeout(timer);
            timer = setTimeout(function () {
                try {
                    build();
                    console.log(`[${new Date().toLocaleTimeString()}] Ricompilato.`);
                } catch (error) {
                    console.error(error.message);
                }
            }, 100);
        });
        console.log("In attesa di modifiche in src/ ...");
    }
}

// Eseguito solo da riga di comando, non quando viene importato.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
