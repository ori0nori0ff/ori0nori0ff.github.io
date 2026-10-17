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
.s3d-btns button,.s3d-full{border:1px solid rgba(255,255,255,.18);background:rgba(10,14,20,.75);color:#E6EBF1;border-radius:999px;padding:7px 12px;min-height:36px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}
.s3d-full{position:absolute;right:10px;top:10px;width:40px;padding:0;font-size:17px}
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
      <div class="s3d-btns"><button data-v="inner">${tr('Inner planets')}</button><button data-v="all">${tr('Whole system')}</button><button data-v="earth">${tr('From Earth')}</button><button data-v="top">${tr('From above')}</button></div>
      <button class="s3d-full" aria-label="${tr('Full screen')}">⛶</button>
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
    let vtab = new Float32Array(360).fill(400), ntab = new Float32Array(360).fill(5), known = new Uint8Array(360), cmes = [], time = Date.now();
    // camera
    const cam = { yaw: -0.6, pitch: 0.55, dist: 3.4, tgt: [0, 0, 0], goal: null };
    let W = 0, H = 0, dpr = 1, M = null, dirty = true, visible = true;

    function setWind(series) {   // trace each at-Earth sample back to the solar longitude (co-rotating) its wind left from
      const sum = new Float32Array(360), cnt = new Float32Array(360), nsum = new Float32Array(360);
      (series || []).forEach(p => { if (!(p.v > 100)) return; const t = p.t, E = planet('Earth', t), r = Math.hypot(E[0], E[2]);
        const psi = lonOf(E) - OMEGA * (t / DAY) + OMEGA * r / kmsAU(p.v); let b = Math.round(((psi / D2R) % 360 + 360) % 360) % 360;
        sum[b] += p.v; nsum[b] += p.n || 5; cnt[b]++; });
      known = new Uint8Array(360); const v = new Float32Array(360), n = new Float32Array(360);
      for (let b = 0; b < 360; b++) if (cnt[b]) { v[b] = sum[b] / cnt[b]; n[b] = nsum[b] / cnt[b]; known[b] = 1; }
      for (let b = 0; b < 360; b++) if (!known[b]) {   // gaps: blend towards a calm 400 km/s with distance from known data
        let d = 1; while (d < 180 && !known[(b + d) % 360] && !known[(b - d + 360) % 360]) d++;
        const nb = known[(b + d) % 360] ? (b + d) % 360 : (b - d + 360) % 360, f = d >= 180 ? 1 : Math.min(1, d / 25);
        v[b] = d >= 180 ? 400 : v[nb] * (1 - f) + 400 * f; n[b] = d >= 180 ? 5 : n[nb] * (1 - f) + 5 * f; }
      for (let pass = 0; pass < 2; pass++) for (let b = 0; b < 360; b++) v[b] = (v[(b + 359) % 360] + 2 * v[b] + v[(b + 1) % 360]) / 4;
      vtab = v; ntab = n; dirty = true;
    }
    function setCmes(list) { cmes = (list || []).filter(c => c.v > 0); dirty = true; }

    function build() {
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
      if (cam.follow) { cam.tgt = planet(cam.follow, time); }
      const eye = camEye(); M = mul(persp(45 * D2R, W / H, 0.005, 2000), lookAt(eye, cam.tgt, [0, 1, 0]));
      gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0.02, 0.03, 0.06, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniformMatrix4fv(U.m, false, new Float32Array(M)); gl.uniform1f(U.k, dpr * Math.min(W, H) / 900);
      gl.uniform1f(U.mx, 4 * dpr); gl.uniform1f(U.pt, 1); bind(stars); gl.drawArrays(gl.POINTS, 0, stars.n);
      gl.uniform1f(U.pt, 0); bind(orbits); for (let i = 0; i < ORB.length; i++) gl.drawArrays(gl.LINE_STRIP, i * 181, 181);
      gl.uniform1f(U.pt, 1); gl.uniform1f(U.mx, 7 * dpr); bind(wind); gl.drawArrays(gl.POINTS, 0, wind.n); gl.uniform1f(U.mx, 6 * dpr); bind(cmeB); gl.drawArrays(gl.POINTS, 0, cmeB.n);
      // overlay: Sun, planets, labels, CME tags
      g2.setTransform(dpr, 0, 0, dpr, 0, 0); g2.clearRect(0, 0, W, H); hits = [];
      const s = proj([0, 0, 0]);
      if (s) { const R = Math.max(5, 0.05 * H / s[2] * 2.4); g2.globalCompositeOperation = 'lighter';
        let gr = g2.createRadialGradient(s[0], s[1], 0, s[0], s[1], R * 4); gr.addColorStop(0, 'rgba(255,200,90,.55)'); gr.addColorStop(.3, 'rgba(255,140,40,.18)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
        g2.fillStyle = gr; g2.beginPath(); g2.arc(s[0], s[1], R * 4, 0, 7); g2.fill(); g2.globalCompositeOperation = 'source-over';
        gr = g2.createRadialGradient(s[0] - R * .2, s[1] - R * .2, 0, s[0], s[1], R); gr.addColorStop(0, '#FFF6D8'); gr.addColorStop(.7, '#FFC24A'); gr.addColorStop(1, '#FF8A1E');
        g2.fillStyle = gr; g2.beginPath(); g2.arc(s[0], s[1], R, 0, 7); g2.fill(); hits.push({ x: s[0], y: s[1], r: R + 6, name: 'Sun' }); }
      g2.font = '600 12px Inter, system-ui, sans-serif'; g2.textBaseline = 'middle'; const boxes = [];
      ['Earth'].concat(ORB.filter(n => n !== 'Earth')).forEach(nm => { const p = planet(nm, time), q = proj(p); if (!q) return; const r = Math.max(2.5, EL[nm][3] * Math.min(1.8, 1.6 / Math.sqrt(q[2])));
        g2.fillStyle = EL[nm][2]; g2.beginPath(); g2.arc(q[0], q[1], r, 0, 7); g2.fill();
        if (nm === 'Earth') { g2.strokeStyle = 'rgba(90,169,255,.6)'; g2.lineWidth = 1.5; g2.beginPath(); g2.arc(q[0], q[1], r + 4, 0, 7); g2.stroke(); }
        const lab = tr(nm), tw = g2.measureText(lab).width, bx = [q[0] + r + 4, q[1] - 8, tw + 8, 16];
        hits.push({ x: q[0], y: q[1], r: r + 14, name: nm, w: tw + 12 });
        if (boxes.some(b => bx[0] < b[0] + b[2] && bx[0] + bx[2] > b[0] && bx[1] < b[1] + b[3] && bx[1] + bx[3] > b[1]) && nm !== 'Earth') return; boxes.push(bx);
        g2.fillStyle = 'rgba(0,0,0,.55)'; g2.fillRect(...bx); g2.fillStyle = nm === 'Earth' ? '#9CCBFF' : '#DCE3EB'; g2.fillText(lab, q[0] + r + 8, q[1]); });
      (build.active || []).forEach(({ c, r, ax }) => { const q = proj(ax.map(x => x * r)); if (!q) return; const lab = 'CME ' + Math.round(c.v) + ' km/s';
        g2.fillStyle = 'rgba(0,0,0,.6)'; const tw = g2.measureText(lab).width; g2.fillRect(q[0] + 6, q[1] - 8, tw + 8, 16); g2.fillStyle = '#FFE2C2'; g2.fillText(lab, q[0] + 10, q[1]); });
      dirty = false;
    }
    function frame() { if (visible && (dirty || cam.goal || cam.follow && dirty)) draw(); requestAnimationFrame(frame); }
    function resize() { const r = el.getBoundingClientRect(); W = Math.max(200, r.width); H = Math.max(200, r.height); dpr = Math.min(2, devicePixelRatio || 1);
      [cv, ov].forEach(c => { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }); dirty = true; }
    function setTime(t) { if (!isFinite(t)) return; time = t; el.querySelector('.s3d-t').textContent = new Date(t).toLocaleString(window.LOC || 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: opts.tz ? opts.tz() : undefined });
      const E = planet('Earth', t), q = cmes.filter(c => { const r = 0.1 + kmsAU(c.v) * (t - c.t) / DAY; return r > 0 && r < 3.4; }).length;
      el.querySelector('.s3d-sub').textContent = tr('wind at Earth ≈ {v} km/s', { v: Math.round(vtab[Math.round((((lonOf(E) - OMEGA * t / DAY) / D2R) % 360 + 360) % 360) % 360]) }) + (q ? ' · ' + tr('{n} CME in flight', { n: q }) : '');
      build(); dirty = true; }
    const VIEWS = { inner: { dist: 3.4, pitch: .55, tgt: [0, 0, 0] }, all: { dist: 62, pitch: .7, tgt: [0, 0, 0] }, top: { dist: 4.2, pitch: 1.5, tgt: [0, 0, 0] } };
    function view(v) { cam.follow = null;
      if (v === 'earth') { const E = planet('Earth', time); const lon = lonOf(E); cam.goal = { tgt: [0, 0, 0], dist: Math.hypot(E[0], E[2]) * 1.35, pitch: .12, yaw: -lon }; }
      else cam.goal = Object.assign({}, VIEWS[v] || VIEWS.inner); dirty = true; }
    // controls: drag = turn, wheel / pinch = zoom, tap a planet = fly to it
    const pts = new Map(); let d0 = 0, z0 = 0, moved = 0;
    ov.addEventListener('pointerdown', e => { ov.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); z0 = cam.dist; } });
    ov.addEventListener('pointermove', e => { const p = pts.get(e.pointerId); if (!p) return; const dx = e.clientX - p[0], dy = e.clientY - p[1]; pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) { cam.yaw += dx * .006; cam.pitch = Math.max(-1.5, Math.min(1.55, cam.pitch + dy * .006)); moved += Math.abs(dx) + Math.abs(dy); cam.goal = null; dirty = true; }
      else if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); cam.dist = Math.max(.08, Math.min(120, z0 * d0 / Math.max(10, d))); moved = 99; cam.goal = null; dirty = true; } });
    const up = e => { pts.delete(e.pointerId); if (moved < 6 && e.type === 'pointerup') { const r = ov.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        const h = hits.find(h => Math.hypot(h.x - x, h.y - y) < h.r || (h.w && x > h.x && x < h.x + h.w + 10 && Math.abs(y - h.y) < 10));
        if (h && h.name !== 'Sun') { cam.follow = null; const p = planet(h.name, time); cam.goal = { tgt: p, dist: Math.max(.25, Math.hypot(...p) * .25) }; setTimeout(() => { cam.follow = h.name; }, 900); }
        else if (h) view('inner'); } };
    ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
    ov.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.max(.08, Math.min(120, cam.dist * Math.exp(e.deltaY * .0012))); cam.goal = null; dirty = true; }, { passive: false });
    el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => view(b.dataset.v));
    el.querySelector('.s3d-full').onclick = () => { el.classList.toggle('s3d-fs'); document.body.classList.toggle('s3d-lock', el.classList.contains('s3d-fs')); setTimeout(resize, 60); };
    if (window.ResizeObserver) new ResizeObserver(resize).observe(el); else addEventListener('resize', resize);
    if (window.IntersectionObserver) new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) dirty = true; }).observe(el);
    resize(); setWind(opts.wind); setCmes(opts.cmes); setTime(opts.time || Date.now()); requestAnimationFrame(frame);
    return { setTime, setWind: s => { setWind(s); setTime(time); }, setCmes: c => { setCmes(c); setTime(time); }, view, resize, canvas: () => { draw(); const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; const g = c.getContext('2d'); g.drawImage(cv, 0, 0); g.drawImage(ov, 0, 0); return c; } };
  }
  window.Space3D = { create, planet };
})();
