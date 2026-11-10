// ============================================================
// physics.js — Fisica della simulazione (nessuna dipendenza da
// Viewer, DOM o orologio di Cesium).
//
// Usa solo le classi matematiche di Cesium, quindi funziona sia nel
// browser sia in Node, dove la provano i test unitari (Vitest).
// Il tempo è espresso in secondi simulati dall'inizio (t = 0, quando
// ECI ed ECEF coincidono).
// ============================================================

import * as Cesium from "cesium";

// --------------------------------------------------
// PARAMETRI DELLA SIMULAZIONE
// --------------------------------------------------

export const OMEGA = 7.292115e-5;     // Velocità angolare terrestre [rad/s]

export const GM = 3.986004418e14;    // Parametro gravitazionale terrestre G·M [m^3/s^2]
export const SPHERE_RADIUS = 125000; // Raggio della sfera [m]
export const MAX_PHYSICS_STEP = 0.5; // Passo massimo di integrazione [s simulati]
const MAX_SUBSTEPS = 20000;   // Limite di sicurezza per frame

export const EARTH_RADIUS = 6371008.8; // Raggio medio terrestre (IUGG) [m]

// Modello ellissoidale (WGS84) con gravità J2.
export const WGS84 = Cesium.Ellipsoid.WGS84;
export const EQUATORIAL_RADIUS = WGS84.radii.x; // [m]
export const J2 = 1.08262668e-3;                // Coefficiente zonale J2 (WGS84)


// --------------------------------------------------
// TRASFORMAZIONI ECI <-> ECEF
// --------------------------------------------------

// ECI -> ECEF: rotazione attorno all'asse Z di -angle
export function eciToEcef(position, angle, result) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const x = c * position.x + s * position.y;
    const y = -s * position.x + c * position.y;

    if (!Cesium.defined(result)) {
        result = new Cesium.Cartesian3();
    }
    result.x = x;
    result.y = y;
    result.z = position.z;
    return result;
}

// ECEF -> ECI: rotazione attorno all'asse Z di +angle
export function ecefToEci(position, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);

    return new Cesium.Cartesian3(
        c * position.x - s * position.y,
        s * position.x + c * position.y,
        position.z
    );
}

// --------------------------------------------------
// FISICA DELLA SFERA (IN ECI)
// --------------------------------------------------
//
// Due modelli, scelti con il flag "Usa Terra sferica":
//
// TERRA SFERICA (default)
// - Gravità: legge di gravitazione universale, a = -GM·r/|r|^3.
// - Urto: elastico e senza attrito contro una Terra SFERICA di raggio
//   EARTH_RADIUS. La normale nel punto di contatto è radiale, cioè
//   allineata alla gravità da massa puntiforme: nessuna componente
//   tangenziale, quindi la sfera rimbalza sempre sulla stessa
//   verticale inerziale. La sfera terrestre è simmetrica attorno
//   all'asse Z, quindi la sua forma in ECI non cambia con la rotazione
//   e riflettere la componente normale della velocità in ECI è corretto.
//   Nota: la superficie del modello differisce fino a ~21 km
//   dall'ellissoide WGS84 visualizzato da Cesium.
//
// TERRA ELLISSOIDALE (WGS84)
// - Gravità: massa puntiforme + termine J2 dello schiacciamento.
//   È il modello coerente con l'ellissoide: insieme alla forza
//   centrifuga della rotazione, la superficie WGS84 risulta (quasi)
//   equipotenziale, quindi un corpo fermo rispetto alla Terra non
//   "scivola" verso i poli come accadeva con la sola massa puntiforme.
// - Urto: elastico e senza attrito contro l'ellissoide WGS84, lungo la
//   normale geodetica. L'ellissoide è simmetrico attorno all'asse Z,
//   quindi anche qui la superficie è ferma in ECI.
//
// In entrambi i casi: integrazione Velocity Verlet a passo variabile
// (<= MAX_PHYSICS_STEP) con ricerca dell'istante esatto di contatto.

