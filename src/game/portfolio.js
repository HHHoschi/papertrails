// Portfolio (owner: game). The sketchbook shows Jörg's works: framed paper pictures stand along a winding trail from
// the start; walking up to one opens it large (image, title, year, text, link). Content: public/portfolio/works.json
// ({ cover: { title, author, hint }, works: [{ id, title, year, text, image, link }] }), images next to it.
// A sketchbook cover is shown first and opens on a click (?cover=0 skips it). ?portfolio=0 turns all of this off.
//
// Stations rise out of the page like the tiles (a spring on a hinge at their foot) when the traveller comes near and
// fold flat again when he leaves. Visited works are remembered in localStorage.
import * as THREE from 'three';
import { bus } from '../core/events.js';

const BASE = './portfolio/';
const RISE_NEAR = 3.4; // world units: stand up inside this distance ...
const RISE_FAR = 4.4; // ... fold flat beyond this one
const OPEN_DIST = 0.85; // walking this close opens the work
const REARM_DIST = 1.2; // after closing, step this far away before it opens again
const CARD_H = 0.62; // picture height (world units); a tile is 2 units, the traveller 0.6
const FIRST = 2.4; // distance of the first station from the start
const STEP = 2.3; // spacing along the trail
const VISITED_KEY = 'papertrails:portfolio:visited';

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

const CSS = `
.pf-cover { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at 50% 45%, #3a271b 0%, #1c130d 70%); perspective: 1600px; cursor: pointer;
  transition: opacity 0.9s ease 0.9s; font-family: Georgia, 'Times New Roman', serif; }
.pf-cover.gone { opacity: 0; pointer-events: none; }
.pf-book { position: relative; width: min(64vw, 460px); aspect-ratio: 3 / 4; transform-style: preserve-3d;
  transform: rotateX(8deg); transition: transform 1.4s cubic-bezier(.3,.1,.2,1); }
.pf-cover.open .pf-book { transform: rotateX(0deg) translateX(min(16vw, 115px)) scale(1.04); }
.pf-page, .pf-front { position: absolute; inset: 0; border-radius: 4px 14px 14px 4px; }
.pf-page { background: #fbf6ea; box-shadow: 0 30px 60px rgba(0,0,0,.55), inset 12px 0 18px -10px rgba(80,50,20,.35);
  background-image: repeating-linear-gradient(0deg, transparent 0 27px, rgba(120,150,190,.18) 27px 28px); }
.pf-page::after { content: ''; position: absolute; left: 14%; top: 22%; width: 60%; height: 40%;
  border: 2px solid rgba(60,40,30,.35); border-radius: 46% 54% 40% 60%; transform: rotate(-6deg); }
.pf-front { transform-origin: left center; transition: transform 1.4s cubic-bezier(.5,.05,.3,1); backface-visibility: hidden;
  background: #8a3b22; background-image: radial-gradient(circle at 30% 20%, rgba(255,255,255,.08), transparent 60%),
  repeating-linear-gradient(45deg, rgba(0,0,0,.04) 0 2px, transparent 2px 5px);
  box-shadow: 0 30px 60px rgba(0,0,0,.6), inset 0 0 0 1px rgba(0,0,0,.25), inset 10px 0 0 rgba(0,0,0,.18);
  display: flex; flex-direction: column; align-items: center; justify-content: center; color: #f6e7c8; text-align: center; }
.pf-cover.open .pf-front { transform: rotateY(-165deg); }
.pf-front .t { font-size: clamp(28px, 6vw, 46px); letter-spacing: .06em; }
.pf-front .a { margin-top: 14px; font-size: clamp(14px, 2.4vw, 18px); letter-spacing: .2em; text-transform: uppercase; opacity: .85; }
.pf-front .label { border: 1.5px solid rgba(246,231,200,.6); padding: 26px 30px; background: rgba(0,0,0,.08); }
.pf-band { position: absolute; top: -2%; bottom: -2%; right: 13%; width: 14px; background: #2b1d16; border-radius: 3px;
  box-shadow: 0 0 6px rgba(0,0,0,.5); transition: opacity .3s; }
.pf-cover.open .pf-band { opacity: 0; }
.pf-hint { position: absolute; bottom: 6vh; left: 0; right: 0; text-align: center; color: rgba(255,240,214,.75);
  font: 500 13px/1 Georgia, serif; letter-spacing: .16em; transition: opacity .4s; }
.pf-cover.open .pf-hint { opacity: 0; }

.pf-view { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
  background: rgba(20, 13, 8, 0.55); opacity: 0; pointer-events: none; transition: opacity .35s ease; padding: 16px; box-sizing: border-box; }
.pf-view.on { opacity: 1; pointer-events: auto; }
.pf-card { position: relative; background: #fbf6ea; color: #3a2a20; max-width: min(980px, 100%); max-height: 100%; overflow: auto;
  box-shadow: 0 24px 60px rgba(0,0,0,.5); padding: 22px 22px 18px; transform: rotate(-.6deg) scale(.96); transition: transform .35s ease;
  font-family: Georgia, 'Times New Roman', serif; box-sizing: border-box; cursor: default; }
.pf-view.on .pf-card { transform: rotate(-.6deg) scale(1); }
.pf-card img { display: block; max-width: 100%; max-height: 62vh; margin: 0 auto; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
.pf-card h2 { margin: 18px 0 4px; font-size: 26px; font-weight: 600; }
.pf-card .y { font-size: 14px; letter-spacing: .14em; opacity: .65; }
.pf-card p { margin: 10px 0 0; font-size: 16px; line-height: 1.5; max-width: 62ch; }
.pf-card a.more { display: inline-block; margin-top: 12px; color: #b8341f; font-size: 15px; }
.pf-close { position: absolute; top: 6px; right: 10px; border: 0; background: none; font: 28px/1 Georgia, serif; color: #6b5444; cursor: pointer; padding: 6px; }
.pf-count { position: absolute; bottom: 10px; right: 16px; font-size: 12px; letter-spacing: .14em; opacity: .5; }
`;

