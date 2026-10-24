/**
 * CreateOpeningCommand / DeleteOpeningCommand — undo/redo ของการเจาะช่อง
 * redo ใช้ id เดิมเสมอ เพื่อให้ข้อมูลอ้างอิงยังถูกต้อง
 */
export class CreateOpeningCommand {
    constructor(openingManager, props) {
        this.openingManager = openingManager;
        this.props = props;
        this.snapshot = null;
    }
    execute() {
        if (!this.snapshot) {
            const o = this.openingManager.addOpening(this.props);
            if (o) this.snapshot = o.toJSON();
            return o;
        }
        return this.openingManager.restoreOpening(this.snapshot);
    }
    undo() { if (this.snapshot) this.openingManager.removeOpening(this.snapshot.id); }
}

export class DeleteOpeningCommand {
    constructor(openingManager, openingId) {
        this.openingManager = openingManager;
        this.openingId = openingId;
        this.snapshot = null;
    }
    execute() {
        const o = this.openingManager.model.getOpening(this.openingId);
        if (o) this.snapshot = o.toJSON();
        this.openingManager.removeOpening(this.openingId);
    }
    undo() { if (this.snapshot) this.openingManager.restoreOpening(this.snapshot); }
}
