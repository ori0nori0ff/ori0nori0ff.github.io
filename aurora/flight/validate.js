/* S2 validation runs, headless (no Earth view): the real flight/core.js + aero.js with a mock api.flight() (flat ground of a fixed height,
   no tiles), driven by small test autopilots. Use from the console of fly.html:  (await import('./flight/validate.js')).run('takeoff')
   Tests: takeoff, minspeed, maxspeed (sea level, 10 km), climb, turn, cost. Results are plain numbers (SI + kt / ft/min where useful). */
import * as THREE from 'three';
import { createCore, R_E, toF } from './core.js';
import { loadAircraft } from './aero.js';

const D2R = Math.PI / 180, KT = 1.943844;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => a.map(x => x * k), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const qrot = (q, v) => { const t = mul(cross(q, v), 2); return add(add(v, mul(t, q[3])), cross(q, t)); };
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const RWY = { lat: 45.6960 + .0205 * 150 / 2823, lon: 25.5128 + .0214 * 150 / 2823, heading: 36.1 };

async function make(relief, load = LOAD) {   // load = { tanks, fuel } (flight/stores.js); none = the clean jet with 1 800 kg as always
  let cb = null, rate = 1e3; const F = { THREE, earthQuat: new THREE.Quaternion(), groundAt: () => relief, clock: { now: () => 0, set() {}, setRate(x) { rate = x; }, rate: () => rate, playing: () => true },
    onFrame(f) { cb = f; return () => {}; }, pilot() { return null; }, piloting: false };
  const ac = await loadAircraft(new URL('aircraft/f16.json', import.meta.url), load); let ap = null;
  const apMod = { step(s, env, h) { if (ap) ap(s, env, h); } };
  const core = createCore(F, ac.def, RWY, { mods: [apMod, ...ac.mods] });
  let t = 1.7e12; cb(.016, t); await new Promise(r => setTimeout(r, 1700)); cb(.016, t); cb(.016, t);   // hold: the ground value must stay 1.5 s
  if (core.hold) throw new Error('still holding');
  const sim = (sec, every, fn) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { t += 1000 / 60; cb(1 / 60, t); if (fn && fn(core.hud, core.state, i / 60)) return true; } return false; };
  return { core, ac, sim, set ap(f) { ap = f; }, s: core.state };
}
// airborne start: altitude MSL (m), true airspeed (m/s), level, alpha guess
function launch(T, hMSL, V, alDeg) { const P = T.core.fixedPose(), f = mul(P.f, (R_E + 400 + hMSL) / Math.hypot(...P.f));
  const fw = qrot(P.qf, [0, 0, -1]), qf = qmul(P.qf, [Math.sin(alDeg * D2R / 2), 0, 0, Math.cos(alDeg * D2R / 2)]);
  T.core.teleport({ f, vf: mul(fw, V), qf, wb: [0, 0, 0] }); T.s.ctl.park = false; T.s.ctl.gear = 0; T.s.srf.gear = 0; }
// test autopilot: altitude hold through the g command, bank hold, optional speed hold by throttle, endless fuel (mass constant)
function holdAP(o) { return (s, env, h) => { const U = env.nUp, vs = dot(env.vAir, U), rt = qrot(s.q, [1, 0, 0]), up = qrot(s.q, [0, 1, 0]);
  const phi = Math.atan2(-dot(rt, U), dot(up, U)), ph = (o.bank || 0) * D2R, n = 1 / Math.cos(ph);
  const dn = .004 * (o.alt - env.altMSL) - .06 * vs; s.ctl.pitch = Math.max(-1, Math.min(1, (n - 1 + dn) / 8 * (o.bank ? 1 : 1)));
  if (o.bank) { const fw = qrot(s.q, [0, 0, -1]), cth = Math.sqrt(1 - dot(fw, U) ** 2), cph = Math.cos(phi), ref = cth * (cph >= .5 ? 1 / cph : cph > -.5 ? 4 * cph : 1 / cph);
    s.ctl.pitch = Math.max(-1, Math.min(1, (n * cth + dn - ref) / (9 - ref))); }   // the stick that asks the FCS for n g (+ altitude correction)
  s.ctl.roll = Math.max(-1, Math.min(1, (ph - phi) * 1.5)); s.ctl.yaw = 0;
  if (o.thr != null) s.ctl.throttle = o.thr; s.sys.fuelHold = !!o.fuel; }; }   // o.fuel: endless fuel (stores.js: nothing burns, the start mass stays)

