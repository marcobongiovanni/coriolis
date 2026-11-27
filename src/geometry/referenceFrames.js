// ============================================================
// referenceFrames.js — Sistemi di riferimento e terna locale
// Est-Nord-Su (ENU).
//
// Solo funzioni pure, senza stato: le usano il modello, il
// ViewModel e la vista. Le trasformazioni tra i sistemi ECI ed ECEF e
// la rotazione terrestre sono nel modello (SceneNode, Earth,
// RotationAxis).
// ============================================================

import * as Cesium from "cesium";

export const KMH_PER_MS = 3.6; // Conversione m/s -> km/h

// Asse Z comune ai sistemi ECI ed ECEF (verso il Polo Nord): l'asse
// attorno al quale ruota la Terra. Definisce l'Est della terna locale.
const EARTH_ROTATION_AXIS = Cesium.Cartesian3.UNIT_Z;

// Sistemi di riferimento, nell'ordine in cui compaiono nell'interfaccia.
export const REFERENCE_SYSTEMS = ["eci", "ecef"];

// Oggetto { eci, ecef } con il valore create(system) per ogni sistema.
export function bySystem(create) {
    return Object.fromEntries(REFERENCE_SYSTEMS.map((system) => [system, create(system)]));
}

// Velocità di trascinamento ω × r di un punto in "position", solidale
// con un sistema che ruota con velocità angolare "omega" (vettore).
export function dragVelocity(omega, position, result = new Cesium.Cartesian3()) {
    return Cesium.Cartesian3.cross(omega, position, result);
}

const scratchDrag = new Cesium.Cartesian3();

// Velocità relativa al sistema rotante: v - ω × r. "result" può
// coincidere con "velocity".
export function relativeVelocity(omega, position, velocity, result = new Cesium.Cartesian3()) {
    const drag = dragVelocity(omega, position, scratchDrag);
    return Cesium.Cartesian3.subtract(velocity, drag, result);
}

const scratchAlongNormal = new Cesium.Cartesian3();

// Componente di "vector" perpendicolare al versore "normal", cioè la
// sua proiezione sul piano tangente: vector - (vector · normal) normal.
// "result" può coincidere con "vector".
export function tangentialComponent(vector, normal, result = new Cesium.Cartesian3()) {
    const along = Cesium.Cartesian3.dot(vector, normal);
    return Cesium.Cartesian3.subtract(
        vector, Cesium.Cartesian3.multiplyByScalar(normal, along, scratchAlongNormal), result
    );
}

// Accelerazione di Coriolis -2 ω × v_rel di un punto con velocità
// "relativeVelocity" rispetto al sistema rotante. "result" può
// coincidere con "relativeVelocity".
export function coriolisAcceleration(omega, relativeVelocity, result = new Cesium.Cartesian3()) {
    Cesium.Cartesian3.cross(omega, relativeVelocity, result);
    return Cesium.Cartesian3.multiplyByScalar(result, -2, result);
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
