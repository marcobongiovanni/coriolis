// ============================================================
// cameraRig.js — Presentazione delle telecamere del modello sulla
// telecamera di Cesium, comandi del mouse, pan e zoom con la rotella
// verso il punto sotto il mouse.
//
// La posa da mostrare arriva dal ViewModel (telecamera attiva, in
// ECEF) ed è applicata a ogni frame con apply(). Tra un frame e il
// successivo l'utente può muovere la telecamera di Cesium con il mouse:
// takeUserMove() riconosce lo spostamento e lo restituisce, così che il
// ViewModel lo registri nella telecamera del modello che era mostrata.
// ============================================================

import * as Cesium from "cesium";

// Soglie oltre le quali la posa è considerata mossa dall'utente.
const MOVED_POSITION_TOLERANCE = 0.01; // [m]
const MOVED_AXIS_TOLERANCE = 1e-8;

// Zoom con la rotella: a ogni scatto (delta 100) la distanza dal punto
// sotto il mouse diventa WHEEL_ZOOM_RATIO volte quella di prima.
const WHEEL_ZOOM_RATIO = 0.8;
const WHEEL_STEP_DELTA = 100;

// Comandi predefiniti di Cesium, scritti qui per chiarezza: sono quelli
// descritti dal pannello di aiuto "?" in alto a destra. In 3D:
//   rotate (gira il globo)        trascinamento con il tasto sinistro
//   zoom                          trascinamento destro, pinch
//   tilt (inclina verso           trascinamento centrale, Ctrl +
//   l'orizzonte)                  trascinamento sinistro o destro, pinch
//   look (ruota la telecamera     Shift + trascinamento sinistro
//   su se stessa)
// "translate" agisce solo in 2D e Columbus View. La rotella non è
// gestita da Cesium ma da CameraRig (zoom verso il punto sotto il mouse).
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
    controller.zoomEventTypes = [E.RIGHT_DRAG, E.PINCH];
    controller.tiltEventTypes = [
        E.MIDDLE_DRAG,
        E.PINCH,
        { eventType: E.LEFT_DRAG, modifier: CTRL },
        { eventType: E.RIGHT_DRAG, modifier: CTRL }
    ];
    controller.lookEventTypes = { eventType: E.LEFT_DRAG, modifier: SHIFT };
    controller.translateEventTypes = E.LEFT_DRAG;
}

