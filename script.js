/* =====================================================================
   3D BUILDING MATERIAL QUANTITY TAKEOFF / BOQ (มยผ. 1101-64)
   -----------------------------------------------------------------------
   สารบัญ (ไล่ตามลำดับในไฟล์):
     1. SECURITY                 - กันคลิกขวา/เปิด devtools
     2. MATERIAL LIBRARY          - สูตรคำนวณวัสดุต่อชนิด (คอนกรีต/อิฐ/มวลเบา)
     3. GUI UTILS                 - เปิด/ปิด/ลาก/ยกหน้าต่างขึ้นหน้าสุด
     4. THREE.JS SETUP            - ฉาก กล้อง แสง กริด controls
     5. DIMENSION LABELS          - ป้ายตัวเลขขนาด X/Y/Z ลอยบนชิ้นงาน
     6. MATERIAL ASSIGNMENT       - สร้าง mesh / เปลี่ยนวัสดุ / แท็บเลือกวัสดุ
     7. OBJECT MANAGEMENT         - เพิ่ม/เลือก/เอาต์ไลน์ชิ้นงาน
     8. LAYER PANEL HELPERS       - ล็อก/ซ่อน/ลำดับเลเยอร์/กลุ่ม/ลาก-วาง
     9. CALCULATION LOGIC (BOQ)   - รวมปริมาตร/พื้นที่ แล้วสร้างรายงาน HTML
    10. INPUT HANDLERS            - ช่องกรอกตำแหน่ง X/Y/Z ในแผงคุณสมบัติ
    11. UNDO / REDO / COPY-PASTE  - เก็บ snapshot ของฉากทั้งหมด
    12. SAVE / LOAD PROJECT       - บันทึก/เปิดไฟล์ .json
    13. EVENT LISTENERS           - เมาส์ (คลิก/ลากครอบ/ดับเบิลคลิก) + คีย์ลัด
    14. ANIMATION LOOP            - requestAnimationFrame หลัก
    15. VIEWPORT TOOLBAR/QUICKSTART - ปุ่มย้าย/หมุน/ขนาด + การ์ดเริ่มต้นใช้งาน
    16. RESIZABLE WINDOWS         - ลากขอบ/มุมปรับขนาดหน้าต่าง
   ===================================================================== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { CreateWallCommand } from './src/history/commands/CreateWallCommand.js';
import { DeleteOpeningCommand } from './src/history/commands/OpeningCommands.js';
import { bootstrapParametricBuilding } from './src/app/AppBootstrap.js';
import { LandPlotOverlay } from './src/scene/LandPlotOverlay.js';
import { CutGraph } from './src/landplot/CutGraph.js';
import { CutTool } from './src/ui/build/CutTool.js';
import { CutGraphRenderer } from './src/scene/CutGraphRenderer.js';
import { Events } from './src/core/EventBus.js';
import { distanceXZ } from './src/core/MathUtils.js';
import { t, tData, initI18n, setLanguage, getLanguage, detectDefaultLanguage, onLanguageChange } from './src/i18n/i18n.js';

// --- 1. SECURITY ---
document.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('keydown', (e) => {
    if (e.keyCode === 123 || (e.ctrlKey && e.shiftKey && e.keyCode === 73) || (e.ctrlKey && e.keyCode === 85)) {
        e.preventDefault();
        return false;
    }
});

// --- 1b. APP SETTINGS + LANGUAGE (project spec §25-§30, §65) ---
// Single existing settings store (localStorage key 'appSettings.v1') is
// reused for the language preference too, instead of adding a second
// competing localStorage key. Placed early (right after imports) so the
// UI is translated before any panel content renders, not after.
const APP_SETTINGS_KEY = 'appSettings.v1';
const defaultAppSettings = { showDragLength: true, language: null, theme: null }; // language: null = "not chosen yet", fall back to browser
let appSettings = { ...defaultAppSettings };
try {
    const saved = JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || '{}');
    appSettings = { ...defaultAppSettings, ...saved };
} catch (e) { /* ignore corrupt/missing settings, use defaults */ }

function saveAppSettings() {
    try { localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(appSettings)); } catch (e) { /* storage unavailable, non-fatal */ }
}

// Initialize the UI language: saved preference > browser language > Thai
// (spec §30). This only applies the translation pass (initI18n does not
// persist), so first-run behavior never writes to storage on its own.
initI18n(appSettings.language || detectDefaultLanguage());

const langButtons = document.querySelectorAll('#lang-switcher .lang-btn');
function updateLangButtonsUI() {
    langButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.lang === getLanguage()));
}
updateLangButtonsUI();
langButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.dataset.lang === getLanguage()) return;
        setLanguage(btn.dataset.lang);
        appSettings.language = btn.dataset.lang;
        saveAppSettings();
        updateLangButtonsUI();
    });
});


// --- 1c. COLOR THEMES (dark / light / sky) ---
// UI colors live in CSS variables (body.theme-light / body.theme-sky in
// style.css). The 3D scene is drawn by WebGL and can't read CSS, so each
// theme also carries its scene palette here. Saved in the same
// appSettings store as language; default stays "dark" (original look).
const THEMES = {
    dark:  { bg: 0x12151b, gridCenter: 0x3f7cb5, grid: 0x2a2f38, plotCenter: 0x4fae67, plotGrid: 0x2f5138, outline: 0x5aa3d8, cut: 0xffd24d },
    light: { bg: 0xe9edf1, gridCenter: 0x3f7cb5, grid: 0xc3ccd6, plotCenter: 0x2e8f4e, plotGrid: 0xa9d2b5, outline: 0x2c6690, cut: 0xc98200 },
    sky:   { bg: 0xe4edf6, gridCenter: 0x3a77b3, grid: 0xb4c8dc, plotCenter: 0x2e8f4e, plotGrid: 0xa6cdb3, outline: 0x2d6fa9, cut: 0xc98200 }
};
let currentTheme = THEMES[appSettings.theme] ? appSettings.theme : 'dark';
let sceneThemeReady = false; // flipped on once the 3D scene exists (see applySceneTheme)
const themeScene = () => THEMES[currentTheme];

function updateThemeTitles() {
    document.querySelectorAll('.theme-btn[data-theme-choice]').forEach(el => {
        const label = t('settings.theme.' + el.dataset.themeChoice);
        el.title = label;
        el.setAttribute('aria-label', label);
    });
}

function applyTheme(name, persist = true) {
    if (!THEMES[name]) name = 'dark';
    currentTheme = name;
    document.body.classList.remove('theme-light', 'theme-sky');
    if (name !== 'dark') document.body.classList.add('theme-' + name);
    document.documentElement.style.colorScheme = name === 'dark' ? 'dark' : 'light';
    document.querySelectorAll('[data-theme-choice]').forEach(el => {
        const on = el.dataset.themeChoice === name;
        el.classList.toggle('active', on);
        el.setAttribute('aria-pressed', String(on));
    });
    if (persist) { appSettings.theme = name; saveAppSettings(); }
    if (sceneThemeReady) applySceneTheme();
}
applyTheme(currentTheme, false);
updateThemeTitles();
onLanguageChange(updateThemeTitles);
document.querySelectorAll('[data-theme-choice]').forEach(el => {
    el.addEventListener('click', () => applyTheme(el.dataset.themeChoice));
});

// setLanguage() re-applies translations to every [data-i18n*] element
// automatically, but a few panels build their own HTML strings from JS
// (BOQ report, texture manager status text, cut-face counter, outliner
// empty state) and need an explicit re-render to pick up the new
// language. Registered once; the functions themselves are defined further
// down but hoisted (function declarations), so this is safe at call time.
onLanguageChange(() => {
    try { refreshFloorSwitcher(); } catch (e) { /* not ready yet, skip */ }
    try { refreshLandPlotUI(); } catch (e) { /* not ready yet, skip */ }
    try { refreshObjectList(); } catch (e) { /* not ready yet, skip */ }
    try { refreshNewMaterialTabs(); } catch (e) { /* not ready yet, skip */ }
    try { if (document.getElementById('texture-modal')?.style.display !== 'none') renderTextureManager(); } catch (e) { /* not ready yet, skip */ }
    try { updateCutFaceCountLabel(); } catch (e) { /* not ready yet, skip */ }
    try { updateStatusBar(); } catch (e) { /* not ready yet, skip */ }
    try {
        const calcEl = document.getElementById('calc-result-content');
        if (calcEl && !calcEl.querySelector('.calc-placeholder') && typeof window.performCalcAll === 'function') {
            (typeof lastBOQRefresh === 'function' ? lastBOQRefresh : window.performCalcAll)();
        }
    } catch (e) { /* not ready yet, skip */ }
});

import { getMaterials, DEFAULT_MATERIAL_ID, addCustomMaterial, removeCustomMaterial, getMaterialTextures, setMaterialTextures, clearMaterialTextures, serializeMaterialRegistry, loadMaterialRegistry, getBoqSettings, ceilQty, COUNT_UNITS, setWastePct, setSandStoneBulking, applyRecommendedWaste, resetBoqSettings } from './src/materials/MaterialLibrary.js';
import { fileToDataURL } from './src/materials/TextureCache.js';
import { scaleBoxUVsToRealSize } from './src/geometry/GeometryFactory.js';
import { openTextureCropTool, isLikelyExrDataUrl } from './src/materials/TextureCropTool.js';
import { applyTexturesToMaterial, buildStandardMaterial } from './src/materials/MaterialBuilder.js';
import { generateId } from './src/core/IdGenerator.js';

// เวอร์ชันนี้ถอดเฉพาะ "ปริมาณวัสดุ" ตามสูตรตรงๆ ไม่มีค่าเผื่อสูญเสียและไม่มีการคิดราคา (เพราะราคาไม่คงที่)

// --- 2. MATERIAL LIBRARY (คลังวัสดุ) ---
// ดึงจาก MaterialLibrary กลาง (src/materials/) ที่ใช้ร่วมกับผนังพาราเมตริกใน GeometryFactory.js
// เป็น `let` เพราะรีเฟรชใหม่ทุกครั้งที่ผู้ใช้เพิ่ม/ลบวัสดุผ่านหน้าจัดการพื้นผิว (ข้อ 6)
let MATERIALS = getMaterials();
function refreshMaterialsRegistry() { MATERIALS = getMaterials(); }
const DEFAULT_MATERIAL = DEFAULT_MATERIAL_ID;
function getMaterialId(obj) {
    return (obj && obj.userData && MATERIALS[obj.userData.material]) ? obj.userData.material : DEFAULT_MATERIAL;
}

// --- 3. GUI UTILS ---
function isWindowVisible(el) {
    // เช็คจากค่าที่แสดงจริง ไม่ใช่แค่ inline style (กัน bug คลิกครั้งแรกไม่ทำงาน)
    return el && getComputedStyle(el).display !== 'none';
}

window.toggleWindow = function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (isWindowVisible(el)) {
        el.style.display = 'none';
    } else {
        el.style.display = 'flex';
        bringToFront(el);
    }
    updateTaskbar();
    if (typeof window.updateViewportRegion === 'function') window.updateViewportRegion();
};

window.closeWindow = function (id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
    updateTaskbar();
    if (typeof window.updateViewportRegion === 'function') window.updateViewportRegion();
};

function updateTaskbar() {
    if (typeof window.snavSync === 'function') window.snavSync();
    ['panel-tools', 'panel-outliner', 'panel-calc', 'panel-settings'].forEach((pid, idx) => {
        const el = document.getElementById(pid);
        const btnId = ['tb-tools', 'tb-outliner', 'tb-calc', 'tb-settings'][idx];
        const btn = document.getElementById(btnId);
        if (el && btn) {
            if (isWindowVisible(el)) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    });
}

// --- SIDE NAV (UI only): switches which section of #panel-tools is shown.
// No scene logic; sections are plain DOM show/hide, buttons keep their IDs/handlers.
const SNAV_SECTIONS = {
    build: 'snavSection.build', mat: 'snavSection.mat', floors: 'snavSection.floors',
    props: 'snavSection.props', proj: 'snavSection.proj'
};
let snavCurrent = 'build';
function snavShowSection(name) {
    document.querySelectorAll('#panel-tools .snav-section').forEach(sec => {
        sec.classList.toggle('snav-section--hidden', sec.dataset.snavSection !== name);
    });
    // material list node (listeners intact) is shown in the materials section, returned to build otherwise
    const mt = document.getElementById('material-tabs');
    const home = document.getElementById('material-tabs-home');
    const slot = document.getElementById('material-tabs-mat-slot');
    if (mt && home && slot) (name === 'mat' ? slot : home).appendChild(mt);
    const titleEl = document.querySelector('#panel-tools-header .win-title');
    if (titleEl) { titleEl.removeAttribute('data-i18n'); titleEl.textContent = SNAV_SECTIONS[name] ? t(SNAV_SECTIONS[name]) : titleEl.textContent; }
}
onLanguageChange(() => {
    const titleEl = document.querySelector('#panel-tools-header .win-title');
    if (titleEl && !titleEl.hasAttribute('data-i18n') && SNAV_SECTIONS[snavCurrent]) titleEl.textContent = t(SNAV_SECTIONS[snavCurrent]);
});
window.snavActivate = function (name) {
    if (!SNAV_SECTIONS[name]) { window.snavSync(); return; }
    const panel = document.getElementById('panel-tools');
    if (name === snavCurrent && isWindowVisible(panel)) { window.closeWindow('panel-tools'); return; }
    snavCurrent = name;
    snavShowSection(name);
    if (!isWindowVisible(panel)) window.toggleWindow('panel-tools');
    else { bringToFront(panel); window.snavSync(); }
};
window.snavSync = function () {
    const vis = id => isWindowVisible(document.getElementById(id));
    const toolsOpen = vis('panel-tools');
    Object.keys(SNAV_SECTIONS).forEach(k => {
        document.getElementById('snav-' + k)?.classList.toggle('snav-active', toolsOpen && k === snavCurrent);
    });
    document.getElementById('snav-boq')?.classList.toggle('snav-active', vis('panel-calc'));
    document.getElementById('snav-outliner')?.classList.toggle('snav-active', vis('panel-outliner'));
    document.getElementById('snav-settings')?.classList.toggle('snav-active', vis('panel-settings'));
};

function bringToFront(el) {
    document.querySelectorAll('.window-panel').forEach(p => p.style.zIndex = 10);
    el.style.zIndex = 11;
}

function makeDraggable(elmnt) {
    if (!elmnt) return;
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const header = document.getElementById(elmnt.id + "-header");
    if (header) header.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
        bringToFront(elmnt);
    }
    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        let newTop = elmnt.offsetTop - pos2;
        let newLeft = elmnt.offsetLeft - pos1;
        // จำกัดไม่ให้แถบหัวหลุดออกนอกจอ (เหลืออย่างน้อย 120px ไว้คว้าลากกลับได้เสมอ)
        const w = elmnt.offsetWidth;
        const MIN_VISIBLE = 120, TOP_BAR = 40;
        newTop = Math.max(TOP_BAR, Math.min(newTop, window.innerHeight - 36));
        newLeft = Math.max(MIN_VISIBLE - w, Math.min(newLeft, window.innerWidth - MIN_VISIBLE));
        elmnt.style.top = newTop + "px";
        elmnt.style.left = newLeft + "px";
    }
    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
        if (typeof window.updateViewportRegion === 'function') window.updateViewportRegion();
    }
}

['panel-tools', 'panel-outliner', 'panel-calc', 'panel-settings'].forEach(id => makeDraggable(document.getElementById(id)));
snavShowSection('build');
window.snavSync();

// --- 4. THREE.JS SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(themeScene().bg); // ตรงกับ --bg-canvas ของธีมปัจจุบัน

