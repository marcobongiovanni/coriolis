// ============================================================
// cameraFraming.js — Inquadratura iniziale: particella vista da
// sud-sud-est con la Terra intera nella vista.
//
// Funzioni pure, usate da Camera: della vista serve solo la tangente
// del semiangolo del campo visivo lungo la larghezza.
//
// La telecamera guarda il centro della sfera della particella da una
// direzione fissa nella terna locale Est-Nord-Su della posizione di partenza
// (EnuFrame della particella):
//   - azimuth CAMERA_AZIMUTH_DEG, in senso orario dal Nord;
//   - elevazione CAMERA_ELEVATION_DEG sopra l'orizzonte locale.
// Il vettore Up sta nel piano formato dalla direzione di vista e dalla
// normale alla superficie (nessun rollio): la verticale locale appare
// verticale sullo schermo.
//
// La distanza è quella per cui il disco terrestre occupa la frazione
// EARTH_WIDTH_FRACTION della larghezza della vista.
// ============================================================

import * as Cesium from "cesium";
import { directionEnu } from "../geometry/referenceFrames.js";

const CAMERA_AZIMUTH_DEG = 150;    // Dal Nord, in senso orario [°]
const CAMERA_ELEVATION_DEG = 45;   // Sopra l'orizzonte locale [°]
const EARTH_WIDTH_FRACTION = 0.95; // Larghezza della Terra / larghezza della vista

// Frazione della larghezza della vista occupata dal diametro del disco
// terrestre, visto da "position" lungo "direction" con il vettore "up"
// (Infinity se la telecamera è troppo vicina).
//
// I bordi del disco sono dati dai due piani tangenti alla Terra che
// contengono la retta per la telecamera parallela a Up: nel piano
// (Destra, direzione) il centro della Terra sta all'angolo
// a = atan2(x, z) e i piani tangenti a a ± asin(R / distanza).
function earthWidthFraction(position, direction, up, tanHalfFovWidth) {
    const C3 = Cesium.Cartesian3;
    const right = C3.cross(direction, up, new C3());
    const toCenter = C3.negate(position, new C3());
    const x = C3.dot(toCenter, right);
    const z = C3.dot(toCenter, direction);
    const distance = Math.hypot(x, z);
    const radius = Cesium.Ellipsoid.WGS84.maximumRadius;
    if (distance <= radius) {
        return Infinity;
    }
    const a = Math.atan2(x, z);
    const b = Math.asin(radius / distance);
    if (a + b >= Math.PI / 2 || a - b <= -Math.PI / 2) {
        return Infinity;
    }
    return (Math.tan(a + b) - Math.tan(a - b)) / (2 * tanHalfFovWidth);
}

// Punto della semiretta target + d·offset (offset versore) alla distanza
// d a cui la Terra occupa EARTH_WIDTH_FRACTION della larghezza
// (bisezione: allontanandosi la Terra rimpicciolisce).
function positionForEarthWidth(target, offset, direction, up, tanHalfFovWidth) {
    const candidate = new Cesium.Cartesian3();
    // Posizione della telecamera a "distance" da target.
    function cameraAt(distance, result) {
        Cesium.Cartesian3.multiplyByScalar(offset, distance, result);
        return Cesium.Cartesian3.add(target, result, result);
    }
    // Vero se a "distance" la Terra occupa più della frazione voluta.
    function tooLarge(distance) {
        const fraction = earthWidthFraction(cameraAt(distance, candidate), direction, up, tanHalfFovWidth);
        return fraction > EARTH_WIDTH_FRACTION;
    }

    let near = 0;
    let far = 1.0e7;
    while (tooLarge(far)) {
        far *= 2;
    }
    for (let i = 0; i < 50; i++) {
        const mid = 0.5 * (near + far);
        if (tooLarge(mid)) {
            near = mid;
        } else {
            far = mid;
        }
    }
    return cameraAt(far, new Cesium.Cartesian3());
}

// Posa { position, direction, up } che inquadra l'origine della terna
// locale "frame" (EnuFrame con origine nel centro della sfera della
// particella e asse Su lungo la normale locale), nel sistema del padre
// della terna (World o Terra, con origine nel centro della Terra).
export function startPositionFraming(frame, tanHalfFovWidth) {
    const C3 = Cesium.Cartesian3;
    const target = frame.position;
    const normal = frame.axes[2];

    // Versore dalla particella verso la telecamera.
    const offset = frame.toCartesian(directionEnu(CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG));
    C3.normalize(offset, offset);
    const direction = C3.negate(offset, new C3());

    // Up: componente della normale ortogonale alla direzione di vista.
    const up = C3.subtract(
        normal,
        C3.multiplyByScalar(direction, C3.dot(normal, direction), new C3()),
        new C3()
    );
    C3.normalize(up, up);

    return {
        position: positionForEarthWidth(target, offset, direction, up, tanHalfFovWidth),
        direction: direction,
        up: up
    };
}
