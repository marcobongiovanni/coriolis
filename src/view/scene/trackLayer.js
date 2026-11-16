// ============================================================
// trackLayer.js — Disegno di una traiettoria della particella.
//
// Riceve i punti della traiettoria (nel sistema della traiettoria) e
// li disegna con una modelMatrix verso ECEF (identità per una
// traiettoria solidale con la Terra, rotazione ECI -> ECEF per una
// ferma nello spazio inerziale).
//
// Prestazioni: in una PolylineCollection sia la variazione del numero
// di vertici sia la variazione della modelMatrix ricostruiscono TUTTI
// i vertici della collezione. Per questo:
// - il troncone attivo (al massimo TRACK_CHUNK_SIZE vertici) sta da
//   solo in una PolylineCollection piccola, ricostruita a ogni frame;
// - quando è pieno viene "congelato" in una Primitive statica, per la
//   quale cambiare la modelMatrix costa solo l'aggiornamento di una
//   matrice, senza ricostruire la geometria.
// ============================================================

import * as Cesium from "cesium";

const TRACK_CHUNK_SIZE = 500;
const TRACK_WIDTH = 1; // [px]

export class TrackLayer {
    #color;
    #modelMatrix = Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY);
    #frozenChunks; // Tronconi completi (Primitive statiche)
    #active;       // Troncone attivo
    #activePolyline;
    #points = [];  // Vertici del troncone attivo
    #revision;     // Revisione della traiettoria disegnata
    #drawnCount = 0;

    constructor(primitives, color) {
        this.#color = color;
        this.#frozenChunks = primitives.add(new Cesium.PrimitiveCollection());
        this.#active = primitives.add(new Cesium.PolylineCollection());
    }

    // Mostra/nasconde la traccia (continua a essere aggiornata anche
    // quando è nascosta).
    set show(show) {
        this.#active.show = show;
        this.#frozenChunks.show = show;
    }

    // Allinea il disegno alla traiettoria { points, revision }: aggiunge
    // i punti nuovi e ricomincia se la traiettoria è stata azzerata.
    sync({ points, revision }) {
        if (revision !== this.#revision) {
            this.#clear();
            this.#revision = revision;
        }
        for (let i = this.#drawnCount; i < points.length; i++) {
            this.#addPoint(points[i]);
        }
        this.#drawnCount = points.length;
    }

    // Matrice dai vertici della traiettoria al sistema ECEF di Cesium.
    setModelMatrix(matrix) {
        Cesium.Matrix4.clone(matrix, this.#modelMatrix);
        Cesium.Matrix4.clone(matrix, this.#active.modelMatrix);
        for (let i = 0; i < this.#frozenChunks.length; i++) {
            Cesium.Matrix4.clone(matrix, this.#frozenChunks.get(i).modelMatrix);
        }
    }

    #clear() {
        this.#active.removeAll();
        this.#frozenChunks.removeAll();
        this.#activePolyline = undefined;
        this.#points = [];
        this.#drawnCount = 0;
    }

    #addPoint(position) {
        if (this.#points.length >= TRACK_CHUNK_SIZE) {
            const last = this.#points[this.#points.length - 1];
            // Congela il troncone completo e ne apre uno nuovo che parte
            // dall'ultimo vertice (traccia continua).
            this.#freeze(this.#points);
            this.#active.removeAll();
            this.#activePolyline = undefined;
            this.#points = [last];
        }

        this.#points.push(Cesium.Cartesian3.clone(position));
        if (this.#points.length < 2) {
            return;
        }

        if (this.#activePolyline) {
            this.#activePolyline.positions = this.#points.slice();
            return;
        }
        this.#activePolyline = this.#active.add({
            positions: this.#points.slice(),
            width: TRACK_WIDTH,
            // Ogni polilinea ha il PROPRIO materiale: Polyline._destroy()
            // distrugge il materiale associato (causa del bug del Reset).
            material: Cesium.Material.fromType("Color", { color: this.#color })
        });
    }

    #freeze(points) {
        this.#frozenChunks.add(new Cesium.Primitive({
            geometryInstances: new Cesium.GeometryInstance({
                geometry: new Cesium.PolylineGeometry({
                    positions: points,
                    width: TRACK_WIDTH,
                    // NONE: segmenti rettilinei tra i vertici, senza
                    // suddivisione lungo la superficie terrestre.
                    arcType: Cesium.ArcType.NONE,
                    vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT
                }),
                attributes: {
                    color: Cesium.ColorGeometryInstanceAttribute.fromColor(this.#color)
                }
            }),
            appearance: new Cesium.PolylineColorAppearance(),
            modelMatrix: Cesium.Matrix4.clone(this.#modelMatrix),
            asynchronous: false
        }));
    }
}
