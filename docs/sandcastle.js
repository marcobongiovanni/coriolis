// ============================================================
// FILE GENERATO da scripts/build.mjs — non modificarlo qui.
// Modifica i file di src/, poi esegui
// "npm run sandcastle" e incolla questo file in Sandcastle.
// ============================================================

// ---------------------------------------------------- src/geometry/referenceFrames.js
// ============================================================
// referenceFrames.js — Sistemi di riferimento ECI/ECEF e terna
// locale Est-Nord-Su (ENU).
//
// Solo funzioni pure, senza stato: le usano il modello, il
// ViewModel e la vista. Il tempo è in secondi simulati dall'inizio
// (t = 0, quando ECI ed ECEF coincidono).
// ============================================================


const OMEGA = 7.292115e-5; // Velocità angolare terrestre [rad/s]
const KMH_PER_MS = 3.6;    // Conversione m/s -> km/h

// Angolo di cui la Terra ha ruotato dopo "seconds" secondi simulati.
function earthRotationAngle(seconds) {
    return OMEGA * seconds;
}

// Rotazione attorno all'asse Z (comune a ECI ed ECEF) di "angle".
// "result" può coincidere con "vector".
function rotateAboutZ(vector, angle, result) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const x = c * vector.x - s * vector.y;
    const y = s * vector.x + c * vector.y;

    result = result || new Cesium.Cartesian3();
    result.x = x;
    result.y = y;
    result.z = vector.z;
    return result;
}

// ECI -> ECEF: rotazione attorno all'asse Z di -angle.
function eciToEcef(vector, angle, result) {
    return rotateAboutZ(vector, -angle, result);
}

// ECEF -> ECI: rotazione attorno all'asse Z di +angle.
function ecefToEci(vector, angle, result) {
    return rotateAboutZ(vector, angle, result);
}

// Velocità relativa alla Terra, in coordinate ECI: v - ω × r,
// con ω = (0, 0, OMEGA).
function relativeVelocity(position, velocity, result) {
    result = result || new Cesium.Cartesian3();
    result.x = velocity.x + OMEGA * position.y;
    result.y = velocity.y - OMEGA * position.x;
    result.z = velocity.z;
    return result;
}

// Angolo in gradi ricondotto all'intervallo [0°, 360°). Gli angoli già
// nell'intervallo restano identici (nessun errore di arrotondamento).
function normalizeDegrees(deg) {
    const r = deg % 360;
    const wrapped = r < 0 ? r + 360 : r;
    return wrapped >= 360 ? 0 : wrapped + 0; // "+ 0" trasforma -0 in 0
}

// --------------------------------------------------
// TERNA LOCALE EST-NORD-SU
// --------------------------------------------------

const scratchEnuTransform = new Cesium.Matrix4();

// Rotazione dalla terna Est-Nord-Su del punto (normale geodetica
// WGS84) alle coordinate cartesiane: le colonne sono Est, Nord, Su.
function enuRotation(point, result) {
    Cesium.Transforms.eastNorthUpToFixedFrame(point, Cesium.Ellipsoid.WGS84, scratchEnuTransform);
    return Cesium.Matrix4.getMatrix3(scratchEnuTransform, result || new Cesium.Matrix3());
}

// Versore ENU di azimuth [°] (in senso orario dal Nord) ed elevazione
// [°] (sopra l'orizzonte locale).
function directionEnu(azimuthDeg, elevationDeg) {
    const az = Cesium.Math.toRadians(azimuthDeg);
    const el = Cesium.Math.toRadians(elevationDeg);
    return new Cesium.Cartesian3(
        Math.cos(el) * Math.sin(az),
        Math.cos(el) * Math.cos(az),
        Math.sin(el)
    );
}

// ---------------------------------------------------- src/model/earth.js
// ============================================================
// earth.js — Modelli di Terra usati da gravità e urti.
//
// Ogni modello è una strategia con la stessa forma:
//   gravity(position, result)            accelerazione [m/s²]
//   potential(position)                  potenziale [J/kg]
//   heightAboveSurface(position, normal) distanza con segno dalla
//       superficie lungo la sua normale (scritta in "normal");
//       undefined se non definita
//   pointAboveSurface(surfacePoint, height, result)
//       punto a "height" metri sopra "surfacePoint", lungo la normale
//   rotationAxis                         asse di rotazione terrestre
//
// La simulazione sceglie il modello e non contiene "if" sul tipo di
// Terra.
//
// TERRA SFERICA
// - Gravità: legge di gravitazione universale, a = -GM·r/|r|³.
// - Superficie: sfera di raggio EARTH_RADIUS, normale radiale, cioè
//   allineata alla gravità: una particella rimbalza sempre sulla stessa
//   verticale inerziale. La superficie differisce fino a ~21 km
//   dall'ellissoide WGS84 visualizzato da Cesium.
//
// TERRA ELLISSOIDALE (WGS84)
// - Gravità: massa puntiforme + termine J2 dello schiacciamento.
//   Insieme alla forza centrifuga la superficie WGS84 risulta (quasi)
//   equipotenziale: un corpo fermo rispetto alla Terra non "scivola"
//   verso i poli.
// - Superficie: ellissoide WGS84, normale geodetica.
//
// Entrambe le superfici sono simmetriche attorno all'asse Z, quindi
// la loro forma in ECI non cambia con la rotazione terrestre.
// ============================================================


const GM = 3.986004418e14;              // G·M terrestre [m³/s²]
const EARTH_RADIUS = 6371008.8;          // Raggio medio (IUGG) [m]
const WGS84 = Cesium.Ellipsoid.WGS84;
const EQUATORIAL_RADIUS = WGS84.radii.x; // [m]
const J2 = 1.08262668e-3;                // Coefficiente zonale J2 (WGS84)

// Comune ai due modelli: la Terra ruota attorno all'asse Z (verso il
// Polo Nord) con velocità angolare OMEGA [rad/s].
const ROTATION_AXIS = Object.freeze({
    direction: Cesium.Cartesian3.UNIT_Z,
    angularVelocity: OMEGA
});

const scratchSurfacePoint = new Cesium.Cartesian3();
const scratchSurfaceOffset = new Cesium.Cartesian3();

const SPHERICAL_EARTH = {
    rotationAxis: ROTATION_AXIS,

    gravity(position, result) {
        const r2 = Cesium.Cartesian3.magnitudeSquared(position);
        return Cesium.Cartesian3.multiplyByScalar(position, -GM / (r2 * Math.sqrt(r2)), result);
    },

    potential(position) {
        return -GM / Cesium.Cartesian3.magnitude(position);
    },

    heightAboveSurface(position, normalResult) {
        const r = Cesium.Cartesian3.magnitude(position);
        if (r === 0) {
            return undefined;
        }
        Cesium.Cartesian3.divideByScalar(position, r, normalResult);
        return r - EARTH_RADIUS;
    },

    pointAboveSurface(surfacePoint, height, result) {
        const up = Cesium.Cartesian3.normalize(surfacePoint, result);
        return Cesium.Cartesian3.multiplyByScalar(up, EARTH_RADIUS + height, result);
    }
};

const ELLIPSOIDAL_EARTH = {
    rotationAxis: ROTATION_AXIS,

    // Massa puntiforme corretta dal termine J2 (asse di simmetria Z):
    //   ax,y = a_pm · [1 + 3/2·J2·(Re/r)²·(1 - 5·z²/r²)]
    //   az   = a_pm · [1 + 3/2·J2·(Re/r)²·(3 - 5·z²/r²)]
    gravity(position, result) {
        SPHERICAL_EARTH.gravity(position, result);
        const r2 = Cesium.Cartesian3.magnitudeSquared(position);
        const k = 1.5 * J2 * (EQUATORIAL_RADIUS * EQUATORIAL_RADIUS) / r2;
        const z2r2 = (position.z * position.z) / r2;
        const horizontal = 1 + k * (1 - 5 * z2r2);
        result.x *= horizontal;
        result.y *= horizontal;
        result.z *= 1 + k * (3 - 5 * z2r2);
        return result;
    },

    potential(position) {
        const r = Cesium.Cartesian3.magnitude(position);
        const s = position.z / r;
        return SPHERICAL_EARTH.potential(position) *
            (1 - J2 * (EQUATORIAL_RADIUS / r) ** 2 * (3 * s * s - 1) / 2);
    },

    heightAboveSurface(position, normalResult) {
        const surface = WGS84.scaleToGeodeticSurface(position, scratchSurfacePoint);
        if (!Cesium.defined(surface)) {
            return undefined;
        }
        WGS84.geodeticSurfaceNormal(surface, normalResult);
        const offset = Cesium.Cartesian3.subtract(position, surface, scratchSurfaceOffset);
        return Cesium.Cartesian3.dot(offset, normalResult);
    },

    pointAboveSurface(surfacePoint, height, result) {
        const surface = WGS84.scaleToGeodeticSurface(surfacePoint, scratchSurfacePoint);
        const normal = WGS84.geodeticSurfaceNormal(surface, result);
        Cesium.Cartesian3.multiplyByScalar(normal, height, result);
        return Cesium.Cartesian3.add(surface, result, result);
    }
};

// ---------------------------------------------------- src/model/arrow.js
// ============================================================
// arrow.js — Freccia: grandezza vettoriale applicata nel centro di
// una particella (per esempio la velocità).
//
// La grandezza è calcolata dallo stato corrente della particella con
// la funzione "quantity(state, result)", che restituisce le componenti
// in coordinate ECI. "system" indica rispetto a quale sistema è
// misurata la grandezza: "eci" (spazio inerziale) o "ecef" (Terra).
// ============================================================


class Arrow {
    system; // "eci" o "ecef"

    #state;    // Stato corrente della particella: { position, velocity } in ECI
    #quantity; // (state, result) => componenti ECI della grandezza

    constructor(system, state, quantity) {
        this.system = system;
        this.#state = state;
        this.#quantity = quantity;
    }

    // Componenti in coordinate ECI.
    value(result = new Cesium.Cartesian3()) {
        return this.#quantity(this.#state, result);
    }

    // Punto di applicazione e vettore in coordinate ECEF all'istante
    // "seconds" dello stato corrente (copie).
    inEcef(seconds) {
        const angle = earthRotationAngle(seconds);
        return {
            origin: eciToEcef(this.#state.position, angle),
            vector: eciToEcef(this.value(), angle)
        };
    }
}

// ---------------------------------------------------- src/model/enuFrame.js
// ============================================================
// enuFrame.js — Terna Est-Nord-Su con origine in un punto.
//
// A t = 0 i sistemi ECI ed ECEF coincidono, quindi origine e assi sono
// gli stessi in entrambi. Poi la terna:
//   "ecef": resta solidale con la Terra (ferma in ECEF);
//   "eci":  resta ferma nello spazio inerziale (ferma in ECI) e, vista
//           dalla Terra, ruota all'indietro dell'angolo di rotazione
//           terrestre.
//
// I metodi statici convertono una velocità tra componenti nella terna
// e modulo/azimuth/elevazione.
// ============================================================


class EnuFrame {
    system; // "eci" o "ecef"

    // Nel sistema della terna (costanti dopo placeAt).
    origin = new Cesium.Cartesian3();
    axes = [new Cesium.Cartesian3(), new Cesium.Cartesian3(), new Cesium.Cartesian3()]; // E, N, U

    #rotation = new Cesium.Matrix3();

    constructor(system) {
        this.system = system;
    }

