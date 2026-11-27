// ============================================================
// simulationViewModel.js — Stato e comandi dell'interfaccia.
//
// Collega le viste al modello (Simulation). Non conosce componenti
// dell'interfaccia: riceve il tempo e la posizione geografica tramite
// le interfacce SimulationClock e GeolocationService.
//
// Ogni elemento della scena corrisponde a un nodo della gerarchia del
// modello (SceneNode, vedi Simulation):
//   Terra                                               -> Earth
//   particella                                          -> Particle
//   frecce della velocità e dell'accelerazione di Coriolis -> Arrow
//   traiettorie                                         -> Trajectory
//   terne nel punto di partenza                         -> EnuFrame
//   asse di rotazione                                   -> RotationAxis
//   telecamere ECI ed ECEF                              -> Camera
// Cesium disegna nel sistema ECEF: il ViewModel esprime ogni elemento
// nelle coordinate della Terra.
//
// Eventi emessi (vedi Observable):
//   "change"            lo stato mostrato dalle viste è cambiato
//   "frame" (frame)     calcolato lo stato di un nuovo istante
//   "error" (message)   messaggio per l'utente (undefined = nascondi)
//   "startPointLocated" punto di partenza preso dalla posizione del PC
// ============================================================

import * as Cesium from "cesium";
import {
    KMH_PER_MS,
    bySystem,
    normalizeDegrees
} from "../geometry/referenceFrames.js";
import { WGS84 } from "../model/earth.js";
import { GeolocationService, SimulationClock, requireImplementation } from "../services/interfaces.js";
import { Observable } from "./observable.js";

export const PICK_REQUIRES_RESET_MESSAGE =
    "Per selezionare un nuovo punto premi prima il pulsante Reset.";

export class SimulationViewModel extends Observable {
    // Telecamera attiva: quella ferma in "eci" oppure quella ferma in
    // "ecef". Ognuna conserva la propria posa.
    cameraMode = "eci";

    // Vero mentre si attende il clic sul globo che sceglie il punto.
    pickMode = false;

    // Oggetti visibili, per tipo e sistema di riferimento.
    visibility = {
        frame: { eci: true, ecef: true },
        track: { eci: true, ecef: true },
        velocity: { eci: true, ecef: true },
        coriolis: { ecef: true } // Solo relativa alla Terra
    };

    #simulation;
    #particle;
    #clock;
    #geolocation;
    #frame;

    // "clock" e "geolocation" devono implementare SimulationClock e
    // GeolocationService. Parte da t = 0.
    constructor(simulation, clock, geolocation) {
        super();
        this.#simulation = simulation;
        this.#particle = simulation.particle;
        this.#clock = requireImplementation(clock, SimulationClock);
        this.#geolocation = requireImplementation(geolocation, GeolocationService);
        this.#restarted();
    }

    // --------------------------------------------------
    // PROPRIETÀ
    // --------------------------------------------------

    // Vero mentre il tempo simulato scorre.
    get running() {
        return this.#clock.running;
    }

    // Le condizioni iniziali si modificano solo a simulazione ferma.
    get editable() {
        return !this.running;
    }

    // Modello di Terra: sfera (true) o ellissoide (false).
    get sphericalEarth() {
        return this.#simulation.earth.spherical;
    }

    // Raggio della particella [m].
    get particleRadius() {
        return this.#particle.radius;
    }

    // Latitudine del punto di partenza [°], in [-90°, +90°].
    get latitudeDeg() {
        return this.#particle.start.latitudeDeg;
    }

    // Longitudine del punto di partenza [°], in [0°, 360°).
    get longitudeDeg() {
        return this.#particle.start.longitudeDeg;
    }

    // Quota di partenza [km].
    get altitudeKm() {
        return this.#particle.start.altitude / 1000;
    }

    // Posa { position, direction, up } della telecamera attiva in ECEF
    // all'istante "seconds" [s simulati].
    cameraPose(seconds) {
        return this.#simulation.cameras[this.cameraMode].expressedIn(this.#simulation.earth, seconds);
    }

    // Terna di velocità iniziale: "ecef" (relativa) o "eci" (assoluta).
    velocity(frame) {
        return this.#particle.velocity[frame];
    }

