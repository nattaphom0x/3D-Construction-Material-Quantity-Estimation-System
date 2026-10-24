/**
 * MaterialLibrary — migrated verbatim from the original script.js
 * MATERIALS object (project spec §33: "Preserve the formulas unless
 * demonstrably incorrect"). Only the input shape changed: these
 * components(m) functions used to receive {volume, area} aggregated from
 * mesh world-scale; now they receive the same shape aggregated from
 * WallCalculator output. The math itself is untouched.
 *
 * m = { volume: ลบ.ม., area: ตร.ม. }
 */

export const COUNT_UNITS = ['ก้อน', 'ถุง'];

export function boqRow(name, qty, unit, decimals = 0) {
    // rawQty = ค่าก่อนปัดเศษ — ใช้ให้ค่าเผื่อสูญเสียคูณก่อนปัด (ไม่ปัดซ้อนสองรอบ)
    const qtyOut = COUNT_UNITS.includes(unit) ? ceilQty(qty) : qty;
    return { name, qty: qtyOut, rawQty: qty, unit, decimals };
}

/**
 * ปัดขึ้นเป็นจำนวนเต็ม (ก้อน/ถุง) โดยตัดเศษทศนิยมลอยตัวก่อน
 * เช่น 1.5 × 130 ใน JS ได้ 195.00000000000003 ซึ่ง Math.ceil จะปัดเป็น 196
 * แต่ CEILING ใน Excel และการคำนวณมือได้ 195 — ฟังก์ชันนี้ทำให้ตรงกัน
 */
export function ceilQty(x) {
    return Math.ceil(Number(x.toFixed(9)));
}

export const MATERIALS = {
    concrete: {
        label: 'ผนังคอนกรีต',
        color: 0x8a8f98,
        basis: 'volume',
        note: 'ส่วนผสม 1:2:4 ต่อ 1 ลบ.ม. ใช้ปูน ~324 กก. ทราย 0.57 ลบ.ม. หิน 1.09 ลบ.ม. — ค่าประมาณของโครงงาน (มยผ. 1101-64 เป็นมาตรฐานงานคอนกรีต ไม่ได้ระบุชุดค่านี้โดยตรง)',
        components(m) {
            const v = m.volume;
            return [
                boqRow('ปูนซีเมนต์ปอร์ตแลนด์ (50กก.)', v * (324 / 50), 'ถุง'),
                boqRow('ทรายหยาบ', v * 0.57, 'คิว', 2),
                boqRow('หินก่อสร้าง (1-2)', v * 1.09, 'คิว', 2)
            ];
        }
    },
    brick: {
        label: 'ผนังก่ออิฐมอญ',
        color: 0xb5651d,
        basis: 'area',
        note: 'ก่อครึ่งแผ่น ~130 ก้อน/ตร.ม. + ปูนก่อ 15 กก. และทราย 0.05 ลบ.ม./ตร.ม.',
        components(m) {
            const a = m.area;
            return [
                boqRow('อิฐมอญ', a * 130, 'ก้อน'),
                boqRow('ปูนซีเมนต์ (ปูนก่อ)', a * (15 / 50), 'ถุง'),
                boqRow('ทรายหยาบ', a * 0.05, 'คิว', 2)
            ];
        }
    },
    aac: {
        label: 'ผนังอิฐมวลเบา',
        color: 0xd9d2c5,
        basis: 'area',
        note: 'บล็อกมวลเบา 20×60 ซม. 8.33 ก้อน/ตร.ม. + ปูนก่อสำเร็จรูป 1 ถุง/39 ตร.ม.',
        components(m) {
            const a = m.area;
            return [
                boqRow('อิฐมวลเบา', a * 8.33, 'ก้อน'),
                boqRow('ปูนก่อมวลเบาสำเร็จรูป', a * (1 / 39), 'ถุง')
            ];
        }
    },
    concreteBlock: {
        label: 'ผนังคอนกรีตบล็อก',
        color: 0x9a9d93,
        basis: 'area',
        note: 'บล็อกกลวงมาตรฐาน 19×39 ซม. ~12.5 ก้อน/ตร.ม. + ปูนก่อ 12 กก. และทราย 0.04 ลบ.ม./ตร.ม.',
        components(m) {
            const a = m.area;
            return [
                boqRow('คอนกรีตบล็อก (19×39ซม.)', a * 12.5, 'ก้อน'),
                boqRow('ปูนซีเมนต์ (ปูนก่อ)', a * (12 / 50), 'ถุง'),
                boqRow('ทรายหยาบ', a * 0.04, 'คิว', 2)
            ];
        }
    },
    interlockBlock: {
        label: 'ผนังอิฐบล็อกประสาน',
        color: 0xc9a876,
        basis: 'area',
        note: 'บล็อกประสานมาตรฐาน ~13 ก้อน/ตร.ม. ก่อแห้งด้วยเดือยบล็อก ไม่ใช้ปูนก่อ',
        components(m) {
            const a = m.area;
            return [
                boqRow('อิฐบล็อกประสาน', a * 13, 'ก้อน')
            ];
        }
    }
};

