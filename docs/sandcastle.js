// ============================================================
// FILE GENERATO da scripts/build.mjs — non modificarlo qui.
// Modifica src/physics.js e src/app.js, poi esegui
// "npm run sandcastle" e incolla questo file in Sandcastle.
// ============================================================

// ---------------------------------------------------- src/physics.js
// ============================================================
// physics.js — Fisica della simulazione (nessuna dipendenza da
// Viewer, DOM o orologio di Cesium).
//
// Usa solo le classi matematiche di Cesium, quindi funziona sia nel
// browser sia in Node, dove la provano i test unitari (Vitest).
// Il tempo è espresso in secondi simulati dall'inizio (t = 0, quando
// ECI ed ECEF coincidono).
// ============================================================


// --------------------------------------------------
// PARAMETRI DELLA SIMULAZIONE
// --------------------------------------------------

const OMEGA = 7.292115e-5;     // Velocità angolare terrestre [rad/s]

const GM = 3.986004418e14;    // Parametro gravitazionale terrestre G·M [m^3/s^2]
const SPHERE_RADIUS = 125000; // Raggio della sfera [m]
const MAX_PHYSICS_STEP = 0.5; // Passo massimo di integrazione [s simulati]
const MAX_SUBSTEPS = 20000;   // Limite di sicurezza per frame

const EARTH_RADIUS = 6371008.8; // Raggio medio terrestre (IUGG) [m]

// Modello ellissoidale (WGS84) con gravità J2.
const WGS84 = Cesium.Ellipsoid.WGS84;
const EQUATORIAL_RADIUS = WGS84.radii.x; // [m]
const J2 = 1.08262668e-3;                // Coefficiente zonale J2 (WGS84)


// --------------------------------------------------
// TRASFORMAZIONI ECI <-> ECEF
// --------------------------------------------------

