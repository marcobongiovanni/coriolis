// ============================================================
// observable.js — Notifica di eventi con nome, base del ViewModel.
// ============================================================

export class Observable {
    #listeners = new Map(); // nome dell'evento -> funzioni registrate

    // Registra "listener", chiamato a ogni emissione di "event".
    on(event, listener) {
        if (!this.#listeners.has(event)) {
            this.#listeners.set(event, []);
        }
        this.#listeners.get(event).push(listener);
    }

    // Chiama, nell'ordine di registrazione, le funzioni registrate per
    // "event", passando loro "args".
    emit(event, ...args) {
        (this.#listeners.get(event) || []).forEach((listener) => listener(...args));
    }
}