const container = document.getElementById('canvas-container');
// Viewport overlays (gizmo, floor badge) must track the viewport region
// itself, not the browser window — move them inside #canvas-container so
// they anchor to its edges even when a dock changes its width.
['view-gizmo', 'viewport-floor-badge', 'view-mode-toggle'].forEach(id => {
    const el = document.getElementById(id);
    if (el) container.appendChild(el);
});
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(container.clientWidth, container.clientHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
container.appendChild(labelRenderer.domElement);

const marqueeEl = document.createElement('div');
marqueeEl.className = 'marquee-box';
container.appendChild(marqueeEl);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(10, 8, 12);

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(5, 12, 7);
scene.add(dirLight);

let gridHelper = buildCustomGrid(20, 20, 20);
scene.add(gridHelper);
scene.add(new THREE.AxesHelper(2));

// --- GRID SIZE (must be set once before use, per spec request) ---
// Custom LineSegments instead of THREE.GridHelper: GridHelper only draws
// a square (one size, one division count), so a non-square width×length
// had to be faked with non-uniform scale (skewed cell spacing). Building
// the lines by hand lets width/length/divisions be set independently and
// still land on true 1-cell-per-division spacing on both axes.
function buildCustomGrid(width, length, divisions, colorCenter = themeScene().gridCenter, colorGrid = themeScene().grid) {
    const halfW = width / 2, halfL = length / 2;
    const positions = [];
    const colors = [];
    const cCenter = new THREE.Color(colorCenter);
    const cGrid = new THREE.Color(colorGrid);
    for (let i = 0; i <= divisions; i++) {
        const x = -halfW + (width * i) / divisions;
        const c = (x === 0) ? cCenter : cGrid;
        positions.push(x, 0, -halfL, x, 0, halfL);
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let i = 0; i <= divisions; i++) {
        const z = -halfL + (length * i) / divisions;
        const c = (z === 0) ? cCenter : cGrid;
        positions.push(-halfW, 0, z, halfW, 0, z);
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
    return new THREE.LineSegments(geo, mat);
}

// Recolor an existing custom grid in place (used when the theme changes).
function recolorGrid(grid, centerHex, gridHex) {
    const pos = grid.geometry.attributes.position;
    const col = grid.geometry.attributes.color;
    const cc = new THREE.Color(centerHex), cg = new THREE.Color(gridHex);
    for (let i = 0; i + 1 < pos.count; i += 2) {
        const alongZ = pos.getX(i) === pos.getX(i + 1);
        const isCenter = alongZ ? pos.getX(i) === 0 : pos.getZ(i) === 0;
        const c = isCenter ? cc : cg;
        col.setXYZ(i, c.r, c.g, c.b);
        col.setXYZ(i + 1, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
}

function applyGridSize(width, length, divisions) {
    scene.remove(gridHelper);
    gridHelper.geometry.dispose();
    gridHelper.material.dispose();
    gridHelper = buildCustomGrid(width, length, Math.max(1, Math.round(divisions)));
    scene.add(gridHelper);
    syncGridToActiveFloor();
}

const gridSetupEl = document.getElementById('gridsetup');
document.getElementById('gridsetup-close')?.addEventListener('click', () => {
    const w = parseFloat(document.getElementById('inp-grid-width').value);
    const l = parseFloat(document.getElementById('inp-grid-length').value);
    const d = parseFloat(document.getElementById('inp-grid-divisions').value);
    applyGridSize(w > 0 ? w : 20, l > 0 ? l : 20, d > 0 ? d : 20);
    if (gridSetupEl) gridSetupEl.style.display = 'none';
});

let orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
// ลูกกลิ้งเมาส์: ซูมเข้า/ออกตรงตำแหน่งเคอร์เซอร์ (แทนที่จะซูมเข้าหาจุดกลางฉากเสมอ)
// และไม่ให้ซูมทะลุ/ติดค้างที่จุดเป้าหมาย
orbit.enableZoom = false; // ซูมด้วยระบบของเราเอง (smoothZoom ด้านล่าง) เพื่อให้นุ่มและไม่วาป
orbit.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.ROTATE,   // ลากเมาส์กลาง = หมุนมุมมอง (เหมือน SketchUp)
    RIGHT: THREE.MOUSE.PAN
};

// rebuildOrbitControls() — audited three@0.160.0's actual OrbitControls
// source: its up-alignment quaternion (`quat`/`quatInverse`, used to
// convert camera.position<->spherical every update() call) is computed
// ONCE, inside a closure, from `object.up` AT CONSTRUCTION TIME, and this
// three version has NO public `updateUp()` method to resync it (that only
// exists in much newer three.js releases). So once our axis-view code
// mutates camera.up away from the default (0,1,0) for a Top/Bottom view,
// every future orbit.update() — including the one every pan/rotate/zoom
// handler calls, and the one called every frame in the main animate()
// loop — recomputes position using a now-WRONG alignment, reintroducing
// roll on every view afterward (not just Top/Bottom), which is exactly
// what showed up as "drag to pan and it goes crooked" after ever visiting
// a Top/Bottom view in the same session. There's no private-internals
// workaround available from outside the module, so the only correct fix
// using public API only is to fully recreate the controls (dispose + new)
// whenever camera.up changes — its alignment quaternion is then freshly
// derived from the CURRENT camera.up at the moment of construction, which
// is exactly the alignment orbiting/panning/dollying needs from then on.
function rebuildOrbitControls() {
    const prevTarget = orbit.target.clone();
    const prevEnabled = orbit.enabled;
    const prevDamping = orbit.enableDamping;
    const prevDampingFactor = orbit.dampingFactor;
    const prevMouseButtons = { ...orbit.mouseButtons };
    orbit.dispose();
    orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.copy(prevTarget);
    orbit.enabled = prevEnabled;
    orbit.enableDamping = prevDamping;
    orbit.dampingFactor = prevDampingFactor;
    orbit.enableZoom = false;
    orbit.mouseButtons = prevMouseButtons;
    orbit.update();
    if (typeof window.__armOrbitUnlock === 'function') window.__armOrbitUnlock();
}

// --- VIEWPORT REGION (canvas actually resizes when a dock is open —
// spec rule "Docked panels push content"). A panel counts as "docked"
// here only while it's still flush against its edge (left===0 / right
// flush to window edge); once its header is dragged away (existing
// makeDraggable sets an arbitrary inline left/top) it's floating and
// stops reserving viewport space, same as `panel-tools`/`panel-outliner`
// naturally already behave, no new state flag needed. ---
function computeDockOffsets() {
    let left = 0, right = 0;
    const tools = document.getElementById('panel-tools');
    const outliner = document.getElementById('panel-outliner');
    if (tools && isWindowVisible(tools) && tools.offsetLeft <= 0) {
        left = tools.offsetWidth;
    }
    if (outliner && isWindowVisible(outliner)) {
        const rect = outliner.getBoundingClientRect();
        if (window.innerWidth - rect.right <= 1) right = outliner.offsetWidth;
    }
    return { left, right };
}
function onViewportResize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (w <= 0 || h <= 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
}
function updateViewportRegion() {
    const { left, right } = computeDockOffsets();
    container.style.left = left + 'px';
    container.style.right = right + 'px';
    onViewportResize();
}
window.updateViewportRegion = updateViewportRegion;
// Initial layout: left/right panels are visible by default (docked), so
// the viewport must already be sized around them on first paint.
updateViewportRegion();


const transformControl = new TransformControls(camera, renderer.domElement);
transformControl.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !e.value;
    if (e.value) pushUndo();
});
scene.add(transformControl);

// --- VIEW ORIENTATION GIZMO (camera navigation only — never touches
// scene/object transforms; confirmed world-up axis = Y, per camera setup
// above `camera.position.set(10, 8, 12)` + flat XZ grid, Floor/Ground on
// the XZ plane per FloorManager/WallManager use of position.x/position.z). ---
//
// ROOT CAUSE OF THE REPORTED TILT (audited before this fix, not guessed):
//
// 1. camera.up was being mutated at runtime for the ±Y (Top/Bottom) views,
//    but OrbitControls caches an internal up-alignment quaternion once,
//    from object.up as it was AT CONSTRUCTION TIME (default (0,1,0)), and
//    does not recompute it when object.up changes later — that's what its
//    own `updateUp()` method exists to do, and it was never called here.
//    From the first ±Y click onward, every later `orbit.update()` call
//    (every frame, forever, via the main animate() loop) derived spherical
//    coordinates against a now-stale alignment, reintroducing roll — on
//    every axis afterward, not only Y. This alone explains "click X, still
//    looks tilted" whenever a Top/Bottom view had been visited earlier.
// 2. `orbit.enableDamping = true` means any leftover rotation momentum
//    (sphericalDelta) from the user's last manual drag is not zeroed when
//    an axis view starts; it only decays a few percent per `update()`
//    call, so a fraction of the old free-look rotation bleeds into the new
//    axis view and fades out over the following second instead of being
//    exact immediately.
// 3. No exact re-snap at animation end — the final frame relied only on
//    lerp reaching t=1 plus `normalize()`, with no explicit re-derivation
//    of orientation from the exact table values and no floating-point
//    drift cleanup (spec's own §19/§26 requirement).
// 4. Per-button ad hoc `up` logic instead of one authoritative table
//    (spec §30-33) — kept the two Top/Bottom cases from ever being
//    reasoned about consistently with the other four.
//
// Fix below: a single AXIS_VIEWS table (direction + up, spec §32), one
// entry point setExactAxisView() used by gizmo clicks/corner/numpad, an
// explicit momentum-clear + updateUp() resync + exact re-snap at the end
// of the fly animation, and a console-only validateCameraAxisAlignment()
// debug helper (spec §47). Camera stays Perspective (switching to a true
// Orthographic camera touches raycasting/TransformControls/every build
// tool that reads `camera` — a larger, separate change, flagged, not done
// here per "don't modify unrelated systems").
(function setupViewGizmo() {
    const root = document.getElementById('view-gizmo');
    if (!root) return;

    // Single source of truth for every axis-aligned view (spec §32-33).
    // view direction = world vector the camera looks ALONG (camera sits on
    // the opposite side of target, i.e. camera.position = target - dir*distance... 
    // here we keep the original convention: dir is the direction FROM target
    // TO the camera, matching the previous `flyTo(dir)` call sites below).
    const AXIS_VIEWS = {
        '+X': { dir: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
        '-X': { dir: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
        '+Y': { dir: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },
        '-Y': { dir: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
        '+Z': { dir: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
        '-Z': { dir: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
    };

    // World direction, i18n key, display letter (only shown on the + node)
    const AXES = [
        { view: '+X', cls: 'gizmo-x', label: 'X', key: 'gizmo.right', neg: false },
        { view: '-X', cls: 'gizmo-x', label: '', key: 'gizmo.left', neg: true },
        { view: '+Y', cls: 'gizmo-y', label: 'Y', key: 'gizmo.top', neg: false },
        { view: '-Y', cls: 'gizmo-y', label: '', key: 'gizmo.bottom', neg: true },
        { view: '+Z', cls: 'gizmo-z', label: 'Z', key: 'gizmo.front', neg: false },
        { view: '-Z', cls: 'gizmo-z', label: '', key: 'gizmo.back', neg: true },
    ];

    const nodes = AXES.map(a => {
        const el = document.createElement('div');
        el.className = 'gizmo-axis ' + a.cls + (a.neg ? ' gizmo-neg' : '');
        el.textContent = a.label;
        el.title = t(a.key);
        el.addEventListener('click', (e) => { e.stopPropagation(); setExactAxisView(a.view); });
        // Don't let OrbitControls see mousedown that started on the gizmo.
        el.addEventListener('mousedown', (e) => e.stopPropagation());
        root.appendChild(el);
        return el;
    });

    const centerEl = document.createElement('div');
    centerEl.className = 'gizmo-center';
    centerEl.title = t('gizmo.iso');
    centerEl.addEventListener('mousedown', (e) => e.stopPropagation());
    // Isometric/corner view is explicitly NOT an axis view (spec §23-24):
    // no snap-to-exact-axis, no up-vector table entry — just a diagonal
    // look direction with world Y kept up, same as the original behavior.
    centerEl.addEventListener('click', (e) => { e.stopPropagation(); flyTo(new THREE.Vector3(1, 1, 1), new THREE.Vector3(0, 1, 0)); });
    root.appendChild(centerEl);

    // Re-apply tooltips when language changes (same pattern as rest of app).
    onLanguageChange(() => {
        nodes.forEach((el, i) => { el.title = t(AXES[i].key); });
        centerEl.title = t('gizmo.iso');
    });

    const RADIUS = 38;
    const tmpQuat = new THREE.Quaternion();
    function updateViewGizmo() {
        tmpQuat.copy(camera.quaternion).invert();
        AXES.forEach((a, i) => {
            const dir = AXIS_VIEWS[a.view].dir;
            const v = dir.clone().applyQuaternion(tmpQuat); // world axis -> camera-local space
            const x = v.x * RADIUS, y = -v.y * RADIUS;
            const front = v.z > 0; // toward viewer in camera-local space
            const el = nodes[i];
            el.style.left = (50 + x) + 'px';
            el.style.top = (50 + y) + 'px';
            el.style.zIndex = Math.round(v.z * 100) + 10;
            el.style.opacity = front ? (a.neg ? 0.5 : 1) : (a.neg ? 0.22 : 0.45);
        });
    }
    window.updateViewGizmo = updateViewGizmo;

    // Camera-only transition: preserves current distance-to-target, never
    // touches object transforms. Re-uses the existing `orbit` OrbitControls
    // instance (no duplicate camera system per spec).
    let flyState = null;
    // Locked axis view (spec §53-54 repeated-click case). Continuous
    // orbit.update() in the main animate() loop still recomputes
    // camera position/orientation from OrbitControls' own internal
    // spherical state every single frame, forever — even with zero
    // pointer delta and damping off, that round-trip is not guaranteed
    // bit-exact against the authoritative AXIS_VIEWS table, so a small
    // but real (not float-epsilon) drift creeps in frame after frame
    // once an exact axis view is active (confirmed via
    // validateCameraAxisAlignment: Dot Error 1.3e-2, Roll Error 0 —
    // direction drifts while up stays pinned, i.e. OrbitControls'
    // own update() is the moving part, not the one-time snap). Cheapest
    // correct fix: re-assert the exact table orientation every frame
    // while locked, and only release the lock once the user actually
    // starts orbiting/panning/zooming again.
    let lockedExactView = null;
    window.__correctAxisLockDrift = function () {
        if (lockedExactView) snapCameraToExactAxis(lockedExactView);
    };
    window.__clearAxisLock = function () { lockedExactView = null; };
    function armOrbitUnlock() {
        orbit.addEventListener('start', () => { lockedExactView = null; });
    }
    armOrbitUnlock();
    window.__armOrbitUnlock = armOrbitUnlock; // rebuildOrbitControls() makes a
    // fresh `orbit` instance (see its own comment above) — that new instance
    // needs this listener re-attached too, or the lock could never clear.

    /** setExactAxisView('+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z') — the one
     * entry point for every axis-aligned view (spec §21, §33). Never call
     * camera.position/rotation ad hoc from elsewhere — go through this. */
    function setExactAxisView(view) {
        const cfg = AXIS_VIEWS[view];
        if (!cfg) return;
        flyTo(cfg.dir, cfg.up, view);
    }
    window.setExactAxisView = setExactAxisView;

    function flyTo(dirVector, upVector, exactView) {
        const dir = dirVector.clone().normalize();
        const up = upVector.clone().normalize();
        // Target must stay whatever the user is currently looking at (spec
        // §12-13, §36) — never recentered to (0,0,0) or "fit view" here.
        const target = orbit.target.clone();
        const distance = camera.position.distanceTo(target);
        const targetPos = target.clone().addScaledVector(dir, distance);

        // Kill leftover rotation momentum from a drag that just ended right
        // before the click (root cause #2 above): with damping OFF for one
        // call, OrbitControls' own update() zeroes sphericalDelta instead
        // of decaying it, so none of the old free-look rotation carries
        // into the new view. Public API only (`enableDamping`), no private
        // internals touched.
        const hadDamping = orbit.enableDamping;
        orbit.enableDamping = false;
        orbit.update();
        orbit.enableDamping = hadDamping;

        flyState = {
            fromPos: camera.position.clone(), toPos: targetPos,
            fromUp: camera.up.clone(), toUp: up,
            target, exactView,
            t0: performance.now(), duration: 320,
        };
        orbit.enabled = false;
        requestAnimationFrame(stepFly);
    }

    function stepFly(now) {
        if (!flyState) return;
        const k = Math.min(1, (now - flyState.t0) / flyState.duration);
        const ease = 1 - Math.pow(1 - k, 3); // ease-out cubic

        if (k < 1) {
            camera.position.lerpVectors(flyState.fromPos, flyState.toPos, ease);
            camera.up.copy(flyState.fromUp).lerp(flyState.toUp, ease).normalize();
            camera.lookAt(flyState.target);
            orbit.update();
            requestAnimationFrame(stepFly);
            return;
        }

        // Final frame: snap to the EXACT table values instead of trusting
        // lerp(t=1)/normalize() alone (spec §19, §26 — remove float drift
        // at the source, not just round it away cosmetically).
        camera.position.copy(flyState.toPos);
        camera.up.copy(flyState.toUp);
        camera.lookAt(flyState.target);
        orbit.target.copy(flyState.target);

        // Root cause #1 fix (see rebuildOrbitControls() above for the full
        // audit): camera.up just changed (or was reaffirmed); this three.js
        // version has no updateUp() to resync OrbitControls' cached
        // alignment, so rebuild the controls instance instead — the only
        // fix available through public API that actually works, for every
        // view, not only ±Y.
        rebuildOrbitControls();

        snapCameraToExactAxis(flyState.exactView);
        lockedExactView = flyState.exactView || null;

        flyState = null;
        orbit.enabled = true;
    }

    /** snapCameraToExactAxis(view) — for a real axis view (not iso), force
     * camera.quaternion to the mathematically exact orientation derived
     * from the table's dir/up rather than whatever lookAt()+float math
     * produced, so repeated/alternating clicks (spec §53-54) can never
     * accumulate drift. No-op for the isometric/corner view. */
    function snapCameraToExactAxis(view) {
        if (!view || !AXIS_VIEWS[view]) return;
        const { dir, up } = AXIS_VIEWS[view];
        const m = new THREE.Matrix4();
        // Camera looks from (target + dir*distance) back toward target,
        // i.e. its local -Z axis is -dir.
        m.lookAt(dir, new THREE.Vector3(0, 0, 0), up);
        camera.quaternion.setFromRotationMatrix(m);
        camera.up.copy(up);
    }

    /** validateCameraAxisAlignment() — debug utility (spec §47), console-only. */
    function validateCameraAxisAlignment(view) {
        const cfg = AXIS_VIEWS[view];
        if (!cfg) { console.warn('Unknown view', view); return; }
        const actual = new THREE.Vector3();
        camera.getWorldDirection(actual); // camera looks along -dir
        const expected = cfg.dir.clone().multiplyScalar(-1).normalize();
        const dotError = 1 - actual.normalize().dot(expected);
        const rollError = 1 - camera.up.clone().normalize().dot(cfg.up);
        const pass = Math.abs(dotError) < 1e-6 && Math.abs(rollError) < 1e-6;
        console.log(`View: ${view}\nExpected Direction: (${expected.x.toFixed(4)}, ${expected.y.toFixed(4)}, ${expected.z.toFixed(4)})\nActual Direction:   (${actual.x.toFixed(4)}, ${actual.y.toFixed(4)}, ${actual.z.toFixed(4)})\nDot Error: ${dotError.toExponential(2)}\nRoll Error: ${rollError.toExponential(2)}\n${pass ? 'PASS' : 'FAIL'}`);
        return pass;
    }
    window.validateCameraAxisAlignment = validateCameraAxisAlignment;

    // Numpad view shortcuts (front/back/left/right/top/bottom/iso) — only
    // Numpad codes, so they can't collide with the existing plain-letter
    // shortcuts (T/E/R/Q) or typing in a focused input.
    window.addEventListener('keydown', (e) => {
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        const map = {
            Numpad1: e.ctrlKey ? '-Z' : '+Z',
            Numpad3: e.ctrlKey ? '-X' : '+X',
            Numpad7: e.ctrlKey ? '-Y' : '+Y',
        };
        if (map[e.code]) { e.preventDefault(); setExactAxisView(map[e.code]); }
        if (e.code === 'Numpad0') { e.preventDefault(); document.getElementById('btn-reset-view')?.click(); }
        if (e.code === 'Numpad5') { e.preventDefault(); flyTo(new THREE.Vector3(1, 1, 1), new THREE.Vector3(0, 1, 0)); }
    });
})();

// --- 2D / 3D VIEW MODE TOGGLE --------------------------------------------
// "2D" here means: free rotate is switched off (pan/zoom + the gizmo's
// axis nodes only, so the user lands on a flat top/bottom/left/right/
// front/back view and stays there), not a real THREE.OrthographicCamera.
// A true ortho camera is intentionally NOT used: `camera` is a shared
// reference read by TransformControls, both raycasters, and the
// parametric building module (see `bootstrapParametricBuilding({camera})`
// below) — swapping it for a whole new camera *instance* would mean
// re-wiring every one of those (a much larger, separate change, same
// reasoning as the "camera stays Perspective" note on the gizmo above).
// Instead this keeps the exact same PerspectiveCamera object and fakes an
// orthographic look by shrinking its FOV to near-zero while pushing it
// back the matching distance, so every consumer of `camera` keeps working
// unchanged — only fov/far/position on the existing object change.
(function setupViewModeToggle() {
    const PERSPECTIVE_FOV = 50; // matches the camera's initial construction above
    const PERSPECTIVE_FAR = 1000;
    const ORTHO_LIKE_FOV = 1.2; // degrees — narrow enough to read as flat/parallel

    let cameraMode = '3d';

    function setCameraMode(mode) {
        if (mode === cameraMode) return;
        const target = orbit.target.clone();
        const distance = camera.position.distanceTo(target);
        if (distance < 1e-6) return; // camera sitting on its own target — nothing sane to compute
        const dir = camera.position.clone().sub(target).normalize();

        // Keep the same apparent framing across the switch: solve for the
        // distance at the new FOV that reproduces today's visible half-height.
        const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance;
        const newFov = (mode === '2d') ? ORTHO_LIKE_FOV : PERSPECTIVE_FOV;
        const newDistance = halfHeight / Math.tan(THREE.MathUtils.degToRad(newFov) / 2);

        camera.fov = newFov;
        // At near-zero FOV the camera sits very far back, so the far plane
        // needs matching headroom or geometry near the target gets clipped.
        camera.far = (mode === '2d') ? (newDistance + PERSPECTIVE_FAR) : PERSPECTIVE_FAR;
        camera.position.copy(target).addScaledVector(dir, newDistance);
        camera.updateProjectionMatrix();
        cameraMode = mode;

        // Same reasoning as flyTo()/rebuildOrbitControls() above: OrbitControls
        // caches its own spherical(radius/theta/phi) state instead of reading
        // camera.position fresh each frame, so a manual position change like
        // the one above needs a fresh instance or it gets silently overwritten
        // on the next orbit.update().
        rebuildOrbitControls();
        orbit.enableRotate = (mode !== '2d');
        orbit.mouseButtons = (mode === '2d')
            ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }
            : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };

        document.getElementById('view-gizmo')?.classList.toggle('mode-2d', mode === '2d');
        const btn = document.getElementById('view-mode-toggle');
        if (btn) {
            btn.textContent = (mode === '2d') ? '2D' : '3D';
            btn.classList.toggle('active-2d', mode === '2d');
            btn.title = t(mode === '2d' ? 'gizmo.switchTo2d' : 'gizmo.switchTo3d');
        }
    }
    window.setCameraMode = setCameraMode;
    window.getCameraMode = () => cameraMode;

    const toggleBtn = document.getElementById('view-mode-toggle');
    if (toggleBtn) {
        toggleBtn.title = t('gizmo.switchTo2d');
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setCameraMode(cameraMode === '2d' ? '3d' : '2d');
        });
        toggleBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        onLanguageChange(() => {
            toggleBtn.title = t(cameraMode === '2d' ? 'gizmo.switchTo2d' : 'gizmo.switchTo3d');
        });
    }
})();

// --- PARAMETRIC BUILDING SYSTEM (additive; see docs/ARCHITECTURE.md) ---
// Coexists with the legacy free-form box editor below. Toggled on via
// the "วาดผนัง" button; does not touch `objects`/legacy undo-redo.
const parametric = bootstrapParametricBuilding({
    scene, camera, domElement: renderer.domElement,
    // Fold every parametric wall mesh into the SAME `objects` array/outliner
    // legacy boxes use, so group/duplicate/lock/rename/delete all work on
    // walls for free instead of needing a parallel UI (spec request: one
    // unified "โครงสร้างในฉาก" list).
    onWallMeshCreated: (mesh, wall) => {
        mesh.userData.name = wall.name || `ผนัง ${wall.id.slice(-4)}`;
        mesh.userData.material = wall.materialId;
        objects.push(mesh);
        refreshObjectList();
        selectObject(mesh);
    },
});

// --- PARAMETRIC FLOOR SWITCHER (additive UI, spec §15) ---
function refreshFloorSwitcher() {
    const container = document.getElementById('floor-switcher');
    if (!container) return;
    container.innerHTML = '';
    parametric.floorManager.listFloors().forEach(floor => {
        const btn = document.createElement('button');
        btn.className = 'material-tab' + (floor.id === parametric.floorManager.activeFloorId ? ' active' : '');
        btn.textContent = tData(floor.name);
        btn.title = t('floors.tooltip', { elev: floor.elevation.toFixed(2), h: floor.height.toFixed(2) });
        btn.addEventListener('click', () => {
            const wasActive = floor.id === parametric.floorManager.activeFloorId;
            parametric.floorManager.setActiveFloor(floor.id);
            updateStatusBar();
            refreshFloorSwitcher();
            if (wasActive) toggleFloorLayerPanel();
            else showFloorLayerPanel();
        });
        container.appendChild(btn);
    });
}
refreshFloorSwitcher();

// --- ข้อ 7: toggle เปิด/ปิดเลเยอร์ต่อชั้น (independent ต่อชั้น) ---
function showFloorLayerPanel() {
    const panel = document.getElementById('floor-layer-panel');
    if (!panel) return;
    panel.style.display = 'block';
    const floor = parametric.floorManager.getActiveFloor();
    if (!floor) return;
    document.getElementById('chk-layer-designedGrid').checked = floor.layerVisibility.designedGrid;
    document.getElementById('chk-layer-plainGrid').checked = floor.layerVisibility.plainGrid;
    document.getElementById('chk-layer-landPlotImage').checked = floor.layerVisibility.landPlotImage;
}
function toggleFloorLayerPanel() {
    const panel = document.getElementById('floor-layer-panel');
    if (!panel) return;
    if (panel.style.display === 'none') showFloorLayerPanel();
    else panel.style.display = 'none';
}
function applyFloorLayerVisibility() {
    const floor = parametric.floorManager.getActiveFloor();
    if (!floor) return;
    gridHelper.visible = floor.layerVisibility.plainGrid;
    landPlotOverlay.setVisible(floor.layerVisibility.landPlotImage && (floor.landPlotImage?.visible !== false));
    rebuildLandPlotGrid();
    if (typeof renderCutGraph === 'function') renderCutGraph(); // designedGrid: เส้นตัด/ช่อง (ยังไม่มี fill mesh จริง รอข้อ 5-6)
}
['designedGrid', 'plainGrid', 'landPlotImage'].forEach(key => {
    document.getElementById(`chk-layer-${key}`)?.addEventListener('change', (e) => {
        const floor = parametric.floorManager.getActiveFloor();
        if (!floor) return;
        floor.layerVisibility[key] = e.target.checked;
        applyFloorLayerVisibility();
        parametric.buildingModel.events.emit(Events.FLOOR_LAYER_VISIBILITY_CHANGED, { floorId: floor.id, layerVisibility: floor.layerVisibility });
    });
});
parametric.buildingModel.events.on(Events.ACTIVE_FLOOR_CHANGED, applyFloorLayerVisibility);
// เรียกจริงหลัง landPlotOverlay ถูกสร้าง (ดู syncLandPlotOverlayToActiveFloor ด้านล่าง) กัน ReferenceError

document.getElementById('btn-add-floor')?.addEventListener('click', () => {
    const floorCount = parametric.floorManager.listFloors().length;
    const input = window.prompt(t('floors.promptHeight'), '3.0');
    if (input === null) return; // ผู้ใช้กดยกเลิก
    const height = parseFloat(input);
    if (!(height > 0)) { alert(t('floors.alertInvalidHeight')); return; }
    const floor = parametric.floorManager.addFloor({ name: `ชั้น ${floorCount + 1}`, height });
    parametric.floorManager.setActiveFloor(floor.id);
    refreshFloorSwitcher();
    updateStatusBar();
});

// --- GRID FOLLOWS ACTIVE FLOOR (spec §15) ---
// gridHelper was static at y=0; move it to the active floor's elevation
// whenever the active floor changes, so the ground grid actually matches
// the floor the user is building on.
function syncGridToActiveFloor() {
    const floor = parametric.floorManager.getActiveFloor();
    if (floor) gridHelper.position.y = floor.elevation;
}
parametric.buildingModel.events.on(Events.ACTIVE_FLOOR_CHANGED, syncGridToActiveFloor);
syncGridToActiveFloor();

// --- LAND PLOT IMAGE OVERLAY (handoff ข้อ 2+3) ---
// หนึ่ง overlay instance ต่อการแสดงผล สลับข้อมูลตามชั้นที่ active อยู่
// (ข้อมูลจริงเก็บแยกต่อชั้นใน Floor.landPlotImage อยู่แล้ว)
const landPlotOverlay = new LandPlotOverlay(scene);
let landPlotGrid = null;
let landPlotEditing = false;

const landPlotTransformControl = new TransformControls(camera, renderer.domElement);
landPlotTransformControl.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });
landPlotTransformControl.addEventListener('objectChange', () => {
    landPlotOverlay.lockScaleY();
    persistLandPlotImage();
    rebuildLandPlotGrid();
});
scene.add(landPlotTransformControl);
landPlotTransformControl.visible = false;
landPlotTransformControl.enabled = false;

