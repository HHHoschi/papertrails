// The dino's pistol (owner: game). Space / F (or the mobile fire button) shoots a paper pellet from the gun in the
// dino's hand. The pellet flies straight ahead, dipping slowly toward the page; the first stand-up piece it meets
// (tree, bush, fence, sign, house ...) tips over and stays down (world.shoot does the hit test and the fall).
// Purely visual + world state: no game progress depends on it. ?blaster=0 turns it off.
import * as THREE from 'three';
import { bus } from '../core/events.js';
import { sight } from '../world/world.js';

const SPEED = 9; // world units / s
const RANGE = 6; // world units before the pellet is spent
const DROP = 0.06; // downward slope (units down per unit forward): long shots reach the low bushes and rocks
const COOLDOWN = 0.28; // s between shots
const MAX_LIVE = 6;
// gun muzzle in the arm_r part of dino.glb (tools/dino/build_dino.py: gun at hand + slide front)
const MUZZLE = new THREE.Vector3(-0.006, -0.038, 0.13);

export function createBlaster({ scene, world, traveller, modal }) {
  const params = new URLSearchParams(location.search);
  if (params.get('blaster') === '0') return { update() {}, fire() {}, dispose() {} };

  const pelletGeo = new THREE.SphereGeometry(0.03, 10, 8);
  const pelletMat = new THREE.MeshBasicMaterial({ color: 0x2b2420 });
  const flashGeo = new THREE.SphereGeometry(0.035, 8, 6);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc45a, transparent: true, opacity: 0.95, depthWrite: false });
  const puffMat = new THREE.MeshBasicMaterial({ color: 0xf0e3c6, transparent: true, opacity: 0.9, depthWrite: false });

  const pellets = [];
  const puffs = [];
  let cool = 0;
  const _o = new THREE.Vector3();
  const _f = new THREE.Vector3();

  function muzzle(out) {
    const arm = traveller.group && traveller.group.getObjectByName('arm_r');
    const root = traveller.group && traveller.group.getObjectByName('traveller');
    const isDino = !!(root && root.userData && root.userData.variant === 'dino');
    if (arm && isDino) {
      arm.updateWorldMatrix(true, false);
      return out.copy(MUZZLE).applyMatrix4(arm.matrixWorld);
    }
    const p = traveller.position;
    return out.set(p.x, p.y + 0.32, p.z);
  }

  function puff(pos, scale = 1) {
    const m = new THREE.Mesh(flashGeo, puffMat.clone());
    m.position.copy(pos);
    m.scale.setScalar(0.6 * scale);
    m.renderOrder = 5;
    scene.add(m);
    puffs.push({ m, t: 0, life: 0.35, grow: 2.2 * scale });
  }

  function fire() {
    if (cool > 0 || (modal && modal())) return;
    if (pellets.length >= MAX_LIVE) return;
    cool = COOLDOWN;
    const h = traveller.heading;
    _f.set(Math.sin(h), 0, Math.cos(h)); // the model faces +Z, the group turns by `heading`
    muzzle(_o).addScaledVector(_f, 0.02);
    const dir = new THREE.Vector3(_f.x, -DROP, _f.z).normalize();
    const m = new THREE.Mesh(pelletGeo, pelletMat);
    m.position.copy(_o);
    scene.add(m);
    pellets.push({ m, dir, left: RANGE });
    // muzzle flash
    const fl = new THREE.Mesh(flashGeo, flashMat.clone());
    fl.position.copy(_o);
    fl.renderOrder = 5;
    scene.add(fl);
    puffs.push({ m: fl, t: 0, life: 0.09, grow: 1.6 });
    bus.emit('blaster:fire', { x: _o.x, z: _o.z });
  }

  function onKey(e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' || e.code === 'KeyF') { e.preventDefault(); fire(); }
  }
  window.addEventListener('keydown', onKey);

  function update(dt) {
    if (cool > 0) cool -= dt;
    for (let i = pellets.length - 1; i >= 0; i--) {
      const b = pellets[i];
      const step = Math.min(b.left, SPEED * dt);
      const p = b.m.position;
      const hit = step > 0 ? world.shoot(p.x, p.y, p.z, b.dir.x, b.dir.y, b.dir.z, step) : -1;
      let end = false;
      if (hit >= 0) {
        p.addScaledVector(b.dir, hit);
        puff(p, 1.2);
        bus.emit('blaster:hit', { x: p.x, y: p.y, z: p.z, what: sight.lastShot });
        end = true;
      } else {
        p.addScaledVector(b.dir, step);
        b.left -= step;
        const ground = (world.heightAt && world.heightAt(p.x, p.z)) || 0;
        if (p.y <= ground + 0.01) { p.y = ground + 0.01; puff(p, 0.6); end = true; } else if (b.left <= 0) end = true;
      }
      if (end) { scene.remove(b.m); pellets.splice(i, 1); }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const q = puffs[i];
      q.t += dt;
      const k = q.t / q.life;
      if (k >= 1) { scene.remove(q.m); q.m.material.dispose(); puffs.splice(i, 1); continue; }
      q.m.scale.setScalar(0.6 + q.grow * k);
      q.m.material.opacity = 0.95 * (1 - k);
    }
  }

  function dispose() {
    window.removeEventListener('keydown', onKey);
    for (const b of pellets) scene.remove(b.m);
    for (const q of puffs) scene.remove(q.m);
    pelletGeo.dispose(); pelletMat.dispose(); flashGeo.dispose(); flashMat.dispose(); puffMat.dispose();
  }

  return { update, fire, dispose };
}