let LOAD;   // run(name, load): every test of this run with that store load
export async function run(name, load) {
  const out = {}; LOAD = load;
  if (name === 'fuel10' || name === 'jett') return runStores(name, make);
  if (name === 'takeoff') for (const thr of [1, .77]) {   // full afterburner and military power, from the brakes, rotate at 140 KIAS
    const T = await make(136); T.s.ctl.throttle = thr; let x0 = null, r = null, tRot = null;
    T.ap = (s, env) => { s.ctl.throttle = thr; s.ctl.roll = 0; s.ctl.yaw = 0; const h = T.core.hud; s.ctl.pitch = h.ias * KT > 140 ? Math.max(0, Math.min(.6, (12 - h.pitch) / 8)) : 0; };   // the pilot rotates to ~12° pitch
    T.sim(120, 0, (h, s, t) => { const f = toF(s.t, s.r); if (!x0) x0 = f; if (h.ias * KT > 140 && tRot == null) tRot = t;
      if (!h.onGround && h.agl > 1 && !r) r = { roll_m: Math.hypot(f[0] - x0[0], f[1] - x0[1], f[2] - x0[2]), t_s: t, ias_kt: h.ias * KT, pitch: h.pitch, aoa: h.aoa, mass_kg: s.m, crash: h.crash };
      return !!r || h.crash; });
    out[thr === 1 ? 'AB' : 'MIL'] = r || { fail: T.core.hud.crash || 'no lift-off', ias: T.core.hud.ias * KT };
  }
  if (name === 'minspeed') {   // 3 km, idle, altitude hold, gear up: the IAS where the AoA limiter is reached, and the 13° AoA approach speed with gear down
    for (const gear of [0, 1]) { const T = await make(0); launch(T, 3000, 160, 4); if (gear) { T.s.ctl.gear = 1; T.s.srf.gear = 1; } let at13 = null, atLim = null;
      T.ap = holdAP({ alt: 3000, thr: 0, fuel: 1800 }); T.sim(150, 0, (h, s, t) => { if (t < 5) return; if (!at13 && h.aoa > 13) at13 = { ias_kt: h.ias * KT, tas: h.tas };
        if (!atLim && h.aoa > 24) atLim = { ias_kt: h.ias * KT, alt: h.altMSL, aoa: h.aoa }; return !!atLim && t > 10; });
      out[gear ? 'gearDown' : 'clean'] = { at13, atLimit: atLim, mass: T.s.m }; } }
  if (name === 'maxspeed') for (const alt of [100, 10000]) {   // full afterburner, level, until the speed stops growing; also MIL at sea level
    for (const thr of alt === 100 ? [1, .77] : [1]) { const T = await make(0); launch(T, alt, alt > 5000 ? 250 : 250, 2); T.ap = holdAP({ alt, thr, fuel: 1800 });
      let last = 0, best = null, ps = []; T.sim(900, 0, (h, s, t) => { if ((t | 0) % 10 === 0 && Math.abs(t - Math.round(t)) < 1e-6) { const dv = h.tas - last; last = h.tas;
        if (t > 15) ps.push([Math.round(h.mach * 100) / 100, Math.round(h.tas / 9.80665 * dv / 10 * 196.85)]); if (t > 30 && Math.abs(dv) < .05) { best = { mach: h.mach, tas_kmh: h.tas * 3.6, ias_kt: h.ias * KT, t }; return true; } } });
      out[alt + 'm_' + (thr === 1 ? 'AB' : 'MIL')] = { max: best || { mach: T.core.hud.mach, tas_kmh: T.core.hud.tas * 3.6, note: 'still accelerating at 900 s' }, PsFtMinEvery10s: ps }; } }
  if (name === 'turn') for (const n of [3, 5, 7, 9]) {   // 4.5 km (15 000 ft), start Mach 0.8, full AB: bank for n g, altitude hold; turn rate + speed change over 3 s after 3 s
    const T = await make(0); const a = 322.5; launch(T, 4572, .8 * a, 2); T.ap = holdAP({ alt: 4572, thr: 1, fuel: 1800 }); T.sim(4);
    T.ap = holdAP({ alt: 4572, thr: 1, fuel: 1800, bank: Math.acos(1 / n) / D2R }); let h0 = null, r = null;
    T.sim(9, 0, (h, s, t) => { if (t >= 4 && !h0) h0 = { hd: h.heading, v: h.tas, t }; if (t >= 7) { const dh = ((h.heading - h0.hd + 540) % 360) - 180;
      r = { g: h.g, rate_deg_s: Math.abs(dh) / (t - h0.t), dVdt: (h.tas - h0.v) / (t - h0.t), mach: h.mach, aoa: h.aoa, altErr: h.altMSL - 4572 }; return true; } });
    out[n + 'g'] = r; }
  if (name === 'cost') { const T = await make(0); launch(T, 1000, 200, 3); T.ap = holdAP({ alt: 1000, thr: .8 }); const t0 = performance.now(); T.sim(60); out.air_ms_per_sim_s = (performance.now() - t0) / 60;
    const G = await make(136); G.ap = s => { s.ctl.throttle = .3; }; const t1 = performance.now(); G.sim(30); out.ground_ms_per_sim_s = (performance.now() - t1) / 30; }
  if (name === 'speedbrake') {   // 300 KIAS at 5 000 ft (TAS 166 m/s), idle, altitude hold: speed loss over 10 s with the speed brake in / out; then the gear-down limit
    for (const sb of [0, 1]) { const T = await make(0); launch(T, 1524, 166, 3); T.ap = holdAP({ alt: 1524, thr: 0, fuel: 1800 }); T.s.ctl.speedbrake = sb; T.s.srf.spoiler = sb;
      let a = null, b = null, dh = 0, q = 0; T.sim(11, 0, (h, s, t) => { if (t >= 1 && !a) a = { ias: h.ias * KT, t }; if (t >= 1) { dh = Math.max(dh, Math.abs(h.altMSL - 1524)); q = Math.max(q, Math.abs(s.w[0])); }
        if (t >= 10.98 && !b) b = { ias: h.ias * KT, t, sbDeg: h.speedbrake, aoa: h.aoa, elev: s.srf.elev }; });
      out[sb ? 'brakeOut' : 'brakeIn'] = { ias_kt_1s: a.ias, ias_kt_11s: b.ias, decel_kt_s: (a.ias - b.ias) / (b.t - a.t), decel_g: (a.ias - b.ias) / KT / (b.t - a.t) / 9.80665, sbDeg: b.sbDeg, aoa: b.aoa, elev: b.elev, maxAltErr_m: dh, maxPitchRate_dps: q / D2R }; }
    const T = await make(0); launch(T, 1524, 120, 6); T.ap = holdAP({ alt: 1524, thr: .5, fuel: 1800 }); T.s.ctl.speedbrake = 1; T.s.srf.spoiler = 1; T.s.ctl.gear = 1; T.s.srf.gear = .5;
    const L = []; T.sim(6, 0, (h, s, t) => { if (Math.abs(t * 2 - Math.round(t * 2)) < 1e-6) L.push([t, +s.srf.gear.toFixed(2), +h.speedbrake.toFixed(1)]); }); out.gearDown = L; }
  return out;
}

