/* AI targets plug-in (docs/flight-notes/weapons-contract.md row "ai", notes docs/flight-notes/f16-ai.md): red bandits (MiG-29A class) that
   follow the contract's target interface, so the gun, the radar and the missiles use them without knowing this file. Own code.
   Flight: a point mass in the core's frame I (metres, doubles; gravity GM / r^2 as the craft, air turning with the Earth, no wind), forces
   lift + drag + thrust from the Falcon BMS 4.38 MiG-29A tables (data/ai.json: CL / CD vs Mach and alpha, thrust idle / MIL / AB vs altitude and
   Mach), load factor limited by maxG and CLmax, coordinated (no sideslip): the lift lies in the bank plane, the bank follows the wanted lift
   direction at the roll rate. Heun step of h = 1/120 s (the core's), controls held over the step.
   Brain (4 Hz): PATROL (racetrack) -> MERGE (lead pursuit when the F-16 is within mergeRange) -> DEFEND (a missile from Wp.bus.missiles flies
   at it: full AB, beam = 90 deg to the missile's line of sight, dive) -> back. A height floor over the real ground (F.groundAt + 400 m, looked
   up ahead along the track) overrides every state. Killed: a tumbling point mass with gravity + drag, smoke, stops on the ground.
   Drawing (S0a rules): each bandit is its own Object3D at its W position (scale 1 / R_E); smoke / contrail puffs sit in a W-aligned group
   at the craft with vertices in metres relative to it (float32-safe). Shape: own simple geometry after the MiG-29 planform (no model copied).
   Keys: Digit9 spawns one bandit ahead (Shift = a pair). Shader chunks: no // comments after code. */
import { R_E, GM_E, OMEGA_I, H, fromF, toF, qFromBasis } from '../core.js';
import { atmosphere } from '../atmos.js';
import { qmul, qrot } from './weapons.js';

const D2R = Math.PI / 180, G0 = 9.80665, RHO0 = 1.225;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]), unit = a => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : [0, 0, 0]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const perp = (a, n) => sub(a, mul(n, dot(a, n)));   // a without its part along the unit n
const mv = (M, x) => [M[0] * x[0] + M[1] * x[1] + M[2] * x[2], M[3] * x[0] + M[4] * x[1] + M[5] * x[2], M[6] * x[0] + M[7] * x[1] + M[8] * x[2]];
const MWq = M => qFromBasis([M[0], M[3], M[6]], [M[1], M[4], M[7]], [M[2], M[5], M[8]]);
// index + fraction of x in the sorted breakpoints X (clamped)
const seg = (X, x) => { if (x <= X[0]) return [0, 0]; const n = X.length - 1; if (x >= X[n]) return [n - 1, 1]; let i = 1; while (X[i] < x) i++; return [i - 1, (x - X[i - 1]) / (X[i] - X[i - 1])]; };
const lerp = (a, b, t) => a + (b - a) * t;
// table T[i][j] over X (rows) and Y (columns)
const bil = (X, Y, T, x, y) => { const [i, u] = seg(X, x), [j, w] = seg(Y, y); return lerp(lerp(T[i][j], T[i][j + 1], w), lerp(T[i + 1][j], T[i + 1][j + 1], w), u); };

const J = await (await fetch(new URL('./data/ai.json', import.meta.url))).json();

