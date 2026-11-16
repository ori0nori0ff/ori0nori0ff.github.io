/* Test drone for the gun (flight/weapons): a target that flies a fixed circle near LRBV and falls when killed. Own code, plain shapes.
   Size after the BQM-167A Skeeter aerial target (public data: length ~6.1 m, span ~3.4 m); colour red / white as target drones.
   Alive: kinematic (exact circle at a constant height over the sea and a constant speed, banked for a level turn tan(phi) = V^2 / (g R)).
   Killed: a point mass with gravity + drag (cd A ESTIMATE, terminal speed ~55 m/s) and a slow roll; smoke trail; on the ground it stops
   (and turns with the Earth from then on).
   Hit points: `hp` hits of the 20 mm TP round (game value, not a damage model). Positions in the core's frame I (metres, doubles); drawn as an
   ordinary Object3D at its W position (S0a rule: no world coordinates in vertices). */
import { R_E, GM_E, OMEGA_I, fromF, toF, qIF, qFromBasis } from '../core.js?v=d29b8afa';
import { atmosphere } from '../atmos.js?v=7ee6d1db';
import { qmul, qconj } from './weapons.js?v=98af5389';

const D2R = Math.PI / 180, G0 = 9.80665;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], len = a => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], unit = a => mul(a, 1 / len(a));
const enu = (la, lo) => [[-Math.sin(lo), 0, -Math.cos(lo)], [-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo)], [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)]];

