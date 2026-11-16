// ============================================================
// particle.js — Modello di una particella: corpo sferico soggetto
// alla gravità che rimbalza elasticamente sulla Terra.
//
// Contiene ciò che appartiene alla singola particella:
//   - raggio;
//   - condizioni iniziali (punto e quota di partenza, velocità) con le
//     loro regole di validità;
//   - stato iniziale e stato corrente, in ECI;
//   - grandezze derivate (quota, energia);
//   - frecce della velocità assoluta (ECI) e relativa (ECEF);
//   - terne Est-Nord-Su nel punto di partenza (ECI ed ECEF);
//   - traiettorie del centro (ECI ed ECEF).
//
// Ciò che è comune a tutte le particelle (modello di Terra, tempo,
// integrazione) è in Simulation. Il modello di Terra viene passato ai
// metodi che ne dipendono.
//
// Le modifiche delle condizioni iniziali hanno effetto alla successiva
// chiamata di reset(earth) (Simulation.reset()).
// ============================================================

import * as Cesium from "cesium";
import {
    bySystem,
    dragVelocity,
    earthRotationAngle,
    eciToEcef,
    normalizeDegrees,
    relativeVelocity
} from "../geometry/referenceFrames.js";
import { Arrow } from "./arrow.js";
import { EnuFrame } from "./enuFrame.js";
import { Trajectory } from "./trajectory.js";

export const DEFAULT_PARTICLE_RADIUS = 125000; // [m]

// Punto di partenza predefinito, usato finché il browser non fornisce
// la posizione geografica del PC.
export const DEFAULT_START_POINT = { latitudeDeg: 45.0, longitudeDeg: 7.1 };

// Grandezze rappresentate dalle frecce della velocità, in coordinate
// ECI: assoluta (eci), v, e relativa alla Terra (ecef), v - ω × r.
const VELOCITY_QUANTITIES = {
    eci: (state, result) => Cesium.Cartesian3.clone(state.velocity, result),
    ecef: (state, result) => relativeVelocity(state.position, state.velocity, result)
};

export class Particle {
    radius;

    // Condizioni iniziali.
    start = {
        latitudeDeg: DEFAULT_START_POINT.latitudeDeg,   // [-90°, +90°]
        longitudeDeg: DEFAULT_START_POINT.longitudeDeg, // [0°, 360°)
        surfacePointECEF: new Cesium.Cartesian3(),
        altitude: 0 // Quota del punto più basso della particella [m]
    };

    // Terne di velocità iniziale (nella terna Est-Nord-Su del punto di
    // partenza: modulo [km/h], azimuth [°] dal Nord, elevazione [°]):
    //   "relative": rispetto alla Terra (ECEF);
    //   "absolute": rispetto allo spazio inerziale (ECI).
    // L'ultima terna modificata è quella "di riferimento"
    // (velocityMaster): l'altra viene ricalcolata da questa.
    velocityMaster = "relative";

    velocity = {
        relative: { speedKmh: 0, azimuthDeg: 0, elevationDeg: 0 },
        absolute: { speedKmh: 0, azimuthDeg: 0, elevationDeg: 0 }
    };

    // Stato iniziale (a t = 0 ECI ed ECEF coincidono).
    initial = {
        position: new Cesium.Cartesian3(),
        velocityECI: new Cesium.Cartesian3(),
        velocityECEF: new Cesium.Cartesian3()
    };

    // Stato corrente, in ECI.
    state = {
        position: new Cesium.Cartesian3(),
        velocity: new Cesium.Cartesian3(),
        altitude: 0 // Quota del punto più basso della particella [m]
    };

    // Velocità corrente del centro: assoluta (eci) e relativa (ecef).
    velocityArrows = bySystem((system) => new Arrow(system, this.state, VELOCITY_QUANTITIES[system]));

    // Terne Est-Nord-Su con origine nel centro della particella a t = 0.
    startFrames = bySystem((system) => new EnuFrame(system));

    // Posizioni del centro dall'inizio della simulazione.
    trajectories = bySystem((system) => new Trajectory(system));

    #scratchEcef = new Cesium.Cartesian3();

    constructor(radius = DEFAULT_PARTICLE_RADIUS) {
        this.radius = radius;
        this.setStartPoint(DEFAULT_START_POINT.latitudeDeg, DEFAULT_START_POINT.longitudeDeg);
    }

    // --------------------------------------------------
    // CONDIZIONI INIZIALI (con le loro regole di validità)
    // --------------------------------------------------

