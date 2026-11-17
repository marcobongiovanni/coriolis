// ============================================================
// Test unitari del ViewModel (Vitest, in Node).
//
// Il ViewModel non dipende dall'interfaccia: si prova senza browser,
// con implementazioni finte di SimulationClock e GeolocationService.
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import * as Cesium from "cesium";
import { Simulation } from "../src/model/simulation.js";
import { GeolocationService, SimulationClock } from "../src/services/interfaces.js";
import {
    PICK_REQUIRES_RESET_MESSAGE,
    SimulationViewModel
} from "../src/viewmodel/simulationViewModel.js";

// --------------------------------------------------
// Implementazioni finte delle interfacce
// --------------------------------------------------

class FakeClock extends SimulationClock {
    running = false;
    atStart = true;

    reset() {
        this.atStart = true;
    }

    isAtStart() {
        return this.atStart;
    }
}

class FakeGeolocation extends GeolocationService {
    constructor(position) {
        super();
        this.position = position;
    }

    getCurrentPosition() {
        return Promise.resolve(this.position);
    }
}

// --------------------------------------------------
// Strumenti
// --------------------------------------------------

let clock;
let simulation;
let vm;
let events;

function createViewModel(position) {
    clock = new FakeClock();
    simulation = new Simulation();
    vm = new SimulationViewModel(simulation, clock, new FakeGeolocation(position));
    events = [];
    ["change", "error", "startPointLocated"].forEach((name) => {
        vm.on(name, (arg) => events.push(arg === undefined ? name : [name, arg]));
    });
}

// Simulazione avviata e poi messa in pausa dopo qualche istante.
function runAndPause() {
    vm.togglePlay();
    clock.atStart = false;
    vm.frameAt(100);
    vm.togglePlay();
}

beforeEach(function () {
    createViewModel(undefined);
});

// --------------------------------------------------
// Test
// --------------------------------------------------

describe("dipendenze", function () {
    it("accetta solo implementazioni delle interfacce", function () {
        const geolocation = new FakeGeolocation();
        expect(() => new SimulationViewModel(new Simulation(), {}, geolocation)).toThrow(TypeError);
        expect(() => new SimulationViewModel(new Simulation(), new FakeClock(), {})).toThrow(TypeError);
    });

    it("le interfacce non implementate segnalano l'errore", function () {
        expect(() => new SimulationClock().reset()).toThrow(/non implementato/);
        expect(() => new GeolocationService().getCurrentPosition()).toThrow(/non implementato/);
    });
});

describe("avvio e arresto", function () {
    it("play/pausa comanda l'orologio e blocca le modifiche", function () {
        vm.togglePlay();
        expect(clock.running).toBe(true);
        expect(vm.editable).toBe(false);

        vm.setLatitude(10);
        vm.setSphericalEarth(false);
        expect(vm.latitudeDeg).toBe(45);
        expect(vm.sphericalEarth).toBe(true);

        vm.togglePlay();
        expect(vm.editable).toBe(true);
    });

    it("stop riporta a t = 0 e azzera il tempo dell'orologio", function () {
        runAndPause();
        events.length = 0;
        vm.stop();
        expect(clock.atStart).toBe(true);
        expect(simulation.time).toBe(0);
        expect(vm.frame.seconds).toBe(0);
        expect(vm.trajectory("eci").points).toHaveLength(1);
        expect(events).toEqual(["error", "change"]);
    });

    it("stop è ignorato durante la simulazione", function () {
        vm.togglePlay();
        clock.atStart = false;
        vm.stop();
        expect(clock.atStart).toBe(false);
    });
});

describe("condizioni iniziali", function () {
    it("ogni modifica fa ripartire la simulazione", function () {
        runAndPause();
        events.length = 0;
        vm.setAltitudeKm(225);
        expect(vm.altitudeKm).toBe(225);
        expect(clock.atStart).toBe(true);
        expect(vm.frame.status.altitudeKm).toBeCloseTo(225, 6);
        expect(events).toEqual(["change"]);
    });

    it("la longitudine viene avvolta e la latitudine limitata", function () {
        vm.setLongitude(-1);
        expect(vm.longitudeDeg).toBe(359);
        vm.setLatitude(120);
        expect(vm.latitudeDeg).toBe(90);
    });

    it("la terna modificata determina l'altra", function () {
        vm.setVelocity("relative", "speedKmh", 1000);
        expect(vm.velocity("relative").speedKmh).toBe(1000);
        expect(vm.velocity("absolute").speedKmh).not.toBeCloseTo(1000, 0);
        expect(vm.frame.status.speedEcefKmh).toBeCloseTo(1000, 6);
    });
});

