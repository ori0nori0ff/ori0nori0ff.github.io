/* Weapons framework for the flight mode (docs/flight-notes/f16-gun.md): master arm + interlocks, a fixed pool of projectiles flown in the
   core's frame and time step, hit tests against targets, ground impacts, events. Guns (gun.js) and later missiles / bombs plug in here.
   Own code. Frames as flight/core.js: physics in I (ecliptic axes, Earth-centred, metres, doubles), body axes x right, y up, -z forward;
   drawing in W (earthgl's Earth-fixed world). Projectiles are point masses: gravity (GM / r^2, as the craft) + drag 1/2 rho Cd(M) A V^2 against
   the air (which turns with the Earth + the core's wind); US Std Atmosphere 1976 (atmos.js). Heun (2nd-order) step of h = 1/120 s.
   createWeapons(F, def) -> { module (core force / step / hud module: add it to createCore's mods), pool, targets, events, ... };
   flight/weapons/fx.js attachWeapons(session, weapons) adds the keys and the drawing.
   The module's step runs once per physics step BEFORE the craft's RK4 step (core.js): rounds leave the gun from the state at the step's start
   (spread over the step by their firing time) and are flown to the step's end, the same time the craft reaches. */
import { R_E, GM_E, OMEGA_I, qIF } from '../core.js?v=d29b8afa';
import { atmosphere } from '../atmos.js?v=7ee6d1db';
import { createGun } from './gun.js?v=8db5898c';

const N = 1024;   // pool size: 510 rounds fit with room for later weapons
// air table every 25 m from -500 m to 39.5 km (linear interpolation; error < 1e-5 in rho), above it the formula
const AZ0 = -500, ADZ = 25, AN = 1601, aRho = new Float64Array(AN), aA = new Float64Array(AN);
for (let i = 0; i < AN; i++) { const a = atmosphere(AZ0 + i * ADZ); aRho[i] = a.rho; aA[i] = a.a; }
const air = [0, 0];
function airAt(z) { const f = (z - AZ0) / ADZ; if (f >= AN - 1) { const a = atmosphere(z); air[0] = a.rho; air[1] = a.a; return air; }
  const i = f <= 0 ? 0 : Math.floor(f), t = f <= 0 ? 0 : f - i; air[0] = aRho[i] + (aRho[i + 1] - aRho[i]) * t; air[1] = aA[i] + (aA[i + 1] - aA[i]) * t; return air; }
const lut = (X, Y, x) => { if (x <= X[0]) return Y[0]; for (let i = 1; i < X.length; i++) if (x <= X[i]) return Y[i - 1] + (Y[i] - Y[i - 1]) * (x - X[i - 1]) / (X[i] - X[i - 1]); return Y[Y.length - 1]; };
// 3x3 rotation of a quaternion [x, y, z, w] (row-major), and q·v
const qmat = q => { const [x, y, z, w] = q; return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]; };
const mm = (A, B) => { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return C; };
export const qrot = (q, v) => { const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx]; };
export const qconj = q => [-q[0], -q[1], -q[2], q[3]];
export const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const W0 = OMEGA_I[0], W1 = OMEGA_I[1], W2 = OMEGA_I[2];

// a projectile kind from its json: mass (kg), diameter (m), Cd vs Mach
function kindOf(R) { return { m: R.mass, A: Math.PI * R.diam * R.diam / 4, cdM: R.cd.M, cdC: R.cd.Cd, maxTime: R.maxTime || 30, trace: R.traceTime || 0, every: R.tracerEvery || 0, name: R.name }; }

