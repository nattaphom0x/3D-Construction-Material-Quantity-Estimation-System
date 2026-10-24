/**
 * EventBus — decouples BuildingModel changes from rendering/UI/calculation
 * (project spec §52). No circular imports: this module has zero deps.
 */
export class EventBus {
    constructor() {
        this._listeners = new Map();
    }

    on(event, handler) {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event).add(handler);
        return () => this.off(event, handler);
    }

    off(event, handler) {
        this._listeners.get(event)?.delete(handler);
    }

    emit(event, payload) {
        this._listeners.get(event)?.forEach(fn => {
            try { fn(payload); } catch (err) { console.error(`[EventBus] handler for "${event}" threw:`, err); }
        });
    }
}

export const Events = {
    NODE_CHANGED: 'NODE_CHANGED',
    WALL_CREATED: 'WALL_CREATED',
    WALL_CHANGED: 'WALL_CHANGED',
    WALL_DELETED: 'WALL_DELETED',
    ROOM_CHANGED: 'ROOM_CHANGED',
    OPENING_CHANGED: 'OPENING_CHANGED',
    FLOOR_CHANGED: 'FLOOR_CHANGED',
    ACTIVE_FLOOR_CHANGED: 'ACTIVE_FLOOR_CHANGED',
    FLOOR_LAYER_VISIBILITY_CHANGED: 'FLOOR_LAYER_VISIBILITY_CHANGED',
    QUANTITY_CHANGED: 'QUANTITY_CHANGED',
    BOQ_CHANGED: 'BOQ_CHANGED',
    PROJECT_LOADED: 'PROJECT_LOADED',
};
