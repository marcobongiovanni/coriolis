// ============================================================
// camera.js — Telecamera: punto di vista sulla scena, fermo nel
// sistema di riferimento "system":
//   "eci":  ferma nello spazio inerziale (la Terra ruota sullo schermo);
//   "ecef": solidale con la Terra (la Terra appare immobile).
//
// La posa (posizione, direzione di vista e Up) è conservata nel sistema
// della telecamera, quindi resta costante finché l'utente non la
// sposta; inEcef() la restituisce in ECEF, il sistema in cui Cesium
// disegna la scena.
// ============================================================

import * as Cesium from "cesium";
import { ecefToEci, eciToEcef, systemToEcefAngle } from "../geometry/referenceFrames.js";
import { startPointFraming } from "./cameraFraming.js";

export class Camera {
    system; // "eci" o "ecef"

    // Posa nel sistema della telecamera; direzione e Up sono versori.
    position = new Cesium.Cartesian3();
    direction = new Cesium.Cartesian3();
    up = new Cesium.Cartesian3();

    // Diventa vero quando l'utente sposta la telecamera: da quel
    // momento l'inquadratura automatica non la tocca più.
    movedByUser = false;

    constructor(system) {
        this.system = system;
    }

    // Posa { position, direction, up } in ECEF all'istante "seconds"
    // (copie).
    inEcef(seconds) {
        const angle = systemToEcefAngle(this.system, seconds);
        return {
            position: eciToEcef(this.position, angle),
            direction: eciToEcef(this.direction, angle),
            up: eciToEcef(this.up, angle)
        };
    }

    // Imposta la posa da una posa { position, direction, up } espressa
    // in ECEF all'istante "seconds".
    setFromEcef(pose, seconds) {
        const C3 = Cesium.Cartesian3;
        const angle = systemToEcefAngle(this.system, seconds);
        ecefToEci(pose.position, angle, this.position);
        C3.normalize(ecefToEci(pose.direction, angle, this.direction), this.direction);
        C3.normalize(ecefToEci(pose.up, angle, this.up), this.up);
    }

    // Inquadratura iniziale (vedi cameraFraming.js): "target" (centro
    // della sfera della particella) visto dal punto di partenza
    // "surfacePoint". Valida a t = 0, quando ECI ed ECEF coincidono.
    frameStartPoint(surfacePoint, target, tanHalfFovWidth) {
        this.setFromEcef(startPointFraming(surfacePoint, target, tanHalfFovWidth), 0);
    }
}
