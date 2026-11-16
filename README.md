# Accelerazione di Coriolis — simulazione CesiumJS

Una particella soggetta alla gravità rimbalza elasticamente sulla Terra in
rotazione. La dinamica è calcolata nel sistema inerziale **ECI** e
visualizzata anche nel sistema terrestre **ECEF**.

All'avvio la particella è a quota 0 nel punto in cui si trova il PC (il
browser chiede il permesso di usare la posizione). La telecamera guarda
la particella da sud-sud-est (azimuth 150°) con un'elevazione di 45° sopra
l'orizzonte locale, senza rollio (la verticale del punto appare
verticale), da una distanza a cui la Terra occupa il 95% della larghezza
della vista.
Se la posizione non è disponibile (permesso negato, pagina non in https,
oppure un iframe che non la concede, come può succedere in Sandcastle)
si parte da 45° N, 7.1° E.

## Struttura

Il codice segue il paradigma **MVVM** (Model - View - ViewModel).
Le regole dell'architettura sono in [ARCHITECTURE.md](ARCHITECTURE.md).

```
View (PanelView, SceneView) ──comandi──▶ ViewModel ──▶ Model (Simulation,
            ▲                               │                Particle)
            └──────── eventi "change", ─────┘──▶ interfacce dei servizi
                      "frame", ...                (SimulationClock,
                                                   GeolocationService)
```

| Percorso | Livello | Contenuto |
|---|---|---|
| `src/geometry/referenceFrames.js` | condiviso | Funzioni pure: conversioni ECI/ECEF, rotazione e direzioni della terna Est-Nord-Su, angoli. |
| `src/model/earth.js` | Model | Modelli di Terra (sfera, ellissoide WGS84 con J2): gravità, potenziale, superficie, asse di rotazione. |
| `src/model/particle.js` | Model | `Particle`: raggio, condizioni iniziali e loro regole di validità, stato iniziale e corrente, frecce della velocità, terne e traiettorie. |
| `src/model/arrow.js` | Model | `Arrow`: grandezza vettoriale applicata nel centro della particella (oggi la velocità assoluta e quella relativa). |
| `src/model/enuFrame.js` | Model | `EnuFrame`: terna Est-Nord-Su nel punto di partenza, ferma in ECI o in ECEF; conversioni della velocità tra componenti ENU e modulo/azimuth/elevazione. |
| `src/model/trajectory.js` | Model | `Trajectory`: posizioni del centro della particella, in ECI o in ECEF. |
| `src/model/simulation.js` | Model | `Simulation`: modello di Terra, tempo, integrazione e urti delle particelle. |
| `src/services/interfaces.js` | servizi | Interfacce `SimulationClock` e `GeolocationService`. |
| `src/services/cesiumClock.js`, `browserGeolocation.js` | servizi | Implementazioni con l'orologio di Cesium e la Geolocation API. |
| `src/viewmodel/simulationViewModel.js` | ViewModel | Stato mostrato, comandi, regole dell'interfaccia (es. controlli bloccati durante la simulazione), stato di ogni istante in coordinate ECEF. |
| `src/view/panel/` | View | Pannello dei controlli (DOM) e suo stile. |
| `src/view/scene/` | View | Scena Cesium: entità, tracce, telecamera ECI/ECEF, pan, inquadratura. |
| `src/view/palette.js` | View | Colori comuni a scena e legenda. |
| `src/main.js` | avvio | Crea e collega modello, servizi, ViewModel e viste. |
| `test/` | | Test unitari di modello e ViewModel (Vitest, in Node). |
| `e2e/` | | Test dell'interfaccia nel browser (Playwright). |
| `scripts/build.mjs` | | Unisce i file sorgente in `dist/sandcastle.js`. |
| `scripts/server.mjs` | | Server locale per `index.html`. |
| `scripts/pages.mjs` | | Prepara la cartella `docs/` per GitHub Pages. |
| `pages.config.json` | | Titolo, descrizione e token di Cesium ion del sito pubblicato. |
| `index.html` | | Pagina locale che riproduce l'ambiente di Sandcastle. |
| `dist/` | | File generati (non modificarli a mano). |
| `docs/` | | Sito per GitHub Pages, generato da `npm run pages`. |

