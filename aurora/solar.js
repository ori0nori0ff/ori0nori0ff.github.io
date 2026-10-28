/* The solar system around the 3D Earth (three.js): Sun, planets, the Moon and orbits in a "far layer" drawn before the Earth's own
   scene, all positioned relative to the camera in double precision (no jitter close to a planet, 30 AU away from the Sun).
   Units: Earth radii (R⊕). Positions: JPL Keplerian elements (1800–2050), the Moon (Meeus, low precision); orientations: IAU poles
   and prime meridians. Textures: Solar System Scope (CC BY 4.0) from NASA / JPL / USGS maps, baked by tools/build_planet_tex.py.
   createSolar({ THREE, renderer, camera, Q, tr, el, nrmOf, gmst, quatW, dayTex }) → { scene, cam, update(t, view), bodies, pick(x, y), helio(name, t) } */
const D2R = Math.PI / 180, DAY = 864e5, AU = 1.495978707e8 / 6371, EPS = 23.4393 * D2R;
// a, e, I, L, long.peri, long.node + rates per century (JPL)
const EL = {
  Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  Venus: [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
  Earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  Mars: [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  Jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  Saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  Uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  Neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
};
// radius km, IAU pole RA / Dec (°), prime meridian W0 + rate (°/day), texture, minimum size seen from far (px), orbit colour
const BODY = {
  Sun: [695700, 286.13, 63.87, 84.176, 14.1844, 'sun', 9, ''],
  Mercury: [2439.7, 281.0103, 61.4155, 329.5988, 6.1385108, 'mercury', 2.6, '#B8B2A7'],
  Venus: [6051.8, 272.76, 67.16, 160.20, -1.4813688, 'venus_air', 3.4, '#E8D3A2'],
  Earth: [6371, 0, 90, 0, 0, '', 3.6, '#5AA9FF'],
  Moon: [1737.4, 269.9949, 66.5392, 38.3213, 13.17635815, 'moon', 2, ''],
  Mars: [3389.5, 317.269, 54.432, 176.049863, 350.891982443, 'mars', 3, '#E2704A'],
  Jupiter: [69911, 268.056595, 64.495303, 284.95, 870.536, 'jupiter', 6, '#D9B38C'],
  Saturn: [58232, 40.589, 83.537, 38.90, 810.7939024, 'saturn', 5.5, '#E6CF8E'],
  Uranus: [25362, 257.311, -15.175, 203.81, -501.1600928, 'uranus', 4.4, '#9FE3E8'],
  Neptune: [24622, 299.36, 43.46, 249.978, 541.1397757, 'neptune', 4.4, '#6E8BFF'],
};
const kepler = (name, T) => { const [e0, r] = EL[name], el = e0.map((v, i) => v + r[i] * T);
  const [a, e, I, L, wb, Om] = el, w = (wb - Om) * D2R, M = ((L - wb) % 360) * D2R, i = I * D2R, O = Om * D2R;
  let E = M + e * Math.sin(M); for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E), cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  return [((cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp) * AU, ((cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp) * AU, ((sw * si) * xp + (cw * si) * yp) * AU]; };
// the Moon around the Earth, ecliptic, R⊕
const moonGeo = t => { const d = t / DAY - 10957.5, L = (218.316 + 13.176396 * d) * D2R, M = (134.963 + 13.064993 * d) * D2R, F = (93.272 + 13.229350 * d) * D2R;
  const l = L + 6.289 * D2R * Math.sin(M), b = 5.128 * D2R * Math.sin(F), r = (385001 - 20905 * Math.cos(M)) / 6371;
  return [r * Math.cos(b) * Math.cos(l), r * Math.cos(b) * Math.sin(l), r * Math.sin(b)]; };
// heliocentric ecliptic position (R⊕, astronomical x / y / z) of any body
export function helio(name, t) { const T = (t / DAY + 2440587.5 - 2451545) / 36525;
  if (name === 'Sun') return [0, 0, 0];
  if (name === 'Moon') { const e = kepler('Earth', T), m = moonGeo(t); return [e[0] + m[0], e[1] + m[1], e[2] + m[2]]; }
  return kepler(name, T); }

import { createBodyHD } from './bodyhd.js';

export function createSolar({ THREE, renderer, camera, Q, tr, el, nrmOf, gmst, quatW, dayTex }) {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(camera.fov, camera.aspect, 1, 1e8);
  const TP = new URL('./img/planets/', import.meta.url).href, HI = Q !== 'low';
  // textures: decoded off the main thread (ImageBitmap), sent to the GPU one at a time over the next frames (no stall on the
  // first flight); 2k first, the 4k map only when the body gets big on screen
  const ibl = new THREE.ImageBitmapLoader(); ibl.setOptions({ imageOrientation: 'flipY' }); const warm = [];
  function tex(url, cb, srgb = true) { const t = new THREE.Texture(); t.flipY = false; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    ibl.load(url, bmp => { t.image = bmp; t.needsUpdate = true; warm.push(t); if (cb) cb(t); }); return t; }
  const M = new THREE.Matrix3(), Mi = new THREE.Matrix3(), v3 = new THREE.Vector3(), tmp = new THREE.Vector3();
  // ecliptic → the Earth view's world frame (the Earth-fixed frame turned like the globe mesh)
  function eclToWorld(t) { const g = gmst(t), ce = Math.cos(EPS), se = Math.sin(EPS), cg = Math.cos(g), sg = Math.sin(g);
    const E2Q = new THREE.Matrix3().set(1, 0, 0, 0, ce, -se, 0, se, ce);   // ecliptic → equatorial
    const Q2F = new THREE.Matrix3().set(cg, sg, 0, 0, 0, 1, sg, -cg, 0);   // equatorial → Earth-fixed (x = lon 0, y = north, z = −lon 90°)
    const W = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(quatW));
    M.copy(W).multiply(Q2F).multiply(E2Q); Mi.copy(M).invert(); return M; }
  const toW = (p, out) => out.set(p[0], p[1], p[2]).applyMatrix3(M);
  // IAU orientation → a world quaternion (x = prime meridian, y = north pole)
  const eqW = (ra, de) => toW(eqToEcl(ra, de), new THREE.Vector3());
  function eqToEcl(ra, de) { const a = ra * D2R, d = de * D2R, x = Math.cos(d) * Math.cos(a), y = Math.cos(d) * Math.sin(a), z = Math.sin(d);
    return [x, y * Math.cos(EPS) + z * Math.sin(EPS), -y * Math.sin(EPS) + z * Math.cos(EPS)]; }
  function orient(b, t) { const P = eqW(b[1], b[2]).normalize(), N = eqW(b[1] + 90, 0).normalize(), W = (b[3] + b[4] * (t / DAY - 10957.5)) * D2R;
    const X = N.clone().multiplyScalar(Math.cos(W)).addScaledVector(new THREE.Vector3().crossVectors(P, N), Math.sin(W)).normalize(), Z = new THREE.Vector3().crossVectors(X, P);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, P, Z)); }

  // a lit planet: day texture, Lambert from the Sun + a soft limb, a thin air rim for the ones with air
  const pMat = (map, rim, gas) => new THREE.ShaderMaterial({ uniforms: { map: { value: map }, sun: { value: new THREE.Vector3(1, 0, 0) }, rim: { value: new THREE.Color(...(rim || [0, 0, 0])) } },
    vertexShader: `varying vec2 vUv; varying vec3 vN, vV; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 sun, rim; varying vec2 vUv; varying vec3 vN, vV;
      void main() { vec3 n = normalize(vN); float l = dot(n, sun), mu = max(dot(n, vV), 0.); vec3 c = texture2D(map, vUv).rgb;
        ${gas ? 'c *= .55 + .45 * pow(mu, .35);' : ''}
        vec3 col = c * (max(l, 0.) * 1.25 + .012) + rim * pow(1. - mu, 3.) * smoothstep(-.25, .3, l);
        gl_FragColor = vec4(col, 1.); }` });
  const sphere = new THREE.SphereGeometry(1, 96, 48), bodies = {};
  const bhd = createBodyHD({ THREE, renderer, Q }); scene.add(bhd.group);   // HD close-ups (the Moon) when a body fills the view
  for (const [name, b] of Object.entries(BODY)) {
    let mat;
    if (name === 'Sun') mat = new THREE.ShaderMaterial({ uniforms: { map: { value: tex(TP + 'sun_2k.jpg') } },
      vertexShader: `varying vec2 vUv; varying vec3 vN, vV; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec3 vN, vV; void main() { float mu = max(dot(normalize(vN), vV), 0.);
        vec3 c = texture2D(map, vUv).rgb * vec3(1.6, 1.25, .8) * (.45 + .55 * pow(mu, .5)); gl_FragColor = vec4(c * 2.2, 1.); }` });
    else if (name === 'Earth') mat = pMat(dayTex, [.35, .6, 1]);
    else { const tx = tex(TP + b[5] + '_2k.jpg');
      mat = pMat(tx, name === 'Venus' ? [1, .85, .6] : name === 'Mars' ? [.9, .55, .4] : null, /Jupiter|Saturn|Uranus|Neptune/.test(name)); }
    const m = new THREE.Mesh(sphere, mat); m.frustumCulled = false; scene.add(m);
    bodies[name] = { name, R: b[0] / 6371, b, mesh: m, minPx: b[6], col: b[7], rel: new THREE.Vector3(), d: 1, px: 0 };
  }
  // the Sun's glow (always faces the camera)
  const gc = document.createElement('canvas'); gc.width = gc.height = 256; { const g = gc.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,240,210,1)'); gr.addColorStop(.12, 'rgba(255,220,160,.55)'); gr.addColorStop(.35, 'rgba(255,170,90,.14)'); gr.addColorStop(1, 'rgba(255,150,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); scene.add(glow);
  // Saturn's rings: radial strip (C ring 74 500 km → F ring ~140 000 km), lit, with the planet's shadow
  const ringT = tex(TP + 'saturn_ring_2k.png', null, false);
  const ringGeo = new THREE.RingGeometry(74500 / 58232, 140220 / 58232, 256, 1); ringGeo.rotateX(-Math.PI / 2);   // in the planet's equator (x–z), y = pole
  const ring = new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { map: { value: ringT }, sun: { value: new THREE.Vector3() }, inner: { value: 74500 / 58232 }, outer: { value: 140220 / 58232 } },
    vertexShader: `varying vec3 vP, vW; void main() { vP = position; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz - (modelMatrix * vec4(0., 0., 0., 1.)).xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 sun; uniform float inner, outer; varying vec3 vP, vW;
      void main() { float r = length(vP.xz), u = (r - inner) / (outer - inner); vec4 c = texture2D(map, vec2(u, .5));
        float R = length(vW) / r; vec3 p = vW / R; float b = dot(p, sun), h = b * b - dot(p, p) + 1.; float sh = (b < 0. && h > 0.) ? .08 : 1.;   // in the planet's shadow
        gl_FragColor = vec4(c.rgb * sh * 1.1, c.a * .95); }` }));
  ring.frustumCulled = false; bodies.Saturn.mesh.add(ring);
  // orbits: thin lines, positioned at the Sun
  const orbits = new THREE.Group(); scene.add(orbits); let orbT = -1e15;
  function buildOrbits(t) { orbits.clear(); const T = (t / DAY + 2440587.5 - 2451545) / 36525;
    for (const n of Object.keys(EL)) { const P = [];
      for (let k = 0; k <= 360; k++) { const x = kepler(n, T + k / EL[n][1][3]); P.push(x[0], x[1], x[2]); }   // one turn of mean longitude
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      orbits.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: BODY[n][7], transparent: true, opacity: .35, depthWrite: false }))); } orbT = t; }

  // ── the solar wind + CMEs, drawn on the GPU (same model as space3d: the wind measured / forecast at Earth is traced back
  //    to the solar longitude it left from; each source longitude emits a particle every hour that flies straight out while
  //    the Sun turns under it → the Parker spiral; CMEs = cone model, a cap at r(t) = 0.1 AU + v·(t − t0))
  const OMEGA = 2 * Math.PI / 25.38, kmsAU = v => v * 86400 / 1.495978707e8, JS = 64, KS = 340, DTW = 1 / 24, NW = JS * KS;
  const helioG = new THREE.Group(); scene.add(helioG);
  const wGeo = new THREE.BufferGeometry(), wa = new Float32Array(NW * 4), wb = new Float32Array(NW * 4);
  for (let j = 0; j < JS; j++) for (let k = 0; k < KS; k++) wa.set([j / JS * 2 * Math.PI, k, j, 0], (j * KS + k) * 4);
  wGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(NW * 3), 3));
  wGeo.setAttribute('a', new THREE.BufferAttribute(wa, 4)); wGeo.setAttribute('b', new THREE.BufferAttribute(wb, 4));
  const SC = `vec3 sc(float v) { vec3 c = vec3(.27, .47, 1.);   // speed colours: 300 blue · 420 green · 550 yellow · 700 orange · 900 red
      c = mix(c, vec3(.24, .86, .63), clamp((v - 300.) / 120., 0., 1.)); c = mix(c, vec3(1., .88, .31), clamp((v - 420.) / 130., 0., 1.));
      c = mix(c, vec3(1., .51, .2), clamp((v - 550.) / 150., 0., 1.)); return mix(c, vec3(1., .24, .31), clamp((v - 700.) / 200., 0., 1.)); }`;
  const PFS = `varying vec4 vC; void main() { float f = smoothstep(.5, .1, length(gl_PointCoord - .5)); if (f <= 0.) discard; gl_FragColor = vec4(vC.rgb, vC.a * f); }`;
  const wU = { frac: { value: 0 }, ph0: { value: 0 }, nq: { value: 0 }, tsec: { value: 0 }, AUr: { value: AU }, px: { value: 1 }, gate: { value: 1 } };
  const windP = new THREE.Points(wGeo, new THREE.ShaderMaterial({ uniforms: wU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float frac, ph0, nq, tsec, AUr, px, gate; attribute vec4 a, b; varying vec4 vC; ${SC}
      float hs(float x) { return fract(sin(x) * 43758.5453); }
      void main() { float k = a.y, r = .03 + b.x * (frac + k * ${DTW}), n = mod(nq - k, 100000.), s1 = hs(a.z * 17.13 + n * .731), s2 = hs(a.z * 3.7 + n * 1.913);
        float la = (s1 - .5) * .16, lon = a.x + ph0 - ${OMEGA} * k * ${DTW};
        vec4 mv = modelViewMatrix * vec4(AUr * r * vec3(cos(lon) * cos(la), sin(lon) * cos(la), sin(la)), 1.);
        float fade = clamp((3.2 - r) / .8, 0., 1.) * clamp(r / .12, 0., 1.) * step(r, 3.2), near = smoothstep(.01 * AUr, .08 * AUr, -mv.z);
        float cr = r > .25 ? a.w * min(1., (r - .25) / .3) : 0., pulse = .72 + .28 * sin(r * 55. - tsec * (1. + 3. * clamp((b.y - 300.) / 600., 0., 1.)) + s2 * 6.28);
        vC = vec4(mix(sc(b.y), vec3(1.), cr * .55), min(1., .42 * fade * b.w * b.z * (.8 + .2 * s2) * pulse * (1. + cr * .8) * gate * near));
        gl_PointSize = (1.7 + .9 * b.z + 1.3 * cr) * px; gl_Position = projectionMatrix * mv; if (vC.a < .004) gl_Position = vec4(2., 2., 2., 1.); }`,
    fragmentShader: PFS }));
  windP.frustumCulled = false; helioG.add(windP);
  let wSeries = [], cmes = [], donki = null;
  function setWind(series) { wSeries = series || [];
    const sum = new Float32Array(360), cnt = new Float32Array(360), nsum = new Float32Array(360), known = new Uint8Array(360), v = new Float32Array(360), n = new Float32Array(360);
    wSeries.forEach(p => { if (!(p.v > 100)) return; const E = helio('Earth', p.t), r = Math.hypot(E[0], E[1]) / AU;
      const psi = Math.atan2(E[1], E[0]) - OMEGA * (p.t / DAY) + OMEGA * r / kmsAU(p.v), b = Math.round(((psi / D2R) % 360 + 360) % 360) % 360;
      sum[b] += p.v; nsum[b] += p.n || 5; cnt[b]++; });
    for (let b = 0; b < 360; b++) if (cnt[b]) { v[b] = sum[b] / cnt[b]; n[b] = nsum[b] / cnt[b]; known[b] = 1; }
    for (let b = 0; b < 360; b++) if (!known[b]) {   // gaps: towards a calm 400 km/s with distance from known data
      let d = 1; while (d < 180 && !known[(b + d) % 360] && !known[(b - d + 360) % 360]) d++;
      const nb = known[(b + d) % 360] ? (b + d) % 360 : (b - d + 360) % 360, f = d >= 180 ? 1 : Math.min(1, d / 25);
      v[b] = d >= 180 ? 400 : v[nb] * (1 - f) + 400 * f; n[b] = d >= 180 ? 5 : n[nb] * (1 - f) + 5 * f; }
    for (let pass = 0; pass < 2; pass++) for (let b = 0; b < 360; b++) v[b] = (v[(b + 359) % 360] + 2 * v[b] + v[(b + 1) % 360]) / 4;
    for (let j = 0; j < JS; j++) { const b = Math.round(j / JS * 360) % 360, dens = Math.min(1.6, Math.max(.6, Math.sqrt(n[b] / 5))), cmp = Math.max(0, Math.min(1, (v[b] - v[(b + 8) % 360] - 40) / 220));
      for (let k = 0; k < KS; k++) { const i = (j * KS + k) * 4; wb.set([kmsAU(v[b]), v[b], dens, known[b] ? 1 : .55], i); wa[i + 3] = cmp; } }
    wGeo.attributes.a.needsUpdate = wGeo.attributes.b.needsUpdate = true; buildSpirals(v); setCmes(); }
  // without NASA DONKI analyses: the CMEs the ENLIL run sends to Earth (its "cloud" flag), launched early enough to arrive then — estimates
  function fromEnlil() { const out = []; let seg = null;
    wSeries.forEach(p => { if (p.cme) { if (!seg) seg = { t: p.t, v: p.v }; else seg.v = Math.max(seg.v, p.v); } else if (seg) { out.push(seg); seg = null; } }); if (seg) out.push(seg);
    return out.map(c => ({ t: c.t - (1 - 0.1) / kmsAU(c.v) * DAY, lat: 0, lon: 0, half: 35, v: c.v, est: true })); }
  function setCmes(list) { if (list) donki = list.filter(c => c.v > 0); cmes = donki && donki.length ? donki : fromEnlil(); }
  const CP = 1600, NC = 12, cGeo = new THREE.BufferGeometry(), ca = new Float32Array(CP * 4);
  for (let i = 0; i < CP; i++) { const sh = i < 1100; ca.set(sh ? [(i + .5) / 1100, i * 2.39996, 1, Math.random()] : [Math.random(), Math.random() * 6.283, 0, Math.random()], i * 4); }
  cGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(CP * 3), 3)); cGeo.setAttribute('c', new THREE.BufferAttribute(ca, 4));
  const cmeP = [];
  for (let m = 0; m < NC; m++) { const u = { ax: { value: new THREE.Vector3(1, 0, 0) }, u: { value: new THREE.Vector3(0, 1, 0) }, w: { value: new THREE.Vector3(0, 0, 1) }, r: { value: 1 }, hh: { value: .6 }, fade: { value: 1 }, AUr: { value: AU }, px: wU.px, gate: wU.gate };
    const p = new THREE.Points(cGeo, new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform vec3 ax, u, w; uniform float r, hh, fade, AUr, px, gate; attribute vec4 c; varying vec4 vC;
        void main() { float th = acos(1. - c.x * (1. - cos(hh))), e = th / hh, ph = c.y; vec3 d = ax * cos(th) + (u * cos(ph) + w * sin(ph)) * sin(th);
          float front = r * (1. - .1 * e * e + .04 * cos(2. * ph) * e), rr = c.z > .5 ? front * (.985 + .03 * c.w) : front * (.62 + .33 * pow(c.w, .6)), q = rr / front;
          vec4 mv = modelViewMatrix * vec4(d * rr * AUr, 1.);
          vC = c.z > .5 ? vec4(1., .82 + .18 * (1. - e), .62 + .38 * (1. - e), min(1., .55 + .6 * e) * fade) : vec4(1., .6 + .25 * q, .4 + .3 * q, .3 * fade * q);
          vC.a *= gate * smoothstep(.004 * AUr, .04 * AUr, -mv.z); gl_PointSize = (c.z > .5 ? 2.3 : 2.8) * px; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: PFS }));
    p.frustumCulled = false; p.visible = false; helioG.add(p); cmeP.push(p); }
  let active = [];
  function windUpdate(t, pxr) { const td = t / DAY, nqf = Math.floor(td / DTW), tq = nqf * DTW;
    wU.frac.value = td - tq; wU.ph0.value = (OMEGA * tq) % (2 * Math.PI); wU.nq.value = nqf % 100000; wU.tsec.value = (performance.now() / 1000) % 1000; wU.px.value = pxr;
    active = []; let m = 0;
    for (const c of cmes) { const va = kmsAU(c.v), r = .1 + va * (td - c.t / DAY); if (r < .02 || r > 3.4 || m >= NC) continue;
      const E = helio('Earth', c.t), lon = Math.atan2(E[1], E[0]) + c.lon * D2R, la = c.lat * D2R, h = Math.max(5, c.half) * D2R;
      const ax = new THREE.Vector3(Math.cos(la) * Math.cos(lon), Math.cos(la) * Math.sin(lon), Math.sin(la)), up = Math.abs(ax.z) > .9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const u = new THREE.Vector3().crossVectors(ax, up).normalize(), w = new THREE.Vector3().crossVectors(ax, u), U = cmeP[m].material.uniforms;
      U.ax.value.copy(ax); U.u.value.copy(u); U.w.value.copy(w); U.r.value = r; U.hh.value = h; U.fade.value = Math.min(1, (3.4 - r) / .6); cmeP[m].visible = true; m++;
      active.push({ c, r, ax }); }
    for (; m < NC; m++) cmeP[m].visible = false; }
  // how hard a CME is pressing on Earth now (0–1) + hours until the next one arrives (same rule as space3d)
  function cmeAtEarth(t) { const E = helio('Earth', t), rE = Math.hypot(...E) / AU, ue = E.map(x => x / (rE * AU)); let f = 0, eta = null, hit = null;
    for (const { c, r, ax } of active) { if (ax.x * ue[0] + ax.y * ue[1] + ax.z * ue[2] < Math.cos(Math.max(5, c.half) * D2R)) continue;
      const d = r - rE; if (d < 0) { const hrs = -d / kmsAU(c.v) * 24; if (eta == null || hrs < eta) eta = hrs; }
      else if (rE > r * .62) { const g = Math.min(1, d / .02) * Math.min(1, (rE - r * .62) / (r * .1)); if (g > f) { f = g; hit = c; } } }
    return { f, eta, hit }; }

  // ── the Sun's magnetic field (port of space3d's 🌀 view): closed loops near the Sun, open field lines dragged into Parker
  //    spirals (blue = towards the Sun, red = away, split by the wavy current sheet) with pulses riding them at the wind's
  //    speed, each magnetised planet's own torus (squashed sunward, lit by a passing CME), the heliosphere (94 / 121 AU);
  //    fieldMode 2 = "without the solar wind": the bare dipole torus would wrap the whole system
  const fieldG = new THREE.Group(); helioG.add(fieldG);   // turns with the Sun
  const RS = 696000 / 6371, SSr = 2.5 * RS, TILT = 25 * D2R, sheetLat = lon => TILT * Math.sin(lon), AUkm = 1.495978707e8;
  const P3 = (a, lat, lon) => [a * Math.cos(lat) * Math.cos(lon), a * Math.cos(lat) * Math.sin(lon), a * Math.sin(lat)];
  const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const BL = hex('#78AFFF'), RD = hex('#FF6E6E'), VI = hex('#AA96FF');
  const lMat = () => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  // polylines [{ p: [[x, y, z]…], c: [r, g, b], a: alpha | (i) => alpha }] → one LineSegments
  function lines(polys, obj) { const P = [], C = [];
    for (const { p, c, a } of polys) for (let i = 1; i < p.length; i++) { const a0 = typeof a === 'function' ? a(i - 1) : a, a1 = typeof a === 'function' ? a(i) : a; P.push(...p[i - 1], ...p[i]); C.push(...c, a0, ...c, a1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 4));
    if (obj) { obj.geometry.dispose(); obj.geometry = g; return obj; } const o = new THREE.LineSegments(g, lMat()); o.frustumCulled = false; return o; }
  // 1 · closed loops near the Sun (shown once the Sun is big enough)
  const loopP = []; for (const Lr of [1.3, 1.65, 2.05, 2.5]) { const t0 = Math.asin(Math.sqrt(1 / Lr));
    for (let m = 0; m < 12; m++) { const ps = m / 12 * Math.PI * 2, p = [];
      for (let k = 0; k <= 40; k++) { const th = t0 + (Math.PI - 2 * t0) * k / 40, r = Lr * RS * Math.sin(th) ** 2; p.push([r * Math.sin(th) * Math.cos(ps), r * Math.sin(th) * Math.sin(ps), r * Math.cos(th)]); }
      loopP.push({ p, c: hex('#FFC890'), a: .4 }); } }
  const loops = lines(loopP); fieldG.add(loops);
  // 2 · open field lines (rebuilt with each new wind table) + their pulses
  let spir = lines([]), spirL = []; fieldG.add(spir);
  function buildSpirals(vt) { spirL = []; const polys = [];
    for (let li = 0; li < 6; li++) { const lat0 = [-45, -20, -6, 6, 20, 45][li] * D2R;
      for (let k = 0; k < 8; k++) { const lon0 = k / 8 * Math.PI * 2 + li * .4, col = lat0 > sheetLat(lon0) ? BL : RD;
        const v = Math.abs(lat0) > 30 * D2R ? 750 : (vt ? vt[Math.round(((lon0 / D2R) % 360 + 360) % 360) % 360] : 420) || 420, wind = OMEGA * AUkm / v / 86400;   // rad per AU
        const p = []; let a = 2.5 * 696000 / AUkm; while (a < 125) { p.push(P3(a * AU, lat0 * (a < .05 ? 1 : .985), lon0 - wind * a)); a *= a < 1 ? 1.08 : 1.05; }
        polys.push({ p, c: col, a: i => i < 60 ? .2 : i < 90 ? .11 : .05 }); spirL.push({ lat0, lon0, v, wind, col, li, k }); } }
    spir = lines(polys, spir); }
  buildSpirals(null);
  const pulG = new THREE.BufferGeometry(); pulG.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(48 * 3), 3)); pulG.setAttribute('col', new THREE.Float32BufferAttribute(new Float32Array(48 * 3), 3));
  const pulU = { px: wU.px };
  const pulses = new THREE.Points(pulG, new THREE.ShaderMaterial({ uniforms: pulU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float px; attribute vec3 col; varying vec3 vC; void main() { vC = col; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = 11. * px; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; void main() { float d = length(gl_PointCoord - .5) * 2.; if (d > 1.) discard; gl_FragColor = vec4(mix(vec3(1., .96, .86), vC, smoothstep(0., .9, d)), (1. - d) * .95); }` }));
  pulses.frustumCulled = false; fieldG.add(pulses);
  // 3 · the current sheet ("ballerina skirt"): rings waving above / below the planets' plane
  const sheets = [.4, .7, 1, 1.5, 2.5, 5.2, 9.5, 19, 30].map(a => { const p = [];
    for (let j = 0; j <= 96; j++) { const lon = j / 96 * Math.PI * 2, src = lon + OMEGA * AUkm / 420 / 86400 * a; p.push(P3(a * AU, sheetLat(src) * Math.min(1, a * 2) * .9, lon)); }
    const o = lines([{ p, c: hex('#B9A7FF'), a: .16 }]); o.userData.a = a; fieldG.add(o); return o; });
  // 4 · each magnetised planet's own torus: [magnetopause km, dipole tilt °, min px]
  const PMAG = { Mercury: [3700, 0, 6], Earth: [64000, 23, 12], Jupiter: [5.4e6, 13, 24], Saturn: [1.3e6, 3, 17], Uranus: [6.4e5, 60, 12], Neptune: [6.2e5, 47, 12] };
  const NT = 6 * 2 * 4 * 24 * 2, torG = new THREE.BufferGeometry(), torPos = new Float32Array(NT * 3), torCol = new Float32Array(NT * 4);
  torG.setAttribute('position', new THREE.BufferAttribute(torPos, 3)); torG.setAttribute('color', new THREE.BufferAttribute(torCol, 4));
  const tori = new THREE.LineSegments(torG, lMat()); tori.frustumCulled = false; helioG.add(tori);
  // 5 · the heliosphere: termination shock and heliopause, nose towards the interstellar wind, long tail
  const hn = P3(1, 5 * D2R, 255 * D2R), he1 = new THREE.Vector3(...hn).cross(new THREE.Vector3(0, 0, 1)).normalize(), he2 = new THREE.Vector3(...hn).cross(he1).normalize();
  const helio2 = [[94, '#8E7CFF', .26], [121, '#C77DFF', .34]].map(([R, col, al]) => { const polys = [];
    for (let m = 0; m < 8; m++) { const b2 = m / 8 * Math.PI, p = [];
      for (let j = 0; j <= 80; j++) { const th = j / 80 * Math.PI * 2, c = Math.cos(th), s = Math.sin(th), rr = R * AU * (c > 0 ? 1 : 1 - c * 1.7), e = he1.clone().multiplyScalar(Math.cos(b2)).addScaledVector(he2, Math.sin(b2));
        p.push([0, 1, 2].map(i => rr * (c * hn[i] + s * e.getComponent(i)))); }
      polys.push({ p, c: hex(col), a: al * .55 }); }
    const o = lines(polys); o.userData = { R, col }; helioG.add(o); return o; });
  const hLab = helio2.map(o => { const sp = document.createElement('span'); sp.style.color = o.userData.col; return sp; });
  // 6 · without the solar wind: a bare dipole torus out to 45 AU, with dots running along one field line each
  const dipP = []; [.4, 1, 2.2, 5, 11, 24, 45].forEach(L => { for (let m = 0; m < 12; m++) { const ps = m / 12 * Math.PI * 2, p = [];
      for (let th = .03; th < Math.PI - .03; th += .03) { const r = L * AU * Math.sin(th) ** 2; p.push([r * Math.sin(th) * Math.cos(ps), r * Math.sin(th) * Math.sin(ps), r * Math.cos(th)]); }
      dipP.push({ p, c: m % 2 ? BL : VI, a: .22 }); } });
  const dip = lines(dipP); dip.visible = false; fieldG.add(dip);
  let fieldOn = false, fieldMode = 1;
  function fieldUpdate(t, pix, nearOn) {
    const d = t / DAY, rot = (OMEGA * d) % (2 * Math.PI), dSun = bodies.Sun.d, amax = Math.min(125, Math.max(2.5, dSun / AU * 1.6)), real = fieldOn && fieldMode === 1;
    fieldG.rotation.set(0, 0, rot); fieldG.visible = fieldOn;
    dip.visible = fieldOn && fieldMode === 2; spir.visible = pulses.visible = tori.visible = real;
    loops.visible = real && SSr / (dSun * pix) > 14; sheets.forEach(o => o.visible = real && o.userData.a < amax);
    const hf = real ? Math.min(1, Math.max(0, (dSun / AU - 45) / 15)) : 0; helio2.forEach(o => { o.visible = hf > 0; o.material.opacity = hf; });
    if (!fieldOn) return;
    // pulses (and the what-if dots) ride the lines
    const pp = pulG.attributes.position.array, pc = pulG.attributes.col.array; let n = 0;
    if (fieldMode === 2) { [.4, 1, 2.2, 5, 11, 24, 45].forEach((L, i) => { const ph = (d * .15 + i * .13) % 1, th = .03 + ph * (Math.PI - .06), r = L * AU * Math.sin(th) ** 2;
        pp.set([r * Math.sin(th), 0, r * Math.cos(th)], n * 3); pc.set([.9, .94, 1], n * 3); n++; }); pulses.visible = true; }
    else for (const s of spirL) { const ap = ((d * kmsAU(s.v) + s.k * .37 + s.li * .61) % Math.min(6, amax)) + 2.5 * 696000 / AUkm;
      pp.set(P3(ap * AU, s.lat0, s.lon0 - s.wind * ap), n * 3); pc.set(s.col, n * 3); n++; }
    pulG.setDrawRange(0, n); pulG.attributes.position.needsUpdate = pulG.attributes.col.needsUpdate = true;
    if (fieldMode !== 1) return;
    // planet tori, around each planet (CPU, ~2 300 vertices)
    let v = 0; for (const [nm, [km, tl, mn]] of Object.entries(PMAG)) { if (nm === 'Earth' && nearOn) continue;
      const h = helio(nm, t), cA = h.map(x => x / AU), dl = Math.hypot(...cA), u0 = cA.map(x => -x / dl), tr_ = tl * D2R, b = bodies[nm];
      let s = km / 6371; const px = s / (b.d * pix); if (px < mn) s *= mn / px;
      const ax = [-Math.sin(tr_) * u0[1], Math.sin(tr_) * u0[0], Math.cos(tr_)], axl = Math.hypot(...ax); for (let i = 0; i < 3; i++) ax[i] /= axl;
      const e1 = u0, e2 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]];
      let hit = 0; for (const { c: ce, r: rr, ax: cax } of active) { const cosA = (cax.x * cA[0] + cax.y * cA[1] + cax.z * cA[2]) / dl;
        if (Math.acos(Math.max(-1, Math.min(1, cosA))) < (Math.max(5, ce.half) + 8) * D2R) hit = Math.max(hit, 1 - Math.abs(rr - dl) / (.12 * dl)); }
      hit = Math.max(0, hit); const sq2 = .7 - .3 * hit, col = hit > .05 ? [1, (200 - 80 * hit) / 255, (160 - 60 * hit) / 255] : nm === 'Earth' ? hex('#7FC4FF') : hex('#9FE8C8'), al = .32 + .45 * hit;
      for (const L of [.6, 1]) { const t0 = Math.asin(Math.sqrt(.3 / L));
        for (let m = 0; m < 4; m++) { const ps = m / 4 * Math.PI * 2; let prev = null;
          for (let k = 0; k <= 24; k++) { const th = t0 + (Math.PI - 2 * t0) * k / 24, r = L * Math.sin(th) ** 2, hh = r * Math.sin(th); let cx = hh * Math.cos(ps); const cy = hh * Math.sin(ps); cx *= cx > 0 ? sq2 : 2.2;
            const q = [0, 1, 2].map(i => h[i] + s * (cx * e1[i] + cy * e2[i] + r * Math.cos(th) * ax[i]));
            if (prev && v < NT - 1) { torPos.set(prev, v * 3); torPos.set(q, v * 3 + 3); torCol.set([...col, al, ...col, al], v * 4); v += 2; } prev = q; } } } }
    torG.setDrawRange(0, v); torG.attributes.position.needsUpdate = torG.attributes.color.needsUpdate = true; }
  // labels
  const lab = document.createElement('div'); lab.className = 'e3g-pl'; el.appendChild(lab);
  for (const b of Object.values(bodies)) { b.lab = lab.appendChild(document.createElement('span')); b.lab.textContent = tr(b.name); b.lab.style.color = b.col || '#FFE6B0'; }
  hLab.forEach((sp, i) => { sp.textContent = i ? tr('heliopause · 121 AU (Voyager 1, 2012)') : tr('termination shock · 94 AU'); lab.appendChild(sp); });
  const sunW = new THREE.Vector3();
  let realScale = false, guides = false;   // guides = names + orbit lines
  // camHelio: the camera's heliocentric ecliptic position (R⊕, doubles) · camW: the camera's world position (in the Earth view's frame)
  let windOn = false;
  function update(t, camHelio, W, H, nearOn, pxr) {
    eclToWorld(t); if (Math.abs(t - orbT) > 5 * DAY) buildOrbits(t);
    cam.quaternion.copy(camera.quaternion); cam.fov = camera.fov; cam.aspect = camera.aspect;
    const pix = 2 * Math.tan(camera.fov * D2R / 2) / H; let nearest = 1e12;
    for (const b of Object.values(bodies)) { const h = helio(b.name, t); toW([h[0] - camHelio[0], h[1] - camHelio[1], h[2] - camHelio[2]], b.rel); b.d = b.rel.length();
      const boost = realScale ? 1 : Math.max(1, b.minPx * pix * b.d / b.R); b.rs = b.R * boost; b.px = b.rs / (b.d * pix);
      b.mesh.position.copy(b.rel); b.mesh.scale.setScalar(b.rs); if (b.name !== 'Earth' && b.name !== 'Sun') b.mesh.quaternion.copy(orient(b.b, t));
      nearest = Math.min(nearest, Math.max(1e-3, b.d - b.rs)); }
    if (warm.length) renderer.initTexture(warm.shift());
    if (HI) for (const b of Object.values(bodies)) if (!b.hi && b.px > 300 && b.b[5] && b.mesh.material.uniforms.map) { b.hi = true; const u = b.mesh.material.uniforms.map;
      tex(TP + b.b[5] + '.jpg', t => { const old = u.value; u.value = t; if (old && old !== t) setTimeout(() => old.dispose(), 2000); }); }
    const S = bodies.Sun.rel; sunW.copy(S);
    for (const b of Object.values(bodies)) if (b.mesh.material.uniforms.sun) b.mesh.material.uniforms.sun.value.copy(tmp.copy(S).sub(b.rel).normalize());
    ring.material.uniforms.sun.value.copy(bodies.Saturn.mesh.material.uniforms.sun.value);
    // HD close-up of the biggest body on screen that has one; its texture sphere sinks a little under the relief
    let hb = null; for (const b of Object.values(bodies)) if (bhd.has(b.name) && (!hb || b.px > hb.px)) hb = b;
    cam.updateMatrixWorld(); const hdR = bhd.update(hb, cam, hb ? hb.mesh.material.uniforms.sun.value : null);
    if (hdR) { nearest = Math.min(nearest, Math.max(2e-8, hdR.clear)); hb.mesh.scale.setScalar(hb.rs * (1 - 15000 / (hb.R * 6371000))); }
    bodies.Earth.mesh.visible = !nearOn; bodies.Earth.mesh.quaternion.copy(quatW);
    glow.position.copy(S); glow.scale.setScalar(Math.max(bodies.Sun.rs * 9, 40 * pix * bodies.Sun.d));
    orbits.position.copy(S); orbits.quaternion.setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(M));
    helioG.position.copy(S); helioG.quaternion.copy(orbits.quaternion); windP.visible = windOn; wU.px.value = pxr || 1;
    if (windOn) windUpdate(t, pxr || 1); else { active = []; cmeP.forEach(p => p.visible = false); }
    fieldUpdate(t, pix, nearOn); helioG.updateMatrixWorld(true);
    cam.near = Math.max(hdR ? 1e-8 : 1e-3, nearest * .5); cam.far = Math.max(cam.near * 10, 4e6, bodies.Sun.d * 3); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    // labels: beside each body when it is small on screen, hidden when big or behind
    const qi = cam.quaternion.clone().invert(), occ = Object.values(bodies).filter(o => o.px > 60 || (o.name === 'Earth' && nearOn));   // big bodies hide the labels behind them
    for (const b of Object.values(bodies)) { const s = b.lab; if ((b.name === 'Earth' && nearOn) || b.px > 60 || occ.some(o => o !== b && o.d < b.d && o.rel.angleTo(b.rel) < Math.asin(Math.min(1, o.rs / o.d)))) { s.style.opacity = 0; continue; }
      v3.copy(b.rel).applyQuaternion(qi); if (v3.z > 0) { s.style.opacity = 0; continue; }
      const x = (v3.x / (-v3.z * pix) + W / 2), y = (H / 2 - v3.y / (-v3.z * pix)); if (x < -50 || x > W + 50 || y < -20 || y > H + 20) { s.style.opacity = 0; continue; }
      s.style.opacity = 1; s.style.transform = `translate(${Math.round(x + b.px + 6)}px, ${Math.round(y - 8)}px)`; }
    helio2.forEach((o, i) => { const s = hLab[i]; if (!o.visible || bodies.Sun.d < 60 * AU) { s.style.opacity = 0; return; }
      v3.set(...hn).multiplyScalar(o.userData.R * AU).applyMatrix4(helioG.matrixWorld).applyQuaternion(qi).sub(tmp.copy(cam.position).applyQuaternion(qi)); if (v3.z > 0) { s.style.opacity = 0; return; }
      s.style.opacity = o.material.opacity; s.style.transform = `translate(${Math.round(v3.x / (-v3.z * pix) + W / 2 + 6)}px, ${Math.round(H / 2 - v3.y / (-v3.z * pix) - 8)}px)`; });
    return { sunW, bodies }; }
  // the body under a screen point (within its drawn disc + a few px), nearest first
  function pick(x, y, W, H) { const pix = 2 * Math.tan(camera.fov * D2R / 2) / H; let best = null, bd = 1e9; const qi = cam.quaternion.clone().invert();
    for (const b of Object.values(bodies)) { v3.copy(b.rel).applyQuaternion(qi); if (v3.z > 0) continue; const sx = v3.x / (-v3.z * pix) + W / 2, sy = H / 2 - v3.y / (-v3.z * pix), r = Math.hypot(sx - x, sy - y);
      if (r < Math.max(14, b.px + 6) && b.d < bd) { best = b; bd = b.d; } } return best; }
  const hdHas = n => bhd.has(n), hdOn = n => bhd.on === n, hdGround = (n, dirW) => bhd.ground(n, bodies[n], dirW);
  orbits.visible = guides; lab.style.display = guides ? '' : 'none';   // start as the Layers panel says (off)
  return { scene, cam, update, bodies, pick, hdHas, hdOn, hdGround, helio, eclToWorld, toWorld: p => toW(p, new THREE.Vector3()), fromWorld: v => v.clone().applyMatrix3(Mi), get realScale() { return realScale; }, set realScale(v) { realScale = v; }, setWind, setCmes, cmeAtEarth, get wind() { return windOn; }, set wind(v) { windOn = v; }, get field() { return fieldOn; }, set field(v) { fieldOn = v; }, get bare() { return fieldMode === 2; }, set bare(v) { fieldMode = v ? 2 : 1; }, get guides() { return guides; }, set guides(v) { guides = v; orbits.visible = v; lab.style.display = v ? '' : 'none'; } };
}
