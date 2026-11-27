// ============================================================
// FILE GENERATO da scripts/build.mjs — non modificarlo qui.
// Modifica i file di src/, poi esegui
// "npm run sandcastle" e incolla questo file in Sandcastle.
// ============================================================

// ---------------------------------------------------- src/geometry/referenceFrames.js
// ============================================================
// referenceFrames.js — Sistemi di riferimento e terna locale
// Est-Nord-Su (ENU).
//
// Solo funzioni pure, senza stato: le usano il modello, il
// ViewModel e la vista. Le trasformazioni tra i sistemi ECI ed ECEF e
// la rotazione terrestre sono nel modello (SceneNode, Earth,
// RotationAxis).
// ============================================================


const KMH_PER_MS = 3.6; // Conversione m/s -> km/h

// Asse Z comune ai sistemi ECI ed ECEF (verso il Polo Nord): l'asse
// attorno al quale ruota la Terra. Definisce l'Est della terna locale.
const EARTH_ROTATION_AXIS = Cesium.Cartesian3.UNIT_Z;

// Sistemi di riferimento, nell'ordine in cui compaiono nell'interfaccia.
const REFERENCE_SYSTEMS = ["eci", "ecef"];

// Oggetto { eci, ecef } con il valore create(system) per ogni sistema.
function bySystem(create) {
    return Object.fromEntries(REFERENCE_SYSTEMS.map((system) => [system, create(system)]));
}

// Velocità di trascinamento ω × r di un punto in "position", solidale
// con un sistema che ruota con velocità angolare "omega" (vettore).
function dragVelocity(omega, position, result = new Cesium.Cartesian3()) {
    return Cesium.Cartesian3.cross(omega, position, result);
}

const scratchDrag = new Cesium.Cartesian3();

// Velocità relativa al sistema rotante: v - ω × r. "result" può
// coincidere con "velocity".
function relativeVelocity(omega, position, velocity, result = new Cesium.Cartesian3()) {
    const drag = dragVelocity(omega, position, scratchDrag);
    return Cesium.Cartesian3.subtract(velocity, drag, result);
}

const scratchAlongNormal = new Cesium.Cartesian3();

// Componente di "vector" perpendicolare al versore "normal", cioè la
// sua proiezione sul piano tangente: vector - (vector · normal) normal.
// "result" può coincidere con "vector".
function tangentialComponent(vector, normal, result = new Cesium.Cartesian3()) {
    const along = Cesium.Cartesian3.dot(vector, normal);
    return Cesium.Cartesian3.subtract(
        vector, Cesium.Cartesian3.multiplyByScalar(normal, along, scratchAlongNormal), result
    );
}

