/* Extra camera views for an aircraft (F-16): flyby, ground camera, onboard angles, free camera. Own code (no GPL code).
   Views follow core.js's view contract: { name, pose(P, cam, look) } with P = the draw pose (W, R⊕ units), cam = { pos, quat, fov }; earthgl
   adds the drag "look" turn to cam.quat afterwards. Ground-fixed points are kept in the Earth-fixed frame (W turned back by earthQuat) so they
   stay on the ground while the Earth turns. Ground height: F.groundAt (relief, m) + 400 m = the drawn ground (pilot mode pins relief x1).
   Keys (while piloting): 1 cockpit, 2 chase / far chase / orbit, 3 flyby, 4 onboard angles, 5 ground camera, 6 free camera;
   free camera: I / K forward / back, J / L left / right, U / O down / up, Shift x10, wheel = speed.
   Note: the earlier camera pose is in `cam` (core reuses one object); F.camera is earthgl's globe camera while the frame callbacks run. */
import { R_E, latLonOf } from './core.js?v=d29b8afa';

// F = api.flight(); core = createCore(); def = core.def; o = { bb (model-frame Box3, m), head ([x, y, z] pilot eye, m) }
export function addCameraViews(F, core, def, o) {
  const THREE = F.THREE, V3 = THREE.Vector3, D2R = Math.PI / 180, clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const qE = new THREE.Quaternion(), qEi = new THREE.Quaternion(), mT = new THREE.Matrix4(), vA = new V3(), vB = new V3(), vC = new V3(), vU = new V3();
  const earth = () => { const e = F.earthQuat; qE.set(e.x, e.y, e.z, e.w); qEi.copy(qE).invert(); };
  const look = (cam, eye, tgt, up) => { cam.pos.copy(eye); cam.quat.setFromRotationMatrix(mT.lookAt(eye, tgt, up)); };
  // drawn ground (m above the sea-level sphere) under an Earth-fixed point (R⊕ units); null while no height tile covers it
  const groundF = pF => { const [la, lo] = latLonOf([pF.x, pF.y, pF.z]), g = F.groundAt(la, lo); return g == null ? null : g + 400; };
  const hOf = pF => pF.length() * R_E - R_E;   // m above the sea-level sphere
  const lift = (pF, h) => pF.setLength((R_E + h) / R_E);

  // ── the craft's track, Earth-fixed, from the draw pose each frame (sim time: the same at any time speed)
  const trk = { pF: new V3(), vF: new V3(), t: -1, gH: 400 };   // position (R⊕), velocity (m/s), last ground height under the craft (m)
  function tick(P, t) { earth(); vA.copy(P.pos).applyQuaternion(qEi);
    const dt = (t - trk.t) / 1e3; if (trk.t >= 0 && dt > 1e-3 && dt < 2) trk.vF.lerp(vB.subVectors(vA, trk.pF).multiplyScalar(R_E / dt), .15); else if (trk.t < 0 || dt >= 2) trk.vF.set(0, 0, 0);
    if (dt > 1e-3 || trk.t < 0) { trk.pF.copy(vA); trk.t = t; }
    const g = groundF(trk.pF); if (g != null) trk.gH = g; else if (core.hud.agl != null) trk.gH = hOf(trk.pF) - core.hud.agl - (def.rest || 0); }
  // direction of travel, Earth-fixed unit vector (the nose, levelled, when slower than 3 m/s); side = to the right of it, level
  const travel = (P, out) => { if (trk.vF.length() > 3) return out.copy(trk.vF).normalize();
    vU.copy(trk.pF).normalize(); out.set(0, 0, -1).applyQuaternion(P.quat).applyQuaternion(qEi); out.addScaledVector(vU, -out.dot(vU)); return out.lengthSq() > 1e-9 ? out.normalize() : out.set(1, 0, 0); };
  const sideOf = (dir, out) => { vU.copy(trk.pF).normalize(); return out.crossVectors(dir, vU).normalize(); };
  const L = Math.max(8, o.bb.max.z - o.bb.min.z);   // craft length, m

  // ── Flyby (as in DCS): a still camera set ahead on the flight path, a little off to one side; the craft flies past it, then it jumps ahead again
  const fly = { name: 'Flyby', pF: null, seen: -1, pose(P, cam) { const now = performance.now(); earth();
    if (now - fly.seen > 300) fly.pF = null; fly.seen = now;
    const sp = trk.vF.length(), dir = travel(P, vB), cF = trk.pF;
    if (fly.pF) { const d = vA.subVectors(cF, fly.pF), dist = d.length() * R_E; if (dist > 6000 || (d.dot(dir) > 0 && dist > Math.max(300, 1.6 * fly.lead))) fly.pF = null; }
    if (!fly.pF) { const side = sideOf(dir, vC), s = Math.random() < .5 ? -1 : 1, lead = fly.lead = clamp(sp * 2.5, 60, 800), off = clamp(sp * .06, 12, 45);
      fly.pF = cF.clone().addScaledVector(dir, lead / R_E).addScaledVector(side, s * off / R_E).addScaledVector(vU.copy(cF).normalize(), (Math.random() * .8 - .2) * off / R_E); }
    const g = groundF(fly.pF) ?? trk.gH; if (hOf(fly.pF) < g + 3) lift(fly.pF, g + 3);   // never under the drawn ground
    const eye = vA.copy(fly.pF).applyQuaternion(qE), dist = eye.distanceTo(P.pos) * R_E;
    cam.fov = clamp(2 * Math.atan(3 * L / dist) / D2R, 18, 40);   // a light zoom: the craft is not a dot when it is still far
    look(cam, eye, P.pos, vU.copy(eye).normalize()); } };

  // ── Ground camera: a person on the ground beside the track, 1.8 m up, zooming so the craft keeps its size; a new spot ahead past 8 km
  const gnd = { name: 'Ground', pF: null, seen: -1, pose(P, cam) { const now = performance.now(); earth();
    if (now - gnd.seen > 300) gnd.pF = null; gnd.seen = now;
    const sp = trk.vF.length(), dir = travel(P, vB), cF = trk.pF;
    if (gnd.pF && vA.subVectors(cF, gnd.pF).length() * R_E > 8000) gnd.pF = null;
    if (!gnd.pF) { const side = sideOf(dir, vC), s = Math.random() < .5 ? -1 : 1, ahead = sp > 3 ? clamp(sp * 12, 150, 3000) : 40, off = sp > 3 ? clamp(sp * 1.5, 60, 500) : 70;
      gnd.pF = cF.clone().addScaledVector(dir, ahead / R_E).addScaledVector(side, s * off / R_E); gnd.fix = false; }
    const g = groundF(gnd.pF); if (g != null || !gnd.fix) { lift(gnd.pF, (g ?? trk.gH) + 1.8); gnd.fix = g != null; }   // until its height tile is in: the height under the craft
    const eye = vA.copy(gnd.pF).applyQuaternion(qE), dist = eye.distanceTo(P.pos) * R_E;
    cam.fov = clamp(2 * Math.atan(2 * L / dist) / D2R, 1.5, 50);   // the craft ~ 1/4 of the screen height
    look(cam, eye, P.pos, vU.copy(eye).normalize()); } };

  // ── onboard cameras, rigid to the craft: eye and aim point in the model frame (m; -Z = nose, +Y = up). Positions from the model's bounds (estimates).
  const b = o.bb, hd = o.head, cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2;
  const rigid = (name, eye, tgt, fov) => { const m = new THREE.Matrix4().lookAt(new V3(...eye), new V3(...tgt), new V3(0, 1, 0)), qL = new THREE.Quaternion().setFromRotationMatrix(m), e = new V3(...eye);
    return { name, onboard: true, pose(P, cam) { cam.pos.copy(e).multiplyScalar(1 / R_E).applyQuaternion(P.quat).add(P.pos); cam.quat.copy(P.quat).multiply(qL); cam.fov = fov; } }; };
  const onboard = [
    rigid('Tail', [cx, b.max.y + .7, b.max.z - .6], [cx, hd[1] + .2, b.min.z], 55),                                   // over the fin tip, along the spine
    rigid('Wing', [b.min.x + .5, cy + .35, b.min.z + .64 * L], [hd[0], hd[1], hd[2]], 60),                            // left wing tip, toward the canopy
    rigid('Front', [hd[0], hd[1] + .55, hd[2] - 3.2], [hd[0], hd[1] - .1, hd[2] + 1], 55),                           // over the nose, back at the canopy
    rigid('Low rear', [cx, b.min.y + .2, b.max.z + 5], [cx, cy, b.min.z + .3 * L], 50)];                                // behind and under the nozzle

  // ── Free camera: starts where the last view was; I / K, J / L, U / O move it (along the view), Shift x10, wheel = speed; Earth-fixed
  const keys = new Set(), FK = ['KeyI', 'KeyK', 'KeyJ', 'KeyL', 'KeyU', 'KeyO'];
  const free = { name: 'Free', pF: null, qF: new THREE.Quaternion(), seen: -1, speed: 40, pose(P, cam, lk) { earth(); const now = performance.now(), dt = Math.min(.1, (now - free.seen) / 1e3);
    // start = the last view's pose: cam still holds it (core reuses one cam object; F.camera is earthgl's globe camera during the frame callbacks)
    if (now - free.seen > 300) { free.pF = cam.pos.clone().applyQuaternion(qEi); free.qF.copy(qEi).multiply(cam.quat); } free.seen = now;   // look is reset on a view change
    const ax = (p, n) => (keys.has(p) ? 1 : 0) - (keys.has(n) ? 1 : 0), mv = vB.set(ax('KeyL', 'KeyJ'), ax('KeyO', 'KeyU'), ax('KeyK', 'KeyI'));
    if (mv.lengthSq()) { const q = new THREE.Quaternion().copy(free.qF); if (lk) q.multiply(lk);
      free.pF.addScaledVector(mv.normalize().applyQuaternion(q), free.speed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 10 : 1) * dt / R_E); }
    const g = groundF(free.pF) ?? trk.gH; if (hOf(free.pF) < g + 2) lift(free.pF, g + 2);
    cam.pos.copy(free.pF).applyQuaternion(qE); cam.quat.copy(qE).multiply(free.qF); } };

  // ── the view list: Cockpit, Chase, Far chase, Orbit (from the craft / gfx) + these
  const v = def.views; v.push(fly, gnd, ...onboard, free);
  const idx = x => v.indexOf(x), groups = { Digit1: [0], Digit2: [1, 2, v.findIndex(x => x.name === 'Orbit')].filter(i => i > 0), Digit3: [idx(fly)], Digit4: onboard.map(idx), Digit5: [idx(gnd)], Digit6: [idx(free)] };
  const typing = e => e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input,textarea,select,[contenteditable]');
  const onKey = e => { if (!F.piloting || core.hold || typing(e)) return;
    const gr = groups[e.code] || groups[e.code.replace('Numpad', 'Digit')];
    if (gr && e.type === 'keydown' && !e.repeat) { e.preventDefault(); const k = gr.indexOf(core.view); core.view = gr[(k + 1) % gr.length]; return; }   // again = next in the group
    if (FK.includes(e.code) || e.code.startsWith('Shift')) { if (e.type === 'keydown') { keys.add(e.code); if (v[core.view] === free && FK.includes(e.code)) e.preventDefault(); } else keys.delete(e.code); } };
  const onBlur = () => keys.clear();
  const onWheel = e => { if (!F.piloting || v[core.view] !== free) return; free.speed = clamp(free.speed * Math.exp(-Math.sign(e.deltaY) * .25), 2, 5000); };
  addEventListener('keydown', onKey); addEventListener('keyup', onKey); addEventListener('blur', onBlur); F.renderer.domElement.addEventListener('wheel', onWheel, { passive: true });
  return { tick, get freeSpeed() { return free.speed; },
    dispose() { removeEventListener('keydown', onKey); removeEventListener('keyup', onKey); removeEventListener('blur', onBlur); F.renderer.domElement.removeEventListener('wheel', onWheel); } };
}
