/* A flight session (docs/flight-plan.md, step S4): one craft flown inside an existing 3D Earth view (earthgl.js Earth3D.create(...)).
   Used by the test page (fly.html, flight/fly-start.js) and by the flight menu in the 3D view (flight/menu.js). Builds the craft layer, the
   core (flight/core.js) with the craft's force modules, the visuals (flight/gfx.js), the live F-16 cockpit (flight/instruments/f16.js), the
   screen HUD (flight/hud.js), the controls bar, the key help and, for the test spacecraft, the mission panel + orbit lines (from S1).
   EN only for now (RO / DE later: every new string is listed in the plan, S4). */
import { createCore, R_E, fromF, qFromBasis } from './core.js?v=47034b95';
import { createScreenHud, dur, km } from './hud.js?v=eff5db9f';
import { fmt } from './instruments/draw.js?v=c3b9eb1c';

const D2R = Math.PI / 180;
// runway 03 threshold 45.6960 N, 25.5128 E; runway 21 end 45.7165 N, 25.5342 E -> true course 36.1°, 2823 m (airportguide.com, sprinkle.com);
// the craft stands 150 m past the threshold on the centre line
export const RWY = { lat: 45.6960 + .0205 * 150 / 2823, lon: 25.5128 + .0214 * 150 / 2823, heading: 36.1, name: 'LRBV' };
export const CRAFTS = {
  f16: { name: 'F-16', what: 'Fighter jet on runway 03 of Brașov-Ghimbav (LRBV). Flight model from NASA TP-1538 wind-tunnel tables; live cockpit instruments.' },
  orbiter: { name: 'Test spacecraft', what: 'A placeholder spacecraft in a 400 km orbit over Brașov: real orbital mechanics, missions that fly themselves, navball.' },
  rocket: { name: 'Rocket', what: 'A multi-stage launcher on a real pad, from published stage figures: autopilot to orbit, then a capsule back to the ground. Placeholder shapes.' } };
const KEYS = {
  f16: [['W / S', 'pitch (W = nose down)'], ['A / D', 'roll'], ['Q / E', 'yaw'], ['R / F', 'throttle up / down'], ['X', 'throttle to 0'], ['B', 'brakes'], ['G', 'gear'],
    ['C', 'next view: cockpit, chase, far chase, orbit'], ['M / Shift+M', 'next page on the left / right MFD'], ['Wheel, Z (hold)', 'zoom in the cockpit'], ['Drag', 'look around'],
    [', / .', 'slower / faster time (max ×4 in the air)'], ['Esc', 'leave the pilot seat']],
  orbiter: [['W / S', 'pitch'], ['A / D', 'roll'], ['Q / E', 'yaw'], ['R / F', 'throttle up / down'], ['X', 'engine off'], ['T', 'attitude hold on / off'], ['N', 'auto-execute the node'],
    ['Delete', 'remove the node'], ['C', 'next view'], ['Drag', 'look around'], [', / .', 'slower / faster time'], ['Esc', 'leave the pilot seat']],
  rocket: [['Space', 'launch (on the pad) / next stage'], ['P', 'autopilot on / off'], ['W / S, A / D, Q / E', 'pitch, roll, yaw rate (takes over from the autopilot)'], ['R / F', 'throttle up / down (manual)'],
    ['X', 'throttle to 0'], ['C', 'next view: auto, chase, side, tower, far chase'], ['Drag', 'look around'], [', / .', 'slower / faster time (max ×4 in the air)'], ['Esc', 'leave the pilot seat']] };