// Accelerazione di Coriolis -2 ω × v_rel di un punto con velocità
// "relativeVelocity" rispetto al sistema rotante. "result" può
// coincidere con "relativeVelocity".
function coriolisAcceleration(omega, relativeVelocity, result = new Cesium.Cartesian3()) {
    Cesium.Cartesian3.cross(omega, relativeVelocity, result);
    return Cesium.Cartesian3.multiplyByScalar(result, -2, result);
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

const scratchEast = new Cesium.Cartesian3();
const scratchNorth = new Cesium.Cartesian3();

// Rotazione dalla terna Est-Nord-Su alle coordinate cartesiane, data la
// verticale "up" (versore, di norma la normale locale del modello di
// Terra): le colonne sono Est, Nord, Su.
//   Est  = Z × Su (orizzontale, verso cui ruota la Terra);
//   Nord = Su × Est.
// Ai poli (Su parallelo a Z) Est non è definito: si usa la stessa
// convenzione di Cesium, Est = +Y.
function enuRotation(up, result) {
    const C3 = Cesium.Cartesian3;
    const east = C3.cross(EARTH_ROTATION_AXIS, up, scratchEast);
    if (C3.magnitudeSquared(east) === 0) {
        C3.clone(C3.UNIT_Y, east);
    }
    C3.normalize(east, east);
    const north = C3.cross(up, east, scratchNorth);

    result = result || new Cesium.Matrix3();
    Cesium.Matrix3.setColumn(result, 0, east, result);
    Cesium.Matrix3.setColumn(result, 1, north, result);
    return Cesium.Matrix3.setColumn(result, 2, up, result);
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

// ---------------------------------------------------- src/model/cameraFraming.js
// ============================================================
// cameraFraming.js — Inquadratura iniziale: particella vista da
// sud-sud-est con la Terra intera nella vista.
//
// Funzioni pure, usate da Camera: della vista serve solo la tangente
// del semiangolo del campo visivo lungo la larghezza.
//
// La telecamera guarda il centro della sfera della particella da una
// direzione fissa nella terna locale Est-Nord-Su della posizione di partenza
// (EnuFrame della particella):
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
    // Posizione della telecamera a "distance" da target.
    function cameraAt(distance, result) {
        Cesium.Cartesian3.multiplyByScalar(offset, distance, result);
        return Cesium.Cartesian3.add(target, result, result);
    }
    // Vero se a "distance" la Terra occupa più della frazione voluta.
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

// Posa { position, direction, up } che inquadra l'origine della terna
// locale "frame" (EnuFrame con origine nel centro della sfera della
// particella e asse Su lungo la normale locale), nel sistema del padre
// della terna (World o Terra, con origine nel centro della Terra).
function startPositionFraming(frame, tanHalfFovWidth) {
    const C3 = Cesium.Cartesian3;
    const target = frame.position;
    const normal = frame.axes[2];

    // Versore dalla particella verso la telecamera.
    const offset = frame.toCartesian(directionEnu(CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG));
    C3.normalize(offset, offset);
    const direction = C3.negate(offset, new C3());

    // Up: componente della normale ortogonale alla direzione di vista.
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

// ---------------------------------------------------- src/model/sceneNode.js
// ============================================================
// sceneNode.js — Nodo della gerarchia della scena.
//
// Ogni elemento del modello che corrisponde a un oggetto della scena
// discende da SceneNode. I nodi formano un albero con relazioni
// padre-figlio, costruito con addChild(); la radice è il nodo "World"
// (parent nullo), il cui sistema di coordinate è ECI.
//
// POSA
// Ogni nodo ha un proprio sistema di coordinate, la cui posa è espressa
// in quello del padre:
//   position     origine del sistema del nodo;
//   orientation  assi X, Y, Z del sistema del nodo (colonne, versori).
// Per difetto la posa è costante (identità: il sistema del nodo
// coincide con quello del padre). Le sottoclassi la rendono variabile
// nel tempo ridefinendo localPosition() o localOrientation(): la Terra
// ruota attorno all'asse di rotazione, una freccia segue la particella.
//
// Tutto il codice relativo alla posa sta qui: le sottoclassi usano
// positionIn()/axesIn() per esprimerla nel sistema di un altro nodo e
// setPose()/setPoseFrom() per impostarla.
// ============================================================


const UNIT_AXES = [Cesium.Cartesian3.UNIT_X, Cesium.Cartesian3.UNIT_Y, Cesium.Cartesian3.UNIT_Z];

class SceneNode {
    parent = null; // Nodo padre (null finché non è aggiunto, e per la radice)
    children = [];

    // Posa nel sistema del padre (vedi intestazione).
    position = new Cesium.Cartesian3();
    orientation = Cesium.Matrix3.clone(Cesium.Matrix3.IDENTITY);

    // --------------------------------------------------
    // GERARCHIA
    // --------------------------------------------------

    // Aggiunge "child" ai figli, togliendolo dal padre precedente.
    // Restituisce "child".
    addChild(child) {
        if (child.parent) {
            child.parent.removeChild(child);
        }
        child.parent = this;
        this.children.push(child);
        return child;
    }

    // Toglie "child" dai figli.
    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) {
            this.children.splice(index, 1);
            child.parent = null;
        }
    }

    // --------------------------------------------------
    // POSA NEL SISTEMA DEL PADRE
    // --------------------------------------------------

    // Assi X, Y, Z del nodo nel sistema del padre (copie).
    get axes() {
        return [0, 1, 2].map((i) => Cesium.Matrix3.getColumn(this.orientation, i, new Cesium.Cartesian3()));
    }

    // Imposta la posa: origine "position" e assi "axes" ([X, Y, Z],
    // versori ortogonali), nel sistema del padre.
    setPose(position, axes) {
        Cesium.Cartesian3.clone(position, this.position);
        axes.forEach((axis, i) => Cesium.Matrix3.setColumn(this.orientation, i, axis, this.orientation));
    }

    // Imposta la posa da origine e assi espressi nel sistema del nodo
    // "node" all'istante "seconds". Senza padre, sono già nel sistema
    // del padre.
    setPoseFrom(node, position, axes, seconds) {
        const parent = this.parent;
        if (!parent) {
            this.setPose(position, axes);
            return;
        }
        this.setPose(
            node.pointTo(parent, seconds, position),
            axes.map((axis) => node.vectorTo(parent, seconds, axis))
        );
    }

    // Origine del nodo nel sistema del padre all'istante "seconds" [s
    // simulati]. Costante per difetto.
    localPosition(seconds, result = new Cesium.Cartesian3()) {
        return Cesium.Cartesian3.clone(this.position, result);
    }

    // Assi del nodo nel sistema del padre all'istante "seconds".
    // Costanti per difetto.
    localOrientation(seconds, result = new Cesium.Matrix3()) {
        return Cesium.Matrix3.clone(this.orientation, result);
    }

    // Matrice dalle coordinate del nodo a quelle del padre all'istante
    // "seconds".
    localTransform(seconds, result = new Cesium.Matrix4()) {
        return Cesium.Matrix4.fromRotationTranslation(
            this.localOrientation(seconds), this.localPosition(seconds), result
        );
    }

    // --------------------------------------------------
    // TRASFORMAZIONI TRA I SISTEMI DEI NODI
    // --------------------------------------------------

    // Matrice dalle coordinate del nodo a quelle della radice.
    worldTransform(seconds, result = new Cesium.Matrix4()) {
        const local = new Cesium.Matrix4();
        this.localTransform(seconds, result);
        for (let node = this.parent; node; node = node.parent) {
            Cesium.Matrix4.multiplyTransformation(node.localTransform(seconds, local), result, result);
        }
        return result;
    }

    // Matrice dalle coordinate del nodo a quelle del nodo "target"
    // (della stessa gerarchia) all'istante "seconds".
    transformTo(target, seconds, result = new Cesium.Matrix4()) {
        const toWorld = this.worldTransform(seconds, result);
        const fromWorld = Cesium.Matrix4.inverseTransformation(
            target.worldTransform(seconds), new Cesium.Matrix4()
        );
        return Cesium.Matrix4.multiplyTransformation(fromWorld, toWorld, result);
    }

    // Punto "point" (coordinate del nodo) nelle coordinate di "target".
    pointTo(target, seconds, point, result = new Cesium.Cartesian3()) {
        return Cesium.Matrix4.multiplyByPoint(this.transformTo(target, seconds), point, result);
    }

    // Vettore "vector" (coordinate del nodo) nelle coordinate di
    // "target": solo rotazione, senza traslazione.
    vectorTo(target, seconds, vector, result = new Cesium.Cartesian3()) {
        return Cesium.Matrix4.multiplyByPointAsVector(this.transformTo(target, seconds), vector, result);
    }

    // Origine del nodo nelle coordinate di "target" all'istante
    // "seconds".
    positionIn(target, seconds, result = new Cesium.Cartesian3()) {
        return this.pointTo(target, seconds, Cesium.Cartesian3.ZERO, result);
    }

    // Assi X, Y, Z del nodo nelle coordinate di "target" all'istante
    // "seconds" (copie).
    axesIn(target, seconds) {
        return UNIT_AXES.map((axis) => this.vectorTo(target, seconds, axis));
    }

    // Posa { position, axes } del nodo nelle coordinate di "target"
    // all'istante "seconds" (copie).
    poseIn(target, seconds) {
        return { position: this.positionIn(target, seconds), axes: this.axesIn(target, seconds) };
    }
}

// ---------------------------------------------------- src/model/camera.js
// ============================================================
// camera.js — Telecamera: punto di vista sulla scena.
//
// È un nodo della scena il cui sistema è quello della telecamera:
//   origine  posizione della telecamera;
//   asse X   direzione di vista;
//   asse Y   Up;
//   asse Z   destra (X × Y).
// La posa è costante nel sistema del padre:
//   figlia di World (Telecamera ECI): ferma nello spazio inerziale (la
//     Terra ruota sullo schermo);
//   figlia della Terra (Telecamera ECEF): solidale con la Terra (la
//     Terra appare immobile).
// expressedIn() la restituisce nelle coordinate di un altro nodo (per
// esempio la Terra, il sistema in cui Cesium disegna).
// ============================================================


class Camera extends SceneNode {
    // Diventa vero quando l'utente sposta la telecamera: da quel
    // momento l'inquadratura automatica non la tocca più.
    movedByUser = false;

    // Direzione di vista nel sistema del padre (versore, copia).
    get direction() {
        return this.axes[0];
    }

    // Up nel sistema del padre (versore, copia).
    get up() {
        return this.axes[1];
    }

    // Posa { position, direction, up } nelle coordinate del nodo "node"
    // all'istante "seconds" (copie).
    expressedIn(node, seconds) {
        const { position, axes: [direction, up] } = this.poseIn(node, seconds);
        return { position: position, direction: direction, up: up };
    }

    // Imposta la posa da una posa { position, direction, up } espressa
    // nelle coordinate del nodo "node" all'istante "seconds". Up viene
    // reso ortogonale alla direzione.
    setFrom(node, pose, seconds) {
        const C3 = Cesium.Cartesian3;
        const direction = C3.normalize(pose.direction, new C3());
        const right = C3.normalize(C3.cross(direction, pose.up, new C3()), new C3());
        const up = C3.cross(right, direction, new C3());
        this.setPoseFrom(node, pose.position, [direction, up, right], seconds);
    }

    // Inquadratura iniziale (vedi cameraFraming.js): l'origine della
    // terna locale "frame" (centro della sfera della particella) vista
    // da una direzione fissa nella terna, a t = 0.
    frameStartPosition(frame, tanHalfFovWidth) {
        this.setFrom(frame.parent, startPositionFraming(frame, tanHalfFovWidth), 0);
    }
}

// ---------------------------------------------------- src/model/earth.js
// ============================================================
// earth.js — Terra: nodo della scena e modelli di Terra usati da
// gravità e urti.
//
// Earth è il nodo della scena "Terra", figlio di World: il suo sistema
// di coordinate è ECEF, che ruota rispetto a World (ECI) attorno
// all'asse di rotazione. Contiene il modello di Terra attivo.
//
// Ogni modello è una strategia con la stessa forma:
//   gravity(position, result)            accelerazione [m/s²]
//   potential(position)                  potenziale [J/kg]
//   heightAboveSurface(position, normal) distanza con segno dalla
//       superficie lungo la sua normale (scritta in "normal");
//       undefined se non definita
//   pointAboveSurface(surfacePoint, height, result)
//       punto a "height" metri sopra "surfacePoint", lungo la normale
//
// La Terra sceglie il modello e la simulazione non contiene "if" sul
// tipo di Terra.
//
// TERRA SFERICA
// - Gravità: legge di gravitazione universale, a = -GM·r/|r|³.
// - Superficie: sfera di raggio EARTH_RADIUS, normale radiale, cioè
//   allineata alla gravità: una particella rimbalza sempre sulla stessa
//   verticale inerziale. La superficie differisce fino a ~21 km
//   dall'ellissoide WGS84 visualizzato da Cesium.
//
// TERRA ELLISSOIDALE (WGS84)
// - Gravità: massa puntiforme + termini zonali J2 e J4 dello
//   schiacciamento. Insieme alla forza centrifuga la superficie WGS84
//   risulta equipotenziale a meno dei termini successivi (J6, ~1e-8):
//   un corpo fermo rispetto alla Terra sulla superficie non "scivola"
//   verso l'equatore. Con il solo J2 lo scostamento era ~35 volte
//   maggiore.
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
const J4 = -2.37091222e-6;               // Coefficiente zonale J4 (ellissoide normale WGS84)

// Polinomi di Legendre di grado 2 e 4 nel seno della latitudine
// geocentrica "s".
function legendre2(s) {
    return (3 * s * s - 1) / 2;
}

function legendre4(s) {
    const s2 = s * s;
    return (35 * s2 * s2 - 30 * s2 + 3) / 8;
}

const scratchSurfacePoint = new Cesium.Cartesian3();
const scratchSurfaceOffset = new Cesium.Cartesian3();

const SPHERICAL_EARTH = {
    // Massa puntiforme: a = -GM·r/|r|³.
    gravity(position, result) {
        const r2 = Cesium.Cartesian3.magnitudeSquared(position);
        return Cesium.Cartesian3.multiplyByScalar(position, -GM / (r2 * Math.sqrt(r2)), result);
    },

    // Potenziale della massa puntiforme: -GM/|r|.
    potential(position) {
        return -GM / Cesium.Cartesian3.magnitude(position);
    },

    // Distanza dalla sfera di raggio EARTH_RADIUS; normale radiale.
    heightAboveSurface(position, normalResult) {
        const r = Cesium.Cartesian3.magnitude(position);
        if (r === 0) {
            return undefined;
        }
        Cesium.Cartesian3.divideByScalar(position, r, normalResult);
        return r - EARTH_RADIUS;
    },

    // Punto sulla verticale radiale di "surfacePoint".
    pointAboveSurface(surfacePoint, height, result) {
        const up = Cesium.Cartesian3.normalize(surfacePoint, result);
        return Cesium.Cartesian3.multiplyByScalar(up, EARTH_RADIUS + height, result);
    }
};

const ELLIPSOIDAL_EARTH = {
    // Massa puntiforme corretta dai termini J2 e J4 (asse di simmetria
    // Z), con s = z/r e q = (Re/r)²:
    //   ax,y = a_pm · [1 + 3/2·J2·q·(1 - 5s²) - 5/8·J4·q²·(3 - 42s² + 63s⁴)]
    //   az   = a_pm · [1 + 3/2·J2·q·(3 - 5s²) - 5/8·J4·q²·(15 - 70s² + 63s⁴)]
    // (gradiente di potential(), verificato dai test).
    gravity(position, result) {
        SPHERICAL_EARTH.gravity(position, result);
        const r2 = Cesium.Cartesian3.magnitudeSquared(position);
        const q = (EQUATORIAL_RADIUS * EQUATORIAL_RADIUS) / r2;
        const s2 = (position.z * position.z) / r2;
        const s4 = s2 * s2;
        const j2 = 1.5 * J2 * q;
        const j4 = 0.625 * J4 * q * q;
        const horizontal = 1 + j2 * (1 - 5 * s2) - j4 * (3 - 42 * s2 + 63 * s4);
        result.x *= horizontal;
        result.y *= horizontal;
        result.z *= 1 + j2 * (3 - 5 * s2) - j4 * (15 - 70 * s2 + 63 * s4);
        return result;
    },

    // Potenziale con i termini J2 e J4:
    //   -GM/r · [1 - J2·(Re/r)²·P2(s) - J4·(Re/r)⁴·P4(s)].
    potential(position) {
        const r = Cesium.Cartesian3.magnitude(position);
        const s = position.z / r;
        const q = (EQUATORIAL_RADIUS / r) ** 2;
        return SPHERICAL_EARTH.potential(position) *
            (1 - J2 * q * legendre2(s) - J4 * q * q * legendre4(s));
    },

    // Distanza dall'ellissoide WGS84 lungo la normale geodetica.
    heightAboveSurface(position, normalResult) {
        const surface = WGS84.scaleToGeodeticSurface(position, scratchSurfacePoint);
        if (!Cesium.defined(surface)) {
            return undefined;
        }
        WGS84.geodeticSurfaceNormal(surface, normalResult);
        const offset = Cesium.Cartesian3.subtract(position, surface, scratchSurfaceOffset);
        return Cesium.Cartesian3.dot(offset, normalResult);
    },

    // Punto lungo la normale geodetica di "surfacePoint".
    pointAboveSurface(surfacePoint, height, result) {
        const surface = WGS84.scaleToGeodeticSurface(surfacePoint, scratchSurfacePoint);
        const normal = WGS84.geodeticSurfaceNormal(surface, result);
        Cesium.Cartesian3.multiplyByScalar(normal, height, result);
        return Cesium.Cartesian3.add(surface, result, result);
    }
};

const scratchRotation = new Cesium.Quaternion();

// Nodo della scena "Terra" (sistema ECEF).
class Earth extends SceneNode {
    // Modello di Terra attivo: sfera (true) o ellissoide WGS84 con J2 e
    // J4 (false).
    spherical = true;

    #rotationAxis; // RotationAxis, fratello della Terra sotto World

    // "rotationAxis": asse attorno al quale ruota.
    constructor(rotationAxis) {
        super();
        this.#rotationAxis = rotationAxis;
    }

    // Modello di Terra attivo (SPHERICAL_EARTH o ELLIPSOIDAL_EARTH).
    get model() {
        return this.spherical ? SPHERICAL_EARTH : ELLIPSOIDAL_EARTH;
    }

    // Assi ECEF nel sistema di World (il padre): ruotati dell'angolo di
    // cui la Terra ha ruotato attorno all'asse. L'origine resta nel
    // centro della Terra.
    localOrientation(seconds, result = new Cesium.Matrix3()) {
        const axis = this.#rotationAxis;
        Cesium.Quaternion.fromAxisAngle(axis.direction, axis.angle(seconds), scratchRotation);
        return Cesium.Matrix3.fromQuaternion(scratchRotation, result);
    }
}

// ---------------------------------------------------- src/model/arrow.js
// ============================================================
// arrow.js — Freccia: grandezza vettoriale di una particella (per
// esempio la velocità), disegnata nel centro della sua sfera.
//
// È un nodo della scena: il padre stabilisce rispetto a quale sistema
// è misurata la grandezza (World: spazio inerziale, Terra: ECEF).
// L'origine del nodo segue il centro della sfera della particella; gli
// assi sono quelli del padre. La grandezza è calcolata dallo stato
// corrente della particella con la funzione "quantity(state, result)",
// che restituisce le componenti nelle coordinate della particella (ECI).
// ============================================================


class Arrow extends SceneNode {
    #particle; // Particella di cui la freccia rappresenta la grandezza
    #quantity; // (state, result) => componenti nelle coordinate della particella

    // "particle": particella, letta a ogni richiesta; "quantity":
    // funzione che ne ricava la grandezza.
    constructor(particle, quantity) {
        super();
        this.#particle = particle;
        this.#quantity = quantity;
    }

    // Origine nel sistema del padre: centro della sfera della particella
    // nello stato corrente.
    localPosition(seconds, result = new Cesium.Cartesian3()) {
        const particle = this.#particle;
        return particle.pointTo(this.parent, seconds, particle.state.sphereCenter, result);
    }

    // Componenti nelle coordinate della freccia, all'istante "seconds"
    // dello stato corrente della particella.
    value(seconds, result = new Cesium.Cartesian3()) {
        const particle = this.#particle;
        this.#quantity(particle.state, result);
        return particle.vectorTo(this, seconds, result, result);
    }

    // Origine e vettore nelle coordinate del nodo "node" all'istante
    // "seconds" (copie).
    expressedIn(node, seconds) {
        return {
            position: this.positionIn(node, seconds),
            vector: this.vectorTo(node, seconds, this.value(seconds))
        };
    }
}

// ---------------------------------------------------- src/model/enuFrame.js
// ============================================================
// enuFrame.js — Terna Est-Nord-Su con origine in un punto.
// L'asse Su è la normale locale del modello di Terra: radiale per la
// Terra sferica, geodetica per quella ellissoidale.
//
// È un nodo della scena il cui sistema è la terna stessa: origine e
// assi Est, Nord, Su sono la posa del nodo, costante nel sistema del
// padre. Quindi la terna:
//   figlia di World (terna locale assoluta): resta ferma nello spazio
//     inerziale e, vista dalla Terra, ruota all'indietro dell'angolo di
//     rotazione terrestre;
//   figlia della Terra (terna locale relativa): resta solidale con la
//     Terra.
//
// toCartesian/toLocal convertono un vettore tra componenti nella terna
// e coordinate cartesiane del sistema del padre; i metodi statici
// convertono una velocità tra componenti nella terna e
// modulo/azimuth/elevazione.
// ============================================================


class EnuFrame extends SceneNode {
    #scratchTranspose = new Cesium.Matrix3();

    // Porta l'origine in "origin" e orienta gli assi verso Est, Nord e
    // Su, con Su lungo il versore "up" (la normale locale del modello di
    // Terra nel punto). "origin" e "up" sono nelle coordinate del nodo
    // "source" all'istante "seconds" (senza "source": già nel sistema
    // del padre).
    placeAt(origin, up, source, seconds = 0) {
        const enu = enuRotation(up);
        const axes = [0, 1, 2].map((i) => Cesium.Matrix3.getColumn(enu, i, new Cesium.Cartesian3()));
        if (source) {
            this.setPoseFrom(source, origin, axes, seconds);
        } else {
            this.setPose(origin, axes);
        }
    }

    // Componenti E, N, U di un vettore -> coordinate cartesiane nel
    // sistema del padre.
    toCartesian(local, result = new Cesium.Cartesian3()) {
        return Cesium.Matrix3.multiplyByVector(this.orientation, local, result);
    }

    // Coordinate cartesiane di un vettore nel sistema del padre ->
    // componenti E, N, U.
    toLocal(vector, result = new Cesium.Cartesian3()) {
        const transpose = Cesium.Matrix3.transpose(this.orientation, this.#scratchTranspose);
        return Cesium.Matrix3.multiplyByVector(transpose, vector, result);
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
// trajectory.js — Traiettoria del centro della sfera di una particella.
//
// È un nodo della scena: sequenza delle posizioni registrate a ogni
// istante raggiunto dalla simulazione, nelle coordinate del nodo, che
// coincidono con quelle del padre:
//   figlia di World (traiettoria assoluta): ferma nello spazio inerziale;
//   figlia della Terra (traiettoria relativa): solidale con la Terra.
// ============================================================


const TRAJECTORY_MIN_DISTANCE = 10; // [m] evita vertici coincidenti

class Trajectory extends SceneNode {
    // Posizioni registrate (Cartesian3, nelle coordinate del nodo), in
    // ordine di tempo.
    points = [];

    // Cresce a ogni clear(): chi disegna la traiettoria capisce che
    // deve ricominciare anche se nel frattempo sono stati aggiunti
    // nuovi punti.
    revision = 0;

    // Aggiunge una copia di "position" (coordinate del nodo), se dista
    // almeno TRAJECTORY_MIN_DISTANCE dall'ultimo punto.
    addPoint(position) {
        const last = this.points[this.points.length - 1];
        if (last && Cesium.Cartesian3.distance(last, position) < TRAJECTORY_MIN_DISTANCE) {
            return;
        }
        this.points.push(Cesium.Cartesian3.clone(position));
    }

    // Svuota la traiettoria.
    clear() {
        this.points = [];
        this.revision++;
    }
}

// ---------------------------------------------------- src/model/particle.js
// ============================================================
// particle.js — Modello di una particella: punto materiale soggetto
// alla gravità che rimbalza elasticamente sulla Terra.
//
// Il baricentro della particella è il suo punto di contatto con la
// superficie: la dinamica (posizione, velocità, quota, urti) riguarda
// solo quel punto. La particella è disegnata come una sfera di raggio
// "radius" appoggiata sul punto, con il centro lungo la verticale
// locale del modello di Terra; frecce, terne e traiettorie sono
// riferite al centro della sfera.
//
// Perché il punto di contatto e non il centro della sfera: una
// particella ferma rispetto alla Terra resta ferma solo se il suo
// baricentro si muove su una superficie equipotenziale della gravità
// efficace. La superficie del modello di Terra lo è; la superficie
// parallela a 125 km di quota, su cui starebbe il centro della sfera,
// no (la verticale si incurva con la quota) e la particella
// scivolerebbe verso l'equatore.
//
// È un nodo della scena, figlio di World (vedi Simulation): le sue
// coordinate sono ECI.
//
// Contiene ciò che appartiene alla singola particella:
//   - raggio della sfera disegnata;
//   - condizioni iniziali (posizione di partenza, velocità) con le loro
//     regole di validità;
//   - stato iniziale e stato corrente, in ECI;
//   - grandezze derivate (quota, centro della sfera, energia);
//   - frecce della velocità assoluta e relativa;
//   - freccia della componente orizzontale dell'accelerazione di
//     Coriolis;
//   - terne locali assoluta e relativa nella posizione di partenza;
//   - traiettorie assoluta e relativa del centro della sfera.
// Frecce, terne e traiettorie sono nodi della scena che Simulation
// appende a World (assoluti, chiave "eci") o alla Terra (relativi,
// chiave "ecef", e la freccia di Coriolis), non alla particella: la
// particella li conserva come riferimenti.
//
// Ciò che è comune a tutte le particelle (modello di Terra, tempo,
// integrazione) è in Simulation. Il modello di Terra viene passato ai
// metodi che ne dipendono.
//
// Le modifiche delle condizioni iniziali hanno effetto alla successiva
// chiamata di reset(earthModel) (Simulation.reset()).
// ============================================================


const DEFAULT_PARTICLE_RADIUS = 125000; // [m] raggio della sfera disegnata

// Posizione di partenza predefinita; latitudine e longitudine sono
// usate finché il browser non fornisce la posizione geografica del PC.
const DEFAULT_START_POSITION = { latitudeDeg: 45.0, longitudeDeg: 7.1, altitude: 0 };

class Particle extends SceneNode {
    // Raggio della sfera con cui la particella è disegnata [m]: non
    // entra nella dinamica.
    radius;

    // Posizione di partenza del baricentro (condizione iniziale):
    // latitudine e longitudine geodetiche WGS84 e quota lungo la normale
    // locale del modello di Terra. Impostata dal costruttore con
    // setStartPosition().
    startPosition = {
        latitudeDeg: 0,                           // [-90°, +90°]
        longitudeDeg: 0,                          // [0°, 360°)
        altitude: 0,                              // [m], non negativa
        surfacePointECEF: new Cesium.Cartesian3() // Derivato: punto WGS84 di quota 0
    };

    // Terne di velocità iniziale (nella terna Est-Nord-Su della
    // posizione di partenza: modulo [km/h], azimuth [°] dal Nord,
    // elevazione [°]):
    //   "eci":  velocità assoluta, rispetto allo spazio inerziale;
    //   "ecef": velocità relativa, rispetto alla Terra.
    // L'ultima terna modificata è quella "di riferimento"
    // (velocityMaster): l'altra viene ricalcolata da questa.
    velocityMaster = "ecef";

    velocity = bySystem(() => ({ speedKmh: 0, azimuthDeg: 0, elevationDeg: 0 }));

    // Stato iniziale del baricentro e centro iniziale della sfera
    // (a t = 0 ECI ed ECEF coincidono).
    initial = {
        position: new Cesium.Cartesian3(),
        velocity: bySystem(() => new Cesium.Cartesian3()), // Assoluta (eci) e relativa (ecef), in ECI
        sphereCenter: new Cesium.Cartesian3(),
        normal: new Cesium.Cartesian3() // Normale locale nella posizione di partenza
    };

    // Stato corrente, in ECI.
    state = {
        position: new Cesium.Cartesian3(),     // Baricentro
        velocity: new Cesium.Cartesian3(),     // Velocità del baricentro
        altitude: 0,                           // Quota del baricentro [m]
        normal: new Cesium.Cartesian3(),       // Normale locale nel baricentro (nulla se non definita)
        sphereCenter: new Cesium.Cartesian3()  // Centro della sfera disegnata
    };

    // Velocità corrente: assoluta (eci) e relativa (ecef), disegnate
    // nel centro della sfera.
    velocityArrows;

    // Componente orizzontale (perpendicolare alla normale locale)
    // dell'accelerazione di Coriolis corrente -2 ω × v_rel, disegnata nel
    // centro della sfera (figlia della Terra).
    coriolisArrow;

    // Terne locali assoluta (eci) e relativa (ecef), con origine nel
    // centro della sfera a t = 0.
    startFrames;

    // Traiettorie assoluta (eci) e relativa (ecef): posizioni del centro
    // della sfera dall'inizio della simulazione.
    trajectories;

    #rotationAxis; // Asse di rotazione terrestre (velocità di trascinamento)
    #scratchPoint = new Cesium.Cartesian3();

    // "rotationAxis": asse di rotazione terrestre (RotationAxis);
    // "radius": raggio della sfera disegnata [m].
    constructor(rotationAxis, radius = DEFAULT_PARTICLE_RADIUS) {
        super();
        this.#rotationAxis = rotationAxis;
        this.radius = radius;
        // Grandezze delle frecce, in coordinate ECI: velocità assoluta v
        // e relativa alla Terra v - ω × r.
        const quantities = {
            eci: (state, result) => Cesium.Cartesian3.clone(state.velocity, result),
            ecef: (state, result) => rotationAxis.relativeVelocity(state.position, state.velocity, result)
        };
        this.velocityArrows = bySystem((system) => new Arrow(this, quantities[system]));
        this.coriolisArrow = new Arrow(this, (state, result) => {
            const coriolis = rotationAxis.coriolisAcceleration(state.position, state.velocity, result);
            return tangentialComponent(coriolis, state.normal, coriolis);
        });
        this.startFrames = bySystem(() => new EnuFrame());
        this.trajectories = bySystem(() => new Trajectory());
        this.setStartPosition(DEFAULT_START_POSITION);
    }

    // --------------------------------------------------
    // CONDIZIONI INIZIALI (con le loro regole di validità)
    // --------------------------------------------------

    // Modifica una o più componenti della posizione di partenza:
    // "changes" può contenere latitudeDeg [°], longitudeDeg [°] e
    // altitude [m]. Latitudine limitata a [-90°, +90°], longitudine
    // ricondotta a [0°, 360°), quota non negativa; il punto WGS84 di
    // quota 0 segue latitudine e longitudine.
    setStartPosition(changes) {
        const start = Object.assign(this.startPosition, changes);
        start.latitudeDeg = Cesium.Math.clamp(start.latitudeDeg, -90, 90);
        start.longitudeDeg = normalizeDegrees(start.longitudeDeg);
        start.altitude = Math.max(0, start.altitude);
        Cesium.Cartesian3.fromDegrees(
            start.longitudeDeg, start.latitudeDeg, 0, Cesium.Ellipsoid.WGS84, start.surfacePointECEF
        );
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

    // Calcola lo stato iniziale sul modello di Terra "earthModel", vi riporta
    // lo stato corrente e fa ripartire le traiettorie.
    reset(earthModel) {
        const C3 = Cesium.Cartesian3;
        const initial = this.initial;

        // Baricentro nella posizione di partenza: alla sua quota, lungo
        // la normale alla superficie del modello sotto latitudine e
        // longitudine (a t = 0 le coordinate ECEF coincidono con quelle
        // ECI della particella).
        const start = this.startPosition;
        earthModel.pointAboveSurface(start.surfacePointECEF, start.altitude, initial.position);
        C3.clone(initial.position, this.state.position);
        this.updateDerivedState(earthModel);
        C3.clone(this.state.sphereCenter, initial.sphereCenter);

        // Terne con origine nel centro della sfera e asse Su lungo la
        // normale locale del modello di Terra.
        C3.clone(this.state.normal, initial.normal);
        Object.values(this.startFrames).forEach((frame) => frame.placeAt(initial.sphereCenter, initial.normal, this));
        this.#computeInitialVelocity();
        C3.clone(initial.velocity.eci, this.state.velocity);

        Object.values(this.trajectories).forEach((trajectory) => trajectory.clear());
        this.recordTrajectory(0);
    }

    // Aggiunge il centro corrente della sfera (istante "seconds") alle
    // traiettorie, nelle coordinate di ciascuna.
    recordTrajectory(seconds) {
        Object.values(this.trajectories).forEach((trajectory) => {
            trajectory.addPoint(this.pointTo(trajectory, seconds, this.state.sphereCenter, this.#scratchPoint));
        });
    }

    // Distanza con segno del baricentro dalla superficie, lungo la
    // normale (scritta in "normalResult"); undefined se non definita.
    clearance(earthModel, normalResult) {
        return earthModel.heightAboveSurface(this.state.position, normalResult);
    }

    // Aggiorna le grandezze derivate dalla posizione del baricentro:
    // quota (0 se non definita), normale locale (nulla se non definita) e
    // centro della sfera, a un raggio dal baricentro lungo la verticale
    // locale.
    updateDerivedState(earthModel) {
        const state = this.state;
        const normal = state.normal;
        const h = this.clearance(earthModel, normal);
        state.altitude = Cesium.defined(h) ? h : 0;
        if (!Cesium.defined(h)) {
            Cesium.Cartesian3.clone(Cesium.Cartesian3.ZERO, normal);
            Cesium.Cartesian3.clone(state.position, state.sphereCenter);
            return;
        }
        Cesium.Cartesian3.multiplyByScalar(normal, this.radius, state.sphereCenter);
        Cesium.Cartesian3.add(state.position, state.sphereCenter, state.sphereCenter);
    }

    // Energia meccanica specifica nel sistema ECI [J/kg]: si conserva
    // durante il moto (utile per verificare l'integrazione).
    mechanicalEnergy(earthModel) {
        return 0.5 * Cesium.Cartesian3.magnitudeSquared(this.state.velocity) +
            earthModel.potential(this.state.position);
    }

    // A t = 0 le due terne di velocità sono legate da
    // v_ECI = v_ECEF + ω × r, con ω × r velocità di trascinamento nel
    // baricentro. La terna di riferimento (velocityMaster) determina
    // l'altra. Richiede le terne già posizionate (placeAt): i loro assi
    // Est, Nord, Su sono quelli della posizione di partenza.
    #computeInitialVelocity() {
        const C3 = Cesium.Cartesian3;
        const frame = this.startFrames.eci; // Sistema del padre della terna = ECI
        const { velocity } = this.initial;
        const master = this.velocityMaster;
        const other = master === "eci" ? "ecef" : "eci";
        const drag = this.#rotationAxis.dragVelocity(this.initial.position);

        frame.toCartesian(EnuFrame.fromSpherical(this.velocity[master]), velocity[master]);
        if (master === "ecef") {
            C3.add(velocity.ecef, drag, velocity.eci);
        } else {
            C3.subtract(velocity.eci, drag, velocity.ecef);
        }
        EnuFrame.toSpherical(frame.toLocal(velocity[other]), this.velocity[other]);
    }
}

// ---------------------------------------------------- src/model/rotationAxis.js
// ============================================================
// rotationAxis.js — Asse di rotazione terrestre, figlio di World.
//
// Unica definizione della rotazione terrestre: la Terra ruota attorno
// a questo asse (vedi Earth); velocità di trascinamento, velocità
// relativa e accelerazione di Coriolis si calcolano da qui. La direzione è l'asse Z del nodo (posa identità: asse Z di
// World, verso il Polo Nord).
// ============================================================


const OMEGA = 7.292115e-5; // Velocità angolare terrestre [rad/s]

class RotationAxis extends SceneNode {
    angularVelocity = OMEGA; // [rad/s]

    // Versore dell'asse nel sistema del padre (copia).
    get direction() {
        return this.axes[2];
    }

    // Vettore velocità angolare ω nel sistema del padre [rad/s].
    get omega() {
        return Cesium.Cartesian3.multiplyByScalar(this.direction, this.angularVelocity, new Cesium.Cartesian3());
    }

    // Angolo di cui la Terra ha ruotato dopo "seconds" secondi simulati.
    angle(seconds) {
        return this.angularVelocity * seconds;
    }

    // Velocità di trascinamento ω × r di un punto solidale con la Terra
    // in "position" (sistema del padre).
    dragVelocity(position, result) {
        return dragVelocity(this.omega, position, result);
    }

    // Velocità relativa alla Terra v - ω × r di un punto in "position"
    // con velocità "velocity" (sistema del padre).
    relativeVelocity(position, velocity, result) {
        return relativeVelocity(this.omega, position, velocity, result);
    }

    // Accelerazione di Coriolis -2 ω × v_rel di un punto in "position"
    // con velocità "velocity" (sistema del padre).
    coriolisAcceleration(position, velocity, result) {
        const omega = this.omega;
        const relative = relativeVelocity(omega, position, velocity, result);
        return coriolisAcceleration(omega, relative, relative);
    }
}

// ---------------------------------------------------- src/model/simulation.js
// ============================================================
// simulation.js — Modello: particella che si muove attorno alla
// Terra in rotazione.
//
// Contiene ciò che è comune a tutte le particelle: la gerarchia della
// scena, il tempo simulato, l'integrazione e gli urti. Lo stato e le
// condizioni iniziali di ogni particella sono in Particle; i metodi di
// integrazione ricevono la particella su cui agire.
//
// Gerarchia della scena (padre -> figli, vedi SceneNode):
//   World (radice, coordinate ECI)
//     -> Terra (coordinate ECEF, contiene il modello di Terra attivo)
//          -> terna locale relativa, traiettoria relativa,
//             freccia della velocità relativa,
//             freccia dell'accelerazione di Coriolis, Telecamera ECEF
//     -> asse di rotazione
//     -> particella
//     -> terna locale assoluta, traiettoria assoluta,
//        freccia della velocità assoluta, Telecamera ECI
// Le telecamere non partecipano alla dinamica.
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
    // Radice della gerarchia della scena (coordinate ECI).
    world = new SceneNode();

    rotationAxis = new RotationAxis();

    // Terra: nodo ECEF con il modello usato da gravità e urti.
    earth = new Earth(this.rotationAxis);

    particle = new Particle(this.rotationAxis);

    // Telecamere ECI (figlia di World) ed ECEF (figlia della Terra). Il
    // reset non le sposta.
    cameras = bySystem(() => new Camera());

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
        this.#buildScene();
        this.reset();
    }

    // Costruisce la gerarchia della scena (vedi l'intestazione del file).
    #buildScene() {
        const { world, earth, particle, cameras } = this;

        world.addChild(earth);
        world.addChild(this.rotationAxis);
        world.addChild(particle);
        world.addChild(particle.startFrames.eci);    // Terna locale assoluta
        world.addChild(particle.trajectories.eci);   // Traiettoria assoluta
        world.addChild(particle.velocityArrows.eci); // Freccia della velocità assoluta
        world.addChild(cameras.eci);

        earth.addChild(particle.startFrames.ecef);    // Terna locale relativa
        earth.addChild(particle.trajectories.ecef);   // Traiettoria relativa
        earth.addChild(particle.velocityArrows.ecef); // Freccia della velocità relativa
        earth.addChild(particle.coriolisArrow);       // Freccia dell'accelerazione di Coriolis
        earth.addChild(cameras.ecef);
    }

    // Riporta la simulazione a t = 0, applicando le condizioni iniziali
    // correnti (modello di Terra e particelle).
    reset() {
        this.particle.reset(this.earth.model);
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
        this.particle.updateDerivedState(this.earth.model);
        this.particle.recordTrajectory(target);
    }

    // --------------------------------------------------
    // INTEGRAZIONE E URTI
    // --------------------------------------------------

    // Vero se la particella compenetra la superficie e si sta ancora
    // avvicinando (dopo il rimbalzo la velocità normale è positiva).
    #isCollidingInward(particle) {
        const n = this.#scratch.normal;
        const c = particle.clearance(this.earth.model, n);
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
        particle.clearance(this.earth.model, n);
        const vn = Cesium.Cartesian3.dot(v, n);
        if (vn < 0) {
            Cesium.Cartesian3.subtract(
                v, Cesium.Cartesian3.multiplyByScalar(n, 2 * vn, this.#scratch.temp), v
            );
        }
    }

    // Salva posizione e velocità della particella, per ripetere un passo
    // con durata diversa (ricerca dell'istante di contatto).
    #saveState(particle) {
        Cesium.Cartesian3.clone(particle.state.position, this.#scratch.savedPosition);
        Cesium.Cartesian3.clone(particle.state.velocity, this.#scratch.savedVelocity);
    }

    // Ripristina lo stato salvato da #saveState().
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
        const earthModel = this.earth.model;
        const p = particle.state.position;
        const v = particle.state.velocity;
        const temp = this.#scratch.temp;

        const a0 = earthModel.gravity(p, this.#scratch.accel0);
        C3.add(p, C3.multiplyByScalar(v, h, temp), p);
        C3.add(p, C3.multiplyByScalar(a0, 0.5 * h * h, temp), p);

        const a1 = earthModel.gravity(p, this.#scratch.accel1);
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

// Errore lanciato dai metodi di un'interfaccia non implementati.
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

    // Avvia (true) o ferma (false) lo scorrere del tempo simulato.
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

    // "geolocation": navigator.geolocation (undefined se il browser non
    // la fornisce).
    constructor(geolocation) {
        super();
        this.#geolocation = geolocation;
    }

    // Promise della posizione, o di undefined se non disponibile (mai
    // rifiutata: l'errore è solo annotato nella console).
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

    // Configura "cesiumClock": tempo illimitato che parte da adesso,
    // fermo, "timeScale" volte più veloce del tempo reale quando scorre.
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

    // Il tempo scorre quando Cesium anima la scena.
    get running() {
        return this.#clock.shouldAnimate;
    }

    // Avvia o ferma lo scorrere del tempo.
    set running(value) {
        this.#clock.shouldAnimate = value;
    }

    // Riporta l'orologio all'istante iniziale.
    reset() {
        this.#clock.currentTime = this.#clock.startTime.clone();
    }

    // Vero se l'orologio è all'istante iniziale.
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
    coriolis: "yellow",    // Accelerazione di Coriolis (ECEF)
    rotationAxis: "violet",
    particle: "orange",
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
    ["ecef", "relativa (ECEF)"],
    ["eci", "assoluta (ECI)"]
];

// Righe della sezione Visualizzazione: [etichetta, oggetto, sistemi in
// cui l'oggetto esiste].
const VISIBILITY_ROWS = [
    ["Terne", "frame", REFERENCE_SYSTEMS],
    ["Traiettoria", "track", REFERENCE_SYSTEMS],
    ["Velocità", "velocity", REFERENCE_SYSTEMS],
    ["Coriolis", "coriolis", ["ecef"]]
];

const LEGEND = [
    [PALETTE.ecef, "Traiettoria e velocità relative (ECEF)"],
    [PALETTE.eci, "Traiettoria e velocità assolute (ECI)"],
    [PALETTE.coriolis, "Accelerazione di Coriolis orizzontale (ECEF)"],
    [PALETTE.rotationAxis, "Asse di rotazione terrestre"]
];

// --------------------------------------------------
// STRUMENTI DOM
// --------------------------------------------------

// Crea un elemento DOM con le proprietà e i figli indicati.
function element(tag, properties, children) {
    const node = Object.assign(document.createElement(tag), properties);
    node.append(...(children || []));
    return node;
}

// Icona SVG del pulsante, con descrizione per tooltip e lettori di
// schermo.
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

// Griglia di classe "className" con la riga di intestazione: una cella
// vuota sopra le etichette e i titoli "headings" delle colonne.
function gridWithHeadings(className, headings) {
    return element("div", { className: className }, [
        element("span"),
        ...headings.map((heading) => element("span", { className: "sim-colhead", textContent: heading }))
    ]);
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

    // Inserisce il pannello a sinistra di "sceneContainer" (contenitore
    // della vista Cesium) e lo collega a "viewModel".
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

    // Aggiunge lo stile e il pannello alla pagina e restringe la vista
    // Cesium allo spazio a destra del pannello.
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

    // Registra la funzione che aggiorna un controllo dallo stato del
    // ViewModel.
    #bind(refresher) {
        this.#refreshers.push(refresher);
    }

    // Aggiorna tutti i controlli.
    #refresh() {
        this.#refreshers.forEach((refresher) => refresher());
    }

    // --- Costruttori di controlli ----------------------------------------

    // Nuova sezione del pannello con il titolo indicato.
    #section(title, className) {
        const section = element("div", { className: className ? "sim-section " + className : "sim-section" }, [
            element("h3", { textContent: title })
        ]);
        this.#panel.append(section);
        return section;
    }

    // Pulsante che chiama "onClick" al clic.
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

    // Pulsanti avvia/pausa e stop, con il riquadro degli errori.
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

    // Selezione del punto sul globo, latitudine, longitudine e quota.
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
        this.#field(section, "Quota [km]", this.#numberInput({
            min: 0, step: 10,
            read: () => vm.altitudeKm,
            write: (value) => vm.setAltitudeKm(value)
        }));
    }

    // Griglia della velocità iniziale: righe VELOCITY_ROWS, colonne
    // VELOCITY_COLUMNS.
    #buildVelocitySection() {
        const vm = this.#vm;
        const grid = gridWithHeadings("sim-grid", ["Relativa (ECEF)", "Assoluta (ECI)"]);
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

    // Scelta del modello di Terra.
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

        const grid = gridWithHeadings("sim-visibility", ["Assoluti (ECI)", "Relativi (ECEF)"]);
        VISIBILITY_ROWS.forEach(([labelText, item, systems]) => {
            grid.append(element("span", { textContent: labelText }));
            REFERENCE_SYSTEMS.forEach((frame) => {
                // Cella vuota per i sistemi in cui l'oggetto non esiste.
                if (!systems.includes(frame)) {
                    grid.append(element("span"));
                    return;
                }
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
            options: [["Telecamera ECI", "eci"], ["Telecamera ECEF", "ecef"]],
            read: () => vm.cameraMode,
            write: (mode) => vm.setCameraMode(mode)
        });
        section.append(element("div", {
            className: "sim-note",
            textContent: "Rotella: zoom verso il puntatore del mouse. " +
                "Spostamento laterale: Shift + trascinamento con tasto destro"
        }));
    }

    // Riquadro dello stato, aggiornato a ogni istante da #showStatus().
    #buildStatusSection() {
        this.#status = element("div", { className: "sim-status" });
        this.#section("Stato").append(this.#status);
    }

    // Colori della scena e loro significato.
    #buildLegendSection() {
        const section = this.#section("Legenda", "sim-legend");
        LEGEND.forEach(([color, text]) => {
            const swatch = element("span", { className: "sim-swatch" });
            swatch.style.background = color;
            section.append(element("div", {}, [swatch, text]));
        });
    }

    // --- Messaggi e stato ---------------------------------------------------

    // Mostra "message" per ERROR_DURATION_MS; undefined lo nasconde.
    #showError(message) {
        clearTimeout(this.#errorTimer);
        this.#errorBox.style.display = message ? "block" : "none";
        if (message) {
            this.#errorBox.textContent = "⚠ " + message;
            this.#errorTimer = setTimeout(() => this.#showError(undefined), ERROR_DURATION_MS);
        }
    }

    // Righe "etichetta: valore" in colonna (testo monospaziato).
    #showStatus(status) {
        const position = status.latitudeDeg === undefined
            ? "-"
            : `${status.latitudeDeg.toFixed(2)}°, ${status.longitudeDeg.toFixed(2)}°`;
        this.#status.textContent = [
            ["Posizione", position],
            ["Tempo", status.timeSeconds.toFixed(1) + " s"],
            ["Quota", status.altitudeKm.toFixed(1) + " km"],
            ["Velocità ECEF", status.speedEcefKmh.toFixed(0) + " km/h"],
            ["Velocità ECI", status.speedEciKmh.toFixed(0) + " km/h"],
            ["Coriolis ECEF", status.coriolisMs2.toFixed(4) + " m/s²"]
        ].map(([label, value]) => (label + ":").padEnd(STATUS_LABEL_WIDTH) + value).join("\n");
    }
}

