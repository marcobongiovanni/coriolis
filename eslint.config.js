// ============================================================
// Configurazione di ESLint (npm run lint).
//
// Oltre alle regole consigliate fa rispettare le dipendenze tra i
// livelli MVVM (vedi ARCHITECTURE.md): un import non consentito è un
// errore.
// ============================================================

import js from "@eslint/js";
import globals from "globals";

// Import vietati in un livello: { gruppo di percorsi, motivo }.
function forbidImports(...rules) {
    return {
        "no-restricted-imports": ["error", {
            patterns: rules.map(([group, message]) => ({ group, message }))
        }]
    };
}

const NO_VIEW = [["**/view/**"], "Il livello View non può essere importato da qui."];
const NO_VIEWMODEL = [["**/viewmodel/**"], "Il ViewModel non può essere importato da qui."];
const NO_MODEL = [["**/model/**"], "La vista non conosce il modello: riceve il ViewModel dal costruttore."];
const NO_SERVICES = [["**/services/**"], "I servizi sono collegati solo in main.js."];
const ONLY_SERVICE_INTERFACES = [
    ["**/services/**", "!**/services/interfaces.js"],
    "Il ViewModel usa solo le interfacce dei servizi (services/interfaces.js)."
];

// Il modello, il ViewModel e la geometria non toccano il browser.
const NO_BROWSER = {
    "no-restricted-globals": ["error",
        { name: "window", message: "Non usare il browser fuori da view/, services/ e main.js." },
        { name: "document", message: "Non usare il DOM fuori da view/ e main.js." },
        { name: "navigator", message: "Usa un'interfaccia di services/interfaces.js." }
    ]
};

export default [
    {
        ignores: ["node_modules/", "dist/", "docs/", "test-results/", "playwright-report/"]
    },

    js.configs.recommended,

    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module"
        },
        rules: {
            eqeqeq: "error",
            "no-var": "error",
            "prefer-const": "error",
            "no-unused-vars": ["error", { args: "none" }],
            curly: "error",
            quotes: ["error", "double", { avoidEscape: true, allowTemplateLiterals: true }],
            semi: ["error", "always"]
        }
    },

    // Livelli dell'applicazione.
    {
        files: ["src/**/*.js"],
        languageOptions: { globals: globals.browser }
    },
    {
        files: ["src/view/**/*.js"],
        rules: forbidImports(NO_MODEL, NO_VIEWMODEL, NO_SERVICES)
    },
    {
        files: ["src/viewmodel/**/*.js"],
        rules: { ...forbidImports(NO_VIEW, ONLY_SERVICE_INTERFACES), ...NO_BROWSER }
    },
    {
        files: ["src/model/**/*.js"],
        rules: { ...forbidImports(NO_VIEW, NO_VIEWMODEL, NO_SERVICES), ...NO_BROWSER }
    },
    {
        files: ["src/geometry/**/*.js"],
        rules: {
            ...forbidImports(
                NO_VIEW, NO_VIEWMODEL, NO_SERVICES,
                [["**/model/**"], "La geometria è condivisa: non dipende dal modello."]
            ),
            ...NO_BROWSER
        }
    },
    {
        files: ["src/services/**/*.js"],
        rules: forbidImports(NO_VIEW, NO_VIEWMODEL, [["**/model/**"], "I servizi non dipendono dal modello."])
    },

    // Test, script e configurazioni (Node; i test e2e eseguono anche
    // codice nella pagina).
    {
        files: ["test/**/*.js", "scripts/**/*.mjs", "*.config.js"],
        languageOptions: { globals: globals.node }
    },
    {
        files: ["e2e/**/*.js"],
        languageOptions: { globals: { ...globals.node, ...globals.browser, Cesium: "readonly" } }
    }
];
