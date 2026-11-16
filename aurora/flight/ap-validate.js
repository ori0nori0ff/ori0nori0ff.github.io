/* Trim + autopilot validation runs, headless (no Earth view, calm air, flat ground at 400 m): the real core.js + aero.js + autopilot.js with
   a mock api.flight(), as flight/validate.js. From the console of fly.html:  (await import('./flight/ap-validate.js')).run('all')
   Tests: trim (hands-off at 300 / 450 KIAS, trim steps), alt (ALT HOLD 10 000 ft / 350 KIAS 2 min, also engaged in a 1500 ft/min climb),
   hdg (HDG SEL +90 deg / -30 deg), att (ATT HOLD at 5 deg pitch / 20 deg bank), limits (gear, stick steering, paddle, stick additive
   in ALT HOLD, HOTAS events, beyond 60 deg bank). Throttle = a simple speed hold (the pilot's hand). */
import * as THREE from 'three';
import { createCore, R_E } from './core.js';
import { loadAircraft } from './aero.js';
import { attitudeOf } from './autopilot.js';

const D2R = Math.PI / 180, KT = 1.943844, FT = 3.28084;
const mul = (a, k) => a.map(x => x * k), cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], qrot = (q, v) => { const t = mul(cross(q, v), 2); return add(add(v, mul(t, q[3])), cross(q, t)); };
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const RWY = { lat: 45.7, lon: 25.5, heading: 36.1 };
const r1 = (x, n = 1) => Math.round(x * 10 ** n) / 10 ** n;

async function make() {
  let cb = null, rate = 1e3; const F = { THREE, earthQuat: new THREE.Quaternion(), groundAt: () => 0, clock: { now: () => 0, set() {}, setRate(x) { rate = x; }, rate: () => rate, playing: () => true },
    onFrame(f) { cb = f; return () => {}; }, pilot() { return null; }, piloting: false };
  const ac = await loadAircraft(new URL('aircraft/f16.json', import.meta.url)); let hand = null;
  const handMod = { step(s, env, h) { if (hand) hand(s, env, h); } };   // runs before the autopilot (a pilot's hand on the throttle / stick)
  const core = createCore(F, ac.def, RWY, { mods: [handMod, ...ac.mods], wind: false });
  let t = 1.7e12; cb(.016, t); await new Promise(r => setTimeout(r, 1700)); cb(.016, t); cb(.016, t);
  if (core.hold) throw new Error('still holding');
  const sim = (sec, fn) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { t += 1000 / 60; cb(1 / 60, t); if (fn && fn(core.hud, core.state, i / 60)) return true; } return false; };
  return { core, ac, sim, set hand(f) { hand = f; }, s: core.state, key(c) { (core.state.ctl.ev || (core.state.ctl.ev = [])).push(c); } };
}
// airborne, level, wings level, gear up, at hMSL (m) and true airspeed V (m/s); alpha guess (deg)
function launch(T, hMSL, V, alDeg) { const P = T.core.fixedPose(), f = mul(P.f, (R_E + 400 + hMSL) / Math.hypot(...P.f));
  const fw = qrot(P.qf, [0, 0, -1]), qf = qmul(P.qf, [Math.sin(alDeg * D2R / 2), 0, 0, Math.cos(alDeg * D2R / 2)]);
  T.core.teleport({ f, vf: mul(fw, V), qf, wb: [0, 0, 0] }); const c = T.s.ctl; c.park = false; c.gear = 0; T.s.srf.gear = 0; c.brake = 0; c.pitch = c.roll = c.yaw = 0; }
// the pilot's hand: speed hold by throttle (PI on IAS), endless fuel (s.sys.fuelHold: the 7 tanks keep the start load, 1 800 kg); optional stick
const speedHand = (kias, o = {}) => { let I = .6; return (s, env, h) => {   // s.__ias (kt) is set by the run's frame callback
  const e = kias - (s.__ias ?? kias); I = Math.max(0, Math.min(1, I + e * .01 * h)); s.ctl.throttle = Math.max(0, Math.min(1, I + e * .02)); s.sys.fuelHold = true;   /* stores.js: no fuel used, constant mass */
  if (o.stick) o.stick(s, env, h); }; };