export const DEFAULT_MATERIAL_ID = 'concrete';

/* =====================================================================
   ข้อ 6: TEXTURE SYSTEM — วัสดุกำหนดเอง (custom materials) + texture
   ต่อวัสดุ (diff/disp/nor_gl/rough)
   -----------------------------------------------------------------------
   - `customMaterials` เก็บวัสดุที่ผู้ใช้เพิ่มเองผ่านหน้าจัดการพื้นผิว
     (แยกจาก MATERIALS ตัวหลักที่เป็นสูตร BOQ คงที่ตาม มยผ. — วัสดุใหม่
     ยังไม่มีสูตรคำนวณของตัวเอง จึงยืม `components()` ของ concrete/default
     ไปพลางก่อน ผู้ใช้ปรับ label/สี/texture ได้ แต่การคำนวณ BOQ อ้างอิงวัสดุ
     มาตรฐานที่ใกล้เคียงที่สุด)
   - `textures` เก็บ path (data URL) ของแต่ละ slot ต่อวัสดุ (ทั้งมาตรฐาน
     และกำหนดเอง) + ค่า repeat/dispScale
   - persist ลง localStorage เพื่อให้อยู่รอดข้ามการรีเฟรชหน้า, และยัง
     serialize/load ผ่านไฟล์โปรเจกต์ (.json) ได้ด้วย (ข้อ save/load)
   ===================================================================== */


/* =====================================================================
   การตั้งค่าปริมาณวัสดุ (จากผลประเมินผู้เชี่ยวชาญ)
   - wastePct[matId]  ค่าเผื่อสูญเสีย % ต่อวัสดุ (ค่าเริ่มต้น 0 = ผลเท่าเดิม)
   - sandStoneBulking ตัวคูณทราย/หิน (หน่วยคิว) เผื่อพองตัว/หลวม (เริ่มต้น 1 = ไม่คูณ)
   ลำดับคำนวณ: ค่าดิบ × (1 + เผื่อ%) × bulking(เฉพาะหน่วยคิว) แล้วค่อยปัดขึ้น (ก้อน/ถุง)
   ===================================================================== */
export const RECOMMENDED_WASTE_PCT = { concrete: 7.5, brick: 7.5, aac: 5, concreteBlock: 5, interlockBlock: 5 }; // กลางช่วง 5–10 / 3–10 ที่ผู้ตอบใช้ (ปรับได้)
let boqSettings = { wastePct: {}, sandStoneBulking: 1 };

export function getBoqSettings() {
    return { wastePct: { ...boqSettings.wastePct }, sandStoneBulking: boqSettings.sandStoneBulking };
}
export function setWastePct(matId, pct) {
    const v = Number(pct);
    boqSettings.wastePct[matId] = Number.isFinite(v) && v >= 0 ? Math.min(v, 100) : 0;
    persist();
}
export function setSandStoneBulking(f) {
    const v = Number(f);
    boqSettings.sandStoneBulking = Number.isFinite(v) && v >= 1 ? Math.min(v, 2) : 1;
    persist();
}
export function applyRecommendedWaste() {
    boqSettings.wastePct = { ...RECOMMENDED_WASTE_PCT };
    persist();
}
export function resetBoqSettings() {
    boqSettings = { wastePct: {}, sandStoneBulking: 1 };
    persist();
}