export function createPortfolio(ctx) {
  const { scene, world, traveller, controls } = ctx;
  const params = new URLSearchParams(location.search);
  const off = { update() {}, dispose() {}, open: false, cover: false };
  if (params.get('portfolio') === '0') return off;

  const style = el('style', null, document.head);
  style.textContent = CSS;

  let data = null;
  const stations = [];
  let placed = false;
  let visited = {};
  try { visited = JSON.parse(localStorage.getItem(VISITED_KEY) || '{}') || {}; } catch { visited = {}; }

  // ---- cover -------------------------------------------------------------------------------------
  const api = { open: false, cover: params.get('cover') !== '0', update, dispose, stations };
  let coverEl = null;
  function buildCover(c) {
    coverEl = el('div', 'pf-cover', document.body);
    const book = el('div', 'pf-book', coverEl);
    el('div', 'pf-page', book);
    const front = el('div', 'pf-front', book);
    const label = el('div', 'label', front);
    el('div', 't', label, (c && c.title) || 'Skizzenbuch');
    if (c && c.author) el('div', 'a', label, c.author);
    el('div', 'pf-band', front);
    el('div', 'pf-hint', coverEl, (c && c.hint) || 'Zum Öffnen klicken');
    const openIt = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (coverEl.classList.contains('open')) return;
      coverEl.classList.add('open');
      bus.emit('input:first', {}); // the click is the first gesture: audio may start
      setTimeout(() => { coverEl.classList.add('gone'); }, 900);
      setTimeout(() => { api.cover = false; coverEl.remove(); coverEl = null; }, 2000);
      window.removeEventListener('keydown', onCoverKey, true);
    };
    function onCoverKey(e) { e.preventDefault(); e.stopPropagation(); if (e.code === 'Enter' || e.code === 'Space') openIt(); }
    coverEl.addEventListener('pointerdown', openIt);
    window.addEventListener('keydown', onCoverKey, true); // nothing reaches the game until the book is open
  }

  // ---- large view ----------------------------------------------------------------------------------
  const view = el('div', 'pf-view', document.body);
  const card = el('div', 'pf-card', view);
  const close = el('button', 'pf-close', card, '×');
  close.setAttribute('aria-label', 'Schließen');
  const img = el('img', null, card);
  const h2 = el('h2', null, card);
  const year = el('div', 'y', card);
  const text = el('p', null, card);
  const more = el('a', 'more', card, 'Mehr ansehen →');
  more.target = '_blank'; more.rel = 'noopener';
  const count = el('div', 'pf-count', card);
  let current = null;
  function show(st) {
    const w = st.work;
    current = st;
    img.src = BASE + w.image; img.alt = w.title || '';
    h2.textContent = w.title || '';
    year.textContent = w.year || '';
    text.textContent = w.text || '';
    more.style.display = w.link ? '' : 'none';
    if (w.link) more.href = w.link;
    count.textContent = (st.index + 1) + ' / ' + stations.length;
    view.classList.add('on');
    api.open = true;
    if (controls && controls.clearTarget) controls.clearTarget();
    if (!visited[w.id]) { visited[w.id] = 1; try { localStorage.setItem(VISITED_KEY, JSON.stringify(visited)); } catch { /* private mode */ } }
    bus.emit('portfolio:open', { id: w.id, index: st.index });
  }
  function hide() {
    if (!api.open) return;
    view.classList.remove('on');
    api.open = false;
    if (current) current.armed = false;
    current = null;
  }
  close.addEventListener('click', hide);
  view.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === view) hide(); });
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  function onKey(e) {
    if (!api.open) return;
    if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); hide(); }
    else if (/^(Key[WASDE]|Arrow|Tab)/.test(e.code)) { e.stopPropagation(); }
  }
  window.addEventListener('keydown', onKey, true);

  // ---- stations in the world -----------------------------------------------------------------------
  const loader = new THREE.TextureLoader();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf3ead6, roughness: 0.95, side: THREE.DoubleSide });
  const backMat = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.95 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.9 });
  const seenMat = new THREE.MeshStandardMaterial({ color: 0xe8682a, roughness: 0.8 });

  function makeStation(work, index, x, z) {
    const root = new THREE.Group();
    root.name = 'portfolio-' + work.id;
    root.position.set(x, (world.heightAt && world.heightAt(x, z)) || 0, z);
    root.rotation.y = ((index * 37) % 21 - 10) * Math.PI / 180; // a little askew, like propped-up sketches
    const hinge = new THREE.Group(); // the foot: the card folds about it like a tile flap
    root.add(hinge);
    const tex = loader.load(BASE + work.image, (t) => {
      const a = t.image && t.image.width ? t.image.width / t.image.height : 4 / 3;
      size(a);
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const picMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.012), [frameMat, frameMat, frameMat, frameMat, frameMat, backMat]);
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), picMat);
    frame.castShadow = true; pic.castShadow = false; frame.receiveShadow = true;
    hinge.add(frame, pic);
    // easel leg behind and a small tab with a dot that turns orange once the work was seen
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, CARD_H * 0.95, 0.012), legMat);
    leg.castShadow = true;
    hinge.add(leg);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), visited[work.id] ? seenMat : frameMat);
    hinge.add(dot);
    function size(aspect) {
      const h = CARD_H; const w = Math.min(1.1, h * aspect);
      const hh = w / aspect;
      frame.scale.set(w + 0.07, hh + 0.07, 1);
      frame.position.set(0, 0.06 + (hh + 0.07) / 2, 0);
      pic.scale.set(w, hh, 1);
      pic.position.set(0, frame.position.y, 0.0075);
      leg.position.set(0, (hh + 0.13) * 0.45, -0.12);
      leg.rotation.x = -0.32;
      dot.position.set(w / 2 - 0.02, 0.06 + 0.035 + 0.01, 0.0076);
    }
    size(4 / 3);
    scene.add(root);
    const st = { work, index, root, hinge, dot, x, z, p: 0, v: 0, target: 0, armed: true, pic, picMat, tex };
    pose(st);
    return st;
  }
  function pose(st) {
    const shown = st.p > 0.002;
    st.root.visible = shown;
    st.hinge.rotation.x = -(Math.PI / 2) * (1 - st.p); // flat on the page, face up, at p = 0
  }

  /** A free spot near (x, z): room for the picture and for the traveller in front of it. */
  function freeSpot(x, z) {
    const room = (a, b) => (world.clearance ? world.clearance(a, b) : (world.isWalkable(a, b) ? 1 : -1));
    for (let r = 0; r <= 1.6; r += 0.2) {
      const n = r === 0 ? 1 : Math.round(r * 14);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = x + Math.cos(a) * r; const pz = z + Math.sin(a) * r;
        if (room(px, pz) > 0.25 && room(px, pz + 0.45) > 0.15) return [px, pz];
      }
    }
    return [x, z];
  }

  function place() {
    placed = true;
    const sx = traveller.position.x; const sz = traveller.position.z;
    data.works.forEach((w, i) => {
      // a winding trail leading north (into the picture) from the start
      const d = FIRST + i * STEP;
      const [x, z] = freeSpot(sx + Math.sin(i * 1.3 + 0.6) * 0.6, sz - d);
      stations.push(makeStation(w, i, x, z));
    });
    bus.emit('portfolio:placed', { count: stations.length });
  }

  fetch(BASE + 'works.json').then((r) => (r.ok ? r.json() : null)).then((j) => {
    data = j && Array.isArray(j.works) ? j : { works: [] };
    if (api.cover) buildCover(data.cover);
  }).catch(() => { data = { works: [] }; api.cover = false; });

  const K = 60; const C = 9; // hinge spring (stiff, a little bouncy, like the tile flaps)
  function update(dt) {
    if (!data) return;
    if (!placed) place();
    const p = traveller.position;
    for (const st of stations) {
      const d = Math.hypot(p.x - st.x, p.z - st.z);
      if (d < RISE_NEAR) st.target = 1; else if (d > RISE_FAR) st.target = 0;
      if (st.p !== st.target || st.v !== 0) {
        const h = Math.min(dt, 1 / 30);
        st.v += (K * (st.target - st.p) - C * st.v) * h;
        st.p += st.v * h;
        if (st.target === 0 && st.p <= 0) { st.p = 0; st.v = 0; }
        if (Math.abs(st.target - st.p) < 1e-3 && Math.abs(st.v) < 1e-3) { st.p = st.target; st.v = 0; }
        pose(st);
      }
      if (!api.open && !api.cover && st.armed && st.p > 0.8 && d < OPEN_DIST) show(st);
      if (!st.armed && d > REARM_DIST) st.armed = true;
      if (visited[st.work.id] && st.dot.material !== seenMat) st.dot.material = seenMat;
    }
  }

  function dispose() {
    window.removeEventListener('keydown', onKey, true);
    for (const st of stations) { scene.remove(st.root); st.tex.dispose(); st.picMat.dispose(); }
    view.remove(); style.remove(); if (coverEl) coverEl.remove();
  }
  return api;
}