// ECI -> ECEF: rotazione attorno all'asse Z di -angle
function eciToEcef(position, angle, result) {
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
function ecefToEci(position, angle) {
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

const settings = {
    // Modello di Terra usato da gravità e urti ("Usa Terra sferica").
    useSphericalEarth: true,

    // Latitudine geodetica [-90°, +90°] e longitudine [0°, 360°)
    // del punto di partenza.
    startLatitudeDeg: 45.0,
    startLongitudeDeg: 7.1,
    startSurfacePointECEF: Cesium.Cartesian3.fromDegrees(7.1, 45.0, 0),

    // Quota di partenza del punto più basso della sfera [m].
    startAltitude: 225000,

    // Terna di velocità "di riferimento": "relative" (ECEF) o
    // "absolute" (ECI). Vedi VELOCITÀ INIZIALE.
    velocityMaster: "relative"
};

function normalizeLongitude(deg) {
    return ((deg % 360) + 360) % 360;
}

// Imposta il punto di partenza da latitudine e longitudine.
function setStartPoint(latitudeDeg, longitudeDeg) {
    settings.startLatitudeDeg = Cesium.Math.clamp(latitudeDeg, -90, 90);
    settings.startLongitudeDeg = normalizeLongitude(longitudeDeg);
    settings.startSurfacePointECEF = Cesium.Cartesian3.fromDegrees(
        settings.startLongitudeDeg,
        settings.startLatitudeDeg,
        0
    );
}

const spherePositionECI_initial = new Cesium.Cartesian3();

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

const velocityRelative = { speedKmh: 0, azimuthDeg: 0, elevationDeg: 0 };
const velocityAbsolute = { speedKmh: 0, azimuthDeg: 0, elevationDeg: 0 };

const sphereVelocityECI_initial = new Cesium.Cartesian3();
const sphereVelocityECEF_initial = new Cesium.Cartesian3();

// Modulo/azimuth/elevazione -> componenti ENU [m/s].
function sphericalToEnu(v) {
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
function enuToSpherical(local, v) {
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

function computeInitialState() {
    computeInitialPosition();
    computeInitialVelocity();
}

computeInitialState();

const physics = {
    position: Cesium.Cartesian3.clone(spherePositionECI_initial),
    velocity: Cesium.Cartesian3.clone(sphereVelocityECI_initial),
    time: 0,          // Istante simulato a cui si riferisce lo stato [s]
    altitude: 0       // Quota del punto più basso della sfera [m]
};

function resetPhysics() {
    Cesium.Cartesian3.clone(spherePositionECI_initial, physics.position);
    Cesium.Cartesian3.clone(sphereVelocityECI_initial, physics.velocity);
    physics.time = 0;
    updateAltitude();
}

const scratchAccel0 = new Cesium.Cartesian3();
const scratchAccel1 = new Cesium.Cartesian3();
const scratchTemp = new Cesium.Cartesian3();
const scratchNormal = new Cesium.Cartesian3();

function gravityAcceleration(position, result) {
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
function heightAboveSurface(position, normalResult) {
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
function advancePhysicsToSeconds(target) {

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
function relativeVelocityECI(result) {
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
function mechanicalEnergy() {
    const p = physics.position;
    const r = Cesium.Cartesian3.magnitude(p);
    let potential = -GM / r;
    if (!settings.useSphericalEarth) {
        const s = p.z / r;
        potential *= 1 - J2 * (EQUATORIAL_RADIUS / r) ** 2 * (3 * s * s - 1) / 2;
    }
    return 0.5 * Cesium.Cartesian3.magnitudeSquared(physics.velocity) + potential;
}

// ---------------------------------------------------- src/app.js
// ============================================================
// app.js — Viewer, entità, telecamera e pannello dei controlli.
//
// La fisica è in physics.js. Per Sandcastle i due file vengono
// uniti in un unico script con "npm run sandcastle".
// ============================================================


const viewer = new Cesium.Viewer("cesiumContainer", {
    animation: false,
    timeline: false
});

const TIME_SCALE = 600; // 1 secondo reale = 600 secondi simulati

// --------------------------------------------------
// OROLOGIO DI CESIUM COME UNICA SORGENTE DEL TEMPO
// --------------------------------------------------
//
// Le entità sono aggiornate in clock.onTick (prima di preRender),
// la telecamera in preRender: entrambe usano il "time" fornito da
// Cesium, quindi lo stesso istante nello stesso frame.

const simulationStart = Cesium.JulianDate.now();

viewer.clock.startTime = simulationStart.clone();
viewer.clock.currentTime = simulationStart.clone();
viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED;
viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
viewer.clock.multiplier = TIME_SCALE;
viewer.clock.shouldAnimate = false;

function simulationSecondsAt(time) {
    return Cesium.JulianDate.secondsDifference(time, simulationStart);
}

function earthAngleAt(time) {
    return OMEGA * simulationSecondsAt(time);
}

// Porta lo stato fisico all'istante "time" dell'orologio di Cesium.
function advancePhysicsTo(time) {
    advancePhysicsToSeconds(simulationSecondsAt(time));
}

let simulationTime = 0;
let earthAngle = 0;

// --------------------------------------------------
// POSIZIONE INIZIALE DELLA TELECAMERA IN ECI
// --------------------------------------------------

const cameraPositionECI = Cesium.Cartesian3.fromDegrees(
    7.1,
    45.0,
    400000
);

const cameraDirectionECI = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.negate(
        cameraPositionECI,
        new Cesium.Cartesian3()
    ),
    new Cesium.Cartesian3()
);

// Calcolo di un vettore Up ortogonale alla direzione
const globalZ = new Cesium.Cartesian3(0, 0, 1);

const projection = Cesium.Cartesian3.multiplyByScalar(
    cameraDirectionECI,
    Cesium.Cartesian3.dot(globalZ, cameraDirectionECI),
    new Cesium.Cartesian3()
);

const cameraUpECI = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.subtract(
        globalZ,
        projection,
        new Cesium.Cartesian3()
    ),
    new Cesium.Cartesian3()
);

// --------------------------------------------------
// POSA INERZIALE CORRENTE DELLA TELECAMERA
// --------------------------------------------------

let cameraPositionECI_current =
    Cesium.Cartesian3.clone(cameraPositionECI);

let cameraDirectionECI_current =
    Cesium.Cartesian3.clone(cameraDirectionECI);

let cameraUpECI_current =
    Cesium.Cartesian3.clone(cameraUpECI);

// --------------------------------------------------
// MEMORIZZAZIONE DELL'ULTIMA POSA IMPOSTATA
// DALLO SCRIPT IN COORDINATE ECEF
// --------------------------------------------------

let lastAppliedCameraPose = undefined;

function rememberCameraPose() {
    lastAppliedCameraPose = {
        position: Cesium.Cartesian3.clone(
            viewer.camera.positionWC
        ),
        direction: Cesium.Cartesian3.clone(
            viewer.camera.directionWC
        ),
        up: Cesium.Cartesian3.clone(
            viewer.camera.upWC
        )
    };
}

// --------------------------------------------------
// VERIFICA SE LA TELECAMERA È STATA MOSSA
// DALL'UTENTE
// --------------------------------------------------

function cameraPoseHasChanged() {
    if (!lastAppliedCameraPose) {
        return true;
    }

    const camera = viewer.camera;

    const positionDifference = Cesium.Cartesian3.distance(
        camera.positionWC,
        lastAppliedCameraPose.position
    );

    const directionDifference = Cesium.Cartesian3.distance(
        camera.directionWC,
        lastAppliedCameraPose.direction
    );

    const upDifference = Cesium.Cartesian3.distance(
        camera.upWC,
        lastAppliedCameraPose.up
    );

    return (
        positionDifference > 0.01 ||
        directionDifference > 1e-8 ||
        upDifference > 1e-8
    );
}

// --------------------------------------------------
// ACQUISIZIONE DELLA POSA ATTUALE DELLA TELECAMERA
// E CONVERSIONE IN ECI
// --------------------------------------------------

function captureCameraECI() {
    const camera = viewer.camera;

    cameraPositionECI_current = ecefToEci(
        camera.positionWC,
        earthAngle
    );

    cameraDirectionECI_current = Cesium.Cartesian3.normalize(
        ecefToEci(camera.directionWC, earthAngle),
        new Cesium.Cartesian3()
    );

    cameraUpECI_current = Cesium.Cartesian3.normalize(
        ecefToEci(camera.upWC, earthAngle),
        new Cesium.Cartesian3()
    );

    rememberCameraPose();
}

// --------------------------------------------------
// APPLICAZIONE DELLA POSA INERZIALE ALLA TELECAMERA
// --------------------------------------------------

function applyCameraECI() {
    viewer.camera.setView({
        destination: eciToEcef(cameraPositionECI_current, earthAngle),
        orientation: {
            direction: eciToEcef(cameraDirectionECI_current, earthAngle),
            up: eciToEcef(cameraUpECI_current, earthAngle)
        }
    });

    // Registra la posa impostata dallo script,
    // così non verrà scambiata per un movimento dell'utente.
    rememberCameraPose();
}

// --------------------------------------------------
// INIZIALIZZAZIONE TELECAMERA
// --------------------------------------------------

applyCameraECI();

// --------------------------------------------------
// SFERA SOGGETTA A GRAVITÀ (STATO IN ECI)
// --------------------------------------------------

viewer.entities.add({
    name: "Sfera inerziale",
    // Stato fisico e angolo terrestre calcolati dal "time"
    // passato da Cesium: stesso istante usato dalla telecamera.
    position: new Cesium.CallbackProperty(function (time, result) {
        advancePhysicsTo(time);
        return eciToEcef(
            physics.position,
            earthAngleAt(time),
            result
        );
    }, false),

    ellipsoid: {
        radii: new Cesium.Cartesian3(
            SPHERE_RADIUS,
            SPHERE_RADIUS,
            SPHERE_RADIUS
        ),
        material: Cesium.Color.ORANGE.withAlpha(0.85)
    }
});

// --------------------------------------------------
// FRECCE DELLA VELOCITÀ ISTANTANEA
// --------------------------------------------------
//
// Due frecce, calcolate dallo stato fisico (in ECI):
//
// - ROSSA: velocità ASSOLUTA (ECI), v. È la "Velocità ECI" della
//   riga di stato.
// - VERDE: velocità RELATIVA alla Terra (ECEF), v - ω × r. È la
//   "Velocità ECEF" della riga di stato.
//
// Entrambi i vettori sono calcolati in coordinate ECI e ruotati in
// ECEF (di -earthAngle attorno a Z) solo per essere disegnati: la
// rotazione non cambia né i moduli né gli angoli tra i vettori.
//
// - Verso: quello della rispettiva velocità.
// - Modulo: lunghezza proporzionale alla velocità, pari allo spazio
//   percorso in VELOCITY_ARROW_SECONDS secondi a velocità costante
//   (es. 1 km/s -> 600 km).
// - Ogni freccia parte dalla superficie della sfera, nella propria
//   direzione, così non resta nascosta al suo interno.
//
// Come la sfera, sono calcolate dal "time" di Cesium: nello stesso
// frame usano lo stesso stato fisico e lo stesso angolo terrestre.

const VELOCITY_ARROW_SECONDS = 600; // [s] scala della lunghezza
const VELOCITY_ARROW_WIDTH = 12;    // [px] (serve per la punta)
const VELOCITY_ARROW_MIN_SPEED = 1; // [m/s] sotto: freccia nascosta

// Velocità assoluta, in coordinate ECI.
function absoluteVelocityECI(result) {
    return Cesium.Cartesian3.clone(physics.velocity, result);
}

function createVelocityArrow(name, color, velocityFunction) {
    const velocity = new Cesium.Cartesian3();

    function currentSpeed(time) {
        advancePhysicsTo(time);
        return Cesium.Cartesian3.magnitude(velocityFunction(velocity));
    }

    function positions(time) {
        const speed = currentSpeed(time);
        const angle = earthAngleAt(time);
        const center = eciToEcef(physics.position, angle);

        if (speed < VELOCITY_ARROW_MIN_SPEED) {
            return [center, Cesium.Cartesian3.clone(center)];
        }

        const direction = Cesium.Cartesian3.normalize(
            eciToEcef(velocity, angle),
            new Cesium.Cartesian3()
        );

        const tail = Cesium.Cartesian3.add(
            center,
            Cesium.Cartesian3.multiplyByScalar(
                direction, SPHERE_RADIUS, new Cesium.Cartesian3()
            ),
            new Cesium.Cartesian3()
        );
        const head = Cesium.Cartesian3.add(
            tail,
            Cesium.Cartesian3.multiplyByScalar(
                direction,
                speed * VELOCITY_ARROW_SECONDS,
                new Cesium.Cartesian3()
            ),
            new Cesium.Cartesian3()
        );

        return [tail, head];
    }

    return viewer.entities.add({
        name: name,
        polyline: {
            positions: new Cesium.CallbackProperty(positions, false),
            show: new Cesium.CallbackProperty(function (time) {
                return currentSpeed(time) >= VELOCITY_ARROW_MIN_SPEED;
            }, false),
            width: VELOCITY_ARROW_WIDTH,
            // NONE: segmento rettilineo nello spazio.
            arcType: Cesium.ArcType.NONE,
            material: new Cesium.PolylineArrowMaterialProperty(color)
        }
    });
}

const absoluteVelocityArrow = createVelocityArrow(
    "Velocità assoluta (ECI)",
    Cesium.Color.RED,
    absoluteVelocityECI
);

const relativeVelocityArrow = createVelocityArrow(
    "Velocità relativa (ECEF)",
    Cesium.Color.LIME,
    relativeVelocityECI
);

// --------------------------------------------------
// TRACCE DELLA SFERA
// --------------------------------------------------
//
// Due tracce del centro della sfera, una per sistema di riferimento:
//
// - VERDE, solidale con la Terra (ECEF): vertici salvati in ECEF,
//   restano fissi rispetto alla Terra e ruotano con essa.
// - ROSSA, solidale con lo spazio inerziale (ECI): vertici salvati in
//   ECI e disegnati con una modelMatrix ECI -> ECEF (rotazione di
//   -earthAngle attorno a Z) aggiornata a ogni frame: la traccia resta
//   ferma nello spazio mentre la Terra ruota.
//
// A ogni frame in cui la fisica avanza si aggiunge un vertice nella
// posizione corrente del centro della sfera, cioè un nuovo segmento.
//
// Prestazioni: in una PolylineCollection sia la variazione del numero
// di vertici sia la variazione della modelMatrix ricostruiscono TUTTI
// i vertici della collezione. Per questo:
// - il troncone attivo (al massimo TRACK_CHUNK_SIZE vertici) sta da
//   solo in una PolylineCollection piccola, ricostruita a ogni frame;
// - quando è pieno viene "congelato" in una Primitive statica, per la
//   quale cambiare la modelMatrix costa solo l'aggiornamento di una
//   matrice, senza ricostruire la geometria.

const TRACK_CHUNK_SIZE = 500;
const TRACK_MIN_DISTANCE = 10; // [m] evita vertici coincidenti
const TRACK_WIDTH = 1;         // [px]

function createTrack(color) {
    const modelMatrix = Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY);

    // Tronconi completi (Primitive statiche).
    const frozenChunks = viewer.scene.primitives.add(
        new Cesium.PrimitiveCollection()
    );

    // Troncone attivo.
    const activeCollection = viewer.scene.primitives.add(
        new Cesium.PolylineCollection()
    );

    let activePolyline = undefined;
    let points = [];

    function freezeChunk(chunkPoints) {
        frozenChunks.add(new Cesium.Primitive({
            geometryInstances: new Cesium.GeometryInstance({
                geometry: new Cesium.PolylineGeometry({
                    positions: chunkPoints,
                    width: TRACK_WIDTH,
                    // NONE: segmenti rettilinei tra i vertici, senza
                    // suddivisione lungo la superficie terrestre.
                    arcType: Cesium.ArcType.NONE,
                    vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT
                }),
                attributes: {
                    color: Cesium.ColorGeometryInstanceAttribute.fromColor(color)
                }
            }),
            appearance: new Cesium.PolylineColorAppearance(),
            modelMatrix: Cesium.Matrix4.clone(modelMatrix),
            asynchronous: false
        }));
    }

    function addPoint(position) {
        const last = points[points.length - 1];
        if (
            last &&
            Cesium.Cartesian3.distance(last, position) < TRACK_MIN_DISTANCE
        ) {
            return;
        }

        if (points.length >= TRACK_CHUNK_SIZE) {
            // Congela il troncone completo e ne apre uno nuovo
            // che parte dall'ultimo vertice (traccia continua).
            freezeChunk(points);
            activeCollection.removeAll();
            activePolyline = undefined;
            points = [last];
        }

        points.push(Cesium.Cartesian3.clone(position));

        if (points.length < 2) {
            return;
        }

        if (!activePolyline) {
            activePolyline = activeCollection.add({
                positions: points.slice(),
                width: TRACK_WIDTH,
                // Ogni polilinea ha il PROPRIO materiale:
                // Polyline._destroy() distrugge il materiale associato
                // (causa del bug del Reset già corretto).
                material: Cesium.Material.fromType("Color", { color: color })
            });
        } else {
            activePolyline.positions = points.slice();
        }
    }

    // Matrice dai vertici salvati al sistema ECEF di Cesium.
    function setModelMatrix(matrix) {
        Cesium.Matrix4.clone(matrix, modelMatrix);
        Cesium.Matrix4.clone(matrix, activeCollection.modelMatrix);
        for (let i = 0; i < frozenChunks.length; i++) {
            Cesium.Matrix4.clone(matrix, frozenChunks.get(i).modelMatrix);
        }
    }

    function reset() {
        activeCollection.removeAll();
        frozenChunks.removeAll();
        activePolyline = undefined;
        points = [];
    }

    // Mostra/nasconde la traccia (i vertici continuano a essere
    // registrati anche quando è nascosta).
    function setShow(show) {
        activeCollection.show = show;
        frozenChunks.show = show;
    }

    return {
        addPoint: addPoint,
        setModelMatrix: setModelMatrix,
        reset: reset,
        setShow: setShow
    };
}

const ecefTrack = createTrack(Cesium.Color.LIME); // Verde: solidale ECEF
const eciTrack = createTrack(Cesium.Color.RED);   // Rossa: solidale ECI

const scratchEciRotation3 = new Cesium.Matrix3();
const scratchEciRotation4 = new Cesium.Matrix4();

let lastTrackedPhysicsTime = undefined;

// Aggiorna la rotazione ECI -> ECEF della traccia rossa e, se lo
// stato fisico è cambiato, aggiunge un vertice a entrambe le tracce.
function updateTrack() {
    Cesium.Matrix3.fromRotationZ(-earthAngle, scratchEciRotation3);
    Cesium.Matrix4.fromRotation(scratchEciRotation3, scratchEciRotation4);
    eciTrack.setModelMatrix(scratchEciRotation4);

    if (physics.time === lastTrackedPhysicsTime) {
        return;
    }
    lastTrackedPhysicsTime = physics.time;

    ecefTrack.addPoint(eciToEcef(physics.position, earthAngle));
    eciTrack.addPoint(physics.position);
}

function resetTrack() {
    ecefTrack.reset();
    eciTrack.reset();
    lastTrackedPhysicsTime = undefined;
}

// --------------------------------------------------
// ASSE DI ROTAZIONE TERRESTRE
// --------------------------------------------------
//
// La rotazione avviene attorno all'asse Z, comune a ECI ed ECEF:
// la linea è quindi fissa in entrambi i sistemi. Si disegnano solo
// i due tratti esterni, dalla superficie di ciascun polo verso lo
// spazio: nessuna parte della linea passa dentro la Terra, quindi
// nulla può trasparire attraverso il globo.

const AXIS_HALF_LENGTH = 9000000; // [m] dal centro della Terra
const POLAR_RADIUS = Cesium.Ellipsoid.WGS84.radii.z; // Raggio polare WGS84 [m]

function addAxisSegment(name, sign) {
    viewer.entities.add({
        name: name,
        polyline: {
            positions: [
                new Cesium.Cartesian3(0, 0, sign * POLAR_RADIUS),
                new Cesium.Cartesian3(0, 0, sign * AXIS_HALF_LENGTH)
            ],
            // NONE: segmento rettilineo nello spazio, non adagiato
            // sulla superficie terrestre.
            arcType: Cesium.ArcType.NONE,
            width: 1.5,
            material: Cesium.Color.VIOLET
        }
    });
}

addAxisSegment("Asse di rotazione (Nord)", +1);
addAxisSegment("Asse di rotazione (Sud)", -1);

// --------------------------------------------------
// MARCATORE DEL PUNTO DI PARTENZA (SOLIDALE CON LA TERRA)
// --------------------------------------------------

const startMarker = viewer.entities.add({
    name: "Punto di partenza",
    position: Cesium.Cartesian3.clone(settings.startSurfacePointECEF),
    point: {
        pixelSize: 7,
        color: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    }
});

// Imposta il punto di partenza (fisica) e sposta il marcatore.
function applyStartPoint(latitudeDeg, longitudeDeg) {
    setStartPoint(latitudeDeg, longitudeDeg);
    startMarker.position = Cesium.Cartesian3.clone(
        settings.startSurfacePointECEF
    );
}

// --------------------------------------------------
// TERNE DI RIFERIMENTO NEL PUNTO DI PARTENZA DELLA SFERA
// --------------------------------------------------
//
// Due terne East-North-Up con origine nel centro della sfera alla
// partenza (t = 0, quando ECI ed ECEF coincidono, quindi sono
// inizialmente sovrapposte):
//   X (rosso) -> Est, lungo il parallelo
//   Y (verde) -> Nord, lungo il meridiano
//   Z (blu)   -> Su, normale alla superficie terrestre (WGS84)
//
// - Terna ECEF: solidale con la Terra, quindi fissa in ECEF.
// - Terna ECI: fissa nello spazio inerziale; in ECEF la sua origine
//   e i suoi assi ruotano di -earthAngle attorno all'asse Z.
//
// La lunghezza degli assi è ricalcolata a ogni frame in modo da
// occupare sempre FRAME_AXIS_PIXELS pixel, qualunque sia lo zoom.

const FRAME_AXIS_PIXELS = 70;  // Lunghezza a schermo degli assi [px]
const FRAME_LINE_WIDTH = 3;    // Spessore degli assi [px]

const FRAME_COLORS = [
    Cesium.Color.RED,   // X - Est
    Cesium.Color.LIME,  // Y - Nord
    Cesium.Color.BLUE   // Z - Su
];

const frameCollection = viewer.scene.primitives.add(
    new Cesium.PolylineCollection()
);

function createFramePolylines() {
    return FRAME_COLORS.map(function (color) {
        return frameCollection.add({
            positions: [
                new Cesium.Cartesian3(0, 0, 0),
                new Cesium.Cartesian3(1, 0, 0)
            ],
            width: FRAME_LINE_WIDTH,
            material: Cesium.Material.fromType("Color", { color: color })
        });
    });
}

const ecefFramePolylines = createFramePolylines();
const eciFramePolylines = createFramePolylines();

const scratchEnu = new Cesium.Matrix4();
const scratchEnu3 = new Cesium.Matrix3();
const scratchFrameSphere = new Cesium.BoundingSphere();
const frameAxes = [
    new Cesium.Cartesian3(),
    new Cesium.Cartesian3(),
    new Cesium.Cartesian3()
];

// Metri corrispondenti a un pixel alla distanza di "origin".
function metersPerPixelAt(origin) {
    const scene = viewer.scene;
    scratchFrameSphere.center = origin;
    scratchFrameSphere.radius = 0;
    return scene.camera.getPixelSize(
        scratchFrameSphere,
        scene.drawingBufferWidth,
        scene.drawingBufferHeight
    );
}

function setFrame(polylines, origin, axes) {
    const length = FRAME_AXIS_PIXELS * metersPerPixelAt(origin);

    for (let i = 0; i < 3; i++) {
        const tip = Cesium.Cartesian3.add(
            origin,
            Cesium.Cartesian3.multiplyByScalar(
                axes[i],
                length,
                new Cesium.Cartesian3()
            ),
            new Cesium.Cartesian3()
        );
        polylines[i].positions = [Cesium.Cartesian3.clone(origin), tip];
    }
}

function updateReferenceFrames() {
    // Origine e assi ENU a t = 0 (ECI = ECEF).
    const origin = spherePositionECI_initial;

    Cesium.Transforms.eastNorthUpToFixedFrame(
        origin,
        Cesium.Ellipsoid.WGS84,
        scratchEnu
    );
    Cesium.Matrix4.getMatrix3(scratchEnu, scratchEnu3);
    for (let i = 0; i < 3; i++) {
        Cesium.Matrix3.getColumn(scratchEnu3, i, frameAxes[i]);
    }

    // Terna solidale con ECEF: ferma rispetto alla Terra.
    setFrame(ecefFramePolylines, origin, frameAxes);

    // Terna solidale con ECI: ruotata di -earthAngle in ECEF.
    const eciOrigin = eciToEcef(origin, earthAngle);
    const eciAxes = frameAxes.map(function (axis) {
        return eciToEcef(axis, earthAngle);
    });
    setFrame(eciFramePolylines, eciOrigin, eciAxes);
}

// --------------------------------------------------
// NUOVA CONDIZIONE INIZIALE: riporta la simulazione a t = 0
// con la sfera sulla verticale del punto scelto.
// --------------------------------------------------

// skipInput (opzionale): campo che l'utente sta modificando, da non
// riscrivere per non disturbare la digitazione.
function restartSimulation(skipInput) {
    computeInitialState();
    syncVelocityInputs(skipInput);
    viewer.clock.currentTime = simulationStart.clone();
    resetPhysics();
    resetTrack();
}

// --------------------------------------------------
// CONTROLLI DELLA TELECAMERA
// --------------------------------------------------

const controller =
    viewer.scene.screenSpaceCameraController;

controller.enableZoom = true;
controller.enableRotate = true;
controller.enableTranslate = true;
controller.enableTilt = true;
controller.enableLook = true;

controller.zoomEventTypes = [
    Cesium.CameraEventType.WHEEL,
    Cesium.CameraEventType.PINCH
];

controller.rotateEventTypes = [
    Cesium.CameraEventType.LEFT_DRAG
];

controller.translateEventTypes = [
    Cesium.CameraEventType.RIGHT_DRAG
];

controller.tiltEventTypes = [
    Cesium.CameraEventType.MIDDLE_DRAG,
    Cesium.CameraEventType.PINCH
];

// --------------------------------------------------
// AGGIORNAMENTO DELLA SIMULAZIONE
// --------------------------------------------------

viewer.scene.preRender.addEventListener(function (scene, time) {

    // 1. Se l'utente ha mosso la telecamera, acquisisce la nuova
    //    posa in ECI usando l'angolo del frame precedente.
    if (cameraPoseHasChanged()) {
        captureCameraECI();
    }

    // 2. Aggiorna tempo, angolo terrestre e fisica allo stesso
    //    istante usato in questo frame per le entità.
    simulationTime = simulationSecondsAt(time);
    earthAngle = OMEGA * simulationTime;
    advancePhysicsTo(time);

    // Nuovo segmento della traccia, nella posizione ECEF
    // della sfera a questo istante.
    updateTrack();

    // 3. Mantiene la telecamera fissa in ECI.
    applyCameraECI();

    // 4. Terne di riferimento: dopo la telecamera, così la loro
    //    dimensione a schermo usa la posa di questo frame.
    updateReferenceFrames();
});

// --------------------------------------------------
// INTERFACCIA DI CONTROLLO: PANNELLO LATERALE
// --------------------------------------------------
//
// Il pannello occupa una colonna a sinistra a tutta altezza e la vista
// Cesium occupa lo spazio restante (non più un riquadro sovrapposto).
// Cesium ridimensiona il canvas da solo quando cambia la dimensione
// del suo contenitore.

const PANEL_WIDTH = 340; // [px]

const panelStyle = document.createElement("style");
panelStyle.textContent = `
#simPanel {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: ${PANEL_WIDTH}px;
    box-sizing: border-box;
    overflow-y: auto;
    padding: 12px 14px;
    background: #1e1f22;
    border-right: 1px solid #3a3b3f;
    color: #e8e8e8;
    font: 13px/1.4 sans-serif;
    z-index: 100;
}
#simPanel h2 {
    margin: 0 0 12px 0;
    font-size: 16px;
    font-weight: 600;
}
#simPanel .sim-section {
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid #333438;
}
#simPanel .sim-section:last-child {
    border-bottom: none;
}
#simPanel h3 {
    margin: 0 0 8px 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #9a9ca3;
}
/* Play/pausa e stop: insieme occupano metà della larghezza utile
   (lo spazio del vecchio pulsante "Avvia rotazione"). */
#simPanel .sim-buttons {
    display: flex;
    gap: 8px;
    width: calc(50% - 4px);
}
#simPanel .sim-buttons button {
    flex: 1 1 0;
    min-width: 0;
    margin: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    padding: 0;
}
#simPanel .sim-buttons svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
}
/* "Punto iniziale": sta in una riga .sim-buttons identica a quella
   di play/stop, quindi ha lo stesso bordo destro dello stop. */
#simPanel .sim-buttons .sim-text-button {
    padding: 0 6px;
    white-space: nowrap;
    overflow: hidden;
    text-align: center;
}
/* Sezione Visualizzazione: etichetta + due colonne di checkbox. */
#simPanel .sim-visibility {
    display: grid;
    grid-template-columns: 1fr 90px 90px;
    gap: 6px 8px;
    align-items: center;
}
#simPanel .sim-visibility input[type="checkbox"] {
    justify-self: center;
    margin: 0;
}
#simPanel button {
    padding: 6px 10px;
    cursor: pointer;
}
#simPanel button:disabled,
#simPanel input:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}
#simPanel .sim-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
}
#simPanel input[type="number"] {
    width: 90px;
    box-sizing: border-box;
}
#simPanel .sim-grid {
    display: grid;
    grid-template-columns: 1fr 90px 90px;
    gap: 6px 8px;
    align-items: center;
}
#simPanel .sim-colhead {
    font-size: 11px;
    color: #9a9ca3;
    text-align: center;
}
#simPanel .sim-note {
    margin-top: 6px;
    font-size: 11px;
    color: #9a9ca3;
}
#simPanel .sim-status {
    white-space: pre-wrap;
    font-family: monospace;
    font-size: 12px;
}
#simPanel .sim-error {
    display: none;
    margin-top: 8px;
    padding: 6px 8px;
    background: #8e2020;
    border-radius: 4px;
}
#simPanel .sim-legend div {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
}
#simPanel .sim-swatch {
    display: inline-block;
    width: 18px;
    height: 3px;
    border-radius: 2px;
}
`;
document.head.appendChild(panelStyle);

const panel = document.createElement("div");
panel.id = "simPanel";

// La vista Cesium occupa lo spazio a destra del pannello.
const cesiumContainerElement = viewer.container;
cesiumContainerElement.style.position = "absolute";
cesiumContainerElement.style.top = "0";
cesiumContainerElement.style.bottom = "0";
cesiumContainerElement.style.right = "0";
cesiumContainerElement.style.left = PANEL_WIDTH + "px";
cesiumContainerElement.style.width = "auto";
cesiumContainerElement.style.height = "auto";

cesiumContainerElement.parentNode.insertBefore(panel, cesiumContainerElement);

function createSection(title) {
    const section = document.createElement("div");
    section.className = "sim-section";
    const heading = document.createElement("h3");
    heading.textContent = title;
    section.appendChild(heading);
    panel.appendChild(section);
    return section;
}

function createNumberInput(value, min, max, step) {
    const input = document.createElement("input");
    input.type = "number";
    if (min !== undefined) {
        input.min = String(min);
    }
    if (max !== undefined) {
        input.max = String(max);
    }
    input.step = String(step);
    input.value = String(value);
    return input;
}

// Riga "etichetta ........ campo".
function createField(parent, labelText, control) {
    const row = document.createElement("label");
    row.className = "sim-field";
    row.appendChild(document.createTextNode(labelText));
    row.appendChild(control);
    parent.appendChild(row);
    return row;
}

const panelTitle = document.createElement("h2");
panelTitle.textContent = "Accelerazione di Coriolis";
panel.appendChild(panelTitle);

// --- Simulazione -----------------------------------------------------

const simulationSection = createSection("Simulazione");

const simulationButtons = document.createElement("div");
simulationButtons.className = "sim-buttons";

// Icone SVG (stessa resa su tutti i sistemi, a differenza dei
// caratteri Unicode ▶ / ⏸ / ■ che alcuni sistemi mostrano come emoji).
const ICON_PLAY =
    '<svg viewBox="0 0 16 16"><path d="M3 1.5v13l11-6.5z"/></svg>';
const ICON_PAUSE =
    '<svg viewBox="0 0 16 16"><path d="M3 1.5h3.5v13H3zM9.5 1.5H13v13H9.5z"/></svg>';
const ICON_STOP =
    '<svg viewBox="0 0 16 16"><path d="M2.5 2.5h11v11h-11z"/></svg>';

const startButton = document.createElement("button");
startButton.innerHTML = ICON_PLAY;
startButton.title = "Avvia";
startButton.setAttribute("aria-label", "Avvia");

// Stop = Reset: riporta la simulazione a t = 0.
const resetButton = document.createElement("button");
resetButton.innerHTML = ICON_STOP;
resetButton.title = "Stop (reset)";
resetButton.setAttribute("aria-label", "Stop (reset)");

simulationButtons.appendChild(startButton);
simulationButtons.appendChild(resetButton);
simulationSection.appendChild(simulationButtons);

// Messaggio di errore (non bloccante, scompare dopo alcuni secondi).
const errorBox = document.createElement("div");
errorBox.className = "sim-error";
simulationSection.appendChild(errorBox);

let errorTimer = undefined;

function showError(message) {
    errorBox.textContent = "⚠ " + message;
    errorBox.style.display = "block";
    clearTimeout(errorTimer);
    errorTimer = setTimeout(hideError, 4000);
}

function hideError() {
    clearTimeout(errorTimer);
    errorBox.style.display = "none";
}

// --- Partenza ---------------------------------------------------------

const startSection = createSection("Partenza");

const pickButtonRow = document.createElement("div");
pickButtonRow.className = "sim-buttons";

const pickButton = document.createElement("button");
pickButton.textContent = "Punto iniziale";
pickButton.className = "sim-text-button";
pickButtonRow.appendChild(pickButton);
startSection.appendChild(pickButtonRow);

const latitudeInput = createNumberInput(settings.startLatitudeDeg, -90, 90, 1);
createField(startSection, "Latitudine [°]", latitudeInput);

// Senza min/max: tenendo premuto su/giù la longitudine supera 359° o
// scende sotto 0° e viene "avvolta" (ciclo continuo).
const longitudeInput = createNumberInput(settings.startLongitudeDeg, undefined, undefined, 1);
createField(startSection, "Longitudine [°]", longitudeInput);

const altitudeInput = createNumberInput(settings.startAltitude / 1000, 0, undefined, 10);
createField(startSection, "Quota di partenza [km]", altitudeInput);

// --- Velocità iniziale -----------------------------------------------

const velocitySection = createSection("Velocità iniziale");

const velocityGrid = document.createElement("div");
velocityGrid.className = "sim-grid";
velocitySection.appendChild(velocityGrid);

function appendGridCell(element) {
    velocityGrid.appendChild(element);
    return element;
}

function gridText(text, className) {
    const span = document.createElement("span");
    span.textContent = text;
    if (className) {
        span.className = className;
    }
    return appendGridCell(span);
}

// Intestazioni delle colonne.
gridText("");
gridText("Relativa (ECEF)", "sim-colhead");
gridText("Assoluta (ECI)", "sim-colhead");

// Controlli di una terna (modulo, azimuth, elevazione).
function createVelocityInputs(state) {
    return {
        state: state,
        speed: createNumberInput(0, 0, undefined, 100),
        // Senza min/max: tenendo premuto su/giù l'azimuth può superare
        // 360° o scendere sotto 0° e viene "avvolto".
        azimuth: createNumberInput(0, undefined, undefined, 1),
        elevation: createNumberInput(0, -90, 90, 1)
    };
}

// Relativa: rispetto alla Terra (terna ECEF).
const relativeVelocityControls = createVelocityInputs(velocityRelative);
// Assoluta: rispetto allo spazio inerziale (terna ECI).
const absoluteVelocityControls = createVelocityInputs(velocityAbsolute);

const velocityControls = [relativeVelocityControls, absoluteVelocityControls];

[
    ["Modulo [km/h]", "speed"],
    ["Azimuth [°]", "azimuth"],
    ["Elevazione [°]", "elevation"]
].forEach(function (rowDef) {
    gridText(rowDef[0]);
    // Nome accessibile (lettori di schermo e test end-to-end).
    relativeVelocityControls[rowDef[1]].setAttribute(
        "aria-label", rowDef[0] + " relativa (ECEF)"
    );
    absoluteVelocityControls[rowDef[1]].setAttribute(
        "aria-label", rowDef[0] + " assoluta (ECI)"
    );
    appendGridCell(relativeVelocityControls[rowDef[1]]);
    appendGridCell(absoluteVelocityControls[rowDef[1]]);
});


// Valori mostrati con al massimo 3 decimali (i calcoli usano i valori
// interni a precisione piena).
function formatNumber(x) {
    return String(Number(x.toFixed(3)));
}

function syncVelocityInputs(skipInput) {
    function set(input, value) {
        if (input !== skipInput) {
            input.value = formatNumber(value);
        }
    }
    velocityControls.forEach(function (c) {
        set(c.speed, c.state.speedKmh);
        set(c.azimuth, c.state.azimuthDeg);
        set(c.elevation, c.state.elevationDeg);
    });
}

syncVelocityInputs();

// --- Modello ----------------------------------------------------------

const modelSection = createSection("Modello");

const sphericalEarthLabel = document.createElement("label");
const sphericalEarthCheckbox = document.createElement("input");
sphericalEarthCheckbox.type = "checkbox";
sphericalEarthCheckbox.checked = settings.useSphericalEarth;
sphericalEarthCheckbox.style.marginRight = "6px";

sphericalEarthLabel.appendChild(sphericalEarthCheckbox);
sphericalEarthLabel.appendChild(document.createTextNode("Usa Terra sferica"));
modelSection.appendChild(sphericalEarthLabel);

// --- Visualizzazione ---------------------------------------------------
//
// Per ogni voce due checkbox: oggetti ECI (assoluti) e ECEF (relativi).
// Sono attive anche durante la simulazione: agiscono solo sulla
// visualizzazione, non sulla fisica.

const visibilitySection = createSection("Visualizzazione");

const visibilityGrid = document.createElement("div");
visibilityGrid.className = "sim-visibility";
visibilitySection.appendChild(visibilityGrid);

function visibilityText(text, className) {
    const span = document.createElement("span");
    span.textContent = text;
    if (className) {
        span.className = className;
    }
    visibilityGrid.appendChild(span);
}

function visibilityCheckbox(title, onToggle) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.title = title;
    checkbox.addEventListener("change", function () {
        onToggle(checkbox.checked);
    });
    visibilityGrid.appendChild(checkbox);
    return checkbox;
}

function setFrameShow(polylines, show) {
    polylines.forEach(function (polyline) {
        polyline.show = show;
    });
}

visibilityText("");
visibilityText("Assoluti (ECI)", "sim-colhead");
visibilityText("Relativi (ECEF)", "sim-colhead");

[
    {
        label: "Frame",
        eci: function (show) { setFrameShow(eciFramePolylines, show); },
        ecef: function (show) { setFrameShow(ecefFramePolylines, show); }
    },
    {
        label: "Traiettoria",
        eci: function (show) { eciTrack.setShow(show); },
        ecef: function (show) { ecefTrack.setShow(show); }
    },
    {
        label: "Velocità",
        eci: function (show) { absoluteVelocityArrow.show = show; },
        ecef: function (show) { relativeVelocityArrow.show = show; }
    }
].forEach(function (item) {
    visibilityText(item.label);
    visibilityCheckbox(item.label + " ECI", item.eci);
    visibilityCheckbox(item.label + " ECEF", item.ecef);
});

// --- Stato ------------------------------------------------------------

const statusSection = createSection("Stato");

const status = document.createElement("div");
status.className = "sim-status";
statusSection.appendChild(status);

// --- Legenda ----------------------------------------------------------

const legendSection = createSection("Legenda");
legendSection.classList.add("sim-legend");

[
    [Cesium.Color.LIME, "Traccia e velocità relative (ECEF)"],
    [Cesium.Color.RED, "Traccia e velocità assolute (ECI)"],
    [Cesium.Color.VIOLET, "Asse di rotazione terrestre"]
].forEach(function (item) {
    const row = document.createElement("div");
    const swatch = document.createElement("span");
    swatch.className = "sim-swatch";
    swatch.style.background = item[0].toCssColorString();
    row.appendChild(swatch);
    row.appendChild(document.createTextNode(item[1]));
    legendSection.appendChild(row);
});


// --------------------------------------------------
// SELEZIONE DEL PUNTO SULLA SUPERFICIE
// --------------------------------------------------
//
// Premuto il pulsante, il clic sinistro successivo sul globo
// sceglie il punto. Il trascinamento continua a ruotare la vista.

let pickMode = false;

function setPickMode(active) {
    pickMode = active;
    pickButton.textContent = active
        ? "Annulla"
        : "Punto iniziale";
    pickButton.title = active
        ? "Clicca un punto sul globo, oppure premi qui per annullare"
        : "";
    viewer.canvas.style.cursor = active ? "crosshair" : "";
}

// La simulazione è "resettata" quando si trova a t = 0: all'apertura
// della pagina, dopo Reset, o dopo aver cambiato punto o quota.
function isAtReset() {
    return Cesium.JulianDate.equals(
        viewer.clock.currentTime,
        simulationStart
    );
}

pickButton.addEventListener("click", function () {
    if (viewer.clock.shouldAnimate) {
        return; // Disattivato durante la simulazione.
    }

    // Uscire dalla modalità selezione è sempre permesso.
    if (!pickMode && !isAtReset()) {
        showError(
            "Per selezionare un nuovo punto premi prima il pulsante Reset."
        );
        return;
    }

    hideError();
    setPickMode(!pickMode);
});

const pickHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);

pickHandler.setInputAction(function (click) {
    if (!pickMode || viewer.clock.shouldAnimate || !isAtReset()) {
        return;
    }

    const ray = viewer.camera.getPickRay(click.position);
    const picked = Cesium.defined(ray)
        ? viewer.scene.globe.pick(ray, viewer.scene)
        : undefined;

    if (!Cesium.defined(picked)) {
        return; // Clic nello spazio: resta in modalità selezione.
    }

    // Il punto è in ECEF all'istante corrente. Lo si usa come punto
    // geografico: la simulazione riparte da t = 0, quando ECI = ECEF.
    const cartographic = Cesium.Cartographic.fromCartesian(picked);
    applyStartPoint(
        Cesium.Math.toDegrees(cartographic.latitude),
        Cesium.Math.toDegrees(cartographic.longitude)
    );
    syncStartInputs();
    viewer.selectedEntity = undefined;

    setPickMode(false);
    restartSimulation();
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// --------------------------------------------------
// CAMPO QUOTA DI PARTENZA
// --------------------------------------------------

// Latitudine, longitudine e quota si comportano allo stesso modo:
// - "input": a ogni variazione (anche tenendo premuti su/giù) aggiorna
//   subito la posizione di partenza, il marcatore e la sfera, senza
//   riscrivere il campo in modifica; valori incompleti sono ignorati;
// - "change": a modifica conclusa normalizza e riscrive il campo.

function syncStartInputs(skipInput) {
    function set(input, value) {
        if (input !== skipInput) {
            input.value = formatNumber(value);
        }
    }
    set(latitudeInput, settings.startLatitudeDeg);
    set(longitudeInput, settings.startLongitudeDeg);
    set(altitudeInput, settings.startAltitude / 1000);
}

function attachStartHandler(input, applyValue) {
    function apply(isFinal) {
        if (viewer.clock.shouldAnimate) {
            return; // Disattivato durante la simulazione.
        }
        const value = parseFloat(input.value);
        if (!isFinite(value)) {
            if (isFinal) {
                syncStartInputs(); // ripristina il valore valido
            }
            return;
        }
        applyValue(value);
        syncStartInputs(isFinal ? undefined : input);
        restartSimulation();
    }
    input.addEventListener("input", function () {
        apply(false);
    });
    input.addEventListener("change", function () {
        apply(true);
    });
}

attachStartHandler(latitudeInput, function (deg) {
    // Limitata a [-90°, +90°].
    applyStartPoint(deg, settings.startLongitudeDeg);
});

attachStartHandler(longitudeInput, function (deg) {
    // Ricondotta a [0°, 360°) e riscritta subito se "avvolta", così
    // tenendo premuto su/giù il punto continua a girare.
    applyStartPoint(settings.startLatitudeDeg, deg);
    if (settings.startLongitudeDeg !== deg) {
        longitudeInput.value = formatNumber(settings.startLongitudeDeg);
    }
});

attachStartHandler(altitudeInput, function (km) {
    // Non negativa.
    settings.startAltitude = Math.max(0, km) * 1000;
});

// --------------------------------------------------
// CAMPI VELOCITÀ INIZIALE (MODULO, AZIMUTH, ELEVAZIONE)
// --------------------------------------------------

function readNumber(input, fallback) {
    const value = parseFloat(input.value);
    return isFinite(value) ? value : fallback;
}

// Ogni campo aggiorna solo il proprio valore, poi la terna modificata
// diventa quella di riferimento e l'altra viene ricalcolata.
// Ogni campo aggiorna solo il proprio valore, poi la terna modificata
// diventa quella di riferimento e l'altra viene ricalcolata.
//
// Due eventi:
// - "input": scatta a ogni variazione, anche a ogni passo quando si
//   tengono premuti i tasti su/giù o le frecce del campo. Aggiorna
//   subito velocità, frecce e terna opposta, senza riscrivere il campo
//   in modifica (per non disturbare la digitazione). Valori non ancora
//   numerici (es. campo vuoto o "-") vengono ignorati.
// - "change": a modifica conclusa (Invio o uscita dal campo) normalizza
//   e riscrive anche il campo modificato.
function attachVelocityHandlers(controls, master) {
    function apply(field, input, isFinal) {
        if (viewer.clock.shouldAnimate) {
            return; // Disattivato durante la simulazione.
        }

        const value = parseFloat(input.value);
        if (!isFinite(value)) {
            if (isFinal) {
                syncVelocityInputs(); // ripristina il valore valido
            }
            return;
        }

        const state = controls.state;

        if (field === "speedKmh") {
            // Modulo: non negativo.
            state.speedKmh = Math.max(0, value);
        } else if (field === "azimuthDeg") {
            // Azimuth: ricondotto all'intervallo [0, 360).
            state.azimuthDeg = ((value % 360) + 360) % 360;
            // Avvolge subito il campo (es. 360 -> 0, -1 -> 359), così
            // tenendo premuto su/giù la direzione continua a ruotare.
            if (state.azimuthDeg !== value) {
                input.value = formatNumber(state.azimuthDeg);
            }
        } else {
            // Elevazione: limitata a [-90, 90].
            state.elevationDeg = Cesium.Math.clamp(value, -90, 90);
        }

        settings.velocityMaster = master;

        // Ricalcola stato iniziale, terna opposta e frecce.
        restartSimulation(isFinal ? undefined : input);
    }

    [
        ["speedKmh", controls.speed],
        ["azimuthDeg", controls.azimuth],
        ["elevationDeg", controls.elevation]
    ].forEach(function (entry) {
        const field = entry[0];
        const input = entry[1];
        input.addEventListener("input", function () {
            apply(field, input, false);
        });
        input.addEventListener("change", function () {
            apply(field, input, true);
        });
    });
}

attachVelocityHandlers(relativeVelocityControls, "relative");
attachVelocityHandlers(absoluteVelocityControls, "absolute");

// --------------------------------------------------
// FLAG "USA TERRA SFERICA"
// --------------------------------------------------
//
// Cambia il modello usato da gravità e urti e fa ripartire la
// simulazione da t = 0 (la posizione iniziale dipende dal modello).

sphericalEarthCheckbox.addEventListener("change", function () {
    if (viewer.clock.shouldAnimate) {
        sphericalEarthCheckbox.checked = settings.useSphericalEarth;
        return; // Disattivato durante la simulazione.
    }
    settings.useSphericalEarth = sphericalEarthCheckbox.checked;
    restartSimulation();
});


// --------------------------------------------------
// PULSANTE AVVIO / ARRESTO
// --------------------------------------------------

// Durante la simulazione l'unico controllo attivo è il pulsante
// di arresto: Reset, selezione del punto e quota sono disattivati
// finché la simulazione non viene fermata.
function updateControlsState() {
    const running = viewer.clock.shouldAnimate;

    startButton.innerHTML = running ? ICON_PAUSE : ICON_PLAY;
    startButton.title = running ? "Pausa" : "Avvia";
    startButton.setAttribute("aria-label", startButton.title);

    resetButton.disabled = running;
    pickButton.disabled = running;
    altitudeInput.disabled = running;
    latitudeInput.disabled = running;
    longitudeInput.disabled = running;
    velocityControls.forEach(function (c) {
        c.speed.disabled = running;
        c.azimuth.disabled = running;
        c.elevation.disabled = running;
    });
    sphericalEarthCheckbox.disabled = running;

    if (running && pickMode) {
        setPickMode(false);
    }
}

startButton.addEventListener("click", function () {

    viewer.clock.shouldAnimate = !viewer.clock.shouldAnimate;
    updateControlsState();
});

updateControlsState();

// --------------------------------------------------
// PULSANTE RESET
// --------------------------------------------------

resetButton.addEventListener("click", function () {

    if (viewer.clock.shouldAnimate) {
        return; // Disattivato durante la simulazione.
    }

    hideError();

    // Riporta il tempo a zero e la sfera allo stato iniziale
    // (punto e quota correnti). La telecamera conserva la posa ECI.
    restartSimulation();
});

// --------------------------------------------------
// INFORMAZIONI SULLA SIMULAZIONE
// --------------------------------------------------

viewer.scene.postRender.addEventListener(function () {

    // Velocità relativa alla Terra: v_ECEF = v_ECI - ω × r
    // (il modulo non dipende dalla rotazione tra i due sistemi).
    const p = physics.position;
    const v = physics.velocity;
    const relX = v.x + OMEGA * p.y;
    const relY = v.y - OMEGA * p.x;
    const speedEcefKmh = Math.sqrt(relX * relX + relY * relY + v.z * v.z) * 3.6;
    const speedEciKmh = Cesium.Cartesian3.magnitude(v) * 3.6;

    status.textContent =
        "Punto:      " +
        settings.startLatitudeDeg.toFixed(2) +
        "°, " +
        settings.startLongitudeDeg.toFixed(2) +
        "°\n" +
        "Tempo:      " +
        simulationTime.toFixed(1) +
        " s\n" +
        "Angolo:     " +
        Cesium.Math.toDegrees(earthAngle).toFixed(3) +
        "°\n" +
        "Quota:      " +
        (physics.altitude / 1000).toFixed(1) +
        " km\n" +
        "v ECEF:     " +
        speedEcefKmh.toFixed(0) +
        " km/h\n" +
        "v ECI:      " +
        speedEciKmh.toFixed(0) +
        " km/h";
});

// --------------------------------------------------
// ACCESSO PER I TEST END-TO-END
// --------------------------------------------------
//
// Oggetto in sola lettura usato dai test Playwright per verificare lo
// stato della scena. Non ha effetti sulla simulazione.

window.__coriolis = {
    viewer: viewer,
    settings: settings,
    physics: physics,
    arrows: {
        absolute: absoluteVelocityArrow,
        relative: relativeVelocityArrow
    },
    frames: {
        eci: eciFramePolylines,
        ecef: ecefFramePolylines
    }
};