// stores / fuel tests (flight/stores.js): run('fuel10', { tanks: 2 }) = 10 min at 3 km (MIL 6 min, then full AB), a log line per minute;
// run('jett', { tanks: 3 }) = jettison on the ground (inhibited), one press only, then two presses in flight
async function runStores(name, make) {
  const KG = 1 / .45359237, r1 = x => Math.round(x * 10) / 10, out = {};
  const snap = (T, t, ffInt, m0) => { const s = T.s, ST = T.ac.stores, f = s.sys.fuel, h = T.core.hud, g = {};
    ST.tanks.forEach((tk, i) => { g[tk.name] = Math.round(f[i] * KG); });
    return { t, mass_kg: r1(s.m), cg_mm: s.cg.map(x => Math.round(x * 1000)), xcg_cbar: Math.round((.35 + s.cg[2] / 3.4503) * 1e4) / 1e4, groups_lb: g,
      int_lb: Math.round(h.fuelInt * KG), ext_lb: Math.round(h.fuelExt * KG), FR_lb: Math.round(h.fuelFR * KG), AL_lb: Math.round(h.fuelAL * KG),
      burned_kg: r1(ffInt), massDrop_kg: r1(m0 - s.m), ff_pph: Math.round(h.ff * KG * 3600), mach: Math.round(h.mach * 100) / 100,
      low: [h.fuelLowFwd && 'FWD', h.fuelLowAft && 'AFT', h.trpFuel && 'TRP'].filter(Boolean).join(' ') }; };
  if (name === 'fuel10') { const T = await make(0); launch(T, 3000, 200, 3); const m0 = T.s.m; let ffI = 0, k = 0, thr = .77; out.log = [snap(T, 0, 0, m0)];
    T.ap = (s, env, h) => { holdAP({ alt: 3000, thr })(s, env, h); ffI += (s.eng[0] ? s.eng[0].ff : 0) * h; };
    T.sim(600, 0, (h, s, t) => { if (t >= 360) thr = 1; if (t >= (k + 1) * 60 - 1e-9) { k++; out.log.push(snap(T, Math.round(t), ffI, m0)); } return false; });
    const ST = T.ac.stores; out.capacity_lb = { internal: Math.round(ST.tanks.filter(x => !x.ext).reduce((a, x) => a + x.cap, 0) * KG), external: Math.round(ST.tanks.filter(x => x.ext).reduce((a, x) => a + x.cap, 0) * KG) }; }
  if (name === 'jett') { const press = s => { s.ctl.jett = (s.ctl.jett || 0) + 1; };
    const G = await make(136); G.sim(1); const g0 = G.s.m; press(G.s); G.sim(.1); press(G.s); G.sim(1);
    out.ground = { mass_before: r1(g0), mass_after: r1(G.s.m), stores: G.core.hud.stores, msg: G.core.hud.storesMsg };
    const T = await make(0); launch(T, 3000, 200, 3); T.ap = holdAP({ alt: 3000, thr: .77 }); T.sim(2); const a0 = T.s.m;
    press(T.s); T.sim(.2); await new Promise(r => setTimeout(r, 1200)); press(T.s); T.sim(.5);   // presses 1.2 s apart (real time): arms twice, no release
    out.slow = { mass_before: r1(a0), mass_after: r1(T.s.m), stores: T.core.hud.stores };
    const b0 = { m: T.s.m, cg: T.s.cg.map(x => Math.round(x * 1000)), units: T.s.sys.stores.units, fuel: Math.round(T.core.hud.fuel) };
    await new Promise(r => setTimeout(r, 1200)); press(T.s); T.sim(.1); press(T.s); T.sim(1);   // the arm of the slow pair has run out first
    out.fast = { before: b0, after: { m: r1(T.s.m), cg: T.s.cg.map(x => Math.round(x * 1000)), units: T.s.sys.stores.units, fuel: Math.round(T.core.hud.fuel) }, dropped_kg: r1(b0.m - T.s.m),
      drops: T.s.sys.stores.drops.map(d => ({ n: d.n, type: d.type, mass: r1(d.mass), fuel: r1(d.fuel) })), stores: T.core.hud.stores, msg: T.core.hud.storesMsg }; }
  return out;
}
