/* S12 damage plug-in (docs/flight-notes/weapons-contract.md row "damage"; notes docs/flight-notes/s12-combat.md): the F-16 becomes a target
   (team 'blue', the contract's target interface) with a GAME damage model; every number is an invented game value in data/combat.json.
   Hit points `hp`: a 20 mm round (weapons.js pool, red side) takes gunHit, a game missile blast takes `blast` once per physics step (missiles.js
   calls T.hit up to blastHits times per burst). Zones by where the round hit (body axes): engine (aft fuselage), controls (wings / tails),
   fuel (the rest); each zone's severity 0..1 grows with the damage it takes. Effects, applied in the physics step right after the aircraft's
   own step (weapons.js runs after aero.js), so the craft files stay untouched:
   - engine: thrust x (1 - thrustLossMax x severity)
   - controls: aileron (and half as much elevator) deflection limit x authority (1 .. authorityMin) and its rate limit x rate (1 .. rateMin), both by sqrt(severity) -> sluggish roll
   - fuel: a leak of leakMax x severity kg/s, taken from every tank in proportion to its fuel
   hp <= 0: destroyed = the existing crash state (s.crash = 'shot down': aero.js stops the engine and the wreck). The flight's Reset restores
   the jet (core.reset -> def.init clears s.crash) and this file's state (same Reset click). Shown on both HUDs (h.ew, weapon-hud.js) and the
   RWR page's caution lamps (ew.js). Own code. */
import { qrot, qconj } from './weapons.js';

