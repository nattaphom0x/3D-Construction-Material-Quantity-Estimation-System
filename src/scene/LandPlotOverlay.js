import * as THREE from 'three';

/**
 * LandPlotOverlay (handoff ข้อ 2+3) — a reference image (land-plot plan)
 * shown as a flat, semi-transparent plane sitting on the grid, per floor.
 *
 * Structure: THREE.Group (position.x/z + rotation.y editable by
 * TransformControls) -> THREE.Mesh child (fixed rotation.x = -90° so the
 * plane lies flat, facing up). The group's scale.x/scale.z become the
 * plane's world width/depth; scale.y is always pinned to 1 (the plane has
 * zero thickness, so a stray uniform-scale drag on Y must never distort
 * it — see lockScaleY()).
 *
 * Data in/out is the plain object described in the handoff:
 *   { dataUrl, position:{x,z}, scale:{x,z}, rotationY, opacity, visible }
 * This is exactly what Floor.landPlotImage stores, so toData()/applyData()
 * round-trip directly through Floor.toJSON()/fromJSON() with no extra glue.
 */
export class LandPlotOverlay {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.name = 'LandPlotOverlayGroup';

        this.geometry = new THREE.PlaneGeometry(1, 1);
        this.material = new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0.75,
            side: THREE.DoubleSide,
            depthWrite: false, // so it never fights the grid/other meshes in the depth buffer
        });
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.rotation.x = -Math.PI / 2; // lay the plane flat, facing +Y
        this.group.add(this.mesh);

        this.texture = null;
        this.dataUrl = null;
        scene.add(this.group);
    }

    /** Downscale an uploaded image file to a data URL (spec: cap long edge at maxDim so save-files don't bloat). */
    static fileToDataUrl(file, maxDim = 2048) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const objectUrl = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(objectUrl);
                const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                const w = Math.max(1, Math.round(img.width * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: w, height: h });
            };
            img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('โหลดไฟล์ภาพไม่สำเร็จ')); };
            img.src = objectUrl;
        });
    }

    /** Load a File straight from the <input type=file>; sets a sensible default size/position and applies it. */
    async loadFromFile(file, { defaultWidth = 10 } = {}) {
        const { dataUrl, width, height } = await LandPlotOverlay.fileToDataUrl(file);
        const aspect = height > 0 ? width / height : 1;
        this.applyData({
            dataUrl,
            position: { x: 0, z: 0 },
            scale: { x: defaultWidth, z: defaultWidth / aspect },
            rotationY: 0,
            opacity: 0.75,
            visible: true,
        });
        return this.toData();
    }

    /** Apply a stored data object (from Floor.landPlotImage) to the live mesh. Safe to call with partial data. */
    applyData(data) {
        if (!data) { this.setVisible(false); return; }
        if (data.dataUrl && data.dataUrl !== this.dataUrl) {
            this.dataUrl = data.dataUrl;
            const loader = new THREE.TextureLoader();
            const tex = loader.load(data.dataUrl);
            tex.colorSpace = THREE.SRGBColorSpace;
            if (this.texture) this.texture.dispose();
            this.texture = tex;
            this.material.map = tex;
            this.material.needsUpdate = true;
        }
        const pos = data.position || { x: 0, z: 0 };
        const scl = data.scale || { x: 10, z: 10 };
        this.group.position.set(pos.x, this.group.position.y, pos.z);
        this.group.rotation.y = data.rotationY || 0;
        this.group.scale.set(scl.x, 1, scl.z);
        this.material.opacity = data.opacity ?? 0.75;
        this.setVisible(data.visible !== false);
    }

    /** Keep the plane just above the floor's own grid so it never z-fights, without letting the transform gizmo touch Y. */
    setElevation(y) {
        this.group.position.y = y + 0.002;
    }

    lockScaleY() {
        if (this.group.scale.y !== 1) this.group.scale.y = 1;
    }

    setVisible(v) {
        this.group.visible = !!v && !!this.dataUrl;
    }

    setOpacity(o) {
        this.material.opacity = o;
    }

    /** Bounding box of the plane in world XZ — used by item 3 to derive a grid that hugs the image. */
    getWorldBounds() {
        this.group.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(this.mesh);
        return box;
    }

    /** Serialize current transform back into the plain-object shape Floor.landPlotImage expects. */
    toData() {
        if (!this.dataUrl) return null;
        return {
            dataUrl: this.dataUrl,
            position: { x: this.group.position.x, z: this.group.position.z },
            scale: { x: this.group.scale.x, z: this.group.scale.z },
            rotationY: this.group.rotation.y,
            opacity: this.material.opacity,
            visible: this.group.visible,
        };
    }

    dispose() {
        this.scene.remove(this.group);
        this.geometry.dispose();
        this.material.dispose();
        if (this.texture) this.texture.dispose();
    }
}
