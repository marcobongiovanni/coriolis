// ============================================================
// Test unitari della particella: condizioni iniziali, loro regole
// di validità e stato iniziale.
// ============================================================

import { describe, it, expect } from "vitest";
import * as Cesium from "cesium";
import { enuRotation } from "../src/geometry/referenceFrames.js";
import { EARTH_RADIUS, SPHERICAL_EARTH } from "../src/model/earth.js";
import { DEFAULT_PARTICLE_RADIUS, Particle } from "../src/model/particle.js";
import { OMEGA, RotationAxis } from "../src/model/rotationAxis.js";
import { TRAJECTORY_MIN_DISTANCE, Trajectory } from "../src/model/trajectory.js";
import { createParticle, earthOf, eciToEcef } from "./helpers.js";

function dragVelocity(r) {
    return new Cesium.Cartesian3(-OMEGA * r.y, OMEGA * r.x, 0);
}

describe("condizioni iniziali", function () {
    it("predefinite: punto di riserva, quota 0, velocità relativa nulla", function () {
        const particle = new Particle(new RotationAxis());
        expect(particle.radius).toBe(DEFAULT_PARTICLE_RADIUS);
        expect(particle.startPoint.latitudeDeg).toBe(45);
        expect(particle.startPoint.longitudeDeg).toBe(7.1);
        expect(particle.start.altitude).toBe(0);
        expect(particle.velocityMaster).toBe("ecef");
        expect(particle.velocity.ecef.speedKmh).toBe(0);
    });

    it("la latitudine è limitata a ±90° e la longitudine avvolta in [0°, 360°)", function () {
        const particle = new Particle(new RotationAxis());
        particle.setStartPoint(120, -10);
        expect(particle.startPoint.latitudeDeg).toBe(90);
        expect(particle.startPoint.longitudeDeg).toBe(350);
        particle.setStartPoint(-95, 370);
        expect(particle.startPoint.latitudeDeg).toBe(-90);
        expect(particle.startPoint.longitudeDeg).toBeCloseTo(10, 12);
    });

    it("il punto sulla superficie segue latitudine e longitudine", function () {
        const particle = new Particle(new RotationAxis());
        particle.setStartPoint(30, 100);
        const expected = Cesium.Cartesian3.fromDegrees(100, 30, 0);
        expect(Cesium.Cartesian3.distance(particle.startPoint.position, expected)).toBeLessThan(1e-6);
    });

    it("la quota non è negativa", function () {
        const particle = new Particle(new RotationAxis());
        particle.setStartAltitude(-5000);
        expect(particle.start.altitude).toBe(0);
    });

    it("velocità: modulo non negativo, azimuth avvolto, elevazione limitata", function () {
        const particle = new Particle(new RotationAxis());
        particle.setVelocity("eci",{ speedKmh: -10, azimuthDeg: -1, elevationDeg: 120 });
        expect(particle.velocity.eci).toEqual({ speedKmh: 0, azimuthDeg: 359, elevationDeg: 90 });
        expect(particle.velocityMaster).toBe("eci");
    });

    it("il raggio è solo quello della sfera disegnata: il baricentro sta sulla superficie", function () {
        const particle = new Particle(new RotationAxis(), 1000);
        particle.setStartAltitude(0);
        particle.reset(SPHERICAL_EARTH);
        expect(Cesium.Cartesian3.magnitude(particle.initial.position)).toBeCloseTo(EARTH_RADIUS, 6);
        expect(Cesium.Cartesian3.magnitude(particle.initial.sphereCenter)).toBeCloseTo(EARTH_RADIUS + 1000, 6);
        expect(particle.state.altitude).toBeCloseTo(0, 6);
    });
});

describe("stato iniziale", function () {
    it.each([true, false])("la quota iniziale è quella impostata (Terra sferica: %s)", function (spherical) {
        const particle = createParticle({ spherical, altitudeKm: 300 });
        expect(particle.state.altitude).toBeCloseTo(300000, 3);
    });

    it("con Terra sferica baricentro e centro della sfera sono sulla verticale radiale del punto", function () {
        const particle = createParticle({ latitude: 30, longitude: 100 });
        const surface = Cesium.Cartesian3.fromDegrees(100, 30, 0);
        const { position, sphereCenter } = particle.initial;
        expect(Cesium.Cartesian3.angleBetween(position, surface)).toBeLessThan(1e-12);
        expect(Cesium.Cartesian3.angleBetween(sphereCenter, surface)).toBeLessThan(1e-12);
        expect(Cesium.Cartesian3.magnitude(position)).toBeCloseTo(EARTH_RADIUS + 225000, 3);
        expect(Cesium.Cartesian3.magnitude(sphereCenter)).toBeCloseTo(EARTH_RADIUS + 225000 + DEFAULT_PARTICLE_RADIUS, 3);
    });

    it("con Terra ellissoidale baricentro e centro della sfera sono sulla normale geodetica", function () {
        const particle = createParticle({ spherical: false, latitude: 30, longitude: 100 });
        const { position, sphereCenter } = particle.initial;
        const expectedPosition = Cesium.Cartesian3.fromDegrees(100, 30, 225000);
        const expectedCenter = Cesium.Cartesian3.fromDegrees(100, 30, 225000 + DEFAULT_PARTICLE_RADIUS);
        expect(Cesium.Cartesian3.distance(position, expectedPosition)).toBeLessThan(1e-3);
        expect(Cesium.Cartesian3.distance(sphereCenter, expectedCenter)).toBeLessThan(1e-3);
    });

    it("reset riporta lo stato corrente a quello iniziale", function () {
        const particle = createParticle();
        particle.state.position.x += 1e6;
        particle.reset(SPHERICAL_EARTH);
        expect(Cesium.Cartesian3.equals(particle.state.position, particle.initial.position)).toBe(true);
    });
});