    // Direzione dell'asse di rotazione terrestre (verso il Polo Nord), in
    // ECEF. La Terra ruota attorno all'asse, quindi è la stessa in ogni
    // istante.
    get rotationAxis() {
        const { earth, rotationAxis } = this.#simulation;
        return rotationAxis.axesIn(earth, 0)[2]; // L'asse è l'asse Z del nodo
    }

    // Traiettoria assoluta ("eci") o relativa ("ecef") della particella:
    // { points, revision } (vedi Trajectory). I punti sono nelle
    // coordinate della traiettoria (vedi frameAt().trajectoryTransforms),
    // in sola lettura.
    trajectory(system) {
        const { points, revision } = this.#particle.trajectories[system];
        return { points, revision };
    }

    // Ultimo istante calcolato (vedi frameAt).
    get frame() {
        return this.#frame;
    }

    // --------------------------------------------------
    // COMANDI
    // --------------------------------------------------

    // Avvia o mette in pausa la simulazione; l'avvio chiude la
    // selezione del punto.
    togglePlay() {
        this.#clock.running = !this.#clock.running;
        if (this.running) {
            this.pickMode = false;
        }
        this.emit("change");
    }

    // Stop = Reset: riporta la simulazione a t = 0 con le condizioni
    // iniziali correnti.
    stop() {
        this.#editSetup(() => this.#hideError());
    }

    // Il punto si può scegliere solo a t = 0; uscire dalla modalità
    // di selezione è sempre permesso.
    togglePickMode() {
        if (this.running) {
            return;
        }
        if (!this.pickMode && !this.#clock.isAtStart()) {
            this.emit("error", PICK_REQUIRES_RESET_MESSAGE);
            return;
        }
        this.#hideError();
        this.pickMode = !this.pickMode;
        this.emit("change");
    }

    // Punto scelto sul globo. Restituisce true se è stato accettato.
    pickStartPoint(latitudeDeg, longitudeDeg) {
        if (!this.pickMode || this.running || !this.#clock.isAtStart()) {
            return false;
        }
        this.pickMode = false;
        this.#editSetup(() => this.#particle.setStartPoint(latitudeDeg, longitudeDeg));
        return true;
    }

    // Comandi delle condizioni iniziali: il modello valida il valore e
    // la simulazione riparte da t = 0 (vedi #editSetup).

    // Latitudine di partenza [°].
    setLatitude(deg) {
        this.#editSetup(() => this.#particle.setStartPoint(deg, this.longitudeDeg));
    }

    // Longitudine di partenza [°].
    setLongitude(deg) {
        this.#editSetup(() => this.#particle.setStartPoint(this.latitudeDeg, deg));
    }

    // Quota di partenza [km].
    setAltitudeKm(km) {
        this.#editSetup(() => this.#particle.setStartAltitude(km * 1000));
    }

    // Una componente della terna di velocità iniziale "frame";
    // component: "speedKmh", "azimuthDeg" o "elevationDeg".
    setVelocity(frame, component, value) {
        this.#editSetup(() => this.#particle.setVelocity(frame, { [component]: value }));
    }