    // Latitudine limitata a [-90°, +90°], longitudine ricondotta a [0°, 360°).
    setStartPoint(latitudeDeg, longitudeDeg) {
        const start = this.start;
        start.latitudeDeg = Cesium.Math.clamp(latitudeDeg, -90, 90);
        start.longitudeDeg = normalizeDegrees(longitudeDeg);
        start.surfacePointECEF = Cesium.Cartesian3.fromDegrees(start.longitudeDeg, start.latitudeDeg, 0);
    }

    // Quota non negativa [m].
    setStartAltitude(meters) {
        this.start.altitude = Math.max(0, meters);
    }

    // Modifica una o più componenti della terna "frame", che diventa
    // quella di riferimento. Modulo non negativo, azimuth in [0°, 360°),
    // elevazione in [-90°, +90°].
    setVelocity(frame, changes) {
        const v = Object.assign(this.velocity[frame], changes);
        v.speedKmh = Math.max(0, v.speedKmh);
        v.azimuthDeg = normalizeDegrees(v.azimuthDeg);
        v.elevationDeg = Cesium.Math.clamp(v.elevationDeg, -90, 90);
        this.velocityMaster = frame;
    }

    // --------------------------------------------------
    // STATO
    // --------------------------------------------------

    // Calcola lo stato iniziale sul modello di Terra "earth", vi riporta
    // lo stato corrente e fa ripartire le traiettorie.
    reset(earth) {
        this.#computeInitialPosition(earth);
        Object.values(this.startFrames).forEach((frame) => frame.placeAt(this.initial.position));
        this.#computeInitialVelocity();
        Cesium.Cartesian3.clone(this.initial.position, this.state.position);
        Cesium.Cartesian3.clone(this.initial.velocityECI, this.state.velocity);
        this.updateAltitude(earth);

        Object.values(this.trajectories).forEach((trajectory) => trajectory.clear());
        this.recordTrajectory(0);
    }

    // Aggiunge la posizione corrente (istante "seconds") alle traiettorie.
    recordTrajectory(seconds) {
        const position = this.state.position;
        this.trajectories.eci.addPoint(position);
        this.trajectories.ecef.addPoint(eciToEcef(position, earthRotationAngle(seconds), this.#scratchEcef));
    }

    // Distanza con segno del punto più basso della particella dalla
    // superficie, lungo la normale (scritta in "normalResult");
    // undefined se non definita.
    clearance(earth, normalResult) {
        const h = earth.heightAboveSurface(this.state.position, normalResult);
        return Cesium.defined(h) ? h - this.radius : undefined;
    }

    // Aggiorna la quota dello stato corrente (0 se non definita).
    updateAltitude(earth) {
        const c = this.clearance(earth, new Cesium.Cartesian3());
        this.state.altitude = Cesium.defined(c) ? c : 0;
    }

    // Energia meccanica specifica nel sistema ECI [J/kg]: si conserva
    // durante il moto (utile per verificare l'integrazione).
    mechanicalEnergy(earth) {
        return 0.5 * Cesium.Cartesian3.magnitudeSquared(this.state.velocity) +
            earth.potential(this.state.position);
    }

    // Centro della particella a raggio + quota dalla superficie del
    // modello, lungo la sua normale nel punto di partenza.
    #computeInitialPosition(earth) {
        earth.pointAboveSurface(
            this.start.surfacePointECEF,
            this.radius + this.start.altitude,
            this.initial.position
        );
    }

    // A t = 0 le due terne di velocità sono legate da
    // v_ECI = v_ECEF + ω × r, con ω × r velocità di trascinamento nel
    // centro della particella. La terna di riferimento (velocityMaster)
    // determina l'altra. Richiede le terne già posizionate (placeAt).
    #computeInitialVelocity() {
        const C3 = Cesium.Cartesian3;
        const frame = this.startFrames.ecef; // A t = 0 ECEF = ECI
        const initial = this.initial;
        const drag = dragVelocity(initial.position);

        if (this.velocityMaster === "relative") {
            frame.toCartesian(EnuFrame.fromSpherical(this.velocity.relative), initial.velocityECEF);
            C3.add(initial.velocityECEF, drag, initial.velocityECI);
            EnuFrame.toSpherical(frame.toLocal(initial.velocityECI), this.velocity.absolute);
        } else {
            frame.toCartesian(EnuFrame.fromSpherical(this.velocity.absolute), initial.velocityECI);
            C3.subtract(initial.velocityECI, drag, initial.velocityECEF);
            EnuFrame.toSpherical(frame.toLocal(initial.velocityECEF), this.velocity.relative);
        }
    }
}
