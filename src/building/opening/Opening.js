import { generateId } from '../../core/IdGenerator.js';

export class Opening {
    constructor({ id, wallId, offset, width, height, sillHeight, type } = {}) {
        this.id = id || generateId('opening');
        this.wallId = wallId;
        this.offset = offset ?? 0;       // distance from wall start node, meters
        this.width = width ?? 0.9;
        this.height = height ?? (type === 'window' ? 1.2 : 2.1);
        this.sillHeight = sillHeight ?? (type === 'window' ? 1.0 : 0);
        this.type = type || 'door';      // 'door' | 'window'
    }

    get area() { return this.width * this.height; }

    /** พื้นที่ที่เจาะได้จริง (ไม่เกินความสูงผนัง) — ใช้หักใน BOQ */
    areaWithin(wallHeight) {
        const sill = Math.max(0, this.sillHeight);
        const h = Math.max(0, Math.min(this.height, wallHeight - sill));
        return this.width * h;
    }

    toJSON() {
        return { id: this.id, wallId: this.wallId, offset: this.offset, width: this.width, height: this.height, sillHeight: this.sillHeight, type: this.type };
    }

    static fromJSON(data) { return new Opening({ ...data }); }
}
