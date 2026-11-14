/* Orbital mechanics (docs/flight-plan.md, step S1): gravity of the Sun, the planets and the Moon (+ the Earth's J2) on solar.js's own
   ephemerides and clock; the craft's state is kept relative to the dominant body (sphere of influence) and re-based when it crosses one;
   Kepler arcs ("on rails") at high time warp; orbit prediction (adaptive Dormand-Prince 5(4)) with apsides, SOI changes and closest
   approaches; a manoeuvre node (prograde / normal / radial delta-v) with a burn timer and an auto-execute; a PLACEHOLDER test spacecraft
   (one engine + attitude control) and the drawing of the prediction (lines + labels).
   Own code. Methods from the standard texts: Vallado, Fundamentals of Astrodynamics and Applications (universal-variable Kepler problem,
   elements); Curtis, Orbital Mechanics for Engineering Students; Dormand & Prince 1980 (RK5(4) coefficients); Laplace sphere of influence.
   No third-party code. Units SI; frame I = solar.js ecliptic axes, origin = the reference body's centre (see the plan's Interfaces). */
import { R_E, GM_E, toF, qIF } from './core.js?v=47034b95';

const D2R = Math.PI / 180, G0 = 9.80665, AU = 1.495978707e11, EPS = 23.4393 * D2R;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], len = a => Math.hypot(a[0], a[1], a[2]);
const madd = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k], unit = a => { const l = len(a); return l > 0 ? mul(a, 1 / l) : [0, 0, 0]; };
const qconj = q => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => { const t = mul(cross(q, v), 2); return add(add(v, mul(t, q[3])), cross(q, t)); };
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];

// ── bodies. gm (m³/s²): JPL DE440 (Park et al. 2021, AJ 161:105), quoted from memory, to verify; planets = system values (planet + its moons,
// which are not separate bodies here); the Earth = WGS 84 (core.js GM_E). R = mean radius (m, solar.js); surf = the drawn surface (the Earth's
// drawn sea lies 400 m over the 6371 km sphere); atm = top of the air over surf (Earth: core AIR_TOP; other bodies: S5). a = semi-major axis
// around the parent (m; planets: solar.js JPL elements; the Moon: mean distance) -> sphere of influence r = a (gm / gm_parent)^0.4 (Laplace).
export const BODIES = {
  Sun: { gm: 1.32712440041e20, R: 695700e3, parent: null },
  Mercury: { gm: 2.2031868551e13, R: 2439.7e3, parent: 'Sun', a: .38709927 * AU },
  Venus: { gm: 3.24858592e14, R: 6051.8e3, parent: 'Sun', a: .72333566 * AU },
  Earth: { gm: GM_E, R: R_E, surf: R_E + 400, atm: 100e3, parent: 'Sun', a: 1.00000261 * AU, j2: 1.08262668e-3, Req: 6378137,
    pole: [0, Math.sin(EPS), Math.cos(EPS)] },   // pole = the equator's north pole in I (no precession: as core.js / solar.js gmst)
  Moon: { gm: 4.902800118e12, R: 1737.4e3, parent: 'Earth', a: 384399e3 },
  Mars: { gm: 4.2828375816e13, R: 3389.5e3, parent: 'Sun', a: 1.52371034 * AU },
  Jupiter: { gm: 1.267127641e17, R: 69911e3, parent: 'Sun', a: 5.202887 * AU },
  Saturn: { gm: 3.79405848e16, R: 58232e3, parent: 'Sun', a: 9.53667594 * AU },
  Uranus: { gm: 5.7945564e15, R: 25362e3, parent: 'Sun', a: 19.18916464 * AU },
  Neptune: { gm: 6.836527101e15, R: 24622e3, parent: 'Sun', a: 30.06992276 * AU },
};
for (const b of Object.values(BODIES)) { b.surf = b.surf || b.R; b.atm = b.atm || 0; b.soi = b.parent ? b.a * Math.pow(b.gm / BODIES[b.parent].gm, .4) : Infinity; }

// ── Kepler problem with universal variables (Vallado alg. 8 / Curtis 3.7): state (r0, v0) after dt seconds around mu; any conic
function stumpff(z) { if (z > 1e-6) { const s = Math.sqrt(z); return [(1 - Math.cos(s)) / z, (s - Math.sin(s)) / (s * z)]; }
  if (z < -1e-6) { const s = Math.sqrt(-z); return [(Math.cosh(s) - 1) / -z, (Math.sinh(s) - s) / (s * -z)]; }
  return [1 / 2 - z / 24 + z * z / 720, 1 / 6 - z / 120 + z * z / 5040]; }
