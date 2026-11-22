// ============================================================
// sceneNode.js — Nodo della gerarchia della scena.
//
// Ogni elemento del modello che corrisponde a un oggetto della scena
// discende da SceneNode. I nodi formano un albero con relazioni
// padre-figlio, costruito con addChild(); la radice è il nodo "World"
// (parent nullo), il cui sistema di coordinate è ECI.
//
// POSA
// Ogni nodo ha un proprio sistema di coordinate, la cui posa è espressa
// in quello del padre:
//   position     origine del sistema del nodo;
//   orientation  assi X, Y, Z del sistema del nodo (colonne, versori).
// Per difetto la posa è costante (identità: il sistema del nodo
// coincide con quello del padre). Le sottoclassi la rendono variabile
// nel tempo ridefinendo localPosition() o localOrientation(): la Terra
// ruota attorno all'asse di rotazione, una freccia segue la particella.
//
// Tutto il codice relativo alla posa sta qui: le sottoclassi usano
// positionIn()/axesIn() per esprimerla nel sistema di un altro nodo e
// setPose()/setPoseFrom() per impostarla.
// ============================================================

import * as Cesium from "cesium";

const UNIT_AXES = [Cesium.Cartesian3.UNIT_X, Cesium.Cartesian3.UNIT_Y, Cesium.Cartesian3.UNIT_Z];

export class SceneNode {
    parent = null; // Nodo padre (null finché non è aggiunto, e per la radice)
    children = [];

    // Posa nel sistema del padre (vedi intestazione).
    position = new Cesium.Cartesian3();
    orientation = Cesium.Matrix3.clone(Cesium.Matrix3.IDENTITY);

    // --------------------------------------------------
    // GERARCHIA
    // --------------------------------------------------

    // Aggiunge "child" ai figli, togliendolo dal padre precedente.
    // Restituisce "child".
    addChild(child) {
        if (child.parent) {
            child.parent.removeChild(child);
        }
        child.parent = this;
        this.children.push(child);
        return child;
    }

    // Toglie "child" dai figli.
    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) {
            this.children.splice(index, 1);
            child.parent = null;
        }
    }

    // --------------------------------------------------
    // POSA NEL SISTEMA DEL PADRE
    // --------------------------------------------------

    // Assi X, Y, Z del nodo nel sistema del padre (copie).
    get axes() {
        return [0, 1, 2].map((i) => Cesium.Matrix3.getColumn(this.orientation, i, new Cesium.Cartesian3()));
    }

    // Imposta la posa: origine "position" e assi "axes" ([X, Y, Z],
    // versori ortogonali), nel sistema del padre.
    setPose(position, axes) {
        Cesium.Cartesian3.clone(position, this.position);
        axes.forEach((axis, i) => Cesium.Matrix3.setColumn(this.orientation, i, axis, this.orientation));
    }

    // Imposta la posa da origine e assi espressi nel sistema del nodo
    // "node" all'istante "seconds". Senza padre, sono già nel sistema
    // del padre.
    setPoseFrom(node, position, axes, seconds) {
        const parent = this.parent;
        if (!parent) {
            this.setPose(position, axes);
            return;
        }
        this.setPose(
            node.pointTo(parent, seconds, position),
            axes.map((axis) => node.vectorTo(parent, seconds, axis))
        );
    }

    // Origine del nodo nel sistema del padre all'istante "seconds" [s
    // simulati]. Costante per difetto.
    localPosition(seconds, result = new Cesium.Cartesian3()) {
        return Cesium.Cartesian3.clone(this.position, result);
    }

    // Assi del nodo nel sistema del padre all'istante "seconds".
    // Costanti per difetto.
    localOrientation(seconds, result = new Cesium.Matrix3()) {
        return Cesium.Matrix3.clone(this.orientation, result);
    }

    // Matrice dalle coordinate del nodo a quelle del padre all'istante
    // "seconds".
    localTransform(seconds, result = new Cesium.Matrix4()) {
        return Cesium.Matrix4.fromRotationTranslation(
            this.localOrientation(seconds), this.localPosition(seconds), result
        );
    }

    // --------------------------------------------------
    // TRASFORMAZIONI TRA I SISTEMI DEI NODI
    // --------------------------------------------------

    // Matrice dalle coordinate del nodo a quelle della radice.
    worldTransform(seconds, result = new Cesium.Matrix4()) {
        const local = new Cesium.Matrix4();
        this.localTransform(seconds, result);
        for (let node = this.parent; node; node = node.parent) {
            Cesium.Matrix4.multiplyTransformation(node.localTransform(seconds, local), result, result);
        }
        return result;
    }

    // Matrice dalle coordinate del nodo a quelle del nodo "target"
    // (della stessa gerarchia) all'istante "seconds".
    transformTo(target, seconds, result = new Cesium.Matrix4()) {
        const toWorld = this.worldTransform(seconds, result);
        const fromWorld = Cesium.Matrix4.inverseTransformation(
            target.worldTransform(seconds), new Cesium.Matrix4()
        );
        return Cesium.Matrix4.multiplyTransformation(fromWorld, toWorld, result);
    }

    // Punto "point" (coordinate del nodo) nelle coordinate di "target".
    pointTo(target, seconds, point, result = new Cesium.Cartesian3()) {
        return Cesium.Matrix4.multiplyByPoint(this.transformTo(target, seconds), point, result);
    }

    // Vettore "vector" (coordinate del nodo) nelle coordinate di
    // "target": solo rotazione, senza traslazione.
    vectorTo(target, seconds, vector, result = new Cesium.Cartesian3()) {
        return Cesium.Matrix4.multiplyByPointAsVector(this.transformTo(target, seconds), vector, result);
    }

    // Origine del nodo nelle coordinate di "target" all'istante
    // "seconds".
    positionIn(target, seconds, result = new Cesium.Cartesian3()) {
        return this.pointTo(target, seconds, Cesium.Cartesian3.ZERO, result);
    }

    // Assi X, Y, Z del nodo nelle coordinate di "target" all'istante
    // "seconds" (copie).
    axesIn(target, seconds) {
        return UNIT_AXES.map((axis) => this.vectorTo(target, seconds, axis));
    }

    // Posa { position, axes } del nodo nelle coordinate di "target"
    // all'istante "seconds" (copie).
    poseIn(target, seconds) {
        return { position: this.positionIn(target, seconds), axes: this.axesIn(target, seconds) };
    }
}
