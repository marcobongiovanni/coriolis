// ============================================================
// Test unitari della terna Est-Nord-Su: conversioni della velocità
// tra componenti e modulo/azimuth/elevazione.
// ============================================================

import { describe, it, expect } from "vitest";
import * as Cesium from "cesium";
import { EnuFrame } from "../src/model/enuFrame.js";

describe("conversioni modulo/azimuth/elevazione <-> ENU", function () {
    it.each([
        [1000, 0, 0],
        [1000, 90, 0],
        [1000, 225, 30],
        [500, 359, -45],
        [3600, 10, 89]
    ])("andata e ritorno: %d km/h, az %d°, el %d°", function (speedKmh, azimuthDeg, elevationDeg) {
        const local = EnuFrame.fromSpherical({ speedKmh, azimuthDeg, elevationDeg });
        const v = { speedKmh: 0, azimuthDeg: 0, elevationDeg: 0 };
        EnuFrame.toSpherical(local, v);
        expect(v.speedKmh).toBeCloseTo(speedKmh, 9);
        expect(v.azimuthDeg).toBeCloseTo(azimuthDeg, 9);
        expect(v.elevationDeg).toBeCloseTo(elevationDeg, 9);
    });

    it("azimuth 90° è verso Est, 0° verso Nord", function () {
        const east = EnuFrame.fromSpherical({ speedKmh: 3.6, azimuthDeg: 90, elevationDeg: 0 });
        expect(east.x).toBeCloseTo(1, 12);
        expect(east.y).toBeCloseTo(0, 12);
        const north = EnuFrame.fromSpherical({ speedKmh: 3.6, azimuthDeg: 0, elevationDeg: 0 });
        expect(north.y).toBeCloseTo(1, 12);
    });

    it("con modulo nullo conserva gli angoli precedenti", function () {
        const v = { speedKmh: 5, azimuthDeg: 123, elevationDeg: 12 };
        EnuFrame.toSpherical(new Cesium.Cartesian3(0, 0, 0), v);
        expect(v).toEqual({ speedKmh: 0, azimuthDeg: 123, elevationDeg: 12 });
    });
});
