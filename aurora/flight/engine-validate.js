/* Engine start / electrics / EPU validation runs, headless (flight/engine-start.js): the real core.js + aero.js with a mock api.flight()
   (flat ground, no tiles), as flight/validate.js. From the console of fly.html:
     (await import('./flight/engine-validate.js')).run('cold')       N from cold and dark -> events (s after N) + rpm / FTIT / thrust curve
     (await import('./flight/engine-validate.js')).run('shutdown')   N at idle on the ground -> generators off, rpm 0, MAIN PWR off
     (await import('./flight/engine-validate.js')).run('epu')        EPU manual ON on the ground at idle (hydrazine use), then OFF
     (await import('./flight/engine-validate.js')).run('flameout')   fuel cut at 3 km, 250 kt -> windmill, EPU automatic, then N = airstart
   The keys are pressed through the module's key() (the same function the KeyN / Equal path in core.js calls). */
import * as THREE from 'three';
import { createCore, R_E } from './core.js';
import { loadAircraft } from './aero.js';

const D2R = Math.PI / 180, KT = 1.943844;
const RWY = { lat: 45.6960 + .0205 * 150 / 2823, lon: 25.5128 + .0214 * 150 / 2823, heading: 36.1 };
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qrot = (q, v) => { const c = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], t = c(q, v).map(x => 2 * x), u = c(q, t);
  return [v[0] + q[3] * t[0] + u[0], v[1] + q[3] * t[1] + u[1], v[2] + q[3] * t[2] + u[2]]; };

async function make(start, relief = 136) {
  let cb = null, rate = 1e3; const F = { THREE, earthQuat: new THREE.Quaternion(), groundAt: () => relief, clock: { now: () => 0, set() {}, setRate(x) { rate = x; }, rate: () => rate, playing: () => true },
    onFrame(f) { cb = f; return () => {}; }, pilot() { return null; }, piloting: false };
  const ac = await loadAircraft(new URL('aircraft/f16.json', import.meta.url), { start }); let ap = null;
  const core = createCore(F, ac.def, RWY, { mods: [{ step(s, env, h) { if (ap) ap(s, env, h); } }, ...ac.mods] });
  let t = 1.7e12; cb(.016, t); await new Promise(r => setTimeout(r, 1700)); cb(.016, t); cb(.016, t);
  if (core.hold) throw new Error('still holding');
  let el = 0; const sim = (sec, fn) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { t += 1000 / 60; el += 1 / 60; cb(1 / 60, t); if (fn && fn(core.hud, core.state, el)) return true; } return false; };
  const km = ac.mods.find(m => m.key);
  return { core, s: core.state, sim, key: c => km.key(core.state, c), get t() { return el; }, set ap(f) { ap = f; } };
}
const r1 = x => Math.round(x * 10) / 10;
// event times (s after the key): the first step where each condition holds
function events(T, sec, conds, every = 1) { const ev = {}, rows = [], t0 = T.t; let k = 0;
  T.sim(sec, (h, s, t) => { const dt = t - t0; for (const n in conds) if (ev[n] == null && conds[n](s, h)) ev[n] = r1(dt);
    if (++k % Math.round(every * 60) === 0) rows.push([r1(dt), r1(s.sys.engine.rpm), Math.round(s.sys.engine.ftit), r1(s.sys.jfs.spd * 100), Math.round(s.eng[0].thrust), Math.round(s.eng[0].ff * 7936.64), s.sys.engine.state]); });
  return { ev, curve: { cols: ['t_s', 'rpm_%', 'ftit_C', 'jfs_%', 'thrust_N', 'ff_pph', 'state'], rows } }; }

