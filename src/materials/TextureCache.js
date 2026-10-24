/**
 * TextureCache — handles the file → texture pipeline for the material
 * texture system (ข้อ 6): reads an uploaded texture file (diff/disp/
 * nor_gl/rough) into a data URL so it can live inside MaterialLibrary's
 * registry (and get saved/loaded with the project as plain JSON), then
 * turns data URLs into cached THREE.Texture instances on demand.
 *
 * Standard image formats (png/jpg/webp) go through THREE.TextureLoader.
 * .exr files (commonly used for nor_gl/rough/disp maps) are detected by
 * sniffing the EXR magic number in the decoded bytes — file extensions
 * are lost once a File becomes a data URL, so we can't rely on the
 * uploaded filename alone — and are decoded with THREE's EXRLoader.
 */
import * as THREE from 'three';

const EXR_MAGIC = [0x76, 0x2f, 0x31, 0x01];

export function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        if (!file) { reject(new Error('ไม่พบไฟล์')); return; }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('อ่านไฟล์ไม่สำเร็จ'));
        reader.readAsDataURL(file);
    });
}

function isEXRDataURL(dataUrl) {
    const idx = typeof dataUrl === 'string' ? dataUrl.indexOf('base64,') : -1;
    if (idx === -1) return false;
    try {
        const bin = atob(dataUrl.slice(idx + 7, idx + 7 + 12));
        return EXR_MAGIC.every((b, i) => bin.charCodeAt(i) === b);
    } catch {
        return false;
    }
}

function dataURLToUint8Array(dataUrl) {
    const idx = dataUrl.indexOf('base64,');
    const bin = atob(dataUrl.slice(idx + 7));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

const textureLoader = new THREE.TextureLoader();
let exrLoaderPromise = null; // โหลด EXRLoader แบบ lazy (import แบบ dynamic) เพราะไม่ใช่ทุกโปรเจกต์จะใช้ .exr
function getEXRLoader() {
    if (!exrLoaderPromise) {
        exrLoaderPromise = import('three/addons/loaders/EXRLoader.js').then(m => new m.EXRLoader());
    }
    return exrLoaderPromise;
}

const cache = new Map(); // dataUrl -> Promise<THREE.Texture>

/** โหลด texture จาก data URL แบบมี cache (เรียกซ้ำด้วย url เดิม = ได้ instance เดิม ไม่โหลดซ้ำ) */
export function loadCachedTexture(dataUrl) {
    if (!dataUrl) return Promise.resolve(null);
    if (cache.has(dataUrl)) return cache.get(dataUrl);

    const promise = (async () => {
        if (isEXRDataURL(dataUrl)) {
            const loader = await getEXRLoader();
            const bytes = dataURLToUint8Array(dataUrl);
            return new Promise((resolve, reject) => {
                loader.parse
                    ? resolve(wrapEXRDataTexture(loader.parse(bytes.buffer)))
                    : loader.load(dataUrl, (tex) => resolve(tex), undefined, reject);
            });
        }
        return new Promise((resolve, reject) => {
            textureLoader.load(dataUrl, resolve, undefined, reject);
        });
    })();

    cache.set(dataUrl, promise);
    promise.catch(() => cache.delete(dataUrl)); // ถ้าโหลดพังให้ลองใหม่ได้ครั้งหน้า แทนที่จะแคช error ไว้ถาวร
    return promise;
}

function wrapEXRDataTexture(parsed) {
    const tex = new THREE.DataTexture(parsed.data, parsed.width, parsed.height, parsed.format, parsed.type);
    tex.needsUpdate = true;
    return tex;
}

export function clearTextureCache() {
    cache.forEach(p => p.then(tex => tex && tex.dispose && tex.dispose()).catch(() => {}));
    cache.clear();
}
