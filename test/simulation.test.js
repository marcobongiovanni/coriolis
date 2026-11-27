// ============================================================
// Test unitari dei modelli di Terra e della dinamica (Vitest, in Node).
//
//   npm test            esegue tutti i test una volta
//   npm run test:watch  li riesegue a ogni modifica
// ============================================================

import { describe, it, expect } from "vitest";
import * as Cesium from "cesium";
import { OMEGA } from "../src/model/rotationAxis.js";
import {
    EARTH_RADIUS,
    ELLIPSOIDAL_EARTH,
    EQUATORIAL_RADIUS,
    GM,
    J2,
    J4,
    SPHERICAL_EARTH
} from "../src/model/earth.js";
import { Simulation } from "../src/model/simulation.js";
import { createSimulation, eciToEcef } from "./helpers.js";

// Latitudine geodetica [°] della particella all'istante t (s).
function latitudeAt(simulation, t) {
    const ecef = eciToEcef(simulation.particle.state.position, OMEGA * t);
    return Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(ecef).latitude);
}

// --------------------------------------------------
// Modelli di Terra
// --------------------------------------------------

describe("gravità", function () {
    it("Terra sferica: modulo GM/r² diretto verso il centro", function () {
        const p = new Cesium.Cartesian3(7e6, 1e6, 2e6);
        const a = SPHERICAL_EARTH.gravity(p, new Cesium.Cartesian3());
        const r = Cesium.Cartesian3.magnitude(p);
        expect(Cesium.Cartesian3.magnitude(a)).toBeCloseTo(GM / (r * r), 9);
        const toCenter = Cesium.Cartesian3.negate(p, new Cesium.Cartesian3());
        expect(Cesium.Cartesian3.angleBetween(a, toCenter)).toBeLessThan(1e-12);
    });

    it("Terra ellissoidale: J2 e J4 rinforzano la gravità all'equatore e la indeboliscono ai poli", function () {
        const r = EQUATORIAL_RADIUS;
        const pointMass = GM / (r * r);

        const equator = ELLIPSOIDAL_EARTH.gravity(new Cesium.Cartesian3(r, 0, 0), new Cesium.Cartesian3());
        expect(-equator.x / pointMass).toBeCloseTo(1 + 1.5 * J2 - 1.875 * J4, 12);

        const pole = ELLIPSOIDAL_EARTH.gravity(new Cesium.Cartesian3(0, 0, r), new Cesium.Cartesian3());
        expect(-pole.z / pointMass).toBeCloseTo(1 - 3 * J2 - 5 * J4, 12);
    });

    it.each([
        ["sferica", SPHERICAL_EARTH],
        ["ellissoidale", ELLIPSOIDAL_EARTH]
    ])("Terra %s: la gravità è il gradiente del potenziale", function (name, earth) {
        const C3 = Cesium.Cartesian3;
        const h = 1; // [m] passo delle differenze finite
        [new C3(4e6, 3e6, 4.5e6), new C3(6.4e6, 0, 0), new C3(0, 0, 6.36e6)].forEach((p) => {
            const gradient = ["x", "y", "z"].map((axis) => {
                const plus = C3.clone(p);
                const minus = C3.clone(p);
                plus[axis] += h;
                minus[axis] -= h;
                return -(earth.potential(plus) - earth.potential(minus)) / (2 * h);
            });
            const gravity = earth.gravity(p, new C3());
            expect(C3.distance(gravity, new C3(...gradient)) / C3.magnitude(gravity)).toBeLessThan(1e-8);
        });
    });

    it("la Terra ruota attorno all'asse Z con velocità angolare OMEGA", function () {
        const { rotationAxis } = new Simulation();
        expect(Cesium.Cartesian3.equals(rotationAxis.direction, Cesium.Cartesian3.UNIT_Z)).toBe(true);
        expect(rotationAxis.angularVelocity).toBe(OMEGA);
    });

    it("la velocità relativa usa la rotazione dell'asse della simulazione", function () {
        const simulation = createSimulation({ ecef: { speedKmh: 1000, azimuthDeg: 90 } });
        const { particle, rotationAxis } = simulation;
        rotationAxis.angularVelocity = 2 * OMEGA;
        const { position, velocity } = particle.state;
        const drag = new Cesium.Cartesian3(-2 * OMEGA * position.y, 2 * OMEGA * position.x, 0);
        const expected = Cesium.Cartesian3.subtract(velocity, drag, new Cesium.Cartesian3());
        expect(Cesium.Cartesian3.distance(particle.velocityArrows.ecef.value(0), expected)).toBeLessThan(1e-9);
    });

    it("la freccia di Coriolis rappresenta la componente orizzontale di -2 ω × v_rel", function () {
        const C3 = Cesium.Cartesian3;
        const simulation = createSimulation({ ecef: { speedKmh: 1000, azimuthDeg: 0 } });
        simulation.advanceTo(1800);
        const { particle, earth } = simulation;
        const t = 1800;
        // Velocità relativa e normale locale nel sistema della Terra.
        const relative = particle.velocityArrows.ecef.expressedIn(earth, t).vector;
        const normal = particle.vectorTo(earth, t, particle.state.normal);
        const omega = new C3(0, 0, OMEGA);
        const full = C3.multiplyByScalar(C3.cross(omega, relative, new C3()), -2, new C3());
        const expected = C3.subtract(full, C3.multiplyByScalar(normal, C3.dot(full, normal), new C3()), new C3());

        const { position, vector } = particle.coriolisArrow.expressedIn(earth, t);
        expect(C3.distance(vector, expected)).toBeLessThan(1e-12);
        // Orizzontale (perpendicolare alla normale), non nulla, applicata
        // nel centro della sfera.
        expect(C3.dot(vector, normal)).toBeCloseTo(0, 12);
        expect(C3.magnitude(vector)).toBeGreaterThan(1e-3);
        expect(C3.distance(position, particle.pointTo(earth, t, particle.state.sphereCenter))).toBeLessThan(1e-6);
    });

    it("la Terra usa il modello scelto", function () {
        const simulation = new Simulation();
        expect(simulation.earth.model).toBe(SPHERICAL_EARTH);
        simulation.earth.spherical = false;
        expect(simulation.earth.model).toBe(ELLIPSOIDAL_EARTH);
    });
});

