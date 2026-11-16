// ============================================================
// cameraRig.js — Telecamera fissa in ECI o solidale con la Terra
// (ECEF), comandi del mouse e pan.
//
// Modalità (mode):
//   - "eci": ferma nello spazio inerziale; la posa ECI è riapplicata a
//     ogni frame, quindi la Terra ruota sullo schermo. I movimenti fatti
//     dall'utente vengono riconosciuti e acquisiti come nuova posa ECI;
//   - "ecef": solidale con la Terra (la Terra appare immobile). La posa
//     di Cesium è già in coordinate ECEF, quindi basta non toccarla.
// Il cambio di modalità non sposta la telecamera: la vista resta
// identica e da quel momento è mantenuta nel nuovo sistema.
// ============================================================

import * as Cesium from "cesium";
import { ecefToEci, eciToEcef } from "../../geometry/referenceFrames.js";
import { startPointFraming } from "./cameraFraming.js";

// Soglie oltre le quali la posa è considerata mossa dall'utente.
const MOVED_POSITION_TOLERANCE = 0.01; // [m]
const MOVED_AXIS_TOLERANCE = 1e-8;

// Comandi predefiniti di Cesium, scritti qui per chiarezza: sono quelli
// descritti dal pannello di aiuto "?" in alto a destra. In 3D:
//   rotate (gira il globo)        trascinamento con il tasto sinistro
//   zoom                          rotellina, trascinamento destro, pinch
//   tilt (inclina verso           trascinamento centrale, Ctrl +
//   l'orizzonte)                  trascinamento sinistro o destro, pinch
//   look (ruota la telecamera     Shift + trascinamento sinistro
//   su se stessa)
// "translate" agisce solo in 2D e Columbus View.
function configureMouseControls(controller) {
    const E = Cesium.CameraEventType;
    const CTRL = Cesium.KeyboardEventModifier.CTRL;
    const SHIFT = Cesium.KeyboardEventModifier.SHIFT;

    controller.enableZoom = true;
    controller.enableRotate = true;
    controller.enableTranslate = true;
    controller.enableTilt = true;
    controller.enableLook = true;

    controller.rotateEventTypes = E.LEFT_DRAG;
    controller.zoomEventTypes = [E.RIGHT_DRAG, E.WHEEL, E.PINCH];
    controller.tiltEventTypes = [
        E.MIDDLE_DRAG,
        E.PINCH,
        { eventType: E.LEFT_DRAG, modifier: CTRL },
        { eventType: E.RIGHT_DRAG, modifier: CTRL }
    ];
    controller.lookEventTypes = { eventType: E.LEFT_DRAG, modifier: SHIFT };
    controller.translateEventTypes = E.LEFT_DRAG;
}

// Imposta direttamente posizione e assi della telecamera (in ECEF).
//
// Non si usa camera.setView: converte direzione e Up in rotta,
// inclinazione e rollio locali, rappresentazione degenere quando la
// telecamera guarda verso il centro della Terra (inclinazione -90°).
// Riapplicata a ogni frame, quella conversione alterava la direzione
// e impediva di spostare la Terra oltre quel punto con il pan.
function setCameraPose(camera, position, direction, up) {
    const C3 = Cesium.Cartesian3;
    if (!Cesium.Matrix4.equals(camera.transform, Cesium.Matrix4.IDENTITY)) {
        camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    }
    C3.clone(position, camera.position);
    C3.normalize(direction, camera.direction);
    // Terna ortonormale: Destra = Direzione × Up, poi Up ricalcolato.
    C3.normalize(C3.cross(camera.direction, up, camera.right), camera.right);
    C3.cross(camera.right, camera.direction, camera.up);
}

export class CameraRig {
    // Diventa vero al primo movimento della telecamera fatto dall'utente.
    movedByUser = false;

