// ============================================================
// enuFrame.js — Terna Est-Nord-Su con origine in un punto.
// L'asse Su è la normale locale del modello di Terra: radiale per la
// Terra sferica, geodetica per quella ellissoidale.
//
// A t = 0 i sistemi ECI ed ECEF coincidono, quindi origine e assi sono
// gli stessi in entrambi. Poi la terna:
//   "ecef": resta solidale con la Terra (ferma in ECEF);
//   "eci":  resta ferma nello spazio inerziale (ferma in ECI) e, vista
//           dalla Terra, ruota all'indietro dell'angolo di rotazione
//           terrestre.
//
// toCartesian/toLocal convertono un vettore tra componenti nella terna
// e coordinate cartesiane del sistema della terna; i metodi statici
// convertono una velocità tra componenti nella terna e
// modulo/azimuth/elevazione.
// ============================================================

import * as Cesium from "cesium";
import {
    KMH_PER_MS,
    directionEnu,
    eciToEcef,
    enuRotation,
    normalizeDegrees,
    systemToEcefAngle
} from "../geometry/referenceFrames.js";

export class EnuFrame {
    system; // "eci" o "ecef"

    // Nel sistema della terna (costanti dopo placeAt).
    origin = new Cesium.Cartesian3();
    axes = [new Cesium.Cartesian3(), new Cesium.Cartesian3(), new Cesium.Cartesian3()]; // E, N, U

    #rotation = new Cesium.Matrix3();

    constructor(system) {
        this.system = system;
    }

    // Porta l'origine in "origin" (a t = 0) e orienta gli assi verso
    // Est, Nord e Su, con Su lungo il versore "up" (la normale locale
    // del modello di Terra nel punto).
    placeAt(origin, up) {
        Cesium.Cartesian3.clone(origin, this.origin);
        enuRotation(up, this.#rotation);
        this.axes.forEach((axis, i) => Cesium.Matrix3.getColumn(this.#rotation, i, axis));
    }

    // Origine e assi in coordinate ECEF all'istante "seconds" (copie).
    inEcef(seconds) {
        const angle = systemToEcefAngle(this.system, seconds);
        return {
            origin: eciToEcef(this.origin, angle),
            axes: this.axes.map((axis) => eciToEcef(axis, angle))
        };
    }

    // Componenti E, N, U di un vettore -> coordinate cartesiane.
    toCartesian(local, result = new Cesium.Cartesian3()) {
        return Cesium.Matrix3.multiplyByVector(this.#rotation, local, result);
    }

    // Coordinate cartesiane di un vettore -> componenti E, N, U.
    toLocal(vector, result = new Cesium.Cartesian3()) {
        const [east, north, up] = this.axes;
        return Cesium.Cartesian3.fromElements(
            Cesium.Cartesian3.dot(vector, east),
            Cesium.Cartesian3.dot(vector, north),
            Cesium.Cartesian3.dot(vector, up),
            result
        );
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
