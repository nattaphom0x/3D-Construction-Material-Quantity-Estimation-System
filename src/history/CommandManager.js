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
    }

    execute(command) {
        const result = command.execute();
        this.undoStack.push(command);
        this.redoStack.length = 0;
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
