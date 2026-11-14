/* Flight core (docs/flight-plan.md, step S0c): fixed-step 6-DOF rigid-body physics at 120 Hz on earthgl's one clock, keyboard + Gamepad
   input, ground contact against the drawn ground, the pilot camera. Own code (method after JSBSim / standard rigid-body texts; no GPL code).
   Frames (see the plan's Interfaces): physics in I = ecliptic axes, origin = the reference body's centre, metres, m/s (doubles);
   drawing in W = earthgl's Earth-fixed world, 1 unit = 1 R⊕. Body axes: -z forward, +y up, +x right.
   Force modules: { forces(state, env, acc), substeps? } add acc.F (N, frame I) and acc.M (N·m, body axes).
   Reference body: the Earth for aircraft; S1 (flight/orbit.js) re-bases s.ref at sphere-of-influence changes. A module with
   refOffset(ref, t) (the ref's centre relative to the Earth's, m, I) lets core draw a craft whose ref is not the Earth; a module with
   railsOk(s, t) / rails(s, t) takes over above the steps-per-frame cap ("on rails"). opts.start(t) -> { ref, r, v, q, w } starts the craft
   there (no wait for the ground tiles); opts.warps = the time-speed steps; a module may ask for a time speed with s.warpReq. */

export const R_E = 6371000;                 // m, earthgl's unit (sea-level sphere; the drawn sea lies 400 m above it)
export const GM_E = 3.986004418e14;         // m³/s², WGS 84
const OMEGA_E = 7.2921158553e-5;     // rad/s: the rate of earthgl's gmst() (360.98564736629°/day)
const EPS = 23.4393 * Math.PI / 180; // obliquity, the value solar.js uses
const G0 = 9.80665;
export const H = 1 / 120;            // s, the physics step
export const MAX_STEPS = 120;        // steps per frame at most (warp ≤ fps); above that the clock is pulled back
export const AIR_TOP = 100e3;        // m over the drawn sea: "inside the air" below this
export const AIR_WARP = 4;           // warp cap inside the air and on the ground

// ── small vector / quaternion helpers on plain arrays (doubles); quaternions [x, y, z, w]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], len = a => Math.hypot(a[0], a[1], a[2]);
const madd = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qconj = q => [-q[0], -q[1], -q[2], q[3]];
const qnorm = q => { const n = Math.hypot(q[0], q[1], q[2], q[3]); return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; };
const qrot = (q, v) => { const t = mul(cross(q, v), 2); return add(add(v, mul(t, q[3])), cross(q, t)); };   // q·v·q*
const mv = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
function inv3(M) { const [a, b, c] = M[0], [d, e, f] = M[1], [g, h, i] = M[2], A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A / det, (c * h - b * i) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, (c * d - a * f) / det], [C / det, (b * g - a * h) / det, (a * e - b * d) / det]]; }
// rotation matrix (columns = images of x, y, z) -> quaternion
export function qFromBasis(X, Y, Z) { const m00 = X[0], m11 = Y[1], m22 = Z[2], tr = m00 + m11 + m22; let q;
  if (tr > 0) { const s = .5 / Math.sqrt(tr + 1); q = [(Y[2] - Z[1]) * s, (Z[0] - X[2]) * s, (X[1] - Y[0]) * s, .25 / s]; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [.25 * s, (Y[0] + X[1]) / s, (Z[0] + X[2]) / s, (Y[2] - Z[1]) / s]; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(Y[0] + X[1]) / s, .25 * s, (Z[1] + Y[2]) / s, (Z[0] - X[2]) / s]; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(Z[0] + X[2]) / s, (Z[1] + Y[2]) / s, .25 * s, (X[1] - Y[0]) / s]; }
  return qnorm(q); }

// ── I (ecliptic, Earth-centred) <-> F (Earth-fixed: x = lon 0, y = north, z = -lon 90°), the same turn as solar.js eclToWorld without earthgl's W quaternion
const D2R = Math.PI / 180, CE = Math.cos(EPS), SE = Math.sin(EPS);
export const gmst = t => ((280.46061837 + 360.98564736629 * (t / 864e5 + 2440587.5 - 2451545)) % 360) * D2R;
export function toF(t, v) { const g = gmst(t), cg = Math.cos(g), sg = Math.sin(g), e1 = CE * v[1] - SE * v[2], e2 = SE * v[1] + CE * v[2];
  return [cg * v[0] + sg * e1, e2, sg * v[0] - cg * e1]; }
