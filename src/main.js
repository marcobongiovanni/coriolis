// ============================================================
// main.js — Avvio dell'applicazione (composition root).
//
// Crea il modello, le implementazioni delle interfacce dei servizi,
// il ViewModel e le viste, e li collega. È l'unico punto che conosce
// tutte le classi concrete.
//
//   Modello      Simulation, Particle       (src/model)
//   Servizi      CesiumSimulationClock,     (src/services)
//                BrowserGeolocationService
//   ViewModel    SimulationViewModel        (src/viewmodel)
//   Viste        PanelView, SceneView       (src/view)
// ============================================================

import * as Cesium from "cesium";
import { Simulation } from "./model/simulation.js";
import { BrowserGeolocationService } from "./services/browserGeolocation.js";
import { CesiumSimulationClock } from "./services/cesiumClock.js";
import { PanelView } from "./view/panel/panelView.js";
import { SceneView } from "./view/scene/sceneView.js";
import { SimulationViewModel } from "./viewmodel/simulationViewModel.js";

const TIME_SCALE = 600; // 1 secondo reale = 600 secondi simulati

const viewer = new Cesium.Viewer("cesiumContainer", {
    animation: false,
    timeline: false
});

const simulation = new Simulation();
const viewModel = new SimulationViewModel(
    simulation,
    new CesiumSimulationClock(viewer.clock, TIME_SCALE),
    new BrowserGeolocationService(navigator.geolocation)
);

// Prima il pannello: dà alla vista 3D la sua dimensione definitiva,
// usata dalla scena per l'inquadratura iniziale.
new PanelView(viewer.container, viewModel);
const sceneView = new SceneView(viewer, viewModel);

viewModel.locateStartPoint();

// Oggetto in sola lettura usato dai test end-to-end (Playwright) per
// verificare lo stato della scena. Non ha effetti sulla simulazione.
window.__coriolis = {
    viewer: viewer,
    simulation: simulation,
    particle: simulation.particle,
    // Letta al momento, perché cambia durante l'uso.
    get cameraMode() {
        return viewModel.cameraMode;
    },
    ...sceneView.testObjects
};
