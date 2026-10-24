import { getMaterials, ceilQty, COUNT_UNITS } from '../../materials/MaterialLibrary.js';

/**
 * MaterialAggregator — migrated from original summarizeMaterials()
 * (project spec §34). If several elements use the same material, their
 * component rows are summed into one purchasing total, matched by
 * "name|unit" so different materials that happen to both need cement
 * (e.g. concrete + brick) merge into one cement line.
 *
 * byMat: { [materialId]: { volume, area, sourceWallIds } }
 */
export function aggregateMaterials(byMat) {
    const matIds = Object.keys(byMat).filter(id => (byMat[id].volume > 1e-9 || byMat[id].area > 1e-9));
    const totals = {};

    matIds.forEach(matId => {
        const mat = getMaterials()[matId];
        if (!mat) return;
        mat.components(byMat[matId]).forEach(r => {
            const key = r.name + '|' + r.unit;
            if (!totals[key]) totals[key] = { name: r.name, unit: r.unit, qty: 0, decimals: r.decimals || 0, sources: {} };
            // รวมค่าดิบ (หลังเผื่อ ก่อนปัด) แล้วปัดครั้งเดียวที่ยอดรวม
            const q = r.adjQty ?? r.rawQty ?? r.qty;
            totals[key].qty += q;
            totals[key].decimals = Math.max(totals[key].decimals, r.decimals || 0);
            totals[key].sources[matId] = (totals[key].sources[matId] || 0) + q;
        });
    });
    Object.values(totals).forEach(t => {
        if (COUNT_UNITS.includes(t.unit)) t.qty = ceilQty(t.qty);
    });

    return Object.values(totals);
}
