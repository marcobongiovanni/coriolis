// ============================================================
// sceneView.js — Scena 3D di Cesium.
//
// Solo presentazione: disegna ciò che il ViewModel fornisce (stato di
// ogni istante e posa della telecamera attiva, già in coordinate ECEF)
// e inoltra al ViewModel il punto scelto sul globo e gli spostamenti
// della telecamera fatti dall'utente.
//
// Orologio di Cesium come unica sorgente del tempo: le entità sono
// aggiornate da Cesium con il "time" del frame (CallbackProperty) e
// telecamera, tracce e terne in preRender con lo stesso "time".
// ViewModel.frameAt() è idempotente, quindi nello stesso frame tutti
// usano lo stesso stato.
// ============================================================

import * as Cesium from "cesium";
import { REFERENCE_SYSTEMS, bySystem } from "../../geometry/referenceFrames.js";
import { PALETTE } from "../palette.js";
import { CameraRig } from "./cameraRig.js";
import { TrackLayer } from "./trackLayer.js";

// Frecce della velocità istantanea: partono dalla superficie della
// particella; la lunghezza è lo spazio percorso in VELOCITY_ARROW_SECONDS
// a velocità costante (es. 1 km/s -> 600 km).
const VELOCITY_ARROW_SECONDS = 600; // [s]
const VELOCITY_ARROW_WIDTH = 12;    // [px] (serve per la punta)
const VELOCITY_ARROW_MIN_SPEED = 1; // [m/s] sotto: freccia nascosta

// Asse di rotazione: solo i due tratti esterni, dalla superficie di
// ciascun polo verso lo spazio (nulla traspare attraverso il globo).
const AXIS_HALF_LENGTH = 9000000; // [m] dal centro della Terra
const AXIS_WIDTH = 1.5;           // [px]

// Terne di riferimento: assi lunghi sempre FRAME_AXIS_PIXELS a schermo.
const FRAME_AXIS_PIXELS = 70; // [px]
const FRAME_LINE_WIDTH = 3;   // [px]

// Nomi delle frecce della velocità (mostrati da Cesium alla selezione).
const VELOCITY_ARROW_NAMES = {
    eci: "Velocità assoluta (ECI)",
    ecef: "Velocità relativa (ECEF)"
};

// Colore di Cesium dal nome CSS.
function color(cssName) {
    return Cesium.Color.fromCssColorString(cssName);
}

export class SceneView {
    #viewer;
    #vm;
    #camera;
    #arrows;
    #tracks;
    #framePolylines;
    #startMarker;
    #markerPoint;
    #scratchPixelSphere = new Cesium.BoundingSphere();
    #scratchRotation3 = new Cesium.Matrix3();
    #scratchRotation4 = new Cesium.Matrix4();