// จำกัดแกนของ gizmo ตามโหมด: ย้าย/ขนาด เฉพาะ X-Z (ล็อค Y), หมุนเฉพาะรอบแกน Y (ล็อค X-Z)
function applyLandPlotGizmoAxisLock(mode) {
    if (mode === 'rotate') {
        landPlotTransformControl.showX = false;
        landPlotTransformControl.showZ = false;
        landPlotTransformControl.showY = true;
    } else {
        landPlotTransformControl.showX = true;
        landPlotTransformControl.showZ = true;
        landPlotTransformControl.showY = false;
    }
}
landPlotTransformControl.setMode('translate');
applyLandPlotGizmoAxisLock('translate');

function persistLandPlotImage() {
    const floor = parametric.floorManager.getActiveFloor();
    if (floor) floor.landPlotImage = landPlotOverlay.toData();
}

// ตารางที่ครอบตามขอบเขตจริงของภาพ (ข้อ 3) — rebuild ทุกครั้งที่ภาพขยับ/ย่อ/ขยาย
function rebuildLandPlotGrid() {
    if (landPlotGrid) {
        scene.remove(landPlotGrid);
        landPlotGrid.geometry.dispose();
        landPlotGrid.material.dispose();
        landPlotGrid = null;
    }
    const showOverlayGrid = document.getElementById('setting-landplot-grid')?.checked;
    if (!showOverlayGrid || !landPlotOverlay.group.visible) return;
    const box = landPlotOverlay.getWorldBounds();
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return;
    const width = Math.max(0.01, box.max.x - box.min.x);
    const depth = Math.max(0.01, box.max.z - box.min.z);
    const divisions = Math.max(1, Math.round(parseFloat(document.getElementById('inp-grid-divisions')?.value) || 20));
    landPlotGrid = buildCustomGrid(width, depth, divisions, themeScene().plotCenter, themeScene().plotGrid);
    landPlotGrid.position.set((box.min.x + box.max.x) / 2, box.min.y + 0.0015, (box.min.z + box.max.z) / 2);
    scene.add(landPlotGrid);
}

function setLandPlotEditing(on) {
    landPlotEditing = on && !!landPlotOverlay.dataUrl;
    if (landPlotEditing) {
        landPlotTransformControl.attach(landPlotOverlay.group);
        landPlotTransformControl.visible = true;
        landPlotTransformControl.enabled = true;
    } else {
        landPlotTransformControl.detach();
        landPlotTransformControl.visible = false;
        landPlotTransformControl.enabled = false;
    }
    const btn = document.getElementById('btn-landplot-edit');
    if (btn) btn.classList.toggle('active', landPlotEditing);
    const modeRow = document.getElementById('landplot-edit-modes');
    if (modeRow) modeRow.style.display = landPlotEditing ? 'flex' : 'none';
}

function refreshLandPlotUI() {
    const floor = parametric.floorManager.getActiveFloor();
    const data = floor?.landPlotImage;
    const hasImage = !!data;
    const chkVisible = document.getElementById('setting-landplot-visible');
    const chkGrid = document.getElementById('setting-landplot-grid');
    const opacityInput = document.getElementById('inp-landplot-opacity');
    if (chkVisible) chkVisible.checked = data ? data.visible !== false : true;
    if (opacityInput) opacityInput.value = data?.opacity ?? 0.75;
    const widthInput = document.getElementById('inp-landplot-width');
    const depthInput = document.getElementById('inp-landplot-depth');
    if (widthInput) widthInput.value = data?.scale?.x ? data.scale.x.toFixed(2) : '';
    if (depthInput) depthInput.value = data?.scale?.z ? data.scale.z.toFixed(2) : '';
    document.getElementById('btn-landplot-edit')?.toggleAttribute('disabled', !hasImage);
    document.getElementById('btn-landplot-remove')?.toggleAttribute('disabled', !hasImage);
    const hintEmpty = document.getElementById('landplot-hint-empty');
    const hintLoaded = document.getElementById('landplot-hint-loaded');
    if (hintEmpty) hintEmpty.style.display = hasImage ? 'none' : 'block';
    if (hintLoaded) hintLoaded.style.display = hasImage ? 'block' : 'none';
    void chkGrid;
}

// สลับข้อมูล overlay ให้ตรงกับชั้นที่กำลัง active อยู่ (ทุกชั้นแยกภาพ/ตำแหน่งกันเอง)
function syncLandPlotOverlayToActiveFloor() {
    setLandPlotEditing(false);
    const floor = parametric.floorManager.getActiveFloor();
    landPlotOverlay.applyData(floor?.landPlotImage || null);
    if (floor) landPlotOverlay.setElevation(floor.elevation);
    rebuildLandPlotGrid();
    refreshLandPlotUI();
}
parametric.buildingModel.events.on(Events.ACTIVE_FLOOR_CHANGED, syncLandPlotOverlayToActiveFloor);
syncLandPlotOverlayToActiveFloor();

document.getElementById('inp-land-plot-image')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
        await landPlotOverlay.loadFromFile(file);
        landPlotOverlay.setElevation(parametric.floorManager.getActiveFloor()?.elevation ?? 0);
        persistLandPlotImage();
        rebuildLandPlotGrid();
        refreshLandPlotUI();
    } catch (err) {
        alert(t('landplot.alertUploadFail', { msg: tData(err.message) }));
    }
});

document.getElementById('setting-landplot-visible')?.addEventListener('change', (e) => {
    landPlotOverlay.setVisible(e.target.checked);
    persistLandPlotImage();
    rebuildLandPlotGrid();
});

document.getElementById('setting-landplot-grid')?.addEventListener('change', rebuildLandPlotGrid);

function applyLandPlotSizeInputs() {
    if (!landPlotOverlay.dataUrl) return;
    const w = parseFloat(document.getElementById('inp-landplot-width')?.value);
    const d = parseFloat(document.getElementById('inp-landplot-depth')?.value);
    if (w > 0) landPlotOverlay.group.scale.x = w;
    if (d > 0) landPlotOverlay.group.scale.z = d;
    landPlotOverlay.lockScaleY();
    persistLandPlotImage();
    rebuildLandPlotGrid();
}
document.getElementById('inp-landplot-width')?.addEventListener('change', applyLandPlotSizeInputs);
document.getElementById('inp-landplot-depth')?.addEventListener('change', applyLandPlotSizeInputs);

document.getElementById('inp-landplot-opacity')?.addEventListener('input', (e) => {
    landPlotOverlay.setOpacity(parseFloat(e.target.value));
    persistLandPlotImage();
});

document.getElementById('btn-landplot-edit')?.addEventListener('click', () => setLandPlotEditing(!landPlotEditing));

document.querySelectorAll('#landplot-edit-modes [data-landplot-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
        const mode = btn.dataset.landplotMode;
        landPlotTransformControl.setMode(mode);
        applyLandPlotGizmoAxisLock(mode);
        document.querySelectorAll('#landplot-edit-modes [data-landplot-mode]').forEach(b => b.classList.toggle('active', b === btn));
    });
});

document.getElementById('btn-landplot-remove')?.addEventListener('click', () => {
    if (!confirm(t('landplot.confirmRemove'))) return;
    setLandPlotEditing(false);
    const floor = parametric.floorManager.getActiveFloor();
    if (floor) floor.landPlotImage = null;
    landPlotOverlay.applyData(null);
    rebuildLandPlotGrid();
    refreshLandPlotUI();
});

// --- CUT-GRAPH TOOL (handoff ข้อ 4) ---
// กราฟตัดแบ่งช่อง ต่อชั้น: เริ่มจากรูปสี่เหลี่ยม (ขอบเขตภาพเขตที่ดินถ้ามี ไม่งั้นขอบเขตกริดทั่วไป)
// แล้วผู้ใช้ลากเส้นตัดผ่านได้ไม่จำกัดจำนวนครั้ง ทุกเส้นจะ snap เข้าโหนด/เส้นเดิมให้อัตโนมัติ
const cutGraph = new CutGraph();
const cutGraphRenderer = new CutGraphRenderer(scene);
let cutToolActive = false;
// ข้อ 5 (handoff): id ของช่อง (FaceDetector face.id) ที่ถูก Extrude ไปแล้ว ต่อชั้นที่ active อยู่
let extrudedFaceIds = new Set();

function getFloorBoundsForCut() {
    if (landPlotOverlay.group.visible && landPlotOverlay.dataUrl) {
        const box = landPlotOverlay.getWorldBounds();
        if (isFinite(box.min.x) && isFinite(box.max.x)) {
            return { minX: box.min.x, minZ: box.min.z, maxX: box.max.x, maxZ: box.max.z };
        }
    }
    const w = parseFloat(document.getElementById('inp-grid-width')?.value) || 20;
    const l = parseFloat(document.getElementById('inp-grid-length')?.value) || 20;
    return { minX: -w / 2, minZ: -l / 2, maxX: w / 2, maxZ: l / 2 };
}

function persistCutGraph() {
    const floor = parametric.floorManager.getActiveFloor();
    if (floor) {
        floor.cutGraph = cutGraph.toJSON();
        floor.extrudedFaceIds = [...extrudedFaceIds];
    }
}

function renderCutGraph() {
    const floor = parametric.floorManager.getActiveFloor();
    const elevation = floor?.elevation ?? 0;
    const faces = cutGraphRenderer.render(cutGraph, elevation, extrudedFaceIds);
    cutGraphRenderer.setVisible(floor ? floor.layerVisibility.designedGrid : true);
    const el = document.getElementById('cut-face-count');
    const pickableCount = faces.filter(f => !extrudedFaceIds.has(f.id)).length;
    if (el) {
        el.textContent = cutGraph.isEmpty()
            ? t('tools.cut.faceCount.none')
            : t('tools.cut.faceCount.n', { total: faces.length, remaining: pickableCount });
    }
    hoveredFaceId = null; // render สร้าง mesh ใหม่ทุกครั้ง อ้างอิงของเก่าใช้ไม่ได้แล้ว
    return faces;
}

function deactivateCutTool() {
    cutToolActive = false;
    cutTool?.deactivate();
    orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    document.getElementById('btn-cut-tool')?.classList.remove('active');
}

// ข้อ 5 (handoff): "โหมดเลือกช่อง Extrude" — เอาเมาส์ชี้เหนือช่องที่ตัดไว้ในฉาก (ยังไม่เคย Extrude)
// จะไฮไลต์สีเขียวฟ้าอ่อนให้เห็นก่อนคลิก แทนที่การกดปุ่มเดียวแล้ว Extrude ทุกช่องพร้อมกัน
// (พฤติกรรมเดิมที่ผู้ใช้ไม่ต้องการ) ผู้ใช้คลิกช่องที่ต้องการทีละช่อง แล้วเฉพาะช่องนั้นถูกขึ้นรูปเป็น
// ชิ้นงาน 3 มิติจริง — เส้นตัด/ไฮไลต์ของช่องนั้นจะหายไปหลังขึ้นรูปเสร็จ (ดู pruneFullyExtrudedEdges)
let extrudePickActive = false;
let hoveredFaceId = null;
const extrudeRaycaster = new THREE.Raycaster();

function activateExtrudePickMode() {
    extrudePickActive = true;
    orbit.enabled = true;
    orbit.mouseButtons.LEFT = null; // ปุ่มซ้ายไว้คลิกเลือกช่อง ไม่ใช่หมุนกล้อง
    document.getElementById('btn-extrude-pick-mode')?.classList.add('active');
}

function deactivateExtrudePickMode() {
    extrudePickActive = false;
    orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    if (hoveredFaceId) { cutGraphRenderer.setFaceHighlight(hoveredFaceId, false); hoveredFaceId = null; }
    document.getElementById('btn-extrude-pick-mode')?.classList.remove('active');
}

const cutTool = new CutTool({
    scene, camera, domElement: renderer.domElement,
    getActiveFloor: () => parametric.floorManager.getActiveFloor(),
    getCutGraph: () => cutGraph,
    onCutAdded: () => { persistCutGraph(); renderCutGraph(); },
});

// สลับกราฟตัดให้ตรงกับชั้นที่ active — ชั้นใหม่ที่ยังไม่เคยตัดจะได้ขอบเขตสี่เหลี่ยมเปล่าอัตโนมัติ
function syncCutGraphToActiveFloor() {
    deactivateCutTool();
    deactivateExtrudePickMode();
    const floor = parametric.floorManager.getActiveFloor();
    if (floor?.cutGraph && floor.cutGraph.edges?.length) {
        const loaded = CutGraph.fromJSON(floor.cutGraph);
        // ตัดเส้น "boundary" (เส้นขอบเขตสี่เหลี่ยมที่เคยสร้างอัตโนมัติ) ทิ้งเสมอ แม้จะเป็นข้อมูลเก่า
        // ที่บันทึกไว้ตั้งแต่ก่อนแก้ก็ตาม — ผู้ใช้ระบุชัดว่าไม่ต้องการเส้นนี้เลยจนกว่าจะวาดเอง
        // เหลือไว้เฉพาะเส้นที่ผู้ใช้ลากตัดเองจริง (boundary === false)
        for (const [id, e] of [...loaded.edges]) {
            if (e.boundary) loaded.edges.delete(id);
        }
        // ลบโหนดกำพร้าที่ไม่มีเส้นเหลืออ้างอิงแล้ว (เช่น มุมสี่เหลี่ยมเดิมที่ถูกตัดออกไปแล้ว)
        const usedNodeIds = new Set();
        loaded.edges.forEach(e => { usedNodeIds.add(e.aId); usedNodeIds.add(e.bId); });
        for (const [id] of [...loaded.nodes]) {
            if (!usedNodeIds.has(id)) loaded.nodes.delete(id);
        }
        cutGraph.nodes = loaded.nodes;
        cutGraph.edges = loaded.edges;
    } else {
        // ไม่สร้างเส้นขอบเขตสี่เหลี่ยมอัตโนมัติอีกต่อไป — ผู้ใช้ระบุว่าไม่ต้องการเส้นที่ผุดขึ้นเอง
        // ปล่อยกราฟว่างไว้จนกว่าผู้ใช้จะวาดเส้นตัดเองเป็นครั้งแรก (ดู CutTool.onPointerUp -> addLine)
        cutGraph.clear();
    }
    extrudedFaceIds = new Set(floor?.extrudedFaceIds || []);
    persistCutGraph();
    renderCutGraph();
}
parametric.buildingModel.events.on(Events.ACTIVE_FLOOR_CHANGED, syncCutGraphToActiveFloor);
syncCutGraphToActiveFloor();
applyFloorLayerVisibility(); // เรียกครั้งแรกตอนนี้ ตอน cutGraphRenderer พร้อมใช้แล้ว

