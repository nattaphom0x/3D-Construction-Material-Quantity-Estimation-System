import { signedPolygonAreaXZ, polygonPerimeterXZ } from '../core/MathUtils.js';

/**
 * FaceDetector (handoff ข้อ 4.3) — finds every enclosed sub-polygon
 * ("face") in a CutGraph. Directly modeled on RoomDetector's half-edge
 * face-trace: sort each node's edges by angle, walk the most-clockwise
 * next edge at each stop, and use SIGNED area to throw away the single
 * unbounded outer face. Since CutGraph always starts from a closed
 * boundary rectangle (see CutGraph.setBoundaryRect), every cut chord that
 * snaps onto existing geometry keeps the graph fully planar and this
 * trace finds every resulting piece, however many times it's been cut.
 */
export class FaceDetector {
    detectFaces(cutGraph) {
        const edges = [...cutGraph.edges.values()];
        if (edges.length < 3) return [];

        const adjacency = new Map(); // nodeId -> [{to, edgeId}]
        const addAdj = (a, b, edgeId) => {
            if (!adjacency.has(a)) adjacency.set(a, []);
            adjacency.get(a).push({ to: b, edgeId });
        };
        edges.forEach(e => { addAdj(e.aId, e.bId, e.id); addAdj(e.bId, e.aId, e.id); });

        for (const [nodeId, list] of adjacency) {
            const origin = cutGraph.nodes.get(nodeId);
            list.sort((e1, e2) => {
                const p1 = cutGraph.nodes.get(e1.to), p2 = cutGraph.nodes.get(e2.to);
                return Math.atan2(p1.z - origin.z, p1.x - origin.x) - Math.atan2(p2.z - origin.z, p2.x - origin.x);
            });
        }

        const visited = new Set();
        const faces = [];
        for (const e of edges) {
            for (const [a, b] of [[e.aId, e.bId], [e.bId, e.aId]]) {
                const key = `${a}->${b}`;
                if (visited.has(key)) continue;
                const face = this._traceFace(a, b, adjacency, visited);
                if (face) faces.push(face);
            }
        }

        return faces
            .filter(f => f.nodeIds.length >= 3)
            .map(f => {
                const points = f.nodeIds.map(id => cutGraph.nodes.get(id));
                return { ...f, points, signedArea: signedPolygonAreaXZ(points) };
            })
            .filter(f => f.signedArea > 1e-6) // drop the outer (negative-winding) face
            .map(f => ({
                // ไม่ผูก id กับ index อาเรย์ (handoff ข้อ 5) — สร้างจาก node id ที่เรียงแล้ว
                // จึงคงที่ตราบใดที่รูปร่างเดิมยังอยู่ แม้ลำดับ face ในผลลัพธ์จะเปลี่ยน
                id: [...f.nodeIds].sort().join('-'),
                nodeIds: f.nodeIds,
                edgeIds: f.edgeIds,
                points: f.points.map(p => ({ x: p.x, z: p.z })),
                area: Math.abs(f.signedArea),
                perimeter: polygonPerimeterXZ(f.points),
            }));
    }

    _traceFace(startA, startB, adjacency, visited) {
        const nodeIds = [startA];
        const edgeIds = [];
        let a = startA, b = startB;

        for (let guard = 0; guard < 10000; guard++) {
            const key = `${a}->${b}`;
            if (visited.has(key)) return null;
            visited.add(key);

            const edgeToB = adjacency.get(a).find(e => e.to === b);
            edgeIds.push(edgeToB.edgeId);

            if (b === startA && nodeIds.length > 2) return { nodeIds, edgeIds };
            nodeIds.push(b);

            const edgesAtB = adjacency.get(b);
            const reverseIdx = edgesAtB.findIndex(e => e.to === a);
            const nextEdge = edgesAtB[(reverseIdx + 1) % edgesAtB.length];

            a = b;
            b = nextEdge.to;
        }
        return null;
    }
}
