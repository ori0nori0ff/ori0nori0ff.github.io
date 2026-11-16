/* Buildings on the 3D Earth close to the ground: OpenStreetMap footprints (OpenFreeMap z14 vector tiles, layer `building`; same host as
   nightosm.js, no key) drawn either as a real house model or as a plain extruded building.

   - Models (inside Romania only): Arma Reforger house types (Bohemia Interactive; the ones the user placed at Râșnov, used with the user's
     permission), baked by tools/build_houses.py into models/houses/<type>.glb (3 detail levels) + index.json (footprint w x d, height,
     L-shape data). Per footprint: minimum-area rectangle -> long axis, length L, width W; the type whose footprint is within -13 % / +15 % in
     both directions (and whose L-shape share fits) is placed on it, turned to the long axis, scaled to fit. An L-shaped type is turned and
     mirrored so its wing lies on the same side as the footprint's (centroid offset). Ties broken by a hash, so a street gets some variety.
   - Everything else (no type fits, building parts, outside Romania): walls along the footprint up to OSM render_height; near-rectangular small
     buildings get a gable roof along the long axis (~35 deg, an ESTIMATE), the rest a flat roof. Wall / roof colours: OSM `colour` if set,
     else a hash pick from common plaster and tile colours (ESTIMATE). A window grid (2.9 m floors, 3.1 m bays; ESTIMATE) is dark glass by
     day and partly lit at night.
   Ideas for the fitting rules after fableflight src/buildings.rs (github.com/Rolandjg/fableflight, author allows use; see docs/flight-plan.md):
   rectangle fit of the footprint, roof shape by size and shape, height from the OSM tags. No code copied.

   Heights: the drawn ground = relief x ex + 400 m (groundAt, CLAUDE.md "Heights"), taken at the footprint's centre; the models have a
   buried foundation (to -4 m), the extruded walls go 3 m below. Lighting through earthgl's shade() like airfield.js / veg.js.
   The LRBV airport buildings stay with airfield.js (its box is skipped here). Off: localStorage aurora.bld = 'off' (⚙ checkbox).
   Romania outline: a coarse 40-point polygon (ESTIMATE, a few km off at the borders). */

import { decodeMvt } from './nightosm.js?v=b082f45d';

const ZC = 14, R = 6371000, URL0 = 'https://tiles.openfreemap.org/planet/latest/';
// r = drawn out to (slant distance, m); l0 / l1 = detail level 0 / 1 out to (m); ms = cell build time per frame
const QP = { low: { r: 3000, l0: 90, l1: 380, ms: 3 }, medium: { r: 5000, l0: 130, l1: 520, ms: 4 }, high: { r: 7000, l0: 170, l1: 700, ms: 5 } };
const MAXF = 4, ALT = 30000;   // downloads at once; nothing requested or drawn above this height, m
const LRBV = { la: 45.70625, lo: 25.5235, box: [-800, 1300, -1900, 300] };   // airfield.js draws these (tools/build_bms_airport.py AIRPORTS)
const RO = [[20.26, 46.12], [20.76, 46.27], [21.18, 46.40], [21.66, 46.95], [21.99, 47.39], [22.03, 47.55], [22.60, 47.77], [22.90, 47.96],
  [23.50, 48.00], [24.00, 47.96], [24.65, 47.95], [24.95, 47.74], [25.65, 47.93], [26.20, 48.03], [26.62, 48.26], [27.25, 47.85],
  [27.80, 47.25], [28.15, 46.85], [28.25, 46.40], [28.10, 45.95], [28.20, 45.47], [28.75, 45.30], [29.40, 45.43], [29.70, 45.20],
  [29.65, 44.80], [28.95, 44.35], [28.62, 43.74], [27.95, 43.98], [27.27, 44.12], [26.10, 43.98], [25.36, 43.62], [24.50, 43.70],
  [23.40, 43.85], [22.94, 43.98], [22.60, 44.20], [22.68, 44.60], [22.40, 44.72], [21.38, 44.81], [21.50, 45.15], [20.70, 45.75]];
function inRO(lo, la) {
  let c = false;
  for (let i = 0, j = RO.length - 1; i < RO.length; j = i++) { const [xi, yi] = RO[i], [xj, yj] = RO[j];
    if ((yi > la) !== (yj > la) && lo < (xj - xi) * (la - yi) / (yj - yi) + xi) c = !c; }
  return c;
}
function hash(a, b, c) {   // three integers -> [0, 1)
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── footprint geometry: area / centroid (shoelace), convex hull (monotone chain), minimum-area rectangle (one hull edge on a side)
function areaC(r) {   // r = [x0, y0, x1, y1, ...] closed or open; -> [signed area, cx, cy]
  let a = 0, cx = 0, cy = 0; const n = r.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n, x0 = r[2 * i], y0 = r[2 * i + 1], x1 = r[2 * j], y1 = r[2 * j + 1], c = x0 * y1 - x1 * y0;
    a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c; }
  a /= 2; return Math.abs(a) < 1e-9 ? [0, r[0], r[1]] : [a, cx / (6 * a), cy / (6 * a)];
}
function hull(r) {
  const p = []; for (let i = 0; i < r.length; i += 2) p.push([r[i], r[i + 1]]);
  p.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const q of p) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function mar(r) {
  const H = hull(r); let best = null;
  for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-6) continue;
    const ux = (b[0] - a[0]) / l, uy = (b[1] - a[1]) / l; let s0 = 1e9, s1 = -1e9, t0 = 1e9, t1 = -1e9;
    for (const q of H) { const s = q[0] * ux + q[1] * uy, t = -q[0] * uy + q[1] * ux; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const A = (s1 - s0) * (t1 - t0); if (!best || A < best.A) best = { A, ux, uy, s0, s1, t0, t1 }; }
  if (!best) return null;
  let { ux, uy, s0, s1, t0, t1 } = best;
  if (t1 - t0 > s1 - s0) { [ux, uy] = [-uy, ux]; [s0, s1, t0, t1] = [t0, t1, -s1, -s0]; }   // u = the long axis
  const sm = (s0 + s1) / 2, tm = (t0 + t1) / 2;
  return { L: s1 - s0, W: t1 - t0, ux, uy, cx: sm * ux - tm * uy, cy: sm * uy + tm * ux, A: best.A };
}