    // Porta l'origine in "origin" (a t = 0) e orienta gli assi verso
    // Est, Nord e Su in quel punto.
    placeAt(origin) {
        Cesium.Cartesian3.clone(origin, this.origin);
        enuRotation(origin, this.#rotation);
        this.axes.forEach((axis, i) => Cesium.Matrix3.getColumn(this.#rotation, i, axis));
    }

    // Origine e assi in coordinate ECEF all'istante "seconds" (copie).
    inEcef(seconds) {
        const angle = this.system === "eci" ? earthRotationAngle(seconds) : 0;
        return {
            origin: eciToEcef(this.origin, angle),
            axes: this.axes.map((axis) => eciToEcef(axis, angle))
        };
    }

    // --------------------------------------------------
    // CONVERSIONI DELLA VELOCITÀ
    // --------------------------------------------------

    // { speedKmh, azimuthDeg, elevationDeg } -> componenti E, N, U [m/s].
    static fromSpherical(v) {
        const direction = directionEnu(v.azimuthDeg, v.elevationDeg);
        return Cesium.Cartesian3.multiplyByScalar(direction, v.speedKmh / KMH_PER_MS, direction);
    }

    // Componenti E, N, U [m/s] -> modulo/azimuth/elevazione, scritti in
    // "v". Se la direzione è indefinita (modulo nullo o velocità
    // verticale) si conservano gli angoli precedenti.
    static toSpherical(local, v) {
        const speed = Cesium.Cartesian3.magnitude(local);
        const horizontal = Math.hypot(local.x, local.y);

        v.speedKmh = speed * KMH_PER_MS;

        if (speed < 1e-9) {
            return;
        }
        v.elevationDeg = Cesium.Math.toDegrees(Math.asin(
            Cesium.Math.clamp(local.z / speed, -1, 1)
        ));
        if (horizontal > 1e-9) {
            v.azimuthDeg = normalizeDegrees(Cesium.Math.toDegrees(Math.atan2(local.x, local.y)));
        }
    }
}

// ---------------------------------------------------- src/model/trajectory.js
// ============================================================
// trajectory.js — Traiettoria del centro di una particella.
//
// Sequenza delle posizioni registrate a ogni istante raggiunto dalla
// simulazione, nel sistema di riferimento della traiettoria:
//   "eci":  ferma nello spazio inerziale;
//   "ecef": solidale con la Terra.
// ============================================================


const TRAJECTORY_MIN_DISTANCE = 10; // [m] evita vertici coincidenti

class Trajectory {
    system; // "eci" o "ecef"

    // Posizioni registrate (Cartesian3), in ordine di tempo.
    points = [];

    // Cresce a ogni clear(): chi disegna la traiettoria capisce che
    // deve ricominciare anche se nel frattempo sono stati aggiunti
    // nuovi punti.
    revision = 0;

    constructor(system) {
        this.system = system;
    }

    // Aggiunge una copia di "position", se dista almeno
    // TRAJECTORY_MIN_DISTANCE dall'ultimo punto.
    addPoint(position) {
        const last = this.points[this.points.length - 1];
        if (last && Cesium.Cartesian3.distance(last, position) < TRAJECTORY_MIN_DISTANCE) {
            return;
        }
        this.points.push(Cesium.Cartesian3.clone(position));
    }

    clear() {
        this.points = [];
        this.revision++;
    }
}

// ---------------------------------------------------- src/model/particle.js
// ============================================================
// particle.js — Modello di una particella: corpo sferico soggetto
// alla gravità che rimbalza elasticamente sulla Terra.
//
// Contiene ciò che appartiene alla singola particella:
//   - raggio;
//   - condizioni iniziali (punto e quota di partenza, velocità) con le
//     loro regole di validità;
//   - stato iniziale e stato corrente, in ECI;
//   - grandezze derivate (quota, energia);
//   - frecce della velocità assoluta (ECI) e relativa (ECEF);
//   - terne Est-Nord-Su nel punto di partenza (ECI ed ECEF);
//   - traiettorie del centro (ECI ed ECEF).
//
// Ciò che è comune a tutte le particelle (modello di Terra, tempo,
// integrazione) è in Simulation. Il modello di Terra viene passato ai
// metodi che ne dipendono.
//
// Le modifiche delle condizioni iniziali hanno effetto alla successiva
// chiamata di reset(earth) (Simulation.reset()).
// ============================================================


const DEFAULT_PARTICLE_RADIUS = 125000; // [m]

// Punto di partenza predefinito, usato finché il browser non fornisce
// la posizione geografica del PC.
const DEFAULT_START_POINT = { latitudeDeg: 45.0, longitudeDeg: 7.1 };

// Terne di velocità iniziale (nella terna Est-Nord-Su del punto di
// partenza: modulo [km/h], azimuth [°] dal Nord, elevazione [°]):
//   "relative": rispetto alla Terra (ECEF);
//   "absolute": rispetto allo spazio inerziale (ECI).
// L'ultima terna modificata è quella "di riferimento" (velocityMaster):
// l'altra viene ricalcolata da questa.
const VELOCITY_FRAMES = ["relative", "absolute"];

class Particle {
    radius;

    // Condizioni iniziali.
    start = {
        latitudeDeg: DEFAULT_START_POINT.latitudeDeg,   // [-90°, +90°]
        longitudeDeg: DEFAULT_START_POINT.longitudeDeg, // [0°, 360°)
        surfacePointECEF: new Cesium.Cartesian3(),
        altitude: 0 // Quota del punto più basso della particella [m]
    };

    velocityMaster = "relative";

    velocity = {
        relative: { speedKmh: 0, azimuthDeg: 0, elevationDeg: 0 },
        absolute: { speedKmh: 0, azimuthDeg: 0, elevationDeg: 0 }
    };

    // Stato iniziale (a t = 0 ECI ed ECEF coincidono).
    initial = {
        position: new Cesium.Cartesian3(),
        velocityECI: new Cesium.Cartesian3(),
        velocityECEF: new Cesium.Cartesian3()
    };

    // Stato corrente, in ECI.
    state = {
        position: new Cesium.Cartesian3(),
        velocity: new Cesium.Cartesian3(),
        altitude: 0 // Quota del punto più basso della particella [m]
    };

    // Velocità corrente del centro: assoluta (eci), v, e relativa alla
    // Terra (ecef), v - ω × r.
    velocityArrows = {
        eci: new Arrow("eci", this.state, (state, result) => Cesium.Cartesian3.clone(state.velocity, result)),
        ecef: new Arrow("ecef", this.state, (state, result) => relativeVelocity(state.position, state.velocity, result))
    };

    // Terne Est-Nord-Su con origine nel centro della particella a t = 0.
    startFrames = { eci: new EnuFrame("eci"), ecef: new EnuFrame("ecef") };

    // Posizioni del centro dall'inizio della simulazione.
    trajectories = { eci: new Trajectory("eci"), ecef: new Trajectory("ecef") };

    #enu = new Cesium.Matrix3();
    #scratchEcef = new Cesium.Cartesian3();

    constructor(radius = DEFAULT_PARTICLE_RADIUS) {
        this.radius = radius;
        this.setStartPoint(DEFAULT_START_POINT.latitudeDeg, DEFAULT_START_POINT.longitudeDeg);
    }

    // --------------------------------------------------
    // CONDIZIONI INIZIALI (con le loro regole di validità)
    // --------------------------------------------------

    // Latitudine limitata a [-90°, +90°], longitudine ricondotta a [0°, 360°).
    setStartPoint(latitudeDeg, longitudeDeg) {
        const start = this.start;
        start.latitudeDeg = Cesium.Math.clamp(latitudeDeg, -90, 90);
        start.longitudeDeg = normalizeDegrees(longitudeDeg);
        start.surfacePointECEF = Cesium.Cartesian3.fromDegrees(start.longitudeDeg, start.latitudeDeg, 0);
    }

    // Quota non negativa [m].
    setStartAltitude(meters) {
        this.start.altitude = Math.max(0, meters);
    }

    // Modifica una o più componenti della terna "frame", che diventa
    // quella di riferimento. Modulo non negativo, azimuth in [0°, 360°),
    // elevazione in [-90°, +90°].
    setVelocity(frame, changes) {
        const v = Object.assign(this.velocity[frame], changes);
        v.speedKmh = Math.max(0, v.speedKmh);
        v.azimuthDeg = normalizeDegrees(v.azimuthDeg);
        v.elevationDeg = Cesium.Math.clamp(v.elevationDeg, -90, 90);
        this.velocityMaster = frame;
    }

    // --------------------------------------------------
    // STATO
    // --------------------------------------------------

    // Calcola lo stato iniziale sul modello di Terra "earth", vi riporta
    // lo stato corrente e fa ripartire le traiettorie.
    reset(earth) {
        this.#computeInitialPosition(earth);
        this.#computeInitialVelocity();
        Cesium.Cartesian3.clone(this.initial.position, this.state.position);
        Cesium.Cartesian3.clone(this.initial.velocityECI, this.state.velocity);
        this.updateAltitude(earth);

        Object.values(this.startFrames).forEach((frame) => frame.placeAt(this.initial.position));
        Object.values(this.trajectories).forEach((trajectory) => trajectory.clear());
        this.recordTrajectory(0);
    }

    // Aggiunge la posizione corrente (istante "seconds") alle traiettorie.
    recordTrajectory(seconds) {
        const position = this.state.position;
        this.trajectories.eci.addPoint(position);
        this.trajectories.ecef.addPoint(eciToEcef(position, earthRotationAngle(seconds), this.#scratchEcef));
    }

    // Distanza con segno del punto più basso della particella dalla
    // superficie, lungo la normale (scritta in "normalResult");
    // undefined se non definita.
    clearance(earth, normalResult) {
        const h = earth.heightAboveSurface(this.state.position, normalResult);
        return Cesium.defined(h) ? h - this.radius : undefined;
    }

    updateAltitude(earth) {
        const c = this.clearance(earth, new Cesium.Cartesian3());
        this.state.altitude = Cesium.defined(c) ? c : 0;
    }

    // Energia meccanica specifica nel sistema ECI [J/kg]: si conserva
    // durante il moto (utile per verificare l'integrazione).
    mechanicalEnergy(earth) {
        return 0.5 * Cesium.Cartesian3.magnitudeSquared(this.state.velocity) +
            earth.potential(this.state.position);
    }

    // Centro della particella a raggio + quota dalla superficie del
    // modello, lungo la sua normale nel punto di partenza.
    #computeInitialPosition(earth) {
        earth.pointAboveSurface(
            this.start.surfacePointECEF,
            this.radius + this.start.altitude,
            this.initial.position
        );
    }

    // A t = 0 le due terne sono legate da v_ECI = v_ECEF + ω × r, dove
    // ω × r (velocità di trascinamento nel centro della particella)
    // nella terna ENU è diretta verso Est, di modulo ω·ρ (ρ = distanza
    // dall'asse di rotazione).
    #computeInitialVelocity() {
        const origin = this.initial.position;
        const enu = enuRotation(origin, this.#enu);
        const relativeIsMaster = this.velocityMaster === "relative";
        const master = relativeIsMaster ? this.velocity.relative : this.velocity.absolute;
        const derived = relativeIsMaster ? this.velocity.absolute : this.velocity.relative;

        const drag = new Cesium.Cartesian3(OMEGA * Math.hypot(origin.x, origin.y), 0, 0);
        const localMaster = EnuFrame.fromSpherical(master);
        const localDerived = relativeIsMaster
            ? Cesium.Cartesian3.add(localMaster, drag, new Cesium.Cartesian3())
            : Cesium.Cartesian3.subtract(localMaster, drag, new Cesium.Cartesian3());
        EnuFrame.toSpherical(localDerived, derived);

        // Da ENU a coordinate cartesiane (ECEF = ECI a t = 0).
        Cesium.Matrix3.multiplyByVector(
            enu, relativeIsMaster ? localMaster : localDerived, this.initial.velocityECEF
        );
        Cesium.Matrix3.multiplyByVector(
            enu, relativeIsMaster ? localDerived : localMaster, this.initial.velocityECI
        );
    }
}

// ---------------------------------------------------- src/model/simulation.js
// ============================================================
// simulation.js — Modello: particella che si muove attorno alla
// Terra in rotazione.
//
// Contiene ciò che è comune a tutte le particelle: modello di Terra,
// tempo simulato, integrazione e urti. Lo stato e le condizioni
// iniziali di ogni particella sono in Particle; i metodi di
// integrazione ricevono la particella su cui agire.
//
// Non dipende dal livello di presentazione (né Viewer, né DOM, né
// orologio di Cesium): usa solo le classi matematiche di Cesium, quindi
// funziona sia nel browser sia in Node, dove la provano i test unitari.
//
// - Dinamica calcolata nel sistema inerziale ECI.
// - Integrazione Velocity Verlet a passo variabile (<= MAX_PHYSICS_STEP)
//   con ricerca dell'istante esatto di contatto.
// - Urto elastico e senza attrito lungo la normale della superficie del
//   modello di Terra scelto (vedi earth.js).
// ============================================================


const MAX_PHYSICS_STEP = 0.5;  // Passo massimo di integrazione [s]
const MAX_SUBSTEPS = 20000;           // Limite di sicurezza per chiamata
const MAX_CONTACTS_PER_STEP = 5;      // Urti risolti in un singolo passo
const CONTACT_BISECTIONS = 40;        // Iterazioni per l'istante di contatto

class Simulation {
    // Modello di Terra usato da gravità e urti: sfera (true) o
    // ellissoide WGS84 con J2 (false).
    useSphericalEarth = true;

    particle = new Particle();

    time = 0; // Istante simulato a cui si riferisce lo stato [s]

    #scratch = {
        accel0: new Cesium.Cartesian3(),
        accel1: new Cesium.Cartesian3(),
        temp: new Cesium.Cartesian3(),
        normal: new Cesium.Cartesian3(),
        savedPosition: new Cesium.Cartesian3(),
        savedVelocity: new Cesium.Cartesian3()
    };

    constructor() {
        this.reset();
    }

    get earth() {
        return this.useSphericalEarth ? SPHERICAL_EARTH : ELLIPSOIDAL_EARTH;
    }

    // Riporta la simulazione a t = 0, applicando le condizioni iniziali
    // correnti (modello di Terra e particelle).
    reset() {
        this.particle.reset(this.earth);
        this.time = 0;
    }

    // Porta lo stato esattamente all'istante "target" [s simulati]. È
    // idempotente: chiamata più volte con lo stesso istante integra una
    // sola volta. Un istante precedente riparte da t = 0.
    advanceTo(target) {
        if (target < this.time) {
            this.reset();
        }

        const remaining = target - this.time;
        if (remaining <= 0) {
            return;
        }

        const n = Math.min(Math.ceil(remaining / MAX_PHYSICS_STEP), MAX_SUBSTEPS);
        const h = remaining / n;
        for (let i = 0; i < n; i++) {
            this.#step(this.particle, h, 0);
        }

        this.time = target;
        this.particle.updateAltitude(this.earth);
        this.particle.recordTrajectory(target);
    }

    // --------------------------------------------------
    // INTEGRAZIONE E URTI
    // --------------------------------------------------

    // Vero se la particella compenetra la superficie e si sta ancora
    // avvicinando (dopo il rimbalzo la velocità normale è positiva).
    #isCollidingInward(particle) {
        const n = this.#scratch.normal;
        const c = particle.clearance(this.earth, n);
        if (!Cesium.defined(c) || c >= 0) {
            return false;
        }
        return Cesium.Cartesian3.dot(particle.state.velocity, n) < 0;
    }

    // Urto elastico senza attrito: inverte la componente normale della
    // velocità rispetto alla superficie nel punto di contatto.
    #reflectVelocity(particle) {
        const n = this.#scratch.normal;
        const v = particle.state.velocity;
        particle.clearance(this.earth, n);
        const vn = Cesium.Cartesian3.dot(v, n);
        if (vn < 0) {
            Cesium.Cartesian3.subtract(
                v, Cesium.Cartesian3.multiplyByScalar(n, 2 * vn, this.#scratch.temp), v
            );
        }
    }

    #saveState(particle) {
        Cesium.Cartesian3.clone(particle.state.position, this.#scratch.savedPosition);
        Cesium.Cartesian3.clone(particle.state.velocity, this.#scratch.savedVelocity);
    }

    #restoreState(particle) {
        Cesium.Cartesian3.clone(this.#scratch.savedPosition, particle.state.position);
        Cesium.Cartesian3.clone(this.#scratch.savedVelocity, particle.state.velocity);
    }

    // Un passo che gestisce l'urto all'istante esatto di contatto: se a
    // fine passo c'è compenetrazione, si cerca per bisezione l'istante del
    // contatto, si integra fino a lì, si riflette la velocità e si integra
    // il tempo rimanente.
    #step(particle, h, contacts) {
        this.#saveState(particle);
        this.#verletStep(particle, h);

        if (!this.#isCollidingInward(particle) || contacts >= MAX_CONTACTS_PER_STEP) {
            return;
        }

        let lo = 0;
        let hi = h;
        for (let i = 0; i < CONTACT_BISECTIONS; i++) {
            const mid = 0.5 * (lo + hi);
            this.#restoreState(particle);
            this.#verletStep(particle, mid);
            if (this.#isCollidingInward(particle)) {
                hi = mid;
            } else {
                lo = mid;
            }
        }

        this.#restoreState(particle);
        this.#verletStep(particle, hi);
        this.#reflectVelocity(particle);

        if (h - hi > 0) {
            this.#step(particle, h - hi, contacts + 1);
        }
    }

    // Velocity Verlet:
    //   p += v·h + ½·a0·h²
    //   v += ½·(a0 + a1)·h
    #verletStep(particle, h) {
        const C3 = Cesium.Cartesian3;
        const earth = this.earth;
        const p = particle.state.position;
        const v = particle.state.velocity;
        const temp = this.#scratch.temp;

        const a0 = earth.gravity(p, this.#scratch.accel0);
        C3.add(p, C3.multiplyByScalar(v, h, temp), p);
        C3.add(p, C3.multiplyByScalar(a0, 0.5 * h * h, temp), p);

        const a1 = earth.gravity(p, this.#scratch.accel1);
        C3.add(v, C3.multiplyByScalar(C3.add(a0, a1, temp), 0.5 * h, temp), v);
    }
}

// ---------------------------------------------------- src/services/interfaces.js
// ============================================================
// interfaces.js — Interfacce delle sorgenti esterne usate dal
// ViewModel.
//
// Il ViewModel conosce solo queste classi astratte: le
// implementazioni concrete (orologio di Cesium, geolocalizzazione del
// browser, finti oggetti nei test) vengono scelte in main.js.
// ============================================================

function notImplemented(member) {
    throw new Error(`${member} non implementato`);
}

// Verifica che "object" implementi l'interfaccia "contract".
function requireImplementation(object, contract) {
    if (!(object instanceof contract)) {
        throw new TypeError(`Serve un'implementazione di ${contract.name}`);
    }
    return object;
}

// Sorgente del tempo simulato.
class SimulationClock {
    // Vero mentre il tempo simulato scorre.
    get running() {
        return notImplemented("SimulationClock.running");
    }

    set running(value) {
        notImplemented("SimulationClock.running");
    }

    // Riporta il tempo simulato a t = 0.
    reset() {
        notImplemented("SimulationClock.reset()");
    }

    // Vero se il tempo simulato è t = 0.
    isAtStart() {
        return notImplemented("SimulationClock.isAtStart()");
    }
}

// Posizione geografica del dispositivo.
class GeolocationService {
    // Promise di { latitudeDeg, longitudeDeg }, oppure di undefined se
    // la posizione non è disponibile (mai rifiutata).
    getCurrentPosition() {
        return notImplemented("GeolocationService.getCurrentPosition()");
    }
}

// ---------------------------------------------------- src/services/browserGeolocation.js
// ============================================================
// browserGeolocation.js — GeolocationService basato sulla
// Geolocation API del browser.
//
// Il browser fornisce la posizione solo in un contesto sicuro (https
// o localhost) e se l'utente lo consente; in un iframe può essere
// negata (es. in Sandcastle). In tutti questi casi il risultato è
// undefined.
// ============================================================


const GEOLOCATION_OPTIONS = {
    enableHighAccuracy: false, // basta la posizione approssimata
    timeout: 15000,
    maximumAge: 10 * 60 * 1000
};

class BrowserGeolocationService extends GeolocationService {
    #geolocation;

    constructor(geolocation) {
        super();
        this.#geolocation = geolocation;
    }

    getCurrentPosition() {
        return new Promise((resolve) => {
            if (!this.#geolocation) {
                console.info("Posizione geografica non disponibile: uso il punto predefinito.");
                resolve(undefined);
                return;
            }
            this.#geolocation.getCurrentPosition(
                (position) => resolve({
                    latitudeDeg: position.coords.latitude,
                    longitudeDeg: position.coords.longitude
                }),
                (error) => {
                    console.info(`Posizione geografica non disponibile (${error.message}): uso il punto predefinito.`);
                    resolve(undefined);
                },
                GEOLOCATION_OPTIONS
            );
        });
    }
}

// ---------------------------------------------------- src/services/cesiumClock.js
// ============================================================
// cesiumClock.js — SimulationClock basato sull'orologio di Cesium.
//
// L'orologio di Cesium è l'unica sorgente del tempo: il tempo simulato
// è la differenza tra currentTime e startTime, e scorre "timeScale"
// volte più veloce del tempo reale.
// ============================================================


class CesiumSimulationClock extends SimulationClock {
    #clock;

    constructor(cesiumClock, timeScale) {
        super();
        const start = Cesium.JulianDate.now();
        cesiumClock.startTime = start.clone();
        cesiumClock.currentTime = start.clone();
        cesiumClock.clockRange = Cesium.ClockRange.UNBOUNDED;
        cesiumClock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
        cesiumClock.multiplier = timeScale;
        cesiumClock.shouldAnimate = false;
        this.#clock = cesiumClock;
    }

    get running() {
        return this.#clock.shouldAnimate;
    }

    set running(value) {
        this.#clock.shouldAnimate = value;
    }

    reset() {
        this.#clock.currentTime = this.#clock.startTime.clone();
    }

    isAtStart() {
        return Cesium.JulianDate.equals(this.#clock.currentTime, this.#clock.startTime);
    }
}

// ---------------------------------------------------- src/view/palette.js
// ============================================================
// palette.js — Colori della scena e della legenda (nomi CSS),
// condivisi da SceneView e PanelView.
// ============================================================

const PALETTE = {
    eci: "red",            // Traccia e velocità assolute (ECI)
    ecef: "lime",          // Traccia e velocità relative (ECEF)
    rotationAxis: "violet",
    particle: "orange",
    startMarker: "white",
    startMarkerOutline: "black",
    frameAxes: ["red", "lime", "blue"] // Est, Nord, Su
};

// ---------------------------------------------------- src/view/panel/panelStyle.js
// ============================================================
// panelStyle.js — Foglio di stile del pannello dei controlli.
// ============================================================

const PANEL_WIDTH = 340; // [px]

const PANEL_CSS = `
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
/* Riga di pulsanti: occupa metà della larghezza utile. */
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
#simPanel .sim-buttons .sim-text-button {
    padding: 0 6px;
    white-space: nowrap;
    overflow: hidden;
    text-align: center;
}
/* Griglie: etichetta + due colonne di controlli. */
#simPanel .sim-grid,
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
/* Riga di radio button (modello di Terra, telecamera). */
#simPanel .sim-radio-row {
    display: flex;
    gap: 16px;
}
#simPanel .sim-radio-row label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
}
#simPanel .sim-radio-row input {
    margin: 0;
}
#simPanel .sim-camera-mode {
    margin-top: 10px;
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

// ---------------------------------------------------- src/view/panel/panelView.js
// ============================================================
// panelView.js — Pannello dei controlli (DOM).
//
// Solo presentazione: costruisce i controlli, inoltra le azioni
// dell'utente ai comandi del ViewModel e rispecchia il suo stato.
// Ogni controllo registra con #bind() la funzione che lo aggiorna;
// a ogni notifica "change" del ViewModel vengono eseguite tutte.
//
// Il pannello occupa una colonna a sinistra a tutta altezza; la vista
// Cesium occupa lo spazio restante.
// ============================================================


// Icone SVG (stessa resa su tutti i sistemi, a differenza dei
// caratteri Unicode che alcuni sistemi mostrano come emoji).
const ICON_PLAY = '<svg viewBox="0 0 16 16"><path d="M3 1.5v13l11-6.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 16 16"><path d="M3 1.5h3.5v13H3zM9.5 1.5H13v13H9.5z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 16 16"><path d="M2.5 2.5h11v11h-11z"/></svg>';

const ERROR_DURATION_MS = 4000;
const STATUS_LABEL_WIDTH = 16; // Colonna dei valori (testo monospaziato)

// Righe della velocità iniziale: [etichetta, componente, limiti del campo].
// Azimuth senza min/max: tenendo premuto su/giù supera 360° o scende
// sotto 0° e viene "avvolto" dal ViewModel.
const VELOCITY_ROWS = [
    ["Modulo [km/h]", "speedKmh", { min: 0, step: 100 }],
    ["Azimuth [°]", "azimuthDeg", { step: 1 }],
    ["Elevazione [°]", "elevationDeg", { min: -90, max: 90, step: 1 }]
];

// Colonne della velocità iniziale: [terna, suffisso dell'etichetta].
const VELOCITY_COLUMNS = [
    ["relative", "relativa (ECEF)"],
    ["absolute", "assoluta (ECI)"]
];

// Righe della sezione Visualizzazione: [etichetta, oggetto].
const VISIBILITY_ROWS = [
    ["Frame", "frame"],
    ["Traiettoria", "track"],
    ["Velocità", "velocity"]
];

const LEGEND = [
    [PALETTE.ecef, "Traccia e velocità relative (ECEF)"],
    [PALETTE.eci, "Traccia e velocità assolute (ECI)"],
    [PALETTE.rotationAxis, "Asse di rotazione terrestre"]
];

// --------------------------------------------------
// STRUMENTI DOM
// --------------------------------------------------

function element(tag, properties, children) {
    const node = Object.assign(document.createElement(tag), properties);
    node.append(...(children || []));
    return node;
}

function setIcon(button, svg, label) {
    button.innerHTML = svg;
    button.title = label;
    button.setAttribute("aria-label", label);
}

// Valori mostrati con al massimo 3 decimali.
function formatNumber(x) {
    return String(Number(x.toFixed(3)));
}

// Mostra "value" nel campo. Senza "force" non riscrive un campo che
// contiene già quel valore in un'altra forma (es. "1.50" mentre
// l'utente sta scrivendo): la digitazione non viene disturbata, ma un
// valore corretto dal ViewModel (es. longitudine avvolta) compare subito.
function showNumber(input, value, force) {
    const text = formatNumber(value);
    if (input.value === text || (!force && parseFloat(input.value) === value)) {
        return;
    }
    input.value = text;
}

// --------------------------------------------------
// PANNELLO
// --------------------------------------------------

class PanelView {
    #vm;
    #panel;
    #refreshers = [];
    #errorBox;
    #errorTimer;
    #status;

    constructor(sceneContainer, viewModel) {
        this.#vm = viewModel;
        this.#mount(sceneContainer);

        this.#panel.append(element("h2", { textContent: "Accelerazione di Coriolis" }));
        this.#buildSimulationSection();
        this.#buildStartSection();
        this.#buildVelocitySection();
        this.#buildModelSection();
        this.#buildVisibilitySection();
        this.#buildStatusSection();
        this.#buildLegendSection();

        viewModel.on("change", () => this.#refresh());
        viewModel.on("frame", (frame) => this.#showStatus(frame.status));
        viewModel.on("error", (message) => this.#showError(message));
        this.#refresh();
        this.#showStatus(viewModel.frame.status);
    }

    #mount(sceneContainer) {
        document.head.appendChild(element("style", { textContent: PANEL_CSS }));
        this.#panel = element("div", { id: "simPanel" });
        Object.assign(sceneContainer.style, {
            position: "absolute",
            top: "0",
            bottom: "0",
            right: "0",
            left: PANEL_WIDTH + "px",
            width: "auto",
            height: "auto"
        });
        sceneContainer.parentNode.insertBefore(this.#panel, sceneContainer);
    }

    #bind(refresher) {
        this.#refreshers.push(refresher);
    }

    #refresh() {
        this.#refreshers.forEach((refresher) => refresher());
    }

    // --- Costruttori di controlli ----------------------------------------

    #section(title, className) {
        const section = element("div", { className: className ? "sim-section " + className : "sim-section" }, [
            element("h3", { textContent: title })
        ]);
        this.#panel.append(section);
        return section;
    }

    #button(onClick, properties) {
        const button = element("button", properties);
        button.addEventListener("click", onClick);
        return button;
    }

    // Campo numerico collegato a una proprietà del ViewModel:
    // - "input": a ogni variazione (anche tenendo premuti su/giù) invia
    //   il valore; valori incompleti (es. "" o "-") sono ignorati;
    // - "change": a modifica conclusa riscrive il campo con il valore
    //   normalizzato (o ripristina quello valido).
    // Disattivato durante la simulazione.
    #numberInput({ min, max, step, ariaLabel, read, write }) {
        const input = element("input", { type: "number", step: String(step) });
        if (min !== undefined) {
            input.min = String(min);
        }
        if (max !== undefined) {
            input.max = String(max);
        }
        if (ariaLabel) {
            input.setAttribute("aria-label", ariaLabel);
        }
        const submit = () => {
            const value = parseFloat(input.value);
            if (isFinite(value)) {
                write(value);
            }
        };
        input.addEventListener("input", submit);
        input.addEventListener("change", () => {
            submit();
            showNumber(input, read(), true);
        });
        this.#bind(() => {
            input.disabled = !this.#vm.editable;
            showNumber(input, read(), false);
        });
        return input;
    }

    // Riga "etichetta ........ campo".
    #field(parent, labelText, control) {
        parent.append(element("label", { className: "sim-field" }, [labelText, control]));
    }

    // Gruppo di radio button collegato a una proprietà del ViewModel.
    // options: [[etichetta, valore], ...].
    #radioGroup(parent, { name, className, options, read, write, lockWhileRunning }) {
        const row = element("div", { className: className });
        options.forEach(([labelText, value]) => {
            const radio = element("input", { type: "radio", name: name });
            radio.addEventListener("change", () => {
                if (radio.checked) {
                    write(value);
                }
            });
            this.#bind(() => {
                radio.checked = read() === value;
                if (lockWhileRunning) {
                    radio.disabled = !this.#vm.editable;
                }
            });
            row.append(element("label", {}, [radio, labelText]));
        });
        parent.append(row);
    }

    // --- Sezioni ---------------------------------------------------------

    #buildSimulationSection() {
        const vm = this.#vm;
        const section = this.#section("Simulazione");

        const play = this.#button(() => vm.togglePlay());
        const stop = this.#button(() => vm.stop());
        setIcon(stop, ICON_STOP, "Stop (reset)");
        this.#bind(() => {
            setIcon(play, vm.running ? ICON_PAUSE : ICON_PLAY, vm.running ? "Pausa" : "Avvia");
            stop.disabled = !vm.editable;
        });

        // Messaggio di errore (non bloccante, scompare dopo alcuni secondi).
        this.#errorBox = element("div", { className: "sim-error" });
        section.append(element("div", { className: "sim-buttons" }, [play, stop]), this.#errorBox);
    }

    #buildStartSection() {
        const vm = this.#vm;
        const section = this.#section("Partenza");

        const pick = this.#button(() => vm.togglePickMode(), { className: "sim-text-button" });
        this.#bind(() => {
            pick.textContent = vm.pickMode ? "Annulla" : "Punto iniziale";
            pick.title = vm.pickMode ? "Clicca un punto sul globo, oppure premi qui per annullare" : "";
            pick.disabled = !vm.editable;
        });
        section.append(element("div", { className: "sim-buttons" }, [pick]));

        this.#field(section, "Latitudine [°]", this.#numberInput({
            min: -90, max: 90, step: 1,
            read: () => vm.latitudeDeg,
            write: (value) => vm.setLatitude(value)
        }));
        // Senza min/max: la longitudine viene "avvolta" (ciclo continuo).
        this.#field(section, "Longitudine [°]", this.#numberInput({
            step: 1,
            read: () => vm.longitudeDeg,
            write: (value) => vm.setLongitude(value)
        }));
        this.#field(section, "Quota di partenza [km]", this.#numberInput({
            min: 0, step: 10,
            read: () => vm.altitudeKm,
            write: (value) => vm.setAltitudeKm(value)
        }));
    }

    #buildVelocitySection() {
        const vm = this.#vm;
        const grid = element("div", { className: "sim-grid" }, [
            element("span"),
            element("span", { className: "sim-colhead", textContent: "Relativa (ECEF)" }),
            element("span", { className: "sim-colhead", textContent: "Assoluta (ECI)" })
        ]);
        VELOCITY_ROWS.forEach(([labelText, component, limits]) => {
            grid.append(element("span", { textContent: labelText }));
            VELOCITY_COLUMNS.forEach(([frame, suffix]) => {
                grid.append(this.#numberInput({
                    ...limits,
                    ariaLabel: labelText + " " + suffix,
                    read: () => vm.velocity(frame)[component],
                    write: (value) => vm.setVelocity(frame, component, value)
                }));
            });
        });
        this.#section("Velocità iniziale").append(grid);
    }

    #buildModelSection() {
        const vm = this.#vm;
        this.#radioGroup(this.#section("Modello"), {
            name: "simEarth",
            className: "sim-radio-row",
            options: [["Sfera", true], ["Ellissoide", false]],
            read: () => vm.sphericalEarth,
            write: (spherical) => vm.setSphericalEarth(spherical),
            lockWhileRunning: true
        });
    }

    // Caselle attive anche durante la simulazione.
    #buildVisibilitySection() {
        const vm = this.#vm;
        const section = this.#section("Visualizzazione");

        const grid = element("div", { className: "sim-visibility" }, [
            element("span"),
            element("span", { className: "sim-colhead", textContent: "Assoluti (ECI)" }),
            element("span", { className: "sim-colhead", textContent: "Relativi (ECEF)" })
        ]);
        VISIBILITY_ROWS.forEach(([labelText, item]) => {
            grid.append(element("span", { textContent: labelText }));
            ["eci", "ecef"].forEach((frame) => {
                const checkbox = element("input", {
                    type: "checkbox",
                    title: labelText + " " + frame.toUpperCase()
                });
                checkbox.addEventListener("change", () => vm.setVisibility(item, frame, checkbox.checked));
                this.#bind(() => {
                    checkbox.checked = vm.visibility[item][frame];
                });
                grid.append(checkbox);
            });
        });
        section.append(grid);

        this.#radioGroup(section, {
            name: "simCameraMode",
            className: "sim-radio-row sim-camera-mode",
            options: [["Camera ECI", "eci"], ["Camera ECEF", "ecef"]],
            read: () => vm.cameraMode,
            write: (mode) => vm.setCameraMode(mode)
        });
        section.append(element("div", {
            className: "sim-note",
            textContent: "Spostamento laterale: Shift + trascinamento con il tasto destro"
        }));
    }

    #buildStatusSection() {
        this.#status = element("div", { className: "sim-status" });
        this.#section("Stato").append(this.#status);
    }

    #buildLegendSection() {
        const section = this.#section("Legenda", "sim-legend");
        LEGEND.forEach(([color, text]) => {
            const swatch = element("span", { className: "sim-swatch" });
            swatch.style.background = color;
            section.append(element("div", {}, [swatch, text]));
        });
    }

    // --- Messaggi e stato ---------------------------------------------------

    #showError(message) {
        clearTimeout(this.#errorTimer);
        this.#errorBox.style.display = message ? "block" : "none";
        if (message) {
            this.#errorBox.textContent = "⚠ " + message;
            this.#errorTimer = setTimeout(() => this.#showError(undefined), ERROR_DURATION_MS);
        }
    }

    #showStatus(status) {
        const position = status.latitudeDeg === undefined
            ? "-"
            : `${status.latitudeDeg.toFixed(2)}°, ${status.longitudeDeg.toFixed(2)}°`;
        this.#status.textContent = [
            ["Posizione", position],
            ["Tempo", status.timeSeconds.toFixed(1) + " s"],
            ["Quota", status.altitudeKm.toFixed(1) + " km"],
            ["Velocità ECEF", status.speedEcefKmh.toFixed(0) + " km/h"],
            ["Velocità ECI", status.speedEciKmh.toFixed(0) + " km/h"]
        ].map(([label, value]) => (label + ":").padEnd(STATUS_LABEL_WIDTH) + value).join("\n");
    }
}

// ---------------------------------------------------- src/view/scene/cameraFraming.js
// ============================================================
// cameraFraming.js — Inquadratura iniziale: particella vista da
// sud-sud-est con la Terra intera nella vista.
//
// Funzioni pure (nessun accesso al Viewer): la vista fornisce solo la
// tangente del semiangolo del campo visivo lungo la larghezza.
//
// La telecamera guarda il centro della particella da una direzione fissa
// nella terna locale Est-Nord-Su del punto di partenza:
//   - azimuth CAMERA_AZIMUTH_DEG, in senso orario dal Nord;
//   - elevazione CAMERA_ELEVATION_DEG sopra l'orizzonte locale.
// Il vettore Up sta nel piano formato dalla direzione di vista e dalla
// normale alla superficie (nessun rollio): la verticale locale appare
// verticale sullo schermo.
//
// La distanza è quella per cui il disco terrestre occupa la frazione
// EARTH_WIDTH_FRACTION della larghezza della vista.
// ============================================================


const CAMERA_AZIMUTH_DEG = 150;    // Dal Nord, in senso orario [°]
const CAMERA_ELEVATION_DEG = 45;   // Sopra l'orizzonte locale [°]
const EARTH_WIDTH_FRACTION = 0.95; // Larghezza della Terra / larghezza della vista

// Frazione della larghezza della vista occupata dal diametro del disco
// terrestre, visto da "position" lungo "direction" con il vettore "up"
// (Infinity se la telecamera è troppo vicina).
//
// I bordi del disco sono dati dai due piani tangenti alla Terra che
// contengono la retta per la telecamera parallela a Up: nel piano
// (Destra, direzione) il centro della Terra sta all'angolo
// a = atan2(x, z) e i piani tangenti a a ± asin(R / distanza).
function earthWidthFraction(position, direction, up, tanHalfFovWidth) {
    const C3 = Cesium.Cartesian3;
    const right = C3.cross(direction, up, new C3());
    const toCenter = C3.negate(position, new C3());
    const x = C3.dot(toCenter, right);
    const z = C3.dot(toCenter, direction);
    const distance = Math.hypot(x, z);
    const radius = Cesium.Ellipsoid.WGS84.maximumRadius;
    if (distance <= radius) {
        return Infinity;
    }
    const a = Math.atan2(x, z);
    const b = Math.asin(radius / distance);
    if (a + b >= Math.PI / 2 || a - b <= -Math.PI / 2) {
        return Infinity;
    }
    return (Math.tan(a + b) - Math.tan(a - b)) / (2 * tanHalfFovWidth);
}

// Punto della semiretta target + d·offset (offset versore) alla distanza
// d a cui la Terra occupa EARTH_WIDTH_FRACTION della larghezza
// (bisezione: allontanandosi la Terra rimpicciolisce).
function positionForEarthWidth(target, offset, direction, up, tanHalfFovWidth) {
    const candidate = new Cesium.Cartesian3();
    function cameraAt(distance, result) {
        Cesium.Cartesian3.multiplyByScalar(offset, distance, result);
        return Cesium.Cartesian3.add(target, result, result);
    }
    function tooLarge(distance) {
        const fraction = earthWidthFraction(cameraAt(distance, candidate), direction, up, tanHalfFovWidth);
        return fraction > EARTH_WIDTH_FRACTION;
    }

    let near = 0;
    let far = 1.0e7;
    while (tooLarge(far)) {
        far *= 2;
    }
    for (let i = 0; i < 50; i++) {
        const mid = 0.5 * (near + far);
        if (tooLarge(mid)) {
            near = mid;
        } else {
            far = mid;
        }
    }
    return cameraAt(far, new Cesium.Cartesian3());
}

// Posa { position, direction, up } che inquadra "target" (centro della
// particella) dal punto di partenza "surfacePoint". Valida a t = 0, quando
// ECI ed ECEF coincidono.
function startPointFraming(surfacePoint, target, tanHalfFovWidth) {
    const C3 = Cesium.Cartesian3;
    const enu = enuRotation(surfacePoint);

    // Versore dalla particella verso la telecamera.
    const offset = Cesium.Matrix3.multiplyByVector(
        enu, directionEnu(CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG), new C3()
    );
    C3.normalize(offset, offset);
    const direction = C3.negate(offset, new C3());

    // Up: componente della normale ortogonale alla direzione di vista.
    const normal = Cesium.Matrix3.getColumn(enu, 2, new C3());
    const up = C3.subtract(
        normal,
        C3.multiplyByScalar(direction, C3.dot(normal, direction), new C3()),
        new C3()
    );
    C3.normalize(up, up);

    return {
        position: positionForEarthWidth(target, offset, direction, up, tanHalfFovWidth),
        direction: direction,
        up: up
    };
}

// ---------------------------------------------------- src/view/scene/cameraRig.js
// ============================================================
// cameraRig.js — Telecamera fissa in ECI o solidale con la Terra
// (ECEF), comandi del mouse e pan.
//
// Modalità (mode):
//   - "eci": ferma nello spazio inerziale; la posa ECI è riapplicata a
//     ogni frame, quindi la Terra ruota sullo schermo. I movimenti fatti
//     dall'utente vengono riconosciuti e acquisiti come nuova posa ECI;
//   - "ecef": solidale con la Terra (la Terra appare immobile). La posa
//     di Cesium è già in coordinate ECEF, quindi basta non toccarla.
// Il cambio di modalità non sposta la telecamera: la vista resta
// identica e da quel momento è mantenuta nel nuovo sistema.
// ============================================================


// Soglie oltre le quali la posa è considerata mossa dall'utente.
const MOVED_POSITION_TOLERANCE = 0.01; // [m]
const MOVED_AXIS_TOLERANCE = 1e-8;

// Comandi predefiniti di Cesium, scritti qui per chiarezza: sono quelli
// descritti dal pannello di aiuto "?" in alto a destra. In 3D:
//   rotate (gira il globo)        trascinamento con il tasto sinistro
//   zoom                          rotellina, trascinamento destro, pinch
//   tilt (inclina verso           trascinamento centrale, Ctrl +
//   l'orizzonte)                  trascinamento sinistro o destro, pinch
//   look (ruota la telecamera     Shift + trascinamento sinistro
//   su se stessa)
// "translate" agisce solo in 2D e Columbus View.
function configureMouseControls(controller) {
    const E = Cesium.CameraEventType;
    const CTRL = Cesium.KeyboardEventModifier.CTRL;
    const SHIFT = Cesium.KeyboardEventModifier.SHIFT;

    controller.enableZoom = true;
    controller.enableRotate = true;
    controller.enableTranslate = true;
    controller.enableTilt = true;
    controller.enableLook = true;

    controller.rotateEventTypes = E.LEFT_DRAG;
    controller.zoomEventTypes = [E.RIGHT_DRAG, E.WHEEL, E.PINCH];
    controller.tiltEventTypes = [
        E.MIDDLE_DRAG,
        E.PINCH,
        { eventType: E.LEFT_DRAG, modifier: CTRL },
        { eventType: E.RIGHT_DRAG, modifier: CTRL }
    ];
    controller.lookEventTypes = { eventType: E.LEFT_DRAG, modifier: SHIFT };
    controller.translateEventTypes = E.LEFT_DRAG;
}

// Imposta direttamente posizione e assi della telecamera (in ECEF).
//
// Non si usa camera.setView: converte direzione e Up in rotta,
// inclinazione e rollio locali, rappresentazione degenere quando la
// telecamera guarda verso il centro della Terra (inclinazione -90°).
// Riapplicata a ogni frame, quella conversione alterava la direzione
// e impediva di spostare la Terra oltre quel punto con il pan.
function setCameraPose(camera, position, direction, up) {
    const C3 = Cesium.Cartesian3;
    if (!Cesium.Matrix4.equals(camera.transform, Cesium.Matrix4.IDENTITY)) {
        camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    }
    C3.clone(position, camera.position);
    C3.normalize(direction, camera.direction);
    // Terna ortonormale: Destra = Direzione × Up, poi Up ricalcolato.
    C3.normalize(C3.cross(camera.direction, up, camera.right), camera.right);
    C3.cross(camera.right, camera.direction, camera.up);
}

class CameraRig {
    // Diventa vero al primo movimento della telecamera fatto dall'utente.
    movedByUser = false;

    #viewer;
    #camera;
    #mode = "eci";
    #earthAngle = 0;
    // Posa da mantenere ferma in ECI.
    #inertialPose = {
        position: new Cesium.Cartesian3(),
        direction: new Cesium.Cartesian3(),
        up: new Cesium.Cartesian3()
    };
    // Ultima posa (ECEF) impostata da qui, per riconoscere i movimenti
    // dell'utente.
    #appliedPose;
    // Profondità del punto afferrato con il pan [m]; undefined = nessun pan.
    #panDepth;

    constructor(viewer) {
        this.#viewer = viewer;
        this.#camera = viewer.camera;
        configureMouseControls(viewer.scene.screenSpaceCameraController);
        this.#installPan();
    }

    setMode(mode) {
        if (mode === "eci" && this.#mode !== "eci") {
            // La posa attuale diventa quella da mantenere ferma in ECI.
            this.#captureInertialPose();
        }
        this.#mode = mode;
    }

    // Inquadratura iniziale: particella in "target" vista dal punto di
    // partenza "surfacePoint". Da chiamare a t = 0 (ECI = ECEF).
    frameStartPoint(surfacePoint, target) {
        const pose = startPointFraming(surfacePoint, target, this.#tanHalfFovWidth());
        Cesium.Cartesian3.clone(pose.position, this.#inertialPose.position);
        Cesium.Cartesian3.clone(pose.direction, this.#inertialPose.direction);
        Cesium.Cartesian3.clone(pose.up, this.#inertialPose.up);
        if (this.#mode === "eci") {
            this.#applyInertialPose();
        }
    }

    // A ogni frame, con l'angolo terrestre del frame.
    update(earthAngle) {
        // Un movimento dell'utente è acquisito con l'angolo del frame
        // precedente, quello con cui era stata impostata la posa.
        if (this.#mode === "eci" && this.#poseChanged()) {
            this.#captureInertialPose();
            this.movedByUser = true;
        }
        this.#earthAngle = earthAngle;
        if (this.#mode === "eci") {
            this.#applyInertialPose();
        }
    }

    // --------------------------------------------------
    // POSA INERZIALE
    // --------------------------------------------------

    // Tangente del semiangolo del campo visivo lungo la larghezza (in
    // Cesium "fov" vale per il lato più lungo della vista).
    #tanHalfFovWidth() {
        const container = this.#viewer.container;
        const width = container.clientWidth || 1;
        const height = container.clientHeight || 1;
        return Math.tan(this.#camera.frustum.fov / 2) * width / Math.max(width, height);
    }

    #rememberAppliedPose() {
        const camera = this.#camera;
        this.#appliedPose = {
            position: Cesium.Cartesian3.clone(camera.positionWC),
            direction: Cesium.Cartesian3.clone(camera.directionWC),
            up: Cesium.Cartesian3.clone(camera.upWC)
        };
    }

    #poseChanged() {
        const camera = this.#camera;
        const applied = this.#appliedPose;
        const distance = Cesium.Cartesian3.distance;
        return !applied ||
            distance(camera.positionWC, applied.position) > MOVED_POSITION_TOLERANCE ||
            distance(camera.directionWC, applied.direction) > MOVED_AXIS_TOLERANCE ||
            distance(camera.upWC, applied.up) > MOVED_AXIS_TOLERANCE;
    }

    #captureInertialPose() {
        const camera = this.#camera;
        const pose = this.#inertialPose;
        const angle = this.#earthAngle;
        ecefToEci(camera.positionWC, angle, pose.position);
        Cesium.Cartesian3.normalize(ecefToEci(camera.directionWC, angle, pose.direction), pose.direction);
        Cesium.Cartesian3.normalize(ecefToEci(camera.upWC, angle, pose.up), pose.up);
        this.#rememberAppliedPose();
    }

    #applyInertialPose() {
        const pose = this.#inertialPose;
        const angle = this.#earthAngle;
        setCameraPose(
            this.#camera,
            eciToEcef(pose.position, angle),
            eciToEcef(pose.direction, angle),
            eciToEcef(pose.up, angle)
        );
        this.#rememberAppliedPose();
    }

    // --------------------------------------------------
    // PAN: SHIFT + TRASCINAMENTO CON IL TASTO DESTRO
    // --------------------------------------------------
    //
    // In 3D Cesium non ha uno spostamento laterale vero: il "Pan view" del
    // pannello di aiuto fa ruotare il globo. Questo gesto trasla invece la
    // telecamera parallelamente allo schermo, senza cambiarne
    // l'orientamento.
    //
    // Il punto della Terra sotto il cursore all'inizio del trascinamento
    // segue il cursore: un pixel vale 2·p·tan(fovy/2) / altezza della
    // vista, dove p è la profondità di quel punto lungo la direzione di
    // vista (del centro della Terra se il cursore è nello spazio).
    //
    // Con la telecamera ECI lo spostamento viene acquisito come movimento
    // dell'utente; con quella ECEF resta solidale con la Terra.

    #installPan() {
        const scene = this.#viewer.scene;
        const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
        const SHIFT = Cesium.KeyboardEventModifier.SHIFT;
        const T = Cesium.ScreenSpaceEventType;
        const endPan = () => {
            this.#panDepth = undefined;
        };

        handler.setInputAction((click) => {
            this.#panDepth = this.#depthAt(click.position);
        }, T.RIGHT_DOWN, SHIFT);

        handler.setInputAction((movement) => {
            if (this.#panDepth === undefined) {
                return;
            }
            const camera = this.#camera;
            const height = scene.canvas.clientHeight || 1;
            const metersPerPixel = 2 * this.#panDepth * Math.tan(camera.frustum.fovy / 2) / height;
            // La scena segue il cursore: la telecamera si sposta al contrario.
            camera.moveLeft((movement.endPosition.x - movement.startPosition.x) * metersPerPixel);
            camera.moveUp((movement.endPosition.y - movement.startPosition.y) * metersPerPixel);
        }, T.MOUSE_MOVE, SHIFT);

        // Fine del pan al rilascio del tasto, con o senza Shift premuto.
        handler.setInputAction(endPan, T.RIGHT_UP);
        handler.setInputAction(endPan, T.RIGHT_UP, SHIFT);
    }

    #depthAt(windowPosition) {
        const camera = this.#camera;
        const picked = camera.pickEllipsoid(windowPosition, Cesium.Ellipsoid.WGS84);
        const target = Cesium.defined(picked) ? picked : Cesium.Cartesian3.ZERO;
        const offset = Cesium.Cartesian3.subtract(target, camera.positionWC, new Cesium.Cartesian3());
        return Math.max(Cesium.Cartesian3.dot(offset, camera.directionWC), 1);
    }
}

// ---------------------------------------------------- src/view/scene/trackLayer.js
// ============================================================
// trackLayer.js — Disegno di una traiettoria della particella.
//
// Riceve i punti della traiettoria (nel sistema della traiettoria) e
// li disegna con una modelMatrix verso ECEF (identità per una
// traiettoria solidale con la Terra, rotazione ECI -> ECEF per una
// ferma nello spazio inerziale).
//
// Prestazioni: in una PolylineCollection sia la variazione del numero
// di vertici sia la variazione della modelMatrix ricostruiscono TUTTI
// i vertici della collezione. Per questo:
// - il troncone attivo (al massimo TRACK_CHUNK_SIZE vertici) sta da
//   solo in una PolylineCollection piccola, ricostruita a ogni frame;
// - quando è pieno viene "congelato" in una Primitive statica, per la
//   quale cambiare la modelMatrix costa solo l'aggiornamento di una
//   matrice, senza ricostruire la geometria.
// ============================================================


const TRACK_CHUNK_SIZE = 500;
const TRACK_WIDTH = 1; // [px]

class TrackLayer {
    #color;
    #modelMatrix = Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY);
    #frozenChunks; // Tronconi completi (Primitive statiche)
    #active;       // Troncone attivo
    #activePolyline;
    #points = [];  // Vertici del troncone attivo
    #revision;     // Revisione della traiettoria disegnata
    #drawnCount = 0;

    constructor(primitives, color) {
        this.#color = color;
        this.#frozenChunks = primitives.add(new Cesium.PrimitiveCollection());
        this.#active = primitives.add(new Cesium.PolylineCollection());
    }

    // Mostra/nasconde la traccia (continua a essere aggiornata anche
    // quando è nascosta).
    set show(show) {
        this.#active.show = show;
        this.#frozenChunks.show = show;
    }

    // Allinea il disegno alla traiettoria { points, revision }: aggiunge
    // i punti nuovi e ricomincia se la traiettoria è stata azzerata.
    sync({ points, revision }) {
        if (revision !== this.#revision) {
            this.#clear();
            this.#revision = revision;
        }
        for (let i = this.#drawnCount; i < points.length; i++) {
            this.#addPoint(points[i]);
        }
        this.#drawnCount = points.length;
    }

    // Matrice dai vertici della traiettoria al sistema ECEF di Cesium.
    setModelMatrix(matrix) {
        Cesium.Matrix4.clone(matrix, this.#modelMatrix);
        Cesium.Matrix4.clone(matrix, this.#active.modelMatrix);
        for (let i = 0; i < this.#frozenChunks.length; i++) {
            Cesium.Matrix4.clone(matrix, this.#frozenChunks.get(i).modelMatrix);
        }
    }

    #clear() {
        this.#active.removeAll();
        this.#frozenChunks.removeAll();
        this.#activePolyline = undefined;
        this.#points = [];
        this.#drawnCount = 0;
    }

    #addPoint(position) {
        if (this.#points.length >= TRACK_CHUNK_SIZE) {
            const last = this.#points[this.#points.length - 1];
            // Congela il troncone completo e ne apre uno nuovo che parte
            // dall'ultimo vertice (traccia continua).
            this.#freeze(this.#points);
            this.#active.removeAll();
            this.#activePolyline = undefined;
            this.#points = [last];
        }

        this.#points.push(Cesium.Cartesian3.clone(position));
        if (this.#points.length < 2) {
            return;
        }

        if (this.#activePolyline) {
            this.#activePolyline.positions = this.#points.slice();
            return;
        }
        this.#activePolyline = this.#active.add({
            positions: this.#points.slice(),
            width: TRACK_WIDTH,
            // Ogni polilinea ha il PROPRIO materiale: Polyline._destroy()
            // distrugge il materiale associato (causa del bug del Reset).
            material: Cesium.Material.fromType("Color", { color: this.#color })
        });
    }

    #freeze(points) {
        this.#frozenChunks.add(new Cesium.Primitive({
            geometryInstances: new Cesium.GeometryInstance({
                geometry: new Cesium.PolylineGeometry({
                    positions: points,
                    width: TRACK_WIDTH,
                    // NONE: segmenti rettilinei tra i vertici, senza
                    // suddivisione lungo la superficie terrestre.
                    arcType: Cesium.ArcType.NONE,
                    vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT
                }),
                attributes: {
                    color: Cesium.ColorGeometryInstanceAttribute.fromColor(this.#color)
                }
            }),
            appearance: new Cesium.PolylineColorAppearance(),
            modelMatrix: Cesium.Matrix4.clone(this.#modelMatrix),
            asynchronous: false
        }));
    }
}

// ---------------------------------------------------- src/view/scene/sceneView.js
// ============================================================
// sceneView.js — Scena 3D di Cesium.
//
// Solo presentazione: disegna ciò che il ViewModel fornisce (stato di
// ogni istante già in coordinate ECEF) e inoltra al ViewModel il punto
// scelto sul globo.
//
// Orologio di Cesium come unica sorgente del tempo: le entità sono
// aggiornate da Cesium con il "time" del frame (CallbackProperty) e
// telecamera, tracce e terne in preRender con lo stesso "time".
// ViewModel.frameAt() è idempotente, quindi nello stesso frame tutti
// usano lo stesso stato.
// ============================================================


// Frecce della velocità istantanea: partono dalla superficie della
// particella; la lunghezza è lo spazio percorso in VELOCITY_ARROW_SECONDS
// a velocità costante (es. 1 km/s -> 600 km).
const VELOCITY_ARROW_SECONDS = 600; // [s]
const VELOCITY_ARROW_WIDTH = 12;    // [px] (serve per la punta)
const VELOCITY_ARROW_MIN_SPEED = 1; // [m/s] sotto: freccia nascosta

// Asse di rotazione: solo i due tratti esterni, dalla superficie di
// ciascun polo verso lo spazio (nulla traspare attraverso il globo).
const AXIS_HALF_LENGTH = 9000000; // [m] dal centro della Terra
const AXIS_WIDTH = 1.5;           // [px]

// Terne di riferimento: assi lunghi sempre FRAME_AXIS_PIXELS a schermo.
const FRAME_AXIS_PIXELS = 70; // [px]
const FRAME_LINE_WIDTH = 3;   // [px]

const REFERENCE_SYSTEMS = ["eci", "ecef"];

function color(cssName) {
    return Cesium.Color.fromCssColorString(cssName);
}

class SceneView {
    #viewer;
    #vm;
    #camera;
    #arrows;
    #tracks;
    #framePolylines;
    #startMarker;
    #markerPoint;
    #scratchPixelSphere = new Cesium.BoundingSphere();
    #scratchRotation3 = new Cesium.Matrix3();
    #scratchRotation4 = new Cesium.Matrix4();

    constructor(viewer, viewModel) {
        this.#viewer = viewer;
        this.#vm = viewModel;
        this.#camera = new CameraRig(viewer);

        this.#addParticle();
        this.#arrows = {
            eci: this.#addVelocityArrow("Velocità assoluta (ECI)", PALETTE.eci, "eci"),
            ecef: this.#addVelocityArrow("Velocità relativa (ECEF)", PALETTE.ecef, "ecef")
        };
        this.#tracks = {
            eci: new TrackLayer(viewer.scene.primitives, color(PALETTE.eci)),   // ferma in ECI
            ecef: new TrackLayer(viewer.scene.primitives, color(PALETTE.ecef))  // solidale con la Terra
        };
        this.#addRotationAxis();
        this.#startMarker = this.#addStartMarker();
        this.#framePolylines = this.#addReferenceFrames();
        this.#installPicking();

        viewModel.on("change", () => this.#render());
        viewModel.on("startPointLocated", () => {
            if (!this.#camera.movedByUser) {
                this.#frameStartPoint();
            }
        });
        viewer.scene.preRender.addEventListener((scene, time) => this.#update(time));

        this.#frameStartPoint();
        this.#render();
    }

    // Oggetti della scena per i test end-to-end.
    get testObjects() {
        return {
            arrows: { absolute: this.#arrows.eci, relative: this.#arrows.ecef },
            frames: this.#framePolylines
        };
    }

    // --------------------------------------------------
    // AGGIORNAMENTO
    // --------------------------------------------------

    #frameAt(time) {
        const clock = this.#viewer.clock;
        return this.#vm.frameAt(Cesium.JulianDate.secondsDifference(time, clock.startTime));
    }

    #frameStartPoint() {
        this.#camera.frameStartPoint(this.#vm.startSurfacePoint, this.#vm.startParticlePosition);
    }

    // Stato del ViewModel che non dipende dal tempo.
    #render() {
        const vm = this.#vm;
        REFERENCE_SYSTEMS.forEach((system) => {
            this.#arrows[system].show = vm.visibility.velocity[system];
            this.#tracks[system].show = vm.visibility.track[system];
            this.#framePolylines[system].forEach((polyline) => {
                polyline.show = vm.visibility.frame[system];
            });
        });

        if (!Cesium.Cartesian3.equals(this.#markerPoint, vm.startSurfacePoint)) {
            this.#markerPoint = Cesium.Cartesian3.clone(vm.startSurfacePoint);
            this.#startMarker.position = this.#markerPoint;
        }

        this.#viewer.canvas.style.cursor = vm.pickMode ? "crosshair" : "";
        this.#camera.setMode(vm.cameraMode);
    }

    // A ogni frame, prima del rendering.
    #update(time) {
        const frame = this.#frameAt(time);
        this.#camera.update(frame.earthAngle);
        this.#updateTracks(frame);
        // Dopo la telecamera: la dimensione a schermo usa la sua posa.
        this.#updateReferenceFrames(frame);
    }

    // --------------------------------------------------
    // PARTICELLA E FRECCE DELLA VELOCITÀ
    // --------------------------------------------------

    #addParticle() {
        const r = this.#vm.particleRadius;
        this.#viewer.entities.add({
            name: "Particella",
            position: new Cesium.CallbackProperty((time, result) => {
                return Cesium.Cartesian3.clone(this.#frameAt(time).particlePositionEcef, result);
            }, false),
            ellipsoid: {
                radii: new Cesium.Cartesian3(r, r, r),
                material: color(PALETTE.particle).withAlpha(0.85)
            }
        });
    }

    // system: "eci" (velocità assoluta) o "ecef" (velocità relativa).
    #addVelocityArrow(name, cssColor, system) {
        const velocityAt = (time) => this.#frameAt(time).velocities[system];
        const positions = (time) => {
            const { origin: center, vector: velocity } = velocityAt(time);
            const speed = Cesium.Cartesian3.magnitude(velocity);
            if (speed < VELOCITY_ARROW_MIN_SPEED) {
                return [Cesium.Cartesian3.clone(center), Cesium.Cartesian3.clone(center)];
            }
            const direction = Cesium.Cartesian3.normalize(velocity, new Cesium.Cartesian3());
            const along = (origin, length) => Cesium.Cartesian3.add(
                origin,
                Cesium.Cartesian3.multiplyByScalar(direction, length, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
            const tail = along(center, this.#vm.particleRadius);
            return [tail, along(tail, speed * VELOCITY_ARROW_SECONDS)];
        };

        return this.#viewer.entities.add({
            name: name,
            polyline: {
                positions: new Cesium.CallbackProperty(positions, false),
                show: new Cesium.CallbackProperty((time) => {
                    return Cesium.Cartesian3.magnitude(velocityAt(time).vector) >= VELOCITY_ARROW_MIN_SPEED;
                }, false),
                width: VELOCITY_ARROW_WIDTH,
                // NONE: segmento rettilineo nello spazio.
                arcType: Cesium.ArcType.NONE,
                material: new Cesium.PolylineArrowMaterialProperty(color(cssColor))
            }
        });
    }

    // --------------------------------------------------
    // TRAIETTORIE
    // --------------------------------------------------
    //
    // - ECEF (verde): vertici in ECEF, ruotano con la Terra.
    // - ECI (rossa): vertici in ECI, disegnati con la rotazione
    //   ECI -> ECEF del frame: la traccia resta ferma nello spazio.

    #updateTracks(frame) {
        Cesium.Matrix3.fromRotationZ(-frame.earthAngle, this.#scratchRotation3);
        Cesium.Matrix4.fromRotation(this.#scratchRotation3, this.#scratchRotation4);
        this.#tracks.eci.setModelMatrix(this.#scratchRotation4);

        REFERENCE_SYSTEMS.forEach((system) => {
            this.#tracks[system].sync(this.#vm.trajectory(system));
        });
    }

    // --------------------------------------------------
    // ASSE DI ROTAZIONE E MARCATORE DEL PUNTO DI PARTENZA
    // --------------------------------------------------

    #addRotationAxis() {
        const polarRadius = Cesium.Ellipsoid.WGS84.radii.z;
        const direction = this.#vm.rotationAxis;
        const along = (distance) => Cesium.Cartesian3.multiplyByScalar(direction, distance, new Cesium.Cartesian3());
        [["Nord", +1], ["Sud", -1]].forEach(([pole, sign]) => {
            this.#viewer.entities.add({
                name: `Asse di rotazione (${pole})`,
                polyline: {
                    positions: [along(sign * polarRadius), along(sign * AXIS_HALF_LENGTH)],
                    arcType: Cesium.ArcType.NONE,
                    width: AXIS_WIDTH,
                    material: color(PALETTE.rotationAxis)
                }
            });
        });
    }

    // Posizione impostata da #render().
    #addStartMarker() {
        return this.#viewer.entities.add({
            name: "Punto di partenza",
            point: {
                pixelSize: 7,
                color: color(PALETTE.startMarker),
                outlineColor: color(PALETTE.startMarkerOutline),
                outlineWidth: 1,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
            }
        });
    }

    // --------------------------------------------------
    // TERNE DI RIFERIMENTO NEL PUNTO DI PARTENZA
    // --------------------------------------------------
    //
    // X (rosso) Est, Y (verde) Nord, Z (blu) Su: una terna solidale con
    // la Terra (ECEF) e una ferma nello spazio inerziale (ECI).

    #addReferenceFrames() {
        const collection = this.#viewer.scene.primitives.add(new Cesium.PolylineCollection());
        const createAxes = () => PALETTE.frameAxes.map((cssColor) => collection.add({
            positions: [new Cesium.Cartesian3(0, 0, 0), new Cesium.Cartesian3(1, 0, 0)],
            width: FRAME_LINE_WIDTH,
            material: Cesium.Material.fromType("Color", { color: color(cssColor) })
        }));
        return { ecef: createAxes(), eci: createAxes() };
    }

    #updateReferenceFrames(frame) {
        REFERENCE_SYSTEMS.forEach((system) => {
            const { origin, axes } = frame.referenceFrames[system];
            const length = FRAME_AXIS_PIXELS * this.#metersPerPixelAt(origin);
            this.#framePolylines[system].forEach((polyline, i) => {
                const tip = Cesium.Cartesian3.multiplyByScalar(axes[i], length, new Cesium.Cartesian3());
                polyline.positions = [
                    Cesium.Cartesian3.clone(origin),
                    Cesium.Cartesian3.add(origin, tip, tip)
                ];
            });
        });
    }

    // Metri corrispondenti a un pixel alla distanza di "origin".
    #metersPerPixelAt(origin) {
        const scene = this.#viewer.scene;
        const sphere = this.#scratchPixelSphere;
        sphere.center = origin;
        sphere.radius = 0;
        return scene.camera.getPixelSize(sphere, scene.drawingBufferWidth, scene.drawingBufferHeight);
    }

    // --------------------------------------------------
    // SELEZIONE DEL PUNTO SULLA SUPERFICIE
    // --------------------------------------------------
    //
    // In modalità selezione il clic sinistro sul globo sceglie il punto;
    // un clic nello spazio è ignorato. Il trascinamento continua a
    // ruotare la vista.

    #installPicking() {
        const viewer = this.#viewer;
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
        handler.setInputAction((click) => {
            if (!this.#vm.pickMode) {
                return;
            }
            const ray = viewer.camera.getPickRay(click.position);
            const picked = Cesium.defined(ray) ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
            if (!Cesium.defined(picked)) {
                return;
            }
            // Punto in ECEF all'istante corrente, usato come punto
            // geografico: la simulazione riparte da t = 0 (ECI = ECEF).
            const cartographic = Cesium.Cartographic.fromCartesian(picked);
            const accepted = this.#vm.pickStartPoint(
                Cesium.Math.toDegrees(cartographic.latitude),
                Cesium.Math.toDegrees(cartographic.longitude)
            );
            if (accepted) {
                viewer.selectedEntity = undefined;
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }
}

// ---------------------------------------------------- src/viewmodel/observable.js
// ============================================================
// observable.js — Notifica di eventi con nome, base del ViewModel.
// ============================================================

class Observable {
    #listeners = new Map();

    on(event, listener) {
        if (!this.#listeners.has(event)) {
            this.#listeners.set(event, []);
        }
        this.#listeners.get(event).push(listener);
    }

    emit(event, ...args) {
        (this.#listeners.get(event) || []).forEach((listener) => listener(...args));
    }
}

// ---------------------------------------------------- src/viewmodel/simulationViewModel.js
// ============================================================
// simulationViewModel.js — Stato e comandi dell'interfaccia.
//
// Collega le viste al modello (Simulation). Non conosce componenti
// dell'interfaccia: riceve il tempo e la posizione geografica tramite
// le interfacce SimulationClock e GeolocationService.
//
// Ogni elemento della scena corrisponde a un elemento del modello:
//   particella, punto di partenza                       -> Particle
//   frecce della velocità                               -> Arrow
//   traiettorie                                         -> Trajectory
//   terne nel punto di partenza                         -> EnuFrame
//   asse di rotazione                                   -> rotationAxis
//                                                          del modello di Terra
//
// Eventi emessi (vedi Observable):
//   "change"            lo stato mostrato dalle viste è cambiato
//   "frame" (frame)     calcolato lo stato di un nuovo istante
//   "error" (message)   messaggio per l'utente (undefined = nascondi)
//   "startPointLocated" punto di partenza preso dalla posizione del PC
// ============================================================


const PICK_REQUIRES_RESET_MESSAGE =
    "Per selezionare un nuovo punto premi prima il pulsante Reset.";

class SimulationViewModel extends Observable {
    // Sistema in cui la telecamera resta ferma: "eci" oppure "ecef".
    cameraMode = "eci";

    // Vero mentre si attende il clic sul globo che sceglie il punto.
    pickMode = false;

    // Oggetti visibili, per tipo e sistema di riferimento.
    visibility = {
        frame: { eci: true, ecef: true },
        track: { eci: true, ecef: true },
        velocity: { eci: true, ecef: true }
    };

    #simulation;
    #particle;
    #clock;
    #geolocation;
    #frame;

    constructor(simulation, clock, geolocation) {
        super();
        this.#simulation = simulation;
        this.#particle = simulation.particle;
        this.#clock = requireImplementation(clock, SimulationClock);
        this.#geolocation = requireImplementation(geolocation, GeolocationService);
        this.#restarted();
    }

    // --------------------------------------------------
    // PROPRIETÀ
    // --------------------------------------------------

    get running() {
        return this.#clock.running;
    }

    // Le condizioni iniziali si modificano solo a simulazione ferma.
    get editable() {
        return !this.running;
    }

    get sphericalEarth() {
        return this.#simulation.useSphericalEarth;
    }

    get particleRadius() {
        return this.#particle.radius;
    }

    get latitudeDeg() {
        return this.#particle.start.latitudeDeg;
    }

    get longitudeDeg() {
        return this.#particle.start.longitudeDeg;
    }

    get altitudeKm() {
        return this.#particle.start.altitude / 1000;
    }

    // Punto di partenza sulla superficie (ECEF).
    get startSurfacePoint() {
        return this.#particle.start.surfacePointECEF;
    }

    // Centro della particella a t = 0 (ECI = ECEF).
    get startParticlePosition() {
        return this.#particle.initial.position;
    }

    // Terna di velocità iniziale: "relative" (ECEF) o "absolute" (ECI).
    velocity(frame) {
        return this.#particle.velocity[frame];
    }

    // Direzione dell'asse di rotazione terrestre (verso il Polo Nord).
    get rotationAxis() {
        return this.#simulation.earth.rotationAxis.direction;
    }

    // Traiettoria della particella nel sistema "eci" o "ecef":
    // { points, revision } (vedi Trajectory). I punti sono in sola
    // lettura.
    trajectory(system) {
        const { points, revision } = this.#particle.trajectories[system];
        return { points, revision };
    }

    // Ultimo istante calcolato (vedi frameAt).
    get frame() {
        return this.#frame;
    }

    // --------------------------------------------------
    // COMANDI
    // --------------------------------------------------

    togglePlay() {
        this.#clock.running = !this.#clock.running;
        if (this.running) {
            this.pickMode = false;
        }
        this.emit("change");
    }

    // Stop = Reset: riporta la simulazione a t = 0 con le condizioni
    // iniziali correnti.
    stop() {
        this.#editSetup(() => this.#hideError());
    }

    // Il punto si può scegliere solo a t = 0; uscire dalla modalità
    // di selezione è sempre permesso.
    togglePickMode() {
        if (this.running) {
            return;
        }
        if (!this.pickMode && !this.#clock.isAtStart()) {
            this.emit("error", PICK_REQUIRES_RESET_MESSAGE);
            return;
        }
        this.#hideError();
        this.pickMode = !this.pickMode;
        this.emit("change");
    }

    // Punto scelto sul globo. Restituisce true se è stato accettato.
    pickStartPoint(latitudeDeg, longitudeDeg) {
        if (!this.pickMode || this.running || !this.#clock.isAtStart()) {
            return false;
        }
        this.pickMode = false;
        this.#editSetup(() => this.#particle.setStartPoint(latitudeDeg, longitudeDeg));
        return true;
    }

    setLatitude(deg) {
        this.#editSetup(() => this.#particle.setStartPoint(deg, this.longitudeDeg));
    }

    setLongitude(deg) {
        this.#editSetup(() => this.#particle.setStartPoint(this.latitudeDeg, deg));
    }

    setAltitudeKm(km) {
        this.#editSetup(() => this.#particle.setStartAltitude(km * 1000));
    }

    // component: "speedKmh", "azimuthDeg" o "elevationDeg".
    setVelocity(frame, component, value) {
        this.#editSetup(() => this.#particle.setVelocity(frame, { [component]: value }));
    }

    setSphericalEarth(spherical) {
        this.#editSetup(() => {
            this.#simulation.useSphericalEarth = spherical;
        });
    }

    // Attivo anche durante la simulazione.
    setCameraMode(mode) {
        this.cameraMode = mode;
        this.emit("change");
    }

    // item: "frame", "track" o "velocity"; frame: "eci" o "ecef".
    // Attivo anche durante la simulazione: agisce solo sulla vista.
    setVisibility(item, frame, show) {
        this.visibility[item][frame] = show;
        this.emit("change");
    }

    // Usa la posizione del PC come punto di partenza, se nel frattempo
    // l'utente non ha già scelto un punto o avviato la simulazione.
    async locateStartPoint() {
        const fallbackLatitude = this.latitudeDeg;
        const fallbackLongitude = this.longitudeDeg;
        const position = await this.#geolocation.getCurrentPosition();

        const untouched =
            !this.running &&
            this.#clock.isAtStart() &&
            this.latitudeDeg === fallbackLatitude &&
            this.longitudeDeg === fallbackLongitude;
        if (!position || !untouched) {
            return;
        }
        this.#editSetup(() => this.#particle.setStartPoint(position.latitudeDeg, position.longitudeDeg));
        this.emit("startPointLocated");
    }

    // --------------------------------------------------
    // STATO A UN ISTANTE
    // --------------------------------------------------

    // Stato della scena all'istante "seconds" [s simulati], in
    // coordinate ECEF pronte per essere disegnate. È idempotente: le
    // chiamate successive con lo stesso istante restituiscono lo stesso
    // oggetto.
    frameAt(seconds) {
        if (this.#frame && this.#frame.seconds === seconds) {
            return this.#frame;
        }
        this.#simulation.advanceTo(seconds);

        const angle = earthRotationAngle(seconds);
        const particle = this.#particle;
        const state = particle.state;
        const particlePositionEcef = eciToEcef(state.position, angle);
        const inEcef = (elements) => ({
            eci: elements.eci.inEcef(seconds),
            ecef: elements.ecef.inEcef(seconds)
        });
        const velocities = inEcef(particle.velocityArrows);
        const speedKmh = (system) => Cesium.Cartesian3.magnitude(velocities[system].vector) * KMH_PER_MS;

        this.#frame = {
            seconds: seconds,
            earthAngle: angle,
            particlePositionEcef: particlePositionEcef,
            // Velocità assoluta (eci) e relativa (ecef): { origin, vector }.
            velocities: velocities,
            // Terne nel punto di partenza: { origin, axes: [E, N, U] }.
            referenceFrames: inEcef(particle.startFrames),
            status: {
                ...geographicPosition(particlePositionEcef),
                timeSeconds: seconds,
                altitudeKm: state.altitude / 1000,
                speedEcefKmh: speedKmh("ecef"),
                speedEciKmh: speedKmh("eci")
            }
        };
        this.emit("frame", this.#frame);
        return this.#frame;
    }

    // --------------------------------------------------
    // INTERNI
    // --------------------------------------------------

    // Modifica delle condizioni iniziali: ignorata durante la simulazione
    // (la notifica riallinea comunque le viste), altrimenti la
    // simulazione riparte da t = 0 con le nuove condizioni.
    #editSetup(change) {
        if (this.running) {
            this.emit("change");
            return;
        }
        change();
        this.#restarted();
    }

    #restarted() {
        this.#simulation.reset();
        this.#clock.reset();
        this.#frame = undefined;
        this.frameAt(0);
        this.emit("change");
    }

    #hideError() {
        this.emit("error", undefined);
    }
}

// Latitudine geodetica e longitudine in [0°, 360°) di un punto ECEF.
function geographicPosition(pointEcef) {
    const cartographic = Cesium.Cartographic.fromCartesian(pointEcef, WGS84);
    if (!Cesium.defined(cartographic)) {
        return { latitudeDeg: undefined, longitudeDeg: undefined };
    }
    return {
        latitudeDeg: Cesium.Math.toDegrees(cartographic.latitude),
        longitudeDeg: normalizeDegrees(Cesium.Math.toDegrees(cartographic.longitude))
    };
}

// ---------------------------------------------------- src/main.js
// ============================================================
// main.js — Avvio dell'applicazione (composition root).
//
// Crea il modello, le implementazioni delle interfacce dei servizi,
// il ViewModel e le viste, e li collega. È l'unico punto che conosce
// tutte le classi concrete.
//
//   Modello      Simulation, Particle       (src/model)
//   Servizi      CesiumSimulationClock,     (src/services)
//                BrowserGeolocationService
//   ViewModel    SimulationViewModel        (src/viewmodel)
//   Viste        PanelView, SceneView       (src/view)
// ============================================================


const TIME_SCALE = 600; // 1 secondo reale = 600 secondi simulati

const viewer = new Cesium.Viewer("cesiumContainer", {
    animation: false,
    timeline: false
});

const simulation = new Simulation();
const viewModel = new SimulationViewModel(
    simulation,
    new CesiumSimulationClock(viewer.clock, TIME_SCALE),
    new BrowserGeolocationService(navigator.geolocation)
);

// Prima il pannello: dà alla vista 3D la sua dimensione definitiva,
// usata dalla scena per l'inquadratura iniziale.
new PanelView(viewer.container, viewModel);
const sceneView = new SceneView(viewer, viewModel);

viewModel.locateStartPoint();

// Oggetto in sola lettura usato dai test end-to-end (Playwright) per
// verificare lo stato della scena. Non ha effetti sulla simulazione.
window.__coriolis = {
    viewer: viewer,
    simulation: simulation,
    particle: simulation.particle,
    get cameraMode() {
        return viewModel.cameraMode;
    },
    ...sceneView.testObjects
};
