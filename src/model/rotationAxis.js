// ============================================================
// rotationAxis.js — Asse di rotazione terrestre, figlio di World.
//
// Unica definizione della rotazione terrestre: la Terra ruota attorno
// a questo asse (vedi Earth); velocità di trascinamento, velocità
// relativa e accelerazione di Coriolis si calcolano da qui. La direzione è l'asse Z del nodo (posa identità: asse Z di
// World, verso il Polo Nord).
// ============================================================

import * as Cesium from "cesium";
import { coriolisAcceleration, dragVelocity, relativeVelocity } from "../geometry/referenceFrames.js";
import { SceneNode } from "./sceneNode.js";

export const OMEGA = 7.292115e-5; // Velocità angolare terrestre [rad/s]

export class RotationAxis extends SceneNode {
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
