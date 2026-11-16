/* MSFS 2020 airports on the 3D Earth: the airport packages' own placed objects (terminals, hangars, vehicles, lamps ...) at their
   positions, baked by tools/build_msfs_airport.py into models/msfs/<icao>.json (placements) + models/msfs/m/<guid>.glb (3 detail
   levels, quantized) + models/msfs/tex/ (base colour only). Used with the permission of an MSFS developer (user, 15 Nov 2026).

   Per object: lat, lon, height (above the drawn ground when the BGL says AGL, else MSL kept relative to the real ground), heading
   (clockwise from north; model +X = east, -Z = north at heading 0, see the build script), scale. Pitch / bank are ignored (nearly
   all 0; counted in stats()). The drawn ground = relief x ex + 400 m (groundAt, CLAUDE.md "Heights"); MSFS flattens its airports,
   our relief is not flattened, so objects on a sloping apron can sit a little high or low (KNOWN LIMIT).
   Lighting through earthgl's shade(), like buildings.js. OSM buildings that overlap a placed building are left out (covers()).
   Off together with the buildings: localStorage aurora.bld = 'off'. */

const R = 6371000;
// r = drawn out to (slant distance, m); ms = placement build time per frame
const QP = { low: { r: 4000, ms: 3 }, medium: { r: 7000, ms: 4 }, high: { r: 10000, ms: 5 } };
const ALT = 30000, D = Math.PI / 180;

