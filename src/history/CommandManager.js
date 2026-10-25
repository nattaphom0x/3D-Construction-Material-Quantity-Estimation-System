/**
 * CommandManager (project spec §42). Linear undo/redo stack of Command
 * objects ({ execute(), undo() }). execute() runs the command, pushes it
 * onto the undo stack, and clears the redo stack (new action invalidates
 * any previously-undone branch). undo()/redo() just replay execute()/undo()
 * on the appropriate command — commands themselves must be idempotent on
 * redo (see CreateWallCommand's pinnedWallSnapshot pattern).
 */
export class CommandManager {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.onRecord = null; // เรียกทุกครั้งที่มีคำสั่งใหม่ถูกบันทึก (ใช้รวมเป็นลำดับ undo เดียวกับระบบชิ้นงาน)
    }

    /** บันทึกคำสั่งที่ผลลัพธ์เกิดขึ้นไปแล้ว (ไม่เรียก execute ซ้ำ) */
    record(command) {
        this.undoStack.push(command);
        this.redoStack.length = 0;
        if (this.onRecord) this.onRecord(command);
    }

    execute(command) {
        const result = command.execute();
        this.undoStack.push(command);
        this.redoStack.length = 0;
        if (this.onRecord) this.onRecord(command);
        return result;
    }

    undo() {
        const command = this.undoStack.pop();
        if (!command) return false;
        command.undo();
        this.redoStack.push(command);
        return true;
    }

    redo() {
        const command = this.redoStack.pop();
        if (!command) return false;
        command.execute();
        this.undoStack.push(command);
        return true;
    }

    canUndo() {
        return this.undoStack.length > 0;
    }

    canRedo() {
        return this.redoStack.length > 0;
    }

    clear() {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
    }
}
