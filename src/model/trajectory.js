// ============================================================
// trajectory.js — Traiettoria del centro della sfera di una particella.
//
// È un nodo della scena: sequenza delle posizioni registrate a ogni
// istante raggiunto dalla simulazione, nelle coordinate del nodo, che
// coincidono con quelle del padre:
//   figlia di World (traiettoria assoluta): ferma nello spazio inerziale;
//   figlia della Terra (traiettoria relativa): solidale con la Terra.
// ============================================================

import * as Cesium from "cesium";
import { SceneNode } from "./sceneNode.js";

export const TRAJECTORY_MIN_DISTANCE = 10; // [m] evita vertici coincidenti

export class Trajectory extends SceneNode {
    // Posizioni registrate (Cartesian3, nelle coordinate del nodo), in
    // ordine di tempo.
    points = [];

    // Cresce a ogni clear(): chi disegna la traiettoria capisce che
    // deve ricominciare anche se nel frattempo sono stati aggiunti
    // nuovi punti.
    revision = 0;

    // Aggiunge una copia di "position" (coordinate del nodo), se dista
    // almeno TRAJECTORY_MIN_DISTANCE dall'ultimo punto.
    addPoint(position) {
        const last = this.points[this.points.length - 1];
        if (last && Cesium.Cartesian3.distance(last, position) < TRAJECTORY_MIN_DISTANCE) {
            return;
        }
        this.points.push(Cesium.Cartesian3.clone(position));
    }

    // Svuota la traiettoria.
    clear() {
        this.points = [];
        this.revision++;
    }
}
