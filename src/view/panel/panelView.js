// ============================================================
// panelView.js — Pannello dei controlli (DOM).
//
// Solo presentazione: costruisce i controlli, inoltra le azioni
// dell'utente ai comandi del ViewModel e rispecchia il suo stato.
// Ogni controllo registra con #bind() la funzione che lo aggiorna;
// a ogni notifica "change" del ViewModel vengono eseguite tutte.
//
// Il pannello occupa una colonna a sinistra a tutta altezza; la vista
// Cesium occupa lo spazio restante.
// ============================================================

import { REFERENCE_SYSTEMS } from "../../geometry/referenceFrames.js";
import { PALETTE } from "../palette.js";
import { PANEL_CSS, PANEL_WIDTH } from "./panelStyle.js";

// Icone SVG (stessa resa su tutti i sistemi, a differenza dei
// caratteri Unicode che alcuni sistemi mostrano come emoji).
const ICON_PLAY = '<svg viewBox="0 0 16 16"><path d="M3 1.5v13l11-6.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 16 16"><path d="M3 1.5h3.5v13H3zM9.5 1.5H13v13H9.5z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 16 16"><path d="M2.5 2.5h11v11h-11z"/></svg>';

const ERROR_DURATION_MS = 4000;
const STATUS_LABEL_WIDTH = 16; // Colonna dei valori (testo monospaziato)

// Righe della velocità iniziale: [etichetta, componente, limiti del campo].
// Azimuth senza min/max: tenendo premuto su/giù supera 360° o scende
// sotto 0° e viene "avvolto" dal ViewModel.
const VELOCITY_ROWS = [
    ["Modulo [km/h]", "speedKmh", { min: 0, step: 100 }],
    ["Azimuth [°]", "azimuthDeg", { step: 1 }],
    ["Elevazione [°]", "elevationDeg", { min: -90, max: 90, step: 1 }]
];

// Colonne della velocità iniziale: [terna, suffisso dell'etichetta].
const VELOCITY_COLUMNS = [
    ["ecef", "relativa (ECEF)"],
    ["eci", "assoluta (ECI)"]
];

// Righe della sezione Visualizzazione: [etichetta, oggetto].
const VISIBILITY_ROWS = [
    ["Terne", "frame"],
    ["Traiettoria", "track"],
    ["Velocità", "velocity"]
];

const LEGEND = [
    [PALETTE.ecef, "Traiettoria e velocità relative (ECEF)"],
    [PALETTE.eci, "Traiettoria e velocità assolute (ECI)"],
    [PALETTE.rotationAxis, "Asse di rotazione terrestre"]
];

// --------------------------------------------------
// STRUMENTI DOM
// --------------------------------------------------

// Crea un elemento DOM con le proprietà e i figli indicati.
function element(tag, properties, children) {
    const node = Object.assign(document.createElement(tag), properties);
    node.append(...(children || []));
    return node;
}

// Icona SVG del pulsante, con descrizione per tooltip e lettori di
// schermo.
function setIcon(button, svg, label) {
    button.innerHTML = svg;
    button.title = label;
    button.setAttribute("aria-label", label);
}

// Valori mostrati con al massimo 3 decimali.
function formatNumber(x) {
    return String(Number(x.toFixed(3)));
}

// Mostra "value" nel campo. Senza "force" non riscrive un campo che
// contiene già quel valore in un'altra forma (es. "1.50" mentre
// l'utente sta scrivendo): la digitazione non viene disturbata, ma un
// valore corretto dal ViewModel (es. longitudine avvolta) compare subito.
function showNumber(input, value, force) {
    const text = formatNumber(value);
    if (input.value === text || (!force && parseFloat(input.value) === value)) {
        return;
    }
    input.value = text;
}

// --------------------------------------------------
// PANNELLO
// --------------------------------------------------

export class PanelView {
    #vm;
    #panel;
    #refreshers = [];
    #errorBox;
    #errorTimer;
    #status;

    // Inserisce il pannello a sinistra di "sceneContainer" (contenitore
    // della vista Cesium) e lo collega a "viewModel".
    constructor(sceneContainer, viewModel) {
        this.#vm = viewModel;
        this.#mount(sceneContainer);

        this.#panel.append(element("h2", { textContent: "Accelerazione di Coriolis" }));
        this.#buildSimulationSection();
        this.#buildStartSection();
        this.#buildVelocitySection();
        this.#buildModelSection();
        this.#buildVisibilitySection();
        this.#buildStatusSection();
        this.#buildLegendSection();

        viewModel.on("change", () => this.#refresh());
        viewModel.on("frame", (frame) => this.#showStatus(frame.status));
        viewModel.on("error", (message) => this.#showError(message));
        this.#refresh();
        this.#showStatus(viewModel.frame.status);
    }

    // Aggiunge lo stile e il pannello alla pagina e restringe la vista
    // Cesium allo spazio a destra del pannello.
    #mount(sceneContainer) {
        document.head.appendChild(element("style", { textContent: PANEL_CSS }));
        this.#panel = element("div", { id: "simPanel" });
        Object.assign(sceneContainer.style, {
            position: "absolute",
            top: "0",
            bottom: "0",
            right: "0",
            left: PANEL_WIDTH + "px",
            width: "auto",
            height: "auto"
        });
        sceneContainer.parentNode.insertBefore(this.#panel, sceneContainer);
    }

    // Registra la funzione che aggiorna un controllo dallo stato del
    // ViewModel.
    #bind(refresher) {
        this.#refreshers.push(refresher);
    }

    // Aggiorna tutti i controlli.
    #refresh() {
        this.#refreshers.forEach((refresher) => refresher());
    }

    // --- Costruttori di controlli ----------------------------------------

    // Nuova sezione del pannello con il titolo indicato.
    #section(title, className) {
        const section = element("div", { className: className ? "sim-section " + className : "sim-section" }, [
            element("h3", { textContent: title })
        ]);
        this.#panel.append(section);
        return section;
    }

