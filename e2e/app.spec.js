// ============================================================
// Test end-to-end dell'interfaccia (Playwright).
//
// Ogni test apre la pagina locale, che esegue lo stesso
// dist/sandcastle.js da incollare in Sandcastle.
// ============================================================

import { test, expect } from "@playwright/test";

// --------------------------------------------------
// Strumenti
// --------------------------------------------------

// Apre la pagina, blocca le richieste esterne (mappe di Cesium ion:
// i test non devono dipendere dalla rete) e registra gli errori:
// - eccezioni non gestite (es. nei gestori dei pulsanti);
// - errori di rendering: Cesium li intercetta, mostra "An error
//   occurred while rendering" e li scrive in console.error.
async function openApp(page) {
    const errors = [];
    page.on("pageerror", function (error) {
        errors.push(error.message);
    });
    page.on("console", function (message) {
        if (message.type() === "error" && /render/i.test(message.text())) {
            errors.push(message.text());
        }
    });
    await page.route("**/*", function (route) {
        const url = new URL(route.request().url());
        return url.hostname === "localhost" ? route.continue() : route.abort();
    });
    await page.goto("/");
    await page.waitForFunction(function () {
        return window.__coriolis !== undefined;
    });
    await page.evaluate(function () {
        window.__renderErrors = [];
        window.__coriolis.viewer.scene.renderError.addEventListener(
            function (scene, error) {
                window.__renderErrors.push(String(error));
            }
        );
    });
    return errors;
}

// Verifica che non ci siano stati errori: eccezioni, messaggi di
// errore di rendering e errori segnalati da scene.renderError.
async function expectNoErrors(page, errors) {
    const renderErrors = await page.evaluate(() => window.__renderErrors);
    expect([...errors, ...renderErrors]).toEqual([]);
}

const playButton = (page) => page.getByRole("button", { name: /^(Avvia|Pausa)$/ });
const stopButton = (page) => page.getByRole("button", { name: "Stop (reset)" });
const pickButton = (page) => page.locator("#simPanel .sim-text-button");

// Valore numerico di una riga della sezione Stato (es. "Tempo").
async function statusValue(page, label) {
    const text = await page.locator(".sim-status").textContent();
    const line = text.split("\n").find((l) => l.startsWith(label + ":"));
    return parseFloat(line.slice(label.length + 1).trim());
}

async function runFor(page, milliseconds) {
    await playButton(page).click();
    await page.waitForTimeout(milliseconds);
    await playButton(page).click();
}

// --------------------------------------------------
// Test
// --------------------------------------------------

test("la pagina si carica senza errori", async ({ page }) => {
    const errors = await openApp(page);
    await expect(page.locator("#simPanel h2")).toHaveText("Accelerazione di Coriolis");
    expect(await statusValue(page, "Tempo")).toBe(0);
    await expectNoErrors(page, errors);
});