describe("selezione del punto di partenza", function () {
    it("richiede il Reset se il tempo è avanzato", function () {
        runAndPause();
        events.length = 0;
        vm.togglePickMode();
        expect(vm.pickMode).toBe(false);
        expect(events).toEqual([["error", PICK_REQUIRES_RESET_MESSAGE]]);
    });

    it("il punto scelto diventa il punto di partenza e chiude la selezione", function () {
        vm.togglePickMode();
        expect(vm.pickMode).toBe(true);
        expect(vm.pickStartPoint(10, -20)).toBe(true);
        expect(vm.pickMode).toBe(false);
        expect(vm.latitudeDeg).toBeCloseTo(10, 12);
        expect(vm.longitudeDeg).toBeCloseTo(340, 12);
    });

    it("fuori dalla modalità selezione il punto è ignorato", function () {
        expect(vm.pickStartPoint(10, 20)).toBe(false);
        expect(vm.latitudeDeg).toBe(45);
    });

    it("l'avvio della simulazione chiude la selezione", function () {
        vm.togglePickMode();
        vm.togglePlay();
        expect(vm.pickMode).toBe(false);
    });
});

describe("visualizzazione", function () {
    it("telecamera e visibilità cambiano anche durante la simulazione", function () {
        vm.togglePlay();
        events.length = 0;
        vm.setCameraMode("ecef");
        vm.setVisibility("track", "eci", false);
        expect(vm.cameraMode).toBe("ecef");
        expect(vm.visibility.track.eci).toBe(false);
        expect(events).toEqual(["change", "change"]);
    });
});

describe("stato a un istante", function () {
    it("è idempotente per lo stesso istante", function () {
        const frame = vm.frameAt(500);
        expect(vm.frameAt(500)).toBe(frame);
        expect(simulation.time).toBe(500);
    });

    it("a t = 0 la particella è sul punto di partenza e le due terne coincidono", function () {
        const frame = vm.frameAt(0);
        // Terra sferica: il baricentro della particella è sulla
        // verticale geocentrica, la sua latitudine geodetica può
        // differire di qualche millesimo di grado.
        expect(frame.status.latitudeDeg).toBeCloseTo(45, 2);
        expect(frame.status.longitudeDeg).toBeCloseTo(7.1, 9);
        expect(frame.status.timeSeconds).toBe(0);
        const { eci, ecef } = frame.referenceFrames;
        expect(Cesium.Cartesian3.distance(eci.origin, ecef.origin)).toBeLessThan(1e-6);
    });

    it("la terna ECI ruota rispetto a quella ECEF", function () {
        const frame = vm.frameAt(3600);
        const { eci, ecef } = frame.referenceFrames;
        expect(Cesium.Cartesian3.distance(eci.origin, ecef.origin)).toBeGreaterThan(1000);
        expect(frame.earthAngle).toBeCloseTo(7.292115e-5 * 3600, 15);
    });

    it("le traiettorie crescono con il tempo e ripartono al Reset", function () {
        const before = vm.trajectory("ecef");
        vm.frameAt(600);
        vm.frameAt(1200);
        expect(vm.trajectory("ecef").points).toHaveLength(3);
        expect(vm.trajectory("eci").points).toHaveLength(3);

        vm.stop();
        const after = vm.trajectory("ecef");
        expect(after.points).toHaveLength(1);
        expect(after.revision).toBeGreaterThan(before.revision);
    });

    it("espone l'asse di rotazione del modello di Terra", function () {
        expect(Cesium.Cartesian3.equals(vm.rotationAxis, Cesium.Cartesian3.UNIT_Z)).toBe(true);
    });
});

describe("posizione geografica del PC", function () {
    it("diventa il punto di partenza se l'utente non ha toccato nulla", async function () {
        createViewModel({ latitudeDeg: 41.9, longitudeDeg: 12.5 });
        await vm.locateStartPoint();
        expect(vm.latitudeDeg).toBe(41.9);
        expect(vm.longitudeDeg).toBe(12.5);
        expect(events).toContain("startPointLocated");
    });

    it("non sostituisce un punto già scelto dall'utente", async function () {
        createViewModel({ latitudeDeg: 41.9, longitudeDeg: 12.5 });
        const pending = vm.locateStartPoint();
        vm.setLatitude(10);
        await pending;
        expect(vm.latitudeDeg).toBe(10);
        expect(events).not.toContain("startPointLocated");
    });

    it("senza posizione resta il punto predefinito", async function () {
        await vm.locateStartPoint();
        expect(vm.latitudeDeg).toBe(45);
        expect(events).not.toContain("startPointLocated");
    });
});