export function fromF(t, f) { const g = gmst(t), cg = Math.cos(g), sg = Math.sin(g), q0 = cg * f[0] + sg * f[2], q1 = sg * f[0] - cg * f[2], q2 = f[1];
  return [q0, CE * q1 + SE * q2, -SE * q1 + CE * q2]; }
export const qIF = t => qFromBasis(toF(t, [1, 0, 0]), toF(t, [0, 1, 0]), toF(t, [0, 0, 1]));   // I -> F
export const OMEGA_I = [0, SE * OMEGA_E, CE * OMEGA_E];   // the Earth's spin vector in I (its axis = the equator's pole)
const nrmOf = (lat, lon) => [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)];   // as earthgl.js
export const latLonOf = f => { const r = len(f); return [Math.asin(f[1] / r), Math.atan2(-f[2], f[0])]; };
// local east / north / up at a point of F
const enu = (lat, lon) => [[-Math.sin(lon), 0, -Math.cos(lon)], [-Math.sin(lat) * Math.cos(lon), Math.cos(lat), Math.sin(lat) * Math.sin(lon)], nrmOf(lat, lon)];

// ── air: US Standard Atmosphere 1976 (S2, flight/atmos.js); wind: GFS (S6, flight/wind.js)
import { atmosphere } from './atmos.js?v=7ee6d1db';
import { sharedWind, createGusts } from './wind.js?v=f82bd853';

// ── PLACEHOLDER force model for the test craft (S1 / S2 replace it): point-mass gravity of the Earth, drag ½ρv²·CdA, a lift thruster along
// body +y (throttle 1 = 2 g), control torques + attitude damping. Not an aircraft: it hovers and flies by tilting, like a lander.
export function testForces(def) {
  return { name: 'test (placeholder)', forces(s, env, acc) {
    const r = len(s.r); acc.F = madd(acc.F, s.r, -GM_E * s.m / (r * r * r));
    const v = env.vAirOf(s), V = len(v); if (V > 0) acc.F = madd(acc.F, v, -.5 * env.air.rho * def.cdA * V);
    acc.F = add(acc.F, qrot(s.q, [0, s.ctl.throttle * def.thrust, 0]));
    const k = def.torque, c = def.damp; acc.M = add(acc.M, [k[0] * s.ctl.pitch - c[0] * s.w[0], -k[1] * s.ctl.yaw - c[1] * s.w[1], -k[2] * s.ctl.roll - c[2] * s.w[2]]); } };
}

// ── PLACEHOLDER ground contact (S2 brings gear with real geometry): spring-dampers at body points against the drawn ground (groundAt × 1 + 400 m
// in pilot mode), with regularised Coulomb friction relative to the turning ground; 4 sub-steps per step (480 Hz). The normal is the local
// vertical (slopes ignored).
export function groundContact(def) {
  return { name: 'contact (placeholder)', substeps: 4, forces(s, env, acc) {
    s.contact = []; const wE = OMEGA_I;
    for (const p of def.points) {
      const x = add(s.r, qrot(s.q, p)), xl = len(x), f = toF(s.t, x), [la, lo] = latLonOf(f), g = env.groundOf(la, lo), d = R_E + g - xl;
      if (d <= 0) { s.contact.push({ wheel: p, compression: 0, force: 0 }); continue; }
      const n = mul(x, 1 / xl), vp = add(s.v, qrot(s.q, cross(s.w, p))), vr = sub(vp, cross(wE, x)), vn = dot(vr, n);
      const Fn = Math.max(0, def.k * d - def.c * vn), vt = madd(vr, n, -vn), vtl = len(vt), mu = s.ctl.brake > 0 ? def.muBrake : def.mu;
      const Ft = vtl > 1e-9 ? mul(vt, -Math.min(mu * Fn, def.ct * vtl) / vtl) : [0, 0, 0], F = madd(Ft, n, Fn);
      acc.F = add(acc.F, F); acc.M = add(acc.M, cross(p, qrot(qconj(s.q), F))); s.contact.push({ wheel: p, compression: d, force: Fn }); } } };
}

