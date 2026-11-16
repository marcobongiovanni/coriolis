// ============================================================
// Test unitari della geometria: sistemi ECI/ECEF e terna ENU.
// ============================================================

import { describe, it, expect } from "vitest";
import * as Cesium from "cesium";
import {
    OMEGA,
    eciToEcef,
    ecefToEci,
    normalizeDegrees,
    relativeVelocity
} from "../src/geometry/referenceFrames.js";

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
        expect(eciToEcef(new Cesium.Cartesian3(3, 4, 5), 0.7).z).toBe(5);
    });

    it("il risultato può coincidere con il vettore di ingresso", function () {
        const p = new Cesium.Cartesian3(1, 2, 3);
        const expected = eciToEcef(p, 0.3);
        eciToEcef(p, 0.3, p);
        expect(Cesium.Cartesian3.distance(p, expected)).toBeLessThan(1e-15);
    });

    it("velocità relativa: v - ω × r", function () {
        const r = new Cesium.Cartesian3(7e6, 1e6, 2e6);
        const v = new Cesium.Cartesian3(100, 200, 300);
        const drag = new Cesium.Cartesian3(-OMEGA * r.y, OMEGA * r.x, 0);
        const expected = Cesium.Cartesian3.subtract(v, drag, new Cesium.Cartesian3());
        expect(Cesium.Cartesian3.distance(relativeVelocity(r, v), expected)).toBeLessThan(1e-12);
    });
});

describe("angoli in [0°, 360°)", function () {
    it.each([
        [0, 0],
        [7.1, 7.1],
        [359, 359],
        [360, 0],
        [-1, 359],
        [725, 5],
        [-370, 350]
    ])("normalizeDegrees(%d) = %d", function (input, expected) {
        expect(normalizeDegrees(input)).toBeCloseTo(expected, 12);
    });

    it("gli angoli già nell'intervallo restano identici", function () {
        expect(normalizeDegrees(7.1)).toBe(7.1);
        expect(Object.is(normalizeDegrees(-360), 0)).toBe(true);
    });
});
