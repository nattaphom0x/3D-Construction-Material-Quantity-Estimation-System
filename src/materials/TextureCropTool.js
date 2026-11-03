import { t } from '../i18n/i18n.js';
/**
 * TextureCropTool — lets the user pick exactly which rectangular region of
 * an uploaded texture image gets used, instead of always using the whole
 * file. Shows a modal with the image and a rectangle overlay with 4
 * draggable corner handles; the user can move each corner (and drag the
 * rectangle itself) to select the desired crop area, then confirm to get
 * back a new data URL cropped to that region at full source resolution.
 *
 * Only works for raster formats a <canvas>/<img> can decode (png/jpg/webp).
 * .exr files are raw float data, not decodable this way, so callers should
 * skip this tool for those and use the uploaded file as-is.
 */

const EXR_MAGIC = [0x76, 0x2f, 0x31, 0x01];

/** Sniff the EXR magic number so callers can skip the crop UI for it (mirrors TextureCache's check, kept local to avoid a circular import). */
export function isLikelyExrDataUrl(dataUrl) {
    const idx = typeof dataUrl === 'string' ? dataUrl.indexOf('base64,') : -1;
    if (idx === -1) return false;
    try {
        const bin = atob(dataUrl.slice(idx + 7, idx + 7 + 12));
        return EXR_MAGIC.every((b, i) => bin.charCodeAt(i) === b);
    } catch {
        return false;
    }
}

let modalEl = null;
let canvasEl = null;
let ctx = null;
let img = null;
let displayScale = 1; // canvas px -> source image px multiplier
let rect = { x: 0, y: 0, w: 0, h: 0 }; // in canvas px
let drag = null; // { mode: 'move'|'nw'|'ne'|'sw'|'se', startX, startY, startRect }
let resolvePromise = null;

const HANDLE_R = 9; // hit-test radius for corner handles, in canvas px
const MIN_SIZE = 24; // minimum crop box size, in canvas px

function ensureDom() {
    if (modalEl) return;
    modalEl = document.createElement('div');
    modalEl.id = 'texture-crop-modal';
    modalEl.innerHTML = `
        <div class="qs-card tex-crop-card">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                <div>
                    <h2>${t('crop.title')}</h2>
                    <p class="qs-sub">${t('crop.sub')}</p>
                </div>
                <button class="win-btn btn-close" id="tex-crop-close">×</button>
            </div>
            <div class="tex-crop-canvas-wrap">
                <canvas id="tex-crop-canvas"></canvas>
            </div>
            <div class="tex-crop-actions">
                <button type="button" class="calc-btn" id="tex-crop-reset">${t('crop.reset')}</button>
                <div style="flex:1"></div>
                <button type="button" class="calc-btn" id="tex-crop-cancel">${t('crop.cancel')}</button>
                <button type="button" class="calc-btn qs-close-btn" id="tex-crop-apply">${t('crop.apply')}</button>
            </div>
        </div>`;
    document.body.appendChild(modalEl);
    canvasEl = modalEl.querySelector('#tex-crop-canvas');
    ctx = canvasEl.getContext('2d');

    modalEl.querySelector('#tex-crop-close').addEventListener('click', () => finish(null));
    modalEl.querySelector('#tex-crop-cancel').addEventListener('click', () => finish(null));
    modalEl.querySelector('#tex-crop-apply').addEventListener('click', () => finish(cropToDataURL()));
    modalEl.querySelector('#tex-crop-reset').addEventListener('click', () => {
        rect = { x: 0, y: 0, w: canvasEl.width, h: canvasEl.height };
        draw();
    });
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) finish(null); });

    canvasEl.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    canvasEl.addEventListener('touchstart', onPointerDown, { passive: false });
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);
}

function getPos(e) {
    const r = canvasEl.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return {
        x: (p.clientX - r.left) * (canvasEl.width / r.width),
        y: (p.clientY - r.top) * (canvasEl.height / r.height),
    };
}

function corners() {
    return {
        nw: { x: rect.x, y: rect.y },
        ne: { x: rect.x + rect.w, y: rect.y },
        sw: { x: rect.x, y: rect.y + rect.h },
        se: { x: rect.x + rect.w, y: rect.y + rect.h },
    };
}

function hitHandle(pos) {
    const c = corners();
    for (const key of Object.keys(c)) {
        const dx = pos.x - c[key].x, dy = pos.y - c[key].y;
        if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_R * 1.6) return key;
    }
    return null;
}

function hitInside(pos) {
    return pos.x >= rect.x && pos.x <= rect.x + rect.w && pos.y >= rect.y && pos.y <= rect.y + rect.h;
}

