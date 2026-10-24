import { BuildingModel } from '../building/BuildingModel.js';
import { PROJECT_VERSION } from '../core/Constants.js';

/**
 * ProjectSerializer (project spec §43, §44). Serializes the parametric
 * BuildingModel only — never Three.js Mesh objects. Old (legacy) flat
 * mesh-array saves from the original app (version: 1) are kept alongside
 * under a separate "legacy" key rather than lost, since they describe
 * free-form objects the parametric model doesn't (yet) represent.
 */
export function serializeProject(buildingModel, legacyData) {
    return {
        version: PROJECT_VERSION,
        building: buildingModel.toJSON(),
        legacy: legacyData ?? null, // old script.js scene-graph save, preserved as-is
    };
}

export function loadProject(json) {
    if (!json || typeof json !== 'object') throw new Error('Invalid project file');

    // Legacy v1 files (flat mesh array, no "building" key): nothing
    // parametric to load yet, just hand back an empty model + the legacy
    // payload so the existing box-editor loader can still open it.
    if (!json.building) {
        return { buildingModel: new BuildingModel(), legacy: json };
    }

    const buildingModel = BuildingModel.fromJSON(json.building);
    return { buildingModel, legacy: json.legacy ?? null };
}