// ── aerodynamics + engine of a type (data/ai.json "type")
export function aeroOf(A) {
  const { mach: MX, alpha: AX, cl: CL, cd: CD } = A, iA0 = AX.indexOf(0), aMax = A.aoaMax;
  const clAt = (M, a) => bil(MX, AX, CL, M, a), cdAt = (M, a) => bil(MX, AX, CD, M, a);
  // the lift coefficient's top (and its alpha) up to aoaMax, and its bottom down to -10 deg, per Mach row (interpolated in Mach later)
  const top = MX.map((m, i) => { let best = [0, 0]; for (let j = iA0; j < AX.length && AX[j] <= aMax; j++) if (CL[i][j] > best[0]) best = [CL[i][j], AX[j]]; return best; });
  const clMax = M => { const [i, u] = seg(MX, M); return lerp(top[i][0], top[i + 1][0], u); };
  // alpha for a wanted CL at Mach M (CL rises with alpha between -10 deg and the top); returns [alpha, CL actually reached]
  function alphaFor(M, cl) {
    const amax = (() => { const [i, u] = seg(MX, M); return lerp(top[i][1], top[i + 1][1], u); })();
    if (cl >= 0) { let a0 = 0, c0 = clAt(M, 0); if (cl <= c0) return [0, c0];
      for (let j = iA0 + 1; j < AX.length && AX[j - 1] < amax; j++) { const a1 = Math.min(AX[j], amax), c1 = clAt(M, a1); if (c1 >= cl) return [a0 + (a1 - a0) * (cl - c0) / (c1 - c0 || 1), cl]; a0 = a1; c0 = c1; }
      return [a0, c0]; }
    let a0 = 0, c0 = clAt(M, 0);
    for (let j = iA0 - 1; j >= 0 && AX[j] >= -10; j--) { const a1 = AX[j], c1 = clAt(M, a1); if (c1 <= cl) return [a0 + (a1 - a0) * (cl - c0) / (c1 - c0 || 1), cl]; a0 = a1; c0 = c1; }
    return [a0, c0]; }
  // thrust of all engines (N) at height (m), Mach, throttle 0..1 = idle..MIL, 1..2 = MIL..full AB
  const TA = A.thrustAlt, TM = A.thrustMach;
  function thrust(hm, M, thr) { const mil = bil(TA, TM, A.mil, hm, M);
    const t = thr <= 1 ? lerp(bil(TA, TM, A.idle, hm, M), mil, thr) : lerp(mil, bil(TA, TM, A.ab, hm, M), thr - 1); return Math.max(0, t) * A.nEng; }
  // level-flight performance at height hm (m) and true airspeed V (m/s): instantaneous (CLmax / maxG) and sustained (thrust = drag, full AB)
  function perf(hm, V) { const at = atmosphere(hm), M = V / at.a, q = .5 * at.rho * V * V, qS = q * A.area, W = A.mass * G0;
    const nMax = Math.min(A.maxG, clMax(M) * qS / W); let lo = 0, hi = nMax;
    const Tmax = thrust(hm, M, 2), drag = n => { const [a] = alphaFor(M, n * W / qS); return qS * cdAt(M, a); };
    if (drag(1) > Tmax) hi = lo = 1; else for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (drag(mid) <= Tmax) lo = mid; else hi = mid; }
    const w = n => n > 1 ? G0 * Math.sqrt(n * n - 1) / V / D2R : 0;
    return { M, nMax, wMax: w(nMax), nSus: lo, wSus: w(lo), Ps: (Tmax - drag(1)) * V / W }; }
  return { clAt, cdAt, clMax, alphaFor, thrust, perf };
}

