/* F-16 weapon stations plug-in (docs/flight-notes/weapons-contract.md, row "stations"; notes: docs/flight-notes/f16-stations.md).
   Stations 1-9 of the F-16CM-50: missiles + LAU-129 launchers on 1-3 / 7-9 from weapons/data/loadouts.json (positions: aircraft/f16.json
   stores.stations); the tanks on 4 / 5 / 6 stay with flight/stores.js and are only mirrored here (bus.stations, SMS page).
   - Wp.bus.stations, Wp.bus.release(n), Wp.bus.sel; extra: Wp.bus.pick(kind) -> next station number to fire for 'AIM-9' | 'AIM-120' (or 0).
   - mass: stores.js (frozen) knows only the tanks; this system's step runs after the craft's step (aero.js sets s.m / s.I / s.cg from the
     tanks and fuel each physics step) and adds the missiles + launchers as point masses (same model as stores.js: inertia about the body origin).
   - drag: forces() adds dCD = units x dragPerUnit(Mach) (the f16.json stores scale) along the air velocity, at each station (moment included).
   - key Minus: GUN -> AIM-9 -> AIM-120 -> GUN (types with none left are skipped). MFD page 'SMS'.
   - drawing: BMS models (tools/build_bms_missiles.py) hung on the airframe (S.gfx.model, craft frame); a released store is hidden.
   - loadout: S.load (set by the integrator from the flight menu) > URL &load=aa|clean > loadouts.json default ('aa' = A-A 2+4).
   Own code. Body frame of core: x right, y up, z aft, metres. */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const LB = 0.45359237;
const LD = await (await fetch(new URL('data/loadouts.json', import.meta.url))).json();
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const qrot = (q, v) => { const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx]; };
const KINDS = ['GUN', 'AIM-9', 'AIM-120'];
const SHORT = { 'AIM-9M': '9M', 'AIM-120C': '120C', tank370: 'TK370', tank300: 'TK300' };

