/* Roads on the 3D Earth close to the ground: OpenStreetMap road lines (OpenFreeMap z14 vector tiles, layer `transportation`) painted inside the HD
   ground tiles' own fragment shader (earthgl.js TFS calls rdPaint), so they lie exactly on the drawn relief: no extra mesh, no z-fighting.

   - Per z14 tile near the camera the roads are rasterized on the CPU into a road mask (S x S px RGBA8, ~1.7 m per px at 46 N with S = 1024 within
     1.5 km, S = 512 out to 7 km; at most 32 masks, ~60 MB of GPU memory):
       R = |u| x 40, u = distance to the road's centre line / its half width (so the road is |u| < 1; kept up to ~2.5 px past the edge, so the
           bilinear filter rebuilds the edge between the pixels: sharp at any zoom),
       G, B = cos / sin of 2 pi s / P (s = metres along the road, P = the surface texture's repeat): the texture coordinate along the road
           survives the bilinear filter (an 8-bit coordinate would wrap),
       A = surface (bits 0-1: 1 asphalt, 2 gravel, 3 dirt) + class rank << 2 (read unfiltered with texelFetch).
     Where roads overlap, the higher class wins inside its own width, else the nearer centre line.
   - Look: Arma Reforger road textures (img/roads/roads.webp by tools/build_roads_tex.py: asphalt, gravel trail, two-track dirt road), mirrored
     about the centre line, with their own ragged edges. Centre dashes 3 m / 6 m gap on tertiary and bigger asphalt roads, edge lines on primary and
     bigger: ESTIMATES (Romanian practice, not per road).
   - Widths per OSM class and the surface for roads without a `surface` tag: ESTIMATES (OSM / OpenMapTiles have no width).
     Tunnels are not painted; bridges are painted on the ground under them; paths / footways are not drawn.
   - Fades in over 0.4 s per tile, out when a road is thinner than ~1 px on screen. Only tiles at z >= 14 within ~7 km get roads.
   Off: localStorage aurora.roads = 'off' (⚙ checkbox). */

import { decodeMvt } from './nightosm.js?v=b082f45d';

const ZC = 14, R = 6371000, URL0 = 'https://tiles.openfreemap.org/planet/latest/';
// class -> rank (bit field in A, also the drawing order) and half width in metres (ESTIMATES; motorway / trunk: one carriageway, OSM draws each)
const RANK = { track: 0, service: 1, minor: 2, busway: 2, raceway: 2, tertiary: 3, secondary: 4, primary: 5, trunk: 6, motorway: 7 };
const HW = [1.5, 2, 2.75, 3.25, 3.5, 4, 4.5, 5.5];
const PER = [0, 18, 10, 9];   // metres along the road per texture repeat, per surface (ESTIMATES from the textures' aspect; 18 = 2 dash periods)
const EF = [0, .9, .55, .9];  // where the road edge lies in the texture column, 0..1 from the centre (tools/build_roads_tex.py)
const MAXF = 4, DMAX = 7000, NEAR = 1500, FADE = 400;   // in flight; metres (slant) to the nearest point of a tile: roads at all / full-size mask; fade-in ms
const OFF0 = (() => { try { return localStorage.getItem('aurora.roads') === 'off'; } catch (e) { return false; } })();

export const ROADS = [];   // live instances (tests: import('./roads.js?v=4c078d92') then ROADS.at(-1))

