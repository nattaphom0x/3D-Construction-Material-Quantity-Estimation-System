import * as THREE from 'three';
import { getWallGeometry } from '../building/wall/WallGeometry.js';
import { DEFAULT_MATERIAL_ID, getMaterials } from '../materials/MaterialLibrary.js';
import { buildStandardMaterial, applyTexturesToMaterial } from '../materials/MaterialBuilder.js';

/**
 * GeometryFactory (project spec §5, §22): the ONLY place building data
 * turns into a Three.js mesh. Nothing else should call `new THREE.Mesh`
 * for a wall or opening. Building data stays the source of truth; this
 * is a one-directional derivation.
 */
/**
 * scaleBoxUVsToRealSize — three.js's BoxGeometry gives every face the same
 * 0..1 UV square regardless of that face's actual physical proportions.
 * For a wall (length × height × thickness are almost never equal), that
 * means a single texture.repeat value stretches/squishes non-uniformly:
 * the long face gets its pattern distorted relative to the short face.
 *
 * Fix: rewrite the UV coordinates so 1 UV unit == 1 meter on every face.
 * Combined with MaterialBuilder treating repeatX/repeatY as "meters per
 * texture tile" (repeat = 1 / meters), this keeps texture tiles the same
 * real-world size and square-proportioned on every face, no matter how
 * long or short the wall is.
 *
 * Generalized to any per-face segment count `segs` (default 1, i.e. the
 * plain 4-corners-per-face case). This matters because of the
 * displacement-map fix below: with segs=1 a face has only its 4 corner
 * vertices and no shared edge vertices with its neighbor faces, so a
 * displacementMap (which actually moves vertices, not just shades them)
 * pushes each face's corners out by a different, independently-sampled
 * amount — the faces visibly separate at the seams (texture looks like
 * it "floats" off the box with gaps at the edges). Multiplying UVs by
 * the real face size works the same regardless of vertex count (UV 0..1
 * is interpolated across the face either way), so bumping `segs` here
 * and in createWallMesh/updateWallMesh is a safe, drop-in fix.
 */
export function scaleBoxUVsToRealSize(geometry, sizeX, sizeY, sizeZ, segs = 1) {
    const uv = geometry.attributes.uv;
    if (!uv) return;
    const n = Math.max(1, Math.floor(segs));
    const vertsPerFace = (n + 1) * (n + 1);
    // Order matches THREE.BoxGeometry's internal face construction order.
    const faceUnitSizes = [
        [sizeZ, sizeY], // +x (right)
        [sizeZ, sizeY], // -x (left)
        [sizeX, sizeZ], // +y (top)
        [sizeX, sizeZ], // -y (bottom)
        [sizeX, sizeY], // +z (front)
        [sizeX, sizeY], // -z (back)
    ];
    let vertexIndex = 0;
    for (const [su, sv] of faceUnitSizes) {
        for (let i = 0; i < vertsPerFace; i++) {
            const idx = vertexIndex + i;
            uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
        }
        vertexIndex += vertsPerFace;
    }
    uv.needsUpdate = true;
}

/**
 * Segment count for a wall box: enough subdivision that a displacement
 * map has real geometry to distribute across (so displaced vertices on
 * one face line up with the shared edge on the neighboring face instead
 * of tearing apart into a visible gap), but capped so huge walls don't
 * blow up the vertex count. ~1 segment per 0.5m of the longest dimension,
 * clamped to [4, 24].
 */
function wallSegmentCount(wallLength, height, thickness) {
    const longest = Math.max(wallLength, height, thickness);
    return Math.min(24, Math.max(4, Math.round(longest / 0.5)));
}


const CUT_MARGIN = 0.01; // กันขอบช่องเจาะชนขอบผนังพอดี (รูปทรงจะเสีย)

/**
 * buildWallGeometry — ผนังกล่องธรรมดาเมื่อไม่มีช่องเจาะ; ถ้ามี จะสร้างเป็น
 * Shape (หน้าตัดด้านยาว) + เจาะรู/บากขอบล่างสำหรับประตู แล้ว Extrude ตามความหนา
 * ทำให้ช่องเจาะเป็นช่องว่างจริงทะลุอีกฝั่ง
 * พิกัดโลคัล: x = ตามแนวผนัง (จาก visualCenter), y = กึ่งกลางความสูง, z = ความหนา
 */