// ---------------------------------------------------- src/view/scene/cameraRig.js
// ============================================================
// cameraRig.js — Presentazione delle telecamere del modello sulla
// telecamera di Cesium, comandi del mouse, pan e zoom con la rotella
// verso il punto sotto il mouse.
//
// La posa da mostrare arriva dal ViewModel (telecamera attiva, in
// ECEF) ed è applicata a ogni frame con apply(). Tra un frame e il
// successivo l'utente può muovere la telecamera di Cesium con il mouse:
// takeUserMove() riconosce lo spostamento e lo restituisce, così che il
// ViewModel lo registri nella telecamera del modello che era mostrata.
// ============================================================


// Soglie oltre le quali la posa è considerata mossa dall'utente.
const MOVED_POSITION_TOLERANCE = 0.01; // [m]
const MOVED_AXIS_TOLERANCE = 1e-8;

// Zoom con la rotella: a ogni scatto (delta 100) la distanza dal punto
// sotto il mouse diventa WHEEL_ZOOM_RATIO volte quella di prima.
const WHEEL_ZOOM_RATIO = 0.8;
const WHEEL_STEP_DELTA = 100;

// Comandi predefiniti di Cesium, scritti qui per chiarezza: sono quelli
// descritti dal pannello di aiuto "?" in alto a destra. In 3D:
//   rotate (gira il globo)        trascinamento con il tasto sinistro
//   zoom                          trascinamento destro, pinch
//   tilt (inclina verso           trascinamento centrale, Ctrl +
//   l'orizzonte)                  trascinamento sinistro o destro, pinch
//   look (ruota la telecamera     Shift + trascinamento sinistro
//   su se stessa)
// "translate" agisce solo in 2D e Columbus View. La rotella non è
// gestita da Cesium ma da CameraRig (zoom verso il punto sotto il mouse).
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
    controller.zoomEventTypes = [E.RIGHT_DRAG, E.PINCH];
    controller.tiltEventTypes = [
        E.MIDDLE_DRAG,
        E.PINCH,
        { eventType: E.LEFT_DRAG, modifier: CTRL },
        { eventType: E.RIGHT_DRAG, modifier: CTRL }
    ];
    controller.lookEventTypes = { eventType: E.LEFT_DRAG, modifier: SHIFT };
    controller.translateEventTypes = E.LEFT_DRAG;
}

