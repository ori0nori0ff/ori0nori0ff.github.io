/* Runways on the 3D Earth: paint, a flat profile under them, and their lights, drawn from the numbers below; plus airport buildings
   (models/airports/, baked by tools/build_bms_airport.py: OSM footprints + Falcon BMS textures and control tower). No new hosts.

   - Paint: drawn inside the HD ground tiles' own fragment shader (earthgl.js TFS calls rwPaint), in runway coordinates that each tile's vertex
     shader works out from its own camera-safe offsets (rwT per tile, see tileVec). So the paint lies exactly on the drawn relief: no extra mesh,
     no z-fighting, no float32 jitter. Layout after ICAO Annex 14 Vol. I, 5.2 (precision runway, 45 m wide, >= 2400 m long): side stripes 0.9 m,
     threshold 12 stripes 30 m x 1.8 m, designation 9 m high, centreline 30 m stripe / 20 m gap 0.9 m wide, aiming point 60 x 8 m at 400 m,
     touchdown-zone bars 22.5 x 3 m. Asphalt tone, wear and tyre marks: an ESTIMATE (procedural).
   - Profile: the relief under a runway (+60 m, blended out over 200 m) is set to a straight line between the two thresholds, both in the drawn
     mesh (vertex shader) and in groundAt (the craft's ground), so the two stay the same and the runway has no bumps of the 27 m height grid.
   - Lights: edge lights every 60 m (white; yellow on the last 600 m seen from the landing direction), threshold / end bars (green seen from the
     approach, red from the runway), PAPI on the left of each end. Edge / bar lights on from sunset to sunrise; PAPI always. Fixture spacing and
     the PAPI place are ESTIMATES (the AIP charts are not used); no approach-light system yet.
   LRBV (Brașov-Ghimbav) 03 / 21: thresholds 45.6960 N 25.5128 E and 45.7165 N 25.5342 E (airportguide.com, sprinkle.com), 2823 m x 45 m.
   Threshold heights 535.8 / 521.6 m: a straight-line fit to the Terrarium heights (z12) along the axis, rms 0.56 m (2026-11-15), not surveyed. */

const R = 6371000;
export const RUNWAYS = [
  { id: 'LRBV', ends: ['03', '21'], a: [45.6960, 25.5128], b: [45.7165, 25.5342], w: 45, h: [535.8, 521.6], papi: 300, bld: true,   /* bld: models/airports/lrbv.bin */
    /* taxiway centre lines (segments) and the terminal apron (polygon), metres east / north of the runway centre: OpenStreetMap contributors
       (ODbL 1.0), aeroway layer of the OpenFreeMap z14 tiles read by tools/bms/airport_osm.py on 2026-11-15. At most 4 segments and 5 corners
       (the shader's array sizes). OSM has no width: 23 m is an ESTIMATE */
    twy: [[-664.93, -1248.91, -822.38, -1129.75], [-596.2, -1184.75, -635.77, -1236.82], [-635.77, -1236.82, -644.93, -1242.66], [-644.93, -1242.66, -664.93, -1248.91]], twyW: 23,
    apron: [[-676.59, -1263.07], [-664.93, -1248.91], [-587.03, -1146.83], [-479.98, -1228.08], [-566.62, -1344.32]] },
];

const nrm = (la, lo) => [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];   // same frame as earthgl.js nrmOf
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const D = Math.PI / 180;

// runway frame: centre C (unit vector), east / north there, axis (east, north) from threshold a to b, half length, height line
function frameOf(r) {
  const A = nrm(r.a[0] * D, r.a[1] * D), B = nrm(r.b[0] * D, r.b[1] * D), m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2], l = Math.hypot(...m);
  const C = m.map(v => v / l), la = Math.asin(C[1]), lo = Math.atan2(-C[2], C[0]);
  const e = [-Math.sin(lo), 0, -Math.cos(lo)], n = [-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo)];
  const d = sub(B, A), de = dot(d, e), dn = dot(d, n), dl = Math.hypot(de, dn);
  const L = Math.hypot(...d) * R / 2;
  return { ...r, A, B, C, la, lo, e, n, ax: [de / dl, dn / dl], L, W: r.w / 2, hm: (r.h[0] + r.h[1]) / 2, sl: (r.h[1] - r.h[0]) / (2 * L) };
}