// a run: launch, trim the speed for `settle` s hands-off, then measure
async function setup(kias, altFt, settle = 20) {
  const T = await make(), hm = altFt / FT, tas = kias / KT * Math.sqrt(1.225 / atmos(hm));   // TAS from IAS (density ratio; low Mach)
  launch(T, hm, tas, 3); T.hand = speedHand(kias);
  const ias = () => { T.s.__ias = T.core.hud.ias * KT; }; T.sim(settle, () => { ias(); });
  return { T, ias };
}
const atmos = h => { const Tk = 288.15 - .0065 * h; return 1.225 * Math.pow(Tk / 288.15, 4.2559); };
const att = T => { const e = { nUp: mul(T.s.r, 1 / Math.hypot(...T.s.r)), altMSL: T.core.hud.altMSL }; return attitudeOf(T.s, e); };

export async function run(name = 'all') {
  const out = {}, want = n => name === 'all' || name === n;
  if (want('trim')) for (const kias of [300, 450]) {   // 10 000 ft: hands-off 60 s with trim 0; then +0.10 g pitch trim 5 s; then +5 deg/s roll trim 3 s
    const { T, ias } = await setup(kias, 10000), hL = T.core.hud.altMSL;
    // the pilot levels the jet with small stick inputs for 30 s (the launch leaves a climb / descent), then lets go
    T.hand = speedHand(kias, { stick: (s, env) => { s.ctl.pitch = Math.max(-.05, Math.min(.05, -.004 * T.core.hud.vs - .0005 * (env.altMSL - hL))); } });
    const level = sec => { T.hand = speedHand(kias, { stick: (s, env) => { s.ctl.pitch = Math.max(-.05, Math.min(.05, -.004 * T.core.hud.vs - .0005 * (env.altMSL - hL))); } }); T.sim(sec, () => { ias(); }); T.hand = speedHand(kias); T.s.ctl.pitch = 0; };
    level(30);
    // trimming: let go 8 s, read the vertical-speed trend, press ']' / '[' for that many g steps, level again; 3 rounds
    const presses = [];
    for (let k = 0; k < 3; k++) { T.sim(1, () => { ias(); }); const v1 = T.core.hud.vs; T.sim(8, () => { ias(); }); const dn = (T.core.hud.vs - v1) / 8 / 9.80665, n = Math.round(-dn / T.ac.def.json.trim.pitchStep);
      for (let i = 0; i < Math.abs(n); i++) T.key(n > 0 ? 'BracketRight' : 'BracketLeft'); presses.push(n); level(15); }
    const a0 = att(T), h0 = T.core.hud.altMSL; let vsMax = 0, phiMax = 0;
    T.sim(60, h => { ias(); vsMax = Math.max(vsMax, Math.abs(h.vs)); phiMax = Math.max(phiMax, Math.abs(h.roll)); });
    const hands = { trimPresses: presses, trim_g: r1(T.s.ctl.trim, 3), altChange_ft: r1((T.core.hud.altMSL - h0) * FT, 0), vsMax_fpm: r1(vsMax * FT * 60, 0), bankMax_deg: r1(phiMax, 2), headingChange_deg: r1(T.core.hud.heading - a0.hdg, 2), ias_kt: r1(T.core.hud.ias * KT) };
    const trim0 = T.s.ctl.trim; for (let i = 0; i < 20; i++) T.key('BracketRight'); T.sim(.1); /* +0.10 g on top of the level trim */ const th0 = T.core.hud.pitch, g0 = T.core.hud.g; let gSum = 0, n = 0;
    T.sim(5, (h, s, t) => { ias(); if (t > 1) { gSum += h.g; n++; } }); const pitchUp = { trimAdded_g: r1(T.s.ctl.trim - trim0, 3), gMean_1to5s: r1(gSum / n, 3), gBefore: r1(g0, 3), pitchRate_deg_s: r1((T.core.hud.pitch - th0) / 5, 2) };
    T.key('Backslash'); T.sim(3, () => { ias(); }); const ph0 = T.core.hud.roll; for (let i = 0; i < 20; i++) T.key('Quote');
    T.sim(.1); const ph1 = T.core.hud.roll; T.sim(3, () => { ias(); }); const rollRight = { trimRoll_deg_s: T.s.ctl.trimRoll, rollRate_deg_s: r1((T.core.hud.roll - ph1) / 3, 2), bankAfter: r1(T.core.hud.roll, 1), bankBefore: r1(ph0, 2) };
    // held key: 2 s of ']' with the ramp after the hold delay (from 0): expect one step 0.005 + (2 - 0.4) s * pitchRate
    T.key('Backslash'); T.sim(.05); T.key('BracketRight'); T.s.ctl.trimAx = [1, 0]; let heldTrim = 0;
    { const hand0 = speedHand(kias); T.hand = (s, e, h) => { hand0(s, e, h); s.ctl.trimAx = [1, 0]; }; T.sim(2, () => { ias(); }); heldTrim = T.s.ctl.trim; T.hand = speedHand(kias); }
    out['trim_' + kias] = { hands, pitchUp, rollRight, held2s_trim_g: r1(heldTrim, 3) }; }
  if (want('alt')) for (const climb of [0, 1500]) {   // ALT HOLD at 10 000 ft, 350 KIAS, 120 s; second run: engaged in a 1500 ft/min climb
    const { T, ias } = await setup(350, 10000);
    if (climb) { T.s.ctl.trim = .08; T.sim(30, h => { ias(); return h.vs * FT * 60 > climb; }); T.s.ctl.trim = 0; }
    T.key('KeyY'); T.key('KeyY'); T.sim(.05); const ref = T.core.hud.apRef.alt, vs0 = T.core.hud.vs; let errMax = 0, errLate = 0, flips = 0, lastSign = 0, nzMin = 9, nzMax = -9;
    T.sim(120, (h, s, t) => { ias(); const e = h.altMSL - ref; errMax = Math.max(errMax, Math.abs(e)); if (t > 30) errLate = Math.max(errLate, Math.abs(e));
      const sg = Math.sign(Math.round(h.vs * 10)); if (t > 30 && sg && sg !== lastSign) { flips++; lastSign = sg; } if (s.ap) { nzMin = Math.min(nzMin, s.ap.nz); nzMax = Math.max(nzMax, s.ap.nz); } });
    out['alt_climb' + climb] = { mode: T.core.hud.ap, vsAtEngage_fpm: r1(vs0 * FT * 60, 0), errMax_ft: r1(errMax * FT, 1), errAfter30s_ft: r1(errLate * FT, 2), vsSignChangesAfter30s: flips, finalErr_ft: r1((T.core.hud.altMSL - ref) * FT, 2), nzCmd: [r1(nzMin, 3), r1(nzMax, 3)], ias_kt: r1(T.core.hud.ias * KT) }; }
  if (want('hdg')) for (const turn of [90, -30]) {   // ALT HOLD + HDG SEL; the bug moved by `turn` deg; 120 s
    const { T, ias } = await setup(350, 10000); T.key('KeyY'); T.key('KeyY'); T.key('KeyY'); T.sim(.05);
    const ap = T.ac.autopilot, aim = (T.core.hud.heading + turn + 360) % 360; ap.setHeading(aim); const ref = T.core.hud.apRef.alt;
    let bankMax = 0, tIn = null, errLate = 0, altErr = 0, over = 0;
    T.sim(120, (h, s, t) => { ias(); bankMax = Math.max(bankMax, Math.abs(h.roll)); const e = ((h.heading - aim + 540) % 360) - 180; if (tIn == null && Math.abs(e) < 2) tIn = t;
      if (tIn != null) { errLate = Math.max(errLate, Math.abs(e)); over = Math.max(over, -Math.sign(turn) * e); } altErr = Math.max(altErr, Math.abs(h.altMSL - ref)); });
    out['hdg_' + turn] = { mode: T.core.hud.ap, finalErr_deg: r1(((T.core.hud.heading - aim + 540) % 360) - 180, 2), bankMax_deg: r1(bankMax, 1), within2deg_after_s: tIn != null ? r1(tIn, 1) : null, errMaxAfterCapture_deg: r1(errLate, 2), overshoot_deg: r1(over, 2), altErrMax_ft: r1(altErr * FT, 1) }; }
  if (want('att')) {   // ATT HOLD caught at ~5 deg pitch and ~20 deg bank (set by a stick input before engaging), 60 s
    const { T, ias } = await setup(350, 10000); let ph = 0;
    T.hand = speedHand(350, { stick: (s) => { const a = att(T); s.ctl.roll = ph ? 0 : Math.max(-1, Math.min(1, (20 - a.phi) * .02)); s.ctl.pitch = ph ? 0 : Math.max(-1, Math.min(1, (5 - a.theta) * .03)); } });
    T.sim(12, () => { ias(); }); ph = 1; T.sim(.1, () => { ias(); }); T.key('KeyY'); T.sim(.05); const R = T.core.hud.apRef; let thE = 0, phE = 0;
    T.sim(60, (h, s, t) => { ias(); if (t > 5) { thE = Math.max(thE, Math.abs(h.pitch - R.theta)); phE = Math.max(phE, Math.abs(h.roll - R.phi)); } });
    out.att = { mode: T.core.hud.ap, ref_pitch: r1(R.theta, 2), ref_bank: r1(R.phi, 2), pitchErrMax_deg: r1(thE, 2), bankErrMax_deg: r1(phE, 2) }; }
  if (want('limits')) { const { T, ias } = await setup(350, 10000); const L = {};
    T.s.ctl.gear = 1; T.key('KeyY'); T.sim(.05, () => { ias(); }); L.gearDown = { mode: T.core.hud.ap, msg: T.core.hud.apMsg }; T.s.ctl.gear = 0; T.s.srf.gear = 0;
    T.key('KeyY'); T.sim(.05, () => { ias(); }); L.engaged = T.core.hud.ap; const th0 = T.core.hud.apRef.theta;
    // stick steering in ATT HOLD: 2 s of 0.3 stick, then let go 10 s: the new pitch reference is held
    T.hand = speedHand(350, { stick: s => { s.ctl.pitch = .3; } }); T.sim(1, () => { ias(); }); L.stickSteering = T.core.hud.ap;
    T.hand = speedHand(350); T.s.ctl.pitch = 0; T.sim(.1, () => { ias(); }); const thNew = T.core.hud.apRef.theta; T.sim(10, () => { ias(); });
    L.afterStick = { refBefore: r1(th0, 2), refAfter: r1(thNew, 2), pitchNow: r1(T.core.hud.pitch, 2), mode: T.core.hud.ap };
    for (let i = 0; i < 3; i++) T.key('BracketRight'); T.sim(.05); L.trimWhileEngaged = T.s.ctl.trim;
    // ALT HOLD (HOTAS event), paddle held 8 s with a climb, released: new altitude reference
    T.key('apAlt'); T.sim(.05, () => { ias(); }); const a0 = T.core.hud.apRef.alt; T.s.ctl.paddle = true;
    T.hand = speedHand(350, { stick: s => { s.ctl.pitch = .03; s.ctl.paddle = true; } }); T.sim(8, () => { ias(); }); L.paddleHeld = T.core.hud.ap;
    T.hand = speedHand(350); T.s.ctl.pitch = 0; T.s.ctl.paddle = false; T.sim(.1, () => { ias(); }); const a1 = T.core.hud.apRef.alt; T.sim(20, () => { ias(); });
    L.paddle = { altRefBefore_ft: r1(a0 * FT, 0), altRefAfter_ft: r1(a1 * FT, 0), altNow_ft: r1(T.core.hud.altMSL * FT, 0), mode: T.core.hud.ap };
    // ALT HOLD: the stick adds to the A/P (0.05 stick for 3 s), then the A/P returns to its altitude
    T.hand = speedHand(350, { stick: s => { s.ctl.pitch = .05; } }); T.sim(3, () => { ias(); }); const up = (T.core.hud.altMSL - a1) * FT;
    T.hand = speedHand(350); T.s.ctl.pitch = 0; T.sim(40, () => { ias(); }); L.altAdditive = { climbedWithStick_ft: r1(up, 0), errAfter40s_ft: r1((T.core.hud.altMSL - a1) * FT, 1), mode: T.core.hud.ap };
    T.key('apOff'); T.sim(.05); L.apOff = { mode: T.core.hud.ap, msg: T.core.hud.apMsg };
    T.key('KeyY'); T.key('KeyY'); T.key('KeyY'); T.key('KeyY'); T.sim(.05); L.cycledOff = { mode: T.core.hud.ap, msg: T.core.hud.apMsg };
    // bank beyond 60 deg: roll with the stick to ~70 deg in ATT HOLD -> the mode stops working but stays engaged
    T.key('KeyY'); T.sim(.05); T.hand = speedHand(350, { stick: s => { const a = att(T); s.ctl.roll = a.phi < 70 ? .5 : 0; } }); T.sim(3, () => { ias(); });
    L.beyond60 = { bank: r1(T.core.hud.roll, 1), mode: T.core.hud.ap, apCmd: T.s.ap }; T.hand = speedHand(350);
    out.limits = L; }
  return out;
}