export const GLSL = OFF0 ? 'vec3 rdPaint(vec2 vt, vec3 photo) { return photo; }' : /* glsl */`
  uniform sampler2D rdM, rdTex; uniform vec3 rdSub; uniform float rdA;
  float rdH(int r) { return r == 0 ? ${HW[0].toFixed(2)} : r == 1 ? ${HW[1].toFixed(2)} : r == 2 ? ${HW[2].toFixed(2)} : r == 3 ? ${HW[3].toFixed(2)} : r == 4 ? ${HW[4].toFixed(2)} : r == 5 ? ${HW[5].toFixed(2)} : r == 6 ? ${HW[6].toFixed(2)} : ${HW[7].toFixed(2)}; }
  vec3 rdPaint(vec2 vt, vec3 photo) {
    vec2 q = rdSub.xy + vt * rdSub.z; vec4 m = texture2D(rdM, q);
    float u = m.r * 6.375, fu = max(fwidth(u), 1e-4), v = atan(m.b * 2. - 1., m.g * 2. - 1.) / 6.2831853 + .5;
    vec2 gu = vec2(dFdx(u), dFdy(u)), gv = vec2(dFdx(v), dFdy(v)); gv -= floor(gv + .5);   /* derivatives before any branch; v wraps once per repeat */
    ivec2 sz = textureSize(rdM, 0); vec4 mi = texelFetch(rdM, clamp(ivec2(q * vec2(sz)), ivec2(0), sz - 1), 0);
    int a = int(mi.a * 255. + .5), sf = a & 3, rk = a >> 2;
    if (rdA <= 0. || sf == 0 || u - fu > 1.1) return photo;
    float ef = sf == 2 ? ${EF[2]} : ${EF[1]}, x = min(u * ef, .996), cx = float(sf - 1), tx = (sf == 2 ? cx + 1. - x : cx + x) / 3.;
    vec2 dX = vec2(gu.x * ef / 3., gv.x), dY = vec2(gu.y * ef / 3., gv.y); float gl = max(length(dX), length(dY));
    if (gl > .0156) { dX *= .0156 / gl; dY *= .0156 / gl; }   /* at most 4 mip levels down: the atlas columns do not bleed into each other */
    vec4 c = textureGrad(rdTex, vec2(tx, v), dX, dY); vec3 col = c.rgb * 1.15;
    float hw = rdH(rk), fm = max(fu * hw, 1e-3);   /* metres per pixel across the road */
    if (sf == 1 && rk >= 3) { float xm = u * hw, s = v * ${PER[1]}.;
      float dash = clamp(.5 - (abs(mod(s, 9.) - 1.5) - 1.5) / fm, 0., 1.);
      float ln = max(clamp(.5 - (xm - .075) / fm, 0., 1.) * dash, rk >= 5 ? clamp(.5 - (abs(xm - hw + .35) - .075) / fm, 0., 1.) : 0.);
      col = mix(col, vec3(.6, .6, .58), ln * min(1., .15 / fm)); }
    float al = c.a * clamp((1.08 - u) / fu + .5, 0., 1.) * min(1., 2.2 / fu) * (1. - smoothstep(4., 8., fu)) * rdA;   /* thinner than a pixel: fainter (its true share of the pixel), gone below ~1/4 px */
    return mix(photo, col, al); }`;

