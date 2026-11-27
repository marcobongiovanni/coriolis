// ============================================================
// camera.js — Telecamera: punto di vista sulla scena.
//
// È un nodo della scena il cui sistema è quello della telecamera:
//   origine  posizione della telecamera;
//   asse X   direzione di vista;
//   asse Y   Up;
//   asse Z   destra (X × Y).
// La posa è costante nel sistema del padre:
//   figlia di World (Telecamera ECI): ferma nello spazio inerziale (la
//     Terra ruota sullo schermo);
//   figlia della Terra (Telecamera ECEF): solidale con la Terra (la
//     Terra appare immobile).
// expressedIn() la restituisce nelle coordinate di un altro nodo (per
// esempio la Terra, il sistema in cui Cesium disegna).
// ============================================================

import * as Cesium from "cesium";
import { startPositionFraming } from "./cameraFraming.js";
import { SceneNode } from "./sceneNode.js";

export class Camera extends SceneNode {
    // Diventa vero quando l'utente sposta la telecamera: da quel
    // momento l'inquadratura automatica non la tocca più.
    movedByUser = false;

    // Direzione di vista nel sistema del padre (versore, copia).
    get direction() {
        return this.axes[0];
    }

    // Up nel sistema del padre (versore, copia).
    get up() {
        return this.axes[1];
    }

    // Posa { position, direction, up } nelle coordinate del nodo "node"
    // all'istante "seconds" (copie).
    expressedIn(node, seconds) {
        const { position, axes: [direction, up] } = this.poseIn(node, seconds);
        return { position: position, direction: direction, up: up };
    }

    // Imposta la posa da una posa { position, direction, up } espressa
    // nelle coordinate del nodo "node" all'istante "seconds". Up viene
    // reso ortogonale alla direzione.
    setFrom(node, pose, seconds) {
        const C3 = Cesium.Cartesian3;
        const direction = C3.normalize(pose.direction, new C3());
        const right = C3.normalize(C3.cross(direction, pose.up, new C3()), new C3());
        const up = C3.cross(right, direction, new C3());
        this.setPoseFrom(node, pose.position, [direction, up, right], seconds);
    }

    // Inquadratura iniziale (vedi cameraFraming.js): l'origine della
    // terna locale "frame" (centro della sfera della particella) vista
    // da una direzione fissa nella terna, a t = 0.
    frameStartPosition(frame, tanHalfFovWidth) {
        this.setFrom(frame.parent, startPositionFraming(frame, tanHalfFovWidth), 0);
    }
}
