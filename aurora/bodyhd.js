/* Close-ups of other bodies (three.js): pictures + real heights streamed as a quadtree of tiles, like the Earth's close-up.
   Equirectangular tiles (2 × 1 at zoom 0, −180° … 180°, 90° … −90°), placed on the body's own frame (x = prime meridian,
   y = north pole, east = −z) so they sit exactly on the body's texture sphere. A tile is drawn once its picture and heights
   are in; until all four children are ready the parent stays (no holes).
   Moon: NASA Moon Trek — JAXA Kaguya Terrain Camera global ortho mosaic (tiles to ~21 m) + LRO LOLA DEM 128 ppd (~240 m, real heights in metres as Float32
   TIFF from Trek's image service). Both send CORS *; the requests only carry the tile's place on the Moon. */

const D2R = Math.PI / 180;
const TREK = 'https://trek.nasa.gov/';
const CFG = {
  Moon: { R: 1737400, ZMAX: 10, ZT: 6,
    img: (z, x, y) => `${TREK}tiles/Moon/EQ/Kaguya_TCortho_Mosaic_Global_4096ppd/1.0.0/default/default028mm/${z}/${y}/${x}.png`,
    dem: bb => `${TREK}moon/trekarcgis/rest/services/LRO_LOLA_DEM_Global_128ppd_v04/ImageServer/exportImage?bbox=${bb.join(',')}&bboxSR=104903&imageSR=104903&size=256,256&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`,
    cal: 'img/planets/moon_hdcal.jpg',   // per place: far sphere colour / Kaguya (tools/build_moon_lo.py)
    gain: 1.25 },
};

// an uncompressed Float32 TIFF (strips or tiles) → heights, row 0 = north
function tiffF32(buf) {
  const dv = new DataView(buf), le = dv.getUint16(0) === 0x4949, u16 = o => dv.getUint16(o, le), u32 = o => dv.getUint32(o, le);
  const ifd = u32(4), n = u16(ifd), T = {};
  for (let i = 0; i < n; i++) { const o = ifd + 2 + i * 12, tag = u16(o), type = u16(o + 2), cnt = u32(o + 4), sz = type === 3 ? 2 : 4, at = cnt * sz <= 4 ? o + 8 : u32(o + 8), a = [];
    for (let k = 0; k < cnt && k < 4096; k++) a.push(type === 3 ? u16(at + k * 2) : u32(at + k * 4)); T[tag] = a; }
  if (T[259] && T[259][0] !== 1) throw new Error('compressed TIFF');
  const W = T[256][0], H = T[257][0], out = new Float32Array(W * H);
  if (T[322]) { const tw = T[322][0], th = T[323][0], across = Math.ceil(W / tw);
    T[324].forEach((off, k) => { const x0 = (k % across) * tw, y0 = Math.floor(k / across) * th;
      for (let j = 0; j < th && y0 + j < H; j++) for (let i = 0; i < tw && x0 + i < W; i++) out[(y0 + j) * W + x0 + i] = dv.getFloat32(off + (j * tw + i) * 4, le); }); }
  else { let k = 0; T[273].forEach((off, s) => { const m = T[279][s] / 4; for (let i = 0; i < m && k < out.length; i++) out[k++] = dv.getFloat32(off + i * 4, le); }); }
  return { W, H, h: out };
}

