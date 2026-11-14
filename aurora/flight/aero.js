/* Aircraft flight model (docs/flight-plan.md, step S2): aero forces + moments from coefficient tables (JSBSim-style method, own code; no
   GPL / LGPL code copied), turbofan with afterburner, fuel mass + CG, gear spring-dampers with brakes and nose-wheel steering, and a SIMPLE
   stability augmentation so the F-16 is flyable (NOT the real F-16 FLCS, see the plan's S2 notes).
   createAircraft(json) -> { def, mods } for flight/core.js createCore(F, def, at, { mods }).
   Frames: core's body axes are three.js (x right, y up, z aft); the tables use x forward, y right, z down ("SL" below).
   SL -> three: t = [y, -z, -x]; moments the same; rates: three w = [q, -r, -p]. */
import { OMEGA_I, toF, latLonOf, R_E, GM_E } from './core.js?v=47034b95';
import { atmosphere, casOf } from './atmos.js?v=7ee6d1db';

const D2R = Math.PI / 180, G0 = 9.80665, LBF = 4.448222, FT = .3048;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const madd = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k], len = a => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const qrot = (q, v) => { const t = mul(cross(q, v), 2); return add(add(v, mul(t, q[3])), cross(q, t)); };
const qinv = q => [-q[0], -q[1], -q[2], q[3]];
const mv = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ── table evaluator: linear interpolation, clamped at the ends; 1-D and 2-D (3-D = interpolate two 2-D tables, not needed yet)
function seg(n, x) { const k = n.length - 1; if (x <= n[0]) return [0, 0]; if (x >= n[k]) return [k - 1, 1];
  let i = 0; while (x > n[i + 1]) i++; return [i, (x - n[i]) / (n[i + 1] - n[i])]; }
export const lut1 = (n, y, x) => { const [i, f] = seg(n, x); return y[i] + (y[i + 1] - y[i]) * f; };
export const lut2 = (rn, cn, T, r, c) => { const [i, f] = seg(rn, r), [j, g] = seg(cn, c);
  const a = T[i][j] + (T[i][j + 1] - T[i][j]) * g, b = T[i + 1][j] + (T[i + 1][j + 1] - T[i + 1][j]) * g; return a + (b - a) * f; };

