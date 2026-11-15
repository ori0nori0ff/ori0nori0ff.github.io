/* Runways on the 3D Earth: paint, a flat profile under them, and their lights. No new files or hosts: everything is drawn from the numbers below.

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
  { id: 'LRBV', ends: ['03', '21'], a: [45.6960, 25.5128], b: [45.7165, 25.5342], w: 45, h: [535.8, 521.6], papi: 300 },
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
  vec3 rwPaint(vec2 p, vec4 P, vec3 photo, float fw) {
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
      vS = clamp(.9 * pxK / dm, 1.6, 9.); gl_PointSize = vS * 3.;
      vC = c * I * clamp(2500. / dm, .35, 1.6);
      gl_Position = projectionMatrix * vec4(bv * (1. - min(.002 + 4. / dm, .2)), 1.); }`;
  const LFS = /* glsl */`
    varying vec3 vC; varying float vS;
    void main() { vec2 r = (gl_PointCoord - .5) * vS * 3.; float q = exp(-dot(r, r) / (.5 * vS * vS)); if (q < .01) discard; gl_FragColor = vec4(vC * q * 1.6, 1.); }`;
  let pts = null;

  return {
    uniforms, GLSL, VS, tileVec, flat,
    // once per frame after the tiles (like veg.js): mvD = view x hd.matrixWorld, U = earthgl's shared uniforms, pxK = pixels per radian
    update(hd, mvD, U, pxK, altM) {
      if (altM > 30000) return;
      if (!pts) pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { ...lu, sun: U.sun, ex: U.ex }, vertexShader: LVS, fragmentShader: LFS,
        transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending }));
      pts.frustumCulled = false; pts.renderOrder = 3; lu.pxK.value = pxK;
      lu.cV.value.copy(lu.u0.value).applyMatrix4(mvD); hd.add(pts);
    },
    lights: L.length,
  };
}