const STYLE = `.fl-on .e3g > :not(canvas), .fl-on .s3d-tabs, .fl-on .s3d-ctl, .fl-on .s3d-btns, .fl-on .s3d-time, .fl-on .s3d-info, .fl-on .s3d-top { display: none !important }
.fl-ui { position: absolute; inset: 0; z-index: 4; pointer-events: none; font: 500 13px Inter, system-ui, sans-serif; color: #E6EBF1 }
.fl-ui > * { pointer-events: auto }
.fl-ui button { border: 1px solid rgba(255,255,255,.25); background: rgba(10,14,20,.85); color: #E6EBF1; border-radius: 999px; padding: 6px 12px; min-height: 32px; font: 600 12px Inter, system-ui, sans-serif; cursor: pointer }
.fl-ui button[aria-pressed="true"] { border-color: #39FF9E; background: rgba(57,255,158,.16) } .fl-ui button:focus-visible { outline: 2px solid #FFE600; outline-offset: 2px }
.fl-ctl { position: absolute; right: 12px; top: 12px; display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; max-width: calc(100% - 24px) }
.fl-warps { display: flex; gap: 4px; flex-wrap: wrap }
.fl-st { position: absolute; left: 12px; top: 12px; max-width: min(460px, calc(100% - 24px)); padding: 6px 10px; border-radius: 10px; background: rgba(8,11,16,.78); border: 1px solid rgba(255,255,255,.14); line-height: 1.5 }
.fl-st b { color: #39FF9E; font-weight: 600 } .fl-st small { display: block; color: #9AA4B2; font-size: 11px }
.fl-help { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(420px, calc(100% - 32px)); max-height: calc(100% - 140px); overflow: auto; padding: 12px 14px; border-radius: 12px; background: rgba(8,11,16,.92); border: 1px solid rgba(255,255,255,.2) }
.fl-help h2 { margin: 0 0 8px; font: 600 14px Inter, system-ui, sans-serif } .fl-help table { border-collapse: collapse; width: 100% } .fl-help td { padding: 3px 6px; vertical-align: top } .fl-help td:first-child { color: #39FF9E; white-space: nowrap; font-weight: 600 }
.fl-help p { color: #AEB8C4; margin: 8px 0 0; font-size: 12px }
.fl-touch { position: absolute; inset: auto 0 0 0; height: 0 } .fl-touch > * { position: absolute; bottom: 16px; touch-action: none }
.fl-stick { left: 16px; width: 132px; height: 132px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35); background: rgba(10,14,20,.45); display: grid; place-items: center }
.fl-knob { width: 52px; height: 52px; border-radius: 50%; background: rgba(230,235,241,.55); pointer-events: none } .fl-stick span { position: absolute; top: -18px; font-size: 11px; color: #AEB8C4; text-shadow: 0 0 3px #000 }
.fl-tr { right: 16px; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; padding: 8px; border-radius: 12px; background: rgba(10,14,20,.6) } .fl-tr label { font-size: 12px; display: flex; flex-direction: column; gap: 4px }
.fl-tr input { width: 150px; height: 32px; accent-color: #39FF9E } .fl-tr div { display: flex; gap: 6px } .fl-tr button { min-height: 44px }
#orbl, .fl-orbl { position: absolute; inset: 0; z-index: 3; pointer-events: none; overflow: hidden }
.orb-l { position: absolute; left: 0; top: 0; margin: -9px 0 0 8px; white-space: nowrap; font: 600 11px Inter, system-ui, sans-serif; color: #E6EBF1; text-shadow: 0 0 3px #000, 0 0 3px #000 }
.orb-l::before { content: ''; position: absolute; left: -11px; top: 6px; width: 6px; height: 6px; border-radius: 50%; background: #39FF9E }
.orb-l b { color: #39FF9E } .orb-l.plan b { color: #FFB347 } .orb-l.plan::before { background: #FFB347 } .orb-l.hid { opacity: .45 } .orb-l span { color: #9AA4B2; font-weight: 500 }
.orb-p { position: absolute; left: 12px; top: 92px; width: 300px; max-height: calc(100% - 290px); overflow: auto; padding: 8px 10px; border: 1px solid rgba(255,255,255,.18); border-radius: 12px; background: rgba(10,14,20,.82); font-size: 12px }
.orb-p h2 { font: 600 12px Inter, system-ui, sans-serif; margin: 6px 0 4px; color: #9AA4B2 } .orb-p .row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; margin-bottom: 4px } .orb-p .row > span { min-width: 54px; color: #9AA4B2 }
.orb-p button { border-radius: 8px; padding: 3px 7px; font-size: 11px; min-height: 26px }
@media (max-width: 700px) { .orb-p { width: calc(100% - 40px); max-height: 30% } .fl-st { top: auto; bottom: 200px } }`;
function injectStyle() { if (document.getElementById('fl-style')) return; const s = document.createElement('style'); s.id = 'fl-style'; s.textContent = STYLE; document.head.appendChild(s); }

