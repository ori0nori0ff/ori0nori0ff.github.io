/* Weapons on screen (flight/weapons): keys, tracers, muzzle flash, impact puffs, the test drone's drawing + smoke, and the gun symbols
   (gun cross, lead pipper, target box, ARM / SAFE + rounds). Own code and own look (not the F-16 HUD symbology; EEGS later).
   Keys while piloting the F-16: Space (hold) = trigger, Digit7 = master arm ARM / SAFE, Digit8 = spawn / respawn the test drone.
   Drawing (S0a rules): everything sits in earthgl's craft layer; a W-aligned group at the craft's draw position (scale 1/R_E) holds the
   tracers and puffs with vertices in metres relative to the craft (float32-safe); the drone is its own Object3D at its W position; the
   gun symbols are children of the craft group (body axes), drawn over everything at 1000 m along their directions from the pilot's eye.
   Shader chunks: no // comments after code (one-line rule of this project). */
import { R_E, H } from '../core.js?v=d29b8afa';
import { createDrone } from './target.js?v=db21c8ae';
import { qrot, qconj } from './weapons.js?v=98af5389';

const D2R = Math.PI / 180, HUD_D = 1000, GREEN = 0x39ff9e;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const RIB_V = 'attribute vec3 iA; attribute vec3 iB; attribute float iK; uniform float uPx; uniform float uW; varying float vU; varying float vK; varying float vL;\n' +
  'void main() { vec4 a = modelViewMatrix * vec4(iA, 1.); vec4 b = modelViewMatrix * vec4(iB, 1.); vec3 p = mix(a.xyz, b.xyz, position.x);\n' +
  '  vec3 d = b.xyz - a.xyz; float dl = length(d); d = dl > 0. ? d / dl : vec3(0., 0., -1.);\n' +
  '  vec3 sd = cross(d, normalize(p)); float sl = length(sd); sd = sl > 1e-6 ? sd / sl : vec3(1., 0., 0.);\n' +
  '  p += sd * max(uW, -p.z * uPx) * position.y; vU = position.y; vK = iK; vL = position.x; gl_Position = projectionMatrix * vec4(p, 1.); }';
const RIB_F = 'uniform vec3 uC; varying float vU; varying float vK; varying float vL;\n' +
  'void main() { float c = 1. - abs(vU); c = c * c; gl_FragColor = vec4(uC * c * mix(.2, 1., vL) * vK, 1.); }';
const BB_V = 'attribute vec3 iP; attribute vec4 iC; attribute float iS; uniform float uPx; varying vec2 vQ; varying vec4 vC;\n' +
  'void main() { vec4 c = modelViewMatrix * vec4(iP, 1.); c.xy += position.xy * max(iS, -c.z * uPx); vQ = position.xy; vC = iC; gl_Position = projectionMatrix * c; }';
const BB_F = 'uniform float uSoft; varying vec2 vQ; varying vec4 vC;\n' +
  'void main() { float r = length(vQ); if (r > 1.) discard; float f = 1. - r; f = mix(f, f * f * (3. - 2. * f), uSoft); gl_FragColor = vec4(vC.rgb, vC.a * f); }';

// instanced quads: n instances, attrs = { name: itemSize }
function quads(THREE, n, attrs, vs, fs, uniforms, blending) {
  const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
  const A = {}; for (const k in attrs) { A[k] = new THREE.InstancedBufferAttribute(new Float32Array(n * attrs[k]), attrs[k]); A[k].setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, A[k]); }
  g.instanceCount = 0;
  const m = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms, transparent: true, depthWrite: false, blending });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 3; return { mesh, A, g, m, n };
}

