// ============================================================
// arrow.js — Freccia: grandezza vettoriale di una particella (per
// esempio la velocità), disegnata nel centro della sua sfera.
//
// La grandezza è calcolata dallo stato corrente della particella con
// la funzione "quantity(state, result)", che restituisce le componenti
// in coordinate ECI. "system" indica rispetto a quale sistema è
// misurata la grandezza: "eci" (spazio inerziale) o "ecef" (Terra).
// ============================================================

import * as Cesium from "cesium";
import { earthRotationAngle, eciToEcef } from "../geometry/referenceFrames.js";

export class Arrow {
    system; // "eci" o "ecef"

    #state;    // Stato corrente della particella (vedi Particle.state), in ECI
    #quantity; // (state, result) => componenti ECI della grandezza

    // "state": stato corrente della particella, letto a ogni richiesta;
    // "quantity": funzione che ne ricava la grandezza.
    constructor(system, state, quantity) {
        this.system = system;
        this.#state = state;
        this.#quantity = quantity;
    }

    // Componenti in coordinate ECI.
    value(result = new Cesium.Cartesian3()) {
        return this.#quantity(this.#state, result);
    }

    // Origine (centro della sfera della particella) e vettore in
    // coordinate ECEF all'istante "seconds" dello stato corrente (copie).
    inEcef(seconds) {
        const angle = earthRotationAngle(seconds);
        return {
            origin: eciToEcef(this.#state.sphereCenter, angle),
            vector: eciToEcef(this.value(), angle)
        };
    }
}
