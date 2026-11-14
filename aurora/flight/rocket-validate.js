/* S5 validation runs, headless (no Earth view): the real flight/core.js + orbit.js (gravity: Earth J2 + Moon + Sun + planets) + rocket.js with a
   mock api.flight() (flat ground at the pad's height). From the console of fly.html:
     (await import('./flight/rocket-validate.js')).start('ascent', 'falcon9')     then read window.__rv
   Tests: dv (rocket equation per stage), ascent (pad -> orbit -> deorbit -> capsule landing), entry (capsule from 120 km, vs Allen-Eggers). */
import * as THREE from 'three';
import { createCore, R_E, OMEGA_I, groundContact } from './core.js';
import { createOrbit, gravityModule } from './orbit.js';
import { createRocket, loadRocket } from './rocket.js';
import { helio } from '../solar.js';

const G0 = 9.80665, D2R = Math.PI / 180, T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const qr = (q, v) => { const t = cross(q, v).map(x => x * 2), c = cross(q, t); return [v[0] + t[0] * q[3] + c[0], v[1] + t[1] * q[3] + c[1], v[2] + t[2] * q[3] + c[2]]; };
const yieldUI =() => new Promise(r => setTimeout(r, 0)), r1 = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
window.__rv = window.__rv || {};

async function make(name, o = {}) {
  const R = await loadRocket(name); let cb = null; if (o.guid) Object.assign(R.guidance, o.guid);   // tuning runs
  const F = { THREE, earthQuat: new THREE.Quaternion(), groundAt: () => o.ground || 3, clock: { now: () => 0, set() {}, setRate() {}, rate: () => 1e3, playing: () => true },
    onFrame(f) { cb = f; return () => {}; }, pilot() { return null; }, piloting: false };
  const ctx = { orb: createOrbit({ helio }), node: null, sas: 'pad', last: null }, RK = createRocket(R, ctx, { pad: o.pad, inc: o.inc, alt: o.alt || 200e3, F, entry: o.entry });
  const probe = { name: 'probe', step(s, env) { if (o.probe) o.probe(s, env, RK.K); } };
  RK.def.views = [{ name: 'x', eye: [0, 0, 0] }];
  const core = createCore(F, RK.def, { lat: RK.K.pad.lat, lon: RK.K.pad.lon, heading: 0 }, { mods: [probe, gravityModule(ctx), RK, groundContact(RK.def.gear)], start: RK.start });
  let t = T0; cb(1 / 60, t);
  let work = 0, steps = 0;
  async function sim(sec, stop) { const n = Math.round(sec); let w = performance.now();
    for (let i = 0; i < n; i++) { t += 1000; const a = performance.now(); cb(1 / 60, t); work += performance.now() - a; steps += core.stats.steps; if (stop && stop()) return true;
      if (performance.now() - w > 1500) { await yieldUI(); w = performance.now(); } } return false; }
  return { R, RK, K: RK.K, core, s: core.state, sim, cost: () => ({ msPerStep: work / steps, msPerFrameX1: work / steps * 2 }) };
}

// delta-v per stage (vacuum Isp, rocket equation, with everything above it as payload) vs the needed ~9.3-9.6 km/s to LEO (incl. losses)
async function dv(name) { const R = await loadRocket(name), ST = R.stages; let above = R.payload.mass + (R.fairing ? R.fairing.mass : 0); const out = { stages: [] };
  for (let i = ST.length - 1; i >= 0; i--) { const s = ST[i], m0 = above + s.dry + s.prop, m1 = above + s.dry; out.stages.unshift({ name: s.name, m0, m1, dvVac: r1(s.ispVac * G0 * Math.log(m0 / m1), 0), dvSL: r1(s.ispSL * G0 * Math.log(m0 / m1), 0) }); above = m0; }
  out.liftoffMass = above; out.totalVac = out.stages.reduce((a, x) => a + x.dvVac, 0); out.note = 'fairing / tower counted to orbit (upper bound of the payload mass); needed to LEO: ~7.8 km/s orbital - 0.41 km/s Earth turn (Cape) + losses';
  return out; }