export function kepler(r0, v0, dt, mu) {
  const r0n = len(r0), sm = Math.sqrt(mu), rv = dot(r0, v0), alpha = 2 / r0n - dot(v0, v0) / mu;
  if (alpha > 1e-12) { const P = 2 * Math.PI / Math.sqrt(mu * alpha ** 3); dt -= P * Math.floor(dt / P); }   // whole revolutions add nothing
  let x;
  if (alpha > 1e-12) x = sm * dt * alpha;
  else if (alpha < -1e-12) { const a = 1 / alpha, sg = Math.sign(dt) || 1, arg = (-2 * mu * alpha * dt) / (rv + sg * Math.sqrt(-mu * a) * (1 - r0n * alpha));
    x = arg > 0 ? sg * Math.sqrt(-a) * Math.log(arg) : sm * dt / r0n; }
  else x = sm * dt / r0n;
  let C = .5, S = 1 / 6, z = 0;
  for (let k = 0; k < 60; k++) { z = alpha * x * x; [C, S] = stumpff(z);
    const rr = x * x * C + rv / sm * x * (1 - z * S) + r0n * (1 - z * C), F = rv / sm * x * x * C + (1 - alpha * r0n) * x ** 3 * S + r0n * x - sm * dt, dx = F / rr;
    x -= dx; if (Math.abs(dx) < 1e-12 * Math.max(1, Math.abs(x))) break; }
  z = alpha * x * x; [C, S] = stumpff(z);
  const f = 1 - x * x / r0n * C, g = dt - x ** 3 / sm * S, r = add(mul(r0, f), mul(v0, g)), rn = len(r);
  const fd = sm / (rn * r0n) * (alpha * x ** 3 * S - x), gd = 1 - x * x / rn * C;
  return [r, add(mul(r0, fd), mul(v0, gd))];
}

// ── osculating elements of (r, v) around mu; pole = the reference plane's pole (inclination); times in s from now
export function elements(r, v, mu, pole = [0, 0, 1]) {
  const rn = len(r), h = cross(r, v), hn = len(h), ev = sub(mul(cross(v, h), 1 / mu), mul(r, 1 / rn)), e = len(ev), en = dot(v, v) / 2 - mu / rn;
  const a = -mu / (2 * en), p = hn * hn / mu, peri = p / (1 + e), apo = e < 1 ? p / (1 - e) : Infinity, inc = Math.acos(Math.max(-1, Math.min(1, dot(h, pole) / hn)));
  let period = Infinity, tPe = NaN, tAp = NaN; const rv = dot(r, v);
  if (e < 1 && a > 0) { const n = Math.sqrt(mu / a ** 3), E = Math.atan2(rv / Math.sqrt(mu * a), 1 - rn / a), M = E - e * Math.sin(E), T = 2 * Math.PI;
    period = T / n; tPe = ((T - M) % T + T) % T / n; tAp = ((Math.PI - M) % T + T) % T / n; }
  else if (e > 1) { const n = Math.sqrt(mu / (-a) ** 3), F = Math.asinh(rv / (e * Math.sqrt(-mu * a))), M = e * Math.sinh(F) - F; tPe = M < 0 ? -M / n : NaN; }
  return { a, e, inc, apo, peri, period, tPe, tAp, energy: en, h: hn, hv: h, ev };
}

// ── Dormand-Prince 5(4) tableau
const DP_C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const DP_A = [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]];
const DP_E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40];   // 5th minus 4th order weights

