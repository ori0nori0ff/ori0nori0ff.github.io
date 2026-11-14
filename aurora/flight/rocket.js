/* Rockets (docs/flight-plan.md, step S5): a multi-stage launcher as a 6-DOF craft of flight/core.js, from the pad to orbit, and a capsule from
   orbit back to the ground. Own code; methods from standard texts (rocket equation, Sutton-Graves heating, Allen-Eggers entry, Jorgensen
   slender-body normal force, NASA TR R-474). No GPL code.
   - Stages (flight/rockets/*.json): dry + propellant mass, mass flow from vacuum thrust / (Isp_vac g0), thrust = mdot g0 Isp(p) with
     Isp(p) = Isp_vac - (Isp_vac - Isp_sl) p / p0 (= F_vac - p A_exit), gimballed thrust, staging (the spent stage keeps flying as a point
     mass with drag), fairing / escape tower jettison, mass, CG and inertia from the propellant level. Body origin = the current CG (moved
     with the state when the CG moves inside the body).
   - Aerodynamics: axial drag vs Mach (table), normal force after Jorgensen (potential + cross-flow), dynamic pressure and max-Q, stagnation
     heating (Sutton-Graves) for the HUD and the plasma glow; capsule = blunt ballistic body + drogue / main parachutes (parachute landing).
   - Guidance (labelled simple autopilot): vertical rise, pitch kick, gravity turn (zero angle of attack) through stage 1, then closed-loop
     insertion: the vertical acceleration A = 6 (h_t - h) / T^2 - 4 v_r / T (linear acceleration profile that reaches h_t with v_r = 0 at
     the time to go T, from the rocket equation over the remaining stages), thrust pitch from A + g - v_h^2 / r, heading for the target
     inclination; engine cut when the orbital energy reaches the target circular orbit. What PEG-class guidance adds: the optimal (linear
     tangent) thrust direction, gravity / thrust integrals over the arc, plane targeting with yaw steering, coast phases, tail-off.
   Body axes: -z = nose (up on the pad), +y = downrange on the pad, +x = right. Frame I, SI units (see the plan's Interfaces). */
import { R_E, toF, fromF, qIF, qFromBasis, OMEGA_I, latLonOf, groundContact } from './core.js?v=47034b95';
import { atmosphere } from './atmos.js?v=7ee6d1db';