/** ห่อ components() ของวัสดุ ให้คูณค่าเผื่อ/พองตัวก่อนปัดขึ้น */
function withSettings(id, componentsFn) {
    return function (m) {
        const waste = 1 + (boqSettings.wastePct[id] || 0) / 100;
        return componentsFn.call(this, m).map(r => {
            let q = (r.rawQty ?? r.qty) * waste;
            if (r.unit === 'คิว') q *= boqSettings.sandStoneBulking;
            // adjQty = ค่าหลังเผื่อ/พองตัว ยังไม่ปัด — ใช้รวมข้ามวัสดุแล้วค่อยปัดที่ยอดรวม
        return { ...r, qty: COUNT_UNITS.includes(r.unit) ? ceilQty(q) : q, adjQty: q };
        });
    };
}

const STORAGE_KEY = 'boq_material_registry_v1';

let customMaterials = {};
let textures = {}; // matId -> { diff, disp, nor_gl, rough, repeatX, repeatY, dispScale }

function loadFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') {
            customMaterials = data.customMaterials || {};
            textures = data.textures || {};
            if (data.boqSettings) boqSettings = { wastePct: data.boqSettings.wastePct || {}, sandStoneBulking: data.boqSettings.sandStoneBulking || 1 };
        }
    } catch {
        // localStorage ใช้ไม่ได้ (เช่น private mode) หรือข้อมูลเสีย — ไม่ต้องพัง แค่เริ่มจากค่าว่าง
    }
}
loadFromStorage();

function persist() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ customMaterials, textures, boqSettings }));
    } catch {
        // เต็มโควตา/ปิดไว้ — ไม่ critical เพราะยัง save ผ่านไฟล์โปรเจกต์ได้อยู่ดี
    }
}

/** รายการวัสดุทั้งหมดที่ใช้ได้ตอนนี้ (มาตรฐาน + กำหนดเอง) — เรียกใหม่ทุกครั้งหลังแก้ registry */
export function getMaterials() {
    const merged = {};
    Object.keys(MATERIALS).forEach(id => {
        merged[id] = { ...MATERIALS[id], components: withSettings(id, MATERIALS[id].components) };
    });
    Object.keys(customMaterials).forEach(id => {
        const base = MATERIALS[DEFAULT_MATERIAL_ID];
        merged[id] = {
            ...base,
            ...customMaterials[id],
            isCustom: true,
            components: withSettings(id, base.components), // ยืมสูตรของวัสดุตั้งต้นไปก่อน + ค่าเผื่อของตัวเอง
        };
    });
    return merged;
}

export function addCustomMaterial(id, { label, color }) {
    customMaterials[id] = { label: label || 'วัสดุใหม่', color: (typeof color === 'number' ? color : 0x9a9d93) };
    persist();
}

export function removeCustomMaterial(id) {
    delete customMaterials[id];
    delete textures[id];
    persist();
}

export function getMaterialTextures(id) {
    return textures[id];
}

/** เซ็ต/แก้ไข field ของ texture วัสดุนั้นแบบ merge (ค่า null/undefined = ลบ field นั้นทิ้ง) */
export function setMaterialTextures(id, patch) {
    const current = { ...(textures[id] || {}) };
    Object.keys(patch).forEach(key => {
        const value = patch[key];
        if (value === null || value === undefined) delete current[key];
        else current[key] = value;
    });
    textures[id] = current;
    persist();
}

export function clearMaterialTextures(id) {
    delete textures[id];
    persist();
}

/** สำหรับบันทึกลงไฟล์โปรเจกต์ (.json) ให้วัสดุ/texture ที่ผู้ใช้ตั้งค่าไว้ติดไปกับไฟล์ด้วย */
export function serializeMaterialRegistry() {
    return { customMaterials: { ...customMaterials }, textures: { ...textures }, boqSettings: getBoqSettings() };
}

/** โหลด registry จากไฟล์โปรเจกต์ (แทนที่ของเดิมทั้งหมด) แล้ว persist ต่อ */
export function loadMaterialRegistry(data) {
    if (!data || typeof data !== 'object') return;
    customMaterials = { ...(data.customMaterials || {}) };
    textures = { ...(data.textures || {}) };
    if (data.boqSettings) boqSettings = { wastePct: data.boqSettings.wastePct || {}, sandStoneBulking: data.boqSettings.sandStoneBulking || 1 };
    persist();
}
