/**
 * MaterialBuilder — turns a material id from MaterialLibrary into an
 * actual THREE.MeshStandardMaterial, including any diff/disp/nor_gl/rough
 * textures configured for it (ข้อ 6). Texture loading is async (files
 * are decoded from data URLs), so buildStandardMaterial() returns a
 * material immediately using the flat color, then applyTexturesToMaterial()
 * fills in the maps once loaded and flips material.needsUpdate.
 */
import * as THREE from 'three';
import { getMaterials, getMaterialTextures } from './MaterialLibrary.js';
import { loadCachedTexture } from './TextureCache.js';

/**
 * repeatX/repeatY (from MaterialLibrary's texture settings) are "meters per
 * texture tile" — i.e. how large one repeat of the pattern is in real-world
 * units, NOT a raw repeat count. Wall geometry now carries real-meter UVs
 * (see GeometryFactory.scaleBoxUVsToRealSize), so texture.repeat = 1/meters
 * turns that into an actual repeat count that stays correct — and square —
 * no matter how long or short a given wall is, instead of one fixed repeat
 * count getting stretched over whatever face happens to be longer.
 */
function configureRepeat(tex, repeatX, repeatY) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    const tileMetersX = repeatX > 0 ? repeatX : 1;
    const tileMetersY = repeatY > 0 ? repeatY : 1;
    tex.repeat.set(1 / tileMetersX, 1 / tileMetersY);
    tex.needsUpdate = true;
}

export function buildStandardMaterial(matId, opts = {}) {
    const mat = getMaterials()[matId];
    const material = new THREE.MeshStandardMaterial({
        color: opts.color ?? mat?.color ?? 0x9a9d93,
        roughness: opts.roughness ?? 0.85,
        metalness: opts.metalness ?? 0.05,
        side: opts.side ?? THREE.FrontSide,
    });
    applyTexturesToMaterial(material, matId);
    return material;
}

/** โหลดและใส่ texture (ถ้ามีตั้งค่าไว้) ให้ material ที่มีอยู่แล้ว — ใช้ตอนสร้างใหม่และตอน
 * ผู้ใช้อัปโหลด/ล้าง texture ของวัสดุที่ใช้อยู่ในฉากแล้ว (reapplyTexturesForMaterial ใน script.js) */
export function applyTexturesToMaterial(material, matId) {
    if (!material) return;
    const tex = getMaterialTextures(matId) || {};
    const repeatX = tex.repeatX ?? 1;
    const repeatY = tex.repeatY ?? 1;

    const slotMap = {
        diff: 'map',
        disp: 'displacementMap',
        nor_gl: 'normalMap',
        rough: 'roughnessMap',
    };

    Object.entries(slotMap).forEach(([slotKey, matProp]) => {
        const dataUrl = tex[slotKey];
        if (!dataUrl) {
            if (material[matProp]) {
                material[matProp] = null;
                material.needsUpdate = true;
            }
            return;
        }
        loadCachedTexture(dataUrl).then(texture => {
            if (!texture) return;
            const t = texture.clone();
            t.needsUpdate = true;
            // diff คือสี/ลายที่ต้องตีความเป็น sRGB, ส่วน disp/nor_gl/rough เป็นข้อมูลดิบ ไม่ใช่สี
            t.colorSpace = slotKey === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            configureRepeat(t, repeatX, repeatY);
            material[matProp] = t;
            // dispScale default lowered from 0.05 → 0.01: at 5cm the map was
            // pushing vertices far enough that even subdivided geometry could
            // show a visible seam between the wall's faces at the edges.
            if (matProp === 'displacementMap') material.displacementScale = tex.dispScale ?? 0.00;
            material.needsUpdate = true;
        }).catch(() => { /* ไฟล์เสีย/โหลดไม่สำเร็จ — คงค่าที่มีอยู่เดิมไว้ ไม่ทำให้แอปพัง */ });
    });

    if (!tex.disp) material.displacementScale = 0;
}