document.getElementById('btn-cut-tool')?.addEventListener('click', (e) => {
    const turningOn = !cutToolActive;
    deactivateAllParametricTools(); // กันชนกับเครื่องมือวาดผนัง/ประตู/หน้าต่าง
    deactivateCutTool();
    deactivateExtrudePickMode(); // กันชนกับโหมดเลือกช่อง Extrude
    if (turningOn) {
        cutToolActive = true;
        orbit.enabled = true;
        orbit.mouseButtons.LEFT = null; // ปุ่มซ้ายลากเส้นตัด แทนที่จะหมุนกล้อง
        cutTool.activate();
        e.target.classList.add('active');
    }
});

window.addEventListener('mousedown', (e) => {
    if (!cutToolActive || isUiTarget(e) || e.button !== 0) return;
    cutTool.onPointerDown(e.clientX, e.clientY);
});
window.addEventListener('mousemove', (e) => {
    if (!cutToolActive || !cutTool.startPoint) return;
    cutTool.onPointerMove(e.clientX, e.clientY);
});
window.addEventListener('mouseup', (e) => {
    if (!cutToolActive || isUiTarget(e) || e.button !== 0 || !cutTool.startPoint) return;
    cutTool.onPointerUp(e.clientX, e.clientY);
});

document.getElementById('btn-cut-undo')?.addEventListener('click', () => {
    cutGraph.removeLastCut();
    persistCutGraph();
    renderCutGraph();
});

document.getElementById('btn-cut-reset')?.addEventListener('click', () => {
    if (!confirm(t('cut.confirmReset'))) return;
    const b = getFloorBoundsForCut();
    cutGraph.setBoundaryRect(b.minX, b.minZ, b.maxX, b.maxZ);
    extrudedFaceIds = new Set(); // ล้างเส้นแล้ว ช่องเก่าไม่มีอยู่จริงอีกต่อไป เริ่มนับใหม่
    persistCutGraph();
    renderCutGraph();
});

document.getElementById('btn-extrude-pick-mode')?.addEventListener('click', (e) => {
    const turningOn = !extrudePickActive;
    deactivateAllParametricTools();
    deactivateCutTool();
    deactivateExtrudePickMode();
    if (turningOn) activateExtrudePickMode();
});

function _extrudeFaceMeshAtPointer(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    extrudeRaycaster.setFromCamera(ndc, camera);
    const hits = extrudeRaycaster.intersectObjects(cutGraphRenderer.getFaceMeshObjects(), false);
    return hits.length ? hits[0].object : null;
}

window.addEventListener('mousemove', (e) => {
    if (!extrudePickActive || isUiTarget(e)) return;
    const hitMesh = _extrudeFaceMeshAtPointer(e.clientX, e.clientY);
    const newId = hitMesh?.userData.cutFaceId ?? null;
    if (newId === hoveredFaceId) return;
    if (hoveredFaceId) cutGraphRenderer.setFaceHighlight(hoveredFaceId, false);
    hoveredFaceId = newId;
    if (hoveredFaceId) cutGraphRenderer.setFaceHighlight(hoveredFaceId, true);
});

window.addEventListener('click', (e) => {
    if (!extrudePickActive || isUiTarget(e) || e.button !== 0) return;
    const hitMesh = _extrudeFaceMeshAtPointer(e.clientX, e.clientY);
    if (!hitMesh) return;
    const faceId = hitMesh.userData.cutFaceId;
    const face = cutGraphRenderer.findFaceById(faceId);
    if (!face) return;
    extrudeSingleFace(face);
});

// ตัดเส้น/ขอบที่ไม่จำเป็นแล้วออกจากกราฟ: เส้นขอบช่องใดที่ทุกช่อง (1 หรือ 2 ด้าน) ที่ใช้เส้นนั้น
// ถูก Extrude ไปหมดแล้ว ถือว่าเส้นนั้น "หมดหน้าที่" ให้ลบทิ้งไปด้วย เพื่อให้เส้นเหลืองหายไปจริง
// ตามที่ผู้ใช้ต้องการ ("หลัง Extrude เส้นนั้นก็จะหายไป") — เส้นที่ยังเป็นขอบของช่องที่ยังไม่ได้ Extrude
// อีกด้านหนึ่งจะยังคงอยู่ตามปกติ
function pruneFullyExtrudedEdges() {
    const allFaces = cutGraphRenderer.detector.detectFaces(cutGraph);
    const edgeFaceIds = new Map(); // edgeId -> [faceId, ...]
    allFaces.forEach(f => f.edgeIds.forEach(eid => {
        if (!edgeFaceIds.has(eid)) edgeFaceIds.set(eid, []);
        edgeFaceIds.get(eid).push(f.id);
    }));
    const toRemove = [];
    cutGraph.edges.forEach(e => {
        const faceIds = edgeFaceIds.get(e.id);
        if (!faceIds || !faceIds.length) return; // เส้นลอยไม่ได้เป็นขอบช่องไหนเลย ไม่ยุ่ง
        if (faceIds.every(fid => extrudedFaceIds.has(fid))) toRemove.push(e.id);
    });
    toRemove.forEach(id => cutGraph.removeEdge(id));
}

function extrudeSingleFace(face) {
    const floor = parametric.floorManager.getActiveFloor();
    const elevation = floor?.elevation ?? 0;
    const height = Math.max(parseFloat(document.getElementById('inp-extrude-height')?.value) || 2.5, 0.01);
    const matId = getSelectedMaterialId();

    const mesh = makeExtrudeMesh(face.points, height, matId, null);
    mesh.position.y = elevation;
    mesh.userData.extrudeBaseElevation = elevation;
    addMesh(mesh, `ชิ้นงานจากช่องตัด`);

    extrudedFaceIds.add(face.id);
    if (hoveredFaceId === face.id) hoveredFaceId = null;
    pruneFullyExtrudedEdges();
    persistCutGraph();
    renderCutGraph();
}

// ข้อ 4b: ชิ้นงาน Extrude ใช้ ExtrudeGeometry ไม่ใช่ BoxGeometry ธรรมดา ดังนั้น serializeObject/
// buildFromData (ใช้โดย undo/redo, duplicate, copy-paste, save/load โปรเจค) ต้องรู้จักรูปแบบนี้
// เป็นพิเศษ — เก็บ facePoints/height ไว้ใน userData เพื่อ rebuild ใหม่ได้เป๊ะ แทนที่จะพยายามอ่าน
// .geometry.parameters.width/height/depth ที่ ExtrudeGeometry ไม่มี (สาเหตุที่ undo เคยเพี้ยนมาก่อน)
function makeExtrudeMesh(facePoints, height, materialId, colorHex) {
    const matId = MATERIALS[materialId] ? materialId : DEFAULT_MATERIAL;
    const shapePoints = facePoints.map(p => new THREE.Vector2(p.x, -p.z));
    const shape = new THREE.Shape(shapePoints);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const mat = buildStandardMaterial(matId, { side: THREE.DoubleSide, color: colorHex ?? undefined });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.material = matId;
    mesh.userData.isCutExtrusion = true;
    mesh.userData.extrudeFacePoints = facePoints.map(p => ({ x: p.x, z: p.z }));
    mesh.userData.extrudeHeight = height;
    mesh.userData.id = generateId('obj');
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

let objects = [];           
let selectedObject = null;  
let outlineHelper = null;

// Push the current theme's palette into the WebGL scene (CSS can't reach it).
function applySceneTheme() {
    const th = themeScene();
    scene.background = new THREE.Color(th.bg);
    recolorGrid(gridHelper, th.gridCenter, th.grid);
    if (landPlotGrid) recolorGrid(landPlotGrid, th.plotCenter, th.plotGrid);
    if (outlineHelper) outlineHelper.material.color.setHex(th.outline);
    cutGraphRenderer.setLineColor(th.cut);
}
sceneThemeReady = true;
applySceneTheme();
let multiSelected = new Set(); // ชิ้นงานที่ติ๊ก ☑ ไว้ในลิสต์ (สำหรับปุ่ม "รวมกลุ่มที่ติ๊ก")
let dragSourceObj = null;      // ชิ้นงานที่กำลังลากอยู่ (drag & drop ในลิสต์เลเยอร์)
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// --- 5. DIMENSION LABELS ---
const dimLabels = {
    x: createDimensionInput('x'),
    y: createDimensionInput('y'),
    z: createDimensionInput('z')
};

// ประตู/หน้าต่างเป็นเมชแยกจากผนัง วางตามพิกัดในโมเดล — เมื่อผู้ใช้ขยับ/หมุน/สเกลผนัง
// (หรือกลุ่มที่มีผนัง) ที่ตัวเมช ต้องพาช่องเจาะไปด้วย:
//   openingMatrix = wallWorld * inverse(wallBase) * openingBase
const _wallDelta = new THREE.Matrix4();
const _openingWorld = new THREE.Matrix4();
function syncOpeningsToWallMeshes() {
    if (typeof parametric === 'undefined') return;
    const meshes = parametric.openingRenderer.meshesByOpeningId;
    objects.forEach(root => root.traverse(wm => {
        const wallId = wm.userData?.parametricWallId;
        if (!wallId || !wm.userData.baseMatrix) return;
        wm.updateWorldMatrix(true, false);
        _wallDelta.copy(wm.userData.baseMatrix).invert().premultiply(wm.matrixWorld);
        parametric.buildingModel.getOpeningsForWall(wallId).forEach(o => {
            const om = meshes.get(o.id);
            if (!om || !om.userData.baseMatrix) return;
            _openingWorld.multiplyMatrices(_wallDelta, om.userData.baseMatrix);
            if (om.parent) om.parent.updateWorldMatrix(true, false);
            _openingWorld.decompose(om.position, om.quaternion, om.scale);
            om.updateMatrix();
            om.updateMatrixWorld(true);
        });
    }));
}
transformControl.addEventListener('objectChange', syncOpeningsToWallMeshes);
transformControl.addEventListener('change', syncOpeningsToWallMeshes);

transformControl.addEventListener('change', () => {
    if (!selectedObject) return;
    updatePosInputsFromObject();
    updateDimensionLabels();
    updateRealtimeCalc();
});

function createDimensionInput(axis) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.1';
    input.className = `dimension-input label-${axis}`;
    input.addEventListener('change', () => {
        if (!selectedObject) return;
        const newSize = parseFloat(input.value);
        if (!isNaN(newSize) && newSize > 0) {
            pushUndo();
            resizeObject(selectedObject, axis, newSize);
        }
    });
    ['pointerdown', 'mousedown', 'keydown'].forEach(evt => input.addEventListener(evt, e => e.stopPropagation()));

    const obj = new CSS2DObject(input);
    obj.visible = false;
    scene.add(obj);
    return { dom: input, obj: obj };
}

// --- STATUS BAR — reads only real, already-existing state; no fake values ---
function updateStatusBar() {
    const elFloor = document.getElementById('status-floor');
    const elObjects = document.getElementById('status-objects');
    const elSelected = document.getElementById('status-selected');
    const elPos = document.getElementById('status-pos');
    if (!elFloor || !elObjects) return;

    try {
        const floor = parametric?.floorManager?.getActiveFloor?.();
        elFloor.textContent = floor ? `${t('statusbar.floor')}: ${tData(floor.name)}` : '';
        const badge = document.getElementById('viewport-floor-badge');
        if (badge) badge.textContent = floor ? tData(floor.name) : '';
    } catch (e) { elFloor.textContent = ''; }

    elObjects.textContent = `${t('statusbar.objects')}: ${objects.length}`;

    if (selectedObject) {
        elSelected.textContent = selectedObject.userData?.name || t('statusbar.selected');
        elPos.textContent = `X ${selectedObject.position.x.toFixed(2)}  Y ${selectedObject.position.y.toFixed(2)}  Z ${selectedObject.position.z.toFixed(2)}`;
    } else {
        elSelected.textContent = '';
        elPos.textContent = '';
    }
}

function updateDimensionLabels() {
    updateStatusBar();
    if (!selectedObject || !selectedObject.visible) {
        Object.values(dimLabels).forEach(l => l.obj.visible = false);
        return;
    }
    const box = new THREE.Box3().setFromObject(selectedObject);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    if (document.activeElement !== dimLabels.x.dom) dimLabels.x.dom.value = size.x.toFixed(2);
    if (document.activeElement !== dimLabels.y.dom) dimLabels.y.dom.value = size.y.toFixed(2);
    if (document.activeElement !== dimLabels.z.dom) dimLabels.z.dom.value = size.z.toFixed(2);

    dimLabels.x.obj.position.set(center.x, center.y - size.y / 2 - 0.4, center.z + size.z / 2);
    dimLabels.y.obj.position.set(center.x + size.x / 2 + 0.4, center.y, center.z + size.z / 2);
    dimLabels.z.obj.position.set(center.x - size.x / 2, center.y - size.y / 2 - 0.4, center.z);
    Object.values(dimLabels).forEach(l => l.obj.visible = true);
}

function resizeObject(obj, axis, targetSize) {
    const box = new THREE.Box3().setFromObject(obj);
    const currentSize = new THREE.Vector3();
    box.getSize(currentSize);
    if (axis === 'x' && currentSize.x > 0) obj.scale.x *= (targetSize / currentSize.x);
    if (axis === 'y' && currentSize.y > 0) obj.scale.y *= (targetSize / currentSize.y);
    if (axis === 'z' && currentSize.z > 0) obj.scale.z *= (targetSize / currentSize.z);
    syncOpeningsToWallMeshes();
    updateDimensionLabels();
    updateRealtimeCalc();
}

function makeBoxMesh(w, h, d, colorHex, name, materialId = DEFAULT_MATERIAL) {
    const matId = MATERIALS[materialId] ? materialId : DEFAULT_MATERIAL;
    // เปลี่ยนจาก MeshLambertMaterial เป็น MeshStandardMaterial (ผ่าน buildStandardMaterial) —
    // Lambert ไม่รองรับ normalMap/roughnessMap ที่ระบบ texture (ข้อ 6) ต้องใช้
    // แก้บั๊ก: กล่องนี้ (ปุ่ม "เพิ่มผนัง" แบบชิ้นเดียว) เดิมใช้ UV เริ่มต้นของ BoxGeometry
    // ซึ่งยืด/บีบลาย texture ให้ไม่เป็นสัดส่วนบนหน้าที่ยาว (เช่นด้านยาว 3 ม. เทียบกับความหนา
    // 0.2 ม.) — ใช้ตัวช่วยเดียวกับผนังพาราเมตริกเพื่อให้ 1 หน่วย UV = 1 เมตรจริงทุกหน้า
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVsToRealSize(geo, w, h, d);
    const mesh = new THREE.Mesh(
        geo,
        buildStandardMaterial(matId, { color: colorHex ?? undefined }),
    );
    mesh.userData.name = name || `Structure ${objects.length + 1}`;
    mesh.userData.material = matId;
    mesh.userData.id = generateId('obj');
    return mesh;
}

// เปลี่ยนวัสดุของชิ้นงาน/กลุ่ม แล้วสร้าง material ใหม่ตามวัสดุนั้น (รวม texture ถ้ามีตั้งค่าไว้)
function applyMaterialTo(obj, matId) {
    if (!MATERIALS[matId]) return;
    const recolor = (mesh) => {
        mesh.userData.material = matId;
        if (mesh.material) {
            const oldMaterial = mesh.material;
            mesh.material = buildStandardMaterial(matId, {
                side: oldMaterial.side,
                roughness: oldMaterial.roughness ?? 0.85,
                metalness: oldMaterial.metalness ?? 0.05,
            });
            oldMaterial.dispose();
        }
    };
    if (obj.isGroup) obj.traverse(o => { if (o.isMesh) recolor(o); });
    else if (obj.isMesh) recolor(obj);
}

// วัสดุที่เลือกไว้บนแท็บ "วัสดุผนัง" (สำหรับสร้างชิ้นใหม่)
let selectedNewMaterial = DEFAULT_MATERIAL;
function getSelectedMaterialId() {
    return MATERIALS[selectedNewMaterial] ? selectedNewMaterial : DEFAULT_MATERIAL;
}

// สร้างแท็บเลือกวัสดุแบบปุ่ม (ใช้ทั้งตอนสร้างชิ้นใหม่ และตอนเปลี่ยนวัสดุชิ้นที่เลือกอยู่)
function renderMaterialTabs(containerId, activeId, onSelect) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    Object.keys(MATERIALS).forEach(id => {
        const mat = MATERIALS[id];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'material-tab' + (id === activeId ? ' active' : '');
        btn.addEventListener('click', () => onSelect(id));

        // ไอคอนหน้าชื่อ = สี่เหลี่ยมสีเดียวกับที่ใช้จริงบนชิ้นงาน 3 มิติ (ช่วยจำว่าวัสดุนี้หน้าตาสีอะไร)
        const swatch = document.createElement('span');
        swatch.className = 'material-swatch';
        swatch.style.background = '#' + mat.color.toString(16).padStart(6, '0');

        const label = document.createElement('span');
        label.textContent = tData(mat.label);

        btn.appendChild(swatch);
        btn.appendChild(label);
        el.appendChild(btn);
    });
}

function refreshNewMaterialTabs() {
    renderMaterialTabs('material-tabs', selectedNewMaterial, (id) => {
        selectedNewMaterial = id;
        refreshNewMaterialTabs();
    });
}

// --- ข้อ 6: TEXTURE MANAGER UI — เพิ่ม/ตั้งค่า texture (diff/disp/nor_gl/rough) ต่อวัสดุ ---
const TEX_SLOTS = [
    { key: 'diff', get label() { return t('texture.slot.diff'); }, accept: '.png,.jpg,.jpeg,.webp,.exr' },
    { key: 'disp', get label() { return t('texture.slot.disp'); }, accept: '.png,.jpg,.jpeg,.webp,.exr' },
    { key: 'nor_gl', get label() { return t('texture.slot.nor_gl'); }, accept: '.exr,.png,.jpg,.jpeg' },
    { key: 'rough', get label() { return t('texture.slot.rough'); }, accept: '.exr,.png,.jpg,.jpeg' },
];
let openTextureMatId = null; // แถวที่กางอยู่ตอนนี้ (กางได้ทีละแถว)

function openTextureModal() {
    refreshMaterialsRegistry();
    renderTextureManager();
    document.getElementById('texture-modal')?.classList.add('open');
}
function closeTextureModal() {
    document.getElementById('texture-modal')?.classList.remove('open');
}
document.getElementById('btn-manage-textures')?.addEventListener('click', openTextureModal);
document.getElementById('texture-modal-close')?.addEventListener('click', closeTextureModal);
document.getElementById('texture-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'texture-modal') closeTextureModal(); // คลิกพื้นหลังนอกการ์ดเพื่อปิด
});

/** เมื่อ texture ของวัสดุเปลี่ยน (อัปโหลด/ล้าง) ต้องรีเฟรช material ของทุกชิ้นงานที่ใช้วัสดุนั้นอยู่แล้วในฉาก
 * (ไม่งั้นจะเห็นผลเฉพาะชิ้นงานที่สร้างใหม่หลังจากนี้) รวมถึงผนังพาราเมตริกที่ขึ้นรูปผ่าน GeometryFactory ด้วย */