export function createWeapons(F, def, o = {}) {
  const J = def.json || {}, G = J.gun;
  const gun = G ? createGun(G) : null, muzzle = G ? G.muzzle : [0, 0, 0];
  const kinds = G ? [kindOf(G.round), { ...kindOf(G.round), maxTime: 6 }] : [];   // [1] = the same round for AI guns (S12), dropped after 6 s (game value: keeps the pool free)
  // ── state shared with the HUD / sound / tests (core.state.wpn)
  const ws = { arm: false, trigger: false, firing: false, rounds: gun ? gun.state.rounds : 0, inhibit: '', spin: 0, live: 0 };
  const L = {};   // listeners: 'fire' (n), 'ground' ({ w: W metres }), 'hit' ({ target, w }), 'kill' ({ target })
  const emit = (k, d) => { for (const f of L[k] || []) f(d); };
  // ── projectile pool (structure of arrays)
  const on = new Uint8Array(N), kind = new Uint8Array(N), tracer = new Uint8Array(N), gChk = new Uint8Array(N), team = new Uint8Array(N);   // team: 0 = blue (the F-16), 1 = red (S12 AI guns): rounds pass their own side's targets
  const r = new Float64Array(3 * N), v = new Float64Array(3 * N), w0 = new Float64Array(3 * N), w1 = new Float64Array(3 * N), age = new Float64Array(N), gR = new Float64Array(N);
  const born = new Uint32Array(N); let next = 0, live = 0, serial = 0, stepNo = 0;
  const stats = { ms: 0, msMax: 0, live: 0, steps: 0, fired: 0, hits: 0, ground: 0, redFired: 0 };
  const targets = [];   // { alive, boxes: [{ c, h }] (body m), r0, r1 (I m), q1 (body -> I), hit(w, n) , step(t0, h, env) } + docs/flight-notes/weapons-contract.md
  // plug-in systems (flight/weapons/plugins.js: stations, ai, radar, missiles): { name, step(s, env, h, MW), forces(s, env, acc), hud(s, env, h) },
  // run in the order added, after the targets moved and before the gun. bus = the state they share (contract: weapons-contract.md)
  const systems = [], bus = { sel: 'GUN', stations: [], tracks: [], lock: null, mode: 'RWS', missiles: [] };
  let wI = [0, 0, 0];   // the core's wind this step (frame I)
  let MW = null;        // I -> W (metres) at the step's end
  let MF = null;        // I -> F (Earth-fixed) at the step's end
  const qE = () => [F.earthQuat.x, F.earthQuat.y, F.earthQuat.z, F.earthQuat.w];

  // acceleration of a projectile of kind K at (x, vx) -> a (3); returns the Mach number
  const a3 = [0, 0, 0];
  function accel(K, x0, x1, x2, u0, u1, u2) {
    const rl = Math.hypot(x0, x1, x2), g = -GM_E / (rl * rl * rl), [rho, sa] = airAt(rl - R_E - 400);
    const va0 = u0 - (W1 * x2 - W2 * x1) - wI[0], va1 = u1 - (W2 * x0 - W0 * x2) - wI[1], va2 = u2 - (W0 * x1 - W1 * x0) - wI[2], V = Math.hypot(va0, va1, va2);
    const M = V / sa, k = rho * lut(K.cdM, K.cdC, M) * K.A / (2 * K.m) * V;
    a3[0] = g * x0 - k * va0; a3[1] = g * x1 - k * va1; a3[2] = g * x2 - k * va2; return M; }
  // one Heun step of length h for projectile i
  function fly(i, h) { const K = kinds[kind[i]], j = 3 * i, x0 = r[j], x1 = r[j + 1], x2 = r[j + 2], u0 = v[j], u1 = v[j + 1], u2 = v[j + 2];
    accel(K, x0, x1, x2, u0, u1, u2); const b0 = a3[0], b1 = a3[1], b2 = a3[2];
    const p0 = x0 + u0 * h, p1 = x1 + u1 * h, p2 = x2 + u2 * h, q0 = u0 + b0 * h, q1 = u1 + b1 * h, q2 = u2 + b2 * h;
    accel(K, p0, p1, p2, q0, q1, q2);
    r[j] = x0 + (u0 + q0) * h / 2; r[j + 1] = x1 + (u1 + q1) * h / 2; r[j + 2] = x2 + (u2 + q2) * h / 2;
    v[j] = u0 + (b0 + a3[0]) * h / 2; v[j + 1] = u1 + (b1 + a3[1]) * h / 2; v[j + 2] = u2 + (b2 + a3[2]) * h / 2; age[i] += h; }
  const toW = (i, out) => { const j = 3 * i, x = r[j], y = r[j + 1], z = r[j + 2]; out[j] = MW[0] * x + MW[1] * y + MW[2] * z; out[j + 1] = MW[3] * x + MW[4] * y + MW[5] * z; out[j + 2] = MW[6] * x + MW[7] * y + MW[8] * z; };
  function alloc() { for (let k = 0; k < N; k++) { const i = (next + k) % N; if (!on[i]) { next = (i + 1) % N; return i; } } return -1; }

  // ground under projectile i (radius of the drawn ground, m): relief + 400 m at its lat / lon, as the core's ground. F.groundAt directly (not
  // env.groundOf: that one stores its value as the core's fallback ground, which decides the craft's contact sub-steps); no height tile there
  // yet -> keep the last value (0 = none: no impact test)
  function groundR(i) { const j = 3 * i, x = r[j], y = r[j + 1], z = r[j + 2], f0 = MF[0] * x + MF[1] * y + MF[2] * z, f1 = MF[3] * x + MF[4] * y + MF[5] * z, f2 = MF[6] * x + MF[7] * y + MF[8] * z;
    const fl = Math.hypot(f0, f1, f2), g = F.groundAt(Math.asin(f1 / fl), Math.atan2(-f2, f0)); return g == null ? gR[i] : R_E + 400 + g; }

  // segment (start / end relative to the target, frame I) against the target's boxes (body axes): first hit fraction or -1
  function hitBoxes(T, s0, s1) { const qi = qconj(T.q1), a = qrot(qi, s0), b = qrot(qi, s1); let best = -1;
    for (const B of T.boxes) { let t0 = 0, t1 = 1, ok = true;
      for (let k = 0; k < 3 && ok; k++) { const lo = B.c[k] - B.h[k], hi = B.c[k] + B.h[k], d = b[k] - a[k];
        if (Math.abs(d) < 1e-12) { if (a[k] < lo || a[k] > hi) ok = false; continue; }
        let u = (lo - a[k]) / d, w = (hi - a[k]) / d; if (u > w) [u, w] = [w, u]; t0 = Math.max(t0, u); t1 = Math.min(t1, w); if (t0 > t1) ok = false; }
      if (ok && (best < 0 || t0 < best)) best = t0; }
    return best; }

  const tmpW = new Float64Array(3), dirB = [0, 0, 0];
  // ── once per physics step (core.js): targets move, the gun fires, every projectile flies, hits / ground impacts are found
  function step(s, env, h) {
    if (s.ref !== 'Earth') return; const tp = performance.now(), t1 = s.t + h * 1e3; stepNo++;
    s.wpn = ws; const nv = env.vAirOf({ ref: 'Earth', r: [0, 0, 0], v: [0, 0, 0] }); wI = [-nv[0], -nv[1], -nv[2]];
    MF = qmat(qIF(t1)); MW = mm(qmat(qE()), MF);
    for (const T of targets) if (T.step) T.step(s.t, h, env, MW);
    for (const y of systems) if (y.step) try { y.step(s, env, h, MW); } catch (e) { console.error('weapons system ' + y.name, e); systems.splice(systems.indexOf(y), 1); }
    // gun: interlocks (F-16: no firing with weight on wheels; ARM needed; not after a crash)
    if (gun) { ws.inhibit = !ws.arm ? 'SAFE' : s.onGround ? 'WOW' : s.crash ? 'CRASH' : !gun.state.rounds ? 'EMPTY' : '';
      const fr = gun.step(h, ws.trigger, !ws.inhibit);
      if (fr) { const K = kinds[0], qb = s.q, pm = qrot(qb, muzzle), vm = qrot(qb, cross(s.w, muzzle)), v0 = G.round.v0;
        for (const f of fr) { const i = alloc(); if (i < 0) break; const j = 3 * i; gun.aim(dirB); const d = qrot(qb, dirB);
          for (let k = 0; k < 3; k++) { r[j + k] = s.r[k] + pm[k] + s.v[k] * f * h; v[j + k] = s.v[k] + vm[k] + d[k] * v0; }
          on[i] = 1; kind[i] = 0; team[i] = 0; age[i] = 0; born[i] = stepNo; serial++; tracer[i] = K.every && serial % K.every === 0 ? 1 : 0; gChk[i] = 0; gR[i] = 0;
          fly(i, (1 - f) * h); toW(i, w1); live++;
          // W where it left the muzzle: back along its velocity over the ground (an I point turned with this step's matrix would be off by
          // the Earth's turn since the firing time, up to ~4 m)
          const g0 = v[j] - (W1 * r[j + 2] - W2 * r[j + 1]), g1 = v[j + 1] - (W2 * r[j] - W0 * r[j + 2]), g2 = v[j + 2] - (W0 * r[j + 1] - W1 * r[j]), b = (1 - f) * h;
          w0[j] = w1[j] - (MW[0] * g0 + MW[1] * g1 + MW[2] * g2) * b; w0[j + 1] = w1[j + 1] - (MW[3] * g0 + MW[4] * g1 + MW[5] * g2) * b; w0[j + 2] = w1[j + 2] - (MW[6] * g0 + MW[7] * g1 + MW[8] * g2) * b; }
        stats.fired += fr.length; emit('fire', fr.length); }
      ws.firing = gun.state.firing; ws.rounds = gun.state.rounds; ws.spin = gun.state.spin; }
    // fly
    for (let i = 0; i < N; i++) { if (!on[i]) continue; const j = 3 * i;
      if (born[i] === stepNo) continue;   // fired in this step: already flown to the step's end
      const x0 = r[j], x1 = r[j + 1], x2 = r[j + 2]; w0[j] = w1[j]; w0[j + 1] = w1[j + 1]; w0[j + 2] = w1[j + 2];
      fly(i, h); toW(i, w1);
      // targets: segment relative to each target over the step
      let gone = false;
      for (const T of targets) { if (!T.alive || !T.r1 || (T.team === 'red' ? 1 : 0) === team[i]) continue;
        const e0 = [x0 - T.r0[0], x1 - T.r0[1], x2 - T.r0[2]], e1 = [r[j] - T.r1[0], r[j + 1] - T.r1[1], r[j + 2] - T.r1[2]];
        const span = T.size + Math.hypot(e1[0] - e0[0], e1[1] - e0[1], e1[2] - e0[2]); if (Math.hypot(...e1) > span + 1) continue;
        const u = hitBoxes(T, e0, e1); if (u < 0) continue;
        for (let k = 0; k < 3; k++) tmpW[k] = w0[j + k] + (w1[j + k] - w0[j + k]) * u;
        stats.hits++; const w = [tmpW[0], tmpW[1], tmpW[2]]; emit('hit', { target: T, w }); if (T.hit(w, kinds[kind[i]])) emit('kill', { target: T }); gone = true; break; }
      // ground: checked every step within 300 m of the last ground value, else every 8th step
      if (!gone) { const rl = Math.hypot(r[j], r[j + 1], r[j + 2]);
        if (!gR[i] || rl - gR[i] < 300 || (++gChk[i] & 7) === 0) gR[i] = groundR(i);
        if (gR[i] && rl <= gR[i]) { const r0 = Math.hypot(x0, x1, x2), u = r0 > rl ? Math.max(0, Math.min(1, (r0 - gR[i]) / (r0 - rl))) : 1;
          const w = [0, 1, 2].map(k => w0[j + k] + (w1[j + k] - w0[j + k]) * u); stats.ground++; emit('ground', { w }); gone = true; } }
      if (gone || age[i] > kinds[kind[i]].maxTime) { on[i] = 0; live--; } }
    ws.live = stats.live = live; stats.steps++;
    const ms = performance.now() - tp; stats.ms += (ms - stats.ms) * .05; stats.msMax = Math.max(stats.msMax * .995, ms); }

  // recoil: the mean force of the stream along the gun line, at the muzzle (line of action = the bore), on the craft
  function forces(st, env, acc) { for (const y of systems) if (y.forces) y.forces(st, env, acc);
    if (!gun || !gun.state.rate) return;
    const f = -gun.impulse * gun.state.rate, Fb = [gun.dir[0] * f, gun.dir[1] * f, gun.dir[2] * f], cg = st.cg || [0, 0, 0];
    const Fi = qrot(st.q, Fb); acc.F[0] += Fi[0]; acc.F[1] += Fi[1]; acc.F[2] += Fi[2];
    const M = cross([muzzle[0] - cg[0], muzzle[1] - cg[1], muzzle[2] - cg[2]], Fb); acc.M[0] += M[0]; acc.M[1] += M[1]; acc.M[2] += M[2]; }
  function hud(s, env, h) { h.gun = gun ? { arm: ws.arm, rounds: ws.rounds, firing: ws.firing, inhibit: ws.inhibit } : null; h.wsel = bus.sel;
    for (const y of systems) if (y.hud) y.hud(s, env, h); }

  // lead pipper: a round fired now along the gun line (no dispersion), shooter flying on with its present acceleration and body rates;
  // returns its direction in today's body axes when it is `range` m from the shooter's future position (steady tracking, LCOS idea), + time
  function predict(s, range) { if (!gun || s.ref !== 'Earth') return null; const K = kinds[0], dt = 1 / 60, q = s.q, w = s.w, aS = s.acc ? s.acc.F.map(x => x / s.m) : [0, 0, 0];
    const pm = qrot(q, muzzle), dv = qrot(q, gun.dir), vm = qrot(q, cross(w, muzzle)); let x = [0, 1, 2].map(k => s.r[k] + pm[k]), u = [0, 1, 2].map(k => s.v[k] + vm[k] + dv[k] * G.round.v0), t = 0;
    for (let n = 0; n < 360; n++) {
      accel(K, x[0], x[1], x[2], u[0], u[1], u[2]); const b = a3.slice(), p = x.map((c, k) => c + u[k] * dt), qv = u.map((c, k) => c + b[k] * dt);
      accel(K, p[0], p[1], p[2], qv[0], qv[1], qv[2]); x = x.map((c, k) => c + (u[k] + qv[k]) * dt / 2); u = u.map((c, k) => c + (b[k] + a3[k]) * dt / 2); t += dt;
      const sh = [0, 1, 2].map(k => s.r[k] + s.v[k] * t + .5 * aS[k] * t * t), rel = [x[0] - sh[0], x[1] - sh[1], x[2] - sh[2]], d = Math.hypot(...rel);
      if (d >= range) { const wl = Math.hypot(...w), an = wl * t / 2, sn = wl > 1e-9 ? Math.sin(an) / wl : 0, qt = qmul(q, [w[0] * sn, w[1] * sn, w[2] * sn, Math.cos(an)]);
        const b2 = qrot(qconj(qt), rel); return { dir: b2.map(c => c / d), t, v: Math.hypot(...u) }; } }
    return null; }

  // S12: a round fired by someone else (AI guns): r, v = I m, m/s at the step's start, side 'red' | 'blue'; flown from this step on (the fly
  // loop below runs after the systems); kind 1 = the M61 round with a 6 s life; tracer every `every`-th (0 = none). Returns the pool index or -1
  function shoot(r0, v0, side, every = 5) { if (!MW || !kinds.length) return -1; const i = alloc(); if (i < 0) return -1; const j = 3 * i;
    for (let k = 0; k < 3; k++) { r[j + k] = r0[k]; v[j + k] = v0[k]; }
    on[i] = 1; kind[i] = kinds.length > 1 ? 1 : 0; team[i] = side === 'red' ? 1 : 0; age[i] = 0; born[i] = 0; gChk[i] = 0; gR[i] = 0; serial++; tracer[i] = every && serial % every === 0 ? 1 : 0;
    toW(i, w1); live++; stats.redFired++; return i; }

  const module = { name: 'weapons', step, forces, hud };
  return { module, gun, kinds, targets, stats, state: ws, predict, live: () => live, pool: { on, tracer, age, w0, w1, v, r, N, kind, team },
    bus, systems, shoot, addSystem(y) { systems.push(y); return y; }, removeSystem(y) { const i = systems.indexOf(y); if (i >= 0) systems.splice(i, 1); },
    get MW() { return MW; }, emit,
    on(k, f) { (L[k] = L[k] || []).push(f); return () => { L[k] = L[k].filter(x => x !== f); }; },
    addTarget(T) { targets.push(T); return T; }, removeTarget(T) { const i = targets.indexOf(T); if (i >= 0) targets.splice(i, 1); },
    setArm(a) { ws.arm = !!a; }, toggleArm() { ws.arm = !ws.arm; return ws.arm; }, setTrigger(b) { ws.trigger = !!b; },
    reload() { if (gun) gun.reload(); ws.rounds = gun ? gun.state.rounds : 0; ws.firing = false; },
    clear() { on.fill(0); live = 0; } };
}