// Punto di partenza: punto della superficie (in ECEF all'istante
// zero, quando ECI ed ECEF coincidono) e quota di partenza del
// punto più basso della sfera lungo la verticale del modello.
// --------------------------------------------------
// IMPOSTAZIONI MODIFICABILI DALL'INTERFACCIA
// --------------------------------------------------
//
// Raccolte in un unico oggetto: un modulo ES non può riassegnare le
// variabili importate da un altro modulo, ma può modificarne le
// proprietà.

export const settings = {
    // Modello di Terra usato da gravità e urti ("Usa Terra sferica").
    useSphericalEarth: true,

    // Latitudine geodetica [-90°, +90°] e longitudine [0°, 360°)
    // del punto di partenza. Valori di riserva: all'avvio app.js li
    // sostituisce con la posizione geografica del PC, se il browser
    // la fornisce.
    startLatitudeDeg: 45.0,
    startLongitudeDeg: 7.1,
    startSurfacePointECEF: Cesium.Cartesian3.fromDegrees(7.1, 45.0, 0),

    // Quota di partenza del punto più basso della sfera [m]:
    // all'avvio la sfera appoggia sulla superficie.
    startAltitude: 0,

    // Terna di velocità "di riferimento": "relative" (ECEF) o
    // "absolute" (ECI). Vedi VELOCITÀ INIZIALE.
    velocityMaster: "relative"
};

export function normalizeLongitude(deg) {
    return ((deg % 360) + 360) % 360;
}

// Imposta il punto di partenza da latitudine e longitudine.
export function setStartPoint(latitudeDeg, longitudeDeg) {
    settings.startLatitudeDeg = Cesium.Math.clamp(latitudeDeg, -90, 90);
    settings.startLongitudeDeg = normalizeLongitude(longitudeDeg);
    settings.startSurfacePointECEF = Cesium.Cartesian3.fromDegrees(
        settings.startLongitudeDeg,
        settings.startLatitudeDeg,
        0
    );
}

export const spherePositionECI_initial = new Cesium.Cartesian3();

// Posizione iniziale del centro della sfera, a SPHERE_RADIUS + quota
// dalla superficie del modello, lungo la sua verticale:
// - sferica: verticale radiale, a EARTH_RADIUS + SPHERE_RADIUS + quota
//   dal centro della Terra;
// - ellissoidale: normale geodetica nel punto scelto sull'ellissoide.
function computeInitialPosition() {
    if (settings.useSphericalEarth) {
        const up = Cesium.Cartesian3.normalize(
            settings.startSurfacePointECEF,
            new Cesium.Cartesian3()
        );
        Cesium.Cartesian3.multiplyByScalar(
            up,
            EARTH_RADIUS + SPHERE_RADIUS + settings.startAltitude,
            spherePositionECI_initial
        );
        return;
    }

    const surface = WGS84.scaleToGeodeticSurface(
        settings.startSurfacePointECEF,
        new Cesium.Cartesian3()
    );
    const normal = WGS84.geodeticSurfaceNormal(
        surface,
        new Cesium.Cartesian3()
    );
    Cesium.Cartesian3.add(
        surface,
        Cesium.Cartesian3.multiplyByScalar(
            normal,
            SPHERE_RADIUS + settings.startAltitude,
            new Cesium.Cartesian3()
        ),
        spherePositionECI_initial
    );
}

// --------------------------------------------------
// VELOCITÀ INIZIALE
// --------------------------------------------------
//
// Due terne di controlli, entrambe nella terna Est-Nord-Su del punto
// di partenza della sfera (modulo [km/h], azimuth [°] in senso orario
// dal Nord, elevazione [°] sopra l'orizzonte locale):
//
//   - RELATIVA: velocità rispetto alla Terra (ECEF);
//   - ASSOLUTA: velocità rispetto allo spazio inerziale (ECI).
//
// A t = 0 gli assi ECI ed ECEF coincidono e le due velocità sono
// legate da:
//   v_ECI = v_ECEF + ω × r
// dove ω × r è la velocità di trascinamento della rotazione terrestre
// nel centro della sfera. ω × r è tangente al parallelo, quindi nella
// terna ENU è un vettore diretto esattamente verso Est, di modulo
// ω·ρ (ρ = distanza dall'asse di rotazione).
//
// L'ultima terna modificata dall'utente è quella "di riferimento":
// l'altra viene ricalcolata da questa, anche quando cambiano punto,
// quota o modello di Terra (che cambiano ω × r).