// ── the orbit model. helio(name, t ms) -> heliocentric ecliptic position in R⊕ (solar.js; the same function the scene draws with).
// only = a list of body names (validation: ['Earth'] = two-body); j2 = the Earth's oblateness on / off; step = ephemeris grid (ms)
export function createOrbit({ helio, only = null, j2 = true, step = 600e3 }) {
  const NAMES = Object.keys(BODIES).filter(n => !only || only.includes(n)), NB = NAMES.length, IDX = {};
  NAMES.forEach((n, i) => { IDX[n] = i; });
  const GM = NAMES.map(n => BODIES[n].gm), KIDS = {};
  for (const n of NAMES) KIDS[n] = NAMES.filter(c => BODIES[c].parent === n);
  const soi = n => (BODIES[n].parent && IDX[BODIES[n].parent] != null) ? BODIES[n].soi : Infinity;

  // ephemeris cache: heliocentric positions (m) of all bodies on a grid of `step` ms, cubic Lagrange interpolation between 4 nodes (error
  // for the Moon ~1e-4 m at 600 s; solar.js is evaluated ~once per 10 simulated minutes instead of at every force call)
  const cache = new Map();
  function gridNode(k) { let p = cache.get(k); if (p) return p; if (cache.size > 6000) cache.clear(); p = new Float64Array(NB * 3);
    for (let i = 0; i < NB; i++) { const h = NAMES[i] === 'Sun' ? [0, 0, 0] : helio(NAMES[i], k * step); p[3 * i] = h[0] * R_E; p[3 * i + 1] = h[1] * R_E; p[3 * i + 2] = h[2] * R_E; }
    cache.set(k, p); return p; }
  const P = new Float64Array(NB * 3); let tP = NaN;
  function posAll(t) { if (t === tP) return P; const u = t / step, k = Math.floor(u), f = u - k, a = gridNode(k - 1), b = gridNode(k), c = gridNode(k + 1), d = gridNode(k + 2);
    const w0 = -f * (f - 1) * (f - 2) / 6, w1 = (f + 1) * (f - 1) * (f - 2) / 2, w2 = -(f + 1) * f * (f - 2) / 2, w3 = (f + 1) * f * (f - 1) / 6;
    for (let i = 0; i < NB * 3; i++) P[i] = w0 * a[i] + w1 * b[i] + w2 * c[i] + w3 * d[i]; tP = t; return P; }
  function velAll(t) { const u = t / step, k = Math.floor(u), f = u - k, a = gridNode(k - 1), b = gridNode(k), c = gridNode(k + 1), d = gridNode(k + 2), V = new Float64Array(NB * 3), s = step / 1e3;
    const w0 = -(3 * f * f - 6 * f + 2) / 6, w1 = (3 * f * f - 4 * f - 1) / 2, w2 = -(3 * f * f - 2 * f - 2) / 2, w3 = (3 * f * f - 1) / 6;
    for (let i = 0; i < NB * 3; i++) V[i] = (w0 * a[i] + w1 * b[i] + w2 * c[i] + w3 * d[i]) / s; return V; }
  // position / velocity of body n relative to body ref (m, m/s, frame I axes)
  const rel = (n, ref, t) => { const p = posAll(t), i = IDX[n], j = IDX[ref]; return [p[3 * i] - p[3 * j], p[3 * i + 1] - p[3 * j + 1], p[3 * i + 2] - p[3 * j + 2]]; };
  const relV = (n, ref, t) => { const v = velAll(t), i = IDX[n], j = IDX[ref]; return [v[3 * i] - v[3 * j], v[3 * i + 1] - v[3 * j + 1], v[3 * i + 2] - v[3 * j + 2]]; };
  // centre of ref relative to the Earth's centre (core.js: W pose of a craft whose ref is not the Earth)
  const offset = (ref, t) => ref === 'Earth' || IDX.Earth == null ? [0, 0, 0] : rel(ref, 'Earth', t);

  // gravity in the frame of ref (non-rotating, its origin falls with ref): ref's own field (+ J2 for the Earth) + the tide of every other body
  // = GM_j [ (d_j − r)/|d_j − r|³ − d_j/|d_j|³ ] (the second term is ref's own fall towards j; all relative positions, no large cancellations)
  function accel(ref, r, t) { const p = posAll(t), ir = IDX[ref], x = r[0], y = r[1], z = r[2], r2 = x * x + y * y + z * z, rn = Math.sqrt(r2), k0 = GM[ir] / (r2 * rn);
    let ax = -x * k0, ay = -y * k0, az = -z * k0;
    const B = BODIES[ref];
    if (j2 && B.j2) { const k = B.pole, zz = x * k[0] + y * k[1] + z * k[2], c = 1.5 * B.j2 * B.gm * B.Req * B.Req / (r2 * r2 * rn), q = 5 * zz * zz / r2 - 1;
      ax += c * (q * x - 2 * zz * k[0]); ay += c * (q * y - 2 * zz * k[1]); az += c * (q * z - 2 * zz * k[2]); }
    for (let j = 0; j < NB; j++) { if (j === ir) continue;
      const dx = p[3 * j] - p[3 * ir], dy = p[3 * j + 1] - p[3 * ir + 1], dz = p[3 * j + 2] - p[3 * ir + 2], ex = dx - x, ey = dy - y, ez = dz - z;
      const e2 = ex * ex + ey * ey + ez * ez, d2 = dx * dx + dy * dy + dz * dz, ke = GM[j] / (e2 * Math.sqrt(e2)), kd = GM[j] / (d2 * Math.sqrt(d2));
      ax += ex * ke - dx * kd; ay += ey * ke - dy * kd; az += ez * ke - dz * kd; }
    return [ax, ay, az]; }

  // the dominant body for a point r (frame of ref) at t: leave ref's SOI -> its parent; inside a child's SOI -> the child (small hysteresis)
  function dominant(ref, r, t) { let cur = ref, rr = r;
    for (let k = 0; k < 4; k++) { const par = BODIES[cur].parent;
      if (par && IDX[par] != null && len(rr) > soi(cur) * 1.0005) { rr = add(rr, rel(cur, par, t)); cur = par; continue; }
      let moved = false; for (const c of KIDS[cur]) { const d = sub(rr, rel(c, cur, t)); if (len(d) < soi(c)) { rr = d; cur = c; moved = true; break; } }
      if (!moved) break; }
    return cur; }
  function rebase(st, to, t) { if (to === st.ref) return; st.r = add(st.r, rel(st.ref, to, t)); st.v = add(st.v, relV(st.ref, to, t)); st.ref = to; }
  const poleOf = ref => BODIES[ref].pole || [0, 0, 1];   // inclination: to the Earth's equator, else to the ecliptic
  const elOf = (ref, r, v) => elements(r, v, BODIES[ref].gm, poleOf(ref));

  // ── prediction. st = { ref, r, v, t (ms) }; o = { node: { t (ms), dv: [pro, nrm, rad] } | { t, dvI }, maxSteps, tol }
  // -> { segs: [{ ref, plan, pts: [t s, x, y, z, …] }], ev: [{ kind, t (ms), ref, r, alt, body, dist }], nodeState, end, steps, ms }
  // kinds: 'pe' 'ap' (apsides), 'soi-in' / 'soi-out' (body = the new ref), 'ca' (closest approach to body, dist m), 'atm' (enters the air), 'impact', 'node'
  const HORIZON = { Sun: 3 * 365.25 * 864e2, Earth: 30 * 864e2, Moon: 10 * 864e2 };
  function predict(st, o = {}) {
    const T0 = performance.now(), tol = o.tol || 1e-10, maxSteps = o.maxSteps || 6000;
    let ref = st.ref, t = st.t / 1e3, y = [...st.r, ...st.v], steps = 0, socs = 0, end = 'horizon', nodeState = null;
    const segs = [], ev = [], caSeen = {};
    let seg = null; const newSeg = plan => { seg = { ref, plan, pts: [] }; segs.push(seg); seg.pts.push(t, y[0], y[1], y[2]); };
    const node = o.node ? { t: o.node.t / 1e3, dv: o.node.dv, dvI: o.node.dvI } : null; let planned = false;
    const horizon = () => { const el = elOf(ref, y.slice(0, 3), y.slice(3)), H0 = HORIZON[ref] || 60 * 864e2;
      return t + (el.e < 1 && el.apo < soi(ref) * .98 ? Math.min(el.period, H0) : H0); };
    const f = (tt, yy) => { const a = accel(ref, yy, tt * 1e3); return [yy[3], yy[4], yy[5], a[0], a[1], a[2]]; };
    const dpStep = (tt, yy, k1, hh) => { const K = [k1];
      for (let s = 1; s < 7; s++) { const yi = yy.slice(); for (let j = 0; j < s; j++) { const c = DP_A[s][j] * hh; if (c) for (let i = 0; i < 6; i++) yi[i] += c * K[j][i]; }
        if (s === 6) { K.push(f(tt + hh, yi)); return { y: yi, K }; } K.push(f(tt + DP_C[s] * hh, yi)); } };
    const errOf = (K, hh, yy) => { let er = [0, 0, 0], evv = [0, 0, 0];
      for (let i = 0; i < 3; i++) { let a = 0, b = 0; for (let j = 0; j < 7; j++) { a += DP_E[j] * K[j][i]; b += DP_E[j] * K[j][i + 3]; } er[i] = a * hh; evv[i] = b * hh; }
      return Math.max(len(er) / (tol * len(yy) + 1e-3), len(evv) / (tol * Math.hypot(yy[3], yy[4], yy[5]) + 1e-6)); };
    // cubic Hermite between two accepted states (u = 0..1)
    const herm = (y0, y1, hh, u) => { const u2 = u * u, u3 = u2 * u, a = 2 * u3 - 3 * u2 + 1, b = (u3 - 2 * u2 + u) * hh, c = -2 * u3 + 3 * u2, d = (u3 - u2) * hh;
      const da = (6 * u2 - 6 * u) / hh, db = 3 * u2 - 4 * u + 1, dc = (-6 * u2 + 6 * u) / hh, dd = 3 * u2 - 2 * u, out = [];
      for (let i = 0; i < 3; i++) out.push(a * y0[i] + b * y0[i + 3] + c * y1[i] + d * y1[i + 3]);
      for (let i = 0; i < 3; i++) out.push(da * y0[i] + db * y0[i + 3] + dc * y1[i] + dd * y1[i + 3]); return out; };
    const root = (g, lo = 0, hi = 1) => { let glo = g(lo); for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2, gm = g(m); if ((gm > 0) === (glo > 0)) { lo = m; glo = gm; } else hi = m; } return (lo + hi) / 2; };
    const evAt = (kind, tt, yy, x) => ev.push({ kind, t: tt * 1e3, ref, r: yy.slice(0, 3), v: yy.slice(3), alt: len(yy) - BODIES[ref].surf, ...x });
    newSeg(false); let tEnd = node ? node.t : horizon(), k1 = f(t, y), h = Math.min(o.h0 || 30, Math.max(1, tEnd - t));
    if (node && node.t <= t) tEnd = t;
    while (steps < maxSteps) {
      if (t >= tEnd - 1e-6) {
        if (node && !planned) {   // the node: apply its delta-v, the rest of the path is the planned orbit
          const r = y.slice(0, 3), v = y.slice(3), n = unit(cross(r, v)), pv = unit(v), rd = cross(pv, n);
          const dvI = node.dvI || add(add(mul(pv, node.dv[0]), mul(n, node.dv[1])), mul(rd, node.dv[2]));
          nodeState = { ref, t: t * 1e3, r, v, dvI }; evAt('node', t, y, { dv: len(dvI) });
          for (let i = 0; i < 3; i++) y[i + 3] += dvI[i]; planned = true; newSeg(true); tEnd = horizon(); k1 = f(t, y); h = 30; continue; }
        break; }
      h = Math.min(h, tEnd - t);
      const S = dpStep(t, y, k1, h), err = errOf(S.K, h, y);
      steps++;
      if (!(err <= 1)) { h *= Math.max(.2, .9 * Math.pow(err || 1e9, -.2)); if (h < 1e-3) { end = 'stuck'; break; } continue; }
      const t1 = t + h, y1 = S.y, B = BODIES[ref];
      // stopping events inside the step: impact, leaving the SOI, entering a child's SOI -> the earliest
      let stop = null;
      const tryStop = (kind, g, x) => { if (g(1) < 0 && g(0) >= 0) { const u = root(g); if (!stop || u < stop.u) stop = { kind, u, ...x }; } };
      tryStop('impact', u => len(herm(y, y1, h, u)) - B.surf);
      const sr = soi(ref); if (isFinite(sr)) tryStop('soi-out', u => sr * 1.0005 - len(herm(y, y1, h, u)), { body: B.parent });
      for (const c of KIDS[ref]) { const sc = soi(c); tryStop('soi-in', u => len(sub(herm(y, y1, h, u), rel(c, ref, (t + u * h) * 1e3))) - sc, { body: c }); }
      const uMax = stop ? stop.u : 1;
      // apsides, entering the air, closest approaches (before the stop)
      const rv0 = dot(y, y.slice(3)), rv1 = dot(y1, y1.slice(3));
      if ((rv0 < 0) !== (rv1 < 0)) { const u = root(w => { const q = herm(y, y1, h, w); return dot(q, q.slice(3)); }); if (u <= uMax) evAt(rv0 < 0 ? 'pe' : 'ap', t + u * h, herm(y, y1, h, u)); }
      if (B.atm && len(y) > B.surf + B.atm && len(y1) <= B.surf + B.atm) { const u = root(w => len(herm(y, y1, h, w)) - B.surf - B.atm); if (u <= uMax) evAt('atm', t + u * h, herm(y, y1, h, u)); }
      for (const c of KIDS[ref]) { if (caSeen[ref + c]) continue;
        const g = u => { const q = herm(y, y1, h, u), tt = (t + u * h) * 1e3; return dot(sub(q, rel(c, ref, tt)), sub(q.slice(3), relV(c, ref, tt))); };
        if (g(0) < 0 && g(1) >= 0) { const u = root(g); if (u <= uMax) { const q = herm(y, y1, h, u), dist = len(sub(q, rel(c, ref, (t + u * h) * 1e3))); caSeen[ref + c] = 1;
          if (dist < 5 * soi(c)) evAt('ca', t + u * h, q, { body: c, dist }); } } }   // only near passes (< 5 SOI radii)
      // points for the line (Hermite in-between points: ≤ ~1.5° of turn per piece)
      const n = Math.min(24, Math.max(1, Math.ceil(Math.acos(Math.max(-1, Math.min(1, dot(y, y1) / (len(y) * len(y1))))) / .026)));
      for (let i = 1; i <= n; i++) { const u = i / n * uMax, q = i === n && !stop ? y1 : herm(y, y1, h, u); seg.pts.push(t + u * h, q[0], q[1], q[2]); }
      if (stop) { const hs = stop.u * h, Se = dpStep(t, y, k1, hs); t += hs; y = Se.y;
        if (stop.kind === 'impact') { evAt('impact', t, y); end = 'impact'; break; }
        evAt(stop.kind, t, y, { body: stop.body });
        const st2 = { ref, r: y.slice(0, 3), v: y.slice(3) }; rebase(st2, stop.body, t * 1e3); ref = st2.ref; y = [...st2.r, ...st2.v];
        if (++socs > 4) { end = 'soi'; break; }
        newSeg(planned); if (!node || planned) tEnd = Math.max(tEnd, horizon()); k1 = f(t, y); h = Math.max(1, h * .5); continue; }
      const k7 = S.K[6]; t = t1; y = y1; k1 = k7;
      h *= Math.min(5, .9 * Math.pow(Math.max(err, 1e-10), -.2));
    }
    if (steps >= maxSteps) end = 'steps';
    return { segs, ev, nodeState, end, steps, ms: performance.now() - T0 };
  }

  return { NAMES, BODIES, soi, kids: KIDS, rel, relV, offset, accel, dominant, rebase, elOf, poleOf, predict, kepler, posAll };
}