    // Modello di Terra: sfera (true) o ellissoide (false).
    setSphericalEarth(spherical) {
        this.#editSetup(() => {
            this.#simulation.earth.spherical = spherical;
        });
    }

    // Telecamera attiva ("eci" o "ecef"). Attivo anche durante la
    // simulazione.
    setCameraMode(mode) {
        this.cameraMode = mode;
        this.emit("change");
    }

    // L'utente ha spostato la telecamera "system": "pose" è la nuova
    // posa in ECEF all'istante "seconds" [s simulati].
    moveCamera(system, pose, seconds) {
        const camera = this.#simulation.cameras[system];
        camera.setFrom(this.#simulation.earth, pose, seconds);
        camera.movedByUser = true;
    }

    // Inquadra il punto di partenza con le telecamere che l'utente non
    // ha ancora spostato. "tanHalfFovWidth": tangente del semiangolo
    // del campo visivo lungo la larghezza della vista.
    frameStartPoint(tanHalfFovWidth) {
        const startFrame = this.#particle.startFrames.ecef; // Terna locale nel punto di partenza
        Object.values(this.#simulation.cameras)
            .filter((camera) => !camera.movedByUser)
            .forEach((camera) => camera.frameStartPoint(startFrame, tanHalfFovWidth));
    }

    // item: "frame", "track" o "velocity"; frame: "eci" o "ecef".
    // Attivo anche durante la simulazione: agisce solo sulla vista.
    setVisibility(item, frame, show) {
        this.visibility[item][frame] = show;
        this.emit("change");
    }

    // Usa la posizione del PC come punto di partenza, se nel frattempo
    // l'utente non ha già scelto un punto o avviato la simulazione.
    async locateStartPoint() {
        const fallbackLatitude = this.latitudeDeg;
        const fallbackLongitude = this.longitudeDeg;
        const position = await this.#geolocation.getCurrentPosition();

        const untouched =
            !this.running &&
            this.#clock.isAtStart() &&
            this.latitudeDeg === fallbackLatitude &&
            this.longitudeDeg === fallbackLongitude;
        if (!position || !untouched) {
            return;
        }
        this.#editSetup(() => this.#particle.setStartPoint(position.latitudeDeg, position.longitudeDeg));
        this.emit("startPointLocated");
    }

    // --------------------------------------------------
    // STATO A UN ISTANTE
    // --------------------------------------------------

    // Stato della scena all'istante "seconds" [s simulati], in
    // coordinate ECEF pronte per essere disegnate. È idempotente: le
    // chiamate successive con lo stesso istante restituiscono lo stesso
    // oggetto.
    frameAt(seconds) {
        if (this.#frame && this.#frame.seconds === seconds) {
            return this.#frame;
        }
        this.#simulation.advanceTo(seconds);

        const earth = this.#simulation.earth;
        const particle = this.#particle;
        const state = particle.state;
        const particlePositionEcef = particle.pointTo(earth, seconds, state.position);
        const velocities = bySystem((system) => particle.velocityArrows[system].expressedIn(earth, seconds));
        const speedKmh = (system) => Cesium.Cartesian3.magnitude(velocities[system].vector) * KMH_PER_MS;
        const coriolis = particle.coriolisArrow.expressedIn(earth, seconds);

        this.#frame = {
            seconds: seconds,
            // Baricentro della particella e centro della sfera disegnata.
            particlePositionEcef: particlePositionEcef,
            sphereCenterEcef: particle.pointTo(earth, seconds, state.sphereCenter),
            // Velocità assoluta (eci) e relativa (ecef): { position, vector }.
            velocities: velocities,
            // Componente orizzontale dell'accelerazione di Coriolis:
            // { position, vector }.
            coriolis: coriolis,
            // Terne nel punto di partenza: { position, axes: [E, N, U] }.
            referenceFrames: bySystem((system) => particle.startFrames[system].poseIn(earth, seconds)),
            // Matrici dalle coordinate delle traiettorie (vedi
            // trajectory()) a ECEF.
            trajectoryTransforms: bySystem((system) => particle.trajectories[system].transformTo(earth, seconds)),
            status: {
                ...geographicPosition(particlePositionEcef),
                timeSeconds: seconds,
                altitudeKm: state.altitude / 1000,
                speedEcefKmh: speedKmh("ecef"),
                speedEciKmh: speedKmh("eci"),
                coriolisMs2: Cesium.Cartesian3.magnitude(coriolis.vector)
            }
        };
        this.emit("frame", this.#frame);
        return this.#frame;
    }

    // --------------------------------------------------
    // INTERNI
    // --------------------------------------------------

    // Modifica delle condizioni iniziali: ignorata durante la simulazione
    // (la notifica riallinea comunque le viste), altrimenti la
    // simulazione riparte da t = 0 con le nuove condizioni.
    #editSetup(change) {
        if (this.running) {
            this.emit("change");
            return;
        }
        change();
        this.#restarted();
    }

    // Riporta modello e orologio a t = 0 e notifica le viste.
    #restarted() {
        this.#simulation.reset();
        this.#clock.reset();
        this.#frame = undefined;
        this.frameAt(0);
        this.emit("change");
    }

    // Chiede alle viste di nascondere il messaggio di errore.
    #hideError() {
        this.emit("error", undefined);
    }
}

// Latitudine geodetica e longitudine in [0°, 360°) di un punto ECEF.
function geographicPosition(pointEcef) {
    const cartographic = Cesium.Cartographic.fromCartesian(pointEcef, WGS84);
    if (!Cesium.defined(cartographic)) {
        return { latitudeDeg: undefined, longitudeDeg: undefined };
    }
    return {
        latitudeDeg: Cesium.Math.toDegrees(cartographic.latitude),
        longitudeDeg: normalizeDegrees(Cesium.Math.toDegrees(cartographic.longitude))
    };
}
