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

import * as Cesium from "cesium";
import {
    KMH_PER_MS,
    directionEnu,
    enuRotation,
    normalizeDegrees
} from "../geometry/referenceFrames.js";
import { SceneNode } from "./sceneNode.js";

export class EnuFrame extends SceneNode {
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