// Fa ignorare a "camera" le rotazioni attorno a un asse nullo.
//
// Difetto di Cesium: nello zoom verso il punto sotto il mouse
// (trascinamento destro o rotella), se il mouse è esattamente al
// centro della vista il punto al centro e quello sotto il mouse
// coincidono. Per arrotondamento il loro prodotto scalare può valere
// 0,9999999999999999 (< 1) mentre il prodotto vettoriale, usato come
// asse, è nullo: Camera.rotate lo normalizza, lancia una DeveloperError
// e Cesium ferma il rendering. Una rotazione attorno a un asse nullo
// non sposta nulla, quindi ignorarla non cambia il comportamento.
function ignoreZeroAxisRotations(camera) {
    const rotate = camera.rotate.bind(camera);
    camera.rotate = (axis, angle) => {
        if (Cesium.Cartesian3.magnitudeSquared(axis) > 0) {
            rotate(axis, angle);
        }
    };
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
    // Pan e zoom con la rotella spostano la telecamera di Cesium come
    // i comandi predefiniti: lo spostamento è riconosciuto da
    // takeUserMove() e registrato nella telecamera del modello mostrata.

    #viewer;
    #camera;
    #handler; // Eventi del mouse sul canvas (pan e rotella)
    // Ultima posa applicata: { system, seconds, pose } con la posa ECEF
    // effettiva di Cesium, per riconoscere gli spostamenti dell'utente.
    #applied;
    // Profondità del punto afferrato con il pan [m]; undefined = nessun pan.
    #panDepth;

    // Configura i comandi del mouse, il pan e lo zoom con la rotella
    // sulla telecamera di "viewer".
    constructor(viewer) {
        this.#viewer = viewer;
        this.#camera = viewer.camera;
        this.#handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        ignoreZeroAxisRotations(viewer.camera);
        configureMouseControls(viewer.scene.screenSpaceCameraController);
        this.#installPan();
        this.#installWheelZoom();
    }

    // Tangente del semiangolo del campo visivo lungo la larghezza della
    // vista (in Cesium "fov" vale per il lato più lungo).
    get tanHalfFovWidth() {
        const container = this.#viewer.container;
        const width = container.clientWidth || 1;
        const height = container.clientHeight || 1;
        return Math.tan(this.#camera.frustum.fov / 2) * width / Math.max(width, height);
    }

    // Mostra la posa "pose" (ECEF) della telecamera "system" del modello
    // all'istante "seconds".
    apply(system, seconds, pose) {
        setCameraPose(this.#camera, pose.position, pose.direction, pose.up);
        this.#applied = { system: system, seconds: seconds, pose: this.#currentPose() };
    }

    // Se l'utente ha spostato la telecamera dopo l'ultimo apply(),
    // restituisce { system, seconds, pose }: la telecamera del modello
    // che era mostrata, l'istante in cui era stata applicata e la nuova
    // posa ECEF. Altrimenti undefined.
    takeUserMove() {
        const applied = this.#applied;
        if (!applied || !this.#poseChanged(applied.pose)) {
            return undefined;
        }
        const pose = this.#currentPose();
        this.#applied = { ...applied, pose: pose };
        return { system: applied.system, seconds: applied.seconds, pose: pose };
    }

    // Posa attuale della telecamera di Cesium, in ECEF (copie).
    #currentPose() {
        const camera = this.#camera;
        return {
            position: Cesium.Cartesian3.clone(camera.positionWC),
            direction: Cesium.Cartesian3.clone(camera.directionWC),
            up: Cesium.Cartesian3.clone(camera.upWC)
        };
    }

    // Vero se la telecamera di Cesium non è più nella posa "pose".
    #poseChanged(pose) {
        const camera = this.#camera;
        const distance = Cesium.Cartesian3.distance;
        return distance(camera.positionWC, pose.position) > MOVED_POSITION_TOLERANCE ||
            distance(camera.directionWC, pose.direction) > MOVED_AXIS_TOLERANCE ||
            distance(camera.upWC, pose.up) > MOVED_AXIS_TOLERANCE;
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

    // Registra i gestori di inizio, movimento e fine del pan.
    #installPan() {
        const scene = this.#viewer.scene;
        const handler = this.#handler;
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

    // Profondità [m], lungo la direzione di vista, del punto della Terra
    // sotto "windowPosition" (del centro della Terra se il cursore è
    // nello spazio); almeno 1 m.
    #depthAt(windowPosition) {
        return this.#distanceAlong(this.#camera.directionWC, this.#targetAt(windowPosition));
    }

    // Punto della Terra (ellissoide WGS84) sotto "windowPosition", o il
    // centro della Terra se il cursore è nello spazio.
    #targetAt(windowPosition) {
        const picked = this.#camera.pickEllipsoid(windowPosition, Cesium.Ellipsoid.WGS84);
        return Cesium.defined(picked) ? picked : Cesium.Cartesian3.ZERO;
    }

    // Distanza [m] di "target" dalla telecamera lungo il versore
    // "direction"; almeno 1 m.
    #distanceAlong(direction, target) {
        const offset = Cesium.Cartesian3.subtract(target, this.#camera.positionWC, new Cesium.Cartesian3());
        return Math.max(Cesium.Cartesian3.dot(offset, direction), 1);
    }

    // --------------------------------------------------
    // ZOOM CON LA ROTELLA VERSO IL PUNTO SOTTO IL MOUSE
    // --------------------------------------------------
    //
    // La telecamera si sposta lungo il raggio che passa per il mouse,
    // senza cambiare orientamento: il punto sotto il mouse resta sotto il
    // mouse. La distanza da quel punto (della Terra, o il punto del raggio
    // più vicino al centro della Terra se il mouse è nello spazio) è
    // moltiplicata per WHEEL_ZOOM_RATIO a ogni scatto in avanti e divisa
    // a ogni scatto indietro: avvicinandosi, la telecamera non raggiunge
    // mai la superficie.

    // Registra la posizione del mouse e il gestore della rotella
    // (l'evento di Cesium fornisce solo l'entità dello scatto).
    #installWheelZoom() {
        const canvas = this.#viewer.scene.canvas;
        let cursor;
        canvas.addEventListener("pointermove", (event) => {
            const rect = canvas.getBoundingClientRect();
            cursor = new Cesium.Cartesian2(event.clientX - rect.left, event.clientY - rect.top);
        });
        this.#handler.setInputAction((delta) => {
            const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
            this.#zoomTowards(cursor ?? center, delta);
        }, Cesium.ScreenSpaceEventType.WHEEL);
    }

    // Avvicina (delta > 0) o allontana (delta < 0) la telecamera dal punto
    // sotto "windowPosition".
    #zoomTowards(windowPosition, delta) {
        const camera = this.#camera;
        const ray = camera.getPickRay(windowPosition);
        if (!Cesium.defined(ray)) {
            return;
        }
        const distance = this.#distanceAlong(ray.direction, this.#targetAt(windowPosition));
        const newDistance = distance * Math.pow(WHEEL_ZOOM_RATIO, delta / WHEEL_STEP_DELTA);
        camera.move(ray.direction, distance - newDistance);
    }
}

