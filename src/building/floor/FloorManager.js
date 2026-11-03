import { Events } from '../../core/EventBus.js';

/**
 * FloorManager (project spec §15): supports multiple floors. Walls,
 * nodes, rooms, and openings already carry a floorId (BuildingModel);
 * this manager owns floor lifecycle and "which floor is currently being
 * edited" — the active floor is what new walls attach to and, in the
 * renderer, floors above/below the active one can be dimmed (spec-
 * inspired convenience, not in the original brief verbatim).
 */
export class FloorManager {
    constructor(buildingModel) {
        this.model = buildingModel;
        this.activeFloorId = buildingModel.defaultFloorId;
    }

    addFloor({ elevation, height = 3.0, name } = {}) {
        const level = Math.max(0, ...[...this.model.floors.values()].map(f => f.level)) + 1; // ไม่ซ้ำแม้ลบชั้นกลางไปแล้ว
        // Default elevation = stack directly on top of the highest existing floor.
        const autoElevation = elevation ?? this._highestFloorTop();
        const floor = this.model.addFloor({ level, elevation: autoElevation, height, name });
        this.model.events.emit(Events.FLOOR_CHANGED ?? 'FLOOR_CHANGED', { floor });
        return floor;
    }

    _highestFloorTop() {
        let top = 0;
        this.model.floors.forEach(f => { top = Math.max(top, f.elevation + f.height); });
        return top;
    }

    setActiveFloor(floorId) {
        if (!this.model.floors.has(floorId)) return;
        this.activeFloorId = floorId;
        this.model.defaultFloorId = floorId; // new walls/nodes attach here by default
        this.model.events.emit('ACTIVE_FLOOR_CHANGED', { floorId });
    }

    getActiveFloor() { return this.model.floors.get(this.activeFloorId); }
    listFloors() { return [...this.model.floors.values()].sort((a, b) => a.level - b.level); }

    removeFloor(floorId) {
        if (this.model.floors.size <= 1) return; // never remove the last floor
        const hasContent = [...this.model.walls.values()].some(w => w.floorId === floorId);
        if (hasContent) throw new Error('Cannot remove a floor that still has walls on it');
        this.model.floors.delete(floorId);
        if (this.activeFloorId === floorId) {
            const remaining = this.listFloors();
            this.setActiveFloor(remaining[0].id);
        }
    }
}
