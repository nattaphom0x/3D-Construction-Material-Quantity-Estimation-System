/**
 * FnCommand — คำสั่ง undo/redo แบบกำหนดฟังก์ชันเอง ใช้กับการเปลี่ยนแปลงที่เกิดขึ้นแล้ว
 * (บันทึกผ่าน CommandManager.record) เช่น แก้ช่องเจาะ เพิ่ม/ลบชั้น โหลดโปรเจกต์
 */
export class FnCommand {
    constructor(undoFn, redoFn) {
        this.undoFn = undoFn;
        this.redoFn = redoFn;
    }
    execute() { this.redoFn(); }
    undo() { this.undoFn(); }
}
