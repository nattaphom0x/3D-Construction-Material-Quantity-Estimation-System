import { Room } from './Room.js';
import { signedPolygonAreaXZ, polygonPerimeterXZ } from '../../core/MathUtils.js';

/**
 * RoomDetector — automatically detects enclosed rooms from wall graph
 * topology (project spec §11). Deterministic planar-graph face-tracing:
 *
 *  1. Build adjacency: node -> [connected nodes] (one entry per wall,
 *     both directions).
 *  2. For every unvisited directed half-edge (a -> b), walk the most
 *     clockwise next edge at each node until the walk returns to start.
 *     This traces every bounded face, including the single unbounded
 *     "outer" face.
 *  3. Distinguish outer face from real rooms using SIGNED area: for a
 *     graph embedded with this half-edge convention, interior room faces
 *     wind one way (positive signed area) and the outer face winds the
 *     other way (negative). Using |area| alone is insufficient — for a
 *     single rectangular room the interior and exterior traces have
 *     equal unsigned area, so signed winding is what tells them apart.
 */
export class RoomDetector {
    constructor(buildingModel) {
        this.model = buildingModel;
    }

    detectRooms(floorId) {
        const walls = [...this.model.walls.values()].filter(w => !floorId || w.floorId === floorId);
        if (walls.length < 3) return [];

        const adjacency = new Map(); // nodeId -> [{to: nodeId, wallId}]
        const addEdge = (a, b, wallId) => {
            if (!adjacency.has(a)) adjacency.set(a, []);
            adjacency.get(a).push({ to: b, wallId });
        };
        walls.forEach(w => { addEdge(w.startNodeId, w.endNodeId, w.id); addEdge(w.endNodeId, w.startNodeId, w.id); });

        // Sort each node's outgoing edges by angle for deterministic traversal.
        for (const [nodeId, edges] of adjacency) {
            const origin = this.model.getNode(nodeId).position;
            edges.sort((e1, e2) => {
                const p1 = this.model.getNode(e1.to).position, p2 = this.model.getNode(e2.to).position;
                return Math.atan2(p1.z - origin.z, p1.x - origin.x) - Math.atan2(p2.z - origin.z, p2.x - origin.x);
            });
        }

        const visited = new Set(); // "a->b" half-edges already consumed
        const faces = [];

        for (const w of walls) {
            for (const [a, b] of [[w.startNodeId, w.endNodeId], [w.endNodeId, w.startNodeId]]) {
                const key = `${a}->${b}`;
                if (visited.has(key)) continue;
                const face = this._traceFace(a, b, adjacency, visited);
                if (face) faces.push(face);
            }
        }

        // Interior faces have positive signed area under this half-edge
        // convention; the single outer face is negative. Drop the outer
        // face (and, defensively, keep only faces with 3+ distinct nodes).
        const rooms = faces
            .filter(f => f.nodeIds.length >= 3)
            .map(f => {
                const points = f.nodeIds.map(id => this.model.getNode(id).position);
                const signedArea = signedPolygonAreaXZ(points);
                return { ...f, signedArea, points };
            })
            .filter(f => f.signedArea > 1e-6)
            .map(f => new Room({
                floorId: floorId ?? this.model.defaultFloorId,
                boundaryNodeIds: f.nodeIds,
                boundaryWallIds: f.wallIds,
                area: Math.abs(f.signedArea),
                perimeter: polygonPerimeterXZ(f.points),
            }));

        return rooms;
    }

    _traceFace(startA, startB, adjacency, visited) {
        const nodeIds = [startA];
        const wallIds = [];
        let a = startA, b = startB;

        for (let guard = 0; guard < 10000; guard++) {
            const key = `${a}->${b}`;
            if (visited.has(key)) return null; // already part of a traced face
            visited.add(key);

            const edgeToB = adjacency.get(a).find(e => e.to === b);
            wallIds.push(edgeToB.wallId);

            if (b === startA && nodeIds.length > 2) return { nodeIds, wallIds };
            nodeIds.push(b);

            // Most clockwise turn: find edge (b -> a) in b's list, take the
            // next edge after it in angle-sorted order (wrap around).
            const edgesAtB = adjacency.get(b);
            const reverseIdx = edgesAtB.findIndex(e => e.to === a);
            const nextEdge = edgesAtB[(reverseIdx + 1) % edgesAtB.length];

            a = b;
            b = nextEdge.to;
        }
        return null; // guard tripped, malformed graph
    }
}
