/* PowHau · Earth up close (plain WebGL 1, no libraries) — the "Earth" mode of space3d.js, app + public page.
   A globe built from Web-Mercator tiles (quadtree, more detail as you zoom): NASA GIBS Blue Marble or today's VIIRS
   true colour (with today's clouds) up to z 8–9, then Sentinel-2 cloudless (EOX, ~10 m) up to z 15; NASA Black
   Marble city lights on the night side; day / night from the real Sun position; a thin atmosphere; pins.
   Earth3D.create(el, { places: [{name, lat, lon}], time: () => ms, onBack }) → { show(), hide(), setTime(t), flyTo(lat, lon, km) } */
(function () {
  'use strict';
  const tr = (s, o) => window.T ? window.T(s, o) : String(s).replace(/\{(\w+)\}/g, (m, k) => o && o[k] != null ? o[k] : m);
  const D2R = Math.PI / 180, R_KM = 6371, MAXLAT = 85.05113;
  const day = t => new Date(Date.now() - t < 2 * 864e5 ? t - 864e5 : t).toISOString().slice(0, 10);   // recent → yesterday (today's VIIRS mosaic fills during the day); a chosen past date → that day
  const SRC = {
    clear: (z, x, y) => z <= 8 ? `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/2004-08/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg` : null,
    today: (z, x, y, t) => z <= 9 ? `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${day(t)}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.jpg` : null,
    detail: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/${z}/${y}/${x}.jpg`,
    esri: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    map: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    lab: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`,
    night: (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`,
  };
  const DETAIL_FROM = { clear: 9, today: 10 }, SATZ = 18, EOXZ = 15, MAXZ = 18;
  const lat2y = (lat, z) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2)) / Math.PI) / 2 * (1 << z);
  const y2lat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / (1 << z)))) / D2R;
  const xyz = (lat, lon, r) => { const a = lat * D2R, b = lon * D2R; return [r * Math.cos(a) * Math.cos(b), r * Math.sin(a), -r * Math.cos(a) * Math.sin(b)]; };
  // sub-solar point (low precision is plenty for day / night)
  function sunDir(t) { const d = new Date(t), doy = (t - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5, dec = 23.44 * Math.sin(2 * Math.PI * (doy - 81) / 365.25);
    const B = 2 * Math.PI * (doy - 81) / 364, eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B), hrs = d.getUTCHours() + d.getUTCMinutes() / 60 + eot / 60;
    return xyz(dec, (12 - hrs) * 15, 1); }

  const VS = 'attribute vec3 p;attribute vec2 uv;uniform mat4 m;uniform vec4 ud;uniform vec4 un;varying vec2 vd;varying vec2 vn;varying vec3 vp;varying vec2 vu;void main(){gl_Position=m*vec4(p,1.);vd=uv*ud.xy+ud.zw;vn=uv*un.xy+un.zw;vp=p;vu=uv;}';
  const FS = 'precision mediump float;uniform sampler2D td;uniform sampler2D tn;uniform sampler2D tl;uniform vec3 sun;uniform float hn;uniform float hl;uniform float nk;uniform vec4 ul;varying vec2 vd;varying vec2 vn;varying vec3 vp;varying vec2 vu;void main(){vec3 n=normalize(vp);float d=dot(n,sun);float dl=max(smoothstep(-.12,.18,d),1.-nk);vec3 c=texture2D(td,vd).rgb;vec4 lb=texture2D(tl,vu*ul.xy+ul.zw);c=mix(c,lb.rgb,lb.a*hl);vec3 l=texture2D(tn,vn).rgb*hn*nk;vec3 night=c*.06+l*vec3(1.,.82,.55)*1.5;gl_FragColor=vec4(mix(night,c*(.75+.35*max(d,0.)*nk+.25*(1.-nk)),dl),1.);}';
  const persp = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; };
  const lookAt = (e, c, u) => { let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]], l = Math.hypot(...z); z = z.map(v => v / l);
    let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]]; l = Math.hypot(...x); x = x.map(v => v / l);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1]; };
  const mul = (a, b) => { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; };

  const CSS = `.e3d{position:absolute;inset:0;display:none;background:#000}.e3d.on{display:block}.e3d canvas{position:absolute;left:0;top:0;touch-action:none}
.e3d-ui{position:absolute;left:10px;bottom:10px;display:flex;gap:6px;flex-wrap:wrap;max-width:calc(100% - 70px)}
.e3d-ui button{border:1px solid rgba(255,255,255,.18);background:rgba(10,14,20,.78);color:#E6EBF1;border-radius:999px;padding:7px 12px;min-height:36px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}
.e3d-date{background:rgba(10,14,20,.78);color:#E6EBF1;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:6px 10px;min-height:36px;font:600 12px Inter,system-ui,sans-serif;color-scheme:dark}
.e3d-ui button[aria-pressed=true]{border-color:#39FF9E;color:#39FF9E}
.e3d-alt{position:absolute;left:12px;top:10px;font:700 15px Inter,system-ui,sans-serif;color:#FFE600;text-shadow:0 1px 3px #000;pointer-events:none}
.e3d-alt small{display:block;font:500 12px Inter,system-ui,sans-serif;color:#C9D1DB}
.e3d-attr{position:absolute;right:10px;bottom:6px;font:500 10px Inter,system-ui,sans-serif;color:rgba(220,227,235,.7);text-shadow:0 1px 2px #000;pointer-events:none;max-width:60%;text-align:right}`;

  function create(host, opts) {
    opts = opts || {};
    if (!document.getElementById('e3d-css')) { const st = document.createElement('style'); st.id = 'e3d-css'; st.textContent = CSS; document.head.appendChild(st); }
    const el = document.createElement('div'); el.className = 'e3d'; host.appendChild(el);
    el.innerHTML = `<canvas class="e3d-gl"></canvas><canvas class="e3d-ov"></canvas><div class="e3d-alt">–</div>
      <div class="e3d-ui"><button data-b="back">‹ ${tr('Solar system')}</button><button data-b="home">${tr('My place')}</button><button data-s="today" aria-pressed="true">${tr('Today (clouds)')}</button><button data-s="clear" aria-pressed="false">${tr('Clear view')}</button><button data-s="map" aria-pressed="false">${tr('Map')}</button><button data-l aria-pressed="true">${tr('Names')}</button>
        <input type="datetime-local" class="e3d-date" aria-label="${tr('Date and time')}"><button data-b="now">${tr('Now')}</button></div>
      <div class="e3d-attr">NASA GIBS · Blue Marble · Black Marble · VIIRS · Esri, Maxar, Earthstar Geographics · © OpenStreetMap contributors · Sentinel-2 cloudless by EOX</div>`;
    const cv = el.querySelector('.e3d-gl'), ov = el.querySelector('.e3d-ov'), g2 = ov.getContext('2d');
    const gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
    const api = { show() {}, hide() {}, setTime() {}, flyTo() {} };
    if (!gl) return api;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    const L = { p: gl.getAttribLocation(pr, 'p'), uv: gl.getAttribLocation(pr, 'uv') }, U = {}; ['m', 'ud', 'un', 'td', 'tn', 'tl', 'sun', 'hn', 'hl', 'nk', 'ul'].forEach(k => U[k] = gl.getUniformLocation(pr, k));
    gl.uniform1i(U.td, 0); gl.uniform1i(U.tn, 1); gl.uniform1i(U.tl, 2); gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
    // one shared index buffer for an N×N tile grid
    const N = 16, idx = []; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i; idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2); }
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    const blank = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, blank); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([12, 24, 48, 255]));
    const black = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, black); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    function cap(north) { const v = [0, north ? 1 : -1, 0, .5, .5]; for (let i = 0; i <= 64; i++) { const p = xyz(north ? MAXLAT : -MAXLAT, i / 64 * 360 - 180, 1); v.push(p[0], p[1], p[2], .5, .5); }
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(north ? [200, 214, 228, 255] : [225, 232, 240, 255])); return { b, t, north }; }
    const caps = [cap(true), cap(false)];
    // tile geometry cache (positions on the unit sphere + uv), texture cache (LRU)
    const geo = new Map(), tex = new Map(); let loading = 0, frameNo = 0, esriBad = 0;
    const dem = new Map(), EXAG = 1, DEMZ = 12; let demLoading = 0;
    function demTile(z, x, y) { const k = z + '/' + x + '/' + y; let d = dem.get(k); if (d) return d.h ? d : null; if (demLoading > 8) return null;
      d = {}; dem.set(k, d); demLoading++; const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => { demLoading--; try { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const px = g.getImageData(0, 0, 256, 256).data, h = new Float32Array(65536);
          for (let i = 0; i < 65536; i++) h[i] = Math.max(0, px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768); d.h = h; dirty = true; } catch (e) { d.bad = true; } };
      im.onerror = () => { demLoading--; d.bad = true; }; im.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
      if (dem.size > 160) dem.delete(dem.keys().next().value); return null; }
    function heightAt(z, x, y, u, v) {   // metres at (u, v) inside tile z/x/y, from the DEM tile covering it (z ≤ 12)
      if (z < 7) return 0; const zz = Math.min(z, DEMZ), s = 1 << (z - zz), dx = x >> (z - zz), dy = y >> (z - zz), d = demTile(zz, dx, dy); if (!d) return null;
      const fu = ((x - dx * s) + u) / s, fv = ((y - dy * s) + v) / s; return d.h[Math.min(255, Math.floor(fv * 256)) * 256 + Math.min(255, Math.floor(fu * 256))]; }
    function tileGeo(z, x, y) { const k = z + '/' + x + '/' + y; let g = geo.get(k);
      if (g && (g.dem || z < 7 || heightAt(z, x, y, .5, .5) == null)) return g;
      if (g) { gl.deleteBuffer(g.b); geo.delete(k); }
      const v = new Float32Array((N + 1) * (N + 1) * 5); let o = 0;
      const withDem = z >= 7 && heightAt(z, x, y, .5, .5) != null;
      for (let j = 0; j <= N; j++) { const yy = y + j / N, lat = y2lat(yy, z); for (let i = 0; i <= N; i++) { const lon = (x + i / N) / (1 << z) * 360 - 180, hm = withDem ? heightAt(z, x, y, i / N, j / N) || 0 : 0, p = xyz(lat, lon, 1 + hm / 6371000 * EXAG); v.set([p[0], p[1], p[2], i / N, j / N], o); o += 5; } }
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
      g = { b, c: xyz(y2lat(y + .5, z), (x + .5) / (1 << z) * 360 - 180, 1), dem: withDem, corners: [[0, 0], [1, 0], [0, 1], [1, 1], [.5, 0], [.5, 1], [0, .5], [1, .5]].map(([a, c]) => xyz(y2lat(y + c, z), (x + a) / (1 << z) * 360 - 180, 1)) };
      geo.set(k, g); if (geo.size > 1500) { const [fk, fv] = geo.entries().next().value; gl.deleteBuffer(fv.b); geo.delete(fk); } return g; }
    function texture(url) { if (!url) return null; let t = tex.get(url); if (t) { t.used = frameNo; return t.ok ? t : null; }
      t = { used: frameNo, ok: false }; tex.set(url, t); if (loading > 24) { tex.delete(url); return null; }
      const im = new Image(); im.crossOrigin = 'anonymous'; loading++;
      im.onload = () => { loading--; const g = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, g); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); t.g = g; t.ok = true; dirty = true; };
      im.onerror = () => { loading--; t.bad = true; if (url.indexOf('World_Imagery') > 0 && ++esriBad === 6) { dirty = true; } }; im.src = url;
      if (tex.size > 420) { let old = null; tex.forEach((v, k) => { if (v.ok && (!old || v.used < old[1].used)) old = [k, v]; }); if (old) { gl.deleteTexture(old[1].g); tex.delete(old[0]); } }
      return null; }
    const url = (z, x, y, kind) => kind === 'night' ? (z <= 8 ? SRC.night(z, x, y) : null) : kind === 'lab' ? (z >= 2 && z <= MAXZ ? SRC.lab(z, x, y) : null)
      : src === 'map' ? (z <= MAXZ ? SRC.map(z, x, y) : null)
      : (z >= DETAIL_FROM[src] ? (esriBad < 6 ? SRC.esri(z, x, y) : z <= EOXZ ? SRC.detail(z, x, y) : null) : SRC[src](z, x, y, now()));   // Esri World Imagery (sharp, no key); Sentinel-2 if Esri fails
    // the nearest loaded texture for a tile: itself or an ancestor (uv scaled into the ancestor's square)
    function bestTex(z, x, y, kind) { for (let zz = z, xx = x, yy = y; zz >= 0; zz--, xx >>= 1, yy >>= 1) { const u = url(zz, xx, yy, kind); const t = u && texture(u);
        if (t) { const s = 1 / (1 << (z - zz)); return { g: t.g, tf: [s, s, (x - (xx << (z - zz))) * s, (y - (yy << (z - zz))) * s] }; } } return null; }

    let W = 0, H = 0, dpr = 1, M = null, dirty = true, visible = false, src = 'today', labels = true, sunV = [1, 0, 0];
    const cam = { lat: 45.6, lon: 25.6, alt: 18000, goal: null };   // alt in km above the surface
    let tOver = null; const now = () => tOver != null ? tOver : (opts.time ? opts.time() : Date.now());
    const lonlatTile = (lat, lon, z) => { const t = 1 << z, xf = (lon + 180) / 360 * t, yf = lat2y(lat, z); return [z, Math.floor(xf), Math.floor(yf), xf % 1, yf % 1]; };
    function eyePos() { const r = 1 + cam.alt / R_KM; return xyz(cam.lat, cam.lon, r); }
    const proj = p => { const x = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], y = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], w = M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15];
      return w <= 1e-6 ? null : [(x / w * .5 + .5) * W, (1 - (y / w * .5 + .5)) * H, w]; };
    const list = [];
    function select(z, x, y, eye) {   // quadtree: keep a tile if it faces us and is on screen; split while it looks big
      const g = tileGeo(z, x, y), toEye = [eye[0] - g.c[0], eye[1] - g.c[1], eye[2] - g.c[2]];
      const under = (() => { const t = 1 << z, cx = (cam.lon + 180) / 360 * t, cy = lat2y(cam.lat, z); return cx >= x && cx < x + 1 && cy >= y && cy < y + 1; })()
        || Math.hypot(g.c[0] - eye[0], g.c[1] - eye[1], g.c[2] - eye[2]) < Math.max(4 * (Math.hypot(...eye) - 1), 2.2 * Math.PI / (1 << z));   // around the camera: never culled, only split
      if (z >= 2 && !under && g.corners.concat([g.c]).every(q => q[0] * (eye[0] - q[0]) + q[1] * (eye[1] - q[1]) + q[2] * (eye[2] - q[2]) < 0)) return;   // all of it beyond the horizon
      const ps = g.corners.concat([g.c]).map(proj);
      if (!under) {   // frustum test in clip space: out if every point is beyond the same side
        const C = g.corners.concat([g.c]).map(p => [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15]]);
        const t = c => .15 * Math.abs(c[2]) + 1e-9; if (C.every(c => c[2] <= 0) || C.every(c => c[0] - c[2] > t(c)) || C.every(c => -c[0] - c[2] > t(c)) || C.every(c => c[1] - c[2] > t(c)) || C.every(c => -c[1] - c[2] > t(c))) return; }
      const straddle = ps.some(q => !q);   // part of the tile is behind the camera: keep it and split it
      if (z >= 2 && !under) { if (straddle) { if (z >= 14) { list.push([z, x, y]); return; } } else { const xs = ps.map(q => q[0]), ys = ps.map(q => q[1]); if (Math.max(...xs) < 0 || Math.min(...xs) > W || Math.max(...ys) < 0 || Math.min(...ys) > H) return; } }
      const ok = ps.filter(Boolean), size = straddle || ok.length < 2 ? 1e9 : Math.hypot(Math.max(...ok.map(q => q[0])) - Math.min(...ok.map(q => q[0])), Math.max(...ok.map(q => q[1])) - Math.min(...ok.map(q => q[1])));
      if (z < MAXZ && (z < 2 || size > 360 * dpr / Math.max(1, dpr) ) && list.length < 220) { const kids = [0, 1, 2, 3].map(k => [x * 2 + (k & 1), y * 2 + (k >> 1)]).map(([cx, cy]) => { const c = tileGeo(z + 1, cx, cy).c; return [cx, cy, (c[0] - eye[0]) ** 2 + (c[1] - eye[1]) ** 2 + (c[2] - eye[2]) ** 2]; }).sort((a, b) => a[2] - b[2]);
        kids.forEach(([cx, cy]) => select(z + 1, cx, cy, eye)); return; }   // nearest first, so detail near the camera wins the tile budget
      list.push([z, x, y]);
    }
    function draw() {
      frameNo++;
      if (cam.goal) { const g = cam.goal; cam.lat += (g.lat - cam.lat) * .1; let dl = ((g.lon - cam.lon + 540) % 360) - 180; cam.lon += dl * .1; cam.alt *= Math.pow(g.alt / cam.alt, .1);
        if (Math.abs(g.lat - cam.lat) < .01 && Math.abs(dl) < .01 && Math.abs(Math.log(g.alt / cam.alt)) < .01) cam.goal = null; dirty = true; }
      const a = cam.lat * D2R, b = cam.lon * D2R, n = xyz(cam.lat, cam.lon, 1), north = [-Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b)], h = cam.alt / R_KM;
      const tilt = cam.alt < 400 ? (1 - cam.alt / 400) * .95 : 0, gh = (cam.alt < 400 ? heightAt(...lonlatTile(cam.lat, cam.lon, 12)) || 0 : 0) / 6371000 * EXAG, tgt = n.map(v => v * (1 + gh));
      // the eye stays h above the ground under the target; tilting moves it south (so it never sinks into hills)
      const eye = tgt.map((v, i) => v + n[i] * h - north[i] * h * Math.tan(tilt)), hz = Math.sqrt(2 * (h + gh) + (h + gh) ** 2);   // distance to the horizon
      const near = Math.max(h * .08, 1e-7), far = Math.min(4, hz * 1.6 + h * 3 + .002);
      M = mul(persp(45 * D2R, W / H, near, far), lookAt(eye, tgt, north));
      gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(pr); gl.uniformMatrix4fv(U.m, false, new Float32Array(M)); sunV = sunDir(now()); gl.uniform3fv(U.sun, sunV); gl.uniform1f(U.nk, cam.alt > 2500 ? 1 : cam.alt < 800 ? .12 : .12 + .88 * (cam.alt - 800) / 1700);   // near the ground: the picture in daylight, like Google Earth
      list.length = 0; select(0, 0, 0, eye); list.sort((a, b) => a[0] - b[0]);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); let pending = false;
      list.forEach(([z, x, y]) => { const g = tileGeo(z, x, y), d = bestTex(z, x, y, 'day'), n = bestTex(Math.min(z, 8), x >> Math.max(0, z - 8), y >> Math.max(0, z - 8), 'night');
        if (!d || d.tf[0] < 1) pending = true;
        gl.bindBuffer(gl.ARRAY_BUFFER, g.b); gl.enableVertexAttribArray(L.p); gl.vertexAttribPointer(L.p, 3, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(L.uv); gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, 20, 12);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, d ? d.g : blank); gl.uniform4fv(U.ud, d ? d.tf : [1, 1, 0, 0]);
        let ntf = [1, 1, 0, 0]; if (n) { const s = z > 8 ? 1 / (1 << (z - 8)) : 1, ox = z > 8 ? (x - ((x >> (z - 8)) << (z - 8))) * s : 0, oy = z > 8 ? (y - ((y >> (z - 8)) << (z - 8))) * s : 0; ntf = [n.tf[0] * s, n.tf[1] * s, n.tf[2] + ox * n.tf[0], n.tf[3] + oy * n.tf[1]]; }
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, n ? n.g : black); gl.uniform4fv(U.un, ntf); gl.uniform1f(U.hn, n ? 1 : 0);
        const lt = labels && src !== 'map' ? bestTex(z, x, y, 'lab') : null; gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, lt ? lt.g : black); gl.uniform4fv(U.ul, lt ? lt.tf : [1, 1, 0, 0]); gl.uniform1f(U.hl, lt ? 1 : 0);
        gl.drawElements(gl.TRIANGLES, N * N * 6, gl.UNSIGNED_SHORT, 0); });
      gl.disable(gl.CULL_FACE); caps.forEach(c => { gl.bindBuffer(gl.ARRAY_BUFFER, c.b); gl.vertexAttribPointer(L.p, 3, gl.FLOAT, false, 20, 0); gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, 20, 12);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, c.t); gl.uniform4fv(U.ud, [1, 1, 0, 0]); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, black); gl.uniform1f(U.hn, 0);
        gl.drawArrays(gl.TRIANGLE_FAN, 0, 66); }); gl.enable(gl.CULL_FACE);
      // overlay: atmosphere rim, pins, altitude
      g2.setTransform(dpr, 0, 0, dpr, 0, 0); g2.clearRect(0, 0, W, H);
      const c = proj([0, 0, 0]), rEye = Math.hypot(...eye), ang = Math.asin(Math.min(1, 1 / rEye)), rpx = Math.tan(ang) / Math.tan(22.5 * D2R) * H / 2;
      if (c && cam.alt > 1500) { const gr = g2.createRadialGradient(c[0], c[1], rpx * .97, c[0], c[1], rpx * 1.08); gr.addColorStop(0, 'rgba(110,170,255,0)'); gr.addColorStop(.35, 'rgba(110,170,255,.45)'); gr.addColorStop(1, 'rgba(110,170,255,0)');
        g2.fillStyle = gr; g2.beginPath(); g2.arc(c[0], c[1], rpx * 1.08, 0, 7); g2.fill(); }
      const G = opts.aurora && opts.aurora();
      if (G && cam.alt > 1200) { g2.globalCompositeOperation = 'lighter'; const sz = Math.max(1.5, rpx / 90);
        for (let la = -89; la <= 89; la++) { if (Math.abs(la) < 38) continue; for (let lo = 0; lo < 360; lo += 2) { const v = G[lo * 181 + la + 90]; if (v < 6) continue;
          const p = xyz(la, lo > 180 ? lo - 360 : lo, 1.012), dn = p[0] * sunV[0] + p[1] * sunV[1] + p[2] * sunV[2]; if (dn > .12) continue;
          if (p[0] * (eye[0] - p[0]) + p[1] * (eye[1] - p[1]) + p[2] * (eye[2] - p[2]) < 0) continue; const q = proj(p); if (!q) continue;
          g2.fillStyle = v > 40 ? `rgba(255,90,120,${Math.min(.5, v / 120)})` : `rgba(57,255,158,${Math.min(.55, v / 60)})`; g2.fillRect(q[0] - sz, q[1] - sz, sz * 2, sz * 2); } }
        g2.globalCompositeOperation = 'source-over'; }
      g2.font = '700 12px Inter, system-ui, sans-serif'; g2.textBaseline = 'middle';
      (opts.places || []).forEach(pl => { const p = xyz(pl.lat, pl.lon, 1.0002), q = proj(p); if (!q) return; const toEye = [eye[0] - p[0], eye[1] - p[1], eye[2] - p[2]]; if (p[0] * toEye[0] + p[1] * toEye[1] + p[2] * toEye[2] < 0) return;
        g2.fillStyle = '#FFE08A'; g2.beginPath(); g2.arc(q[0], q[1], 4.5, 0, 7); g2.fill(); g2.strokeStyle = '#000'; g2.lineWidth = 1.5; g2.stroke();
        const tw = g2.measureText(pl.name).width; g2.fillStyle = 'rgba(0,0,0,.6)'; g2.fillRect(q[0] + 8, q[1] - 9, tw + 10, 18); g2.fillStyle = '#FFE08A'; g2.fillText(pl.name, q[0] + 13, q[1]); });
      const ak = cam.alt, al = ak >= 1000 ? Math.round(ak).toLocaleString(window.LOC || 'en-GB') + ' km' : ak >= 10 ? ak.toFixed(0) + ' km' : (ak * 1000).toFixed(0) + ' m';
      el.querySelector('.e3d-alt').innerHTML = `${tr('Altitude')} ${al}<small>${cam.lat.toFixed(2)}°, ${cam.lon.toFixed(2)}° · ${new Date(now()).toLocaleString(window.LOC || 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC</small>`;
      dirty = pending || loading > 0 || demLoading > 0;
    }
    function frame() { if (visible && (dirty || cam.goal || spin[0] || spin[1])) { if (spin[0] || spin[1]) { move(spin[0], spin[1]); spin = spin.map(v => Math.abs(v) < .05 ? 0 : v * .9); } draw(); } requestAnimationFrame(frame); }
    function resize() { const r = host.getBoundingClientRect(); W = Math.max(200, r.width); H = Math.max(200, r.height); dpr = Math.min(2, devicePixelRatio || 1);
      [cv, ov].forEach(c => { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }); dirty = true; }
    // controls: drag = move over the globe (slower near the ground), pinch / wheel = altitude, double-tap = zoom in there
    let spin = [0, 0]; const pts = new Map(); let d0 = 0, a0 = 0, moved = 0, lastTap = 0;
    function move(dx, dy) { const k = (cam.alt / R_KM) / (H / 2) * 50; cam.lon -= dx * k / Math.max(.2, Math.cos(cam.lat * D2R)); cam.lat = Math.max(-85, Math.min(85, cam.lat + dy * k)); cam.goal = null; dirty = true; }
    const zoom = f => { cam.alt = Math.max(.3, Math.min(60000, cam.alt * f)); cam.goal = null; dirty = true; };
    ov.addEventListener('pointerdown', e => { ov.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; spin = [0, 0]; if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); a0 = cam.alt; } });
    ov.addEventListener('pointermove', e => { const p = pts.get(e.pointerId); if (!p) return; const dx = e.clientX - p[0], dy = e.clientY - p[1]; pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) { move(dx, dy); spin = [dx, dy]; moved += Math.abs(dx) + Math.abs(dy); } else if (pts.size === 2) { const [a, b] = [...pts.values()]; cam.alt = Math.max(.3, Math.min(60000, a0 * d0 / Math.max(10, Math.hypot(a[0] - b[0], a[1] - b[1])))); moved = 99; dirty = true; } });
    const up = e => { pts.delete(e.pointerId); if (moved > 6 && pts.size === 0) return; spin = [0, 0];
      if (moved < 6 && e.type === 'pointerup') { const t = performance.now(); if (t - lastTap < 320) { const r = ov.getBoundingClientRect(); move(-(e.clientX - r.left - W / 2), -(e.clientY - r.top - H / 2)); zoom(.4); lastTap = 0; } else lastTap = t; } };
    ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
    ov.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(e.deltaY * .0015)); }, { passive: false });
    el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { src = b.dataset.s; el.querySelectorAll('[data-s]').forEach(o => o.setAttribute('aria-pressed', o === b)); dirty = true; });
    el.querySelector('[data-l]').onclick = e => { labels = !labels; e.target.setAttribute('aria-pressed', labels); dirty = true; };
    const pad = v => String(v).padStart(2, '0'), localStr = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const di = el.querySelector('.e3d-date'); di.max = localStr(Date.now()); di.min = '2012-05-08T00:00';
    di.onchange = () => { const t = Date.parse(di.value); if (isFinite(t)) { tOver = Math.min(Date.now(), t); dirty = true; } };
    el.querySelector('[data-b=now]').onclick = () => { tOver = null; di.value = localStr(now()); dirty = true; };
    el.querySelector('[data-b=back]').onclick = () => opts.onBack && opts.onBack();
    el.querySelector('[data-b=home]').onclick = () => { const p = (opts.places || [])[0]; if (p) cam.goal = { lat: p.lat, lon: p.lon, alt: 60 }; dirty = true; };
    if (window.ResizeObserver) new ResizeObserver(resize).observe(host);
    resize(); requestAnimationFrame(frame);
    api.show = (lat, lon) => { el.querySelector('.e3d-date').value = localStr(now()); el.classList.add('on'); visible = true; resize(); if (lat != null) { cam.lat = lat; cam.lon = lon; } cam.alt = 30000; cam.goal = { lat: cam.lat, lon: cam.lon, alt: 12000 }; dirty = true; };
    api.hide = () => { el.classList.remove('on'); visible = false; };
    api.setTime = () => { dirty = true; };
    api.flyTo = (lat, lon, km) => { cam.goal = { lat, lon, alt: km || 50 }; dirty = true; };
    api.setPlaces = p => { opts.places = p; dirty = true; };
    return api;
  }
  window.Earth3D = { create, sunDir };
})();
