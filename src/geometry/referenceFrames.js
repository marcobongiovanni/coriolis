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

// Asse di rotazione terrestre. Per definizione dei due sistemi coincide
// con il loro asse Z comune: tutte le conversioni di questo file
// ruotano attorno a Z.
export const EARTH_ROTATION_AXIS = Cesium.Cartesian3.UNIT_Z;

// Sistemi di riferimento, nell'ordine in cui compaiono nell'interfaccia.
export const REFERENCE_SYSTEMS = ["eci", "ecef"];

// Oggetto { eci, ecef } con il valore create(system) per ogni sistema.
export function bySystem(create) {
    return Object.fromEntries(REFERENCE_SYSTEMS.map((system) => [system, create(system)]));
}

// Angolo di cui la Terra ha ruotato dopo "seconds" secondi simulati.
export function earthRotationAngle(seconds) {
    return OMEGA * seconds;
}

// Angolo da passare a eciToEcef per portare in ECEF, all'istante
// "seconds", coordinate di un oggetto fermo nel sistema "system":
// l'angolo terrestre per "eci", 0 per "ecef" (già in ECEF).
export function systemToEcefAngle(system, seconds) {
    return system === "eci" ? earthRotationAngle(seconds) : 0;
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

// Velocità di trascinamento ω × r di un punto solidale con la Terra
// in "position", con ω = (0, 0, OMEGA).
export function dragVelocity(position, result) {
    result = result || new Cesium.Cartesian3();
    result.x = -OMEGA * position.y;
    result.y = OMEGA * position.x;
    result.z = 0;
    return result;
}

const scratchDrag = new Cesium.Cartesian3();

// Velocità relativa alla Terra: v - ω × r. "result" può coincidere
// con "velocity".
export function relativeVelocity(position, velocity, result) {
    const drag = dragVelocity(position, scratchDrag);
    return Cesium.Cartesian3.subtract(velocity, drag, result || new Cesium.Cartesian3());
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

const scratchEast = new Cesium.Cartesian3();
const scratchNorth = new Cesium.Cartesian3();

// Rotazione dalla terna Est-Nord-Su alle coordinate cartesiane, data la
// verticale "up" (versore, di norma la normale locale del modello di
// Terra): le colonne sono Est, Nord, Su.
//   Est  = Z × Su (orizzontale, verso cui ruota la Terra);
//   Nord = Su × Est.
// Ai poli (Su parallelo a Z) Est non è definito: si usa la stessa
// convenzione di Cesium, Est = +Y.
export function enuRotation(up, result) {
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
export function directionEnu(azimuthDeg, elevationDeg) {
    const az = Cesium.Math.toRadians(azimuthDeg);
    const el = Cesium.Math.toRadians(elevationDeg);
    return new Cesium.Cartesian3(
        Math.cos(el) * Math.sin(az),
        Math.cos(el) * Math.cos(az),
        Math.sin(el)
    );
}
