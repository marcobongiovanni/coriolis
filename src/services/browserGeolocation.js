// ============================================================
// browserGeolocation.js — GeolocationService basato sulla
// Geolocation API del browser.
//
// Il browser fornisce la posizione solo in un contesto sicuro (https
// o localhost) e se l'utente lo consente; in un iframe può essere
// negata (es. in Sandcastle). In tutti questi casi il risultato è
// undefined.
// ============================================================

import { GeolocationService } from "./interfaces.js";

const GEOLOCATION_OPTIONS = {
    enableHighAccuracy: false, // basta la posizione approssimata
    timeout: 15000,
    maximumAge: 10 * 60 * 1000
};

export class BrowserGeolocationService extends GeolocationService {
    #geolocation;

    constructor(geolocation) {
        super();
        this.#geolocation = geolocation;
    }

    getCurrentPosition() {
        return new Promise((resolve) => {
            if (!this.#geolocation) {
                console.info("Posizione geografica non disponibile: uso il punto predefinito.");
                resolve(undefined);
                return;
            }
            this.#geolocation.getCurrentPosition(
                (position) => resolve({
                    latitudeDeg: position.coords.latitude,
                    longitudeDeg: position.coords.longitude
                }),
                (error) => {
                    console.info(`Posizione geografica non disponibile (${error.message}): uso il punto predefinito.`);
                    resolve(undefined);
                },
                GEOLOCATION_OPTIONS
            );
        });
    }
}
