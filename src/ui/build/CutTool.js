import * as THREE from 'three';
import { distanceXZ } from '../../core/MathUtils.js';

/**
 * CutTool (handoff ข้อ 4.4) — click, drag, release to draw a cut line on
 * the active floor's cut-graph. Structurally copied from WallTool: only
 * the payload differs (a 2D chord added to CutGraph, not a 3D wall mesh).
 */
export class CutTool {
    constructor({ scene, camera, domElement, getActiveFloor, getCutGraph, onCutAdded, onPreviewUpdate } = {}) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;
        this.getActiveFloor = getActiveFloor || (() => null);
        this.getCutGraph = getCutGraph || (() => null);
        this.onCutAdded = onCutAdded || (() => {});
        this.onPreviewUpdate = onPreviewUpdate || (() => {});

        this.active = false;
        this.startPoint = null;
        this.previewMesh = null;
        this.raycaster = new THREE.Raycaster();
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    }

    activate() { this.active = true; }
    deactivate() { this.active = false; this._clearPreview(); this.startPoint = null; this.onPreviewUpdate(null); }

    _pointerToGround(clientX, clientY) {
        const rect = this.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const elevation = this.getActiveFloor()?.elevation ?? 0;
        this.groundPlane.constant = -elevation;
        const point = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(this.groundPlane, point);
        if (!point) return null;
        return { x: point.x, z: point.z };
    }

    /** Snap a raw ground point to a nearby existing node/edge for live "magnetic" feedback. */
    _snapPreview(p) {
        const graph = this.getCutGraph();
        if (!graph) return p;
        const snap = graph.findSnapPoint(p.x, p.z);
        return { x: snap.x, z: snap.z, snapped: snap.snapped };
    }

    onPointerDown(clientX, clientY) {
        if (!this.active) return;
        const p = this._pointerToGround(clientX, clientY);
        if (!p) return;
        this.startPoint = this._snapPreview(p);
    }

    onPointerMove(clientX, clientY) {
        if (!this.active || !this.startPoint) return;
        const raw = this._pointerToGround(clientX, clientY);
        if (!raw) return;
        const p = this._snapPreview(raw);
        this._updatePreview(this.startPoint, p);
        this.onPreviewUpdate({ start: this.startPoint, end: p, length: distanceXZ(this.startPoint, p), snapped: p.snapped, clientX, clientY });
    }

    onPointerUp(clientX, clientY) {
        if (!this.active || !this.startPoint) return null;
        const raw = this._pointerToGround(clientX, clientY);
        const end = raw ? this._snapPreview(raw) : null;
        this._clearPreview();
        this.onPreviewUpdate(null);
        const start = this.startPoint;
        this.startPoint = null;
        if (!end || distanceXZ(start, end) < 0.05) return null;
        const graph = this.getCutGraph();
        if (!graph) return null;
        const edge = graph.addLine(start, end);
        if (edge) this.onCutAdded();
        return edge;
    }

    _updatePreview(start, end) {
        this._clearPreview();
        const elevation = this.getActiveFloor()?.elevation ?? 0;
        const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(start.x, elevation + 0.006, start.z),
            new THREE.Vector3(end.x, elevation + 0.006, end.z),
        ]);
        // สีเขียวสว่างตอนปลายเส้นกำลัง snap เข้ามุม/เส้นเดิม (ให้เห็นผล "ดูด" ชัดเจนระหว่างลาก)
        const color = end.snapped ? 0x5dffb0 : 0xffd24d;
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
        this.previewMesh = new THREE.Line(geo, mat);
        this.previewMesh.renderOrder = 999;
        this.scene.add(this.previewMesh);
    }

    _clearPreview() {
        if (!this.previewMesh) return;
        this.scene.remove(this.previewMesh);
        this.previewMesh.geometry.dispose();
        this.previewMesh.material.dispose();
        this.previewMesh = null;
    }
}
