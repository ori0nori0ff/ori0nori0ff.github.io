/* Game homing projectiles plug-in (docs/flight-notes/weapons-contract.md row "missiles"; notes docs/flight-notes/game-missiles.md).
   An ARCADE mechanic, not a physical model: every number is an invented game value in data/game-missiles.json.
   Two classes: "short" (fired when Wp.bus.sel === 'AIM-9') and "long" (Wp.bus.sel === 'AIM-120'); the names only match the stores drawn
   on the jet (stations plug-in).
   Motion (frame I of core.js, metres, doubles): state = position r, speed V over the air (the air turns with the Earth) and the unit direction
   d of that air velocity. Rail: straight along the launch direction at the jet's speed for railTime. Boost: V grows linearly to the
   jet's speed + addSpeed over boostTime. Coast: V drops by decel each second. Steering: d turns toward the target's present position
   (plain pursuit) by at most turnRate deg/s. No gravity, no drag model. Ends: within hitRadius of the target (closest approach over the
   step) -> T.hit(w, { name, blast: true }) + 'hit' / 'kill' / 'detonate' events; ground contact; lifetime over or V < minSpeed (self-destruct).
   Target: short = the live target nearest the jet's nose within pickCone and pickRange; long = Wp.bus.lock (radar plug-in), none = "NO LOCK".
   Launch: key Enter, master arm, airborne; a store from Wp.bus.release(Wp.bus.pick(sel)) (stations plug-in) or the fallback load in the json.
   Drawing (S0a rules): each projectile is its own Object3D at its W position (scale 1 / R_E); flame + smoke + explosion billboards sit in a
   W-aligned group at the craft with vertices in metres relative to it (float32-safe), as fx.js. Shader chunks: no // comments after code.
   Own code. */
import { R_E, OMEGA_I, H, toF } from '../core.js';
import { qrot, qconj } from './weapons.js';

const D2R = Math.PI / 180;
const J = await (await fetch(new URL('data/game-missiles.json', import.meta.url))).json();
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]), unit = a => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : [0, 0, -1]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mv = (M, x) => [M[0] * x[0] + M[1] * x[1] + M[2] * x[2], M[3] * x[0] + M[4] * x[1] + M[5] * x[2], M[6] * x[0] + M[7] * x[1] + M[8] * x[2]];
const spin = r => cross(OMEGA_I, r);   // velocity of the air (turning with the Earth) at I point r

// turn unit vector d toward unit vector g by at most angle a (rad), in their common plane
function turn(d, g, a) { const c = clamp(dot(d, g), -1, 1), ang = Math.acos(c); if (ang <= a || ang < 1e-9) return g.slice();
  let p = sub(g, mul(d, c)); const pl = len(p); if (pl < 1e-9) { p = unit(cross(d, Math.abs(d[1]) < .9 ? [0, 1, 0] : [1, 0, 0])); } else p = mul(p, 1 / pl);
  return unit(add(mul(d, Math.cos(a)), mul(p, Math.sin(a)))); }

// closest distance between a point moving e0 -> e1 (relative to the target) and the origin; returns [distance, fraction]
function closest(e0, e1) { const de = sub(e1, e0), dd = dot(de, de), u = dd > 1e-12 ? clamp(-dot(e0, de) / dd, 0, 1) : 1; return [len(add(e0, mul(de, u))), u]; }

const BB_V = 'attribute vec3 iP; attribute vec4 iC; attribute float iS; uniform float uPx; varying vec2 vQ; varying vec4 vC;\n' +
  'void main() { vec4 c = modelViewMatrix * vec4(iP, 1.); c.xy += position.xy * max(iS, -c.z * uPx); vQ = position.xy; vC = iC; gl_Position = projectionMatrix * c; }';
const BB_F = 'varying vec2 vQ; varying vec4 vC;\n' +
  'void main() { float r = length(vQ); if (r > 1.) discard; float f = 1. - r; f = f * f * (3. - 2. * f); gl_FragColor = vec4(vC.rgb, vC.a * f); }';

