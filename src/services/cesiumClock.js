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

    get running() {
        return this.#clock.shouldAnimate;
    }

    set running(value) {
        this.#clock.shouldAnimate = value;
    }

    reset() {
        this.#clock.currentTime = this.#clock.startTime.clone();
    }

    isAtStart() {
        return Cesium.JulianDate.equals(this.#clock.currentTime, this.#clock.startTime);
    }
}