// paint, in runway coordinates p = (x across, right of a->b positive; y along from the centre, + towards b), metres. P = (L, W, hMid, slope).
const GLSL = /* glsl */`
  float rwBox(vec2 p, vec2 c, vec2 hs, float fw) { vec2 q = abs(p - c) - hs; return clamp(.5 - max(q.x, q.y) / fw, 0., 1.); }
  float rwH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float rwN(vec2 p) { vec2 i = floor(p), f = p - i; f = f * f * (3. - 2. * f);
    return mix(mix(rwH(i), rwH(i + vec2(1., 0.)), f.x), mix(rwH(i + vec2(0., 1.)), rwH(i + 1.), f.x), f.y); }
  /* taxiways (capsules round rwTw's segments, half width rwTwW) and the apron (polygon rwAp), under the runway's paint. rwAb = their box
     (centre, half size). Asphalt taxiway with a yellow centre line 0.15 m, concrete apron with slab joints every 7.5 m: tones and joints are an ESTIMATE */
  uniform vec4 rwTw[4]; uniform vec2 rwAp[5]; uniform vec4 rwAb; uniform float rwTwW;
  vec3 rwAero(vec2 p, vec3 photo, float fw) {
    vec2 q = abs(p - rwAb.xy) - rwAb.zw; if (max(q.x, q.y) > fw) return photo;
    float dT = 1e9; for (int k = 0; k < 4; k++) { vec2 a = rwTw[k].xy, e = rwTw[k].zw - a; dT = min(dT, length(p - a - e * clamp(dot(p - a, e) / dot(e, e), 0., 1.))); }
    float d = dot(p - rwAp[0], p - rwAp[0]), sg = 1.; int j = 4;   /* signed distance to the polygon, inside negative */
    for (int i = 0; i < 5; i++) { vec2 e = rwAp[j] - rwAp[i], w = p - rwAp[i], b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-9), 0., 1.); d = min(d, dot(b, b));
      bvec3 c = bvec3(p.y >= rwAp[i].y, p.y < rwAp[j].y, e.x * w.y > e.y * w.x); if (all(c) || all(not(c))) sg = -sg; j = i; }
    float mT = clamp(.5 - (dT - rwTwW) / fw, 0., 1.), mA = clamp(.5 - sg * sqrt(d) / fw, 0., 1.), m = max(mT, mA); if (m <= 0.) return photo;
    float g = mix(.5, rwN(p * 2.5), 1. - smoothstep(.2, .6, fw)), pt = rwN(p * .2);
    vec3 asph = vec3(.1, .1, .105) * (.85 + .15 * g + .12 * (pt - .5)), conc = vec3(.3, .3, .285) * (.9 + .1 * g + .12 * (pt - .5));
    float jt = min(abs(fract(p.x / 7.5) - .5), abs(fract(p.y / 7.5) - .5)) * 7.5;   /* metres to the nearest slab joint (the apron lies along the runway's axes) */
    conc *= 1. - .3 * clamp(.5 - (jt - .03) / fw, 0., 1.) * min(1., .2 / fw);
    vec3 c = mix(asph, conc, mA);
    c = mix(c, vec3(.72, .58, .06) * (.8 + .2 * g), clamp(.5 - (dT - .075) / fw, 0., 1.) * min(1., .3 / fw) * (1. - mA));   /* centre line, fading with distance like its real width */
    return mix(photo, c, m); }
  vec3 rwPaint(vec2 p, vec4 P, vec3 photo, float fw) {
    photo = rwAero(p, photo, fw);
    float L = P.x, W = P.y; if (abs(p.x) > W + fw || abs(p.y) > L + fw) return photo;
    float inR = rwBox(p, vec2(0.), vec2(W, L), fw);
    float s = L - abs(p.y), x = p.y < 0. ? p.x : -p.x;   /* s: metres from the nearer threshold; x: across, mirrored so the pattern reads from its approach */
    /* asphalt: fine grain, ~4 m patches, darker tyre marks in the touchdown zone (an estimate) */
    float g = mix(.5, rwN(p * 2.5), 1. - smoothstep(.2, .6, fw)), pt = rwN(p * vec2(.25, .08));
    float tyre = (1. - smoothstep(4., 11., abs(x))) * smoothstep(100., 250., s) * (1. - smoothstep(500., 1100., s)) * mix(.3, 1., rwN(vec2(x * 1.3, s * .02)));
    vec3 asph = vec3(.085, .086, .09) * (.85 + .15 * g + .12 * (pt - .5)) * (1. - .45 * tyre);
    float m = 0.;
    m = max(m, rwBox(vec2(abs(p.x), p.y), vec2(W - .45, 0.), vec2(.45, L), fw));   /* side stripes */
    for (int k = 0; k < 6; k++) m = max(m, rwBox(vec2(abs(x), s), vec2(2.7 + float(k) * 3.6, 21.), vec2(.9, 15.), fw));   /* threshold: 6 + 6 stripes */
    if (s > 46. && s < 59. && abs(x) < 7.) { vec4 t = texture2D(rwNum, vec2((x + 6.) / 12., (p.y < 0. ? .5 : 0.) + .5 * (s - 48.) / 9.));   /* designation */
      m = max(m, t.r * step(48., s) * step(s, 57.)); }
    if (s > 69.) m = max(m, rwBox(vec2(p.x, mod(p.y + L - 69., 50.)), vec2(0., 15.), vec2(.45, 15.), fw));   /* centreline */
    m = max(m, rwBox(vec2(abs(x), s), vec2(14., 430.), vec2(4., 30.), fw));   /* aiming point */
    /* touchdown zone: bars per side at 150 (3), 300 (2), 600 (2), 750 (1), 900 m (1) */
    for (int k = 0; k < 3; k++) { float xc = 11. + float(k) * 4.;
      m = max(m, rwBox(vec2(abs(x), s), vec2(xc, 161.25), vec2(1.5, 11.25), fw));
      if (k < 2) { m = max(m, rwBox(vec2(abs(x), s), vec2(xc, 311.25), vec2(1.5, 11.25), fw)); m = max(m, rwBox(vec2(abs(x), s), vec2(xc, 611.25), vec2(1.5, 11.25), fw)); }
      if (k < 1) { m = max(m, rwBox(vec2(abs(x), s), vec2(xc, 761.25), vec2(1.5, 11.25), fw)); m = max(m, rwBox(vec2(abs(x), s), vec2(xc, 911.25), vec2(1.5, 11.25), fw)); } }
    vec3 paint = vec3(.62, .62, .6) * (.8 + .2 * g) * (1. - .35 * tyre);
    return mix(photo, mix(asph, paint, m), inR); }`;