describe("velocità iniziale relativa (ECEF) e assoluta (ECI)", function () {
    function expectCoherent(particle) {
        const expected = Cesium.Cartesian3.add(
            particle.initial.velocity.ecef,
            dragVelocity(particle.initial.position),
            new Cesium.Cartesian3()
        );
        expect(Cesium.Cartesian3.distance(particle.initial.velocity.eci, expected)).toBeLessThan(1e-9);
    }

    it("relativa nulla: l'assoluta è la velocità di trascinamento ω·ρ verso Est", function () {
        const particle = createParticle();
        const r = particle.initial.position;
        const absolute = particle.velocity.eci;
        expect(absolute.speedKmh).toBeCloseTo(OMEGA * Math.hypot(r.x, r.y) * 3.6, 6);
        expect(absolute.azimuthDeg).toBeCloseTo(90, 9);
        expect(absolute.elevationDeg).toBeCloseTo(0, 9);
        expectCoherent(particle);
    });

    it("assoluta nulla: la relativa ha lo stesso modulo verso Ovest", function () {
        const particle = createParticle({ eci: { speedKmh: 0 } });
        expect(Cesium.Cartesian3.magnitude(particle.initial.velocity.eci)).toBe(0);
        expect(particle.velocity.ecef.azimuthDeg).toBeCloseTo(270, 9);
        expectCoherent(particle);
    });

    it.each([
        { speedKmh: 1000, azimuthDeg: 45, elevationDeg: 30 },
        { speedKmh: 20000, azimuthDeg: 180, elevationDeg: -10 },
        { speedKmh: 5, azimuthDeg: 300, elevationDeg: 80 }
    ])("v_ECI = v_ECEF + ω × r (relativa %o)", function (relative) {
        const particle = createParticle({ ecef: relative });
        expect(Cesium.Cartesian3.magnitude(particle.initial.velocity.ecef) * 3.6)
            .toBeCloseTo(relative.speedKmh, 6);
        expectCoherent(particle);
    });

    it("partendo dall'assoluta calcolata si ritrova la relativa impostata", function () {
        const first = createParticle({ ecef: {speedKmh: 1000, azimuthDeg: 45, elevationDeg: 30 } });
        const second = createParticle({ eci: { ...first.velocity.eci } });
        expect(second.velocity.ecef.speedKmh).toBeCloseTo(1000, 6);
        expect(second.velocity.ecef.azimuthDeg).toBeCloseTo(45, 6);
        expect(second.velocity.ecef.elevationDeg).toBeCloseTo(30, 6);
    });

    it("la velocità relativa dello stato iniziale coincide con quella impostata", function () {
        const particle = createParticle({ ecef: {speedKmh: 1000, azimuthDeg: 45, elevationDeg: 30 } });
        const rel = particle.velocityArrows.ecef.value(0);
        expect(Cesium.Cartesian3.distance(rel, particle.initial.velocity.ecef)).toBeLessThan(1e-9);
    });
});

describe("frecce della velocità", function () {
    it("assoluto = v, relativo = v - ω × r, e seguono lo stato corrente", function () {
        const particle = createParticle({ ecef: {speedKmh: 1000, azimuthDeg: 45, elevationDeg: 30 } });
        particle.state.velocity.z += 50;
        const { position, velocity } = particle.state;
        const expectedRelative = Cesium.Cartesian3.subtract(velocity, dragVelocity(position), new Cesium.Cartesian3());
        expect(Cesium.Cartesian3.equals(particle.velocityArrows.eci.value(0), velocity)).toBe(true);
        expect(Cesium.Cartesian3.distance(particle.velocityArrows.ecef.value(0), expectedRelative)).toBeLessThan(1e-9);
    });

    it("in ECEF: applicate nel centro della sfera e ruotate con la Terra", function () {
        const particle = createParticle({ ecef: {speedKmh: 1000, azimuthDeg: 45, elevationDeg: 30 } });
        const t = 1800;
        const { position: origin, vector } = particle.velocityArrows.eci.expressedIn(earthOf(particle), t);
        expect(Cesium.Cartesian3.distance(origin, eciToEcef(particle.state.sphereCenter, OMEGA * t))).toBeLessThan(1e-6);
        expect(Cesium.Cartesian3.distance(vector, eciToEcef(particle.state.velocity, OMEGA * t))).toBeLessThan(1e-9);
    });
});