export function createRoads({ THREE, Q, off: off0 }) {
  let off = !!off0 || OFF0;
  const SN = Q === 'high' ? 1024 : 512, SF = 512, KEEP = 32;   // mask size near / farther away; masks kept (GPU: 4 MB at 1024, 1 MB at 512; ~60 MB in all)
  const empty = new THREE.DataTexture(new Uint8Array(4), 1, 1); empty.needsUpdate = true;
  const atlas = new THREE.TextureLoader().load(new URL('img/roads/roads.webp', import.meta.url).href);
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.wrapS = THREE.ClampToEdgeWrapping; atlas.wrapT = THREE.RepeatWrapping; atlas.anisotropy = 8;
  atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.generateMipmaps = true;
  const uniforms = { rdTex: { value: atlas } };
  const M = new Map(); let frame = 0, inflight = 0; const want = new Set();
  const stats = { built: 0, ms: 0, max: 0, segs: 0 };

  function load(m) {
    m.st = 1; inflight++;
    fetch(URL0 + ZC + '/' + m.x + '/' + m.y + '.pbf').then(r => { if (r.status === 204 || r.status === 404) return new ArrayBuffer(0); if (!r.ok) throw r.status; return r.arrayBuffer(); })
      .then(buf => { const d = buf.byteLength ? decodeMvt(buf, new Set(['transportation'])) : {}; m.tr = d.transportation || { extent: 4096, features: [] }; m.st = 2; })
      .catch(() => { m.st = 0; m.fail = (m.fail || 0) + 1; m.retry = performance.now() + 4000 * m.fail; })
      .finally(() => inflight--);
  }

  // the road mask of one z14 tile (see the header)
  function raster(m, S) {
    const t0 = performance.now(), n = 1 << ZC, la = Math.atan(Math.sinh(Math.PI * (1 - 2 * (m.y + .5) / n)));
    const mpp = 2 * Math.PI * R * Math.cos(la) / n / S, ext = m.tr.extent || 4096, k = S / ext;
    const cu = new Float32Array(S * S).fill(99), rk = new Int8Array(S * S).fill(-1), px = new Uint8Array(S * S * 4);
    const L = [];
    for (const f of m.tr.features) { const tg = f.tags, r = RANK[tg.class]; if (r === undefined || f.type !== 2 || tg.brunnel === 'tunnel') continue;
      const unp = tg.surface === 'unpaved', sf = tg.surface === 'paved' ? 1 : tg.class === 'track' ? 3 : unp ? 2 : 1;
      L.push([r, sf, tg.ramp ? Math.min(HW[r], 3) : HW[r], f.geom]); }
    L.sort((a, b) => a[0] - b[0]);
    let segs = 0;
    for (const [r, sf, hwM, parts] of L) {
      const hw = hwM / mpp, rr = hw + 2.5, P = PER[sf], A = sf | r << 2, w = 2 * Math.PI / P;
      for (const g of parts) { let s = 0;
        for (let i = 0; i + 3 < g.length; i += 2) {
          const ax = g[i] * k, ay = g[i + 1] * k, bx = g[i + 2] * k, by = g[i + 3] * k, dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, lm = Math.sqrt(l2) * mpp;
          const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rr)), x1 = Math.min(S - 1, Math.ceil(Math.max(ax, bx) + rr));
          const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rr)), y1 = Math.min(S - 1, Math.ceil(Math.max(ay, by) + rr));
          if (x0 <= x1 && y0 <= y1) { segs++;
            for (let y = y0; y <= y1; y++) { const py = y + .5 - ay;
              for (let x = x0; x <= x1; x++) { const pxx = x + .5 - ax, t = l2 > 0 ? Math.max(0, Math.min(1, (pxx * dx + py * dy) / l2)) : 0;
                const ex = pxx - t * dx, ey = py - t * dy, d2 = ex * ex + ey * ey; if (d2 > rr * rr) continue;
                const u = Math.sqrt(d2) / hw, j = y * S + x;
                if (u < cu[j] || (u < 1 && r > rk[j])) { cu[j] = u; rk[j] = r; const an = w * (s + t * lm);
                  px[j * 4 + 1] = Math.round(Math.cos(an) * 127.5 + 127.5); px[j * 4 + 2] = Math.round(Math.sin(an) * 127.5 + 127.5); px[j * 4 + 3] = A; } } } }
          s += lm; } } }
    for (let j = 0; j < S * S; j++) px[j * 4] = Math.min(255, Math.round(cu[j] * 40));
    const tx = new THREE.DataTexture(px, S, S, THREE.RGBAFormat); tx.magFilter = tx.minFilter = THREE.LinearFilter; tx.generateMipmaps = false;
    tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping; tx.needsUpdate = true;
    const old = m.tex; m.tex = tx; m.S = S; if (!old) m.born = performance.now(); else old.dispose(); m.st = 3;
    stats.built++; stats.segs = segs; stats.ms = performance.now() - t0; stats.max = Math.max(stats.max, stats.ms);
  }

  // per HD tile: its own uniforms (in meshOf), then each frame its part of the z14 mask
  const tileU = () => ({ rdM: { value: empty }, rdSub: { value: new THREE.Vector3(0, 0, 1) }, rdA: { value: 0 } });
  function bind(t, u) {
    u.rdA.value = 0; if (off || t.z < ZC || !(t.dd * R < DMAX)) return;
    const s = t.z - ZC, x = t.x >> s, y = t.y >> s, key = x + '/' + y; let m = M.get(key);
    if (!m) { m = { key, x, y, st: 0, tex: null, used: frame, dd: 1e9 }; M.set(key, m); }
    m.used = frame; m.dd = Math.min(m.dd, t.dd); want.add(m);
    if (!m.tex) return;
    const mm = 1 << s, f = Math.min(1, (performance.now() - m.born) / FADE);
    u.rdM.value = m.tex; u.rdSub.value.set((t.x & (mm - 1)) / mm, (t.y & (mm - 1)) / mm, 1 / mm); u.rdA.value = f * f * (3 - 2 * f);
  }
  function update() {
    frame++; if (off) return;
    const ws = [...want].sort((a, b) => a.dd - b.dd).slice(0, KEEP - 4); want.clear();   // the nearest only
    for (const m of ws) { m.sz = m.dd * R < NEAR ? SN : SF; m.dd = 1e9; if (m.st === 0 && inflight < MAXF && !(m.retry > performance.now())) load(m); }
    const r = ws.find(m => m.st === 2) || ws.find(m => m.st === 3 && m.S < m.sz); if (r) raster(r, r.sz);   // one mask per frame (a few ms on the CPU)
    const kept = [...M.values()].filter(m => m.st >= 2);
    if (kept.length > KEEP) { const now = new Set(ws); for (const m of kept.filter(m => !now.has(m)).sort((a, b) => a.used - b.used).slice(0, kept.length - KEEP)) { m.tex?.dispose(); M.delete(m.key); } }
    if (M.size > 400) for (const [k, m] of M) if (m.st === 0 && m.used < frame - 60) M.delete(k);
  }
  const api = { uniforms, tileU, bind, update, stats, get off() { return off; }, set off(v) { off = !!v; }, M }; ROADS.push(api); return api;
}