// ── the gravity module for flight/core.js: forces + SOI re-basing + "on rails" + HUD space data. ctx = { orb, node, sas, last } (shared)
export function gravityModule(ctx) {
  const orb = ctx.orb;
  return { name: 'gravity (S1)',
    forces(s, env, acc) { const a = orb.accel(s.ref, s.r, s.t); acc.F = madd(acc.F, a, s.m); acc.g = a; },
    // once per step, outside RK4: the dominant body (re-base the state when it changes)
    step(s) { const d = orb.dominant(s.ref, s.r, s.t); if (d !== s.ref) orb.rebase(s, d, s.t); },
    refOffset: (ref, t) => orb.offset(ref, t), radius: ref => BODIES[ref].surf,
    // Kepler arcs about the dominant body (no tides, no J2): allowed without thrust, above the air, before an armed burn
    railsOk(s, t1) { const B = BODIES[s.ref], N = ctx.node;
      if (s.ctl.throttle > 0 || s.onGround) return false;
      if (B.atm && len(s.r) < B.surf + B.atm + 5e3) return false;
      if (N && N.auto && N.phase !== 'done' && N.tStart != null && N.tStart < t1 + 30e3) return false;
      return true; },
    // propagate to t1 (ms) in pieces (SOI check after each); stops at the air -> returns the time reached
    rails(s, t1) { let k = 0; const sg = t1 >= s.t ? 1 : -1;   // also backwards (the clock moved back)
      while ((t1 - s.t) * sg > 1e-6 && k++ < 400) { const B = BODIES[s.ref], el = elements(s.r, s.v, B.gm), dt = sg * Math.min(Math.abs(t1 - s.t) / 1e3, 600, isFinite(el.period) ? el.period / 60 : 600);
        const [r, v] = kepler(s.r, s.v, dt, B.gm); s.r = r; s.v = v; s.t += dt * 1e3;
        const d = orb.dominant(s.ref, s.r, s.t); if (d !== s.ref) orb.rebase(s, d, s.t);
        const B2 = BODIES[s.ref]; if (B2.atm && len(s.r) < B2.surf + B2.atm + 5e3) return s.t; }
      if ((t1 - s.t) * sg > 1e-6) { const [r, v] = kepler(s.r, s.v, (t1 - s.t) / 1e3, BODIES[s.ref].gm); s.r = r; s.v = v; s.t = t1; }   // a long clock jump: the rest in one arc
      return s.t; },
    hud(s, env, hud) { const B = BODIES[s.ref], el = orb.elOf(s.ref, s.r, s.v), L = ctx.last, N = ctx.node;
      const soiEv = L && L.cur ? L.cur.ev.find(e => e.kind === 'soi-in' || e.kind === 'soi-out') : null;
      Object.assign(hud, { ref: s.ref, vOrb: len(s.v), altRef: len(s.r) - B.surf, apo: el.apo - B.surf, peri: el.peri - B.surf, ecc: el.e, inc: el.inc / D2R,
        incTo: s.ref === 'Earth' ? 'equator' : 'ecliptic', period: el.period, tApo: el.tAp, tPeri: el.tPe, sma: el.a,
        soiNext: soiEv ? { body: soiEv.body, t: soiEv.t } : null, dvLeft: ctx.def ? ctx.def.isp * G0 * Math.log(s.m / ctx.def.dry) : NaN,
        burn: N && N.dvI ? { dv: N.phase === 'burn' && N.rem ? len(N.rem) : len(N.dvI), t: N.t, tStart: N.tStart, dur: N.burnT, phase: N.phase, auto: N.auto } : null,
        sas: ctx.sas, dvUsed: ctx.dvUsed || 0 }); } };
}

