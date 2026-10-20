/* PowHau aurora globe — shared by noaa/aurora.html and the home NOAA tile (powhau.html).
   Orthographic globe drawn per pixel: land mask (window.LAND from land.js, Natural Earth 110m),
   NOAA OVATION aurora grid (Float32Array 360×181, lon-major, value 0–100), day/night shading,
   optional view line and Brașov marker. No libraries. */
(function () {
  'use strict';
  const BV = { lat: 45.6427, lon: 25.5887 };
  let mask = null;

  function buildMask() {
    const W = 1440, H = 720, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#fff';
    for (const ring of window.LAND || []) {
      g.beginPath();
      ring.forEach(([lo, la], i) => { const px = (lo + 180) / 360 * W, py = (90 - la) / 180 * H; i ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.closePath(); g.fill();
    }
    const d = g.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4] > 127 ? 1 : 0;
    return { W, H, m };
  }
  function land(lat, lon) {
    const { W, H, m } = mask;
    let x = Math.floor((lon + 180) / 360 * W); x = ((x % W) + W) % W;
    const y = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / 180 * H)));
    return m[y * W + x];
  }
  function ovAt(G, lat, lon) {
    if (!G) return 0;
    const lo = ((lon % 360) + 360) % 360, la = lat + 90;
    const x0 = Math.floor(lo), y0 = Math.floor(la), fx = lo - x0, fy = la - y0;
    const v = (x, y) => G[((x % 360) * 181) + Math.min(180, Math.max(0, y))];
    return (v(x0, y0) * (1 - fx) + v(x0 + 1, y0) * fx) * (1 - fy) + (v(x0, y0 + 1) * (1 - fx) + v(x0 + 1, y0 + 1) * fx) * fy;
  }
  function subsolar(t) {
    const d = new Date(t), doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
    const B = 2 * Math.PI / 365 * (doy - 81), eq = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    return { lat: 23.45 * Math.sin(B), lon: -(d.getUTCHours() + d.getUTCMinutes() / 60 - 12) * 15 - eq / 4 };
  }

  /**
   * draw(canvas, opts) — opts: ov (OVATION grid or null), lat0/lon0 (view centre, degrees),
   * viewLine (bool), label (bool, place name), graticule (bool), rim (css colour or null),
   * here ({lat, lon, name}: the marked place, default Brașov), t (ms: time for day / night, default now).
   */
  function draw(cv, o) {
    o = Object.assign({ ov: null, lat0: 58, lon0: 18, viewLine: true, label: true, graticule: true, rim: 'rgba(57,255,158,.18)' }, o || {});
    const dpr = Math.min(2, window.devicePixelRatio || 1), size = Math.round(cv.clientWidth * dpr);
    if (!size) return false;
    cv.width = size; cv.height = size;
    if (!mask) mask = buildMask();
    const g = cv.getContext('2d'), R = size / 2 - 2 * dpr, cx = size / 2, cy = size / 2;
    const lat0 = o.lat0 * Math.PI / 180, lon0 = o.lon0 * Math.PI / 180, sinP0 = Math.sin(lat0), cosP0 = Math.cos(lat0);
    const sun = subsolar(o.t || Date.now()), sl = sun.lat * Math.PI / 180, slo = sun.lon * Math.PI / 180;
    const img = g.createImageData(size, size), px = img.data, N = size * size;
    const lats = new Float32Array(N).fill(NaN), lons = new Float32Array(N), lnd = new Uint8Array(N);
    for (let sy = 0; sy < size; sy++) for (let sx = 0; sx < size; sx++) {
      const x = (sx - cx) / R, y = -(sy - cy) / R, rho = Math.hypot(x, y);
      if (rho > 1) continue;
      const c = Math.asin(rho), sc = Math.sin(c), cc = Math.cos(c);
      const phi = rho ? Math.asin(cc * sinP0 + y * sc * cosP0 / rho) : lat0;
      const lam = lon0 + Math.atan2(x * sc, rho * cosP0 * cc - y * sinP0 * sc);
      const i = sy * size + sx, lat = phi * 180 / Math.PI, lon = ((lam * 180 / Math.PI + 540) % 360) - 180;
      lats[i] = lat; lons[i] = lon; lnd[i] = land(lat, lon);
    }
    const gratW = 0.36 * (90 / R) * dpr;
    for (let i = 0; i < N; i++) {
      const lat = lats[i]; if (isNaN(lat)) continue;
      const lon = lons[i], p = lat * Math.PI / 180, l = lon * Math.PI / 180;
      const cz = Math.sin(p) * Math.sin(sl) + Math.cos(p) * Math.cos(sl) * Math.cos(l - slo);
      const day = Math.min(1, Math.max(0, (cz + 0.1) / 0.2));
      const isL = lnd[i];
      let r = isL ? 20 + 10 * day : 6 + 6 * day, gg = isL ? 27 + 13 * day : 11 + 13 * day, b = isL ? 38 + 16 * day : 20 + 22 * day;
      const sx = i % size, sy = (i / size) | 0;
      if (sx > 0 && sy > 0 && (lnd[i - 1] !== isL || lnd[i - size] !== isL) && !isNaN(lats[i - 1]) && !isNaN(lats[i - size])) { r = 62; gg = 78; b = 100; }
      if (o.graticule && Math.abs(lat - Math.round(lat / 10) * 10) < gratW && Math.round(lat / 10) * 10 >= 40) { r += 10; gg += 12; b += 16; }
      const v = ovAt(o.ov, lat, lon);
      if (v > 2) {
        const a = Math.min(1, (v - 2) / 30) * (0.35 + 0.65 * (1 - day)), t = Math.min(1, v / 90);
        const ar = t < .5 ? 57 + t * 2 * 175 : 232 + (t - .5) * 2 * 23;
        const ag = t < .5 ? 255 - t * 2 * 10 : 245 - (t - .5) * 2 * 184;
        const ab = t < .5 ? 158 - t * 2 * 68 : 90 - (t - .5) * 2 * 20;
        r = Math.min(255, r + ar * a); gg = Math.min(255, gg + ag * a); b = Math.min(255, b + ab * a);
      }
      const k = i * 4; px[k] = r; px[k + 1] = gg; px[k + 2] = b; px[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const proj = (lat, lon) => {
      const p = lat * Math.PI / 180, dl = lon * Math.PI / 180 - lon0;
      if (sinP0 * Math.sin(p) + cosP0 * Math.cos(p) * Math.cos(dl) < 0) return null;
      return [cx + R * Math.cos(p) * Math.sin(dl), cy - R * (cosP0 * Math.sin(p) - sinP0 * Math.cos(p) * Math.cos(dl))];
    };
    // view line ≈ equatorward edge of the oval (≥ 8 %) pushed ~7° south
    if (o.viewLine && o.ov) {
      g.save(); g.setLineDash([5 * dpr, 4 * dpr]); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.2 * dpr; g.beginPath();
      let pen = false;
      for (let lon = -180; lon <= 180; lon += 2) {
        let edge = null;
        for (let lat = 40; lat <= 85; lat++) if (ovAt(o.ov, lat, lon) >= 8) { edge = lat; break; }
        const q = edge == null ? null : proj(edge - 7, lon);
        if (!q) { pen = false; continue; }
        pen ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); pen = true;
      }
      g.stroke(); g.restore();
    }
    if (o.rim) { g.strokeStyle = o.rim; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(cx, cy, R, 0, 2 * Math.PI); g.stroke(); }
    const H = o.here || { lat: BV.lat, lon: BV.lon, name: 'Brașov' }, q = proj(H.lat, H.lon);
    if (q) {
      g.fillStyle = '#FFB300'; g.strokeStyle = '#0A0A0A'; g.lineWidth = 2 * dpr;
      g.beginPath(); g.arc(q[0], q[1], (o.label ? 4 : 3) * dpr, 0, 2 * Math.PI); g.fill(); g.stroke();
      if (o.label) { g.font = `700 ${10 * dpr}px 'JetBrains Mono', monospace`; g.fillStyle = '#FFE08A'; g.fillText(String(H.name || '').toUpperCase().slice(0, 18), q[0] + 8 * dpr, q[1] + 4 * dpr); }
    }
    return true;
  }

  /** NOAA OVATION json → grid */
  function grid(json) {
    const G = new Float32Array(360 * 181);
    json.coordinates.forEach(([lo, la, v]) => { G[lo * 181 + (la + 90)] = v; });
    return G;
  }

  /**
   * Kp needed to see the aurora (low on the northern horizon) from a place, from its geomagnetic latitude
   * (dipole pole 80.7° N 72.7° W). Brașov ≈ 43.6° → 7, Paris ≈ 6.5, London ≈ 5.5, Stockholm ≈ 4, Tromsø ≈ 1. An estimate.
   */
  function kpNeed(lat, lon) {
    const r = Math.PI / 180, P = 80.7 * r, L = -72.7 * r, a = Math.abs(lat) * r;   // southern hemisphere: mirror (rough)
    const m = Math.asin(Math.sin(a) * Math.sin(P) + Math.cos(a) * Math.cos(P) * Math.cos(lon * r - L)) / r;
    const T = [[67, 1], [62, 2.5], [58, 4], [53, 5.5], [50, 6.5], [43.6, 7], [40, 8], [36, 9]];
    if (m >= T[0][0]) return 1;
    for (let i = 1; i < T.length; i++) if (m >= T[i][0]) { const [m0, k0] = T[i - 1], [m1, k1] = T[i]; return Math.round((k1 + (k0 - k1) * (m - m1) / (m0 - m1)) * 2) / 2; }
    return 9;
  }

  window.AuroraGlobe = { draw, grid, kpNeed };
})();