function reapplyTexturesForMaterial(matId) {
    objects.forEach(obj => {
        obj.traverse?.((o) => {
            if (o.isMesh && o.userData.material === matId) applyTexturesToMaterial(o.material, matId);
        });
        if (obj.isMesh && obj.userData.material === matId) applyTexturesToMaterial(obj.material, matId);
    });
    // ผนังพาราเมตริก: rebuild material ใหม่ทั้งชิ้นให้ตรงกับ id (ผ่าน GeometryFactory ในครั้งถัดไปที่ re-render;
    // ที่นี่ขอแค่ apply บน material ปัจจุบันพอ เพราะ mesh เดียวกันถูกใช้ซ้ำใน objects อยู่แล้วผ่าน userData.parametricWallId)
}

function renderTextureManager() {
    const el = document.getElementById('texture-material-list');
    if (!el) return;
    el.innerHTML = '';
    Object.keys(MATERIALS).forEach(id => {
        const mat = MATERIALS[id];
        const tex = getMaterialTextures(id) || {};
        const configuredCount = TEX_SLOTS.filter(s => tex[s.key]).length;

        const row = document.createElement('div');
        row.className = 'tex-mat-row';

        const head = document.createElement('div');
        head.className = 'tex-mat-row-head';
        const title = document.createElement('div');
        title.className = 'tex-mat-row-title';
        const swatch = document.createElement('span');
        swatch.className = 'material-swatch';
        swatch.style.background = '#' + mat.color.toString(16).padStart(6, '0');
        const label = document.createElement('span');
        label.textContent = tData(mat.label) + (mat.isCustom ? t('texture.customSuffix') : '');
        title.appendChild(swatch);
        title.appendChild(label);
        const status = document.createElement('span');
        status.className = 'tex-mat-row-status';
        status.textContent = configuredCount > 0 ? t('texture.status.configured', { n: configuredCount }) : t('texture.status.none');
        head.appendChild(title);
        head.appendChild(status);
        row.appendChild(head);

        const body = document.createElement('div');
        body.className = 'tex-mat-body' + (openTextureMatId === id ? ' open' : '');

        TEX_SLOTS.forEach(slot => {
            const wrap = document.createElement('div');
            wrap.className = 'tex-slot';
            const lbl = document.createElement('label');
            lbl.textContent = slot.label + (tex[slot.key] ? ' ✓' : '');
            const slotRow = document.createElement('div');
            slotRow.className = 'tex-slot-row';
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = slot.accept;
            input.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                try {
                    const dataUrl = await fileToDataURL(file);
                    // ให้ผู้ใช้เลือกพื้นที่ของภาพที่จะใช้ก่อนบันทึก (ลากมุมทั้ง 4 ของกรอบ) —
                    // ข้ามขั้นตอนนี้ให้ไฟล์ .exr เพราะ canvas ถอดรหัสไม่ได้ (ข้อมูล float ดิบ)
                    const cropped = await openTextureCropTool(dataUrl);
                    setMaterialTextures(id, { [slot.key]: cropped ?? dataUrl });
                    reapplyTexturesForMaterial(id);
                    renderTextureManager();
                } catch (err) {
                    alert(t('texture.readFail', { msg: tData(err.message) }));
                }
            });
            slotRow.appendChild(input);
            if (tex[slot.key]) {
                if (!isLikelyExrDataUrl(tex[slot.key])) {
                    const cropBtn = document.createElement('button');
                    cropBtn.type = 'button';
                    cropBtn.className = 'tex-crop-btn';
                    cropBtn.textContent = t('texture.crop.btn');
                    cropBtn.title = t('texture.crop.btn.title');
                    cropBtn.addEventListener('click', async () => {
                        const cropped = await openTextureCropTool(tex[slot.key]);
                        if (!cropped) return; // ยกเลิก — คงค่าเดิมไว้
                        setMaterialTextures(id, { [slot.key]: cropped });
                        reapplyTexturesForMaterial(id);
                        renderTextureManager();
                    });
                    slotRow.appendChild(cropBtn);
                }
                const clearBtn = document.createElement('button');
                clearBtn.type = 'button';
                clearBtn.className = 'tex-clear-btn';
                clearBtn.textContent = t('texture.clear');
                clearBtn.addEventListener('click', () => {
                    setMaterialTextures(id, { [slot.key]: null });
                    reapplyTexturesForMaterial(id);
                    renderTextureManager();
                });
                slotRow.appendChild(clearBtn);
            }
            wrap.appendChild(lbl);
            wrap.appendChild(slotRow);
            body.appendChild(wrap);
        });

        // ขนาดลายจริง (เมตร/ผืน) + ความลึก displacement — ค่าเริ่มต้นสมเหตุสมผลสำหรับผนังทั่วไป
        // หมายเหตุ: ค่านี้คือ "ลาย 1 ผืนกว้าง/สูงกี่เมตร" ไม่ใช่จำนวนครั้งที่ซ้ำ — ระบบจะคำนวณ
        // จำนวนรอบให้เองตามขนาดจริงของผนังแต่ละด้าน ลายจึงไม่บีบ/ยืดผิดสัดส่วนไม่ว่าผนังจะยาวแค่ไหน
        const repeatRow = document.createElement('div');
        repeatRow.className = 'tex-repeat-row';
        const repeatXInput = document.createElement('input');
        repeatXInput.type = 'number'; repeatXInput.step = '0.1'; repeatXInput.min = '0.1';
        repeatXInput.value = tex.repeatX ?? 1;
        repeatXInput.title = t('texture.repeatX.title');
        const repeatYInput = document.createElement('input');
        repeatYInput.type = 'number'; repeatYInput.step = '0.1'; repeatYInput.min = '0.1';
        repeatYInput.value = tex.repeatY ?? 1;
        repeatYInput.title = t('texture.repeatY.title');
        const dispScaleInput = document.createElement('input');
        dispScaleInput.type = 'number'; dispScaleInput.step = '0.01'; dispScaleInput.min = '0';
        dispScaleInput.value = tex.dispScale ?? 0.05;
        dispScaleInput.title = t('texture.dispScale.title');
        const applyRepeat = () => {
            setMaterialTextures(id, {
                repeatX: parseFloat(repeatXInput.value) || 1,
                repeatY: parseFloat(repeatYInput.value) || 1,
                dispScale: parseFloat(dispScaleInput.value) || 0,
            });
            reapplyTexturesForMaterial(id);
        };
        repeatXInput.addEventListener('change', applyRepeat);
        repeatYInput.addEventListener('change', applyRepeat);
        dispScaleInput.addEventListener('change', applyRepeat);
        repeatRow.appendChild(document.createTextNode(t('texture.repeatX.label')));
        repeatRow.appendChild(repeatXInput);
        repeatRow.appendChild(document.createTextNode(t('texture.repeatY.label')));
        repeatRow.appendChild(repeatYInput);
        repeatRow.appendChild(document.createTextNode(t('texture.dispScale.label')));
        repeatRow.appendChild(dispScaleInput);
        body.appendChild(repeatRow);

        const actions = document.createElement('div');
        actions.className = 'tex-mat-actions';
        if (configuredCount > 0) {
            const clearAllBtn = document.createElement('button');
            clearAllBtn.type = 'button';
            clearAllBtn.className = 'calc-btn';
            clearAllBtn.style.background = 'var(--danger)';
            clearAllBtn.textContent = t('texture.clearAll');
            clearAllBtn.addEventListener('click', () => {
                clearMaterialTextures(id);
                reapplyTexturesForMaterial(id);
                renderTextureManager();
            });
            actions.appendChild(clearAllBtn);
        }
        if (mat.isCustom) {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn-danger';
            delBtn.textContent = t('texture.deleteMaterial');
            delBtn.addEventListener('click', () => {
                if (!confirm(t('texture.confirmDelete', { name: tData(mat.label) }))) return;
                removeCustomMaterial(id);
                refreshMaterialsRegistry();
                if (selectedNewMaterial === id) selectedNewMaterial = DEFAULT_MATERIAL;
                refreshNewMaterialTabs();
                if (openTextureMatId === id) openTextureMatId = null;
                renderTextureManager();
            });
            actions.appendChild(delBtn);
        }
        if (actions.children.length) body.appendChild(actions);

        head.addEventListener('click', () => {
            openTextureMatId = (openTextureMatId === id) ? null : id;
            renderTextureManager();
        });

        row.appendChild(body);
        el.appendChild(row);
    });
}

document.getElementById('btn-add-new-material')?.addEventListener('click', () => {
    const labelInput = document.getElementById('inp-new-mat-label');
    const colorInput = document.getElementById('inp-new-mat-color');
    const label = (labelInput?.value || '').trim();
    if (!label) { alert(t('texture.needName')); return; }
    const id = 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const color = parseInt((colorInput?.value || '#9a9d93').replace('#', ''), 16);
    addCustomMaterial(id, { label, color });
    refreshMaterialsRegistry();
    refreshNewMaterialTabs();
    if (labelInput) labelInput.value = '';
    openTextureMatId = id;
    renderTextureManager();
});

// --- 7. OBJECT MANAGEMENT ---
function addMesh(mesh, name) {
    pushUndo();
    if (name) mesh.userData.name = name;
    if (!mesh.userData.name) mesh.userData.name = `Structure ${objects.length + 1}`;
    scene.add(mesh);
    objects.push(mesh);
    refreshObjectList();
    selectObject(mesh);
    updateRealtimeCalc();
}

function selectObject(obj) {
    selectedObject = obj;
    updateSelectionOutline(obj);

    const propsPanel = document.getElementById('properties-panel');
    const openingPanel = document.getElementById('opening-edit-panel');
    const openingId = obj?.userData?.isParametricOpening ? obj.userData.parametricOpeningId : null;

    if (openingId) {
        // ช่องเจาะ (ประตู/หน้าต่าง) ตำแหน่งผูกกับผนังเสมอ (offset ตามแนวผนัง + sillHeight)
        // ไม่ใช้ transformControl แบบลากอิสระ เพราะจะขัดกับ one-way data flow ของ BuildingModel —
        // ใช้แผงตัวเลข offset/width/height/sillHeight แทน (ย้าย/ขยายผ่าน updateOpening)
        transformControl.detach();
        if (propsPanel) propsPanel.style.display = 'none';
        if (openingPanel) { openingPanel.classList.remove('hidden'); openingPanel.style.display = 'block'; }
        updateOpeningInputsFromSelection(openingId);
    } else if (obj) {
        selectedOpeningId = null;
        transformControl.attach(obj);
        if (typeof applyCurrentTool === 'function') applyCurrentTool();
        updateDimensionLabels();
        updatePosInputsFromObject();
        if (typeof syncMaterialDropdown === 'function') syncMaterialDropdown(obj);
        if (propsPanel) propsPanel.style.display = 'block';
        if (openingPanel) { openingPanel.classList.add('hidden'); openingPanel.style.display = 'none'; }
    } else {
        selectedOpeningId = null;
        transformControl.detach();
        updateDimensionLabels();
        if (propsPanel) propsPanel.style.display = 'none';
        if (openingPanel) { openingPanel.classList.add('hidden'); openingPanel.style.display = 'none'; }
    }
    refreshObjectList();
}

// --- แก้ไขช่องเจาะที่เลือก (offset ตามแนวผนัง / กว้าง / สูง / สูงจากพื้น) ---
let selectedOpeningId = null;

function updateOpeningInputsFromSelection(openingId) {
    selectedOpeningId = openingId;
    const o = parametric.buildingModel.getOpening(openingId);
    if (!o) return;
    const elOffset = document.getElementById('inp-open-offset');
    const elW = document.getElementById('inp-open-w');
    const elH = document.getElementById('inp-open-h');
    const elSill = document.getElementById('inp-open-sill');
    if (elOffset) elOffset.value = o.offset.toFixed(2);
    if (elW) elW.value = o.width.toFixed(2);
    if (elH) elH.value = o.height.toFixed(2);
    if (elSill) elSill.value = o.sillHeight.toFixed(2);
}

function applyOpeningInputs() {
    if (!selectedOpeningId) return;
    const elOffset = document.getElementById('inp-open-offset');
    const elW = document.getElementById('inp-open-w');
    const elH = document.getElementById('inp-open-h');
    const elSill = document.getElementById('inp-open-sill');
    const patch = {
        offset: parseFloat(elOffset?.value),
        width: parseFloat(elW?.value),
        height: parseFloat(elH?.value),
        sillHeight: parseFloat(elSill?.value),
    };
    const updated = parametric.openingManager.updateOpening(selectedOpeningId, patch);
    if (!updated) {
        alert(t('alert.openingOverlap'));
        // ค่าที่กรอกใช้ไม่ได้ (ล้นผนัง/ซ้อนช่องอื่น) — รีเซ็ตกลับเป็นค่าปัจจุบันจริงของโมเดล
        updateOpeningInputsFromSelection(selectedOpeningId);
        return;
    }
    updateOpeningInputsFromSelection(selectedOpeningId);
    // เมชถูกสร้างใหม่ (_createOrUpdateMesh ลบของเก่าแล้วเติมใหม่เสมอ) ต้องผูก outline/selection เข้ากับเมชล่าสุด
    const freshMesh = parametric.openingRenderer.meshesByOpeningId.get(selectedOpeningId);
    selectedObject = freshMesh || null;
    updateSelectionOutline(selectedObject);
    updateRealtimeCalc();
}

['inp-open-offset', 'inp-open-w', 'inp-open-h', 'inp-open-sill'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener('change', applyOpeningInputs);
});

document.getElementById('btn-opening-delete')?.addEventListener('click', () => {
    if (!selectedOpeningId) return;
    parametric.commandManager.execute(new DeleteOpeningCommand(parametric.openingManager, selectedOpeningId));
    selectedOpeningId = null;
    selectObject(null);
    updateRealtimeCalc();
});

function updateSelectionOutline(obj) {
    if (outlineHelper) {
        scene.remove(outlineHelper);
        outlineHelper.dispose();
        outlineHelper = null;
    }
    if (!obj) return;
    outlineHelper = new THREE.BoxHelper(obj, themeScene().outline); // ตรงกับ --accent-glow ของธีม
    scene.add(outlineHelper);
}

function getTopLevelObject(obj) {
    let cur = obj;
    while (cur.parent && cur.parent !== scene) cur = cur.parent;
    return cur;
}

// --- 8. LAYER PANEL HELPERS (visibility / lock / order / group tree) ---
function isLocked(obj) {
    return !!(obj.userData && obj.userData.locked);
}

// รายการวัตถุระดับบนสุดที่ยังไม่ถูกล็อก (ใช้กรองก่อน raycast/marquee select)
// รวมเมชประตู/หน้าต่าง (parametric opening) เข้าไปด้วย เพราะมันไม่ได้อยู่ใน
// อาเรย์ objects (ถูกจัดการแยกผ่าน OpeningRenderer) — ถ้าไม่รวม จะคลิกเลือก/ย้าย/ขยายไม่ได้เลย
function selectableObjects() {
    const openingMeshes = parametric?.openingRenderer
        ? Array.from(parametric.openingRenderer.meshesByOpeningId.values())
        : [];
    return objects.filter(o => !isLocked(o)).concat(openingMeshes);
}

// อาเรย์ "พี่น้อง" ของวัตถุ (objects ถ้าอยู่บนสุด, หรือ children ของกลุ่มแม่ถ้าอยู่ในกลุ่ม) — ใช้กำหนดลำดับเลเยอร์
function getSiblingArray(obj) {
    const parent = obj.parent;
    if (!parent || parent === scene) return objects;
    return parent.children;
}

function moveObjectOrder(obj, delta) {
    const arr = getSiblingArray(obj);
    const idx = arr.indexOf(obj);
    if (idx < 0) return;
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= arr.length) return;
    pushUndo();
    const tmp = arr[idx];
    arr[idx] = arr[newIdx];
    arr[newIdx] = tmp;
    refreshObjectList();
}

function moveObjectToEdge(obj, toFront) {
    const arr = getSiblingArray(obj);
    const idx = arr.indexOf(obj);
    if (idx < 0) return;
    pushUndo();
    arr.splice(idx, 1);
    if (toFront) arr.push(obj); else arr.unshift(obj);
    refreshObjectList();
}

function toggleVisible(obj) {
    obj.visible = !obj.visible;
    if (obj.userData.parametricWallId) parametric.wallManager.setWallVisible(obj.userData.parametricWallId, obj.visible);
    if (selectedObject === obj) updateDimensionLabels();
    refreshObjectList();
    updateRealtimeCalc();
}

function toggleLock(obj) {
    obj.userData.locked = !obj.userData.locked;
    if (obj.userData.parametricWallId) parametric.wallManager.setWallLocked(obj.userData.parametricWallId, obj.userData.locked);
    if (obj.userData.locked && selectedObject === obj) selectObject(null);
    refreshObjectList();
}

function toggleCollapse(obj) {
    obj.userData.collapsed = !obj.userData.collapsed;
    refreshObjectList();
}

// ติ๊ก/ยกเลิกติ๊กชิ้นงานในลิสต์ (ใช้เลือกหลายชิ้นสำหรับปุ่ม "รวมกลุ่มที่ติ๊ก")
function toggleMultiSelect(obj) {
    if (multiSelected.has(obj)) multiSelected.delete(obj);
    else multiSelected.add(obj);
    refreshObjectList();
}

// ย้ายชิ้นงาน (child) เข้าไปอยู่ในกลุ่ม (group) โดยคงตำแหน่ง/ขนาดในโลกจริงไว้ (ลากวางบนโฟลเดอร์)
function moveObjectIntoGroup(child, group) {
    if (!child || !group || child === group || !group.isGroup) return;
    // กันไม่ให้ลากกลุ่มแม่ไปไว้ในลูกของตัวเอง
    let p = group;
    while (p) { if (p === child) return; p = p.parent; }
    pushUndo();
    group.attach(child);
    objects = objects.filter(o => o !== child);
    multiSelected.delete(child);
    refreshObjectList();
    updateRealtimeCalc();
}

// ย้ายชิ้นงานออกจากกลุ่มกลับไปเป็นระดับบนสุด (ลากออกมาวางพื้นที่ว่างของลิสต์)
function moveObjectToRoot(child) {
    if (!child || !child.parent || child.parent === scene) return;
    pushUndo();
    scene.attach(child);
    if (!objects.includes(child)) objects.push(child);
    refreshObjectList();
    updateRealtimeCalc();
}

function deleteObjectNode(obj) {
    if (obj.userData.parametricWallId) {
        // Wall data/geometry lifecycle is owned by WallManager/WallRenderer
        // (undo/redo-aware) — just drop our outliner reference, don't
        // touch the mesh/geometry directly or undo would desync.
        parametric.deleteWallUndoable(obj.userData.parametricWallId);
        objects = objects.filter(o => o !== obj);
        multiSelected.delete(obj);
        if (selectedObject === obj) selectObject(null);
        refreshObjectList();
        updateRealtimeCalc();
        return;
    }
    pushUndo();
    const parent = obj.parent;
    if (parent) parent.remove(obj);
    else scene.remove(obj);
    disposeObject(obj);
    objects = objects.filter(o => o !== obj);
    multiSelected.delete(obj);
    if (selectedObject === obj) selectObject(null);
    refreshObjectList();
    updateRealtimeCalc();
}

function duplicateObjectNode(obj) {
    if (obj.userData.parametricWallId) {
        const newWall = parametric.duplicateWallUndoable(obj.userData.parametricWallId);
        // The new mesh arrives via onWallMeshCreated (pushes to `objects`,
        // refreshes the list, and selects it) — nothing else to do here.
        if (!newWall) alert(t('alert.copyWallFail'));
        return;
    }
    pushUndo();
    const data = serializeObject(obj);
    data.position = [data.position[0] + 0.8, data.position[1], data.position[2] + 0.8];
    data.name = data.name + ' Copy';
    const newObj = buildFromData(data);
    const parent = obj.parent;
    if (parent && parent.isGroup) {
        parent.add(newObj);
    } else {
        scene.add(newObj);
        objects.push(newObj);
    }
    refreshObjectList();
    selectObject(newObj);
    updateRealtimeCalc();
}

