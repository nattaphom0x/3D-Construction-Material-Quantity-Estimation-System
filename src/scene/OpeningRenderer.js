import { Events } from '../core/EventBus.js';
import { GeometryFactory } from '../geometry/GeometryFactory.js';
import { applyWallDelta } from './WallTransform.js';

/**
 * OpeningRenderer (project spec §51, §13). Reacts to OPENING_CHANGED and
 * WALL_CHANGED (openings must move if their host wall moves) to keep
 * door/window meshes in sync with the BuildingModel. One-way data flow,
 * same as WallRenderer.
 */
export class OpeningRenderer {
    constructor(buildingModel, scene, openingManager, { getWallMesh } = {}) {
        this.getWallMesh = getWallMesh || (() => null);
        this.model = buildingModel;
        this.scene = scene;
        this.openingManager = openingManager;
        this.factory = new GeometryFactory();
        this.meshesByOpeningId = new Map();

        this.model.events.on(Events.OPENING_CHANGED, ({ opening, openingId }) => {
            if (opening) this._createOrUpdateMesh(opening);
            else if (openingId) this._removeMesh(openingId);
        });
        this.model.events.on(Events.WALL_CHANGED, ({ wall }) => {
            this.model.getOpeningsForWall(wall.id).forEach(o => this._createOrUpdateMesh(o));
        });
        this.model.events.on(Events.WALL_CREATED, ({ wall }) => {
            this.model.getOpeningsForWall(wall.id).forEach(o => this._createOrUpdateMesh(o));
        });
        this.model.events.on(Events.WALL_DELETED, ({ wallId }) => {
            [...this.meshesByOpeningId.keys()].forEach(openingId => {
                const opening = this.model.getOpening(openingId);
                if (!opening || opening.wallId === wallId) this._removeMesh(openingId);
            });
        });
    }

    _createOrUpdateMesh(opening) {
        this._removeMesh(opening.id);
        const wall = this.model.getWall(opening.wallId);
        if (!wall) return; // host wall gone
        const placement = this.openingManager.getOpeningPlacement(opening);
        const mesh = this.factory.createOpeningMesh(opening, placement);
        // ผนังถูกย้าย/หมุนที่ mesh → ช่องที่สร้างใหม่/อัปเดตต้องตาม transform ของผนังด้วย (รวมการหมุนแต่ละชิ้น)
        const wallMesh = this.getWallMesh(opening.wallId);
        if (wallMesh) applyWallDelta(mesh, wallMesh);
        this.meshesByOpeningId.set(opening.id, mesh);
        this.scene.add(mesh);
    }

    _removeMesh(openingId) {
        const mesh = this.meshesByOpeningId.get(openingId);
        if (!mesh) return;
        this.scene.remove(mesh);
        mesh.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material && !(mesh.userData.disposeShared || []).includes(obj.material)) obj.material.dispose();
        });
        (mesh.userData.disposeShared || []).forEach(m => m.dispose());
        this.meshesByOpeningId.delete(openingId);
    }

    renderAll() {
        this.model.openings.forEach(o => this._createOrUpdateMesh(o));
    }
}