export function createAircraft(J) {
  const G = J.geometry, A = J.alpha, D = J.damp, Mt = J.mach, PS = J.postStall, E = J.engine, GR = J.gear, FC = J.fcs, CT = J.controls;
  const S = G.S, b = G.b, c = G.cbar;

  // ── aerodynamic coefficients (SL body axes). al, be in deg; el, ai, ru in deg; p, q, r rad/s; V m/s; M Mach; xcg in cbar; gear 0..1
  function coef(al, be, M, el, ai, ru, p, q, r, V, xcg, gear) {
    const ac = clamp(al, A[0], A[A.length - 1]), ab = Math.abs(be), bs = Math.sign(be) || 1, bc = clamp(be, -30, 30);
    const kL = lut1(Mt.M, Mt.kL, M), dCD = lut1(Mt.M, Mt.dCD, M) + J.gearDrag * gear, dX = lut1(Mt.M, Mt.dXac, M);
    let CX = lut2(J.elevNodes, A, J.CX, el, ac), CZ = lut1(A, J.CZ, ac) * kL * (1 - Math.pow(Math.min(ab, 30) / 57.3, 2)) + J.linear.CZelev * el / 25;
    let CM = lut2(J.elevNodes, A, J.CM, el, ac);
    // post-stall: blend into a flat-plate-like body (estimate)
    const w = al > 0 ? smooth(PS.from, PS.full, al) : smooth(-PS.fromNeg, -PS.fullNeg, -al), ar = al * D2R;
    if (w > 0) { CX += (-PS.CA90 * Math.cos(ar) - CX) * w; CZ += (-PS.CN90 * Math.sin(ar) - CZ) * w; CM += (PS.CM90 * Math.sin(ar) - CM) * w; }
    CX -= dCD * Math.cos(ar); CZ -= dCD * Math.sin(ar);
    const da = ai / 20, dr = ru / 30, Vd = Math.max(V, 5), ch = c / (2 * Vd), bh = b / (2 * Vd), dmp = n => lut1(A, D[n], ac);
    CX += ch * dmp('CXq') * q; CZ += ch * dmp('CZq') * q;
    const CY = J.linear.CYbeta * bc + J.linear.CYail * da + J.linear.CYrud * dr + bh * (dmp('CYr') * r + dmp('CYp') * p);
    const Cl = bs * lut2(J.betaNodes, A, J.CL, Math.min(ab, 30), ac) + lut2(J.betaNodesSigned, A, J.DLDA, bc, ac) * da + lut2(J.betaNodesSigned, A, J.DLDR, bc, ac) * dr + bh * (dmp('Clr') * r + dmp('Clp') * p);
    CM += CZ * (G.xcgRef - xcg) + CZ * dX + ch * dmp('Cmq') * q;
    const Cn = bs * lut2(J.betaNodes, A, J.CN, Math.min(ab, 30), ac) + lut2(J.betaNodesSigned, A, J.DNDA, bc, ac) * da + lut2(J.betaNodesSigned, A, J.DNDR, bc, ac) * dr
      - CY * (G.xcgRef - xcg) * c / b + bh * (dmp('Cnr') * r + dmp('Cnp') * p);
    return [CX, CY, CZ, Cl, CM, Cn];
  }
  // air data of a state (alpha, beta in deg)
  function airData(st, env) { const vb = qrot(qinv(st.q), env.vAirOf(st)), V = len(vb);
    return { V, al: Math.atan2(-vb[1], -vb[2]) / D2R, be: V > 1e-3 ? Math.asin(clamp(vb[0] / V, -1, 1)) / D2R : 0, M: V / env.air.a, qb: .5 * env.air.rho * V * V }; }
  const aeroFM = (st, env, ad, srf) => { const w = st.w, Cf = coef(ad.al, ad.be, ad.M, srf.elev, srf.ail, srf.rud, -w[2], w[0], -w[1], ad.V, xcgOf(st), srf.gear), qS = ad.qb * S;
    return { F: [qS * Cf[1], -qS * Cf[2], -qS * Cf[0]], M: [qS * c * Cf[4], -qS * b * Cf[5], -qS * b * Cf[3]], Cf }; };

  // ── engine (thrust in N); pw = power level 0..100 (50 = military, 100 = full afterburner), altitude m, Mach
  const altFt = E.altFt, mN = E.machNodes, SM = E.superMach;
  function tab(T, h, M) { const hf = h / FT, m1 = Math.min(M, 1); let t = lut2(mN, altFt, T, m1, clamp(hf, 0, 50000));
    if (M > 1) { const k = T === E.idle ? 0 : T === E.mil ? SM.kMil : SM.kMaxSL + (SM.kMaxHigh - SM.kMaxSL) * clamp(hf / 36000, 0, 1);
      if (T === E.idle) t += (t - lut2(mN, altFt, T, .8, clamp(hf, 0, 50000))) / .2 * (M - 1); else t *= 1 + k * (M - 1); }
    return t; }
  function thrustOf(pw, h, M) { const lim = M > SM.Mlimit ? clamp(1 - (M - SM.Mlimit) / (SM.Mzero - SM.Mlimit), 0, 1) : 1, mil = tab(E.mil, h, M);
    const t = pw < 50 ? tab(E.idle, h, M) + (mil - tab(E.idle, h, M)) * pw * .02 : mil + (tab(E.max, h, M) - mil) * (pw - 50) * .02;
    return { T: t * LBF * (t > 0 ? lim : 1), mil: mil * LBF, max: tab(E.max, h, M) * LBF }; }
  // power lag (Stevens & Lewis after TP-1538): command from the throttle, first-order lag whose rate depends on the step size
  const tgear = th => th <= .77 ? 64.94 * th : 217.38 * th - 117.38;
  const rtau = dp => dp <= 25 ? 1 : dp >= 50 ? .1 : 1.9 - .036 * dp;
  function pdot(p3, p1) { let T, p2;
    if (p1 >= 50) { if (p3 >= 50) { T = 5; p2 = p1; } else { p2 = 60; T = rtau(p2 - p3); } }
    else { if (p3 >= 50) { T = 5; p2 = 40; } else { p2 = p1; T = rtau(p2 - p3); } }
    return T * (p2 - p3); }

  // ── mass properties: dry + fuel in tanks (point masses at x aft of the reference CG; wings ±2 m)
  const MS = J.mass, FU = J.fuel, tanks = FU.tanks.map(t => ({ ...t, y: t.name === 'wings' ? 2 : 0 }));
  const fuelJ = f => { let jx = 0, jyz = 0, mx = 0; for (const t of tanks) { const m = f * t.share; jx += m * t.y * t.y; jyz += m * t.x * t.x; mx += m * t.x; } return { jx, jyz, mx }; };
  const f0 = fuelJ(FU.start), mDry = MS.mRef - FU.start, Jd = { x: MS.Jx - f0.jx, y: MS.Jy - f0.jyz, z: MS.Jz - f0.jx - f0.jyz }, cgDry = -f0.mx / mDry;
  function massOf(f) { const k = fuelJ(f), m = mDry + f, cg = (mDry * cgDry + k.mx) / m, Jx = Jd.x + k.jx, Jy = Jd.y + k.jyz, Jz = Jd.z + k.jx + k.jyz;
    return { m, cg, I: [[Jy, 0, 0], [0, Jz, -MS.Jxz], [0, -MS.Jxz, Jx]] }; }
  const xcgOf = st => G.xcgRef + (st.cg ? st.cg[2] : 0) / c;
  const hEng = st => [0, 0, -MS.hEngine * clamp((st.eng[0] ? st.eng[0].spool : 0), 0, 1)];

  // ── ground: one point -> penetration (m) and frame data
  function groundPt(st, env, p) { const x = add(st.r, qrot(st.q, p)), xl = len(x), [la, lo] = latLonOf(toF(st.t, x)), d = R_E + env.groundOf(la, lo) - xl; return { x, xl, d }; }
  function gearForces(st, env, acc) {
    const ext = st.srf.gear >= .95, brk = Math.max(st.ctl.brake || 0, st.ctl.park ? 1 : 0);
    for (const wh of GR.wheels) {
      const P = groundPt(st, env, wh.p);
      if (!ext || P.d <= 0) { st.contact.push({ wheel: wh.name, compression: 0, force: 0 }); continue; }
      const n = mul(P.x, 1 / P.xl), vp = add(st.v, qrot(st.q, cross(st.w, wh.p))), vr = sub(vp, cross(OMEGA_I, P.x)), vn = dot(vr, n);
      const Fn = Math.max(0, wh.k * P.d - wh.c * vn * (vn > 0 ? .5 : 1));
      const gs = len(madd(vr, n, -vn)), sa = wh.steer ? (st.ctl.yaw || 0) * wh.steer * D2R * (gs < 10 ? 1 : Math.max(.25, 10 / gs)) : 0;
      let dir = qrot(st.q, [Math.sin(sa), 0, -Math.cos(sa)]); dir = madd(dir, n, -dot(dir, n)); dir = mul(dir, 1 / len(dir));
      const side = cross(n, dir), vro = dot(vr, dir), vsi = dot(vr, side), mu = GR.muRoll + (wh.brake ? GR.muBrake * brk : 0);
      const Fr = -Math.sign(vro) * Math.min(mu * Fn, GR.ct * Math.abs(vro)), Fs = -Math.sign(vsi) * Math.min(GR.muSide * Fn, GR.ct * Math.abs(vsi));
      const F = add(add(mul(n, Fn), mul(dir, Fr)), mul(side, Fs));
      acc.F = add(acc.F, F); acc.M = add(acc.M, cross(wh.p, qrot(qinv(st.q), F))); st.contact.push({ wheel: wh.name, compression: P.d, force: Fn });
    }
  }

  // ── forces module (pure function of the state: surfaces / engine / fuel change only in step())
  const forces = { name: 'aircraft (S2)', substeps: 4, forces(st, env, acc) {
    const rl = len(st.r); acc.F = madd(acc.F, st.r, -GM_E * st.m / (rl * rl * rl));   // point-mass gravity of the Earth (S1 replaces it)
    const ad = airData(st, env), a = aeroFM(st, env, ad, st.srf), qb = qinv(st.q);
    acc.F = add(acc.F, qrot(st.q, a.F)); acc.M = add(acc.M, a.M);
    const T = st.eng[0] ? st.eng[0].thrust : 0; acc.F = add(acc.F, qrot(st.q, [0, 0, -T]));
    acc.M = sub(acc.M, cross(st.w, hEng(st)));   // engine gyroscopic moment
    gearForces(st, env, acc);
    if (st.crash) { const vr = sub(st.v, cross(OMEGA_I, st.r)); acc.F = madd(acc.F, vr, -2 * st.m); acc.M = madd(acc.M, st.w, -st.I[1][1] * 2); }   // a wreck stops
    void qb; } };

  // ── stability augmentation (own, simple, labelled; NOT the F-16 FLCS): nonlinear dynamic inversion of the table model.
  // Pitch: g command (stick -> -3..+9 g, neutral = hold the flight path, with a bank correction) + integrator, AoA limiter 25 deg, -5 deg.
  // Roll: stability-axis roll-rate command (180 deg/s, less with gear down / slow / high AoA). Yaw: sideslip command from the pedals, turn
  // coordination. On the ground: direct stick -> surfaces + nose-wheel steering.
  let In = 0;
  function fcs(s, env, h) {
    const ad = airData(s, env), ctl = s.ctl, srf = s.srf, wow = s.contact.some(x => x.force > 0), cmd = {};
    const U = mul(s.r, 1 / len(s.r)), fw = qrot(s.q, [0, 0, -1]), rt = qrot(s.q, [1, 0, 0]), up = qrot(s.q, [0, 1, 0]);
    const cth = Math.sqrt(Math.max(0, 1 - dot(fw, U) ** 2)), phi = Math.atan2(-dot(rt, U), dot(up, U)), cph = Math.cos(phi), cc = dot(up, U);
    const rl = len(s.r), gI = mul(s.r, -GM_E / (rl * rl * rl)), Fa = s.acc ? s.acc.F : mul(gI, -s.m), sp = qrot(qinv(s.q), mul(sub(Fa, mul(gI, s.m)), 1 / s.m));
    const nz = sp[1] / G0, ay = qrot(qinv(s.q), mul(Fa, 1 / s.m))[0];
    s.fcs = { nz, mode: wow || ad.V < 30 ? 'direct' : 'SAS' };
    if (wow || ad.V < 30) { In = 0; cmd.elev = -ctl.pitch * CT.elev; cmd.ail = -ctl.roll * CT.ail; cmd.rud = -ctl.yaw * CT.rud;
      // rotation limiter on the runway (our convenience, labelled; tail scrape near 13.8 deg): above 10 deg pitch the elevator eases off
      const th = Math.asin(clamp(dot(fw, U), -1, 1)) / D2R; if (wow && th > 10) cmd.elev = Math.max(cmd.elev, (th - 10) * 6 - 5); }
    else {
      const V = Math.max(ad.V, 40), al = ad.al * D2R, be = ad.be * D2R, gV = G0 / V;
      const ref = cth * (cph >= .5 ? 1 / cph : cph > -.5 ? 4 * cph : 1 / cph), st = clamp(ctl.pitch, -1, 1);
      let nzC = st >= 0 ? ref + st * (FC.nzMax - ref) : ref + st * (ref - FC.nzMin); nzC = clamp(nzC, FC.nzMin, FC.nzMax);
      const aLim = ad.al > FC.alphaMax - 3 || ad.al < FC.alphaMin + 2;
      if (!aLim) In = clamp(In + (nzC - nz) * h, -2, 2);
      let qC = gV * ((nzC - cc) + (nzC - nz) + In);
      const qg = gV * (nz - cc); qC = Math.min(qC, qg + 2 * (FC.alphaMax * D2R - al)); qC = Math.max(qC, qg + 2 * (FC.alphaMin * D2R - al));
      qC = clamp(qC, -1, 1);
      const fade = clamp(ad.qb / 8000, .3, 1) * (srf.gear > .5 ? .5 : 1) * (ad.al > 15 ? clamp(1 - (ad.al - 15) / 20, .3, 1) : 1);
      const pS = clamp(ctl.roll, -1, 1) * FC.rollRate * D2R * fade, rS = ay / V - FC.kbeta * (clamp(ctl.yaw, -1, 1) * FC.betaCmd * D2R - be);
      const pB = pS * Math.cos(al) - rS * Math.sin(al), rB = pS * Math.sin(al) + rS * Math.cos(al), w = s.w;
      const wd = [FC.kq * (qC - w[0]), FC.kr * (-rB - w[1]), FC.kp * (-pB - w[2])], hE = hEng(s);
      const Md = add(mv(s.I, wd), cross(w, add(mv(s.I, w), hE)));
      const qS = Math.max(ad.qb, 50) * S, base = aeroFM(s, env, ad, srf), d = 2;
      const dC = (k, dv) => aeroFM(s, env, ad, { ...srf, [k]: srf[k] + dv }).Cf;
      const e1 = dC('elev', d), a1 = dC('ail', d), r1 = dC('rud', d), B = base.Cf;
      const sE = (e1[4] - B[4]) / d, la = (a1[3] - B[3]) / d, lr = (r1[3] - B[3]) / d, na = (a1[5] - B[5]) / d, nr = (r1[5] - B[5]) / d;
      const dCm = Md[0] / (qS * c) - B[4], dCl = -Md[2] / (qS * b) - B[3], dCn = -Md[1] / (qS * b) - B[5], det = la * nr - lr * na;
      cmd.elev = srf.elev + (Math.abs(sE) > 1e-6 ? dCm / sE : 0);
      if (Math.abs(det) > 1e-9) { cmd.ail = srf.ail + (dCl * nr - lr * dCn) / det; cmd.rud = srf.rud + (la * dCn - na * dCl) / det; } else { cmd.ail = srf.ail; cmd.rud = srf.rud; }
      s.fcs.nzC = nzC; s.fcs.qC = qC;
    }
    // actuators: first-order lag + rate limit, position limits
    const k = 1 - Math.exp(-h / CT.tau);
    for (const [n, lim] of [['elev', CT.elev], ['ail', CT.ail], ['rud', CT.rud]]) { const c0 = clamp(isFinite(cmd[n]) ? cmd[n] : 0, -lim, lim), r = CT.rate[n] * h;
      srf[n] = clamp(srf[n] + clamp((c0 - srf[n]) * k, -r, r), -lim, lim); }
    return wow;
  }

  // ── once per physics step (h = 1/120 s): pilot handles, FCS + actuators, engine, fuel, mass, crash checks
  let pw = 0;
  const step = { name: 'aircraft systems (S2)', step(s, env, h) {
    const ctl = s.ctl, wow = s.contact.some(x => x.force > 0);
    if (ctl.park && (ctl.throttle > .05 || ctl.brake)) ctl.park = false;
    if (wow && !ctl.gear) ctl.gear = 1;   // weight on wheels: the gear handle stays down
    s.srf.gear = clamp(s.srf.gear + clamp((ctl.gear ? 1 : 0) - s.srf.gear, -h / GR.retract, h / GR.retract), 0, 1);
    if (s.crash) { ctl.throttle = 0; }
    fcs(s, env, h);
    const fuel = s.sys.fuel[0], on = fuel > 0 && !s.crash, p1 = on ? tgear(clamp(ctl.throttle, 0, 1)) : 0;
    pw = clamp(pw + (on ? pdot(pw, p1) : -pw * .5) * h, 0, 100);
    const ad = airData(s, env), th = thrustOf(pw, env.altMSL, ad.M), T = on ? th.T : 0, tf = (1 + E.tsfc.machFactor * ad.M) * Math.sqrt(env.air.T / 288.15) / (G0 * 3600);
    const inc = (E.tsfc.ab * th.max - E.tsfc.mil * th.mil) / Math.max(1, th.max - th.mil);
    const ff = on ? Math.max(E.tsfc.idleKgS, (pw < 50 ? Math.max(0, T) * E.tsfc.mil : th.mil * E.tsfc.mil + (T - th.mil) * inc) * tf) : 0;
    s.eng[0] = { n1: null, n2: pw < 50 ? 65 + .7 * pw : 100, spool: on ? .6 + .4 * Math.min(pw, 50) / 50 : 0, thrust: T, ff, egt: null, on, power: pw, ab: pw > 50 };
    s.sys.fuel[0] = Math.max(0, fuel - ff * h); const mp = massOf(s.sys.fuel[0]); s.m = mp.m; s.I = mp.I; s.cg = [0, 0, mp.cg];
    // crash: a hard point in the ground, or a gear strut past its stroke
    if (!s.crash) { for (const p of GR.hard) if (groundPt(s, env, p).d > .15) { s.crash = 'structure hit the ground'; break; }
      if (!s.crash && s.contact.some(x => x.compression > GR.stroke)) s.crash = 'gear collapsed';
      if (!s.crash && s.srf.gear < .95 && GR.wheels.some(w => groundPt(s, env, w.p).d > 0)) s.crash = 'gear not down'; }
  }, hud(s, env, hud) { const ad = airData(s, env), e = s.eng[0] || {};
    Object.assign(hud, { ias: casOf(ad.M, env.air.p), mach: ad.M, aoa: ad.al, beta: ad.be, fuel: s.sys.fuel[0], mass: s.m, eng: s.eng, power: e.power, ab: !!e.ab, thrust: e.thrust, ff: e.ff,
      gear: s.srf.gear, park: !!s.ctl.park, crash: s.crash || null, stall: ad.al > FC.alphaMax + 2 && ad.V > 20, fcs: s.fcs ? s.fcs.mode : '', srf: s.srf, air: env.air }); } };

  const mp = massOf(FU.start);
  const def = { name: J.name, m: mp.m, I: mp.I, cg: [0, 0, mp.cg], size: J.size, rest: J.rest, views: J.views, json: J,
    gear: { points: GR.wheels.map(w => w.p) },
    init(s) { s.sys.fuel = [FU.start]; s.ctl.park = true; s.ctl.throttle = 0; s.crash = null; pw = 0; In = 0; s.srf.elev = s.srf.ail = s.srf.rud = 0; s.srf.gear = 1; s.ctl.gear = 1; } };
  return { def, mods: [forces, step], coef, thrustOf, massOf };
}

export async function loadAircraft(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return createAircraft(await r.json()); }
