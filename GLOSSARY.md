# Glossario

Termini usati per indicare in modo univoco concetti e oggetti del
progetto. Ogni termine indica un solo concetto ed ogni concetto ha 
un solo termine che lo definisce. I termini in grassetto rimandano 
alla loro definizione. Dove esiste, è indicato l'elemento 
corrispondente nel codice.

## Gerarchia della scena

- **Nodo di scena**: elemento del modello che corrisponde a un oggetto
  della scena. I nodi formano una gerarchia con relazioni padre-figlio:
  ogni nodo ha un solo padre e la sua posa è espressa nel sistema di
  coordinate del padre.
  Nel codice: `SceneNode`.

- **World**: **Nodo di scena** radice della gerarchia (senza padre). Il
  suo sistema di coordinate è **ECI**. Figli: **Terra**, **Asse di
  rotazione**, **Particella**, **Terna locale assoluta**, **Traiettoria
  assoluta**, **Freccia della velocità assoluta**, **Telecamera ECI**.
  Nel codice: `simulation.world`.

- **Terra**: **Nodo di scena** figlio di **World**, il cui sistema di
  coordinate è **ECEF**: ruota rispetto a **World** attorno all'**Asse
  di rotazione**. Contiene il **Modello di Terra** attivo. Figli:
  **Terna locale relativa**, **Traiettoria relativa**, **Freccia della
  velocità relativa**, **Freccia dell'accelerazione di Coriolis**,
  **Telecamera ECEF**, **Punto di partenza**.
  Nel codice: `Earth`, `simulation.earth`.

## Sistemi di riferimento

- **ECI**: sistema di riferimento inerziale, fermo nello spazio, con
  origine nel centro della Terra e asse Z lungo l'**Asse di rotazione**.
  Tutta la dinamica è calcolata in questo sistema.

- **ECEF**: sistema di riferimento solidale con la Terra, che ruota con
  velocità angolare `OMEGA` attorno all'**Asse di rotazione**. A t = 0
  coincide con **ECI**. È il sistema di coordinate della **Terra**.
  Nel codice: `Earth` (`localOrientation`), `SceneNode.pointTo`/`vectorTo`.

- **Terna locale** (East-North-Up): terna cartesiana destrorsa con
  origine in un punto arbitrario. Gli assi X, Y e Z sono diretti 
  rispettivamente verso Est, verso Nord e lungo la **Normale locale** 
  nel punto. L'asse X è orizzontale e perpendicolare all'**Asse di
  rotazione**; ai poli, dove non è definito, si usa per convenzione
  l'asse Y di **ECEF**.
  Nel codice: `EnuFrame`, `enuRotation`.

- **Normale locale**: vettore di modulo unitario perpendicolare alla
  **Superficie** in un punto e diretto verso l'esterno. È radiale per la
  Terra sferica e geodetica per quella ellissoidale. È l'asse Z della
  **Terna locale**.
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
  Nel codice: `SPHERICAL_EARTH`, `ELLIPSOIDAL_EARTH`, `simulation.earth.model`.

- **Superficie**: superficie del **Modello di Terra** attivo, su cui la
  **Particella** può rimbalzare con un urto elastico e senza attrito, lungo 
  la **Normale locale**. Il globo disegnato da Cesium è sempre l'ellissoide
  WGS84, anche con la Terra sferica.

- **Asse di rotazione**: asse attorno al quale ruota la **Terra** (asse
  Z comune a **ECI** ed **ECEF**), con velocità angolare `OMEGA`.
  Figlio di **World**.
  Nel codice: `RotationAxis`, `simulation.rotationAxis`.

## Particella

- **Particella**: oggetto fisico simulato, cioè il punto materiale
  soggetto alla gravità del **Modello di Terra** e in grado di rimbalzare
  elasticamente sulla **Superficie**. Il termine indica sempre l'oggetto
  fisico, mai la sua forma disegnata (che è la **Sfera**).
  Posizione, velocità, **Quota** e urti si riferiscono a questo punto.
  Quando la **Quota** = 0, il punto coincide con il punto di contatto 
  tra la **Sfera** e la **Superficie**. Figlia di **World**.
  Nel codice: `Particle`, `particle.state.position`. **Particella** e
  **Sfera** appartengono allo stesso **Nodo di scena** (`Particle`).

- **Sfera**: forma geometrica con cui la **Particella** è disegnata
  nella scena. Il termine indica sempre la forma disegnata, mai
  l'oggetto fisico. Ha raggio fisso, che non entra nella dinamica, ed è
  appoggiata sulla **Particella** lungo la **Normale locale**.
  Nel codice: `particle.radius` (stesso **Nodo di scena** della
  **Particella**).

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
  terrestre del punto WGS84 con quelle coordinate. Figlio della
  **Terra**.
  Nel codice: `StartPoint`, `particle.startPoint` (`latitudeDeg`,
  `longitudeDeg`).

- **Quota di partenza**: **Quota** a t = 0. Non può essere negativa.
  Nel codice: `particle.start.altitude`.