export const velocityRelative = { speedKmh: 0, azimuthDeg: 0, elevationDeg: 0 };
export const velocityAbsolute = { speedKmh: 0, azimuthDeg: 0, elevationDeg: 0 };

export const sphereVelocityECI_initial = new Cesium.Cartesian3();
export const sphereVelocityECEF_initial = new Cesium.Cartesian3();

// Modulo/azimuth/elevazione -> componenti ENU [m/s].
export function sphericalToEnu(v) {
    const speed = v.speedKmh / 3.6;
    const az = Cesium.Math.toRadians(v.azimuthDeg);
    const el = Cesium.Math.toRadians(v.elevationDeg);
    return new Cesium.Cartesian3(
        speed * Math.cos(el) * Math.sin(az),
        speed * Math.cos(el) * Math.cos(az),
        speed * Math.sin(el)
    );
}

// Componenti ENU [m/s] -> modulo/azimuth/elevazione, scritti in "v".
// Se la direzione è indefinita (modulo nullo o velocità verticale)
// si conservano gli angoli precedenti.
export function enuToSpherical(local, v) {
    const speed = Cesium.Cartesian3.magnitude(local);
    const horizontal = Math.hypot(local.x, local.y);

    v.speedKmh = speed * 3.6;

    if (speed < 1e-9) {
        return;
    }
    v.elevationDeg = Cesium.Math.toDegrees(Math.asin(
        Cesium.Math.clamp(local.z / speed, -1, 1)
    ));
    if (horizontal > 1e-9) {
        const az = Cesium.Math.toDegrees(Math.atan2(local.x, local.y));
        v.azimuthDeg = (az + 360) % 360;
    }
}

function computeInitialVelocity() {
    const origin = spherePositionECI_initial; // = ECEF a t = 0

    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(
        origin,
        Cesium.Ellipsoid.WGS84,
        new Cesium.Matrix4()
    );
    const enu3 = Cesium.Matrix4.getMatrix3(enu, new Cesium.Matrix3());

    // Velocità di trascinamento ω × r in ENU: solo verso Est.
    const drag = new Cesium.Cartesian3(
        OMEGA * Math.hypot(origin.x, origin.y),
        0,
        0
    );

    let localRelative;
    let localAbsolute;

    if (settings.velocityMaster === "relative") {
        localRelative = sphericalToEnu(velocityRelative);
        localAbsolute = Cesium.Cartesian3.add(
            localRelative, drag, new Cesium.Cartesian3()
        );
        enuToSpherical(localAbsolute, velocityAbsolute);
    } else {
        localAbsolute = sphericalToEnu(velocityAbsolute);
        localRelative = Cesium.Cartesian3.subtract(
            localAbsolute, drag, new Cesium.Cartesian3()
        );
        enuToSpherical(localRelative, velocityRelative);
    }

    // Da ENU a coordinate cartesiane (ECEF = ECI a t = 0).
    Cesium.Matrix3.multiplyByVector(
        enu3, localRelative, sphereVelocityECEF_initial
    );
    Cesium.Matrix3.multiplyByVector(
        enu3, localAbsolute, sphereVelocityECI_initial
    );
}

export function computeInitialState() {
    computeInitialPosition();
    computeInitialVelocity();
}

computeInitialState();

export const physics = {
    position: Cesium.Cartesian3.clone(spherePositionECI_initial),
    velocity: Cesium.Cartesian3.clone(sphereVelocityECI_initial),
    time: 0,          // Istante simulato a cui si riferisce lo stato [s]
    altitude: 0       // Quota del punto più basso della sfera [m]
};