// Verifica l'inquadratura iniziale: la telecamera guarda la sfera da
// azimuth 150° (sud-sud-est) ed elevazione 45° nella terna locale del punto
// di partenza, con Up complanare a normale e direzione di vista (e
// rivolto verso l'alto), alla distanza in cui la Terra occupa il 95% della larghezza.
async function expectEarthFramedOnStartPoint(page) {
    const framing = await page.evaluate(() => {
        const { viewer, settings, physics } = window.__coriolis;
        const camera = viewer.camera;
        const C3 = Cesium.Cartesian3;

        const enu = Cesium.Transforms.eastNorthUpToFixedFrame(settings.startSurfacePointECEF);
        const toEnu = Cesium.Matrix4.inverseTransformation(enu, new Cesium.Matrix4());
        const normal = C3.fromCartesian4(Cesium.Matrix4.getColumn(enu, 2, new Cesium.Cartesian4()));

        // Direzione sfera -> telecamera, nella terna Est-Nord-Su.
        const offset = C3.subtract(camera.positionWC, physics.position, new C3());
        const local = Cesium.Matrix4.multiplyByPointAsVector(toEnu, offset, new C3());
        C3.normalize(local, local);

        const toSphere = C3.normalize(C3.negate(offset, new C3()), new C3());
        const canvas = viewer.scene.canvas;
        // Larghezza della Terra sullo schermo: proietta molti punti
        // del bordo del disco visto dalla telecamera e ne prende
        // l'estensione orizzontale in pixel.
        const R = Cesium.Ellipsoid.WGS84.maximumRadius;
        const toCam = C3.normalize(camera.positionWC, new C3());
        const D = C3.magnitude(camera.positionWC);
        const limbCenter = C3.multiplyByScalar(toCam, R * R / D, new C3());
        const limbRadius = R * Math.sqrt(1 - (R / D) ** 2);
        const u1 = C3.normalize(C3.cross(toCam, C3.UNIT_Z, new C3()), new C3());
        const u2 = C3.cross(toCam, u1, new C3());
        let minX = Infinity;
        let maxX = -Infinity;
        for (let i = 0; i < 3600; i++) {
            const t = (2 * Math.PI * i) / 3600;
            const p = C3.add(
                limbCenter,
                C3.add(
                    C3.multiplyByScalar(u1, limbRadius * Math.cos(t), new C3()),
                    C3.multiplyByScalar(u2, limbRadius * Math.sin(t), new C3()),
                    new C3()
                ),
                new C3()
            );
            const xy = viewer.scene.cartesianToCanvasCoordinates(p);
            if (xy) {
                minX = Math.min(minX, xy.x);
                maxX = Math.max(maxX, xy.x);
            }
        }

        return {
            azimuth: Cesium.Math.toDegrees(Math.atan2(local.x, local.y)),
            elevation: Cesium.Math.toDegrees(Math.asin(local.z)),
            lookAtSphere: C3.dot(toSphere, camera.directionWC),
            // Prodotto misto: 0 se Up, normale e direzione sono complanari.
            coplanarity: C3.dot(camera.upWC, C3.cross(normal, camera.directionWC, new C3())),
            upAlongNormal: C3.dot(camera.upWC, normal),
            earthLeft: minX,
            earthRight: maxX,
            width: canvas.clientWidth
        };
    });
    expect(framing.azimuth).toBeCloseTo(150, 3);
    expect(framing.elevation).toBeCloseTo(45, 3);
    expect(framing.lookAtSphere).toBeCloseTo(1, 6);
    expect(Math.abs(framing.coplanarity)).toBeLessThan(1e-6);
    expect(framing.upAlongNormal).toBeGreaterThan(0);
    // La Terra occupa il 95% della larghezza, tutta dentro la vista.
    const earthWidth = framing.earthRight - framing.earthLeft;
    expect(Math.abs(earthWidth / framing.width - 0.95)).toBeLessThan(0.005);
    expect(framing.earthLeft).toBeGreaterThan(0);
    expect(framing.earthRight).toBeLessThan(framing.width);
    return framing;
}

test("all'avvio la sfera è a quota 0 e la Terra occupa il 95% della larghezza", async ({ page }) => {
    const errors = await openApp(page);
    expect(await statusValue(page, "Quota")).toBe(0);
    await expect(page.getByLabel("Quota di partenza [km]")).toHaveValue("0");
    await expectEarthFramedOnStartPoint(page);
    await expectNoErrors(page, errors);
});

test.describe("con la posizione geografica consentita", () => {
    test.use({
        geolocation: { latitude: 41.9, longitude: 12.5 },
        permissions: ["geolocation"]
    });

    test("la sfera parte dalla posizione del PC", async ({ page }) => {
        const errors = await openApp(page);
        await expect.poll(() => page.evaluate(() => {
            const s = window.__coriolis.settings;
            return [s.startLatitudeDeg, s.startLongitudeDeg];
        })).toEqual([41.9, 12.5]);
        await expect(page.getByLabel("Latitudine [°]")).toHaveValue("41.9");
        await expect(page.getByLabel("Longitudine [°]")).toHaveValue("12.5");
        expect(await statusValue(page, "Quota")).toBe(0);

        // L'inquadratura è ricalcolata sul nuovo punto di partenza.
        await expectEarthFramedOnStartPoint(page);
        await expectNoErrors(page, errors);
    });
});

