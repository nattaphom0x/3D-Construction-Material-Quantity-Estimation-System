import { distanceXZ, snapToGrid } from '../core/MathUtils.js';

/**
 * SnappingSystem (project spec §20-21). A generic engine that returns
 * candidate snap results; callers (WallTool, etc.) don't embed snap
 * logic themselves. Priority: node endpoint > wall edge/midpoint > grid.
 */
export class SnappingSystem {
    constructor(buildingModel, { gridSize = 0.25, snapDistance = 0.3 } = {}) {
        this.model = buildingModel;
        this.gridSize = gridSize;
        this.snapDistance = snapDistance;
    }

    /** @returns {{snapped:boolean, position:object, targetType:string, targetId:string|null, distance:number}} */
    snap(rawPosition) {
        let best = null;

        // 1. Node endpoints — highest priority (lets walls actually connect).
        for (const node of this.model.nodes.values()) {
            const d = distanceXZ(rawPosition, node.position);
            if (d <= this.snapDistance && (!best || d < best.distance)) {
                best = { snapped: true, position: { ...node.position }, targetType: 'node', targetId: node.id, distance: d };
            }
        }
        if (best) return best;

        // 2. Wall midpoints/edges.
        for (const wall of this.model.walls.values()) {
            const s = this.model.getNode(wall.startNodeId)?.position;
            const e = this.model.getNode(wall.endNodeId)?.position;
            if (!s || !e) continue;
            const mid = { x: (s.x + e.x) / 2, y: 0, z: (s.z + e.z) / 2 };
            const d = distanceXZ(rawPosition, mid);
            if (d <= this.snapDistance && (!best || d < best.distance)) {
                best = { snapped: true, position: mid, targetType: 'wall-midpoint', targetId: wall.id, distance: d };
            }
        }
        if (best) return best;

        // 3. Grid fallback — always "succeeds".
        const gridPos = { x: snapToGrid(rawPosition.x, this.gridSize), y: 0, z: snapToGrid(rawPosition.z, this.gridSize) };
        return { snapped: true, position: gridPos, targetType: 'grid', targetId: null, distance: distanceXZ(rawPosition, gridPos) };
    }

    setGridSize(size) { this.gridSize = size; }
    setSnapDistance(dist) { this.snapDistance = dist; }
}
