import { generateId } from '../core/IdGenerator.js';
import { distanceXZ } from '../core/MathUtils.js';

/**
 * CutGraph (handoff ข้อ 4.1) — planar straight-line graph (node+edge) for
 * cutting a land-plot rectangle into arbitrary sub-shapes. Same pattern as
 * WallManager's node graph (snap-tolerant reuse of existing points), plus
 * edge-splitting: a new point landing ON an existing edge (not just near a
 * node) cuts that edge into two so the graph stays properly planar — this
 * is what lets a chord actually terminate on the plot boundary or on a
 * previous cut instead of dangling.
 */
export class CutGraph {
    constructor() {
        this.nodes = new Map(); // id -> {id, x, z, boundary}
        this.edges = new Map(); // id -> {id, aId, bId, boundary}
    }

    clear() {
        this.nodes.clear();
        this.edges.clear();
    }

    /** Reset the graph to a rectangle boundary (starting shape before any cuts). */
    setBoundaryRect(minX, minZ, maxX, maxZ) {
        this.clear();
        const corners = [
            this._createNode(minX, minZ, true),
            this._createNode(maxX, minZ, true),
            this._createNode(maxX, maxZ, true),
            this._createNode(minX, maxZ, true),
        ];
        for (let i = 0; i < 4; i++) {
            this._createEdge(corners[i].id, corners[(i + 1) % 4].id, true);
        }
    }

    _createNode(x, z, boundary = false) {
        const node = { id: generateId('cutnode'), x, z, boundary };
        this.nodes.set(node.id, node);
        return node;
    }

    _createEdge(aId, bId, boundary = false) {
        const edge = { id: generateId('cutedge'), aId, bId, boundary };
        this.edges.set(edge.id, edge);
        return edge;
    }

    _findEdgeBetween(aId, bId) {
        for (const e of this.edges.values()) {
            if ((e.aId === aId && e.bId === bId) || (e.aId === bId && e.bId === aId)) return e;
        }
        return null;
    }

    /** Closest point on segment a-b to p, plus t in [0,1] along the segment. */
    static _closestPointOnSegment(a, b, p) {
        const abx = b.x - a.x, abz = b.z - a.z;
        const lenSq = abx * abx + abz * abz;
        if (lenSq < 1e-9) return { point: { x: a.x, z: a.z }, t: 0 };
        let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / lenSq;
        t = Math.max(0, Math.min(1, t));
        return { point: { x: a.x + abx * t, z: a.z + abz * t }, t };
    }

    /**
     * Read-only lookup: is there an existing node or edge close enough to
     * (x, z) to snap to? Used for live "magnetic" preview while dragging
     * (CutTool) without mutating the graph — actual node creation/edge
     * splitting only happens for real in snapOrSplit() on pointer-up.
     * Returns { x, z, snapped: true } or { x, z, snapped: false }.
     */
    findSnapPoint(x, z, tolerance = 0.35) {
        let best = null;
        let bestDist = tolerance;
        for (const n of this.nodes.values()) {
            const d = distanceXZ({ x: n.x, z: n.z }, { x, z });
            if (d <= bestDist) { bestDist = d; best = { x: n.x, z: n.z }; }
        }
        if (best) return { ...best, snapped: true };
        for (const e of this.edges.values()) {
            const a = this.nodes.get(e.aId), b = this.nodes.get(e.bId);
            if (!a || !b) continue;
            const { point, t } = CutGraph._closestPointOnSegment(a, b, { x, z });
            if (t > 0.02 && t < 0.98) {
                const d = distanceXZ(point, { x, z });
                if (d <= bestDist) { bestDist = d; best = { x: point.x, z: point.z }; }
            }
        }
        if (best) return { ...best, snapped: true };
        return { x, z, snapped: false };
    }

    /**
     * Resolve a raw click point to a graph node: reuse a nearby node, or
     * split whichever existing edge the point lands on, or create a fresh
     * free-floating node if neither applies.
     */
    snapOrSplit(x, z, tolerance = 0.35) {
        for (const n of this.nodes.values()) {
            if (distanceXZ({ x: n.x, z: n.z }, { x, z }) <= tolerance) return n;
        }
        for (const e of [...this.edges.values()]) {
            const a = this.nodes.get(e.aId), b = this.nodes.get(e.bId);
            if (!a || !b) continue;
            const { point, t } = CutGraph._closestPointOnSegment(a, b, { x, z });
            if (t > 0.02 && t < 0.98 && distanceXZ(point, { x, z }) <= tolerance) {
                const mid = this._createNode(point.x, point.z, e.boundary);
                this.edges.delete(e.id);
                this._createEdge(e.aId, mid.id, e.boundary);
                this._createEdge(mid.id, e.bId, e.boundary);
                return mid;
            }
        }
        return this._createNode(x, z, false);
    }

    /** Add a user-drawn cut line between two world-space points; snaps/splits both ends. */
    addLine(p1, p2, { tolerance = 0.35 } = {}) {
        const a = this.snapOrSplit(p1.x, p1.z, tolerance);
        const b = this.snapOrSplit(p2.x, p2.z, tolerance);
        if (a.id === b.id) return null; // zero-length after snapping, ignore
        const existing = this._findEdgeBetween(a.id, b.id);
        if (existing) return existing;
        return this._createEdge(a.id, b.id, false);
    }

    removeEdge(edgeId) {
        this.edges.delete(edgeId);
    }

    /** Undo the most recent user cut (never removes boundary edges). */
    removeLastCut() {
        const cuts = [...this.edges.values()].filter(e => !e.boundary);
        const last = cuts[cuts.length - 1];
        if (last) this.edges.delete(last.id);
        return last || null;
    }

    isEmpty() {
        return this.edges.size === 0;
    }

    toJSON() {
        return {
            nodes: [...this.nodes.values()],
            edges: [...this.edges.values()],
        };
    }

    static fromJSON(data) {
        const g = new CutGraph();
        (data?.nodes || []).forEach(n => g.nodes.set(n.id, { ...n }));
        (data?.edges || []).forEach(e => g.edges.set(e.id, { ...e }));
        return g;
    }
}
