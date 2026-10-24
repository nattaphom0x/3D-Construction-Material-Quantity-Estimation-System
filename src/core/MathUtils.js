/**
 * MathUtils — plain-number 2D/3D helpers with NO Three.js dependency
 * (project spec §4). Points are {x, y, z}, y is up.
 */

export function distance3D(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function distanceXZ(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    return Math.sqrt(dx * dx + dz * dz);
}

export function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

export function angleXZ(a, b) {
    return Math.atan2(b.z - a.z, b.x - a.x);
}

/** Shoelace formula on the XZ plane. Returns signed area (CCW positive). */
export function signedPolygonAreaXZ(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        sum += (p1.x * p2.z - p2.x * p1.z);
    }
    return sum / 2;
}

export function polygonAreaXZ(points) {
    return Math.abs(signedPolygonAreaXZ(points));
}

export function polygonPerimeterXZ(points) {
    let perim = 0;
    for (let i = 0; i < points.length; i++) {
        perim += distanceXZ(points[i], points[(i + 1) % points.length]);
    }
    return perim;
}

export function snapToGrid(value, gridSize) {
    if (!gridSize) return value;
    return Math.round(value / gridSize) * gridSize;
}

export function roundTo(value, decimals = 3) {
    const f = Math.pow(10, decimals);
    return Math.round(value * f) / f;
}
