// ============================================================
// startPoint.js — Punto di partenza della particella, figlio della
// Terra: punto della superficie WGS84 sotto la particella a t = 0, dato
// da latitudine e longitudine geodetiche (condizioni iniziali, validate
// da Particle.setStartPoint). È l'origine del nodo (position,
// coordinate ECEF).
// ============================================================

import * as Cesium from "cesium";
import { SceneNode } from "./sceneNode.js";

export class StartPoint extends SceneNode {
    latitudeDeg = 0;  // [-90°, +90°]
    longitudeDeg = 0; // [0°, 360°)

    // Porta il punto a latitudine e longitudine geodetiche [°].
    setGeographic(latitudeDeg, longitudeDeg) {
        this.latitudeDeg = latitudeDeg;
        this.longitudeDeg = longitudeDeg;
        Cesium.Cartesian3.fromDegrees(longitudeDeg, latitudeDeg, 0, Cesium.Ellipsoid.WGS84, this.position);
    }
}
