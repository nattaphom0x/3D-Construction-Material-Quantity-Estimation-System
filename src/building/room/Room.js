import { generateId } from '../../core/IdGenerator.js';

export class Room {
    constructor({ id, floorId, boundaryNodeIds, boundaryWallIds, area, perimeter } = {}) {
        this.id = id || generateId('room');
        this.floorId = floorId ?? null;
        this.boundaryNodeIds = boundaryNodeIds || [];
        this.boundaryWallIds = boundaryWallIds || [];
        this.area = area ?? 0;
        this.perimeter = perimeter ?? 0;
    }

    toJSON() {
        return {
            id: this.id, floorId: this.floorId,
            boundaryNodeIds: [...this.boundaryNodeIds],
            boundaryWallIds: [...this.boundaryWallIds],
            area: this.area, perimeter: this.perimeter,
        };
    }

    static fromJSON(data) { return new Room({ ...data }); }
}
