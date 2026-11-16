// ============================================================
// observable.js — Notifica di eventi con nome, base del ViewModel.
// ============================================================

export class Observable {
    #listeners = new Map();

    on(event, listener) {
        if (!this.#listeners.has(event)) {
            this.#listeners.set(event, []);
        }
        this.#listeners.get(event).push(listener);
    }

    emit(event, ...args) {
        (this.#listeners.get(event) || []).forEach((listener) => listener(...args));
    }
}
