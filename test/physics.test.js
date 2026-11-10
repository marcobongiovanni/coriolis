// ============================================================
// Test unitari della fisica (Vitest, in Node).
//
//   npm test            esegue tutti i test una volta
//   npm run test:watch  li riesegue a ogni modifica
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import * as Cesium from "cesium";
import {
    OMEGA,
    GM,
    J2,
    EARTH_RADIUS,
    EQUATORIAL_RADIUS,
    SPHERE_RADIUS,
    settings,
    velocityRelative,
    velocityAbsolute,
    spherePositionECI_initial,
    sphereVelocityECI_initial,
    sphereVelocityECEF_initial,
    physics,
    eciToEcef,
    ecefToEci,
    normalizeLongitude,
    setStartPoint,
    sphericalToEnu,
    enuToSpherical,
    gravityAcceleration,
    heightAboveSurface,
    computeInitialState,
    resetPhysics,
    advancePhysicsToSeconds,
    relativeVelocityECI,
    mechanicalEnergy
} from "../src/physics.js";

// --------------------------------------------------
// Strumenti
// --------------------------------------------------

// Il modulo della fisica ha uno stato condiviso: ogni test parte
// da una configurazione nota, come dopo un Reset nell'interfaccia.
function configure(options = {}) {
    settings.useSphericalEarth = options.spherical ?? true;
    setStartPoint(options.latitude ?? 45.0, options.longitude ?? 7.1);
    settings.startAltitude = (options.altitudeKm ?? 225) * 1000;

    Object.assign(velocityRelative, { speedKmh: 0, azimuthDeg: 0, elevationDeg: 0 });
    Object.assign(velocityAbsolute, { speedKmh: 0, azimuthDeg: 0, elevationDeg: 0 });
    settings.velocityMaster = "relative";
    if (options.relative) {
        Object.assign(velocityRelative, options.relative);
        settings.velocityMaster = "relative";
    }
    if (options.absolute) {
        Object.assign(velocityAbsolute, options.absolute);
        settings.velocityMaster = "absolute";
    }

    computeInitialState();
    resetPhysics();
}

// Posizione della sfera in ECEF all'istante t (s).
function positionEcefAt(t) {
    return eciToEcef(physics.position, OMEGA * t);
}

function geodeticDeg(cartesian) {
    const c = Cesium.Cartographic.fromCartesian(cartesian);
    return {
        latitude: Cesium.Math.toDegrees(c.latitude),
        longitude: Cesium.Math.toDegrees(c.longitude)
    };
}

// Angolo [rad] tra due vettori.
function angleBetween(a, b) {
    return Cesium.Cartesian3.angleBetween(a, b);
}

function dragVelocity(r) {
    return new Cesium.Cartesian3(-OMEGA * r.y, OMEGA * r.x, 0);
}

beforeEach(function () {
    configure();
});

// --------------------------------------------------
// Trasformazioni e utilità
// --------------------------------------------------

describe("trasformazioni ECI <-> ECEF", function () {
    it("ecefToEci annulla eciToEcef", function () {
        const p = new Cesium.Cartesian3(1234567, -7654321, 3456789);
        const back = ecefToEci(eciToEcef(p, 1.234), 1.234);
        expect(Cesium.Cartesian3.distance(p, back)).toBeLessThan(1e-6);
    });

    it("ruota attorno a Z di -angolo (verso della rotazione terrestre)", function () {
        // Dopo un quarto di giro un punto fisso in ECI sull'asse X
        // si trova, rispetto alla Terra, sull'asse -Y (cioè a ovest).
        const p = eciToEcef(new Cesium.Cartesian3(1, 0, 0), Math.PI / 2);
        expect(p.x).toBeCloseTo(0, 12);
        expect(p.y).toBeCloseTo(-1, 12);
        expect(p.z).toBe(0);
    });

    it("non modifica la componente Z", function () {
        const p = eciToEcef(new Cesium.Cartesian3(3, 4, 5), 0.7);
        expect(p.z).toBe(5);
    });
});

