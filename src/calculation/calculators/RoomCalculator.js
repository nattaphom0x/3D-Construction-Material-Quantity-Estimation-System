/**
 * RoomCalculator (project spec §12). Room.area/perimeter are already
 * computed mathematically from the boundary polygon by RoomDetector
 * (shoelace formula) — this just packages that for the QuantityEngine.
 */
export function calculateRoom(room) {
    return {
        roomId: room.id,
        area: room.area,
        perimeter: room.perimeter,
        floorArea: room.area,
        ceilingArea: room.area,
    };
}
