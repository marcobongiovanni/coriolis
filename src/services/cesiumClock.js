// ============================================================
// cesiumClock.js — SimulationClock basato sull'orologio di Cesium.
//
// L'orologio di Cesium è l'unica sorgente del tempo: il tempo simulato
// è la differenza tra currentTime e startTime, e scorre "timeScale"
// volte più veloce del tempo reale.
// ============================================================

import * as Cesium from "cesium";
import { SimulationClock } from "./interfaces.js";

export class CesiumSimulationClock extends SimulationClock {
    #clock;

    // Configura "cesiumClock": tempo illimitato che parte da adesso,
    // fermo, "timeScale" volte più veloce del tempo reale quando scorre.
    constructor(cesiumClock, timeScale) {
        super();
        const start = Cesium.JulianDate.now();
        cesiumClock.startTime = start.clone();
        cesiumClock.currentTime = start.clone();
        cesiumClock.clockRange = Cesium.ClockRange.UNBOUNDED;
        cesiumClock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
        cesiumClock.multiplier = timeScale;
        cesiumClock.shouldAnimate = false;
        this.#clock = cesiumClock;
    }

    // Il tempo scorre quando Cesium anima la scena.
    get running() {
        return this.#clock.shouldAnimate;
    }

    // Avvia o ferma lo scorrere del tempo.
    set running(value) {
        this.#clock.shouldAnimate = value;
    }

    // Riporta l'orologio all'istante iniziale.
    reset() {
        this.#clock.currentTime = this.#clock.startTime.clone();
    }

    // Vero se l'orologio è all'istante iniziale.
    isAtStart() {
        return Cesium.JulianDate.equals(this.#clock.currentTime, this.#clock.startTime);
    }
}
