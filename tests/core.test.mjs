import * as THREE from 'three';
import { distanceXZ } from '../../core/MathUtils.js';
import { SnappingSystem } from '../../interaction/SnappingSystem.js';

/**
 * WallTool (project spec §9): click start, drag, live preview (length
 * shown), release to confirm. The preview mesh never touches the
 * BuildingModel until the user releases — only WallManager.createWall()
 * commits data. Uses SnappingSystem (spec §20-21) so drawing snaps to
 * existing nodes/wall midpoints before falling back to the grid.
 */
export class WallTool {
    constructor({ scene, camera, domElement, buildingModel, wallManager, gridSize = 0.25, onPreviewUpdate, createWallFn } = {}) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;
        this.model = buildingModel;
        this.wallManager = wallManager;
        // Optional override so callers (e.g. AppBootstrap) can route wall
        // creation through a CommandManager for undo/redo, without
        // WallTool needing to know history exists (spec §42: history
        // logic stays out of tool/UI code).
        this.createWallFn = createWallFn || ((props) => this.wallManager.createWall(props));
        this.gridSize = gridSize;
        this.onPreviewUpdate = onPreviewUpdate || (() => {});
        this.snapping = new SnappingSystem(buildingModel, { gridSize });

        this.active = false;
        this.startPoint = null;
        this.lastSnapResult = null;
        this.previewMesh = null;
        this.raycaster = new THREE.Raycaster();
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    }

    activate() { this.active = true; }
    deactivate() { this.active = false; this._clearPreview(); this.startPoint = null; }

    _pointerToGround(clientX, clientY) {
        const rect = this.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const point = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(this.groundPlane, point);
        if (!point) return null;
        const raw = { x: point.x, y: 0, z: point.z };
        const snapResult = this.snapping.snap(raw);
        this.lastSnapResult = snapResult;
        return snapResult.position;
    }

    onPointerDown(clientX, clientY) {
        if (!this.active) return;
        const p = this._pointerToGround(clientX, clientY);
        if (!p) return;
        this.startPoint = p;
    }

    onPointerMove(clientX, clientY) {
        if (!this.active || !this.startPoint) return;
        const p = this._pointerToGround(clientX, clientY);
        if (!p) return;
        this._updatePreview(this.startPoint, p);
        this.onPreviewUpdate({ start: this.startPoint, end: p, length: distanceXZ(this.startPoint, p), snap: this.lastSnapResult });
    }

    onPointerUp(clientX, clientY, { height, thickness, materialId } = {}) {
        if (!this.active || !this.startPoint) return null;
        const end = this._pointerToGround(clientX, clientY);
        this._clearPreview();
        const start = this.startPoint;
        this.startPoint = null;
        if (!end || distanceXZ(start, end) < 0.1) return null;
        return this.createWallFn({ start, end, height, thickness, materialId });
    }

    _updatePreview(start, end) {
        this._clearPreview();
        const length = Math.max(distanceXZ(start, end), 0.01);
        const geo = new THREE.BoxGeometry(length, 2.5, 0.2);
        const snappedToEntity = this.lastSnapResult && this.lastSnapResult.targetType !== 'grid';
        const color = snappedToEntity ? 0x4dff88 : 0x4da6ff; // green = snapped to node/wall, blue = grid
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 });
        this.previewMesh = new THREE.Mesh(geo, mat);
        this.previewMesh.position.set((start.x + end.x) / 2, 1.25, (start.z + end.z) / 2);
        this.previewMesh.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x);
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