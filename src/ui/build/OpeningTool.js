import * as THREE from 'three';
import { getWallGeometry } from '../../building/wall/WallGeometry.js';
import { getWallDelta, worldToWallModel } from '../../scene/WallTransform.js';
import { t as tr, tData } from '../../i18n/i18n.js';

/**
 * OpeningTool (project spec §13, §46 DoorTool/WindowTool). ผู้ใช้คลิกที่ผนัง →
 * หา offset จากจุดคลิกบนเส้นกึ่งกลางผนัง → OpeningManager.addOpening (ผ่านคำสั่ง undo ได้)
 * ขณะเครื่องมือเปิดอยู่ onPointerMove จะแสดง "พรีวิวจุดเจาะ" (กล่องโปร่งแสงตามขนาดจริง):
 * เขียว = เจาะได้, แดง = เจาะไม่ได้ (ซ้อนช่องเดิม/ผนังสั้นไป) — Alt+คลิกที่ช่อง = ลบช่องนั้น
 * ขนาด/ระดับความสูงมาจาก OpeningManager.settings (ปุ่ม "ตั้งค่าประตู/หน้าต่าง")
 */
export class OpeningTool {
    constructor({ scene, camera, domElement, buildingModel, openingManager, wallRenderer, openingRenderer, createOpeningFn, deleteOpeningFn, onStatus } = {}) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;
        this.model = buildingModel;
        this.openingManager = openingManager;
        this.wallRenderer = wallRenderer;
        this.openingRenderer = openingRenderer;
        this.createOpeningFn = createOpeningFn || ((p) => openingManager.addOpening(p));
        this.deleteOpeningFn = deleteOpeningFn || ((id) => openingManager.removeOpening(id));
        this.onStatus = onStatus || (() => {});
        this.raycaster = new THREE.Raycaster();
        this.active = false;
        this.type = 'door';
        this.previewGroup = null;
    }

    activate() { this.active = true; }
    deactivate() { this.active = false; this._clearPreview(); this.onStatus(null); }
    setType(type) { this.type = type === 'window' ? 'window' : 'door'; this._clearPreview(); }

    _setRay(clientX, clientY) {
        const rect = this.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(ndc, this.camera);
    }

    /** หาผนังที่ชี้ + ผลตรวจตำแหน่งเจาะ (ไม่แก้ข้อมูล) */
    _locate(clientX, clientY) {
        this._setRay(clientX, clientY);
        const wallMeshes = [...this.wallRenderer.meshesByWallId.values()].filter(m => m.visible);
        const hits = this.raycaster.intersectObjects(wallMeshes, false);
        if (hits.length === 0) return null;
        const wallId = hits[0].object.userData.parametricWallId;
        const wall = this.model.getWall(wallId);
        if (!wall) return null;
        const geo = getWallGeometry(wall, this.model.getNode(wall.startNodeId), this.model.getNode(wall.endNodeId));
        // hit.point เป็นพิกัดโลก (หลังผู้ใช้ย้าย/หมุนผนัง) แต่ geo มาจาก node ในโมเดล → แปลงกลับเป็นพิกัดโมเดลก่อน
        const wallMesh = hits[0].object;
        const p = worldToWallModel(wallMesh, hits[0].point);
        const len = Math.max(geo.length, 1e-6);
        const ux = (geo.end.x - geo.start.x) / len, uz = (geo.end.z - geo.start.z) / len;
        const t = (p.x - geo.start.x) * ux + (p.z - geo.start.z) * uz;
        const cfg = this.openingManager.getDefaultsFor(this.type);
        const offset = t - cfg.width / 2; // วางให้จุดคลิกอยู่กึ่งกลางช่อง
        const result = this.openingManager.resolvePlacement({ wallId, offset, type: this.type, ...cfg });
        return { wallId, wall, wallMesh, result, type: this.type };
    }

    onPointerMove(clientX, clientY) {
        if (!this.active) return;
        const loc = this._locate(clientX, clientY);
        if (!loc) { this._clearPreview(); this.onStatus(null); return; }
        const { result, wallMesh } = loc;
        const fake = {
            id: '__preview__', wallId: loc.wallId, type: this.type,
            offset: result.offset ?? 0, width: result.width ?? 0.9,
            height: result.height ?? 2.1, sillHeight: result.sillHeight ?? 0,
        };
        const placement = this.openingManager.getOpeningPlacement(fake);
        this._showPreview(fake, placement, result.ok, wallMesh);
        this.onStatus(result.ok
            ? { ok: true, text: tr('opening.status.ok', { type: tr(this.type === 'window' ? 'opening.type.window' : 'opening.type.door'), w: fake.width.toFixed(2), h: fake.height.toFixed(2), sill: fake.sillHeight.toFixed(2) }) }
            : { ok: false, text: tr('opening.status.fail', { reason: tData(result.reason) }) });
    }

    _showPreview(o, placement, ok, wallMesh) {
        this._clearPreview();
        const depth = placement.wallThickness * 1.15;
        const geo = new THREE.BoxGeometry(o.width, placement.height ?? o.height, depth);
        const color = ok ? 0x2ecc71 : 0xe74c3c;
        const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthTest: false }));
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, depthTest: false }));
        const g = new THREE.Group();
        g.add(fill, edges);
        g.renderOrder = 999;
        fill.renderOrder = 999; edges.renderOrder = 1000;
        g.position.set(placement.center.x, placement.center.y, placement.center.z);
        g.rotation.y = placement.rotationY;
        // พรีวิววางด้วยพิกัดโมเดล → คูณ delta ของผนังเพื่อให้ตรงกับผนังที่ถูกย้าย/หมุน
        if (wallMesh) {
            g.updateMatrix();
            getWallDelta(wallMesh).multiply(g.matrix).decompose(g.position, g.quaternion, g.scale);
        }
        this.scene.add(g);
        this.previewGroup = g;
    }

    _clearPreview() {
        if (!this.previewGroup) return;
        this.scene.remove(this.previewGroup);
        this.previewGroup.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
        this.previewGroup = null;
    }

    /** @returns the created Opening, or null if nothing was created. */
    onClick(clientX, clientY, { remove = false } = {}) {
        if (!this.active) return null;
        if (remove) { this._removeAt(clientX, clientY); return null; }
        const loc = this._locate(clientX, clientY);
        if (!loc) return null;
        if (!loc.result.ok) { this.onStatus({ ok: false, text: tr('opening.status.fail', { reason: tData(loc.result.reason) }) }); return null; }
        const r = loc.result;
        const created = this.createOpeningFn({
            wallId: loc.wallId, offset: r.offset, width: r.width, height: r.height, sillHeight: r.sillHeight, type: this.type,
        });
        this._clearPreview();
        return created || null;
    }

    _removeAt(clientX, clientY) {
        this._setRay(clientX, clientY);
        const groups = [...(this.openingRenderer?.meshesByOpeningId.values() ?? [])];
        const hits = this.raycaster.intersectObjects(groups, true);
        for (const h of hits) {
            let o = h.object;
            while (o && !o.userData.parametricOpeningId) o = o.parent;
            if (o) { this.deleteOpeningFn(o.userData.parametricOpeningId); return true; }
        }
        return false;
    }
}
