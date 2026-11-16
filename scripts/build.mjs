// ============================================================
// build.mjs — Unisce i file di src/ in un unico script per
// Sandcastle: dist/sandcastle.js.
//
// Non usa un bundler: rimuove le istruzioni "import ..." e la parola
// "export" e concatena i file. Così il risultato è identico al codice
// sorgente, commenti compresi, e in Sandcastle "Cesium" resta la
// variabile globale fornita dalla pagina.
//
// L'ordine dei file si ricava dagli import relativi, a partire da
// src/main.js: ogni file viene dopo quelli che importa. Dopo la
// concatenazione tutti i file condividono lo stesso ambito, quindi i
// nomi dichiarati al primo livello devono essere diversi in ogni file
// (la build lo verifica).
//
// Genera anche dist/sandcastle.js.map (mappa sorgente riga per riga):
// nel browser e nel debugger di VS Code i breakpoint e gli errori
// puntano direttamente ai file di src/.
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
const ENTRY = "src/main.js";
const OUTPUT = path.join(ROOT, "dist", "sandcastle.js");
const MAP_NAME = "sandcastle.js.map";
const MAP_COMMENT = `//# sourceMappingURL=${MAP_NAME}`;

// --------------------------------------------------
// Ordine dei file: dipendenze prima di chi le usa
// --------------------------------------------------
//
// Restituisce i percorsi relativi a ROOT (con "/"), dall'ingresso
// seguendo gli import relativi ("./" o "../"); gli altri (es. "cesium")
// sono forniti dalla pagina.

function orderedSources(entry) {
    const ordered = [];
    const visiting = new Set();

    // Visita in profondità: prima i file importati, poi "file".
    function visit(file) {
        if (ordered.includes(file)) {
            return;
        }
        if (visiting.has(file)) {
            throw new Error(`Import circolare che coinvolge ${file}.`);
        }
        visiting.add(file);
        const code = fs.readFileSync(path.join(ROOT, file), "utf8");
        for (const match of code.matchAll(/^import\s[^;]*?from\s+["'](\.{1,2}\/[^"']+)["']/gm)) {
            visit(path.posix.join(path.posix.dirname(file), match[1]));
        }
        visiting.delete(file);
        ordered.push(file);
    }

    visit(entry);
    return ordered;
}

// Nomi dichiarati al primo livello (colonna 0) dalle righe di un file.
function topLevelNames(lines) {
    return lines
        .map((line) => /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/.exec(line.text))
        .filter(Boolean)
        .map((match) => match[1]);
}

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

// Codifica Base64 VLQ di un intero, usata dalle mappe sorgente.
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
function createSourceMap(outputLines, sources, sourcesContent) {
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
        sources: sources.map((file) => "../" + file),
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
        "// Modifica i file di src/, poi esegui",
        "// \"npm run sandcastle\" e incolla questo file in Sandcastle.",
        "// ============================================================",
        ""
    ];

    const sources = orderedSources(ENTRY);
    const outputLines = header.map((text) => ({ text }));
    const sourcesContent = [];
    const declaredIn = new Map(); // nome di primo livello -> file

    sources.forEach(function (file, sourceIndex) {
        const code = fs.readFileSync(path.join(ROOT, file), "utf8");
        sourcesContent.push(code);
        const lines = stripModuleSyntax(code, file);

        topLevelNames(lines).forEach(function (name) {
            if (declaredIn.has(name)) {
                throw new Error(
                    `"${name}" è dichiarato sia in ${declaredIn.get(name)} sia in ${file}: ` +
                    `dopo la build i file condividono lo stesso ambito, usa nomi diversi.`
                );
            }
            declaredIn.set(name, file);
        });

        outputLines.push({
            text: `// ---------------------------------------------------- ${file}`
        });
        lines.forEach(function (line) {
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
        createSourceMap(outputLines, sources, sourcesContent),
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

// Esegue la build; con --copy copia il risultato negli appunti, con
// --watch la ripete a ogni modifica dei sorgenti.
function main() {
    const args = process.argv.slice(2);

    const out = build();
    console.log(`Generato ${path.relative(ROOT, out)}`);

    if (args.includes("--copy") && copyToClipboard(out)) {
        console.log("Copiato negli appunti: in Sandcastle premi Ctrl+A, poi Ctrl+V.");
    }

    if (args.includes("--watch")) {
        let timer;
        fs.watch(path.join(ROOT, "src"), { recursive: true }, function () {
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
