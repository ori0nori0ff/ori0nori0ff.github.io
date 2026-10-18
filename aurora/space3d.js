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
  // wind: q = (distance AU, speed 0–1, seed) → brightness pulses running outwards (faster wind = faster pulses) + small wobble
  const WVS = 'attribute vec3 p;attribute vec4 c;attribute float s;attribute vec3 q;uniform mat4 m;uniform float k;uniform float mx;uniform float ph;varying vec4 vc;void main(){float pu=.6+.4*sin(6.2832*(q.x*2.6-ph*(.3+.9*q.y)+q.z*.15));vec3 j=vec3(sin(q.z*12.9+ph*1.3),sin(q.z*78.2+ph*.9),cos(q.z*37.7+ph*1.1))*.006*q.x;gl_Position=m*vec4(p+j,1.);gl_PointSize=clamp(s*k/gl_Position.w,1.,mx);vc=vec4(c.rgb,c.a*pu);}';
  const FS = 'precision mediump float;varying vec4 vc;uniform float pt;void main(){float a=vc.a;if(pt>.5){float d=length(gl_PointCoord-.5);a*=smoothstep(.5,.0,d);}gl_FragColor=vec4(vc.rgb*a,a);}';

  const CSS = `.s3d{position:relative;overflow:hidden;background:#05070D;border-radius:16px;touch-action:none;user-select:none;-webkit-user-select:none}
.s3d canvas{position:absolute;left:0;top:0;display:block}.s3d-ov{cursor:grab}.s3d-ov:active{cursor:grabbing}
.s3d-top{position:absolute;left:12px;top:10px;pointer-events:none;display:flex;flex-direction:column;gap:2px;text-shadow:0 1px 3px #000;max-width:calc(50% - 200px)}
.s3d-t{font:700 15px Inter,system-ui,sans-serif;color:#FFE600}.s3d-sub{font:500 12px Inter,system-ui,sans-serif;color:#C9D1DB}
.s3d-btns{position:absolute;left:10px;bottom:10px;display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;max-width:calc(100% - 20px)}.s3d-btns::-webkit-scrollbar{display:none}.s3d-btns button{flex:none;white-space:nowrap}
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
.s3d-time{position:absolute;left:10px;bottom:54px;display:flex;gap:6px;align-items:center;flex-wrap:nowrap;max-width:calc(100% - 20px)}
.s3d-time button{flex:none;border:1px solid rgba(255,255,255,.18);background:rgba(10,14,20,.75);color:#E6EBF1;border-radius:999px;min-width:36px;min-height:36px;padding:0 10px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}
.s3d-time button[aria-pressed=true]{border-color:#39FF9E;color:#39FF9E}.s3d-rate{width:150px;accent-color:#39FF9E;flex:0 1 150px;min-width:70px}
.s3d-rl{font:700 11px Inter,system-ui,sans-serif;color:#E6EBF1;background:rgba(10,14,20,.75);border-radius:999px;padding:7px 10px;white-space:nowrap;min-width:96px;text-align:center}
.s3d.ea .s3d-time{display:none!important}@media (max-width:640px){.s3d-rate{width:96px;flex-basis:96px}.s3d-rl{min-width:80px}}
.s3d-hdate{background:rgba(10,14,20,.75);color:#E6EBF1;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:6px 10px;min-height:36px;font:600 12px Inter,system-ui,sans-serif;color-scheme:dark}
.s3d.gx .s3d-hx,.s3d.gx .s3d-sys,.s3d.gx .s3d-leg{display:none!important}.s3d .s3d-imp{display:none}.s3d.mag .s3d-imp{display:inline-block}
.s3d:focus-visible{outline:3px solid #FFE600;outline-offset:2px}
@media (max-width:900px){.s3d-top{max-width:calc(100% - 70px)}}@media (min-width:641px) and (max-width:900px){.s3d-top{top:54px}}@media (max-width:640px){.s3d-tabs{top:auto;bottom:98px;left:10px;transform:none}.s3d-tabs button{padding:7px 10px;font-size:11px}.s3d-info{right:56px;max-width:190px}}
.s3d-leg{position:absolute;right:12px;bottom:14px;font:500 11px Inter,system-ui,sans-serif;color:#A3B0C2;pointer-events:none;text-shadow:0 1px 2px #000}
.s3d-leg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin:0 3px 0 8px;vertical-align:-1px}
.s3d.s3d-fs{position:fixed!important;inset:0;z-index:200;border-radius:0;height:auto!important;max-height:none!important;min-height:0!important;margin:0!important;aspect-ratio:auto!important}body.s3d-lock{overflow:hidden}
@media (max-width:560px){.s3d-leg{display:none}}`;
  function create(el, opts) {
    opts = opts || {};
    if (!document.getElementById('s3d-css')) { const st = document.createElement('style'); st.id = 's3d-css'; st.textContent = CSS; document.head.appendChild(st); }
    el.classList.add('s3d');
    el.innerHTML = `<canvas class="s3d-gl"></canvas><canvas class="s3d-ov"></canvas>
      <div class="s3d-top"><b class="s3d-t">–</b><span class="s3d-sub"></span></div>
      <div class="s3d-tabs" role="tablist"><button data-m="sys" aria-pressed="true">${tr('Solar system')}</button><button data-m="helix" aria-pressed="false">${tr('Spiral through space')}</button><button data-m="galaxy" aria-pressed="false">${tr('Galaxy')}</button><button data-m="earth" aria-pressed="false">${tr('Earth')}</button></div>
      <div class="s3d-btns s3d-sys"><button data-v="inner">${tr('Inner planets')}</button><button data-v="all">${tr('Whole system')}</button><button data-v="earth">${tr('From Earth')}</button><button data-v="top">${tr('From above')}</button><button class="s3d-sunf" aria-label="${tr('Sun filter')}">☀ ${tr('visible light')}</button><button class="s3d-cmex" aria-pressed="false">${tr('Example: strong CME')}</button><button class="s3d-mag" aria-pressed="false">🧲 ${tr('Earth’s magnetic shield')}</button><button class="s3d-imp">💥 ${tr('CME impact')}</button></div>
      <div class="s3d-time"><button class="s3d-hrev" aria-label="${tr('Play backwards')}" aria-pressed="false">◀</button><button class="s3d-hplay" aria-label="${tr('Pause')}">⏸</button><input type="range" class="s3d-rate" min="0" max="1000" aria-label="${tr('Speed')}"><span class="s3d-rl" aria-live="polite"></span><button class="s3d-now">${tr('Now')}</button></div>
      <div class="s3d-btns s3d-hx"><input type="date" class="s3d-hdate" aria-label="${tr('Date')}"><button data-f="lsr" aria-pressed="true">${tr('vs nearby stars · 20 km/s')}</button><button data-f="gal" aria-pressed="false">${tr('around the Milky Way · 230 km/s')}</button></div>
      <div class="s3d-ctl"><button class="s3d-full" aria-label="${tr('Full screen')}">⛶</button><button data-z="-1" aria-label="${tr('Zoom in')}">+</button><button data-z="1" aria-label="${tr('Zoom out')}">−</button><button class="s3d-reset" aria-label="${tr('Reset the view')}">⟲</button><button class="s3d-q" aria-label="${tr('How it works')}">?</button></div>
      <div class="s3d-info" hidden></div>
      <div class="s3d-help" hidden><button class="s3d-hx-x" aria-label="${tr('Close')}">✕</button>
        <b>${tr('Moving around')}</b><p>${tr('Drag to turn · pinch or scroll to zoom · two fingers or right-drag to move sideways · double-tap to reset · tap a planet to fly to it and see its numbers. Zoom out from Earth to reach the solar system, keep going for the galaxy; tap Earth and zoom in to land. Keys: arrows turn, + / − zoom, R reset, space play.')}</p>
        <b>${tr('Time')}</b><p>${tr('Everything starts in real time, like the sky outside. The slider changes the speed: left of the middle is slow motion, right speeds time up (minutes, days, years or millions of years per second, depending on the view). ◀ runs time backwards, NOW returns to this moment at real speed.')}</p>
        <b>${tr('Solar system')}</b><p>${tr('Planets at their real positions for the shown time (NASA JPL orbital elements). The solar wind leaves the Sun in all directions while the Sun turns once every ~25 days, so the streams wind up into a spiral (the Parker spiral) — like water from a turning garden sprinkler. Speed and colour come from NOAA’s model at Earth. CMEs grow from the Sun at their measured speed and direction (NASA DONKI, or estimated from NOAA’s model). Distances are real, sizes are not.')}</p>
        <b>${tr('Earth’s magnetic shield')}</b><p>${tr('Earth’s magnetic field turns most of the solar wind aside: it piles up in a bow shock in front, flows around the magnetopause and stretches the field into a long tail at night. A CME squeezes the field from ~10 to ~6 Earth radii; far more particles get in, run down the field lines to the polar regions and light up the aurora ovals, which grow towards the equator. Drawn to show how it works — Earth and its field are enlarged.')}</p>
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
    const pw = gl.createProgram(); gl.attachShader(pw, sh(gl.VERTEX_SHADER, WVS)); gl.attachShader(pw, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pw);
    const AW = { p: gl.getAttribLocation(pw, 'p'), c: gl.getAttribLocation(pw, 'c'), s: gl.getAttribLocation(pw, 's'), q: gl.getAttribLocation(pw, 'q') }, UW = { m: gl.getUniformLocation(pw, 'm'), k: gl.getUniformLocation(pw, 'k'), pt: gl.getUniformLocation(pw, 'pt'), mx: gl.getUniformLocation(pw, 'mx'), ph: gl.getUniformLocation(pw, 'ph') };
    const mkW = n => Object.assign(mk(n), { q: new Float32Array(n * 3), bq: gl.createBuffer() });
    const windQ = new Float32Array(JS * KS * 3), wbq = gl.createBuffer(), streak = mkW(JS * KS * 2);
    const wUp = (b, q) => { [['bp', 'p', 3, AW.p], ['bc', 'c', 4, AW.c], ['bs', 's', 1, AW.s]].forEach(([bk, k, sz, loc]) => { gl.bindBuffer(gl.ARRAY_BUFFER, b[bk]); gl.bufferData(gl.ARRAY_BUFFER, b[k].subarray(0, b.n * sz), gl.DYNAMIC_DRAW); });
      gl.bindBuffer(gl.ARRAY_BUFFER, q.buf); gl.bufferData(gl.ARRAY_BUFFER, q.arr.subarray(0, b.n * 3), gl.DYNAMIC_DRAW); };
    const wBind = (b, qb) => { [['bp', 3, AW.p], ['bc', 4, AW.c], ['bs', 1, AW.s]].forEach(([bk, sz, loc]) => { gl.bindBuffer(gl.ARRAY_BUFFER, b[bk]); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, sz, gl.FLOAT, false, 0, 0); });
      gl.bindBuffer(gl.ARRAY_BUFFER, qb); gl.enableVertexAttribArray(AW.q); gl.vertexAttribPointer(AW.q, 3, gl.FLOAT, false, 0, 0); };
    for (let i = 0; i < JS * KS; i++) lat[i] = (rnd() - .5) * (rnd() < .2 ? 0.3 : 0.08);
    const CP = 1600, cmeB = mk(13 * CP);
    const HX = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'], HXN = 900, trails = mk((HX.length + 1) * HXN);
    const galB = mk(52000), ring = mk(361); let gT = 0, galBuilt = false;
    let mode = 'sys', frameK = 'lsr', hTime = Date.now(), hPlay = true, rate = 1, hDir = 1, hLast = 0, info = null, ph = 0, watch = 0, bAt = 0, tAt = 0, hbAt = 0;
    const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches, YEAR = 3.15576e7;
    // speed slider: log scale, simulated seconds per real second, from 0.1 (slow motion) to each view's maximum
    const RANGE = { sys: [-1, Math.log10(30 * 86400)], helix: [-1, Math.log10(5 * YEAR)], galaxy: [-1, Math.log10(20e6 * YEAR)] };
    const rng = () => RANGE[mode] || RANGE.sys, posOf = r => Math.round((Math.log10(r) - rng()[0]) / (rng()[1] - rng()[0]) * 1000);
    const SUNB = 'https://raw.githubusercontent.com/ori0nori0ff/ori0nori0ff.github.io/enlil/sun/';
    // [file id, label, disc radius as a share of the image width] — HMI fills more of its frame than AIA
    const SUNF = [['HMIIC', 'visible light', .468], ['0171', '171 Å · corona', .393], ['0193', '193 Å · hot corona', .393], ['0304', '304 Å · chromosphere', .393]];
    let sunI = 0, cmeEx = false, exT = 0; const sunImg = {};
    function sunTex() { const f = SUNF[sunI]; let im = sunImg[f[0]];
      if (!im) { im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { dirty = true; }; im.src = SUNB + f[0] + '.jpg?h=' + Math.floor(Date.now() / 3600e3); sunImg[f[0]] = im; }
      return im.complete && im.naturalWidth ? im : null; }
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
      const tq = Math.floor(td / DT) * DT; let n = 0, ns = 0;
      for (let j = 0; j < JS; j++) { const psi = j / JS * 2 * Math.PI, b = Math.round(j / JS * 360) % 360, v = vtab[b], va = kmsAU(v), col = speedCol(v), dens = Math.min(1.6, Math.max(.6, Math.sqrt(ntab[b] / 5))), kn = known[b] ? 1 : .55;
        // fast wind leaving a little later from the same direction catches up with slower wind ahead → a compressed, brighter band
        const cmp = Math.max(0, Math.min(1, (v - vtab[(b + 8) % 360] - 40) / 220)), vq = Math.max(0, Math.min(1, (v - 300) / 600)), sl = .02 + .05 * vq;
        for (let k = 0; k < KS; k++) { const te = tq - k * DT, r = 0.03 + va * (td - te); if (r > 3.2 || r < 0.03) continue;
          const lon = psi + OMEGA * te, la = lat[j * KS + k], fade = Math.min(1, (3.2 - r) / 0.8) * Math.min(1, r / 0.12);
          const a = 0.7 * fade * kn * dens * (0.8 + 0.2 * Math.cos(k * 1.7 + j));
          wind.p.set([r * Math.cos(lon) * Math.cos(la), r * Math.sin(la), -r * Math.sin(lon) * Math.cos(la)], n * 3);
          const cr = r > .25 ? cmp * Math.min(1, (r - .25) / .3) : 0, cc = col.map(x => (x + (255 - x) * cr * .55) / 255), aa = Math.min(1, a * (1 + cr * .8));
          wind.c.set([cc[0], cc[1], cc[2], aa], n * 4); wind.s[n] = 7 + 4 * dens + 4 * cr; windQ.set([r, vq, (j * 131 + k * 17) % 97], n * 3);
          // streak: a short tail pointing back to the Sun (the wind flies straight out), fading to nothing
          const hx = wind.p[n * 3], hy = wind.p[n * 3 + 1], hz = wind.p[n * 3 + 2], tl = Math.max(.6, r - sl) / r;
          streak.p.set([hx, hy, hz, hx * tl, hy * tl, hz * tl], ns * 3); streak.c.set([cc[0], cc[1], cc[2], aa * .55, cc[0], cc[1], cc[2], 0], ns * 4); streak.s[ns] = streak.s[ns + 1] = 1;
          streak.q.set([r, vq, (j * 131 + k * 17) % 97, r, vq, (j * 131 + k * 17) % 97], ns * 3); ns += 2; n++; } }
      wind.n = n; streak.n = ns; gl.useProgram(pw); wUp(wind, { buf: wbq, arr: windQ }); wUp(streak, { buf: streak.bq, arr: streak.q }); gl.useProgram(pr);
      // CMEs: cone model — a cap at r(t) = 21.5 R☉ + v·(t − t21.5), direction = Earth's longitude at t21.5 + DONKI longitude
      let m = 0; const active = [];
      const list = cmeEx ? cmes.concat([{ t: exT, lat: 4, lon: 0, half: 48, v: 1800, ex: true }]) : cmes;
      list.forEach((c, ci) => { const va = kmsAU(c.v), r = 0.1 + va * (td - c.t / DAY); if (r < 0.02 || r > 3.4 || m > 13 * CP - CP) return;
        const E = planet('Earth', c.t), lon = lonOf(E) + c.lon * D2R, la = c.lat * D2R, h = Math.max(5, c.half) * D2R;
        const ax = [Math.cos(la) * Math.cos(lon), Math.sin(la), -Math.cos(la) * Math.sin(lon)], up = Math.abs(ax[1]) > .9 ? [1, 0, 0] : [0, 1, 0];
        let u = [ax[1] * up[2] - ax[2] * up[1], ax[2] * up[0] - ax[0] * up[2], ax[0] * up[1] - ax[1] * up[0]]; const ul = Math.hypot(...u); u = u.map(x => x / ul);
        const w = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]], fade = Math.min(1, (3.4 - r) / .6);
        for (let i = 0; i < CP; i++) { const shell = i < 1100, q = shell ? (i + .5) / 1100 : rnd(), th = Math.acos(1 - q * (1 - Math.cos(h))), ph = shell ? i * 2.39996 : rnd() * 6.283, edge = th / h;
          // front: slightly bent back at the flanks (a flux rope seen from outside); sheath: particles trailing behind it
          const front = r * (1 - .1 * edge * edge + .04 * Math.cos(2 * ph) * edge), rr = shell ? front * (0.985 + 0.03 * rnd()) : front * (0.62 + 0.33 * Math.pow(rnd(), .6));
          const d = ax.map((x, k2) => x * Math.cos(th) + (u[k2] * Math.cos(ph) + w[k2] * Math.sin(ph)) * Math.sin(th));
          cmeB.p.set(d.map(x => x * rr), m * 3);
          if (shell) cmeB.c.set([1, .82 + .18 * (1 - edge), .62 + .38 * (1 - edge), Math.min(1, .55 + .6 * edge) * fade], m * 4);
          else cmeB.c.set([1, .6 + .25 * rr / front, .4 + .3 * rr / front, .3 * fade * rr / front], m * 4);
          cmeB.s[m] = shell ? 16 : 20; m++; }
        active.push({ c, r, ax }); });
      cmeB.n = m; upload(cmeB); build.active = active;
    }

    // ── Earth's magnetic shield (a schematic, Earth and its field enlarged ~70×): bow shock, magnetopause squeezed by CMEs
    //    (Shue-like shape, stand-off 10 → ~6 Earth radii), dipole field lines r = L·cos²λ pushed in on the day side and
    //    stretched into a tail at night, solar-wind particles flowing around it, a few guided down the field to the aurora ovals
    let magOn = false, magF = 0, glow = 0, magPh = 0, magSub = ''; const MS = 0.003;   // AU per Earth radius in the schematic
    const pxAU = q => H / 2 / Math.tan(22.5 * D2R) / q[2];
    const MP = []; for (let i = 0; i < 380; i++) MP.push({ x: -32 + 58 * rnd(), r0: Math.sqrt(rnd()) * 16, a0: rnd() * 6.283, cap: 0 });
    function cmeAtEarth() {   // f: how hard a CME is pressing on Earth now (0–1); eta: hours until the next one arrives
      const E = planet('Earth', time), rE = Math.hypot(...E), ue = E.map(x => x / rE); let f = 0, eta = null;
      (build.active || []).forEach(({ c, r, ax }) => { if (ax[0] * ue[0] + ax[1] * ue[1] + ax[2] * ue[2] < Math.cos(Math.max(5, c.half) * D2R)) return;
        const d = r - rE; if (d < 0) { const h = -d / kmsAU(c.v) * 24; if (eta == null || h < eta) eta = h; }
        else if (rE > r * .62) f = Math.max(f, Math.min(1, d / .02) * Math.min(1, (rE - r * .62) / (r * .1))); });
      return { f, eta };
    }
    const fieldX = (L, ca, R0) => ca > 0 ? 1 - ca * (1 - Math.min(1, R0 * .92 / L)) : 1 + (-ca) * Math.max(0, L - 3.5) * (.35 + .4 * magF);   // day squeeze / night stretch
    function magneto(E) {
      const st = cmeAtEarth(), dph = Math.min(.1, Math.max(0, ph - magPh)); magPh = ph; magF += (st.f - magF) * .05; glow *= .985;
      const R0 = 10 - 3.8 * magF, Rbs = R0 * 1.33, rE = Math.hypot(...E), ex = E.map(v => -v / rE), ey = [0, 1, 0];
      const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
      const P = (x, y, z) => proj([0, 1, 2].map(i => E[i] + (ex[i] * x + ey[i] * y + ez[i] * z) * MS)), qe = proj(E); if (!qe) return;
      const re = Math.max(3, MS * pxAU(qe)), hidden = q => Math.hypot(q[0] - qe[0], q[1] - qe[1]) < re && q[2] > qe[2];   // behind the globe
      const line = (pts, col, w, dash) => { g2.strokeStyle = col; g2.lineWidth = w; g2.setLineDash(dash || []); g2.beginPath(); let on = false;
        pts.forEach(pt => { const q = P(pt[0], pt[1], pt[2]); if (!q || hidden(q)) { on = false; return; } if (on) g2.lineTo(q[0], q[1]); else { g2.moveTo(q[0], q[1]); on = true; } }); g2.stroke(); g2.setLineDash([]); };
      const T = []; for (let th = 0; th < 2.7; th += .06) { const r = R0 * Math.pow(2 / (1 + Math.cos(th)), .58); T.push([r * Math.cos(th), r * Math.sin(th)]); }
      const rho = x => { if (x >= T[0][0]) return 0; for (let i = 1; i < T.length; i++) if (T[i][0] <= x) { const f = (T[i - 1][0] - x) / (T[i - 1][0] - T[i][0]); return T[i - 1][1] + (T[i][1] - T[i - 1][1]) * f; } return T[T.length - 1][1]; };
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a), bs = [];
        for (let th = 0; th <= 2.0; th += .08) { const r = Rbs * Math.pow(2 / (1 + Math.cos(th)), .75); bs.push([r * Math.cos(th), r * Math.sin(th) * sa, r * Math.sin(th) * ca]); }
        line(bs, 'rgba(255,255,255,.16)', 1, [4, 4]); line(T.map(([x, r]) => [x, r * sa, r * ca]), `rgba(110,200,255,${.12 + .18 * magF})`, 1); }
      const shake = magF * .1 * Math.sin(ph * 9);
      for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, ca = Math.cos(a), sa = Math.sin(a);
        [2.5, 4, 6, 8.5].forEach(L => { const lf = Math.acos(Math.sqrt(1 / L)), sx = fieldX(L, ca, R0), pts = [];
          for (let i = 0; i <= 40; i++) { const la = -lf + 2 * lf * i / 40, r = L * Math.cos(la) ** 2 * (1 + shake * L / 8); pts.push([r * Math.cos(la) * ca * sx, r * Math.sin(la), r * Math.cos(la) * sa]); }
          line(pts, `rgba(108,182,255,${L > 7 ? .22 : .32})`, 1); }); }
      for (let k = -2; k <= 2; k++) [1, -1].forEach(hs => { const a = [.3, hs * .95, k * .15], b = [.6, hs * 5.5, k * .8], c = [-32, hs * (6 - 1.6 * magF), k * 3], pts = [];   // open field: polar cap → tail
        for (let i = 0; i <= 24; i++) { const u = i / 24, w = [(1 - u) ** 2, 2 * u * (1 - u), u * u]; pts.push([0, 1, 2].map(j => w[0] * a[j] + w[1] * b[j] + w[2] * c[j])); } line(pts, 'rgba(108,182,255,.16)', 1); });
      // particles: the wind (or CME) flows around the magnetopause; a few leak in at the cusps / from the tail and run down to the ovals
      const cme = magF > .25 || (st.eta != null && st.eta < 3), spd = 6 + 10 * magF;
      MP.forEach(m => {
        if (m.cap) { m.s = Math.min(1, m.s + dph * .8); const la = m.hs * Math.acos(Math.sqrt(1 / m.L)) * m.s, r = m.L * Math.cos(la) ** 2, ca = Math.cos(m.a), sx = fieldX(m.L, ca, R0);
          m.p = [r * Math.cos(la) * ca * sx, r * Math.sin(la), r * Math.cos(la) * Math.sin(m.a)]; if (m.s >= 1) { glow = Math.min(.45, glow + .015); m.cap = 0; m.x = 26; } }
        else { m.x -= dph * spd; if (m.x < -32) { m.x = 26; m.r0 = Math.sqrt(rnd()) * 16; m.a0 = rnd() * 6.283; }
          const rr = Math.sqrt(m.r0 * m.r0 + (rho(m.x) * 1.12) ** 2); m.p = [m.x, rr * Math.sin(m.a0), rr * Math.cos(m.a0)];
          const day = m.x < R0 + 1 && m.x > R0 - 1.5 && m.r0 < 3, tail = m.x < -12 && m.r0 < 4;
          if ((day || tail) && rnd() < (.01 + .14 * magF) * dph * 60) { m.cap = 1; m.s = 0; m.hs = rnd() < .5 ? 1 : -1;
            if (day) { m.L = 9; m.a = (rnd() - .5) * .8; } else { const kk = .35 + .4 * magF, B = 1 - 3.5 * kk; m.L = Math.max(4, Math.min(12, (-B + Math.sqrt(B * B + 4 * kk * -m.x)) / (2 * kk))); m.a = Math.PI + (rnd() - .5) * .8; } } }
        const q = P(m.p[0], m.p[1], m.p[2]); if (!q || hidden(q)) return; const z = m.cap ? 2.6 : 1.8;
        g2.fillStyle = m.cap ? '#7CFFB8' : cme ? 'rgba(255,214,170,.9)' : 'rgba(150,200,255,.75)'; g2.fillRect(q[0] - z / 2, q[1] - z / 2, z, z); });
      // aurora ovals: ~67° magnetic latitude, a little lower on the night side, pushed towards the equator and brighter in storms
      const lo = (67 - 8 * magF) * D2R, inten = Math.min(1, .18 + .7 * magF + glow);
      [1, -1].forEach(hs => { const pts = []; for (let i = 0; i <= 72; i++) { const a = i / 72 * 2 * Math.PI, l = lo + 3 * D2R * Math.cos(a); pts.push([Math.cos(l) * Math.cos(a) * 1.02, hs * Math.sin(l) * 1.02, Math.cos(l) * Math.sin(a) * 1.02]); }
        g2.shadowColor = '#39FF9E'; g2.shadowBlur = 10 * inten; line(pts, `rgba(57,255,158,${.3 + .65 * inten})`, 1.5 + 3 * inten); g2.shadowBlur = 0;
        if (magF > .5) line(pts.map(pt => pt.map(v => v * 1.05)), `rgba(255,80,100,${Math.min(.8, (magF - .5) * 1.4)})`, 1.5); });
      g2.font = '700 11px Inter, system-ui, sans-serif'; g2.textBaseline = 'middle';
      const tag = (pt, t, c) => { const q = P(pt[0], pt[1], pt[2]); if (!q) return; const w = g2.measureText(t).width; g2.fillStyle = 'rgba(0,0,0,.62)'; g2.fillRect(q[0] + 6, q[1] - 9, w + 10, 18); g2.fillStyle = c; g2.fillText(t, q[0] + 11, q[1]); };
      tag([Rbs, -1.5, 0], tr('Bow shock'), '#E6EBF1'); tag([R0 * .15, R0 * 1.3, 0], tr('Magnetopause · {r} Earth radii', { r: R0.toFixed(1) }), '#8FD3FF');
      tag([-24, 6.5, 0], tr('Magnetic tail'), '#8FD3FF'); tag([.2, 1.4, 0], tr('Aurora oval'), '#7CFFB8'); tag([-6, -11, 0], tr('Earth and its field enlarged, not to scale'), '#8E9AAB'); tag([22, -8, 0], (cme ? 'CME' : tr('solar wind')) + ' ← ' + tr('from the Sun'), cme ? '#FFD6AA' : '#96C8FF');
      const sub = (magF > .3 ? tr('CME hit: the field is squeezed to {r} Earth radii and particles pour in at the poles → strong aurora', { r: R0.toFixed(1) })
        : st.eta != null && st.eta < 96 ? tr('CME arrives in ~{h} h — press CME impact or speed up time', { h: Math.max(1, Math.round(st.eta)) })
        : tr('Calm: the magnetic field turns the solar wind aside; a little leaks in → faint aurora near the poles'));
      if (sub !== magSub) { magSub = sub; el.querySelector('.s3d-sub').textContent = sub; }
    }
    function magOff() { if (!magOn) return; magOn = false; magSub = ''; el.classList.remove('mag'); el.querySelector('.s3d-mag').setAttribute('aria-pressed', false); title(); }
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
        gl.useProgram(pw); gl.uniformMatrix4fv(UW.m, false, new Float32Array(M)); gl.uniform1f(UW.k, dpr * Math.min(W, H) / 900); gl.uniform1f(UW.ph, ph);
        gl.uniform1f(UW.pt, 0); gl.uniform1f(UW.mx, 1); wBind(streak, streak.bq); gl.drawArrays(gl.LINES, 0, streak.n);
        gl.uniform1f(UW.pt, 1); gl.uniform1f(UW.mx, 7 * dpr); wBind(wind, wbq); gl.drawArrays(gl.POINTS, 0, wind.n); gl.disableVertexAttribArray(AW.q); gl.useProgram(pr);
        gl.uniform1f(U.pt, 1); gl.uniform1f(U.mx, 6 * dpr); bind(cmeB); gl.drawArrays(gl.POINTS, 0, cmeB.n); }
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
        const im = R > 7 ? sunTex() : null, sf = SUNF[sunI];
        if (im) { const sz = R / sf[2], aia = sunI > 0; g2.save(); g2.beginPath(); g2.arc(s[0], s[1], aia ? R * 1.14 : R, 0, 7); g2.clip();
          if (aia) g2.globalCompositeOperation = 'lighter';   // AIA: black sky adds nothing, the corona glows around the disc
          g2.drawImage(im, s[0] - sz / 2, s[1] - sz / 2, sz, sz); g2.restore(); g2.globalCompositeOperation = 'source-over'; }
        else { gr = g2.createRadialGradient(s[0] - R * .2, s[1] - R * .2, 0, s[0], s[1], R); gr.addColorStop(0, '#FFF6D8'); gr.addColorStop(.7, '#FFC24A'); gr.addColorStop(1, '#FF8A1E');
          g2.fillStyle = gr; g2.beginPath(); g2.arc(s[0], s[1], R, 0, 7); g2.fill(); }
        hits.push({ x: s[0], y: s[1], r: R + 6, name: 'Sun' }); }
      g2.font = '600 12px Inter, system-ui, sans-serif'; g2.textBaseline = 'middle'; const boxes = [];
      if (mode === 'helix') { const T = TRAVEL[frameK], a = proj(T.dir.map(x => x * 1.4 * Math.max(1, cam.dist / 8))), o = proj([0, 0, 0]);
        if (a && o) { g2.strokeStyle = '#FFE08A'; g2.lineWidth = 2; g2.beginPath(); g2.moveTo(o[0], o[1]); g2.lineTo(a[0], a[1]); g2.stroke(); const ang = Math.atan2(a[1] - o[1], a[0] - o[0]);
          g2.fillStyle = '#FFE08A'; g2.beginPath(); g2.moveTo(a[0], a[1]); g2.lineTo(a[0] - 10 * Math.cos(ang - .4), a[1] - 10 * Math.sin(ang - .4)); g2.lineTo(a[0] - 10 * Math.cos(ang + .4), a[1] - 10 * Math.sin(ang + .4)); g2.fill();
          g2.font = '700 12px Inter, system-ui, sans-serif'; const lab = (frameK === 'lsr' ? tr('towards Hercules') : tr('towards Cygnus · around the galaxy')) + ' · ' + T.v + ' km/s';
          g2.fillStyle = 'rgba(0,0,0,.6)'; g2.fillRect(a[0] + 8, a[1] - 9, g2.measureText(lab).width + 10, 18); g2.fillStyle = '#FFE08A'; g2.fillText(lab, a[0] + 13, a[1] + 4); } }
      g2.font = '600 12px Inter, system-ui, sans-serif'; g2.textBaseline = 'middle';
      ['Earth'].concat(ORB.filter(n => n !== 'Earth')).forEach(nm => { if (mode === 'helix' && !HX.includes(nm)) return; const p = planet(nm, now), q = proj(p); if (!q) return; let r = Math.max(2.5, EL[nm][3] * Math.min(cam.follow === nm ? 9 : 1.8, 1.6 / Math.sqrt(q[2])));   // a followed planet grows as you zoom in
        if (magOn && nm === 'Earth') r = Math.max(3, MS * pxAU(q));   // the shield view: Earth at the schematic's scale
        ball(nm, p, q, r, s);
        if (nm === 'Earth') { g2.strokeStyle = 'rgba(90,169,255,.6)'; g2.lineWidth = 1.5; g2.beginPath(); g2.arc(q[0], q[1], r + 4, 0, 7); g2.stroke(); }
        const lab = tr(nm), tw = g2.measureText(lab).width, bx = [q[0] + r + 4, q[1] - 8, tw + 8, 16];
        hits.push({ x: q[0], y: q[1], r: r + 14, name: nm, w: tw + 12 });
        if (boxes.some(b => bx[0] < b[0] + b[2] && bx[0] + bx[2] > b[0] && bx[1] < b[1] + b[3] && bx[1] + bx[3] > b[1]) && nm !== 'Earth') return; boxes.push(bx);
        g2.fillStyle = 'rgba(0,0,0,.55)'; g2.fillRect(...bx); g2.fillStyle = nm === 'Earth' ? '#9CCBFF' : '#DCE3EB'; g2.fillText(lab, q[0] + r + 8, q[1]); });
      if (mode !== 'helix') (build.active || []).forEach(({ c, r, ax }) => { const q = proj(ax.map(x => x * r)); if (!q) return; const lab = 'CME ' + Math.round(c.v) + ' km/s' + (c.ex ? ' · ' + tr('EXAMPLE') : c.est ? ' · ' + tr('estimate') : '');
        g2.fillStyle = 'rgba(0,0,0,.6)'; const tw = g2.measureText(lab).width; g2.fillRect(q[0] + 6, q[1] - 8, tw + 8, 16); g2.fillStyle = '#FFE2C2'; g2.fillText(lab, q[0] + 10, q[1]); });
      if (magOn && mode === 'sys') magneto(planet('Earth', now));
      if (info) showInfo(info);
      dirty = false;
    }
    // a planet as a sphere lit from the Sun: dark side + lit part bounded by the terminator ellipse (its phase from the camera)
    function ball(nm, p, q, r, s) {
      const col = EL[nm][2], rgb = col.match(/\w\w/g).map(h => parseInt(h, 16)), dark = `rgb(${rgb.map(c => Math.round(c * .16)).join(',')})`;
      let lit = 1, ang = 0;
      if (s) { ang = Math.atan2(s[1] - q[1], s[0] - q[0]);
        if (mode !== 'helix') { const e = camEye(), toS = p.map(x => -x), toE = p.map((x, i) => e[i] - x), ls = Math.hypot(...toS), le = Math.hypot(...toE);
          lit = (1 + (toS[0] * toE[0] + toS[1] * toE[1] + toS[2] * toE[2]) / (ls * le)) / 2; } }
      if (nm === 'Saturn') ringS(q, r, rgb, true);
      if (r < 3.5) { g2.fillStyle = col; g2.beginPath(); g2.arc(q[0], q[1], r, 0, 7); g2.fill(); if (nm === 'Saturn') ringS(q, r, rgb, false); return; }
      g2.save(); g2.translate(q[0], q[1]); g2.rotate(ang); g2.beginPath(); g2.arc(0, 0, r, 0, 7); g2.clip();
      g2.fillStyle = dark; g2.fillRect(-r, -r, 2 * r, 2 * r);
      const gr = g2.createRadialGradient(r * .45, 0, 0, 0, 0, r * 1.05); gr.addColorStop(0, `rgb(${rgb.map(c => Math.min(255, c * 1.25 + 30)).join(',')})`); gr.addColorStop(.6, col); gr.addColorStop(1, `rgb(${rgb.map(c => Math.round(c * .55)).join(',')})`);
      g2.fillStyle = gr; g2.beginPath(); const e = r * Math.abs(2 * lit - 1);
      g2.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);   // the half facing the Sun, then the terminator back to the top
      if (lit >= .5) g2.ellipse(0, 0, e, r, 0, Math.PI / 2, Math.PI * 1.5); else g2.ellipse(0, 0, e, r, 0, Math.PI / 2, -Math.PI / 2, true);
      g2.fill();
      if (nm === 'Jupiter' || nm === 'Saturn') { g2.rotate(-ang); g2.fillStyle = 'rgba(120,70,30,.28)'; [-.42, -.12, .2, .5].forEach((y, i) => g2.fillRect(-r, y * r, 2 * r, r * (i % 2 ? .1 : .14))); }
      if (nm === 'Earth') { g2.rotate(-ang); g2.fillStyle = 'rgba(255,255,255,.35)'; g2.fillRect(-r, -r, 2 * r, r * .22); g2.fillRect(-r, r * .8, 2 * r, r * .2); }
      g2.restore();
      if (nm === 'Earth' || nm === 'Venus' || nm === 'Neptune' || nm === 'Uranus') { g2.strokeStyle = nm === 'Venus' ? 'rgba(255,230,180,.35)' : 'rgba(130,190,255,.45)'; g2.lineWidth = 1.2; g2.beginPath(); g2.arc(q[0], q[1], r + .8, ang - 1.4, ang + 1.4); g2.stroke(); }
      if (nm === 'Saturn') ringS(q, r, rgb, false);
    }
    // Saturn's rings as a tilted ellipse: the back half before the planet, the front half after it
    function ringS(q, r, rgb, back) { const R1 = r * 2.2, R0 = r * 1.35;
      g2.save(); g2.translate(q[0], q[1]); g2.rotate(-.35); g2.strokeStyle = `rgba(${rgb.join(',')},.75)`; g2.lineWidth = Math.max(1, (R1 - R0) * .45);
      g2.beginPath(); g2.ellipse(0, 0, (R0 + R1) / 2, (R0 + R1) / 2 * .32, 0, back ? Math.PI : 0, back ? 2 * Math.PI : Math.PI); g2.stroke(); g2.restore(); }
    // a planet's numbers: distance to the Sun, speed on its orbit (vis-viva), light time, distance from Earth
    function showInfo(nm) {
      const box = el.querySelector('.s3d-info'), t = mode === 'helix' ? hTime : time, p = planet(nm, t), r = Math.hypot(...p), a = EL[nm][0][0], v = 29.78 * Math.sqrt(2 / r - 1 / a), E = planet('Earth', t), de = Math.hypot(p[0] - E[0], p[1] - E[1], p[2] - E[2]);
      box.hidden = false; box.innerHTML = `<button aria-label="${tr('Close')}">✕</button><b>${tr(nm)}</b>${tr('From the Sun')}: ${r.toFixed(2)} AU · ${Math.round(r * 149.6)} ${tr('million km')}<br>${tr('Speed on its orbit')}: ${v.toFixed(1)} km/s<br>${tr('Sunlight needs')} ${(r * 8.317).toFixed(1)} min`
        + (nm !== 'Earth' ? `<br>${tr('From Earth')}: ${de.toFixed(2)} AU` : (window.Earth3D ? `<br><button class="s3d-goearth" style="float:none;margin:6px 0 0;border:1px solid #39FF9E;color:#39FF9E;border-radius:999px;padding:5px 10px;font:600 12px Inter,system-ui,sans-serif">${tr('Fly down to Earth')} ›</button>` : '')) + `<br><small style="color:#8E9AAB">${tr('The camera follows it — drag to look around.')}</small>`;
      const ge = box.querySelector('.s3d-goearth'); if (ge) ge.onclick = () => setMode('earth');
      box.querySelector('button').onclick = () => { info = null; box.hidden = true; cam.follow = null; view(mode === 'helix' ? 'hx' : mode === 'galaxy' ? 'gx' : 'inner'); };
    }
    function frame(ts) {
      const dt = Math.min(100, ts - (hLast || ts)) / 1000; hLast = ts;
      if (!REDUCED) ph += dt * Math.min(1, rate);   // the wind's shimmer + the shield's particles (slow motion slows them too)
      if (hPlay && mode !== 'earth' && dt > 0) { const sim = dt * rate * hDir; watch += Math.abs(sim);   // simulated seconds this frame
        if (mode === 'galaxy') { gT += sim / (1e6 * YEAR); if (ts - tAt > 250 || rate > 1e9) { hDate(); tAt = ts; dirty = true; } }
        else if (mode === 'helix') { hTime += sim * 1000; if (ts - hbAt > (rate > 3600 ? 40 : 1000)) { buildHelix(); hbAt = ts; dirty = true; } if (ts - tAt > 250) { hDate(); tAt = ts; } }
        else { time += sim * 1000; if (ts - bAt > (rate > 600 ? 40 : 1000)) { build(); bAt = ts; } if (ts - tAt > 500) { title(); tAt = ts; } } }
      if (mode === 'sys' && visible && (!REDUCED || magOn)) dirty = true;   // the wind and the shield are animated
      if (mode !== 'earth' && visible && (dirty || cam.goal || spin[0] || spin[1])) draw(); requestAnimationFrame(frame); }
    const kmTxt = km => km < 1e6 ? tr('{n} km', { n: Math.round(km).toLocaleString(window.LOC || 'en-GB') }) : km < 1.5e9 ? tr('{n} million km', { n: +(km / 1e6).toPrecision(3) }) : km < 9.46e12 ? tr('{n} AU', { n: +(km / AU_KM).toPrecision(3) }) : tr('{n} light years', { n: +(km / 9.4607e12).toPrecision(3) });
    function rateTxt(r) { const a = Math.abs(r); if (Math.abs(a - 1) < .03) return tr('REAL TIME'); if (a < 1) return tr('SLOW MO ×{n}', { n: a.toFixed(a < .3 ? 2 : 1) });
      for (const [d, k] of [[1e6 * YEAR, '{n} million years/s'], [YEAR, '{n} years/s'], [86400, '{n} days/s'], [3600, '{n} h/s'], [60, '{n} min/s']]) if (a >= d) return tr(k, { n: +(a / d).toPrecision(2) });
      return '×' + Math.round(a); }
    function rateUI() { const sl = el.querySelector('.s3d-rate'); if (document.activeElement !== sl) sl.value = posOf(Math.max(.1, rate)); el.querySelector('.s3d-rl').textContent = (hDir < 0 ? '◀ ' : '') + rateTxt(rate);
      const b = el.querySelector('.s3d-hplay'); b.textContent = hPlay ? '⏸' : '▶'; b.setAttribute('aria-label', hPlay ? tr('Pause') : tr('Play')); el.querySelector('.s3d-hrev').setAttribute('aria-pressed', hDir < 0); }
    function hDate() { const hd = el.querySelector('.s3d-hdate'); if (hd && document.activeElement !== hd && mode === 'helix') { try { hd.value = new Date(hTime).toISOString().slice(0, 10); } catch (e) {} }
      const moved = tr('{d} since you started watching', { d: kmTxt(watch * (mode === 'galaxy' ? 230 : TRAVEL[frameK].v)) });
      if (mode === 'galaxy') { const y = gT * 1e6; el.querySelector('.s3d-t').textContent = Math.abs(y) < 1 ? tr('Today') : Math.abs(gT) < 1 ? (y > 0 ? tr('In {n} years', { n: Math.round(y).toLocaleString(window.LOC || 'en-GB') }) : tr('{n} years ago', { n: Math.round(-y).toLocaleString(window.LOC || 'en-GB') })) : gT > 0 ? tr('In {n} million years', { n: Math.round(gT) }) : tr('{n} million years ago', { n: Math.round(-gT) });
        el.querySelector('.s3d-sub').textContent = (Math.abs(gT) < .01 ? tr('the Sun circles the galaxy at 230 km/s') + ' · ' + moved : tr('one lap around the galaxy ≈ 230 million years · up and down through the disc every ~70')); return; }
      el.querySelector('.s3d-t').textContent = rate > 86400 * 20 ? new Date(hTime).toLocaleDateString(window.LOC || 'en-GB', { month: 'long', year: 'numeric' }) : new Date(hTime).toLocaleString(window.LOC || 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: rate < 60 ? '2-digit' : undefined });
      el.querySelector('.s3d-sub').textContent = tr('the Sun moves {d} AU a year', { d: (kmsAU(TRAVEL[frameK].v) * 365.25).toFixed(1) }) + ' · ' + moved; }
    function resize() { const r = el.getBoundingClientRect(); W = Math.max(200, r.width); H = Math.max(200, r.height); dpr = Math.min(2, devicePixelRatio || 1);
      [cv, ov].forEach(c => { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }); dirty = true; }
    function setTime(t) { if (!isFinite(t)) return; time = t; if (mode === 'helix') return; title(); build(); dirty = true; }
    function title() { if (mode !== 'sys') return; const t = time;
      el.querySelector('.s3d-t').textContent = new Date(t).toLocaleString(window.LOC || 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: hPlay && rate < 30 ? '2-digit' : undefined, timeZone: opts.tz ? opts.tz() : undefined });
      if (magOn) return;   // the shield view writes its own status line
      const E = planet('Earth', t), q = cmes.filter(c => { const r = 0.1 + kmsAU(c.v) * (t - c.t) / DAY; return r > 0 && r < 3.4; }).length;
      el.querySelector('.s3d-sub').textContent = tr('wind at Earth ≈ {v} km/s', { v: Math.round(vtab[Math.round((((lonOf(E) - OMEGA * t / DAY) / D2R) % 360 + 360) % 360) % 360]) }) + (q ? ' · ' + tr('{n} CME in flight', { n: q }) : ''); }
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
        setDist(z0 * d0 / Math.max(10, d)); if (mid0) { pan(mid[0] - mid0[0], mid[1] - mid0[1]); mid0 = mid; } moved = 99; cam.goal = null; dirty = true; } });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) mid0 = null; if (pts.size === 0 && moved > 6) { /* keep the spin going */ } else spin = [0, 0];
      if (moved < 6 && e.type === 'pointerup') { const r = ov.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, now = performance.now();
        if (now - lastTap < 320) { lastTap = 0; info = null; el.querySelector('.s3d-info').hidden = true; view(mode === 'helix' ? 'hx' : mode === 'galaxy' ? 'gx' : 'inner'); return; } lastTap = now;
        const h = hits.find(h => Math.hypot(h.x - x, h.y - y) < h.r || (h.w && x > h.x && x < h.x + h.w + 10 && Math.abs(y - h.y) < 10));
        if (h && h.name !== 'Sun') { cam.follow = null; const p = planet(h.name, mode === 'helix' ? hTime : time); cam.goal = { tgt: toHx(p), dist: Math.max(.25, Math.hypot(...p) * .25) }; info = h.name; setTimeout(() => { if (info === h.name) cam.follow = h.name; }, 900); dirty = true; }
        else if (h) { info = null; el.querySelector('.s3d-info').hidden = true; view(mode === 'helix' ? 'hx' : mode === 'galaxy' ? 'gx' : 'inner'); } } };
    ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
    const zoom = f => { if (performance.now() - modeAt < 900) return;   // let the hand-over flight finish (wheel momentum would carry on)
      cam.goal = null; setDist(cam.dist * f); dirty = true; };
    // one zoom from the ground to the galaxy: Earth ⇄ solar system (zoom in on Earth) ⇄ galaxy (past 400 AU / below 0.3 kpc)
    let modeAt = 0;
    function setDist(d) {
      if (performance.now() - modeAt > 700) {
        if (mode === 'sys' && d > 400) return jump('galaxy');
        if (mode === 'galaxy' && d < .3) return jump('sys');
        if (mode === 'sys' && d < .08 && window.Earth3D && !magOn) { const E = planet('Earth', time); if (cam.follow === 'Earth' || Math.hypot(...cam.tgt.map((v, i) => v - E[i])) < .05) return jump('earth'); } }
      cam.dist = Math.max(magOn ? .025 : .08, Math.min(mode === 'galaxy' ? 70 : 400, d)); }
    function jump(m) {
      const from = mode; setMode(m, true);
      if (m === 'galaxy') { cam.tgt = sunGal(); cam.dist = .4; }                         // start at the Sun, fly out to the whole Milky Way
      else if (m === 'sys' && from === 'galaxy') { cam.tgt = [0, 0, 0]; cam.dist = 380; }  // start at the edge, fly in to the planets
      if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); z0 = cam.dist; }
      dirty = true; }
    ov.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(e.deltaY * .0012)); }, { passive: false });
    el.querySelectorAll('[data-z]').forEach(b => b.onclick = () => zoom(+b.dataset.z > 0 ? 1.35 : 1 / 1.35));
    el.querySelector('.s3d-reset').onclick = () => { info = null; el.querySelector('.s3d-info').hidden = true; view(mode === 'helix' ? 'hx' : mode === 'galaxy' ? 'gx' : 'inner'); };
    el.querySelector('.s3d-q').onclick = () => { const h = el.querySelector('.s3d-help'); h.hidden = !h.hidden; };
    el.querySelector('.s3d-hx-x').onclick = () => { el.querySelector('.s3d-help').hidden = true; };
    el.tabIndex = 0;
    el.addEventListener('keydown', e => { const k = e.key; if (/^Arrow/.test(k)) { e.preventDefault(); if (k === 'ArrowLeft') cam.yaw -= .08; if (k === 'ArrowRight') cam.yaw += .08; if (k === 'ArrowUp') cam.pitch = Math.min(1.55, cam.pitch + .06); if (k === 'ArrowDown') cam.pitch = Math.max(-1.5, cam.pitch - .06); cam.goal = null; dirty = true; }
      else if (k === '+' || k === '=') zoom(1 / 1.2); else if (k === '-') zoom(1.2); else if (k === 'r' || k === 'R') view(mode === 'helix' ? 'hx' : mode === 'galaxy' ? 'gx' : 'inner');
      else if (k === ' ' && mode !== 'earth') { e.preventDefault(); togglePlay(); } else if (k === 'Escape' && el.classList.contains('s3d-fs')) el.querySelector('.s3d-full').click(); });
    // modes
    const togglePlay = () => { hPlay = !hPlay; hLast = 0; rateUI(); };
    el.querySelector('.s3d-hplay').onclick = () => { if (hDir < 0) { hDir = 1; if (hPlay) { rateUI(); return; } } togglePlay(); };
    el.querySelector('.s3d-hrev').onclick = () => { hDir = hDir > 0 ? -1 : 1; if (!hPlay) togglePlay(); else rateUI(); };
    el.querySelector('.s3d-rate').oninput = e => { const r = rng(), p1 = posOf(1), v = +e.target.value, pv = Math.abs(v - p1) < 18 ? p1 : v;   // snaps to real time
      rate = Math.abs(pv - p1) < 1 ? 1 : Math.pow(10, r[0] + pv / 1000 * (r[1] - r[0])); if (!hPlay) togglePlay(); else rateUI(); };
    // NOW: back to this moment, real time, forwards
    el.querySelector('.s3d-now').onclick = () => { rate = 1; hDir = 1; hPlay = true; watch = 0; if (mode === 'galaxy') { gT = 0; hDate(); } else if (mode === 'helix') { hTime = Date.now(); buildHelix(); hDate(); } else setTime(Date.now()); rateUI(); dirty = true; };
    el.querySelector('.s3d-hdate').onchange = e => { const t = Date.parse(e.target.value + 'T12:00:00Z'); if (isFinite(t)) { hTime = t; buildHelix(); hDate(); dirty = true; } };
    el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { frameK = b.dataset.f; el.querySelectorAll('[data-f]').forEach(o => o.setAttribute('aria-pressed', o === b)); buildHelix(); hDate(); view('hx'); });
    let earth = null;
    function setMode(m, far) { modeAt = performance.now();
      if (m === 'earth') { if (!window.Earth3D) return; if (!earth) earth = Earth3D.create(el, { places: opts.places ? opts.places() : [], time: () => time, aurora: opts.aurora, onBack: () => setMode('sys'), onOut: () => { setMode('sys', true); cam.tgt = planet('Earth', time); cam.dist = .06; cam.goal = { dist: .4, pitch: .35 }; cam.follow = 'Earth'; dirty = true; } });   // fly out from Earth, still following it
        mode = 'earth'; magOff(); el.classList.add('ea'); el.classList.remove('hx'); el.querySelectorAll('[data-m]').forEach(o => o.setAttribute('aria-pressed', o.dataset.m === m)); info = null;
        const pl = opts.places ? opts.places()[0] : null; if (opts.places) earth.setPlaces(opts.places()); earth.show(pl ? pl.lat : 45.6, pl ? pl.lon : 25.6, far); return; }
      if (earth) earth.hide(); el.classList.remove('ea');
      mode = m; el.classList.toggle('hx', m === 'helix'); el.classList.toggle('gx', m === 'galaxy');
      rate = 1; hDir = 1; hPlay = true; watch = 0; rateUI(); if (m !== 'sys') magOff();   // every view starts in real time
      if (m === 'galaxy') { el.querySelectorAll('[data-m]').forEach(o => o.setAttribute('aria-pressed', o.dataset.m === m)); info = null; el.querySelector('.s3d-info').hidden = true; gT = 0; buildGalaxy(); hDate(); view('gx'); dirty = true; return; } el.querySelectorAll('[data-m]').forEach(o => o.setAttribute('aria-pressed', o.dataset.m === m)); info = null; el.querySelector('.s3d-info').hidden = true;
      if (m === 'helix') { hTime = Date.now(); buildHelix(); hDate(); view('hx'); } else { build.orbT = null; setTime(time); view('inner'); } dirty = true; }
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => setMode(b.dataset.m));
    el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => view(b.dataset.v));
    // Sun filter: SDO's newest picture in visible light (sunspots) or one of three ultraviolet channels
    el.querySelector('.s3d-sunf').onclick = e => { sunI = (sunI + 1) % SUNF.length; e.currentTarget.textContent = '☀ ' + tr(SUNF[sunI][1]); dirty = true; };
    // example: a strong Earth-directed CME (1800 km/s, like May 2024) launched ~8 h before the clock, so it is on its way
    el.querySelector('.s3d-cmex').onclick = e => { cmeEx = !cmeEx; exT = time - 0.35 * DAY; e.currentTarget.setAttribute('aria-pressed', cmeEx); if (cmeEx && !magOn) view('inner'); build(); dirty = true; };
    // the shield: fly to Earth, seen from the side with the Sun to one side
    el.querySelector('.s3d-mag').onclick = () => { if (magOn) { magOff(); view('inner'); return; }
      magOn = true; el.classList.add('mag'); el.querySelector('.s3d-mag').setAttribute('aria-pressed', true); info = null; el.querySelector('.s3d-info').hidden = true;
      const E = planet('Earth', time), a = Math.atan2(E[2], E[0]); cam.follow = null; cam.goal = { tgt: E, dist: .13, pitch: .16, yaw: a + Math.PI / 2 - .3 }; setTimeout(() => { if (magOn) cam.follow = 'Earth'; }, 900); dirty = true; };
    // CME impact: the next Earth-bound CME about 2 h out (or the example one), then 15 min per second so the hit takes seconds
    el.querySelector('.s3d-imp').onclick = () => { const st = cmeAtEarth();
      if (st.eta == null && magF < .2) { cmeEx = true; el.querySelector('.s3d-cmex').setAttribute('aria-pressed', true); exT = time - (.9 - .1) / kmsAU(1800) * DAY; }
      else if (st.eta != null) time += Math.max(0, st.eta - 2) * 3600e3;
      rate = 900; hDir = 1; hPlay = true; rateUI(); build(); title(); dirty = true; };
    el.querySelector('.s3d-full').onclick = () => { el.classList.toggle('s3d-fs'); document.body.classList.toggle('s3d-lock', el.classList.contains('s3d-fs')); setTimeout(resize, 60); };
    if (window.ResizeObserver) new ResizeObserver(resize).observe(el); else addEventListener('resize', resize);
    if (window.IntersectionObserver) new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) dirty = true; }).observe(el);
    rateUI(); resize(); setWind(opts.wind); setCmes(opts.cmes); setTime(opts.time || Date.now()); requestAnimationFrame(frame);
    return { setTime, setWind: s => { setWind(s); setTime(time); }, setCmes: c => { setCmes(c); setTime(time); }, view, resize, canvas: () => { draw(); const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; const g = c.getContext('2d'); g.drawImage(cv, 0, 0); g.drawImage(ov, 0, 0); return c; } };
  }
  window.Space3D = { create, planet };
})();