// Fa ignorare a "camera" le rotazioni attorno a un asse nullo.
//
// Difetto di Cesium: nello zoom verso il punto sotto il mouse
// (trascinamento destro o rotella), se il mouse è esattamente al
// centro della vista il punto al centro e quello sotto il mouse
// coincidono. Per arrotondamento il loro prodotto scalare può valere
// 0,9999999999999999 (< 1) mentre il prodotto vettoriale, usato come
// asse, è nullo: Camera.rotate lo normalizza, lancia una DeveloperError
// e Cesium ferma il rendering. Una rotazione attorno a un asse nullo
// non sposta nulla, quindi ignorarla non cambia il comportamento.
function ignoreZeroAxisRotations(camera) {
    const rotate = camera.rotate.bind(camera);
    camera.rotate = (axis, angle) => {
        if (Cesium.Cartesian3.magnitudeSquared(axis) > 0) {
            rotate(axis, angle);
        }
    };
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
    // Pan e zoom con la rotella spostano la telecamera di Cesium come
    // i comandi predefiniti: lo spostamento è riconosciuto da
    // takeUserMove() e registrato nella telecamera del modello mostrata.

    #viewer;
    #camera;
    #handler; // Eventi del mouse sul canvas (pan e rotella)
    // Ultima posa applicata: { system, seconds, pose } con la posa ECEF
    // effettiva di Cesium, per riconoscere gli spostamenti dell'utente.
    #applied;
    // Profondità del punto afferrato con il pan [m]; undefined = nessun pan.
    #panDepth;

    // Configura i comandi del mouse, il pan e lo zoom con la rotella
    // sulla telecamera di "viewer".
    constructor(viewer) {
        this.#viewer = viewer;
        this.#camera = viewer.camera;
        this.#handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        ignoreZeroAxisRotations(viewer.camera);
        configureMouseControls(viewer.scene.screenSpaceCameraController);
        this.#installPan();
        this.#installWheelZoom();
    }

    // Tangente del semiangolo del campo visivo lungo la larghezza della
    // vista (in Cesium "fov" vale per il lato più lungo).
    get tanHalfFovWidth() {
        const container = this.#viewer.container;
        const width = container.clientWidth || 1;
        const height = container.clientHeight || 1;
        return Math.tan(this.#camera.frustum.fov / 2) * width / Math.max(width, height);
    }

    // Mostra la posa "pose" (ECEF) della telecamera "system" del modello
    // all'istante "seconds".
    apply(system, seconds, pose) {
        setCameraPose(this.#camera, pose.position, pose.direction, pose.up);
        this.#applied = { system: system, seconds: seconds, pose: this.#currentPose() };
    }

    // Se l'utente ha spostato la telecamera dopo l'ultimo apply(),
    // restituisce { system, seconds, pose }: la telecamera del modello
    // che era mostrata, l'istante in cui era stata applicata e la nuova
    // posa ECEF. Altrimenti undefined.
    takeUserMove() {
        const applied = this.#applied;
        if (!applied || !this.#poseChanged(applied.pose)) {
            return undefined;
        }
        const pose = this.#currentPose();
        this.#applied = { ...applied, pose: pose };
        return { system: applied.system, seconds: applied.seconds, pose: pose };
    }

    // Posa attuale della telecamera di Cesium, in ECEF (copie).
    #currentPose() {
        const camera = this.#camera;
        return {
            position: Cesium.Cartesian3.clone(camera.positionWC),
            direction: Cesium.Cartesian3.clone(camera.directionWC),
            up: Cesium.Cartesian3.clone(camera.upWC)
        };
    }

    // Vero se la telecamera di Cesium non è più nella posa "pose".
    #poseChanged(pose) {
        const camera = this.#camera;
        const distance = Cesium.Cartesian3.distance;
        return distance(camera.positionWC, pose.position) > MOVED_POSITION_TOLERANCE ||
            distance(camera.directionWC, pose.direction) > MOVED_AXIS_TOLERANCE ||
            distance(camera.upWC, pose.up) > MOVED_AXIS_TOLERANCE;
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

    // Registra i gestori di inizio, movimento e fine del pan.
    #installPan() {
        const scene = this.#viewer.scene;
        const handler = this.#handler;
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

    // Profondità [m], lungo la direzione di vista, del punto della Terra
    // sotto "windowPosition" (del centro della Terra se il cursore è
    // nello spazio); almeno 1 m.
    #depthAt(windowPosition) {
        return this.#distanceAlong(this.#camera.directionWC, this.#targetAt(windowPosition));
    }

    // Punto della Terra (ellissoide WGS84) sotto "windowPosition", o il
    // centro della Terra se il cursore è nello spazio.
    #targetAt(windowPosition) {
        const picked = this.#camera.pickEllipsoid(windowPosition, Cesium.Ellipsoid.WGS84);
        return Cesium.defined(picked) ? picked : Cesium.Cartesian3.ZERO;
    }

    // Distanza [m] di "target" dalla telecamera lungo il versore
    // "direction"; almeno 1 m.
    #distanceAlong(direction, target) {
        const offset = Cesium.Cartesian3.subtract(target, this.#camera.positionWC, new Cesium.Cartesian3());
        return Math.max(Cesium.Cartesian3.dot(offset, direction), 1);
    }

    // --------------------------------------------------
    // ZOOM CON LA ROTELLA VERSO IL PUNTO SOTTO IL MOUSE
    // --------------------------------------------------
    //
    // La telecamera si sposta lungo il raggio che passa per il mouse,
    // senza cambiare orientamento: il punto sotto il mouse resta sotto il
    // mouse. La distanza da quel punto (della Terra, o il punto del raggio
    // più vicino al centro della Terra se il mouse è nello spazio) è
    // moltiplicata per WHEEL_ZOOM_RATIO a ogni scatto in avanti e divisa
    // a ogni scatto indietro: avvicinandosi, la telecamera non raggiunge
    // mai la superficie.

    // Registra la posizione del mouse e il gestore della rotella
    // (l'evento di Cesium fornisce solo l'entità dello scatto).
    #installWheelZoom() {
        const canvas = this.#viewer.scene.canvas;
        let cursor;
        canvas.addEventListener("pointermove", (event) => {
            const rect = canvas.getBoundingClientRect();
            cursor = new Cesium.Cartesian2(event.clientX - rect.left, event.clientY - rect.top);
        });
        this.#handler.setInputAction((delta) => {
            const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
            this.#zoomTowards(cursor ?? center, delta);
        }, Cesium.ScreenSpaceEventType.WHEEL);
    }

    // Avvicina (delta > 0) o allontana (delta < 0) la telecamera dal punto
    // sotto "windowPosition".
    #zoomTowards(windowPosition, delta) {
        const camera = this.#camera;
        const ray = camera.getPickRay(windowPosition);
        if (!Cesium.defined(ray)) {
            return;
        }
        const distance = this.#distanceAlong(ray.direction, this.#targetAt(windowPosition));
        const newDistance = distance * Math.pow(WHEEL_ZOOM_RATIO, delta / WHEEL_STEP_DELTA);
        camera.move(ray.direction, distance - newDistance);
    }
}
