// S6 real wind: NOAA GFS 1° u / v (10 m + 1000 ... 100 hPa, forecast hours 0-12 every 3 h), baked every 6 h by the Pages repo bot
// (tools/build_wind.py -> branch "wind": wind.bin.gz int8 [hour][level][u, v][lat 90 ... -90][lon 0 ... 359 E] + wind.json scales).
// Loaded lazily (flight mode / the cloud volume). Interpolation: bilinear in lat / lon, linear in time (clamped to the run's 0-12 h), linear
// in height between the levels at their US 1976 pressure altitudes (an estimate: real level heights differ by a few hundred m).
// Near the ground: the 10 m wind sits at ground + 10 m; below it a log law, z0 = 0.03 m (open land; an estimate). Above 100 hPa (16 km) the
// wind fades to 0 at 30 km. Turbulence: Dryden-lite (a model, not data), see gusts().
export const WIND_URL = 'https://raw.githubusercontent.com/ori0nori0ff/ori0nori0ff.github.io/wind/';
const HSTD = [0, 111, 1457, 3012, 5574, 9164, 10363, 11784, 16180];   // m, US 1976 altitude of 1000 850 700 500 300 250 200 100 hPa (index 0 = 10 m AGL)
const Z0 = .03, LN10 = Math.log(10 / Z0);

export function createWind() {
  let q = null, sc = null, NH = 0, NL = 0, t0 = 0, dtH = 108e5, ready = false, run = '';
  const NI = 360, NJ = 181, PL = NI * NJ;
  // one component c of level l at hour h, bilinear at grid x (0 ... 360, wraps) / y (0 ... 180)
  function bil(h, l, c, x, y, i0, j0, fx, fy) {
    const b = ((h * NL + l) * 2 + c) * PL, i1 = (i0 + 1) % NI, j1 = Math.min(j0 + 1, NJ - 1), s = sc[(h * NL + l) * 2 + c];
    return s * ((q[b + j0 * NI + i0] * (1 - fx) + q[b + j0 * NI + i1] * fx) * (1 - fy) + (q[b + j1 * NI + i0] * (1 - fx) + q[b + j1 * NI + i1] * fx) * fy); }
  const W = {
    get ready() { return ready; }, get run() { return run; },
    async load(base = window.WIND_BASE || WIND_URL) {   // WIND_BASE: a local copy for tests
      const k = Math.floor(Date.now() / 216e5);   // cache key: one per 6 h (the bot's cadence)
      const [j, buf] = await Promise.all([fetch(base + 'wind.json?' + k).then(r => r.json()),
        fetch(base + 'wind.bin.gz?' + k).then(r => { if (!r.ok) throw new Error(r.status); return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); })]);
      [NH, NL] = j.shape; q = new Int8Array(buf); sc = Float32Array.from(j.scale.flat(2)); run = j.run;
      if (q.length !== NH * NL * 2 * PL) throw new Error('wind: size ' + q.length);
      t0 = Date.parse(j.run.replace(/T(\d\d)Z$/, 'T$1:00Z')) + j.hours[0] * 36e5; dtH = (j.hours[1] - j.hours[0]) * 36e5; ready = true; return W; },
    // one whole level l at time t (linear between forecast hours): Float32Array [lat 90 ... -90][lon 0 ... 359 E][u, v], m/s (the clouds' textures)
    level(l, t) { const th = Math.min(Math.max((t - t0) / dtH, 0), NH - 1), h0 = Math.min(Math.floor(th), NH - 2), a = th - h0, o = new Float32Array(PL * 2);
      for (let c = 0; c < 2; c++) { const b0 = ((h0 * NL + l) * 2 + c) * PL, b1 = (((h0 + 1) * NL + l) * 2 + c) * PL, s0 = sc[(h0 * NL + l) * 2 + c] * (1 - a), s1 = sc[((h0 + 1) * NL + l) * 2 + c] * a;
        for (let k = 0; k < PL; k++) o[k * 2 + c] = q[b0 + k] * s0 + q[b1 + k] * s1; }
      return o; },
    // wind toward east / north (m/s) at lat / lon (deg), height above sea level and above the ground (m), time t (ms); out = [e, n]
    at(lat, lon, hMSL, hAGL, t, out = [0, 0]) {
      out[0] = out[1] = 0; if (!ready) return out;
      const y = Math.min(Math.max(90 - lat, 0), 180), x = ((lon % 360) + 360) % 360, i0 = Math.floor(x) % NI, j0 = Math.min(Math.floor(y), NJ - 1), fx = x - Math.floor(x), fy = y - j0;
      const th = Math.min(Math.max((t - t0) / dtH, 0), NH - 1), h0 = Math.min(Math.floor(th), NH - 2), a = th - h0;
      const g = hMSL - hAGL;   // ground height (m above sea level)
      // the two levels around hMSL (levels under ground + 10 m are skipped) and the weight of the upper one; k = extra factor (log law, fade)
      let la = 0, lb = 0, w = 0, k = 1;
      if (hAGL <= 10) k = hAGL > Z0 ? Math.log(hAGL / Z0) / LN10 : 0;
      else if (hMSL >= HSTD[NL - 1]) { la = lb = NL - 1; k = Math.max(0, 1 - (hMSL - HSTD[NL - 1]) / (30000 - HSTD[NL - 1])); }
      else { let hb = g + 10; for (let l = 1; l < NL; l++) { if (HSTD[l] <= g + 10) continue; if (HSTD[l] >= hMSL) { lb = l; w = (hMSL - hb) / (HSTD[l] - hb); break; } la = l; hb = HSTD[l]; } }
      for (let c = 0; c < 2; c++) {
        const A = bil(h0, la, c, x, y, i0, j0, fx, fy) * (1 - a) + bil(h0 + 1, la, c, x, y, i0, j0, fx, fy) * a;
        const B = w > 0 ? bil(h0, lb, c, x, y, i0, j0, fx, fy) * (1 - a) + bil(h0 + 1, lb, c, x, y, i0, j0, fx, fy) * a : A;
        out[c] = (A + (B - A) * w) * k; }
      return out; },
  };
  return W;
}