// ── PLACEHOLDER test spacecraft (not a real vehicle): a 3 × 3 × 6 m can of 13 t (3 t dry + 10 t propellant), one 200 kN engine along body −z
// (Isp 320 s, i.e. a storable-propellant class engine), inertia of a uniform box at full mass (kept constant), attitude control by an ideal
// torque source (reaction wheels / RCS, 0.5 rad/s² per axis). Delta-v ~4.6 km/s.
export const ORBITER = (() => { const dry = 3000, fuel = 10000, m = dry + fuel, w = 3, h = 3, l = 6;
  return { name: 'Test orbiter (placeholder)', dry, fuel, m, thrust: 200e3, isp: 320, alpha: .5, size: [w, h, l],
    I: [[m / 12 * (h * h + l * l), 0, 0], [0, m / 12 * (w * w + l * l), 0], [0, 0, m / 12 * (w * w + h * h)]], cg: [0, 0, 0], gear: { points: [] },
    views: [{ name: 'Chase', eye: [0, 3, 18], tilt: -.12 }, { name: 'Far chase', eye: [0, 40, 160], tilt: -.2 }, { name: 'Orbit view', eye: [0, 9e6, 9e6], tilt: -.95 }],
    rest: 1.5,
    init(s) { s.m = dry + fuel; s.sys.fuel = [fuel]; s.eng = [{ thrust: 0, ff: 0, on: true }]; s.ctl.brake = 0; } }; })();