describe("longitudine", function () {
    it.each([
        [0, 0],
        [359, 359],
        [360, 0],
        [-1, 359],
        [725, 5],
        [-370, 350]
    ])("normalizeLongitude(%d) = %d", function (input, expected) {
        expect(normalizeLongitude(input)).toBeCloseTo(expected, 12);
    });

    it("setStartPoint limita la latitudine a ±90°", function () {
        setStartPoint(120, 10);
        expect(settings.startLatitudeDeg).toBe(90);
        setStartPoint(-95, 10);
        expect(settings.startLatitudeDeg).toBe(-90);
    });
});

describe("conversioni modulo/azimuth/elevazione <-> ENU", function () {
    it.each([
        [1000, 0, 0],
        [1000, 90, 0],
        [1000, 225, 30],
        [500, 359, -45],
        [3600, 10, 89]
    ])("andata e ritorno: %d km/h, az %d°, el %d°", function (speedKmh, azimuthDeg, elevationDeg) {
        const local = sphericalToEnu({ speedKmh, azimuthDeg, elevationDeg });
        const v = { speedKmh: 0, azimuthDeg: 0, elevationDeg: 0 };
        enuToSpherical(local, v);
        expect(v.speedKmh).toBeCloseTo(speedKmh, 9);
        expect(v.azimuthDeg).toBeCloseTo(azimuthDeg, 9);
        expect(v.elevationDeg).toBeCloseTo(elevationDeg, 9);
    });

    it("azimuth 90° è verso Est, 0° verso Nord", function () {
        const east = sphericalToEnu({ speedKmh: 3.6, azimuthDeg: 90, elevationDeg: 0 });
        expect(east.x).toBeCloseTo(1, 12);
        expect(east.y).toBeCloseTo(0, 12);
        const north = sphericalToEnu({ speedKmh: 3.6, azimuthDeg: 0, elevationDeg: 0 });
        expect(north.y).toBeCloseTo(1, 12);
    });

    it("con modulo nullo conserva gli angoli precedenti", function () {
        const v = { speedKmh: 5, azimuthDeg: 123, elevationDeg: 12 };
        enuToSpherical(new Cesium.Cartesian3(0, 0, 0), v);
        expect(v).toEqual({ speedKmh: 0, azimuthDeg: 123, elevationDeg: 12 });
    });
});

// --------------------------------------------------
// Stato iniziale
// --------------------------------------------------

describe("stato iniziale", function () {
    it.each([true, false])("la quota iniziale è quella impostata (Terra sferica: %s)", function (spherical) {
        configure({ spherical, altitudeKm: 300 });
        expect(physics.altitude).toBeCloseTo(300000, 3);
    });

    it("con Terra sferica la sfera parte sulla verticale radiale del punto", function () {
        configure({ latitude: 30, longitude: 100 });
        const surface = Cesium.Cartesian3.fromDegrees(100, 30, 0);
        expect(angleBetween(spherePositionECI_initial, surface)).toBeLessThan(1e-12);
        expect(Cesium.Cartesian3.magnitude(spherePositionECI_initial))
            .toBeCloseTo(EARTH_RADIUS + SPHERE_RADIUS + 225000, 3);
    });

    it("con Terra ellissoidale la sfera parte lungo la normale geodetica", function () {
        configure({ spherical: false, latitude: 30, longitude: 100 });
        const expected = Cesium.Cartesian3.fromDegrees(100, 30, SPHERE_RADIUS + 225000);
        expect(Cesium.Cartesian3.distance(spherePositionECI_initial, expected)).toBeLessThan(1e-3);
    });
});

