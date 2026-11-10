# Accelerazione di Coriolis — simulazione CesiumJS

Una sfera soggetta alla gravità rimbalza elasticamente sulla Terra in
rotazione. La dinamica è calcolata nel sistema inerziale **ECI** e
visualizzata anche nel sistema terrestre **ECEF**.

All'avvio la sfera è a quota 0 nel punto in cui si trova il PC (il
browser chiede il permesso di usare la posizione). La telecamera guarda
la sfera da sud-sud-est (azimuth 150°) con un'elevazione di 45° sopra
l'orizzonte locale, senza rollio (la verticale del punto appare
verticale), da una distanza a cui la Terra occupa il 95% della larghezza
della vista.
Se la posizione non è disponibile (permesso negato, pagina non in https,
oppure un iframe che non la concede, come può succedere in Sandcastle)
si parte da 45° N, 7.1° E.

## Struttura

| Percorso | Contenuto |
|---|---|
| `src/physics.js` | Fisica: gravità (massa puntiforme o J2), urti, integrazione, conversioni ECI/ECEF e delle velocità. Nessuna dipendenza da Viewer o DOM. |
| `src/app.js` | Viewer, entità, telecamera e pannello dei controlli. |
| `test/` | Test unitari della fisica (Vitest, in Node). |
| `e2e/` | Test dell'interfaccia nel browser (Playwright). |
| `scripts/build.mjs` | Unisce i due file sorgente in `dist/sandcastle.js`. |
| `scripts/server.mjs` | Server locale per `index.html`. |
| `scripts/pages.mjs` | Prepara la cartella `docs/` per GitHub Pages. |
| `pages.config.json` | Titolo, descrizione e token di Cesium ion del sito pubblicato. |
| `index.html` | Pagina locale che riproduce l'ambiente di Sandcastle. |
| `dist/` | File generati (non modificarli a mano). |
| `docs/` | Sito per GitHub Pages, generato da `npm run pages`. |

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

- `src/physics.js` non deve usare `viewer`, `document` né l'orologio di
  Cesium: il tempo è in secondi simulati dall'inizio.
- Ciò che `app.js` usa da `physics.js` va esportato con
  `export const/let/function` e importato con `import { ... } from "./physics.js"`.
- Le impostazioni modificate dall'interfaccia stanno nell'oggetto
  `settings` (un modulo non può riassegnare le variabili importate, ma
  può cambiarne le proprietà).
- Nomi diversi nei due file: dopo la build condividono lo stesso ambito.

## Test

**Unitari** (`test/physics.test.js`): trasformazioni ECI/ECEF,
conversioni modulo/azimuth/elevazione, stato iniziale, coerenza tra
velocità relativa e assoluta (`v_ECI = v_ECEF + ω × r`), gravità con e
senza J2, conservazione dell'energia, rimbalzi, deriva su Terra sferica
ed ellissoidale.

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
pagina locale. I breakpoint si mettono direttamente in `src/physics.js`
e `src/app.js`, grazie alla mappa sorgente `dist/sandcastle.js.map`.