// ---------------------------------------------------- src/view/scene/trackLayer.js
// ============================================================
// trackLayer.js — Disegno di una traiettoria della particella.
//
// Riceve i punti della traiettoria (nelle coordinate della traiettoria)
// e li disegna con una modelMatrix verso ECEF (identità per una
// traiettoria solidale con la Terra, rotazione per una ferma nello
// spazio inerziale).
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

    // Aggiunge a "primitives" le collezioni della traccia, di colore
    // "color" (Cesium.Color).
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

    // Cancella tutto il disegno.
    #clear() {
        this.#active.removeAll();
        this.#frozenChunks.removeAll();
        this.#activePolyline = undefined;
        this.#points = [];
        this.#drawnCount = 0;
    }

    // Aggiunge un vertice al troncone attivo, congelandolo quando è
    // pieno.
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

    // Disegna "points" come Primitive statica, con la modelMatrix
    // corrente.
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
// ogni istante e posa della telecamera attiva, già in coordinate ECEF)
// e inoltra al ViewModel il punto scelto sul globo e gli spostamenti
// della telecamera fatti dall'utente.
//
// Orologio di Cesium come unica sorgente del tempo: le entità sono
// aggiornate da Cesium con il "time" del frame (CallbackProperty) e
// telecamera, tracce e terne in preRender con lo stesso "time".
// ViewModel.frameAt() è idempotente, quindi nello stesso frame tutti
// usano lo stesso stato.
// ============================================================


