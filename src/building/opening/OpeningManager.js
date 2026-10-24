import { Events } from '../../core/EventBus.js';
import { getWallGeometry } from '../wall/WallGeometry.js';

const EPS = 1e-3;

/**
 * OpeningManager (project spec §13): doors/windows belong to walls, not
 * floating objects. Offset is stored as distance-from-start along the
 * wall, so if the wall moves/resizes the opening's absolute position is
 * always re-derived, never stored redundantly.
 *
 * ค่าตั้งต้น (settings) ของประตู/หน้าต่าง + ตัวล็อกความสูงอยู่ที่นี่ เพื่อให้
 * ทุกช่องเจาะที่ล็อกไว้ใช้ระดับเดียวกัน (กันเจาะสูงต่ำไม่เท่ากัน)
 */
export class OpeningManager {
    constructor(buildingModel) {
        this.model = buildingModel;
        this.settings = {
            door:   { width: 0.9, height: 2.1, sillHeight: 0 },
            window: { width: 1.2, height: 1.2, sillHeight: 1.0 },
            lockSill: true,   // ล็อกความสูงจากพื้น (sill) เท่ากันทุกบานชนิดเดียวกัน
            lockHead: false,  // ล็อกระดับหัวช่อง (sill+height) เท่ากันทุกบานชนิดเดียวกัน
        };
    }

    getSettings() { return JSON.parse(JSON.stringify(this.settings)); }

    /** อัปเดตค่าตั้งต้น; ถ้า applyToExisting จะปรับช่องเดิมชนิดเดียวกันให้ตรงกับตัวล็อกด้วย */
    updateSettings(next = {}, { applyToExisting = true } = {}) {
        const s = this.settings;
        for (const type of ['door', 'window']) {
            if (next[type]) s[type] = { ...s[type], ...this._sanitize(next[type]) };
        }
        if (next.lockSill !== undefined) s.lockSill = !!next.lockSill;
        if (next.lockHead !== undefined) s.lockHead = !!next.lockHead;
        if (applyToExisting) this.applySettingsToExisting();
        return this.getSettings();
    }

    _sanitize(v) {
        const out = {};
        if (v.width !== undefined) out.width = Math.max(0.1, Number(v.width) || 0.1);
        if (v.height !== undefined) out.height = Math.max(0.1, Number(v.height) || 0.1);
        if (v.sillHeight !== undefined) out.sillHeight = Math.max(0, Number(v.sillHeight) || 0);
        return out;
    }

    /** ขนาด/ระดับที่ควรใช้เมื่อสร้างช่องใหม่ชนิดนี้ (ตัวล็อกบังคับระดับ) */
    getDefaultsFor(type) {
        const d = { ...this.settings[type === 'window' ? 'window' : 'door'] };
        return d;
    }

    /** ปรับช่องที่มีอยู่ตามตัวล็อก: lockSill → sill เท่ากัน, lockHead → หัวช่องเท่ากัน */
    applySettingsToExisting() {
        const touchedWalls = new Set();
        for (const o of this.model.openings.values()) {
            const wall = this.model.getWall(o.wallId);
            if (!wall) continue;
            const cfg = this.settings[o.type === 'window' ? 'window' : 'door'];
            const before = `${o.sillHeight}|${o.height}`;
            if (this.settings.lockSill) o.sillHeight = cfg.sillHeight;
            if (this.settings.lockHead) {
                const head = cfg.sillHeight + cfg.height;
                o.height = Math.max(0.1, head - o.sillHeight);
            }
            this._clampVertical(o, wall);
            if (`${o.sillHeight}|${o.height}` !== before) touchedWalls.add(wall.id);
        }
        touchedWalls.forEach(id => {
            const wall = this.model.getWall(id);
            this.model.getOpeningsForWall(id).forEach(o => this.model.events.emit(Events.OPENING_CHANGED, { opening: o, wall }));
            this.model.events.emit(Events.WALL_CHANGED, { wall });
        });
    }

    _clampVertical(o, wall) {
        o.sillHeight = Math.max(0, Math.min(o.sillHeight, wall.height - 0.1));
        o.height = Math.max(0.1, Math.min(o.height, wall.height - o.sillHeight));
    }

    _wallLength(wall) {
        const startNode = this.model.getNode(wall.startNodeId);
        const endNode = this.model.getNode(wall.endNodeId);
        return getWallGeometry(wall, startNode, endNode).length;
    }