const G0 = 9.80665, D2R = Math.PI / 180, P0 = 101325, MU = 3.986004418e14, KSG = 1.7415e-4;   // KSG: Sutton-Graves constant (Earth air, SI)
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a); return l > 0 ? mul(a, 1 / l) : [0, 0, 0]; }, madd = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const qconj = q => [-q[0], -q[1], -q[2], q[3]];
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qrot = (q, v) => { const t = mul(cross(q, v), 2); return add(add(v, mul(t, q[3])), cross(q, t)); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerpTab = (T, x) => { if (x <= T[0][0]) return T[0][1]; for (let i = 1; i < T.length; i++) if (x <= T[i][0]) { const [x0, y0] = T[i - 1], [x1, y1] = T[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return T[T.length - 1][1]; };
const enu = (lat, lon) => [[-Math.sin(lon), 0, -Math.cos(lon)], [-Math.sin(lat) * Math.cos(lon), Math.cos(lat), Math.sin(lat) * Math.sin(lon)], [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)]];

// ── launch pads. Coordinates: the Wikipedia articles of each complex (GeoHack links), quoted from memory, to verify (± ~100 m). inc = default
// target inclination (the lowest a due-east launch gives, or the usual one).
export const PADS = {
  lc39a: { name: 'Kennedy LC-39A', lat: 28.60839, lon: -80.60433, inc: 28.6, src: 'Wikipedia "Launch Complex 39A": 28°36′30″N 80°36′16″W' },
  slc40: { name: 'Cape Canaveral SLC-40', lat: 28.56194, lon: -80.57722, inc: 28.6, src: 'Wikipedia "Cape Canaveral Space Launch Complex 40": 28°33′43″N 80°34′38″W' },
  baikonur: { name: 'Baikonur Site 1/5', lat: 45.92028, lon: 63.34222, inc: 51.6, src: 'Wikipedia "Gagarin\'s Start": 45°55′13″N 63°20′32″E' },
  kourou: { name: 'Kourou ELA-3', lat: 5.23917, lon: -52.76833, inc: 6, src: 'Wikipedia "ELA-3": 5°14′21″N 52°46′06″W' } };
export const ROCKETS = { falcon9: 'rockets/falcon9.json', saturn5: 'rockets/saturn5.json' };
export async function loadRocket(name) { const u = new URL(ROCKETS[name] || ROCKETS.falcon9, import.meta.url); const r = await fetch(u); if (!r.ok) throw new Error('rocket ' + r.status); return r.json(); }

// launch azimuth (rad, from north, relative to the turning ground) for an inclination from a latitude: inertial azimuth sin Az = cos i / cos lat,
// minus the ground's eastward speed against the target orbital speed
export function launchAz(lat, inc, vOrb = 7790) { const si = clamp(Math.cos(inc * D2R) / Math.cos(lat), -1, 1), azI = Math.asin(si), vr = 465.1 * Math.cos(lat);
  return Math.atan2(vOrb * Math.sin(azI) - vr, vOrb * Math.cos(azI)); }

// ── the rocket: def for core + force / step / hud module. R = json; o = { pad (PADS key), inc, alt (target, m over the drawn sea), F (api.flight,
// for the pad ground), entry: { alt, v, gamma } = start as a capsule at the entry interface, wait (ms the pad height must stay the same) }
export function createRocket(R, ctx, o = {}) {
  const pad = PADS[o.pad] || PADS.slc40, inc = o.inc != null ? o.inc : pad.inc, altT = o.alt || 200e3, rT = R_E + 400 + altT;
  const ST = R.stages, NS = ST.length, CAP = R.capsule, AER = R.aero, GU = R.guidance;
  // stations along the stack (m up from the base of stage 1)
  let x = 0; for (const s of ST) { s.x0 = x; x += s.len; s.mdot = s.thrustVac / (s.ispVac * G0); }
  const PL = R.payload, FR = R.fairing; PL.x0 = x; const xTopStages = x; x += PL.len;
  if (FR) FR.x0 = FR.tower ? x : xTopStages; const L0 = FR && FR.tower ? x + FR.len : Math.max(x, FR ? FR.x0 + FR.len : x);
  const K = { R, pad, inc, altT, stage: 0, fairing: !!FR, mode: o.entry ? 'capsule' : 'stack', clamped: !o.entry, prop: ST.map(s => s.prop), engOn: false, thr: 0, nOn: 0,
    tIgn: null, tLift: null, tNext: null, phase: o.entry ? 'entry' : 'pad', auto: true, go: false, xc: 0, len: L0, dia: ST[0].dia, gx: 0, gy: 0, F: 0, Fdir: [0, 0, -1], Mrcs: [0, 0, 0],
    maxQ: { q: 0, alt: 0, t: 0, mach: 0 }, loss: { ideal: 0, grav: 0, drag: 0, steer: 0, v0: 0 }, heat: 0, heatMax: { q: 0, alt: 0, t: 0 }, gMax: { g: 0, alt: 0, t: 0 }, gNow: 0,
    chute: 0, chuteK: 0, spent: [], events: [], ins: null, touch: null, kickDir: null, dLast: null, az: launchAz(pad.lat * D2R, inc), Maero: [0, 0, 0], Faero: [0, 0, 0], ent: null,
    deorbit: false, onSep: null, onFairing: null, onCapsule: null };
  const T = () => K.tLift != null && K.t != null ? (K.t - K.tLift) / 1e3 : 0;
  const ev = (txt, s) => { K.events.push({ t: K.t, T: T(), txt, alt: s ? len(s.r) - R_E - 400 : 0 }); if (K.events.length > 40) K.events.shift(); };

  // mass properties of what is attached: { m, xc (station), It (transverse, about the CG), Ir (roll), xb (base station), dia }
  function massProps() { const it = [];
    const solid = (m, x0, l, r) => it.push({ m, xm: x0 + l / 2, It: m * (3 * r * r + l * l) / 12, Ir: m * r * r / 2 });
    const shell = (m, x0, l, r) => it.push({ m, xm: x0 + l / 2, It: m * (r * r / 2 + l * l / 12), Ir: m * r * r });
    if (K.mode === 'capsule') { const l = CAP.dia * .8; solid(CAP.mass, 0, l, CAP.dia / 2); K.len = l; K.dia = CAP.dia; K.xb = 0; }
    else { for (let i = K.stage; i < NS; i++) { const s = ST[i], r = s.dia / 2; shell(s.dry, s.x0, s.len, r); const f = K.prop[i] / s.prop; if (K.prop[i] > 0) solid(K.prop[i], s.x0 + .05 * s.len, Math.max(.05, f * .85 * s.len), r * .98); }
      solid(PL.mass, PL.x0, PL.len, PL.dia / 2); if (K.fairing) shell(FR.mass, FR.x0, FR.len, FR.dia / 2);
      K.xb = ST[Math.min(K.stage, NS - 1)].x0; K.len = L0 - K.xb; K.dia = ST[Math.min(K.stage, NS - 1)].dia; }
    let m = 0, mx = 0; for (const a of it) { m += a.m; mx += a.m * a.xm; } const xc = mx / m; let It = 0, Ir = 0;
    for (const a of it) { It += a.It + a.m * (a.xm - xc) ** 2; Ir += a.Ir; } return { m, xc, It, Ir }; }

  // the craft definition for core (gear = 4 contact points round the base; changes with the stack)
  const gear = { points: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], k: 1, c: 1, ct: 1, mu: .8, muBrake: .8 };
  const def = { name: R.name, m: 1, I: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], cg: [0, 0, 0], size: [3, 3, 40], gear, rest: 0, views: null,
    init(s) { s.sys.fuel = K.prop; s.eng = [{ thrust: 0, ff: 0, on: false }]; s.ctl.brake = 0; s.ctl.throttle = 0; applyMass(s, true); } };
  // set m, I (new array -> core recomputes the inverse), contact points; move the state so the body origin stays on the CG
  function applyMass(s, first) { const P = massProps();
    if (!first && s.r && Math.abs(P.xc - K.xc) > 1e-9) { const d = [0, 0, -(P.xc - K.xc)]; s.r = add(s.r, qrot(s.q, d)); s.v = add(s.v, qrot(s.q, cross(s.w, d))); }
    K.xc = P.xc; s.m = def.m = P.m; s.I = def.I = [[P.It, 0, 0], [0, P.It, 0], [0, 0, P.Ir]];
    const rb = K.clamped ? Math.max(K.dia * .45, K.len * .2) : K.dia * .45, zb = K.xc - K.xb;   // hold-down clamps on the launch mount: a wide base until liftoff gear.points[0] = [rb, 0, zb]; gear.points[1] = [-rb, 0, zb]; gear.points[2] = [0, rb, zb]; gear.points[3] = [0, -rb, zb];
    gear.k = P.m * G0 / (4 * .05); gear.c = .8 * 2 * Math.sqrt(gear.k * P.m / 4); gear.ct = P.m * 60; def.size = [K.dia, K.dia, K.len]; }

  // ── start: on the pad (waits until the pad's height stays the same for o.wait ms) or at the entry interface
  let gSeen = null, gSince = 0;
  function start(t) {
    const la = pad.lat * D2R, lo = pad.lon * D2R, [E, N, U] = enu(la, lo);
    if (o.entry) { const e = o.entry, r0 = R_E + 400 + e.alt, gm = (e.gamma || -1.5) * D2R, az = launchAz(la, inc), h = add(mul(N, Math.cos(az)), mul(E, Math.sin(az)));
      const f = mul(U, r0), vf = add(mul(h, e.v * Math.cos(gm)), mul(U, e.v * Math.sin(gm))), r = fromF(t, f), v = fromF(t, vf);   // e.v = inertial speed, direction in the ground frame (estimate of a plane)
      const Z = unit(v), Y0 = unit(sub(r, mul(Z, dot(r, Z)))), X = cross(Y0, Z);   // heat shield (+z) forward along v
      K.t = t; applyMass({ q: [0, 0, 0, 1] }, true); return { ref: 'Earth', r, v, q: qFromBasis(X, Y0, Z), w: [0, 0, 0] }; }
    const g = o.F ? o.F.groundAt(la, lo) : 0; if (g == null) return null;
    if ((o.wait || 0) > 0) { if (g !== gSeen) { gSeen = g; gSince = performance.now(); return null; } if (performance.now() - gSince < o.wait) return null; }
    K.padG = g; const Y = add(mul(N, Math.cos(K.az)), mul(E, Math.sin(K.az))), Z = mul(U, -1), X = cross(Y, Z), qf = qFromBasis(X, Y, Z);
    const r = fromF(t, mul(U, R_E + g + 400 + K.xc - K.xb + .02)), q = qmul(qconj(qIF(t)), qf);
    K.padF = { U, E, N, Y, X, g }; K.t = t;
    return { ref: 'Earth', r, v: cross(OMEGA_I, r), q, w: qrot(qconj(q), OMEGA_I) }; }

  // ── aerodynamics in body axes: returns { F (I), M (body), D (drag along -vAir, N) }
  function aero(s, env) { const rho = env.air.rho; if (!(rho > 0)) return null; const vA = env.vAir, V = len(vA); if (V < .5) return null;
    const vb = qrot(qconj(s.q), vA), q = .5 * rho * V * V, mach = V / env.air.a;
    if (K.mode === 'capsule') { const S = Math.PI * CAP.dia * CAP.dia / 4; let cdA = CAP.cd * S;
      if (K.chute) { const c = K.chute === 2 ? CAP.main : CAP.drogue; cdA += c.cd * c.area * K.chuteK; }
      const Fb = mul(vb, -q * cdA / V); return { F: qrot(s.q, Fb), M: [0, 0, 0], D: q * cdA, q, mach }; }
    const S = Math.PI * K.dia * K.dia / 4, cA = lerpTab(AER.cd, mach), u = mul(vb, 1 / V), ca = -u[2], al = Math.acos(clamp(ca, -1, 1));
    const ax = [0, 0, ca >= 0 ? q * S * cA * ca : q * S * cA * ca];   // axial force, along +z when flying nose first
    const cr = Math.hypot(u[0], u[1]); let M = [0, 0, 0], Fb = ax;
    if (cr > 1e-6) { const nb = [-u[0] / cr, -u[1] / cr, 0], s2 = Math.sin(2 * al) * Math.cos(al / 2), si = Math.sin(al), Ap = K.dia * K.len;
      const Np = q * S * s2, Nc = q * AER.eta * AER.cdc * Ap * si * si;   // Jorgensen: potential (nose) + cross-flow (body)
      const xTop = K.xb + K.len, zP = K.xc - (xTop - AER.noseLen * 2 / 3), zC = K.xc - (K.xb + K.len / 2);   // body z of the two centres (station x -> z = xc - x)
      const FP = mul(nb, Np), FC = mul(nb, Nc); Fb = add(add(ax, FP), FC); M = add(cross([0, 0, zP], FP), cross([0, 0, zC], FC)); }
    const FI = qrot(s.q, Fb); return { F: FI, M, D: -dot(FI, unit(vA)), q, mach }; }

  // ── guidance target (unit vector in I for the nose, body -z) and throttle; null = keep the last direction
  function guide(s, env) { const r = s.r, rl = len(r), up = mul(r, 1 / rl), v = s.v, vA = env.vAir;
    switch (K.phase) {
      case 'pad': case 'ign': return { d: up, thr: K.phase === 'ign' ? 1 : 0 };
      case 'rise': if (dot(vA, up) > GU.kickV) { K.phase = 'kick'; K.tKick = K.t; ev('pitch kick', s); } return { d: up, thr: 1 };
      case 'kick': { const a = GU.kick * D2R * clamp((K.t - K.tKick) / 1e3 / GU.kickT, 0, 1), hz = fromF(K.t, K.padF.Y);   // downrange (the pad's +y, now in I)
        const hh = unit(sub(hz, mul(up, dot(hz, up)))), d = add(mul(up, Math.cos(a)), mul(hh, Math.sin(a)));
        // then hold that attitude until the air-relative velocity has tilted to within 1° of the nose (or 20 s more): gravity turn from there
        const dt = (K.t - K.tKick) / 1e3; if (dt > GU.kickT && (dot(unit(vA), up) - dot(d, up) < Math.sin(1 * D2R) * Math.cos(a) || dt > GU.kickT + 20)) { K.phase = 'turn'; ev('gravity turn', s); }
        return { d, thr: 1 }; }
      case 'turn': { if (K.stage >= GU.closedFrom && K.engOn) { K.phase = 'closed'; ev('closed-loop guidance', s); }
        // gravity turn (nose along the air-relative velocity), with a floor on the climb angle (30° below 30 km, then 15°): a kick a bit too large
        // must not fly the rocket into the ground (the turn is very sensitive to the kick)
        const u = unit(vA), sg = dot(u, up), fl = Math.sin((env.altMSL < 30e3 ? 30 : 15) * D2R);
        if (sg >= fl) return { d: u, thr: 1 }; const hh = unit(sub(u, mul(up, sg))); return { d: add(mul(up, fl), mul(hh, Math.cos(Math.asin(fl)))), thr: 1 }; }
      case 'closed': { const vr = dot(v, up), vh = sub(v, mul(up, vr)), vhl = len(vh), g = MU / (rl * rl), vc = Math.sqrt(MU / rT);
        if (dot(v, v) / 2 - MU / rl >= -MU / (2 * rT)) { K.phase = 'orbit'; ev('engine cut-off: in orbit', s); return { d: unit(v), thr: 0 }; }
        const Tg = tgo(Math.hypot(vc - vhl, vr), s), F = K.F > 0 ? K.F : thrustNow(s, env), aT = F / s.m;
        let sth = K.sth != null ? K.sth : 0;
        if (Tg > 4 && aT > 0) { const A = 6 * (rT - rl) / (Tg * Tg) - 4 * vr / Tg; sth = clamp((A + g - vhl * vhl / rl) / aT, -.5, .95); K.sth = sth; }
        // heading: the horizontal direction of the target plane (ascending branch nearest the current motion)
        const [la] = latLonOf(toF(K.t, r)), si = Math.cos(inc * D2R) / Math.cos(la); let hd = unit(vh);
        if (Math.abs(si) <= 1) { const f = toF(K.t, r), [lat, lon] = latLonOf(f), [E, N] = enu(lat, lon), az = Math.asin(si);
          const c1 = fromF(K.t, add(mul(N, Math.cos(az)), mul(E, Math.sin(az)))), c2 = fromF(K.t, add(mul(N, -Math.cos(az)), mul(E, Math.sin(az))));
          hd = dot(c1, vh) >= dot(c2, vh) ? c1 : c2; }
        return { d: add(mul(up, sth), mul(hd, Math.sqrt(1 - sth * sth))), thr: 1 }; }
      case 'orbit': return { d: unit(v), thr: 0 };
      case 'deorbit': { const d = mul(unit(v), -1), fw = qrot(s.q, [0, 0, -1]), el = elems(s), aligned = dot(fw, d) > Math.cos(5 * D2R);
        if (el.peri - R_E - 400 <= CAP.deorbitPeri) { ev('deorbit burn done', s); toCapsule(s); return { d: mul(unit(env.vAir), -1), thr: 0 }; }
        return { d, thr: aligned ? 1 : 0 }; }
      case 'entry': case 'chute': case 'landed': return { d: mul(unit(vA), -1), thr: 0 };   // heat shield (+z) into the flow
    } return { d: unit(v), thr: 0 }; }
  const elems = s => { const rl = len(s.r), v2 = dot(s.v, s.v), a = 1 / (2 / rl - v2 / MU), h = len(cross(s.r, s.v)), e = Math.sqrt(Math.max(0, 1 - h * h / (MU * a))); return { a, e, peri: a * (1 - e), apo: a * (1 + e) }; };
  // time to go for a velocity gain dv over the remaining burning stages (rocket equation, vacuum Isp, full throttle, staging gaps included)
  function tgo(dv, s) { let m = s.m, t = 0; for (let i = K.stage; i < NS && dv > 0; i++) { const st = ST[i], ve = st.ispVac * G0, mp = K.prop[i], md = st.mdot * (K.nOn && i === K.stage ? K.nOn / st.engines : 1);
      if (mp <= 0 || md <= 0) continue; const dvs = ve * Math.log(m / (m - mp));
      if (dv <= dvs) return t + m / md * (1 - Math.exp(-dv / ve)); dv -= dvs; t += mp / md + (st.sepDelay || 0) + (ST[i + 1] ? ST[i + 1].ignDelay || 0 : 0); m -= mp + st.dry; }
    return t + 1e3; }
  const ispOf = (st, p) => st.ispVac - (st.ispVac - st.ispSL) * clamp(p / P0, 0, 1.2);
  const thrustNow = (s, env) => { const st = ST[K.stage]; return st ? st.mdot * G0 * ispOf(st, env.air.p) : 0; };

  // ── events
  function separate(s) { const st = ST[K.stage], P0m = massProps(), x0 = K.xc;   // spent stage: a point mass with drag from where its CG is
    const xm = st.x0 + st.len / 2, rS = add(s.r, qrot(s.q, [0, 0, -(xm - x0)])), cdA = 1.0 * st.dia * st.len;   // broadside tumbling, cd ~1 (estimate)
    K.spent.push({ name: st.name, r: rS, v: s.v.slice(), q: s.q.slice(), m: st.dry + K.prop[K.stage], cdA, idx: K.stage, t: s.t, alive: true, xm });
    ev(st.name + ' separation', s); K.prop[K.stage] = 0; K.stage++; K.engOn = false; K.F = 0; applyMass(s); if (K.onSep) K.onSep(K.spent[K.spent.length - 1]);
    K.tNext = s.t + (ST[K.stage] ? (ST[K.stage].ignDelay || 0) * 1e3 : 0); }
  function jettisonFairing(s) { K.fairing = false; const xm = FR.x0 + FR.len / 2;
    for (const sd of FR.tower ? [0] : [-1, 1]) { const off = qrot(s.q, [sd * FR.dia * .3, 0, -(xm - K.xc)]), vOut = qrot(s.q, [sd * 2, 0, FR.tower ? -15 : 0]);
      K.spent.push({ name: FR.tower ? 'escape tower' : 'fairing', r: add(s.r, off), v: add(s.v, vOut), q: s.q.slice(), m: FR.mass / (FR.tower ? 1 : 2), cdA: FR.dia * FR.len * .5, idx: 'fairing', side: sd, t: s.t, alive: true, xm }); }
    ev(FR.tower ? 'escape tower jettison' : 'fairing jettison', s); applyMass(s); if (K.onFairing) K.onFairing(); }
  function toCapsule(s) { const xm = K.xc;   // everything else becomes one spent body; the capsule sits at the top of the payload
    K.spent.push({ name: 'upper stage + service module', r: s.r.slice(), v: s.v.slice(), q: s.q.slice(), m: s.m - CAP.mass, cdA: K.dia * K.len * .8, idx: 'rest', t: s.t, alive: true, xm });
    const xCap = PL.x0 + PL.len - CAP.dia * .4; s.r = add(s.r, qrot(s.q, [0, 0, -(xCap - xm)])); s.v = add(s.v, qrot(s.q, [0, 0, -1]));   // 1 m/s push away (estimate)
    K.mode = 'capsule'; K.stage = NS; K.engOn = false; K.F = 0; K.fairing = false; K.phase = 'entry'; K.xc = CAP.dia * .4; applyMass(s, true); ev('capsule separation', s); if (K.onCapsule) K.onCapsule(); }

  // ── spent bodies: point masses with gravity (Earth, point) + drag, semi-implicit Euler at the physics step; gone at the ground
  function spentStep(t, h) { for (const b of K.spent) { if (!b.alive) continue; const rl = len(b.r), alt = rl - R_E - 400;
      if (alt < (K.padG || 0) || t - b.t > 3600e3) { b.alive = false; continue; }
      let a = mul(b.r, -MU / (rl * rl * rl)); if (alt < 150e3) { const air = atmosphere(alt), va = sub(b.v, cross(OMEGA_I, b.r)), V = len(va); if (V > 0) a = madd(a, va, -.5 * air.rho * V * b.cdA / b.m); }
      b.v = madd(b.v, a, h); b.r = madd(b.r, b.v, h); } }

  // ── attitude: desired body rates from the target (P), torques (D), gimbal for the engines, RCS when the engines are off
  const KP = .6, KD = 2.5, WMAX = 4 * D2R;
  function attitude(s, d, man) { const I = [s.I[0][0], s.I[1][1], s.I[2][2]];
    let wd = [0, 0, 0];
    if (man) wd = [s.ctl.pitch * WMAX, -s.ctl.yaw * WMAX, -s.ctl.roll * WMAX];
    else if (d) { const tb = qrot(qconj(s.q), d), sn = Math.hypot(tb[0], tb[1]), ang = Math.atan2(sn, -tb[2]);
      wd = sn > 1e-9 ? [tb[1] / sn * ang * KP, -tb[0] / sn * ang * KP, 0] : (tb[2] > 0 ? [WMAX, 0, 0] : [0, 0, 0]); const wl = Math.hypot(wd[0], wd[1]); if (wl > WMAX) wd = mul(wd, WMAX / wl); }
    const Mw = [0, 1, 2].map(i => I[i] * KD * (wd[i] - s.w[i]) - (K.Maero[i] || 0));   // aero moment cancelled (feed-forward)
    K.gx = K.gy = 0; K.Mrcs = [0, 0, 0];
    if (K.engOn && K.F > 0 && K.mode === 'stack') { const st = ST[K.stage], l = K.xc - K.xb, gm = st.gimbal * D2R, FL = K.F * Math.max(l, 1);
      K.gx = Math.asin(clamp(-Mw[0] / FL, -Math.sin(gm), Math.sin(gm))); K.gy = Math.asin(clamp(Mw[1] / FL, -Math.sin(gm), Math.sin(gm)));
      const rollA = K.F * K.dia * .25 * Math.sin(gm); K.Mrcs[2] = clamp(Mw[2], -rollA, rollA); }
    else { const rc = K.mode === 'capsule' ? CAP.rcs : R.rcs; K.Mrcs = Mw.map(m => clamp(m, -rc, rc)); }
    K.Fdir = [Math.sin(K.gy), Math.sin(K.gx), -Math.cos(K.gx) * Math.cos(K.gy)]; }

  const mod = { name: 'rocket (S5)', K, def, start,
    step(s, env, h) { K.t = s.t; const st = ST[K.stage], c = s.ctl;
      const man = Math.abs(c.pitch) + Math.abs(c.roll) + Math.abs(c.yaw) > .05;
      if (man && K.auto && K.phase !== 'pad') { K.auto = false; ev('manual control', s); }
      if (K.go && K.phase === 'pad') { K.phase = 'ign'; K.tIgn = s.t; K.engOn = true; K.loss.v0 = len(s.v); ev('ignition', s); }
      if (K.phase === 'ign' && s.t - K.tIgn >= (R.holdDown || 2) * 1e3) { K.clamped = false; K.tLift = s.t; K.phase = K.auto ? 'rise' : 'manual'; ev('liftoff', s); }
      // guidance / manual
      const g = K.auto || K.mode === 'capsule' ? guide(s, env) : null; if (g && g.d) K.dLast = g.d;   // the capsule always points its shield into the flow (RCS)
      if (K.auto) c.throttle = g ? g.thr : 0;
      // stage logic: burnout -> separation after sepDelay -> next ignition after ignDelay
      if (K.mode === 'stack') {
        if (st && K.engOn && K.prop[K.stage] <= 0) { K.engOn = false; ev(st.name + ' engine cut-off (empty)', s); K.tSep = s.t + (st.sepDelay || 0) * 1e3; }
        if (K.tSep != null && s.t >= K.tSep && K.stage < NS - 1) { K.tSep = null; separate(s); }
        if (K.manualStage) { K.manualStage = false; if (K.stage < NS - 1) { if (K.engOn) ev(st.name + ' engine cut-off', s); K.engOn = false; separate(s); } }
        if (!K.engOn && K.tNext != null && s.t >= K.tNext && K.prop[K.stage] > 0) { K.tNext = null; K.engOn = true; ev(ST[K.stage].name + ' ignition', s); }
        if (K.phase === 'deorbit' && !K.engOn && K.prop[K.stage] > 0 && K.stage === NS - 1) K.engOn = true;
        if (K.fairing && ((FR.jettisonT && T() >= FR.jettisonT) || (!FR.jettisonT && env.altMSL > 60e3 && .5 * env.air.rho * Math.pow(env.aero.vTas, 3) < 1135))) jettisonFairing(s); }
      // engines: throttle (limits), engine-out times, Isp(p), mass flow
      const sNow = ST[K.stage]; K.F = 0; K.nOn = 0;
      if (K.mode === 'stack' && sNow && K.engOn && K.prop[K.stage] > 0) {
        let thr = clamp(c.throttle, 0, 1); if (thr > 0) thr = clamp(thr, sNow.throttle[0], sNow.throttle[1]);
        if (K.auto && GU.gMax && sNow.throttle[0] < 1 && thr > 0) { const Fm = sNow.mdot * G0 * ispOf(sNow, env.air.p); thr = clamp(Math.min(thr, GU.gMax * G0 * s.m / Fm), sNow.throttle[0], 1); }
        let n = sNow.engines; if (sNow.coeT && K.tLift != null && T() >= sNow.coeT) { n = sNow.engines - 1; if (!K['coe' + K.stage]) { K['coe' + K.stage] = 1; ev(sNow.name + ' centre engine cut-off', s); } }
        const md = thr > 0 ? sNow.mdot * thr * n / sNow.engines : 0, burn = Math.min(K.prop[K.stage], md * h);
        K.prop[K.stage] -= burn; K.nOn = thr > 0 ? n : 0; K.thr = thr; K.F = md > 0 ? burn / h * G0 * ispOf(sNow, env.air.p) : 0;
        s.eng[0].thrust = K.F; s.eng[0].ff = burn / h; s.eng[0].on = true; applyMass(s); }
      else { s.eng[0].thrust = 0; s.eng[0].ff = 0; K.thr = 0; }
      // capsule: parachutes (drogue then main, 3 s filling), landing
      if (K.mode === 'capsule') { const V = env.aero.vTas;
        if (K.chute === 0 && env.altMSL < CAP.drogue.alt && V < CAP.drogue.vMax) { K.chute = 1; K.chuteK = 0; K.phase = 'chute'; ev('drogue parachute', s); }
        if (K.chute === 1 && env.altMSL < CAP.main.alt && V < CAP.main.vMax) { K.chute = 2; K.chuteK = 0; ev('main parachute', s); }
        if (K.chute) K.chuteK = Math.min(1, K.chuteK + h / 3);
        if (!K.touch && env.alt - K.xc < .3) { const vr = sub(s.v, cross(OMEGA_I, s.r)); K.touch = { v: len(vr), vs: dot(vr, env.nUp), t: s.t }; ev('touchdown at ' + K.touch.v.toFixed(1) + ' m/s', s); K.phase = 'landed'; } }
      // aero now (for the feed-forward and the numbers), attitude
      const A = aero(s, env); K.Maero = A ? A.M : [0, 0, 0]; K.Faero = A ? A.F : [0, 0, 0];
      attitude(s, K.auto || K.mode === 'capsule' ? (g ? g.d : K.dLast) : null, !K.auto && K.mode !== 'capsule');
      // numbers: max-Q, heating, g, losses (inertial speed: d|v|/dt = (T + D + m g) · v / m)
      const q = env.aero.qbar, alt = env.altMSL; K.qNow = q; K.mach = env.aero.mach;
      if (K.tLift != null && q > K.maxQ.q && K.mode === 'stack') K.maxQ = { q, alt, t: T(), mach: env.aero.mach };
      K.heat = KSG * Math.sqrt(env.air.rho / (K.mode === 'capsule' ? CAP.noseR : 1)) * Math.pow(env.aero.vTas, 3);
      if (K.heat > K.heatMax.q) K.heatMax = { q: K.heat, alt, t: s.t, v: env.aero.vTas };
      const aNG = add(mul(qrot(s.q, K.Fdir), K.F), K.Faero), gN = len(aNG) / (s.m * G0); K.gNow = gN; if (K.tLift != null || K.mode === 'capsule') if (gN > K.gMax.g && !s.onGround) K.gMax = { g: gN, alt, t: s.t, v: env.aero.vTas };
      if (K.tLift != null && K.mode === 'stack' && K.phase !== 'orbit') { const vh = unit(s.v), Tv = mul(qrot(s.q, K.Fdir), K.F / s.m), gv = s.acc && s.acc.g ? s.acc.g : mul(s.r, -MU / len(s.r) ** 3);
        K.loss.ideal += len(Tv) * h; K.loss.steer += (len(Tv) - dot(Tv, vh)) * h; K.loss.drag += -dot(K.Faero, vh) / s.m * h; K.loss.grav += -dot(gv, vh) * h; }
      if (K.phase === 'orbit' && !K.ins) { const e = elems(s); K.ins = { T: T(), apo: e.apo - R_E - 400, peri: e.peri - R_E - 400, m: s.m, prop: K.prop[K.stage], v: len(s.v) }; }
      ctx.sas = K.auto ? K.phase : 'manual';
      spentStep(s.t, h); },
    forces(s, env, acc) {
      if (K.F > 0) { const Fb = mul(K.Fdir, K.F); if (!K.clamped) acc.F = add(acc.F, qrot(s.q, Fb)); acc.M = add(acc.M, cross([0, 0, K.xc - K.xb], Fb)); }
      acc.M = add(acc.M, K.Mrcs);
      const A = aero(s, env); if (A) { acc.F = add(acc.F, A.F); acc.M = add(acc.M, A.M); } },
    hud(s, env, hud) { let dv = 0, m = s.m; if (K.mode === 'stack') for (let i = K.stage; i < NS; i++) { const st = ST[i]; dv += st.ispVac * G0 * Math.log(m / (m - K.prop[i])); m -= K.prop[i] + st.dry; }
      hud.dvLeft = dv; hud.throttle = K.thr; },
    launch() { K.go = true; }, stageNow() { K.manualStage = true; },
    deorbitLand() { if (K.mode !== 'stack' || K.phase === 'pad' || K.stage < NS - 1) return 'Only from orbit, on the last stage.';
      if (K.prop[NS - 1] <= 0) return 'No propellant left for the deorbit burn.';
      K.auto = true; K.phase = 'deorbit'; ev('deorbit: turning retrograde', null); return ''; } };
  applyMass({ q: [0, 0, 0, 1] }, true);
  return mod;
}

