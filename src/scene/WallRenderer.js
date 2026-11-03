import { Events } from '../core/EventBus.js';
import { GeometryFactory } from '../geometry/GeometryFactory.js';

/**
 * WallRenderer (project spec §51): reacts to BuildingModel events and
 * keeps Three.js meshes in sync. The renderer never writes back to the
 * model — data flows one way, model -> mesh.
 */
export class WallRenderer {
    constructor(buildingModel, scene, { onMeshCreated } = {}) {
        this.model = buildingModel;
        this.scene = scene;
        this.factory = new GeometryFactory();
        this.meshesByWallId = new Map();
        this.onMeshCreated = onMeshCreated || (() => {});

        this.model.events.on(Events.WALL_CREATED, ({ wall }) => this._createOrUpdateMesh(wall));
        this.model.events.on(Events.WALL_CHANGED, ({ wall }) => this._createOrUpdateMesh(wall));
        this.model.events.on(Events.WALL_DELETED, ({ wallId }) => this._removeMesh(wallId));
    }

    _createOrUpdateMesh(wall) {
        let mesh = this.meshesByWallId.get(wall.id);
        if (mesh) {
            this.factory.updateWallMesh(mesh, wall, this.model);
            mesh.visible = wall.visible !== false;
            return mesh;
        }
        mesh = this.factory.createWallMesh(wall, this.model);
        mesh.visible = wall.visible !== false;
        this.meshesByWallId.set(wall.id, mesh);
        this.scene.add(mesh);
        // New instance — let the caller fold it into the legacy `objects`
        // outliner array instead of it only living in this map, so it
        // gets group/duplicate/lock/rename for free.
        this.onMeshCreated(mesh, wall);
        return mesh;
    }

    _removeMesh(wallId) {
        const mesh = this.meshesByWallId.get(wallId);
        if (!mesh) return;
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        this.meshesByWallId.delete(wallId);
    }

    /** ล้าง mesh ผนังทั้งหมด (ใช้ก่อนโหลดโปรเจกต์ — กัน mesh เก่าค้างใน map แล้วผนังที่ id ซ้ำไม่ถูกสร้างใหม่) */
    clearAll() {
        [...this.meshesByWallId.keys()].forEach(id => this._removeMesh(id));
    }

    renderAll() {
        this.model.walls.forEach(wall => this._createOrUpdateMesh(wall));
    }
}
