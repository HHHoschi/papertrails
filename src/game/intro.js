// Opening sequence (owner: game). The world starts as a closed sketchbook lying on the table. A click (or Enter / Space)
// opens it: the front cover swings over the spine to the left, the two blank pages lie open, the print inks in from the
// traveller outward, the camera dives into the book and the trees and houses fold up in a wave around him.
// ?cover=0 (or ?intro=0) skips it. Cover text comes from public/portfolio/works.json ({ cover: { title, author, hint } }).
//
// Nothing here is a second world: the pages ARE the real page (book.js cuts it to the two pages and holds the ink back
// via book.setIntro), and the tiles rise through the world's own streaming (state.introRise scales the reveal ring).
import * as THREE from 'three';
import { bus } from '../core/events.js';
import { state } from '../core/state.js';
import { CONFIG } from '../core/config.js';

const PW = 12; // page width (world units); the gutter period is 14, so the next gutters stay off the pages
const PH = 8.5; // half page height
const OV = 0.35; // cover overhang
const OPEN_T = 1.9; // s: the cover swings over
const INK_T0 = 1.7; const INK_T1 = 4.2; // s: the print inks in
const DIVE_T0 = 3.0; const DIVE_T1 = 6.6; // s: the camera dives into the book
const RISE_T0 = 3.9; const RISE_T1 = 6.4; // s: the world folds up around the traveller
const END_T = 6.8;

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeIO = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const span = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function createIntro(ctx) {
  const { scene, world, traveller, follow, controls } = ctx;
  const params = new URLSearchParams(location.search);
  const book = world.book;
  const skip = params.get('cover') === '0' || params.get('intro') === '0' || !book || !book.setIntro;
  const api = { active: !skip, update() {}, dispose() {} };
  if (skip) return api;

  state.introRise = 0;
  const camera = follow.camera;
  const T = (CONFIG.book && CONFIG.book.blockThickness) || 0.25;
  const CT = (CONFIG.book && CONFIG.book.coverThickness) || 0.07;
  const coverColor = '#9a4529'; // a little lighter than the table-side board: the closed book is seen from far, in the dark
  const g = book.gutterX; // the spine: the gutter nearest the start
  const sx = traveller.position.x; const sz = traveller.position.z;
  const zc = sz - 1.2; // the pages reach a little further north (up the screen), where the walk goes
  const rect = [g - PW, zc - PH, g + PW, zc + PH];

  // ---- the book's own pieces (only while the intro runs; the real book has no edges in view) ------------------------
  const root = new THREE.Group();
  root.name = 'intro-book';
  scene.add(root);
  const edgeTex = canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#f7efdc'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) { c.fillStyle = `rgba(120, 90, 60, ${0.10 + ((y * 7) % 5) * 0.03})`; c.fillRect(0, y, w, 1); }
  });
  edgeTex.wrapS = edgeTex.wrapT = THREE.RepeatWrapping;
  edgeTex.repeat.set(8, 1);
  const edgeMat = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.95 });
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const creamMat = new THREE.MeshStandardMaterial({ color: (CONFIG.palette && CONFIG.palette.paper) || '#efe0c2', roughness: 0.92 });
  const boardMat = new THREE.MeshStandardMaterial({ color: coverColor, roughness: 0.85 });
  const owned = [edgeTex, edgeMat, hidden, creamMat, boardMat];

  /** One half of the book in pivot space (spine at x = 0, page top at y = 0); sx = -1: leaf toward -x, +1: toward +x. */
  function half(withTop, sx = -1) {
    const h = new THREE.Group();
    const blockGeo = new THREE.BoxGeometry(PW, T, PH * 2);
    // box faces: +x, -x, +y, -y, +z, -z (the outer edge is -x for the left leaf, +x for the right one)
    const outer = sx < 0 ? [hidden, edgeMat] : [edgeMat, hidden];
    const block = new THREE.Mesh(blockGeo, [...outer, withTop ? creamMat : hidden, hidden, edgeMat, edgeMat]);
    block.position.set((sx * PW) / 2, -T / 2 - 0.004, 0);
    const board = new THREE.Mesh(new THREE.BoxGeometry(PW + OV, CT, PH * 2 + OV * 2), boardMat);
    board.position.set((sx * (PW + OV)) / 2, -T - 0.004 - CT / 2, 0);
    for (const m of [block, board]) { m.castShadow = true; m.receiveShadow = true; h.add(m); owned.push(m.geometry); }
    return h;
  }
  // right half (static), left half (shown once the cover has landed), the lid (front cover + the left pages)
  const right = half(false, 1); right.position.set(g, 0, zc);
  const left = half(false); left.position.set(g, 0, zc); left.visible = false;
  const lid = new THREE.Group(); lid.position.set(g, 0, zc);
  const lidHalf = half(true);
  lid.add(lidHalf);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.6, CT, PH * 2 + OV * 2), boardMat);
  spine.position.set(g, -T - 0.004 - CT / 2, zc);
  owned.push(spine.geometry);
  root.add(right, left, lid, spine);

  // front cover label: drawn on the outside of the lid's board (faces down when open, up when closed)
  let labelMat = null;
  function makeLabel(c) {
    const W = 1024; const H = Math.round((W * (PH * 2 + OV * 2)) / (PW + OV));
    const tex = canvasTex(W, H, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.save();
      x.translate(w / 2, h / 2); x.rotate(Math.PI); x.translate(-w / 2, -h / 2); // the board is turned over when closed
      x.strokeStyle = 'rgba(246, 231, 200, 0.75)'; x.lineWidth = 6;
      const bw = w * 0.62; const bh = h * 0.24;
      x.strokeRect((w - bw) / 2, h * 0.3, bw, bh);
      x.fillStyle = '#f6e7c8'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = `${Math.round(w * 0.085)}px Georgia, 'Times New Roman', serif`;
      x.fillText((c && c.title) || 'Skizzenbuch', w / 2, h * 0.3 + bh * 0.42);
      if (c && c.author) {
        x.font = `${Math.round(w * 0.034)}px Georgia, serif`;
        const a = String(c.author).toUpperCase().split('').join(' ');
        x.fillText(a, w / 2, h * 0.3 + bh * 0.76);
      }
      // the elastic band
      x.fillStyle = '#2b1d16'; x.fillRect(w * 0.84, 0, w * 0.035, h);
      x.restore();
    });
    labelMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.85 });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(PW + OV, PH * 2 + OV * 2).rotateX(Math.PI / 2), labelMat);
    label.position.set(-(PW + OV) / 2, -T - 0.004 - CT - 0.002, 0);
    lidHalf.add(label);
    owned.push(tex, labelMat, label.geometry);
  }

  // ---- hint ----------------------------------------------------------------------------------------------------
  const hintEl = document.createElement('div');
  hintEl.style.cssText = 'position:fixed;left:0;right:0;bottom:7vh;text-align:center;z-index:30;color:rgba(255,240,214,.85);'
    + "font:500 14px/1 Georgia,serif;letter-spacing:.16em;pointer-events:none;transition:opacity .4s;text-shadow:0 1px 6px rgba(0,0,0,.5)";
  hintEl.textContent = 'Zum Öffnen klicken';
  document.body.appendChild(hintEl);
  const gameHint = document.getElementById('hint');
  if (gameHint) gameHint.style.visibility = 'hidden';

  fetch('./portfolio/works.json').then((r) => (r.ok ? r.json() : null)).then((j) => {
    const c = (j && j.cover) || {};
    makeLabel(c);
    if (c.hint) hintEl.textContent = c.hint;
  }).catch(() => makeLabel(null));

  // ---- state ---------------------------------------------------------------------------------------------------
  let t = -1; // < 0: closed, waiting for the click
  let landed = false;
  let idle = 0;
  traveller.group.visible = false;
  lid.rotation.z = -Math.PI;
  book.setIntro({ rect: [g, rect[1], rect[2], rect[3]], ink: [sx, sz, 0] });

  function start(e) {
    if (t >= 0) return;
    if (e) { e.preventDefault(); e.stopPropagation(); }
    t = 0;
    hintEl.style.opacity = '0';
    bus.emit('input:first', {}); // the click is the first gesture: audio may start
    bus.emit('fold', { x: g + PW / 2, z: zc, size: 3, dir: 'up', pan: 0 });
  }
  function onKey(e) {
    if (!api.active) return;
    e.stopPropagation();
    if (t < 0 && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); start(); }
  }
  function onPointer(e) {
    if (!api.active) return;
    e.stopPropagation();
    if (t < 0) start(e);
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onPointer, true);

  // ---- camera --------------------------------------------------------------------------------------------------
  const _pos = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _look = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const PITCH = 62 * Math.PI / 180;
  const FOV = 30;
  /** Distance at which a w x h rectangle on the table fills the frame (with a margin). */
  function fit(w, h) {
    const v = Math.tan((FOV * Math.PI) / 360);
    const a = camera.aspect || 16 / 9;
    const dh = (h * Math.sin(PITCH) * 0.5 + 0.6) / v; // the page foreshortened by the pitch
    const dw = (w * 0.5) / (v * a);
    return Math.max(dh, dw) * 1.12;
  }
  /** The intro camera: looking at (x, zc) from the south, `d` away, at PITCH. */
  function introPose(x, d, out, q) {
    _look.set(x, 0, zc);
    out.set(x, Math.sin(PITCH) * d, zc + Math.cos(PITCH) * d);
    _m.lookAt(out, _look, _up);
    q.setFromRotationMatrix(_m);
  }

  function update(dt) {
    if (!api.active) return;
    // where the follow camera wants to be this frame (it ran just before us)
    const fPos = camera.position.clone();
    const fQ = camera.quaternion.clone();
    const fFov = camera.fov;

    if (t < 0) idle += dt; else t += dt;
    state.introClock = t;
    const tt = Math.max(0, t);

    // cover
    const o = easeIO(span(tt, 0, OPEN_T));
    lid.rotation.z = -Math.PI * (1 - o);
    if (!landed && o >= 1) {
      landed = true;
      lid.visible = false; left.visible = true;
      bus.emit('fold', { x: g - PW / 2, z: zc, size: 3, dir: 'down', pan: 0 });
    }
    // the left page shows once the cover has passed upright (it is under the lid from then on)
    const showLeft = o > 0.5;
    const r = 26 * ease(span(tt, INK_T0, INK_T1));
    book.setIntro({ rect: [showLeft ? rect[0] : g, rect[1], rect[2], rect[3]], ink: [sx, sz, r] });
    if (!traveller.group.visible && r > 1.2) traveller.group.visible = true;
    state.introRise = ease(span(tt, RISE_T0, RISE_T1));

    // camera: closed book framed -> open spread framed -> dive into the follow camera
    const pan = easeIO(span(tt, 0.2, OPEN_T + 0.4));
    const dClosed = fit(PW + 1, PH * 2 + 1);
    const dOpen = fit(PW * 2 + 1.5, PH * 2 + 1.5);
    const breathe = t < 0 ? Math.sin(idle * 0.8) * 0.15 : 0;
    introPose(g + (PW / 2) * (1 - pan), dClosed + (dOpen - dClosed) * pan + breathe, _pos, _q);
    const k = easeIO(span(tt, DIVE_T0, DIVE_T1));
    camera.position.lerpVectors(_pos, fPos, k);
    camera.quaternion.slerpQuaternions(_q, fQ, k);
    const fov = FOV + (fFov - FOV) * k;
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    // keep the depth of field on the book until the camera arrives
    _look.set(g + (PW / 2) * (1 - pan), 0, zc);
    follow.focusPoint.lerpVectors(_look, follow.focusPoint, k);

    if (t >= END_T) finish();
  }

  function finish() {
    api.active = false;
    state.introRise = 1;
    book.setIntro(null);
    traveller.group.visible = true;
    camera.fov = follow.pose.fov; camera.updateProjectionMatrix();
    if (controls && controls.clearTarget) controls.clearTarget();
    dispose();
    if (gameHint) {
      gameHint.style.visibility = '';
      gameHint.classList.add('on');
      const off = () => { gameHint.classList.remove('on'); window.removeEventListener('keydown', off); window.removeEventListener('pointerdown', off); };
      window.addEventListener('keydown', off); window.addEventListener('pointerdown', off);
    }
    bus.emit('intro:done', {});
  }

  function dispose() {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointer, true);
    scene.remove(root);
    hintEl.remove();
    for (const x of owned) if (x && x.dispose) x.dispose();
  }

  api.update = update;
  api.dispose = () => { if (api.active) { api.active = false; state.introRise = 1; book.setIntro(null); traveller.group.visible = true; dispose(); } };
  api.finish = () => { if (api.active) finish(); };
  return api;
}