// ── procedural PLACEHOLDER model (cylinders, cones, stage colours; no livery): stations along -z, the group's origin = station 0 (base)
export function buildRocketMesh(THREE, R, makePlume) {
  const mat = (c, rough = .6, met = .1) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: rough, metalness: met });
  const cyl = (r0, r1, l, m, seg = 40) => { const g = new THREE.CylinderGeometry(r1, r0, l, seg, 1, false); g.rotateX(-Math.PI / 2); return new THREE.Mesh(g, m); };   // r0 at the base (+z), r1 at the top
  const root = new THREE.Group(), parts = { stages: [], fairing: [], payload: null, plumes: [] };
  for (const st of R.stages) { const g = new THREE.Group(), r = st.dia / 2, body = cyl(r, r, st.len, mat(st.color)); body.position.z = -(st.x0 + st.len / 2); g.add(body);
    for (const f of [.04, .97]) { const b = cyl(r * 1.005, r * 1.005, st.len * .025, mat(st.band, .7)); b.position.z = -(st.x0 + st.len * f); g.add(b); }
    const n = st.engines, ring = n > 1 ? r * .62 : 0, nr = Math.min(r * .9 / Math.max(1, Math.sqrt(n) * 1.1), r * .5);
    for (let i = 0; i < n; i++) { const a = i / Math.max(1, n - (n % 2 ? 1 : 0)) * Math.PI * 2, c = n % 2 && i === n - 1, bell = cyl(nr, nr * .45, nr * 2, mat('#3a3d42', .4, .7), 20);
      bell.position.set(c ? 0 : Math.cos(a) * ring, c ? 0 : Math.sin(a) * ring, -st.x0 + nr); g.add(bell); }
    const pl = makePlume(THREE); pl.position.z = -st.x0 + nr * 2; pl.visible = false; g.add(pl); parts.plumes.push(pl); pl.userData = { r: Math.max(nr, ring + nr * .8), kind: st.plume };
    root.add(g); parts.stages.push(g); }
  const PL = R.payload, p = new THREE.Group(), pb = cyl(PL.dia / 2, PL.dia / 2, PL.len, mat(PL.color)); pb.position.z = -(PL.x0 + PL.len / 2); p.add(pb); root.add(p); parts.payload = p;
  const FR = R.fairing;
  if (FR && FR.tower) { const g = new THREE.Group(), t = cyl(FR.dia / 2, FR.dia * .2, FR.len, mat(FR.color, .5, .3), 16); t.position.z = -(FR.x0 + FR.len / 2); g.add(t); root.add(g); parts.fairing.push(g); }
  else if (FR) { const r = FR.dia / 2, lc = FR.len * .55, lb = FR.len - lc;
    for (const sd of [-1, 1]) { const g = new THREE.Group(), m = mat(FR.color, .45);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, lb, 32, 1, true, sd > 0 ? 0 : Math.PI, Math.PI), m); b.rotation.x = -Math.PI / 2; b.position.z = -(FR.x0 + lb / 2);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r * .12, r, lc, 32, 1, false, sd > 0 ? 0 : Math.PI, Math.PI), m); c.rotation.x = -Math.PI / 2; c.position.z = -(FR.x0 + lb + lc / 2);
      g.add(b, c); g.userData.side = sd; root.add(g); parts.fairing.push(g); } }
  // capsule (shown after separation): blunt cone, dark heat shield at +z
  const C = R.capsule, cg = new THREE.Group(), cr = C.dia / 2, cl = C.dia * .8, cb = cyl(cr, cr * .38, cl, mat(C.color, .55, .3)); cb.position.z = -cl / 2;
  const hs = new THREE.Mesh(new THREE.SphereGeometry(cr * 1.6, 32, 8, 0, Math.PI * 2, 0, .67), mat('#2a2522', .8)); hs.rotation.x = Math.PI / 2; hs.position.z = -cr * 1.6 * Math.cos(.67) + .05; cg.add(cb, hs);
  // parachutes: canopy hemispheres above the nose (-z), sized from their area
  const chute = (A, col) => { const rr = Math.sqrt(A / Math.PI), g = new THREE.Group(), m = new THREE.Mesh(new THREE.SphereGeometry(rr, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: col, roughness: .9, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.z = -(cl + rr * 2.2); g.add(m); g.visible = false; g.userData.r = rr; return g; };
  const drg = chute(C.drogue.area, '#e8763a'), mn = chute(C.main.area, '#f2f2f2'); cg.add(drg, mn); cg.visible = false;
  parts.capsule = cg; parts.drogue = drg; parts.main = mn; root.add(cg);
  return { root, parts };
}

// ── a rocket flight inside a flight session (flight/session.js): model, views, HUD, orbit lines, panel. o = { rocket, pad, inc, alt (km), entry }
export async function setupRocket(S, o, ui, { sunL, createCore, createScreenHud }) {
  const F = S.F, THREE = F.THREE;
  const [{ createOrbit, gravityModule, createOrbitView }, { makePlume, makePlasma }] = await Promise.all([import('./orbit.js?v=11d73788'), import('./gfx.js?v=2d4add6b')]);
  const R = await loadRocket(o.rocket), orb = createOrbit({ helio: F.solar.helio }), ctx = S.ctx = { orb, node: null, sas: 'pad', last: null };
  const RK = S.rocket = createRocket(R, ctx, { pad: o.pad, inc: o.inc, alt: (o.alt || 200) * 1e3, F, wait: 1500, entry: o.entry ? { alt: 120e3, v: 7830, gamma: -1.5 } : null });
  const K = RK.K, pad = K.pad, { root, parts } = buildRocketMesh(THREE, R, makePlume); S.craft.add(root);
  const plasma = makePlasma(THREE), C = R.capsule; plasma.scale.set(C.dia * 1.5, C.dia * 1.5, C.dia * 1.6); plasma.position.z = -C.dia * .3; parts.capsule.add(plasma);
  const e4 = () => [F.earthQuat.x, F.earthQuat.y, F.earthQuat.z, F.earthQuat.w];
  const wOfI = (r, t) => { const w = qrot(e4(), toF(t, r)); return new THREE.Vector3(w[0] / R_E, w[1] / R_E, w[2] / R_E); };
  // views: Auto (tower camera while near the pad, then chase), Chase (behind the path), Side, Tower, Far chase
  const mT = new THREE.Matrix4(), vA = new THREE.Vector3(), vB = new THREE.Vector3(), vUp = new THREE.Vector3();
  const look = (cam, eye, tgt, up) => { cam.pos.copy(eye); cam.quat.setFromRotationMatrix(mT.lookAt(eye, tgt, up)); };
  const velW = () => { const s = S.core.state, vr = sub(s.v, cross(OMEGA_I, s.r)), w = qrot(e4(), toF(s.t, vr)); return vA.set(w[0], w[1], w[2]); };
  const towerEye = () => { const P = K.padF; if (!P) return null; const f = add(add(mul(P.U, R_E + P.g + 400 + 3), mul(P.X, 1100)), mul(P.Y, -500)), w = qrot(e4(), f); return new THREE.Vector3(w[0] / R_E, w[1] / R_E, w[2] / R_E); };
  const Lv = () => Math.max(K.len, 8) / R_E;
  const chase = (P, cam, k) => { const up = vUp.copy(P.pos).normalize(), v = velW(), L = Lv(); let back;
    if (v.length() > 20) back = v.normalize().multiplyScalar(-1); else back = vB.set(0, 1, 0).applyQuaternion(P.quat).multiplyScalar(-1);
    const tgt = P.pos.clone(), eye = tgt.clone().addScaledVector(back, k * L).addScaledVector(up, .35 * k * L); look(cam, eye, tgt, up); };
  const tower = (P, cam) => { const eye = towerEye(); if (!eye) return chase(P, cam, 3); const up = vUp.copy(eye).normalize(); look(cam, eye, P.pos.clone().addScaledVector(up, -.15 * Lv()), up); };
  RK.def.views = [
    { name: 'Auto', pose(P, cam) { const eye = towerEye(); if (K.mode === 'stack' && eye && eye.distanceTo(P.pos) * R_E < 9000) tower(P, cam); else chase(P, cam, 2.6); } },
    { name: 'Chase', pose: (P, cam) => chase(P, cam, 2.6) },
    { name: 'Side', pose(P, cam) { const up = vUp.copy(P.pos).normalize(), v = velW(); let sd = v.length() > 20 ? v.clone().cross(up) : vB.set(1, 0, 0).applyQuaternion(P.quat);
      if (sd.length() < 1e-9) sd = vB.set(1, 0, 0).applyQuaternion(P.quat); sd.normalize(); look(cam, P.pos.clone().addScaledVector(sd, 1.6 * Lv()), P.pos, up); } },
    { name: 'Tower', pose: tower },
    { name: 'Far chase', pose: (P, cam) => chase(P, cam, 14) }];
  const core = S.core = createCore(F, RK.def, { lat: pad.lat, lon: pad.lon, heading: K.az / D2R }, { mods: [gravityModule(ctx), RK, groundContact(RK.def.gear)], start: RK.start, warps: [1, 2, 4, 10, 60, 100, 1000] });
  S.hud = createScreenHud(core, ui, { kind: 'space', ctx });
  const labelsEl = document.createElement('div'); labelsEl.className = 'fl-orbl'; labelsEl.setAttribute('aria-hidden', 'true'); ui.prepend(labelsEl);
  const view = S.orbitView = createOrbitView(F, ctx, S.cs, labelsEl);
  // separated parts: their meshes move into their own groups (world position from the spent body, I -> W)
  const spentG = [], wrap = (b, objs, zOff) => { const g = new THREE.Group(); g.scale.setScalar(1 / R_E); for (const ob of objs) { ob.position.z = zOff; g.add(ob); } S.cs.add(g); spentG.push({ b, g }); };
  const inner = grp => { const w = new THREE.Group(); w.add(grp); return w; };
  K.onSep = b => { const g = parts.stages[b.idx]; parts.plumes[b.idx].visible = false; root.remove(g); wrap(b, [inner(g)], b.xm); };
  K.onFairing = () => { for (const g of parts.fairing) { root.remove(g); const b = K.spent.find(x => x.idx === 'fairing' && x.side === (R.fairing.tower ? 0 : g.userData.side)); if (b) wrap(b, [inner(g)], b.xm); } };
  K.onCapsule = () => { const b = K.spent[K.spent.length - 1], objs = [...parts.stages.filter(g => g.parent === root), parts.payload].map(g => { root.remove(g); return inner(g); }); wrap(b, objs, b.xm); for (const p of parts.plumes) p.visible = false; };
  if (K.mode === 'capsule') { for (const g of [...parts.stages, ...parts.fairing, parts.payload]) root.remove(g); }
  // prediction lines once out of the thick air (every 1 s)
  let tPred = 0; const repredict = () => { const s = core.state; const cur = orb.predict({ ref: s.ref, r: s.r.slice(), v: s.v.slice(), t: s.t }); ctx.last = { cur, plan: null, t: s.t, ms: cur.ms }; view.set(ctx.last); tPred = performance.now(); };
  const onPose = (P, t) => { const s = core.state, h = core.hud;
    root.position.z = K.xc; parts.capsule.visible = K.mode === 'capsule'; parts.drogue.visible = K.chute === 1; parts.main.visible = K.chute === 2;
    for (const c of [parts.drogue, parts.main]) if (c.visible) c.scale.setScalar(.2 + .8 * K.chuteK);
    const air = atmosphere(h.altMSL || 0);
    parts.plumes.forEach((pl, i) => { const on = K.mode === 'stack' && i === K.stage && K.F > 0; pl.visible = on; if (!on) return; const U = pl.material.uniforms, kero = pl.userData.kind !== 'hydrolox';
      const wide = clamp(Math.pow(P0 / Math.max(air.p, 1), .25), 1, 6), st = R.stages[i]; U.uTime.value = t / 1000; U.uStage.value = kero ? 1 : 0; U.uWide.value = wide; U.uR0.value = pl.userData.r;
      U.uLen.value = st.dia * (kero ? 5 : 3) * (1 + .5 * (wide - 1)); U.uBright.value = (kero ? 1.4 + 1.2 * K.thr : .35 + .3 * K.thr); U.uDiam.value = clamp(1.6 * air.p / P0, 0, 1) * (kero ? 1 : .5); });
    const k = clamp((K.heat - 2e5) / 1.5e6, 0, 1); plasma.visible = K.mode === 'capsule' && k > .002;
    if (plasma.visible) { plasma.material.uniforms.uK.value = k; const vr = sub(s.v, cross(OMEGA_I, s.r)), vb = qrot(qconj(s.q), vr); plasma.material.uniforms.uW.value.set(vb[0], vb[1], vb[2]).normalize(); }
    for (const x of spentG) { x.g.visible = x.b.alive; if (!x.b.alive) continue; x.g.position.copy(wOfI(x.b.r, s.t)); const q = qmul(e4(), qmul(qIF(s.t), x.b.q)); x.g.quaternion.set(q[0], q[1], q[2], q[3]); }
    const cp = F.piloting ? core.camPose(t) : null, d = (cp ? cp.pos : F.camera.position).distanceTo(P.pos) * R_E;
    S.cc.near = Math.max(.3, Math.min(d - K.len, d * .05)) / R_E; S.cc.far = (spentG.some(x => x.b.alive) ? 3e6 : d + 3e4) / R_E; S.cc.updateProjectionMatrix();
    sunL.position.copy(P.pos).addScaledVector(F.sun(), 400 / R_E); sunL.target.position.copy(P.pos);
    if ((h.altMSL || 0) > 70e3 && K.mode === 'stack' && performance.now() - tPred > 1000) repredict();
    if (K.mode === 'capsule' && ctx.last) { ctx.last = null; view.set(null); }
    view.frame(t, F.camera); };
  // panel: launch, autopilot, stage, deorbit + numbers
  const panel = document.createElement('div'); panel.className = 'orb-p'; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Rocket controls');
  panel.innerHTML = `<h2>${R.short} · ${pad.name} → ${K.altT / 1e3} km, ${K.inc}°</h2><div class="row"><button data-r="go">Launch</button><button data-r="auto" aria-pressed="true">Autopilot</button>
    <button data-r="stage">Next stage</button><button data-r="land">Deorbit and land</button></div><p class="rkS" aria-live="polite" style="margin:6px 0 4px"></p>
    <div class="rkD" style="font-variant-numeric:tabular-nums;line-height:1.55"></div><h2>Events</h2><div class="rkE" style="color:#AEB8C4;line-height:1.45"></div>`;
  ui.appendChild(panel); const $ = q => panel.querySelector(q); let msg = '';
  const autoT = () => { K.auto = !K.auto; if (K.auto && K.phase === 'manual') K.phase = 'turn'; };
  panel.onclick = e => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); b.blur(); const a = b.dataset.r;
    if (a === 'go') RK.launch(); else if (a === 'auto') autoT(); else if (a === 'stage') RK.stageNow(); else if (a === 'land') msg = RK.deorbitLand(); };
  const onKey = e => { if (!F.piloting || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input,textarea,select')) return;
    if (e.code === 'Space') { e.preventDefault(); if (K.phase === 'pad') RK.launch(); else RK.stageNow(); } else if (e.code === 'KeyP') autoT(); };
  addEventListener('keydown', onKey);
  const f0 = (x, d = 0) => isFinite(x) ? x.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d }) : '–';
  const PH = { pad: 'on the pad: press Launch (or Space)', ign: 'engines starting, held down', rise: 'vertical rise', kick: 'pitch kick', turn: 'gravity turn (nose along the air flow)', closed: 'closed-loop guidance to orbit',
    orbit: 'in orbit, engine off', deorbit: 'deorbit burn (retrograde)', entry: 'capsule: re-entry, heat shield first', chute: 'capsule under parachute', landed: 'capsule landed', manual: 'manual control' };
  function tick() { const h = core.hud, s = core.state, st = R.stages[K.stage], Tt = K.tLift != null ? (s.t - K.tLift) / 1e3 : 0;
    $('[data-r="auto"]').setAttribute('aria-pressed', String(K.auto));
    $('.rkS').textContent = (K.auto ? 'Autopilot: ' : 'Manual: ') + (PH[K.phase] || K.phase) + (msg ? ' · ' + msg : '');
    const prop = st && K.mode === 'stack' ? K.prop[K.stage] / st.prop * 100 : 0, L = K.loss;
    $('.rkD').innerHTML = [`T+ ${f0(Tt, 0)} s · ${K.mode === 'capsule' ? C.name : (st ? st.name + ' · ' + (K.nOn || 0) + ' / ' + st.engines + ' engines · ' + f0(K.thr * 100) + ' % · propellant ' + f0(prop) + ' %' : '')}`,
      `Altitude ${f0((h.altMSL || 0) / 1e3, 1)} km · speed ${f0(h.tas)} m/s (air) · ${f0(len(s.v))} m/s (inertial) · Mach ${f0(K.mach, 2)}`,
      `q ${f0((K.qNow || 0) / 1e3, 1)} kPa · max-Q ${f0(K.maxQ.q / 1e3, 1)} kPa at ${f0(K.maxQ.alt / 1e3, 1)} km, T+${f0(K.maxQ.t)} s`,
      `Acceleration ${f0(K.gNow, 2)} g (max ${f0(K.gMax.g, 1)}) · heating ${f0(K.heat / 1e3)} kW/m² (stagnation, estimate)`,
      `Δv left ${f0(h.dvLeft)} m/s · losses: gravity ${f0(L.grav)}, drag ${f0(L.drag)}, steering ${f0(L.steer)} m/s`,
      K.ins ? `Orbit at T+${f0(K.ins.T)} s: ${f0(K.ins.peri / 1e3, 1)} × ${f0(K.ins.apo / 1e3, 1)} km` : '', K.touch ? `Touchdown ${f0(K.touch.v, 1)} m/s` : ''].filter(Boolean).join('<br>');
    $('.rkE').innerHTML = K.events.slice(-6).map(x => `T+${f0(x.T)} s ${x.txt}${x.alt > 1e3 ? ' · ' + f0(x.alt / 1e3, 1) + ' km' : ''}`).join('<br>'); }
  S.reset = () => location.reload();
  const credit = `${R.short}: published stage figures (sources in rockets/*.json); PLACEHOLDER shapes, no livery · pad ${pad.name}`;
  return { onPose, tick, credit, dispose() { removeEventListener('keydown', onKey); panel.remove(); view.clear && view.clear(); for (const x of spentG) S.cs.remove(x.g); } };
}