function buildWallGeometry(wall, geo, openings) {
    const L = Math.max(geo.visualLength, 0.001);
    const H = wall.height, T = wall.thickness;
    const usable = (openings || []).filter(o => o.width > 0.01 && o.height > 0.01);
    if (usable.length === 0) {
        const segs = wallSegmentCount(L, H, T);
        const box = new THREE.BoxGeometry(L, H, T, segs, segs, segs);
        scaleBoxUVsToRealSize(box, L, H, T, segs);
        return box;
    }

    const dx = geo.end.x - geo.start.x, dz = geo.end.z - geo.start.z;
    const len = Math.max(geo.length, 1e-6);
    const shift = ((geo.visualCenter.x - geo.center.x) * dx + (geo.visualCenter.z - geo.center.z) * dz) / len;
    const hw = L / 2;

    const rects = usable.map(o => {
        const cx = (o.offset + o.width / 2) - geo.length / 2 - shift;
        const sill = Math.max(0, Math.min(o.sillHeight, H - 0.05));
        const top = Math.min(sill + o.height, H - CUT_MARGIN);
        let x0 = Math.max(cx - o.width / 2, -hw + CUT_MARGIN);
        let x1 = Math.min(cx + o.width / 2, hw - CUT_MARGIN);
        return { x0, x1, y0: sill, y1: top };
    }).filter(r => r.x1 - r.x0 > 0.01 && r.y1 - r.y0 > 0.01);

    const notches = rects.filter(r => r.y0 < CUT_MARGIN).sort((a, b) => a.x0 - b.x0);
    const holes = rects.filter(r => r.y0 >= CUT_MARGIN);

    const shape = new THREE.Shape();
    shape.moveTo(-hw, 0);
    let lastX = -hw;
    for (const n of notches) {
        if (n.x0 < lastX + 0.005) continue; // ซ้อนกัน: ข้าม
        shape.lineTo(n.x0, 0);
        shape.lineTo(n.x0, n.y1);
        shape.lineTo(n.x1, n.y1);
        shape.lineTo(n.x1, 0);
        lastX = n.x1;
    }
    shape.lineTo(hw, 0);
    shape.lineTo(hw, H);
    shape.lineTo(-hw, H);
    shape.lineTo(-hw, 0);

    for (const h of holes) {
        const path = new THREE.Path();
        path.moveTo(h.x0, h.y0);
        path.lineTo(h.x0, h.y1);
        path.lineTo(h.x1, h.y1);
        path.lineTo(h.x1, h.y0);
        path.lineTo(h.x0, h.y0);
        shape.holes.push(path);
    }

    const g = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, steps: 1 });
    g.translate(0, -H / 2, -T / 2);
    return g;
}