// ── the test craft: a 6 × 4 × 1.5 m box of 1000 kg with a nose arrow (placeholder for S2 / S3)
export const TEST_CRAFT = (() => { const m = 1000, w = 4, h = 1.5, l = 6;
  return { name: 'Test box', m, size: [w, h, l], I: [[m / 12 * (h * h + l * l), 0, 0], [0, m / 12 * (w * w + l * l), 0], [0, 0, m / 12 * (w * w + h * h)]], cg: [0, 0, 0],
    cdA: 3, thrust: 2 * m * G0, torque: [6000, 6000, 4000], damp: [5000, 5000, 3000],
    gear: { points: [[-1.8, -h / 2, -2.6], [1.8, -h / 2, -2.6], [-1.8, -h / 2, 2.6], [1.8, -h / 2, 2.6]], k: m * G0 / 4 / .05, c: 3500, ct: 60000, mu: .05, muBrake: .7 },
    views: [{ name: 'Cockpit', eye: [0, .9, -1.8], tilt: -.1 }, { name: 'Chase', eye: [0, 6, 30], tilt: -.2 }, { name: 'Far chase', eye: [0, 150, 1000], tilt: -.15 }],
    rest: h / 2 - .05 }; })();

// ── input: keyboard + Gamepad API (standard mapping) -> state.ctl
// keys: W / S pitch (W = nose down), A / D roll, Q / E yaw, arrows = pitch / roll, R / F throttle, X throttle 0, B brake, G gear, C view,  , / . time speed
const KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyX', 'KeyB', 'KeyG', 'KeyC', 'Comma', 'Period', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
function createInput(on, ext) {   // ext() -> touch controls (session.js, phones) or null
  const k = new Set(), ev = [];
  const kd = e => { if (!on() || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input,textarea,select,[contenteditable]') || !KEYS.includes(e.code)) return;
    e.preventDefault(); if (!e.repeat && !k.has(e.code)) ev.push(e.code); k.add(e.code); };
  const ku = e => k.delete(e.code), bl = () => k.clear();
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('blur', bl);
  let padPrev = [];
  const toward = (x, aim, rate, dt) => x + Math.max(-rate * dt, Math.min(rate * dt, aim - x));
  const dz = a => Math.abs(a) < .1 ? 0 : (a - Math.sign(a) * .1) / .9;
  return {
    // returns one-shot events ('KeyC', 'KeyG', 'Comma', 'Period', 'pad3', …) and updates ctl in place
    update(ctl, dt) { const out = ev.splice(0), has = c => k.has(c);
      const ax = (p, n) => (has(p) ? 1 : 0) - (has(n) ? 1 : 0);
      let pitch = ax('KeyS', 'KeyW') || ax('ArrowDown', 'ArrowUp'), roll = ax('KeyD', 'KeyA') || ax('ArrowRight', 'ArrowLeft'), yaw = ax('KeyE', 'KeyQ');
      let thr = ax('KeyR', 'KeyF') * .6, brake = has('KeyB') ? 1 : 0, pad = null;
      const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g && g.connected) : null;
      if (gp) { pad = gp.id; const a = gp.axes, b = gp.buttons, bv = i => b[i] ? b[i].value : 0;
        if (dz(a[1] || 0)) pitch = dz(a[1]); if (dz(a[0] || 0)) roll = dz(a[0]); if (dz(a[2] || 0)) yaw = dz(a[2]);
        if (bv(7) > .05 || bv(6) > .05) thr = (bv(7) - bv(6)) * .8; if (bv(1) > .5) brake = 1;
        b.forEach((x, i) => { if (x.pressed && !padPrev[i]) out.push('pad' + i); }); padPrev = b.map(x => x.pressed); }
      // S7 touch controls: a virtual stick sets pitch / roll like a gamepad stick; the throttle slider sets the throttle; buttons send key events
      const tc = ext && ext(); let tStick = false;
      if (tc) { if (tc.active) { pitch = tc.pitch; roll = tc.roll; tStick = true; } if (tc.thr != null) { ctl.throttle = tc.thr; tc.thr = null; } if (tc.brake) brake = 1; if (tc.ev.length) out.push(...tc.ev.splice(0)); }
      // keys ramp the controls (3 /s out, 4 /s back to centre); a stick sets them directly
      const kRate = (x, aim) => toward(x, aim, aim ? 3 : 4, dt);
      ctl.pitch = tStick || (gp && dz(gp.axes[1] || 0)) ? pitch : kRate(ctl.pitch, pitch); ctl.roll = tStick || (gp && dz(gp.axes[0] || 0)) ? roll : kRate(ctl.roll, roll);
      ctl.yaw = gp && dz(gp.axes[2] || 0) ? yaw : kRate(ctl.yaw, yaw);
      ctl.throttle = Math.max(0, Math.min(1, ctl.throttle + thr * dt)); ctl.brake = brake; ctl.pad = pad;
      if (out.includes('KeyX')) ctl.throttle = 0;
      return out; },
    dispose() { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', bl); } };
}

// ── the core
// F = api.flight() of earthgl; def = a craft definition (TEST_CRAFT); at = { lat, lon (deg), heading (deg true) } = where it stands on the ground
export function createCore(F, def, at, opts = {}) {
  const THREE = F.THREE, clock = F.clock;
  const mods = opts.mods || [testForces(def), groundContact(def.gear)];
  const nSub = Math.max(1, ...mods.map(m => m.substeps || 1)), steps = mods.filter(m => m.step), hudMods = mods.filter(m => m.hud);
  // S1: other reference bodies (offset of their centre from the Earth's) and Kepler arcs at high warp
  const railsMod = mods.find(m => m.rails), offMod = mods.find(m => m.refOffset);
  const offOf = (ref, t) => ref === 'Earth' || !offMod ? [0, 0, 0] : offMod.refOffset(ref, t);
  const VAC = { rho: 0, T: 3, p: 0, a: 1 };
  const s = { ref: 'Earth', r: [R_E, 0, 0], v: [0, 0, 0], q: [0, 0, 0, 1], w: [0, 0, 0], m: def.m, I: def.I, cg: def.cg,
    ctl: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 1, gear: 1, flaps: 0, trim: 0, stage: 0, pad: null },
    srf: { elev: 0, ail: 0, rud: 0, flap: 0, spoiler: 0, gear: 1 }, eng: [], sys: { fuel: [] }, contact: [], onGround: false, t: 0 };
  if (def.init) def.init(s);   // S2: the craft sets its own systems (fuel, parking brake, surfaces)
  let Iinv = inv3(s.I), Iof = s.I;   // cached while the mass properties stay the same (S5: recompute when m / I change)
  // time: tBase (ms) + kSub whole sub-steps; adding 2.08 ms to a ~1.8e12 ms clock rounds by up to 1.2e-4 ms per add, which drifted a parked craft
  // 0.8 m/min against the turning ground
  let tBase = 0, kSub = 0;   // kSub counts the finest sub-steps (H / nSub); far over the ground (> 300 m) a step is one sub-step: no contact to resolve
  let hold = true, gSeen = null, gSince = 0, view = 0, warpWant = 1, lastG = 400;
  const stats = { ms: 0, msMax: 0, steps: 0, frames: 0, warp: 1, warpCap: AIR_WARP, onRails: false, log: null };
  const input = createInput(() => !!F.piloting && !hold, () => !hold && F.piloting ? api.touch : null);
  // the ground physics uses: true relief + 400 m (= what is drawn in pilot mode, where earthgl pins the relief factor to 1); the last value where no
  // height tile is loaded yet
  const groundOf = (la, lo) => { const g = F.groundAt(la, lo); if (g != null) lastG = g + 400; return lastG; };
  let ph = null;   // earthgl's pilot handle ({ look }) while pilot mode is on
  // S6: the craft flies in the air mass: vAir = v - ω⊕ × r - wind; wind = GFS mean wind (flight/wind.js) + Dryden-lite gusts near the ground,
  // set once per step (windStep) in frame I. No wind in a storm replay (the past) or with opts.wind === false
  const wind = opts.wind === false || window.STORM ? null : sharedWind(), gusts = createGusts(7), wM = [0, 0], w6 = [0, 0];
  let wI = [0, 0, 0]; const wNow = { e: 0, n: 0, ge: 0, gn: 0, gu: 0, on: false };
  const vAirOf = st => st.ref === 'Earth' ? sub(sub(st.v, cross(OMEGA_I, st.r)), wI) : st.v;
  function windStep(dt) {
    if (!wind || !wind.ready || s.ref !== 'Earth') { wI = [0, 0, 0]; wNow.on = false; return; }
    const [la, lo] = latLonOf(toF(s.t, s.r)), g = groundOf(la, lo), rl = len(s.r), hMSL = rl - R_E - 400, hAGL = Math.max(rl - R_E - g, 0);
    const m = wind.at(la / D2R, lo / D2R, hMSL, hAGL, s.t, wM), w20 = Math.hypot(...wind.at(la / D2R, lo / D2R, g - 400 + 6, 6, s.t, w6));
    const gs = gusts.step(dt, hAGL, len(vAirOf(s)), m[0], m[1], w20), [E, N, U] = enu(la, lo);
    wI = fromF(s.t, add(add(mul(E, m[0] + gs[0]), mul(N, m[1] + gs[1])), mul(U, gs[2])));
    Object.assign(wNow, { e: m[0], n: m[1], ge: gs[0], gn: gs[1], gu: gs[2], on: true }); }

  // environment of one sub-step (from the state at its start)
  function envOf(st) {
    if (st.ref !== 'Earth') { const rl = len(st.r), R = offMod ? offMod.radius(st.ref) : 0;   // S1: no air, no ground model away from the Earth (yet)
      return { t: st.t, dt: H / nSub, ref: st.ref, alt: rl - R, altMSL: rl - R, lat: 0, lon: 0, nUp: mul(st.r, 1 / rl), ground: 0, air: VAC, vAir: st.v,
        aero: { alpha: 0, beta: 0, vTas: len(st.v), mach: 0, qbar: 0, pqr: st.w, alphaDot: 0 }, groundOf, vAirOf }; }
    const f = toF(st.t, st.r), [lat, lon] = latLonOf(f), g = groundOf(lat, lon), rl = len(st.r), altMSL = rl - R_E - 400, alt = rl - R_E - g;
    const air = atmosphere(altMSL), vAir = vAirOf(st), vb = qrot(qconj(st.q), vAir), V = len(vb);
    const aero = { alpha: Math.atan2(-vb[1], -vb[2]), beta: V > 1e-6 ? Math.asin(Math.max(-1, Math.min(1, vb[0] / V))) : 0, vTas: V, mach: V / air.a, qbar: .5 * air.rho * V * V, pqr: st.w, alphaDot: 0 };
    return { t: st.t, dt: H / nSub, ref: st.ref, alt, altMSL, lat, lon, nUp: mul(st.r, 1 / rl), ground: (g - 400), air, vAir, aero, groundOf, vAirOf }; }

  function deriv(st, env) { const acc = { F: [0, 0, 0], M: [0, 0, 0] }; for (const m of mods) if (m.forces) m.forces(st, env, acc);
    const Iw = mv(st.I, st.w); st.acc = acc;
    return { dr: st.v, dv: mul(acc.F, 1 / st.m), dq: qmul(st.q, [st.w[0], st.w[1], st.w[2], 0]).map(x => x * .5), dw: mv(Iinv, sub(acc.M, cross(st.w, Iw))) }; }
  const stage = (b, d, k, dt) => ({ ...b, r: madd(b.r, d.dr, k), v: madd(b.v, d.dv, k), q: qnorm([b.q[0] + d.dq[0] * k, b.q[1] + d.dq[1] * k, b.q[2] + d.dq[2] * k, b.q[3] + d.dq[3] * k]),
    w: madd(b.w, d.dw, k), t: b.t + dt * 1e3, contact: [] });
  // one RK4 sub-step of length hs (s)
  function rk4(hs) { const env = envOf(s), k1 = deriv(s, env), a = stage(s, k1, hs / 2, hs / 2), k2 = deriv(a, env), b = stage(s, k2, hs / 2, hs / 2), k3 = deriv(b, env), c = stage(s, k3, hs, hs), k4 = deriv(c, env);
    const comb = (f, i) => (k1[f][i] + 2 * k2[f][i] + 2 * k3[f][i] + k4[f][i]) / 6;
    for (let i = 0; i < 3; i++) { s.r[i] += comb('dr', i) * hs; s.v[i] += comb('dv', i) * hs; s.w[i] += comb('dw', i) * hs; }
    s.q = qnorm([0, 1, 2, 3].map(i => s.q[i] + comb('dq', i) * hs)); kSub += Math.round(hs * nSub / H); s.t = tBase + kSub * (H / nSub) * 1e3; s.contact = c.contact;   // s.acc = the forces at the sub-step's start (set by deriv)
    noFallThrough(env); }
  // a hard floor: no part of the craft more than 0.3 m inside the ground (a crash or a late height tile), no speed into it
  function noFallThrough() { if (s.ref !== 'Earth') return; let deep = 0; const x0 = len(s.r), n = mul(s.r, 1 / x0);
    for (const p of def.gear.points.concat([[0, -def.size[1] / 2, 0]])) { const x = add(s.r, qrot(s.q, p)), [la, lo] = latLonOf(toF(s.t, x)); deep = Math.max(deep, R_E + groundOf(la, lo) - len(x) - .3); }
    if (deep > 0) { s.r = madd(s.r, n, deep); const vr = sub(s.v, cross(OMEGA_I, s.r)), vn = dot(vr, n); if (vn < 0) s.v = madd(s.v, n, -vn); } }

  // place / re-anchor: a pose relative to the turning ground (F) -> I at time t
  function fixedPose() { const qf = qmul(qIF(s.t), s.q), vr = sub(s.v, cross(OMEGA_I, s.r)), wb = sub(s.w, qrot(qconj(s.q), OMEGA_I));
    return { f: toF(s.t, s.r), vf: toF(s.t, vr), qf, wb }; }
  function setFromFixed(t, P) { s.t = tBase = t; kSub = 0; s.r = fromF(t, P.f); s.q = qnorm(qmul(qconj(qIF(t)), P.qf)); s.v = add(fromF(t, P.vf), cross(OMEGA_I, s.r)); s.w = add(P.wb, qrot(qconj(s.q), OMEGA_I)); }
  function placeOnGround(t, g) { const la = at.lat * D2R, lo = at.lon * D2R, hd = (at.heading || 0) * D2R, [E, N, U] = enu(la, lo);
    const fw = add(mul(N, Math.cos(hd)), mul(E, Math.sin(hd))), Z = mul(fw, -1), X = cross(U, Z);
    setFromFixed(t, { f: mul(U, R_E + g + def.rest), vf: [0, 0, 0], qf: qFromBasis(X, U, Z), wb: [0, 0, 0] }); prevW = curW = poseW(); }

  // W pose of the state (Earth-fixed world, R⊕), with three.js objects for drawing
  const qE = () => [F.earthQuat.x, F.earthQuat.y, F.earthQuat.z, F.earthQuat.w];
  function poseW() { const e = qE(), f = toF(s.t, add(s.r, offOf(s.ref, s.t))), p = qrot(e, f), q = qnorm(qmul(e, qmul(qIF(s.t), s.q)));
    return { p: mul(p, 1 / R_E), q }; }
  let prevW = null, curW = null;
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), cam = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), agl: 2 }, qa = new THREE.Quaternion(), qb = new THREE.Quaternion();

  // HUD data (subset of the plan's list; ias = tas until S2's pitot model)
  const hud = {};
  // S6 wind readout (mean wind, no gusts): from-direction (deg true), speed, headwind (+ = on the nose), crosswind (+ = from the right), m/s
  const windHud = hd => { if (!wNow.on) return { wind: null }; const e = wNow.e, n = wNow.n;
    return { wind: { from: (Math.atan2(-e, -n) / D2R + 360) % 360, spd: Math.hypot(e, n), head: -(e * Math.sin(hd) + n * Math.cos(hd)), cross: -(e * Math.cos(hd) - n * Math.sin(hd)),
      gust: Math.hypot(wNow.ge, wNow.gn, wNow.gu) } }; };
  function hudFill() { const f = toF(s.t, add(s.r, offOf(s.ref, s.t))), [la, lo] = latLonOf(f), [E, N, U] = enu(la, lo), qf = qmul(qIF(s.t), s.q);
    const fw = qrot(qf, [0, 0, -1]), rt = qrot(qf, [1, 0, 0]), up = qrot(qf, [0, 1, 0]), vr = toF(s.t, vAirOf(s)), env = envOf(s);
    const gA = s.acc && s.acc.g ? s.acc.g : mul(s.r, -GM_E / Math.pow(len(s.r), 3)), nonG = s.acc ? len(madd(s.acc.F, gA, -s.m)) : 0;   // S1: acc.g = gravity (m/s²)
    Object.assign(hud, { tas: env.aero.vTas, ias: env.aero.vTas, mach: env.aero.mach, gs: Math.hypot(dot(vr, E), dot(vr, N)), vs: dot(vr, U), altMSL: env.altMSL, agl: env.alt - def.rest,
      heading: (Math.atan2(dot(fw, E), dot(fw, N)) / D2R + 360) % 360, pitch: Math.asin(Math.max(-1, Math.min(1, dot(fw, U)))) / D2R, roll: Math.atan2(-dot(rt, U), dot(up, U)) / D2R,
      aoa: env.aero.alpha / D2R, beta: env.aero.beta / D2R, ...windHud(Math.atan2(dot(fw, E), dot(fw, N))), g: nonG / (s.m * G0), throttle: s.ctl.throttle, mass: s.m, gear: s.ctl.gear, brake: s.ctl.brake, flaps: s.ctl.flaps,
      onGround: s.onGround, lat: la / D2R, lon: lo / D2R, t: s.t, warp: stats.warp, warpCap: stats.warpCap, onRails: stats.onRails, view: def.views[view].name, hold, pad: s.ctl.pad });
    for (const m of hudMods) m.hud(s, env, hud); }

  function setWarp(x) { warpWant = x; clock.setRate(Math.min(x, capNow()) * 1e3); }
  const capNow = () => ((s.ref === 'Earth' && len(s.r) - R_E - 400 < AIR_TOP) || s.onGround) ? AIR_WARP : Math.max(1, Math.floor(MAX_STEPS * H * Math.max(30, stats.fps || 60)));
  const WARPS = opts.warps || [1, 2, 4, 10, 60];

  // per frame (earthgl calls it before the camera / near plane / tiles): integrate to the clock's time in fixed steps
  function frame(dtReal, t) {
    stats.fps = (stats.fps || 60) + (1 / Math.max(dtReal, 1e-3) - (stats.fps || 60)) * .05;
    if (hold && opts.start) { const P = opts.start(t); if (!P) return; /* S5: null = keep waiting (pad heights not loaded yet) */ s.t = tBase = t; kSub = 0; s.ref = P.ref || 'Earth'; s.r = P.r.slice(); s.v = P.v.slice(); s.q = P.q.slice(); s.w = P.w.slice(); prevW = curW = poseW(); hold = false; clock.setRate(1e3); return; }   // S1: start in flight
    if (hold) { const g = F.groundAt(at.lat * D2R, at.lon * D2R);   // wait for the height tiles at the spot: the value must stay the same for 1.5 s
      if (g == null) return; if (g !== gSeen) { gSeen = g; gSince = performance.now(); return; } if (performance.now() - gSince < 1500) return;
      placeOnGround(t, g + 400); hold = false; clock.setRate(1e3); return; }
    const t0 = performance.now();
    if (t < s.t - 1 || t - s.t > 36e5) {   // the clock jumped: a craft in space follows its orbit there (S1, Kepler arc); else keep the place + motion relative to the ground
      if (railsMod && !s.onGround && (s.ref !== 'Earth' || len(s.r) - R_E - 400 > AIR_TOP)) { railsMod.rails(s, t); s.t = tBase = t; kSub = 0; }
      else setFromFixed(t, fixedPose());
      prevW = curW = poseW(); }
    const evs = input.update(s.ctl, Math.min(.1, dtReal));
    for (const e of evs) { if (e === 'KeyC' || e === 'pad3') { view = (view + 1) % def.views.length; if (ph) ph.look.identity(); }
      else if (e === 'KeyG' || e === 'pad0') s.ctl.gear = s.ctl.gear ? 0 : 1;
      else if (e === 'Period' || e === 'pad5') setWarp(WARPS[Math.min(WARPS.length - 1, WARPS.indexOf(warpWant) + 1)]);
      else if (e === 'Comma' || e === 'pad4') setWarp(WARPS[Math.max(0, WARPS.indexOf(warpWant) - 1)]); }
    // warp cap: x4 inside the air / on the ground; elsewhere steps per frame ≤ MAX_STEPS (S1 puts the craft on rails above that)
    if (s.warpReq) { setWarp(s.warpReq); delete s.warpReq; }   // a module asks for a time speed (S1: x1 at the start of an auto burn)
    // S1 "on rails": above the cap, outside the air, without thrust -> Kepler arc about the dominant body to the clock's time
    if (railsMod && warpWant > capNow() && railsMod.railsOk(s, t)) {
      if (Math.abs(clock.rate() / 1e3 - warpWant) > 1e-9) clock.setRate(warpWant * 1e3);
      stats.onRails = true; stats.warp = warpWant; stats.warpCap = capNow(); stats.steps = 0;
      if (t > s.t) { railsMod.rails(s, t); tBase = s.t; kSub = 0; if (t - s.t > 1) clock.set(s.t); }
      prevW = curW = poseW(); const ms = performance.now() - t0; stats.ms += (ms - stats.ms) * .05; stats.frames++; hudFill(); return; }
    stats.onRails = false;
    const cap = capNow(), rate = clock.rate() / 1e3; stats.warpCap = cap;
    if (rate > cap + 1e-9) clock.setRate(cap * 1e3); else if (rate < Math.min(warpWant, cap) - 1e-9 && rate > 0) clock.setRate(Math.min(warpWant, cap) * 1e3);
    stats.warp = Math.min(Math.max(0, clock.rate() / 1e3), cap);
    let n = Math.floor((t - s.t) / (H * 1e3) + 1e-9);
    if (n > MAX_STEPS) { n = MAX_STEPS; }
    for (let i = 0; i < n; i++) { prevW = curW; windStep(H);
      // S2: once per step (h = H) the discrete systems run (FCS, actuators, engine, fuel); a new inertia tensor -> new inverse
      if (steps.length) { const e = envOf(s); for (const m of steps) m.step(s, e, H); if (s.I !== Iof) { Iinv = inv3(s.I); Iof = s.I; } }
      const ns = len(s.r) - R_E - lastG < 300 ? nSub : 1; for (let j = 0; j < ns; j++) rk4(H / ns); curW = poseW(); }
    if (t - s.t > H * 1e3) clock.set(s.t);   // the frame asked for more than MAX_STEPS: pull the clock back (one clock, the warp is lowered)
    s.onGround = s.contact.some(c => c.force > 0);
    stats.steps = n; const ms = performance.now() - t0; stats.ms += (ms - stats.ms) * .05; stats.msMax = Math.max(stats.msMax * .995, ms); stats.frames++;
    if (stats.log) stats.log.push([ms, n, stats.warp]);
    hudFill();
  }
  // the pose to draw, between the last two steps (fixed steps vs. any frame rate); W, R⊕
  function drawPose(t) { if (!curW) return null; const a = prevW ? Math.max(0, Math.min(1, (t - s.t) / (H * 1e3))) : 1, p0 = prevW || curW;
    pos.set(p0.p[0] + (curW.p[0] - p0.p[0]) * a, p0.p[1] + (curW.p[1] - p0.p[1]) * a, p0.p[2] + (curW.p[2] - p0.p[2]) * a);
    qa.set(...p0.q); qb.set(...curW.q); quat.copy(qa).slerp(qb, a); return { pos, quat }; }
  // the pilot camera: a view of the craft (cockpit / chase), rigid to it
  function camPose(t) { if (hold) return holdCam(t); const P = drawPose(t); if (!P) return null; const V = def.views[view], e = V.eye; cam.fov = V.fov || 0;   // S3b: a view may set its own vertical field of view (deg)
    if (V.pose) V.pose(P, cam, ph ? ph.look : null);   // S3: a view with its own pose (free orbit around the craft); sets cam.pos / cam.quat (earthgl adds the look turn)
    else { cam.pos.set(e[0], e[1], e[2]).multiplyScalar(1 / R_E).applyQuaternion(P.quat).add(P.pos);
      cam.quat.copy(P.quat).multiply(qa.setFromAxisAngle(new THREE.Vector3(1, 0, 0), V.tilt || 0)); }
    const fW = [cam.pos.x, cam.pos.y, cam.pos.z], e0 = qE(), f = qrot(qconj(e0), fW), [la, lo] = latLonOf(f); cam.agl = len(fW) * R_E - R_E - groundOf(la, lo);
    return cam; }

  // while the height tiles load: the camera 1.5 km over the spot, looking along the heading 30° down (so earthgl loads the tiles there)
  function holdCam() { const la = at.lat * D2R, lo = at.lon * D2R, hd = (at.heading || 0) * D2R, [E, N, U] = enu(la, lo), e = qE();
    const fw = add(mul(N, Math.cos(hd)), mul(E, Math.sin(hd))), Z = mul(fw, -1), X = cross(U, Z), q = qmul(e, qFromBasis(X, U, Z)), p = qrot(e, mul(U, (R_E + 1500 + 400 + (gSeen || 0)) / R_E));
    cam.pos.set(...p); cam.quat.set(...q).multiply(qa.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -.5)); cam.agl = 1500; return cam; }

  let tNow = 0; const off = F.onFrame((dt, t) => { tNow = t; frame(dt, t); if (api.onPose) api.onPose(hold ? null : drawPose(t), t); });
  const api = { state: s, hud, stats, def, touch: null, get hold() { return hold; }, get view() { return view; }, set view(v) { view = v % def.views.length; },
    pilot(on) { const h = F.pilot(on, () => camPose(tNow)); ph = on ? h : null; if (on && h) h.onOff = () => { ph = null; if (api.onPilotOff) api.onPilotOff(); }; },
    setWarp, warps: WARPS, drawPose, camPose, poseW, fixedPose,
    teleport(P) { setFromFixed(s.t, P); prevW = curW = poseW(); },
    reset(P) { if (def.init) def.init(s); s.v = [0, 0, 0]; s.w = [0, 0, 0]; s.contact = []; setFromFixed(s.t, P); prevW = curW = poseW(); },   // S2: systems back to the start + a pose   // P = fixedPose() shape: { f (m, F), vf (m/s rel. ground, F), qf (body -> F), wb (rad/s rel. ground, body) }
    // check the I -> W turn against solar.js (the two must agree; numbers in the console)
    selfCheck(t) { const M = F.solar.eclToWorld(t), v = [.3, .5, .8], a = new THREE.Vector3(...v).applyMatrix3(M), b = qrot(qE(), toF(t, v)); return Math.hypot(a.x - b[0], a.y - b[1], a.z - b[2]); },
    dispose() { off(); input.dispose(); F.pilot(false); } };
  return api;
}