// Frecce: partono dalla superficie della sfera della particella e sono
// lunghe "metersPerUnit" metri per unità della grandezza; sotto
// "minMagnitude" sono nascoste.
const ARROW_WIDTH = 12; // [px] (serve per la punta)

// Velocità: lunghezza pari allo spazio percorso in 600 s a velocità
// costante (es. 1 km/s -> 600 km).
const VELOCITY_ARROW = { metersPerUnit: 600, minMagnitude: 1 }; // [m per m/s], [m/s]

// Componente orizzontale dell'accelerazione di Coriolis (2ω·v·sin φ per
// velocità relativa orizzontale alla latitudine φ): scala scelta perché
// ai poli la freccia sia lunga circa il doppio di quella della velocità
// relativa (2 · 600 s / 2ω ≈ 8·10⁶ s²), alla latitudine φ sin φ volte
// tanto. La soglia corrisponde a circa 0,7 m/s di velocità relativa ai
// poli.
const CORIOLIS_ARROW = { metersPerUnit: 8e6, minMagnitude: 1e-4 }; // [m per m/s²], [m/s²]

// Asse di rotazione: solo i due tratti esterni, dalla superficie di
// ciascun polo verso lo spazio (nulla traspare attraverso il globo).
const AXIS_HALF_LENGTH = 9000000; // [m] dal centro della Terra
const AXIS_WIDTH = 1.5;           // [px]