describe("distanza dalla superficie", function () {
    it("Terra sferica", function () {
        const n = new Cesium.Cartesian3();
        const p = new Cesium.Cartesian3(0, EARTH_RADIUS + 1234, 0);
        expect(SPHERICAL_EARTH.heightAboveSurface(p, n)).toBeCloseTo(1234, 6);
        expect(n.y).toBeCloseTo(1, 12);
    });

    it("Terra ellissoidale: coincide con la quota geodetica", function () {
        const n = new Cesium.Cartesian3();
        const p = Cesium.Cartesian3.fromDegrees(12, 41.9, 5000);
        expect(ELLIPSOIDAL_EARTH.heightAboveSurface(p, n)).toBeCloseTo(5000, 3);
    });

    it.each([
        ["sferica", SPHERICAL_EARTH],
        ["ellissoidale", ELLIPSOIDAL_EARTH]
    ])("Terra %s: pointAboveSurface è alla quota richiesta", function (name, earth) {
        const surface = Cesium.Cartesian3.fromDegrees(-60, 20, 0);
        const point = earth.pointAboveSurface(surface, 7000, new Cesium.Cartesian3());
        expect(earth.heightAboveSurface(point, new Cesium.Cartesian3())).toBeCloseTo(7000, 3);
    });
});

// --------------------------------------------------
// Simulazione
// --------------------------------------------------

describe("simulazione", function () {
    it("all'avvio: Terra sferica, t = 0, particella a quota 0", function () {
        const simulation = new Simulation();
        expect(simulation.earth.spherical).toBe(true);
        expect(simulation.time).toBe(0);
        expect(simulation.particle.state.altitude).toBeCloseTo(0, 6);
    });

    it("le condizioni iniziali hanno effetto al reset, che riporta a t = 0", function () {
        const simulation = createSimulation();
        simulation.advanceTo(1000);
        simulation.particle.setStartPosition({ altitude: 300000 });
        simulation.reset();
        expect(simulation.time).toBe(0);
        expect(simulation.particle.state.altitude).toBeCloseTo(300000, 3);
    });

    it("cambiare modello di Terra sposta la partenza sulla nuova superficie", function () {
        const simulation = createSimulation({ latitude: 30 });
        simulation.earth.spherical = false;
        simulation.reset();
        const expected = Cesium.Cartesian3.fromDegrees(7.1, 30, 225000);
        expect(Cesium.Cartesian3.distance(simulation.particle.initial.position, expected)).toBeLessThan(1e-3);
    });
});