export class GeometryFactory {
    createWallMesh(wall, buildingModel) {
        const startNode = buildingModel.getNode(wall.startNodeId);
        const endNode = buildingModel.getNode(wall.endNodeId);
        const geo = getWallGeometry(wall, startNode, endNode, buildingModel);
        const elevation = buildingModel.floors.get(wall.floorId)?.elevation ?? 0;

        // Use the joint-extended length/center (not the raw centerline
        // length) so the mesh reaches into shared corners/T-junctions
        // instead of leaving a gap between adjoining wall boxes.
        const box = buildWallGeometry(wall, geo, buildingModel.getOpeningsForWall(wall.id));
        const matId = getMaterials()[wall.materialId] ? wall.materialId : DEFAULT_MATERIAL_ID;
        const material = buildStandardMaterial(matId);
        const mesh = new THREE.Mesh(box, material);

        mesh.position.set(geo.visualCenter.x, elevation + wall.height / 2, geo.visualCenter.z);
        mesh.rotation.y = geo.rotationY;
        mesh.userData.parametricWallId = wall.id;
        mesh.userData.isParametricWall = true;
        mesh.updateMatrix();
        mesh.userData.baseMatrix = mesh.matrix.clone();
        mesh.userData.material = matId;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    /**
     * updateWallMesh — reshapes an EXISTING wall mesh in place (geometry
     * swap + reposition + recolor) instead of the caller discarding and
     * recreating a new Object3D. Needed so a wall mesh can live inside
     * the legacy `objects` array (grouping/duplicate/lock/etc. all key
     * off object identity) without losing its slot every time the wall
     * is edited.
     */
    updateWallMesh(mesh, wall, buildingModel) {
        const startNode = buildingModel.getNode(wall.startNodeId);
        const endNode = buildingModel.getNode(wall.endNodeId);
        const geo = getWallGeometry(wall, startNode, endNode, buildingModel);
        const elevation = buildingModel.floors.get(wall.floorId)?.elevation ?? 0;

        // เก็บ transform ที่ผู้ใช้ย้าย/หมุนไว้ (delta จาก base เดิม) — ไม่งั้นการเจาะช่องจะเด้งผนังกลับตำแหน่งเดิม
        // localDelta = mesh.matrix * inverse(oldBase) (อยู่ในกรอบของ parent เดียวกัน)
        mesh.updateMatrix();
        const oldBase = mesh.userData.baseMatrix;
        const localDelta = oldBase ? oldBase.clone().invert().premultiply(mesh.matrix) : null;

        mesh.geometry.dispose();
        mesh.geometry = buildWallGeometry(wall, geo, buildingModel.getOpeningsForWall(wall.id));
        mesh.position.set(geo.visualCenter.x, elevation + wall.height / 2, geo.visualCenter.z);
        mesh.rotation.y = geo.rotationY;
        mesh.scale.set(1, 1, 1);
        mesh.updateMatrix();
        mesh.userData.baseMatrix = mesh.matrix.clone();
        if (localDelta) {
            localDelta.multiply(mesh.userData.baseMatrix).decompose(mesh.position, mesh.quaternion, mesh.scale);
            mesh.updateMatrix();
        }
        const matId = getMaterials()[wall.materialId] ? wall.materialId : DEFAULT_MATERIAL_ID;
        const matDef = getMaterials()[matId];
        if (mesh.userData.material !== matId) {
            // วัสดุเปลี่ยน (ไม่ใช่แค่รูปทรง) — สร้าง material ใหม่เพื่อให้ texture ของวัสดุใหม่ถูกโหลดด้วย
            mesh.material.dispose();
            mesh.material = buildStandardMaterial(matId);
            mesh.userData.material = matId;
        } else {
            mesh.material.color.setHex(matDef.color);
            applyTexturesToMaterial(mesh.material, matId); // เผื่อ texture ของวัสดุเดิมถูกอัปเดต
        }
        return mesh;
    }

    /**
     * ช่องเจาะถูกตัดออกจากเรขาคณิตผนังจริงแล้ว (buildWallGeometry) ฟังก์ชันนี้สร้างแค่
     * "วงกบ" บางๆ รอบช่อง (+ กระจกโปร่งใสสำหรับหน้าต่าง) ให้เห็นว่าเป็นประตู/หน้าต่าง
     * ประตูไม่มีบานทึบ — เป็นช่องว่างทะลุอีกฝั่งตามที่ตั้งใจ
     */
    createOpeningMesh(opening, placement) {
        const isWindow = opening.type === 'window';
        const w = opening.width;
        const h = placement.height ?? opening.height;
        const depth = placement.wallThickness * 1.02;
        const bar = 0.05;
        const frameMat = new THREE.MeshStandardMaterial({ color: isWindow ? 0xdfe6ea : 0x6b4a2b, roughness: 0.5, metalness: 0.1 });
        const group = new THREE.Group();

        const addBar = (bw, bh, x, y) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, depth), frameMat);
            m.position.set(x, y, 0);
            group.add(m);
        };
        addBar(w, bar, 0, h / 2 - bar / 2);           // บน
        addBar(bar, h, -w / 2 + bar / 2, 0);          // ซ้าย
        addBar(bar, h, w / 2 - bar / 2, 0);           // ขวา
        if (isWindow) {
            addBar(w, bar, 0, -h / 2 + bar / 2);      // ขอบล่างของหน้าต่าง (ประตูไม่มีธรณีประตู)
            const glass = new THREE.Mesh(
                new THREE.BoxGeometry(Math.max(w - bar * 2, 0.01), Math.max(h - bar * 2, 0.01), 0.01),
                new THREE.MeshStandardMaterial({ color: 0x8ecdf0, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35 }),
            );
            group.add(glass);
        }
        group.position.set(placement.center.x, placement.center.y, placement.center.z);
        group.rotation.y = placement.rotationY;
        group.updateMatrix();
        group.userData.baseMatrix = group.matrix.clone();
        group.userData.parametricOpeningId = opening.id;
        group.userData.isParametricOpening = true;
        group.userData.disposeShared = [frameMat];
        return group;
    }
}

