// ============================================================
// arrow.js — Freccia: grandezza vettoriale di una particella (per
// esempio la velocità), disegnata nel centro della sua sfera.
//
// È un nodo della scena: il padre stabilisce rispetto a quale sistema
// è misurata la grandezza (World: spazio inerziale, Terra: ECEF).
// L'origine del nodo segue il centro della sfera della particella; gli
// assi sono quelli del padre. La grandezza è calcolata dallo stato
// corrente della particella con la funzione "quantity(state, result)",
// che restituisce le componenti nelle coordinate della particella (ECI).
// ============================================================

import * as Cesium from "cesium";
import { SceneNode } from "./sceneNode.js";

export class Arrow extends SceneNode {
    #particle; // Particella di cui la freccia rappresenta la grandezza
    #quantity; // (state, result) => componenti nelle coordinate della particella

    // "particle": particella, letta a ogni richiesta; "quantity":
    // funzione che ne ricava la grandezza.
    constructor(particle, quantity) {
        super();
        this.#particle = particle;
        this.#quantity = quantity;
    }

    // Origine nel sistema del padre: centro della sfera della particella
    // nello stato corrente.
    localPosition(seconds, result = new Cesium.Cartesian3()) {
        const particle = this.#particle;
        return particle.pointTo(this.parent, seconds, particle.state.sphereCenter, result);
    }

    // Componenti nelle coordinate della freccia, all'istante "seconds"
    // dello stato corrente della particella.
    value(seconds, result = new Cesium.Cartesian3()) {
        const particle = this.#particle;
        this.#quantity(particle.state, result);
        return particle.vectorTo(this, seconds, result, result);
    }

    // Origine e vettore nelle coordinate del nodo "node" all'istante
    // "seconds" (copie).
    expressedIn(node, seconds) {
        return {
            position: this.positionIn(node, seconds),
            vector: this.vectorTo(node, seconds, this.value(seconds))
        };
    }
}
