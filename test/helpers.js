// ============================================================
// Strumenti comuni ai test unitari del modello.
// ============================================================

import { ELLIPSOIDAL_EARTH, SPHERICAL_EARTH } from "../src/model/earth.js";
import { Particle } from "../src/model/particle.js";
import { Simulation } from "../src/model/simulation.js";

// Condizioni iniziali note (quota 225 km se non indicata).
function configureParticle(particle, options) {
    particle.setStartPoint(options.latitude ?? 45.0, options.longitude ?? 7.1);
    particle.setStartAltitude((options.altitudeKm ?? 225) * 1000);
    if (options.relative) {
        particle.setVelocity("relative", options.relative);
    }
    if (options.absolute) {
        particle.setVelocity("absolute", options.absolute);
    }
}

// Particella configurata e portata allo stato iniziale.
export function createParticle(options = {}) {
    const particle = new Particle();
    configureParticle(particle, options);
    particle.reset((options.spherical ?? true) ? SPHERICAL_EARTH : ELLIPSOIDAL_EARTH);
    return particle;
}

// Simulazione con la particella configurata, a t = 0.
export function createSimulation(options = {}) {
    const simulation = new Simulation();
    simulation.useSphericalEarth = options.spherical ?? true;
    configureParticle(simulation.particle, options);
    simulation.reset();
    return simulation;
}