// สร้างกลุ่ม/โฟลเดอร์เลเยอร์เปล่า (เหมือนสร้าง Layer Group ใน Photoshop)
function createEmptyGroup() {
    pushUndo();
    const group = new THREE.Group();
    const groupCount = objects.filter(o => o.isGroup).length + 1;
    group.userData.name = `Group ${groupCount}`;
    group.userData.id = generateId('group');
    scene.add(group);
    objects.push(group);
    refreshObjectList();
    selectObject(group);
}

// --- 8. LAYER PANEL HELPERS: ไอคอน SVG ชุดเดียวกันทั้งพาเนล (แทนอิโมจิสีสันไม่เข้าธีม) ---
const ICN = {
    chevron: '<svg viewBox="0 0 16 16"><path d="M5 3l6 5-6 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    eye: '<svg viewBox="0 0 16 16"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.7" fill="currentColor"/></svg>',
    eyeOff: '<svg viewBox="0 0 16 16"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" stroke-width="1.5"/></svg>',
    lock: '<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    unlock: '<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    folder: '<svg viewBox="0 0 16 16"><path d="M1.5 4.2c0-.7.6-1.2 1.2-1.2h3l1.2 1.4h6.4c.7 0 1.2.5 1.2 1.2v6.2c0 .7-.5 1.2-1.2 1.2H2.7c-.7 0-1.2-.5-1.2-1.2V4.2Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
    cube: '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    up: '<svg viewBox="0 0 16 16"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    toFront: '<svg viewBox="0 0 16 16"><line x1="3" y1="3.5" x2="13" y2="3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M5 11l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    toBack: '<svg viewBox="0 0 16 16"><line x1="3" y1="12.5" x2="13" y2="12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M5 5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    duplicate: '<svg viewBox="0 0 16 16"><rect x="2.5" y="4.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 4.5V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    ungroup: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="9" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M7 5h3a2 2 0 0 1 2 2v2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    trash: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function refreshObjectList() {
    const list = document.getElementById('object-list');
    if (!list) return;
    list.innerHTML = '';
    objects.forEach(obj => renderObjectNode(obj, list, 0));
    updateStatusBar();
}

// ลากวางบนพื้นที่ว่างของลิสต์ (ไม่ใช่บนแถวไหน) = ย้ายชิ้นงานออกจากกลุ่มกลับสู่ระดับบนสุด
(function setupOutlinerRootDrop() {
    const list = document.getElementById('object-list');
    if (!list) return;
    list.addEventListener('dragover', (e) => {
        if (!dragSourceObj || e.target !== list) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        list.classList.add('drag-target-root');
    });
    list.addEventListener('dragleave', (e) => {
        if (e.target === list) list.classList.remove('drag-target-root');
    });
    list.addEventListener('drop', (e) => {
        list.classList.remove('drag-target-root');
        if (dragSourceObj && e.target === list) {
            e.preventDefault();
            moveObjectToRoot(dragSourceObj);
        }
        dragSourceObj = null;
    });
})();

function renderObjectNode(obj, container, depth) {
    const li = document.createElement('li');
    li.style.paddingLeft = (8 + depth * 16) + 'px';
    if (selectedObject === obj) li.classList.add('selected');
    if (isLocked(obj)) li.classList.add('locked-row');
    if (multiSelected.has(obj)) li.classList.add('multi-selected');
    for (let d = 0; d < depth; d++) {
        const guide = document.createElement('span');
        guide.className = 'indent-guide';
        guide.style.left = (14 + d * 16) + 'px';
        li.appendChild(guide);
    }
    li.onclick = () => {
        if (isLocked(obj)) return;
        if (selectedObject !== obj) selectObject(obj);
    };

    // --- Drag & Drop: ลากชิ้นงานไปวางบนโฟลเดอร์เพื่อย้ายเข้ากลุ่ม หรือวางพื้นที่ว่างเพื่อย้ายออก ---
    li.draggable = !isLocked(obj);
    li.ondragstart = (e) => {
        e.stopPropagation();
        dragSourceObj = obj;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', obj.uuid); } catch (err) { /* noop */ }
    };
    li.ondragend = () => { dragSourceObj = null; };
    if (obj.isGroup) {
        li.ondragover = (e) => {
            if (!dragSourceObj || dragSourceObj === obj) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            li.classList.add('drag-target');
        };
        li.ondragleave = () => li.classList.remove('drag-target');
        li.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            li.classList.remove('drag-target');
            if (dragSourceObj && dragSourceObj !== obj) moveObjectIntoGroup(dragSourceObj, obj);
            dragSourceObj = null;
        };
    }

    // --- แถวหลัก: ไอคอนพับ/กาง, ตา, กุญแจ, ชื่อ ---
    const rowMain = document.createElement('div');
    rowMain.className = 'row-main';

    if (obj.isGroup) {
        const tri = document.createElement('span');
        tri.className = 'tri-toggle' + (obj.userData.collapsed ? '' : ' expanded');
        tri.innerHTML = ICN.chevron;
        tri.title = obj.userData.collapsed ? t('layer.expand') : t('layer.collapse');
        tri.onclick = (e) => { e.stopPropagation(); toggleCollapse(obj); };
        rowMain.appendChild(tri);
    } else {
        const spacer = document.createElement('span');
        spacer.className = 'tri-spacer';
        rowMain.appendChild(spacer);
    }

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'multi-chk';
    chk.checked = multiSelected.has(obj);
    chk.title = t('layer.tick');
    chk.onclick = (e) => { e.stopPropagation(); toggleMultiSelect(obj); };
    rowMain.appendChild(chk);

    const eyeBtn = document.createElement('span');
    eyeBtn.className = 'icon-btn eye-btn' + (obj.visible ? '' : ' off');
    eyeBtn.innerHTML = obj.visible ? ICN.eye : ICN.eyeOff;
    eyeBtn.title = obj.visible ? t('layer.hide') : t('layer.show');
    eyeBtn.onclick = (e) => { e.stopPropagation(); toggleVisible(obj); };
    rowMain.appendChild(eyeBtn);

    const lockBtn = document.createElement('span');
    lockBtn.className = 'icon-btn lock-btn' + (isLocked(obj) ? ' on' : '');
    lockBtn.innerHTML = isLocked(obj) ? ICN.lock : ICN.unlock;
    lockBtn.title = isLocked(obj) ? t('layer.unlock') : t('layer.lock');
    lockBtn.onclick = (e) => { e.stopPropagation(); toggleLock(obj); };
    rowMain.appendChild(lockBtn);

    const typeIcon = document.createElement('span');
    typeIcon.className = 'row-icon';
    typeIcon.innerHTML = obj.isGroup ? ICN.folder : ICN.cube;
    rowMain.appendChild(typeIcon);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'obj-name';
    const suffix = obj.isGroup
        ? ` (${obj.children.length})`
        : ` · ${tData(MATERIALS[getMaterialId(obj)].label)}`;
    nameSpan.textContent = `${tData(obj.userData.name)}${suffix}`;
    nameSpan.ondblclick = (e) => {
        e.stopPropagation();
        if (isLocked(obj)) return;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'obj-name-edit';
        input.value = obj.userData.name;
        const commit = () => {
            pushUndo();
            obj.userData.name = input.value.trim() || obj.userData.name;
            if (obj.userData.parametricWallId) parametric.wallManager.renameWall(obj.userData.parametricWallId, obj.userData.name);
            refreshObjectList();
        };
        input.onblur = commit;
        input.onkeydown = (ev) => {
            ev.stopPropagation();
            if (ev.key === 'Enter') input.blur();
            if (ev.key === 'Escape') { input.value = obj.userData.name; input.blur(); }
        };
        nameSpan.replaceWith(input);
        input.focus();
        input.select();
    };
    rowMain.appendChild(nameSpan);
    li.appendChild(rowMain);

    // --- แถวไอคอน: ลำดับเลเยอร์ + คัดลอก + (แยกกลุ่ม) + ลบ ---
    const iconsDiv = document.createElement('div');
    iconsDiv.className = 'list-icon-group';

    const mkIcon = (svg, title, onClick, extraClass) => {
        const btn = document.createElement('span');
        btn.className = 'icon-btn' + (extraClass ? ' ' + extraClass : '');
        btn.innerHTML = svg;
        btn.title = title;
        btn.onclick = (e) => { e.stopPropagation(); onClick(); };
        return btn;
    };

    iconsDiv.appendChild(mkIcon(ICN.toFront, t('layer.toFront'), () => moveObjectToEdge(obj, true)));
    iconsDiv.appendChild(mkIcon(ICN.up, t('layer.up'), () => moveObjectOrder(obj, -1)));
    iconsDiv.appendChild(mkIcon(ICN.down, t('layer.down'), () => moveObjectOrder(obj, 1)));
    iconsDiv.appendChild(mkIcon(ICN.toBack, t('layer.toBack'), () => moveObjectToEdge(obj, false)));
    iconsDiv.appendChild(mkIcon(ICN.duplicate, t('layer.duplicate'), () => duplicateObjectNode(obj)));
    if (obj.isGroup) {
        iconsDiv.appendChild(mkIcon(ICN.ungroup, t('layer.ungroup'), () => { selectObject(obj); ungroupSelected(); }));
    }
    iconsDiv.appendChild(mkIcon(ICN.trash, t('layer.delete'), () => deleteObjectNode(obj), 'danger-hover'));

    li.appendChild(iconsDiv);
    container.appendChild(li);

    if (obj.isGroup && !obj.userData.collapsed) {
        obj.children.forEach(child => renderObjectNode(child, container, depth + 1));
    }
}

// คืนหน่วยความจำ geometry/material ของ mesh ทุกชั้น (รวมลูกในกลุ่ม)
function disposeObject(obj) {
    obj.traverse(o => {
        if (o.isMesh) {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        }
    });
}

function clearAllObjects() {
    pushUndo();
    selectObject(null);
    objects.forEach(obj => {
        scene.remove(obj);
        disposeObject(obj);
    });
    objects = [];
    multiSelected.clear();
    refreshObjectList();
    updateRealtimeCalc();
}

document.getElementById('btn-clear-all')?.addEventListener('click', () => {
    if (confirm(t('confirm.clearAll'))) {
        clearAllObjects();
    }
});

function createGroupFromObjects(list) {
    if (list.length < 2) return;
    pushUndo();
    const group = new THREE.Group();
    const groupCount = objects.filter(o => o.isGroup).length + 1;
    group.userData.name = `Group ${groupCount}`;
    group.userData.id = generateId('group');
    scene.add(group);

    list.forEach(obj => group.attach(obj));

    objects = objects.filter(o => !list.includes(o));
    objects.push(group);

    refreshObjectList();
    selectObject(group);
    updateRealtimeCalc();
}

function ungroupSelected() {
    if (!selectedObject || !selectedObject.isGroup) return;
    pushUndo();
    const group = selectedObject;
    [...group.children].forEach(child => {
        scene.attach(child);
        objects.push(child);
    });
    scene.remove(group);
    objects = objects.filter(o => o !== group);
    selectObject(null);
    refreshObjectList();
    updateRealtimeCalc();
}

// --- SINGLE CREATION BUTTONS (สำหรับงานต่อเติม: สร้างทีละชิ้น ไม่ต้องมีพรีเซ็ตบ้านทั้งหลัง) ---
document.getElementById('btn-add-wall')?.addEventListener('click', () => {
    // สร้างเป็นผนังพาราเมตริก (ไม่ใช่กล่องธรรมดา) เพื่อให้เครื่องมือเพิ่มประตู/หน้าต่างคลิกเจาะได้
    const mat = getSelectedMaterialId();
    const d = parametric.getWallDefaults();
    const floor = parametric.floorManager.getActiveFloor();
    const cx = Math.round((orbit.target?.x ?? 0) / 0.25) * 0.25;
    const cz = Math.round((orbit.target?.z ?? 0) / 0.25) * 0.25;
    // เลื่อนทีละนิดไม่ให้ผนังใหม่ซ้อนทับผนังเดิม
    const n = (window.__addWallCount = (window.__addWallCount || 0) + 1) - 1;
    const z = cz + (n % 8) * 0.5;
    parametric.commandManager.execute(new CreateWallCommand(parametric.wallManager, {
        start: { x: cx - 1.5, y: 0, z }, end: { x: cx + 1.5, y: 0, z },
        height: d.height, thickness: d.thickness, materialId: mat, floorId: floor?.id,
    }));
    updateRealtimeCalc();
});

// --- PARAMETRIC WALL TOOL TOGGLE ---
let parametricToolActive = false;
let parametricOpeningToolActive = false;

function deactivateAllParametricTools() {
    parametricToolActive = false;
    parametricOpeningToolActive = false;
    parametric.wallTool.deactivate();
    parametric.openingTool.deactivate();
    if (typeof deactivateCutTool === 'function') deactivateCutTool(); // กันชนกับเครื่องมือตัดเส้นแบ่งช่อง (ข้อ 4)
    orbit.enabled = true;
    orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE; // restore default (left = orbit) outside wall tool
    document.getElementById('btn-parametric-wall-tool')?.classList.remove('active');
    document.getElementById('btn-parametric-door-tool')?.classList.remove('active');
    document.getElementById('btn-parametric-window-tool')?.classList.remove('active');
    const wallBtn = document.getElementById('btn-parametric-wall-tool');
    if (wallBtn) wallBtn.textContent = t('tools.parametricWall.draw');
}

document.getElementById('btn-parametric-wall-tool')?.addEventListener('click', (e) => {
    const turningOn = !parametricToolActive;
    deactivateAllParametricTools();
    if (turningOn) {
        parametricToolActive = true;
        // Keep orbit ENABLED so the camera stays controllable while drawing —
        // only free the LEFT button (it drives wall-draw drag). MIDDLE stays
        // ROTATE and RIGHT stays PAN, per the requested control scheme.
        orbit.enabled = true;
        orbit.mouseButtons.LEFT = null;
        parametric.wallTool.activate();
        e.target.classList.add('active');
        e.target.textContent = t('tools.parametricWall.drawing');
    }
});

document.getElementById('btn-parametric-door-tool')?.addEventListener('click', (e) => {
    const turningOn = !parametricOpeningToolActive || parametric.openingTool.type !== 'door';
    deactivateAllParametricTools();
    if (turningOn) {
        parametricOpeningToolActive = true;
        parametric.openingTool.setType('door');
        parametric.openingTool.activate();
        e.target.classList.add('active');
    }
});

document.getElementById('btn-parametric-window-tool')?.addEventListener('click', (e) => {
    const turningOn = !parametricOpeningToolActive || parametric.openingTool.type !== 'window';
    deactivateAllParametricTools();
    if (turningOn) {
        parametricOpeningToolActive = true;
        parametric.openingTool.setType('window');
        parametric.openingTool.activate();
        e.target.classList.add('active');
    }
});

// --- ตั้งค่าประตู/หน้าต่าง + สถานะพรีวิวการเจาะ ---
(function setupOpeningSettingsUI() {
    const $ = (id) => document.getElementById(id);
    const panel = $('opening-settings-panel');
    const statusEl = $('opening-status');
    if (!panel) return;

    const fields = {
        door:   { width: $('inp-door-w'),   height: $('inp-door-h'),   sillHeight: $('inp-door-sill') },
        window: { width: $('inp-window-w'), height: $('inp-window-h'), sillHeight: $('inp-window-sill') },
    };
    const fillInputs = () => {
        const st = parametric.getOpeningSettings();
        for (const type of ['door', 'window']) {
            for (const key of ['width', 'height', 'sillHeight']) {
                if (fields[type][key]) fields[type][key].value = st[type][key];
            }
        }
        $('chk-lock-sill').checked = st.lockSill;
        $('chk-lock-head').checked = st.lockHead;
    };
    fillInputs();

    const readInputs = () => {
        const next = { door: {}, window: {} };
        for (const type of ['door', 'window']) {
            for (const key of ['width', 'height', 'sillHeight']) {
                const v = parseFloat(fields[type][key].value);
                if (Number.isFinite(v)) next[type][key] = v;
            }
        }
        next.lockSill = $('chk-lock-sill').checked;
        next.lockHead = $('chk-lock-head').checked;
        return next;
    };

    $('btn-opening-settings')?.addEventListener('click', (e) => {
        const show = panel.style.display === 'none';
        panel.style.display = show ? '' : 'none';
        e.currentTarget.classList.toggle('active', show);
        if (show) fillInputs();
    });

    // ค่าที่กรอกมีผลกับช่องที่จะเจาะใหม่ทันที; ปุ่ม "นำไปใช้" ปรับช่องเดิมตามตัวล็อกด้วย
    Object.values(fields).forEach(group => Object.values(group).forEach(inp => {
        inp?.addEventListener('change', () => parametric.updateOpeningSettings(readInputs(), { applyToExisting: false }));
    }));
    ['chk-lock-sill', 'chk-lock-head'].forEach(id => $(id)?.addEventListener('change', () => {
        parametric.updateOpeningSettings(readInputs(), { applyToExisting: false });
    }));
    $('btn-opening-apply')?.addEventListener('click', () => {
        parametric.updateOpeningSettings(readInputs(), { applyToExisting: true });
        fillInputs();
        updateRealtimeCalc();
    });

    parametric.setOpeningStatusHandler((st) => {
        if (!statusEl) return;
        statusEl.textContent = st ? st.text : '';
        statusEl.style.color = st ? (st.ok ? 'var(--success)' : 'var(--danger)') : '';
    });
})();

// --- 9. CALCULATION LOGIC (มยผ. 1101-64 + BOQ, รองรับหลายวัสดุ) ---
// ปริมาตร + พื้นที่ผนังของ mesh โดยคิด world scale
// (แก้บั๊ก: ปริมาตรผิดเมื่อย่อ/ขยายทั้งกลุ่ม; พื้นที่ผนัง = ปริมาตร/ความหนาที่บางสุด)
function meshMetrics(mesh) {
    const p = mesh.geometry && mesh.geometry.parameters;
    const s = new THREE.Vector3();
    mesh.getWorldScale(s);
    let dims;
    if (p && p.width != null) {
        dims = [Math.abs(p.width * s.x), Math.abs(p.height * s.y), Math.abs(p.depth * s.z)];
    } else {
        const box = new THREE.Box3().setFromObject(mesh);
        const size = new THREE.Vector3();
        box.getSize(size);
        dims = [size.x, size.y, size.z];
    }
    const volume = dims[0] * dims[1] * dims[2];
    dims.sort((a, b) => a - b);
    const thickness = dims[0];
    const area = thickness > 1e-6 ? volume / thickness : 0; // พื้นที่หน้าผนัง = ด้านกว้าง×ด้านยาว
    return { volume, area };
}

// รวมปริมาตร+พื้นที่แยกตามวัสดุ (เดินลูกทุกชั้นของกลุ่ม)
function collectMetrics(list) {
    scene.updateMatrixWorld(true);
    const byMat = {};
    let totalVolume = 0;
    const walk = (obj) => {
        if (obj.isMesh && obj.geometry) {
            const matId = getMaterialId(obj);
            const mm = meshMetrics(obj);
            if (!byMat[matId]) byMat[matId] = { volume: 0, area: 0, count: 0 };
            byMat[matId].volume += mm.volume;
            byMat[matId].area += mm.area;
            byMat[matId].count += 1;
            totalVolume += mm.volume;
        }
        if (obj.children) obj.children.forEach(walk);
    };
    list.forEach(walk);
    return { byMat, totalVolume };
}

function fmtQty(row) {
    return row.decimals
        ? row.qty.toLocaleString(undefined, { minimumFractionDigits: row.decimals, maximumFractionDigits: row.decimals })
        : Math.round(row.qty).toLocaleString();
}