export function attach(ctx) {
  const { S, F, Wp, bus, core } = ctx, THREE = F.THREE, CL = J.classes, G = J.game;
  const bySel = {}; for (const k in CL) bySel[CL[k].sel] = k;
  const stations = () => S.plugins && S.plugins.list && S.plugins.list.stations;   // filled after all plug-ins attached
  const hasStations = () => typeof bus.pick === 'function' && typeof bus.release === 'function';
  // fallback load (no stations plug-in): count + launch points per class (body m)
  const fb = {}; for (const k in CL) fb[k] = { left: CL[k].fallback.count, pos: CL[k].fallback.pos };
  const live = [];   // { cls, C, r, V, d, t (s since launch), state, T (target), w0, w1, obj, ent (bus entry), smokeT }
  const stats = { launched: 0, hits: 0, kills: 0, misses: 0, ground: 0, ms: 0, msMax: 0, drawMs: 0 };
  let want = false, lastLaunch = -1e9, msg = '', msgT = 0, MWlast = null;

  const leftOf = k => { if (!hasStations()) return fb[k].left; const st = CL[k].store; return (bus.stations || []).reduce((a, x) => a + (x.store === st ? x.count : 0), 0); };
  const say = (m, t) => { msg = m; msgT = t; };

  // target for class k at the jet state s: short = nearest the nose within the cone, long = the radar lock
  function pickTarget(k, s) { const C = CL[k];
    if (k === 'long') { const L = bus.lock; return L && L.T && L.T.alive ? L.T : null; }
    const qc = qconj(s.q), cosC = Math.cos(C.pickCone * D2R); let best = null, bd = Infinity;
    for (const T of Wp.targets) { if (!T.alive || !T.r1 || T.team === 'blue') continue; const rel = sub(T.r1, s.r), dl = len(rel); if (dl > C.pickRange || dl < 1) continue;
      const b = qrot(qc, rel), off = -b[2] / dl; if (off < cosC) continue; const score = (1 - off) * 4 + dl / C.pickRange; if (score < bd) { bd = score; best = T; } }
    return best; }

  // ── launch (in the physics step, from the jet's state at the step's start)
  function launch(s) {
    const k = bySel[bus.sel]; if (!k) return;
    if (!Wp.state.arm) return say('SAFE', s.t);
    if (s.onGround || s.crash) return say(s.crash ? 'CRASH' : 'WOW', s.t);
    if (s.t - lastLaunch < G.launchGap * 1e3) return;
    if (leftOf(k) <= 0) return say('EMPTY', s.t);
    const T = pickTarget(k, s); if (!T && k === 'long') return say('NO LOCK', s.t);
    let pos;
    if (hasStations()) { const rel = bus.release(bus.pick(CL[k].sel)); if (!rel) return say('EMPTY', s.t); pos = rel.pos; }
    else { const f = fb[k], i = f.pos.length - f.left; f.left--; pos = f.pos[i % f.pos.length]; }
    const r = add(s.r, qrot(s.q, pos)), m = spawn(k, r, sub(s.v, spin(s.r)), unit(qrot(s.q, [0, 0, -1])), T, s.t, 'blue', null);
    lastLaunch = s.t; say(T ? '' : 'NO TGT', s.t);
    Wp.emit('launch', { type: m.C.sel, cls: k, target: T, id: m.id }); }
  // one projectile of class k at I point r, air velocity va (m/s), direction d (unit), target T, time t (ms); side 'blue' (the F-16) | 'red' (S12 AI)
  function spawn(k, r, va, d, T, t, side, shooter) { const C = CL[k], V0 = Math.max(len(va), 50);
    const m = { cls: k, C, r, V: V0, V0, d, t: 0, state: 'rail', T, w0: null, w1: null, obj: null, smokeT: 0, id: ++stats.launched, team: side };
    m.ent = { type: C.sel, cls: k, r: m.r, v: add(mul(d, V0), spin(r)), t, state: 'rail', target: T, team: side, shooter, id: m.id };
    live.push(m); bus.missiles.push(m.ent); makeObj(m); return m; }
  // S12: a launch by an AI shooter (flight/weapons/ai-weapons.js): o = { cls ('short' | 'long'), r, v (I, at the shooter), d (unit, its nose), T, t, shooter }
  function fireAt(o) { const m = spawn(o.cls, o.r.slice(), sub(o.v, spin(o.r)), o.d.slice(), o.T, o.t, 'red', o.shooter || null); stats.redLaunched = (stats.redLaunched || 0) + 1;
    Wp.emit('redLaunch', { type: m.C.sel, cls: o.cls, target: o.T, shooter: o.shooter || null, id: m.id, ent: m.ent }); return m.ent; }
  // S12 countermeasures: one release of `kind` ('flare' | 'chaff') by target T; every live projectile homing on T rolls once with the game chance
  // table (data/combat.json cms.decoy, passed in as chance[cls][kind]); a lost one flies straight on. Returns the number decoyed
  function decoy(T, kind, chance) { let n = 0;
    for (const m of live) { if (m.T !== T || m.state === 'gone' || m.state === 'rail') continue; const p = (chance[m.cls] || {})[kind] || 0;
      m.rolls = (m.rolls || 0) + 1; if (Math.random() < p) { m.T = null; m.ent.target = null; m.ent.decoyed = kind; m.decoyed = kind; n++; } }
    stats.decoyed = (stats.decoyed || 0) + n; return n; }

  function end(m, why, w, T) {
    m.state = m.ent.state = 'gone'; m.why = why; if (m.obj) { m.obj.removeFromParent(); m.obj = null; }
    if (why === 'hit') stats.hits++; else if (why === 'ground') stats.ground++; else stats.misses++;
    let killed = false;
    if (T) { Wp.emit('hit', { target: T, w });
      // blast: hit again until the target dies (the test drone counts gun hits; the AI bandits die on the first blast hit)
      for (let n = 0; n < G.blastHits && T.alive; n++) if (T.hit(w, { name: m.C.store, blast: true })) { killed = true; break; }
      if (killed) { stats.kills++; Wp.emit('kill', { target: T, w }); } }
    Wp.emit('detonate', { type: m.C.sel, cls: m.cls, w, target: T || null, killed, why, id: m.id, team: m.team, decoyed: m.decoyed || null });
    boom.push({ w, why, t: null }); }

  // ── per physics step: fly every projectile; MW = I -> W at the step's end
  function step(s, env, h, MW) {
    const tp = performance.now(); MWlast = MW;
    // drop the entries that ended last step from the bus
    for (let i = bus.missiles.length - 1; i >= 0; i--) if (bus.missiles[i].state === 'gone' && !live.some(m => m.ent === bus.missiles[i])) bus.missiles.splice(i, 1);
    if (want) { want = false; if (s.ref === 'Earth') launch(s); }
    const t1 = s.t + h * 1e3;
    for (let i = live.length - 1; i >= 0; i--) { const m = live[i], C = m.C;
      if (m.state === 'gone') { live.splice(i, 1); const k = bus.missiles.indexOf(m.ent); if (k >= 0) bus.missiles.splice(k, 1); continue; }
      const r0 = m.r.slice(); m.t += h;
      // speed
      if (m.t <= C.railTime) m.state = 'rail';
      else if (m.t <= C.railTime + C.boostTime) { m.state = 'boost'; m.V = m.V0 + C.addSpeed * (m.t - C.railTime) / C.boostTime; }
      else { m.state = 'coast'; m.V -= C.decel * h; }
      // steering: toward the target's position + `lead` x its velocity x the time to reach it (lead 0 = plain pursuit); none / dead /
      // removed / more than lostAngle off the nose (overshot) -> straight on
      if (m.T && (!m.T.alive || !Wp.targets.includes(m.T) || !m.T.r1)) m.T = null;
      const T = m.T;
      if (m.state !== 'rail' && T) { const rel = sub(T.r1, m.r), rg = len(rel), u = mul(rel, 1 / rg);
        if (dot(m.d, u) < Math.cos(C.lostAngle * D2R)) { m.T = null; m.ent.target = null; }
        else { const vT = sub(T.v, spin(T.r1)), cl = Math.max(100, m.V - dot(vT, u)), aim = add(rel, mul(vT, C.lead * rg / cl));
          m.d = turn(m.d, unit(aim), C.turnRate * D2R * h); } }
      const v = add(mul(m.d, m.V), spin(m.r)); m.r = add(m.r, mul(v, h));
      // W at the step's start / end (first step: back by the velocity over the ground)
      m.w1 = mv(MW, m.r); m.w0 = m.wNext || sub(m.w1, mv(MW, mul(m.d, m.V * h))); m.wNext = m.w1;
      const ent = m.ent; ent.r = m.r; ent.v = v; ent.t = t1;
      ent.state = m.state === 'coast' && m.cls === 'long' && T && len(sub(T.r1, m.r)) < C.activeRange ? 'pitbull' : m.state;
      // hit: closest approach to the target over the step
      if (T && m.state !== 'rail') { const [dmin, u] = closest(sub(r0, T.r0 || T.r1), sub(m.r, T.r1));
        if (dmin <= C.hitRadius) { const w = [0, 1, 2].map(k => m.w0[k] + (m.w1[k] - m.w0[k]) * u); m.w1 = w; end(m, 'hit', w, T); continue; } }
      // ground: relief + 400 m (as the core), every step below 2 km over the last ground value, else every 8th step
      const rl = len(m.r); if (!m.gR || rl - m.gR < 2000 || ((m.gk = (m.gk || 0) + 1) & 7) === 0) { const f = toF(t1, m.r), fl = len(f), g = F.groundAt(Math.asin(f[1] / fl), Math.atan2(-f[2], f[0])); if (g != null) m.gR = R_E + 400 + g; }
      if (m.gR && rl <= m.gR) { end(m, 'ground', m.w1, null); continue; }
      if (m.t > C.lifetime || (m.state === 'coast' && m.V < C.minSpeed)) end(m, m.t > C.lifetime ? 'time' : 'slow', m.w1, null); }
    const ms = performance.now() - tp; stats.ms += (ms - stats.ms) * .05; stats.msMax = Math.max(stats.msMax * .995, ms); }

  // ── HUD values for the integrator (h.msl): selected class, count, target, range, message
  function hud(s, env, h) { const k = bySel[bus.sel]; if (!k) { h.msl = null; return; }
    const T = s.ref === 'Earth' ? pickTarget(k, s) : null;
    h.msl = { sel: bus.sel, cls: k, left: leftOf(k), target: T ? T.name : null, range: T && T.r1 ? len(sub(T.r1, s.r)) : null, live: live.length,
      msg: s.t - msgT < G.msgTime * 1e3 ? msg : (k === 'long' && !T ? 'NO LOCK' : '') }; }
  const sys = Wp.addSystem({ name: 'missiles', step, hud });

  ctx.key('Enter', ['Enter', 'Launch the selected homing projectile (- selects; needs master arm 7)'], e => { if (!e.repeat) want = true; });

  // ── WPN page
  const FONT = 'system-ui, sans-serif', MONO = 'ui-monospace, Consolas, monospace';
  function page(x) { const W = 512, s = core.state, k = bySel[bus.sel]; x.textBaseline = 'middle'; x.textAlign = 'left';
    x.font = `700 30px ${FONT}`; const arm = !!Wp.state.arm; x.fillStyle = arm ? '#FFB347' : '#39FF9E'; x.fillText(arm ? 'ARM' : 'SAFE', 24, 82);
    x.textAlign = 'center'; x.font = `700 44px ${MONO}`; x.fillStyle = '#F2F4F6';
    if (!k) { x.fillText(bus.sel || 'GUN', W / 2, 160); x.font = `600 24px ${FONT}`; x.fillStyle = '#9AA4B2'; x.fillText('- = SELECT SHORT / LONG', W / 2, 230); }
    else { const C = CL[k], T = s && s.ref === 'Earth' ? pickTarget(k, s) : null, n = leftOf(k);
      x.fillText(C.label, W / 2, 150); x.font = `600 22px ${FONT}`; x.fillStyle = '#9AA4B2'; x.fillText(C.sel + ' STATION', W / 2, 192);
      x.font = `700 34px ${MONO}`; x.fillStyle = n ? '#39FF9E' : '#FF5A5A'; x.fillText(n + ' LEFT', W / 2, 250);
      x.font = `700 30px ${MONO}`;
      if (T) { x.fillStyle = '#7FD8FF'; x.fillText(T.name.toUpperCase(), W / 2, 310); x.fillText((len(sub(T.r1, s.r)) / 1000).toFixed(1) + ' KM', W / 2, 352); }
      else { x.fillStyle = '#FF5A5A'; x.fillText(k === 'long' ? 'NO LOCK' : 'NO TARGET', W / 2, 330); } }
    const m = s && s.t - msgT < G.msgTime * 1e3 ? msg : ''; if (m) { x.font = `700 30px ${MONO}`; x.fillStyle = '#FF5A5A'; x.fillText(m, W / 2, 400); }
    x.font = `600 20px ${FONT}`; x.fillStyle = '#5D6878'; x.fillText('ENTER = LAUNCH   IN FLIGHT ' + live.length, W / 2, 456); }
  ctx.mfdPage('WPN', page);

  // ── drawing: the projectile (stations' model if there, else a cylinder), flame, smoke, explosions
  const proto = {}, mats = { body: new THREE.MeshStandardMaterial({ color: 0xe6e6e2, roughness: .45, metalness: .2 }), fin: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: .5, metalness: .2 }) };
  const geos = [];
  function simple(C) { const g = new THREE.Group();
    const cy = new THREE.CylinderGeometry(C.diam / 2, C.diam / 2, C.len, 12); cy.rotateX(Math.PI / 2); geos.push(cy); g.add(new THREE.Mesh(cy, mats.body));
    const fn = new THREE.BoxGeometry(C.diam * 3.2, .015, C.len * .12); fn.translate(0, 0, C.len * .42); geos.push(fn);
    const a = new THREE.Mesh(fn, mats.fin), b = new THREE.Mesh(fn, mats.fin); b.rotation.z = Math.PI / 2; g.add(a, b); return g; }
  function loadProtos() { const sp = stations(); if (!sp || !sp.model) return;
    for (const k in CL) if (!proto[k]) { proto[k] = 'wait'; sp.model(CL[k].model).then(o => { o.position.set(0, .08, 0); const g = new THREE.Group(); g.add(o); proto[k] = g; }).catch(() => { proto[k] = null; }); } }
  function makeObj(m) { loadProtos(); const p = proto[m.cls]; const inner = p && p !== 'wait' ? p.clone() : simple(m.C);
    const o = new THREE.Group(); o.add(inner); o.userData.simple = !(p && p !== 'wait'); o.scale.setScalar(1 / R_E); o.visible = false; ctx.cs.add(o); m.obj = o; }

  const NP = 3000, root = new THREE.Group(); root.scale.setScalar(1 / R_E); ctx.cs.add(root);
  const uPx = { value: 0 };
  function quads(n, blending, order) { const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    const A = { iP: 3, iC: 4, iS: 1 }; for (const k in A) { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * A[k]), A[k]); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); A[k] = a; }
    g.instanceCount = 0; const mt = new THREE.ShaderMaterial({ vertexShader: BB_V, fragmentShader: BB_F, uniforms: { uPx }, transparent: true, depthWrite: false, blending });
    const mesh = new THREE.Mesh(g, mt); mesh.frustumCulled = false; mesh.renderOrder = order; root.add(mesh); return { g, A, mt, n }; }
  const smoke = quads(NP, THREE.NormalBlending, 2), glow = quads(200, THREE.AdditiveBlending, 3);
  const puffs = [], boom = [];   // puffs: { w, t0, life, s0, s1, c, a, add }
  const puff = p => { if (puffs.length >= NP) puffs.shift(); puffs.push(p); };
  const qn = new THREE.Quaternion(), vz = new THREE.Vector3(0, 0, -1), vd = new THREE.Vector3();

  ctx.onPose((P, t) => {
    if (!P) return; const t0 = performance.now(), s = core.state, a = clamp((t - s.t) / (H * 1e3), 0, 1), tS = t / 1e3, cc = S.cc, Hpx = Math.max(1, F.renderer.domElement.clientHeight);
    root.position.copy(P.pos); const base = [P.pos.x * R_E, P.pos.y * R_E, P.pos.z * R_E];
    uPx.value = 2 * Math.tan(cc.fov * D2R / 2) / Hpx * 1.5;
    let far = 0; const gl = [];
    for (const m of live) { if (!m.w1 || !m.obj) continue;
      const p = [0, 1, 2].map(k => m.w0[k] + (m.w1[k] - m.w0[k]) * a), o = m.obj; o.visible = true; o.position.set(p[0] / R_E, p[1] / R_E, p[2] / R_E);
      const dW = unit(sub(m.w1, m.w0)); o.quaternion.copy(qn.setFromUnitVectors(vz, vd.set(dW[0], dW[1], dW[2])));
      if (o.userData.simple && proto[m.cls] && proto[m.cls] !== 'wait') { o.userData.simple = false; o.clear(); o.add(proto[m.cls].clone()); }   /* swap in the model once loaded */
      far = Math.max(far, len(sub(p, base)) + 10);
      const tail = sub(p, mul(dW, m.C.len * .5 + .2)), burn = m.state === 'boost';
      if (burn) { const f = .8 + .4 * Math.random(); gl.push([tail, [3.2 * f, 2.2 * f, 1.1 * f], 1, 1.3 * f]); gl.push([sub(tail, mul(dW, .9)), [2.4, 1.1, .35], .8, .8 * f]); }
      // smoke: puffs every smokeStep m along the path since the last puff (filled in between drawn frames)
      if (burn || G.smokeCoast && m.state === 'coast') { const q = m.smokeW || tail, dd = len(sub(tail, q)), n = Math.min(24, Math.floor(dd / G.smokeStep));
        for (let k = 1; k <= n; k++) { const f = k * G.smokeStep / dd; puff({ w: add(q, mul(sub(tail, q), f)), t0: tS, life: G.smokeLife, s0: 1.1, s1: 7, c: [.88, .88, .87], a: .32 }); }
        if (n || !m.smokeW) m.smokeW = n ? add(q, mul(sub(tail, q), n * G.smokeStep / dd)) : tail; } }
    // explosions (set by end(): the first frame after it stamps the time)
    for (const b of boom.splice(0)) { const w = b.w;
      if (b.why === 'hit') { puff({ w, t0: tS, life: .5, s0: 6, s1: 16, c: [3.4, 2, .7], a: 1, add: true }); puff({ w, t0: tS, life: 9, s0: 5, s1: 22, c: [.2, .19, .18], a: .85 }); }
      else if (b.why === 'ground') { puff({ w, t0: tS, life: .5, s0: 4, s1: 10, c: [3, 1.7, .6], a: 1, add: true }); puff({ w, t0: tS, life: 5, s0: 4, s1: 16, c: [.42, .37, .31], a: .8 }); }
      else { puff({ w, t0: tS, life: .35, s0: 3, s1: 8, c: [3, 1.8, .7], a: 1, add: true }); puff({ w, t0: tS, life: 5, s0: 3, s1: 10, c: [.3, .3, .3], a: .7 }); } }
    // fill the two instanced sets
    let ns = 0, ng = 0; const SP = smoke.A.iP.array, SC = smoke.A.iC.array, SS = smoke.A.iS.array, GP = glow.A.iP.array, GC = glow.A.iC.array, GS = glow.A.iS.array;
    for (let k = puffs.length - 1; k >= 0; k--) { const p = puffs[k], u = (tS - p.t0) / p.life; if (u >= 1 || u < 0) { puffs.splice(k, 1); continue; }
      const sz = p.s0 + (p.s1 - p.s0) * u, x = p.w[0] - base[0], y = p.w[1] - base[1], z = p.w[2] - base[2]; far = Math.max(far, Math.hypot(x, y, z) + sz);
      if (p.add) { if (ng >= glow.n) continue; GP[3 * ng] = x; GP[3 * ng + 1] = y; GP[3 * ng + 2] = z; GC.set([p.c[0], p.c[1], p.c[2], p.a * (1 - u) * (1 - u)], 4 * ng); GS[ng] = sz / R_E; ng++; }
      else { if (ns >= smoke.n) continue; SP[3 * ns] = x; SP[3 * ns + 1] = y; SP[3 * ns + 2] = z; SC.set([p.c[0], p.c[1], p.c[2], p.a * (1 - u)], 4 * ns); SS[ns] = sz / R_E; ns++; } }
    for (const e of gl) { if (ng >= glow.n) break; const [w, c, al, sz] = e; GP[3 * ng] = w[0] - base[0]; GP[3 * ng + 1] = w[1] - base[1]; GP[3 * ng + 2] = w[2] - base[2]; GC.set([c[0], c[1], c[2], al], 4 * ng); GS[ng] = sz / R_E; ng++; }
    smoke.g.instanceCount = ns; glow.g.instanceCount = ng; for (const q of [smoke, glow]) for (const k in q.A) q.A[k].needsUpdate = true;
    stats.puffs = ns + ng;
    if (far > 0) { const cp = F.piloting ? core.camPose(t) : null, dCam = (cp ? cp.pos : F.camera.position).distanceTo(P.pos) * R_E;
      cc.far = Math.max(cc.far, Math.min(80000, far + dCam + 50) / R_E); cc.near = Math.min(cc.near, 1 / R_E); }
    stats.drawMs += (performance.now() - t0 - stats.drawMs) * .05; });

  // reset button of the flight UI: clear the projectiles, refill the fallback load (stations refills its own)
  function clear() { for (const m of live) { if (m.obj) m.obj.removeFromParent(); } live.length = 0; bus.missiles.length = 0; puffs.length = 0; boom.length = 0; for (const k in fb) fb[k].left = CL[k].fallback.count; }
  const onClick = e => { if (e.target.closest && e.target.closest('[data-a="reset"]')) clear(); };
  if (ctx.ui) ctx.ui.addEventListener('click', onClick);

  function dispose() { clear(); Wp.removeSystem(sys); if (ctx.ui) ctx.ui.removeEventListener('click', onClick); ctx.cs.remove(root);
    for (const q of [smoke, glow]) { q.g.dispose(); q.mt.dispose(); } for (const g of geos) g.dispose(); for (const k in mats) mats[k].dispose(); }
  bus.decoy = decoy;   /* S12: contract field (countermeasures) */
  return { dispose, stats, live, puffs, data: J, page, clear, pickTarget, fireAt, decoy, fire() { want = true; } };
}