describe("dinamica", function () {
    it("avanzare due volte allo stesso istante non cambia lo stato", function () {
        const simulation = createSimulation();
        const state = simulation.particle.state;
        simulation.advanceTo(1000);
        const p = Cesium.Cartesian3.clone(state.position);
        simulation.advanceTo(1000);
        expect(Cesium.Cartesian3.equals(p, state.position)).toBe(true);
    });

    it("registra la traiettoria a ogni nuovo istante raggiunto", function () {
        const simulation = createSimulation();
        const trajectory = simulation.particle.trajectories.eci;
        simulation.advanceTo(100);
        simulation.advanceTo(100);
        simulation.advanceTo(200);
        expect(trajectory.points).toHaveLength(3);
        expect(Cesium.Cartesian3.equals(trajectory.points[2], simulation.particle.state.sphereCenter)).toBe(true);
    });

    it("tornare indietro nel tempo riparte dallo stato iniziale (Reset)", function () {
        const simulation = createSimulation();
        const particle = simulation.particle;
        simulation.advanceTo(5000);
        simulation.advanceTo(0);
        expect(Cesium.Cartesian3.distance(particle.state.position, particle.initial.position)).toBeLessThan(1e-6);
        expect(simulation.time).toBe(0);
    });

    it("il risultato non dipende dalla durata dei frame", function () {
        const simulation = createSimulation();
        const state = simulation.particle.state;
        simulation.advanceTo(3000);
        const oneStep = Cesium.Cartesian3.clone(state.position);

        simulation.reset();
        for (let t = 7; t < 3000; t += 7) {
            simulation.advanceTo(t);
        }
        simulation.advanceTo(3000);
        // Differenza ammessa: errore di integrazione, molto minore
        // delle distanze in gioco.
        expect(Cesium.Cartesian3.distance(oneStep, state.position)).toBeLessThan(10);
    });

    it("la particella rimbalza e non penetra mai la superficie", function () {
        const simulation = createSimulation();
        const state = simulation.particle.state;
        let minAltitude = Infinity;
        let bounces = 0;
        let previousRadialSpeed = 0;
        for (let t = 10; t <= 20000; t += 10) {
            simulation.advanceTo(t);
            minAltitude = Math.min(minAltitude, state.altitude);
            const radial = Cesium.Cartesian3.dot(
                state.velocity,
                Cesium.Cartesian3.normalize(state.position, new Cesium.Cartesian3())
            );
            if (previousRadialSpeed < 0 && radial > 0 && state.altitude < 50000) {
                bounces++;
            }
            previousRadialSpeed = radial;
        }
        expect(bounces).toBeGreaterThan(10);
        expect(minAltitude).toBeGreaterThan(-1); // tolleranza: 1 m
    });

    it.each([true, false])("conserva l'energia meccanica (Terra sferica: %s)", function (spherical) {
        const simulation = createSimulation({
            spherical,
            ecef: { speedKmh: 3000, azimuthDeg: 30, elevationDeg: 20 }
        });
        const particle = simulation.particle;
        const e0 = particle.mechanicalEnergy(simulation.earth.model);
        for (let t = 100; t <= 30000; t += 100) {
            simulation.advanceTo(t);
        }
        expect(Math.abs((particle.mechanicalEnergy(simulation.earth.model) - e0) / e0)).toBeLessThan(1e-8);
    });

    it("ferma in ECI su Terra sferica: resta sulla stessa verticale inerziale", function () {
        const simulation = createSimulation({ eci: { speedKmh: 0 } });
        const particle = simulation.particle;
        const start = Cesium.Cartesian3.clone(particle.initial.position);
        for (let t = 100; t <= 40000; t += 100) {
            simulation.advanceTo(t);
            expect(Cesium.Cartesian3.angleBetween(particle.state.position, start)).toBeLessThan(1e-9);
        }
    });

    it("ferma rispetto alla Terra su Terra sferica: deriva verso l'equatore", function () {
        // Comportamento fisico atteso (non un errore): senza attrito
        // nessuna forza mantiene la particella sul parallelo.
        const simulation = createSimulation();
        simulation.advanceTo(7200);
        expect(latitudeAt(simulation, 7200)).toBeLessThan(43);
    });

    it("ferma rispetto alla Terra su ellissoide con J2 e J4: deriva molto minore", function () {
        const simulation = createSimulation({ spherical: false });
        simulation.advanceTo(7200);
        expect(Math.abs(latitudeAt(simulation, 7200) - 45)).toBeLessThan(1);
    });

    it.each([0, 30, 45, 60, 80])(
        "ferma rispetto alla Terra sulla superficie dell'ellissoide (latitudine %d°): resta ferma",
        function (latitude) {
            // Baricentro sulla superficie WGS84, equipotenziale a meno
            // dei termini oltre J4: dopo 2 ore lo spostamento è di pochi
            // metri (senza J4 erano centinaia di metri, con il baricentro
            // al centro della sfera decine di chilometri).
            const simulation = createSimulation({ spherical: false, altitudeKm: 0, latitude });
            const particle = simulation.particle;
            for (let t = 60; t <= 7200; t += 60) {
                simulation.advanceTo(t);
            }
            const end = eciToEcef(particle.state.position, OMEGA * 7200);
            expect(Cesium.Cartesian3.distance(end, particle.initial.position)).toBeLessThan(10);
            expect(Math.abs(particle.state.altitude)).toBeLessThan(1);
        }
    );
});