// รวมปริมาณวัสดุชนิดเดียวกันข้ามหมวด (เช่น ปูน/ทราย ที่โผล่ทั้งงานคอนกรีตและงานก่อ)
function summarizeMaterials(byMat, matIds) {
    const totals = {}; // key = "ชื่อ|หน่วย" → { name, unit, qty, decimals }
    matIds.forEach(matId => {
        const mat = MATERIALS[matId];
        mat.components(byMat[matId]).forEach(r => {
            const key = r.name + '|' + r.unit;
            if (!totals[key]) totals[key] = { name: r.name, unit: r.unit, qty: 0, decimals: r.decimals || 0 };
            totals[key].qty += (r.adjQty ?? r.rawQty ?? r.qty); // รวมค่าดิบก่อน แล้วปัดที่ยอดรวม
            totals[key].decimals = Math.max(totals[key].decimals, r.decimals || 0);
        });
    });
    Object.values(totals).forEach(t => { if (COUNT_UNITS.includes(t.unit)) t.qty = ceilQty(t.qty); });
    return Object.values(totals);
}

// กล่องตั้งค่าค่าเผื่อสูญเสีย/พองตัว (ผลประเมินผู้เชี่ยวชาญ: ทั้งสองท่านเสนอให้ปรับได้ต่อวัสดุ)
function buildBOQSettingsBox(matIds) {
    const st = getBoqSettings();
    const inputs = matIds.map(id => `<label class="boq-set-row"><span class="boq-set-label">${tData(MATERIALS[id].label)}</span>
            <input type="number" min="0" max="100" step="0.5" value="${st.wastePct[id] || 0}" data-boq-waste="${id}"><span class="boq-set-unit">%</span></label>`).join('');
    return `<div class="boq-settings">
        <div class="boq-summary-title">${t('boq.settings.title')}</div>
        ${inputs}
        <label class="boq-set-row"><span class="boq-set-label">${t('boq.settings.bulking')}</span>
            <input type="number" min="1" max="2" step="0.05" value="${st.sandStoneBulking}" data-boq-bulking><span class="boq-set-unit">${t('boq.settings.times')}</span></label>
        <div class="boq-set-actions">
            <button type="button" data-boq-preset>${t('boq.settings.preset')}</button>
            <button type="button" data-boq-reset>${t('boq.settings.reset')}</button>
        </div>
        <small class="boq-note">${t('boq.settings.note')}</small>
    </div>`;
}

function buildBOQReport(objList, label, topCount) {
    const { byMat, totalVolume } = collectMetrics(objList);
    const matIds = Object.keys(byMat).filter(m => byMat[m].volume > 1e-9);

    if (matIds.length === 0) {
        return `<div class="boq-empty">${t('boq.empty')}</div>`;
    }

    let sections = '';

    matIds.forEach(matId => {
        const mat = MATERIALS[matId];
        const m = byMat[matId];
        const basisText = mat.basis === 'area'
            ? `${m.area.toFixed(2)} ${tData('ตร.ม.')}`
            : `${m.volume.toFixed(3)} ${tData('ลบ.ม.')}`;
        const rowsHtml = mat.components(m).map(r => `<tr>
                <td>${tData(r.name)}</td>
                <td class="qty">${fmtQty(r)}</td>
                <td>${tData(r.unit)}</td>
            </tr>`).join('');

        sections += `
            <div class="boq-material-section">
                <h4 class="boq-material-title">${tData(mat.label)} — <span class="qty">${basisText} (${m.count} ${tData('ชิ้น')})</span></h4>
                <table>
                    <thead>
                        <tr><th>${t('boq.col.item')}</th><th style="text-align:right;">${t('boq.col.qty')}</th><th>${t('boq.col.unit')}</th></tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
                <small class="boq-note">* ${tData(mat.note)}</small>
            </div>`;
    });

    // ตารางสรุปวัสดุรวม (รวมชนิดเดียวกันข้ามหมวด) — เอาไว้สั่งซื้อของได้เลย
    const summary = summarizeMaterials(byMat, matIds);
    const summaryRows = summary.map(r => `<tr>
            <td>${tData(r.name)}</td>
            <td class="qty">${fmtQty(r)}</td>
            <td>${tData(r.unit)}</td>
        </tr>`).join('');

    return `
        <div class="boq-report">
            <h3 class="boq-report-title">${label}</h3>
            <p class="boq-report-meta">${t('boq.meta', { top: topCount, vol: totalVolume.toFixed(3), types: matIds.length })}</p>
            ${buildBOQSettingsBox(matIds)}
            ${sections}
            <div class="boq-summary-box">
                <div class="boq-summary-title">${t('boq.summary.project')}</div>
                <table><thead><tr><th>${t('boq.col.item')}</th><th style="text-align:right;">${t('boq.col.totalQty')}</th><th>${t('boq.col.unit')}</th></tr></thead>
                    <tbody>${summaryRows}</tbody>
                </table>
            </div>
            <small class="boq-reference">
                ${t('boq.reference.html')}
            </small>
        </div>
    `;
}

// Renders a parametric BOQReport (from src/boq/BOQEngine.js) as HTML in
// the same visual style as the legacy buildBOQReport(), since the two
// systems share one BOQ panel until they're unified in a later phase.
function renderParametricBOQReport(report) {
    if (!report.sections.length) return '';
    const sections = report.sections.map(s => {
        const rows = s.rows.map(r => {
            const qtyText = r.decimals
                ? r.qty.toLocaleString(undefined, { minimumFractionDigits: r.decimals, maximumFractionDigits: r.decimals })
                : Math.round(r.qty).toLocaleString();
            return `<tr><td>${tData(r.name)}</td><td class="qty">${qtyText}</td><td>${tData(r.unit)}</td></tr>`;
        }).join('');
        return `
            <div class="boq-material-section">
                <h4 class="boq-material-title">${tData(s.label)} — <span class="qty">${s.basisValue.toFixed(2)} ${tData(s.basisUnit)} (${s.elementCount} ${tData('ชิ้น')})</span></h4>
                <table>
                    <thead><tr><th>${t('boq.col.item')}</th><th style="text-align:right;">${t('boq.col.qty')}</th><th>${t('boq.col.unit')}</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
                <small class="boq-note">* ${tData(s.note)}</small>
            </div>`;
    }).join('');
    const summaryRows = report.summaryRows.map(r => {
        const qtyText = r.decimals
            ? r.qty.toLocaleString(undefined, { minimumFractionDigits: r.decimals, maximumFractionDigits: r.decimals })
            : Math.round(r.qty).toLocaleString();
        return `<tr><td>${tData(r.name)}</td><td class="qty">${qtyText}</td><td>${tData(r.unit)}</td></tr>`;
    }).join('');
    const warnings = report.warnings.length
        ? `<small class="boq-note">⚠ ${report.warnings.join(' ')}</small>` : '';
    return `
        <div class="boq-report">
            <h3 class="boq-report-title">${tData(report.label)}</h3>
            <p class="boq-report-meta">${t('boq.metaParametric', { top: report.elementCount, vol: report.totalVolume.toFixed(3), types: report.materialTypeCount })}</p>
            ${sections}
            <div class="boq-summary-box">
                <div class="boq-summary-title">${t('boq.summary.parametric')}</div>
                <table><thead><tr><th>${t('boq.col.item')}</th><th style="text-align:right;">${t('boq.col.totalQty')}</th><th>${t('boq.col.unit')}</th></tr></thead>
                    <tbody>${summaryRows}</tbody>
                </table>
            </div>
            ${warnings}
        </div>`;
}

let lastBOQRefresh = null;
// ฟังที่ตัวแม่ (event delegation) เพราะรายงานถูกสร้าง innerHTML ใหม่ทุกครั้ง
document.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.dataset.boqWaste) setWastePct(t.dataset.boqWaste, t.value);
    else if ('boqBulking' in t.dataset) setSandStoneBulking(t.value);
    else return;
    lastBOQRefresh?.();
});
document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-boq-preset],[data-boq-reset]') : null;
    if (!b) return;
    if ('boqPreset' in b.dataset) applyRecommendedWaste(); else resetBoqSettings();
    lastBOQRefresh?.();
});

window.performCalcAll = function () {
    const visible = objects.filter(o => o.visible);
    const el = document.getElementById('calc-result-content');
    const legacyHtml = buildBOQReport(visible, t('boq.title.project'), visible.length);
    const parametricReport = parametric.calculateBOQ();
    const parametricHtml = renderParametricBOQReport(parametricReport);
    // ถ้ามีแต่ผนังพาราเมตริก (legacy ว่าง) ให้แสดงกล่องตั้งค่านำหน้า เพื่อไม่ให้ปรับค่าเผื่อไม่ได้
    const settingsHtml = (!legacyHtml.includes('boq-settings') && parametricReport.sections.length)
        ? buildBOQSettingsBox(parametricReport.sections.map(s => s.materialId)) : '';
    if (el) el.innerHTML = settingsHtml + legacyHtml + parametricHtml;
    lastBOQRefresh = () => window.performCalcAll();
};

window.calcSelectedObject = function () {
    if (!selectedObject) {
        alert(t('alert.selectObjectOrGroup'));
        return;
    }
    const topCount = selectedObject.isGroup ? selectedObject.children.length : 1;

    const panel = document.getElementById('panel-calc');
    if (panel) {
        panel.style.display = 'flex';
        bringToFront(panel);
        updateTaskbar();
    }
    const el = document.getElementById('calc-result-content');
    lastBOQRefresh = () => window.calcSelectedObject();
    if (el) el.innerHTML = buildBOQReport([selectedObject], t('boq.title.selected', { name: tData(selectedObject.userData.name) }), topCount);
};

document.getElementById('btn-calc-selected')?.addEventListener('click', () => window.calcSelectedObject());

document.getElementById('btn-calc-ticked')?.addEventListener('click', () => {
    if (multiSelected.size === 0) {
        alert(t('alert.tickAtLeast1'));
        return;
    }
    const picked = Array.from(multiSelected);
    const topCount = picked.reduce((n, o) => n + (o.isGroup ? o.children.length : 1), 0);
    const panel = document.getElementById('panel-calc');
    if (panel) { panel.style.display = 'flex'; bringToFront(panel); updateTaskbar(); }
    const el = document.getElementById('calc-result-content');
    lastBOQRefresh = () => document.getElementById('btn-calc-ticked')?.click();
    if (el) el.innerHTML = buildBOQReport(picked, t('boq.title.ticked', { n: picked.length }), topCount);
});

function updateRealtimeCalc() {
    const panel = document.getElementById('panel-calc');
    if (isWindowVisible(panel)) {
        window.performCalcAll();
    }
}

// --- 10. INPUT HANDLERS ---
const inpPosX = document.getElementById('inp-pos-x');
const inpPosY = document.getElementById('inp-pos-y');
const inpPosZ = document.getElementById('inp-pos-z');

function updatePosInputsFromObject() {
    if (selectedObject) {
        if (inpPosX) inpPosX.value = selectedObject.position.x.toFixed(2);
        if (inpPosY) inpPosY.value = selectedObject.position.y.toFixed(2);
        if (inpPosZ) inpPosZ.value = selectedObject.position.z.toFixed(2);
    }
}

function applyPosFromInputs() {
    if (selectedObject) {
        const x = parseFloat(inpPosX.value), y = parseFloat(inpPosY.value), z = parseFloat(inpPosZ.value);
        if (!isNaN(x)) selectedObject.position.x = x;
        if (!isNaN(y)) selectedObject.position.y = y;
        if (!isNaN(z)) selectedObject.position.z = z;
        updateDimensionLabels();
    }
}

[inpPosX, inpPosY, inpPosZ].forEach(inp => inp?.addEventListener('input', () => { applyPosFromInputs(); syncOpeningsToWallMeshes(); }));

// --- 11. UNDO / REDO / COPY / PASTE SYSTEM ---
let undoStack = [];
let redoStack = [];
const UNDO_LIMIT = 40;
let clipboardData = null;

function snapshotCurrent() {
    return JSON.stringify(objects.map(o => serializeObject(o)));
}

function serializeObject(obj) {
    if (obj.isGroup) {
        return {
            type: 'group',
            id: obj.userData.id || (obj.userData.id = generateId('group')),
            name: obj.userData.name,
            visible: obj.visible,
            locked: !!obj.userData.locked,
            position: obj.position.toArray(),
            rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
            scale: obj.scale.toArray(),
            children: obj.children.map(c => serializeObject(c))
        };
    }
    // ชิ้นงานที่ Extrude มาจากเส้นตัด (geometry เป็น ExtrudeGeometry ไม่ใช่ BoxGeometry
    // จึงไม่มี .geometry.parameters.width/height/depth) — เก็บ facePoints/height แทน
    // เพื่อ rebuild รูปทรงเดิมได้เป๊ะตอน undo/redo/duplicate/copy-paste/save-load
    if (obj.userData.isCutExtrusion) {
        return {
            type: 'extrude',
            id: obj.userData.id || (obj.userData.id = generateId('obj')),
            name: obj.userData.name,
            visible: obj.visible,
            locked: !!obj.userData.locked,
            material: obj.userData.material || DEFAULT_MATERIAL,
            color: '#' + obj.material.color.getHexString(),
            facePoints: obj.userData.extrudeFacePoints,
            height: obj.userData.extrudeHeight,
            // ข้อ 41: baseElevation ของช่อง extrude ต่อชั้น — ขาดไปเดิมทำให้ reload/สลับชั้นแล้ว
            // ชิ้นงาน extrude ลอย/จมผิดตำแหน่งเทียบชั้นเดิม
            extrudeBaseElevation: obj.userData.extrudeBaseElevation ?? null,
            position: obj.position.toArray(),
            rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
            scale: obj.scale.toArray()
        };
    }
    return {
        type: 'mesh',
        id: obj.userData.id || (obj.userData.id = generateId('obj')),
        name: obj.userData.name,
        visible: obj.visible,
        locked: !!obj.userData.locked,
        material: obj.userData.material || DEFAULT_MATERIAL,
        size: {
            w: obj.geometry.parameters.width,
            h: obj.geometry.parameters.height,
            d: obj.geometry.parameters.depth
        },
        color: '#' + obj.material.color.getHexString(),
        position: obj.position.toArray(),
        rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
        scale: obj.scale.toArray()
    };
}

function buildFromData(data) {
    if (data.type === 'group') {
        const g = new THREE.Group();
        g.userData.name = data.name;
        g.userData.id = data.id || generateId('group');
        g.userData.locked = !!data.locked;
        g.visible = data.visible !== false;
        g.position.fromArray(data.position);
        g.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
        g.scale.fromArray(data.scale);
        data.children.forEach(cd => g.add(buildFromData(cd)));
        return g;
    }
    if (data.type === 'extrude') {
        const mesh = makeExtrudeMesh(data.facePoints, data.height, data.material || DEFAULT_MATERIAL, data.color);
        mesh.userData.name = data.name;
        mesh.userData.id = data.id || generateId('obj');
        mesh.userData.locked = !!data.locked;
        if (data.extrudeBaseElevation != null) mesh.userData.extrudeBaseElevation = data.extrudeBaseElevation;
        mesh.visible = data.visible !== false;
        mesh.position.fromArray(data.position);
        mesh.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
        mesh.scale.fromArray(data.scale);
        return mesh;
    }
    const mesh = makeBoxMesh(data.size.w, data.size.h, data.size.d, data.color, data.name, data.material || DEFAULT_MATERIAL);
    mesh.userData.id = data.id || generateId('obj');
    mesh.userData.locked = !!data.locked;
    mesh.visible = data.visible !== false;
    mesh.position.fromArray(data.position);
    mesh.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
    mesh.scale.fromArray(data.scale);
    return mesh;
}

function pushUndo() {
    undoStack.push(snapshotCurrent());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = []; // การกระทำใหม่ล้างประวัติ redo
}

function restoreSnapshot(snapshotJSON) {
    objects.forEach(o => { scene.remove(o); disposeObject(o); });
    objects = [];
    const data = JSON.parse(snapshotJSON);
    data.forEach(d => {
        const obj = buildFromData(d);
        scene.add(obj);
        objects.push(obj);
    });
    selectObject(null);
    refreshObjectList();
    updateRealtimeCalc();
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(snapshotCurrent());
    const prev = undoStack.pop();
    restoreSnapshot(prev);
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(snapshotCurrent());
    const next = redoStack.pop();
    restoreSnapshot(next);
}

function copySelected() {
    if (!selectedObject) return;
    clipboardData = serializeObject(selectedObject);
}

function pasteClipboard() {
    if (!clipboardData) return;
    pushUndo();
    const data = JSON.parse(JSON.stringify(clipboardData));
    data.position = [data.position[0] + 0.8, data.position[1], data.position[2] + 0.8];
    data.name = data.name + ' Copy';
    const obj = buildFromData(data);
    scene.add(obj);
    objects.push(obj);
    refreshObjectList();
    selectObject(obj);
    updateRealtimeCalc();
}

// --- 13. EVENT LISTENERS ---
window.addEventListener('resize', () => {
    updateViewportRegion();
});

let pointerDownPos = null;
let marqueeStart = null;
let isDraggingMarquee = false;

function isUiTarget(e) {
    return e.target.closest('.window-panel') || e.target.closest('#taskbar') || e.target.closest('#side-nav') || e.target.closest('#view-gizmo') || e.target.tagName === 'INPUT';
}


// --- WALL DEFAULTS INPUTS (height/thickness set *before* drag; length
// always comes from the drag itself, per spec). ---
const inpWallHeight = document.getElementById('inp-wall-height');
const inpWallThickness = document.getElementById('inp-wall-thickness');
if (inpWallHeight) {
    inpWallHeight.value = parametric.getWallDefaults().height;
    inpWallHeight.addEventListener('change', () => {
        const v = parseFloat(inpWallHeight.value);
        if (v > 0) parametric.setWallDefaults({ height: v });
    });
}
if (inpWallThickness) {
    inpWallThickness.value = parametric.getWallDefaults().thickness;
    inpWallThickness.addEventListener('change', () => {
        const v = parseFloat(inpWallThickness.value);
        if (v > 0) parametric.setWallDefaults({ thickness: v });
    });
}

const settingShowDragLengthEl = document.getElementById('setting-show-drag-length');
if (settingShowDragLengthEl) {
    settingShowDragLengthEl.checked = appSettings.showDragLength;
    settingShowDragLengthEl.addEventListener('change', () => {
        appSettings.showDragLength = settingShowDragLengthEl.checked;
        saveAppSettings();
        if (!appSettings.showDragLength) wallLengthLabelEl?.classList.add('hidden');
    });
}

// --- LIVE WALL-LENGTH LABEL WHILE DRAGGING (spec request: show meters drawn) ---
const wallLengthLabelEl = document.getElementById('wall-length-label');
parametric.buildingModel.events.on(Events.WALL_PREVIEW_UPDATE, (data) => {
    if (!wallLengthLabelEl) return;
    if (!data || !appSettings.showDragLength) {
        wallLengthLabelEl.classList.add('hidden');
        return;
    }
    wallLengthLabelEl.textContent = `${data.length.toFixed(2)} ${t('unit.m')} / ${data.angleDeg.toFixed(1)}°`;
    wallLengthLabelEl.style.left = `${data.clientX}px`;
    wallLengthLabelEl.style.top = `${data.clientY}px`;
    wallLengthLabelEl.classList.remove('hidden');
});