// S = the flight session (F, core, cs, cc, craft, ui); Wp = createWeapons(); o = { at: { lat, lon } (deg, the airfield), target: spawn at the start }
export function attachWeapons(S, Wp, o = {}) {
  const F = S.F, THREE = F.THREE, core = S.core, def = core.def, G = def.json.gun, pool = Wp.pool, stats = { ms: 0, tracers: 0, puffs: 0 };
  // ── keys (only these three; the core's own keys stay in core.js)
  const busy = e => !F.piloting || core.hold || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input,textarea,select,[contenteditable]');
  const kd = e => { if (busy(e)) return;
    if (e.code === 'Space') { e.preventDefault(); Wp.setTrigger(true); }
    else if (e.code === 'Digit7') { e.preventDefault(); if (!e.repeat) Wp.toggleArm(); }
    else if (e.code === 'Digit8') { e.preventDefault(); if (!e.repeat) spawnDrone(); } };
  const ku = e => { if (e.code === 'Space') { Wp.setTrigger(false); if (F.piloting) e.preventDefault(); } };
  const bl = () => Wp.setTrigger(false);
  addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('blur', bl);

  // ── W-aligned group at the craft (tracers, puffs, flash)
  const root = new THREE.Group(); root.scale.setScalar(1 / R_E); S.cs.add(root);
  const uPx = { value: 0 };
  const rib = quads(THREE, 512, { iA: 3, iB: 3, iK: 1 }, RIB_V, RIB_F, { uPx, uW: { value: .06 / R_E }, uC: { value: new THREE.Color(3.2, .55, .22) } }, THREE.AdditiveBlending);
  const glow = quads(THREE, 256, { iP: 3, iC: 4, iS: 1 }, BB_V, BB_F, { uPx, uSoft: { value: 1 } }, THREE.AdditiveBlending);
  const dust = quads(THREE, 640, { iP: 3, iC: 4, iS: 1 }, BB_V, BB_F, { uPx, uSoft: { value: 1 } }, THREE.NormalBlending);
  for (const q of [rib, glow, dust]) { q.g.attributes.position.array.forEach((x, i, a) => { if (q !== rib && i % 3 < 2) a[i] = i % 3 === 0 ? 2 * x - 1 : x; }); root.add(q.mesh); }   // billboards: corners -1..1
  dust.mesh.renderOrder = 2;
  // particles: { w: W metres, vw: W m/s, t0, life (s), s0, s1 (m), c: [r, g, b], a, add }; ring buffers
  const parts = { glow: [], dust: [] };
  const emitP = (p, add) => { const L = add ? parts.glow : parts.dust, cap = add ? 250 : 630; if (L.length >= cap) L.shift(); L.push(p); };
  let tSim = 0;
  const offs = [Wp.on('ground', e => { emitP({ w: e.w, vw: [0, 0, 0], t0: tSim, life: 2.2, s0: .8, s1: 4.5, c: [.42, .37, .31], a: .75 }, false); }),
    Wp.on('hit', e => { emitP({ w: e.w, vw: [0, 0, 0], t0: tSim, life: .18, s0: 1.2, s1: 2.2, c: [2.6, 1.9, .9], a: 1 }, true);
      emitP({ w: e.w, vw: [0, 0, 0], t0: tSim, life: 1.4, s0: .6, s1: 2.5, c: [.22, .21, .2], a: .7 }, false); }),
    Wp.on('kill', e => { emitP({ w: e.w || (e.target.w1 || [0, 0, 0]).slice(), vw: [0, 0, 0], t0: tSim, life: 1.1, s0: 3, s1: 9, c: [3, 1.6, .5], a: 1 }, true); })];

  if (S.snd && S.snd.hookWeapons) S.snd.hookWeapons(Wp);   // weapon sounds (flight/sound.js: launch, explosions, select click); sound.js is made before the weapons

  // ── the drone
  let drone = null;
  function spawnDrone() {
    if (drone) { Wp.removeTarget(drone); S.cs.remove(drone.object); drone.dispose(); drone = null; }
    const at = o.at || { lat: 45.696, lon: 25.513 }, g = F.groundAt(at.lat * D2R, at.lon * D2R);
    drone = Wp.addTarget(createDrone(F, { lat: at.lat + 6000 / 111195, lon: at.lon, hMSL: (g == null ? 550 : g) + 914.4, radius: 3000, speed: 128.6, hp: 8, phase: Math.PI }));
    S.cs.add(drone.object); return drone; }
  let spawnAtStart = !!o.target;

  // ── gun symbols (children of the craft group, body axes, metres)
  const eye = def.views[0].eye, hud = new THREE.Group(); hud.position.set(...eye); S.craft.add(hud);
  const lm = new THREE.LineBasicMaterial({ color: GREEN, depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
  const line = pts => { const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p))); const l = new THREE.LineSegments(g, lm); l.renderOrder = 1000; l.frustumCulled = false; return l; };
  const T = x => Math.tan(x / 1000) * HUD_D;   // mrad -> metres at HUD_D
  const gd = Wp.gun ? Wp.gun.dir : [0, 0, -1];
  const cross = line([[-T(15), 0, 0], [-T(5), 0, 0], [T(5), 0, 0], [T(15), 0, 0], [0, -T(15), 0], [0, -T(5), 0], [0, T(5), 0], [0, T(15), 0]]);   // gun cross, 30 mrad wide
  cross.position.set(...gd.map(c => c * HUD_D)); hud.add(cross);
  const ringPts = []; for (let k = 0; k < 36; k++) { const a0 = k / 36 * 2 * Math.PI, a1 = (k + 1) / 36 * 2 * Math.PI; ringPts.push([T(17.5) * Math.cos(a0), T(17.5) * Math.sin(a0), 0], [T(17.5) * Math.cos(a1), T(17.5) * Math.sin(a1), 0]); }
  const pip = line([...ringPts, [-T(1.2), 0, 0], [T(1.2), 0, 0], [0, -T(1.2), 0], [0, T(1.2), 0]]); hud.add(pip);   // pipper: 35 mrad ring + centre dot (ESTIMATE size)
  const box = line([[-T(20), -T(20), 0], [T(20), -T(20), 0], [T(20), -T(20), 0], [T(20), T(20), 0], [T(20), T(20), 0], [-T(20), T(20), 0], [-T(20), T(20), 0], [-T(20), -T(20), 0]]); hud.add(box);   // target box
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64; const cx = cv.getContext('2d'), tex = new THREE.CanvasTexture(cv);
  const sm = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }), txt = new THREE.Sprite(sm);
  txt.renderOrder = 1000; txt.center.set(0, .5); txt.scale.set(T(160), T(20), 1); txt.position.set(-T(110), -T(75), -HUD_D); hud.add(txt);
  let txtKey = '';
  const drawTxt = s => { if (s === txtKey) return; txtKey = s; cx.clearRect(0, 0, 512, 64); cx.font = '600 40px Inter, system-ui, sans-serif'; cx.fillStyle = '#39FF9E'; cx.textBaseline = 'middle'; cx.fillText(s, 4, 34); tex.needsUpdate = true; };

  // ── per frame (session.js onPose, after gfx): t = earthgl time (ms)
  const base = [0, 0, 0], fl = new THREE.Vector3(), mz = new THREE.Vector3(), qd = new THREE.Quaternion();
  let pipT = 0, pipRes = null, lock = null;
  function update(P, t) {
    const t0 = performance.now(), s = core.state, ws = Wp.state; if (!P) return;
    tSim = t / 1e3; if (spawnAtStart && !core.hold) { spawnAtStart = false; spawnDrone(); }
    root.position.copy(P.pos); base[0] = P.pos.x * R_E; base[1] = P.pos.y * R_E; base[2] = P.pos.z * R_E;
    const a = clamp((t - s.t) / (H * 1e3), 0, 1), cc = S.cc, Hpx = Math.max(1, F.renderer.domElement.clientHeight);
    uPx.value = 2 * Math.tan(cc.fov * D2R / 2) / Hpx * 1.6;   // ~1.6 px wide at least, at any distance and zoom
    let far = 0;
    // tracers: the PGU-30 rounds while their trace burns
    let n = 0; const tr = Wp.kinds[0] ? Wp.kinds[0].trace : 0, A = rib.A.iA.array, B = rib.A.iB.array, K = rib.A.iK.array;
    for (let i = 0; i < pool.N && n < rib.n; i++) { if (!pool.on[i] || !pool.tracer[i] || pool.age[i] > tr) continue; const j = 3 * i;
      const px = pool.w0[j] + (pool.w1[j] - pool.w0[j]) * a - base[0], py = pool.w0[j + 1] + (pool.w1[j + 1] - pool.w0[j + 1]) * a - base[1], pz = pool.w0[j + 2] + (pool.w1[j + 2] - pool.w0[j + 2]) * a - base[2];
      const k = clamp(pool.age[i] - (1 - a) * H, 0, .02) / H;   // streak = 20 ms of flight behind the round (eye persistence), never behind the muzzle
      A[3 * n] = px - (pool.w1[j] - pool.w0[j]) * k; A[3 * n + 1] = py - (pool.w1[j + 1] - pool.w0[j + 1]) * k; A[3 * n + 2] = pz - (pool.w1[j + 2] - pool.w0[j + 2]) * k;
      B[3 * n] = px; B[3 * n + 1] = py; B[3 * n + 2] = pz; K[n] = clamp((tr - pool.age[i]) / .3, 0, 1); far = Math.max(far, Math.hypot(px, py, pz)); n++; }
    rib.g.instanceCount = n; stats.tracers = n; for (const k in rib.A) rib.A[k].needsUpdate = true;
    // muzzle flash while firing (ESTIMATE size / colour), at the gun port in the drawn pose
    const gl = [], dl = [];
    if (ws.firing) { mz.set(...G.muzzle).add(fl.set(...Wp.gun.dir).multiplyScalar(.6)).applyQuaternion(P.quat); const f = .7 + .5 * Math.random();
      gl.push([mz.x, mz.y, mz.z, 3 * f, 2.1 * f, 1 * f, 1, .55 * f]); }
    // the drone: pose, smoke while falling, fire + dust when it hits the ground
    if (drone) { const d = drone, o3 = d.object;
      if (d.w1) { o3.visible = true; const p = [0, 1, 2].map(k => d.w0[k] + (d.w1[k] - d.w0[k]) * a); o3.position.set(p[0] / R_E, p[1] / R_E, p[2] / R_E); qd.set(...d.wq0); o3.quaternion.set(...d.wq1); o3.quaternion.copy(qd.slerp(o3.quaternion, a));
        const rel = [p[0] - base[0], p[1] - base[1], p[2] - base[2]]; far = Math.max(far, Math.hypot(...rel) + 8);
        if (d.fall && !d.onGround && tSim - (d.lastSmoke || 0) > .06) { d.lastSmoke = tSim; emitP({ w: p, vw: [0, 0, 0], t0: tSim, life: 7, s0: 1.5, s1: 9, c: [.16, .16, .17], a: .8 }, false);
          emitP({ w: p, vw: [0, 0, 0], t0: tSim, life: .35, s0: 1.6, s1: 1, c: [3, 1.4, .4], a: 1 }, true); }
        if (d.impact) { d.impact = false; emitP({ w: p, vw: [0, 0, 0], t0: tSim, life: 1.6, s0: 5, s1: 14, c: [3, 1.5, .4], a: 1 }, true);
          emitP({ w: p, vw: [0, 0, 0], t0: tSim, life: 10, s0: 6, s1: 25, c: [.2, .19, .18], a: .85 }, false); } } }
    // particles (age by the sim clock; a slow rise for smoke / dust: ESTIMATE 2 m/s)
    for (const [L, out] of [[parts.glow, gl], [parts.dust, dl]]) { for (let k = L.length - 1; k >= 0; k--) { const p = L[k], u = (tSim - p.t0) / p.life;
        if (u >= 1 || u < 0) { L.splice(k, 1); continue; } const rise = out === dl ? 2 * (tSim - p.t0) : 0, f = 1 - u;
        const up = [p.w[0] / R_E, p.w[1] / R_E, p.w[2] / R_E], ul = Math.hypot(...up);
        const x = p.w[0] - base[0] + up[0] / ul * rise, y = p.w[1] - base[1] + up[1] / ul * rise, z = p.w[2] - base[2] + up[2] / ul * rise; far = Math.max(far, Math.hypot(x, y, z) + p.s1);
        out.push([x, y, z, p.c[0], p.c[1], p.c[2], p.a * (out === dl ? f : f * f), p.s0 + (p.s1 - p.s0) * u]); } }
    for (const [q, L] of [[glow, gl], [dust, dl]]) { const P3 = q.A.iP.array, C = q.A.iC.array, Sz = q.A.iS.array, m = Math.min(L.length, q.n);
      for (let k = 0; k < m; k++) { const e = L[k]; P3[3 * k] = e[0]; P3[3 * k + 1] = e[1]; P3[3 * k + 2] = e[2]; C[4 * k] = e[3]; C[4 * k + 1] = e[4]; C[4 * k + 2] = e[5]; C[4 * k + 3] = e[6]; Sz[k] = e[7] / R_E; }
      q.g.instanceCount = m; for (const k in q.A) q.A[k].needsUpdate = true; }
    stats.puffs = gl.length + dl.length;
    // gun symbols: ARM only; the text always (SAFE / ARM, rounds, the reason the gun will not fire, the range used by the pipper)
    const showHud = !core.hold && !!Wp.gun; hud.visible = showHud;
    if (showHud) { const armed = ws.arm; cross.visible = pip.visible = armed;
      // lock: the radar's (Wp.bus.lock, radar plug-in: its range drives the pipper) so the gun and the radar show the same target;
      // without a radar lock the nearest live target within 3 km and 20 deg of the nose (a stand-in; ESTIMATE)
      lock = null; const RL = Wp.bus && Wp.bus.lock;
      if (RL && RL.T && RL.T.alive && RL.T.r1 && RL.range > 0) { const rel = [RL.T.r1[0] - s.r[0], RL.T.r1[1] - s.r[1], RL.T.r1[2] - s.r[2]], d = Math.hypot(...rel);
        if (d > 0) lock = { d: RL.range, b: qrot(qconj(s.q), rel).map(c => c / d), radar: true }; }
      if (!lock) for (const Tg of Wp.targets) { if (!Tg.alive || !Tg.r1 || Tg.team === 'blue') continue; const rel = [Tg.r1[0] - s.r[0], Tg.r1[1] - s.r[1], Tg.r1[2] - s.r[2]], d = Math.hypot(...rel);
        const b = qrot(qconj(s.q), rel); if (d < 3000 && -b[2] / d > Math.cos(20 * D2R) && (!lock || d < lock.d)) lock = { d, b: b.map(c => c / d) }; }
      box.visible = armed && !!lock; if (box.visible) box.position.set(...lock.b.map(c => c * HUD_D));
      if (armed && performance.now() - pipT > 33) { pipT = performance.now(); pipRes = Wp.predict(s, lock ? lock.d : G.pipperRange); }
      pip.visible = armed && !!pipRes; if (pip.visible) pip.position.set(...pipRes.dir.map(c => c * HUD_D));
      drawTxt((armed ? 'ARM' : 'SAFE') + '  ' + ws.rounds + (armed && ws.inhibit && ws.inhibit !== 'SAFE' ? '  ' + ws.inhibit : '') + (armed ? '  R ' + ((lock ? lock.d : G.pipperRange) / 1852).toFixed(2) + ' NM' : '') + (armed && lock && !pipRes ? '  OUT' : ''));   // OUT: the round needs > 6 s (Wp.predict) to reach the lock range, no pipper
      far = Math.max(far, HUD_D + 50); }
    // the craft layer's far plane (gfx.js sets it for the craft and its contrail): reach the tracers, puffs, drone and symbols
    // and the near plane (in far views gfx puts it 20 m short of the craft): 1 m at most, so a drone or puff between the camera and the jet stays
    const cp = F.piloting ? core.camPose(t) : null, dCam = (cp ? cp.pos : F.camera.position).distanceTo(P.pos) * R_E;
    if (far > 0) { cc.far = Math.max(cc.far, Math.min(60000, far + dCam + 50) / R_E); cc.near = Math.min(cc.near, 1 / R_E); }
    stats.ms += (performance.now() - t0 - stats.ms) * .05; }

  function reset() { Wp.reload(); Wp.clear(); Wp.setTrigger(false); Wp.setArm(false); parts.glow.length = parts.dust.length = 0; }   // Reset = a full drum, master arm SAFE
  function dispose() { if (S.snd && S.snd.hookWeapons) S.snd.hookWeapons(null); removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('blur', bl); for (const f of offs) f();
    if (drone) { S.cs.remove(drone.object); drone.dispose(); } S.cs.remove(root); S.craft.remove(hud);
    for (const q of [rib, glow, dust]) { q.g.dispose(); q.m.dispose(); } hud.traverse(n => { if (n.geometry) n.geometry.dispose(); }); lm.dispose(); sm.dispose(); tex.dispose(); }
  return { update, reset, dispose, stats, spawnDrone, get drone() { return drone; }, get lock() { return lock; }, get pipper() { return pipRes; }, weapons: Wp };
}
