// ============================================================
// interfaces.js — Interfacce delle sorgenti esterne usate dal
// ViewModel.
//
// Il ViewModel conosce solo queste classi astratte: le
// implementazioni concrete (orologio di Cesium, geolocalizzazione del
// browser, finti oggetti nei test) vengono scelte in main.js.
// ============================================================

function notImplemented(member) {
    throw new Error(`${member} non implementato`);
}

// Verifica che "object" implementi l'interfaccia "contract".
export function requireImplementation(object, contract) {
    if (!(object instanceof contract)) {
        throw new TypeError(`Serve un'implementazione di ${contract.name}`);
    }
    return object;
}

// Sorgente del tempo simulato.
export class SimulationClock {
    // Vero mentre il tempo simulato scorre.
    get running() {
        return notImplemented("SimulationClock.running");
    }

    set running(value) {
        notImplemented("SimulationClock.running");
    }

    // Riporta il tempo simulato a t = 0.
    reset() {
        notImplemented("SimulationClock.reset()");
    }

    // Vero se il tempo simulato è t = 0.
    isAtStart() {
        return notImplemented("SimulationClock.isAtStart()");
    }
}

// Posizione geografica del dispositivo.
export class GeolocationService {
    // Promise di { latitudeDeg, longitudeDeg }, oppure di undefined se
    // la posizione non è disponibile (mai rifiutata).
    getCurrentPosition() {
        return notImplemented("GeolocationService.getCurrentPosition()");
    }
}
