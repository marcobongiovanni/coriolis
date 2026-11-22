// ============================================================
// Test unitari delle telecamere del modello: posa ferma in ECI o in
// ECEF e inquadratura iniziale.
// ============================================================

import { describe, it, expect } from "vitest";
import * as Cesium from "cesium";
import { OMEGA, eciToEcef } from "../src/geometry/referenceFrames.js";
import { Camera } from "../src/model/camera.js";

const C3 = Cesium.Cartesian3;

// Posa ECEF di prova: a 20 000 km sull'asse X, rivolta verso il centro.
function samplePose() {
    return {
        position: new C3(2e7, 0, 0),
        direction: new C3(-1, 0, 0),
        up: new C3(0, 0, 1)
    };
}

describe("posa", function () {
    it("la telecamera ECEF resta ferma rispetto alla Terra", function () {
        const camera = new Camera("ecef");
        camera.setFromEcef(samplePose(), 1000);
        const later = camera.inEcef(5000);
        expect(C3.distance(later.position, samplePose().position)).toBeLessThan(1e-6);
        expect(C3.distance(later.direction, samplePose().direction)).toBeLessThan(1e-12);
    });

    it("la telecamera ECI resta ferma nello spazio: vista dalla Terra ruota", function () {
        const camera = new Camera("eci");
        camera.setFromEcef(samplePose(), 1000);
        const later = camera.inEcef(4600);
        const expected = eciToEcef(samplePose().position, OMEGA * 3600);
        expect(C3.distance(later.position, expected)).toBeLessThan(1e-6);
        expect(C3.distance(camera.inEcef(1000).position, samplePose().position)).toBeLessThan(1e-6);
    });

    it("direzione e Up sono conservati come versori", function () {
        const camera = new Camera("eci");
        const pose = samplePose();
        pose.direction = new C3(-3, 0, 0);
        camera.setFromEcef(pose, 0);
        expect(C3.magnitude(camera.direction)).toBeCloseTo(1, 15);
    });

    it("una nuova telecamera non è stata spostata dall'utente", function () {
        expect(new Camera("eci").movedByUser).toBe(false);
    });
});

describe("inquadratura iniziale", function () {
    it("guarda il bersaglio con Up verso l'alto e la Terra intera nella vista", function () {
        const camera = new Camera("eci");
        const surface = C3.fromDegrees(7.1, 45, 0);
        const target = C3.fromDegrees(7.1, 45, 125000);
        camera.frameStartPoint(surface, target, Math.tan(Cesium.Math.toRadians(30)));
        const pose = camera.inEcef(0);
        const toTarget = C3.normalize(C3.subtract(target, pose.position, new C3()), new C3());
        expect(C3.dot(toTarget, pose.direction)).toBeCloseTo(1, 12);
        expect(C3.dot(pose.up, C3.normalize(surface, new C3()))).toBeGreaterThan(0);
        expect(C3.magnitude(pose.position)).toBeGreaterThan(2 * Cesium.Ellipsoid.WGS84.maximumRadius);
    });
});
