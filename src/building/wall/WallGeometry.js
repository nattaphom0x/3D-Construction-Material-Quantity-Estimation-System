import { distanceXZ, angleXZ, midpoint } from '../../core/MathUtils.js';

/**
 * Engine-independent derivation of a wall's geometric properties from its
 * two endpoint nodes. Returns plain numbers/points — no Three.js.
 *
 * Corner/joint fix: a wall BOX built exactly from centerline-to-centerline
 * (length = distance between node positions) only reaches the *point*
 * where two walls' centerlines meet, not the corner of their volumes. At
 * an L-corner or T-junction that leaves a visible triangular/diagonal gap
 * between the two wall boxes (the edge doesn't fully cover the joint).
 *
 * Fix (rendering only): whenever an end sits on a node shared by another
 * wall (a real joint, not a free-standing end), extend that end outward
 * so the mesh overlaps into the corner and the seam is hidden rather
 * than gapped. This must NOT change `length`/`center`, since BOQ
 * quantities (WallCalculator) and opening placement
 * (OpeningManager/OpeningTool) key off the true centerline length —
 * only the mesh geometry should grow. Those extended values are
 * exposed separately as `visualLength`/`visualCenter` for GeometryFactory.
 *
 * Extension amount (miter, not fixed): a flat `thickness/2` only closes
 * the gap for an exact 90° corner. Freehand-drawn walls (WallTool drag)
 * can join at any angle, and `thickness/2` under/over-extends at
 * anything else — visible as a dark seam/gap between the two wall
 * faces at the joint. Instead derive the extension from the actual
 * angle between this wall and whichever other wall shares the node:
 * extend = thickness / (2 * tan(interiorAngle / 2)). At 90° this
 * reduces to the old thickness/2 (tan(45°) = 1); near-collinear walls
 * (interiorAngle -> 180°) need ~no extension; sharp angles are capped
 * so the box doesn't blow up.
 */
function angleXZof(v) { return Math.atan2(v.z, v.x); }

function normalizeAngleDiff(a) {
    let d = a % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
}

/** Extension needed at `node` so `wall`'s box reaches into the corner formed with the other wall sharing that node. */
function jointExtension(node, wall, dirAwayFromNode, model) {
    const thickness = wall.thickness;
    const maxExtend = thickness * 4; // cap so near-parallel/acute joints don't produce absurd geometry
    if (!model) return (node.connectedWallIds?.size ?? 0) > 1 ? thickness / 2 : 0;

    const otherWallId = [...node.connectedWallIds].find(id => id !== wall.id);
    if (!otherWallId) return 0;
    const otherWall = model.getWall(otherWallId);
    if (!otherWall) return thickness / 2;

    const otherStart = model.getNode(otherWall.startNodeId);
    const otherEnd = model.getNode(otherWall.endNodeId);
    if (!otherStart || !otherEnd) return thickness / 2;
    const farNode = otherStart.id === node.id ? otherEnd : otherStart;
    const otherDir = {
        x: farNode.position.x - node.position.x,
        z: farNode.position.z - node.position.z,
    };
    const otherLen = Math.hypot(otherDir.x, otherDir.z);
    if (otherLen < 1e-6) return thickness / 2;

    const interiorAngle = normalizeAngleDiff(angleXZof(dirAwayFromNode) - angleXZof(otherDir));
    const half = interiorAngle / 2;
    if (half < 1e-3 || half > Math.PI / 2 - 1e-3) return thickness / 2; // degenerate: fall back to the old safe value
    const extend = thickness / (2 * Math.tan(half));
    return Math.min(Math.max(extend, 0), maxExtend);
}

export function getWallGeometry(wall, startNode, endNode, model) {
    const start = startNode.position;
    const end = endNode.position;
    const length = distanceXZ(start, end);
    const dirX = length > 0 ? (end.x - start.x) / length : 1;
    const dirZ = length > 0 ? (end.z - start.z) / length : 0;

    const isJoint = (node) => (node.connectedWallIds?.size ?? 0) > 1;
    const extendStart = isJoint(startNode)
        ? jointExtension(startNode, wall, { x: -dirX, z: -dirZ }, model)
        : 0;
    const extendEnd = isJoint(endNode)
        ? jointExtension(endNode, wall, { x: dirX, z: dirZ }, model)
        : 0;

    const visualLength = length + extendStart + extendEnd;
    // Shift the centerline midpoint along the wall direction by however
    // much more we grew on the end side vs. the start side.
    const shift = (extendEnd - extendStart) / 2;
    const mid = midpoint(start, end);
    const visualCenter = {
        x: mid.x + dirX * shift,
        y: mid.y,
        z: mid.z + dirZ * shift,
    };

    return {
        start, end,
        length,
        rotationY: -angleXZ(start, end), // Three.js Y-rotation convention (negated for CW-from-above)
        center: mid,
        height: wall.height,
        thickness: wall.thickness,
        visualLength,
        visualCenter,
    };
}
