/* Trees and bushes on the 3D Earth close to the ground: camera-facing billboards (photo cut-outs from Falcon BMS 4.38, used with the BMS
   team's permission: img/veg/, tools/build_bms_veg.py), standing on the drawn relief, lit by the same shade() as the ground.

   Where they stand:
   - ESA WorldCover 2021 (10 m, CC BY 4.0), baked to data/veg/<z>/<x>/<y>.png by tools/build_veg_map.py (Romania for now): per ~27 m pixel the
     share of tree cover, shrubland and grassland. Trees fill tree cover, bushes (and a few trees) shrubland, single bushes / trees dot grassland.
   - Elsewhere an ESTIMATE from the colour of the photo under it (dark green and rough = forest). It misses dark forests and puts trees on some
     green fields; labelled as such in the ⚙ text.
   The ground is cut into cells (Web Mercator z14 tiles, ~1.7 km at 46 N); a cell near the camera gets one instanced mesh of quads, with
   fewer trees the farther it is (levels, see build). Positions
   are kept relative to the cell's centre and drawn relative to the camera, like the HD tiles (float32 safe).
   Tree heights: 10.7-21 m (BMS ForestTypes: 35-70 ft); bushes 1-3.5 m. Needle / broad leaf share by ground height and latitude, varied in
   ~100 m stands (an estimate, see build). */

const ZC = 14, R = 6371000;
// r = how far the full set (L2), 1/4 of it (L1) and 1/16 of it (L0) are drawn, m; s = grid spacing, m; ms = build time per frame
const QP = { low: { r: [1200, 2600, 5200], s: 14, ms: 2 }, medium: { r: [2000, 4500, 9000], s: 11, ms: 3 }, high: { r: [2500, 5500, 11000], s: 10, ms: 4 } };