function onPointerDown(e) {
    e.preventDefault();
    const pos = getPos(e);
    const handle = hitHandle(pos);
    if (handle) {
        drag = { mode: handle, startPos: pos, startRect: { ...rect } };
    } else if (hitInside(pos)) {
        drag = { mode: 'move', startPos: pos, startRect: { ...rect } };
    }
}

function onPointerMove(e) {
    if (!drag) return;
    e.preventDefault();
    const pos = getPos(e);
    const dx = pos.x - drag.startPos.x;
    const dy = pos.y - drag.startPos.y;
    const s = drag.startRect;
    const maxW = canvasEl.width, maxH = canvasEl.height;

    if (drag.mode === 'move') {
        rect.x = clamp(s.x + dx, 0, maxW - s.w);
        rect.y = clamp(s.y + dy, 0, maxH - s.h);
        rect.w = s.w;
        rect.h = s.h;
    } else {
        // Resize by dragging one corner while the opposite corner stays fixed.
        let left = s.x, top = s.y, right = s.x + s.w, bottom = s.y + s.h;
        if (drag.mode === 'nw') { left = s.x + dx; top = s.y + dy; }
        if (drag.mode === 'ne') { right = s.x + s.w + dx; top = s.y + dy; }
        if (drag.mode === 'sw') { left = s.x + dx; bottom = s.y + s.h + dy; }
        if (drag.mode === 'se') { right = s.x + s.w + dx; bottom = s.y + s.h + dy; }

        left = clamp(left, 0, maxW);
        right = clamp(right, 0, maxW);
        top = clamp(top, 0, maxH);
        bottom = clamp(bottom, 0, maxH);

        if (right - left < MIN_SIZE) {
            if (drag.mode === 'nw' || drag.mode === 'sw') left = right - MIN_SIZE;
            else right = left + MIN_SIZE;
        }
        if (bottom - top < MIN_SIZE) {
            if (drag.mode === 'nw' || drag.mode === 'ne') top = bottom - MIN_SIZE;
            else bottom = top + MIN_SIZE;
        }
        rect = { x: left, y: top, w: right - left, h: bottom - top };
    }
    draw();
}

function onPointerUp() { drag = null; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function draw() {
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);

    // Dim everything outside the crop rect.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, canvasEl.width, canvasEl.height);
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.fill('evenodd');

    // Rect border.
    ctx.strokeStyle = '#7fd8ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    // Thirds guide lines (rule-of-thirds, purely visual aid).
    ctx.strokeStyle = 'rgba(127,216,255,0.5)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
        const gx = rect.x + (rect.w * i) / 3;
        const gy = rect.y + (rect.h * i) / 3;
        ctx.beginPath(); ctx.moveTo(gx, rect.y); ctx.lineTo(gx, rect.y + rect.h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rect.x, gy); ctx.lineTo(rect.x + rect.w, gy); ctx.stroke();
    }

    // Corner handles.
    const c = corners();
    ctx.fillStyle = '#7fd8ff';
    Object.values(c).forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
        ctx.strokeStyle = '#0b1a22';
        ctx.lineWidth = 2;
        ctx.stroke();
    });
}

function cropToDataURL() {
    const sx = rect.x * displayScale;
    const sy = rect.y * displayScale;
    const sw = Math.max(1, rect.w * displayScale);
    const sh = Math.max(1, rect.h * displayScale);

    const out = document.createElement('canvas');
    out.width = Math.round(sw);
    out.height = Math.round(sh);
    const octx = out.getContext('2d');
    octx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
}

function finish(result) {
    modalEl.classList.remove('open');
    drag = null;
    if (resolvePromise) { resolvePromise(result); resolvePromise = null; }
}

/**
 * Opens the crop UI on the given image data URL.
 * Resolves with a new cropped data URL, or null if the user cancelled.
 */
export function openTextureCropTool(dataUrl) {
    if (!dataUrl || isLikelyExrDataUrl(dataUrl)) return Promise.resolve(null);
    ensureDom();
    return new Promise((resolve) => {
        img = new Image();
        img.onload = () => {
            // Fit the canvas to the modal while keeping it crisp: cap the
            // display size but keep displayScale so the final crop is read
            // back out at full source resolution, not the shrunk preview size.
            const maxW = Math.min(720, window.innerWidth * 0.8);
            const maxH = Math.min(520, window.innerHeight * 0.6);
            const fit = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
            canvasEl.width = Math.round(img.naturalWidth * fit);
            canvasEl.height = Math.round(img.naturalHeight * fit);
            displayScale = img.naturalWidth / canvasEl.width;
            rect = { x: 0, y: 0, w: canvasEl.width, h: canvasEl.height };
            resolvePromise = resolve;
            modalEl.classList.add('open');
            draw();
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}
