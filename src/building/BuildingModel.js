import { EventBus } from '../core/EventBus.js';
import { BuildingNode } from './node/BuildingNode.js';
import { Wall } from './wall/Wall.js';
import { Room } from './room/Room.js';
import { Floor } from './floor/Floor.js';
import { Opening } from './opening/Opening.js';
import { generateId } from '../core/IdGenerator.js';

/**
 * BuildingModel — the single source of truth (project spec §5, §6).
 * Contains only plain data entities. No Three.js. No DOM.
 */
export class BuildingModel {
    constructor() {
        this.events = new EventBus();
        this.floors = new Map();
        this.nodes = new Map();
        this.walls = new Map();
        this.rooms = new Map();
        this.openings = new Map();

        const groundFloor = new Floor({ level: 1, elevation: 0, name: 'Ground Floor' });
        this.floors.set(groundFloor.id, groundFloor);
        this.defaultFloorId = groundFloor.id;
    }

    // ---- Nodes ----
    addNode(position, floorId = this.defaultFloorId) {
        const node = new BuildingNode({ position, floorId });
        this.nodes.set(node.id, node);
        return node;
    }
    getNode(id) { return this.nodes.get(id); }
    removeNode(id) { this.nodes.delete(id); }

    // ---- Walls ----
    addWall(wallProps) {
        const wall = new Wall(wallProps);
        this.walls.set(wall.id, wall);
        this.getNode(wall.startNodeId)?.addWall(wall.id);
        this.getNode(wall.endNodeId)?.addWall(wall.id);
        return wall;
    }
    getWall(id) { return this.walls.get(id); }
    removeWall(id) {
        const wall = this.walls.get(id);
        if (!wall) return;
        this.getNode(wall.startNodeId)?.removeWall(id);
        this.getNode(wall.endNodeId)?.removeWall(id);
        this.walls.delete(id);
    }

    // ---- Openings ----
    addOpening(openingProps) {
        const opening = new Opening(openingProps);
        this.openings.set(opening.id, opening);
        const wall = this.getWall(opening.wallId);
        if (wall) wall.openingIds.push(opening.id);
        return opening;
    }
    getOpening(id) { return this.openings.get(id); }
    getOpeningsForWall(wallId) {
        const wall = this.getWall(wallId);
        if (!wall) return [];
        return wall.openingIds.map(id => this.getOpening(id)).filter(Boolean);
    }

    // ---- Rooms ----
    setRooms(rooms) {
        this.rooms.clear();
        rooms.forEach(r => this.rooms.set(r.id, r));
    }
    getRoom(id) { return this.rooms.get(id); }

    // ---- Floors ----
    addFloor(floorProps) {
        const floor = new Floor(floorProps);
        this.floors.set(floor.id, floor);
        return floor;
    }

    // ---- Serialization ----
    toJSON() {
        return {
            floors: [...this.floors.values()].map(f => f.toJSON()),
            nodes: [...this.nodes.values()].map(n => n.toJSON()),
            walls: [...this.walls.values()].map(w => w.toJSON()),
            rooms: [...this.rooms.values()].map(r => r.toJSON()),
            openings: [...this.openings.values()].map(o => o.toJSON()),
        };
    }

    static fromJSON(data) {
        const model = new BuildingModel();
        model.floors.clear();
        (data.floors || []).forEach(f => { const fl = Floor.fromJSON(f); model.floors.set(fl.id, fl); });
        if (model.floors.size === 0) { const fl = new Floor({}); model.floors.set(fl.id, fl); }
        model.defaultFloorId = [...model.floors.keys()][0];

        (data.nodes || []).forEach(n => model.nodes.set(n.id, BuildingNode.fromJSON(n)));
        (data.walls || []).forEach(w => model.walls.set(w.id, Wall.fromJSON(w)));
        (data.openings || []).forEach(o => model.openings.set(o.id, Opening.fromJSON(o)));
        (data.rooms || []).forEach(r => model.rooms.set(r.id, Room.fromJSON(r)));
        return model;
    }
}
