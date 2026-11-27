// ============================================================
// Test unitari della gerarchia della scena: relazioni padre-figlio,
// trasformazioni tra i sistemi dei nodi e gerarchia della simulazione.
// ============================================================

import { describe, it, expect } from "vitest";
import * as Cesium from "cesium";
import { OMEGA } from "../src/model/rotationAxis.js";
import { SceneNode } from "../src/model/sceneNode.js";
import { Simulation } from "../src/model/simulation.js";
import { createSystemNodes, ecefToEci } from "./helpers.js";

const C3 = Cesium.Cartesian3;

describe("relazioni padre-figlio", function () {
    it("addChild appende il nodo al padre; la radice ha parent nullo", function () {
        const world = new SceneNode();
        const child = new SceneNode();
        expect(world.addChild(child)).toBe(child);
        expect(world.parent).toBeNull();
        expect(child.parent).toBe(world);
        expect(world.children).toEqual([child]);
    });

    it("un nodo spostato sotto un altro padre lascia il precedente", function () {
        const world = new SceneNode();
        const a = world.addChild(new SceneNode());
        const b = world.addChild(new SceneNode());
        const child = a.addChild(new SceneNode());
        b.addChild(child);
        expect(child.parent).toBe(b);
        expect(a.children).toEqual([]);
        expect(b.children).toEqual([child]);
    });
});

describe("trasformazioni tra i sistemi dei nodi", function () {
    it("figli di World con trasformazione identità condividono le coordinate", function () {
        const world = new SceneNode();
        const a = world.addChild(new SceneNode());
        const b = world.addChild(new SceneNode()).addChild(new SceneNode());
        const p = new C3(1, 2, 3);
        expect(C3.distance(a.pointTo(b, 1000, p), p)).toBe(0);
    });

    it("la Terra ruota rispetto a World: ECEF -> ECI", function () {
        const { eci: world, ecef: earth } = createSystemNodes();
        const p = new C3(6.4e6, 1e5, 2e6);
        const t = 3600;
        expect(C3.distance(earth.pointTo(world, t, p), ecefToEci(p, OMEGA * t))).toBeLessThan(1e-6);
        expect(C3.distance(earth.pointTo(world, 0, p), p)).toBeLessThan(1e-9);
    });

    it("la Terra ruota verso Est: un punto fermo in ECI si sposta verso Ovest", function () {
        // Dopo un quarto di giro un punto fisso in ECI sull'asse X si
        // trova, rispetto alla Terra, sull'asse -Y.
        const { eci: world, ecef: earth } = createSystemNodes();
        const quarterTurn = Math.PI / 2 / OMEGA;
        const p = world.pointTo(earth, quarterTurn, new C3(1, 0, 0));
        expect(C3.distance(p, new C3(0, -1, 0))).toBeLessThan(1e-12);
    });

    it("andata e ritorno tra due nodi restituiscono il punto di partenza", function () {
        const { eci: world, ecef: earth } = createSystemNodes();
        const a = earth.addChild(new SceneNode());
        const b = world.addChild(new SceneNode());
        const p = new C3(-3e6, 4e6, 5e6);
        const back = b.pointTo(a, 777, a.pointTo(b, 777, p));
        expect(C3.distance(back, p)).toBeLessThan(1e-6);
    });

    it("la posa di un nodo trasla e ruota il suo sistema rispetto al padre", function () {
        const world = new SceneNode();
        const node = world.addChild(new SceneNode());
        // Origine in (10, 0, 0), assi X e Y scambiati (Z invertito).
        node.setPose(new C3(10, 0, 0), [C3.UNIT_Y, C3.UNIT_X, new C3(0, 0, -1)]);
        expect(C3.distance(node.positionIn(world, 0), new C3(10, 0, 0))).toBe(0);
        expect(C3.distance(node.pointTo(world, 0, new C3(1, 2, 3)), new C3(12, 1, -3))).toBeLessThan(1e-12);
        expect(C3.distance(node.axesIn(world, 0)[0], C3.UNIT_Y)).toBeLessThan(1e-15);
    });

    it("setPoseFrom imposta la posa da un altro sistema", function () {
        const { eci: world, ecef: earth } = createSystemNodes();
        const node = world.addChild(new SceneNode());
        const position = new C3(7e6, 0, 0);
        const axes = [C3.UNIT_X, C3.UNIT_Y, C3.UNIT_Z];
        node.setPoseFrom(earth, position, axes, 3600);
        const pose = node.poseIn(earth, 3600);
        expect(C3.distance(pose.position, position)).toBeLessThan(1e-6);
        pose.axes.forEach((axis, i) => expect(C3.distance(axis, axes[i])).toBeLessThan(1e-12));
    });

    it("i vettori ruotano ma non si traslano", function () {
        const { eci: world, ecef: earth } = createSystemNodes();
        const v = new C3(0, 0, 5);
        expect(C3.distance(earth.vectorTo(world, 5000, v), v)).toBeLessThan(1e-12);
    });
});

describe("gerarchia della simulazione", function () {
    it("World e Terra hanno i figli previsti", function () {
        const simulation = new Simulation();
        const { world, earth, rotationAxis, particle, cameras } = simulation;
        expect(world.parent).toBeNull();
        expect(new Set(world.children)).toEqual(new Set([
            earth, rotationAxis, particle,
            particle.startFrames.eci, particle.trajectories.eci, particle.velocityArrows.eci,
            cameras.eci
        ]));
        expect(new Set(earth.children)).toEqual(new Set([
            particle.startFrames.ecef, particle.trajectories.ecef, particle.velocityArrows.ecef,
            particle.coriolisArrow,
            cameras.ecef
        ]));
    });
});
