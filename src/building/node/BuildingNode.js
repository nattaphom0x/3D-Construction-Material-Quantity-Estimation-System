import { generateId } from '../../core/IdGenerator.js';

export class BuildingNode {
    constructor({ id, position, floorId } = {}) {
        this.id = id || generateId('node');
        this.position = { x: position?.x ?? 0, y: position?.y ?? 0, z: position?.z ?? 0 };
        this.floorId = floorId ?? null;
        this.connectedWallIds = new Set();
    }

    addWall(wallId) { this.connectedWallIds.add(wallId); }
    removeWall(wallId) { this.connectedWallIds.delete(wallId); }

    toJSON() {
        return {
            id: this.id,
            position: { ...this.position },
            floorId: this.floorId,
            connectedWallIds: [...this.connectedWallIds],
        };
    }

    static fromJSON(data) {
        const node = new BuildingNode({ id: data.id, position: data.position, floorId: data.floorId });
        (data.connectedWallIds || []).forEach(id => node.addWall(id));
        return node;
    }
}