export function resetPhysics() {
    Cesium.Cartesian3.clone(spherePositionECI_initial, physics.position);
    Cesium.Cartesian3.clone(sphereVelocityECI_initial, physics.velocity);
    physics.time = 0;
    updateAltitude();
}

const scratchAccel0 = new Cesium.Cartesian3();
const scratchAccel1 = new Cesium.Cartesian3();
const scratchTemp = new Cesium.Cartesian3();
const scratchNormal = new Cesium.Cartesian3();

export function gravityAcceleration(position, result) {
    const r2 = Cesium.Cartesian3.magnitudeSquared(position);
    const r = Math.sqrt(r2);
    const factor = -GM / (r2 * r);

    if (settings.useSphericalEarth) {
        // Massa puntiforme.
        return Cesium.Cartesian3.multiplyByScalar(position, factor, result);
    }

    // Massa puntiforme + J2 (asse di simmetria = asse Z):
    //   ax = -GM·x/r³ · [1 + 3/2·J2·(Re/r)²·(1 - 5·z²/r²)]
    //   ay = -GM·y/r³ · [1 + 3/2·J2·(Re/r)²·(1 - 5·z²/r²)]
    //   az = -GM·z/r³ · [1 + 3/2·J2·(Re/r)²·(3 - 5·z²/r²)]
    const k = 1.5 * J2 * (EQUATORIAL_RADIUS * EQUATORIAL_RADIUS) / r2;
    const z2r2 = (position.z * position.z) / r2;
    const fxy = factor * (1 + k * (1 - 5 * z2r2));
    const fz = factor * (1 + k * (3 - 5 * z2r2));

    result.x = position.x * fxy;
    result.y = position.y * fxy;
    result.z = position.z * fz;
    return result;
}

const scratchSurface = new Cesium.Cartesian3();

// Distanza con segno del centro della sfera dalla superficie del
// modello, lungo la sua normale (radiale per la sfera, geodetica per
// l'ellissoide). Restituisce undefined se il centro coincide con il
// centro della Terra.
export function heightAboveSurface(position, normalResult) {
    if (settings.useSphericalEarth) {
        const r = Cesium.Cartesian3.magnitude(position);
        if (r === 0) {
            return undefined;
        }
        Cesium.Cartesian3.divideByScalar(position, r, normalResult);
        return r - EARTH_RADIUS;
    }

    const surface = WGS84.scaleToGeodeticSurface(position, scratchSurface);
    if (!Cesium.defined(surface)) {
        return undefined;
    }
    WGS84.geodeticSurfaceNormal(surface, normalResult);
    const offset = Cesium.Cartesian3.subtract(position, surface, scratchTemp);
    return Cesium.Cartesian3.dot(offset, normalResult);
}

function updateAltitude() {
    const h = heightAboveSurface(physics.position, scratchNormal);
    physics.altitude = Cesium.defined(h) ? h - SPHERE_RADIUS : 0;
}

// Vero se la sfera compenetra la superficie e si sta ancora
// avvicinando (dopo il rimbalzo vn > 0, quindi non riscatta).
function isCollidingInward() {
    const h = heightAboveSurface(physics.position, scratchNormal);
    if (!Cesium.defined(h) || h >= SPHERE_RADIUS) {
        return false;
    }
    return Cesium.Cartesian3.dot(physics.velocity, scratchNormal) < 0;
}

// Urto elastico senza attrito: inverte la componente normale
// della velocità rispetto alla superficie nel punto di contatto.
function reflectVelocity() {
    const n = scratchNormal;
    heightAboveSurface(physics.position, n);
    const vn = Cesium.Cartesian3.dot(physics.velocity, n);
    if (vn < 0) {
        Cesium.Cartesian3.subtract(
            physics.velocity,
            Cesium.Cartesian3.multiplyByScalar(n, 2 * vn, scratchTemp),
            physics.velocity
        );
    }
}

const savedPosition = new Cesium.Cartesian3();
const savedVelocity = new Cesium.Cartesian3();

