// ============================================================
// Test di coerenza tra lo schema del modello (MODEL.md) e il codice
// di src/model/: segnala quando il diagramma non è stato aggiornato.
// ============================================================

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODEL_DIR = join(ROOT, "src", "model");

// Diagramma delle classi: primo blocco "classDiagram" di MODEL.md.
function classDiagram() {
    const text = readFileSync(join(ROOT, "MODEL.md"), "utf8");
    const match = text.match(/```mermaid\s*\n\s*classDiagram\n([\s\S]*?)```/);
    if (!match) {
        throw new Error("MODEL.md non contiene un blocco mermaid classDiagram");
    }
    return match[1];
}

// Classi esportate da src/model/: { nome: classe base o null }.
function exportedClasses() {
    const classes = {};
    readdirSync(MODEL_DIR).filter((file) => file.endsWith(".js")).forEach((file) => {
        const source = readFileSync(join(MODEL_DIR, file), "utf8");
        for (const [, name, base] of source.matchAll(/^export class (\w+)(?: extends (\w+))?/gm)) {
            classes[name] = base ?? null;
        }
    });
    return classes;
}

// Classi dichiarate nel diagramma, esclusi gli stereotipi (es.
// <<strategy>>), che non corrispondono a classi del codice.
function diagramClasses(diagram) {
    const names = [...diagram.matchAll(/^\s*class (\w+)\s*\{([^}]*)\}/gm)]
        .filter(([, , body]) => !/<<\w+>>/.test(body))
        .map(([, name]) => name);
    return new Set(names);
}

describe("schema del modello (MODEL.md)", function () {
    const diagram = classDiagram();
    const code = exportedClasses();

    it("contiene esattamente le classi esportate da src/model/", function () {
        expect([...diagramClasses(diagram)].sort()).toEqual(Object.keys(code).sort());
    });

    it("indica l'ereditarietà di ogni sottoclasse", function () {
        Object.entries(code)
            .filter(([, base]) => base)
            .forEach(([name, base]) => {
                expect(diagram, `manca "${base} <|-- ${name}"`).toMatch(new RegExp(`^\\s*${base} <\\|-- ${name}\\s*$`, "m"));
            });
    });
});