describe("velocità iniziale relativa (ECEF) e assoluta (ECI)", function () {
    function expectCoherent() {
        const expected = Cesium.Cartesian3.add(
            sphereVelocityECEF_initial,
            dragVelocity(spherePositionECI_initial),
            new Cesium.Cartesian3()
        );
        expect(Cesium.Cartesian3.distance(sphereVelocityECI_initial, expected)).toBeLessThan(1e-9);
    }

    it("relativa nulla: l'assoluta è la velocità di trascinamento ω·ρ verso Est", function () {
        const r = spherePositionECI_initial;
        const rho = Math.hypot(r.x, r.y);
        expect(velocityAbsolute.speedKmh).toBeCloseTo(OMEGA * rho * 3.6, 6);
        expect(velocityAbsolute.azimuthDeg).toBeCloseTo(90, 9);
        expect(velocityAbsolute.elevationDeg).toBeCloseTo(0, 9);
        expectCoherent();
    });

    it("assoluta nulla: la relativa ha lo stesso modulo verso Ovest", function () {
        configure({ absolute: { speedKmh: 0 } });
        expect(Cesium.Cartesian3.magnitude(sphereVelocityECI_initial)).toBe(0);
        expect(velocityRelative.azimuthDeg).toBeCloseTo(270, 9);
        expectCoherent();
    });

    it.each([
        { speedKmh: 1000, azimuthDeg: 45, elevationDeg: 30 },
        { speedKmh: 20000, azimuthDeg: 180, elevationDeg: -10 },
        { speedKmh: 5, azimuthDeg: 300, elevationDeg: 80 }
    ])("v_ECI = v_ECEF + ω × r (relativa %o)", function (relative) {
        configure({ relative });
        expect(Cesium.Cartesian3.magnitude(sphereVelocityECEF_initial) * 3.6)
            .toBeCloseTo(relative.speedKmh, 6);
        expectCoherent();
    });

    it("partendo dall'assoluta calcolata si ritrova la relativa impostata", function () {
        configure({ relative: { speedKmh: 1000, azimuthDeg: 45, elevationDeg: 30 } });
        const absolute = { ...velocityAbsolute };
        configure({ absolute });
        expect(velocityRelative.speedKmh).toBeCloseTo(1000, 6);
        expect(velocityRelative.azimuthDeg).toBeCloseTo(45, 6);
        expect(velocityRelative.elevationDeg).toBeCloseTo(30, 6);
    });

    it("la velocità relativa dello stato iniziale coincide con quella impostata", function () {
        configure({ relative: { speedKmh: 1000, azimuthDeg: 45, elevationDeg: 30 } });
        const rel = relativeVelocityECI(new Cesium.Cartesian3());
        expect(Cesium.Cartesian3.distance(rel, sphereVelocityECEF_initial)).toBeLessThan(1e-9);
    });
});

// --------------------------------------------------
// Gravità e superficie
// --------------------------------------------------

describe("gravità", function () {
    it("Terra sferica: modulo GM/r² diretto verso il centro", function () {
        const p = new Cesium.Cartesian3(7e6, 1e6, 2e6);
        const a = gravityAcceleration(p, new Cesium.Cartesian3());
        const r = Cesium.Cartesian3.magnitude(p);
        expect(Cesium.Cartesian3.magnitude(a)).toBeCloseTo(GM / (r * r), 9);
        expect(angleBetween(a, Cesium.Cartesian3.negate(p, new Cesium.Cartesian3())))
            .toBeLessThan(1e-12);
    });

    it("Terra ellissoidale: J2 rinforza la gravità all'equatore e la indebolisce ai poli", function () {
        settings.useSphericalEarth = false;
        const r = EQUATORIAL_RADIUS;
        const pointMass = GM / (r * r);

        const equator = gravityAcceleration(new Cesium.Cartesian3(r, 0, 0), new Cesium.Cartesian3());
        expect(-equator.x / pointMass).toBeCloseTo(1 + 1.5 * J2, 12);

        const pole = gravityAcceleration(new Cesium.Cartesian3(0, 0, r), new Cesium.Cartesian3());
        expect(-pole.z / pointMass).toBeCloseTo(1 - 3 * J2, 12);
    });
});

describe("distanza dalla superficie", function () {
    it("Terra sferica", function () {
        const n = new Cesium.Cartesian3();
        const p = new Cesium.Cartesian3(0, EARTH_RADIUS + 1234, 0);
        expect(heightAboveSurface(p, n)).toBeCloseTo(1234, 6);
        expect(n.y).toBeCloseTo(1, 12);
    });

    it("Terra ellissoidale: coincide con la quota geodetica", function () {
        settings.useSphericalEarth = false;
        const n = new Cesium.Cartesian3();
        const p = Cesium.Cartesian3.fromDegrees(12, 41.9, 5000);
        expect(heightAboveSurface(p, n)).toBeCloseTo(5000, 3);
    });
});