Ogni tipo di elemento della scena corrisponde a un elemento del modello:

| Elemento della scena | Elemento del modello |
|---|---|
| Particella | `Particle` (`state.position`, `radius`) |
| Frecce della velocità assoluta e relativa | `Arrow` (`particle.velocityArrows`) |
| Punto di partenza | `Particle` (`start`) |
| Traiettorie ECI ed ECEF | `Trajectory` (`particle.trajectories`) |
| Terne ECI ed ECEF nel punto di partenza | `EnuFrame` (`particle.startFrames`) |
| Asse di rotazione | `rotationAxis` del modello di Terra |

La vista decide solo come disegnarli (colori, spessori, lunghezza a
schermo); i dati vengono dal modello attraverso il ViewModel.

## Prima installazione (una volta sola)

1. Serve **Node.js 18.18 o successivo** (`node --version` per controllare).
   Se puoi, usa la versione LTS più recente da <https://nodejs.org>.
2. Apri la cartella del progetto in **VS Code** e accetta le estensioni
   consigliate (*Vitest* e *Playwright Test for VS Code*).
3. Apri un terminale in VS Code (menu *Terminale → Nuovo terminale*) ed esegui:

   ```
   npm install
   ```

   Su Windows i test end-to-end usano **Microsoft Edge** già installato:
   non serve scaricare altro (utile se il PC non permette di eseguire
   programmi scaricati, per esempio con BeyondTrust). Su altri sistemi
   esegui anche `npm run e2e:install`, che scarica Chromium.

## Comandi

| Comando | A cosa serve |
|---|---|
| `npm run dev` | Avvia la pagina locale su <http://localhost:5173> e la ricompila a ogni salvataggio (aggiorna il browser per vedere le modifiche). |
| `npm test` | Esegue i test unitari della fisica (pochi secondi). |
| `npm run test:watch` | Come sopra, ma li riesegue a ogni modifica. |
| `npm run e2e` | Esegue i test dell'interfaccia nel browser (circa 2 minuti). |
| `npm run e2e:ui` | Come sopra, con l'interfaccia grafica di Playwright. |
| `npm run test:all` | Tutti i test. |
| `npm run lint` | Controlla il codice con ESLint, comprese le dipendenze consentite tra i livelli MVVM. |
| `npm run sandcastle` | Genera `dist/sandcastle.js` e lo **copia negli appunti**. |
| `npm run pages` | Genera la cartella `docs/` da pubblicare su GitHub Pages. |

## Portare il codice in Sandcastle

1. `npm run sandcastle`
2. In Sandcastle, nella scheda *JavaScript*: `Ctrl+A`, poi `Ctrl+V`.
3. *Run*.

Il file incollato è identico al codice di `src/`, commenti compresi:
la build toglie solo le righe `import` e la parola `export`.

Se modifichi qualcosa direttamente in Sandcastle, riporta la modifica in
`src/`: la build successiva sovrascrive `dist/sandcastle.js`.

## Pubblicare su GitHub Pages

Il sito sarà all'indirizzo `https://<utente>.github.io/<repository>/`.
Con un account GitHub gratuito il repository deve essere **pubblico**.

### Una volta sola: token di Cesium ion

Fuori da Sandcastle serve un token proprio per le mappe di Cesium ion
(gratuito):

1. Crea un account su <https://ion.cesium.com> e apri *Access Tokens*.
2. *Create token*, con gli ambiti predefiniti.
3. In *Allowed URLs* inserisci `https://<utente>.github.io`: il token è
   visibile nel codice della pagina, così funziona solo sul tuo sito.
4. Copia il token in `pages.config.json`, campo `"cesiumIonToken"`.

Senza token la pagina usa quello predefinito di Cesium, valido solo per
prove: mostra un avviso e può smettere di funzionare.

### A ogni pubblicazione

1. `npm run pages` genera `docs/` con:
   - `index.html`: CesiumJS caricato da CDN (jsDelivr), nella stessa
     versione installata da npm;
   - `sandcastle.js`: lo stesso script che si incolla in Sandcastle;
   - `.nojekyll`: GitHub pubblica i file così come sono.
