# Modello

Schema delle classi del modello (`src/model/`) e della gerarchia della
scena. Va aggiornato insieme al codice: il test
`test/modelDiagram.test.js` verifica che le classi del diagramma
corrispondano a quelle esportate da `src/model/` e che le sottoclassi di
`SceneNode` siano indicate come tali.

## Classi

Convenzioni del diagramma:
- `<|--` ereditarietà; `*--` composizione (crea e possiede);
  `-->` riferimento (usa senza possedere);
- `<<strategy>>`: oggetto che non è una classe (modelli di Terra);
- i campi `eci`/`ecef` indicano una coppia di oggetti, uno per sistema
  (vedi `bySystem`): assoluto (figlio di World) e relativo (figlio della
  Terra).

```mermaid
classDiagram
    direction TB

    class SceneNode {
        parent
        children
        position
        orientation
        addChild(child)
        removeChild(child)
        setPose(position, axes)
        setPoseFrom(node, position, axes, seconds)
        localPosition(seconds)
        localOrientation(seconds)
        transformTo(target, seconds)
        pointTo(target, seconds, point)
        vectorTo(target, seconds, vector)
        positionIn(target, seconds)
        axesIn(target, seconds)
        poseIn(target, seconds)
    }

    class Simulation {
        world
        rotationAxis
        earth
        particle
        cameras eci/ecef
        time
        reset()
        advanceTo(target)
    }

    class Earth {
        spherical
        model
        localOrientation(seconds)
    }

    class EarthModel {
        <<strategy>>
        gravity(position)
        potential(position)
        heightAboveSurface(position, normal)
        pointAboveSurface(surfacePoint, height)
    }

    class RotationAxis {
        angularVelocity
        direction
        omega
        angle(seconds)
        dragVelocity(position)
        relativeVelocity(position, velocity)
        coriolisAcceleration(position, velocity)
    }

    class Particle {
        radius
        start
        velocityMaster
        velocity eci/ecef
        initial
        state
        velocityArrows eci/ecef
        coriolisArrow
        startFrames eci/ecef
        trajectories eci/ecef
        setStartPoint(latitudeDeg, longitudeDeg)
        setStartAltitude(meters)
        setVelocity(frame, changes)
        reset(earthModel)
        recordTrajectory(seconds)
        updateDerivedState(earthModel)
    }

    class Arrow {
        localPosition(seconds)
        value(seconds)
        expressedIn(node, seconds)
    }

    class EnuFrame {
        placeAt(origin, up, source, seconds)
        toCartesian(local)
        toLocal(vector)
        fromSpherical(v)$
        toSpherical(local, v)$
    }

    class Trajectory {
        points
        revision
        addPoint(position)
        clear()
    }

    class Camera {
        movedByUser
        direction
        up
        expressedIn(node, seconds)
        setFrom(node, pose, seconds)
        frameStartPoint(frame, tanHalfFovWidth)
    }

    SceneNode <|-- Earth
    SceneNode <|-- RotationAxis
    SceneNode <|-- Particle
    SceneNode <|-- Arrow
    SceneNode <|-- EnuFrame
    SceneNode <|-- Trajectory
    SceneNode <|-- Camera

    Simulation *-- "1" SceneNode : world
    Simulation *-- "1" RotationAxis
    Simulation *-- "1" Earth
    Simulation *-- "1" Particle
    Simulation *-- "2" Camera

    Earth --> RotationAxis : ruota attorno
    Earth --> "1" EarthModel : modello attivo

    Particle --> RotationAxis : velocità di trascinamento
    Particle *-- "3" Arrow : velocità e Coriolis
    Particle *-- "2" EnuFrame : terne locali
    Particle *-- "2" Trajectory
    Arrow --> Particle : grandezza e origine

    Camera ..> EnuFrame : inquadratura iniziale
```

## Gerarchia della scena

Relazioni padre-figlio costruite da `Simulation.#buildScene()` con
`SceneNode.addChild`. Ogni nodo ha la posa espressa nel sistema del
padre: World è il sistema ECI, la Terra il sistema ECEF.

```mermaid
flowchart TB
    world["World (SceneNode, ECI)"]
    earth["Terra (Earth, ECEF)"]
    world --> earth
    world --> axis["Asse di rotazione (RotationAxis)"]
    world --> particle["Particella (Particle)"]
    world --> frameAbs["Terna locale assoluta (EnuFrame)"]
    world --> trajAbs["Traiettoria assoluta (Trajectory)"]
    world --> arrowAbs["Freccia della velocità assoluta (Arrow)"]
    world --> camEci["Telecamera ECI (Camera)"]
    earth --> frameRel["Terna locale relativa (EnuFrame)"]
    earth --> trajRel["Traiettoria relativa (Trajectory)"]
    earth --> arrowRel["Freccia della velocità relativa (Arrow)"]
    earth --> arrowCor["Freccia dell'accelerazione di Coriolis (Arrow)"]
    earth --> camEcef["Telecamera ECEF (Camera)"]
```
