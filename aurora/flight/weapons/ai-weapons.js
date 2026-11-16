/* S12 AI weapons plug-in (docs/flight-notes/weapons-contract.md row "aiweapons"; notes docs/flight-notes/s12-combat.md): the bandits of
   ai.js shoot back, as a GAME. Every number is an invented game value in data/combat.json "ai" (no real weapon data).
   Rules, per bandit, only in MERGE (ai.js), only after firstShot (+ a random 0..firstShotJitter) s in it, never at a crashed / landed F-16:
   - gun: the F-16 within gun.range, the bandit in the F-16's rear hemisphere (angle between the F-16's tail and the line to the bandit
     < gun.aspect) and its lead point (rounds inherit the bandit's velocity; time = range / v0; gravity drop added) within gun.cone of
     the bandit's nose -> a burst of gun.burst s at gun.rate rounds/s with gun.spreadMrad scatter, then gun.cooldown s; gun.rounds per
     bandit. The rounds are weapons.js pool rounds of the red side (Wp.shoot): same flight and hit test as the F-16's own.
   - missiles: the arcade projectiles of missiles.js (fireAt, same invented class values as the F-16's): long within [minRange, maxRange],
     short within its own window, the F-16 within `cone` of the nose, `cooldown` s after the last launch, `count` per bandit, never while
     one of its own is still in flight. Long is preferred outside the short window.
   - countermeasures: while ai.js reports a threat (DEFEND, T.threat) closer than cms.range, one flare + one chaff every cms.gap s
     (missiles.js bus.decoy with the same chance table as the F-16; drawn by ew.js drop).
   Own code. */
import { OMEGA_I } from '../core.js';
import { qrot } from './weapons.js';

const J = await (await fetch(new URL('data/combat.json', import.meta.url))).json();
const D2R = Math.PI / 180, G0 = 9.80665;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]), unit = a => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : [0, 0, -1]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / D2R;   // deg between unit vectors
const mv = (M, x) => [M[0] * x[0] + M[1] * x[1] + M[2] * x[2], M[3] * x[0] + M[4] * x[1] + M[5] * x[2], M[6] * x[0] + M[7] * x[1] + M[8] * x[2]];
const gauss = () => { let u = 0; while (u === 0) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); };

export function attach(ctx) {
  const { S, Wp, bus, core, def } = ctx, A = J.ai, CM = J.cms, v0 = def.json && def.json.gun ? def.json.gun.round.v0 : 1000;
  const L = () => (S.plugins && S.plugins.list) || {};
  const per = new WeakMap(), stats = { rounds: 0, bursts: 0, short: 0, long: 0, flares: 0, chaff: 0, decoyed: 0 };
  const ammo = T => { let a = per.get(T); if (!a) { a = { rounds: A.gun.rounds, short: A.short.count, long: A.long.count, cdGun: 0, burst: 0, acc: 0, cdMsl: 0, merge: 0,
    flares: A.cms.flares, chaff: A.cms.chaff, cmT: 0 }; per.set(T, a); } return a; };

  function step(s, env, h, MW) {
    const ai = L().ai, ms = L().missiles, dm = L().damage, ew = L().ew; if (!ai || s.ref !== 'Earth') return;
    const me = dm ? dm.target : null, ok = me && me.alive && me.r1 && !s.crash && !s.onGround;
    for (const T of ai.list()) { if (!T.alive || T.fall || !T.r1) continue; const a = ammo(T);
      a.cdGun = Math.max(0, a.cdGun - h); a.cdMsl = Math.max(0, a.cdMsl - h); a.cmT = Math.max(0, a.cmT - h);
      // countermeasures while defending
      if (T.threat && T.threat.d < A.cms.range && a.cmT <= 0 && (a.flares > 0 || a.chaff > 0)) { a.cmT = A.cms.gap;
        for (const k of ['flare', 'chaff']) { if (a[k === 'flare' ? 'flares' : 'chaff'] <= 0) continue; a[k === 'flare' ? 'flares' : 'chaff']--; stats[k === 'flare' ? 'flares' : 'chaff']++;
          if (bus.decoy) stats.decoyed += bus.decoy(T, k, CM.decoy);
          if (ew && ew.drop && MW) ew.drop(mv(MW, T.r1), mv(MW, sub(T.v, cross(OMEGA_I, T.r1))), k); } }
      if (!ok || T.state !== 'MERGE') { a.merge = 0; a.burst = 0; a.wait = null; continue; }
      if (a.wait == null) a.wait = A.firstShot + Math.random() * (A.firstShotJitter || 0);
      a.merge += h; if (a.merge < a.wait) continue;
      const rel = sub(me.r1, T.r1), d = len(rel), u = mul(rel, 1 / d), nose = qrot(T.q1, [0, 0, -1]), off = angle(nose, u);
      // ── gun: lead point for rounds that keep the bandit's velocity; drop 1/2 g t^2 added upwards
      const G = A.gun, tail = qrot(s.q, [0, 0, 1]), aspect = angle(tail, mul(u, -1));
      if (a.burst > 0 || (a.cdGun <= 0 && a.rounds > 0 && d < G.range && aspect < G.aspect)) {
        const tf = d / v0, up = unit(T.r1), aim = add(add(rel, mul(sub(me.v, T.v), tf)), mul(up, .5 * G0 * tf * tf)), au = unit(aim), offG = angle(nose, au);
        if (a.burst <= 0 && offG < G.cone && d < G.range) { a.burst = G.burst; a.acc = 0; stats.bursts++; }
        if (a.burst > 0) { a.burst -= h; a.acc += G.rate * h; const sig = G.spreadMrad / 1000, rt = unit(cross(au, up)), upP = cross(rt, au);
          while (a.acc >= 1 && a.rounds > 0) { a.acc--; a.rounds--;
            const dir = unit(add(au, add(mul(rt, sig * gauss()), mul(upP, sig * gauss()))));
            if (Wp.shoot(add(T.r1, mul(dir, 10)), add(T.v, mul(dir, v0)), 'red', G.every) >= 0) stats.rounds++; }
          if (a.burst <= 0 || a.rounds <= 0 || offG > 3 * G.cone) { a.burst = 0; a.cdGun = G.cooldown; } } }
      // ── missiles (missiles.js fireAt): one of its own in flight at a time
      if (!ms || !ms.fireAt || a.cdMsl > 0) continue;
      if ((bus.missiles || []).some(m => m.shooter === T && m.state !== 'gone')) continue;
      const inS = a.short > 0 && d >= A.short.minRange && d <= A.short.maxRange && off < A.short.cone, inL = a.long > 0 && d >= A.long.minRange && d <= A.long.maxRange && off < A.long.cone;
      const cls = inS ? 'short' : inL ? 'long' : null; if (!cls) continue;
      a[cls]--; stats[cls]++; a.cdMsl = A[cls].cooldown;
      ms.fireAt({ cls, r: add(T.r1, mul(qrot(T.q1, [0, -1, 0]), 1.2)), v: T.v, d: nose, T: me, t: s.t, shooter: T }); } }
  const sys = Wp.addSystem({ name: 'aiweapons', step });

  // the flight's Reset: every bandit gets its load back
  const onClick = e => { if (e.target.closest && e.target.closest('[data-a="reset"]')) { const ai = L().ai; if (ai) for (const T of ai.list()) per.delete(T); } };
  if (ctx.ui) ctx.ui.addEventListener('click', onClick);
  function dispose() { Wp.removeSystem(sys); if (ctx.ui) ctx.ui.removeEventListener('click', onClick); }
  return { dispose, stats, ammo, data: J };
}
