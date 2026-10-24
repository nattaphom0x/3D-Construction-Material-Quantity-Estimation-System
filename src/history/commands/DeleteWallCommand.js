import { Events } from '../../core/EventBus.js';

/**
 * DeleteWallCommand (project spec §42). Mirrors CreateWallCommand: execute()
 * removes the wall via WallManager (so WALL_DELETED fires and nodes stay
 * consistent); undo() re-inserts the wall directly from its snapshot with
 * the ORIGINAL id, so any Opening/Room still referencing that wall id
 * remains valid, and manually emits WALL_CREATED since we bypass
 * WallManager.createWall's node-snap path on purpose (the nodes already
 * exist — deleteWall does not remove them).
 */
export class DeleteWallCommand {
    constructor(wallManager, wallId) {
        this.wallManager = wallManager;
        this.wallId = wallId;
        this.wallSnapshot = null; // {id, startNodeId, endNodeId, height, thickness, floorId, materialId}
    }

    execute() {
        const model = this.wallManager.model;
        const wall = model.getWall(this.wallId);
        if (wall) this.wallSnapshot = { ...wall.toJSON() };
        this.wallManager.deleteWall(this.wallId);
    }

    undo() {
        if (!this.wallSnapshot) return;
        const model = this.wallManager.model;
        const wall = model.addWall({ ...this.wallSnapshot });
        model.events.emit(Events.WALL_CREATED, { wall });
    }
}