async function ascent(name, o = {}) { const ent = {}; let prevAlt = 1e9;
  const T = await make(name, { ...o, probe(s, env, K) { const a = env.altMSL;   // crossing 120 km downward as the capsule: the entry state (air-relative)
    if (K.mode === 'capsule' && prevAlt >= 120e3 && a < 120e3 && !ent.v) { const va = env.vAir; ent.v = len(va); ent.gamma = Math.asin(dot(va, env.nUp) / len(va)) / D2R; ent.vI = len(s.v); }
    prevAlt = a;
    if (o.trace && K.tLift != null && Math.round((s.t - K.tLift) / 1e3 * 120) % (120 * (o.every || 10)) === 0) { const up = env.nUp, nose = qr(s.q, [0, 0, -1]), va = env.vAir;
      o.trace.push([r1((s.t - K.tLift) / 1e3), r1(a / 1e3), K.phase, r1(90 - Math.acos(dot(nose, up)) / D2R), r1(Math.asin(dot(va, up) / Math.max(1, len(va))) / D2R), r1(len(va)), r1(K.gx / D2R, 2), r1(K.gy / D2R, 2), r1(env.aero.alpha / D2R, 2), r1(K.F / 1e3)]); } } });
  const K = T.K, s = T.s; T.RK.launch(); const out = {};
  await T.sim(1500, () => K.phase === 'orbit');
  out.events = K.events.map(e => `T+${r1(e.T)} s ${e.txt} @ ${r1(e.alt / 1e3)} km`);
  out.maxQ = { kPa: r1(K.maxQ.q / 1e3, 2), alt_km: r1(K.maxQ.alt / 1e3, 2), T: r1(K.maxQ.t), mach: r1(K.maxQ.mach, 2) };
  out.insertion = K.ins && { T_s: r1(K.ins.T), peri_km: r1(K.ins.peri / 1e3), apo_km: r1(K.ins.apo / 1e3), propLeft_kg: Math.round(K.ins.prop), mass_kg: Math.round(K.ins.m) };
  const L = K.loss; out.losses = { ideal: r1(L.ideal, 0), gravity: r1(L.grav, 0), drag: r1(L.drag, 0), steering: r1(L.steer, 0), v0: r1(L.v0, 0), vNow: r1(len(s.v), 0),
    check: r1(L.v0 + L.ideal - L.grav - L.drag - L.steer - len(s.v), 1) };   // d|v|/dt identity: should be ~0
  out.gMaxAscent = r1(K.gMax.g, 2); out.cost = T.cost();
  if (o.land !== false && K.phase === 'orbit') { await T.sim(60); const msg = T.RK.deorbitLand(); out.deorbit = msg || 'ok'; K.gMax = { g: 0 }; K.heatMax = { q: 0 };
    const tD = s.t; await T.sim(9000, () => K.phase === 'landed' && s.onGround);
    out.landing = { after_min: r1((s.t - tD) / 6e4), touch: K.touch && { v: r1(K.touch.v, 2), vs: r1(K.touch.vs, 2) }, gMax: r1(K.gMax.g, 2), gMaxAlt_km: r1(K.gMax.alt / 1e3, 1), gMaxV: r1(K.gMax.v || 0, 0),
      heatMax_kWm2: r1(K.heatMax.q / 1e3, 0), heatAlt_km: r1(K.heatMax.alt / 1e3, 1), heatV: r1(K.heatMax.v || 0, 0), entry120: ent, events: K.events.slice(-6).map(e => `${e.txt} @ ${r1(e.alt / 1e3, 2)} km`) };
    if (ent.v) out.landing.allenEggers = allenEggers(T.R.capsule, ent.v, ent.gamma); }
  return out; }

// Allen-Eggers ballistic entry (exponential air rho0 e^(-h/Hs), constant flight-path angle, no gravity / lift): peak deceleration
// n = V_E^2 sin|g| / (2 e g0 Hs) at V = V_E e^-1/2; peak stagnation heating (~ sqrt(rho) V^3) at V = V_E e^-1/6
function allenEggers(C, V, gDeg) { const Hs = 7200, rho0 = 1.225, sg = Math.sin(Math.abs(gDeg) * D2R), beta = C.mass / (C.cd * Math.PI * C.dia * C.dia / 4);
  return { Hs_m: Hs, beta_kgm2: r1(beta, 0), nMax_g: r1(V * V * sg / (2 * Math.E * G0 * Hs), 2), altNmax_km: r1(Hs * Math.log(rho0 * Hs / (beta * sg)) / 1e3, 1), vAtNmax: r1(V * Math.exp(-.5), 0),
    altQmax_km: r1(Hs * Math.log(3 * rho0 * Hs / (beta * sg)) / 1e3, 1), vAtQmax: r1(V * Math.exp(-1 / 6), 0) }; }

async function entry(name, o = {}) { const g = o.gamma || -1.5, T = await make(name, { entry: { alt: 120e3, v: o.v || 7830, gamma: g } }), K = T.K, s = T.s;
  let e0 = null; await T.sim(1, () => { const va = sub(s.v, cross(OMEGA_I, s.r)), up = s.r.map(x => x / len(s.r)); e0 = { v: len(va), gamma: Math.asin(dot(va, up) / len(va)) / D2R }; return true; });
  await T.sim(4000, () => K.phase === 'landed' && s.onGround);
  return { start: { vInertial: o.v || 7830, gammaInertial: g, vAir: r1(e0.v, 0), gammaAir: r1(e0.gamma, 2) }, gMax: r1(K.gMax.g, 2), gMaxAlt_km: r1(K.gMax.alt / 1e3, 1), gMaxV: r1(K.gMax.v || 0, 0),
    heatMax_kWm2: r1(K.heatMax.q / 1e3, 0), heatAlt_km: r1(K.heatMax.alt / 1e3, 1), heatV: r1(K.heatMax.v || 0, 0), touch: K.touch && r1(K.touch.v, 2), time_s: r1((s.t - T0) / 1e3, 0),
    allenEggers: allenEggers(T.R.capsule, e0.v, e0.gamma), events: K.events.map(e => `${e.txt} @ ${r1(e.alt / 1e3, 2)} km`), cost: T.cost() }; }

export async function start(test, name = 'falcon9', o = {}) { const t0 = performance.now(); let r;
  try { r = test === 'dv' ? await dv(name) : test === 'entry' ? await entry(name, o) : await ascent(name, o); } catch (e) { r = { error: String(e), stack: e.stack }; }
  r.wall_s = r1((performance.now() - t0) / 1e3); window.__rv[test + ':' + name] = r; return r; }