export function createBuildings({ THREE, Q, SHADE, U, groundAt, renderer, off: off0, skip }) {   // skip = { covers(la, lo), ver }: MSFS airport buildings (msfsair.js)
  const P = QP[Q] || QP.medium;
  let off = !!off0; try { off = off || localStorage.getItem('aurora.bld') === 'off'; } catch (e) {}
  const base = new URL('.', import.meta.url);
  const cells = new Map(), texs = new Map(), buckets = new Map();
  let types = null, frame = 0, inflight = 0, job = null, dirty = true, skipVer = 0;
  const camA = new THREE.Vector3(), lastCam = new THREE.Vector3(1e9, 0, 0), A = new THREE.Vector3(), lastEx = { v: 0 };
  const uCV = { value: new THREE.Vector3() }, uA = { value: new THREE.Vector3() };
  if (!off) fetch(new URL('models/houses/index.json', base)).then(r => r.json()).then(j => {
    types = j.types.map((t, i) => ({ ...t, i, longX: t.w >= t.d, tL: Math.max(t.w, t.d), tW: Math.min(t.w, t.d),
      qL: t.w >= t.d ? t.qx : t.qz, qW: t.w >= t.d ? t.qz : t.qx, lv: null, asked: false })); }).catch(() => { types = []; });

  // ── a house type: its GLB (minimal glTF reader: our own files, see tools/build_houses.py) -> per level a list of { geo, mat }
  const CT = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array, 5120: Int8Array };
  const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  function texOf(uri) {
    let t = texs.get(uri); if (t) return t;
    t = new THREE.TextureLoader().load(new URL('models/houses/' + uri, base).href);
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    texs.set(uri, t); return t;
  }
  function loadType(t) {
    t.asked = true;
    fetch(new URL('models/houses/' + t.file, base)).then(r => { if (!r.ok) throw r.status; return r.arrayBuffer(); }).then(ab => {
      const dv = new DataView(ab), jl = dv.getUint32(12, true), g = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, jl))), b0 = 20 + jl + 8;
      const acc = k => { const a = g.accessors[k], v = g.bufferViews[a.bufferView], C = CT[a.componentType], n = NC[a.type], st = v.byteStride ? v.byteStride / C.BYTES_PER_ELEMENT : n;
        const arr = new C(ab, b0 + (v.byteOffset || 0), a.count * st);
        if (st !== n) return new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(arr, st), n, 0, !!a.normalized);
        return new THREE.BufferAttribute(arr, n, !!a.normalized); };
      const mats = g.materials.map(m => { const pb = m.pbrMetallicRoughness || {}, ti = pb.baseColorTexture ? g.textures[pb.baseColorTexture.index].source : -1;
        return { tex: ti >= 0 ? texOf(g.images[ti].uri) : null, base: pb.baseColorFactor || [1, 1, 1, 1], glass: !!(m.extras && m.extras.glass), inner: !!(m.extras && m.extras.interior) }; });
      t.lv = g.meshes.map(me => me.primitives.map(p => {
        const geo = new THREE.BufferGeometry(), at = p.attributes;
        geo.setAttribute('position', acc(at.POSITION)); geo.setAttribute('normal', acc(at.NORMAL)); geo.setAttribute('uv', acc(at.TEXCOORD_0));
        if (at.COLOR_0 != null) geo.setAttribute('col', acc(at.COLOR_0));
        geo.setIndex(acc(p.indices)); return { geo, mat: mats[p.material], col: at.COLOR_0 != null }; }));
      dirty = true; }).catch(() => { t.lv = []; });
  }

  // instanced model shader: per instance i0 = offset from the anchor A (m, Earth frame) + x scale, i1 = model x axis + z scale,
  // i2 = up + y scale, i3 = lon / lat for the cloud lookup + hash. Positions relative to A, drawn relative to the camera (float32 safe).
  const MVS = /* glsl */`
    uniform vec3 cV, A; attribute vec4 i0, i1, i2, i3; attribute vec4 col;
    varying vec2 vUv; varying vec3 vC; varying vec3 vO; varying vec3 vP; varying vec3 vN; varying vec2 vG; varying float vR;
    void main() {
      vec3 ax = i1.xyz, up = i2.xyz, az = cross(ax, up);   /* right-handed: x cross y = z */
      vec3 w = i0.xyz + ax * (position.x * i0.w) + up * (position.y * i2.w) + az * (position.z * i1.w);
      gl_Position = projectionMatrix * vec4(cV + mat3(modelViewMatrix) * (w / ${R}.), 1.);
      vN = ax * (normal.x / i0.w) + up * (normal.y / i2.w) + az * (normal.z / i1.w);
      vO = up; vP = A + w / ${R}.; vUv = uv; vC = col.rgb; vG = i3.xy; vR = i3.z; }`;
  const MFS = S => /* glsl */`
    uniform sampler2D map; uniform vec4 base; uniform float useCol, glass, inner, hasMap;
    varying vec2 vUv; varying vec3 vC; varying vec3 vO; varying vec3 vP; varying vec3 vN; varying vec2 vG; varying float vR; ${S}
    void main() {
      vec3 d = (hasMap > .5 ? texture2D(map, vUv).rgb : vec3(.6)) * base.rgb;
      if (useCol > .5) d *= vC;
      if (glass > .5) d = d * .25 + .02;
      vec3 n = normalize(vO), N = normalize(vN);
      nOv = vec4(0., 0., 0., 1.);   /* no global city lights painted on walls */
      gl_FragColor = vec4(shade(n, vP, N, N, .6, d, 0., vG, 1.), 1.);
      /* at night (ESTIMATE): the interior of about half the houses lit warm, seen through the window openings */
      float nt = 1. - smoothstep(-.1, .05, dot(n, sun)); if (nt <= 0. || inner < .5 || vR > .5) return;
      gl_FragColor.rgb += nt * vec3(1., .72, .42) * .5 * d; }`;
  function bucketOf(ti, L, mir) {
    const k = ti + '/' + L + '/' + mir; let b = buckets.get(k); if (b) return b;
    b = { k, ti, L, mir, n: 0, cap: 0, arr: null, ib: null, meshes: [] }; buckets.set(k, b); return b;
  }
  function grow(b, need) {
    let cap = Math.max(64, b.cap); while (cap < need) cap *= 2;
    const arr = new Float32Array(cap * 16); if (b.arr) arr.set(b.arr.subarray(0, b.n * 16)); b.arr = arr; b.cap = cap;
    b.ib = new THREE.InstancedInterleavedBuffer(arr, 16); b.ib.setUsage(THREE.DynamicDrawUsage);
    const lv = types[b.ti].lv[b.L];
    if (!b.meshes.length) b.meshes = lv.map(p => { const g = new THREE.InstancedBufferGeometry();
      for (const a of ['position', 'normal', 'uv']) g.setAttribute(a, p.geo.getAttribute(a));
      g.setAttribute('col', p.col ? p.geo.getAttribute('col') : new THREE.InstancedBufferAttribute(new Uint8Array([255, 255, 255, 255]), 4, true, 1e9)); g.setIndex(p.geo.index);   /* no colour: one constant white */
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { ...U, cV: uCV, A: uA, map: { value: p.mat.tex }, hasMap: { value: p.mat.tex ? 1 : 0 },
        base: { value: new THREE.Vector4(...p.mat.base) }, useCol: { value: p.col ? 1 : 0 }, glass: { value: p.mat.glass ? 1 : 0 }, inner: { value: p.mat.inner ? 1 : 0 } },
        vertexShader: MVS, fragmentShader: MFS(SHADE), side: b.mir ? THREE.BackSide : THREE.FrontSide }));
      m.frustumCulled = false; m.renderOrder = 1; return m; });
    for (const m of b.meshes) { const g = m.geometry;
      g.setAttribute('i0', new THREE.InterleavedBufferAttribute(b.ib, 4, 0)); g.setAttribute('i1', new THREE.InterleavedBufferAttribute(b.ib, 4, 4));
      g.setAttribute('i2', new THREE.InterleavedBufferAttribute(b.ib, 4, 8)); g.setAttribute('i3', new THREE.InterleavedBufferAttribute(b.ib, 4, 12)); }
  }

  // ── extruded buildings: one mesh per cell, 16 floats per vertex: x, y (m from the cell centre), hb (ground, drawn x ex + 400) | a1 = dz (m above
  // the ground), normal (east, north, up) | a2 = building hash, colour rgb | (pad) | a3 = wall u, v (m), wall top (m), kind (0 wall, 1 roof)
  const PVS = /* glsl */`
    uniform vec3 cV, e0, n0, u0; uniform vec2 ll; uniform float ex; attribute vec4 a1, a2, a3;
    varying vec3 vO; varying vec3 vP; varying vec3 vN; varying vec2 vG; varying vec4 vW; varying vec3 vC; varying float vR;
    void main() {
      vec3 dn = (e0 * position.x + n0 * position.y) / ${R}. - u0 * ((position.x * position.x + position.y * position.y) / ${2 * R * R}.);
      vec3 n = u0 + dn; float hh = (position.z * ex + 400. + a1.x) / ${R}.;
      gl_Position = projectionMatrix * vec4(cV + mat3(modelViewMatrix) * (dn + n * hh), 1.);
      vO = n; vP = n * (1. + hh); vN = e0 * a1.y + n0 * a1.z + u0 * a1.w; vR = a2.x; vW = a3; vC = a2.yzw;
      float la = ll.x + position.y / ${R}., lo = ll.y + position.x / (${R}. * cos(ll.x));
      vG = vec2(lo / 6.2831853 + .5, la / 3.1415927 + .5); }`;
  const PFS = S => /* glsl */`
    varying vec3 vO; varying vec3 vP; varying vec3 vN; varying vec2 vG; varying vec4 vW; varying vec3 vC; varying float vR; ${S}
    void main() {
      vec3 d = vC, n = normalize(vO), N = normalize(vN);
      /* window grid on walls (ESTIMATE: 2.9 m floors, 3.1 m bays), not on the ground floor's lowest half metre nor the top 0.6 m */
      vec2 f = fract(vec2(vW.x / 3.1, vW.y / 2.9)), cell = floor(vec2(vW.x / 3.1, vW.y / 2.9));
      float win = vW.w < .5 && vW.z > 2.4 ? step(.3, f.x) * step(f.x, .7) * step(.3, f.y) * step(f.y, .78) * step(.5, vW.y) * step(vW.y, vW.z - .6) : 0.;
      d = mix(d, vec3(.05, .06, .07), win * .85);
      nOv = vec4(0., 0., 0., 1.);
      gl_FragColor = vec4(shade(n, vP, N, N, .6, d, 0., vG, 1.), 1.);
      float nt = 1. - smoothstep(-.1, .05, dot(n, sun)); if (nt <= 0. || win <= 0.) return;
      float on = step(.6, fract(sin(dot(cell + vR * 97.3, vec2(12.9898, 78.233))) * 43758.5453));
      gl_FragColor.rgb += nt * win * on * vec3(1., .72, .42) * 1.2; }`;

  // ── cells (z14 tiles): download, decode, fit
  const nrmOf = (la, lo) => new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
  function cellOf(x, y) {
    const k = x + '/' + y; let c = cells.get(k); if (c) return c;
    const n = 1 << ZC, lo0 = x / n * 2 * Math.PI - Math.PI, dlo = 2 * Math.PI / n, my0 = Math.PI * (1 - 2 * y / n), dmy = 2 * Math.PI / n;
    const la = Math.atan(Math.sinh(my0 - dmy / 2)), lo = lo0 + dlo / 2, la0 = Math.atan(Math.sinh(my0)), la1 = Math.atan(Math.sinh(my0 - dmy));
    c = { k, x, y, la, lo, cl: Math.cos(la), wE: dlo * R * Math.cos(la), hN: (la0 - la1) * R, u0: nrmOf(la, lo),
      e0: new THREE.Vector3(-Math.sin(lo), 0, -Math.cos(lo)), n0: new THREE.Vector3(-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo)),
      st: 0, data: null, inst: null, mesh: null, h0: null, used: frame, fail: 0, retry: 0, nB: 0, nM: 0 };
    cells.set(k, c); return c;
  }
  function load(c) {
    c.st = 1; inflight++;
    fetch(URL0 + ZC + '/' + c.x + '/' + c.y + '.pbf').then(r => { if (r.status === 204 || r.status === 404) return new ArrayBuffer(0); if (!r.ok) throw r.status; return r.arrayBuffer(); })
      .then(buf => { c.data = buf.byteLength ? (decodeMvt(buf, new Set(['building'])).building || null) : null; c.st = 2; })
      .catch(() => { c.st = 0; c.fail++; c.retry = performance.now() + 4000 * c.fail; })
      .finally(() => { inflight--; });
  }
  const WALL = [[.86, .84, .79], [.87, .79, .62], [.80, .66, .45], [.88, .83, .58], [.72, .72, .70], [.85, .71, .66], [.78, .80, .72]];
  const ROOF = [[.50, .25, .17], [.42, .22, .16], [.30, .30, .32], [.55, .32, .22]];
  const hex = s => { const m = /^#?([0-9a-f]{6})$/i.exec(s || ''); if (!m) return null; const v = parseInt(m[1], 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };

  function fit(fp, rh) {   // the best house type for a footprint, or null
    if (!types || !types.length) return null;
    const cand = [];
    for (const t of types) {
      const sL = fp.L / t.tL, sW = fp.W / t.tW;
      if (sL < .87 || sL > 1.15 || sW < .87 || sW > 1.15 || Math.abs(fp.fill - t.fill) > .14) continue;
      if (rh > 5.5 && Math.abs(Math.log(rh / t.h)) > .55) continue;   // OSM height given (5 = the default): must be plausible
      cand.push([Math.log(sL) ** 2 + Math.log(sW) ** 2 + 2 * (fp.fill - t.fill) ** 2, t, sL, sW]); }
    if (!cand.length) return null;
    cand.sort((a, b) => a[0] - b[0]);
    const k = cand.filter(c => c[0] < cand[0][0] + .006).length;
    return cand[Math.min(k - 1, Math.floor(fp.r * k))];
  }

  function* build(c) {
    const feats = c.data ? c.data.features : [], ext = c.data ? c.data.extent : 4096, inst = [], V = [];
    const inR = inRO(c.lo * 180 / Math.PI, c.la * 180 / Math.PI) || inRO(c.lo * 180 / Math.PI + .02, c.la * 180 / Math.PI) || inRO(c.lo * 180 / Math.PI - .02, c.la * 180 / Math.PI);
    const lb = LRBV, D = Math.PI / 180;
    let nB = 0, k = 0;
    for (const ft of feats) {
      if (++k % 40 === 0) yield;
      if (ft.type !== 3 || ft.tags.hide_3d) continue;
      // rings in metres from the cell centre; the outer rings have the first ring's winding
      const rings = ft.geom.map(g => { const r = new Array(g.length); for (let i = 0; i < g.length; i += 2) { r[i] = (g[i] / ext - .5) * c.wE; r[i + 1] = (.5 - g[i + 1] / ext) * c.hN; }
        if (r.length > 4 && r[0] === r[r.length - 2] && r[1] === r[r.length - 1]) r.length -= 2; return r; }).filter(r => r.length >= 6);
      if (!rings.length) continue;
      const s0 = Math.sign(areaC(rings[0])[0]);
      const polys = []; for (const r of rings) { const a = areaC(r); if (Math.sign(a[0]) === s0 || !polys.length) polys.push({ r, a: Math.abs(a[0]), cx: a[1], cy: a[2], holes: [] }); else polys[polys.length - 1].holes.push(r); }
      for (const pg of polys) {
        // a building on the tile border is in both tiles (clipped): keep it in the tile that holds its centroid
        if (Math.abs(pg.cx) > c.wE / 2 || Math.abs(pg.cy) > c.hN / 2 || pg.a < 6) continue;
        const la = c.la + pg.cy / R, lo = c.lo + pg.cx / (R * c.cl);
        if (Math.abs(la - lb.la * D) < .03 && Math.abs(lo - lb.lo * D) < .04) {   // the LRBV box (airfield.js)
          const e = (lo - lb.lo * D) * R * Math.cos(lb.la * D), n = (la - lb.la * D) * R;
          if (e > lb.box[0] && e < lb.box[1] && n > lb.box[2] && n < lb.box[3]) continue; }
        if (skip && skip.covers(la, lo)) continue;   // an MSFS airport building stands there
        const h = groundAt(la, lo); if (h == null) continue;
        const fp = mar(pg.r); if (!fp) continue;
        fp.fill = pg.a / fp.A; fp.r = hash(c.x * 8192 + Math.round(pg.cx), c.y * 8192 + Math.round(pg.cy), 11);
        const rh = +ft.tags.render_height || 5, rmin = +ft.tags.render_min_height || 0; nB++;
        const m = inR && rmin <= 0 && !pg.holes.length ? fit(fp, rh) : null;
        if (m) {
          const [, t, sL, sW] = m, uL = [fp.ux, fp.uy], uW = [-fp.uy, fp.ux];
          const qL = ((pg.cx - fp.cx) * fp.ux + (pg.cy - fp.cy) * fp.uy) / fp.L, qW = (-(pg.cx - fp.cx) * fp.uy + (pg.cy - fp.cy) * fp.ux) / fp.W;
          let gL, gW;
          if (t.fill < .85) { gL = Math.sign(qL) === Math.sign(t.qL) ? 1 : -1; gW = Math.sign(qW) === Math.sign(t.qW) ? 1 : -1; }
          else { gL = fp.r < .5 ? 1 : -1; gW = 0; }
          let ax = t.longX ? [gL * uL[0], gL * uL[1]] : null, az = t.longX ? null : [gL * uL[0], gL * uL[1]];
          if (gW === 0) {   // a plain type: the other axis so that the model is not mirrored (proper: ax.n * az.e - ax.e * az.n > 0)
            if (ax) { az = [uW[0], uW[1]]; if (ax[1] * az[0] - ax[0] * az[1] < 0) az = [-az[0], -az[1]]; }
            else { ax = [uW[0], uW[1]]; if (ax[1] * az[0] - ax[0] * az[1] < 0) ax = [-ax[0], -ax[1]]; } }
          else if (ax) az = [gW * uW[0], gW * uW[1]]; else ax = [gW * uW[0], gW * uW[1]];
          const mir = ax[1] * az[0] - ax[0] * az[1] < 0 ? 1 : 0, sx = t.longX ? sL : sW, sz = t.longX ? sW : sL, sy = Math.min(1.15, (sL + sW) / 2);
          const ox = fp.cx - (ax[0] * t.cx * sx + az[0] * t.cz * sz), oy = fp.cy - (ax[1] * t.cx * sx + az[1] * t.cz * sz);
          const lai = c.la + oy / R, loi = c.lo + ox / (R * c.cl);
          inst.push({ t, x: ox, y: oy, h, ax, az, sx, sy, sz, mir, r: fp.r, g: [loi / (2 * Math.PI) + .5, lai / Math.PI + .5] });
          continue;
        }
        extrude(V, pg, fp, h, rh, rmin, hex(ft.tags.colour));
      }
    }
    if (c.mesh) { c.mesh.geometry.dispose(); c.mesh.material.dispose(); c.mesh = null; }
    // per instance: the point under the model origin and the up / axis vectors in the Earth frame (doubles; offsets from the anchor per frame)
    for (const q of inst) {
      const d2 = (q.x * q.x + q.y * q.y) / (2 * R * R);
      q.P = [0, 1, 2].map(i => c.u0.getComponent(i) * (1 - d2) + (c.e0.getComponent(i) * q.x + c.n0.getComponent(i) * q.y) / R);
      const l = Math.hypot(...q.P); q.up = q.P.map(v => v / l);
      const ax = [0, 1, 2].map(i => c.e0.getComponent(i) * q.ax[0] + c.n0.getComponent(i) * q.ax[1]), d = ax[0] * q.up[0] + ax[1] * q.up[1] + ax[2] * q.up[2];
      const a2 = ax.map((v, i) => v - d * q.up[i]), la2 = Math.hypot(...a2); q.A = a2.map(v => v / la2);   // made exactly level there
    }
    c.inst = inst; c.nB = nB; c.nM = inst.length; c.h0 = groundAt(c.la, c.lo); dirty = true;
    if (V.length) {
      const g = new THREE.BufferGeometry(), ib = new THREE.InterleavedBuffer(new Float32Array(V), 16);
      g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0)); g.setAttribute('a1', new THREE.InterleavedBufferAttribute(ib, 4, 3));
      g.setAttribute('a2', new THREE.InterleavedBufferAttribute(ib, 4, 7)); g.setAttribute('a3', new THREE.InterleavedBufferAttribute(ib, 4, 12));
      c.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { ...U, cV: { value: new THREE.Vector3() }, e0: { value: c.e0 }, n0: { value: c.n0 }, u0: { value: c.u0 },
        ll: { value: new THREE.Vector2(c.la, c.lo) } }, vertexShader: PVS, fragmentShader: PFS(SHADE) }));
      c.mesh.frustumCulled = false; c.mesh.renderOrder = 1; c.nV = V.length / 16;
    }
    c.st = 3;
  }
  // walls (+ roof) of one footprint into V. Gable roof: near-rectangular (fill > .88), < 16 m wide, not a tall or raised part.
  function extrude(V, pg, fp, h, rh, rmin, col) {
    const r = fp.r, wc = col || WALL[Math.floor(r * WALL.length)], rc = ROOF[Math.floor(hash(r * 1e6 | 0, 3, 5) * ROOF.length)];
    const gable = fp.fill > .88 && fp.W < 16 && rh <= 12 && rmin <= 0;
    const eave = gable ? (rh <= 5.5 ? 3 : Math.max(2.6, rh - Math.min(.35 * fp.W, 4))) : rh, z0 = rmin > 0 ? rmin : -3;
    const v = (x, y, dz, nx, ny, nz, u, w, top, kind, c) => V.push(x, y, h, dz, nx, ny, nz, r, c[0], c[1], c[2], 0, u, w, top, kind);   // see PVS: position, a1 @3, a2 @7, a3 @12
    const wall = (x0, y0, x1, y1, top) => { const l = Math.hypot(x1 - x0, y1 - y0); if (l < .05) return; const nx = (y1 - y0) / l, ny = -(x1 - x0) / l;
      const b = Math.max(0, z0);
      for (const [x, y, z, u] of [[x0, y0, z0, 0], [x1, y1, z0, l], [x1, y1, top, l], [x0, y0, z0, 0], [x1, y1, top, l], [x0, y0, top, 0]]) v(x, y, z, nx, ny, 0, u, z - b, top - b, 0, wc); };
    if (gable) {
      const { L, W, ux, uy, cx, cy } = fp, wx = -uy, wy = ux, hl = L / 2, hw = W / 2, ridge = eave + .35 * W;
      const P = (s, t) => [cx + ux * s + wx * t, cy + uy * s + wy * t];
      const c4 = [P(-hl, -hw), P(hl, -hw), P(hl, hw), P(-hl, hw)];
      for (let i = 0; i < 4; i++) { const a = c4[i], b = c4[(i + 1) % 4]; wall(a[0], a[1], b[0], b[1], eave); }   // counter-clockwise: normals outward
      const g0 = P(-hl, 0), g1 = P(hl, 0), nz = Math.cos(Math.atan2(ridge - eave, hw)), ns = Math.sin(Math.atan2(ridge - eave, hw));
      const gab = (a, b, m) => { const nx = (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]), ny = -(b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
        v(a[0], a[1], eave, nx, ny, 0, 0, eave, 0, 0, wc); v(b[0], b[1], eave, nx, ny, 0, W, eave, 0, 0, wc); v(m[0], m[1], ridge, nx, ny, 0, hw, ridge, 0, 0, wc); };
      gab(c4[1], c4[2], g1); gab(c4[3], c4[0], g0);   // gable ends (no windows: top 0)
      const o = .4;   // eaves overhang (ESTIMATE)
      const Q = (s, t) => P(s * (1 + o / hl), t * (1 + o / hw));
      for (const sd of [-1, 1]) { const a = Q(-hl, sd * hw), b = Q(hl, sd * hw), nx = wx * sd * ns, ny = wy * sd * ns, ez = eave - o * (ridge - eave) / hw;
        const tri = sd < 0 ? [[a, ez], [b, ez], [g1, ridge], [a, ez], [g1, ridge], [g0, ridge]] : [[a, ez], [g1, ridge], [b, ez], [a, ez], [g0, ridge], [g1, ridge]];   // counter-clockwise seen from outside
        for (const [p, z] of tri) v(p[0], p[1], z, nx, ny, nz, 0, 0, 0, 1, rc); }
      return;
    }
    // hip roof (most other small / medium houses, ESTIMATE): walls along the footprint to the eave; every wall edge slopes up to the nearest
    // point of a ridge on the rectangle's long centre line (length L - W), so a rectangle gets a classic hip roof, odd shapes a plausible one
    if (rmin <= 0 && rh <= 15 && pg.a < 1500 && fp.W < 30 && !pg.holes.length) {
      const { L, W, ux, uy, cx, cy } = fp, wE = Math.min(W, 1.3 * pg.a / L), hr = Math.max(0, (L - W) / 2);
      const eave = rh <= 5.5 ? 3 : Math.max(2.6, rh - Math.min(.35 * wE, 4)), ridge = eave + Math.min(.35 * wE, 5);
      const n = pg.r.length / 2, ccw = areaC(pg.r)[0] > 0, P = i => { const k = ccw ? i % n : (n - 1 - i % n); return [pg.r[2 * k], pg.r[2 * k + 1]]; };
      const Rp = p => { const s = Math.max(-hr, Math.min(hr, (p[0] - cx) * ux + (p[1] - cy) * uy)); return [cx + ux * s, cy + uy * s]; };
      const tri = (a, za, b, zb, c, zc) => {   // one roof triangle, turned to face up
        const e1 = [b[0] - a[0], b[1] - a[1], zb - za], e2 = [c[0] - a[0], c[1] - a[1], zc - za];
        let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0]; const l = Math.hypot(nx, ny, nz); if (l < 1e-4) return;
        if (nz < 0) { [b, zb, c, zc] = [c, zc, b, zb]; nx = -nx; ny = -ny; nz = -nz; }
        for (const [p, z] of [[a, za], [b, zb], [c, zc]]) v(p[0], p[1], z, nx / l, ny / l, nz / l, 0, 0, 0, 1, rc); };
      for (let i = 0; i < n; i++) { const a = P(i), b = P(i + 1), ra = Rp(a), rb = Rp(b);
        wall(a[0], a[1], b[0], b[1], eave); tri(a, eave, b, eave, rb, ridge); tri(a, eave, rb, ridge, ra, ridge); }
      return;
    }
    const rs = [pg.r, ...pg.holes];
    for (const ring of rs) { const ccw = areaC(ring)[0] > 0, outer = ring === pg.r, n = ring.length / 2;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; let a = i, b = j; if (ccw !== outer) [a, b] = [j, i];   // outward normals: outer ring ccw, holes cw
        wall(ring[2 * a], ring[2 * a + 1], ring[2 * b], ring[2 * b + 1], rh); } }
    const shape = [], holes = pg.holes.map(hr => { const p = []; for (let i = 0; i < hr.length; i += 2) p.push(new THREE.Vector2(hr[i], hr[i + 1])); return p; });
    for (let i = 0; i < pg.r.length; i += 2) shape.push(new THREE.Vector2(pg.r[i], pg.r[i + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(shape, holes), all = shape.concat(...holes);
    for (const t of tris) { let [a, b, cc] = t; const p = all;
      if ((p[b].x - p[a].x) * (p[cc].y - p[a].y) - (p[b].y - p[a].y) * (p[cc].x - p[a].x) < 0) [b, cc] = [cc, b];
      for (const q of [a, b, cc]) v(p[q].x, p[q].y, rh, 0, 0, 1, 0, 0, 0, 1, [.41, .41, .42]); }
  }

  // ── once per frame: which instances are drawn at which level, offsets from the anchor (redone when the camera moved > 6 m, the relief scale
  // changed, or a cell / type came in)
  function rebucket(want, ex) {
    for (const b of buckets.values()) b.n = 0;
    let nI = 0;
    for (const c of want) { if (!c.inst) continue;
      for (const q of c.inst) { const t = q.t;
        if (!t.lv) { if (!t.asked) loadType(t); continue; }
        if (!t.lv.length) continue;
        const k = 1 + (q.h * ex + 400) / R, ox = (q.P[0] * k - A.x) * R, oy = (q.P[1] * k - A.y) * R, oz = (q.P[2] * k - A.z) * R;
        const d = Math.hypot(ox - camA.x, oy - camA.y, oz - camA.z); if (d > P.r) continue;
        const L = Math.min(t.lv.length - 1, d < P.l0 ? 0 : d < P.l1 ? 1 : 2), b = bucketOf(t.i, L, q.mir);
        if (b.n + 1 > b.cap) grow(b, b.n + 1);
        const o = b.n * 16, a = b.arr, u = q.up, x = q.A;
        a[o] = ox; a[o + 1] = oy; a[o + 2] = oz; a[o + 3] = q.sx; a[o + 4] = x[0]; a[o + 5] = x[1]; a[o + 6] = x[2]; a[o + 7] = q.sz;
        a[o + 8] = u[0]; a[o + 9] = u[1]; a[o + 10] = u[2]; a[o + 11] = q.sy; a[o + 12] = q.g[0]; a[o + 13] = q.g[1]; a[o + 14] = q.r; a[o + 15] = 0;
        b.n++; nI++; } }
    for (const b of buckets.values()) if (b.ib) { if (b.n) { b.ib.clearUpdateRanges(); b.ib.addUpdateRange(0, b.n * 16); b.ib.needsUpdate = true; } for (const m of b.meshes) m.geometry.instanceCount = b.n; }
    return nI;
  }

  let nInst = 0, nTris = 0;
  return {
    // once per frame from hdUpdate, after the tiles: mvD = view x hd.matrixWorld, camN = camera direction (hd frame), altM = height over the ground (m)
    update(hd, mvD, camN, altM) {
      frame++;
      if (off || !types || altM > ALT) { nInst = nTris = 0; return 0; }
      const la = Math.asin(Math.max(-1, Math.min(1, camN.y))), lo = Math.atan2(-camN.z, camN.x), n = 1 << ZC;
      const my = Math.log(Math.tan(Math.PI / 4 + la / 2)), fx = (lo + Math.PI) / (2 * Math.PI) * n, fy = (1 - my / Math.PI) / 2 * n;
      const cw = 2 * Math.PI * R * Math.cos(la) / n, far = Math.sqrt(Math.max(0, P.r * P.r - altM * altM));
      if (far <= 0) { nInst = nTris = 0; return 0; }
      const rc = Math.ceil(far / cw) + 1, want = [], now = performance.now();
      for (let y = Math.floor(fy) - rc; y <= Math.floor(fy) + rc; y++) for (let x = Math.floor(fx) - rc; x <= Math.floor(fx) + rc; x++) {
        const d = Math.max(0, Math.hypot(x + .5 - fx, y + .5 - fy) * cw - cw * .75); if (d > far) continue;
        const c = cellOf((x + n) % n, y); c.used = frame; c.d = d; want.push(c); }
      want.sort((a, b) => a.d - b.d);
      for (const c of want) { if (inflight >= MAXF) break; if (c.st === 0 && now >= c.retry && c.fail < 5) load(c); }
      // re-fit a cell when the relief under it changed (a finer height tile came in)
      if (skip && skip.ver !== skipVer) { skipVer = skip.ver; for (const c of cells.values()) if (c.st === 3) c.st = 2; }   // a new MSFS airport: fit again
      if (frame % 30 === 0) for (const c of want) if (c.st === 3 && c.h0 != null) { const h = groundAt(c.la, c.lo); if (h != null && Math.abs(h - c.h0) > .3) { c.st = 2; break; } }
      const t0 = performance.now();
      while (performance.now() - t0 < P.ms) {
        if (!job) { const c = want.find(c => c.st === 2 && groundAt(c.la, c.lo) != null); if (!c) break; job = { c, it: build(c) }; }
        if (job.it.next().done) job = null;
      }
      // anchor: the centre of the cell under the camera at sea level + 400 m
      const c0 = cellOf(Math.floor(fx) % n, Math.floor(fy)), ex = U.ex.value;
      if (!A.equals(c0.u0)) { A.copy(c0.u0); dirty = true; }
      camA.copy(U.camO.value).sub(A).multiplyScalar(R);
      if (dirty || camA.distanceTo(lastCam) > 6 || Math.abs(ex - lastEx.v) > .002) { nInst = rebucket(want, ex); lastCam.copy(camA); lastEx.v = ex; dirty = false; }
      uA.value.copy(A); uCV.value.copy(A).applyMatrix4(mvD);
      nTris = 0;
      for (const b of buckets.values()) if (b.n) for (const m of b.meshes) { hd.add(m); nTris += b.n * m.geometry.index.count / 3; }
      for (const c of want) if (c.mesh && c.d < far) { c.mesh.material.uniforms.cV.value.copy(c.u0).applyMatrix4(mvD); hd.add(c.mesh); nTris += c.nV / 3; }
      if (cells.size > 400) for (const c of [...cells.values()]) if (c.used < frame - 600 && c.st !== 1) { if (c.mesh) { c.mesh.geometry.dispose(); c.mesh.material.dispose(); } cells.delete(c.k); dirty = true; }
      return nInst;
    },
    stats: () => { const cs = [...cells.values()].filter(c => c.st === 3);
      return { cells: cs.length, withData: cs.filter(c => c.data).length, polygons: cs.reduce((s, c) => s + (c.data ? c.data.features.reduce((t, f) => t + f.geom.length, 0) : 0), 0), footprints: cs.reduce((s, c) => s + c.nB, 0), models: cs.reduce((s, c) => s + c.nM, 0), drawnInstances: nInst, tris: Math.round(nTris),
        perLevel: [0, 1, 2].map(L => [...buckets.values()].filter(b => b.L === L).reduce((s, b) => s + b.n, 0)),
        types: types ? types.filter(t => t.lv && t.lv.length).length : 0 }; },
    get on() { return !off; }, set on(v) { off = !v; },
    dbg: { inRO, mar, areaC, fit: (fp, rh) => fit(fp, rh), cells, types: () => types },   /* for tests (tools/test) */
  };
}