    // Pulsante che chiama "onClick" al clic.
    #button(onClick, properties) {
        const button = element("button", properties);
        button.addEventListener("click", onClick);
        return button;
    }

    // Campo numerico collegato a una proprietà del ViewModel:
    // - "input": a ogni variazione (anche tenendo premuti su/giù) invia
    //   il valore; valori incompleti (es. "" o "-") sono ignorati;
    // - "change": a modifica conclusa riscrive il campo con il valore
    //   normalizzato (o ripristina quello valido).
    // Disattivato durante la simulazione.
    #numberInput({ min, max, step, ariaLabel, read, write }) {
        const input = element("input", { type: "number", step: String(step) });
        if (min !== undefined) {
            input.min = String(min);
        }
        if (max !== undefined) {
            input.max = String(max);
        }
        if (ariaLabel) {
            input.setAttribute("aria-label", ariaLabel);
        }
        const submit = () => {
            const value = parseFloat(input.value);
            if (isFinite(value)) {
                write(value);
            }
        };
        input.addEventListener("input", submit);
        input.addEventListener("change", () => {
            submit();
            showNumber(input, read(), true);
        });
        this.#bind(() => {
            input.disabled = !this.#vm.editable;
            showNumber(input, read(), false);
        });
        return input;
    }

    // Riga "etichetta ........ campo".
    #field(parent, labelText, control) {
        parent.append(element("label", { className: "sim-field" }, [labelText, control]));
    }

    // Gruppo di radio button collegato a una proprietà del ViewModel.
    // options: [[etichetta, valore], ...].
    #radioGroup(parent, { name, className, options, read, write, lockWhileRunning }) {
        const row = element("div", { className: className });
        options.forEach(([labelText, value]) => {
            const radio = element("input", { type: "radio", name: name });
            radio.addEventListener("change", () => {
                if (radio.checked) {
                    write(value);
                }
            });
            this.#bind(() => {
                radio.checked = read() === value;
                if (lockWhileRunning) {
                    radio.disabled = !this.#vm.editable;
                }
            });
            row.append(element("label", {}, [radio, labelText]));
        });
        parent.append(row);
    }

    // --- Sezioni ---------------------------------------------------------

    // Pulsanti avvia/pausa e stop, con il riquadro degli errori.
    #buildSimulationSection() {
        const vm = this.#vm;
        const section = this.#section("Simulazione");

        const play = this.#button(() => vm.togglePlay());
        const stop = this.#button(() => vm.stop());
        setIcon(stop, ICON_STOP, "Stop (reset)");
        this.#bind(() => {
            setIcon(play, vm.running ? ICON_PAUSE : ICON_PLAY, vm.running ? "Pausa" : "Avvia");
            stop.disabled = !vm.editable;
        });

        // Messaggio di errore (non bloccante, scompare dopo alcuni secondi).
        this.#errorBox = element("div", { className: "sim-error" });
        section.append(element("div", { className: "sim-buttons" }, [play, stop]), this.#errorBox);
    }

    // Selezione del punto sul globo, latitudine, longitudine e quota.
    #buildStartSection() {
        const vm = this.#vm;
        const section = this.#section("Partenza");

        const pick = this.#button(() => vm.togglePickMode(), { className: "sim-text-button" });
        this.#bind(() => {
            pick.textContent = vm.pickMode ? "Annulla" : "Punto iniziale";
            pick.title = vm.pickMode ? "Clicca un punto sul globo, oppure premi qui per annullare" : "";
            pick.disabled = !vm.editable;
        });
        section.append(element("div", { className: "sim-buttons" }, [pick]));

        this.#field(section, "Latitudine [°]", this.#numberInput({
            min: -90, max: 90, step: 1,
            read: () => vm.latitudeDeg,
            write: (value) => vm.setLatitude(value)
        }));
        // Senza min/max: la longitudine viene "avvolta" (ciclo continuo).
        this.#field(section, "Longitudine [°]", this.#numberInput({
            step: 1,
            read: () => vm.longitudeDeg,
            write: (value) => vm.setLongitude(value)
        }));
        this.#field(section, "Quota di partenza [km]", this.#numberInput({
            min: 0, step: 10,
            read: () => vm.altitudeKm,
            write: (value) => vm.setAltitudeKm(value)
        }));
    }

    // Griglia della velocità iniziale: righe VELOCITY_ROWS, colonne
    // VELOCITY_COLUMNS.
    #buildVelocitySection() {
        const vm = this.#vm;
        const grid = element("div", { className: "sim-grid" }, [
            element("span"),
            element("span", { className: "sim-colhead", textContent: "Relativa (ECEF)" }),
            element("span", { className: "sim-colhead", textContent: "Assoluta (ECI)" })
        ]);
        VELOCITY_ROWS.forEach(([labelText, component, limits]) => {
            grid.append(element("span", { textContent: labelText }));
            VELOCITY_COLUMNS.forEach(([frame, suffix]) => {
                grid.append(this.#numberInput({
                    ...limits,
                    ariaLabel: labelText + " " + suffix,
                    read: () => vm.velocity(frame)[component],
                    write: (value) => vm.setVelocity(frame, component, value)
                }));
            });
        });
        this.#section("Velocità iniziale").append(grid);
    }

    // Scelta del modello di Terra.
    #buildModelSection() {
        const vm = this.#vm;
        this.#radioGroup(this.#section("Modello"), {
            name: "simEarth",
            className: "sim-radio-row",
            options: [["Sfera", true], ["Ellissoide", false]],
            read: () => vm.sphericalEarth,
            write: (spherical) => vm.setSphericalEarth(spherical),
            lockWhileRunning: true
        });
    }

    // Caselle attive anche durante la simulazione.
    #buildVisibilitySection() {
        const vm = this.#vm;
        const section = this.#section("Visualizzazione");

        const grid = element("div", { className: "sim-visibility" }, [
            element("span"),
            element("span", { className: "sim-colhead", textContent: "Assoluti (ECI)" }),
            element("span", { className: "sim-colhead", textContent: "Relativi (ECEF)" })
        ]);
        VISIBILITY_ROWS.forEach(([labelText, item]) => {
            grid.append(element("span", { textContent: labelText }));
            REFERENCE_SYSTEMS.forEach((frame) => {
                const checkbox = element("input", {
                    type: "checkbox",
                    title: labelText + " " + frame.toUpperCase()
                });
                checkbox.addEventListener("change", () => vm.setVisibility(item, frame, checkbox.checked));
                this.#bind(() => {
                    checkbox.checked = vm.visibility[item][frame];
                });
                grid.append(checkbox);
            });
        });
        section.append(grid);

        this.#radioGroup(section, {
            name: "simCameraMode",
            className: "sim-radio-row sim-camera-mode",
            options: [["Telecamera ECI", "eci"], ["Telecamera ECEF", "ecef"]],
            read: () => vm.cameraMode,
            write: (mode) => vm.setCameraMode(mode)
        });
        section.append(element("div", {
            className: "sim-note",
            textContent: "Spostamento laterale: Shift + trascinamento con il tasto destro"
        }));
    }

    // Riquadro dello stato, aggiornato a ogni istante da #showStatus().
    #buildStatusSection() {
        this.#status = element("div", { className: "sim-status" });
        this.#section("Stato").append(this.#status);
    }

    // Colori della scena e loro significato.
    #buildLegendSection() {
        const section = this.#section("Legenda", "sim-legend");
        LEGEND.forEach(([color, text]) => {
            const swatch = element("span", { className: "sim-swatch" });
            swatch.style.background = color;
            section.append(element("div", {}, [swatch, text]));
        });
    }

    // --- Messaggi e stato ---------------------------------------------------

    // Mostra "message" per ERROR_DURATION_MS; undefined lo nasconde.
    #showError(message) {
        clearTimeout(this.#errorTimer);
        this.#errorBox.style.display = message ? "block" : "none";
        if (message) {
            this.#errorBox.textContent = "⚠ " + message;
            this.#errorTimer = setTimeout(() => this.#showError(undefined), ERROR_DURATION_MS);
        }
    }

    // Righe "etichetta: valore" in colonna (testo monospaziato).
    #showStatus(status) {
        const position = status.latitudeDeg === undefined
            ? "-"
            : `${status.latitudeDeg.toFixed(2)}°, ${status.longitudeDeg.toFixed(2)}°`;
        this.#status.textContent = [
            ["Posizione", position],
            ["Tempo", status.timeSeconds.toFixed(1) + " s"],
            ["Quota", status.altitudeKm.toFixed(1) + " km"],
            ["Velocità ECEF", status.speedEcefKmh.toFixed(0) + " km/h"],
            ["Velocità ECI", status.speedEciKmh.toFixed(0) + " km/h"]
        ].map(([label, value]) => (label + ":").padEnd(STATUS_LABEL_WIDTH) + value).join("\n");
    }
}