// Terne di riferimento: assi lunghi sempre FRAME_AXIS_PIXELS a schermo.
const FRAME_AXIS_PIXELS = 70; // [px]
const FRAME_LINE_WIDTH = 3;   // [px]

// Nomi delle frecce della velocità (mostrati da Cesium alla selezione).
const VELOCITY_ARROW_NAMES = {
    eci: "Velocità assoluta (ECI)",
    ecef: "Velocità relativa (ECEF)"
};

// Colore di Cesium dal nome CSS.
function color(cssName) {
    return Cesium.Color.fromCssColorString(cssName);
}

class SceneView {
    #viewer;
    #vm;
    #camera;
    #arrows;
    #coriolisArrow;
    #tracks;
    #framePolylines;
    #scratchPixelSphere = new Cesium.BoundingSphere();

    constructor(viewer, viewModel) {
        this.#viewer = viewer;
        this.#vm = viewModel;
        this.#camera = new CameraRig(viewer);

        this.#addParticle();
        this.#arrows = bySystem((system) => this.#addArrow(
            VELOCITY_ARROW_NAMES[system], PALETTE[system], (frame) => frame.velocities[system], VELOCITY_ARROW
        ));
        this.#coriolisArrow = this.#addArrow(
            "Accelerazione di Coriolis orizzontale (ECEF)", PALETTE.coriolis, (frame) => frame.coriolis, CORIOLIS_ARROW
        );
        this.#tracks = bySystem((system) => new TrackLayer(viewer.scene.primitives, color(PALETTE[system])));
        this.#addRotationAxis();
        this.#framePolylines = this.#addReferenceFrames();
        this.#installPicking();

        viewModel.on("change", () => this.#render());
        // Il ViewModel inquadra solo le telecamere non spostate dall'utente.
        viewModel.on("startPositionLocated", () => this.#frameStartPosition());
        viewer.scene.preRender.addEventListener((scene, time) => this.#update(time));

        this.#frameStartPosition();
        this.#render();
    }

    // Oggetti della scena per i test end-to-end.
    get testObjects() {
        return {
            arrows: this.#arrows,
            coriolisArrow: this.#coriolisArrow,
            frames: this.#framePolylines
        };
    }

    // --------------------------------------------------
    // AGGIORNAMENTO
    // --------------------------------------------------

    // Secondi simulati all'istante "time" dell'orologio di Cesium
    // (dell'istante corrente se non indicato).
    #secondsAt(time = this.#viewer.clock.currentTime) {
        return Cesium.JulianDate.secondsDifference(time, this.#viewer.clock.startTime);
    }

    // Stato del ViewModel all'istante "time" dell'orologio di Cesium.
    #frameAt(time) {
        return this.#vm.frameAt(this.#secondsAt(time));
    }

    // Inquadratura iniziale sulla posizione di partenza, mostrata subito.
    #frameStartPosition() {
        this.#vm.frameStartPosition(this.#camera.tanHalfFovWidth);
        this.#showCamera(this.#secondsAt());
    }

    // Registra nel modello l'eventuale spostamento della telecamera fatto
    // dall'utente, poi mostra la posa della telecamera attiva
    // all'istante "seconds".
    #showCamera(seconds) {
        const vm = this.#vm;
        const move = this.#camera.takeUserMove();
        if (move) {
            vm.moveCamera(move.system, move.pose, move.seconds);
        }
        this.#camera.apply(vm.cameraMode, seconds, vm.cameraPose(seconds));
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
        this.#coriolisArrow.show = vm.visibility.coriolis.ecef;

        this.#viewer.canvas.style.cursor = vm.pickMode ? "crosshair" : "";
        // Subito, senza attendere il frame: la telecamera attiva può
        // essere cambiata.
        this.#showCamera(this.#secondsAt());
    }

    // A ogni frame, prima del rendering.
    #update(time) {
        const frame = this.#frameAt(time);
        this.#showCamera(frame.seconds);
        this.#updateTracks(frame);
        // Dopo la telecamera: la dimensione a schermo usa la sua posa.
        this.#updateReferenceFrames(frame);
    }

    // --------------------------------------------------
    // PARTICELLA E FRECCE
    // --------------------------------------------------

    #addParticle() {
        const r = this.#vm.particleRadius;
        this.#viewer.entities.add({
            name: "Particella",
            position: new Cesium.CallbackProperty((time, result) => {
                return Cesium.Cartesian3.clone(this.#frameAt(time).sphereCenterEcef, result);
            }, false),
            ellipsoid: {
                radii: new Cesium.Cartesian3(r, r, r),
                material: color(PALETTE.particle).withAlpha(0.85)
            }
        });
    }

    // Freccia di nome "name" e colore "cssColor", aggiornata da Cesium a
    // ogni frame. "arrowOf(frame)" ricava dallo stato dell'istante la
    // freccia { position, vector } (ECEF); "scale" è { metersPerUnit,
    // minMagnitude } (vedi le costanti delle frecce).
    #addArrow(name, cssColor, arrowOf, scale) {
        const arrowAt = (time) => arrowOf(this.#frameAt(time));
        const positions = (time) => {
            const { position: center, vector } = arrowAt(time);
            const magnitude = Cesium.Cartesian3.magnitude(vector);
            if (magnitude < scale.minMagnitude) {
                return [Cesium.Cartesian3.clone(center), Cesium.Cartesian3.clone(center)];
            }
            const direction = Cesium.Cartesian3.normalize(vector, new Cesium.Cartesian3());
            const along = (origin, length) => Cesium.Cartesian3.add(
                origin,
                Cesium.Cartesian3.multiplyByScalar(direction, length, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
            const tail = along(center, this.#vm.particleRadius);
            return [tail, along(tail, magnitude * scale.metersPerUnit)];
        };

        return this.#viewer.entities.add({
            name: name,
            polyline: {
                positions: new Cesium.CallbackProperty(positions, false),
                show: new Cesium.CallbackProperty((time) => {
                    return Cesium.Cartesian3.magnitude(arrowAt(time).vector) >= scale.minMagnitude;
                }, false),
                width: ARROW_WIDTH,
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
    // Vertici nelle coordinate della traiettoria, disegnati con la
    // matrice verso ECEF dell'istante fornita dal ViewModel:
    // - relativa (verde): figlia della Terra, ruota con la Terra;
    // - assoluta (rossa): figlia di World, resta ferma nello spazio.

    // Aggiorna la posa delle tracce e aggiunge i punti nuovi.
    #updateTracks(frame) {
        REFERENCE_SYSTEMS.forEach((system) => {
            this.#tracks[system].setModelMatrix(frame.trajectoryTransforms[system]);
            this.#tracks[system].sync(this.#vm.trajectory(system));
        });
    }

    // --------------------------------------------------
    // ASSE DI ROTAZIONE
    // --------------------------------------------------

    // Due tratti lungo l'asse fornito dal ViewModel, dalla superficie
    // di ciascun polo fino a AXIS_HALF_LENGTH dal centro.
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

    // --------------------------------------------------
    // TERNE DI RIFERIMENTO NEL PUNTO DI PARTENZA
    // --------------------------------------------------
    //
    // X (rosso) Est, Y (verde) Nord, Z (blu) Su: una terna solidale con
    // la Terra (ECEF) e una ferma nello spazio inerziale (ECI).

    // Tre polilinee (E, N, U) per terna; posizioni impostate da
    // #updateReferenceFrames().
    #addReferenceFrames() {
        const collection = this.#viewer.scene.primitives.add(new Cesium.PolylineCollection());
        const createAxes = () => PALETTE.frameAxes.map((cssColor) => collection.add({
            positions: [new Cesium.Cartesian3(0, 0, 0), new Cesium.Cartesian3(1, 0, 0)],
            width: FRAME_LINE_WIDTH,
            material: Cesium.Material.fromType("Color", { color: color(cssColor) })
        }));
        // La terna ECI è creata per ultima: a t = 0, quando le due
        // coincidono, è disegnata sopra.
        return { ecef: createAxes(), eci: createAxes() };
    }

    // Porta le terne nella posizione dell'istante, con assi lunghi
    // FRAME_AXIS_PIXELS a schermo.
    #updateReferenceFrames(frame) {
        REFERENCE_SYSTEMS.forEach((system) => {
            const { position: origin, axes } = frame.referenceFrames[system];
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

    // Registra il gestore del clic sinistro.
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
            const accepted = this.#vm.pickStartPosition(
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
    #listeners = new Map(); // nome dell'evento -> funzioni registrate

    // Registra "listener", chiamato a ogni emissione di "event".
    on(event, listener) {
        if (!this.#listeners.has(event)) {
            this.#listeners.set(event, []);
        }
        this.#listeners.get(event).push(listener);
    }

    // Chiama, nell'ordine di registrazione, le funzioni registrate per
    // "event", passando loro "args".
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
// Ogni elemento della scena corrisponde a un nodo della gerarchia del
// modello (SceneNode, vedi Simulation):
//   Terra                                               -> Earth
//   particella                                          -> Particle
//   frecce della velocità e dell'accelerazione di Coriolis -> Arrow
//   traiettorie                                         -> Trajectory
//   terne nella posizione di partenza                   -> EnuFrame
//   asse di rotazione                                   -> RotationAxis
//   telecamere ECI ed ECEF                              -> Camera
// Cesium disegna nel sistema ECEF: il ViewModel esprime ogni elemento
// nelle coordinate della Terra.
//
// Eventi emessi (vedi Observable):
//   "change"            lo stato mostrato dalle viste è cambiato
//   "frame" (frame)     calcolato lo stato di un nuovo istante
//   "error" (message)   messaggio per l'utente (undefined = nascondi)
//   "startPositionLocated" latitudine e longitudine di partenza prese
//                         dalla posizione del PC
// ============================================================


const PICK_REQUIRES_RESET_MESSAGE =
    "Per selezionare un nuovo punto premi prima il pulsante Reset.";

class SimulationViewModel extends Observable {
    // Telecamera attiva: quella ferma in "eci" oppure quella ferma in
    // "ecef". Ognuna conserva la propria posa.
    cameraMode = "eci";

    // Vero mentre si attende il clic sul globo che sceglie il punto.
    pickMode = false;

    // Oggetti visibili, per tipo e sistema di riferimento.
    visibility = {
        frame: { eci: true, ecef: true },
        track: { eci: true, ecef: true },
        velocity: { eci: true, ecef: true },
        coriolis: { ecef: true } // Solo relativa alla Terra
    };

    #simulation;
    #particle;
    #clock;
    #geolocation;
    #frame;

    // "clock" e "geolocation" devono implementare SimulationClock e
    // GeolocationService. Parte da t = 0.
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

    // Vero mentre il tempo simulato scorre.
    get running() {
        return this.#clock.running;
    }

    // Le condizioni iniziali si modificano solo a simulazione ferma.
    get editable() {
        return !this.running;
    }

    // Modello di Terra: sfera (true) o ellissoide (false).
    get sphericalEarth() {
        return this.#simulation.earth.spherical;
    }

    // Raggio della particella [m].
    get particleRadius() {
        return this.#particle.radius;
    }

    // Latitudine della posizione di partenza [°], in [-90°, +90°].
    get latitudeDeg() {
        return this.#particle.startPosition.latitudeDeg;
    }

    // Longitudine della posizione di partenza [°], in [0°, 360°).
    get longitudeDeg() {
        return this.#particle.startPosition.longitudeDeg;
    }

    // Quota della posizione di partenza [km].
    get altitudeKm() {
        return this.#particle.startPosition.altitude / 1000;
    }

    // Posa { position, direction, up } della telecamera attiva in ECEF
    // all'istante "seconds" [s simulati].
    cameraPose(seconds) {
        return this.#simulation.cameras[this.cameraMode].expressedIn(this.#simulation.earth, seconds);
    }

    // Terna di velocità iniziale: "ecef" (relativa) o "eci" (assoluta).
    velocity(frame) {
        return this.#particle.velocity[frame];
    }

    // Direzione dell'asse di rotazione terrestre (verso il Polo Nord), in
    // ECEF. La Terra ruota attorno all'asse, quindi è la stessa in ogni
    // istante.
    get rotationAxis() {
        const { earth, rotationAxis } = this.#simulation;
        return rotationAxis.axesIn(earth, 0)[2]; // L'asse è l'asse Z del nodo
    }

    // Traiettoria assoluta ("eci") o relativa ("ecef") della particella:
    // { points, revision } (vedi Trajectory). I punti sono nelle
    // coordinate della traiettoria (vedi frameAt().trajectoryTransforms),
    // in sola lettura.
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

    // Avvia o mette in pausa la simulazione; l'avvio chiude la
    // selezione del punto.
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
    pickStartPosition(latitudeDeg, longitudeDeg) {
        if (!this.pickMode || this.running || !this.#clock.isAtStart()) {
            return false;
        }
        this.pickMode = false;
        this.#editSetup(() => this.#particle.setStartPosition({ latitudeDeg, longitudeDeg }));
        return true;
    }

    // Comandi delle condizioni iniziali: il modello valida il valore e
    // la simulazione riparte da t = 0 (vedi #editSetup).

    // Latitudine di partenza [°].
    setLatitude(deg) {
        this.#editSetup(() => this.#particle.setStartPosition({ latitudeDeg: deg }));
    }

    // Longitudine di partenza [°].
    setLongitude(deg) {
        this.#editSetup(() => this.#particle.setStartPosition({ longitudeDeg: deg }));
    }

    // Quota della posizione di partenza [km].
    setAltitudeKm(km) {
        this.#editSetup(() => this.#particle.setStartPosition({ altitude: km * 1000 }));
    }

    // Una componente della terna di velocità iniziale "frame";
    // component: "speedKmh", "azimuthDeg" o "elevationDeg".
    setVelocity(frame, component, value) {
        this.#editSetup(() => this.#particle.setVelocity(frame, { [component]: value }));
    }

    // Modello di Terra: sfera (true) o ellissoide (false).
    setSphericalEarth(spherical) {
        this.#editSetup(() => {
            this.#simulation.earth.spherical = spherical;
        });
    }

    // Telecamera attiva ("eci" o "ecef"). Attivo anche durante la
    // simulazione.
    setCameraMode(mode) {
        this.cameraMode = mode;
        this.emit("change");
    }

    // L'utente ha spostato la telecamera "system": "pose" è la nuova
    // posa in ECEF all'istante "seconds" [s simulati].
    moveCamera(system, pose, seconds) {
        const camera = this.#simulation.cameras[system];
        camera.setFrom(this.#simulation.earth, pose, seconds);
        camera.movedByUser = true;
    }

    // Inquadra la posizione di partenza con le telecamere che l'utente non
    // ha ancora spostato. "tanHalfFovWidth": tangente del semiangolo
    // del campo visivo lungo la larghezza della vista.
    frameStartPosition(tanHalfFovWidth) {
        const startFrame = this.#particle.startFrames.ecef; // Terna locale relativa
        Object.values(this.#simulation.cameras)
            .filter((camera) => !camera.movedByUser)
            .forEach((camera) => camera.frameStartPosition(startFrame, tanHalfFovWidth));
    }

    // item: "frame", "track" o "velocity"; frame: "eci" o "ecef".
    // Attivo anche durante la simulazione: agisce solo sulla vista.
    setVisibility(item, frame, show) {
        this.visibility[item][frame] = show;
        this.emit("change");
    }

    // Usa la posizione del PC come latitudine e longitudine di partenza,
    // se nel frattempo
    // l'utente non ha già scelto un punto o avviato la simulazione.
    async locateStartPosition() {
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
        this.#editSetup(() => this.#particle.setStartPosition({
            latitudeDeg: position.latitudeDeg,
            longitudeDeg: position.longitudeDeg
        }));
        this.emit("startPositionLocated");
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

        const earth = this.#simulation.earth;
        const particle = this.#particle;
        const state = particle.state;
        const particlePositionEcef = particle.pointTo(earth, seconds, state.position);
        const velocities = bySystem((system) => particle.velocityArrows[system].expressedIn(earth, seconds));
        const speedKmh = (system) => Cesium.Cartesian3.magnitude(velocities[system].vector) * KMH_PER_MS;
        const coriolis = particle.coriolisArrow.expressedIn(earth, seconds);

        this.#frame = {
            seconds: seconds,
            // Baricentro della particella e centro della sfera disegnata.
            particlePositionEcef: particlePositionEcef,
            sphereCenterEcef: particle.pointTo(earth, seconds, state.sphereCenter),
            // Velocità assoluta (eci) e relativa (ecef): { position, vector }.
            velocities: velocities,
            // Componente orizzontale dell'accelerazione di Coriolis:
            // { position, vector }.
            coriolis: coriolis,
            // Terne nella posizione di partenza: { position, axes: [E, N, U] }.
            referenceFrames: bySystem((system) => particle.startFrames[system].poseIn(earth, seconds)),
            // Matrici dalle coordinate delle traiettorie (vedi
            // trajectory()) a ECEF.
            trajectoryTransforms: bySystem((system) => particle.trajectories[system].transformTo(earth, seconds)),
            status: {
                ...geographicPosition(particlePositionEcef),
                timeSeconds: seconds,
                altitudeKm: state.altitude / 1000,
                speedEcefKmh: speedKmh("ecef"),
                speedEciKmh: speedKmh("eci"),
                coriolisMs2: Cesium.Cartesian3.magnitude(coriolis.vector)
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

    // Riporta modello e orologio a t = 0 e notifica le viste.
    #restarted() {
        this.#simulation.reset();
        this.#clock.reset();
        this.#frame = undefined;
        this.frameAt(0);
        this.emit("change");
    }

    // Chiede alle viste di nascondere il messaggio di errore.
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

viewModel.locateStartPosition();

// Oggetto in sola lettura usato dai test end-to-end (Playwright) per
// verificare lo stato della scena. Non ha effetti sulla simulazione.
window.__coriolis = {
    viewer: viewer,
    simulation: simulation,
    particle: simulation.particle,
    // Letta al momento, perché cambia durante l'uso.
    get cameraMode() {
        return viewModel.cameraMode;
    },
    ...sceneView.testObjects
};