export async function run(name) {
  if (name === 'cold') { const T = await make('cold'), s = T.s; T.sim(2); const off = { line: T.core.hud.engLine, rpm: s.sys.engine.rpm, bus: s.sys.elec.bus, thrust: s.eng[0].thrust };
    T.key('KeyN');
    const r = events(T, 70, { mainPwrMain: s => s.sys.elec.main === 'main', jfsStart: s => s.sys.jfs.sw === 'start2', rpm12: s => s.sys.engine.rpm >= 12, rpm20: s => s.sys.engine.rpm >= 20,
      jfsRun: s => s.sys.jfs.run, throttleIdle: s => !s.ctl.cutoff, lightoff: s => s.sys.engine.lit, flcsPmg: s => s.sys.elec.flcsPmg, jfsCutout50: s => s.sys.engine.rpm >= 50 && s.sys.jfs.sw === 'off',
      stbyGen: s => s.sys.elec.stbyGen, mainGen: s => s.sys.elec.mainGen, idle: s => s.sys.engine.run, jfsStopped: s => s.sys.engine.run && s.sys.jfs.spd === 0,
      ftitPeak: () => false }, 1);
    let pk = 0; for (const x of r.curve.rows) pk = Math.max(pk, x[2]);
    return { off, ...r, ftitPeak_C: pk, idle: { rpm: s.sys.engine.rpm, ftit: r1(s.sys.engine.ftit), ff_pph: Math.round(s.eng[0].ff * 7936.64), thrust_N: Math.round(s.eng[0].thrust), elec: s.sys.elec, line: T.core.hud.engLine } }; }
  if (name === 'shutdown') { const T = await make('runway'), s = T.s; T.sim(2); T.key('KeyN');
    const r = events(T, 45, { cutoff: s => s.ctl.cutoff, mainGenOff: s => !s.sys.elec.mainGen, stbyGenOff: s => !s.sys.elec.stbyGen, flcsPmgOff: s => !s.sys.elec.flcsPmg,
      rpm12: s => s.sys.engine.rpm < 12, mainPwrOff: s => s.sys.elec.main === 'off', rpm0: s => s.sys.engine.rpm === 0 }, 2);
    const again = (() => { T.key('KeyN'); T.sim(1); return s.sys.engine.seq; })();
    return { ...r, epuAuto: s.sys.epu.spd > 0, restartSeq: again }; }
  if (name === 'epu') { const T = await make('runway'), s = T.s; T.sim(2); T.key('Equal');
    const r = events(T, 60, { run: s => s.sys.epu.run, hyd: s => s.sys.epu.hyd }, 10); const used = 1 - s.sys.epu.fuel;
    T.key('Equal'); T.sim(5); return { ...r, hydrazineUsedIn60s: r1(used * 100) + ' %', minutesLeftAtThisRate: r1((1 - used) / used), afterOff: { ...s.sys.epu } }; }
  if (name === 'flameout') { const T = await make('runway', 0), s = T.s; T.sim(2);
    // airborne at 3 km, 250 KIAS-ish (130 m/s TAS), level, gear up, engine at idle; the test autopilot holds wings level and ~1 g
    const P = T.core.fixedPose(), f = P.f.map(x => x * (R_E + 400 + 3000) / Math.hypot(...P.f)), fw = qrot(P.qf, [0, 0, -1]), qf = qmul(P.qf, [Math.sin(3 * D2R / 2), 0, 0, Math.cos(3 * D2R / 2)]);
    T.core.teleport({ f, vf: fw.map(x => x * 150), qf, wb: [0, 0, 0] }); s.ctl.park = false; s.ctl.gear = 0; s.srf.gear = 0;
    T.ap = s => { s.ctl.roll = 0; s.ctl.yaw = 0; s.ctl.pitch = 0; };
    T.sim(1); const fuel = s.sys.fuel.slice(); s.sys.fuel.fill(0);   // fuel cut: every tank empty (stores.js: 7 internal + external; the reservoirs alone would refill)
    const a = events(T, 20, { flameout: s => !s.sys.engine.lit, stbyGenOff: s => !s.sys.elec.stbyGen, epuAuto: s => s.sys.epu.auto, epuRun: s => s.sys.epu.run }, 2);
    const wind = { rpm: r1(s.sys.engine.rpm), kt: r1(T.core.hud.ias * KT), state: s.sys.engine.state, bus: s.sys.elec.bus, hyd: s.sys.epu.hyd };
    s.sys.fuel.splice(0, fuel.length, ...fuel); T.key('KeyN');   // fuel back, N = airstart
    const b = events(T, 60, { jfsStart: s => s.sys.jfs.sw === 'start2', throttleIdle: s => !s.ctl.cutoff, lightoff: s => s.sys.engine.lit, idle: s => s.sys.engine.run, mainGen: s => s.sys.elec.mainGen }, 2);
    return { flameout: a, windmill: wind, airstart: b, epuAfter: { ...s.sys.epu }, line: T.core.hud.engLine }; }
  throw new Error('tests: cold, shutdown, epu, flameout');
}
