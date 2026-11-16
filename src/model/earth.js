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

import * as Cesium from "cesium";
import { EARTH_ROTATION_AXIS, OMEGA } from "../geometry/referenceFrames.js";

export const GM = 3.986004418e14;              // G·M terrestre [m³/s²]
export const EARTH_RADIUS = 6371008.8;          // Raggio medio (IUGG) [m]
export const WGS84 = Cesium.Ellipsoid.WGS84;
export const EQUATORIAL_RADIUS = WGS84.radii.x; // [m]
export const J2 = 1.08262668e-3;                // Coefficiente zonale J2 (WGS84)

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

    // Potenziale con il termine J2: -GM/r · [1 - J2·(Re/r)²·(3·sin²φ - 1)/2].
    potential(position) {
        const r = Cesium.Cartesian3.magnitude(position);
        const s = position.z / r;
        return SPHERICAL_EARTH.potential(position) *
            (1 - J2 * (EQUATORIAL_RADIUS / r) ** 2 * (3 * s * s - 1) / 2);
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
