import { generateId } from '../../core/IdGenerator.js';
import { DEFAULT_WALL_HEIGHT, DEFAULT_WALL_THICKNESS } from '../../core/Constants.js';

export class Wall {
    constructor({ id, startNodeId, endNodeId, height, thickness, floorId, materialId, assemblyId, name, visible, locked } = {}) {
        this.id = id || generateId('wall');
        this.startNodeId = startNodeId;
        this.endNodeId = endNodeId;
        this.height = height ?? DEFAULT_WALL_HEIGHT;
        this.thickness = thickness ?? DEFAULT_WALL_THICKNESS;
        this.floorId = floorId ?? null;
        this.materialId = materialId ?? 'concrete';
        this.assemblyId = assemblyId ?? null;
        this.openingIds = [];
        // Outliner-facing state (spec: wall must behave like other scene
        // structures — nameable, hideable, lockable — inside the outliner).
        this.name = name ?? null;
        this.visible = visible ?? true;
        this.locked = locked ?? false;
    }

    toJSON() {
        return {
            id: this.id, startNodeId: this.startNodeId, endNodeId: this.endNodeId,
            height: this.height, thickness: this.thickness, floorId: this.floorId,
            materialId: this.materialId, assemblyId: this.assemblyId,
            openingIds: [...this.openingIds],
            name: this.name, visible: this.visible, locked: this.locked,
        };
    }

    static fromJSON(data) {
        const wall = new Wall({ ...data });
        wall.openingIds = data.openingIds || [];
        return wall;
    }
}
