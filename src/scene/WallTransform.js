import * as THREE from 'three';

/**
 * ผนังเป็นข้อมูลแบบ node (โมเดล) แต่ผู้ใช้ย้าย/หมุน/สเกลที่ตัว mesh ผ่าน gizmo โดยไม่เขียนกลับเข้า node
 * → "พิกัดโมเดล" (userData.baseMatrix) กับ "พิกัดโลกจริง" (matrixWorld) ต่างกันด้วย delta:
 *     delta = wallMesh.matrixWorld * inverse(wallMesh.userData.baseMatrix)
 * ทุกอย่างที่คำนวณจากโมเดล (เจาะช่อง, วาง opening mesh, พรีวิว) ต้องผ่าน delta นี้
 */
export function getWallDelta(wallMesh, target = new THREE.Matrix4()) {
    if (!wallMesh || !wallMesh.userData.baseMatrix) return target.identity();
    wallMesh.updateWorldMatrix(true, false);
    return target.copy(wallMesh.userData.baseMatrix).invert().premultiply(wallMesh.matrixWorld);
}

/** จุดในโลก (เช่น hit.point) → พิกัดโมเดลของผนังนั้น (ไว้คำนวณ offset บนเส้นกึ่งกลาง) */
export function worldToWallModel(wallMesh, worldPoint, target = new THREE.Vector3()) {
    const inv = getWallDelta(wallMesh).invert();
    return target.copy(worldPoint).applyMatrix4(inv);
}

/** ใช้ delta ของผนังกับ Object3D ที่วางด้วยพิกัดโมเดล (ต้องมี userData.baseMatrix และ parent เป็น scene) */
export function applyWallDelta(obj, wallMesh) {
    const base = obj.userData.baseMatrix;
    if (!base) return;
    const m = getWallDelta(wallMesh).multiply(base);
    m.decompose(obj.position, obj.quaternion, obj.scale);
    obj.updateMatrix();
    obj.updateMatrixWorld(true);
}