// one wind field for the page (flight core + clouds), loaded on first use; failures leave it not ready (= no wind)
let SHARED = null;
export const sharedWind = () => SHARED || (SHARED = createWind(), SHARED.load().catch(e => console.warn('wind: not loaded', e)), SHARED);

// Dryden-lite turbulence (MIL-F-8785C low-altitude form, first-order filters instead of the exact Dryden transfer functions): below 305 m AGL
// sigma_w = 0.1 W20 (W20 = the mean wind at 6 m), sigma_u = sigma_v = sigma_w / (0.177 + 0.000823 h)^0.4, lengths L_w = h, L_u = L_v =
// h / (0.177 + 0.000823 h)^1.2 (h in ft); fades out from 305 to 600 m (no clear-air turbulence). A model, not data. Returns [e, n, up] m/s.
export function createGusts(seed = 1) {
  let s = seed >>> 0 || 1; const g = [0, 0, 0];
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(6.2831853 * rnd());
  return { state: g, step(dt, hAGL, V, wE, wN, w20) {   // wE / wN: the mean wind here (its direction = the u axis), V = airspeed (m/s)
    const hf = Math.max(hAGL, 3) / .3048, fade = 1 - Math.min(Math.max((hAGL - 305) / 295, 0), 1);
    if (fade <= 0 || w20 < .1) { g[0] = g[1] = g[2] = 0; return g; }
    const sw = .1 * w20 * fade, r = .177 + .000823 * Math.min(hf, 1000), su = sw / Math.pow(r, .4), Lu = Math.min(hf, 1000) / Math.pow(r, 1.2) * .3048, Lw = Math.min(hf, 1000) * .3048;
    const v = Math.max(V, 5), ws = Math.hypot(wE, wN), ce = ws > .1 ? wE / ws : 1, cn = ws > .1 ? wN / ws : 0;
    const ou = (x, sg, L) => { const b = Math.min(v * dt / L, 1); return x * (1 - b) + sg * Math.sqrt(2 * b) * gauss(); };
    const u = ou(g[0] * ce + g[1] * cn, su, Lu), l = ou(-g[0] * cn + g[1] * ce, su, Lu);   // along / across the mean wind
    g[0] = u * ce - l * cn; g[1] = u * cn + l * ce; g[2] = ou(g[2], sw, Lw); return g; } };
}