// --- PARAMETRIC WALL TOOL POINTER WIRING (additive, gated on parametricToolActive) ---
window.addEventListener('mousedown', (e) => {
    // Only the LEFT button draws walls — RIGHT/MIDDLE are reserved for
    // camera pan/orbit (see orbit.mouseButtons above) and must pass through.
    if (!parametricToolActive || isUiTarget(e) || e.button !== 0) return;
    parametric.wallTool.onPointerDown(e.clientX, e.clientY);
});
window.addEventListener('mousemove', (e) => {
    if (!parametricToolActive || !parametric.wallTool.startPoint) return;
    parametric.wallTool.onPointerMove(e.clientX, e.clientY);
});
window.addEventListener('mouseup', (e) => {
    if (!parametricToolActive || isUiTarget(e) || e.button !== 0 || !parametric.wallTool.startPoint) return;
    const defaults = parametric.getWallDefaults();
    const created = parametric.wallTool.onPointerUp(e.clientX, e.clientY, defaults);
    if (created) updateRealtimeCalc();
});

window.addEventListener('click', (e) => {
    if (!parametricOpeningToolActive || isUiTarget(e)) return;
    const created = parametric.openingTool.onClick(e.clientX, e.clientY, { remove: e.altKey });
    // เจาะใหม่หรือลบช่อง (Alt+คลิก) ก็ต้องคำนวณ BOQ ใหม่
    updateRealtimeCalc();
});
// พรีวิวตำแหน่งที่จะเจาะขณะเลื่อนเมาส์บนผนัง
window.addEventListener('mousemove', (e) => {
    if (!parametricOpeningToolActive) return;
    if (isUiTarget(e)) { parametric.openingTool.onPointerMove(-1e6, -1e6); return; }
    parametric.openingTool.onPointerMove(e.clientX, e.clientY);
});

// Container-relative NDC — must match viewport region set by
// updateViewportRegion(), not raw window size (canvas no longer spans
// the full window once a dock reserves space).
function ndcFromClient(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) / rect.width) * 2 - 1,
        y: -((clientY - rect.top) / rect.height) * 2 + 1,
        rect,
    };
}

window.addEventListener('mousedown', (e) => {
    if (isUiTarget(e) || transformControl.dragging) return;
    pointerDownPos = { x: e.clientX, y: e.clientY };

    if (e.shiftKey) {
        const ndc = ndcFromClient(e.clientX, e.clientY);
        mouse.x = ndc.x; mouse.y = ndc.y;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(selectableObjects(), true);
        if (intersects.length === 0) {
            marqueeStart = { x: e.clientX, y: e.clientY };
            isDraggingMarquee = false;
            orbit.enabled = false;
        }
    }
});

window.addEventListener('mousemove', (e) => {
    if (!marqueeStart) return;
    const dx = Math.abs(e.clientX - marqueeStart.x);
    const dy = Math.abs(e.clientY - marqueeStart.y);
    if (dx > 4 || dy > 4) isDraggingMarquee = true;
    if (isDraggingMarquee) {
        const rect = container.getBoundingClientRect();
        const x1 = Math.min(marqueeStart.x, e.clientX) - rect.left;
        const y1 = Math.min(marqueeStart.y, e.clientY) - rect.top;
        marqueeEl.style.left = x1 + 'px';
        marqueeEl.style.top = y1 + 'px';
        marqueeEl.style.width = Math.abs(e.clientX - marqueeStart.x) + 'px';
        marqueeEl.style.height = Math.abs(e.clientY - marqueeStart.y) + 'px';
        marqueeEl.style.display = 'block';
    }
});

window.addEventListener('mouseup', (e) => {
    if (marqueeStart) {
        orbit.enabled = true;
        if (isDraggingMarquee) {
            const rect = container.getBoundingClientRect();
            const x1 = Math.min(marqueeStart.x, e.clientX), x2 = Math.max(marqueeStart.x, e.clientX);
            const y1 = Math.min(marqueeStart.y, e.clientY), y2 = Math.max(marqueeStart.y, e.clientY);
            const picked = [];
            // ช่องเจาะ (ประตู/หน้าต่าง) เลือกได้ทีละบานเท่านั้น ห้ามรวมกลุ่มด้วยการครอบเลือก
            // เพราะตำแหน่งผูกกับผนังเสมอ ไม่ใช่วัตถุอิสระแบบอื่น
            selectableObjects().filter(o => !o.userData?.isParametricOpening).forEach(obj => {
                const box = new THREE.Box3().setFromObject(obj);
                const center = new THREE.Vector3();
                box.getCenter(center);
                const proj = center.clone().project(camera);
                const sx = rect.left + (proj.x * 0.5 + 0.5) * rect.width;
                const sy = rect.top + (-proj.y * 0.5 + 0.5) * rect.height;
                if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) picked.push(obj);
            });
            marqueeEl.style.display = 'none';
            if (picked.length >= 2) createGroupFromObjects(picked);
            else if (picked.length === 1) selectObject(picked[0]);
        }
        marqueeStart = null;
        isDraggingMarquee = false;
        pointerDownPos = null;
        return;
    }

    if (!pointerDownPos) return;
    const dx = Math.abs(e.clientX - pointerDownPos.x);
    const dy = Math.abs(e.clientY - pointerDownPos.y);
    pointerDownPos = null;
    if (dx > 4 || dy > 4) return;
    if (isUiTarget(e) || transformControl.dragging) return;

    const ndcUp = ndcFromClient(e.clientX, e.clientY);
    mouse.x = ndcUp.x; mouse.y = ndcUp.y;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(selectableObjects(), true);
    if (intersects.length > 0) {
        selectObject(getTopLevelObject(intersects[0].object));
        return;
    }
    selectObject(null);
});

window.addEventListener('dblclick', (e) => {
    if (isUiTarget(e)) return;
    const ndcDbl = ndcFromClient(e.clientX, e.clientY);
    mouse.x = ndcDbl.x; mouse.y = ndcDbl.y;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(selectableObjects(), true);
    if (intersects.length > 0) {
        const top = getTopLevelObject(intersects[0].object);
        if (top.isGroup && !top.userData?.isParametricOpening) {
            selectObject(top);
            ungroupSelected();
        }
    }
});

window.addEventListener('keydown', (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' && e.shiftKey) {
            e.preventDefault();
            if (parametricToolActive || parametricOpeningToolActive) { parametric.redo(); updateRealtimeCalc(); }
            else redo();
            return;
        }
        if (key === 'z') {
            e.preventDefault();
            if (parametricToolActive || parametricOpeningToolActive) { parametric.undo(); updateRealtimeCalc(); }
            else undo();
            return;
        }
        if (key === 'y') {
            e.preventDefault();
            if (parametricToolActive || parametricOpeningToolActive) { parametric.redo(); updateRealtimeCalc(); }
            else redo();
            return;
        }
        if (key === 'c') { e.preventDefault(); copySelected(); return; }
        if (key === 'v') { e.preventDefault(); pasteClipboard(); return; }
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedObject) deleteObjectNode(selectedObject);
    }
    if (e.key.toLowerCase() === 't') setTool('translate');
    if (e.key.toLowerCase() === 'r') setTool('scale');
    if (e.key.toLowerCase() === 'e') setTool('rotate');
    if (e.key.toLowerCase() === 'q') setTool('select');
});

document.getElementById('btn-calc-all')?.addEventListener('click', () => {
    const el = document.getElementById('panel-calc');
    if (el) {
        el.style.display = 'flex';
        bringToFront(el);
        updateTaskbar();
    }
    window.performCalcAll();
});

// --- DYNAMIC UI: MATERIALS (แท็บ), PROJECT I/O ---
refreshNewMaterialTabs();

// วัสดุตัวแทนของวัตถุ (สำหรับกลุ่มใช้วัสดุของลูกชิ้นแรกที่พบ)
function representativeMaterial(obj) {
    if (!obj) return DEFAULT_MATERIAL;
    if (obj.isMesh) return getMaterialId(obj);
    let found = DEFAULT_MATERIAL;
    obj.traverse(o => {
        if (o.isMesh && o.userData.material && MATERIALS[o.userData.material]) found = o.userData.material;
    });
    return found;
}

function syncMaterialDropdown(obj) {
    if (!obj) return;
    renderMaterialTabs('material-tabs-prop', representativeMaterial(obj), (id) => {
        if (!selectedObject) return;
        pushUndo();
        applyMaterialTo(selectedObject, id);
        updateSelectionOutline(selectedObject);
        refreshObjectList();
        updateRealtimeCalc();
        syncMaterialDropdown(selectedObject);
    });
}

document.getElementById('btn-duplicate')?.addEventListener('click', () => {
    if (!selectedObject) { alert(t('alert.selectObjectFirst')); return; }
    copySelected();
    pasteClipboard();
});

document.getElementById('btn-new-group')?.addEventListener('click', () => {
    createEmptyGroup();
});

document.getElementById('btn-group-selected')?.addEventListener('click', () => {
    const list = Array.from(multiSelected);
    if (list.length < 2) {
        alert(t('alert.tickAtLeast2'));
        return;
    }
    createGroupFromObjects(list);
    multiSelected.clear();
});

document.getElementById('btn-ungroup-selected')?.addEventListener('click', () => {
    if (!selectedObject || !selectedObject.isGroup) {
        alert(t('alert.selectGroupToUngroup'));
        return;
    }
    ungroupSelected();
});

document.getElementById('btn-reset-view')?.addEventListener('click', () => {
    if (typeof window.__clearAxisLock === 'function') window.__clearAxisLock();
    camera.position.set(10, 8, 12);
    camera.up.set(0, 1, 0);
    orbit.target.set(0, 0, 0);
    camera.lookAt(orbit.target);
    // Same root cause as the axis-view fix above: if a Top/Bottom view was
    // ever visited, camera.up got mutated and OrbitControls' cached
    // up-alignment quaternion (fixed at construction time) goes stale —
    // must rebuild controls, not just orbit.update(), or view stays tilted.
    rebuildOrbitControls();
});

// --- 12. SAVE / LOAD PROJECT (.json) ---
document.getElementById('btn-save-project')?.addEventListener('click', () => {
    // Uses ProjectSerializer (src/persistence/) so the parametric
    // building model is saved alongside the legacy free-form objects
    // under one file, versioned (project spec §43-44).
    // Wall meshes now live in `objects` too (for grouping/etc.), but their
    // real data is the BuildingModel wall, already saved via
    // saveProjectData's own `building` key — skip re-serializing them here
    // or load would double them up.
    const data = parametric.saveProjectData(
        objects.filter(o => !o.userData.parametricWallId).map(o => serializeObject(o))
    );
    // แนบวัสดุกำหนดเอง + texture ที่ตั้งค่าไว้ (ข้อ 6) ไปกับไฟล์โปรเจกต์ด้วย
    // เพื่อให้เปิดไฟล์นี้บนเครื่อง/เบราว์เซอร์อื่นแล้วยังเห็นวัสดุ/texture เดิมครบ
    data.materials = serializeMaterialRegistry();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'boq-project.json';
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('btn-load-project')?.addEventListener('click', () => {
    document.getElementById('file-load-project')?.click();
});

document.getElementById('file-load-project')?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            // โหลดวัสดุกำหนดเอง/texture ของไฟล์นี้ก่อน (ถ้ามี) แล้วรีเฟรช registry + แท็บวัสดุ
            // ให้ทันก่อนที่ buildFromData ด้านล่างจะสร้าง mesh ที่อาจอ้างอิงวัสดุกำหนดเองเหล่านั้น
            if (data.materials) {
                loadMaterialRegistry(data.materials);
                refreshMaterialsRegistry();
                refreshNewMaterialTabs();
            }
            // FIX (root cause of "wall/parametric object disappears after load"):
            // parametric.loadProjectData() -> renderer.renderAll() creates fresh wall
            // meshes and (via onWallMeshCreated) pushes them into `objects` DURING this
            // call. The old code cleared `objects` (scene.remove + dispose) AFTER calling
            // loadProjectData, which nuked the just-created wall meshes it had pushed in,
            // then rebuilt `objects` only from the legacy list — so every parametric wall
            // vanished immediately after every Load. Must clear old scene state FIRST,
            // then load, so the freshly rendered walls are never in the disposal sweep.
            pushUndo();
            objects.forEach(o => { scene.remove(o); disposeObject(o); });
            objects = [];
            const list = parametric.loadProjectData(data);
            list.forEach(d => {
                const obj = buildFromData(d);
                scene.add(obj);
                objects.push(obj);
            });
            selectObject(null);
            refreshObjectList();
            updateRealtimeCalc();
            refreshFloorSwitcher();
            syncLandPlotOverlayToActiveFloor();
            syncCutGraphToActiveFloor();
        } catch (err) {
            alert(t('alert.openFail', { msg: tData(err.message) }));
        }
        e.target.value = '';
    };
    reader.readAsText(file);
});

// --- SMOOTH WHEEL ZOOM ---
// ซูมแบบ "ย่อ/ขยายรอบจุดใต้เคอร์เซอร์" (กล้องและจุดเป้าหมายถูกสเกลรอบจุดเดียวกัน)
// ทิศการมองไม่เปลี่ยน จุดใต้เมาส์อยู่ที่เดิมบนจอ และค่อยๆ เลื่อนด้วย easing ต่อเฟรม (ไม่กระโดด)
const smoothZoom = (() => {
    const MIN_DIST = 0.3, MAX_DIST = 3000;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const anchor = new THREE.Vector3();
    let pending = 0;      // ปริมาณซูมที่ยังเหลือ (log-scale)
    let lastWheel = 0;
    const el = renderer.domElement;

    function pickAnchor(clientX, clientY) {
        const rect = el.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const dist = camera.position.distanceTo(orbit.target);
        const hit = new THREE.Vector3();
        const ok = ray.ray.intersectPlane(plane, hit);
        const t = ok ? hit.distanceTo(camera.position) : Infinity;
        // ใช้จุดบนพื้นถ้าอยู่ข้างหน้าและไม่ไกลเกินไป ไม่งั้นใช้จุดบนรังสีที่ระยะเท่าเป้าหมาย
        if (ok && t > 0.01 && t < dist * 4) anchor.copy(hit);
        else anchor.copy(ray.ray.origin).addScaledVector(ray.ray.direction, dist);
    }

    el.addEventListener('wheel', (e) => {
        if (!orbit.enabled) return;
        e.preventDefault();
        const now = performance.now();
        if (now - lastWheel > 200 || pending === 0) pickAnchor(e.clientX, e.clientY);
        lastWheel = now;
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
        const dy = Math.max(-300, Math.min(300, e.deltaY * unit));
        pending += dy * 0.0016; // + = ซูมออก
    }, { passive: false });

    return function step() {
        if (Math.abs(pending) < 1e-4) { pending = 0; return; }
        const f = pending * 0.25; // easing: ใช้ 25% ของที่เหลือต่อเฟรม
        pending -= f;
        let s = Math.exp(f);
        const dist = camera.position.distanceTo(orbit.target);
        const nd = Math.max(MIN_DIST, Math.min(MAX_DIST, dist * s));
        s = nd / dist;
        if (Math.abs(s - 1) < 1e-6) { pending = 0; return; }
        camera.position.sub(anchor).multiplyScalar(s).add(anchor);
        orbit.target.sub(anchor).multiplyScalar(s).add(anchor);
    };
})();

// --- 14. ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);
    if (outlineHelper) outlineHelper.update();
    smoothZoom();
    orbit.update();
    // ระยะตัดภาพไกล (far) ต้องตามระยะกล้องเสมอ ไม่งั้นซูมออกไกลแล้วฉากหายไปทั้งหมด (โดยเฉพาะโหมด 2D ที่กล้องถอยไกลมาก)
    {
        const camDist = camera.position.distanceTo(orbit.target);
        const needFar = Math.max(1000, camDist * 2 + 1000);
        const needNear = camDist > 200 ? 1 : 0.1;
        if (Math.abs(camera.far - needFar) > 1 || camera.near !== needNear) {
            camera.far = needFar; camera.near = needNear; camera.updateProjectionMatrix();
        }
    }
    if (typeof window.__correctAxisLockDrift === 'function') window.__correctAxisLockDrift();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    if (typeof window.updateViewGizmo === 'function') window.updateViewGizmo();
}
animate();
updateStatusBar();
// --- 15. VIEWPORT TOOLBAR + QUICKSTART ---
let currentTool = 'translate';

function applyCurrentTool() {
    if (!selectedObject) { transformControl.visible = false; return; }
    if (currentTool === 'select') {
        transformControl.enabled = false;
        transformControl.visible = false;
    } else {
        transformControl.enabled = true;
        transformControl.visible = true;
        transformControl.setMode(currentTool);   // 'translate' | 'rotate' | 'scale'
    }
}

function setTool(tool) {
    currentTool = tool;
    applyCurrentTool();
    document.querySelectorAll('.vp-tool[data-tool]').forEach(b =>
        b.classList.toggle('active', b.dataset.tool === tool));
}

document.querySelectorAll('#viewport-toolbar .vp-tool[data-tool]').forEach(btn =>
    btn.addEventListener('click', () => setTool(btn.dataset.tool)));

(function initQuickstart() {
    const qs = document.getElementById('quickstart');
    if (!qs) return;
    let hidden = false;
    try { hidden = localStorage.getItem('boq_hide_quickstart') === '1'; } catch (e) {}
    if (hidden) { qs.style.display = 'none'; return; }
    document.getElementById('qs-close')?.addEventListener('click', () => {
        const chk = document.getElementById('qs-dontshow-chk');
        if (chk && chk.checked) { try { localStorage.setItem('boq_hide_quickstart', '1'); } catch (e) {} }
        qs.style.display = 'none';
    });
})();

// --- 16. RESIZABLE WINDOWS (ลากขอบ/มุมเพื่อปรับขนาดหน้าต่าง) ---
let rsState = null;

function makeResizable(panel) {
    if (!panel || panel.dataset.resizable === '1') return;
    panel.dataset.resizable = '1';
    [['rh-e', 'e'], ['rh-s', 's'], ['rh-se', 'se']].forEach(([cls, axes]) => {
        const h = document.createElement('div');
        h.className = 'resize-handle ' + cls;
        h.addEventListener('mousedown', (e) => startResize(e, panel, axes));
        panel.appendChild(h);
    });
}

function startResize(e, panel, axes) {
    e.preventDefault();
    e.stopPropagation();
    bringToFront(panel);
    const rect = panel.getBoundingClientRect();
    rsState = {
        panel, axes,
        startX: e.clientX, startY: e.clientY,
        startW: rect.width, startH: rect.height
    };
    // ปลดเพดานขนาดเดิม เพื่อให้ขยายได้อิสระ แล้วบังคับให้เนื้อหาเลื่อนแทน
    panel.style.maxHeight = 'none';
    panel.style.maxWidth = 'none';
    panel.classList.add('resizing');
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeUp);
}

function onResizeMove(e) {
    if (!rsState) return;
    const { panel, axes, startX, startY, startW, startH } = rsState;
    if (axes.indexOf('e') !== -1) {
        panel.style.width = Math.max(200, startW + (e.clientX - startX)) + 'px';
    }
    if (axes.indexOf('s') !== -1) {
        panel.style.height = Math.max(120, startH + (e.clientY - startY)) + 'px';
    }
}

function onResizeUp() {
    if (rsState) rsState.panel.classList.remove('resizing');
    rsState = null;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeUp);
    if (typeof window.updateViewportRegion === 'function') window.updateViewportRegion();
}

// ใส่ที่จับปรับขนาดให้ทุกหน้าต่างในระบบ
document.querySelectorAll('.window-panel').forEach(makeResizable);

// --- กันหน้าต่างหลุดจอ: ดึงกลับเข้าจอเมื่อย่อ/ขยายหน้าต่างเบราว์เซอร์ ---
function clampAllPanels() {
    const MIN_VISIBLE = 120, TOP_BAR = 40;
    document.querySelectorAll('.window-panel').forEach(p => {
        if (getComputedStyle(p).display === 'none') return;
        const w = p.offsetWidth;
        let top = p.offsetTop, left = p.offsetLeft;
        top = Math.max(TOP_BAR, Math.min(top, window.innerHeight - 36));
        left = Math.max(MIN_VISIBLE - w, Math.min(left, window.innerWidth - MIN_VISIBLE));
        p.style.top = top + 'px';
        p.style.left = left + 'px';
    });
}
window.addEventListener('resize', clampAllPanels);