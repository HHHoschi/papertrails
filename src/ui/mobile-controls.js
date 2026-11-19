// Mobile on-screen controls (owner: UI). Movement already works on touch via player/controls.js
// (tap / drag to walk uses Pointer Events, which fire for touch too). What's missing on a phone is
// everything that was a physical-keyboard shortcut: run, night/day, music, camera view, the map.
// This module adds a small row of translucent buttons for those, wired up by dispatching the exact
// same synthetic keyboard events the desktop listeners already handle - no game logic is duplicated.
//
// Only shown on touch-capable devices (or ?mobileui=1 to force it for testing on desktop).

function isTouchDevice() {
  const params = new URLSearchParams(location.search);
  if (params.get('mobileui') === '1') return true;
  if (params.get('mobileui') === '0') return false;
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
}

function dispatchKey(type, init) {
  window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));
}

function tapButton(label, title) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  const s = b.style;
  s.width = '44px';
  s.height = '44px';
  s.borderRadius = '50%';
  s.border = '1px solid rgba(255, 240, 214, 0.35)';
  s.background = 'rgba(28, 19, 13, 0.55)';
  s.color = 'rgba(255, 240, 214, 0.92)';
  s.font = '500 18px/1 Georgia, "Times New Roman", serif';
  s.display = 'flex';
  s.alignItems = 'center';
  s.justifyContent = 'center';
  s.padding = '0';
  s.pointerEvents = 'auto';
  s.touchAction = 'none';
  s.webkitTapHighlightColor = 'transparent';
  s.userSelect = 'none';
  s.webkitUserSelect = 'none';
  s.backdropFilter = 'blur(2px)';
  return b;
}

/**
 * @param {{ daynight?: {toggle():void}, music?: {toggle():void} }} [opts] unused for now - every
 * action is routed through the same keydown/keyup events the desktop controls already listen for,
 * so this module stays decoupled from the rest of the boot sequence.
 */
export function createMobileControls() {
  if (!isTouchDevice()) return { dispose() {} };

  const root = document.createElement('div');
  root.id = 'mobile-controls';
  const rs = root.style;
  rs.position = 'fixed';
  rs.right = 'max(10px, env(safe-area-inset-right))';
  rs.bottom = 'max(10px, env(safe-area-inset-bottom))';
  rs.display = 'flex';
  rs.gap = '10px';
  rs.alignItems = 'center';
  rs.zIndex = '10';
  rs.pointerEvents = 'none'; // only the buttons themselves are interactive

  const map = tapButton('▤', 'Karte (Tab)'); // ▤
  const night = tapButton('☽', 'Tag / Nacht (N)'); // ☽
  const view = tapButton('◉', 'Kamera (V)'); // ◉
  const music = tapButton('♪', 'Musik (M)'); // ♪
  const run = tapButton('››', 'Halten zum Rennen'); // ››

  const tapToggle = (btn, code) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dispatchKey('keydown', { code, key: code === 'KeyE' ? 'e' : code === 'KeyN' ? 'n' : code === 'KeyV' ? 'v' : 'm' });
    });
  };
  tapToggle(map, 'KeyE'); // atlasmap.js also accepts KeyE for Tab
  tapToggle(night, 'KeyN');
  tapToggle(view, 'KeyV');
  tapToggle(music, 'KeyM');

  // Run: held, not toggled - mirrors Shift down/up exactly so controls.js's own run/speed logic is untouched.
  let runHeld = false;
  const pressRun = (e) => {
    e.preventDefault();
    if (runHeld) return;
    runHeld = true;
    run.style.background = 'rgba(255, 196, 90, 0.55)';
    dispatchKey('keydown', { key: 'Shift', code: 'ShiftLeft' });
  };
  const releaseRun = (e) => {
    e.preventDefault();
    if (!runHeld) return;
    runHeld = false;
    run.style.background = 'rgba(28, 19, 13, 0.55)';
    dispatchKey('keyup', { key: 'Shift', code: 'ShiftLeft' });
  };
  run.addEventListener('pointerdown', pressRun);
  run.addEventListener('pointerup', releaseRun);
  run.addEventListener('pointercancel', releaseRun);
  run.addEventListener('pointerleave', releaseRun);

  for (const b of [map, night, view, music, run]) { b.style.pointerEvents = 'auto'; root.appendChild(b); }
  document.body.appendChild(root);

  function dispose() {
    releaseRun({ preventDefault() {} });
    root.remove();
  }
  return { dispose };
}
