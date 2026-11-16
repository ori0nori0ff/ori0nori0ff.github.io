/* Drawing of the external stores (flight/stores.js): the BMS tank / pylon models (models/f16-stores/, tools/build_bms_stores.py) hung on
   their stations of the airframe, and jettisoned stores as falling bodies (simple ballistic flight in the Earth-fixed frame: point-mass
   gravity, Coriolis + centrifugal, drag 0.5 rho v^2 cdA; turned nose into the wind; removed on ground contact or after 300 s).
   createStoresGfx(F, core, gfx, { scene }) -> { update(P, t), dispose(), stats }; session.js calls update from the pose callback. */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { R_E, GM_E, latLonOf } from './core.js?v=d29b8afa';
import { atmosphere } from './atmos.js?v=7ee6d1db';

const OMEGA = 7.2921159e-5, EJECT = 3, LIFE = 300, TAU = .7;   // Earth turn (rad/s, about +y of the Earth-fixed frame); ejection speed (m/s, ESTIMATE); s; nose-into-wind time (s, ESTIMATE)
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], len = a => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const qrot = (q, v) => { const t = mul(cross(q, v), 2); return add(add(v, mul(t, q[3])), cross(q, t)); };

export async function createStoresGfx(F, core, gfx, o) {
  const THREE = F.THREE, ST = core.def.stores, cs = o.scene, stats = { loadMs: 0, tris: 0, falling: 0, landed: 0 };
  if (!ST || !gfx || !gfx.model) return null;
  const t0 = performance.now(), dir = new URL('models/f16-stores/', import.meta.url), tl = new THREE.TextureLoader();
  const aniso = Math.min(8, F.renderer.capabilities.getMaxAnisotropy()), proto = {}, waits = [];
  // one prototype per model: PBR material from its 1024 texture set (stored uv = (uv - lo) / span -> repeat span, offset lo)
  async function loadModel(name) { if (proto[name]) return proto[name];
    const g = await new GLTFLoader().loadAsync(new URL(name + '.glb', dir).href), ex = g.userData || {}, lo = ex.uvLo ?? -.001, span = ex.uvSpan ?? 1.002;
    const T = (f, srgb) => { let ok; waits.push(new Promise(r => { ok = r; })); const t = tl.load(new URL('tex/' + name + '_' + f, dir).href, ok, undefined, e => { console.warn('store texture', name, f, e); ok(); });
      t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(span, span); t.offset.set(lo, lo); t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    const orm = T('orm.jpg'), m = new THREE.MeshStandardMaterial({ map: T('alb.jpg', true), normalMap: T('nrm.jpg'), aoMap: orm, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, aoMapIntensity: .8 });
    m.normalScale.set(1, 1); m.name = 'store_' + name;   /* DirectX normal maps, as the airframe */
    g.scene.traverse(n => { if (n.isMesh) { n.material = m; n.castShadow = n.receiveShadow = true; stats.tris += (n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3; } });
    return (proto[name] = g.scene); }
  // attached: one object per load item (+ its rack), in the airframe's frame (craft frame, metres)
  const hung = [];
  for (const it of ST.items) {
    if (it.rack) { const r = (await loadModel(it.rack.S.model)).clone(); r.position.set(...ST.stations.find(s => s.n === it.n).p); gfx.model.add(r); hung.push({ obj: r, rack: true }); }
    const ob = (await loadModel(it.S.model)).clone(); ob.position.set(...it.slot); gfx.model.add(ob); hung.push({ obj: ob, it }); }
  await Promise.all(waits); stats.loadMs = performance.now() - t0;

  // falling stores: state in the Earth-fixed frame F (m, m/s), drawn in W (= earthQuat x F, units R_E)
  const falling = []; let seen = 0, tLast = null;
  const qE = new THREE.Quaternion(), qB = new THREE.Quaternion(), qS = new THREE.Quaternion(), vN = new THREE.Vector3(), vV = new THREE.Vector3();
  function spawn(d) { const P = core.fixedPose(), cmB = add(d.slot, d.cm), qf = P.qf;
    const r = add(P.f, qrot(qf, cmB)), v = add(add(P.vf, qrot(qf, cross(P.wb, cmB))), qrot(qf, [0, -EJECT, 0]));
    const g = new THREE.Group(); g.scale.setScalar(1 / R_E); const m = proto[d.model].clone(); m.position.set(-d.cm[0], -d.cm[1], -d.cm[2]); g.add(m); cs.add(g);
    falling.push({ d, r, v, q: new THREE.Quaternion(qf[0], qf[1], qf[2], qf[3]), g, age: 0 }); }
  function fly(b, dt) { const r = b.r, v = b.v, rl = len(r), w = [0, OMEGA, 0];
    const air = atmosphere(rl - R_E - 400), V = len(v), kD = .5 * air.rho * V * b.d.cdA / Math.max(b.d.mass, 1);
    const a = add(add(mul(r, -GM_E / (rl * rl * rl)), mul(cross(w, v), -2)), add(mul(cross(w, cross(w, r)), -1), mul(v, -kD)));
    b.v = add(v, mul(a, dt)); b.r = add(r, mul(b.v, dt));
    if (V > 1) { vN.set(0, 0, -1).applyQuaternion(b.q); vV.set(v[0] / V, v[1] / V, v[2] / V); qS.setFromUnitVectors(vN, vV); qB.identity().slerp(qS, 1 - Math.exp(-dt / TAU)); b.q.premultiply(qB).normalize(); } }
  function update(P, t) {
    const S = core.state.sys.stores; if (!S) return;
    for (const h of hung) if (h.it) h.obj.visible = S.on[ST.items.indexOf(h.it)];
    if (S.drops.length < seen) seen = 0;   // reset: a new list
    while (seen < S.drops.length) { const d = S.drops[seen++]; if (proto[d.model]) spawn(d); }
    let dt = tLast == null ? 0 : (t - tLast) / 1000; tLast = t;
    if (dt < 0 || dt > 5) { for (const b of falling) b.dead = true; dt = 0; }   // the clock jumped: drop them
    qE.copy(F.earthQuat);
    for (const b of falling) { if (b.dead) continue; const n = Math.ceil(dt / .01); for (let i = 0; i < n; i++) fly(b, dt / n); b.age += dt;
      const [la, lo] = latLonOf(b.r), gH = F.groundAt(la, lo) ?? b.gLast; b.gLast = gH;   // no height tile here: the last known ground
      if (b.age > LIFE || (gH != null && len(b.r) - R_E - (gH + 400) < .4)) { b.dead = true; if (b.age <= LIFE) stats.landed++; continue; }
      b.g.position.set(b.r[0] / R_E, b.r[1] / R_E, b.r[2] / R_E).applyQuaternion(qE); b.g.quaternion.copy(qE).multiply(b.q); }
    for (let i = falling.length - 1; i >= 0; i--) if (falling[i].dead) { cs.remove(falling[i].g); falling.splice(i, 1); }
    stats.falling = falling.length; }
  function dispose() { for (const b of falling) cs.remove(b.g); falling.length = 0; for (const h of hung) h.obj.removeFromParent();
    for (const k in proto) proto[k].traverse(n => { if (n.isMesh) { n.geometry.dispose(); const m = n.material; for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); } }); }
  return { update, dispose, stats, falling, hung };
}
