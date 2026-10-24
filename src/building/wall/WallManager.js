import { Events } from '../../core/EventBus.js';
import { MIN_WALL_LENGTH } from '../../core/Constants.js';
import { distanceXZ } from '../../core/MathUtils.js';

/**
 * WallManager — the only sanctioned way to create/edit/delete walls
 * (project spec §10). Keeps the node graph consistent and emits events
 * so RoomDetector/QuantityEngine/Renderer can react (spec §51).
 */
export class WallManager {
    constructor(buildingModel) {
        this.model = buildingModel;
    }

    createWall({ start, end, height, thickness, floorId, materialId, name } = {}) {
        const startNode = this._findOrCreateNode(start, floorId);
        const endNode = this._findOrCreateNode(end, floorId);

        const length = distanceXZ(startNode.position, endNode.position);
        if (length < MIN_WALL_LENGTH) {
            throw new Error(`Wall length ${length.toFixed(3)}m is below minimum ${MIN_WALL_LENGTH}m`);
        }

        // Snapshot walls already sharing these nodes BEFORE adding the new
        // wall: joining a third wall at a node can turn a previously
        // free-standing/straight end into a joint (see WallGeometry's
        // isJoint extension), so those existing wall meshes need to be
        // re-derived too or their end will keep the old gap.
        const affectedWallIds = new Set([...startNode.connectedWallIds, ...endNode.connectedWallIds]);

        const wall = this.model.addWall({
            startNodeId: startNode.id, endNodeId: endNode.id,
            height, thickness, floorId: floorId ?? this.model.defaultFloorId, materialId, name,
        });
        this.model.events.emit(Events.WALL_CREATED, { wall });
        this._notifyWalls(affectedWallIds);
        return wall;
    }

    /** Re-emit WALL_CHANGED for walls whose joint status may have shifted (not the wall that just fired its own event). */
    _notifyWalls(wallIds) {
        wallIds.forEach(wallId => {
            const wall = this.model.getWall(wallId);
            if (wall) this.model.events.emit(Events.WALL_CHANGED, { wall });
        });
    }

    renameWall(wallId, name) { this.setWallProperty(wallId, 'name', name); }
    setWallVisible(wallId, visible) { this.setWallProperty(wallId, 'visible', visible); }
    setWallLocked(wallId, locked) { this.setWallProperty(wallId, 'locked', locked); }

    /** Snap-tolerant node reuse: existing node within tolerance is reused so walls connect. */
    _findOrCreateNode(position, floorId, tolerance = 0.05) {
        for (const node of this.model.nodes.values()) {
            if (distanceXZ(node.position, position) <= tolerance) return node;
        }
        return this.model.addNode(position, floorId ?? this.model.defaultFloorId);
    }

    moveNode(nodeId, newPosition) {
        const node = this.model.getNode(nodeId);
        if (!node) return;
        node.position = { ...newPosition };
        this.model.events.emit(Events.NODE_CHANGED, { node });
        node.connectedWallIds.forEach(wallId => {
            const wall = this.model.getWall(wallId);
            if (wall) this.model.events.emit(Events.WALL_CHANGED, { wall });
        });
    }

    setWallLength(wallId, newLength, { anchor = 'end' } = {}) {
        const wall = this.model.getWall(wallId);
        if (!wall) return;
        const startNode = this.model.getNode(wall.startNodeId);
        const endNode = this.model.getNode(wall.endNodeId);
        const dx = endNode.position.x - startNode.position.x;
        const dz = endNode.position.z - startNode.position.z;
        const currentLength = Math.sqrt(dx * dx + dz * dz) || 1;
        const ux = dx / currentLength, uz = dz / currentLength;

        if (anchor === 'end') {
            this.moveNode(wall.endNodeId, {
                x: startNode.position.x + ux * newLength, y: endNode.position.y,
                z: startNode.position.z + uz * newLength,
            });
        } else {
            this.moveNode(wall.startNodeId, {
                x: endNode.position.x - ux * newLength, y: startNode.position.y,
                z: endNode.position.z - uz * newLength,
            });
        }
    }

    setWallProperty(wallId, prop, value) {
        const wall = this.model.getWall(wallId);
        if (!wall) return;
        wall[prop] = value;
        this.model.events.emit(Events.WALL_CHANGED, { wall });
    }

    deleteWall(wallId) {
        const wall = this.model.getWall(wallId);
        if (!wall) return;
        const startNode = this.model.getNode(wall.startNodeId);
        const endNode = this.model.getNode(wall.endNodeId);
        const affectedWallIds = new Set([
            ...(startNode?.connectedWallIds ?? []),
            ...(endNode?.connectedWallIds ?? []),
        ]);
        affectedWallIds.delete(wallId);

        this.model.removeWall(wallId);
        this.model.events.emit(Events.WALL_DELETED, { wallId });
        this._notifyWalls(affectedWallIds);
    }
}