    constructor(viewer, viewModel) {
        this.#viewer = viewer;
        this.#vm = viewModel;
        this.#camera = new CameraRig(viewer);

        this.#addParticle();
        this.#arrows = bySystem((system) => this.#addVelocityArrow(system));
        this.#tracks = bySystem((system) => new TrackLayer(viewer.scene.primitives, color(PALETTE[system])));
        this.#addRotationAxis();
        this.#startMarker = this.#addStartMarker();
        this.#framePolylines = this.#addReferenceFrames();
        this.#installPicking();

        viewModel.on("change", () => this.#render());
        // Il ViewModel inquadra solo le telecamere non spostate dall'utente.
        viewModel.on("startPointLocated", () => this.#frameStartPoint());
        viewer.scene.preRender.addEventListener((scene, time) => this.#update(time));

        this.#frameStartPoint();
        this.#render();
    }

    // Oggetti della scena per i test end-to-end.
    get testObjects() {
        return {
            arrows: { absolute: this.#arrows.eci, relative: this.#arrows.ecef },
            frames: this.#framePolylines
        };
    }

    // --------------------------------------------------
    // AGGIORNAMENTO
    // --------------------------------------------------

    // Secondi simulati all'istante "time" dell'orologio di Cesium
    // (dell'istante corrente se non indicato).
    #secondsAt(time = this.#viewer.clock.currentTime) {
        return Cesium.JulianDate.secondsDifference(time, this.#viewer.clock.startTime);
    }

    // Stato del ViewModel all'istante "time" dell'orologio di Cesium.
    #frameAt(time) {
        return this.#vm.frameAt(this.#secondsAt(time));
    }

    // Inquadratura iniziale sul punto di partenza, mostrata subito.
    #frameStartPoint() {
        this.#vm.frameStartPoint(this.#camera.tanHalfFovWidth);
        this.#showCamera(this.#secondsAt());
    }

    // Registra nel modello l'eventuale spostamento della telecamera fatto
    // dall'utente, poi mostra la posa della telecamera attiva
    // all'istante "seconds".
    #showCamera(seconds) {
        const vm = this.#vm;
        const move = this.#camera.takeUserMove();
        if (move) {
            vm.moveCamera(move.system, move.pose, move.seconds);
        }
        this.#camera.apply(vm.cameraMode, seconds, vm.cameraPose(seconds));
    }

    // Stato del ViewModel che non dipende dal tempo.
    #render() {
        const vm = this.#vm;
        REFERENCE_SYSTEMS.forEach((system) => {
            this.#arrows[system].show = vm.visibility.velocity[system];
            this.#tracks[system].show = vm.visibility.track[system];
            this.#framePolylines[system].forEach((polyline) => {
                polyline.show = vm.visibility.frame[system];
            });
        });

        if (!Cesium.Cartesian3.equals(this.#markerPoint, vm.startSurfacePoint)) {
            this.#markerPoint = Cesium.Cartesian3.clone(vm.startSurfacePoint);
            this.#startMarker.position = this.#markerPoint;
        }

        this.#viewer.canvas.style.cursor = vm.pickMode ? "crosshair" : "";
        // Subito, senza attendere il frame: la telecamera attiva può
        // essere cambiata.
        this.#showCamera(this.#secondsAt());
    }

    // A ogni frame, prima del rendering.
    #update(time) {
        const frame = this.#frameAt(time);
        this.#showCamera(frame.seconds);
        this.#updateTracks(frame);
        // Dopo la telecamera: la dimensione a schermo usa la sua posa.
        this.#updateReferenceFrames(frame);
    }

    // --------------------------------------------------
    // PARTICELLA E FRECCE DELLA VELOCITÀ
    // --------------------------------------------------

    #addParticle() {
        const r = this.#vm.particleRadius;
        this.#viewer.entities.add({
            name: "Particella",
            position: new Cesium.CallbackProperty((time, result) => {
                return Cesium.Cartesian3.clone(this.#frameAt(time).sphereCenterEcef, result);
            }, false),
            ellipsoid: {
                radii: new Cesium.Cartesian3(r, r, r),
                material: color(PALETTE.particle).withAlpha(0.85)
            }
        });
    }

    // Freccia della velocità assoluta ("eci") o relativa ("ecef"),
    // aggiornata da Cesium a ogni frame.
    #addVelocityArrow(system) {
        const velocityAt = (time) => this.#frameAt(time).velocities[system];
        const positions = (time) => {
            const { origin: center, vector: velocity } = velocityAt(time);
            const speed = Cesium.Cartesian3.magnitude(velocity);
            if (speed < VELOCITY_ARROW_MIN_SPEED) {
                return [Cesium.Cartesian3.clone(center), Cesium.Cartesian3.clone(center)];
            }
            const direction = Cesium.Cartesian3.normalize(velocity, new Cesium.Cartesian3());
            const along = (origin, length) => Cesium.Cartesian3.add(
                origin,
                Cesium.Cartesian3.multiplyByScalar(direction, length, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
            const tail = along(center, this.#vm.particleRadius);
            return [tail, along(tail, speed * VELOCITY_ARROW_SECONDS)];
        };

        return this.#viewer.entities.add({
            name: VELOCITY_ARROW_NAMES[system],
            polyline: {
                positions: new Cesium.CallbackProperty(positions, false),
                show: new Cesium.CallbackProperty((time) => {
                    return Cesium.Cartesian3.magnitude(velocityAt(time).vector) >= VELOCITY_ARROW_MIN_SPEED;
                }, false),
                width: VELOCITY_ARROW_WIDTH,
                // NONE: segmento rettilineo nello spazio.
                arcType: Cesium.ArcType.NONE,
                material: new Cesium.PolylineArrowMaterialProperty(color(PALETTE[system]))
            }
        });
    }

    // --------------------------------------------------
    // TRAIETTORIE
    // --------------------------------------------------
    //
    // - ECEF (verde): vertici in ECEF, ruotano con la Terra.
    // - ECI (rossa): vertici in ECI, disegnati con la rotazione
    //   ECI -> ECEF del frame: la traccia resta ferma nello spazio.

    // Aggiorna la rotazione della traccia ECI e aggiunge i punti nuovi.
    #updateTracks(frame) {
        Cesium.Matrix3.fromRotationZ(-frame.earthAngle, this.#scratchRotation3);
        Cesium.Matrix4.fromRotation(this.#scratchRotation3, this.#scratchRotation4);
        this.#tracks.eci.setModelMatrix(this.#scratchRotation4);

        REFERENCE_SYSTEMS.forEach((system) => {
            this.#tracks[system].sync(this.#vm.trajectory(system));
        });
    }

    // --------------------------------------------------
    // ASSE DI ROTAZIONE E MARCATORE DEL PUNTO DI PARTENZA
    // --------------------------------------------------

    // Due tratti lungo l'asse fornito dal ViewModel, dalla superficie
    // di ciascun polo fino a AXIS_HALF_LENGTH dal centro.
    #addRotationAxis() {
        const polarRadius = Cesium.Ellipsoid.WGS84.radii.z;
        const direction = this.#vm.rotationAxis;
        const along = (distance) => Cesium.Cartesian3.multiplyByScalar(direction, distance, new Cesium.Cartesian3());
        [["Nord", +1], ["Sud", -1]].forEach(([pole, sign]) => {
            this.#viewer.entities.add({
                name: `Asse di rotazione (${pole})`,
                polyline: {
                    positions: [along(sign * polarRadius), along(sign * AXIS_HALF_LENGTH)],
                    arcType: Cesium.ArcType.NONE,
                    width: AXIS_WIDTH,
                    material: color(PALETTE.rotationAxis)
                }
            });
        });
    }

    // Posizione impostata da #render().
    #addStartMarker() {
        return this.#viewer.entities.add({
            name: "Punto di partenza",
            point: {
                pixelSize: 7,
                color: color(PALETTE.startMarker),
                outlineColor: color(PALETTE.startMarkerOutline),
                outlineWidth: 1,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
            }
        });
    }

    // --------------------------------------------------
    // TERNE DI RIFERIMENTO NEL PUNTO DI PARTENZA
    // --------------------------------------------------
    //
    // X (rosso) Est, Y (verde) Nord, Z (blu) Su: una terna solidale con
    // la Terra (ECEF) e una ferma nello spazio inerziale (ECI).

    // Tre polilinee (E, N, U) per terna; posizioni impostate da
    // #updateReferenceFrames().
    #addReferenceFrames() {
        const collection = this.#viewer.scene.primitives.add(new Cesium.PolylineCollection());
        const createAxes = () => PALETTE.frameAxes.map((cssColor) => collection.add({
            positions: [new Cesium.Cartesian3(0, 0, 0), new Cesium.Cartesian3(1, 0, 0)],
            width: FRAME_LINE_WIDTH,
            material: Cesium.Material.fromType("Color", { color: color(cssColor) })
        }));
        // La terna ECI è creata per ultima: a t = 0, quando le due
        // coincidono, è disegnata sopra.
        return { ecef: createAxes(), eci: createAxes() };
    }

    // Porta le terne nella posizione dell'istante, con assi lunghi
    // FRAME_AXIS_PIXELS a schermo.
    #updateReferenceFrames(frame) {
        REFERENCE_SYSTEMS.forEach((system) => {
            const { origin, axes } = frame.referenceFrames[system];
            const length = FRAME_AXIS_PIXELS * this.#metersPerPixelAt(origin);
            this.#framePolylines[system].forEach((polyline, i) => {
                const tip = Cesium.Cartesian3.multiplyByScalar(axes[i], length, new Cesium.Cartesian3());
                polyline.positions = [
                    Cesium.Cartesian3.clone(origin),
                    Cesium.Cartesian3.add(origin, tip, tip)
                ];
            });
        });
    }

    // Metri corrispondenti a un pixel alla distanza di "origin".
    #metersPerPixelAt(origin) {
        const scene = this.#viewer.scene;
        const sphere = this.#scratchPixelSphere;
        sphere.center = origin;
        sphere.radius = 0;
        return scene.camera.getPixelSize(sphere, scene.drawingBufferWidth, scene.drawingBufferHeight);
    }

    // --------------------------------------------------
    // SELEZIONE DEL PUNTO SULLA SUPERFICIE
    // --------------------------------------------------
    //
    // In modalità selezione il clic sinistro sul globo sceglie il punto;
    // un clic nello spazio è ignorato. Il trascinamento continua a
    // ruotare la vista.

    // Registra il gestore del clic sinistro.
    #installPicking() {
        const viewer = this.#viewer;
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
        handler.setInputAction((click) => {
            if (!this.#vm.pickMode) {
                return;
            }
            const ray = viewer.camera.getPickRay(click.position);
            const picked = Cesium.defined(ray) ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
            if (!Cesium.defined(picked)) {
                return;
            }
            // Punto in ECEF all'istante corrente, usato come punto
            // geografico: la simulazione riparte da t = 0 (ECI = ECEF).
            const cartographic = Cesium.Cartographic.fromCartesian(picked);
            const accepted = this.#vm.pickStartPoint(
                Cesium.Math.toDegrees(cartographic.latitude),
                Cesium.Math.toDegrees(cartographic.longitude)
            );
            if (accepted) {
                viewer.selectedEntity = undefined;
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }
}