test("play/pausa: durante la simulazione i controlli sono disattivati", async ({ page }) => {
    const errors = await openApp(page);

    await playButton(page).click();
    await expect(playButton(page)).toHaveAccessibleName("Pausa");
    await expect(stopButton(page)).toBeDisabled();
    await expect(pickButton(page)).toBeDisabled();
    await expect(page.getByLabel("Latitudine [°]")).toBeDisabled();
    await expect(page.getByLabel("Modulo [km/h] relativa (ECEF)")).toBeDisabled();
    await expect(page.getByLabel("Usa Terra sferica")).toBeDisabled();
    // Le caselle di visualizzazione restano attive.
    await expect(page.getByTitle("Velocità ECI")).toBeEnabled();

    await page.waitForTimeout(1000);
    await playButton(page).click();
    await expect(playButton(page)).toHaveAccessibleName("Avvia");
    await expect(stopButton(page)).toBeEnabled();
    expect(await statusValue(page, "Tempo")).toBeGreaterThan(0);
    await expectNoErrors(page, errors);
});

test("stop dopo una simulazione riporta a t = 0 senza eccezioni", async ({ page }) => {
    // Regressione: il materiale condiviso delle tracce veniva
    // distrutto dal Reset e il rendering si bloccava.
    const errors = await openApp(page);
    await runFor(page, 3000);
    await stopButton(page).click();
    await expect.poll(() => statusValue(page, "Tempo")).toBe(0);
    await page.waitForTimeout(500); // qualche frame dopo il Reset
    await runFor(page, 1000);
    await stopButton(page).click();
    await expectNoErrors(page, errors);
});

test("la sfera cade e accelera", async ({ page }) => {
    const errors = await openApp(page);
    // All'avvio la sfera è a quota 0: la si solleva prima.
    const altitude = page.getByLabel("Quota di partenza [km]");
    await altitude.fill("225");
    await altitude.press("Enter");
    await expect.poll(() => statusValue(page, "Quota")).toBe(225);
    const altitude0 = await statusValue(page, "Quota");
    await playButton(page).click();
    await expect.poll(() => statusValue(page, "Quota")).toBeLessThan(altitude0 - 10);
    await playButton(page).click();
    expect(await statusValue(page, "v ECEF")).toBeGreaterThan(0);
    await expectNoErrors(page, errors);
});

test("Punto iniziale: richiede lo stop se il tempo è avanzato", async ({ page }) => {
    await openApp(page);
    await runFor(page, 500);

    await pickButton(page).click();
    await expect(page.locator(".sim-error")).toBeVisible();
    await expect(page.locator(".sim-error")).toContainText("Reset");
    await expect(pickButton(page)).toHaveText("Punto iniziale");

    await stopButton(page).click();
    await pickButton(page).click();
    await expect(pickButton(page)).toHaveText("Annulla");
    await pickButton(page).click();
    await expect(pickButton(page)).toHaveText("Punto iniziale");
});

test("la longitudine è ciclica tra 0° e 359°", async ({ page }) => {
    await openApp(page);
    const longitude = page.getByLabel("Longitudine [°]");

    await longitude.fill("1");
    await longitude.press("ArrowDown");
    await longitude.press("ArrowDown");
    await expect(longitude).toHaveValue("359");

    await longitude.press("ArrowUp");
    await longitude.press("ArrowUp");
    await expect(longitude).toHaveValue("1");

    const settings = await page.evaluate(() => window.__coriolis.settings.startLongitudeDeg);
    expect(settings).toBe(1);
});

test("la latitudine è limitata a ±90°", async ({ page }) => {
    await openApp(page);
    const latitude = page.getByLabel("Latitudine [°]");
    await latitude.fill("120");
    await latitude.press("Enter");
    await expect(latitude).toHaveValue("90");
});

