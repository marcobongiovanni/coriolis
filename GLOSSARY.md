# Glossario

Termini usati per indicare in modo univoco concetti e oggetti del
progetto. Ogni termine indica un solo concetto ed ogni concetto ha 
un solo termine che lo definisce. I termini in grassetto rimandano 
alla loro definizione. Dove esiste, è indicato l'elemento 
corrispondente nel codice.

Convenzione: **Particella** indica sempre l'oggetto fisico (il punto
materiale simulato), mentre **Sfera** indica sempre la sua forma 
geometrica disegnata nella scena.

## Sistemi di riferimento

- **ECI**: sistema di riferimento inerziale, fermo nello spazio, con
  origine nel centro della Terra e asse Z lungo l'**Asse di rotazione**.
  Tutta la dinamica è calcolata in questo sistema.

- **ECEF**: sistema di riferimento solidale con la Terra, che ruota con
  velocità angolare `OMEGA` attorno all'**Asse di rotazione**. A t = 0
  coincide con **ECI**.
  Nel codice: `eciToEcef`, `ecefToEci`.

- **Terna locale** (East-North-Up): terna cartesiana destrorsa con
  origine in un punto arbitrario. Gli assi X, Y e Z sono diretti 
  rispettivamente verso Est, verso Nord e lungo la **Normale locale** 
  nel punto. Sulla Terra ellissoidale l'asse Z è quindi la normale 
  geodetica, sulla Terra sferica è parallelo al raggio.
  Nel codice: `EnuFrame`, `enuRotation`.

- **Normale locale**: direzione perpendicolare alla **Superficie** in un
  punto, verso l'esterno. È radiale per la Terra sferica e geodetica per
  quella ellissoidale.
  Nel codice: `heightAboveSurface` (parametro `normal`).

- **Azimuth**: angolo misurato in senso orario tra l'asse Y (Nord) della
  **Terna locale** e la proiezione sul piano XY (Est-Nord) di un vettore 
  arbitrario. Ha valori definiti nell'insieme [0°, 360°). Se il vettore 
  è verticale o nullo, l'azimuth non è definito e si mantiene il valore 
  precedente.

- **Elevazione**: angolo tra un vettore arbitrario ed il piano XY (Est-Nord) 
  della **Terna locale**. Ha valore definito nell'insieme [-90°, +90°].
  E' positiva se il vettore punta dalla parte dell'asse Z, negativa altrimenti.
  Se il vettore è nullo, l'elevazione non è definita e si mantiene il valore 
  precedente.

## Terra

- **Modello di Terra**: forma della **Superficie** e campo di gravità
  della Terra, usati dalla dinamica e dagli urti. Può essere:
  - Terra sferica: **Superficie** sferica di raggio medio `EARTH_RADIUS` 
    e gravità di massa puntiforme.
  - Terra ellissoidale: **Superficie** dell'ellissoide WGS84, gravità di 
    massa puntiforme con i termini J2 e J4.
  Nel codice: `SPHERICAL_EARTH`, `ELLIPSOIDAL_EARTH`, `simulation.earth`.

- **Superficie**: superficie del **Modello di Terra** attivo, su cui la
  **Particella** può rimbalzare con un urto elastico e senza attrito, lungo 
  la **Normale locale**. Il globo disegnato da Cesium è sempre l'ellissoide
  WGS84, anche con la Terra sferica.

- **Asse di rotazione**: asse attorno al quale ruota la Terra (asse Z
  comune a **ECI** ed **ECEF**).
  Nel codice: `ROTATION_AXIS`, `rotationAxis`.

## Particella

- **Particella**: punto materiale soggetto alla gravità del **Modello di
  Terra**, in grado di rimbalzare elasticamente sulla **Superficie**. 
  Posizione, velocità, **Quota** e urti si riferiscono a questo punto.
  Quando la **Quota** è 0, il punto coincide con il punto di contatto 
  tra la **Sfera** e la **Superficie**. Nella scena è rappresentata dalla
  **Sfera**.
  Nel codice: `Particle`, `particle.state.position`.

- **Sfera**: forma geometrica che rappresenta la **Particella**.
  Ha raggio fisso ed è appoggiata sulla **Particella** lungo la 
  **Normale locale**.
  Nel codice: `particle.radius`.

- **Centro della sfera**: punto che rappresenta il centro della **Sfera**.
  Si trova ad un raggio di distanza dalla **Particella** lungo la 
  **Normale locale**. **Frecce**, **Traiettorie**, **Terna locale assoluta**, 
  **Terna locale relativa** e **Inquadratura iniziale** si riferiscono 
  a questo punto.
  Nel codice: `particle.state.sphereCenter`.

- **Quota**: distanza con segno della **Particella** dalla
  **Superficie**, lungo la **Normale locale**.
  Nel codice: `particle.state.altitude`.

- **Punto di partenza**: punto della **Superficie** sotto la
  **Particella** a t = 0. È dato da latitudine e longitudine geodetiche
  WGS84. Sulla Terra sferica è la proiezione radiale sulla sfera
  terrestre del punto WGS84 con quelle coordinate.
  Nel codice: `particle.start`.

- **Quota di partenza**: **Quota** a t = 0. Non può essere negativa.
  Nel codice: `particle.start.altitude`.

## Velocità