export function createAirfield(THREE) {
  const F = RUNWAYS.map(frameOf), r0 = F[0];
  // the designations, white on black: top half the a end ("03"), bottom half the b end ("21"); read from their own approach (bottom towards the threshold)
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512; const cx = cv.getContext('2d');
  cx.fillStyle = '#000'; cx.fillRect(0, 0, 256, 512); cx.fillStyle = '#fff'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
  for (const [i, t] of r0.ends.entries()) { cx.save(); cx.translate(128, i * 256 + 128); cx.scale(.42, 1); cx.font = '700 300px Arial, Helvetica, sans-serif'; cx.fillText(t, 0, 14); cx.restore(); }
  const num = new THREE.CanvasTexture(cv); num.generateMipmaps = true; num.minFilter = THREE.LinearMipmapLinearFilter; num.anisotropy = 8;
  num.wrapS = num.wrapT = THREE.ClampToEdgeWrapping;
  const uniforms = { rwP: { value: new THREE.Vector4(r0.L, r0.W, r0.hm, r0.sl) }, rwNum: { value: num } };
  { // taxiways + apron in runway coordinates (x across, y along), padded with far-away values up to the shader's array sizes
    const rw = (e, n) => [e * r0.ax[1] - n * r0.ax[0], e * r0.ax[0] + n * r0.ax[1]], FARP = 1e7;
    const tw = (r0.twy || []).slice(0, 4).map(s => [...rw(s[0], s[1]), ...rw(s[2], s[3])]), ap = (r0.apron || []).slice(0, 5).map(q => rw(q[0], q[1]));
    const all = [...tw.flatMap(s => [[s[0], s[1]], [s[2], s[3]]]), ...ap], hw = (r0.twyW || 23) / 2;
    const lo = [0, 1].map(k => Math.min(...all.map(q => q[k])) - hw - 2), hi = [0, 1].map(k => Math.max(...all.map(q => q[k])) + hw + 2);
    while (tw.length < 4) tw.push([FARP, FARP, FARP + 1, FARP]);
    while (ap.length < 5) ap.push(ap.length ? ap[ap.length - 1] : [FARP, FARP]);   /* repeated last corner: zero-length edges change nothing */
    uniforms.rwTw = { value: tw.map(s => new THREE.Vector4(...s)) }; uniforms.rwAp = { value: ap.map(q => new THREE.Vector2(...q)) }; uniforms.rwTwW = { value: hw };
    uniforms.rwAb = { value: all.length ? new THREE.Vector4((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2) : new THREE.Vector4(FARP, FARP, 0, 0) }; }

  // per tile: the runway centre in the tile's own east / north metres (the chord components its vertex shader uses) + the axis there
  const FAR = new THREE.Vector4(1e9, 1e9, 1, 0);
  function tileVec(t) {
    const u = [t.u0.x, t.u0.y, t.u0.z], e = [t.e0.x, t.e0.y, t.e0.z], n = [t.n0.x, t.n0.y, t.n0.z];
    const c = sub(r0.C, u); if (Math.hypot(...c) * R > 60000 + t.rho * R) return FAR.clone();
    const d = sub(r0.B, r0.A), de = dot(d, e), dn = dot(d, n), dl = Math.hypot(de, dn);
    return new THREE.Vector4(dot(c, e) * R, dot(c, n) * R, de / dl, dn / dl);
  }
  // the same flattening as the vertex shader, for groundAt
  function local(lat, lon) { const v = sub(nrm(lat, lon), r0.C), pe = dot(v, r0.e) * R, pn = dot(v, r0.n) * R;
    return [pe * r0.ax[1] - pn * r0.ax[0], pe * r0.ax[0] + pn * r0.ax[1]]; }
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function flat(lat, lon, h) { const [x, y] = local(lat, lon), qx = Math.max(Math.abs(x) - r0.W - 60, 0), qy = Math.max(Math.abs(y) - r0.L - 60, 0);
    const f = 1 - sm(0, 200, Math.hypot(qx, qy)); return f > 0 ? h + (r0.hm + r0.sl * Math.max(-r0.L, Math.min(r0.L, y)) - h) * f : h; }

  // vertex shader part (inside TVS after dn is known): en = the vertex's east / north metres from the tile centre
  const VS = /* glsl */`
    vRw = en - rwT.xy; vRw = vec2(vRw.x * rwT.w - vRw.y * rwT.z, vRw.x * rwT.z + vRw.y * rwT.w);
    { vec2 q = max(abs(vRw) - vec2(rwP.y + 60., rwP.x + 60.), 0.); float f = 1. - smoothstep(0., 200., length(q));
      if (f > 0.) h = mix(h, rwP.z + rwP.w * clamp(vRw.y, -rwP.x, rwP.x), f); }`;

  // ── lights
  const L = [];   // east, north (centre frame), height, kind / along / across / spare
  const put = (x, y, k) => { const pe = x * r0.ax[1] + y * r0.ax[0], pn = -x * r0.ax[0] + y * r0.ax[1]; L.push([pe, pn, r0.hm + r0.sl * y, k, y, x]); };
  for (let y = -r0.L; y <= r0.L + .1; y += r0.L * 2 / Math.round(r0.L * 2 / 60)) for (const sx of [-1, 1]) put(sx * (r0.W + 1.5), y, 0);   // edge
  for (let x = -r0.W; x <= r0.W + .1; x += 3) { put(x, -r0.L - 1, 1); put(x, r0.L + 1, 2); }   // threshold / end bars (a end, b end)
  for (const [end, sgn] of [[0, -1], [1, 1]]) for (let k = 0; k < 4; k++) {   // PAPI: left of each approach, inner unit = highest angle (3.5 deg) .. outer 2.5 deg
    const s = r0.papi, y = sgn * (r0.L - s), x = (sgn < 0 ? -1 : 1) * (r0.W + 15 + k * 9);
    put(x, y, 3 + end); L[L.length - 1][5] = (3.5 - k / 3) * D; L[L.length - 1].push(sgn); }
  const pos = new Float32Array(L.length * 3), ib = new Float32Array(L.length * 4);
  L.forEach((l, i) => { pos.set([l[0], l[1], l[2]], i * 3); ib.set([l[3], l[4], l[5], l[6] || 0], i * 4); });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('ib', new THREE.BufferAttribute(ib, 4));
  const v3 = a => new THREE.Vector3(...a);
  const axW = v3(r0.e).multiplyScalar(r0.ax[0]).add(v3(r0.n).multiplyScalar(r0.ax[1]));
  const lu = { cV: { value: new THREE.Vector3() }, e0: { value: v3(r0.e) }, n0: { value: v3(r0.n) }, u0: { value: v3(r0.C) }, axW: { value: axW }, pxK: { value: 1000 }, Lh: { value: r0.L } };
  const LVS = /* glsl */`
    uniform vec3 cV, e0, n0, u0, axW, sun; uniform float ex, pxK, Lh; attribute vec4 ib; varying vec3 vC; varying float vS;
    void main() {
      vec3 dn = (e0 * position.x + n0 * position.y) / ${R}. - u0 * ((position.x * position.x + position.y * position.y) / ${2 * R * R}.);
      vec3 n = u0 + dn; float hh = (position.z * ex + 400. + .4) / ${R}.;
      vec3 bv = cV + mat3(modelViewMatrix) * (dn + n * hh); float dm = length(bv) * ${R}.;
      vec3 v = -bv / length(bv), nv = normalize(mat3(modelViewMatrix) * n), aV = normalize(mat3(modelViewMatrix) * axW);
      float al = dot(v, aV), el = asin(clamp(dot(v, nv), -1., 1.));   /* al < 0: the camera is on the a side of the light (looking towards b) */
      float on = 1. - smoothstep(-.02, .06, dot(normalize(n), sun)), k = ib.x, I = 1.; vec3 c = vec3(1., .95, .85);
      if (k < .5) { if ((al < 0. && ib.y > Lh - 600.) || (al > 0. && ib.y < -Lh + 600.)) c = vec3(1., .75, .2); I = on; }
      else if (k < 2.5) { bool out_ = k < 1.5 ? al < 0. : al > 0.; c = out_ ? vec3(.2, 1., .45) : vec3(1., .12, .08); I = on; }
      else { c = el > ib.z ? vec3(1., .95, .85) : vec3(1., .1, .06); I = (.35 + .65 * on) * smoothstep(-.05, .2, al * ib.w); }   /* PAPI: seen from its approach only */
      if (I <= 0. || dm > 25000.) { gl_Position = vec4(2., 2., 2., 1.); return; }
      vS = clamp(3. * pxK / dm, 8., 28.); gl_PointSize = vS;   /* sprite width in pixels: 3 m of glare near, 8 px far away */
      vC = c * I * 4. * clamp(2500. / dm, .35, 1.6);
      gl_Position = projectionMatrix * vec4(bv * (1. - min(.002 + 4. / dm, .2)), 1.); }`;
  const LFS = /* glsl */`
    varying vec3 vC; varying float vS;
    void main() {   /* point + 1/r^2 glare with a zero-slope window at the edge (like the F-16 lights, gfx.js glowTex): the old gaussian x 1.6 clipped to a flat white disc */
      float r2 = min(1., dot(gl_PointCoord - .5, gl_PointCoord - .5) * 4.), w = 1.2 / vS, q = (1. - r2) * (1. - r2) / (1. + r2 / (w * w));   /* core radius ~0.6 px at any sprite size */
      if (q < .003) discard; gl_FragColor = vec4(vC * q, 1.); }`;
  let pts = null;

  // ── buildings (each RUNWAYS entry with bld: true): OSM footprints extruded to their render_height + a Falcon BMS 4.38 control tower,
  // baked by tools/build_bms_airport.py into models/airports/<icao>.bin (13 floats per vertex, metres from the runway centre, see there)
  // + the shared bms2342.jpg. Fetched once the camera is within 60 km, drawn within 30 km of altitude like the lights. Same camera-relative
  // frame as the lights; the ground under them is hb x ex + 400 m like the drawn relief; lit by earthgl's shade() (the vegetation's call).
  const base = new URL('.', import.meta.url), btx = { value: null };
  const AP = F.filter(r => r.bld).map(r => ({ r, geo: null, mesh: null, asked: false,
    u: { cV: { value: new THREE.Vector3() }, e0: { value: v3(r.e) }, n0: { value: v3(r.n) }, u0: { value: v3(r.C) }, ll: { value: new THREE.Vector2(r.la, r.lo) }, btx } }));
  const load = a => { a.asked = true; fetch(new URL(`models/airports/${a.r.id.toLowerCase()}.bin`, base)).then(r => { if (!r.ok) throw r.status; return r.arrayBuffer(); }).then(ab => {
    const ib = new THREE.InterleavedBuffer(new Float32Array(ab), 13), gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0)); gg.setAttribute('a1', new THREE.InterleavedBufferAttribute(ib, 4, 3));
    gg.setAttribute('a2', new THREE.InterleavedBufferAttribute(ib, 2, 7)); gg.setAttribute('a3', new THREE.InterleavedBufferAttribute(ib, 4, 9));
    a.geo = gg; }).catch(() => {}); };
  const BVS = /* glsl */`
    uniform vec3 cV, e0, n0, u0; uniform vec2 ll; uniform float ex; attribute vec4 a1, a3; attribute vec2 a2;
    varying vec2 vTc; varying vec4 vTr; varying vec3 vO; varying vec3 vP; varying vec3 vN; varying vec2 vG;
    void main() {
      vec3 dn = (e0 * position.x + n0 * position.y) / ${R}. - u0 * ((position.x * position.x + position.y * position.y) / ${2 * R * R}.);
      vec3 n = u0 + dn; float hh = (position.z * ex + 400. + a1.x) / ${R}.;
      gl_Position = projectionMatrix * vec4(cV + mat3(modelViewMatrix) * (dn + n * hh), 1.);
      vO = n; vP = n * (1. + hh); vN = e0 * a1.y + n0 * a1.z + u0 * a1.w; vTc = a2; vTr = a3;
      float la = ll.x + position.y / ${R}., lo = ll.y + position.x / (${R}. * cos(ll.x));
      vG = vec2(lo / 6.2831853 + .5, la / 3.1415927 + .5); }`;
  const BFS = S => /* glsl */`
    uniform sampler2D btx; varying vec2 vTc; varying vec4 vTr; varying vec3 vO; varying vec3 vP; varying vec3 vN; varying vec2 vG; ${S}
    void main() {
      bool whole = vTr.z > .999; vec2 uv = whole ? vTc : vTr.xy + fract(vTc) * vTr.zw, gx = dFdx(vTc), gy = dFdy(vTc);   /* repeated facade: grads of the unwrapped coords, no seam */
      if (!whole) { gx *= vTr.zw; gy *= vTr.zw; }
      vec3 d = textureGrad(btx, uv, gx, gy).rgb, n = normalize(vO), N = normalize(vN);
      nOv = vec4(0., 0., 0., 1.);   /* no global city lights painted on walls */
      gl_FragColor = vec4(shade(n, vP, N, N, .6, d, 0., vG, 1.), 1.);
      /* at night (ESTIMATE): dark glass in the facades lit warm, about half the windows on (per cell of the atlas rect), and a faint apron flood light on the walls */
      float nt = 1. - smoothstep(-.1, .05, dot(n, sun)); if (nt <= 0.) return;
      float l = dot(d, vec3(.3, .5, .2)), wall = 1. - step(.5, abs(dot(N, n)));
      vec2 cell = floor(vTc * vec2(9., 4.)) + floor(vTr.xy * 64.); float on = step(.5, fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453));
      gl_FragColor.rgb += nt * wall * (vec3(1., .72, .42) * 1.4 * smoothstep(.16, .07, l) * on + d * .03); }`;
  function buildings(hd, mvD, U, SHADE) {
    if (!SHADE) return;
    for (const a of AP) {
      const near = U.camO.value.distanceTo(a.u.u0.value) * R;
      if (!a.asked && near < 60000) load(a);
      if (!a.geo || near > 60000) continue;
      if (!btx.value) { const tx = btx.value = new THREE.TextureLoader().load(new URL('models/airports/bms2342.jpg', base).href); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8; }
      if (!a.mesh) { a.mesh = new THREE.Mesh(a.geo, new THREE.ShaderMaterial({ uniforms: { ...U, ...a.u }, vertexShader: BVS, fragmentShader: BFS(SHADE) }));
        a.mesh.frustumCulled = false; a.mesh.renderOrder = 1; }
      a.u.cV.value.copy(a.u.u0.value).applyMatrix4(mvD); hd.add(a.mesh);
    }
  }

  return {
    uniforms, GLSL, VS, tileVec, flat,
    // once per frame after the tiles (like veg.js): mvD = view x hd.matrixWorld, U = earthgl's shared uniforms, pxK = pixels per radian
    update(hd, mvD, U, pxK, altM, SHADE) {
      if (altM > 30000) return;
      if (this.bOn) buildings(hd, mvD, U, SHADE);
      if (!pts) pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { ...lu, sun: U.sun, ex: U.ex }, vertexShader: LVS, fragmentShader: LFS,
        transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending }));
      pts.frustumCulled = false; pts.renderOrder = 3; lu.pxK.value = pxK;
      lu.cV.value.copy(lu.u0.value).applyMatrix4(mvD); hd.add(pts);
    },
    lights: L.length, bOn: true,   /* bOn: draw the airport buildings (a test switch) */
  };
}
