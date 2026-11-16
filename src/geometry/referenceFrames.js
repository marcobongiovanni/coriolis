// ============================================================
// referenceFrames.js — Sistemi di riferimento ECI/ECEF e terna
// locale Est-Nord-Su (ENU).
//
// Solo funzioni pure, senza stato: le usano il modello, il
// ViewModel e la vista. Il tempo è in secondi simulati dall'inizio
// (t = 0, quando ECI ed ECEF coincidono).
// ============================================================

import * as Cesium from "cesium";

export const OMEGA = 7.292115e-5; // Velocità angolare terrestre [rad/s]
export const KMH_PER_MS = 3.6;    // Conversione m/s -> km/h

// Angolo di cui la Terra ha ruotato dopo "seconds" secondi simulati.
export function earthRotationAngle(seconds) {
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
export function eciToEcef(vector, angle, result) {
    return rotateAboutZ(vector, -angle, result);
}

// ECEF -> ECI: rotazione attorno all'asse Z di +angle.
export function ecefToEci(vector, angle, result) {
    return rotateAboutZ(vector, angle, result);
}

// Velocità relativa alla Terra, in coordinate ECI: v - ω × r,
// con ω = (0, 0, OMEGA).
export function relativeVelocity(position, velocity, result) {
    result = result || new Cesium.Cartesian3();
    result.x = velocity.x + OMEGA * position.y;
    result.y = velocity.y - OMEGA * position.x;
    result.z = velocity.z;
    return result;
}

// Angolo in gradi ricondotto all'intervallo [0°, 360°). Gli angoli già
// nell'intervallo restano identici (nessun errore di arrotondamento).
export function normalizeDegrees(deg) {
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
export function enuRotation(point, result) {
    Cesium.Transforms.eastNorthUpToFixedFrame(point, Cesium.Ellipsoid.WGS84, scratchEnuTransform);
    return Cesium.Matrix4.getMatrix3(scratchEnuTransform, result || new Cesium.Matrix3());
}

// Versore ENU di azimuth [°] (in senso orario dal Nord) ed elevazione
// [°] (sopra l'orizzonte locale).
export function directionEnu(azimuthDeg, elevationDeg) {
    const az = Cesium.Math.toRadians(azimuthDeg);
    const el = Cesium.Math.toRadians(elevationDeg);
    return new Cesium.Cartesian3(
        Math.cos(el) * Math.sin(az),
        Math.cos(el) * Math.cos(az),
        Math.sin(el)
    );
}