- **Velocità assoluta**: velocità della **Particella** rispetto a
  **ECI**.
  Nel codice: `particle.state.velocity`.

- **Velocità di trascinamento**: velocità ω × r che la **Particella**
  avrebbe se fosse solidale con la Terra.
  Nel codice: `dragVelocity`.

- **Velocità relativa**: velocità della **Particella** rispetto alla
  Terra (**ECEF**). È uguale alla **Velocità assoluta** meno la
  **Velocità di trascinamento**.
  Nel codice: `relativeVelocity`.

- **Velocità iniziale**: velocità della **Particella** a t = 0. Si può
  assegnare come **Velocità assoluta** o come **Velocità relativa**,
  entrambe con modulo [km/h], **Azimuth** [°] ed **Elevazione** [°]
  riferiti alla **Terna locale** al **Centro della sfera**.
  Nel codice: `particle.velocity`, `particle.initial`.

## Elementi della scena

- **Freccia**: rappresentazione a forma di freccia di una grandezza 
  vettoriale della **Particella**. E' disegnata lungo la direzione 
  del vettore da rappresentare a partire da un raggio di distanza 
  dal **Centro della sfera** (cioè dal bordo della **Sfera**).
  Nel codice: `Arrow`, `particle.velocityArrows`.
  
- **Freccia della velocità assoluta**: **Freccia** che rappresenta 
  la **Velocità assoluta** (rossa). La sua lunghezza è pari alla 
  distanza percorsa in 600 s a velocità costante. E' nascosta per 
  valori di velocità inferiori ad 1 m/s.
  Nel codice: `particle.velocityArrows.eci`.

- **Freccia della velocità relativa**: **Freccia** che rappresenta 
  la **Velocità relativa** (verde). La sua lunghezza è pari alla 
  distanza percorsa in 600 s a velocità costante. E' nascosta per 
  valori di velocità inferiori ad 1 m/s.
  Nel codice: `particle.velocityArrows.ecef`.

- **Terna locale assoluta**: **Terna locale** definita al **Centro della sfera** 
  a t = 0. Resta fissa nel tempo rispetto al sistema **ECI**. Gli assi sono 
  disegnati in rosso (X - Est), verde (Y - Nord) e blu (Z - Su).
  Nel codice: `particle.startFrames.eci`.

- **Terna locale relativa**: **Terna locale** definita al **Centro della sfera** 
  a t = 0. Resta fissa nel tempo rispetto al sistema **ECEF**. Gli assi sono 
  disegnati in rosso (X - Est), verde (Y - Nord) e blu (Z - Su).
  Nel codice: `particle.startFrames.ecef`.

- **Traiettoria**: rappresentazione della sequenza delle posizioni 
  del **Centro della sfera** dall'ultimo **Reset**.
  Nel codice: `Trajectory`, `particle.trajectories`.

- **Traiettoria assoluta**: **Traiettoria**, raffigurata in rosso, riferita al 
  sistema di coordinate **ECI**.
  Nel codice: `particle.trajectories.eci`.

- **Traiettoria relativa**: **Traiettoria**, raffigurata in verde, riferita al 
  sistema di coordinate **ECEF**.
  Nel codice: `particle.trajectories.ecef`.

- **Telecamera ECI / Telecamera ECEF**: le due telecamere indipendenti,
  ferme rispettivamente in **ECI** e in **ECEF**. Ognuna conserva la
  propria **Posa**.
  Nel codice: `Camera`, `simulation.cameras`.

- **Telecamera attiva**: telecamera mostrata, scelta nel pannello. Si
  può cambiare anche durante la simulazione.
  Nel codice: `viewModel.cameraMode`.

- **Posa**: posizione, direzione di vista e vettore Up di una
  telecamera.

- **Inquadratura iniziale**: **Posa** che guarda il **Centro della
  sfera** a t = 0, da **Azimuth** = 150° ed **Elevazione** = 45° nella
  **Terna locale** del **Punto di partenza**, senza rollio. La distanza
  è quella per cui il globo occupa il 95% della larghezza della vista.
  Si applica solo alle telecamere non ancora spostate dall'utente, anche
  quando arriva la posizione geografica del PC.
  Nel codice: `startPointFraming`, `Camera.frameStartPoint`.

- **Pan**: spostamento laterale della **Telecamera attiva**, con Shift e
  trascinamento con il tasto destro del mouse.
  Nel codice: `CameraRig`.

## Simulazione

- **Tempo simulato**: secondi trascorsi da t = 0 nella simulazione.
  Scorre 600 volte più veloce del tempo reale.
  Nel codice: `simulation.time`, `TIME_SCALE`.

- **Condizioni iniziali**: **Modello di Terra**, **Punto di partenza**,
  **Quota di partenza** e **Velocità iniziale**. Si possono modificare
  solo a simulazione in pausa o ferma. Ogni modifica ha effetto subito:
  la simulazione torna a t = 0 (**Reset**). Fa eccezione la scelta del
  **Punto di partenza** sul globo, che richiede prima un **Reset**.
  Nel codice: `viewModel.editable`.

- **Reset**: ritorno a t = 0 con le **Condizioni iniziali** correnti
  (pulsante Stop, oppure modifica di una delle **Condizioni iniziali**). 
  Fa ripartire le **Traiettorie** e non sposta le telecamere.
  Nel codice: `simulation.reset`, `viewModel.stop`.