    #viewer;
    #camera;
    #mode = "eci";
    #earthAngle = 0;
    // Posa da mantenere ferma in ECI.
    #inertialPose = {
        position: new Cesium.Cartesian3(),
        direction: new Cesium.Cartesian3(),
        up: new Cesium.Cartesian3()
    };
    // Ultima posa (ECEF) impostata da qui, per riconoscere i movimenti
    // dell'utente.
    #appliedPose;
    // Profondità del punto afferrato con il pan [m]; undefined = nessun pan.
    #panDepth;

    constructor(viewer) {
        this.#viewer = viewer;
        this.#camera = viewer.camera;
        configureMouseControls(viewer.scene.screenSpaceCameraController);
        this.#installPan();
    }

    setMode(mode) {
        if (mode === "eci" && this.#mode !== "eci") {
            // La posa attuale diventa quella da mantenere ferma in ECI.
            this.#captureInertialPose();
        }
        this.#mode = mode;
    }

    // Inquadratura iniziale: particella in "target" vista dal punto di
    // partenza "surfacePoint". Da chiamare a t = 0 (ECI = ECEF).
    frameStartPoint(surfacePoint, target) {
        const pose = startPointFraming(surfacePoint, target, this.#tanHalfFovWidth());
        Cesium.Cartesian3.clone(pose.position, this.#inertialPose.position);
        Cesium.Cartesian3.clone(pose.direction, this.#inertialPose.direction);
        Cesium.Cartesian3.clone(pose.up, this.#inertialPose.up);
        if (this.#mode === "eci") {
            this.#applyInertialPose();
        }
    }

    // A ogni frame, con l'angolo terrestre del frame.
    update(earthAngle) {
        // Un movimento dell'utente è acquisito con l'angolo del frame
        // precedente, quello con cui era stata impostata la posa.
        if (this.#mode === "eci" && this.#poseChanged()) {
            this.#captureInertialPose();
            this.movedByUser = true;
        }
        this.#earthAngle = earthAngle;
        if (this.#mode === "eci") {
            this.#applyInertialPose();
        }
    }

    // --------------------------------------------------
    // POSA INERZIALE
    // --------------------------------------------------

    // Tangente del semiangolo del campo visivo lungo la larghezza (in
    // Cesium "fov" vale per il lato più lungo della vista).
    #tanHalfFovWidth() {
        const container = this.#viewer.container;
        const width = container.clientWidth || 1;
        const height = container.clientHeight || 1;
        return Math.tan(this.#camera.frustum.fov / 2) * width / Math.max(width, height);
    }

    #rememberAppliedPose() {
        const camera = this.#camera;
        this.#appliedPose = {
            position: Cesium.Cartesian3.clone(camera.positionWC),
            direction: Cesium.Cartesian3.clone(camera.directionWC),
            up: Cesium.Cartesian3.clone(camera.upWC)
        };
    }

    #poseChanged() {
        const camera = this.#camera;
        const applied = this.#appliedPose;
        const distance = Cesium.Cartesian3.distance;
        return !applied ||
            distance(camera.positionWC, applied.position) > MOVED_POSITION_TOLERANCE ||
            distance(camera.directionWC, applied.direction) > MOVED_AXIS_TOLERANCE ||
            distance(camera.upWC, applied.up) > MOVED_AXIS_TOLERANCE;
    }

    #captureInertialPose() {
        const camera = this.#camera;
        const pose = this.#inertialPose;
        const angle = this.#earthAngle;
        ecefToEci(camera.positionWC, angle, pose.position);
        Cesium.Cartesian3.normalize(ecefToEci(camera.directionWC, angle, pose.direction), pose.direction);
        Cesium.Cartesian3.normalize(ecefToEci(camera.upWC, angle, pose.up), pose.up);
        this.#rememberAppliedPose();
    }

    #applyInertialPose() {
        const pose = this.#inertialPose;
        const angle = this.#earthAngle;
        setCameraPose(
            this.#camera,
            eciToEcef(pose.position, angle),
            eciToEcef(pose.direction, angle),
            eciToEcef(pose.up, angle)
        );
        this.#rememberAppliedPose();
    }

    // --------------------------------------------------
    // PAN: SHIFT + TRASCINAMENTO CON IL TASTO DESTRO
    // --------------------------------------------------
    //
    // In 3D Cesium non ha uno spostamento laterale vero: il "Pan view" del
    // pannello di aiuto fa ruotare il globo. Questo gesto trasla invece la
    // telecamera parallelamente allo schermo, senza cambiarne
    // l'orientamento.
    //
    // Il punto della Terra sotto il cursore all'inizio del trascinamento
    // segue il cursore: un pixel vale 2·p·tan(fovy/2) / altezza della
    // vista, dove p è la profondità di quel punto lungo la direzione di
    // vista (del centro della Terra se il cursore è nello spazio).
    //
    // Con la telecamera ECI lo spostamento viene acquisito come movimento
    // dell'utente; con quella ECEF resta solidale con la Terra.

    #installPan() {
        const scene = this.#viewer.scene;
        const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
        const SHIFT = Cesium.KeyboardEventModifier.SHIFT;
        const T = Cesium.ScreenSpaceEventType;
        const endPan = () => {
            this.#panDepth = undefined;
        };

        handler.setInputAction((click) => {
            this.#panDepth = this.#depthAt(click.position);
        }, T.RIGHT_DOWN, SHIFT);

        handler.setInputAction((movement) => {
            if (this.#panDepth === undefined) {
                return;
            }
            const camera = this.#camera;
            const height = scene.canvas.clientHeight || 1;
            const metersPerPixel = 2 * this.#panDepth * Math.tan(camera.frustum.fovy / 2) / height;
            // La scena segue il cursore: la telecamera si sposta al contrario.
            camera.moveLeft((movement.endPosition.x - movement.startPosition.x) * metersPerPixel);
            camera.moveUp((movement.endPosition.y - movement.startPosition.y) * metersPerPixel);
        }, T.MOUSE_MOVE, SHIFT);

        // Fine del pan al rilascio del tasto, con o senza Shift premuto.
        handler.setInputAction(endPan, T.RIGHT_UP);
        handler.setInputAction(endPan, T.RIGHT_UP, SHIFT);
    }

    #depthAt(windowPosition) {
        const camera = this.#camera;
        const picked = camera.pickEllipsoid(windowPosition, Cesium.Ellipsoid.WGS84);
        const target = Cesium.defined(picked) ? picked : Cesium.Cartesian3.ZERO;
        const offset = Cesium.Cartesian3.subtract(target, camera.positionWC, new Cesium.Cartesian3());
        return Math.max(Cesium.Cartesian3.dot(offset, camera.directionWC), 1);
    }
}
