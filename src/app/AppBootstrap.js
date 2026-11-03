import { BuildingModel } from '../building/BuildingModel.js';
import { WallManager } from '../building/wall/WallManager.js';
import { OpeningManager } from '../building/opening/OpeningManager.js';
import { FloorManager } from '../building/floor/FloorManager.js';
import { RoomDetector } from '../building/room/RoomDetector.js';
import { QuantityEngine } from '../calculation/QuantityEngine.js';
import { BOQEngine } from '../boq/BOQEngine.js';
import { WallRenderer } from '../scene/WallRenderer.js';
import { OpeningRenderer } from '../scene/OpeningRenderer.js';
import { WallTool } from '../ui/build/WallTool.js';
import { OpeningTool } from '../ui/build/OpeningTool.js';
import { serializeProject, loadProject } from '../persistence/ProjectSerializer.js';
import { Events } from '../core/EventBus.js';
import { CommandManager } from '../history/CommandManager.js';
import { CreateWallCommand } from '../history/commands/CreateWallCommand.js';
import { DeleteWallCommand } from '../history/commands/DeleteWallCommand.js';
import { CreateOpeningCommand, DeleteOpeningCommand } from '../history/commands/OpeningCommands.js';

/**
 * bootstrapParametricBuilding — the single additive entry point called
 * from the legacy script.js. Nothing here removes or rewrites existing
 * behavior; it hangs a new, independent parametric subsystem off the
 * existing scene/camera/renderer and returns handles the legacy code
 * can call into (toggle tool, get BOQ report, hook save/load).
 */