// earth = Earth3D.create(...); host = the element that holds the 3D view; o = { craft: 'f16' | 'orbiter', quality, onExit, alt (km), inc (deg) }
export async function startFlight(earth, host, o = {}) {
  injectStyle(); if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const kind = o.craft === 'orbiter' || o.craft === 'rocket' ? o.craft : 'f16', F = earth.flight(), THREE = F.THREE, keyList = KEYS[kind];
  // S7 quality: earthgl's 3D quality (⚙ 3D quality, light mode = low); phones (coarse pointer) get touch controls and no scanned cockpit unless asked
  const touch = o.touch ?? matchMedia('(pointer: coarse)').matches, quality = o.quality || F.quality || 'high';
  const scan = o.cockpit === false ? 'none' : touch || quality === 'low' ? (o.cockpit ? 'std' : 'none') : quality === 'medium' ? 'std' : 'hi';
  host.classList.add('fl-on');
  const ui = document.createElement('div'); ui.className = 'fl-ui'; host.appendChild(ui);
  ui.innerHTML = `<div class="fl-st" aria-live="off"><b>${CRAFTS[kind].name}</b> · Starting…</div>
    <div class="fl-ctl">${o.onExit ? '<button data-a="exit">✕ Exit flight</button>' : ''}<button data-a="pilot" aria-pressed="true">✈ Pilot</button><button data-a="view">View</button><button data-a="reset">Reset</button>
      <button data-a="keys" aria-expanded="true">Keys</button><div class="fl-warps" role="group" aria-label="Time speed"></div></div>
    <div class="fl-help" role="dialog" aria-label="Keys"><h2>${CRAFTS[kind].name}: keys</h2><table>${keyList.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <p>${kind === 'f16' ? 'Start: R to add throttle (past 50 % = afterburner), B releases the parking brake, pull back (S) at ~140 kt. A gamepad works too.' : kind === 'rocket' ? 'Press Launch (or Space): the autopilot flies to orbit and stages by itself. In orbit, "Deorbit and land" brings the capsule down under parachutes.' : 'Pick a mission on the left; the craft turns and burns by itself. Speed up time with the buttons at the top right.'}</p>
      ${touch ? `<p>Touch: drag the circle at the bottom left = stick (down = nose up, sideways = roll); the slider at the bottom right = throttle${kind === 'f16' ? ' (the parking brake lets go above 5 %; hold Brake to stop)' : ''}. Drag anywhere else = look around.</p>` : ''}
      <p><button data-a="keys">Close</button></p></div>`;
  const $ = s => ui.querySelector(s), st = $('.fl-st'), help = $('.fl-help');
  // craft layer: own scene + camera (near from the craft distance, set by gfx / below)
  const cs = new THREE.Scene(), cc = new THREE.PerspectiveCamera(35, 1, .05 / R_E, (kind === 'orbiter' ? 1e13 : 20000) / R_E);
  const sunL = new THREE.DirectionalLight(0xffffff, 3), amb = new THREE.HemisphereLight(0xbfd4ff, 0x40362a, .6); cs.add(sunL, sunL.target, amb);
  const craft = new THREE.Group(); craft.scale.setScalar(1 / R_E); cs.add(craft); F.craftLayer(cs, cc);
  const S = { kind, earth, F, cs, cc, craft, ui, core: null, gfx: null, cockpit: null, hud: null };
  let onPose = null, extraTick = null, extraDispose = null, credit = '', P0 = null;

  if (kind === 'f16') {
    const [{ loadAircraft }, { createGfx }, { createF16Cockpit }] = await Promise.all([import('./aero.js?v=5dfff859'), import('./gfx.js?v=2d4add6b'), import('./instruments/f16.js?v=584608da')]);
    const ac = await loadAircraft(new URL('aircraft/f16.json', import.meta.url)), def = ac.def;
    const core = S.core = createCore(F, def, RWY, { mods: ac.mods });
    try { S.gfx = await createGfx(F, core, { scene: cs, camera: cc, craft, sun: sunL, amb, model: 'f16', def, quality, scan }); }   /* credits: only in the 3D view's Sources list (user, 2026-11-14) */
    catch (e) { console.error('F-16 model', e); credit = '3D model not loaded'; }
    if (S.gfx && scan !== 'none') S.cockpit = createF16Cockpit(F, core, S.gfx, { quality }); else core.view = 1;   // no scanned cockpit: chase view, screen HUD in every view
    S.hud = createScreenHud(core, ui, { kind: 'air', hideInView: S.cockpit ? [0] : [] });
    onPose = (P, t) => { if (S.gfx) S.gfx.update(P, t); if (S.cockpit) S.cockpit.update(P, t); if (S.hud) S.hud.forceShow = !(S.gfx && S.gfx.cockpit); };
    o.atName = RWY.name;
  } else if (kind === 'rocket') {   // S5: flight/rocket.js builds the craft, views, panel
    const { setupRocket } = await import('./rocket.js?v=912c77e4'), RK = await setupRocket(S, o, ui, { sunL, createCore, createScreenHud });
    onPose = RK.onPose; extraTick = RK.tick; extraDispose = RK.dispose; credit = RK.credit;
  } else {
    const orbit = await import('./orbit.js?v=11d73788'), { createOrbit, gravityModule, orbiterModule, ORBITER, createOrbitView, BODIES } = orbit;
    const ALT = (o.alt || 400) * 1e3, INC = o.inc || 51.6, START = { lat: 45.64, lon: 25.59, heading: 0 };
    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], len = a => Math.hypot(a[0], a[1], a[2]);
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], unit = a => mul(a, 1 / len(a));
    const orb = createOrbit({ helio: F.solar.helio }), ctx = S.ctx = { orb, node: null, sas: 'hold', last: null }, def = ORBITER;
    const start = t => { const la = START.lat * D2R, lo = START.lon * D2R, a = R_E + 400 + ALT, mu = BODIES.Earth.gm;
      const U = [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)], E = [-Math.sin(lo), 0, -Math.cos(lo)], N = [-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo)];
      const b = Math.asin(Math.min(1, Math.cos(INC * D2R) / Math.cos(la))), dir = fromF(t, add(mul(N, Math.cos(b)), mul(E, Math.sin(b)))), r = fromF(t, mul(U, a));
      const Z = mul(dir, -1), Y = unit(r), X = cross(Y, Z); return { ref: 'Earth', r, v: mul(dir, Math.sqrt(mu / a)), q: qFromBasis(X, Y, Z), w: [0, 0, 0] }; };
    S.start = start;
    { const mat = (c, m = .2) => new THREE.MeshStandardMaterial({ color: c, roughness: .55, metalness: m });
      // PLACEHOLDER shape: can, engine bell at the back (+z), two solar panels, an orange nose cap, a green post on top (body +y)
      const can = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 5, 32), mat(0xd8dde4)); can.rotation.x = Math.PI / 2; craft.add(can);
      const bell = new THREE.Mesh(new THREE.ConeGeometry(.9, 1.4, 24, 1, true), mat(0x55585e, .6)); bell.rotation.x = -Math.PI / 2; bell.position.z = 3.1; craft.add(bell);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xff6a3d)); cap.rotation.x = -Math.PI / 2; cap.position.z = -2.5; craft.add(cap);
      for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(6, .05, 1.8), mat(0x1d2c5a, .4)); p.position.set(sx * 4.6, 0, .5); craft.add(p); }
      const top = new THREE.Mesh(new THREE.BoxGeometry(.2, .6, .2), mat(0x39ff9e)); top.position.set(0, 1.7, 0); craft.add(top); }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(.7, 6, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: .55, depthWrite: false }));
    flame.rotation.x = -Math.PI / 2; flame.position.z = 6.8; craft.add(flame);
    const labelsEl = document.createElement('div'); labelsEl.className = 'fl-orbl'; labelsEl.setAttribute('aria-hidden', 'true'); ui.prepend(labelsEl);
    const view = S.orbitView = createOrbitView(F, ctx, cs, labelsEl);
    const core = S.core = createCore(F, def, START, { mods: [gravityModule(ctx), orbiterModule(def, ctx)], start, warps: [1, 2, 4, 10, 60, 100, 1000, 10000] });
    S.hud = createScreenHud(core, ui, { kind: 'space', ctx });
    const M = orbiterPanel(S, orbit, ui); S.repredict = M.repredict;
    onPose = (P, t) => { flame.visible = core.state.eng[0] && core.state.eng[0].thrust > 0; flame.scale.setScalar(.4 + .6 * core.state.ctl.throttle);
      const cp = F.piloting ? core.camPose(t) : null, d = (cp ? cp.pos : F.camera.position).distanceTo(P.pos) * R_E; cc.near = Math.max(.05, Math.min(d - 20, d * .02)) / R_E;
      const sd = F.sun(); sunL.position.copy(P.pos).addScaledVector(sd, 100 / R_E); sunL.target.position.copy(P.pos); M.frame(t); view.frame(t, F.camera); };
    extraTick = M.tick; extraDispose = () => { M.dispose(); view.dispose && view.dispose(); };
    credit = 'Placeholder craft: 13 t, one 200 kN engine, Isp 320 s; gravity of the Sun, the planets, the Moon and the Earth J2';
  }

  const core = S.core;
  core.onPose = (P, t) => { craft.visible = !!P; if (P) { craft.position.copy(P.pos); craft.quaternion.copy(P.quat); if (!P0 && kind === 'f16') P0 = core.fixedPose(); onPose(P, t); } if (S.hud) S.hud.update(); };
  core.pilot(true);

  // ── controls
  const pb = $('[data-a="pilot"]'), wb = $('.fl-warps');
  core.onPilotOff = () => pb.setAttribute('aria-pressed', 'false');
  wb.innerHTML = core.warps.map(x => `<button data-w="${x}" aria-pressed="false">×${x.toLocaleString('en-GB')}</button>`).join('');
  ui.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; b.blur();
    if (b.dataset.w) { core.setWarp(+b.dataset.w); return; }
    const a = b.dataset.a;
    if (a === 'exit') stop();
    else if (a === 'pilot') { const on = pb.getAttribute('aria-pressed') !== 'true'; core.pilot(on); pb.setAttribute('aria-pressed', String(on)); }
    else if (a === 'view') core.view = core.view + 1;
    else if (a === 'keys') { help.hidden = !help.hidden; $('[data-a="keys"]').setAttribute('aria-expanded', String(!help.hidden)); }
    else if (a === 'reset') { if (S.reset) S.reset(); else if (kind === 'f16') { if (P0) core.reset(P0); } else { const s = core.state; S.ctx.node = null; S.ctx.sas = 'hold'; S.ctx.dvUsed = 0; s.ctl.throttle = 0;
      core.reset(core.fixedPose()); Object.assign(s, S.start(s.t)); s.contact = []; S.repredict && S.repredict(); } } });
  // cockpit zoom: wheel (field of view 20-80°), Z held = 25°
  const ckView = core.def.views[0], fov0 = ckView.fov || 60; let zHeld = false, fovSet = fov0;
  const onWheel = e => { if (!F.piloting || core.view !== 0 || !ckView.fov) return; fovSet = Math.max(20, Math.min(80, fovSet * Math.exp(Math.sign(e.deltaY) * .1))); if (!zHeld) ckView.fov = fovSet; };
  const onKey = e => { if (e.code !== 'KeyZ' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input,textarea,select')) return; zHeld = e.type === 'keydown'; ckView.fov = zHeld ? 25 : fovSet; };
  if (kind === 'f16') { F.renderer.domElement.addEventListener('wheel', onWheel, { passive: true }); addEventListener('keydown', onKey); addEventListener('keyup', onKey); }
  setTimeout(() => { if (!help.hidden) { help.hidden = true; $('[data-a="keys"]').setAttribute('aria-expanded', 'false'); } }, 12000);

  // status line (5 Hz): craft, place / orbit, view, time speed, physics cost, credit
  const timer = setInterval(() => { const h = core.hud, sts = core.stats;
    for (const b of wb.querySelectorAll('[data-w]')) b.setAttribute('aria-pressed', String(Math.abs(+b.dataset.w - (h.warp || 1)) < 1e-6));
    if (extraTick && !core.hold) extraTick();
    if (core.hold) { st.innerHTML = `<b>${CRAFTS[kind].name}</b> · ${kind === 'f16' ? 'Waiting for the ground heights at ' + RWY.name + '…' : 'Starting…'}`; return; }
    const vName = h.view || '', where = kind === 'f16' ? (h.crash ? `<b style="color:#FF6B6B">Crash: ${h.crash}</b>` : h.onGround ? 'on the ground at ' + RWY.name : 'flying') : 'around ' + (h.ref || '–');
    st.innerHTML = `<b>${CRAFTS[kind].name}</b> · ${where} · View: ${vName}${kind === 'f16' && core.view === 0 && S.cockpit ? ' (' + Math.round(ckView.fov) + '°)' : ''} · Time ×${fmt(h.warp, 0)}${kind === 'f16' ? ' (max ×' + sts.warpCap + ' in the air)' : h.onRails ? ' (on rails)' : ''}
      <small>Physics ${fmt(sts.ms, 2)} ms / frame${S.cockpit && S.cockpit.group.visible ? ` · HUD ${fmt(S.cockpit.stats.hudMs, 2)} ms · displays ${fmt(S.cockpit.stats.dynMs, 2)} ms` : ''}${credit ? ' · ' + credit : ''}</small>`; }, 200);

  function stop() { clearInterval(timer); core.onPose = null; core.touch = null; if (S.touchUi) S.touchUi.dispose();
    const gpu = new Set(); cs.traverse(n => { if (n.geometry) gpu.add(n.geometry); for (const m of [].concat(n.material || [])) { gpu.add(m); for (const v of Object.values(m)) if (v && v.isTexture) gpu.add(v);
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture) gpu.add(u.value); } });   // freed after the modules let go (S7: nothing left on the GPU)
    core.dispose(); if (S.cockpit) S.cockpit.dispose(); if (S.gfx) S.gfx.dispose(); if (S.hud) S.hud.dispose(); if (extraDispose) extraDispose();
    F.renderer.domElement.removeEventListener('wheel', onWheel); removeEventListener('keydown', onKey); removeEventListener('keyup', onKey);
    F.craftLayer(null); for (const x of gpu) x.dispose(); sunL.dispose(); ui.remove(); host.classList.remove('fl-on'); if (o.onExit) o.onExit(); }
  if (touch) S.touchUi = touchControls(S, ui, kind);
  S.stop = stop; S.instruments = on => { if (S.cockpit) S.cockpit.on = on; if (S.hud) S.hud.on = on; };   // tests: all instruments off / on
  return S;
}