function hash(a, b, c) {   // three integers -> [0, 1)
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createVeg({ THREE, Q, SHADE, U, tiles, groundAt, camera, renderer }) {
  const P = QP[Q] || QP.medium;
  let off = false; try { off = localStorage.getItem('aurora.veg') === 'off'; } catch (e) {}
  const base = new URL('.', import.meta.url);
  const cells = new Map(), maps = new Map(), est = new Map();
  let meta = null, index = null, frame = 0, job = null;
  const cv = new OffscreenCanvas(256, 256), cx = cv.getContext('2d', { willReadFrequently: true });

  // ── textures and the sprite table
  const tex = new THREE.TextureLoader().load(new URL('img/veg/veg.webp', base).href);
  tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const SR = [], SA = [];
  for (let i = 0; i < 16; i++) { SR.push(new THREE.Vector4(0, 0, 1, 1)); SA.push(1); }
  fetch(new URL('img/veg/veg.json', base)).then(r => r.json()).then(m => { m.forEach((s, i) => { SR[i].set(s.u0, s.v0, s.u1, s.v1); SA[i] = s.a; }); meta = m; }).catch(() => {});
  const NONE = { z: 12, pz: 9, packs: new Set() };
  fetch(new URL('data/veg/index.json', base)).then(r => r.ok ? r.json() : null).then(j => { index = j ? { ...j, packs: new Set(j.packs) } : NONE; }).catch(() => { index = NONE; });

  // ── the baked map: packs of 2048 x 2048 (one z9 square at z12 pixels), one value per pixel:
  //    bits 0-1 tree share x 3, bit 2 shrubland >= 1/2, bits 3-4 grass share x 3 (tools/build_veg_map.py)
  let pcv = null;
  function mapOf(x, y) {
    const k = x + '_' + y; let m = maps.get(k);
    if (m) { m.used = frame; return m; }
    m = { used: frame, px: null }; maps.set(k, m);
    fetch(new URL(`data/veg/${k}.webp`, base)).then(r => { if (!r.ok) throw r.status; return r.blob(); })
      .then(b => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })).then(bm => {
        const S = bm.width; pcv = pcv && pcv.width === S ? pcv : new OffscreenCanvas(S, S); const pc = pcv.getContext('2d', { willReadFrequently: true });
        pc.drawImage(bm, 0, 0); bm.close();
        const d = pc.getImageData(0, 0, S, S).data, px = new Uint8Array(S * S); for (let i = 0; i < S * S; i++) px[i] = d[i * 4]; m.S = S; m.px = px; })
      .catch(() => { m.S = 1; m.px = new Uint8Array(1); });
    return m;
  }

  // ── the estimate from the photo (an image tile of the HD ground): forest share and grass share per pixel
  function box(a, r) {   // mean over (2r+1)^2, edges clamped
    const t = new Float32Array(65536), o = new Float32Array(65536), n = 2 * r + 1;
    for (let j = 0; j < 256; j++) { let s = 0; for (let i = -r - 1; i < r; i++) s += a[j * 256 + Math.min(255, Math.max(0, i))];
      for (let i = 0; i < 256; i++) { s += a[j * 256 + Math.min(255, i + r)] - a[j * 256 + Math.max(0, i - r - 1)]; t[j * 256 + i] = s / n; } }
    for (let i = 0; i < 256; i++) { let s = 0; for (let j = -r - 1; j < r; j++) s += t[Math.min(255, Math.max(0, j)) * 256 + i];
      for (let j = 0; j < 256; j++) { s += t[Math.min(255, j + r) * 256 + i] - t[Math.max(0, j - r - 1) * 256 + i]; o[j * 256 + i] = s / n; } }
    return o;
  }
  function estOf(t) {
    let e = est.get(t.k); if (e) { e.used = frame; return e; }
    const im = t.img && t.img.image; if (!im) return null;
    cx.clearRect(0, 0, 256, 256); cx.drawImage(im, 0, 0, 256, 256); const d = cx.getImageData(0, 0, 256, 256).data;
    const L = new Float32Array(65536), col = new Float32Array(65536), gs = new Float32Array(65536), tx = new Float32Array(65536);
    for (let k = 0; k < 65536; k++) { const r = d[k * 4], g = d[k * 4 + 1], b = d[k * 4 + 2]; L[k] = (r + g + b) / 3;
      col[k] = sm(-2, 8, g - Math.max(r, .9 * b)) * (1 - sm(60, 90, L[k])) * (1 - sm(0, 10, b - g));
      gs[k] = sm(-12, 2, g - r) * sm(45, 70, L[k]) * (1 - sm(150, 185, L[k])); }
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { const k = j * 256 + i;   /* clamped gradients: field borders count little */
      tx[k] = (Math.min(Math.abs(L[j * 256 + Math.min(255, i + 1)] - L[k]), 4) + Math.min(Math.abs(L[Math.min(255, j + 1) * 256 + i] - L[k]), 4)) / 2; }
    const tm = box(tx, 2), lm = box(L, 2), f0 = new Float32Array(65536);
    for (let k = 0; k < 65536; k++) f0[k] = col[k] * sm(.04, .075, tm[k] / (lm[k] + 8));
    const fs = box(f0, 4), f = new Float32Array(65536), g = new Float32Array(65536);
    for (let k = 0; k < 65536; k++) { f[k] = col[k] * sm(.25, .55, fs[k]); g[k] = gs[k] * (1 - f[k]) * .5; }
    e = { f, g, z: t.z, used: frame }; est.set(t.k, e); return e;
  }

  // ── a cell: its frame (like geomOf in earthgl.js) and, once its sources are in, its trees
  const nrmOf = (la, lo) => new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
  function cellOf(x, y) {
    const k = x + '/' + y; let c = cells.get(k); if (c) return c;
    const n = 1 << ZC, lo0 = x / n * 2 * Math.PI - Math.PI, dlo = 2 * Math.PI / n, my0 = Math.PI * (1 - 2 * y / n), dmy = 2 * Math.PI / n;
    const la = Math.atan(Math.sinh(my0 - dmy / 2)), lo = lo0 + dlo / 2, la0 = Math.atan(Math.sinh(my0)), la1 = Math.atan(Math.sinh(my0 - dmy));
    c = { k, x, y, la, lo, cl: Math.cos(la), wE: dlo * R * Math.cos(la), hN: (la0 - la1) * R, u0: nrmOf(la, lo),
      e0: new THREE.Vector3(-Math.sin(lo), 0, -Math.cos(lo)), n0: new THREE.Vector3(-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo)),
      mesh: null, src: -1, lvl: -1, used: frame };
    cells.set(k, c); return c;
  }
  // the source for a cell: 'map' (+ the baked tile), 'est' (+ estimate of the finest loaded photo, z12-z14), or null = not ready yet
  function sourceOf(c) {
    const mx = c.x >> (ZC - index.pz), my = c.y >> (ZC - index.pz);
    if (index.packs.has(mx + '_' + my)) { const m = mapOf(mx, my); return m.px ? { kind: 'map', m, mx, my, lvl: 99 } : null; }
    for (let z = 14; z >= 12; z--) { const t = tiles.get(z + '/' + (c.x >> (ZC - z)) + '/' + (c.y >> (ZC - z))); if (t && t.img && t.img.image) { const e = estOf(t); if (e) return { kind: 'est', e, t, lvl: z }; } }
    return null;
  }
  // A cell is built over several frames (a generator, ~3 ms per frame). Grid points belong to a level: L0 = every 4th point in both
  // directions (1/16), L1 = every 2nd (3/16 more), L2 = the rest. A cell holds the levels its distance needs; a nearer cell is rebuilt with
  // more levels, and the points it had stay exactly where they were (same grid, same hashes), so nothing jumps, trees only add up.
  function* build(c, S, lvl) {
    const sp = P.s, nx = Math.ceil(c.wE / sp), ny = Math.ceil(c.hN / sp), A = [], B = [];
    const n2 = 1 << ZC, st0 = lvl === 0 ? 4 : lvl === 1 ? 2 : 1;
    for (let j = 0; j < ny; j += st0) { yield; for (let i = 0; i < nx; i += st0) {
      const L = i % 4 === 0 && j % 4 === 0 ? 0 : i % 2 === 0 && j % 2 === 0 ? 1 : 2;
      const r1 = hash(c.x * 4096 + i, c.y * 4096 + j, 1), r2 = hash(c.x * 4096 + i, c.y * 4096 + j, 2), r3 = hash(c.x * 4096 + i, c.y * 4096 + j, 3);
      const xe = (i + .15 + .7 * r1) * sp - c.wE / 2, yn = c.hN / 2 - (j + .15 + .7 * r2) * sp;
      const la = c.la + yn / R, lo = c.lo + xe / (R * c.cl);
      const my = Math.log(Math.tan(Math.PI / 4 + la / 2)), fx = (lo + Math.PI) / (2 * Math.PI), fy = (1 - my / Math.PI) / 2;
      let pt = 0, ps = 0, pg = 0;
      if (S.kind === 'map') {   // bilinear between the 4 nearest baked pixels
        const N = S.m.S, zn = 1 << index.pz, u = Math.min(N - 1.001, Math.max(0, (fx * zn - S.mx) * N - .5)), v = Math.min(N - 1.001, Math.max(0, (fy * zn - S.my) * N - .5));
        const i0 = u | 0, j0 = v | 0, a = u - i0, b = v - j0, px = S.m.px;
        if (N > 1) for (const [di, dj, w] of [[0, 0, (1 - a) * (1 - b)], [1, 0, a * (1 - b)], [0, 1, (1 - a) * b], [1, 1, a * b]]) {
          const q = px[(j0 + dj) * N + i0 + di]; pt += w * (q & 3) / 3; ps += w * ((q >> 2) & 1); pg += w * ((q >> 3) & 3) / 3; }
      } else {
        const zn = 1 << S.lvl, u = Math.min(255, Math.max(0, ((fx * zn - S.t.x) * 256) | 0)), v = Math.min(255, Math.max(0, ((fy * zn - S.t.y) * 256) | 0));
        pt = S.e.f[v * 256 + u]; pg = S.e.g[v * 256 + u];
      }
      // what grows here: a tree in tree cover; in shrubland mostly bushes; on grass a bush now and then, rarely a tree
      let kind = -1;
      if (r3 < pt) kind = 0;
      else if (r3 < pt + ps * .55) kind = r3 < pt + ps * .06 ? 0 : 1;
      else if (r3 < pt + ps * .55 + pg * .05) kind = r3 < pt + ps * .55 + pg * .004 ? 0 : 1;
      if (kind < 0) continue;
      const h = groundAt(la, lo); if (h == null || h <= .5) continue;   // no heights yet, or sea
      const r4 = hash(c.x * 4096 + i, c.y * 4096 + j, 4), r5 = hash(c.x * 4096 + i, c.y * 4096 + j, 5);
      let spr, size;
      if (kind === 0) {
        // needle leaf share by height (an ESTIMATE, Carpathian zones: beech below ~1000 m, mixed, spruce from ~1400 m; the zones come
        // down ~40 m per degree of latitude above 45 deg, so boreal forest is mostly needle leaf) + ~200 m stands that lean one way or the other
        const al = Math.abs(la) * 180 / Math.PI, h0 = Math.max(150, 900 - 40 * Math.max(0, al - 45));
        const st = hash(Math.floor(fx * n2 * 8), Math.floor(fy * n2 * 8), 7), pn = Math.min(1, Math.max(0, .08 + .84 * sm(h0, h0 + 600, h) + (st - .5) * .5));
        spr = (r4 < pn ? 5 : 0) + Math.floor(r5 * 5); size = 10.7 + 10.6 * hash(c.x * 4096 + i, c.y * 4096 + j, 6); }
      else { spr = 10 + Math.floor(r5 * 6); size = 1 + 2.5 * r4 * r4; }
      A.push(xe, yn, h, size); B.push(spr + 16 * L, hash(c.x * 4096 + i, c.y * 4096 + j, 8));
    } }
    c.src = S.lvl; c.lvl = lvl;
    if (c.mesh) { c.mesh.geometry.dispose(); c.mesh.material.dispose(); c.mesh = null; }
    if (!A.length) return;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.Float32BufferAttribute([-.5, 0, .5, 0, -.5, 1, .5, 1], 2)); g.setIndex([0, 1, 2, 2, 1, 3]);
    g.setAttribute('ia', new THREE.InstancedBufferAttribute(new Float32Array(A), 4)); g.setAttribute('ib', new THREE.InstancedBufferAttribute(new Float32Array(B), 2));
    g.instanceCount = A.length / 4;
    const mat = new THREE.ShaderMaterial({ uniforms: { ...U, vt: VT, SR: { value: SR }, SA: { value: SA }, RL: FR, pxK: PK,
      cV: { value: new THREE.Vector3() }, e0: { value: c.e0 }, n0: { value: c.n0 }, u0: { value: c.u0 }, ll: { value: new THREE.Vector2(c.la, c.lo) } },
      vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide });
    c.mesh = new THREE.Mesh(g, mat); c.mesh.frustumCulled = false; c.mesh.renderOrder = 1; c.n = g.instanceCount;
  }
  const VT = { value: tex }, FR = { value: new THREE.Vector3(...P.r) }, PK = { value: 1000 };

  // the quad stands on the ground point, upright (local up), turned to the camera; collapsed beyond its level's range (thinned out over the
  // last quarter by its own random number, so a level fades instead of ending on a line) or when < 1.5 px
  const VS = /* glsl */`
    uniform vec3 cV, e0, n0, u0, RL; uniform vec2 ll; uniform float ex, pxK; uniform vec4 SR[16]; uniform float SA[16];
    attribute vec2 corner; attribute vec4 ia; attribute vec2 ib;
    varying vec2 vUv; varying vec3 vO; varying vec3 vP; varying vec2 vG; varying float vY; varying vec3 vSide;
    void main() {
      int kl = int(ib.x + .5), k = kl % 16, L = kl / 16; vec4 r = SR[k]; float H = ia.w, W = H * SA[k];
      float fadeR = L == 0 ? RL.z : L == 1 ? RL.y : RL.x;
      vec3 dn = (e0 * ia.x + n0 * ia.y) / ${R}. - u0 * ((ia.x * ia.x + ia.y * ia.y) / ${2 * R * R}.);
      vec3 n = u0 + dn; float hh = (ia.z * ex + 400. - .8 - .03 * H) / ${R}.;   /* sunk a little: the mesh between its vertices */
      vec3 bv = cV + mat3(modelViewMatrix) * (dn + n * hh);
      float dist = length(bv) * ${R}.;
      if (ib.y > 1. - smoothstep(fadeR * .75, fadeR, dist) || H / dist * pxK < 1.5) { gl_Position = vec4(2., 2., 2., 1.); return; }
      vec3 up = normalize(mat3(modelViewMatrix) * n), rt = normalize(cross(bv, up));
      vec3 p = bv + (rt * corner.x * W + up * corner.y * H) / ${R}.;
      gl_Position = projectionMatrix * vec4(p, 1.);
      vUv = vec2(mix(r.x, r.z, corner.x + .5), mix(r.w, r.y, corner.y)); vY = corner.y;
      vO = n; vP = n * (1. + hh);
      vSide = normalize(transpose(mat3(modelViewMatrix)) * rt) * corner.x * 2.;   /* towards the quad's left / right edge, world frame */
      float la = ll.x + ia.y / ${R}., lo = ll.y + ia.x / (${R}. * cos(ll.x));
      vG = vec2(lo / 6.2831853 + .5, la / 3.1415927 + .5); }`;
  const FS = /* glsl */`
    uniform sampler2D vt; varying vec2 vUv; varying vec3 vO; varying vec3 vP; varying vec2 vG; varying float vY; varying vec3 vSide; ${SHADE}
    void main() { vec4 c = texture2D(vt, vUv);
      vec2 dd = vec2(length(dFdx(vUv)), length(dFdy(vUv))) * 2048.; float lod = log2(max(max(dd.x, dd.y), 1e-3));
      if (c.a * (1. + max(lod, 0.) * .35) < .5) discard;   /* keeps far crowns from thinning out in the small mipmaps */
      vec3 n = normalize(vO), V = normalize(camO - vP), Vh = normalize(V - n * dot(V, n) + vec3(1e-6));
      /* a round crown: the normal leans to the side of the quad and a little towards the viewer; the lower part sits in its own shade (estimate) */
      vec3 N = normalize(n * .55 + vSide * .45 + Vh * .35);
      vec3 d = c.rgb * 1.15 * mix(.55, 1., smoothstep(0., .8, vY));
      nOv = vec4(0., 0., 0., 1.);   /* no city lights on a tree (the global night map would paint whole crowns) */
      gl_FragColor = vec4(shade(n, vP, N, N, .3, d, 0., vG, 1.3), 1.); }`;

  return {
    // once per frame from hdUpdate, after the tiles: mvD = view x hd.matrixWorld, camN = camera direction (hd frame), altM = height over the ground (m)
    update(hd, mvD, camN, altM) {
      frame++;
      const far = P.r[2];
      if (off || !meta || !index || altM > far * .6) return 0;
      PK.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
      const la = Math.asin(Math.max(-1, Math.min(1, camN.y))), lo = Math.atan2(-camN.z, camN.x), n = 1 << ZC;
      const my = Math.log(Math.tan(Math.PI / 4 + la / 2)), fx = (lo + Math.PI) / (2 * Math.PI) * n, fy = (1 - my / Math.PI) / 2 * n;
      const cw = 2 * Math.PI * R * Math.cos(la) / n, rc = Math.ceil(far / cw) + 1, want = [];
      for (let y = Math.floor(fy) - rc; y <= Math.floor(fy) + rc; y++) for (let x = Math.floor(fx) - rc; x <= Math.floor(fx) + rc; x++) {
        const d = Math.max(0, Math.hypot(x + .5 - fx, y + .5 - fy) * cw - cw * .75); if (d > far) continue;   // d: about the nearest point of the cell
        const c = cellOf((x + n) % n, y); c.used = frame; c.d = d; c.need = d < P.r[0] ? 2 : d < P.r[1] ? 1 : 0; want.push(c); }
      want.sort((a, b) => a.d - b.d);
      // building: the nearest cell that needs more levels (or has a better source now), a few ms per frame, then the next one
      const t0 = performance.now();
      for (let tries = 0; performance.now() - t0 < P.ms; ) {
        if (!job) { for (const c of want) { if (c.need <= c.lvl && c.src >= 14) continue; if (++tries > 24) break;
            const S = sourceOf(c); if (S && (c.need > c.lvl || S.lvl > c.src)) { job = { c, it: build(c, S, Math.max(c.need, c.lvl)) }; break; } }
          if (!job) break; }
        if (job.it.next().done) job = null;
      }
      let drawn = 0;
      for (const c of want) if (c.mesh) { c.mesh.material.uniforms.cV.value.copy(c.u0).applyMatrix4(mvD); hd.add(c.mesh); drawn += c.n; }
      if (cells.size > 600) for (const c of [...cells.values()]) if (c.used < frame - 300) { if (c.mesh) { c.mesh.geometry.dispose(); c.mesh.material.dispose(); } cells.delete(c.k); }
      for (const M of [maps, est]) if (M.size > 48) for (const [k, v] of M) if (v.used < frame - 600) M.delete(k);
      return drawn;
    },
    stats: () => ({ cells: [...cells.values()].filter(c => c.mesh).length, trees: [...cells.values()].reduce((s, c) => s + (c.mesh ? c.n : 0), 0) }),
  };
}
