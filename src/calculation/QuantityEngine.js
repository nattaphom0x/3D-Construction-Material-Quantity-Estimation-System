import { calculateWall } from './calculators/WallCalculator.js';
import { calculateRoom } from './calculators/RoomCalculator.js';
import { aggregateMaterials } from './aggregation/MaterialAggregator.js';
import { DEFAULT_MATERIAL_ID } from '../materials/MaterialLibrary.js';

/**
 * QuantityEngine (project spec §30). Reads a BuildingModel and returns
 * a QuantityResult. Must NOT depend on DOM or Three.js — verified by the
 * fact this file has no such imports.
 */
export class QuantityEngine {
    calculate(buildingModel) {
        const warnings = [];
        const walls = [...buildingModel.walls.values()].map(w => calculateWall(w, buildingModel));
        const rooms = [...buildingModel.rooms.values()].map(r => calculateRoom(r));

        // Bucket wall quantities by materialId, matching the original
        // collectMetrics() grouping so BOQ formulas receive the same shape.
        const byMat = {};
        for (const wall of buildingModel.walls.values()) {
            const matId = wall.materialId || DEFAULT_MATERIAL_ID;
            const calc = walls.find(w => w.wallId === wall.id);
            if (!byMat[matId]) byMat[matId] = { volume: 0, area: 0, sourceWallIds: [] };
            byMat[matId].volume += calc.netVolume;
            byMat[matId].area += calc.netArea;
            byMat[matId].sourceWallIds.push(wall.id);
        }

        const materials = aggregateMaterials(byMat);

        const totals = {
            totalWallLength: walls.reduce((s, w) => s + w.length, 0),
            totalWallGrossArea: walls.reduce((s, w) => s + w.grossArea, 0),
            totalWallNetArea: walls.reduce((s, w) => s + w.netArea, 0),
            totalWallVolume: walls.reduce((s, w) => s + w.netVolume, 0),
            totalRoomArea: rooms.reduce((s, r) => s + r.area, 0),
        };

        return { elements: { walls, rooms }, materials, byMat, totals, warnings };
    }
}