export function createMsfsAirports({ THREE, Q, SHADE, U, groundAt, renderer, off: off0 }) {
  const P = QP[Q] || QP.medium;
  let off = !!off0; try { off = off || localStorage.getItem('aurora.bld') === 'off'; } catch (e) {}
  const base = new URL('models/msfs/', import.meta.url);
  let index = null, ver = 0, frame = 0, dirty = true, nInst = 0, nTris = 0, nTilt = 0;
  const models = new Map(), texs = new Map(), buckets = new Map(), A = new THREE.Vector3(), camA = new THREE.Vector3(), lastCam = new THREE.Vector3(1e9, 0, 0);
  const lastEx = { v: 0 }, uCV = { value: new THREE.Vector3() }, uA = { value: new THREE.Vector3() };
  let anchorAp = null;
  if (!off) fetch(new URL('index.json', base)).then(r => r.json()).then(j => {
    index = j.map(a => ({ ...a, la: a.lat * D, lo: a.lon * D, st: 0, data: null, inst: null, grid: null })); }).catch(() => { index = []; });

  // ── a model: GLB written by the build script (int16 positions / uvs with per-primitive offset + scale in extras, int8 normals)
  const CT = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5122: Int16Array, 5121: Uint8Array, 5120: Int8Array };
  const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  function texOf(uri) {
    let t = texs.get(uri); if (t) return t;
    t = new THREE.TextureLoader().load(new URL(uri, base).href);
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    texs.set(uri, t); return t;
  }
  function modelOf(info) {
    let m = models.get(info.id); if (m) return m;
    m = { info, lv: null }; models.set(info.id, m);
    fetch(new URL(info.file, base)).then(r => { if (!r.ok) throw r.status; return r.arrayBuffer(); }).then(ab => {
      const dv = new DataView(ab), jl = dv.getUint32(12, true), g = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, jl))), b0 = 20 + jl + 8;
      const acc = k => { const a = g.accessors[k], v = g.bufferViews[a.bufferView], C = CT[a.componentType];
        return new THREE.BufferAttribute(new C(ab, b0 + (v.byteOffset || 0), a.count * NC[a.type]), NC[a.type], !!a.normalized); };
      const mats = g.materials.map(mt => { const pb = mt.pbrMetallicRoughness || {}, ti = pb.baseColorTexture ? g.textures[pb.baseColorTexture.index].source : -1;
        return { tex: ti >= 0 ? texOf(g.images[ti].uri) : null, base: pb.baseColorFactor || [1, 1, 1, 1], cut: (mt.extras && mt.extras.cut) || 0, win: !!(mt.extras && mt.extras.window) }; });
      const seen = new Map();
      m.lv = g.meshes.map(me => { if (seen.has(me.primitives)) return seen.get(me.primitives);
        const l = me.primitives.map(p => { const geo = new THREE.BufferGeometry(), at = p.attributes;
          geo.setAttribute('position', acc(at.POSITION)); geo.setAttribute('normal', acc(at.NORMAL)); geo.setAttribute('uv', acc(at.TEXCOORD_0)); geo.setIndex(acc(p.indices));
          return { geo, mat: mats[p.material], q: p.extras.q, u: p.extras.u }; });
        seen.set(me.primitives, l); return l; });
      dirty = true; }).catch(() => { m.lv = []; });
    return m;
  }

  // instanced shader (as buildings.js): i0 = offset from the anchor A (m, Earth frame) + x scale, i1 = model x axis + z scale,
  // i2 = up + y scale, i3 = lon / lat for the cloud lookup. Positions dequantized: p = position * qs + qo, uv = uv * us + uo.
  const MVS = /* glsl */`
    uniform vec3 cV, A, qo, qs; uniform vec2 uo, us; attribute vec4 i0, i1, i2, i3;
    varying vec2 vUv; varying vec3 vO; varying vec3 vP; varying vec3 vN; varying vec2 vG;
    void main() {
      vec3 p = position * qs + qo, ax = i1.xyz, up = i2.xyz, az = cross(ax, up);
      vec3 w = i0.xyz + ax * (p.x * i0.w) + up * (p.y * i2.w) + az * (p.z * i1.w);
      gl_Position = projectionMatrix * vec4(cV + mat3(modelViewMatrix) * (w / ${R}.), 1.);
      vN = ax * normal.x + up * normal.y + az * normal.z;
      vO = up; vP = A + w / ${R}.; vUv = uv * us + uo; vG = i3.xy; }`;
  const MFS = S => /* glsl */`
    uniform sampler2D map; uniform vec4 base; uniform float hasMap, cut, win;
    varying vec2 vUv; varying vec3 vO; varying vec3 vP; varying vec3 vN; varying vec2 vG; ${S}
    void main() {
      vec4 t = hasMap > .5 ? texture2D(map, vUv) : vec4(.6, .6, .6, 1.);
      if (cut > 0. && t.a < cut) discard;
      vec3 d = t.rgb * base.rgb, n = normalize(vO), N = normalize(vN);
      if (!gl_FrontFacing) N = -N;
      nOv = vec4(0., 0., 0., 1.);
      gl_FragColor = vec4(shade(n, vP, N, N, .6, d, 0., vG, 1.), 1.);
      /* at night: window materials glow a little (ESTIMATE, the MSFS parallax interiors are not drawn) */
      float nt = 1. - smoothstep(-.1, .05, dot(n, sun));
      if (win > .5 && nt > 0.) gl_FragColor.rgb += nt * vec3(1., .78, .5) * .35 * d; }`;
  function bucketOf(m, L) {
    const k = m.info.id + '/' + L; let b = buckets.get(k); if (b) return b;
    b = { k, m, L, n: 0, cap: 0, arr: null, ib: null, meshes: [] }; buckets.set(k, b); return b;
  }
  function grow(b, need) {
    let cap = Math.max(16, b.cap); while (cap < need) cap *= 2;
    const arr = new Float32Array(cap * 16); if (b.arr) arr.set(b.arr.subarray(0, b.n * 16)); b.arr = arr; b.cap = cap;
    b.ib = new THREE.InstancedInterleavedBuffer(arr, 16); b.ib.setUsage(THREE.DynamicDrawUsage);
    if (!b.meshes.length) b.meshes = b.m.lv[b.L].map(p => { const g = new THREE.InstancedBufferGeometry();
      for (const a of ['position', 'normal', 'uv']) g.setAttribute(a, p.geo.getAttribute(a)); g.setIndex(p.geo.index);
      const mt = new THREE.ShaderMaterial({ uniforms: { ...U, cV: uCV, A: uA, map: { value: p.mat.tex }, hasMap: { value: p.mat.tex ? 1 : 0 },
        base: { value: new THREE.Vector4(...p.mat.base) }, cut: { value: p.mat.cut }, win: { value: p.mat.win ? 1 : 0 },
        qo: { value: new THREE.Vector3(...p.q[0]) }, qs: { value: new THREE.Vector3(...p.q[1]) }, uo: { value: new THREE.Vector2(...p.u[0]) }, us: { value: new THREE.Vector2(...p.u[1]) } },
        vertexShader: MVS, fragmentShader: MFS(SHADE), side: THREE.DoubleSide });
      const me = new THREE.Mesh(g, mt); me.frustumCulled = false; me.renderOrder = 1; return me; });
    for (const me of b.meshes) { const g = me.geometry;
      g.setAttribute('i0', new THREE.InterleavedBufferAttribute(b.ib, 4, 0)); g.setAttribute('i1', new THREE.InterleavedBufferAttribute(b.ib, 4, 4));
      g.setAttribute('i2', new THREE.InterleavedBufferAttribute(b.ib, 4, 8)); g.setAttribute('i3', new THREE.InterleavedBufferAttribute(b.ib, 4, 12)); }
  }

  // ── an airport: download its placements, then per object the Earth-frame point, up and x axis (needs the ground heights)
  const nrmOf = (la, lo) => [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
  function load(ap) {
    ap.st = 1;
    fetch(new URL(ap.file, base)).then(r => r.json()).then(j => { ap.data = j; ap.st = 2; }).catch(() => { ap.st = -1; });
  }
  function place(ap) {   // -> false while the ground is not there yet
    const j = ap.data, inst = [];
    for (const o of j.obj) {
      const [mi, lat, lon, alt, agl, hd, pi, ba, sc] = o, la = lat * D, lo = lon * D, h = groundAt(la, lo);
      if (h == null) return false;
      if (pi || ba) nTilt++;
      const u = nrmOf(la, lo), e = [-Math.sin(lo), 0, -Math.cos(lo)], n = [-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo)];
      const c = Math.cos(hd * D), s = Math.sin(hd * D), ax = [0, 1, 2].map(i => e[i] * c - n[i] * s);
      inst.push({ m: modelOf(j.models[mi]), la, lo, u, ax, h, dz: agl ? alt : alt - h, sc, g: [lo / (2 * Math.PI) + .5, la / Math.PI + .5] });
    }
    // grid of the placed buildings (model radius >= 6 m) for covers(): 100 m cells, east / north metres from the centre
    const grid = new Map(), kx = R * Math.cos(ap.la);
    for (const o of j.obj) { const md = j.models[o[0]]; if (md.rad * o[8] < 6) continue;
      const x = (o[2] * D - ap.lo) * kx, y = (o[1] * D - ap.la) * R, r = Math.max(15, .8 * md.rad * o[8]);
      for (let gx = Math.floor((x - r) / 100); gx <= Math.floor((x + r) / 100); gx++) for (let gy = Math.floor((y - r) / 100); gy <= Math.floor((y + r) / 100); gy++) {
        const k = gx + ',' + gy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([x, y, r]); } }
    ap.inst = inst; ap.grid = grid; ap.st = 3; ver++; dirty = true; return true;
  }

  function rebucket(near, ex) {
    for (const b of buckets.values()) b.n = 0;
    let n = 0;
    for (const ap of near) for (const q of ap.inst) {
      const m = q.m; if (!m.lv || !m.lv.length) continue;
      const k = 1 + (q.h * ex + 400 + q.dz) / R, ox = (q.u[0] * k - A.x) * R, oy = (q.u[1] * k - A.y) * R, oz = (q.u[2] * k - A.z) * R;
      const rad = m.info.rad * q.sc, d = Math.hypot(ox - camA.x, oy - camA.y, oz - camA.z);
      if (d > Math.min(P.r, Math.max(1500, 80 * rad))) continue;
      const L = Math.min(m.lv.length - 1, d < Math.max(200, 6 * rad) ? 0 : d < Math.max(800, 25 * rad) ? 1 : 2), b = bucketOf(m, L);
      if (!m.lv[L].length) continue;
      if (b.n + 1 > b.cap) grow(b, b.n + 1);
      const o = b.n * 16, a = b.arr, x = q.ax, u = q.u;
      a[o] = ox; a[o + 1] = oy; a[o + 2] = oz; a[o + 3] = q.sc; a[o + 4] = x[0]; a[o + 5] = x[1]; a[o + 6] = x[2]; a[o + 7] = q.sc;
      a[o + 8] = u[0]; a[o + 9] = u[1]; a[o + 10] = u[2]; a[o + 11] = q.sc; a[o + 12] = q.g[0]; a[o + 13] = q.g[1]; a[o + 14] = 0; a[o + 15] = 0;
      b.n++; n++; }
    for (const b of buckets.values()) if (b.ib) { if (b.n) { b.ib.clearUpdateRanges(); b.ib.addUpdateRange(0, b.n * 16); b.ib.needsUpdate = true; } for (const me of b.meshes) me.geometry.instanceCount = b.n; }
    return n;
  }

  return {
    // once per frame after the tiles (like buildings.js): mvD = view x hd.matrixWorld, camN = camera direction (hd frame), altM = height over ground
    update(hd, mvD, camN, altM) {
      frame++;
      if (off || !index || altM > ALT) { nInst = nTris = 0; return 0; }
      const la = Math.asin(Math.max(-1, Math.min(1, camN.y))), lo = Math.atan2(-camN.z, camN.x), near = [];      for (const ap of index) {
        const dk = Math.hypot((ap.lo - lo) * Math.cos(la), ap.la - la) * R - ap.r;
        ap.d = dk; if (dk > P.r) continue;
        if (ap.st === 0) load(ap);
        // a finer height tile came in under the airport: heights again (the first ones may come from a coarse tile)
        if (ap.st === 3 && frame % 30 === 0) for (let i = 0; i < 12; i++) { const q = ap.inst[(Math.random() * ap.inst.length) | 0], h = groundAt(q.la, q.lo);
          if (h != null && Math.abs(h - q.h) > .3) { ap.st = 2; ap.nRe = (ap.nRe || 0) + 1; break; } }
        if (ap.st === 2) place(ap);
        if (ap.inst) near.push(ap);   /* the old heights stay drawn while new ones wait for the ground */
      }
      if (!near.length) { nInst = nTris = 0; return 0; }
      near.sort((a, b) => a.d - b.d);
      const ex = U.ex.value;
      if (anchorAp !== near[0]) { anchorAp = near[0]; A.fromArray(nrmOf(anchorAp.la, anchorAp.lo)); dirty = true; }
      camA.copy(U.camO.value).sub(A).multiplyScalar(R);
      if (dirty || camA.distanceTo(lastCam) > 6 || Math.abs(ex - lastEx.v) > .002) { nInst = rebucket(near, ex); lastCam.copy(camA); lastEx.v = ex; dirty = false; }
      uA.value.copy(A); uCV.value.copy(A).applyMatrix4(mvD);
      nTris = 0;
      for (const b of buckets.values()) if (b.n) for (const me of b.meshes) { hd.add(me); nTris += b.n * me.geometry.index.count / 3; }
      return nInst;
    },
    // true when an OSM building centred at (la, lo, radians) would overlap a placed MSFS building
    covers(la, lo) {
      if (!index) return false;
      for (const ap of index) { if (!ap.grid) continue;
        const x = (lo - ap.lo) * R * Math.cos(ap.la), y = (la - ap.la) * R; if (Math.hypot(x, y) > ap.r + 100) continue;
        const c = ap.grid.get(Math.floor(x / 100) + ',' + Math.floor(y / 100)); if (!c) continue;
        for (const [px, py, r] of c) if (Math.hypot(x - px, y - py) < r) return true; }
      return false;
    },
    get ver() { return ver; },
    stats: () => ({ frame, replaced: index ? index.map(a => a.nRe || 0) : null, airports: index ? index.length : 0, st: index ? index.map(a => a.icao + ':' + a.st + ':' + Math.round(a.d ?? -1)) : null, placed: index ? index.filter(a => a.st === 3).map(a => a.icao) : [], models: [...models.values()].filter(m => m.lv && m.lv.length).length,
      drawnInstances: nInst, tris: Math.round(nTris), tilted: nTilt, buckets: [...buckets.values()].filter(b => b.n).length }),
    get on() { return !off; }, set on(v) { off = !v; },
  };
}