## Dinamica

- **Velocità assoluta**: velocità della **Particella** rispetto a
  **ECI**.
  Nel codice: `particle.state.velocity`.

- **Velocità di trascinamento**: velocità *ω × r* che la **Particella**
  avrebbe se fosse solidale con la Terra, calcolata in funzione della 
  distanza dall'**Asse di rotazione**.
  Nel codice: `RotationAxis.dragVelocity`.

- **Velocità relativa**: velocità della **Particella** rispetto alla
  Terra (**ECEF**). È uguale alla **Velocità assoluta** meno la
  **Velocità di trascinamento**.
  Nel codice: `RotationAxis.relativeVelocity`.

- **Velocità iniziale**: velocità della **Particella** a t = 0. Si può
  assegnare come **Velocità assoluta** o come **Velocità relativa**,
  entrambe con modulo [km/h], **Azimuth** [°] ed **Elevazione** [°]
  riferiti alla **Terna locale** al **Centro della sfera**.
  Nel codice: `particle.velocity.eci` (assoluta), `particle.velocity.ecef`
  (relativa), `particle.initial.velocity`.

- **Accelerazione di Coriolis**: Accelerazione espressa nel sistema 
  **ECEF** e calcolata come *-2 * ω x **Velocità relativa*** dove *ω* 
  è il vettore allineato all'**Asse di rotazione** di lunghezza pari 
  ad `OMEGA` e orientato verso il Polo Nord.
  Nel codice: `RotationAxis.coriolisAcceleration`.

## Elementi della scena

- **Freccia**: rappresentazione a forma di freccia di una grandezza 
  vettoriale della **Particella**. E' disegnata lungo la direzione 
  del vettore da rappresentare a partire da un raggio di distanza 
  dal **Centro della sfera** (cioè dal bordo della **Sfera**).
  Nel codice: `Arrow`, `particle.velocityArrows`, `particle.coriolisArrow`.
  
- **Freccia della velocità assoluta**: **Freccia** che rappresenta 
  la **Velocità assoluta** (rossa). La sua lunghezza è pari alla 
  distanza percorsa in 600 s a velocità costante. E' nascosta per 
  valori di velocità inferiori ad 1 m/s. Figlia di **World**.
  Nel codice: `particle.velocityArrows.eci`.

- **Freccia della velocità relativa**: **Freccia** che rappresenta 
  la **Velocità relativa** (verde). La sua lunghezza è pari alla 
  distanza percorsa in 600 s a velocità costante. E' nascosta per 
  valori di velocità inferiori ad 1 m/s. Figlia della **Terra**.
  Nel codice: `particle.velocityArrows.ecef`.

- **Freccia dell'accelerazione di Coriolis**: **Freccia** che rappresenta
  la componente orizzontale dell'**Accelerazione di Coriolis** (gialla),
  cioè la sua proiezione sul piano perpendicolare alla **Normale locale**
  nella **Particella**. La sua lunghezza è proporzionale al modulo di
  questa componente: 8000 km per ogni m/s². Con **Velocità relativa**
  orizzontale il modulo vale 2·`OMEGA`·v·sin φ, con φ la latitudine: ai
  poli la freccia è lunga circa il doppio della **Freccia della velocità
  relativa**, all'equatore è nulla. E' nascosta per valori inferiori a
  10⁻⁴ m/s². Figlia della **Terra**.
  Nel codice: `particle.coriolisArrow`, `tangentialComponent`.

- **Terna locale assoluta**: **Terna locale** definita al **Centro della sfera** 
  a t = 0. Resta fissa nel tempo rispetto al sistema **ECI**. Gli assi sono
  disegnati in rosso (X - Est), verde (Y - Nord) e blu (Z - Su).
  Figlia di **World**.
  Nel codice: `particle.startFrames.eci`.

- **Terna locale relativa**: **Terna locale** definita al **Centro della sfera** 
  a t = 0. Resta fissa nel tempo rispetto al sistema **ECEF**. Gli assi sono
  disegnati in rosso (X - Est), verde (Y - Nord) e blu (Z - Su).
  Figlia della **Terra**.
  Nel codice: `particle.startFrames.ecef`.

- **Traiettoria**: rappresentazione della sequenza delle posizioni 
  del **Centro della sfera** dall'ultimo **Reset**.
  Nel codice: `Trajectory`, `particle.trajectories`.

- **Traiettoria assoluta**: **Traiettoria**, raffigurata in rosso, riferita al
  sistema di coordinate **ECI**. Figlia di **World**.
  Nel codice: `particle.trajectories.eci`.

- **Traiettoria relativa**: **Traiettoria**, raffigurata in verde, riferita al
  sistema di coordinate **ECEF**. Figlia della **Terra**.
  Nel codice: `particle.trajectories.ecef`.

- **Telecamera ECI / Telecamera ECEF**: le due telecamere indipendenti,
  ferme rispettivamente in **ECI** e in **ECEF**: figlie
  rispettivamente di **World** e della **Terra**. Ognuna conserva la
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
