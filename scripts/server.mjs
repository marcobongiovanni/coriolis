// ============================================================
// server.mjs — Piccolo server statico per la pagina locale.
//
// Serve la cartella del progetto e, all'indirizzo /Cesium/, la build
// di Cesium installata da npm (node_modules/cesium/Build/CesiumUnminified).
//
// Uso:
//   node scripts/server.mjs           solo server
//   node scripts/server.mjs --watch   server + build automatica (npm run dev)
// ============================================================

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./build.mjs";
import { spawn } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Build NON minificata, come in Sandcastle: mantiene i controlli
// DeveloperError (es. "This object was destroyed") che la build
// minificata elimina, così gli errori emergono anche in locale.
const CESIUM_DIR = path.join(ROOT, "node_modules", "cesium", "Build", "CesiumUnminified");
const PORT = Number(process.env.PORT) || 5173;

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".xml": "application/xml",
    ".glb": "model/gltf-binary",
    ".ktx2": "image/ktx2"
};

function resolveFile(urlPath) {
    const clean = decodeURIComponent(urlPath.split("?")[0]);
    const base = clean.startsWith("/Cesium/") ? CESIUM_DIR : ROOT;
    const relative = clean.startsWith("/Cesium/")
        ? clean.slice("/Cesium/".length)
        : clean.slice(1) || "index.html";
    const file = path.resolve(base, relative);
    // Impedisce di uscire dalle cartelle servite.
    return file === base || file.startsWith(base + path.sep) ? file : undefined;
}

const server = http.createServer(function (request, response) {
    const file = resolveFile(request.url);
    if (!file) {
        response.writeHead(403).end();
        return;
    }
    fs.readFile(file, function (error, data) {
        if (error) {
            response.writeHead(404).end("Non trovato");
            return;
        }
        response.writeHead(200, {
            "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
            "Cache-Control": "no-store"
        });
        response.end(data);
    });
});

server.on("error", function (error) {
    if (error.code === "EADDRINUSE") {
        console.error(
            `La porta ${PORT} è già in uso: probabilmente il server è già ` +
            `avviato (un altro "npm run dev" o un server lasciato dai test).\n` +
            `- Se è questo server, la pagina è già su http://localhost:${PORT}/\n` +
            `- Per trovare il processo: Get-NetTCPConnection -LocalPort ${PORT} -State Listen\n` +
            `- Oppure usa un'altra porta: $env:PORT=5174; npm run dev`
        );
        process.exit(1);
    }
    throw error;
});

server.listen(PORT, function () {
    if (process.argv.includes("--watch")) {
        // Build iniziale + ricompilazione automatica in un processo
        // separato, avviati solo se il server è partito.
        build();
        spawn(process.execPath, [path.join(ROOT, "scripts", "build.mjs"), "--watch"], {
            stdio: "inherit"
        });
    }
    console.log(`Pagina locale: http://localhost:${PORT}/`);
});