// o = { lat, lon (deg, circle centre), hMSL (m), radius (m), speed (m/s), hp, phase (rad: start point, 0 = north of the centre) }
export function createDrone(F, o) {
  const THREE = F.THREE, la = o.lat * D2R, lo = o.lon * D2R, [E, Nn, U] = enu(la, lo), Rad = R_E + 400 + o.hMSL, Rc = o.radius, V = o.speed, om = V / Rc;
  const bank = Math.atan(V * V / (G0 * Rc));
  const T = { name: 'drone', alive: true, dead: false, hp: o.hp, hits: 0, boxes: [{ c: [0, 0, 0], h: [.33, .33, 3.05] }, { c: [0, 0, .6], h: [1.7, .08, .5] }, { c: [0, .55, 2.7], h: [.05, .6, .35] }],
    size: 3.6, team: 'red', rcs: 1, ir: .3,   // signatures for radar / IR seekers (docs/flight-notes/weapons-contract.md): rcs m^2, ir relative to a fighter in MIL = 1 (both ESTIMATE)
    r0: null, r1: null, q1: [0, 0, 0, 1], v: [0, 0, 0], t0: null, fall: null, smoke: 0, cfg: o, onGround: false };
  // the circle (Earth-fixed F): position and velocity at time t (ms) relative to the spawn time
  function circ(t) { const ph = (o.phase || 0) + om * (t - T.t0) / 1e3, c = Math.cos(ph), s = Math.sin(ph);
    const p = unit(add(U, add(mul(E, Rc * s / Rad), mul(Nn, Rc * c / Rad)))), up = p;
    const fw = unit(add(mul(E, c), mul(Nn, -s))), rad = unit(add(mul(E, s), mul(Nn, c)));   // clockwise seen from above: centre on the right
    const Y = unit(add(mul(up, Math.cos(bank)), mul(rad, -Math.sin(bank)))), Z = mul(fw, -1), X = cross(Y, Z);
    return { f: mul(p, Rad), vf: mul(fw, V), qf: qFromBasis(X, Y, Z) }; }
  // I state of the circle point at t
  function onCircle(t) { const c = circ(t), r = fromF(t, c.f), v = add(fromF(t, c.vf), cross(OMEGA_I, r)), q = qmul(qconj(qIF(t)), c.qf); return { r, v, q }; }
  // W (Earth-fixed world, metres) of the step's end with MW = I -> W at that time; the step's start = the last end (first step: back by the
  // velocity over the ground). W is interpolated for drawing, as the craft (an I position turned with another time's matrix would sit
  // up to ~4 m off: the Earth turns 7.3e-5 rad/s x 6.4e6 m x 1/120 s)
  const mv = (M, x) => [M[0] * x[0] + M[1] * x[1] + M[2] * x[2], M[3] * x[0] + M[4] * x[1] + M[5] * x[2], M[6] * x[0] + M[7] * x[1] + M[8] * x[2]];
  function toWorld(MW, h) { T.w1 = mv(MW, T.r1); T.w0 = T.wNext || add(T.w1, mul(mv(MW, add(T.v, mul(cross(OMEGA_I, T.r1), -1))), -h)); T.wNext = T.w1;
    const qw = qmul(MWq(MW), T.q1); T.wq0 = T.wq1 || qw; T.wq1 = qw; }
  const MWq = M => qFromBasis([M[0], M[3], M[6]], [M[1], M[4], M[7]], [M[2], M[5], M[8]]);   // I -> W as a quaternion (MW holds earthgl's turn)
  // ── per physics step (called by the weapons step): t0 = the step's start (ms), h (s), MW = I -> W (metres) at the step's end
  T.step = (t0, h, env, MW) => {
    if (T.t0 == null) T.t0 = t0;
    const t1 = t0 + h * 1e3;
    if (!T.fall) { const a = T.r1 ? null : onCircle(t0), b = onCircle(t1); T.r0 = T.r1 || a.r; T.r1 = b.r; T.v = b.v; T.q1 = b.q; toWorld(MW, h); return; }
    // falling: Heun, gravity + drag against the turning air (no wind), a roll of 90 deg/s
    T.r0 = T.r1.slice(); if (T.onGround) { T.r1 = fromF(t1, T.fGround); T.v = cross(OMEGA_I, T.r1); toWorld(MW, h); return; }   // the wreck turns with the Earth
    const acc = (r, v) => { const rl = len(r), A = atmosphere(rl - R_E - 400), va = add(v, mul(cross(OMEGA_I, r), -1)), Va = len(va);
      return add(mul(r, -GM_E / (rl * rl * rl)), mul(va, -.5 * A.rho * T.fall.cdA / T.fall.m * Va)); };
    const a1 = acc(T.r1, T.v), p = add(T.r1, mul(T.v, h)), q = add(T.v, mul(a1, h)), a2 = acc(p, q);
    T.r1 = add(T.r1, mul(add(T.v, q), h / 2)); T.v = add(T.v, mul(add(a1, a2), h / 2));
    const roll = 90 * D2R * h, qr = [0, 0, Math.sin(roll / 2), Math.cos(roll / 2)]; T.q1 = qmul(T.q1, qr);
    // ground: relief + 400 m (as the core); stop there
    const f = toF(t1, T.r1), fl = len(f), g = F.groundAt(Math.asin(f[1] / fl), Math.atan2(-f[2], f[0]));
    if (g != null && fl <= R_E + 400 + g) { T.fGround = mul(f, (R_E + 400 + g + .3) / fl); T.r1 = fromF(t1, T.fGround); T.v = cross(OMEGA_I, T.r1); T.onGround = true; T.tGround = t1; T.impact = true; }
    toWorld(MW, h); };
  // a hit: true when it kills
  T.hit = () => { if (!T.alive) return false; T.hits++; if (T.hits < T.hp) return false;
    T.alive = false; T.fall = { m: 150, cdA: .9 }; return true; };   // ESTIMATE: ~150 kg, cd A 0.9 m² tumbling -> ~55 m/s terminal at 1 km (measured 49-53 m/s)
  // ── drawing: a plain shape (red / white), W pose from the I state at the core's draw time
  const g = new THREE.Group(); g.scale.setScalar(1 / R_E); g.visible = false;
  const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: .5, metalness: .1 });
  const red = mat(0xd8261c), wht = mat(0xe8e8e8), dark = mat(0x2a2d33);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, 4.6, 16), red); body.rotation.x = Math.PI / 2; g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(.3, 1.1, 16), wht); nose.rotation.x = -Math.PI / 2; nose.position.z = -2.85; g.add(nose);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(3.4, .08, .9), wht); wing.position.z = .6; g.add(wing);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(.06, 1.1, .7), red); fin.position.set(0, .55, 2.6); g.add(fin);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.4, .05, .5), red); tail.position.set(0, 0, 2.7); g.add(tail);
  const eng = new THREE.Mesh(new THREE.CylinderGeometry(.22, .25, 1.4, 12), dark); eng.position.set(0, .45, 1.7); eng.rotation.x = Math.PI / 2; g.add(eng);
  T.object = g;
  T.dispose = () => { g.traverse(n => { if (n.geometry) n.geometry.dispose(); }); for (const m of [red, wht, dark]) m.dispose(); };
  return T;
}