// burn direction of an SAS mode (unit vector in I) for the state st, or null
function sasDir(mode, st, N) { const v = st.v, r = st.r, n = unit(cross(r, v)), pv = unit(v);
  switch (mode) { case 'pro': return pv; case 'retro': return mul(pv, -1); case 'normal': return n; case 'anti': return mul(n, -1);
    case 'radial': return cross(pv, n); case 'antirad': return mul(cross(pv, n), -1);
    case 'node': return N && (N.rem || N.dvI) ? unit(N.phase === 'burn' && N.rem ? N.rem : N.dvI) : null; }
  return null; }

// engine + attitude control + the node autopilot (PLACEHOLDER craft). Manual stick input switches a pointing mode to 'hold'.
export function orbiterModule(def, ctx) {
  const KP = .6, KD = 3, WMAX = .25, Id = [def.I[0][0], def.I[1][1], def.I[2][2]];
  ctx.def = def; ctx.dvUsed = 0;
  return { name: 'engine + attitude (placeholder)',
    step(s, env, h) { const N = ctx.node, man = Math.abs(s.ctl.pitch) + Math.abs(s.ctl.roll) + Math.abs(s.ctl.yaw) > .05;
      if (man && ctx.sas !== 'off' && ctx.sas !== 'hold') ctx.sas = 'hold';
      const fwd = qrot(s.q, [0, 0, -1]);
      if (N && N.dvI && N.phase !== 'done') {
        if (N.phase === 'plan') {
          if (N.auto) { if (ctx.sas !== 'node' && !man) ctx.sas = 'node'; if (N.tStart != null && s.t >= N.tStart) { N.phase = 'burn'; N.rem = N.dvI.slice(); s.warpReq = 1; } }
          else if (s.ctl.throttle > 0 && N.tStart != null && Math.abs(s.t - N.t) < N.burnT * 1e3 + 120e3) { N.phase = 'burn'; N.rem = N.dvI.slice(); } }
        if (N.phase === 'burn') { const u = unit(N.dvI), along = dot(N.rem, u);
          if (along <= .005 || s.sys.fuel[0] <= 0) { N.phase = 'done'; if (N.auto) { s.ctl.throttle = 0; ctx.sas = 'hold'; } }
          else if (N.auto) { const aMax = def.thrust / s.m, err = Math.acos(Math.max(-1, Math.min(1, dot(fwd, unit(N.rem)))));
            s.ctl.throttle = err > 10 * D2R ? 0 : Math.min(1, len(N.rem) / (aMax * .5)); } } }
      // engine: thrust along −z, propellant at F / (Isp g0)
      const fuel = s.sys.fuel[0], F = (fuel > 0 ? s.ctl.throttle : 0) * def.thrust, md = F / (def.isp * G0), burn = Math.min(fuel, md * h);
      const Fe = md > 0 ? F * burn / (md * h) : 0; s.sys.fuel[0] = fuel - burn; s.m = def.dry + s.sys.fuel[0];
      s.eng[0].thrust = Fe; s.eng[0].ff = burn / h;
      const dv = Fe / s.m * h; ctx.dvUsed += dv; if (N && N.phase === 'burn' && N.rem) N.rem = madd(N.rem, fwd, -dv); },
    forces(s, env, acc) { const F = s.eng[0] ? s.eng[0].thrust : 0; if (F) acc.F = add(acc.F, qrot(s.q, [0, 0, -F]));
      const c = s.ctl, a = def.alpha, man = Math.abs(c.pitch) + Math.abs(c.roll) + Math.abs(c.yaw) > .05;
      if (man) { acc.M = add(acc.M, [Id[0] * a * c.pitch, -Id[1] * a * c.yaw, -Id[2] * a * c.roll]); return; }
      const mode = ctx.sas; if (mode === 'off') return;
      let wd = [0, 0, 0]; const dir = mode === 'hold' ? null : sasDir(mode, s, ctx.node);
      if (dir) { const tb = qrot(qconj(s.q), dir), sn = Math.hypot(tb[0], tb[1]), ang = Math.atan2(sn, -tb[2]);
        wd = sn > 1e-9 ? [tb[1] / sn * ang * KP, -tb[0] / sn * ang * KP, 0] : (tb[2] > 0 ? [WMAX, 0, 0] : [0, 0, 0]);
        const wl = Math.hypot(wd[0], wd[1]); if (wl > WMAX) wd = mul(wd, WMAX / wl); }
      const M = [0, 1, 2].map(i => Math.max(-Id[i] * a, Math.min(Id[i] * a, Id[i] * KD * (wd[i] - s.w[i]))));
      acc.M = add(acc.M, M); } };
}

