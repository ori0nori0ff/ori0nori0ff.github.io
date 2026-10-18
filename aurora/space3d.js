/* PowHau · 3D solar system + solar wind + CMEs (plain WebGL 1, no libraries) — shared by the app's aurora page
   (assets/noaa/) and the public page (web/aurora/).
   Model, not a picture: planets at their real positions for the shown time (JPL mean orbital elements),
   the solar wind as a co-rotating Parker spiral whose speed comes from NOAA's WSA-ENLIL run at Earth
   (each sample traced back to the solar longitude it left from), CMEs from NASA DONKI cone analyses expanding
   at their measured speed. Distances are true (AU), sizes are not.
   Space3D.create(el, { wind: [{t, v, n}], cmes: [{t, lat, lon, half, v}] }) → { setTime(t), setWind(), setCmes(), view(name), resize() } */
(function () {
  'use strict';
  const tr = (s, o) => window.T ? window.T(s, o) : String(s).replace(/\{(\w+)\}/g, (m, k) => o && o[k] != null ? o[k] : m);
  const D2R = Math.PI / 180, DAY = 864e5, AU_KM = 1.495978707e8, OMEGA = 2 * Math.PI / 25.38;   // Sun's sidereal rotation, rad/day
  const kmsAU = v => v * 86400 / AU_KM;   // km/s → AU/day
  // JPL "Keplerian elements for approximate positions" (1800–2050): a, e, I, L, long.peri, long.node + rates per century
  const EL = {
    Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081], '#B8B2A7', 2.4],
    Venus: [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418], '#E8D3A2', 3.6],
    Earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0], '#5AA9FF', 3.8],
    Mars: [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343], '#E2704A', 3],
    Jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106], '#D9B38C', 7],
    Saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794], '#E6CF8E', 6.2],
    Uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589], '#9FE3E8', 5],
    Neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664], '#6E8BFF', 5],
  };
  function planet(name, t) {   // heliocentric ecliptic x, y, z in AU (y = up in the scene, so we return [x, z, -y])
    const [e0, r, , ] = EL[name], T = (t / DAY + 2440587.5 - 2451545) / 36525, el = e0.map((v, i) => v + r[i] * T);
    const [a, e, I, L, wb, Om] = el, w = (wb - Om) * D2R, M = ((L - wb) % 360) * D2R, i = I * D2R, O = Om * D2R;
    let E = M + e * Math.sin(M); for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
    const x = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp, y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp, z = (sw * si) * xp + (cw * si) * yp;
    return [x, z, -y];
  }
  const lonOf = p => Math.atan2(-p[2], p[0]);   // ecliptic longitude of a scene point
  // equatorial (RA, Dec in degrees) → scene direction (ecliptic x, up = ecliptic north, like planet())
  function eqDir(ra, de) { const e = 23.439 * D2R, a = ra * D2R, d = de * D2R, x = Math.cos(d) * Math.cos(a), y = Math.cos(d) * Math.sin(a), z = Math.sin(d);
    const ye = y * Math.cos(e) + z * Math.sin(e), ze = -y * Math.sin(e) + z * Math.cos(e); return [x, ze, -ye]; }
  // the Sun's motion: towards the solar apex in Hercules (vs nearby stars, ~20 km/s) or along the galactic rotation
  // towards Cygnus (galactic l = 90°, around the Milky Way's centre, ~230 km/s)
  const TRAVEL = { lsr: { dir: eqDir(271, 30), v: 20 }, gal: { dir: eqDir(318.0, 48.3), v: 230 } };
  // speed colours: slow blue → normal green → fast yellow → very fast red
  function speedCol(v) {
    const S = [[300, [70, 120, 255]], [420, [60, 220, 160]], [550, [255, 225, 80]], [700, [255, 130, 50]], [900, [255, 60, 80]]];
    if (v <= S[0][0]) return S[0][1]; for (let i = 1; i < S.length; i++) if (v <= S[i][0]) { const f = (v - S[i - 1][0]) / (S[i][0] - S[i - 1][0]); return S[i - 1][1].map((c, k) => c + (S[i][1][k] - c) * f); }
    return S[S.length - 1][1];
  }
  // tiny matrix helpers (column-major, like GL)
  const persp = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; };
  const lookAt = (e, c, u) => { let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]], l = Math.hypot(...z); z = z.map(v => v / l);
    let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]]; l = Math.hypot(...x); x = x.map(v => v / l);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1]; };
  const mul = (a, b) => { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; };

  const VS = 'attribute vec3 p;attribute vec4 c;attribute float s;uniform mat4 m;uniform float k;uniform float mx;varying vec4 vc;void main(){gl_Position=m*vec4(p,1.);gl_PointSize=clamp(s*k/gl_Position.w,1.,mx);vc=c;}';
  const FS = 'precision mediump float;varying vec4 vc;uniform float pt;void main(){float a=vc.a;if(pt>.5){float d=length(gl_PointCoord-.5);a*=smoothstep(.5,.0,d);}gl_FragColor=vec4(vc.rgb*a,a);}';

  const CSS = `.s3d{position:relative;overflow:hidden;background:#05070D;border-radius:16px;touch-action:none;user-select:none;-webkit-user-select:none}
.s3d canvas{position:absolute;left:0;top:0;display:block}.s3d-ov{cursor:grab}.s3d-ov:active{cursor:grabbing}
.s3d-top{position:absolute;left:12px;top:10px;pointer-events:none;display:flex;flex-direction:column;gap:2px;text-shadow:0 1px 3px #000}
.s3d-t{font:700 15px Inter,system-ui,sans-serif;color:#FFE600}.s3d-sub{font:500 12px Inter,system-ui,sans-serif;color:#C9D1DB}
.s3d-btns{position:absolute;left:10px;bottom:10px;display:flex;gap:6px;flex-wrap:wrap;max-width:calc(100% - 70px)}
.s3d-btns button,.s3d-ctl button{border:1px solid rgba(255,255,255,.18);background:rgba(10,14,20,.75);color:#E6EBF1;border-radius:999px;padding:7px 12px;min-height:36px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}
.s3d-ctl{position:absolute;right:10px;top:10px;display:flex;flex-direction:column;gap:6px}.s3d-ctl button{width:40px;height:40px;padding:0;font-size:18px;line-height:1}
.s3d-tabs{position:absolute;left:50%;top:10px;transform:translateX(-50%);display:flex;border:1px solid rgba(255,255,255,.18);border-radius:999px;overflow:hidden;background:rgba(10,14,20,.75)}
.s3d-tabs button{border:0;background:none;color:#C9D1DB;padding:8px 14px;min-height:36px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}.s3d-tabs button[aria-pressed=true]{background:#39FF9E;color:#0A0A0A}
.s3d-btns button[aria-pressed=true]{border-color:#39FF9E;color:#39FF9E}.s3d .s3d-hx{display:none}.s3d.hx .s3d-hx{display:flex}.s3d.hx .s3d-sys,.s3d.hx .s3d-leg{display:none}
.s3d-info{position:absolute;right:60px;top:10px;max-width:250px;background:rgba(10,14,20,.88);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:10px 12px;font:500 12px/1.5 Inter,system-ui,sans-serif;color:#C9D1DB}
.s3d-info b{display:block;font-size:15px;color:#fff;margin-bottom:2px}.s3d-info button{float:right;border:0;background:none;color:#A3B0C2;font-size:14px;cursor:pointer;margin:-4px -4px 0 6px}
.s3d-help{position:absolute;inset:56px 60px 60px 10px;overflow:auto;background:rgba(8,11,17,.94);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px 16px;font:500 13px/1.55 Inter,system-ui,sans-serif;color:#C9D1DB}
.s3d-help b{color:#fff;font-size:14px}.s3d-help p{margin:2px 0 12px}.s3d-hx-x{float:right;border:0;background:none;color:#A3B0C2;font-size:16px;cursor:pointer}
.s3d.ea .s3d-gl,.s3d.ea .s3d-ov,.s3d.ea .s3d-btns,.s3d.ea .s3d-leg,.s3d.ea .s3d-top,.s3d.ea .s3d-info,.s3d.ea .s3d-help,.s3d.ea .s3d-ctl button:not(.s3d-full){display:none!important}.s3d.ea .s3d-tabs,.s3d.ea .s3d-ctl{z-index:5}
.s3d-hdate{background:rgba(10,14,20,.75);color:#E6EBF1;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:6px 10px;min-height:36px;font:600 12px Inter,system-ui,sans-serif;color-scheme:dark}
.s3d.gx .s3d-hx{display:flex}.s3d.gx .s3d-hdate,.s3d.gx [data-f],.s3d.gx .s3d-sys,.s3d.gx .s3d-leg{display:none!important}
.s3d:focus-visible{outline:3px solid #FFE600;outline-offset:2px}
@media (max-width:640px){.s3d-tabs{top:52px;left:12px;transform:none}.s3d-tabs button{padding:7px 10px;font-size:11px}.s3d-info{right:56px;max-width:190px}}
.s3d-leg{position:absolute;right:12px;bottom:14px;font:500 11px Inter,system-ui,sans-serif;color:#A3B0C2;pointer-events:none;text-shadow:0 1px 2px #000}
.s3d-leg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin:0 3px 0 8px;vertical-align:-1px}
.s3d.s3d-fs{position:fixed!important;inset:0;z-index:200;border-radius:0;height:auto!important;aspect-ratio:auto!important}body.s3d-lock{overflow:hidden}
@media (max-width:560px){.s3d-leg{display:none}}`;
  function create(el, opts) {
    opts = opts || {};
    if (!document.getElementById('s3d-css')) { const st = document.createElement('style'); st.id = 's3d-css'; st.textContent = CSS; document.head.appendChild(st); }
    el.classList.add('s3d');
    el.innerHTML = `<canvas class="s3d-gl"></canvas><canvas class="s3d-ov"></canvas>
      <div class="s3d-top"><b class="s3d-t">–</b><span class="s3d-sub"></span></div>
      <div class="s3d-tabs" role="tablist"><button data-m="sys" aria-pressed="true">${tr('Solar system')}</button><button data-m="helix" aria-pressed="false">${tr('Spiral through space')}</button><button data-m="galaxy" aria-pressed="false">${tr('Galaxy')}</button><button data-m="earth" aria-pressed="false">${tr('Earth')}</button></div>
      <div class="s3d-btns s3d-sys"><button data-v="inner">${tr('Inner planets')}</button><button data-v="all">${tr('Whole system')}</button><button data-v="earth">${tr('From Earth')}</button><button data-v="top">${tr('From above')}</button></div>
      <div class="s3d-btns s3d-hx"><button class="s3d-hrev" aria-label="${tr('Play backwards')}" aria-pressed="false">◀</button><button class="s3d-hplay" aria-label="${tr('Play')}">▶</button><button class="s3d-hspd">1×</button><input type="date" class="s3d-hdate" aria-label="${tr('Date')}"><button data-f="lsr" aria-pressed="true">${tr('vs nearby stars · 20 km/s')}</button><button data-f="gal" aria-pressed="false">${tr('around the Milky Way · 230 km/s')}</button></div>
      <div class="s3d-ctl"><button class="s3d-full" aria-label="${tr('Full screen')}">⛶</button><button data-z="-1" aria-label="${tr('Zoom in')}">+</button><button data-z="1" aria-label="${tr('Zoom out')}">−</button><button class="s3d-reset" aria-label="${tr('Reset the view')}">⟲</button><button class="s3d-q" aria-label="${tr('How it works')}">?</button></div>
      <div class="s3d-info" hidden></div>
      <div class="s3d-help" hidden><button class="s3d-hx-x" aria-label="${tr('Close')}">✕</button>
        <b>${tr('Moving around')}</b><p>${tr('Drag to turn · pinch or scroll to zoom · two fingers or right-drag to move sideways · double-tap to reset · tap a planet to fly to it and see its numbers. Keys: arrows turn, + / − zoom, R reset, space play.')}</p>
        <b>${tr('Solar system')}</b><p>${tr('Planets at their real positions for the shown time (NASA JPL orbital elements). The solar wind leaves the Sun in all directions while the Sun turns once every ~25 days, so the streams wind up into a spiral (the Parker spiral) — like water from a turning garden sprinkler. Speed and colour come from NOAA’s model at Earth. CMEs grow from the Sun at their measured speed and direction (NASA DONKI, or estimated from NOAA’s model). Distances are real, sizes are not.')}</p>
        <b>${tr('Spiral through space')}</b><p>${tr('The Sun is not standing still: it moves ~20 km/s towards the constellation Hercules compared with nearby stars, and ~230 km/s around the centre of the Milky Way. The planets come along, so each one draws a spiral (a helix) around the Sun’s path. The orbits are tilted about 60° to that path, so the spirals are slanted — the planets are not dragged behind the Sun like a comet tail, as some popular videos show.')}</p></div>
      <div class="s3d-leg"><i style="background:rgb(70,120,255)"></i>300 <i style="background:rgb(60,220,160)"></i>420 <i style="background:rgb(255,225,80)"></i>550 <i style="background:rgb(255,130,50)"></i>700+ km/s <i style="background:#fff"></i>CME</div>`;
    const cv = el.querySelector('.s3d-gl'), ov = el.querySelector('.s3d-ov'), g2 = ov.getContext('2d');
    const gl = cv.getContext('webgl', { antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl) { el.querySelector('.s3d-t').textContent = tr('3D needs WebGL — not available on this device.'); return { setTime() {}, setWind() {}, setCmes() {}, view() {}, resize() {} }; }
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    const A = { p: gl.getAttribLocation(pr, 'p'), c: gl.getAttribLocation(pr, 'c'), s: gl.getAttribLocation(pr, 's') }, U = { m: gl.getUniformLocation(pr, 'm'), k: gl.getUniformLocation(pr, 'k'), pt: gl.getUniformLocation(pr, 'pt'), mx: gl.getUniformLocation(pr, 'mx') };
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
    const mk = (n) => ({ p: new Float32Array(n * 3), c: new Float32Array(n * 4), s: new Float32Array(n), bp: gl.createBuffer(), bc: gl.createBuffer(), bs: gl.createBuffer(), n: 0 });
    const upload = b => { [['bp', 'p', 3, A.p], ['bc', 'c', 4, A.c], ['bs', 's', 1, A.s]].forEach(([bk, k, sz, loc]) => { gl.bindBuffer(gl.ARRAY_BUFFER, b[bk]); gl.bufferData(gl.ARRAY_BUFFER, b[k].subarray(0, b.n * sz), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, sz, gl.FLOAT, false, 0, 0); }); };
    const bind = b => { [['bp', 3, A.p], ['bc', 4, A.c], ['bs', 1, A.s]].forEach(([bk, sz, loc]) => { gl.bindBuffer(gl.ARRAY_BUFFER, b[bk]); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, sz, gl.FLOAT, false, 0, 0); }); };

    // stars (fixed), orbits (per time), wind + CMEs (per time)
    const stars = mk(1600), rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);
    for (let i = 0; i < 1600; i++) { const u = rnd() * 2 - 1, th = rnd() * 6.283, r = 400, q = Math.sqrt(1 - u * u), b = .25 + .75 * rnd() ** 3;
      stars.p.set([r * q * Math.cos(th), r * u, r * q * Math.sin(th)], i * 3); stars.c.set([b, b, b * 1.05, b], i * 4); stars.s[i] = 1.6 * 400; } stars.n = 1600; upload(stars);
    const ORB = Object.keys(EL), orbits = mk(ORB.length * 181);
    const JS = 64, KS = 340, DT = 1 / 24, wind = mk(JS * KS), lat = new Float32Array(JS * KS);   // 64 source longitudes × 340 emissions every hour (~14 days)
    for (let i = 0; i < JS * KS; i++) lat[i] = (rnd() - .5) * (rnd() < .2 ? 0.3 : 0.08);
    const cmeB = mk(12 * 700);
    const HX = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'], HXN = 900, trails = mk((HX.length + 1) * HXN);
    const galB = mk(52000), ring = mk(361); let gT = 0, galBuilt = false;
    let mode = 'sys', frameK = 'lsr', hTime = Date.now(), hPlay = false, hRate = 1, hDir = 1, hLast = 0, info = null;
    let vtab = new Float32Array(360).fill(400), ntab = new Float32Array(360).fill(5), known = new Uint8Array(360), cmes = [], time = Date.now();
    // camera
    const cam = { yaw: -0.6, pitch: 0.55, dist: 3.4, tgt: [0, 0, 0], goal: null };
    let W = 0, H = 0, dpr = 1, M = null, dirty = true, visible = true, spin = [0, 0];

    function setWind(series_) {   // trace each at-Earth sample back to the solar longitude (co-rotating) its wind left from
      const sum = new Float32Array(360), cnt = new Float32Array(360), nsum = new Float32Array(360);
      (series_ || []).forEach(p => { if (!(p.v > 100)) return; const t = p.t, E = planet('Earth', t), r = Math.hypot(E[0], E[2]);
        const psi = lonOf(E) - OMEGA * (t / DAY) + OMEGA * r / kmsAU(p.v); let b = Math.round(((psi / D2R) % 360 + 360) % 360) % 360;
        sum[b] += p.v; nsum[b] += p.n || 5; cnt[b]++; });
      known = new Uint8Array(360); const v = new Float32Array(360), n = new Float32Array(360);
      for (let b = 0; b < 360; b++) if (cnt[b]) { v[b] = sum[b] / cnt[b]; n[b] = nsum[b] / cnt[b]; known[b] = 1; }
      for (let b = 0; b < 360; b++) if (!known[b]) {   // gaps: blend towards a calm 400 km/s with distance from known data
        let d = 1; while (d < 180 && !known[(b + d) % 360] && !known[(b - d + 360) % 360]) d++;
        const nb = known[(b + d) % 360] ? (b + d) % 360 : (b - d + 360) % 360, f = d >= 180 ? 1 : Math.min(1, d / 25);
        v[b] = d >= 180 ? 400 : v[nb] * (1 - f) + 400 * f; n[b] = d >= 180 ? 5 : n[nb] * (1 - f) + 5 * f; }
      for (let pass = 0; pass < 2; pass++) for (let b = 0; b < 360; b++) v[b] = (v[(b + 359) % 360] + 2 * v[b] + v[(b + 1) % 360]) / 4;
      vtab = v; ntab = n; series = series_ || []; setCmes(); dirty = true;
    }
    let donki = null, series = [];
    // without NASA DONKI analyses: CMEs the ENLIL run sends to Earth (its "cloud" flag at Earth), launched towards Earth
    // early enough to arrive then at that speed — marked as estimates
    function fromEnlil() { const out = []; let seg = null;
      series.forEach(p => { if (p.cme) { if (!seg) seg = { t: p.t, v: p.v }; else seg.v = Math.max(seg.v, p.v); } else if (seg) { out.push(seg); seg = null; } }); if (seg) out.push(seg);
      return out.map(c => ({ t: c.t - (1 - 0.1) / kmsAU(c.v) * DAY, lat: 0, lon: 0, half: 35, v: c.v, est: true })); }
    function setCmes(list) { if (list) donki = list.filter(c => c.v > 0); cmes = donki && donki.length ? donki : fromEnlil(); dirty = true; }

    // the planets' paths relative to the Sun's position now: p(t') + V·(t' − t) — behind the Sun for t' < t
    function hxBasis() { const d = TRAVEL[frameK].dir, N = [0, 1, 0], k = d[1], y0 = [N[0] - k * d[0], N[1] - k * d[1], N[2] - k * d[2]], l = Math.hypot(...y0), ey = y0.map(x => x / l);
      const ez = [d[1] * ey[2] - d[2] * ey[1], d[2] * ey[0] - d[0] * ey[2], d[0] * ey[1] - d[1] * ey[0]]; return [d, ey, ez]; }
    const toHx = p => { if (mode !== 'helix') return p; const [a, b, c] = hxBasis(); return [a[0] * p[0] + a[1] * p[1] + a[2] * p[2], b[0] * p[0] + b[1] * p[1] + b[2] * p[2], c[0] * p[0] + c[1] * p[1] + c[2] * p[2]]; };
    function hxMat() { const [a, b, c] = hxBasis(); return [a[0], b[0], c[0], 0, a[1], b[1], c[1], 0, a[2], b[2], c[2], 0, 0, 0, 0, 1]; }
    function buildHelix() {
      const T = TRAVEL[frameK], V = T.dir.map(x => x * kmsAU(T.v)), t = hTime; let n = 0;
      HX.forEach((nm, pi) => { const per = Math.pow(EL[nm][0][0], 1.5) * 365.25, span = Math.min(per * 2.2, 380 * 365.25) * DAY, col = EL[nm][2].match(/\w\w/g).map(h => parseInt(h, 16) / 255);
        for (let i = 0; i < HXN; i++) { const f = i / (HXN - 1), tp = t - span * (1 - f), p = planet(nm, tp), dd = (tp - t) / DAY;
          trails.p.set([p[0] + V[0] * dd, p[1] + V[1] * dd, p[2] + V[2] * dd], n * 3); trails.c.set([col[0], col[1], col[2], .15 + .75 * f * f], n * 4); trails.s[n] = 1; n++; } });
      const span = 6 * 365.25 * DAY; for (let i = 0; i < HXN; i++) { const f = i / (HXN - 1), dd = -span * (1 - f) / DAY;
        trails.p.set(V.map(x => x * dd), n * 3); trails.c.set([1, .8, .35, .1 + .6 * f], n * 4); trails.s[n] = 1; n++; }
      trails.n = n; upload(trails);
    }
    // the Milky Way as a model (kpc): bulge, bar, four log-spiral arms (pitch ~12°), a thin disc; the Sun 8.2 kpc out
    function buildGalaxy() { if (galBuilt) return; galBuilt = true; const g = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283 * v); };
      const arms = [0, 1.57, 3.14, 4.71], k = 1 / Math.tan(12 * D2R); let n = 0;
      const put = (x, y, z, c, a) => { galB.p.set([x, y, z], n * 3); galB.c.set([c[0], c[1], c[2], Math.min(1, a * 1.5)], n * 4); galB.s[n] = 80; n++; };
      for (let i = 0; i < 7000; i++) { const r = Math.abs(g()) * .9, t = rnd() * 6.283, ph = Math.acos(2 * rnd() - 1); put(r * Math.sin(ph) * Math.cos(t), r * Math.cos(ph) * .55, r * Math.sin(ph) * Math.sin(t), [1, .82, .55], .55); }
      for (let i = 0; i < 5000; i++) { const l = g() * 2.2, w = g() * .45, c = Math.cos(27 * D2R), sn = Math.sin(27 * D2R); put(l * c - w * sn, g() * .15, l * sn + w * c, [1, .85, .62], .5); }
      for (let i = 0; i < 30000; i++) { const r = 2.6 + Math.pow(rnd(), 1.35) * 13, a = arms[i % 4] + Math.log(r / 2.6) * k, sp = .22 * Math.sqrt(r / 6), off = g() * sp, oa = g() * .08;
        const hii = rnd() < .05, col = hii ? [1, .45, .7] : r < 5 ? [.95, .9, .85] : [.62, .75, 1]; put(r * Math.cos(a + oa) + off * Math.cos(a), g() * .08, -(r * Math.sin(a + oa) + off * Math.sin(a)), col, hii ? .7 : .45); }
      while (n < 52000) { const r = Math.pow(rnd(), .7) * 15, t = rnd() * 6.283; put(r * Math.cos(t), g() * .12, -r * Math.sin(t), [.75, .78, .9], .18); }
      galB.n = n; upload(galB);
      for (let i = 0; i <= 360; i++) { const t = i * D2R; ring.p.set([8.2 * Math.cos(t), 0, -8.2 * Math.sin(t)], i * 3); ring.c.set([1, .85, .4, .35], i * 4); ring.s[i] = 1; } ring.n = 361; upload(ring); }
    const sunGal = () => { const t = -gT / 230 * 2 * Math.PI + 0.35; return [8.2 * Math.cos(t), .025 + .07 * Math.sin(gT / 70 * 2 * Math.PI), -8.2 * Math.sin(t)]; };   // clockwise seen from the north galactic pole
    function build() {
      if (mode === 'galaxy') { buildGalaxy(); return; }
      if (mode === 'helix') { buildHelix(); return; }
      const td = time / DAY;
      // orbits: the path each planet traces over one period
      if (Math.abs(time - (build.orbT || -1e15)) > 5 * DAY) { build.orbT = time; let o = 0; ORB.forEach(nm => { const per = Math.pow(EL[nm][0][0], 1.5) * 365.25 * DAY, col = nm === 'Earth' ? [.35, .6, 1, .55] : [.6, .7, .85, .22];
        for (let i = 0; i <= 180; i++) { const p = planet(nm, time + (i / 180) * per); orbits.p.set(p, o * 3); orbits.c.set(col, o * 4); orbits.s[o] = 1; o++; } }); orbits.n = o; upload(orbits); }
      // wind: particle (j, k) left co-rotating longitude psi_j at time te; it flies radially at that longitude's speed
      const tq = Math.floor(td / DT) * DT; let n = 0;
      for (let j = 0; j < JS; j++) { const psi = j / JS * 2 * Math.PI, b = Math.round(j / JS * 360) % 360, v = vtab[b], va = kmsAU(v), col = speedCol(v), dens = Math.min(1.6, Math.max(.6, Math.sqrt(ntab[b] / 5))), kn = known[b] ? 1 : .55;
        for (let k = 0; k < KS; k++) { const te = tq - k * DT, r = 0.03 + va * (td - te); if (r > 3.2 || r < 0.03) continue;
          const lon = psi + OMEGA * te, la = lat[j * KS + k], fade = Math.min(1, (3.2 - r) / 0.8) * Math.min(1, r / 0.12);
          const a = 0.7 * fade * kn * dens * (0.8 + 0.2 * Math.cos(k * 1.7 + j));
          wind.p.set([r * Math.cos(lon) * Math.cos(la), r * Math.sin(la), -r * Math.sin(lon) * Math.cos(la)], n * 3);
          wind.c.set([col[0] / 255, col[1] / 255, col[2] / 255, a], n * 4); wind.s[n] = 7 + 4 * dens; n++; } }
      wind.n = n; upload(wind);
      // CMEs: cone model — a cap at r(t) = 21.5 R☉ + v·(t − t21.5), direction = Earth's longitude at t21.5 + DONKI longitude
      let m = 0; const active = [];
      cmes.forEach((c, ci) => { const va = kmsAU(c.v), r = 0.1 + va * (td - c.t / DAY); if (r < 0.02 || r > 3.4 || m > 12 * 700 - 700) return;
        const E = planet('Earth', c.t), lon = lonOf(E) + c.lon * D2R, la = c.lat * D2R, h = Math.max(5, c.half) * D2R;
        const ax = [Math.cos(la) * Math.cos(lon), Math.sin(la), -Math.cos(la) * Math.sin(lon)], up = Math.abs(ax[1]) > .9 ? [1, 0, 0] : [0, 1, 0];
        let u = [ax[1] * up[2] - ax[2] * up[1], ax[2] * up[0] - ax[0] * up[2], ax[0] * up[1] - ax[1] * up[0]]; const ul = Math.hypot(...u); u = u.map(x => x / ul);
        const w = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]], fade = Math.min(1, (3.4 - r) / .6);
        for (let i = 0; i < 700; i++) { const q = (i + .5) / 700, th = Math.acos(1 - q * (1 - Math.cos(h))), ph = i * 2.39996, rr = r * (0.97 + 0.03 * ((i * 7) % 5) / 5);
          const d = ax.map((x, k2) => x * Math.cos(th) + (u[k2] * Math.cos(ph) + w[k2] * Math.sin(ph)) * Math.sin(th)), edge = th / h;
          cmeB.p.set(d.map(x => x * rr), m * 3); cmeB.c.set([1, .85 + .15 * (1 - edge), .7 + .3 * (1 - edge), (.25 + .5 * edge) * fade], m * 4); cmeB.s[m] = 13; m++; }
        active.push({ c, r, ax }); });
      cmeB.n = m; upload(cmeB); build.active = active;
    }
    function camEye() { const c = cam, cp = Math.cos(c.pitch); return [c.tgt[0] + c.dist * cp * Math.cos(c.yaw), c.tgt[1] + c.dist * Math.sin(c.pitch), c.tgt[2] + c.dist * cp * Math.sin(c.yaw)]; }
    const proj = p => { const x = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], y = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], w = M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15];
      return w <= 0.01 ? null : [(x / w * .5 + .5) * W, (1 - (y / w * .5 + .5)) * H, w]; };
    let hits = [];
    function draw() {
      if (cam.goal) { const g = cam.goal; ['dist', 'yaw', 'pitch'].forEach(k => { if (g[k] != null) cam[k] += (g[k] - cam[k]) * .12; }); if (g.tgt) cam.tgt = cam.tgt.map((v, i) => v + (g.tgt[i] - v) * .12);
        if (Math.abs(cam.dist - (g.dist ?? cam.dist)) < .002 && (!g.tgt || Math.hypot(...cam.tgt.map((v, i) => v - g.tgt[i])) < .002)) cam.goal = null; dirty = true; }
      if (spin[0] || spin[1]) { cam.yaw += spin[0]; cam.pitch = Math.max(-1.5, Math.min(1.55, cam.pitch + spin[1])); spin = spin.map(v => Math.abs(v) < 1e-4 ? 0 : v * .92); dirty = true; }
      const now = mode === 'helix' ? hTime : time;
      if (cam.follow) { cam.tgt = toHx(planet(cam.follow, now)); }
      const eye = camEye(); M = mul(persp(45 * D2R, W / H, 0.005, 4000), lookAt(eye, cam.tgt, [0, 1, 0])); if (mode === 'helix') M = mul(M, hxMat());
      gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0.02, 0.03, 0.06, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniformMatrix4fv(U.m, false, new Float32Array(M)); gl.uniform1f(U.k, dpr * Math.min(W, H) / 900);
      gl.uniform1f(U.mx, 4 * dpr); gl.uniform1f(U.pt, 1); bind(stars); gl.drawArrays(gl.POINTS, 0, stars.n);
      if (mode === 'galaxy') { gl.uniform1f(U.pt, 1); gl.uniform1f(U.mx, 3 * dpr); bind(galB); gl.drawArrays(gl.POINTS, 0, galB.n); gl.uniform1f(U.pt, 0); bind(ring); gl.drawArrays(gl.LINE_STRIP, 0, ring.n); }
      else if (mode === 'helix') { gl.uniform1f(U.pt, 0); bind(trails); for (let i = 0; i <= HX.length; i++) gl.drawArrays(gl.LINE_STRIP, i * HXN, HXN); }
      else { gl.uniform1f(U.pt, 0); bind(orbits); for (let i = 0; i < ORB.length; i++) gl.drawArrays(gl.LINE_STRIP, i * 181, 181);
        gl.uniform1f(U.pt, 1); gl.uniform1f(U.mx, 7 * dpr); bind(wind); gl.drawArrays(gl.POINTS, 0, wind.n); gl.uniform1f(U.mx, 6 * dpr); bind(cmeB); gl.drawArrays(gl.POINTS, 0, cmeB.n); }
      // overlay: Sun, planets, labels, CME tags
      g2.setTransform(dpr, 0, 0, dpr, 0, 0); g2.clearRect(0, 0, W, H); hits = [];
      if (mode === 'galaxy') { g2.font = '700 12px Inter, system-ui, sans-serif'; g2.textBaseline = 'middle';
        const lab = (q, t, col) => { if (!q) return; const w = g2.measureText(t).width; g2.fillStyle = 'rgba(0,0,0,.6)'; g2.fillRect(q[0] + 9, q[1] - 9, w + 10, 18); g2.fillStyle = col; g2.fillText(t, q[0] + 14, q[1]); };
        const sq = proj(sunGal()); if (sq) { g2.fillStyle = '#FFE600'; g2.beginPath(); g2.arc(sq[0], sq[1], 4, 0, 7); g2.fill(); g2.strokeStyle = 'rgba(255,230,0,.6)'; g2.beginPath(); g2.arc(sq[0], sq[1], 9, 0, 7); g2.stroke(); lab(sq, tr('The Sun — we are here'), '#FFE600'); }
        lab(proj([0, 0, 0]), tr('Centre · black hole Sagittarius A*'), '#FFD9A8');
        const a = proj([-12, 0, 13]), b = proj([-12 + 3.066, 0, 13]); if (a && b) { g2.strokeStyle = '#C9D1DB'; g2.lineWidth = 2; g2.beginPath(); g2.moveTo(a[0], a[1]); g2.lineTo(b[0], b[1]); g2.stroke(); g2.fillStyle = '#C9D1DB'; g2.fillText(tr('10,000 light years'), a[0], a[1] + 14); }
        dirty = false; return; }
      const s = proj([0, 0, 0]);
      if (s) { const R = Math.max(5, 0.05 * H / s[2] * 2.4); g2.globalCompositeOperation = 'lighter';
        let gr = g2.createRadialGradient(s[0], s[1], 0, s[0], s[1], R * 4); gr.addColorStop(0, 'rgba(255,200,90,.55)'); gr.addColorStop(.3, 'rgba(255,140,40,.18)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
        g2.fillStyle = gr; g2.beginPath(); g2.arc(s[0], s[1], R * 4, 0, 7); g2.fill(); g2.globalCompositeOperation = 'source-over';
        gr = g2.createRadialGradient(s[0] - R * .2, s[1] - R * .2, 0, s[0], s[1], R); gr.addColorStop(0, '#FFF6D8'); gr.addColorStop(.7, '#FFC24A'); gr.addColorStop(1, '#FF8A1E');
        g2.fillStyle = gr; g2.beginPath(); g2.arc(s[0], s[1], R, 0, 7); g2.fill(); hits.push({ x: s[0], y: s[1], r: R + 6, name: 'Sun' }); }
      g2.font = '600 12px Inter, system-ui, sans-serif'; g2.textBaseline = 'middle'; const boxes = [];
      if (mode === 'helix') { const T = TRAVEL[frameK], a = proj(T.dir.map(x => x * 1.4 * Math.max(1, cam.dist / 8))), o = proj([0, 0, 0]);
        if (a && o) { g2.strokeStyle = '#FFE08A'; g2.lineWidth = 2; g2.beginPath(); g2.moveTo(o[0], o[1]); g2.lineTo(a[0], a[1]); g2.stroke(); const ang = Math.atan2(a[1] - o[1], a[0] - o[0]);
          g2.fillStyle = '#FFE08A'; g2.beginPath(); g2.moveTo(a[0], a[1]); g2.lineTo(a[0] - 10 * Math.cos(ang - .4), a[1] - 10 * Math.sin(ang - .4)); g2.lineTo(a[0] - 10 * Math.cos(ang + .4), a[1] - 10 * Math.sin(ang + .4)); g2.fill();
          g2.font = '700 12px Inter, system-ui, sans-serif'; const lab = (frameK === 'lsr' ? tr('towards Hercules') : tr('towards Cygnus · around the galaxy')) + ' · ' + T.v + ' km/s';
          g2.fillStyle = 'rgba(0,0,0,.6)'; g2.fillRect(a[0] + 8, a[1] - 9, g2.measureText(lab).width + 10, 18); g2.fillStyle = '#FFE08A'; g2.fillText(lab, a[0] + 13, a[1] + 4); } }
      g2.font = '600 12px Inter, system-ui, sans-serif'; g2.textBaseline = 'middle';
      ['Earth'].concat(ORB.filter(n => n !== 'Earth')).forEach(nm => { if (mode === 'helix' && !HX.includes(nm)) return; const p = planet(nm, now), q = proj(p); if (!q) return; const r = Math.max(2.5, EL[nm][3] * Math.min(1.8, 1.6 / Math.sqrt(q[2])));
        g2.fillStyle = EL[nm][2]; g2.beginPath(); g2.arc(q[0], q[1], r, 0, 7); g2.fill();
        if (nm === 'Earth') { g2.strokeStyle = 'rgba(90,169,255,.6)'; g2.lineWidth = 1.5; g2.beginPath(); g2.arc(q[0], q[1], r + 4, 0, 7); g2.stroke(); }
        const lab = tr(nm), tw = g2.measureText(lab).width, bx = [q[0] + r + 4, q[1] - 8, tw + 8, 16];
        hits.push({ x: q[0], y: q[1], r: r + 14, name: nm, w: tw + 12 });
        if (boxes.some(b => bx[0] < b[0] + b[2] && bx[0] + bx[2] > b[0] && bx[1] < b[1] + b[3] && bx[1] + bx[3] > b[1]) && nm !== 'Earth') return; boxes.push(bx);
        g2.fillStyle = 'rgba(0,0,0,.55)'; g2.fillRect(...bx); g2.fillStyle = nm === 'Earth' ? '#9CCBFF' : '#DCE3EB'; g2.fillText(lab, q[0] + r + 8, q[1]); });
      if (mode !== 'helix') (build.active || []).forEach(({ c, r, ax }) => { const q = proj(ax.map(x => x * r)); if (!q) return; const lab = 'CME ' + Math.round(c.v) + ' km/s' + (c.est ? ' · ' + tr('estimate') : '');
        g2.fillStyle = 'rgba(0,0,0,.6)'; const tw = g2.measureText(lab).width; g2.fillRect(q[0] + 6, q[1] - 8, tw + 8, 16); g2.fillStyle = '#FFE2C2'; g2.fillText(lab, q[0] + 10, q[1]); });
      if (info) showInfo(info);
      dirty = false;
    }
    // a planet's numbers: distance to the Sun, speed on its orbit (vis-viva), light time, distance from Earth
    function showInfo(nm) {
      const box = el.querySelector('.s3d-info'), t = mode === 'helix' ? hTime : time, p = planet(nm, t), r = Math.hypot(...p), a = EL[nm][0][0], v = 29.78 * Math.sqrt(2 / r - 1 / a), E = planet('Earth', t), de = Math.hypot(p[0] - E[0], p[1] - E[1], p[2] - E[2]);
      box.hidden = false; box.innerHTML = `<button aria-label="${tr('Close')}">✕</button><b>${tr(nm)}</b>${tr('From the Sun')}: ${r.toFixed(2)} AU · ${Math.round(r * 149.6)} ${tr('million km')}<br>${tr('Speed on its orbit')}: ${v.toFixed(1)} km/s<br>${tr('Sunlight needs')} ${(r * 8.317).toFixed(1)} min`
        + (nm !== 'Earth' ? `<br>${tr('From Earth')}: ${de.toFixed(2)} AU` : (window.Earth3D ? `<br><button class="s3d-goearth" style="float:none;margin:6px 0 0;border:1px solid #39FF9E;color:#39FF9E;border-radius:999px;padding:5px 10px;font:600 12px Inter,system-ui,sans-serif">${tr('Fly down to Earth')} ›</button>` : '')) + `<br><small style="color:#8E9AAB">${tr('The camera follows it — drag to look around.')}</small>`;
      const ge = box.querySelector('.s3d-goearth'); if (ge) ge.onclick = () => setMode('earth');
      box.querySelector('button').onclick = () => { info = null; box.hidden = true; cam.follow = null; view(mode === 'helix' ? 'hx' : mode === 'galaxy' ? 'gx' : 'inner'); };
    }
    function frame(ts) {
      if (mode === 'galaxy' && hPlay) { const dt = Math.min(100, ts - (hLast || ts)); gT += dt / 1000 * hRate * 4 * hDir; hDate(); dirty = true; }   // 1× = 4 million years per second
      if (mode === 'helix' && hPlay) { const dt = Math.min(100, ts - (hLast || ts)); hTime += dt / 1000 * hRate * 0.25 * 365.25 * DAY * hDir; buildHelix(); hDate(); dirty = true; }   // 1× = a quarter year per second
      hLast = ts; if (mode !== 'earth' && visible && (dirty || cam.goal || spin[0] || spin[1])) draw(); requestAnimationFrame(frame); }
    function hDate() { const hd = el.querySelector('.s3d-hdate'); if (hd && document.activeElement !== hd && mode === 'helix') { try { hd.value = new Date(hTime).toISOString().slice(0, 10); } catch (e) {} } if (mode === 'galaxy') { el.querySelector('.s3d-t').textContent = Math.abs(gT) < 1 ? tr('Today') : gT > 0 ? tr('In {n} million years', { n: Math.round(gT) }) : tr('{n} million years ago', { n: Math.round(-gT) }); el.querySelector('.s3d-sub').textContent = tr('one lap around the galaxy ≈ 230 million years · up and down through the disc every ~70'); return; }
      el.querySelector('.s3d-t').textContent = new Date(hTime).toLocaleDateString(window.LOC || 'en-GB', { month: 'long', year: 'numeric' });
      el.querySelector('.s3d-sub').textContent = tr('the Sun moves {d} AU a year', { d: (kmsAU(TRAVEL[frameK].v) * 365.25).toFixed(1) }); }
    function resize() { const r = el.getBoundingClientRect(); W = Math.max(200, r.width); H = Math.max(200, r.height); dpr = Math.min(2, devicePixelRatio || 1);
      [cv, ov].forEach(c => { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }); dirty = true; }
    function setTime(t) { if (!isFinite(t)) return; time = t; if (mode === 'helix') return; el.querySelector('.s3d-t').textContent = new Date(t).toLocaleString(window.LOC || 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: opts.tz ? opts.tz() : undefined });
      const E = planet('Earth', t), q = cmes.filter(c => { const r = 0.1 + kmsAU(c.v) * (t - c.t) / DAY; return r > 0 && r < 3.4; }).length;
      el.querySelector('.s3d-sub').textContent = tr('wind at Earth ≈ {v} km/s', { v: Math.round(vtab[Math.round((((lonOf(E) - OMEGA * t / DAY) / D2R) % 360 + 360) % 360) % 360]) }) + (q ? ' · ' + tr('{n} CME in flight', { n: q }) : '');
      build(); dirty = true; }
    const VIEWS = { hx: null, inner: { dist: 3.4, pitch: .55, tgt: [0, 0, 0] }, all: { dist: 62, pitch: .7, tgt: [0, 0, 0] }, top: { dist: 4.2, pitch: 1.5, tgt: [0, 0, 0] } };
    function view(v) { cam.follow = null; spin = [0, 0];
      if (v === 'gx' || (mode === 'galaxy' && v === 'inner')) { cam.goal = { tgt: [0, 0, 0], dist: 34, pitch: .85, yaw: -0.6 }; dirty = true; return; }
      if (v === 'hx' || (mode === 'helix' && v === 'inner')) {   // frame the inner planets' last ~2 years (lsr) / ~1 year (galaxy), seen from the side
        const T = TRAVEL[frameK], d = T.dir, V = d.map(x => x * kmsAU(T.v)), span = (frameK === 'lsr' ? 2.4 : 1.1) * 365.25, P = [[0, 0, 0]];
        ['Mercury', 'Venus', 'Earth', 'Mars'].forEach(nm => { for (let i = 0; i <= 40; i++) { const dd = -span * i / 40, q = planet(nm, hTime + dd * DAY); P.push([q[0] + V[0] * dd, q[1] + V[1] * dd, q[2] + V[2] * dd]); } });
        const c = [0, 1, 2].map(k => P.reduce((a, q) => a + q[k], 0) / P.length), rad = Math.max(...P.map(q => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2])));
        const tg = toHx(c); tg[0] += rad * .3; cam.goal = { tgt: tg, dist: rad / Math.tan(22.5 * D2R) / Math.max(1, Math.min(1.6, W / H)) * 1.15, pitch: .18, yaw: Math.PI / 2 }; dirty = true; return; }
      if (v === 'earth') { const E = planet('Earth', time); const lon = lonOf(E); cam.goal = { tgt: [0, 0, 0], dist: Math.hypot(E[0], E[2]) * 1.35, pitch: .12, yaw: -lon }; }
      else cam.goal = Object.assign({}, VIEWS[v] || VIEWS.inner); dirty = true; }
    // controls: drag = turn, wheel / pinch = zoom, tap a planet = fly to it
    const pts = new Map(); let d0 = 0, z0 = 0, moved = 0, panBtn = false, lastTap = 0, mid0 = null;
    const pan = (dx, dy) => {   // move the target in the camera's plane
      const k = cam.dist * .0016, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), right = [-sy, 0, cy], upv = [-Math.sin(cam.pitch) * cy, Math.cos(cam.pitch), -Math.sin(cam.pitch) * sy];
      cam.follow = null; cam.tgt = cam.tgt.map((v, i) => v - right[i] * dx * k + upv[i] * dy * k); dirty = true; };
    ov.addEventListener('contextmenu', e => e.preventDefault());
    ov.addEventListener('pointerdown', e => { ov.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; spin = [0, 0]; panBtn = e.button === 2 || e.shiftKey;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); z0 = cam.dist; mid0 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; } });
    ov.addEventListener('pointermove', e => { const p = pts.get(e.pointerId); if (!p) return; const dx = e.clientX - p[0], dy = e.clientY - p[1]; pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) { moved += Math.abs(dx) + Math.abs(dy); cam.goal = null;
        if (panBtn) pan(dx, dy); else { cam.yaw += dx * .006; cam.pitch = Math.max(-1.5, Math.min(1.55, cam.pitch + dy * .006)); spin = [dx * .006, dy * .006]; } dirty = true; }
      else if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        cam.dist = Math.max(.08, Math.min(400, z0 * d0 / Math.max(10, d))); if (mid0) { pan(mid[0] - mid0[0], mid[1] - mid0[1]); mid0 = mid; } moved = 99; cam.goal = null; dirty = true; } });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) mid0 = null; if (pts.size === 0 && moved > 6) { /* keep the spin going */ } else spin = [0, 0];
      if (moved < 6 && e.type === 'pointerup') { const r = ov.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, now = performance.now();
        if (now - lastTap < 320) { lastTap = 0; info = null; el.querySelector('.s3d-info').hidden = true; view(mode === 'helix' ? 'hx' : mode === 'galaxy' ? 'gx' : 'inner'); return; } lastTap = now;
        const h = hits.find(h => Math.hypot(h.x - x, h.y - y) < h.r || (h.w && x > h.x && x < h.x + h.w + 10 && Math.abs(y - h.y) < 10));
        if (h && h.name !== 'Sun') { cam.follow = null; const p = planet(h.name, mode === 'helix' ? hTime : time); cam.goal = { tgt: toHx(p), dist: Math.max(.25, Math.hypot(...p) * .25) }; info = h.name; setTimeout(() => { if (info === h.name) cam.follow = h.name; }, 900); dirty = true; }
        else if (h) { info = null; el.querySelector('.s3d-info').hidden = true; view(mode === 'helix' ? 'hx' : mode === 'galaxy' ? 'gx' : 'inner'); } } };
    ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
    const zoom = f => { cam.dist = Math.max(.08, Math.min(400, cam.dist * f)); cam.goal = null; dirty = true; };
    ov.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(e.deltaY * .0012)); }, { passive: false });
    el.querySelectorAll('[data-z]').forEach(b => b.onclick = () => zoom(+b.dataset.z > 0 ? 1.35 : 1 / 1.35));
    el.querySelector('.s3d-reset').onclick = () => { info = null; el.querySelector('.s3d-info').hidden = true; view(mode === 'helix' ? 'hx' : mode === 'galaxy' ? 'gx' : 'inner'); };
    el.querySelector('.s3d-q').onclick = () => { const h = el.querySelector('.s3d-help'); h.hidden = !h.hidden; };
    el.querySelector('.s3d-hx-x').onclick = () => { el.querySelector('.s3d-help').hidden = true; };
    el.tabIndex = 0;
    el.addEventListener('keydown', e => { const k = e.key; if (/^Arrow/.test(k)) { e.preventDefault(); if (k === 'ArrowLeft') cam.yaw -= .08; if (k === 'ArrowRight') cam.yaw += .08; if (k === 'ArrowUp') cam.pitch = Math.min(1.55, cam.pitch + .06); if (k === 'ArrowDown') cam.pitch = Math.max(-1.5, cam.pitch - .06); cam.goal = null; dirty = true; }
      else if (k === '+' || k === '=') zoom(1 / 1.2); else if (k === '-') zoom(1.2); else if (k === 'r' || k === 'R') view(mode === 'helix' ? 'hx' : mode === 'galaxy' ? 'gx' : 'inner');
      else if (k === ' ' && mode === 'helix') { e.preventDefault(); togglePlay(); } else if (k === 'Escape' && el.classList.contains('s3d-fs')) el.querySelector('.s3d-full').click(); });
    // modes
    const togglePlay = () => { hPlay = !hPlay; const b = el.querySelector('.s3d-hplay'); b.textContent = hPlay ? '⏸' : '▶'; b.setAttribute('aria-label', hPlay ? tr('Pause') : tr('Play')); hLast = 0; };
    el.querySelector('.s3d-hplay').onclick = () => { if (hDir < 0) { hDir = 1; el.querySelector('.s3d-hrev').setAttribute('aria-pressed', false); if (hPlay) return; } togglePlay(); };
    el.querySelector('.s3d-hrev').onclick = () => { hDir = hDir > 0 ? -1 : 1; el.querySelector('.s3d-hrev').setAttribute('aria-pressed', hDir < 0); if (!hPlay) togglePlay(); };
    el.querySelector('.s3d-hdate').onchange = e => { const t = Date.parse(e.target.value + 'T12:00:00Z'); if (isFinite(t)) { hTime = t; buildHelix(); hDate(); dirty = true; } };
    el.querySelector('.s3d-hspd').onclick = e => { hRate = hRate === 1 ? 4 : hRate === 4 ? 16 : 1; e.target.textContent = hRate + '×'; };
    el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { frameK = b.dataset.f; el.querySelectorAll('[data-f]').forEach(o => o.setAttribute('aria-pressed', o === b)); buildHelix(); hDate(); view('hx'); });
    let earth = null;
    function setMode(m) {
      if (m === 'earth') { if (!window.Earth3D) return; if (!earth) earth = Earth3D.create(el, { places: opts.places ? opts.places() : [], time: () => time, aurora: opts.aurora, onBack: () => setMode('sys') });
        if (hPlay) togglePlay(); mode = 'earth'; el.classList.add('ea'); el.classList.remove('hx'); el.querySelectorAll('[data-m]').forEach(o => o.setAttribute('aria-pressed', o.dataset.m === m)); info = null;
        const pl = opts.places ? opts.places()[0] : null; if (opts.places) earth.setPlaces(opts.places()); earth.show(pl ? pl.lat : 45.6, pl ? pl.lon : 25.6); return; }
      if (earth) earth.hide(); el.classList.remove('ea');
      mode = m; el.classList.toggle('hx', m === 'helix'); el.classList.toggle('gx', m === 'galaxy');
      if (m === 'galaxy') { el.querySelectorAll('[data-m]').forEach(o => o.setAttribute('aria-pressed', o.dataset.m === m)); info = null; el.querySelector('.s3d-info').hidden = true; buildGalaxy(); hDate(); view('gx'); if (!hPlay) togglePlay(); dirty = true; return; } el.querySelectorAll('[data-m]').forEach(o => o.setAttribute('aria-pressed', o.dataset.m === m)); info = null; el.querySelector('.s3d-info').hidden = true;
      if (m === 'helix') { hTime = time; buildHelix(); hDate(); view('hx'); if (!hPlay) togglePlay(); } else { if (hPlay) togglePlay(); build.orbT = null; setTime(time); view('inner'); } dirty = true; }
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => setMode(b.dataset.m));
    el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => view(b.dataset.v));
    el.querySelector('.s3d-full').onclick = () => { el.classList.toggle('s3d-fs'); document.body.classList.toggle('s3d-lock', el.classList.contains('s3d-fs')); setTimeout(resize, 60); };
    if (window.ResizeObserver) new ResizeObserver(resize).observe(el); else addEventListener('resize', resize);
    if (window.IntersectionObserver) new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) dirty = true; }).observe(el);
    resize(); setWind(opts.wind); setCmes(opts.cmes); setTime(opts.time || Date.now()); requestAnimationFrame(frame);
    return { setTime, setWind: s => { setWind(s); setTime(time); }, setCmes: c => { setCmes(c); setTime(time); }, view, resize, canvas: () => { draw(); const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; const g = c.getContext('2d'); g.drawImage(cv, 0, 0); g.drawImage(ov, 0, 0); return c; } };
  }
  window.Space3D = { create, planet };
})();
