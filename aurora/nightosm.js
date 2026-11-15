/* Street lights on the 3D Earth at night, close to the ground: single light points along the real roads of OpenStreetMap.

   Source: OpenFreeMap vector tiles (OpenMapTiles schema, "© OpenMapTiles Data from OpenStreetMap", no key), max zoom 14. The tiles are
   decoded here by hand (Mapbox Vector Tile = protobuf). Layers used: `transportation` (roads) and, at z14, `building` (a few lit yards).

   Which roads are lit is not in OSM: a point is kept only where the NASA VIIRS 2016 lights (the close-up lights tiles of earthgl.js, z8,
   ~420 m) show light. The light of each VIIRS pixel is shared out over the points inside it (energy kept): the area seen from far has the
   same brightness as the raster it replaces, so the raster can be dimmed exactly where points carry its light (coverage texture, see
   covUpdate) and nothing pops when tiles come and go.

   Levels (rings around the camera, slant distance): z14 within 5 km, z12 within 35 km (and always 30 km around the point under the camera), z10 within 130 km; a finer level covers a coarser one
   per VIIRS pixel, with a 0.4 s cross-fade. Faded in between 100 and 90 km height. Above 100 km, in daylight, or with U.osmOn = 0: nothing is requested or drawn.
   Colours (ESTIMATE): high-pressure sodium ~2000 K and white LED ~4000 K, chosen per ~420 m block and road class (more LED on major roads). */

const R = 6371000, URL0 = 'https://tiles.openfreemap.org/planet/latest/';
const RINGS = [[14, 5000, 0], [12, 35000, 30000], [10, 130000, 0]];   // zoom, slant distance out to (m), at least this far on the ground (m)
const ALT1 = 90000, ALT0 = 100000;   // points fully in below ALT1, gone (and nothing requested) above ALT0, m
// road class -> [spacing m, LED share] (ESTIMATES: urban poles every 25-50 m; LED retrofits first on main roads)
const CLSD = { motorway: [45, .7], trunk: [42, .65], primary: [38, .6], secondary: [36, .55], tertiary: [34, .5], minor: [30, .4], service: [34, .35], busway: [34, .5] };
const CLS = {}, CLS_LED = [];   // class -> [spacing, rank]; rank -> LED share
Object.keys(CLSD).forEach((k, i) => { CLS[k] = [CLSD[k][0], i]; CLS_LED[i] = CLSD[k][1]; });
const MAXF = 4, RATE = 6, KEEP = 320, FADE = 400, POLE = 9;   // in flight, starts per second, tiles kept, fade ms, lamp height m
const LIT0 = 8;   // VIIRS value (of 255) below which a point is not kept
const CORE = .35, POOL = 12;   // share of a light's energy in the lamp itself; sigma of its pool of light on the road, m (ESTIMATES)

