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

import * as Cesium from "cesium";
import { EARTH_ROTATION_AXIS, OMEGA } from "../geometry/referenceFrames.js";

export const GM = 3.986004418e14;              // G·M terrestre [m³/s²]
export const EARTH_RADIUS = 6371008.8;          // Raggio medio (IUGG) [m]
export const WGS84 = Cesium.Ellipsoid.WGS84;
export const EQUATORIAL_RADIUS = WGS84.radii.x; // [m]
export const J2 = 1.08262668e-3;                // Coefficiente zonale J2 (WGS84)
export const J4 = -2.37091222e-6;               // Coefficiente zonale J4 (ellissoide normale WGS84)

// Polinomi di Legendre di grado 2 e 4 nel seno della latitudine
// geocentrica "s".
function legendre2(s) {
    return (3 * s * s - 1) / 2;
}

function legendre4(s) {
    const s2 = s * s;
    return (35 * s2 * s2 - 30 * s2 + 3) / 8;
}

// Comune ai due modelli: la Terra ruota attorno all'asse Z (verso il
// Polo Nord) con velocità angolare OMEGA [rad/s]. Sono gli stessi
// valori su cui sono definiti i sistemi ECI ed ECEF in
// referenceFrames.js, così scena e conversioni non possono divergere.
export const ROTATION_AXIS = Object.freeze({
    direction: EARTH_ROTATION_AXIS,
    angularVelocity: OMEGA
});

const scratchSurfacePoint = new Cesium.Cartesian3();
const scratchSurfaceOffset = new Cesium.Cartesian3();

export const SPHERICAL_EARTH = {
    rotationAxis: ROTATION_AXIS,

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

export const ELLIPSOIDAL_EARTH = {
    rotationAxis: ROTATION_AXIS,

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
