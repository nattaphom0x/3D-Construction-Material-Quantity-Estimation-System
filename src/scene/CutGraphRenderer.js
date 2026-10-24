import * as THREE from 'three';
import { FaceDetector } from '../landplot/FaceDetector.js';

/**
 * CutGraphRenderer (handoff ข้อ 4/5) — draws CutGraph edges as lines and
 * exposes the currently-detected faces so callers (script.js, item 5's
 * fill-toggle) can build fill meshes without re-running FaceDetector
 * themselves. Pattern from WallRenderer: renderer never writes back to
 * the model, data flows one way, model -> mesh. Unlike WallRenderer this
 * has no event bus to listen on (CutGraph is plain data mutated by
 * CutTool), so the caller re-invokes render() after every graph change.
 *
 * ข้อ 5 (handoff): นอกจากเส้น ยังสร้าง "face overlay" ต่อช่องที่ยังไม่ถูก Extrude
 * (invisible-by-default, transparent ShapeGeometry ที่พื้น) ไว้ให้ raycast หา
 * ตอน hover/click เลือกทีละช่อง — ตัวโปร่งใสจริงจนกว่า caller จะสั่ง setFaceHighlight()
 */
export class CutGraphRenderer {
    constructor(scene) {
        this.scene = scene;
        this.linesMesh = null;
        this.detector = new FaceDetector();
        this.lastFaces = [];
        this.faceMeshes = []; // [{ mesh, face }] — เฉพาะช่องที่ยังไม่ถูก extrude
        this.hoverColor = 0x7CFFE0; // เขียวฟ้าอ่อน ตามที่ผู้ใช้ระบุ
        this.hoverOpacity = 0.4;
        this.lineColor = 0xffd24d; // เปลี่ยนตามธีมผ่าน setLineColor()
    }

    setLineColor(hex) {
        this.lineColor = hex;
        if (this.linesMesh) this.linesMesh.material.color.setHex(hex);
    }

    render(cutGraph, elevation = 0, extrudedFaceIds = null) {
        this._clearLines();
        this._clearFaceMeshes();
        if (!cutGraph || cutGraph.edges.size === 0) {
            this.lastFaces = [];
            return this.lastFaces;
        }

        const positions = [];
        cutGraph.edges.forEach(e => {
            const a = cutGraph.nodes.get(e.aId), b = cutGraph.nodes.get(e.bId);
            if (!a || !b) return;
            positions.push(a.x, elevation + 0.004, a.z, b.x, elevation + 0.004, b.z);
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const mat = new THREE.LineBasicMaterial({ color: this.lineColor, transparent: true, opacity: 0.95 });
        this.linesMesh = new THREE.LineSegments(geo, mat);
        this.scene.add(this.linesMesh);

        this.lastFaces = this.detector.detectFaces(cutGraph);
        this._buildFaceMeshes(this.lastFaces, elevation, extrudedFaceIds);
        return this.lastFaces;
    }

    /** สร้าง overlay โปร่งใสต่อช่อง (เว้นช่องที่ extrude ไปแล้ว) สำหรับ raycast hover/click */
    _buildFaceMeshes(faces, elevation, extrudedFaceIds) {
        const skip = extrudedFaceIds instanceof Set ? extrudedFaceIds : new Set(extrudedFaceIds || []);
        faces.forEach(face => {
            if (skip.has(face.id)) return;
            const shapePoints = face.points.map(p => new THREE.Vector2(p.x, -p.z));
            const shape = new THREE.Shape(shapePoints);
            const geo = new THREE.ShapeGeometry(shape);
            geo.rotateX(-Math.PI / 2);
            const mat = new THREE.MeshBasicMaterial({
                color: this.hoverColor, transparent: true, opacity: 0,
                side: THREE.DoubleSide, depthWrite: false,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.y = elevation + 0.008;
            mesh.renderOrder = 998;
            mesh.userData.isCutFaceOverlay = true;
            mesh.userData.cutFaceId = face.id;
            this.scene.add(mesh);
            this.faceMeshes.push({ mesh, face });
        });
    }

    /** เปิด/ปิดไฮไลต์ overlay ของช่องหนึ่ง (ตาม face.id) — ใช้ตอน hover ในโหมดเลือก Extrude */
    setFaceHighlight(faceId, isHighlighted) {
        const entry = this.faceMeshes.find(f => f.face.id === faceId);
        if (entry) entry.mesh.material.opacity = isHighlighted ? this.hoverOpacity : 0;
    }

    clearAllHighlights() {
        this.faceMeshes.forEach(f => { f.mesh.material.opacity = 0; });
    }

    getFaceMeshObjects() {
        return this.faceMeshes.map(f => f.mesh);
    }

    findFaceById(faceId) {
        return this.faceMeshes.find(f => f.face.id === faceId)?.face || null;
    }

    setVisible(v) {
        if (this.linesMesh) this.linesMesh.visible = v;
        this.faceMeshes.forEach(f => { f.mesh.visible = v; });
    }

    _clearLines() {
        if (!this.linesMesh) return;
        this.scene.remove(this.linesMesh);
        this.linesMesh.geometry.dispose();
        this.linesMesh.material.dispose();
        this.linesMesh = null;
    }

    _clearFaceMeshes() {
        this.faceMeshes.forEach(f => {
            this.scene.remove(f.mesh);
            f.mesh.geometry.dispose();
            f.mesh.material.dispose();
        });
        this.faceMeshes = [];
    }

    dispose() {
        this._clearLines();
        this._clearFaceMeshes();
    }
}