test("velocità relativa e assoluta restano coerenti", async ({ page }) => {
    await openApp(page);

    await page.getByLabel("Modulo [km/h] relativa (ECEF)").fill("1000");
    await page.getByLabel("Azimuth [°] relativa (ECEF)").fill("45");
    await page.getByLabel("Elevazione [°] relativa (ECEF)").fill("30");
    await page.getByLabel("Elevazione [°] relativa (ECEF)").press("Enter");

    // Velocità relativa calcolata dallo stato fisico (v - ω × r).
    const relativeKmh = await page.evaluate(() => {
        const { physics } = window.__coriolis;
        const OMEGA = 7.292115e-5;
        const p = physics.position;
        const v = physics.velocity;
        return Math.hypot(v.x + OMEGA * p.y, v.y - OMEGA * p.x, v.z) * 3.6;
    });
    expect(relativeKmh).toBeCloseTo(1000, 6);
    expect(await statusValue(page, "v ECEF")).toBe(1000);

    // La terna assoluta è stata ricalcolata e corrisponde allo stato.
    const absoluteField = parseFloat(
        await page.getByLabel("Modulo [km/h] assoluta (ECI)").inputValue()
    );
    const absoluteKmh = await page.evaluate(() => {
        const v = window.__coriolis.physics.velocity;
        return Math.hypot(v.x, v.y, v.z) * 3.6;
    });
    expect(absoluteField).toBeCloseTo(absoluteKmh, 2);
    expect(absoluteField).not.toBeCloseTo(1000, 0);
});

test("le caselle di Visualizzazione nascondono e mostrano gli oggetti", async ({ page }) => {
    const errors = await openApp(page);

    const isShown = () => page.evaluate(() => {
        const s = window.__coriolis;
        return {
            arrowEci: s.arrows.absolute.show,
            arrowEcef: s.arrows.relative.show,
            frameEci: s.frames.eci.every((p) => p.show),
            frameEcef: s.frames.ecef.every((p) => p.show)
        };
    });

    expect(await isShown()).toEqual({ arrowEci: true, arrowEcef: true, frameEci: true, frameEcef: true });

    await page.getByTitle("Velocità ECI").uncheck();
    await page.getByTitle("Frame ECEF").uncheck();
    expect(await isShown()).toEqual({ arrowEci: false, arrowEcef: true, frameEci: true, frameEcef: false });

    // Funzionano anche durante la simulazione.
    await playButton(page).click();
    await page.getByTitle("Traiettoria ECI").uncheck();
    await page.getByTitle("Velocità ECI").check();
    await page.waitForTimeout(500);
    await playButton(page).click();
    expect((await isShown()).arrowEci).toBe(true);
    await expectNoErrors(page, errors);
});

test("i comandi della telecamera corrispondono al pannello di aiuto", async ({ page }) => {
    const errors = await openApp(page);
    const canvas = page.locator("#cesiumContainer canvas").first();
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const pose = () => page.evaluate(() => {
        const camera = window.__coriolis.viewer.camera;
        return {
            distance: Cesium.Cartesian3.magnitude(camera.positionWC),
            pitch: camera.pitch
        };
    });

    async function drag(button, modifier) {
        if (modifier) {
            await page.keyboard.down(modifier);
        }
        await page.mouse.move(cx, cy);
        await page.mouse.down({ button: button });
        await page.mouse.move(cx, cy + 120, { steps: 10 });
        await page.mouse.up({ button: button });
        if (modifier) {
            await page.keyboard.up(modifier);
        }
        await page.waitForTimeout(500); // inerzia
    }

    // Trascinamento con il tasto destro: zoom (cambia la distanza).
    const before = await pose();
    await drag("right");
    const afterZoom = await pose();
    expect(Math.abs(afterZoom.distance - before.distance)).toBeGreaterThan(1000);

    // Ctrl + trascinamento con il tasto sinistro: tilt (cambia il pitch).
    await drag("left", "Control");
    const afterTilt = await pose();
    expect(Math.abs(afterTilt.pitch - afterZoom.pitch)).toBeGreaterThan(0.01);

    await expectNoErrors(page, errors);
});
