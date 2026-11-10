// Configurazione dei test unitari (Vitest): solo la cartella test/.
// I test in e2e/ sono di Playwright e si eseguono con "npm run e2e".
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.test.js"],
        environment: "node"
    }
});