export function bootstrapParametricBuilding({ scene, camera, domElement, onWallMeshCreated } = {}) {
    const buildingModel = new BuildingModel();
    const wallManager = new WallManager(buildingModel);
    const openingManager = new OpeningManager(buildingModel);
    const floorManager = new FloorManager(buildingModel);
    const roomDetector = new RoomDetector(buildingModel);
    const quantityEngine = new QuantityEngine();
    const boqEngine = new BOQEngine();
    const renderer = new WallRenderer(buildingModel, scene, { onMeshCreated: onWallMeshCreated });
    const openingRenderer = new OpeningRenderer(buildingModel, scene, openingManager, {
        getWallMesh: (wallId) => renderer.meshesByWallId.get(wallId),
    });
    const commandManager = new CommandManager();

    let wallDefaults = { height: 2.5, thickness: 0.2, materialId: 'concrete' };

    // Recompute rooms per-floor whenever the wall graph changes, so walls
    // on different floors never merge into one room (spec §15: entities
    // belong to a floor; room detection must respect that boundary).
    const recomputeRooms = () => {
        const allRooms = [];
        buildingModel.floors.forEach(floor => {
            allRooms.push(...roomDetector.detectRooms(floor.id));
        });
        buildingModel.setRooms(allRooms);
        buildingModel.events.emit(Events.ROOM_CHANGED, { rooms: allRooms });
    };
    buildingModel.events.on(Events.WALL_CREATED, recomputeRooms);
    buildingModel.events.on(Events.WALL_CHANGED, recomputeRooms);
    buildingModel.events.on(Events.WALL_DELETED, recomputeRooms);

    const wallTool = new WallTool({
        scene, camera, domElement, buildingModel, wallManager,
        // Re-broadcast on the shared event bus so DOM/UI code (script.js)
        // can show a live length label without WallTool needing to know
        // about the DOM at all — keeps tool/UI concerns separate (spec §51-52).
        onPreviewUpdate: (data) => buildingModel.events.emit(Events.WALL_PREVIEW_UPDATE, data),
        // So the preview (and the wall actually created) uses whichever
        // floor is currently selected instead of always the ground floor.
        getActiveFloor: () => floorManager.getActiveFloor(),
        getWallDefaults: () => wallDefaults,
        createWallFn: (props) => {
            const command = new CreateWallCommand(wallManager, props);
            commandManager.execute(command);
            return buildingModel.getWall(command.pinnedWallSnapshot.id);
        },
    });

    let openingStatusHandler = () => {};
    const openingTool = new OpeningTool({
        scene, camera, domElement, buildingModel, openingManager, wallRenderer: renderer, openingRenderer,
        createOpeningFn: (props) => {
            const command = new CreateOpeningCommand(openingManager, props);
            const opening = command.execute();
            if (!opening) return null;
            commandManager.record(command);
            return opening;
        },
        deleteOpeningFn: (openingId) => commandManager.execute(new DeleteOpeningCommand(openingManager, openingId)),
        onStatus: (st) => openingStatusHandler(st),
    });

    function deleteWallUndoable(wallId) {
        commandManager.execute(new DeleteWallCommand(wallManager, wallId));
    }

    /** duplicateWallUndoable — same idea as legacy duplicateObjectNode, but
     * for a graph-backed wall: offsets both endpoint nodes and creates a
     * fresh wall (new nodes, spec §10 — walls never share endpoints with
     * their source unless they snap back together). */
    function duplicateWallUndoable(wallId, offset = { x: 0.8, z: 0.8 }) {
        const wall = buildingModel.getWall(wallId);
        if (!wall) return null;
        const startNode = buildingModel.getNode(wall.startNodeId);
        const endNode = buildingModel.getNode(wall.endNodeId);
        if (!startNode || !endNode) return null;
        const start = { x: startNode.position.x + offset.x, y: 0, z: startNode.position.z + offset.z };
        const end = { x: endNode.position.x + offset.x, y: 0, z: endNode.position.z + offset.z };
        const command = new CreateWallCommand(wallManager, {
            start, end, height: wall.height, thickness: wall.thickness,
            materialId: wall.materialId, floorId: wall.floorId,
            name: wall.name ? `${wall.name} Copy` : null,
        });
        commandManager.execute(command);
        return buildingModel.getWall(command.pinnedWallSnapshot.id);
    }

    function getQuantityResult() { return quantityEngine.calculate(buildingModel); }
    function getBOQReport() { return boqEngine.buildReport(getQuantityResult()); }

    /**
     * calculateBOQ() — adapts BOQEngine's structured report into the flat
     * shape the legacy BOQ panel renderer (renderParametricBOQReport in
     * script.js) already expects, so the two BOQ systems can share one
     * panel until they're unified in a later phase.
     */
    function calculateBOQ() {
        const quantityResult = getQuantityResult();
        const report = boqEngine.buildReport(quantityResult);
        const wallCount = buildingModel.walls.size;

        const sections = report.sections.map(s => ({
            label: s.label,
            basisValue: s.basisValue,
            basisUnit: s.basis === 'area' ? 'ตร.ม.' : 'ลบ.ม.',
            elementCount: quantityResult.byMat[s.materialId]?.sourceWallIds.length ?? 0,
            note: s.note,
            rows: s.rows,
        }));

        return {
            label: 'สรุปถอดปริมาณวัสดุ (ผนังพาราเมตริก)',
            elementCount: wallCount,
            totalVolume: quantityResult.totals.totalWallVolume,
            materialTypeCount: sections.length,
            sections,
            summaryRows: report.materialSummary,
            warnings: quantityResult.warnings,
        };
    }

    /** saveProjectData(legacyList) — bundles parametric + legacy data, versioned (spec §43-44). */
    function saveProjectData(legacyList) {
        const data = serializeProject(buildingModel, legacyList);
        // spec §27: activeFloorId is project workflow state, not UI preference —
        // must round-trip so the user returns to the same floor after Load.
        // (Previously not saved at all: BuildingModel.fromJSON() always picks the
        // first floor in map order as defaultFloorId, so multi-floor projects
        // always reopened on Floor 1 regardless of which floor was active on Save.)
        data.activeFloorId = floorManager.activeFloorId;
        return data;
    }

    /**
     * loadProjectData(data) — handles version migration (v1 bare-array or
     * {version:1,...} legacy format vs current {version,building,legacy}
     * format) and returns the legacy object list either way, per the
     * comment already written at the script.js call site.
     */
    function loadProjectData(data) {
        // Legacy v1 saves are either a bare array or {version:1, objects:[...]}
        // with no "building" key at all — normalize to the loader's expected shape.
        const normalized = Array.isArray(data) ? { legacy: data }
            : (!data.building && !data.legacy) ? { legacy: data }
            : data;

        const { buildingModel: loadedModel, legacy } = loadProject(normalized);
        // ล้าง mesh ผนัง/ช่องเจาะของโปรเจกต์เดิมก่อน ไม่งั้นผนัง id เดิมจะถูก "อัปเดต" mesh เก่าที่หลุดจากฉากแล้ว
        // (ไม่เข้า objects/scene) และช่องเจาะเก่าจะค้างเป็นผี
        renderer.clearAll();
        openingRenderer.clearAll();
        buildingModel.floors = loadedModel.floors;
        buildingModel.nodes = loadedModel.nodes;
        buildingModel.walls = loadedModel.walls;
        buildingModel.rooms = loadedModel.rooms;
        buildingModel.openings = loadedModel.openings;
        buildingModel.defaultFloorId = loadedModel.defaultFloorId;

        renderer.renderAll();
        openingRenderer.renderAll();
        recomputeRooms();
        // Restore the floor that was active when saved (spec §27), falling back to
        // the model's default floor for files saved before activeFloorId existed,
        // or if the saved id no longer matches any loaded floor.
        floorManager.activeFloorId = (data.activeFloorId && buildingModel.floors.has(data.activeFloorId))
            ? data.activeFloorId
            : buildingModel.defaultFloorId;
        commandManager.clear(); // old undo/redo entries reference pre-load state — stale, must not resurrect

        // Legacy payload may itself be {objects:[...]} (old v1 shape) or a bare array.
        if (Array.isArray(legacy)) return legacy;
        if (legacy && Array.isArray(legacy.objects)) return legacy.objects;
        return legacy || [];
    }

    return {
        buildingModel, wallManager, openingManager, floorManager, roomDetector, quantityEngine, boqEngine,
        renderer, openingRenderer, wallTool, openingTool, commandManager,
        getQuantityResult, getBOQReport, calculateBOQ,
        saveProjectData, loadProjectData,
        deleteWallUndoable,
        duplicateWallUndoable,
        undo() { return commandManager.undo(); },
        redo() { return commandManager.redo(); },
        canUndo() { return commandManager.canUndo(); },
        canRedo() { return commandManager.canRedo(); },
        setOpeningStatusHandler(fn) { openingStatusHandler = fn || (() => {}); },
        getOpeningSettings() { return openingManager.getSettings(); },
        updateOpeningSettings(next, opts) { return openingManager.updateSettings(next, opts); },
        setWallDefaults(next) { wallDefaults = { ...wallDefaults, ...next }; },
        getWallDefaults() { return wallDefaults; },
    };
}