const J = await (await fetch(new URL('data/combat.json', import.meta.url))).json();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function attach(ctx) {
  const { Wp, core } = ctx, D = J.f16, Z = D.zones, SP = D.zoneSplit;
  const st = { hp: D.hp, sev: { engine: 0, controls: 0, fuel: 0 }, hits: 0, blasts: 0, leaked: 0, dead: false, log: [], stepNo: 0, blastStep: -1 };
  let MW = null;
  // ── the F-16 as a target: r0 / r1 = the state at the step's start / a straight line to its end (the craft's RK4 runs after the weapons step)
  const T = { name: 'F-16', team: 'blue', alive: true, self: true, rcs: D.rcs, ir: D.ir, size: D.size, boxes: D.boxes, r0: null, r1: null, q1: [0, 0, 0, 1], v: [0, 0, 0], w1: null,
    step(t0, h, env, M) { const s = core.state; MW = M; st.stepNo++; if (s.ref !== 'Earth') { T.r1 = null; return; }
      T.r0 = s.r.slice(); T.r1 = [0, 1, 2].map(k => s.r[k] + s.v[k] * h); T.q1 = s.q.slice(); T.v = s.v.slice();
      T.w1 = [0, 1, 2].map(k => M[3 * k] * T.r1[0] + M[3 * k + 1] * T.r1[1] + M[3 * k + 2] * T.r1[2]);
      T.ir = D.ir * (s.eng[0] && s.eng[0].ab ? 3 : 1); T.alive = !st.dead && !s.crash; },
    hit(w, kind) { if (st.dead) return false;
      const blast = !!(kind && kind.blast);
      if (blast && st.blastStep === st.stepNo) return false;   // one burst = one hit (missiles.js repeats the call)
      const dmg = blast ? D.blast : D.gunHit; st.hp -= dmg; st.hits++; if (blast) { st.blasts++; st.blastStep = st.stepNo; }
      const zs = blast ? ['engine', 'controls', 'fuel'] : [zoneOf(w)];
      for (const z of zs) st.sev[z] = clamp(st.sev[z] + dmg * D.zoneShare / 100 / zs.length * (blast ? .5 + Math.random() : 1), 0, 1);
      st.log.push({ t: core.state.t, dmg, zones: zs, hp: st.hp, kind: blast ? kind.name : 'gun' }); if (st.log.length > 50) st.log.shift();
      if (st.hp <= 0) { st.hp = 0; st.dead = true; T.alive = false; const s = core.state; if (!s.crash) s.crash = 'shot down'; return true; }
      return false; } };
  // zone of a hit at W point w: W -> I (MW is a rotation) -> body
  function zoneOf(w) { if (!MW || !w || !T.r1) return 'fuel'; const M = MW, x = [M[0] * w[0] + M[3] * w[1] + M[6] * w[2], M[1] * w[0] + M[4] * w[1] + M[7] * w[2], M[2] * w[0] + M[5] * w[1] + M[8] * w[2]];
    const b = qrot(qconj(T.q1), [x[0] - T.r1[0], x[1] - T.r1[1], x[2] - T.r1[2]]);
    if (b[2] > SP.engineZ && Math.abs(b[0]) < SP.wingX && Math.abs(b[1]) < .9) return 'engine';
    if (Math.abs(b[0]) > SP.wingX || (b[2] > SP.tailZ)) return 'controls';
    return 'fuel'; }
  Wp.addTarget(T);

  // ── effects, once per physics step (after aero.js set thrust, surfaces and fuel)
  // controls: clamps only (a scale would compound with the FCS, which starts each step from the surface position): the deflection limit
  // x authority, the change per step x rate (both of aircraft/f16.json "controls"); the elevator gets half the loss
  const CT = (ctx.def.json && ctx.def.json.controls) || { ail: 21.5, elev: 25, rate: { ail: 80, elev: 60 } };
  let ailP = null, elvP = null;
  const lim = (x, p, cap, dmax) => { const y = clamp(x, -cap, cap); return p == null ? y : clamp(y, p - dmax, p + dmax); };
  function step(s, env, h) {
    if (st.dead || s.crash) { ailP = elvP = null; return; }
    const e = s.eng[0], se = st.sev;
    if (e && se.engine > 0) e.thrust *= 1 - Z.engine.thrustLossMax * se.engine;
    if (se.controls > 0 && s.srf) { const k = Math.sqrt(se.controls), a = 1 - (1 - Z.controls.authorityMin) * k, r = 1 - (1 - Z.controls.rateMin) * k, a2 = (1 + a) / 2, r2 = (1 + r) / 2;
      s.srf.ail = ailP = lim(s.srf.ail, ailP, CT.ail * a, CT.rate.ail * r * h); s.srf.elev = elvP = lim(s.srf.elev, elvP, CT.elev * a2, CT.rate.elev * r2 * h); } else { ailP = elvP = null; }
    if (se.fuel > 0 && s.sys && s.sys.fuel) { const f = s.sys.fuel, tot = f.reduce((a, b) => a + b, 0), out = Math.min(tot, Z.fuel.leakMax * se.fuel * h);
      if (tot > 0) { for (let i = 0; i < f.length; i++) f[i] -= f[i] / tot * out; st.leaked += out; } } }
  function hud(s, env, h) { const E = h.ew || (h.ew = {}); E.hp = st.hp; E.dead = st.dead; E.cautions = cautions(); }
  const cautions = () => Object.keys(st.sev).filter(k => st.sev[k] > .02).map(k => Z[k].label);
  const sys = Wp.addSystem({ name: 'damage', step, hud });

  function reset() { st.hp = D.hp; for (const k in st.sev) st.sev[k] = 0; st.dead = false; st.hits = st.blasts = 0; st.leaked = 0; st.log.length = 0; T.alive = true; ailP = elvP = null; }
  const onClick = e => { if (e.target.closest && e.target.closest('[data-a="reset"]')) reset(); };
  if (ctx.ui) ctx.ui.addEventListener('click', onClick);
  function dispose() { Wp.removeTarget(T); Wp.removeSystem(sys); if (ctx.ui) ctx.ui.removeEventListener('click', onClick); }
  return { dispose, target: T, state: st, cautions, reset, data: J };
}