export function createBodyHD({ THREE, renderer, Q }) {
  const G = Q === 'low' ? 16 : 32, PX = Q === 'low' ? 380 : Q === 'medium' ? 280 : 210, ZCUT = Q === 'low' ? 1 : 0;
  const group = new THREE.Group(); group.visible = false;
  const aniso = renderer.capabilities.getMaxAnisotropy();
  // calibration maps (log2 ratio, + 4, / 8); until one has loaded: a flat ratio of about 4
  const CAL0 = new THREE.DataTexture(new Uint8Array([195, 195, 195, 255]), 1, 1, THREE.RGBAFormat); CAL0.needsUpdate = true; const CAL = {};
  const calOf = s => { if (!s.cfg.cal) return CAL0; if (!CAL[s.cfg.cal]) { CAL[s.cfg.cal] = CAL0; new THREE.TextureLoader().load(s.cfg.cal, tx => { tx.colorSpace = THREE.NoColorSpace; tx.wrapS = THREE.RepeatWrapping; tx.generateMipmaps = false; tx.minFilter = THREE.LinearFilter; CAL[s.cfg.cal] = tx; for (const t of s.tiles.values()) if (t.mesh) t.mesh.material.uniforms.cal.value = tx; }); } return CAL[s.cfg.cal]; };
  // one grid for every tile (+ skirts: the border again, pulled down, so cracks never show)
  const tileGeo = (() => { const P = [], UV = [], SK = [], I = [], id = (i, j) => j * (G + 1) + i, ring = [];
    for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) { P.push(0, 0, 0); UV.push(i / G, j / G); SK.push(0); }
    for (let i = 0; i < G; i++) ring.push([i, 0]); for (let j = 0; j < G; j++) ring.push([G, j]); for (let i = G; i > 0; i--) ring.push([i, G]); for (let j = G; j > 0; j--) ring.push([0, j]);
    const base = (G + 1) * (G + 1); ring.forEach(([i, j]) => { P.push(0, 0, 0); UV.push(i / G, j / G); SK.push(1); });
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1); I.push(a, c, b, b, c, d); }
    for (let k = 0; k < ring.length; k++) { const k2 = (k + 1) % ring.length, a = id(...ring[k]), b = id(...ring[k2]); I.push(a, base + k, b, b, base + k, base + k2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    g.setAttribute('sk', new THREE.Float32BufferAttribute(SK, 1)); g.setIndex(I); return g; })();
  const VS = /* glsl */`
    uniform vec4 rect; uniform sampler2D hmap; uniform vec3 hsub; uniform float skirt, R; attribute float sk; varying vec2 vT; varying vec3 vO; varying float vD;
    void main() { vT = uv; float lon = rect.x + uv.x * rect.y, lat = rect.z - uv.y * rect.w;
      float h = texture2D(hmap, ((hsub.xy + uv * hsub.z) * 255. + .5) / 256.).r;   // pixel centres sit on the tile edges
      vec3 n = vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon)); vO = n;
      vec4 mv = modelViewMatrix * vec4(n * (1. + h / R - sk * skirt), 1.); vD = length(mv.xyz) * 6371000.;   // camera distance, m
      gl_Position = projectionMatrix * mv; }`;
  const FS = /* glsl */`
    uniform sampler2D img, pimg, nmap, cal; uniform vec3 psub, hsub, sun; uniform float fade, gain, R; varying vec2 vT; varying vec3 vO; varying float vD;
    // the sun direction is in the body's own frame; sm(): smooth magnification (no square texels when the picture runs out of detail)
    vec2 sm(vec2 u) { u = u * 256. + .5; vec2 i = floor(u), f = fract(u); f = f * f * (3. - 2. * f); return (i + f - .5) / 256.; }
    float hs(vec3 p) { p = mod(p, 289.); return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
    float vn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(mix(hs(i), hs(i + vec3(1, 0, 0)), f.x), mix(hs(i + vec3(0, 1, 0)), hs(i + vec3(1, 1, 0)), f.x), f.y),
                 mix(mix(hs(i + vec3(0, 0, 1)), hs(i + vec3(1, 0, 1)), f.x), mix(hs(i + vec3(0, 1, 1)), hs(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
    void main() { vec3 n = normalize(vO), ea = normalize(vec3(n.z, 0., -n.x) + vec3(1e-5)), no = cross(n, ea);
      vec3 c = mix(texture2D(pimg, sm(psub.xy + vT * psub.z)).rgb, texture2D(img, sm(vT)).rgb, fade);
      // the far sphere's brightness + colour at this place (evens out the mosaic's orbit strips)
      c *= exp2(texture2D(cal, vec2(atan(-n.z, n.x) / 6.2831853 + .5, .5 - asin(clamp(n.y, -1., 1.)) / 3.1415927)).rgb * 8. - 4.);
      // close up (below ~40 km): fine regolith detail made up on the spot, finer than the 21 m pictures; the local metres keep float precision
      float dk = 1. - smoothstep(4000., 40000., vD);
      if (dk > 0.) { vec3 q = vO * R; float d = vn(q / 60.) * .5 + vn(q / 19.) * .3 + vn(q / 6.) * .2;
        c *= 1. + dk * (d - .5) * .45; }
      vec3 tn = texture2D(nmap, ((hsub.xy + vT * hsub.z) * 255. + .5) / 256.).xyz * 2. - 1., N = normalize(ea * tn.x + no * tn.y + n * tn.z);
      float l = max(dot(N, sun), 0.) * smoothstep(-.02, .04, dot(n, sun));   // the slope's own light, and the night side stays dark
      gl_FragColor = vec4(c * (l * gain + .012), 1.); }`;

  const S = {};   // per body: its tile cache
  function state(name) { if (S[name]) return S[name]; return S[name] = { cfg: CFG[name], tiles: new Map(), demQ: [], act: 0, frame: 0 }; }
  const nrm = (lat, lon) => new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
  function tileOf(s, z, x, y) { const k = z + '/' + x + '/' + y; let t = s.tiles.get(k); if (t) return t;
    const nx = 2 << z, ny = 1 << z, l0 = -Math.PI + x * 2 * Math.PI / nx, dl = 2 * Math.PI / nx, a1 = Math.PI / 2 - y * Math.PI / ny, da = Math.PI / ny;
    t = { k, z, x, y, lon0: l0, dlon: dl, lat1: a1, dlat: da, used: 0 };
    t.c = nrm(a1 - da / 2, l0 + dl / 2); t.rho = Math.max(...[[a1, l0], [a1, l0 + dl], [a1 - da, l0], [a1 - da, l0 + dl], [a1, l0 + dl / 2], [a1 - da, l0 + dl / 2]].map(([a, b]) => t.c.angleTo(nrm(a, b))));
    s.tiles.set(k, t); return t; }
  const demOf = (s, t) => t.z <= s.cfg.ZT ? t : tileOf(s, s.cfg.ZT, t.x >> (t.z - s.cfg.ZT), t.y >> (t.z - s.cfg.ZT));
  // far out (zoom < 3) the relief can't be seen: those tiles use a flat height map instead of asking the slow height service
  const FLAT = (() => { const h = new Float32Array(65536), nm = new Uint8Array(65536 * 4); for (let i = 0; i < 65536; i++) nm.set([128, 128, 255, 255], i * 4);
    const ht = new THREE.DataTexture(h, 256, 256, THREE.RedFormat, THREE.FloatType); ht.needsUpdate = true; const nt = new THREE.DataTexture(nm, 256, 256, THREE.RGBAFormat); nt.needsUpdate = true; return { h, ht, nt, flat: true }; })();
  const ready = (s, t) => { if (t.z < 3 && !t.dem) t.dem = FLAT; return t.img && demOf(s, t).dem; };
  // the mosaic has thin gaps between orbit strips (transparent pixels): fill them from the pixels around
  const gc = new OffscreenCanvas(256, 256), gx = gc.getContext('2d', { willReadFrequently: true });
  function fillGaps(bm) { gx.clearRect(0, 0, 256, 256); gx.drawImage(bm, 0, 0, 256, 256); bm.close?.();
    const d = gx.getImageData(0, 0, 256, 256).data, ok = new Uint8Array(65536); let bad = 0;
    for (let i = 0; i < 65536; i++) if (d[i * 4 + 3] > 250) ok[i] = 1; else bad++;
    for (let pass = 0; bad && pass < 24; pass++) { const nw = [];
      for (let i = 0; i < 65536; i++) if (!ok[i]) { const x = i & 255, y = i >> 8; let r = 0, g = 0, b = 0, n = 0;
        for (const j of [x > 0 ? i - 1 : -1, x < 255 ? i + 1 : -1, y > 0 ? i - 256 : -1, y < 255 ? i + 256 : -1]) if (j >= 0 && ok[j]) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; n++; }
        if (n) nw.push(i, r / n, g / n, b / n); }
      for (let k = 0; k < nw.length; k += 4) { const i = nw[k]; d[i * 4] = nw[k + 1]; d[i * 4 + 1] = nw[k + 2]; d[i * 4 + 2] = nw[k + 3]; d[i * 4 + 3] = 255; ok[i] = 1; bad--; } if (!nw.length) break; }
    for (let i = 0; i < 65536; i++) d[i * 4 + 3] = 255; return new Uint8Array(d.buffer); }
  function loadImg(s, t) { t.imgP = true; s.act++;
    fetch(s.cfg.img(t.z, t.x, t.y)).then(r => { if (!r.ok) throw r.status; return r.blob(); }).then(b => createImageBitmap(b)).then(bm => {
      const tx = new THREE.DataTexture(fillGaps(bm), 256, 256, THREE.RGBAFormat); tx.flipY = false; tx.magFilter = THREE.LinearFilter; tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = Math.min(8, aniso);
      tx.minFilter = THREE.LinearMipmapLinearFilter; tx.generateMipmaps = true; tx.needsUpdate = true; t.img = tx; })
      .catch(() => { t.fail = (t.fail || 0) + 1; }).finally(() => { s.act--; setTimeout(() => t.imgP = false, t.img ? 0 : 3000 * (t.fail || 1)); }); }
  function loadDem(s, t) { t.demP = true; s.act++;
    // half a pixel more on each side: the 256 pixel centres then fall exactly on the tile's edges (neighbours share their border heights)
    const e = t.dlon / D2R / 255 / 2, f = t.dlat / D2R / 255 / 2, l0 = t.lon0 / D2R, a1 = t.lat1 / D2R;
    fetch(s.cfg.dem([l0 - e, a1 - t.dlat / D2R - f, l0 + t.dlon / D2R + e, a1 + f])).then(r => { if (!r.ok) throw r.status; return r.arrayBuffer(); })
      .then(b => s.demQ.push([t, tiffF32(b)])).catch(() => { t.fail = (t.fail || 0) + 1; setTimeout(() => t.demP = false, 3000 * t.fail); }).finally(() => s.act--); }
  function decodeDem(s, t, d) {   // heights (m) for the mesh + a normal map (east / north / up) for the light
    const h = d.h, R = s.cfg.R, nm = new Uint8Array(65536 * 4);
    for (let j = 0; j < 256; j++) { let last = 0; for (let i = 0; i < 256; i++) { const k = j * 256 + i, v = h[k]; if (!(v > -2e4 && v < 2e4)) h[k] = last; else last = v; } }   // no data (beyond the poles / date line) → the neighbour
    const my = R * t.dlat / 255;
    for (let j = 0; j < 256; j++) { const lat = t.lat1 - j / 255 * t.dlat, mx = Math.max(R * Math.cos(lat) * t.dlon / 255, my * .02), ju = Math.max(j - 1, 0) * 256, jd = Math.min(j + 1, 255) * 256;
      for (let i = 0; i < 256; i++) { const k = j * 256 + i, gx = (h[j * 256 + Math.min(i + 1, 255)] - h[j * 256 + Math.max(i - 1, 0)]) / (2 * mx), gy = (h[ju + i] - h[jd + i]) / (2 * my);
        const nz = 1 / Math.sqrt(gx * gx + gy * gy + 1); nm[k * 4] = (-gx * nz * .5 + .5) * 255; nm[k * 4 + 1] = (-gy * nz * .5 + .5) * 255; nm[k * 4 + 2] = (nz * .5 + .5) * 255; nm[k * 4 + 3] = 255; } }
    const ht = new THREE.DataTexture(h, 256, 256, THREE.RedFormat, THREE.FloatType); ht.needsUpdate = true;
    const nt = new THREE.DataTexture(nm, 256, 256, THREE.RGBAFormat); nt.magFilter = THREE.LinearFilter; nt.minFilter = THREE.LinearMipmapLinearFilter; nt.generateMipmaps = true; nt.needsUpdate = true;
    t.dem = { h, ht, nt }; }
  function meshOf(s, t, sun) { const d = demOf(s, t); if (t.mesh && t.mesh.material.uniforms.hmap.value === d.dem.ht) return t.mesh; t.mesh?.material.dispose();
    const ZT = s.cfg.ZT, sc = t.z > ZT ? 1 / (1 << (t.z - ZT)) : 1, m = t.z > ZT ? 1 << (t.z - ZT) : 1;
    const p = t.z > 0 ? s.tiles.get((t.z - 1) + '/' + (t.x >> 1) + '/' + (t.y >> 1)) : null, pok = p && p.img;
    const mat = new THREE.ShaderMaterial({ uniforms: { img: { value: t.img }, pimg: { value: pok ? p.img : t.img }, psub: { value: new THREE.Vector3(pok ? (t.x & 1) * .5 : 0, pok ? (t.y & 1) * .5 : 0, pok ? .5 : 1) },
        hmap: { value: d.dem.ht }, nmap: { value: d.dem.nt }, hsub: { value: new THREE.Vector3((t.x % m) * sc, (t.y % m) * sc, sc) }, rect: { value: new THREE.Vector4(t.lon0, t.dlon, t.lat1, t.dlat) },
        fade: { value: pok ? 0 : 1 }, skirt: { value: Math.max(t.rho * .05, 4000 / s.cfg.R) }, R: { value: s.cfg.R }, sun: { value: sun }, gain: { value: s.cfg.gain }, cal: { value: calOf(s) } }, vertexShader: VS, fragmentShader: FS });
    t.mesh = new THREE.Mesh(tileGeo, mat); t.mesh.frustumCulled = false; t.born = 0; return t.mesh; }
  // the finest height we have under a direction (body frame), metres
  function groundM(s, v) { const lat = Math.asin(Math.max(-1, Math.min(1, v.y))), lon = Math.atan2(-v.z, v.x);
    for (let z = s.cfg.ZT; z >= 0; z--) { const nx = 2 << z, ny = 1 << z, fx = (lon + Math.PI) / (2 * Math.PI) * nx, fy = (Math.PI / 2 - lat) / Math.PI * ny, t = s.tiles.get(z + '/' + Math.min(nx - 1, fx | 0) + '/' + Math.min(ny - 1, fy | 0));
      if (t && t.dem && !t.dem.flat) { const h = t.dem.h, u = Math.min(254.999, Math.max(0, (fx % 1) * 255)), w = Math.min(254.999, Math.max(0, (fy % 1) * 255)), i = u | 0, j = w | 0, a = u - i, b = w - j, k = j * 256 + i;
        return (h[k] * (1 - a) + h[k + 1] * a) * (1 - b) + (h[k + 256] * (1 - a) + h[k + 257] * a) * b; } } return 0; }

  const fr = new THREE.Frustum(), fm = new THREE.Matrix4(), sph = new THREE.Sphere(), camL = new THREE.Vector3(), camN = new THREE.Vector3(), qi = new THREE.Quaternion();
  const sunV = new THREE.Vector3();
  let on = null, need = [], drawn = [], pxK = 1000;
  // b: the body (solar.js), cam: the far camera (at the origin), sunDir: world direction from the body to the Sun
  function update(b, cam, sunDir) {
    const s = b && CFG[b.name] ? state(b.name) : null, want = s && b.rs <= b.R * 1.001 && b.px > (on === b.name ? 250 : 350);
    if (!want) { if (on) { group.visible = false; on = null; } return null; }
    on = b.name; group.visible = true; s.frame++;
    group.position.copy(b.rel); group.quaternion.copy(b.mesh.quaternion); group.scale.setScalar(b.R); group.updateMatrixWorld(true);
    qi.copy(b.mesh.quaternion).invert(); camL.copy(b.rel).negate().applyQuaternion(qi).divideScalar(b.R); const D = camL.length(); camN.copy(camL).normalize();
    fm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(group.matrixWorld); fr.setFromProjectionMatrix(fm);
    const hor = Math.acos(Math.min(1, 1 / D)) + .03; pxK = renderer.domElement.height / (2 * Math.tan(cam.fov * D2R / 2)); sunV.copy(sunDir).applyQuaternion(qi);   // the Sun in the body's own frame
    need = []; drawn = [];
    const culled = t => { if (t.c.angleTo(camN) - t.rho > hor) return true; sph.center.copy(t.c); sph.radius = 2 * Math.sin(Math.min(t.rho, 1.5) / 2) + .01; return !fr.intersectsSphere(sph); };
    const walk = t => { if (culled(t)) return; t.used = s.frame;
      const dist = Math.max(camL.distanceTo(t.c) - 2 * Math.sin(Math.min(t.rho, 1.5) / 2), (D - 1) * .7, 1e-6), px = t.rho * 1.41 / dist * pxK;
      if (t.z < s.cfg.ZMAX - ZCUT && (t.z < 2 || px > PX)) { const ch = [0, 1, 2, 3].map(i => tileOf(s, t.z + 1, t.x * 2 + (i & 1), t.y * 2 + (i >> 1)));
        const vis = ch.filter(k => !culled(k)); vis.forEach(k => { k.used = s.frame; if (!ready(s, k)) need.push(k); });
        if (vis.every(k => ready(s, k))) { vis.forEach(walk); return; } }
      if (ready(s, t)) { drawn.push(t); demOf(s, t).used = s.frame; } else need.push(t); };
    walk(tileOf(s, 0, 0, 0)); walk(tileOf(s, 0, 1, 0));
    for (const t0 = performance.now(); s.demQ.length && performance.now() - t0 < 6;) decodeDem(s, ...s.demQ.shift());
    need.sort((a, b) => a.z - b.z);
    for (const t of need) { if (s.act >= 12) break; const d = demOf(s, t); if (!d.dem && !d.demP && s.act < 8) loadDem(s, d); if (!t.img && !t.imgP && s.act < 12) loadImg(s, t); }
    group.clear(); const now = performance.now();
    for (const t of drawn) { const m = meshOf(s, t, sunV), u = m.material.uniforms; if (!t.born) t.born = now;
      const f = Math.min(1, (now - t.born) / 400); u.fade.value = f * f * (3 - 2 * f); if (f >= 1) u.pimg.value = t.img; group.add(m); }
    // forget tiles not seen for a while (GPU memory)
    if (s.tiles.size > 700 && s.frame % 60 === 0) for (const [k, t] of s.tiles) if (t.z > 1 && s.frame - t.used > 600 && !t.imgP && !t.demP) {
      t.img?.dispose(); if (t.dem && !t.dem.flat) { t.dem.ht.dispose(); t.dem.nt.dispose(); } t.mesh?.material.dispose(); s.tiles.delete(k); }
    return { clear: (D - 1 - groundM(s, camN) / s.cfg.R) * b.R };   // the camera's height above the drawn ground, R⊕
  }
  // height of the ground under a world direction from the body's centre, in body radii (0 = the reference sphere)
  function ground(name, b, dirW) { const s = S[name]; if (!s) return 0; return groundM(s, dirW.clone().applyQuaternion(qi.copy(b.mesh.quaternion).invert())) / s.cfg.R; }
  return { group, update, ground, has: name => !!CFG[name], get on() { return on; } };
}
