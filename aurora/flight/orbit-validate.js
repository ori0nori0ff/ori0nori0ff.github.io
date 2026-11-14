/* S1 validation runs, headless (no Earth view): the real flight/core.js + flight/orbit.js with a mock api.flight(); long runs are cut in
   slices (the page stays alive); results land in window.__ov[name]. From the console of fly.html:
     (await import('./flight/orbit-validate.js')).start('period')      then read window.__ov.period
   Tests: period, drift, hohmann, rails, tli, cost. Numbers in SI unless named. */
import * as THREE from 'three';
import { createCore, R_E, qFromBasis } from './core.js';
import { createOrbit, gravityModule, orbiterModule, ORBITER, nodeUpdate, hohmann, elements, kepler, BODIES } from './orbit.js';
import { helio } from '../solar.js';

const D2R = Math.PI / 180, MU = BODIES.Earth.gm, A400 = R_E + 400 + 400e3, GEO = 42164e3;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]), unit = a => mul(a, 1 / len(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const T0 = Date.UTC(2026, 10, 14, 0, 0, 0);   // a fixed date: the runs repeat
const yieldUI = () => new Promise(r => setTimeout(r, 0));

// a core on a mock earthgl: craft state P0 (frame I, ref Earth) at T0; extra modules (test probes) before the orbit modules
function make(orbOpts, P0, extra = []) {
  let cb = null; const F = { THREE, earthQuat: new THREE.Quaternion(), groundAt: () => 0, clock: { now: () => 0, set() {}, setRate() {}, rate: () => 1e3, playing: () => true },
    onFrame(f) { cb = f; return () => {}; }, pilot() { return null; }, piloting: false };
  const orb = createOrbit({ helio, ...orbOpts }), ctx = { orb, node: null, sas: 'hold', last: null };
  const core = createCore(F, ORBITER, { lat: 0, lon: 0 }, { mods: [...extra, gravityModule(ctx), orbiterModule(ORBITER, ctx)], start: () => ({ ref: 'Earth', q: [0, 0, 0, 1], w: [0, 0, 0], ...P0, r: P0.r.slice(), v: P0.v.slice() }) });
  let t = T0; cb(1 / 60, t);   // first frame: the start state
  // advance sim seconds in frames of 1 s (120 steps each); fn(state) -> true stops; slices of ~1.5 s of work
  async function sim(sec, fn, fm = 1000) { const n = Math.round(sec * 1e3 / fm); let w = performance.now();
    for (let i = 0; i < n; i++) { t += fm; cb(1 / 60, t); if (fn && fn(core.state)) return true; if (performance.now() - w > 1500) { await yieldUI(); w = performance.now(); } } return false; }
  return { core, ctx, orb, s: core.state, sim, get t() { return t; } };
}
const circ = (a, axisDeg = 0) => { const c = Math.cos(axisDeg * D2R), s = Math.sin(axisDeg * D2R);   // circular orbit, plane tilted about x by axisDeg
  return { r: [a, 0, 0], v: [0, Math.sqrt(MU / a) * c, Math.sqrt(MU / a) * s] }; };
const pointAlong = (d, up) => { const Z = mul(unit(d), -1), Y = unit(sub(up, mul(unit(d), dot(up, unit(d))))); return qFromBasis(cross(Y, Z), Y, Z); };   // body −z along d, +y towards up

// conservative energy of the two-body + J2 field (per kg)
const energyJ2 = (r, v, j2) => { const rn = len(r), B = BODIES.Earth, z = dot(r, B.pole) / rn; return dot(v, v) / 2 - MU / rn + (j2 ? MU * B.j2 * B.Req ** 2 / (2 * rn ** 3) * (3 * z * z - 1) : 0); };

export const R = {};
async function period() {   // two-body: time for 360° of the argument of latitude vs 2π sqrt(a³/μ); then the full model
  const out = {}; out.formula_s = 2 * Math.PI * Math.sqrt(A400 ** 3 / MU); out.formula_min = out.formula_s / 60;
  out.formula_6378km_min = 2 * Math.PI * Math.sqrt((6378137 + 400e3) ** 3 / MU) / 60;   // the same with the equatorial radius (textbooks: ~92.6 min)
  for (const [name, o] of [['twoBody', { only: ['Earth'], j2: false }], ['fullModel', {}]]) {
    let ang = 0, prev = null, hit = null; const P0 = circ(A400, 51.6);
    const probe = { step(s) { const h = cross(P0.r, P0.v); if (prev) { const d = Math.atan2(dot(cross(prev, s.r), unit(h)), dot(prev, s.r)); if (ang < 2 * Math.PI && ang + d >= 2 * Math.PI && !hit) hit = s.t + (2 * Math.PI - ang) / d * (1e3 / 120) - T0; ang += d; } prev = s.r.slice(); } };
    const T = make(o, P0, [probe]); await T.sim(out.formula_s + 60, () => hit != null);
    out[name] = { period_s: hit / 1e3 - 1 / 120, diff_s: hit / 1e3 - 1 / 120 - out.formula_s };   // the probe sees the state at a step's start: −1 step
  }
  return out; }
async function drift() {   // 10 orbits: relative energy / angular momentum change, two-body and two-body + J2 (both conservative)
  const out = {};
  for (const [name, o, j2] of [['twoBody', { only: ['Earth'], j2: false }, false], ['earthJ2', { only: ['Earth'], j2: true }, true]]) {
    const P0 = circ(A400, 51.6), T = make(o, P0), E0 = energyJ2(P0.r, P0.v, j2), h0 = len(cross(P0.r, P0.v)), hz0 = dot(cross(P0.r, P0.v), BODIES.Earth.pole);
    let dE = 0, dH = 0; const per = 2 * Math.PI * Math.sqrt(A400 ** 3 / MU), w0 = performance.now(), frames = Math.round(10 * per);
    await T.sim(frames, s => { const e = Math.abs(energyJ2(s.r, s.v, j2) / E0 - 1), hh = j2 ? Math.abs(dot(cross(s.r, s.v), BODIES.Earth.pole) / hz0 - 1) : Math.abs(len(cross(s.r, s.v)) / h0 - 1);
      dE = Math.max(dE, e); dH = Math.max(dH, hh); });
    out[name] = { orbits: 10, maxRelEnergyChange: dE, maxRelAngMomChange: dH, angMom: j2 ? 'component along the pole (J2 keeps only that)' : '|h|', wall_s: (performance.now() - w0) / 1e3, steps: frames * 120 };
  }
  return out; }
async function hohmannRun(o) {   // 400 km circular -> GEO with two auto-executed nodes; finite burns with the placeholder engine
  const P0 = circ(A400, 0), q = pointAlong(P0.v, P0.r), T = make(o, { ...P0, q }), s = T.s, ctx = T.ctx, mu = MU, [d1, d2] = hohmann(mu, A400, GEO);
  const plan = (t, dv) => { ctx.node = { t, dv, auto: true, phase: 'plan' }; const p = T.orb.predict({ ref: s.ref, r: s.r, v: s.v, t: s.t }, { node: { t, dv } }); nodeUpdate(ctx, s, p); return p; };
  // burn 1: the textbook delta-v from the actual speed at the node (impulsive), the node 600 s ahead
  const p1 = plan(s.t + 600e3, [0, 0, 0]), ns = p1.nodeState, r1 = len(ns.r); ctx.node.dv[0] = Math.sqrt(mu * (2 / r1 - 2 / (r1 + GEO))) - len(ns.v); plan(ctx.node.t, ctx.node.dv);
  const dvPlan1 = ctx.node.dv[0], burn1 = ctx.node.burnT;
  await T.sim(900, () => ctx.node.phase === 'done'); const dvUsed1 = ctx.dvUsed, el1 = elements(s.r, s.v, mu);
  // burn 2: circularise at the next apoapsis (from the prediction)
  const pr = T.orb.predict({ ref: s.ref, r: s.r, v: s.v, t: s.t }), ap = pr.ev.find(e => e.kind === 'ap'); plan(ap.t, [Math.sqrt(mu / len(ap.r)) - len(ap.v), 0, 0]);
  const dvPlan2 = ctx.node.dv[0], burn2 = ctx.node.burnT;
  await T.sim((ap.t - s.t) / 1e3 + 600, () => ctx.node.phase === 'done'); await T.sim(60);
  const el2 = elements(s.r, s.v, mu);
  return { textbook: { dv1: d1, dv2: d2, total: d1 + d2 }, planned: { dv1: dvPlan1, dv2: dvPlan2, total: dvPlan1 + dvPlan2 }, burnTime_s: [burn1, burn2],
    used: { dv1: dvUsed1, dv2: ctx.dvUsed - dvUsed1, total: ctx.dvUsed }, afterBurn1: { apo_km: (el1.apo - R_E - 400) / 1e3, peri_km: (el1.peri - R_E - 400) / 1e3 },
    final: { a_km: el2.a / 1e3, e: el2.e, apo_km: (el2.apo - R_E - 400) / 1e3, peri_km: (el2.peri - R_E - 400) / 1e3, geoRadius_km: GEO / 1e3, period_h: el2.period / 3600 }, fuelLeft_kg: s.sys.fuel[0] }; }
async function rails() {   // Kepler arcs vs the integrator (two-body): an ellipse over one orbit; a hyperbola vs the predictor
  const out = {}, a = R_E + 400 + 1200e3, e = .1, rp = a * (1 - e), vp = Math.sqrt(MU * (1 + e) / rp), P0 = { r: [rp, 0, 0], v: [0, vp * Math.cos(.5), vp * Math.sin(.5)] };
  const per = 2 * Math.PI * Math.sqrt(a ** 3 / MU), T = make({ only: ['Earth'], j2: false }, P0); await T.sim(Math.round(per));
  const dt = (T.s.t - T0) / 1e3, [rk, vk] = kepler(P0.r, P0.v, dt, MU); out.ellipse = { dt_s: dt, posDiff_m: len(sub(rk, T.s.r)), velDiff_ms: len(sub(vk, T.s.v)) };
  const orb = createOrbit({ helio, only: ['Earth'], j2: false }), vh = Math.sqrt(2 * MU / rp) * 1.3, H0 = { ref: 'Earth', r: [rp, 0, 0], v: [0, vh, 0], t: T0 };
  const p = orb.predict(H0, { tol: 1e-12 }), sg = p.segs[0].pts, k = Math.floor(sg.length / 4 / 2) * 4, tt = sg[k] * 1e3, [rh] = kepler(H0.r, H0.v, (tt - T0) / 1e3, MU);
  out.hyperbola = { dt_s: (tt - T0) / 1e3, posDiff_m: len(sub(rh, [sg[k + 1], sg[k + 2], sg[k + 3]])), r_km: len(rh) / 1e3 };
  // rails module: the same arc in pieces (SOI checks) vs one Kepler call
  const g = T.core.state, st = { ref: 'Earth', r: P0.r.slice(), v: P0.v.slice(), t: T0, ctl: { throttle: 0 }, onGround: false };
  const gm = (await import('./orbit.js')).gravityModule({ orb: T.orb, node: null }); gm.rails(st, T0 + per * 1e3 * 3.5); const [r3] = kepler(P0.r, P0.v, per * 3.5, MU);
  out.railsPieces = { posDiff_m: len(sub(r3, st.r)) };
  return out; }
async function tli() {   // the full model, predictor only: from a 400 km orbit whose plane holds the Moon's place ~5 days later, a prograde burn;
  // the smallest delta-v (5 m/s steps) whose path enters the Moon's SOI; then the same with a 100× tighter tolerance (predictor precision)
  const orb = createOrbit({ helio }), m = orb.rel('Moon', 'Earth', T0 + 4.9 * 864e5), n = unit(cross(m, BODIES.Earth.pole)), rb = mul(unit(m), -A400);
  const vb = mul(unit(cross(n, rb)), Math.sqrt(MU / A400)), out = { tries: 0 };
  for (let dv = 3000; dv <= 3250; dv += 5) { out.tries++; const st = { ref: 'Earth', r: rb, v: vb, t: T0 };
    const p = orb.predict(st, { node: { t: T0, dv: [dv, 0, 0] } }), inn = p.ev.find(e => e.kind === 'soi-in');
    if (inn) { const pe = p.ev.find(e => e.kind === 'pe' && e.ref === 'Moon'), imp = p.ev.find(e => e.kind === 'impact' && e.ref === 'Moon');
      const p2 = orb.predict(st, { node: { t: T0, dv: [dv, 0, 0] }, tol: 1e-12 }), in2 = p2.ev.find(e => e.kind === 'soi-in');
      Object.assign(out, { dv_ms: dv, soiEntry_h: (inn.t - T0) / 36e5, soiEntry_tightTol_h: in2 ? (in2.t - T0) / 36e5 : null,
        periselene_km: pe ? pe.alt / 1e3 : null, impact: !!imp, moonSOI_km: BODIES.Moon.soi / 1e3, steps: p.steps, predict_ms: p.ms, events: p.ev.map(e => e.kind + (e.body ? ':' + e.body : '') + '@' + ((e.t - T0) / 36e5).toFixed(2) + 'h') });
      break; } }
  return out; }
async function cost() {   // physics time per frame (full model: Sun, planets, Moon, J2 + the craft modules), ×1 and ×60 (core's own timer); prediction
  const out = {}, P0 = circ(A400, 51.6);
  for (const [name, fm, n] of [['x1', 1000 / 60, 4000], ['x60', 1000, 1500]]) { const T = make({}, P0); T.core.stats.log = []; await T.sim(n * fm / 1e3, null, fm);
    const L = T.core.stats.log.slice(300).map(x => x[0]).sort((a, b) => a - b);
    out[name] = { mean_ms: L.reduce((a, b) => a + b, 0) / L.length, p95_ms: L[Math.floor(L.length * .95)], stepsPerFrame: T.core.stats.steps }; }
  const orb = createOrbit({ helio }), st = { ref: 'Earth', ...P0, t: T0 }, w = performance.now(); let n = 0; while (performance.now() - w < 1000) { orb.predict(st); n++; }
  out.predictLEO_ms = (performance.now() - w) / n; out.predictLEO_steps = orb.predict(st).steps;
  return out; }

const RUNS = { period, drift, hohmann: () => hohmannRun({ only: ['Earth'], j2: false }), hohmannFull: () => hohmannRun({}), rails, tli, cost };
export function start(name) { window.__ov = window.__ov || {}; window.__ov[name] = 'running';
  RUNS[name]().then(r => { window.__ov[name] = r; }, e => { window.__ov[name] = 'error: ' + e.message + ' ' + e.stack; }); return 'started ' + name; }
