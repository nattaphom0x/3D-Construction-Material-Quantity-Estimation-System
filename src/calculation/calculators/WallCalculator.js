import { getWallGeometry } from '../../building/wall/WallGeometry.js';

/**
 * WallCalculator (project spec §32). Pure function of building data.
 * Returns all intermediate values, never rounds internally.
 */
export function calculateWall(wall, buildingModel) {
    const startNode = buildingModel.getNode(wall.startNodeId);
    const endNode = buildingModel.getNode(wall.endNodeId);
    const geo = getWallGeometry(wall, startNode, endNode);

    const grossArea = geo.length * wall.height;
    const grossVolume = geo.length * wall.height * wall.thickness;

    const openings = buildingModel.getOpeningsForWall(wall.id);
    const openingsArea = openings.reduce((sum, o) => sum + o.areaWithin(wall.height), 0);
    const doorCount = openings.filter(o => o.type === 'door').length;
    const windowCount = openings.filter(o => o.type === 'window').length;

    const netArea = Math.max(0, grossArea - openingsArea);
    // Volume deduction assumes openings pass fully through wall thickness.
    const netVolume = Math.max(0, grossVolume - openingsArea * wall.thickness);

    return {
        wallId: wall.id,
        length: geo.length,
        height: wall.height,
        thickness: wall.thickness,
        grossArea, openingsArea, netArea, doorCount, windowCount,
        grossVolume, netVolume,
    };
}
