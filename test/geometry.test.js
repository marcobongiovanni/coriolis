// ============================================================
// Test unitari della geometria: sistemi ECI/ECEF e terna ENU.
// ============================================================

import { describe, it, expect } from "vitest";
import * as Cesium from "cesium";
import {
    OMEGA,
    REFERENCE_SYSTEMS,
    bySystem,
    dragVelocity,
    eciToEcef,
    ecefToEci,
    enuRotation,
    normalizeDegrees,
    relativeVelocity
} from "../src/geometry/referenceFrames.js";

describe("terna Est-Nord-Su da una verticale", function () {
    const C3 = Cesium.Cartesian3;
    const column = (matrix, i) => Cesium.Matrix3.getColumn(matrix, i, new C3());

    it("con la normale geodetica coincide con la terna ENU di Cesium", function () {
        const point = C3.fromDegrees(100, 30, 1000);
        const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(point);
        const ours = enuRotation(normal);
        const cesium = Cesium.Matrix4.getMatrix3(
            Cesium.Transforms.eastNorthUpToFixedFrame(point), new Cesium.Matrix3()
        );
        [0, 1, 2].forEach((i) => {
            expect(C3.distance(column(ours, i), column(cesium, i))).toBeLessThan(1e-12);
        });
    });

    it("è ortonormale destrorsa con Su uguale alla verticale data", function () {
        const up = C3.normalize(new C3(1, -2, 3), new C3());
        const enu = enuRotation(up);
        const [east, north, z] = [0, 1, 2].map((i) => column(enu, i));
        expect(C3.distance(z, up)).toBeLessThan(1e-15);
        expect(C3.dot(east, north)).toBeCloseTo(0, 15);
        expect(east.z).toBeCloseTo(0, 15); // Est orizzontale
        expect(north.z).toBeGreaterThan(0); // Nord verso il polo Nord
        expect(C3.distance(C3.cross(east, north, new C3()), up)).toBeLessThan(1e-15);
    });

    it("ai poli usa Est = +Y, come Cesium", function () {
        const enu = enuRotation(C3.UNIT_Z);
        expect(C3.distance(column(enu, 0), C3.UNIT_Y)).toBeLessThan(1e-15);
        expect(C3.distance(column(enu, 1), new C3(-1, 0, 0))).toBeLessThan(1e-15);
    });
});

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

    it("velocità di trascinamento: ω × r, verso Est di modulo ω·ρ", function () {
        const r = new Cesium.Cartesian3(7e6, 0, 2e6);
        const drag = dragVelocity(r);
        expect(drag.x).toBeCloseTo(0, 12);
        expect(drag.y).toBeCloseTo(OMEGA * 7e6, 12);
        expect(drag.z).toBe(0);
    });

    it("bySystem crea un valore per ogni sistema di riferimento", function () {
        expect(bySystem((system) => system.toUpperCase())).toEqual({ eci: "ECI", ecef: "ECEF" });
        expect(REFERENCE_SYSTEMS).toEqual(["eci", "ecef"]);
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