    /**
     * ตรวจและปรับค่าให้อยู่ในผนัง + ไม่ซ้อนกับช่องเดิม
     * @returns {{ok:boolean, reason?:string, offset?:number, width?:number, height?:number, sillHeight?:number}}
     */
    resolvePlacement({ wallId, offset, width, height, sillHeight, type, ignoreOpeningId = null }) {
        const wall = this.model.getWall(wallId);
        if (!wall) return { ok: false, reason: 'ไม่พบผนัง' };
        const len = this._wallLength(wall);
        const cfg = this.getDefaultsFor(type);
        const w = width ?? cfg.width;
        let sill = Math.max(0, sillHeight ?? cfg.sillHeight);
        sill = Math.min(sill, wall.height - 0.1);
        const h = Math.max(0.1, Math.min(height ?? cfg.height, wall.height - sill));

        if (w > len + EPS) return { ok: false, reason: 'ผนังสั้นกว่าความกว้างช่องเจาะ' };
        const off = Math.max(0, Math.min(offset ?? 0, len - w));

        for (const o of this.model.getOpeningsForWall(wallId)) {
            if (o.id === ignoreOpeningId) continue;
            const overlapX = off < o.offset + o.width - EPS && off + w > o.offset + EPS;
            const overlapY = sill < o.sillHeight + o.height - EPS && sill + h > o.sillHeight + EPS;
            if (overlapX && overlapY) return { ok: false, reason: 'ซ้อนกับช่องเจาะเดิม', offset: off, width: w, height: h, sillHeight: sill };
        }
        return { ok: true, offset: off, width: w, height: h, sillHeight: sill };
    }

    /** offset is clamped so the opening can't hang off either end of the wall. Returns null if invalid. */
    addOpening({ wallId, offset, width, height, sillHeight, type, id }) {
        const wall = this.model.getWall(wallId);
        if (!wall) throw new Error(`Wall ${wallId} not found`);
        const r = this.resolvePlacement({ wallId, offset, width, height, sillHeight, type });
        if (!r.ok) return null;
        const opening = this.model.addOpening({ id, wallId, offset: r.offset, width: r.width, height: r.height, sillHeight: r.sillHeight, type });
        this.model.events.emit(Events.OPENING_CHANGED, { opening, wall });
        this.model.events.emit(Events.WALL_CHANGED, { wall }); // net area changed + wall mesh re-cut
        return opening;
    }

    /** แก้ขนาด/ตำแหน่งของช่องเดิม (ผ่านการตรวจเดียวกับตอนสร้าง) */
    updateOpening(openingId, patch = {}) {
        const o = this.model.getOpening(openingId);
        if (!o) return null;
        const wall = this.model.getWall(o.wallId);
        const r = this.resolvePlacement({
            wallId: o.wallId, type: o.type, ignoreOpeningId: o.id,
            offset: patch.offset ?? o.offset, width: patch.width ?? o.width,
            height: patch.height ?? o.height, sillHeight: patch.sillHeight ?? o.sillHeight,
        });
        if (!r.ok) return null;
        Object.assign(o, { offset: r.offset, width: r.width, height: r.height, sillHeight: r.sillHeight });
        this.model.events.emit(Events.OPENING_CHANGED, { opening: o, wall });
        this.model.events.emit(Events.WALL_CHANGED, { wall });
        return o;
    }

    removeOpening(openingId) {
        const opening = this.model.getOpening(openingId);
        if (!opening) return;
        const wall = this.model.getWall(opening.wallId);
        if (wall) wall.openingIds = wall.openingIds.filter(id => id !== openingId);
        this.model.openings.delete(openingId);
        this.model.events.emit(Events.OPENING_CHANGED, { openingId, wall });
        if (wall) this.model.events.emit(Events.WALL_CHANGED, { wall });
    }

    /** ใส่ช่องเดิมกลับด้วย id เดิม (ใช้ตอน undo การลบ / redo การสร้าง) */
    restoreOpening(snapshot) {
        const wall = this.model.getWall(snapshot.wallId);
        if (!wall) return null;
        const opening = this.model.addOpening({ ...snapshot });
        this.model.events.emit(Events.OPENING_CHANGED, { opening, wall });
        this.model.events.emit(Events.WALL_CHANGED, { wall });
        return opening;
    }

    /** World-space center point + rotation for placing a door/window mesh. */
    getOpeningPlacement(opening) {
        const wall = this.model.getWall(opening.wallId);
        const startNode = this.model.getNode(wall.startNodeId);
        const endNode = this.model.getNode(wall.endNodeId);
        const geo = getWallGeometry(wall, startNode, endNode);
        const elevation = this.model.floors.get(wall.floorId)?.elevation ?? 0;
        const t = geo.length > 0 ? (opening.offset + opening.width / 2) / geo.length : 0;
        const height = Math.max(0.05, Math.min(opening.height, wall.height - opening.sillHeight));
        const center = {
            x: geo.start.x + (geo.end.x - geo.start.x) * t,
            y: elevation + opening.sillHeight + height / 2,
            z: geo.start.z + (geo.end.z - geo.start.z) * t,
        };
        return { center, rotationY: geo.rotationY, wallThickness: wall.thickness, height };
    }
}