function restoreState() {
    Cesium.Cartesian3.clone(savedPosition, physics.position);
    Cesium.Cartesian3.clone(savedVelocity, physics.velocity);
}

// Un passo che gestisce l'urto all'istante esatto di contatto:
// se a fine passo c'è compenetrazione, si cerca per bisezione
// l'istante del contatto, si integra fino a lì, si riflette la
// velocità e si integra il tempo rimanente.
function physicsStep(h, depth) {
    depth = depth || 0;

    Cesium.Cartesian3.clone(physics.position, savedPosition);
    Cesium.Cartesian3.clone(physics.velocity, savedVelocity);

    verletStep(h);

    if (!isCollidingInward() || depth > 4) {
        return;
    }

    let lo = 0;
    let hi = h;
    for (let i = 0; i < 40; i++) {
        const mid = 0.5 * (lo + hi);
        restoreState();
        verletStep(mid);
        if (isCollidingInward()) {
            hi = mid;
        } else {
            lo = mid;
        }
    }

    restoreState();
    verletStep(hi);
    reflectVelocity();

    const remaining = h - hi;
    if (remaining > 0) {
        physicsStep(remaining, depth + 1);
    }
}

function verletStep(h) {
    const p = physics.position;
    const v = physics.velocity;

    // Velocity Verlet
    const a0 = gravityAcceleration(p, scratchAccel0);

    // p += v·h + ½·a0·h²
    Cesium.Cartesian3.add(
        p,
        Cesium.Cartesian3.multiplyByScalar(v, h, scratchTemp),
        p
    );
    Cesium.Cartesian3.add(
        p,
        Cesium.Cartesian3.multiplyByScalar(a0, 0.5 * h * h, scratchTemp),
        p
    );

    const a1 = gravityAcceleration(p, scratchAccel1);

    // v += ½·(a0 + a1)·h
    Cesium.Cartesian3.add(
        v,
        Cesium.Cartesian3.multiplyByScalar(
            Cesium.Cartesian3.add(a0, a1, scratchTemp),
            0.5 * h,
            scratchTemp
        ),
        v
    );
}

// Porta lo stato fisico esattamente all'istante "target" [s simulati
// dall'inizio]. È idempotente: chiamata più volte con lo stesso
// istante (dalla CallbackProperty e da preRender) integra una sola
// volta.
export function advancePhysicsToSeconds(target) {

    if (target < physics.time) {
        // Il tempo è tornato indietro (Reset): riparte da capo.
        resetPhysics();
    }

    let remaining = target - physics.time;
    if (remaining <= 0) {
        return;
    }

    let n = Math.ceil(remaining / MAX_PHYSICS_STEP);
    if (n > MAX_SUBSTEPS) {
        n = MAX_SUBSTEPS;
    }
    const h = remaining / n;

    for (let i = 0; i < n; i++) {
        physicsStep(h);
    }

    physics.time = target;
    updateAltitude();
}

updateAltitude();

// Velocità relativa alla Terra, in coordinate ECI: v - ω × r,
// con ω = (0, 0, OMEGA).
export function relativeVelocityECI(result) {
    const p = physics.position;
    const v = physics.velocity;
    result.x = v.x + OMEGA * p.y;
    result.y = v.y - OMEGA * p.x;
    result.z = v.z;
    return result;
}

// Energia meccanica specifica (per unità di massa) nel sistema ECI
// [J/kg]: cinetica + potenziale del modello di gravità attivo.
// Si conserva durante il moto: utile per verificare l'integrazione.
export function mechanicalEnergy() {
    const p = physics.position;
    const r = Cesium.Cartesian3.magnitude(p);
    let potential = -GM / r;
    if (!settings.useSphericalEarth) {
        const s = p.z / r;
        potential *= 1 - J2 * (EQUATORIAL_RADIUS / r) ** 2 * (3 * s * s - 1) / 2;
    }
    return 0.5 * Cesium.Cartesian3.magnitudeSquared(physics.velocity) + potential;
}
