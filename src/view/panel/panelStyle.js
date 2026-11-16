// ============================================================
// panelStyle.js — Foglio di stile del pannello dei controlli.
// ============================================================

export const PANEL_WIDTH = 340; // [px]

export const PANEL_CSS = `
#simPanel {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: ${PANEL_WIDTH}px;
    box-sizing: border-box;
    overflow-y: auto;
    padding: 12px 14px;
    background: #1e1f22;
    border-right: 1px solid #3a3b3f;
    color: #e8e8e8;
    font: 13px/1.4 sans-serif;
    z-index: 100;
}
#simPanel h2 {
    margin: 0 0 12px 0;
    font-size: 16px;
    font-weight: 600;
}
#simPanel .sim-section {
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid #333438;
}
#simPanel .sim-section:last-child {
    border-bottom: none;
}
#simPanel h3 {
    margin: 0 0 8px 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #9a9ca3;
}
/* Riga di pulsanti: occupa metà della larghezza utile. */
#simPanel .sim-buttons {
    display: flex;
    gap: 8px;
    width: calc(50% - 4px);
}
#simPanel .sim-buttons button {
    flex: 1 1 0;
    min-width: 0;
    margin: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    padding: 0;
}
#simPanel .sim-buttons svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
}
#simPanel .sim-buttons .sim-text-button {
    padding: 0 6px;
    white-space: nowrap;
    overflow: hidden;
    text-align: center;
}
/* Griglie: etichetta + due colonne di controlli. */
#simPanel .sim-grid,
#simPanel .sim-visibility {
    display: grid;
    grid-template-columns: 1fr 90px 90px;
    gap: 6px 8px;
    align-items: center;
}
#simPanel .sim-visibility input[type="checkbox"] {
    justify-self: center;
    margin: 0;
}
/* Riga di radio button (modello di Terra, telecamera). */
#simPanel .sim-radio-row {
    display: flex;
    gap: 16px;
}
#simPanel .sim-radio-row label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
}
#simPanel .sim-radio-row input {
    margin: 0;
}
#simPanel .sim-camera-mode {
    margin-top: 10px;
}
#simPanel button {
    padding: 6px 10px;
    cursor: pointer;
}
#simPanel button:disabled,
#simPanel input:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}
#simPanel .sim-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
}
#simPanel input[type="number"] {
    width: 90px;
    box-sizing: border-box;
}
#simPanel .sim-colhead {
    font-size: 11px;
    color: #9a9ca3;
    text-align: center;
}
#simPanel .sim-note {
    margin-top: 6px;
    font-size: 11px;
    color: #9a9ca3;
}
#simPanel .sim-status {
    white-space: pre-wrap;
    font-family: monospace;
    font-size: 12px;
}
#simPanel .sim-error {
    display: none;
    margin-top: 8px;
    padding: 6px 8px;
    background: #8e2020;
    border-radius: 4px;
}
#simPanel .sim-legend div {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
}
#simPanel .sim-swatch {
    display: inline-block;
    width: 18px;
    height: 3px;
    border-radius: 2px;
}
`;