// ── manoeuvre node helpers (ctx.node = { t ms, dv [pro, nrm, rad] m/s, auto, phase 'plan' | 'burn' | 'done', dvI, rem, burnT s, tStart ms })
export function nodeUpdate(ctx, s, pred) {   // after a planned prediction: the burn vector, its duration (rocket equation) and start
  const N = ctx.node, def = ctx.def; if (!N || N.phase !== 'plan' || !pred.nodeState) return;
  N.dvI = pred.nodeState.dvI; const dv = len(N.dvI), ve = def.isp * G0, m1 = s.m * Math.exp(-dv / ve), md = def.thrust / ve;
  N.burnT = (s.m - m1) / md; N.tStart = N.t - N.burnT / 2 * 1e3; N.ref = pred.nodeState.ref; }
export function hohmann(mu, r1, r2) { const a = (r1 + r2) / 2; return [Math.sqrt(mu / r1) * (Math.sqrt(r2 / a) - 1), Math.sqrt(mu / r2) * (1 - Math.sqrt(r1 / a))]; }

// ── drawing of the prediction in earthgl's craft layer (camera-relative scene): one line per segment, placed at its reference body's centre
// now and turned I -> W now (the path is inertial; the globe turns under it); vertices relative to the segment's first point (small numbers
// near the craft: float32-safe). Parts hidden behind the Earth or the Moon are dimmed (CPU ray test, the craft layer has no Earth depth).
// Labels (Ap, Pe, SOI, closest approach, node, impact) are HTML elements in `labelsEl`, projected with the Earth camera.
export function createOrbitView(F, ctx, layerScene, labelsEl) {
  const THREE = F.THREE, root = new THREE.Group(); layerScene.add(root);
  const COL = { cur: [.22, 1, .62], plan: [1, .70, .28], moon: [.62, .83, 1] };
  let lines = [], labels = [];
  const qW = new THREE.Quaternion(), qa = new THREE.Quaternion(), v3 = new THREE.Vector3(), cam = new THREE.Vector3();
  const qIW = t => { const e = F.earthQuat, q = qmul([e.x, e.y, e.z, e.w], qIF(t)); return qW.set(q[0], q[1], q[2], q[3]); };
  const wOf = (ref, p, t) => { const o = ctx.orb.offset(ref, t), f = toF(t, add(o, p)), e = F.earthQuat, w = qrot([e.x, e.y, e.z, e.w], f); return v3.set(w[0] / R_E, w[1] / R_E, w[2] / R_E); };
  function clear() { for (const l of lines) { root.remove(l.obj); l.obj.geometry.dispose(); l.obj.material.dispose(); } lines = []; labelsEl.textContent = ''; labels = []; }
  function addSeg(sg, col, a) { const n = sg.pts.length / 4; if (n < 2) return; const p0 = [sg.pts[1], sg.pts[2], sg.pts[3]], pos = new Float32Array(n * 3), c = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) pos[i * 3 + k] = (sg.pts[i * 4 + 1 + k] - p0[k]) / R_E; c.set([...col, a], i * 4); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 4));
    const obj = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: false })); obj.frustumCulled = false; obj.renderOrder = 5;
    root.add(obj); lines.push({ obj, ref: sg.ref, p0, a }); }
  const fmtD = m => !isFinite(m) ? '∞' : Math.abs(m) >= 1e6 ? (m / 1e3).toLocaleString('en-GB', { maximumFractionDigits: 0 }) + ' km' : (m / 1e3).toLocaleString('en-GB', { maximumFractionDigits: 1 }) + ' km';
  const fmtT = s => { if (!isFinite(s)) return ''; const a = Math.abs(s), sg = s < 0 ? 'T+' : 'T−';   // time to the event
    return sg + (a >= 86400 ? Math.floor(a / 86400) + ' d ' + Math.floor(a % 86400 / 3600) + ' h' : a >= 3600 ? Math.floor(a / 3600) + ' h ' + Math.floor(a % 3600 / 60) + ' min' : Math.floor(a / 60) + ' min ' + Math.floor(a % 60) + ' s'); };
  function addLabel(e, plan) { const d = document.createElement('div'); d.className = 'orb-l' + (plan ? ' plan' : '');
    const name = { pe: 'Pe', ap: 'Ap', 'soi-in': 'Enters ' + e.body + ' SOI', 'soi-out': 'Leaves SOI → ' + e.body, ca: 'Closest ' + e.body, atm: 'Enters the air', impact: 'Impact', node: 'Node' }[e.kind];
    const val = e.kind === 'pe' || e.kind === 'ap' ? fmtD(e.alt) : e.kind === 'ca' ? fmtD(e.dist) : e.kind === 'node' ? (e.dv).toFixed(1) + ' m/s' : '';
    d.dataset.t = e.t; d.innerHTML = `<b>${name}</b> ${val}<span></span>`; labelsEl.appendChild(d); labels.push({ el: d, e, sp: d.lastChild }); }
  // pred = { cur, plan } (predict() results)
  function set(pred) { clear(); if (!pred) return;
    if (pred.cur) { for (const sg of pred.cur.segs) addSeg(sg, sg.ref === 'Moon' ? COL.moon : COL.cur, .9); for (const e of pred.cur.ev) if (e.kind !== 'node') addLabel(e, false); }
    if (pred.plan && pred.plan.nodeState) { const tn = pred.plan.nodeState.t; for (const sg of pred.plan.segs) if (sg.plan) addSeg(sg, COL.plan, .9);
      for (const e of pred.plan.ev) if (e.kind === 'node' || e.t > tn) addLabel(e, true); } }
  // per frame: place the lines (doubles), dim hidden parts, move the labels
  const occ = [];
  function frame(t, camera) { cam.copy(camera.position); occ.length = 0; occ.push([0, 0, 0, (R_E + 400) / R_E]);
    if (ctx.orb.NAMES.includes('Moon')) { const m = wOf('Moon', [0, 0, 0], t); occ.push([m.x, m.y, m.z, BODIES.Moon.R / R_E]); }
    const hid = (x, y, z) => { for (const [ox, oy, oz, rr] of occ) { const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z, fx = cam.x - ox, fy = cam.y - oy, fz = cam.z - oz, dd = dx * dx + dy * dy + dz * dz;
      const s = Math.max(0, Math.min(1, -(fx * dx + fy * dy + fz * dz) / dd)), cx = fx + s * dx, cy = fy + s * dy, cz = fz + s * dz; if (cx * cx + cy * cy + cz * cz < rr * rr) return true; } return false; };
    qIW(t);
    for (const l of lines) { const o = wOf(l.ref, l.p0, t); l.obj.position.copy(o); l.obj.quaternion.copy(qW); l.obj.updateMatrix();
      // the local matrix = W (root sits at the layer scene's origin; earthgl moves that scene by −camera.position only while drawing)
      const P = l.obj.geometry.attributes.position, C = l.obj.geometry.attributes.color, M = l.obj.matrix.elements;
      for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        C.setW(i, hid(M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]) ? l.a * .2 : l.a); }
      C.needsUpdate = true; }
    const W = labelsEl.clientWidth || innerWidth, Hh = labelsEl.clientHeight || innerHeight;
    for (const L of labels) { const p = wOf(L.e.ref, L.e.r, t), x = p.x, y = p.y, z = p.z; v3.set(x, y, z).project(camera);
      const vis = v3.z < 1 && v3.z > -1 && Math.abs(v3.x) < 1.2 && Math.abs(v3.y) < 1.2;
      L.el.style.display = vis ? '' : 'none'; if (!vis) continue;
      L.el.style.transform = `translate(${((v3.x + 1) / 2 * W).toFixed(1)}px, ${((1 - v3.y) / 2 * Hh).toFixed(1)}px)`;
      L.el.classList.toggle('hid', hid(x, y, z)); L.sp.textContent = ' ' + fmtT((L.e.t - t) / 1e3); } }
  return { set, frame, clear };
}
