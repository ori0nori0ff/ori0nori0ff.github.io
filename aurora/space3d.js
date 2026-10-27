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
  const BASE = ((document.currentScript && document.currentScript.src) || '').replace(/[^/]*$/, '');   // stars3d.js sits next to this file
  // famous objects: [name, RA°, Dec°, distance pc, colour, kind, one line]
  const OBJ = [
    ['Orion Nebula', 83.82, -5.39, 412, '255,120,170', 'star nursery', 'A star nursery you can see with the naked eye below Orion’s belt: new stars light up the gas around them.'],
    ['Horsehead Nebula', 85.25, -2.46, 422, '255,90,110', 'dark nebula', 'A cloud of dark dust shaped like a horse’s head, in front of glowing red gas.'],
    ['Pleiades', 56.75, 24.12, 136, '150,190,255', 'star cluster', 'The Seven Sisters: a young cluster, about 100 million years old, still wrapped in blue dust.'],
    ['Hyades', 66.75, 15.87, 47, '255,220,170', 'star cluster', 'The nearest star cluster — the V-shaped face of Taurus.'],
    ['Crab Nebula', 83.63, 22.01, 2000, '255,170,120', 'supernova remnant', 'What is left of a star that exploded in the year 1054; Chinese astronomers saw it in daylight.'],
    ['Eagle Nebula', 274.7, -13.8, 1740, '210,170,255', 'star nursery', 'Home of the “Pillars of Creation”, towers of gas where stars are being born.'],
    ['Lagoon Nebula', 270.9, -24.4, 1250, '255,110,150', 'star nursery', 'A big star nursery towards the centre of the galaxy.'],
    ['Carina Nebula', 161.27, -59.87, 2300, '255,140,120', 'star nursery', 'One of the brightest nebulae, home of the giant unstable star Eta Carinae.'],
    ['Rosette Nebula', 98.0, 4.95, 1600, '255,100,130', 'star nursery', 'A rose-shaped cloud around a young star cluster.'],
    ['Ring Nebula', 283.4, 33.03, 790, '120,220,255', 'planetary nebula', 'The shell of gas puffed off by a dying Sun-like star.'],
    ['Helix Nebula', 337.41, -20.84, 200, '120,220,200', 'planetary nebula', 'A nearby dying star, the “Eye of God” — our Sun will end like this in ~5 billion years.'],
    ['North America Nebula', 314.75, 44.33, 795, '255,110,140', 'star nursery', 'A glowing cloud in Cygnus shaped like North America.'],
    ['Omega Centauri', 201.7, -47.48, 5430, '255,230,180', 'globular cluster', 'The biggest globular cluster: about 10 million very old stars packed in a ball.'],
    ['Hercules Cluster', 250.42, 36.46, 6800, '255,230,180', 'globular cluster', 'A ball of ~300,000 ancient stars (M13).'],
    ['Large Magellanic Cloud', 80.89, -69.76, 49970, '200,210,255', 'satellite galaxy', 'A small galaxy circling the Milky Way, seen from the southern hemisphere.'],
    ['Small Magellanic Cloud', 13.19, -72.83, 62440, '200,210,255', 'satellite galaxy', 'Another small companion galaxy of the Milky Way.']];
  // J2000 equatorial → galactic l, b (radians)
  function galLB(ra, de) { const a = ra * D2R, d = de * D2R, aG = 192.85948 * D2R, dG = 27.12825 * D2R, lN = 122.93192 * D2R;
    const sb = Math.sin(d) * Math.sin(dG) + Math.cos(d) * Math.cos(dG) * Math.cos(a - aG);
    return [lN - Math.atan2(Math.cos(d) * Math.sin(a - aG), Math.sin(d) * Math.cos(dG) - Math.cos(d) * Math.sin(dG) * Math.cos(a - aG)), Math.asin(sb)]; }
  // B−V colour index → star colour (blue-white … orange-red)
  function bvRGB(bv) { const t = Math.max(-.4, Math.min(2, bv)), S = [[-.4, [155, 176, 255]], [0, [202, 215, 255]], [.4, [248, 247, 255]], [.65, [255, 244, 234]], [1, [255, 210, 161]], [1.4, [255, 180, 110]], [2, [255, 140, 80]]];
    for (let i = 1; i < S.length; i++) if (t <= S[i][0]) { const f = (t - S[i - 1][0]) / (S[i][0] - S[i - 1][0]); return S[i - 1][1].map((c, k) => (c + (S[i][1][k] - c) * f) / 255); } return S[S.length - 1][1].map(c => c / 255); }
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
  const TVS = 'attribute vec3 p;attribute vec2 u;uniform mat4 m;varying vec2 vu;void main(){gl_Position=m*vec4(p,1.);vu=u;}';
  const TFS = 'precision mediump float;varying vec2 vu;uniform sampler2D t;uniform float a;void main(){gl_FragColor=texture2D(t,vu)*a;}';
  const FS = 'precision mediump float;varying vec4 vc;uniform float pt;void main(){float a=vc.a;if(pt>.5){float d=length(gl_PointCoord-.5);a*=smoothstep(.5,.0,d);}gl_FragColor=vec4(vc.rgb*a,a);}';

  const CSS = `.s3d{position:relative;overflow:hidden;background:#05070D;border-radius:16px;touch-action:none;user-select:none;-webkit-user-select:none}
.s3d canvas{position:absolute;left:0;top:0;display:block}.s3d-ov{cursor:grab}.s3d-ov:active{cursor:grabbing}
.s3d-top{position:absolute;left:12px;top:10px;pointer-events:none;display:flex;flex-direction:column;gap:2px;text-shadow:0 1px 3px #000;max-width:calc(50% - 200px)}
.s3d-snap{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:30}.s3d-t{font:700 15px Inter,system-ui,sans-serif;color:#FFE600}.s3d-sub{font:500 12px Inter,system-ui,sans-serif;color:#C9D1DB}
.s3d-btns{position:absolute;left:10px;bottom:10px;display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;max-width:calc(100% - 20px)}.s3d-btns::-webkit-scrollbar{display:none}.s3d-btns button{flex:none;white-space:nowrap}
.s3d-btns button,.s3d-ctl button{border:1px solid rgba(255,255,255,.18);background:rgba(10,14,20,.75);color:#E6EBF1;border-radius:999px;padding:7px 12px;min-height:36px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}
.s3d-ctl{position:absolute;right:10px;top:10px;display:flex;flex-direction:column;gap:6px}.s3d-ctl button{width:40px;height:40px;padding:0;font-size:18px;line-height:1}
.s3d-tabs{position:absolute;left:50%;top:10px;transform:translateX(-50%);display:flex;border:1px solid rgba(255,255,255,.18);border-radius:999px;overflow:hidden;background:rgba(10,14,20,.75)} .s3d-ph{margin-top:8px}.s3d-phl{font:600 10.5px Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#A3B0C2;margin-bottom:4px}.s3d-phg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}.s3d-phg a{position:relative;display:block;aspect-ratio:1;border-radius:8px;overflow:hidden;background:#0F1318}.s3d-phg img{width:100%;height:100%;object-fit:cover;display:block}.s3d-phg span{position:absolute;left:4px;bottom:3px;font:600 9.5px Inter,system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000} .s3d-sc{font-style:normal;color:#5D6878;align-self:center;padding:0 1px}.s3d-hxb{margin-left:10px}
.s3d-tabs{max-width:calc(100% - 20px);overflow-x:auto;scrollbar-width:none}.s3d-tabs::-webkit-scrollbar{display:none}.s3d-tabs button{border:0;background:none;color:#C9D1DB;padding:8px 14px;min-height:36px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap;flex:none}.s3d-tabs button[aria-pressed=true]{background:#39FF9E;color:#0A0A0A}
.s3d-btns button[aria-pressed=true]{border-color:#39FF9E;color:#39FF9E}.s3d .s3d-hx{display:none}.s3d.hx .s3d-hx{display:flex}.s3d.hx .s3d-sys,.s3d.hx .s3d-leg{display:none}
.s3d-info{position:absolute;right:60px;top:10px;max-width:250px;background:rgba(10,14,20,.88);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:10px 12px;font:500 12px/1.5 Inter,system-ui,sans-serif;color:#C9D1DB}
.s3d-info b{display:block;font-size:15px;color:#fff;margin-bottom:2px}.s3d-info button{float:right;border:0;background:none;color:#A3B0C2;font-size:14px;cursor:pointer;margin:-4px -4px 0 6px}
.s3d-help{position:absolute;inset:56px 60px 60px 10px;overflow:auto;background:rgba(8,11,17,.94);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px 16px;font:500 13px/1.55 Inter,system-ui,sans-serif;color:#C9D1DB}
.s3d-help b{color:#fff;font-size:14px}.s3d-help p{margin:2px 0 12px}.s3d-hx-x{float:right;border:0;background:none;color:#A3B0C2;font-size:16px;cursor:pointer}
.s3d.ea .s3d-gl,.s3d.ea .s3d-ov,.s3d.ea .s3d-btns,.s3d.ea .s3d-leg,.s3d.ea .s3d-top,.s3d.ea .s3d-info,.s3d.ea .s3d-help,.s3d.ea .s3d-ctl button:not(.s3d-full){display:none!important}.s3d.ea .s3d-tabs,.s3d.ea .s3d-ctl{z-index:5}
.s3d-time{position:absolute;left:10px;bottom:54px;display:flex;gap:6px;align-items:center;flex-wrap:nowrap;max-width:calc(100% - 20px)}
.s3d-time button{flex:none;border:1px solid rgba(255,255,255,.18);background:rgba(10,14,20,.75);color:#E6EBF1;border-radius:999px;min-width:36px;min-height:36px;padding:0 10px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}
.s3d-time .s3d-hplay{min-width:44px;font-size:14px}
.s3d-rl{font:700 11px Inter,system-ui,sans-serif;color:#E6EBF1;background:rgba(10,14,20,.75);border-radius:999px;padding:7px 10px;white-space:nowrap;min-width:96px;text-align:center}
.s3d.ea .s3d-time{display:none!important}@media (max-width:640px){.s3d-rl{min-width:84px}}
.s3d-hdate{background:rgba(10,14,20,.75);color:#E6EBF1;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:6px 10px;min-height:36px;font:600 12px Inter,system-ui,sans-serif;color-scheme:dark}
.s3d.gx .s3d-hx,.s3d.gx .s3d-sys,.s3d.gx .s3d-leg{display:none!important}.s3d .s3d-st{display:none}.s3d.st .s3d-st{display:flex}.s3d.st .s3d-sys,.s3d.st .s3d-hx,.s3d.st .s3d-leg{display:none!important}.s3d .s3d-imp{display:none}.s3d.mag .s3d-imp{display:inline-block}
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
      <div class="s3d-tabs" role="tablist"><button data-m="earth" aria-pressed="true">${tr('Solar system')}</button><i class="s3d-sc">›</i><button data-m="stars" aria-pressed="false">${tr('Nearby stars')}</button><i class="s3d-sc">›</i><button data-m="galaxy" aria-pressed="false">${tr('Galaxy')}</button><button data-m="helix" aria-pressed="false" class="s3d-hxb">${tr('Spiral through space')}</button></div>
      <div class="s3d-time"><button class="s3d-back" aria-label="${tr('Slower / backwards')}">⏪</button><button class="s3d-hplay" aria-label="${tr('Pause')}">⏸</button><button class="s3d-fwd" aria-label="${tr('Faster forwards')}">⏩</button><span class="s3d-rl" aria-live="polite"></span><button class="s3d-now">${tr('Now')}</button></div>
      <div class="s3d-btns s3d-st"><button data-sv="sun">${tr('From the Sun')}</button><button data-sv="orion">${tr('Orion from the side')}</button><button data-sv="far">${tr('Zoomed out')}</button><button class="s3d-con" aria-pressed="true">✦ ${tr('Constellations')}</button><button class="s3d-nam" aria-pressed="true">${tr('Names')}</button></div>
      <div class="s3d-btns s3d-hx"><input type="date" class="s3d-hdate" aria-label="${tr('Date')}"><button data-f="lsr" aria-pressed="true">${tr('vs nearby stars · 20 km/s')}</button><button data-f="gal" aria-pressed="false">${tr('around the Milky Way · 230 km/s')}</button></div>
      <div class="s3d-ctl"><button class="s3d-full" aria-label="${tr('Full screen')}">⛶</button><button data-z="-1" aria-label="${tr('Zoom in')}">+</button><button data-z="1" aria-label="${tr('Zoom out')}">−</button><button class="s3d-reset" aria-label="${tr('Reset the view')}">⟲</button><button class="s3d-q" aria-label="${tr('How it works')}">?</button></div>
      <div class="s3d-info" hidden></div>
      <div class="s3d-help" hidden><button class="s3d-hx-x" aria-label="${tr('Close')}">✕</button>
        <b>${tr('Moving around')}</b><p>${tr('Drag to turn · pinch or scroll to zoom · two fingers or right-drag to move sideways · double-tap to reset · tap a planet to fly to it and see its numbers. Zoom out from Earth to reach the solar system, keep going for the galaxy; tap Earth and zoom in to land. Keys: arrows turn, + / − zoom, R reset, space play.')}</p>
        <b>${tr('Time')}</b><p>${tr('Everything starts in real time, like the sky outside. ⏩ speeds time up one step at a time (minutes, days, years or millions of years per second, depending on the view); ⏪ slows it down — through slow motion — and then runs it backwards, faster with each press. ⏸ pauses, NOW returns to this moment at real speed. Keys: space, J / L.')}</p>
        <b>${tr('Nearby stars')}</b><p>${tr('The 2,800 stars you can see with the naked eye, at their real distances (HYG catalogue, from ESA’s Hipparcos). The constellations only look like figures from here: fly to the side of Orion and its stars turn out to lie at very different distances. Stars also move — speed time up to watch the constellations change shape over tens of thousands of years. Tap a nebula for its story.')}</p>
        <b>${tr('Galaxy')}</b><p>${tr('The Milky Way seen from outside: a bar of old yellow stars in the middle, spiral arms of young blue stars, pink star nurseries and dark dust. We live in the small Orion Spur, between two big arms, 26,000 light years from the black hole at the centre. The Sun takes ~230 million years for one lap.')}</p>
        <b>${tr('Spiral through space')}</b><p>${tr('The Sun is not standing still: it moves ~20 km/s towards the constellation Hercules compared with nearby stars, and ~230 km/s around the centre of the Milky Way. The planets come along, so each one draws a spiral (a helix) around the Sun’s path. The orbits are tilted about 60° to that path, so the spirals are slanted — the planets are not dragged behind the Sun like a comet tail, as some popular videos show.')}</p></div>`;
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
    const HX = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'], HXN = 900, trails = mk((HX.length + 1) * HXN);
    const galB = mk(52000), ring = mk(361); let gT = 0, galBuilt = false;
    const starB = mk(3000), conB = mk(4000), oriB = mk(200); let sT = 0, starsReady = false, showCon = true, showNames = true, starsAt = -1e9;   // sT: years from now
    const pt = gl.createProgram(); gl.attachShader(pt, sh(gl.VERTEX_SHADER, TVS)); gl.attachShader(pt, sh(gl.FRAGMENT_SHADER, TFS)); gl.linkProgram(pt);
    const AT = { p: gl.getAttribLocation(pt, 'p'), u: gl.getAttribLocation(pt, 'u') }, UT = { m: gl.getUniformLocation(pt, 'm'), a: gl.getUniformLocation(pt, 'a') };
    let galTexO = null; const galQ = gl.createBuffer(), galU = gl.createBuffer();
    let mode = 'wait', frameK = 'lsr', hTime = Date.now(), hPlay = true, rate = 1, hDir = 1, hLast = 0, info = null, ph = 0, watch = 0, bAt = 0, tAt = 0, hbAt = 0;
    const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches, YEAR = 3.15576e7;
    // speed slider: log scale, simulated seconds per real second, from 0.1 (slow motion) to each view's maximum
    // speed ladder (simulated seconds per real second): ⏩ one step more forward, ⏪ one step more backward — through slow motion into reverse
    const STEPS = { stars: [.1, .5, 1, 3600, 86400, YEAR, 100 * YEAR, 1000 * YEAR, 1e4 * YEAR, 5e4 * YEAR], sys: [.1, .25, .5, 1, 10, 60, 600, 3600, 21600, 86400, 604800, 2592000], helix: [.1, .25, .5, 1, 60, 3600, 86400, 604800, 2592000, YEAR / 4, YEAR, 5 * YEAR],
      galaxy: [.1, .5, 1, 3600, 86400, YEAR, 1000 * YEAR, 1e5 * YEAR, 1e6 * YEAR, 5e6 * YEAR, 2e7 * YEAR] };
    const ladder = () => { const a = STEPS[mode] || STEPS.sys, r = a.indexOf(1); return a.slice(r).reverse().map(x => -x).concat(a); };   // reverse never slower than real time
    const SUNB = 'https://raw.githubusercontent.com/ori0nori0ff/ori0nori0ff.github.io/enlil/sun/';
    // [file id, label, disc radius as a share of the image width] — HMI fills more of its frame than AIA
    const SUNF = [['HMIIC', 'visible light', .468], ['0171', '171 Å · corona', .393], ['0193', '193 Å · hot corona', .393], ['0304', '304 Å · chromosphere', .393]];
    let sunI = 0, cmeEx = false, exT = 0; const sunImg = {};
    function sunTex() { const f = SUNF[sunI]; let im = sunImg[f[0]];
      if (!im) { im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { dirty = true; }; im.src = SUNB + f[0] + '.jpg?h=' + Math.floor(Date.now() / 3600e3); sunImg[f[0]] = im; }
      return im.complete && im.naturalWidth ? im : null; }
    // camera
    const cam = { yaw: -0.6, pitch: 0.55, dist: 3.4, tgt: [0, 0, 0], goal: null };
    let W = 0, H = 0, dpr = 1, M = null, dirty = true, visible = true, spin = [0, 0], time = Date.now();
    let donki = null, series = [];   // NOAA wind + NASA DONKI CMEs, handed to the three.js scene
    const setWind = s_ => { series = s_ || []; }, setCmes = list => { if (list) donki = list.filter(c => c.v > 0); };

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
    function buildGalaxy() { galPicture(); if (galBuilt) return; galBuilt = true; const g = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283 * v); };
      const arms = [0, 1.57, 3.14, 4.71], k = 1 / Math.tan(12 * D2R); let n = 0;
      const put = (x, y, z, c, a) => { galB.p.set([x, y, z], n * 3); galB.c.set([c[0], c[1], c[2], Math.min(1, a * 1.5)], n * 4); galB.s[n] = 80; n++; };
      for (let i = 0; i < 7000; i++) { const r = Math.abs(g()) * .9, t = rnd() * 6.283, ph = Math.acos(2 * rnd() - 1); put(r * Math.sin(ph) * Math.cos(t), r * Math.cos(ph) * .55, r * Math.sin(ph) * Math.sin(t), [1, .82, .55], .55); }
      for (let i = 0; i < 5000; i++) { const l = g() * 2.2, w = g() * .45, c = Math.cos(27 * D2R), sn = Math.sin(27 * D2R); put(l * c - w * sn, g() * .15, l * sn + w * c, [1, .85, .62], .5); }
      for (let i = 0; i < 30000; i++) { const r = 2.6 + Math.pow(rnd(), 1.35) * 13, a = arms[i % 4] + Math.log(r / 2.6) * k, sp = .22 * Math.sqrt(r / 6), off = g() * sp, oa = g() * .08;
        const hii = rnd() < .05, col = hii ? [1, .45, .7] : r < 5 ? [.95, .9, .85] : [.62, .75, 1]; put(r * Math.cos(a + oa) + off * Math.cos(a), g() * .08, -(r * Math.sin(a + oa) + off * Math.sin(a)), col, hii ? .7 : .45); }
      while (n < 52000) { const r = Math.pow(rnd(), .7) * 15, t = rnd() * 6.283; put(r * Math.cos(t), g() * .12, -r * Math.sin(t), [.75, .78, .9], .18); }
      galB.n = n; upload(galB);
      for (let i = 0; i <= 360; i++) { const t = i * D2R; ring.p.set([8.2 * Math.cos(t), 0, -8.2 * Math.sin(t)], i * 3); ring.c.set([1, .85, .4, .35], i * 4); ring.s[i] = 1; } ring.n = 361; upload(ring); }
    // the Milky Way as a picture (same arms as the star points): glow, arms of young blue stars, pink nurseries, dark dust lanes, bar + bulge
    function galPicture() { if (galTexO) return; const N = 1024, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), S = N / 32, X = x => (x + 16) * S, Z = z => (z + 16) * S;
      const gs = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283 * v); };
      const blob = (x, z, r, col, a) => { const R = r * S, gg = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), R); gg.addColorStop(0, `rgba(${col},${a})`); gg.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gg; g.fillRect(X(x) - R, Z(z) - R, 2 * R, 2 * R); };
      g.fillStyle = '#000'; g.fillRect(0, 0, N, N); g.globalCompositeOperation = 'lighter';
      let gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, 15.5 * S); gr.addColorStop(0, 'rgba(255,214,160,.5)'); gr.addColorStop(.2, 'rgba(220,200,190,.16)'); gr.addColorStop(.6, 'rgba(120,150,220,.06)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, N, N);
      const k = 1 / Math.tan(12 * D2R), ARMS = [0, 1.57, 3.14, 4.71], arm = (a0, r) => a0 + Math.log(r / 2.6) * k;
      ARMS.forEach(a0 => { for (let i = 0; i < 1700; i++) { const r = 2.6 + Math.pow(rnd(), 1.15) * 13.2, a = arm(a0, r) + gs() * .05, w = gs() * .25 * Math.sqrt(r / 6);
          const x = r * Math.cos(a) + w * Math.cos(a), z = -(r * Math.sin(a) + w * Math.sin(a)); blob(x, z, .35 + rnd() * .6, r < 5 ? '255,228,200' : '165,195,255', .05 + .05 * rnd());
          if (rnd() < .07) blob(x, z, .08 + rnd() * .12, '255,105,165', .5); } });
      for (let i = 0; i < 420; i++) { const r = 7 + rnd() * 2.6, a = .35 + Math.log(r / 8.2) * k + gs() * .03; blob(r * Math.cos(a), -r * Math.sin(a), .25 + rnd() * .3, '170,200,255', .05); if (rnd() < .06) blob(r * Math.cos(a), -r * Math.sin(a), .07, '255,105,165', .5); }   // Orion Spur
      g.save(); g.translate(N / 2, N / 2); g.rotate(27 * D2R); g.scale(1, .36); gr = g.createRadialGradient(0, 0, 0, 0, 0, 3 * S); gr.addColorStop(0, 'rgba(255,215,150,.8)'); gr.addColorStop(1, 'rgba(255,190,120,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 3 * S, 0, 7); g.fill(); g.restore();
      blob(0, 0, 1.6, '255,236,200', .85);
      g.globalCompositeOperation = 'source-over';   // dust lanes on the inner edge of each arm
      ARMS.forEach(a0 => { for (let i = 0; i < 900; i++) { const r = 3.2 + Math.pow(rnd(), 1.2) * 11, a = arm(a0, r / .94) + gs() * .03; const x = r * Math.cos(a), z = -r * Math.sin(a), R = (.12 + rnd() * .2) * S;
          const gg = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), R); gg.addColorStop(0, 'rgba(18,10,6,.32)'); gg.addColorStop(1, 'rgba(18,10,6,0)'); g.fillStyle = gg; g.fillRect(X(x) - R, Z(z) - R, 2 * R, 2 * R); } });
      galTexO = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, galTexO); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.bindBuffer(gl.ARRAY_BUFFER, galQ); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-16, 0, -16, 16, 0, -16, -16, 0, 16, 16, 0, 16]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, galU); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW); }
    function drawGalPic() { if (!galTexO) return; gl.useProgram(pt); gl.uniformMatrix4fv(UT.m, false, new Float32Array(M)); gl.uniform1f(UT.a, .9); gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindBuffer(gl.ARRAY_BUFFER, galQ); gl.enableVertexAttribArray(AT.p); gl.vertexAttribPointer(AT.p, 3, gl.FLOAT, false, 0, 0); gl.bindBuffer(gl.ARRAY_BUFFER, galU); gl.enableVertexAttribArray(AT.u); gl.vertexAttribPointer(AT.u, 2, gl.FLOAT, false, 0, 0);
      gl.bindTexture(gl.TEXTURE_2D, galTexO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.disableVertexAttribArray(AT.u); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.useProgram(pr); }
    // an object's place: galaxy view (kpc, around the moving Sun) or nearby-stars view (pc, Sun at the origin)
    function objGal(o) { const [l, b] = galLB(o[1], o[2]), d = o[3] / 1000, S0 = sunGal(), t = -gT / 230 * 2 * Math.PI + .35, c = [-Math.cos(t), 0, Math.sin(t)], r9 = [Math.sin(t), 0, Math.cos(t)];
      return [0, 1, 2].map(i => S0[i] + d * (Math.cos(b) * Math.cos(l) * c[i] + Math.cos(b) * Math.sin(l) * r9[i] + (i === 1 ? Math.sin(b) : 0))); }
    const objStar = o => eqDir(o[1], o[2]).map(v => v * o[3]);
    // the galaxy view shows the near objects (< 1 kpc) only when zoomed in
    function drawObjs(where, maxPc) { g2.font = '600 11px Inter, system-ui, sans-serif'; g2.textBaseline = 'middle';
      OBJ.forEach(o => { if (o[3] > maxPc || (where === objGal && o[3] < 1000 && cam.dist > 6)) return; const q = proj(where(o)); if (!q) return; const R = Math.max(5, Math.min(30, (where === objStar ? 14 : 6) * (o[5] === 'satellite galaxy' ? 4 : 1) * Math.sqrt(H / 600 / Math.max(.05, q[2] / (where === objStar ? 400 : 20)))));
        g2.save(); g2.globalCompositeOperation = 'lighter'; const gg = g2.createRadialGradient(q[0], q[1], 0, q[0], q[1], R); gg.addColorStop(0, `rgba(${o[4]},.9)`); gg.addColorStop(.35, `rgba(${o[4]},.35)`); gg.addColorStop(1, `rgba(${o[4]},0)`);
        g2.fillStyle = gg; g2.beginPath(); g2.arc(q[0], q[1], R, 0, 7); g2.fill(); g2.restore();
        const t = tr(o[0]), w = g2.measureText(t).width, bx = [q[0] + R * .5 + 3, q[1] - 8, w + 8, 16];
        if (freeBox(bx)) { LB.push(bx); g2.fillStyle = 'rgba(0,0,0,.55)'; g2.fillRect(...bx); g2.fillStyle = `rgb(${o[4]})`; g2.fillText(t, q[0] + R * .5 + 7, q[1]); }
        hits.push({ x: q[0], y: q[1], r: Math.max(14, R), obj: o, w: w + 12 + R * .5 }); }); }
    function showObj(o) { const box = el.querySelector('.s3d-info'), ly = Math.round(o[3] * 3.2616);
      box.hidden = false; box.innerHTML = `<button aria-label="${tr('Close')}">✕</button><b>${tr(o[0])}</b><span style="color:rgb(${o[4]})">${tr(o[5])}</span> · ${tr('{n} light years', { n: ly.toLocaleString(window.LOC || 'en-GB') })}<br>${tr(o[6])}`;
      box.querySelector('button').onclick = () => { box.hidden = true; }; }
    // nearby stars: STARS3D (HYG + constellation figures), loaded on first use; positions move with the stars' real space velocities
    function loadStars() { if (window.STARS3D) { starsReady = true; return; } if (loadStars.on) return; loadStars.on = 1; const sc = document.createElement('script'); sc.src = BASE + 'stars3d.js'; sc.onload = () => { starsReady = true; starsAt = -1e9; buildStars(); dirty = true; }; document.head.appendChild(sc); }
    const starP = (i, yr) => { const S = window.STARS3D, k = i * 3; return [S.p[k] + S.v[k] * 1e-6 * yr, S.p[k + 1] + S.v[k + 1] * 1e-6 * yr, S.p[k + 2] + S.v[k + 2] * 1e-6 * yr]; };
    function buildStars() { if (!starsReady) { loadStars(); return; } if (Math.abs(sT - starsAt) < .5) return; starsAt = sT; const S = window.STARS3D, n = S.m.length;
      for (let i = 0; i < n; i++) { const q = starP(i, sT), d = Math.hypot(S.p[i * 3], S.p[i * 3 + 1], S.p[i * 3 + 2]) || 1, Mabs = S.m[i] - 5 * Math.log10(d / 10), c = bvRGB(S.c[i]);
        starB.p.set(q, i * 3); starB.c.set([c[0], c[1], c[2], 1], i * 4); starB.s[i] = Math.min(20000, 300 * Math.pow(10, -.2 * Mabs)); } starB.n = n; upload(starB);
      const ori = new Set((S.cons.find(c => c[0] === 'Orion') || []).slice(2)); let m = 0, mo = 0;
      S.lines.forEach(ch => { const isO = ch.every(i => ori.has(i)); for (let j = 1; j < ch.length; j++) { const a = starP(ch[j - 1], sT), b = starP(ch[j], sT);
        if (isO) { oriB.p.set(a, mo * 3); oriB.p.set(b, mo * 3 + 3); oriB.c.set([1, .78, .45, .8, 1, .78, .45, .8], mo * 4); oriB.s[mo] = oriB.s[mo + 1] = 1; mo += 2; }
        conB.p.set(a, m * 3); conB.p.set(b, m * 3 + 3); conB.c.set([.45, .65, 1, .4, .45, .65, 1, .4], m * 4); conB.s[m] = conB.s[m + 1] = 1; m += 2; } }); conB.n = m; oriB.n = mo; upload(conB); upload(oriB); }
    function drawStarsOv() { const S = window.STARS3D; g2.font = '600 12px Inter, system-ui, sans-serif'; g2.textBaseline = 'middle';
      const o = proj([0, 0, 0]); if (o) { g2.fillStyle = '#FFE600'; g2.beginPath(); g2.arc(o[0], o[1], 4, 0, 7); g2.fill(); g2.strokeStyle = 'rgba(255,230,0,.6)'; g2.beginPath(); g2.arc(o[0], o[1], 9, 0, 7); g2.stroke(); const t = tr('The Sun — we are here'), w = g2.measureText(t).width; LB.push([o[0] + 10, o[1] - 9, w + 10, 18]); g2.fillStyle = 'rgba(0,0,0,.6)'; g2.fillRect(o[0] + 10, o[1] - 9, w + 10, 18); g2.fillStyle = '#FFE600'; g2.fillText(t, o[0] + 15, o[1]); }
      if (!S) { g2.fillStyle = '#C9D1DB'; g2.fillText(tr('LOADING…'), 20, H / 2); return; }
      const farV = Math.hypot(...camEye()) > 25; if (showCon) { g2.font = '700 11px Inter, system-ui, sans-serif'; S.cons.forEach(c => { if (c[1] > 2 || (farV && c[0] !== 'Orion')) return; let x = 0, y = 0, z = 0; const ids = c.slice(2); ids.forEach(i => { const q = starP(i, sT); x += q[0]; y += q[1]; z += q[2]; });
          const q = proj([x / ids.length, y / ids.length, z / ids.length]); if (!q) return; g2.fillStyle = 'rgba(140,175,255,.7)'; g2.textAlign = 'center'; g2.fillText(tr(c[0]).toUpperCase(), q[0], q[1]); g2.textAlign = 'left'; }); }
      g2.save(); g2.globalCompositeOperation = 'lighter';   // a soft glow around the bright stars
      for (let i = 0; i < 160; i++) { const q = proj(starP(i, sT)); if (!q) continue; const R = Math.max(3, Math.min(26, starB.s[i] * dpr * Math.min(W, H) / 900 / q[2] * 1.6)), c = bvRGB(S.c[i]).map(v => Math.round(v * 255)).join(',');
        const gg = g2.createRadialGradient(q[0], q[1], 0, q[0], q[1], R); gg.addColorStop(0, `rgba(${c},.55)`); gg.addColorStop(.25, `rgba(${c},.18)`); gg.addColorStop(1, `rgba(${c},0)`); g2.fillStyle = gg; g2.beginPath(); g2.arc(q[0], q[1], R, 0, 7); g2.fill(); }
      g2.restore();
      if (showNames) { g2.font = '600 11px Inter, system-ui, sans-serif'; Object.keys(S.names).forEach(i => { const q = proj(starP(+i, sT)); if (!q) return; const d = Math.hypot(...starP(+i, 0));
          const t = tr(S.names[i]) + ' · ' + tr('{n} ly', { n: Math.round(d * 3.2616) }), bx = [q[0] + 6, q[1] - 13, g2.measureText(t).width, 14]; if (!freeBox(bx)) return; LB.push(bx);
          g2.fillStyle = 'rgba(230,235,241,.85)'; g2.fillText(t, q[0] + 6, q[1] - 6); }); }
      drawObjs(objStar, 2500); }
    const sunGal = () => { const t = -gT / 230 * 2 * Math.PI + 0.35; return [8.2 * Math.cos(t), .025 + .07 * Math.sin(gT / 70 * 2 * Math.PI), -8.2 * Math.sin(t)]; };   // clockwise seen from the north galactic pole
    function build() { if (mode === 'galaxy') buildGalaxy(); else if (mode === 'stars') buildStars(); else if (mode === 'helix') buildHelix(); }

    function camEye() { const c = cam, cp = Math.cos(c.pitch); return [c.tgt[0] + c.dist * cp * Math.cos(c.yaw), c.tgt[1] + c.dist * Math.sin(c.pitch), c.tgt[2] + c.dist * cp * Math.sin(c.yaw)]; }
    const proj = p => { const x = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], y = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], w = M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15];
      return w <= cam.dist * .01 ? null : [(x / w * .5 + .5) * W, (1 - (y / w * .5 + .5)) * H, w]; };
    let hits = [], LB = [];   // LB: label boxes already drawn this frame (no overlaps)
    const freeBox = b => !LB.some(o => b[0] < o[0] + o[2] && b[0] + b[2] > o[0] && b[1] < o[1] + o[3] && b[1] + b[3] > o[1]);
    function draw() {
      if (cam.goal) { const g = cam.goal; ['dist', 'yaw', 'pitch'].forEach(k => { if (g[k] != null) cam[k] += (g[k] - cam[k]) * .12; }); if (g.tgt) cam.tgt = cam.tgt.map((v, i) => v + (g.tgt[i] - v) * .12);
        const tol = Math.min(.002, (g.dist ?? cam.dist) * .01); if (Math.abs(cam.dist - (g.dist ?? cam.dist)) < tol && (!g.tgt || Math.hypot(...cam.tgt.map((v, i) => v - g.tgt[i])) < tol)) cam.goal = null; dirty = true; }
      if (spin[0] || spin[1]) { cam.yaw += spin[0]; cam.pitch = Math.max(-1.5, Math.min(1.55, cam.pitch + spin[1])); spin = spin.map(v => Math.abs(v) < 1e-4 ? 0 : v * .92); dirty = true; }
      const now = mode === 'helix' ? hTime : time;
      if (cam.follow) { cam.tgt = toHx(planet(cam.follow, now)); }
      const eye = camEye(); M = mul(persp(45 * D2R, W / H, Math.min(.005, cam.dist * .02), 4000), lookAt(eye, cam.tgt, [0, 1, 0])); if (mode === 'helix') M = mul(M, hxMat());
      gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0.02, 0.03, 0.06, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniformMatrix4fv(U.m, false, new Float32Array(M)); gl.uniform1f(U.k, dpr * Math.min(W, H) / 900);
      gl.uniform1f(U.mx, 4 * dpr); gl.uniform1f(U.pt, 1); if (mode !== 'stars') { bind(stars); gl.drawArrays(gl.POINTS, 0, stars.n); }
      if (mode === 'stars') { const far = Math.hypot(...eye) > 25; if (showCon && conB.n) { gl.uniform1f(U.pt, 0); if (!far) { bind(conB); gl.drawArrays(gl.LINES, 0, conB.n); } if (oriB.n) { bind(oriB); gl.drawArrays(gl.LINES, 0, oriB.n); } } if (starB.n) { gl.uniform1f(U.pt, 1); gl.uniform1f(U.mx, 9 * dpr); bind(starB); gl.drawArrays(gl.POINTS, 0, starB.n); } }
      else if (mode === 'galaxy') { drawGalPic(); gl.uniform1f(U.pt, 1); gl.uniform1f(U.mx, 3 * dpr); bind(galB); gl.drawArrays(gl.POINTS, 0, galB.n); gl.uniform1f(U.pt, 0); bind(ring); gl.drawArrays(gl.LINE_STRIP, 0, ring.n); }
      else if (mode === 'helix') { gl.uniform1f(U.pt, 0); bind(trails); for (let i = 0; i <= HX.length; i++) gl.drawArrays(gl.LINE_STRIP, i * HXN, HXN); }
      // overlay: Sun, planets, labels, CME tags
      g2.setTransform(dpr, 0, 0, dpr, 0, 0); g2.clearRect(0, 0, W, H); hits = []; LB = [];
      if (mode === 'stars') { drawStarsOv(); if (info) showInfo(info); dirty = false; return; }
      if (mode === 'galaxy') { g2.font = '700 12px Inter, system-ui, sans-serif'; g2.textBaseline = 'middle';
        const lab = (q, t, col) => { if (!q) return; const w = g2.measureText(t).width; LB.push([q[0] + 9, q[1] - 9, w + 10, 18]); g2.fillStyle = 'rgba(0,0,0,.6)'; g2.fillRect(q[0] + 9, q[1] - 9, w + 10, 18); g2.fillStyle = col; g2.fillText(t, q[0] + 14, q[1]); };
        const sq = proj(sunGal()); if (sq) { g2.fillStyle = '#FFE600'; g2.beginPath(); g2.arc(sq[0], sq[1], 4, 0, 7); g2.fill(); g2.strokeStyle = 'rgba(255,230,0,.6)'; g2.beginPath(); g2.arc(sq[0], sq[1], 9, 0, 7); g2.stroke(); lab(sq, tr('The Sun — we are here'), '#FFE600'); }
        lab(proj([0, 0, 0]), tr('Centre · black hole Sagittarius A*'), '#FFD9A8');
        // arm names: the arm just outside the Sun is Perseus, just inside Sagittarius–Carina, then Scutum–Centaurus; the fourth = Norma / Outer
        const k = 1 / Math.tan(12 * D2R), t0 = -gT / 230 * 2 * Math.PI + .35, rad = a0 => { let best = []; for (let n = -3; n <= 3; n++) { const r = 2.6 * Math.exp((t0 - a0 + 2 * Math.PI * n) / k); if (r > 2.6 && r < 16) best.push(r); } return best; };
        const near = [0, 1.57, 3.14, 4.71].map(a0 => ({ a0, rs: rad(a0) })), out = near.map(o => ({ a0: o.a0, d: Math.min(...o.rs.filter(r => r > 8.2).map(r => r - 8.2), 99) })).sort((a, b) => a.d - b.d), inn = near.map(o => ({ a0: o.a0, d: Math.min(...o.rs.filter(r => r < 8.2).map(r => 8.2 - r), 99) })).sort((a, b) => a.d - b.d);
        const names = new Map(); names.set(out[0].a0, 'Perseus Arm'); if (!names.has(inn[0].a0)) names.set(inn[0].a0, 'Sagittarius–Carina Arm'); const rest = [0, 1.57, 3.14, 4.71].filter(a => !names.has(a)); if (rest[0] != null) names.set(rest[0], 'Scutum–Centaurus Arm'); if (rest[1] != null) names.set(rest[1], 'Norma–Outer Arm');
        g2.font = 'italic 600 12px Inter, system-ui, sans-serif'; names.forEach((nm, a0) => { const r = 12.5, a = a0 + Math.log(r / 2.6) * k, q = proj([r * Math.cos(a), 0, -r * Math.sin(a)]); if (q) { g2.fillStyle = 'rgba(170,200,255,.8)'; g2.textAlign = 'center'; g2.fillText(tr(nm), q[0], q[1]); g2.textAlign = 'left'; } });
        const sp = proj([7.2 * Math.cos(t0 - .02), 0, -7.2 * Math.sin(t0 - .02)]); if (sp) { g2.fillStyle = 'rgba(170,200,255,.7)'; g2.fillText(tr('Orion Spur'), sp[0] + 8, sp[1] + 16); }
        g2.font = '700 12px Inter, system-ui, sans-serif'; drawObjs(objGal, 1e6);
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
        ball(nm, p, q, r, s);
        if (nm === 'Earth') { g2.strokeStyle = 'rgba(90,169,255,.6)'; g2.lineWidth = 1.5; g2.beginPath(); g2.arc(q[0], q[1], r + 4, 0, 7); g2.stroke(); }
        const lab = tr(nm), tw = g2.measureText(lab).width, bx = [q[0] + r + 4, q[1] - 8, tw + 8, 16];
        hits.push({ x: q[0], y: q[1], r: r + 14, name: nm, w: tw + 12 });
        if (boxes.some(b => bx[0] < b[0] + b[2] && bx[0] + bx[2] > b[0] && bx[1] < b[1] + b[3] && bx[1] + bx[3] > b[1]) && nm !== 'Earth') return; boxes.push(bx);
        g2.fillStyle = 'rgba(0,0,0,.55)'; g2.fillRect(...bx); g2.fillStyle = nm === 'Earth' ? '#9CCBFF' : '#DCE3EB'; g2.fillText(lab, q[0] + r + 8, q[1]); });
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
    // what each planet's field is like (the info card when you tap it) — and the Sun's own card
    const FIELD = { Mercury: 'A weak field, 1% of Earth’s; the solar wind almost touches the ground.', Venus: 'No global magnetic field: the solar wind strips its upper air directly.',
      Earth: 'Our shield: the magnetopause stands ~10 Earth radii towards the Sun, the tail stretches past the Moon. Where the field lines reach the poles: auroras.',
      Mars: 'Lost its global field ~4 billion years ago — and most of its atmosphere with it.', Jupiter: 'The biggest magnetosphere in the system: if we could see it, it would look bigger than the full Moon in our sky.',
      Saturn: 'Its field is almost perfectly lined up with its spin axis.', Uranus: 'Tilted ~60° and off-centre: its magnetosphere tumbles as it turns.', Neptune: 'Tilted ~47° and off-centre, like Uranus.' };
    // latest pictures in the planet card: Earth = today's whole-disc photo from DSCOVR / EPIC (1.5 million km away);
    // the others = the newest NASA Image Library pictures whose title names the planet (both send CORS *), cached per planet
    const PHOTO = {};
    const PHN = {};   // one DOM node per planet, re-attached each time the card redraws (so the pictures don't reload)
    function photoNode(nm) { if (PHN[nm]) return PHN[nm]; const host = PHN[nm] = document.createElement('div'); host.className = 's3d-ph'; host.innerHTML = `<div class="s3d-phl">${tr('Latest pictures')} · ${tr('loading…')}</div>`; photos(nm, host); return host; }
    async function photos(nm, host) {
      try {
        if (!PHOTO[nm]) {
          if (nm === 'Earth') { const r = await (await fetch('https://epic.gsfc.nasa.gov/api/natural')).json();
            PHOTO[nm] = r.slice(-4).reverse().map(x => { const d = x.date.slice(0, 10).replace(/-/g, '/'); return { t: x.date.slice(0, 16), cap: tr('Earth from DSCOVR, 1.5 million km away'), src: `https://epic.gsfc.nasa.gov/archive/natural/${d}/thumbs/${x.image}.jpg`, href: `https://epic.gsfc.nasa.gov/archive/natural/${d}/png/${x.image}.png` }; }); }
          else { const r = await (await fetch(`https://images-api.nasa.gov/search?keywords=${encodeURIComponent(nm)}&media_type=image&year_start=2012`)).json(), seen = new Set();
            PHOTO[nm] = r.collection.items.filter(x => x.links && x.data[0].title.toLowerCase().includes(nm.toLowerCase()) && !seen.has(x.data[0].title) && seen.add(x.data[0].title))
              .sort((a, b) => b.data[0].date_created.localeCompare(a.data[0].date_created)).slice(0, 4)
              .map(x => ({ t: x.data[0].date_created.slice(0, 10), cap: x.data[0].title, src: x.links[0].href, href: `https://images.nasa.gov/details/${encodeURIComponent(x.data[0].nasa_id)}` })); } }
        const L = PHOTO[nm]; if (!L.length) { host.innerHTML = ''; return; }
        host.innerHTML = `<div class="s3d-phl">${tr('Latest pictures')} · NASA</div><div class="s3d-phg">` + L.map(x => `<a href="${x.href}" target="_blank" rel="noopener" title="${x.cap.replace(/"/g, '&quot;')}"><img src="${x.src}" alt="${x.cap.replace(/"/g, '&quot;')}" loading="lazy"><span>${x.t}</span></a>`).join('') + `</div>`;
      } catch (e) { host.innerHTML = ''; } }
    function showInfo(nm) { if (nm === 'Sun') return;
      const box = el.querySelector('.s3d-info'), t = mode === 'helix' ? hTime : time, p = planet(nm, t), r = Math.hypot(...p), a = EL[nm][0][0], v = 29.78 * Math.sqrt(2 / r - 1 / a), E = planet('Earth', t), de = Math.hypot(p[0] - E[0], p[1] - E[1], p[2] - E[2]);
      box.hidden = false; box.innerHTML = `<button aria-label="${tr('Close')}">✕</button><b>${tr(nm)}</b>${tr('From the Sun')}: ${r.toFixed(2)} AU · ${Math.round(r * 149.6)} ${tr('million km')}<br>${tr('Speed on its orbit')}: ${v.toFixed(1)} km/s<br>${tr('Sunlight needs')} ${(r * 8.317).toFixed(1)} min`
        + (FIELD[nm] ? `<br><span style="color:#9FE8C8">🧲 ${tr(FIELD[nm])}</span>` : '') + (nm !== 'Earth' ? `<br>${tr('From Earth')}: ${de.toFixed(2)} AU` : (window.Earth3D ? `<br><button class="s3d-goearth" style="float:none;margin:6px 0 0;border:1px solid #39FF9E;color:#39FF9E;border-radius:999px;padding:5px 10px;font:600 12px Inter,system-ui,sans-serif">${tr('Fly down to Earth')} ›</button>` : '')) + `<br><small style="color:#8E9AAB">${tr('The camera follows it — drag to look around.')}</small>`;
      const ge = box.querySelector('.s3d-goearth'); if (ge) ge.onclick = () => setMode('earth');
      box.appendChild(photoNode(nm));   // the latest pictures (kept between redraws)
      box.querySelector('button').onclick = () => { info = null; box.hidden = true; cam.follow = null; view(mode === 'helix' ? 'hx' : mode === 'galaxy' ? 'gx' : mode === 'stars' ? 'st' : 'inner'); };
    }
    function frame(ts) {
      const dt = Math.min(100, ts - (hLast || ts)) / 1000; hLast = ts;
      if (!REDUCED) ph += dt * Math.min(1, rate);   // the wind's shimmer + the shield's particles (slow motion slows them too)
      if (hPlay && mode !== 'earth' && dt > 0) { const sim = dt * rate * hDir; watch += Math.abs(sim);   // simulated seconds this frame
        if (mode === 'stars') { sT += sim / YEAR; if (ts - tAt > 250) { buildStars(); hDate(); tAt = ts; dirty = true; } }
        else if (mode === 'galaxy') { gT += sim / (1e6 * YEAR); if (ts - tAt > 250 || rate > 1e9) { hDate(); tAt = ts; dirty = true; } }
        else if (mode === 'helix') { hTime += sim * 1000; if (ts - hbAt > (rate > 3600 ? 40 : 1000)) { buildHelix(); hbAt = ts; dirty = true; } if (ts - tAt > 250) { hDate(); tAt = ts; } } }
      if (mode !== 'earth' && mode !== 'wait' && visible && !(opts.paused && opts.paused()) && (dirty || cam.goal || spin[0] || spin[1])) draw(); requestAnimationFrame(frame); }
    const kmTxt = km => km < 1e6 ? tr('{n} km', { n: Math.round(km).toLocaleString(window.LOC || 'en-GB') }) : km < 1.5e9 ? tr('{n} million km', { n: +(km / 1e6).toPrecision(3) }) : km < 9.46e12 ? tr('{n} AU', { n: +(km / AU_KM).toPrecision(3) }) : tr('{n} light years', { n: +(km / 9.4607e12).toPrecision(3) });
    function rateTxt(r) { const a = Math.abs(r); if (Math.abs(a - 1) < .03) return tr('REAL TIME'); if (a < 1) return tr('SLOW MO ×{n}', { n: a.toFixed(a < .3 ? 2 : 1) });
      for (const [d, k] of [[1e6 * YEAR, '{n} million years/s'], [YEAR, '{n} years/s'], [86400, '{n} days/s'], [3600, '{n} h/s'], [60, '{n} min/s']]) if (a >= d) return tr(k, { n: +(a / d).toPrecision(2) });
      return '×' + Math.round(a); }
    function rateUI() { el.querySelector('.s3d-rl').textContent = (hPlay ? (hDir < 0 ? '◀ ' : '▶ ') : '⏸ ') + rateTxt(rate);
      const b = el.querySelector('.s3d-hplay'); b.textContent = hPlay ? '⏸' : '▶'; b.setAttribute('aria-label', hPlay ? tr('Pause') : tr('Play')); }
    function step(d) { const L = ladder(), cur = hDir * rate; let i = L.findIndex(x => Math.abs(x - cur) < Math.abs(cur) * .01 + 1e-9); if (i < 0) i = L.indexOf(1);
      i = Math.max(0, Math.min(L.length - 1, i + d)); hDir = L[i] < 0 ? -1 : 1; rate = Math.abs(L[i]); hPlay = true; hLast = 0; rateUI(); }
    function hDate() { const hd = el.querySelector('.s3d-hdate'); if (hd && document.activeElement !== hd && mode === 'helix') { try { hd.value = new Date(hTime).toISOString().slice(0, 10); } catch (e) {} }
      if (mode === 'stars') { const y = Math.round(sT); el.querySelector('.s3d-t').textContent = Math.abs(y) < 1 ? tr('Today') : y > 0 ? tr('In {n} years', { n: y.toLocaleString(window.LOC || 'en-GB') }) : tr('{n} years ago', { n: (-y).toLocaleString(window.LOC || 'en-GB') });
        el.querySelector('.s3d-sub').textContent = tr('naked-eye stars at their real distances · speed up time to see the constellations change'); return; }
      const moved = tr('{d} since you started watching', { d: kmTxt(watch * (mode === 'galaxy' ? 230 : TRAVEL[frameK].v)) });
      if (mode === 'galaxy') { const y = gT * 1e6; el.querySelector('.s3d-t').textContent = Math.abs(y) < 1 ? tr('Today') : Math.abs(gT) < 1 ? (y > 0 ? tr('In {n} years', { n: Math.round(y).toLocaleString(window.LOC || 'en-GB') }) : tr('{n} years ago', { n: Math.round(-y).toLocaleString(window.LOC || 'en-GB') })) : gT > 0 ? tr('In {n} million years', { n: Math.round(gT) }) : tr('{n} million years ago', { n: Math.round(-gT) });
        el.querySelector('.s3d-sub').textContent = (Math.abs(gT) < .01 ? tr('the Sun circles the galaxy at 230 km/s') + ' · ' + moved : tr('one lap around the galaxy ≈ 230 million years · up and down through the disc every ~70')); return; }
      el.querySelector('.s3d-t').textContent = rate > 86400 * 20 ? new Date(hTime).toLocaleDateString(window.LOC || 'en-GB', { month: 'long', year: 'numeric' }) : new Date(hTime).toLocaleString(window.LOC || 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: rate < 60 ? '2-digit' : undefined });
      el.querySelector('.s3d-sub').textContent = tr('the Sun moves {d} AU a year', { d: (kmsAU(TRAVEL[frameK].v) * 365.25).toFixed(1) }) + ' · ' + moved; }
    function resize() { const r = el.getBoundingClientRect(); W = Math.max(200, el.clientWidth || r.width); H = Math.max(200, el.clientHeight || r.height); /* layout size: a scaled-down tile would shrink the rect */ dpr = Math.min(2, devicePixelRatio || 1);
      [cv, ov].forEach(c => { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }); dirty = true; }
    function setTime(t) { if (isFinite(t)) time = t; }
    function view(v) { cam.follow = null; spin = [0, 0];
      if (v === 'st' || mode === 'stars') { const o = eqDir(83.8, -5.4); if (v === 'orion') cam.goal = { tgt: o.map(x => x * 330), dist: 520, pitch: .25, yaw: Math.atan2(o[2], o[0]) + Math.PI / 2 };
        else if (v === 'far') cam.goal = { tgt: [0, 0, 0], dist: 650, pitch: .6, yaw: Math.atan2(-o[2], -o[0]) + .5 };
        else cam.goal = { tgt: o.map(x => x * 3), dist: 3.6, pitch: Math.asin(-o[1]) + .12, yaw: Math.atan2(-o[2], -o[0]) }; dirty = true; return; }   // just behind the Sun, looking at Orion
      if (v === 'gx' || (mode === 'galaxy' && v === 'inner')) { cam.goal = { tgt: [0, 0, 0], dist: 34, pitch: .85, yaw: -0.6 }; dirty = true; return; }
      if (v === 'hx' || (mode === 'helix' && v === 'inner')) {   // frame the inner planets' last ~2 years (lsr) / ~1 year (galaxy), seen from the side
        const T = TRAVEL[frameK], d = T.dir, V = d.map(x => x * kmsAU(T.v)), span = (frameK === 'lsr' ? 2.4 : 1.1) * 365.25, P = [[0, 0, 0]];
        ['Mercury', 'Venus', 'Earth', 'Mars'].forEach(nm => { for (let i = 0; i <= 40; i++) { const dd = -span * i / 40, q = planet(nm, hTime + dd * DAY); P.push([q[0] + V[0] * dd, q[1] + V[1] * dd, q[2] + V[2] * dd]); } });
        const c = [0, 1, 2].map(k => P.reduce((a, q) => a + q[k], 0) / P.length), rad = Math.max(...P.map(q => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2])));
        const tg = toHx(c); tg[0] += rad * .3; cam.goal = { tgt: tg, dist: rad / Math.tan(22.5 * D2R) / Math.max(1, Math.min(1.6, W / H)) * 1.15, pitch: .18, yaw: Math.PI / 2 }; dirty = true; return; }
      dirty = true; }
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
        if (now - lastTap < 320) { lastTap = 0; info = null; el.querySelector('.s3d-info').hidden = true; view(mode === 'helix' ? 'hx' : mode === 'galaxy' ? 'gx' : mode === 'stars' ? 'st' : 'inner'); return; } lastTap = now;
        const h = hits.find(h => Math.hypot(h.x - x, h.y - y) < h.r || (h.w && x > h.x && x < h.x + h.w + 10 && Math.abs(y - h.y) < 10));
        if (h && h.obj) { showObj(h.obj); return; }
        if (h && h.name !== 'Sun') { cam.follow = null; const p = planet(h.name, mode === 'helix' ? hTime : time); cam.goal = { tgt: toHx(p), dist: Math.max(.25, Math.hypot(...p) * .25) }; info = h.name; setTimeout(() => { if (info === h.name) cam.follow = h.name; }, 900); dirty = true; }
        else if (h) { info = null; el.querySelector('.s3d-info').hidden = true; view(mode === 'helix' ? 'hx' : mode === 'galaxy' ? 'gx' : mode === 'stars' ? 'st' : 'inner'); } } };
    ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
    const zoom = f => { if (performance.now() - modeAt < 900) return;   // let the hand-over flight finish (wheel momentum would carry on)
      cam.goal = null; setDist(cam.dist * f); dirty = true; };
    // one zoom from the ground to the galaxy: Earth ⇄ solar system (zoom in on Earth) ⇄ galaxy (past 400 AU / below 0.3 kpc)
    let modeAt = 0;
    function setDist(d) {
      if (performance.now() - modeAt > 700) {
        if (mode === 'stars' && d > 800) return jump('galaxy');
        if (mode === 'stars' && d < .01 && window.Earth3D) { setMode('earth', true); if (earth) earth.start('sys'); return; }
        if (mode === 'galaxy' && d < .3) return jump('stars'); }
      if (mode === 'stars' && d < cam.dist && d < 2) { const k = Math.min(.5, (cam.dist - d) / cam.dist * 1.5); cam.follow = null; cam.tgt = cam.tgt.map(v => v * (1 - k)); }
      cam.dist = Math.max(mode === 'stars' ? .005 : .08, Math.min(mode === 'galaxy' ? 70 : mode === 'stars' ? 800 : 400, d)); }
    function jump(m) {
      const from = mode; setMode(m, true);
      if (m === 'galaxy') { cam.tgt = sunGal(); cam.dist = .8; }                          // start at the Sun, fly out to the whole Milky Way
      else if (m === 'stars' && from === 'galaxy') { cam.tgt = [0, 0, 0]; cam.dist = 780; cam.goal = { dist: 300 }; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); z0 = cam.dist; }
      dirty = true; }
    ov.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(e.deltaY * .0012)); }, { passive: false });
    el.querySelectorAll('[data-z]').forEach(b => b.onclick = () => zoom(+b.dataset.z > 0 ? 1.35 : 1 / 1.35));
    el.querySelector('.s3d-reset').onclick = () => { info = null; el.querySelector('.s3d-info').hidden = true; view(mode === 'helix' ? 'hx' : mode === 'galaxy' ? 'gx' : mode === 'stars' ? 'st' : 'inner'); };
    el.querySelector('.s3d-q').onclick = () => { const h = el.querySelector('.s3d-help'); h.hidden = !h.hidden; };
    el.querySelector('.s3d-hx-x').onclick = () => { el.querySelector('.s3d-help').hidden = true; };
    el.tabIndex = 0;
    el.addEventListener('keydown', e => { const k = e.key; if (/^Arrow/.test(k)) { e.preventDefault(); if (k === 'ArrowLeft') cam.yaw -= .08; if (k === 'ArrowRight') cam.yaw += .08; if (k === 'ArrowUp') cam.pitch = Math.min(1.55, cam.pitch + .06); if (k === 'ArrowDown') cam.pitch = Math.max(-1.5, cam.pitch - .06); cam.goal = null; dirty = true; }
      else if (k === '+' || k === '=') zoom(1 / 1.2); else if (k === '-') zoom(1.2); else if (k === 'r' || k === 'R') view(mode === 'helix' ? 'hx' : mode === 'galaxy' ? 'gx' : mode === 'stars' ? 'st' : 'inner');
      else if (k === ' ' && mode !== 'earth') { e.preventDefault(); togglePlay(); } else if ((k === '.' || k === 'l' || k === 'L') && mode !== 'earth') step(1); else if ((k === ',' || k === 'j' || k === 'J') && mode !== 'earth') step(-1); else if (k === 'Escape' && el.classList.contains('s3d-fs')) el.querySelector('.s3d-full').click(); });
    // modes
    const togglePlay = () => { hPlay = !hPlay; hLast = 0; rateUI(); };
    el.querySelector('.s3d-hplay').onclick = togglePlay;
    el.querySelector('.s3d-fwd').onclick = () => step(1); el.querySelector('.s3d-back').onclick = () => step(-1);
    // NOW: back to this moment, real time, forwards
    el.querySelector('.s3d-now').onclick = () => { rate = 1; hDir = 1; hPlay = true; watch = 0; if (mode === 'galaxy') { gT = 0; hDate(); } else if (mode === 'helix') { hTime = Date.now(); buildHelix(); hDate(); } else setTime(Date.now()); rateUI(); dirty = true; };
    el.querySelector('.s3d-hdate').onchange = e => { const t = Date.parse(e.target.value + 'T12:00:00Z'); if (isFinite(t)) { hTime = t; buildHelix(); hDate(); dirty = true; } };
    el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { frameK = b.dataset.f; el.querySelectorAll('[data-f]').forEach(o => o.setAttribute('aria-pressed', o === b)); buildHelix(); hDate(); view('hx'); });
    let earth = null;
    // the solar system is the three.js scene: without WebGL2 only the stars, the galaxy and the spiral are left
    const noGL = () => { el.querySelector('.s3d-t').textContent = tr('The 3D solar system needs WebGL2 — not available in this browser.'); el.querySelector('.s3d-sub').textContent = tr('Nearby stars, the galaxy and the spiral still work.'); };
    function setMode(m, far) { modeAt = performance.now();
      if (m === 'earth') { if (!window.Earth3D) return noGL(); if (!earth) try { earth = Earth3D.create(el, { wind: () => series, cmes: () => donki, places: opts.places ? opts.places() : [], time: () => Date.now(),   // its own clock: real time (or the date picked in it), not the page's playing clock — a forecast time has no pictures yet
 aurora: opts.aurora, paused: opts.paused, onOut: null }); } catch (e) { return noGL(); }   // flies out into the shield view   // fly out from Earth, still following it
        mode = 'earth'; el.classList.add('ea'); el.classList.remove('hx'); el.querySelectorAll('[data-m]').forEach(o => o.setAttribute('aria-pressed', o.dataset.m === m)); info = null;
        const pl = opts.places ? opts.places()[0] : null; if (opts.places) earth.setPlaces(opts.places()); earth.show(pl ? pl.lat : 45.6, pl ? pl.lon : 25.6, far); return; }
      if (earth) earth.hide(); el.classList.remove('ea');
      mode = m; el.classList.toggle('hx', m === 'helix'); el.classList.toggle('gx', m === 'galaxy');
      rate = 1; hDir = 1; hPlay = true; watch = 0; rateUI();   // every view starts in real time
      el.classList.toggle('st', m === 'stars');
      if (m === 'stars') { el.querySelectorAll('[data-m]').forEach(o => o.setAttribute('aria-pressed', o.dataset.m === m)); info = null; el.querySelector('.s3d-info').hidden = true; sT = 0; starsAt = -1e9; buildStars(); hDate(); if (!far) view('st'); dirty = true; return; }
      if (m === 'galaxy') { el.querySelectorAll('[data-m]').forEach(o => o.setAttribute('aria-pressed', o.dataset.m === m)); info = null; el.querySelector('.s3d-info').hidden = true; gT = 0; buildGalaxy(); hDate(); view('gx'); dirty = true; return; } el.querySelectorAll('[data-m]').forEach(o => o.setAttribute('aria-pressed', o.dataset.m === m)); info = null; el.querySelector('.s3d-info').hidden = true;
      if (m === 'helix') { hTime = Date.now(); buildHelix(); hDate(); view('hx'); } dirty = true; }
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => setMode(b.dataset.m));
    el.querySelectorAll('[data-sv]').forEach(b => b.onclick = () => view(b.dataset.sv === 'sun' ? 'st' : b.dataset.sv));
    el.querySelector('.s3d-con').onclick = e => { showCon = !showCon; e.currentTarget.setAttribute('aria-pressed', showCon); dirty = true; };
    el.querySelector('.s3d-nam').onclick = e => { showNames = !showNames; e.currentTarget.setAttribute('aria-pressed', showNames); dirty = true; };
    el.querySelector('.s3d-full').onclick = () => { el.classList.toggle('s3d-fs'); document.body.classList.toggle('s3d-lock', el.classList.contains('s3d-fs')); setTimeout(resize, 60); };
    if (window.ResizeObserver) new ResizeObserver(resize).observe(el); else addEventListener('resize', resize);
    if (window.IntersectionObserver) new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) dirty = true; }).observe(el);
    rateUI(); resize(); setWind(opts.wind); setCmes(opts.cmes); setTime(opts.time || Date.now()); requestAnimationFrame(frame);
    // ⚙ "3D starts on" (aurora.s3dstart: shield / earth / sys / last): the three.js scene starts as soon as the 3D is on screen,
    // live in the board tile too; light mode keeps the tile still: the last picture of the scene (aurora.s3dsnap) until it is opened big
    const snap = document.createElement('img'); snap.className = 's3d-snap'; snap.alt = ''; snap.hidden = true; el.appendChild(snap);
    { let wt = 0; const iv = setInterval(() => { const lt = document.documentElement.classList.contains('lite') && !!el.closest('.tls'); let sv = null;
        if (lt && mode !== 'earth') try { sv = localStorage.getItem('aurora.s3dsnap'); } catch (e) {}
        if (sv && snap.src !== sv) snap.src = sv; snap.hidden = !sv;
        if (sv || !el.offsetParent || mode !== 'wait') return; if (!window.Earth3D) { if (++wt > 30) { clearInterval(iv); noGL(); } return; } clearInterval(iv); snap.hidden = true; if (opts.noAuto3d) return;
        let v = 'shield'; try { v = localStorage.getItem('aurora.s3dstart') || 'shield'; if (v === 'last') v = localStorage.getItem('aurora.s3dlast') || 'shield'; } catch (e) {}
        setMode('earth'); if (earth) earth.start(v); }, 500); }
    return { setTime, setWind: s => { setWind(s); setTime(time); }, setCmes: c => { setCmes(c); setTime(time); }, view, resize, canvas: () => { draw(); const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; const g = c.getContext('2d'); g.drawImage(cv, 0, 0); g.drawImage(ov, 0, 0); return c; } };
  }
  window.Space3D = { create, planet };
})();
