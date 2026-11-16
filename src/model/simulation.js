// ============================================================
// simulation.js — Modello: particella che si muove attorno alla
// Terra in rotazione.
//
// Contiene ciò che è comune a tutte le particelle: modello di Terra,
// tempo simulato, integrazione e urti. Lo stato e le condizioni
// iniziali di ogni particella sono in Particle; i metodi di
// integrazione ricevono la particella su cui agire.
//
// Non dipende dal livello di presentazione (né Viewer, né DOM, né
// orologio di Cesium): usa solo le classi matematiche di Cesium, quindi
// funziona sia nel browser sia in Node, dove la provano i test unitari.
//
// - Dinamica calcolata nel sistema inerziale ECI.
// - Integrazione Velocity Verlet a passo variabile (<= MAX_PHYSICS_STEP)
//   con ricerca dell'istante esatto di contatto.
// - Urto elastico e senza attrito lungo la normale della superficie del
//   modello di Terra scelto (vedi earth.js).
// ============================================================

import * as Cesium from "cesium";
import { ELLIPSOIDAL_EARTH, SPHERICAL_EARTH } from "./earth.js";
import { Particle } from "./particle.js";

export const MAX_PHYSICS_STEP = 0.5;  // Passo massimo di integrazione [s]
const MAX_SUBSTEPS = 20000;           // Limite di sicurezza per chiamata
const MAX_CONTACTS_PER_STEP = 5;      // Urti risolti in un singolo passo
const CONTACT_BISECTIONS = 40;        // Iterazioni per l'istante di contatto

export class Simulation {
    // Modello di Terra usato da gravità e urti: sfera (true) o
    // ellissoide WGS84 con J2 (false).
    useSphericalEarth = true;

    particle = new Particle();

    time = 0; // Istante simulato a cui si riferisce lo stato [s]

    #scratch = {
        accel0: new Cesium.Cartesian3(),
        accel1: new Cesium.Cartesian3(),
        temp: new Cesium.Cartesian3(),
        normal: new Cesium.Cartesian3(),
        savedPosition: new Cesium.Cartesian3(),
        savedVelocity: new Cesium.Cartesian3()
    };

    constructor() {
        this.reset();
    }

    // Modello di Terra attivo (vedi earth.js).
    get earth() {
        return this.useSphericalEarth ? SPHERICAL_EARTH : ELLIPSOIDAL_EARTH;
    }

    // Riporta la simulazione a t = 0, applicando le condizioni iniziali
    // correnti (modello di Terra e particelle).
    reset() {
        this.particle.reset(this.earth);
        this.time = 0;
    }

    // Porta lo stato esattamente all'istante "target" [s simulati]. È
    // idempotente: chiamata più volte con lo stesso istante integra una
    // sola volta. Un istante precedente riparte da t = 0.
    advanceTo(target) {
        if (target < this.time) {
            this.reset();
        }

        const remaining = target - this.time;
        if (remaining <= 0) {
            return;
        }

        const n = Math.min(Math.ceil(remaining / MAX_PHYSICS_STEP), MAX_SUBSTEPS);
        const h = remaining / n;
        for (let i = 0; i < n; i++) {
            this.#step(this.particle, h, 0);
        }

        this.time = target;
        this.particle.updateAltitude(this.earth);
        this.particle.recordTrajectory(target);
    }

    // --------------------------------------------------
    // INTEGRAZIONE E URTI
    // --------------------------------------------------

    // Vero se la particella compenetra la superficie e si sta ancora
    // avvicinando (dopo il rimbalzo la velocità normale è positiva).
    #isCollidingInward(particle) {
        const n = this.#scratch.normal;
        const c = particle.clearance(this.earth, n);
        if (!Cesium.defined(c) || c >= 0) {
            return false;
        }
        return Cesium.Cartesian3.dot(particle.state.velocity, n) < 0;
    }

    // Urto elastico senza attrito: inverte la componente normale della
    // velocità rispetto alla superficie nel punto di contatto.
    #reflectVelocity(particle) {
        const n = this.#scratch.normal;
        const v = particle.state.velocity;
        particle.clearance(this.earth, n);
        const vn = Cesium.Cartesian3.dot(v, n);
        if (vn < 0) {
            Cesium.Cartesian3.subtract(
                v, Cesium.Cartesian3.multiplyByScalar(n, 2 * vn, this.#scratch.temp), v
            );
        }
    }

    // Salva posizione e velocità della particella, per ripetere un passo
    // con durata diversa (ricerca dell'istante di contatto).
    #saveState(particle) {
        Cesium.Cartesian3.clone(particle.state.position, this.#scratch.savedPosition);
        Cesium.Cartesian3.clone(particle.state.velocity, this.#scratch.savedVelocity);
    }

    // Ripristina lo stato salvato da #saveState().
    #restoreState(particle) {
        Cesium.Cartesian3.clone(this.#scratch.savedPosition, particle.state.position);
        Cesium.Cartesian3.clone(this.#scratch.savedVelocity, particle.state.velocity);
    }

    // Un passo che gestisce l'urto all'istante esatto di contatto: se a
    // fine passo c'è compenetrazione, si cerca per bisezione l'istante del
    // contatto, si integra fino a lì, si riflette la velocità e si integra
    // il tempo rimanente.
    #step(particle, h, contacts) {
        this.#saveState(particle);
        this.#verletStep(particle, h);

        if (!this.#isCollidingInward(particle) || contacts >= MAX_CONTACTS_PER_STEP) {
            return;
        }

        let lo = 0;
        let hi = h;
        for (let i = 0; i < CONTACT_BISECTIONS; i++) {
            const mid = 0.5 * (lo + hi);
            this.#restoreState(particle);
            this.#verletStep(particle, mid);
            if (this.#isCollidingInward(particle)) {
                hi = mid;
            } else {
                lo = mid;
            }
        }

        this.#restoreState(particle);
        this.#verletStep(particle, hi);
        this.#reflectVelocity(particle);

        if (h - hi > 0) {
            this.#step(particle, h - hi, contacts + 1);
        }
    }

    // Velocity Verlet:
    //   p += v·h + ½·a0·h²
    //   v += ½·(a0 + a1)·h
    #verletStep(particle, h) {
        const C3 = Cesium.Cartesian3;
        const earth = this.earth;
        const p = particle.state.position;
        const v = particle.state.velocity;
        const temp = this.#scratch.temp;

        const a0 = earth.gravity(p, this.#scratch.accel0);
        C3.add(p, C3.multiplyByScalar(v, h, temp), p);
        C3.add(p, C3.multiplyByScalar(a0, 0.5 * h * h, temp), p);

        const a1 = earth.gravity(p, this.#scratch.accel1);
        C3.add(v, C3.multiplyByScalar(C3.add(a0, a1, temp), 0.5 * h, temp), v);
    }
}