describe("terne nel punto di partenza", function () {
    it("hanno origine nel centro iniziale della sfera e assi Est, Nord, Su", function () {
        const particle = createParticle({ latitude: 30, longitude: 100 });
        const enu = enuRotation(particle.initial.normal);
        Object.values(particle.startFrames).forEach((frame) => {
            const { position: origin, axes } = frame.poseIn(earthOf(particle), 0);
            expect(Cesium.Cartesian3.distance(origin, particle.initial.sphereCenter)).toBeLessThan(1e-6);
            axes.forEach((axis, i) => {
                const expected = Cesium.Matrix3.getColumn(enu, i, new Cesium.Cartesian3());
                expect(Cesium.Cartesian3.distance(axis, expected)).toBeLessThan(1e-12);
            });
        });
    });

    it("l'asse Su è la normale locale: radiale (sfera) o geodetica (ellissoide)", function () {
        const up = (particle) => particle.startFrames.ecef.axes[2];

        const spherical = createParticle({ latitude: 45, longitude: 7.1 });
        const radial = Cesium.Cartesian3.normalize(spherical.initial.position, new Cesium.Cartesian3());
        expect(Cesium.Cartesian3.distance(up(spherical), radial)).toBeLessThan(1e-12);

        const ellipsoidal = createParticle({ spherical: false, latitude: 45, longitude: 7.1 });
        const wgs84 = Cesium.Ellipsoid.WGS84;
        const geodetic = wgs84.geodeticSurfaceNormal(wgs84.scaleToGeodeticSurface(ellipsoidal.initial.position));
        expect(Cesium.Cartesian3.distance(up(ellipsoidal), geodetic)).toBeLessThan(1e-12);
    });

    it("vista dalla Terra, la terna ECEF resta ferma e quella ECI ruota", function () {
        const particle = createParticle();
        const t = 3600;
        const ecef = particle.startFrames.ecef.poseIn(earthOf(particle), t);
        const eci = particle.startFrames.eci.poseIn(earthOf(particle), t);
        expect(Cesium.Cartesian3.distance(ecef.position, particle.initial.sphereCenter)).toBeLessThan(1e-6);
        const rotated = eciToEcef(particle.initial.sphereCenter, OMEGA * t);
        expect(Cesium.Cartesian3.distance(eci.position, rotated)).toBeLessThan(1e-6);
    });

    it("seguono il punto di partenza al reset", function () {
        const particle = createParticle();
        particle.setStartPoint(-20, 200);
        particle.reset(SPHERICAL_EARTH);
        const { position: origin } = particle.startFrames.ecef.poseIn(earthOf(particle), 0);
        expect(Cesium.Cartesian3.distance(origin, particle.initial.sphereCenter)).toBeLessThan(1e-6);
    });
});

describe("traiettorie", function () {
    it("scartano i punti più vicini di TRAJECTORY_MIN_DISTANCE all'ultimo", function () {
        const trajectory = new Trajectory();
        trajectory.addPoint(new Cesium.Cartesian3(0, 0, 0));
        trajectory.addPoint(new Cesium.Cartesian3(TRAJECTORY_MIN_DISTANCE / 2, 0, 0));
        trajectory.addPoint(new Cesium.Cartesian3(TRAJECTORY_MIN_DISTANCE, 0, 0));
        expect(trajectory.points).toHaveLength(2);
    });

    it("conservano copie dei punti e clear aumenta la revisione", function () {
        const trajectory = new Trajectory();
        const p = new Cesium.Cartesian3(1, 2, 3);
        trajectory.addPoint(p);
        p.x = 100;
        expect(trajectory.points[0].x).toBe(1);
        trajectory.clear();
        expect(trajectory.points).toHaveLength(0);
        expect(trajectory.revision).toBe(1);
    });

    it("dopo il reset contengono solo il centro iniziale della sfera", function () {
        const particle = createParticle();
        Object.values(particle.trajectories).forEach((trajectory) => {
            expect(trajectory.points).toHaveLength(1);
            expect(Cesium.Cartesian3.distance(trajectory.points[0], particle.initial.sphereCenter)).toBeLessThan(1e-6);
        });
    });

    it("la traiettoria ECEF è quella ECI vista dalla Terra in rotazione", function () {
        const particle = createParticle();
        particle.state.sphereCenter.x += 1e5;
        particle.recordTrajectory(1800);
        const eci = particle.trajectories.eci.points[1];
        const ecef = particle.trajectories.ecef.points[1];
        expect(Cesium.Cartesian3.distance(eciToEcef(eci, OMEGA * 1800), ecef)).toBeLessThan(1e-6);
    });
});
