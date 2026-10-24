import { generateId } from '../../core/IdGenerator.js';

export class Floor {
    constructor({ id, level, elevation, height, name, landPlotImage, layerVisibility, cutGraph, extrudedFaceIds } = {}) {
        this.id = id || generateId('floor');
        this.level = level ?? 1;
        this.elevation = elevation ?? 0;
        this.height = height ?? 3.0;
        this.name = name || `Floor ${this.level}`;
        // ข้อ 2 (handoff): รูปเขตที่ดินอ้างอิง ต่อชั้น เก็บเป็น dataUrl (ไม่ใช่ blob-url) เพื่อ serialize
        // ลง save-file ได้ — ดู src/scene/LandPlotOverlay.js สำหรับตัวจัดการ mesh/texture ที่ตรงกับ shape นี้
        this.landPlotImage = landPlotImage ?? null;
        // { dataUrl, position:{x,z}, scale:{x,z}, rotationY, opacity, visible }

        // ข้อ 4 (handoff): กราฟเส้นตัดแบ่งช่องอิสระ ต่อชั้น — plain {nodes:[], edges:[]}
        // ดู src/landplot/CutGraph.js (ยังไม่มี fill state ของข้อ 5, ตามด้วยในอีก session)
        this.cutGraph = cutGraph ?? null;

        // ข้อ 5 (handoff): id ของ "ช่อง" (FaceDetector face.id) ที่ผู้ใช้เลือก Extrude ไปแล้ว
        // เก็บต่อชั้น เพื่อไม่ให้ช่องเดิมโผล่มาให้เลือก/ไฮไลต์ซ้ำอีกหลัง reload หรือสลับชั้นไปกลับ
        this.extrudedFaceIds = extrudedFaceIds ?? [];

        // ข้อ 7 (handoff): เปิด/ปิดเลเยอร์อิสระต่อชั้น (designedGrid ยังไม่มีจริง จนกว่าจะทำข้อ 4-6 เสร็จ,
        // เตรียม flag ไว้ก่อน)
        this.layerVisibility = {
            designedGrid: true,
            plainGrid: true,
            landPlotImage: true,
            ...(layerVisibility || {}),
        };
    }

    toJSON() {
        return {
            id: this.id, level: this.level, elevation: this.elevation, height: this.height, name: this.name,
            landPlotImage: this.landPlotImage,
            cutGraph: this.cutGraph,
            extrudedFaceIds: [...this.extrudedFaceIds],
            layerVisibility: { ...this.layerVisibility },
        };
    }

    static fromJSON(data) { return new Floor({ ...data }); }
}