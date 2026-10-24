import { Events } from '../../core/EventBus.js';

/**
 * CreateWallCommand (project spec §42). execute() creates the wall via
 * WallManager (so events fire correctly); undo() removes it by id.
 *
 * IMPORTANT: after the FIRST execute(), nodes already exist in the
 * model — so redo() must NOT call wallManager.createWall() again with
 * raw start/end points (that would re-run node-snap lookup and could
 * attach to a different id, breaking any Opening that references the
 * wall's id, or any Room boundary referencing it). Instead, redo()
 * re-inserts the wall directly with its ORIGINAL id and node ids,
 * keeping every downstream reference (openings, rooms) valid, and
 * manually emits WALL_CREATED since model.addWall() itself is silent
 * (only WallManager.createWall emits, and we bypass it here on purpose).
 */
export class CreateWallCommand {
    constructor(wallManager, wallProps) {
        this.wallManager = wallManager;
        this.wallProps = wallProps;
        this.pinnedWallSnapshot = null; // {id, startNodeId, endNodeId, height, thickness, floorId, materialId}
    }

    execute() {
        const model = this.wallManager.model;
        if (!this.pinnedWallSnapshot) {
            // First run: real creation, including node snap/creation.
            const wall = this.wallManager.createWall(this.wallProps);
            this.pinnedWallSnapshot = { ...wall.toJSON() };
            return wall;
        }
        // Redo: nodes already exist (undo only removed the wall, not its
        // nodes — see undo() below), so re-insert with the SAME id.
        const wall = model.addWall({ ...this.pinnedWallSnapshot });
        model.events.emit(Events.WALL_CREATED, { wall });
        return wall;
    }

    undo() {
        if (this.pinnedWallSnapshot) this.wallManager.deleteWall(this.pinnedWallSnapshot.id);
    }
}