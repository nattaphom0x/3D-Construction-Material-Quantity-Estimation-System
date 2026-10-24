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
    constructor({ scene, camera, domElement, buildingModel, wallManager, gridSize = 0.25, onPreviewUpdate, createWallFn, getActiveFloor, getWallDefaults } = {}) {
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
        // Lets the tool know which floor is currently selected so the live
        // preview is drawn at that floor's elevation instead of always at
        // ground level (bug: preview used to render on the bottom-most
        // floor no matter which floor was active).
        this.getActiveFloor = getActiveFloor || (() => null);
        this.getWallDefaults = getWallDefaults || (() => ({ height: 2.5, thickness: 0.2 }));
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
    deactivate() { this.active = false; this._clearPreview(); this.startPoint = null; this.onPreviewUpdate(null); }

    _pointerToGround(clientX, clientY) {
        const rect = this.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        // Raycast against a plane at the *active* floor's elevation, not
        // always y=0 — otherwise clicks on an upper floor get projected
        // onto the ground plane and land in the wrong XZ position (the
        // higher the camera angle, the bigger the error).
        const activeFloor = this.getActiveFloor();
        const elevation = activeFloor?.elevation ?? 0;
        this.groundPlane.constant = -elevation;
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
        // Angle shown alongside length while dragging (spec request: see
        // the bearing being drawn, not just the distance). 0-360, measured
        // from +X axis, matches the rotation applied to the preview mesh.
        let angleDeg = -Math.atan2(p.z - this.startPoint.z, p.x - this.startPoint.x) * (180 / Math.PI);
        if (angleDeg < 0) angleDeg += 360;
        this.onPreviewUpdate({
            start: this.startPoint, end: p, length: distanceXZ(this.startPoint, p), angleDeg,
            snap: this.lastSnapResult, clientX, clientY,
        });
    }

    onPointerUp(clientX, clientY, { height, thickness, materialId } = {}) {
        if (!this.active || !this.startPoint) return null;
        const end = this._pointerToGround(clientX, clientY);
        this._clearPreview();
        this.onPreviewUpdate(null); // hide any live length label
        const start = this.startPoint;
        this.startPoint = null;
        if (!end || distanceXZ(start, end) < 0.1) return null;
        const activeFloor = this.getActiveFloor();
        return this.createWallFn({ start, end, height, thickness, materialId, floorId: activeFloor?.id });
    }

    _updatePreview(start, end) {
        this._clearPreview();
        const activeFloor = this.getActiveFloor();
        const elevation = activeFloor?.elevation ?? 0;
        // Preview must match what createWallFn will actually build — using
        // fixed 2.5/0.2 here made the box look oversized vs. the real wall
        // whenever the user had set custom height/thickness (most visible
        // on diagonal drags where the rotated box makes any mismatch
        // obvious).
        const defaults = this.getWallDefaults();
        const wallHeight = defaults.height;
        const thickness = defaults.thickness;
        const length = Math.max(distanceXZ(start, end), 0.01);
        const geo = new THREE.BoxGeometry(length, wallHeight, thickness);
        const snappedToEntity = this.lastSnapResult && this.lastSnapResult.targetType !== 'grid';
        const color = snappedToEntity ? 0x4dff88 : 0x4da6ff; // green = snapped to node/wall, blue = grid
        // Strongly transparent + no depth write so the preview never
        // occludes other floors/walls behind it while dragging (spec
        // request: preview must stay see-through).
        const mat = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.35, depthWrite: false,
        });
        this.previewMesh = new THREE.Mesh(geo, mat);
        // Position at the *active* floor's elevation, not always ground
        // level, so the preview shows up on whichever floor is selected.
        this.previewMesh.position.set((start.x + end.x) / 2, elevation + wallHeight / 2, (start.z + end.z) / 2);
        this.previewMesh.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x);
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