export function attach(ctx) {
  const { F, Wp, S } = ctx, THREE = F.THREE, A = J.type, B = J.behaviour, aero = aeroOf(A), core = ctx.core;
  const bandits = [];
  let serial = 0;

  // ground radius (m from the Earth's centre) under an I point at time t: relief + 400 m (as the core); null = no height tile there
  const groundR = (t, r) => { const f = toF(t, r), fl = len(f), g = F.groundAt(Math.asin(f[1] / fl), Math.atan2(-f[2], f[0])); return g == null ? null : R_E + 400 + g; };
  const gravity = r => { const rl = len(r); return mul(r, -GM_E / (rl * rl * rl)); };
  const vAir = (r, v) => sub(v, cross(OMEGA_I, r));

  // ── one bandit. o = { r (I m), v (I m/s, inertial), t (ms), hMSL (patrol height), axis (I unit, racetrack leg), state }
  function createBandit(o) {
    const T = { name: 'bandit-' + (++serial), kind: A.name, alive: true, team: 'red', rcs: A.rcs, ir: A.ir[1], size: 9.5, hp: A.hp, hits: 0,
      boxes: [{ c: [0, 0, -.5], h: [.95, .75, 8.2] }, { c: [0, -.05, 1.6], h: [5.68, .18, 2.6] }, { c: [0, .1, 6.4], h: [3.9, .12, 1.1] }, { c: [0, 1.7, 6.2], h: [1.9, 1.3, 1.1] }],
      r0: null, r1: o.r.slice(), q1: [0, 0, 0, 1], v: o.v.slice(), state: o.state || 'PATROL', fall: null, onGround: false,
      // flight state: lift direction (unit, I, perpendicular to the air velocity), throttle command / actual (0..2), alpha (deg), load factor
      lh: null, thrCmd: 1, thr: 1, alpha: 2, n: 1, Vt: B.patrolTas, aimDir: null, hT: o.hMSL, gAhead: null, gHere: null, gStep: 0,
      brainT: 0, minAGL: Infinity, hAGL: null, threat: null, wp: 0, home: o.r.slice(), axis: o.axis, hPatrol: o.hMSL, tSpawn: o.t, test: o.test || null };
    // racetrack corners (I, at the spawn time; the Earth's turn over a patrol is ignored for the corners: they are drift-free in F)
    { const up = unit(o.r), ax = unit(perp(o.axis, up)), sd = cross(ax, up), L = B.patrolLeg / 2, Wd = B.patrolWidth / 2, fH = toF(o.t, o.r);
      T.corners = [[L, Wd], [-L, Wd], [-L, -Wd], [L, -Wd]].map(([a, b]) => toF(o.t, add(o.r, add(mul(ax, a), mul(sd, b))))).map(f => mul(unit(f), len(fH))); }

    // ── brain: picks the wanted flight direction (I unit), speed, throttle mode; 4 Hz
    function brain(t, s) {
      const r = T.r1, up = unit(r), va = vAir(r, T.v), V = len(va), at = atmosphere(len(r) - R_E - 400);
      if (T.test) { T.aimDir = null; return; }
      // threat: the nearest live missile aimed at this bandit that it can know about (ESTIMATE warning ranges: AIM-9 seen, AIM-120 RWR when active)
      let th = null;
      for (const m of ctx.bus.missiles || []) { if (m.target !== T || !m.r || m.state === 'gone' || m.state === 'rail') continue; const d = len(sub(m.r, r));
        const warn = /9/.test(m.type || '') ? B.warnAim9 : (m.state === 'pitbull' ? Infinity : B.warnAim120); if (d < warn && (!th || d < th.d)) th = { m, d }; }
      T.threat = th;
      const me = s && s.ref === 'Earth' && !s.crash ? s : null, rel = me ? sub(me.r, r) : null, rng = rel ? len(rel) : Infinity;
      if (th) T.state = 'DEFEND';
      else if (T.state === 'DEFEND') T.state = rng < B.leaveRange ? 'MERGE' : 'PATROL';
      else if (T.state === 'PATROL' && rng < B.mergeRange) T.state = 'MERGE';
      else if (T.state === 'MERGE' && rng > B.leaveRange) T.state = 'PATROL';
      const cornerTas = A.cornerKcas * .514444 / Math.sqrt(at.rho / RHO0);
      if (T.state === 'DEFEND') {
        // beam: horizontal, 90 deg to the line of sight to the missile, on the side nearer the present heading; dive while high enough
        const los = unit(perp(sub(th.m.r, r), up)), p = unit(cross(up, los)), hv = unit(perp(va, up)), side = dot(p, hv) >= 0 ? p : mul(p, -1);
        const gam = (T.hAGL != null && T.hAGL > B.defendBottomAGL) ? B.defendDive * D2R : 0;
        T.aimDir = add(mul(side, Math.cos(gam)), mul(up, Math.sin(gam))); T.hT = null; T.Vt = 1e9; T.thrCmd = 2; return; }
      if (T.state === 'MERGE') {
        // lead pursuit: aim at where the F-16 will be in tl seconds (tl grows with range, capped), straight at it in height too (+-30 deg)
        const tl = clamp(rng / (V + 300), 0, B.leadMax), vRel = me.v ? sub(me.v, T.v) : [0, 0, 0];
        let d = unit(add(rel, mul(vRel, tl))); const el = Math.asin(clamp(dot(d, up), -1, 1)), lim = 30 * D2R;
        if (Math.abs(el) > lim) { const hz = unit(perp(d, up)); d = add(mul(hz, Math.cos(lim)), mul(up, Math.sign(el) * Math.sin(lim))); }
        T.aimDir = d; T.hT = null; T.Vt = rng > 8000 ? Math.max(cornerTas, 300) : cornerTas; return; }
      // PATROL: corners in order (I now from F), height hold
      const cI = fromF(t, T.corners[T.wp]); if (len(perp(sub(cI, r), up)) < 2000) T.wp = (T.wp + 1) % 4;
      T.aimDir = unit(perp(sub(fromF(t, T.corners[T.wp]), r), up)); T.hT = T.hPatrol; T.Vt = B.patrolTas; }

    // ── guidance + forces: the specific force (lift + thrust - drag, I m/s^2) for this step
    function control(t, h) {
      const r = T.r1, up = unit(r), va = vAir(r, T.v), V = len(va), vh = mul(va, 1 / V), hm = len(r) - R_E - 400;
      const at = atmosphere(hm), M = V / at.a, q = .5 * at.rho * V * V, qS = q * A.area, W = A.mass * G0;
      // ground: here + ahead along the track (every 15 steps = 8 Hz), the highest one counts for the floor
      if (--T.gStep <= 0) { T.gStep = 15; let gmax = null, here = null;
        for (const s of B.lookAhead) { const g = groundR(t, add(r, mul(perp(va, up), s))); if (g == null) continue; if (s === 0) here = g; gmax = gmax == null ? g : Math.max(gmax, g); }
        if (here != null) T.gHere = here; if (gmax != null) T.gAhead = gmax; }
      const rl = len(r), hAGL = T.gHere != null ? rl - T.gHere : null, hAhead = T.gAhead != null ? rl - T.gAhead : null; T.hAGL = hAGL;
      if (hAGL != null) T.minAGL = Math.min(T.minAGL, hAGL);
      // wanted direction: the brain's, or straight on; height hold folds a climb angle in
      let d = T.aimDir || vh; const vz = dot(va, up), cmax = B.climbMax * D2R;
      if (T.hT != null) { const hz = unit(perp(d, up)), g = Math.asin(clamp((T.hT - hm) / (B.climbTau * V), -Math.sin(cmax), Math.sin(cmax))); d = add(mul(hz, Math.cos(g)), mul(up, Math.sin(g))); }
      // floor: the higher of (floor + 4 s of sink) over the ground here / ahead -> a minimum climb angle (overrides every state)
      if (hAhead != null) { const need = B.floorAGL + Math.max(0, -vz) * 4, h0 = Math.min(hAhead, hAGL ?? hAhead);
        if (h0 < need) { const gmin = clamp((need - h0) / need, 0, 1) * cmax + (h0 < B.hardFloorAGL ? 10 * D2R : 0), el = Math.asin(clamp(dot(unit(d), up), -1, 1));
          if (el < gmin) { const hz = unit(perp(d, up)); d = add(mul(hz, Math.cos(gmin)), mul(up, Math.sin(gmin))); } } }
      if (T.test && T.test.turn) { const hz = unit(cross(vh, up)); d = add(hz, mul(up, clamp((T.test.h - hm) / (B.climbTau * V), -.3, .3))); }
      d = unit(d);
      // turn toward d: rate kp x angle (saturates at the lift limit), gravity's cross part carried first
      const g = gravity(r), gp = perp(g, vh), e = perp(d, vh), el = len(e), ang = Math.atan2(el, dot(d, vh));
      const eh = el > 1e-9 ? mul(e, 1 / el) : (T.lh || unit(perp(up, vh)));
      let aT = mul(eh, V * B.kp * ang);
      // g cap by state (energy rule, ESTIMATE): DEFEND / test = all it has; MERGE = full g at corner speed and above, less when slower so a
      // pursuit does not bleed to a stall; PATROL = 3 g
      const corner = A.cornerKcas * .514444 / Math.sqrt(at.rho / RHO0), sl = clamp((V - B.slowTas) / (corner - B.slowTas), 0, 1);
      const nCap = T.state === 'DEFEND' || T.test ? A.maxG : T.state === 'MERGE' ? 1.5 + (A.maxG - 1.5) * sl * sl : 3;
      const nLimUp = Math.min(A.maxG, nCap, aero.clMax(M) * qS / W), Lmax = nLimUp * G0;
      // test: a level turn whose load factor holds the true airspeed test.V (sustained turn), or max lift without test.V
      if (T.test && T.test.turn && T.test.V) { const tt = T.test; const dV = tt.Vp ? (V - tt.Vp) / h : 0; tt.Vp = V; tt.nc = clamp((tt.nc || 1.5) + ((V - tt.V) * .05 + dV * .4) * h, 1, nLimUp);
        aT = add(mul(unit(cross(vh, up)), Math.sqrt(Math.max(0, (tt.nc * G0) ** 2 - dot(gp, gp)))), mul(unit(perp(up, vh)), (tt.h - hm) * .02 - vz * .4)); }
      let aL = sub(aT, gp);
      if (len(aL) > Lmax) { // largest s in [0, 1] with |s aT - gp| = Lmax (keep the gravity part when it fits)
        const a2 = dot(aT, aT), b2 = -2 * dot(aT, gp), c2 = dot(gp, gp) - Lmax * Lmax, D = b2 * b2 - 4 * a2 * c2;
        const s = (c2 < 0 && a2 > 1e-12 && D >= 0) ? clamp((-b2 + Math.sqrt(D)) / (2 * a2), 0, 1) : 0; aL = sub(mul(aT, s), gp); if (len(aL) > Lmax) aL = mul(unit(aL), Lmax); }
      // bank: the lift direction turns about the velocity toward aL at the roll rate (lower at low dynamic pressure: ESTIMATE)
      // a small downward need (<= 1.5 g) is a push (negative lift, wings stay level), not a roll to inverted
      const aLl = len(aL), upP = unit(perp(up, vh)), push = aLl > .1 * G0 && dot(aL, upP) < -.7 * aLl && aLl <= 1.5 * G0;
      const want = aLl > .1 * G0 ? mul(aL, (push ? -1 : 1) / aLl) : upP;
      if (!T.lh) T.lh = want.slice();
      T.lh = unit(perp(T.lh, vh));
      const phi = Math.atan2(dot(cross(T.lh, want), vh), dot(T.lh, want)), rr = A.rollRate * D2R * clamp(q / 15000, .3, 1) * h, dp = clamp(phi, -rr, rr);
      const c = Math.cos(dp), sn = Math.sin(dp); T.lh = unit(add(mul(T.lh, c), mul(cross(vh, T.lh), sn)));
      let Lacc = dot(aL, T.lh); Lacc = clamp(Lacc, A.minG * G0, Lmax);
      // alpha for that lift, drag, thrust (speed hold: P on the true airspeed; spool lag)
      const [alpha, clr] = aero.alphaFor(M, Lacc * A.mass / qS); Lacc = clr * qS / A.mass; T.alpha = alpha; T.n = Lacc / G0;
      if (T.state !== 'DEFEND' || T.test) T.thrCmd = clamp(1 + (T.Vt - V) / 25, T.state === 'MERGE' ? 1 : 0, 2);   // no idle in a merge
      if (T.test && T.test.thr != null) T.thrCmd = T.test.thr;
      T.thr += (T.thrCmd - T.thr) * Math.min(1, h / A.spool);
      const Th = aero.thrust(hm, M, T.thr), Dr = qS * aero.cdAt(M, alpha);
      T.ir = T.thr <= 1 ? lerp(A.ir[0], A.ir[1], T.thr) : lerp(A.ir[1], A.ir[2], T.thr - 1);
      T.M = M; T.V = V; T.hm = hm; T.Th = Th; T.Dr = Dr;
      return add(mul(vh, (Th - Dr) / A.mass), mul(T.lh, Lacc)); }

    // pose: body -z along the air velocity turned up by alpha in the lift plane, body y = the lift direction turned back by alpha
    function pose() { const va = vAir(T.r1, T.v), vh = unit(va), lh = T.lh || unit(perp(unit(T.r1), vh)), a = T.alpha * D2R;
      const fw = add(mul(vh, Math.cos(a)), mul(lh, Math.sin(a))), Y = unit(add(mul(vh, -Math.sin(a)), mul(lh, Math.cos(a)))), Z = mul(fw, -1); T.q1 = qFromBasis(cross(Y, Z), Y, Z); }

    function toWorld(MW, h) { T.w1 = mv(MW, T.r1); T.w0 = T.wNext || add(T.w1, mul(mv(MW, vAir(T.r1, T.v)), -h)); T.wNext = T.w1;
      const qw = qmul(MWq(MW), T.q1); T.wq0 = T.wq1 || qw; T.wq1 = qw; }

    // ── per physics step (weapons.js, before the systems): t0 = the step's start (ms), h (s), MW = I -> W at the step's end
    T.step = (t0, h, env, MW) => {
      const t1 = t0 + h * 1e3; T.r0 = T.r1.slice();
      if (!T.fall) {
        if ((T.brainT -= h) <= 0) { T.brainT = .25; brain(t0, core.state); }
        const aF = control(t0, h), a1 = add(gravity(T.r1), aF), p = add(T.r1, mul(T.v, h)), qv = add(T.v, mul(a1, h)), a2 = add(gravity(p), aF);
        T.r1 = add(T.r1, mul(add(T.v, qv), h / 2)); T.v = add(T.v, mul(add(a1, a2), h / 2));
        // last guard (never expected): a hard floor above the ground here
        if (T.gHere != null) { const rl = len(T.r1), lo = T.gHere + B.hardFloorAGL * .5; if (rl < lo) { T.r1 = mul(T.r1, lo / rl); T.floorHits = (T.floorHits || 0) + 1; } }
        pose(); toWorld(MW, h); return; }
      // killed: a tumbling point mass (gravity + drag against the turning air), roll + slow pitch down; stops on the ground
      if (T.onGround) { T.r1 = fromF(t1, T.fGround); T.v = cross(OMEGA_I, T.r1); toWorld(MW, h); return; }
      const acc = (r, v) => { const A2 = atmosphere(len(r) - R_E - 400), va = vAir(r, v); return add(gravity(r), mul(va, -.5 * A2.rho * A.deadCdA / A.mass * len(va))); };
      const a1 = acc(T.r1, T.v), p = add(T.r1, mul(T.v, h)), qv = add(T.v, mul(a1, h)), a2 = acc(p, qv);
      T.r1 = add(T.r1, mul(add(T.v, qv), h / 2)); T.v = add(T.v, mul(add(a1, a2), h / 2));
      const ro = T.fall.roll * h, pi = -.35 * h, qr = qmul([0, 0, Math.sin(ro / 2), Math.cos(ro / 2)], [Math.sin(pi / 2), 0, 0, Math.cos(pi / 2)]); T.q1 = qmul(T.q1, qr);
      const gR = groundR(t1, T.r1);
      if (gR != null && len(T.r1) <= gR) { const f = toF(t1, T.r1); T.fGround = mul(f, (gR + .5) / len(f)); T.r1 = fromF(t1, T.fGround); T.v = cross(OMEGA_I, T.r1); T.onGround = true; T.tGround = t1; T.impact = true; }
      toWorld(MW, h); };

    // a hit: true when it kills. Gun rounds count (hp), a missile blast kills (contract: T.hit(w, { name, blast: true }))
    T.hit = (w, kind) => { if (!T.alive) return false; T.hits++; T.lastHit = { w, kind, t: core.state.t };
      if (!(kind && kind.blast) && T.hits < T.hp) return false;
      T.alive = false; T.state = 'DEAD'; T.fall = { roll: (Math.random() < .5 ? -1 : 1) * (60 + 80 * Math.random()) * D2R }; T.thr = 0; T.ir = A.ir[0] * .5; return true; };
    T.object = makeShape(); T.object.visible = false;
    return T;
  }

  // ── shape: own simple geometry after the MiG-29 planform (length 17.3 m, span 11.4 m, twin canted fins), two greys
  const mats = { top: new THREE.MeshStandardMaterial({ color: 0x8e9aa3, roughness: .55, metalness: .25, side: THREE.DoubleSide }), dark: new THREE.MeshStandardMaterial({ color: 0x5d6870, roughness: .6, metalness: .25, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: .1, metalness: .6 }), noz: new THREE.MeshStandardMaterial({ color: 0x2e2a27, roughness: .7, metalness: .6 }),
    flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.3, .5), transparent: true, opacity: .85, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    red: new THREE.MeshBasicMaterial({ color: 0xd42a1e }) };
  const geos = [];
  const G = g => { geos.push(g); return g; };
  // flat plate from a planform [x, z] list (y = 0), thickness th
  const plate = (pts, th) => { const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))); const g = new THREE.ExtrudeGeometry(sh, { depth: th, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, -th / 2, 0); return G(g); };
  const wingPts = [[.9, -6.3], [1.5, -2.4], [2.1, -.2], [5.68, 3.0], [5.68, 4.0], [2.3, 4.3], [-2.3, 4.3], [-5.68, 4.0], [-5.68, 3.0], [-2.1, -.2], [-1.5, -2.4], [-.9, -6.3]];
  const tailPts = [[.9, 5.3], [3.9, 7.0], [3.9, 7.6], [1.0, 7.6], [-1.0, 7.6], [-3.9, 7.6], [-3.9, 7.0], [-.9, 5.3]];
  const finPts = [[0, 3.9], [2.9, 6.1], [2.9, 7.1], [0, 7.7]];   // [height, z]
  const fus = (() => { const prof = [[0, -8.66], [.18, -8.2], [.42, -7.0], [.62, -5.6], [.78, -4.2], [.85, -2], [.8, 2], [.6, 6], [.4, 7.6]].map(([r, z]) => new THREE.Vector2(r, z)); const g = new THREE.LatheGeometry(prof, 18); g.rotateX(Math.PI / 2); g.scale(1.15, 1, 1); return G(g); })();
  const nac = G(new THREE.CylinderGeometry(.62, .58, 8.2, 14)); nac.rotateX(Math.PI / 2);
  const noz = G(new THREE.CylinderGeometry(.5, .56, .9, 14, 1, true)); noz.rotateX(Math.PI / 2);
  const inl = G(new THREE.BoxGeometry(.95, .85, 2.6));
  const can = G(new THREE.SphereGeometry(.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)); can.scale(.9, .8, 2.6);
  const fla = G(new THREE.ConeGeometry(.42, 3.2, 12, 1, true)); fla.rotateX(Math.PI / 2); fla.translate(0, 0, 1.6);
  const star = G(new THREE.CircleGeometry(.45, 5)); star.rotateX(-Math.PI / 2);
  const wingG = plate(wingPts, .22), tailG = plate(tailPts, .12);
  const finG = (() => { const sh = new THREE.Shape(finPts.map(([y, z]) => new THREE.Vector2(z, y))); const g = new THREE.ExtrudeGeometry(sh, { depth: .14, bevelEnabled: false }); g.rotateY(-Math.PI / 2); g.translate(.07, 0, 0); return G(g); })();
  function makeShape() {
    const g = new THREE.Group(); g.scale.setScalar(1 / R_E);
    const m = (geo, mat, x = 0, y = 0, z = 0) => { const k = new THREE.Mesh(geo, mat); k.position.set(x, y, z); g.add(k); return k; };
    m(fus, mats.top, 0, .15, 0); m(wingG, mats.top, 0, 0, 0); m(tailG, mats.dark, 0, .05, 0);
    for (const sx of [-1, 1]) { m(nac, mats.dark, sx * .95, -.3, 3.3); m(noz, mats.noz, sx * .95, -.3, 7.75); m(inl, mats.dark, sx * 1.0, -.62, -2.2);
      const f = m(finG, mats.top, sx * 1.55, .2, 0); f.rotation.z = -sx * 8 * D2R;
      const fl = m(fla, mats.flame, sx * .95, -.3, 8.1); fl.name = 'flame'; fl.visible = false;
      m(star, mats.red, sx * 4.4, .13, 3.4); }
    m(can, mats.glass, 0, .78, -4.8);
    g.traverse(k => { if (k.isMesh) k.castShadow = false; });
    return g; }

  // ── smoke / contrail puffs: W metres, drawn as soft billboards relative to the craft
  const BB_V = 'attribute vec3 iP; attribute vec4 iC; attribute float iS; uniform float uPx; varying vec2 vQ; varying vec4 vC;\n' +
    'void main() { vec4 c = modelViewMatrix * vec4(iP, 1.); c.xy += position.xy * max(iS, -c.z * uPx); vQ = position.xy; vC = iC; gl_Position = projectionMatrix * c; }';
  const BB_F = 'varying vec2 vQ; varying vec4 vC;\n' +
    'void main() { float r = length(vQ); if (r > 1.) discard; float f = 1. - r; f = f * f * (3. - 2. * f); gl_FragColor = vec4(vC.rgb, vC.a * f); }';
  const NP = 1500, root = new THREE.Group(); root.scale.setScalar(1 / R_E); ctx.cs.add(root);
  const uPx = { value: 0 };
  const pg = new THREE.InstancedBufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); pg.setIndex([0, 1, 2, 0, 2, 3]);
  const PA = { iP: 3, iC: 4, iS: 1 }; for (const k in PA) { const a = new THREE.InstancedBufferAttribute(new Float32Array(NP * PA[k]), PA[k]); a.setUsage(THREE.DynamicDrawUsage); pg.setAttribute(k, a); PA[k] = a; }
  pg.instanceCount = 0;
  const pm = new THREE.ShaderMaterial({ vertexShader: BB_V, fragmentShader: BB_F, uniforms: { uPx }, transparent: true, depthWrite: false });
  const pmesh = new THREE.Mesh(pg, pm); pmesh.frustumCulled = false; pmesh.renderOrder = 2; root.add(pmesh);
  const puffs = [];   // { w, t0, life, s0, s1, c: [r, g, b], a }
  const puff = p => { if (puffs.length >= NP) puffs.shift(); puffs.push(p); };

  // ── spawning. o = { d (m ahead of the F-16, default 15-25 km random), bearing (deg right of its nose), hMSL (m, default 3-8 km random),
  //    heading (deg right of the F-16's heading, default 90 or -90 = crossing), speed (m/s TAS), state, test }
  function spawn(o = {}) {
    const s = core.state; if (!s || s.ref !== 'Earth') return null;
    while (bandits.length >= B.maxBandits) { const k = bandits.findIndex(b => !b.alive); remove(bandits[k >= 0 ? k : 0]); }
    const up = unit(s.r), fw = unit(perp(qrot(s.q, [0, 0, -1]), up)), rt = cross(fw, up);
    const brg = (o.bearing ?? (Math.random() * 40 - 20)) * D2R, d = o.d ?? 15000 + 10000 * Math.random(), dir = add(mul(fw, Math.cos(brg)), mul(rt, Math.sin(brg)));
    let hMSL = o.hMSL ?? 3000 + 5000 * Math.random();
    const p0 = add(s.r, mul(dir, d)), g = groundR(s.t, p0); if (g != null) hMSL = Math.max(hMSL, g - R_E - 400 + B.floorAGL + 300);
    const r = mul(unit(p0), R_E + 400 + hMSL), u2 = unit(r);
    const hd = (o.heading ?? (Math.random() < .5 ? 90 : -90)) * D2R, f2 = unit(perp(fw, u2)), r2 = cross(f2, u2), vd = add(mul(f2, Math.cos(hd)), mul(r2, Math.sin(hd)));
    const V = o.speed ?? B.patrolTas, v = add(mul(vd, V), cross(OMEGA_I, r));
    const T = createBandit({ r, v, t: s.t, hMSL, axis: vd, state: o.state, test: o.test });
    bandits.push(T); Wp.addTarget(T); ctx.cs.add(T.object); return T; }
  function remove(T) { const i = bandits.indexOf(T); if (i >= 0) bandits.splice(i, 1); Wp.removeTarget(T); ctx.cs.remove(T.object); }

  ctx.key('Digit9', ['9', 'Spawn a bandit ahead (Shift+9: a pair)'], e => { if (e.repeat) return; const a = spawn();
    if (a && e.shiftKey) { const s = core.state, up = unit(a.r1), vh = unit(perp(vAir(a.r1, a.v), up)), sd = cross(vh, up);
      // wingman: 1.5 km abeam, 300 m back, same height and velocity
      const r = add(a.r1, add(mul(sd, 1500), mul(vh, -300))), T = createBandit({ r, v: a.v.slice(), t: s.t, hMSL: a.hPatrol, axis: a.axis, state: a.state });
      T.wp = a.wp; T.corners = a.corners.map(c => add(c, mul(toF(s.t, sd), 1500))); bandits.push(T); Wp.addTarget(T); ctx.cs.add(T.object); } });

  // ── per drawn frame: poses (interpolated between the step's start and end as the drone), smoke, flames, the craft layer's far plane
  const qd = new THREE.Quaternion();
  ctx.onPose((P, t) => {
    if (!P) return; const s = core.state, a = clamp((t - s.t) / (H * 1e3), 0, 1), tS = t / 1e3, cc = S.cc, Hpx = Math.max(1, F.renderer.domElement.clientHeight);
    root.position.copy(P.pos); const base = [P.pos.x * R_E, P.pos.y * R_E, P.pos.z * R_E];
    uPx.value = 2 * Math.tan(cc.fov * D2R / 2) / Hpx * 1.2;
    let far = 0;
    for (const T of bandits.slice()) { const o3 = T.object; if (!T.w1) continue; o3.visible = true;
      const p = [0, 1, 2].map(k => T.w0[k] + (T.w1[k] - T.w0[k]) * a); o3.position.set(p[0] / R_E, p[1] / R_E, p[2] / R_E);
      qd.set(...T.wq0); o3.quaternion.set(...T.wq1); o3.quaternion.copy(qd.slerp(o3.quaternion, a));
      far = Math.max(far, Math.hypot(p[0] - base[0], p[1] - base[1], p[2] - base[2]) + 12);
      const ab = T.alive && T.thr > 1.02; o3.traverse(k => { if (k.name === 'flame') { k.visible = ab; k.scale.set(1, 1, .5 + .5 * (T.thr - 1) * (.85 + .3 * Math.random())); } });
      // trails: the RD-33's grey smoke at MIL and below (a known MiG-29 trait; look ESTIMATE), a contrail above ~8.2 km, black smoke when killed
      const tail = [0, 1, 2].map(k => p[k] - (T.w1[k] - T.w0[k]) / H * .03);
      if (!T.fall && tS - (T.lastPuff || 0) > .12) { T.lastPuff = tS;
        if (T.hm > 8200) puff({ w: tail, t0: tS, life: 9, s0: 1.4, s1: 9, c: [.92, .93, .95], a: .55 });
        else if (T.thr <= 1.02 && T.thr > .6) puff({ w: tail, t0: tS, life: 3.5, s0: 1, s1: 5, c: [.36, .36, .37], a: .22 }); }
      if (T.fall && !T.onGround && tS - (T.lastPuff || 0) > .05) { T.lastPuff = tS; puff({ w: p, t0: tS, life: 9, s0: 2, s1: 12, c: [.12, .12, .13], a: .85 });
        puff({ w: p, t0: tS, life: .4, s0: 2.5, s1: 1.5, c: [2.6, 1.2, .35], a: 1 }); }
      if (T.impact) { T.impact = false; puff({ w: p, t0: tS, life: 2, s0: 8, s1: 22, c: [2.8, 1.4, .4], a: 1 }); puff({ w: p, t0: tS, life: 14, s0: 10, s1: 40, c: [.18, .17, .16], a: .85 }); }
      if (T.onGround && s.t - T.tGround > B.wreckLife * 1e3) remove(T); }
    // puffs (sim clock; smoke rises 2 m/s: ESTIMATE)
    let n = 0; const P3 = PA.iP.array, C = PA.iC.array, Sz = PA.iS.array;
    for (let k = puffs.length - 1; k >= 0; k--) { const p = puffs[k], u = (tS - p.t0) / p.life; if (u >= 1 || u < 0) { puffs.splice(k, 1); continue; }
      const ul = Math.hypot(...p.w), rise = 2 * (tS - p.t0), x = p.w[0] - base[0] + p.w[0] / ul * rise, y = p.w[1] - base[1] + p.w[1] / ul * rise, z = p.w[2] - base[2] + p.w[2] / ul * rise;
      const sz = p.s0 + (p.s1 - p.s0) * u; far = Math.max(far, Math.hypot(x, y, z) + sz);
      P3[3 * n] = x; P3[3 * n + 1] = y; P3[3 * n + 2] = z; C[4 * n] = p.c[0]; C[4 * n + 1] = p.c[1]; C[4 * n + 2] = p.c[2]; C[4 * n + 3] = p.a * (1 - u); Sz[n] = sz / R_E; n++; }
    pg.instanceCount = n; for (const k in PA) PA[k].needsUpdate = true;
    if (far > 0) { const cp = F.piloting ? core.camPose(t) : null, dCam = (cp ? cp.pos : F.camera.position).distanceTo(P.pos) * R_E;
      cc.far = Math.max(cc.far, Math.min(80000, far + dCam + 50) / R_E); cc.near = Math.min(cc.near, 1 / R_E); } });

  function dispose() { for (const T of bandits.slice()) remove(T); ctx.cs.remove(root); pg.dispose(); pm.dispose(); for (const g of geos) g.dispose(); for (const k in mats) mats[k].dispose(); }
  return { dispose, list: () => bandits, spawn, remove, aero, data: J };
}
