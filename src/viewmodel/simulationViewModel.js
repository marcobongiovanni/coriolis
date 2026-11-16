// ============================================================
// simulationViewModel.js — Stato e comandi dell'interfaccia.
//
// Collega le viste al modello (Simulation). Non conosce componenti
// dell'interfaccia: riceve il tempo e la posizione geografica tramite
// le interfacce SimulationClock e GeolocationService.
//
// Ogni elemento della scena corrisponde a un elemento del modello:
//   particella, punto di partenza                       -> Particle
//   frecce della velocità                               -> Arrow
//   traiettorie                                         -> Trajectory
//   terne nel punto di partenza                         -> EnuFrame
//   asse di rotazione                                   -> rotationAxis
//                                                          del modello di Terra
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
    earthRotationAngle,
    eciToEcef,
    normalizeDegrees
} from "../geometry/referenceFrames.js";
import { WGS84 } from "../model/earth.js";
import { GeolocationService, SimulationClock, requireImplementation } from "../services/interfaces.js";
import { Observable } from "./observable.js";

export const PICK_REQUIRES_RESET_MESSAGE =
    "Per selezionare un nuovo punto premi prima il pulsante Reset.";

export class SimulationViewModel extends Observable {
    // Sistema in cui la telecamera resta ferma: "eci" oppure "ecef".
    cameraMode = "eci";

    // Vero mentre si attende il clic sul globo che sceglie il punto.
    pickMode = false;

    // Oggetti visibili, per tipo e sistema di riferimento.
    visibility = {
        frame: { eci: true, ecef: true },
        track: { eci: true, ecef: true },
        velocity: { eci: true, ecef: true }
    };

    #simulation;
    #particle;
    #clock;
    #geolocation;
    #frame;

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

    get running() {
        return this.#clock.running;
    }

    // Le condizioni iniziali si modificano solo a simulazione ferma.
    get editable() {
        return !this.running;
    }

    get sphericalEarth() {
        return this.#simulation.useSphericalEarth;
    }

    get particleRadius() {
        return this.#particle.radius;
    }

    get latitudeDeg() {
        return this.#particle.start.latitudeDeg;
    }

    get longitudeDeg() {
        return this.#particle.start.longitudeDeg;
    }

    get altitudeKm() {
        return this.#particle.start.altitude / 1000;
    }

    // Punto di partenza sulla superficie (ECEF).
    get startSurfacePoint() {
        return this.#particle.start.surfacePointECEF;
    }

    // Centro della particella a t = 0 (ECI = ECEF).
    get startParticlePosition() {
        return this.#particle.initial.position;
    }

    // Terna di velocità iniziale: "relative" (ECEF) o "absolute" (ECI).
    velocity(frame) {
        return this.#particle.velocity[frame];
    }

    // Direzione dell'asse di rotazione terrestre (verso il Polo Nord).
    get rotationAxis() {
        return this.#simulation.earth.rotationAxis.direction;
    }

    // Traiettoria della particella nel sistema "eci" o "ecef":
    // { points, revision } (vedi Trajectory). I punti sono in sola
    // lettura.
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

    setLatitude(deg) {
        this.#editSetup(() => this.#particle.setStartPoint(deg, this.longitudeDeg));
    }

    setLongitude(deg) {
        this.#editSetup(() => this.#particle.setStartPoint(this.latitudeDeg, deg));
    }

    setAltitudeKm(km) {
        this.#editSetup(() => this.#particle.setStartAltitude(km * 1000));
    }

    // component: "speedKmh", "azimuthDeg" o "elevationDeg".
    setVelocity(frame, component, value) {
        this.#editSetup(() => this.#particle.setVelocity(frame, { [component]: value }));
    }

    setSphericalEarth(spherical) {
        this.#editSetup(() => {
            this.#simulation.useSphericalEarth = spherical;
        });
    }

    // Attivo anche durante la simulazione.
    setCameraMode(mode) {
        this.cameraMode = mode;
        this.emit("change");
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

        const angle = earthRotationAngle(seconds);
        const particle = this.#particle;
        const state = particle.state;
        const particlePositionEcef = eciToEcef(state.position, angle);
        const inEcef = (elements) => ({
            eci: elements.eci.inEcef(seconds),
            ecef: elements.ecef.inEcef(seconds)
        });
        const velocities = inEcef(particle.velocityArrows);
        const speedKmh = (system) => Cesium.Cartesian3.magnitude(velocities[system].vector) * KMH_PER_MS;

        this.#frame = {
            seconds: seconds,
            earthAngle: angle,
            particlePositionEcef: particlePositionEcef,
            // Velocità assoluta (eci) e relativa (ecef): { origin, vector }.
            velocities: velocities,
            // Terne nel punto di partenza: { origin, axes: [E, N, U] }.
            referenceFrames: inEcef(particle.startFrames),
            status: {
                ...geographicPosition(particlePositionEcef),
                timeSeconds: seconds,
                altitudeKm: state.altitude / 1000,
                speedEcefKmh: speedKmh("ecef"),
                speedEciKmh: speedKmh("eci")
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

    #restarted() {
        this.#simulation.reset();
        this.#clock.reset();
        this.#frame = undefined;
        this.frameAt(0);
        this.emit("change");
    }

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