export function attach(ctx) {
  const { S, core, def, Wp, bus } = ctx, J = def.json || {}, SD = J.stores || {}, ST = def.stores || null;
  const pos0 = Object.fromEntries((SD.stations || []).map(s => [s.n, s.pos]));
  const pick = () => { const u = S.load ?? new URLSearchParams(location.search).get('load'); return LD.loads[u] ? u : LD.default; };
  let loadId = pick();
  // ── missile stations of the load: { n, store, T (type), rack (type or null), att (missile attachment point), p (mass / launch point), count }
  const st = [];
  for (const [ns, type] of Object.entries(LD.loads[loadId].st)) { const n = +ns, T = LD.types[type], rk = LD.racks[ns] ? LD.types[LD.racks[ns]] : null;
    if (!T || !pos0[n]) { console.error('stations: bad load entry', ns, type); continue; }
    const att = rk ? add(pos0[n], rk.slot) : pos0[n].slice();
    st.push({ n, store: type, T, kind: T.kind, rack: rk, rp: rk ? add(pos0[n], rk.cm) : null, att, p: add(att, T.cm), m: T.lb * LB, count: 1 }); }
  st.sort((a, b) => a.n - b.n);
  const fireOrder = LD.fireOrder;

  // ── bus: the missile stations + the tanks of stores.js (mirrored, read-only here)
  function publish() { const s = core.state, so = s && s.sys && s.sys.stores, out = [];
    for (const x of st) out.push({ n: x.n, store: x.store, count: x.count, pos: x.p.slice(), mass: x.count ? x.m : 0 });
    if (ST && so) ST.items.forEach((it, k) => out.push({ n: it.n, store: it.type, count: so.on[k] ? 1 : 0, pos: it.p.slice(), mass: so.on[k] ? it.m0 + (it.tank >= 0 ? s.sys.fuel[it.tank] : 0) : 0 }));
    out.sort((a, b) => a.n - b.n); bus.stations = out; }
  const left = kind => st.reduce((a, x) => a + (x.kind === kind ? x.count : 0), 0);
  bus.pick = kind => { for (const n of fireOrder[kind] || []) { const x = st.find(y => y.n === n && y.kind === kind && y.count > 0); if (x) return n; } return 0; };
  bus.release = n => { const x = st.find(y => y.n === n); if (!x || x.count <= 0) return null;
    x.count--; stats.released++; publish(); show(); return { store: x.store, pos: x.p.slice() }; };
  function reload() { for (const x of st) x.count = 1; publish(); show(); }

  // ── mass + inertia: added after the craft's step set s.m / s.I / s.cg from the tanks (if that step did not run, the last base is reused)
  let base = null, mine = null;
  function sums() { const a = { m: 0, x: 0, y: 0, z: 0, r: 0, p: 0, w: 0 };
    const pm = (m, p) => { a.m += m; a.x += m * p[0]; a.y += m * p[1]; a.z += m * p[2]; a.r += m * (p[0] * p[0] + p[1] * p[1]); a.p += m * (p[1] * p[1] + p[2] * p[2]); a.w += m * (p[0] * p[0] + p[2] * p[2]); };
    for (const x of st) { if (x.count) pm(x.m, x.p); if (x.rack) pm(x.rack.lb * LB, x.rp); }
    return a; }
  function massStep(s) {
    if (!(mine && s.I === mine)) base = { m: s.m, I: s.I, cg: s.cg || [0, 0, 0] };   // fresh values from aero.js this step
    const a = sums(), B = base, m = B.m + a.m, I = B.I;
    s.m = m; s.cg = [(B.m * B.cg[0] + a.x) / m, (B.m * B.cg[1] + a.y) / m, (B.m * B.cg[2] + a.z) / m];
    s.I = mine = [[I[0][0] + a.p, I[0][1], I[0][2]], [I[1][0], I[1][1] + a.w, I[1][2]], [I[2][0], I[2][1], I[2][2] + a.r]];
    stats.added = a.m; }

  // ── drag: per store, along the air velocity, at its mass point (moment about the CG)
  const [m0, m1] = SD.dragMach || [.9, 1], [k0, k1] = SD.dragPerUnit || [1e-4, 2.83e-4], Sw = (J.geometry && J.geometry.S) || 27.87;
  function forces(s, env, acc) { if (!env.aero || !env.vAir) return; const V = env.aero.vTas; if (V < 1) return;
    const t = Math.max(0, Math.min(1, (env.aero.mach - m0) / (m1 - m0))), k = (k0 + (k1 - k0) * t) * env.aero.qbar * Sw;
    const vb = qrot([-s.q[0], -s.q[1], -s.q[2], s.q[3]], env.vAir), cg = s.cg || [0, 0, 0]; let u = 0;
    for (const x of st) { const ux = (x.count ? x.T.drag : 0) + (x.rack ? x.rack.drag : 0); if (!ux) continue; u += ux;
      const f = -k * ux / V, Fb = [vb[0] * f, vb[1] * f, vb[2] * f], M = cross([x.p[0] - cg[0], x.p[1] - cg[1], x.p[2] - cg[2]], Fb);
      acc.M[0] += M[0]; acc.M[1] += M[1]; acc.M[2] += M[2]; }
    if (!u) return; const f = -k * u / V, Fi = [env.vAir[0] * f, env.vAir[1] * f, env.vAir[2] * f];
    acc.F[0] += Fi[0]; acc.F[1] += Fi[1]; acc.F[2] += Fi[2]; stats.units = u; }

  const stats = { load: loadId, added: 0, units: 0, released: 0, loadMs: 0, tris: 0, models: 0 };
  const sys = Wp.addSystem({ name: 'stations', step(s) { massStep(s); }, forces,
    hud(s, env, h) { publish(); h.sms = { sel: bus.sel, aim9: left('AIM-9'), aim120: left('AIM-120'), load: LD.loads[loadId].name }; } });
  publish();

  // ── weapon select (Minus): GUN -> AIM-9 -> AIM-120 -> GUN, skipping types with none left
  ctx.key('Minus', ['-', 'Weapon select: GUN / AIM-9 / AIM-120'], () => {
    let i = KINDS.indexOf(bus.sel); for (let k = 0; k < KINDS.length; k++) { i = (i + 1) % KINDS.length; if (KINDS[i] === 'GUN' || left(KINDS[i]) > 0) break; }
    bus.sel = KINDS[i]; });

  // ── SMS page: planform row of stations 1-9, counts, selected weapon, master arm
  const FONT = 'system-ui, sans-serif', MONO = 'ui-monospace, Consolas, monospace';
  const sms = (x, h) => {
    const arm = !!(Wp.state && Wp.state.arm), W = 512; x.textBaseline = 'middle';
    x.textAlign = 'left'; x.font = `700 30px ${FONT}`; x.fillStyle = arm ? '#FFB347' : '#39FF9E'; x.fillText(arm ? 'MASTER ARM' : 'SAFE', 24, 82);
    x.textAlign = 'right'; x.fillStyle = '#B8C2CC'; x.font = `600 22px ${FONT}`; x.fillText(LD.loads[loadId].name, W - 24, 82);
    // selected weapon
    const sel = bus.sel, cnt = sel === 'GUN' ? (Wp.state ? Wp.state.rounds : 0) : left(sel);
    x.textAlign = 'center'; x.font = `700 46px ${MONO}`; x.fillStyle = '#F2F4F6'; x.fillText(sel === 'GUN' ? 'GUN' : sel === 'AIM-9' ? 'AIM-9M' : 'AIM-120C', W / 2, 150);
    x.font = `700 30px ${MONO}`; x.fillStyle = cnt ? '#39FF9E' : '#FF5A5A'; x.fillText(String(cnt) + (sel === 'GUN' ? ' RDS' : ' LEFT'), W / 2, 196);
    // stations: boxes left (1) to right (9), heights by span position (wing tips higher)
    const all = bus.stations || [], bw = 50, gap = 4, x0 = (W - 9 * bw - 8 * gap) / 2;
    for (let n = 1; n <= 9; n++) { const e = all.find(q => q.n === n), cx = x0 + (n - 1) * (bw + gap), y = 250 + Math.abs(5 - n) * -6 + 30;
      const kind = e && LD.types[e.store] ? LD.types[e.store].kind : null, hot = e && e.count && kind === sel;
      x.strokeStyle = hot ? '#39FF9E' : '#5D6878'; x.lineWidth = hot ? 3 : 1.5; x.strokeRect(cx, y, bw, 96);
      x.fillStyle = '#9AA4B2'; x.font = `600 20px ${FONT}`; x.fillText(String(n), cx + bw / 2, y - 16);
      x.fillStyle = !e ? '#5D6878' : e.count ? '#F2F4F6' : '#FF5A5A'; x.font = `700 ${e && SHORT[e.store] && SHORT[e.store].length > 4 ? 13 : 17}px ${MONO}`;
      x.fillText(e ? (SHORT[e.store] || e.store) : '-', cx + bw / 2, y + 34); x.font = `700 22px ${MONO}`; x.fillText(e ? String(e.count) : '', cx + bw / 2, y + 68); }
    // totals
    x.textAlign = 'left'; x.font = `600 24px ${FONT}`; x.fillStyle = '#7FD8FF';
    x.fillText(`AIM-9 ${left('AIM-9')}   AIM-120 ${left('AIM-120')}   GUN ${Wp.state ? Wp.state.rounds : 0}`, 24, 420);
    x.fillStyle = '#5D6878'; x.font = `600 20px ${FONT}`; x.textAlign = 'center'; x.fillText('- = WEAPON SELECT', W / 2, 456); };
  ctx.mfdPage('SMS', sms);

  // ── drawing: one prototype per model (PBR from its 512 texture set), hung on the airframe
  const gfx = S.gfx, hung = [], proto = {}, protoP = {};
  function loadModel(name) { if (protoP[name]) return protoP[name];
    const THREE = ctx.F.THREE, dir = new URL('../models/f16-stores/', import.meta.url), tl = new THREE.TextureLoader(), waits = [];
    return (protoP[name] = new GLTFLoader().loadAsync(new URL(name + '.glb', dir).href).then(async g => { const ex = g.userData || {}, lo = ex.uvLo ?? -.001, span = ex.uvSpan ?? 1.002;
      const aniso = Math.min(8, ctx.F.renderer.capabilities.getMaxAnisotropy());
      const T = (f, srgb) => { let ok; waits.push(new Promise(r => { ok = r; })); const t = tl.load(new URL('tex/' + name + '_' + f, dir).href, ok, undefined, e => { console.warn('store texture', name, f, e); ok(); });
        t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(span, span); t.offset.set(lo, lo); t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
      const orm = T('orm.jpg'), m = new THREE.MeshStandardMaterial({ map: T('alb.jpg', true), normalMap: T('nrm.jpg'), aoMap: orm, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, aoMapIntensity: .8 });
      m.name = 'store_' + name; const glass = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: .08, metalness: .2, name: 'store_glass' });   /* DirectX normal maps, as the airframe */
      g.scene.traverse(n => { if (n.isMesh) { n.material = /glass/i.test(n.material.name || '') ? glass : m; n.castShadow = n.receiveShadow = true;
        stats.tris += (n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3; } });
      await Promise.all(waits); stats.models++; return (proto[name] = g.scene); })); }
  function show() { for (const h of hung) if (h.x && !h.rack) h.obj.visible = h.x.count > 0; }
  let gone = false;
  if (gfx && gfx.model) { const t0 = performance.now();
    Promise.all(st.flatMap(x => [x.rack ? loadModel(x.rack.model).then(p => ({ x, p, rack: true })) : null, loadModel(x.T.model).then(p => ({ x, p, rack: false }))].filter(Boolean)))
      .then(list => { if (gone) return; for (const { x, p, rack } of list) { const o = p.clone(); o.position.set(...(rack ? pos0[x.n] : x.att)); o.name = (rack ? 'rack' : 'store') + x.n; gfx.model.add(o); hung.push({ obj: o, x, rack }); }
        show(); stats.loadMs = performance.now() - t0; }).catch(e => console.error('stations: models', e)); }

  // reset button of the flight UI (session.js resets the gun the same way): full load again
  const onClick = e => { if (e.target.closest && e.target.closest('[data-a="reset"]')) reload(); };
  if (ctx.ui) ctx.ui.addEventListener('click', onClick);

  return { stats, st, reload, publish, sms, loads: LD.loads, get load() { return loadId; },
    // a clone of a store model (for the missiles plug-in: same origin = the attachment point); Promise
    model: name => loadModel(name).then(p => p.clone()),
    dispose() { gone = true; Wp.removeSystem(sys); if (ctx.ui) ctx.ui.removeEventListener('click', onClick); for (const h of hung) h.obj.removeFromParent(); hung.length = 0;
      delete bus.release; delete bus.pick; bus.stations = []; bus.sel = 'GUN'; } };
}
