import { getMaterials } from '../materials/MaterialLibrary.js';

/**
 * BOQEngine (project spec §35). Consumes QuantityResult only — no math
 * of its own, no DOM. Turns byMat + materials into a structured report
 * the UI can render directly.
 */
export class BOQEngine {
    buildReport(quantityResult) {
        const { byMat, totals } = quantityResult;
        const matIds = Object.keys(byMat).filter(id => byMat[id].volume > 1e-9 || byMat[id].area > 1e-9);

        const sections = matIds.map(matId => {
            const mat = getMaterials()[matId];
            const m = byMat[matId];
            if (!mat) return null;
            return {
                materialId: matId,
                label: mat.label,
                basis: mat.basis,
                basisValue: mat.basis === 'area' ? m.area : m.volume,
                note: mat.note,
                rows: mat.components(m),
            };
        }).filter(Boolean);

        return { sections, totals, materialSummary: quantityResult.materials };
    }
}