function hash(a, b, c) {   // three integers -> [0, 1)
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── Mapbox Vector Tile decoder (spec 2.1): Tile { repeated Layer layers = 3 }, Layer { name 1, features 2, keys 3, values 4, extent 5 },
//    Feature { id 1, tags 2 (packed), type 3, geometry 4 (packed) }, Value { string 1, float 2, double 3, int 4, uint 5, sint 6, bool 7 }.
//    Returns { <layer>: { extent, features: [{ type, tags: {k: v}, geom: [[x0, y0, x1, y1, ...], ...] }] } } for the layers in `want`.
export function decodeMvt(buf, want) {
  const b = new Uint8Array(buf), out = {};
  let p = 0;
  const vi = () => { let r = 0, s = 1, c; do { c = b[p++]; r += (c & 127) * s; s *= 128; } while (c >= 128); return r; };   // varint (up to 2^53)
  const skip = w => { if (w === 0) vi(); else if (w === 1) p += 8; else if (w === 2) { const l = vi(); p += l; } else if (w === 5) p += 4; else throw new Error('mvt wire ' + w); };
  const str = (a, e) => new TextDecoder().decode(b.subarray(a, e));
  const zz = n => (n >>> 1) ^ -(n & 1);
  function value(e) { let v = null; while (p < e) { const k = vi(), f = k >> 3, w = k & 7;
      if (f === 1 && w === 2) { const l = vi(); v = str(p, p + l); p += l; }
      else if (f === 2 && w === 5) { v = new DataView(b.buffer, b.byteOffset + p, 4).getFloat32(0, true); p += 4; }
      else if (f === 3 && w === 1) { v = new DataView(b.buffer, b.byteOffset + p, 8).getFloat64(0, true); p += 8; }
      else if ((f === 4 || f === 5) && w === 0) v = vi();
      else if (f === 6 && w === 0) { const n = vi(); v = n % 2 ? -(n + 1) / 2 : n / 2; }
      else if (f === 7 && w === 0) v = !!vi();
      else skip(w); }
    return v; }
  function geom(e) { const parts = []; let x = 0, y = 0, cur = null;
    while (p < e) { const c = vi(), id = c & 7, n = c >> 3;
      if (id === 1 || id === 2) for (let i = 0; i < n; i++) { x += zz(vi()); y += zz(vi()); if (id === 1) { cur = [x, y]; parts.push(cur); } else if (cur) cur.push(x, y); }
      else if (id === 7) { if (cur && cur.length > 2) cur.push(cur[0], cur[1]); }   // ClosePath: back to the ring's first point
      else throw new Error('mvt cmd ' + id); }
    return parts; }
  while (p < b.length) { const k = vi(), f = k >> 3, w = k & 7;
    if (f !== 3 || w !== 2) { skip(w); continue; }
    const l = vi(), e = p + l; let name = '', ext = 4096; const fr = [], keys = [], vals = [];
    while (p < e) { const k2 = vi(), f2 = k2 >> 3, w2 = k2 & 7;
      if (f2 === 1 && w2 === 2) { const n = vi(); name = str(p, p + n); p += n; if (!want.has(name)) { p = e; break; } }
      else if (f2 === 2 && w2 === 2) { const n = vi(); fr.push(p, p + n); p += n; }   // features: ranges first (keys / values may come later)
      else if (f2 === 3 && w2 === 2) { const n = vi(); keys.push(str(p, p + n)); p += n; }
      else if (f2 === 4 && w2 === 2) { const n = vi(), ve = p + n; vals.push(value(ve)); p = ve; }
      else if (f2 === 5 && w2 === 0) ext = vi();
      else skip(w2); }
    p = e;
    if (!want.has(name)) continue;
    const feats = [];
    for (let i = 0; i < fr.length; i += 2) { p = fr[i]; const fe = fr[i + 1], ft = { type: 0, tags: {}, geom: [] };
      while (p < fe) { const k3 = vi(), f3 = k3 >> 3, w3 = k3 & 7;
        if (f3 === 2 && w3 === 2) { const n = vi(), te = p + n; while (p < te) { const a = vi(), c = vi(); if (keys[a] !== undefined) ft.tags[keys[a]] = vals[c]; } }
        else if (f3 === 3 && w3 === 0) ft.type = vi();
        else if (f3 === 4 && w3 === 2) { const n = vi(), ge = p + n; ft.geom = geom(ge); p = ge; }
        else skip(w3); }
      feats.push(ft); }
    p = e; out[name] = { extent: ext, features: feats };
  }
  return out;
}

export function createNightOsm({ THREE, U, tiles, groundAt, camera, renderer }) {
  U.osmOn = U.osmOn || { value: 1 };   // code switch (the ⚙ switch comes later): 0 = no requests, no points, raster as before
  U.oK = U.oK || { value: 0 };         // 0..1: how much the points replace the raster (altitude fade x on), read by the tile shader
  const T = new Map(), covs = new Map(), alphas = new Map();
  let frame = 0, inflight = 0, tokens = RATE, tLast = performance.now(), wantK = new Set(), prevN = null, prevT = 0, vel = new THREE.Vector3();
  const net = [];   // [time ms, bytes] of finished requests, for stats()
  const zero = new THREE.DataTexture(new Uint8Array(4), 1, 1); zero.needsUpdate = true;
  const pxK = { value: 1000 }, PK = { value: 2 }, PP = { value: .06 }, asp = { value: 1 };   // PP: the brightest a pool of light may be near   // PK: the brightest a point's core may be (linear, before exposure)

  // ── the VIIRS lights of a z8 tile as bytes (alpha = light), read once from the lights tile earthgl.js loaded for the night side
  const cv = new OffscreenCanvas(256, 256), cx = cv.getContext('2d', { willReadFrequently: true });
  function alphaOf(x8, y8) {
    const k = x8 + '/' + y8; let a = alphas.get(k); if (a) return a;
    const t = tiles.get('8/' + k), im = t && t.lt && t.lt.image; if (!im) return null;
    cx.clearRect(0, 0, 256, 256); cx.drawImage(im, 0, 0, 256, 256); const d = cx.getImageData(0, 0, 256, 256).data;
    a = new Uint8Array(65536); for (let i = 0; i < 65536; i++) a[i] = d[i * 4 + 3];
    alphas.set(k, a); return a;
  }
  // light of a VIIRS value as the tile shader draws it, without the colour tint (TFS: pow(a, 2.2), SHADE: pow(nt, 1.35) * 1.5)
  const Lof = a => Math.pow(a / 255, 2.2 * 1.35) * 1.5;

  // ── per z8 tile: the weight of each level per VIIRS pixel (r = z10, g = z12, b = z14 points) and a = the share of the raster carried by points
  function covOf(x8, y8) { const k = x8 + '/' + y8; let c = covs.get(k);
    if (!c) { const arr = new Uint8Array(65536 * 4), tex = new THREE.DataTexture(arr, 256, 256); tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
      c = { k, x8, y8, arr, S: new Float32Array(65536), A: new Float32Array(65536), tex, dirty: true }; covs.set(k, c); }
    return c; }
  function covUpdate(c) {
    const { arr, S, A } = c; arr.fill(0); S.fill(0); A.fill(0);
    const act = []; for (const t of T.values()) if (t.f > 0 && t.pts && t.k8 === c.k) act.push(t);
    act.sort((a, b) => b.z - a.z);   // finest first: what it does not cover goes to the coarser levels
    for (const t of act) { const ch = t.z === 14 ? 2 : t.z === 12 ? 1 : 0, sp = 256 >> (t.z - 8), m = (1 << (t.z - 8)) - 1, x0 = (t.x & m) * sp, y0 = (t.y & m) * sp;
      for (let j = 0; j < sp; j++) for (let i = 0; i < sp; i++) { const q = (y0 + j) * 256 + x0 + i, w = t.f * (1 - S[q]); if (w <= 0) continue;
        S[q] += w; arr[q * 4 + ch] = Math.round(w * 255); if (t.z >= 12 || t.has[j * sp + i]) A[q] += w; } }
    for (let q = 0; q < 65536; q++) arr[q * 4 + 3] = Math.round(Math.min(1, A[q]) * 255);
    c.tex.needsUpdate = true; c.dirty = false;
  }

  // ── a tile: its frame (like geomOf in earthgl.js), the download, the points
  const nrmOf = (la, lo) => new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
  function tileOf(z, x, y) {
    const k = z + '/' + x + '/' + y; let t = T.get(k); if (t) return t;
    const n = 1 << z, lo0 = x / n * 2 * Math.PI - Math.PI, dlo = 2 * Math.PI / n, my0 = Math.PI * (1 - 2 * y / n), dmy = 2 * Math.PI / n;
    const la = Math.atan(Math.sinh(my0 - dmy / 2)), lo = lo0 + dlo / 2;
    t = { k, z, x, y, la, lo, cl: Math.cos(la), k8: (x >> (z - 8)) + '/' + (y >> (z - 8)), u0: nrmOf(la, lo),
      e0: new THREE.Vector3(-Math.sin(lo), 0, -Math.cos(lo)), n0: new THREE.Vector3(-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo)),
      st: 0, data: null, ctl: null, pts: null, has: null, f: 0, used: frame, demZ: -1 };
    T.set(k, t); return t;
  }
  function load(t) {
    t.st = 1; t.ctl = new AbortController(); inflight++;
    fetch(URL0 + t.k + '.pbf', { signal: t.ctl.signal }).then(r => { if (r.status === 204 || r.status === 404) return new ArrayBuffer(0); if (!r.ok) throw r.status; return r.arrayBuffer(); })
      .then(buf => { net.push([performance.now(), buf.byteLength]);
        const d = buf.byteLength ? decodeMvt(buf, new Set(['transportation', 'building'])) : {};
        t.data = { tr: d.transportation || null, bd: t.z === 14 ? d.building || null : null }; t.st = 2; })
      .catch(e => { t.st = e && e.name === 'AbortError' ? 0 : 0; t.fail = (t.fail || 0) + (e && e.name === 'AbortError' ? 0 : 1); t.retry = performance.now() + 4000 * (t.fail || 0); })
      .finally(() => { inflight--; t.ctl = null; });
  }
  // which DEM level covers the tile's centre now (earthgl.js keeps heights at z <= 12)
  function demZ(t) { const n12 = 4096, my = Math.log(Math.tan(Math.PI / 4 + t.la / 2)), fx = (t.lo + Math.PI) / (2 * Math.PI), fy = (1 - my / Math.PI) / 2;
    for (let z = 12; z >= 2; z--) { const n = 1 << z, d = tiles.get(z + '/' + Math.floor(fx * n) + '/' + Math.floor(fy * n)); if (d && d.dem) return z; } return -1; }

  // points: along each road every `spacing` m (start phase by hash), kept where VIIRS shows light; + every ~8th building's middle at z14
  function build(t) {
    const x8 = t.x >> (t.z - 8), y8 = t.y >> (t.z - 8), al = alphaOf(x8, y8); if (!al) return false;
    const dz = demZ(t); if (dz < 0) return false;
    const n = 1 << t.z, sp8 = 256 >> (t.z - 8), m8 = (1 << (t.z - 8)) - 1, px0 = (t.x & m8) * sp8, py0 = (t.y & m8) * sp8;
    const wE = 2 * Math.PI * R * t.cl / n, P = [];   // P: x, y in tile units (0..1), class rank, LED share
    const tr = t.data.tr;
    if (tr) { const E = tr.extent;
      for (const f of tr.features) { const cls = CLS[f.tags.class]; if (!cls || f.tags.brunnel === 'tunnel' || f.type !== 2) continue;
        const spc = cls[0] / wE * E;   // spacing in tile units
        for (const g of f.geom) { let acc = spc * hash(g[0] + 7, g[1] + 13, t.z);
          for (let i = 2; i < g.length; i += 2) { const ax = g[i - 2], ay = g[i - 1], dx = g[i] - ax, dy = g[i + 1] - ay, L = Math.hypot(dx, dy); if (!L) continue;
            let s = acc; for (; s < L; s += spc) { const x = (ax + dx * s / L) / E, y = (ay + dy * s / L) / E; if (x >= 0 && x < 1 && y >= 0 && y < 1) P.push(x, y, cls[1], 0); }
            acc = s - L; } } } }
    const bd = t.data.bd;
    if (bd) { const E = bd.extent;
      for (const f of bd.features) { if (f.type !== 3) continue;
        for (const g of f.geom) { let a = 0, cx2 = 0, cy2 = 0; for (let i = 2; i < g.length; i += 2) { const c = g[i - 2] * g[i + 1] - g[i] * g[i - 1]; a += c; cx2 += (g[i - 2] + g[i]) * c; cy2 += (g[i - 1] + g[i + 1]) * c; }
          if (a <= 0) continue;   // MVT: outer rings have positive area (y down), holes negative
          const x = cx2 / (3 * a) / E, y = cy2 / (3 * a) / E, am2 = a / 2 / (E * E) * wE * wE;
          if (am2 < 80 || x < 0 || x >= 1 || y < 0 || y >= 1 || hash(Math.round(x * 65536), Math.round(y * 65536), 5) > .12) continue;
          P.push(x, y, .5, 1); } } }
    // VIIRS at each point (bilinear) -> keep or not; per VIIRS pixel the weights are scaled so they add up to that pixel's light x its area
    const pa = (wE / sp8) ** 2, keep = [], W = new Float32Array(sp8 * sp8), has = new Uint8Array(sp8 * sp8);
    for (let i = 0; i < P.length; i += 4) {
      const u = px0 + P[i] * sp8 - .5, v = py0 + P[i + 1] * sp8 - .5, i0 = Math.max(0, Math.min(254, Math.floor(u))), j0 = Math.max(0, Math.min(254, Math.floor(v))), a = Math.min(1, Math.max(0, u - i0)), b = Math.min(1, Math.max(0, v - j0));
      const lit = (al[j0 * 256 + i0] * (1 - a) + al[j0 * 256 + i0 + 1] * a) * (1 - b) + (al[(j0 + 1) * 256 + i0] * (1 - a) + al[(j0 + 1) * 256 + i0 + 1] * a) * b;
      if (lit < LIT0) continue;
      const ci = Math.min(sp8 - 1, Math.floor(P[i] * sp8)) + Math.min(sp8 - 1, Math.floor(P[i + 1] * sp8)) * sp8;
      const zb = P[i + 2] <= 2 && !P[i + 3] ? 12 : 15;   // colour block: ~7 km stretches of main roads (z12 cell), ~850 m of streets (z15 cell)
      const gx = Math.floor((t.x + P[i]) * 2 ** (zb - t.z)), gy = Math.floor((t.y + P[i + 1]) * 2 ** (zb - t.z));
      const r1 = hash(gx, gy, Math.round(P[i + 2] * 10) + 3), r2 = hash(Math.round((t.x + P[i]) * 2 ** (30 - t.z)), Math.round((t.y + P[i + 1]) * 2 ** (30 - t.z)), 9);
      const led = P[i + 3] ? (r1 < .3 ? 1 : .35) : r1 < CLS_LED[P[i + 2]] ? 1 : 0;
      const w = Lof(lit) * (.7 + .6 * r2); W[ci] += w; has[ci] = 1;
      keep.push(P[i], P[i + 1], w, ci, led);
    }
    // z10 holds only the major roads: a lit VIIRS pixel without one gets 1-12 lights scattered inside it (ESTIMATE: a village or the
    // streets between boulevards, places unknown), so no raster pixel is left to show as a block from far
    if (t.z < 12) for (let j = 0; j < sp8; j++) for (let i = 0; i < sp8; i++) { const ci = j * sp8 + i, a8 = al[(py0 + j) * 256 + px0 + i]; if (has[ci] || a8 < LIT0) continue;
      const nn = Math.max(1, Math.min(12, Math.round(a8 / 255 * 12)));
      for (let k = 0; k < nn; k++) { const gx = (px0 + i) * 64 + k, gy = py0 + j + (t.x >> (t.z - 8)) * 977 + (t.y >> (t.z - 8)) * 131;
        const w = Lof(a8) * (.7 + .6 * hash(gx, gy, 11)); W[ci] += w; has[ci] = 1;
        keep.push((i + .1 + .8 * hash(gx, gy, 12)) / sp8, (j + .1 + .8 * hash(gx, gy, 13)) / sp8, w, ci, hash(gx, gy, 14) < CLS_LED[5] ? 1 : 0); } }
    // light per VIIRS pixel (x area). The 420 m pixels are blurred: a pixel with light but no road (a park, a forested hill next to the
    // streets) gives its light to the pixels with points within 2 px (1 / d^2); z12 / z14 hold all the streets, so the raster is then
    // dimmed over the whole tile (covUpdate), z10 (major roads only) only where it has points.
    const Ec = new Float32Array(sp8 * sp8);
    for (let j = 0; j < sp8; j++) for (let i = 0; i < sp8; i++) Ec[j * sp8 + i] = has[j * sp8 + i] ? Lof(al[(py0 + j) * 256 + px0 + i]) * pa : 0;
    if (t.z >= 12) for (let j = 0; j < sp8; j++) for (let i = 0; i < sp8; i++) { const q = j * sp8 + i; if (has[q]) continue;
      const e = Lof(al[(py0 + j) * 256 + px0 + i]) * pa; if (e <= 0) continue; let sw = 0; const nb = [];
      for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= sp8 || jj >= sp8 || !has[jj * sp8 + ii]) continue; const w = 1 / (a * a + b * b); nb.push(jj * sp8 + ii, w); sw += w; }
      for (let k = 0; k < nb.length; k += 2) Ec[nb[k]] += e * nb[k + 1] / sw; }
    // positions relative to the tile's centre, east / north metres (small angles, like veg.js); heights in metres (x ex in the shader)
    const N = keep.length / 5, pos = new Float32Array(N * 3), ib = new Float32Array(N * 4);
    for (let k = 0; k < N; k++) { const x = keep[k * 5], y = keep[k * 5 + 1], ci = keep[k * 5 + 3];
      const lo = (t.x + x) / n * 2 * Math.PI - Math.PI, la = Math.atan(Math.sinh(Math.PI * (1 - 2 * (t.y + y) / n)));
      const h = groundAt(la, lo); pos[k * 3] = (lo - t.lo) * R * t.cl; pos[k * 3 + 1] = (la - t.la) * R; pos[k * 3 + 2] = h == null ? 0 : h;
      const cu = ci % sp8, cv2 = (ci / sp8) | 0;
      ib[k * 4] = W[ci] > 0 ? keep[k * 5 + 2] / W[ci] * Ec[ci] : 0;   // this point's share of its VIIRS pixel's light x area (m2)
      ib[k * 4 + 1] = px0 + cu; ib[k * 4 + 2] = py0 + cv2; ib[k * 4 + 3] = keep[k * 5 + 4]; }
    if (t.pts) { t.pts.geometry.dispose(); t.pts.material.dispose(); t.pts = null; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('ib', new THREE.BufferAttribute(ib, 4));
    const mat = new THREE.ShaderMaterial({ uniforms: { sun: U.sun, ex: U.ex, lightsOn: U.lightsOn, oK: U.oK, pxK, PK, PP, asp, cov: { value: covOf(x8, y8).tex }, lv: { value: t.z === 14 ? 2 : t.z === 12 ? 1 : 0 },
      cV: { value: new THREE.Vector3() }, e0: { value: t.e0 }, n0: { value: t.n0 }, u0: { value: t.u0 } },
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending });
    t.pts = new THREE.Points(g, mat); t.pts.frustumCulled = false; t.pts.renderOrder = 3; t.n = N; t.has = has; t.demZ = dz; t.data.ok = true;
    covOf(x8, y8).dirty = true;
    return true;
  }

  // A light's energy (light x area, m2) is drawn as two Gaussians in one sprite:
  // - the lamp: a small spot (sigma >= 0.7 px; a lamp head ~1.2 m near), its peak capped at PK (else a fog of bloom over the town);
  // - the pool of light it throws on the road (sigma POOL m on the ground, an ellipse squeezed by the view angle). VIIRS sees mostly this lit
  //   pavement; the pool's radiance does not depend on distance, so it carries the rest of the energy without a cap.
  // From far both shrink to < 1 px and add up per pixel: the same light as the raster. Lifted 9 m (pole) and pulled a little toward the
  // camera along the view ray (same pixel, depth bias: the mesh between its vertices and our heights are not exact). Colours have the
  // luminance of the raster's tint, so the swap keeps the brightness.
  const VS = /* glsl */`
    uniform vec3 cV, e0, n0, u0, sun; uniform float ex, lightsOn, oK, pxK, PK, PP, asp; uniform sampler2D cov; uniform int lv;
    attribute vec4 ib; varying vec3 vC; varying vec4 vS; varying vec2 vA, vU;
    void main() {
      vec4 cw = texelFetch(cov, ivec2(ib.yz), 0); float w = lv == 0 ? cw.r : lv == 1 ? cw.g : cw.b;
      vec3 dn = (e0 * position.x + n0 * position.y) / ${R}. - u0 * ((position.x * position.x + position.y * position.y) / ${2 * R * R}.);
      vec3 n = u0 + dn; float hh = (position.z * ex + 400. + ${POLE}.) / ${R}.;
      vec3 bv = cV + mat3(modelViewMatrix) * (dn + n * hh); float d = length(bv), dm = d * ${R}.;
      float mu = dot(normalize(n), sun), deep = 1. - smoothstep(-.12, -.015, mu);   /* same as SHADE in earthgl.js */
      vec3 nv = normalize(mat3(modelViewMatrix) * n); float ct = max(dot(nv, -bv / d), .05);
      float e = ib.x * w * oK * deep * lightsOn * pxK * pxK / (dm * dm);   /* energy on screen per unit cos */
      if (e * ct < 2e-3) { gl_Position = vec4(2., 2., 2., 1.); return; }
      float sc = max(.7, 1.2 * pxK / dm), sp = max(.7, ${POOL}. * pxK / dm);
      vec4 p = projectionMatrix * vec4(bv * (1. - min(.004 + 15. / dm, .3)), 1.), p1 = projectionMatrix * vec4(bv + nv * 1e-6, 1.);
      vec2 u = (p1.xy / p1.w - p.xy / p.w) * vec2(asp, -1.); vU = length(u) > 0. ? normalize(u) : vec2(0., 1.);   /* the ground's depth direction on screen (gl_PointCoord y is down) */
      /* pool radiance (light per m2 of road) capped at PP near (below the bloom threshold: lit streets, dark blocks), the cap lifted between
         6 and 20 km (geometric) so that from far the points carry all of the raster's light (no step where they take over) */
      float pm = min(ib.x * ${1 - CORE}, PP * ${(2 * Math.PI * POOL * POOL).toFixed(1)} * pow(1e4, smoothstep(6000., 20000., dm)));   /* x1 near, x1e4 (= no cap) from 20 km */
      float ce = e * ct * ${CORE}, cA = min(ce / (6.2832 * sc * sc), PK), pA = e * pm / max(ib.x, 1e-9) / (6.2832 * sp * sp);   /* pool: area 2 pi sp^2 ct, so cos cancels */
      if (sp < 1.) { cA += pA * ct * sp * sp / (sc * sc); pA = 0.; }   /* both within a pixel: one spot */
      vA = vec2(cA, pA); vS = vec4(sc, sp, max(ct, .15), 0.);
      vS.w = min(ceil(max(sc, sp) * 5.), 64.); gl_PointSize = vS.w;
      vec3 sod = vec3(1.585, .666, .159), led = vec3(.947, .805, .663);   /* ~2000 K / ~4000 K, scaled to the luminance of the raster tint (1, .8, .55) */
      vC = mix(sod, led, ib.w);
      gl_Position = p; }`;
  const FS = /* glsl */`
    varying vec3 vC; varying vec4 vS; varying vec2 vA, vU;
    void main() { vec2 r = (gl_PointCoord - .5) * vS.w, q = vec2(dot(r, vU) / vS.z, dot(r, vec2(-vU.y, vU.x)));
      float g = vA.x * exp(-dot(r, r) / (2. * vS.x * vS.x)) + vA.y * exp(-dot(q, q) / (2. * vS.y * vS.y)); if (g < 1e-3) discard;
      gl_FragColor = vec4(vC * g, 1.); }`;

  // ── the wanted tiles: per level, those within its slant distance of the camera's ground point and of where it will be in ~8 s
  function wanted(la, lo, altM, out, pri0) {
    const my = Math.log(Math.tan(Math.PI / 4 + la / 2));
    for (const [z, rz, r0] of RINGS) { if (altM >= rz && !r0) continue;
      const rh = Math.max(r0, Math.sqrt(Math.max(0, rz * rz - altM * altM))), n = 1 << z, fx = (lo + Math.PI) / (2 * Math.PI) * n, fy = (1 - my / Math.PI) / 2 * n, cw = 2 * Math.PI * R * Math.cos(la) / n, rc = Math.ceil(rh / cw);
      for (let y = Math.floor(fy) - rc; y <= Math.floor(fy) + rc; y++) for (let x = Math.floor(fx) - rc; x <= Math.floor(fx) + rc; x++) { if (y < 0 || y >= n) continue;
        const dx = Math.max(x - fx, 0, fx - x - 1), dy = Math.max(y - fy, 0, fy - y - 1), d = Math.hypot(dx, dy) * cw; if (d > rh) continue;
        const k = z + '/' + ((x + n) % n) + '/' + y, pr = pri0 + d / rh + (z === 10 ? 0 : z === 12 ? .1 : .2);
        if (!out.has(k) || out.get(k) > pr) out.set(k, pr); } }
  }

  let wantL = [];
  return {
    // once per frame from hdUpdate, after the HD tiles: same arguments as veg.js
    update(hd, mvD, camN, altM) {
      frame++; const now = performance.now(), dt = Math.min(.25, (now - (prevT || now)) / 1000); prevT = now;
      tokens = Math.min(RATE, tokens + dt * RATE);
      const mu = camN.dot(U.sun.value), on = U.osmOn.value > 0 && U.lightsOn.value > 0 && altM < ALT0 && mu < .01;   // from just before sunset: tiles are in when the lights switch on
      U.oK.value = on ? 1 - Math.min(1, Math.max(0, (altM - ALT1) / (ALT0 - ALT1))) : 0;
      // ground speed (rad/s on the unit sphere), smoothed: for the prefetch ahead in flight
      if (prevN && dt > 0) { const v = camN.clone().sub(prevN).multiplyScalar(1 / dt); vel.lerp(v, Math.min(1, dt * 2)); } prevN = (prevN || new THREE.Vector3()).copy(camN);
      if (on && frame % 10 === 1) {
        const W = new Map(), la = Math.asin(Math.max(-1, Math.min(1, camN.y))), lo = Math.atan2(-camN.z, camN.x);
        wanted(la, lo, altM, W, 0);
        if (vel.length() * R > 40) { const a = camN.clone().addScaledVector(vel, 8).normalize(); wanted(Math.asin(Math.max(-1, Math.min(1, a.y))), Math.atan2(-a.z, a.x), altM, W, .5); }
        wantK = new Set(W.keys()); wantL = [...W].sort((a, b) => a[1] - b[1]).map(e => e[0]);
      } else if (!on) { wantK = new Set(); wantL = []; }
      // abort downloads no longer wanted; start new ones (nearest / coarsest first) within the caps
      for (const t of T.values()) if (t.st === 1 && t.ctl && !wantK.has(t.k)) t.ctl.abort();
      for (const k of wantL) { if (inflight >= MAXF || tokens < 1) break; const [z, x, y] = k.split('/').map(Number), t = tileOf(z, x, y); t.used = frame;
        if (t.st === 0 && !(t.retry > now) && (t.fail || 0) < 4) { tokens--; load(t); } }
      // build: one tile per frame (data in, VIIRS + heights there); rebuild once finer heights came in
      for (const k of wantL) { const t = T.get(k); if (!t) continue; t.used = frame;
        if (t.st === 2 && !t.data.ok) { if (build(t)) break; }
        else if (t.st === 2 && t.pts && frame % 60 === t.z && demZ(t) > t.demZ) { if (build(t)) break; } }
      // fades: in when wanted and built, out otherwise; the coverage of a z8 tile is redone while anything in it changes
      const df = dt * 1000 / FADE;
      for (const t of T.values()) { const g = on && wantK.has(t.k) && t.pts ? 1 : 0; if (t.f === g) continue;
        t.f = g > t.f ? Math.min(1, t.f + df) : Math.max(0, t.f - df); covOf(...t.k8.split('/').map(Number)).dirty = true; }
      for (const c of covs.values()) if (c.dirty) covUpdate(c);
      // draw
      pxK.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360)); asp.value = camera.aspect;
      let drawn = 0;
      if (U.oK.value > 0) for (const t of T.values()) if (t.f > 0 && t.pts && t.n) { t.pts.material.uniforms.cV.value.copy(t.u0).applyMatrix4(mvD); hd.add(t.pts); drawn += t.n; }
      // forget the least recently used tiles over the limit (never one downloading or on screen)
      if (T.size > KEEP && frame % 30 === 0) for (const t of [...T.values()].sort((a, b) => a.used - b.used).slice(0, T.size - KEEP)) {
        if (t.st === 1 || t.f > 0) continue; if (t.pts) { t.pts.geometry.dispose(); t.pts.material.dispose(); } T.delete(t.k); }
      if (alphas.size > 24) for (const k of alphas.keys()) { alphas.delete(k); if (alphas.size <= 16) break; }
      return drawn;
    },
    // the coverage texture of a z8 lights tile, for the HD tile shader (raster dimmed where points carry its light)
    PK, PP, cov: (x8, y8) => { const c = covs.get(x8 + '/' + y8); return c ? c.tex : zero; },
    stats() { const now = performance.now(), m = net.filter(e => e[0] > now - 60000);
      const s = { tiles: 0, built: 0, active: 0, points: 0, inflight, reqMin: m.length, bytesMin: m.reduce((a, e) => a + e[1], 0), reqAll: net.length, bytesAll: net.reduce((a, e) => a + e[1], 0), z: { 10: 0, 12: 0, 14: 0 } };
      for (const t of T.values()) { s.tiles++; if (t.pts) s.built++; if (t.f > 0 && t.pts) { s.active++; s.points += t.n; s.z[t.z]++; } }
      return s; },
  };
}
