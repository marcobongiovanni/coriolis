// ============================================================
// Test unitari delle telecamere del modello: posa ferma nel sistema
// del padre (World = ECI, Terra = ECEF) e inquadratura iniziale.
// ============================================================

import { describe, it, expect } from "vitest";
import * as Cesium from "cesium";
import { Camera } from "../src/model/camera.js";
import { EnuFrame } from "../src/model/enuFrame.js";
import { OMEGA } from "../src/model/rotationAxis.js";
import { createSystemNodes, eciToEcef } from "./helpers.js";

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
    it("la telecamera figlia della Terra resta ferma rispetto alla Terra", function () {
        const { ecef: earth } = createSystemNodes();
        const camera = earth.addChild(new Camera());
        camera.setFrom(earth, samplePose(), 1000);
        const later = camera.expressedIn(earth, 5000);
        expect(C3.distance(later.position, samplePose().position)).toBeLessThan(1e-6);
        expect(C3.distance(later.direction, samplePose().direction)).toBeLessThan(1e-12);
    });

    it("la telecamera figlia di World resta ferma nello spazio: vista dalla Terra ruota", function () {
        const { eci: world, ecef: earth } = createSystemNodes();
        const camera = world.addChild(new Camera());
        camera.setFrom(earth, samplePose(), 1000);
        const later = camera.expressedIn(earth, 4600);
        const expected = eciToEcef(samplePose().position, OMEGA * 3600);
        expect(C3.distance(later.position, expected)).toBeLessThan(1e-6);
        expect(C3.distance(camera.expressedIn(earth, 1000).position, samplePose().position)).toBeLessThan(1e-6);
    });

    it("direzione e Up sono conservati come versori", function () {
        const { eci: world } = createSystemNodes();
        const camera = world.addChild(new Camera());
        const pose = samplePose();
        pose.direction = new C3(-3, 0, 0);
        camera.setFrom(world, pose, 0);
        expect(C3.magnitude(camera.direction)).toBeCloseTo(1, 15);
    });

    it("una nuova telecamera non è stata spostata dall'utente", function () {
        expect(new Camera().movedByUser).toBe(false);
    });
});

describe("inquadratura iniziale", function () {
    it("guarda il bersaglio con Up verso l'alto e la Terra intera nella vista", function () {
        const { eci: world, ecef: earth } = createSystemNodes();
        const camera = world.addChild(new Camera());
        const surface = C3.fromDegrees(7.1, 45, 0);
        const target = C3.fromDegrees(7.1, 45, 125000);
        const frame = earth.addChild(new EnuFrame());
        frame.placeAt(target, Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(surface));
        camera.frameStartPoint(frame, Math.tan(Cesium.Math.toRadians(30)));
        const pose = camera.expressedIn(earth, 0);
        const toTarget = C3.normalize(C3.subtract(target, pose.position, new C3()), new C3());
        expect(C3.dot(toTarget, pose.direction)).toBeCloseTo(1, 12);
        expect(C3.dot(pose.up, C3.normalize(surface, new C3()))).toBeGreaterThan(0);
        expect(C3.magnitude(pose.position)).toBeGreaterThan(2 * Cesium.Ellipsoid.WGS84.maximumRadius);
    });
});
