// ============================================================
// Strumenti comuni ai test unitari del modello.
// ============================================================

import * as Cesium from "cesium";
import { Earth } from "../src/model/earth.js";
import { RotationAxis } from "../src/model/rotationAxis.js";
import { SceneNode } from "../src/model/sceneNode.js";
import { Simulation } from "../src/model/simulation.js";

// Riferimento indipendente dal modello per le trasformazioni tra ECI ed
// ECEF: rotazione attorno all'asse Z di -angle (ECI -> ECEF) o di
// +angle (ECEF -> ECI), con "angle" l'angolo di cui la Terra ha ruotato.
export function eciToEcef(vector, angle) {
    return Cesium.Matrix3.multiplyByVector(Cesium.Matrix3.fromRotationZ(-angle), vector, new Cesium.Cartesian3());
}

export function ecefToEci(vector, angle) {
    return eciToEcef(vector, -angle);
}

// Gerarchia minima della scena: { eci: World, ecef: Terra }.
export function createSystemNodes() {
    const world = new SceneNode();
    const rotationAxis = world.addChild(new RotationAxis());
    const earth = world.addChild(new Earth(rotationAxis));
    return { eci: world, ecef: earth };
}

// Condizioni iniziali note (quota 225 km se non indicata).
function configureParticle(particle, options) {
    particle.setStartPoint(options.latitude ?? 45.0, options.longitude ?? 7.1);
    particle.setStartAltitude((options.altitudeKm ?? 225) * 1000);
    if (options.ecef) {
        particle.setVelocity("ecef", options.ecef);
    }
    if (options.eci) {
        particle.setVelocity("eci", options.eci);
    }
}

// Particella configurata e portata allo stato iniziale, inserita nella
// gerarchia della scena di una simulazione.
export function createParticle(options = {}) {
    return createSimulation(options).particle;
}

// Simulazione con la particella configurata, a t = 0.
export function createSimulation(options = {}) {
    const simulation = new Simulation();
    simulation.earth.spherical = options.spherical ?? true;
    configureParticle(simulation.particle, options);
    simulation.reset();
    return simulation;
}