2. Carica i file nella cartella `docs/` del repository:
   - **dal sito di GitHub**: apri il repository, *Add file → Upload
     files*, trascina la cartella `docs` e conferma con *Commit changes*;
   - **oppure con Git**, se l'intero progetto è nel repository:
     `git add docs`, `git commit`, `git push`.
3. Solo la prima volta: *Settings → Pages → Build and deployment →
   Source: Deploy from a branch*, ramo `main`, cartella `/docs`, *Save*.
4. Dopo uno o due minuti il link compare in *Settings → Pages*
   (*Visit site*).

## Regole per i sorgenti

Dipendenze consentite (ogni livello conosce solo quelli alla sua destra):

| Livello | Può importare |
|---|---|
| View | `geometry/`, `view/` — mai `model/` né `services/`: riceve il ViewModel dal costruttore |
| ViewModel | `model/`, `services/interfaces.js`, `geometry/` — mai DOM, `viewer` o implementazioni concrete dei servizi |
| Model | `geometry/` e Cesium solo come libreria matematica — mai `viewer`, `document` né l'orologio di Cesium (il tempo è in secondi simulati dall'inizio) |

- **Vista**: solo presentazione. Costruisce i controlli, inoltra le
  azioni ai comandi del ViewModel e si aggiorna agli eventi `"change"`
  e `"frame"`. Nessuna regola di business (limiti, validazioni, quando
  un comando è permesso).
- **Regole di business** nel modello (validità delle condizioni
  iniziali) o nel ViewModel (regole dell'interfaccia).
- **Sorgenti esterne** (tempo, posizione geografica) solo tramite le
  interfacce di `src/services/interfaces.js`. Una nuova sorgente:
  interfaccia in `interfaces.js`, implementazione in un file a parte,
  collegamento in `main.js`.
- Sintassi dei moduli: `export const/let/function/class` e
  `import { ... } from "..."`. La build ricava l'ordine dei file dagli
  import a partire da `src/main.js`.
- Nomi di primo livello diversi in ogni file: dopo la build i file
  condividono lo stesso ambito (la build segnala i duplicati).

## Test

**Unitari del modello**:
- `test/geometry.test.js`: trasformazioni ECI/ECEF, angoli;
- `test/enuFrame.test.js`: conversioni della velocità tra componenti
  ENU e modulo/azimuth/elevazione;
- `test/particle.test.js`: regole di validità delle condizioni
  iniziali, stato iniziale, coerenza tra velocità relativa e assoluta
  (`v_ECI = v_ECEF + ω × r`), frecce della velocità, terne nel punto di
  partenza, traiettorie;
- `test/simulation.test.js`: gravità con e senza J2, superficie, asse
  di rotazione, registrazione della traiettoria, conservazione
  dell'energia, rimbalzi, deriva su Terra sferica ed ellissoidale.

`test/helpers.js` contiene gli strumenti comuni per configurare
particelle e simulazioni.

**Unitari del ViewModel** (`test/viewModel.test.js`, senza browser, con
orologio e geolocalizzazione finti): play/pausa e blocco dei controlli,
Reset, selezione del punto, posizione del PC, stato di ogni istante,
traiettorie.

**End-to-end** (`e2e/app.spec.js`, browser: Edge su Windows, Chromium
altrove; si può forzare con la variabile `PW_CHANNEL`, es. `chrome`): avvio senza errori, play/pausa e
controlli disattivati, stop dopo una simulazione (regressione del bug
"This object was destroyed"), pulsante *Punto iniziale*, longitudine
ciclica, latitudine limitata, coerenza delle velocità nei campi,
caselle di *Visualizzazione*.

I test end-to-end bloccano le richieste di rete (mappe di Cesium ion):
non dipendono dalla connessione. La pagina locale usa la build **non
minificata** di Cesium, come Sandcastle, così emergono gli stessi
controlli di errore.

Su una macchina senza scheda video (per esempio un server di
integrazione continua) imposta `PW_SOFTWARE_GL=1` per usare WebGL
software.

## Debug in VS Code

Nel pannello *Esegui e debug* (`Ctrl+Shift+D`) scegli **Debug in Edge**
oppure **Debug in Chrome**: viene avviato `npm run dev` e si apre la
pagina locale. I breakpoint si mettono direttamente nei file di `src/`,
grazie alla mappa sorgente `dist/sandcastle.js.map`.
