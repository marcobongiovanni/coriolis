// ============================================================
// trajectory.js — Traiettoria del centro di una particella.
//
// Sequenza delle posizioni registrate a ogni istante raggiunto dalla
// simulazione, nel sistema di riferimento della traiettoria:
//   "eci":  ferma nello spazio inerziale;
//   "ecef": solidale con la Terra.
// ============================================================

import * as Cesium from "cesium";

export const TRAJECTORY_MIN_DISTANCE = 10; // [m] evita vertici coincidenti

export class Trajectory {
    system; // "eci" o "ecef"

    // Posizioni registrate (Cartesian3), in ordine di tempo.
    points = [];

    // Cresce a ogni clear(): chi disegna la traiettoria capisce che
    // deve ricominciare anche se nel frattempo sono stati aggiunti
    // nuovi punti.
    revision = 0;

    constructor(system) {
        this.system = system;
    }

    // Aggiunge una copia di "position", se dista almeno
    // TRAJECTORY_MIN_DISTANCE dall'ultimo punto.
    addPoint(position) {
        const last = this.points[this.points.length - 1];
        if (last && Cesium.Cartesian3.distance(last, position) < TRAJECTORY_MIN_DISTANCE) {
            return;
        }
        this.points.push(Cesium.Cartesian3.clone(position));
    }

    clear() {
        this.points = [];
        this.revision++;
    }
}