// --------------------------------------------------
// Dinamica
// --------------------------------------------------

describe("dinamica", function () {
    it("avanzare due volte allo stesso istante non cambia lo stato", function () {
        advancePhysicsToSeconds(1000);
        const p = Cesium.Cartesian3.clone(physics.position);
        advancePhysicsToSeconds(1000);
        expect(Cesium.Cartesian3.equals(p, physics.position)).toBe(true);
    });

    it("tornare indietro nel tempo riparte dallo stato iniziale (Reset)", function () {
        advancePhysicsToSeconds(5000);
        advancePhysicsToSeconds(0);
        expect(Cesium.Cartesian3.distance(physics.position, spherePositionECI_initial)).toBeLessThan(1e-6);
        expect(physics.time).toBe(0);
    });

    it("il risultato non dipende dalla durata dei frame", function () {
        advancePhysicsToSeconds(3000);
        const oneStep = Cesium.Cartesian3.clone(physics.position);

        resetPhysics();
        for (let t = 7; t < 3000; t += 7) {
            advancePhysicsToSeconds(t);
        }
        advancePhysicsToSeconds(3000);
        // Differenza ammessa: errore di integrazione, molto minore
        // del raggio della sfera.
        expect(Cesium.Cartesian3.distance(oneStep, physics.position)).toBeLessThan(10);
    });

    it("la sfera rimbalza e non penetra mai la superficie", function () {
        let minAltitude = Infinity;
        let bounces = 0;
        let previousRadialSpeed = 0;
        for (let t = 10; t <= 20000; t += 10) {
            advancePhysicsToSeconds(t);
            minAltitude = Math.min(minAltitude, physics.altitude);
            const radial = Cesium.Cartesian3.dot(
                physics.velocity,
                Cesium.Cartesian3.normalize(physics.position, new Cesium.Cartesian3())
            );
            if (previousRadialSpeed < 0 && radial > 0 && physics.altitude < 50000) {
                bounces++;
            }
            previousRadialSpeed = radial;
        }
        expect(bounces).toBeGreaterThan(10);
        expect(minAltitude).toBeGreaterThan(-1); // tolleranza: 1 m
    });

    it.each([true, false])("conserva l'energia meccanica (Terra sferica: %s)", function (spherical) {
        configure({ spherical, relative: { speedKmh: 3000, azimuthDeg: 30, elevationDeg: 20 } });
        const e0 = mechanicalEnergy();
        for (let t = 100; t <= 30000; t += 100) {
            advancePhysicsToSeconds(t);
        }
        expect(Math.abs((mechanicalEnergy() - e0) / e0)).toBeLessThan(1e-8);
    });

    it("ferma in ECI su Terra sferica: resta sulla stessa verticale inerziale", function () {
        configure({ absolute: { speedKmh: 0 } });
        const start = Cesium.Cartesian3.clone(spherePositionECI_initial);
        for (let t = 100; t <= 40000; t += 100) {
            advancePhysicsToSeconds(t);
            expect(angleBetween(physics.position, start)).toBeLessThan(1e-9);
        }
    });

    it("ferma rispetto alla Terra su Terra sferica: deriva verso l'equatore", function () {
        // Comportamento fisico atteso (non un errore): senza attrito
        // nessuna forza mantiene la sfera sul parallelo.
        advancePhysicsToSeconds(7200);
        const { latitude } = geodeticDeg(positionEcefAt(7200));
        expect(latitude).toBeLessThan(43);
    });

    it("ferma rispetto alla Terra su ellissoide con J2: deriva molto minore", function () {
        configure({ spherical: false });
        advancePhysicsToSeconds(7200);
        const { latitude } = geodeticDeg(positionEcefAt(7200));
        expect(Math.abs(latitude - 45)).toBeLessThan(1);
    });
});