// ── test spacecraft: missions first, the manual node on request (S1 user test, 2026-11-14: "too complicated")
function orbiterPanel(S, orbit, ui) {
  const { nodeUpdate, BODIES } = orbit, core = S.core, ctx = S.ctx, orb = ctx.orb, GEO = 42164e3;
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const SAS = [['off', 'Off'], ['hold', 'Hold'], ['pro', 'Prograde'], ['retro', 'Retrograde'], ['normal', 'Normal'], ['anti', 'Anti-normal'], ['radial', 'Radial out'], ['antirad', 'Radial in'], ['node', 'Node']];
  const panel = document.createElement('div'); panel.className = 'orb-p'; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Orbit controls');
  const dvRow = (k, name) => `<div class="row"><span>${name}</span>${[-100, -10, -1, 1, 10, 100].map(x => `<button data-dv="${k}" data-x="${x}">${x > 0 ? '+' : '−'}${Math.abs(x)}</button>`).join('')}</div>`;
  const MIS = [['up', 'Raise the orbit by 100 km', 'Two automatic burns: one to climb, one at the top to make the orbit round again.'],
    ['down', 'Lower the orbit by 100 km', 'Two automatic burns: one to drop, one at the bottom to make the orbit round again.'],
    ['round', 'Make the orbit round', 'One automatic burn at the next high or low point.'],
    ['geo', 'Fly to geostationary orbit', 'Two automatic burns to 35 800 km, where one orbit takes a day. The second burn comes ~5 h later: speed up time with the buttons at the top right.'],
    ['stop', 'Cancel', 'Cancels the plan and stops the engine.']];
  panel.innerHTML = `<h2>What do you want to do?</h2>${MIS.map(([k, n, d]) => `<div class="row"><button data-m="${k}" title="${d}">${n}</button></div>`).join('')}
    <p class="misS" aria-live="polite" style="margin:6px 0 4px;color:#E6EBF1"></p>
    <details><summary style="cursor:pointer;color:#9AA4B2">Advanced (manual node)</summary>
    <h2>Attitude</h2><div class="row">${SAS.map(([k, n]) => `<button data-sas="${k}" aria-pressed="false">${n}</button>`).join('')}</div>
    <h2>Manoeuvre node</h2><div class="row"><button data-n="ap">At next Ap</button><button data-n="pe">At next Pe</button><button data-n="t10">In 10 min</button><button data-n="del">Delete</button></div>
    ${dvRow(0, 'Prograde')}${dvRow(1, 'Normal')}${dvRow(2, 'Radial')}
    <div class="row"><button data-n="tm">Node −1 min</button><button data-n="tp">Node +1 min</button></div>
    <div class="row"><button data-n="circA">Circularise at Ap</button><button data-n="circP">Circularise at Pe</button><button data-n="geo">Hohmann to GEO</button></div>
    <div class="row"><button data-n="auto" aria-pressed="false">Execute (auto)</button></div></details>`;
  ui.appendChild(panel);
  let tPredReal = 0, dirty = true, mission = null;
  function repredict() { const s = core.state, stt = { ref: s.ref, r: s.r.slice(), v: s.v.slice(), t: s.t }, N = ctx.node; const cur = orb.predict(stt); let plan = null;
    if (N && N.phase !== 'done') { plan = N.phase === 'burn' && N.rem ? orb.predict(stt, { node: { t: s.t, dvI: N.rem } }) : orb.predict(stt, { node: { t: Math.max(N.t, s.t), dv: N.dv } }); if (N.phase === 'plan') nodeUpdate(ctx, s, plan); }
    ctx.last = { cur, plan, t: s.t, ms: cur.ms + (plan ? plan.ms : 0) }; S.orbitView && S.orbitView.set(ctx.last); dirty = false; tPredReal = performance.now(); }
  const mkNode = t => { ctx.node = { t, dv: [0, 0, 0], auto: false, phase: 'plan' }; dirty = true; };
  const nextEv = k => { const L = ctx.last; return L && L.cur.ev.find(e => e.kind === k && e.t > core.state.t + 1e3); };
  function circ(k) { const e = nextEv(k); if (!e) return; const mu = BODIES[e.ref].gm; mkNode(e.t); ctx.node.dv[0] = Math.sqrt(mu / len(e.r)) - len(e.v); }
  function geo() { mkNode(core.state.t + 600e3); repredict(); const ns = ctx.last.plan && ctx.last.plan.nodeState; if (!ns || ns.ref !== 'Earth') return;
    const mu = BODIES.Earth.gm, r = len(ns.r); ctx.node.dv[0] = Math.sqrt(mu * (2 / r - 2 / (r + GEO))) - len(ns.v); dirty = true; }
  function transferNode(r2) { mkNode(core.state.t + 120e3); repredict(); const ns = ctx.last.plan && ctx.last.plan.nodeState; if (!ns) { ctx.node = null; return; }
    const mu = BODIES[ns.ref].gm, r = len(ns.r); ctx.node.dv[0] = Math.sqrt(mu * (2 / r - 2 / (r + r2))) - len(ns.v); ctx.node.auto = true; dirty = true; }
  function roundNode(kind) { repredict(); const a = nextEv('ap'), p = nextEv('pe'), e = kind === 'ap' ? a : kind === 'pe' ? p : (a && p ? (a.t < p.t ? a : p) : a || p);
    if (!e) return; circ(e.kind); if (ctx.node) ctx.node.auto = true; }
  function startMission(k) { const s = core.state, r = len(s.r), B = BODIES[s.ref]; ctx.node = null; s.ctl.throttle = 0; dirty = true;
    if (k === 'stop') { mission = null; ctx.sas = 'hold'; return; }
    if (k === 'down' && r - 100e3 - B.surf < (B.atm || 0) + 100e3) { mission = { name: 'Too low: the orbit would touch the air', steps: [], n: 0, k: 0 }; return; }
    const r2 = k === 'up' ? r + 100e3 : k === 'down' ? r - 100e3 : GEO, steps = k === 'round' ? [() => roundNode()] : [() => transferNode(r2), () => roundNode(r2 > r ? 'ap' : 'pe')];
    mission = { name: MIS.find(m => m[0] === k)[1], steps, n: steps.length, k: 0 }; runMission(); }
  function runMission() { if (!mission || !mission.steps.length) return; mission.steps.shift()(); mission.k++; }
  function tick() { const el = panel.querySelector('.misS'), N = ctx.node, s = core.state, h = core.hud;
    for (const b of panel.querySelectorAll('[data-sas]')) b.setAttribute('aria-pressed', String(b.dataset.sas === ctx.sas));
    panel.querySelector('[data-n="auto"]').setAttribute('aria-pressed', String(!!(N && N.auto)));
    if (!mission) { el.textContent = ''; return; }
    if (N && N.phase === 'done') { ctx.node = null; if (mission.steps.length) runMission(); else mission.done = true; dirty = true; }
    const n = ctx.node, pre = `${mission.name}: `;
    if (mission.done || (!n && !mission.steps.length)) { el.textContent = mission.n ? pre + `done. Orbit now ${km(h.peri)} × ${km(h.apo)} km.` : mission.name; return; }
    if (!n) { el.textContent = pre + 'planning…'; return; }
    const step = mission.n > 1 ? `burn ${mission.k} of ${mission.n}` : 'burn';
    el.textContent = n.phase === 'burn' ? pre + `${step}: engine on, ${fmt(n.rem ? len(n.rem) : 0, 0)} m/s to go.`
      : pre + `${step} starts in ${dur((n.tStart - s.t) / 1e3)}. The craft turns by itself.${(n.tStart - s.t) > 300e3 ? ' To wait less, speed up time: the ×100 / ×1000 buttons at the top right (it slows down by itself before the burn).' : ''}`; }
  panel.onclick = ev => { const b = ev.target.closest('button'); if (!b) return; ev.stopPropagation(); b.blur(); const N = ctx.node;
    if (b.dataset.m) { startMission(b.dataset.m); return; }
    if (b.dataset.sas) { ctx.sas = b.dataset.sas; return; }
    if (b.dataset.dv) { if (!N || N.phase !== 'plan') return; N.dv[+b.dataset.dv] += +b.dataset.x; dirty = true; return; }
    const k = b.dataset.n;
    if (k === 'ap' || k === 'pe') { const e = nextEv(k); if (e) mkNode(e.t); }
    else if (k === 't10') mkNode(core.state.t + 600e3);
    else if (k === 'del') { ctx.node = null; dirty = true; }
    else if ((k === 'tm' || k === 'tp') && N && N.phase === 'plan') { N.t = Math.max(core.state.t + 5e3, N.t + (k === 'tp' ? 60e3 : -60e3)); dirty = true; }
    else if (k === 'circA') circ('ap'); else if (k === 'circP') circ('pe'); else if (k === 'geo') geo();
    else if (k === 'auto' && N && N.phase !== 'done') { N.auto = !N.auto; if (!N.auto && N.phase === 'burn') core.state.ctl.throttle = 0; } };
  // keys: T = hold / off, N = auto-execute, Delete = remove the node (the flight keys are in core.js)
  const onKey = e => { if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input,textarea,select') || !F_on()) return;
    if (e.code === 'KeyT') ctx.sas = ctx.sas === 'off' ? 'hold' : 'off';
    else if (e.code === 'KeyN' && ctx.node && ctx.node.phase !== 'done') ctx.node.auto = !ctx.node.auto;
    else if (e.code === 'Delete') { ctx.node = null; dirty = true; } };
  const F_on = () => !!S.F.piloting; addEventListener('keydown', onKey);
  // prediction: every second (4 / s while the engine burns), at once after a change of the node, when a labelled event has passed
  function frame(t) { const L = ctx.last, now = performance.now(), burning = core.state.ctl.throttle > 0;
    if (dirty || now - tPredReal > (burning ? 250 : 1000) || (L && L.cur.ev.some(e => e.t < t && e.t > L.t))) repredict(); }
  return { repredict, tick, frame, dispose() { removeEventListener('keydown', onKey); panel.remove(); } };
}

// ── S7 touch controls (phones): a virtual stick (left), a throttle slider and, for the F-16, brake + gear buttons (right); the keys keep working
function touchControls(S, ui, kind) {
  const core = S.core, tc = core.touch = { active: false, pitch: 0, roll: 0, thr: null, brake: false, ev: [] };
  const box = document.createElement('div'); box.className = 'fl-touch';
  box.innerHTML = `<div class="fl-stick" role="application" aria-label="Stick: drag down = nose up, sideways = roll"><div class="fl-knob"></div><span>Stick</span></div>
    <div class="fl-tr"><label>Throttle <input type="range" min="0" max="100" value="0" aria-label="Throttle"></label>${kind === 'f16' ? '<div><button data-t="brake">Brake (hold)</button><button data-t="KeyG">Gear</button></div>' : ''}</div>`;
  ui.appendChild(box);
  const stick = box.querySelector('.fl-stick'), knob = box.querySelector('.fl-knob'), thr = box.querySelector('input');
  let pid = null;
  const move = e => { const r = stick.getBoundingClientRect(), R = r.width / 2; let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    tc.roll = x; tc.pitch = y; knob.style.transform = `translate(${x * R * .6}px, ${y * R * .6}px)`; };
  const end = () => { pid = null; tc.active = false; tc.pitch = tc.roll = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerdown', e => { e.preventDefault(); pid = e.pointerId; stick.setPointerCapture(pid); tc.active = true; move(e); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === pid) move(e); });
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  let thrHeld = false; thr.addEventListener('input', () => { tc.thr = thr.value / 100; thrHeld = true; }); thr.addEventListener('change', () => { thrHeld = false; });
  for (const b of box.querySelectorAll('[data-t]')) { const k = b.dataset.t;
    if (k === 'brake') { b.addEventListener('pointerdown', () => { tc.brake = true; }); for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { tc.brake = false; }); }
    else b.addEventListener('click', () => tc.ev.push(k)); }
  const sync = setInterval(() => { if (!thrHeld) thr.value = String(Math.round(core.state.ctl.throttle * 100)); }, 250);   // follows the keys / autopilot
  return { dispose() { clearInterval(sync); box.remove(); } };
}
