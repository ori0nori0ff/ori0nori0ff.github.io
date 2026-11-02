/* STORM MODE (?storm=may2024): the whole page as it was at the peak of the G5 storm, 10 May 2024 20:30 UTC (23:30 in Romania).
   Loaded first in <head>; does nothing in calm mode. It moves the page's clock to that moment (time keeps running from there),
   answers the page's NOAA / NASA / Open-Meteo / USGS requests with the real data of that day (baked by tools/build_storm.py into
   storm/may2024/) and shows a placeholder for what did not exist yet (CCOR coronagraphs). The page draws everything as usual. */
(() => {
  const id = new URLSearchParams(location.search).get('storm');
  if (!id || !/^\w+$/.test(id)) return;
  // TIME MACHINE: any week of the replay archive (tools/build_timemachine.py → <week>/tm/), the hand-baked ones here or the weekly
  // bot's in /aurora-replay/; the clock = the end of that week, so every 7-day chart holds the whole week
  const sx = u => { try { const x = new XMLHttpRequest(); x.open('GET', u + 'manifest.json', false); x.send(); return x.status === 200 ? JSON.parse(x.responseText) : null; } catch (e) { return null; } };
  let BASE = 'storm/may2024/', M = { now: Date.UTC(2024, 4, 10, 20, 30), swpc: [], latest: {}, prefix: 'replay/may2024/' };
  if (id === 'may2024') M = Object.assign(M, sx(BASE) || {});
  else { let w = null; for (const b of ['replay/' + id + '/tm/', '/aurora-replay/' + id + '/tm/']) { const m = sx(b); if (m) { w = [b, m]; break; } } if (!w) return; [BASE, M] = w; }
  const SWPC = 'https://services.swpc.noaa.gov/', NA = BASE + 'na.svg', PRE = M.prefix || 'replay/may2024/', LIVE = M.live || [];
  const have = new Set(M.swpc);

  // the clock: "now" = the storm's moment, running on from there
  const RD = Date, real = RD.now.bind(RD), OFF = M.now - real();
  function SD(...a) { if (!new.target) return new RD(real() + OFF).toString(); return a.length ? new RD(...a) : new RD(real() + OFF); }
  SD.prototype = RD.prototype; SD.now = () => real() + OFF; SD.parse = RD.parse; SD.UTC = RD.UTC;
  window.Date = SD;
  const day = d => new RD(d).toISOString().slice(0, 10);

  const strip = u => u.split('?')[0].split('#')[0];
  const latest = k => M.latest[k] || null;
  // where a request goes in storm mode: a local file, a historical API, '' (= not available), or unchanged
  function map(u, kind) {
    if (typeof u !== 'string' || !u) return u;
    const abs = new URL(u, location.href).href;
    if (abs.startsWith(SWPC)) {
      const p = strip(abs.slice(SWPC.length));
      if (p.startsWith('__replay/')) return PRE + p.slice(9);
      if (LIVE.some(q => p.startsWith(q))) return u;   // history anyway (solar cycle): the live file
      if (!have.has(p) && have.has(p.replace('-7-day', '-3-day'))) return BASE + 'swpc/' + p.replace('-7-day', '-3-day');   // the page asks for 7 days, the storm copy has 3
      return have.has(p) || (kind === 'img' && p.startsWith('images/animations/enlil/')) ? BASE + 'swpc/' + p : '';
    }
    if (abs.startsWith(location.origin)) {
      const p = strip(abs.slice(location.origin.length)).replace(/^.*\/aurora\//, '');
      if (p === 'sun/frames.json' || p === 'data/earth.json' || p === 'data/cme.json' || (p === 'data/journal.json' && id === 'may2024')) return BASE + p;
      return u;
    }
    let m;
    if ((m = abs.match(/sdo\.gsfc\.nasa\.gov\/assets\/img\/latest\/latest_(?:1024|512|4096|2048)_(\w+)\.jpg/))) return latest(m[1] === 'HMIIF' ? 'HMIIC' : m[1]) || NA;
    if (/sdo\.gsfc\.nasa\.gov\/assets\/img\/latest\/mpeg\//.test(abs) || /soho\.nascom\.nasa\.gov\/data\/LATEST\/.*\.mp4/.test(abs)) return '';
    if (/soho\.nascom\.nasa\.gov\/data\/realtime\/c3\//.test(abs)) return latest('C3') || NA;
    if (/soho\.nascom\.nasa\.gov\/data\/realtime\/c2\//.test(abs)) return latest('C2') || NA;
    if ((m = abs.match(/raw\.githubusercontent\.com\/ori0nori0ff\/ori0nori0ff\.github\.io\/enlil\/sun\/(\w+)\.jpg/))) return latest(m[1]) || NA;
    if (/raw\.githubusercontent\.com\/ori0nori0ff\/ori0nori0ff\.github\.io\/enlil\//.test(abs)) return '';
    if (/github\.com\/ori0nori0ff\/ori0nori0ff\.github\.io\/releases\//.test(abs)) return '';
    if ((m = abs.match(/^https:\/\/wsrv\.nl\/\?url=([^&]+)/))) { const inner = map(decodeURIComponent(m[1]), kind); return inner && !/^https?:/.test(inner) ? inner : inner ? abs : ''; }
    if (/^https:\/\/api\.open-meteo\.com\/v1\/forecast/.test(abs)) {
      const q = new URL(abs); q.host = 'historical-forecast-api.open-meteo.com'; ['forecast_days', 'past_days', 'past_hours', 'forecast_hours'].forEach(k => q.searchParams.delete(k));
      q.searchParams.set('start_date', day(AT)); q.searchParams.set('end_date', day(AT + 2 * 864e5)); return q.href;
    }
    if (/earthquake\.usgs\.gov\/earthquakes\/feed\/v1\.0\/summary\/4\.5_week\.geojson/.test(abs))
      return `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=4.5&starttime=${new RD(M.now - 7 * 864e5).toISOString().slice(0, 19)}&endtime=${new RD(M.now).toISOString().slice(0, 19)}`;
    if (/^https:\/\/epic\.gsfc\.nasa\.gov\/api\/natural\/?$/.test(abs)) return 'https://epic.gsfc.nasa.gov/api/natural/date/' + day(M.now);
    return u;
  }

  // TIME MACHINE v2: the page's clock picks the moment (STORM.setAt); the "now" feeds (Kp now, wind + Bz now, L1 1-min, OVATION,
  // NOAA scales, alerts) are then answered as they were at that moment, made from the week's data.json (5-min wind, 3-h Kp, X-rays).
  // Charts keep the whole week. Until the clock moves, the baked files answer as before.
  let AT = M.now, AT3 = M.now, moved = false, atReal = real(), DJ = null;
  const dj = () => DJ || (DJ = F(PRE + 'data.json').then(r => r.ok ? r.json() : null).catch(() => null));
  const J = o => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const isoZ = t => new RD(t).toISOString().slice(0, 19);
  const kpAt = D => { let k = 0; for (const [t, v] of D.kp) if (t <= AT) k = v; return k; };
  const idxAt = D => Math.max(0, Math.min(D.v.length - 1, Math.floor((AT - D.t0) / D.step)));
  const lastOf = (D, k, i) => { const a = D[k]; if (!a) return null; for (let j = i; j >= 0 && j > i - 24; j--) if (a[j] != null) return [D.t0 + j * D.step, a[j]]; return null; };
  function ovation(k) {   // the same Kp-driven oval as tools/build_timemachine.py ovation()
    const r = Math.PI / 180, PL = 80.8 * r, PO = -72.6 * r, c = 66.5 - 2.3 * k, w = 2.6 + .55 * k, amp = Math.min(100, 12 + 10 * k), d = new RD(AT), sun = -((d.getUTCHours() + d.getUTCMinutes() / 60) - 12) * 15, co = [];
    for (let lo = 0; lo < 360; lo++) { const l = (lo <= 180 ? lo : lo - 360) * r, nt = .55 + .45 * -Math.cos(l - sun * r), cc = c - 2.5 * (nt - .5);
      for (let la = -90; la <= 90; la++) { const f = la * r, ml = Math.asin(Math.sin(f) * Math.sin(PL) + Math.cos(f) * Math.cos(PL) * Math.cos(l - PO)) / r, v = amp * nt * Math.exp(-(((Math.abs(ml) - cc) / w) ** 2)); co.push([lo, la, v > 3 ? Math.round(v) : 0]); } }
    return { 'Observation Time': isoZ(AT) + 'Z', 'Forecast Time': isoZ(AT + 35 * 6e4) + 'Z', 'Data Format': '[Longitude, Latitude, Aurora]', coordinates: co, type: 'MultiPoint' }; }
  async function now(p, to) {
    if (p === 'products/alerts.json') { const r = await F(to); if (!r.ok) return r; return J((await r.json()).filter(a => RD.parse(a.issue_datetime.replace(' ', 'T') + 'Z') <= AT)); }
    const D = await dj(); if (!D) return null; const i = idxAt(D), k = kpAt(D);
    if (p === 'json/planetary_k_index_1m.json') { const o = []; for (let t = AT - 60 * 6e4; t <= AT; t += 6e4) o.push({ time_tag: isoZ(t), kp_index: Math.round(k), estimated_kp: Math.round(k * 100) / 100, kp: String(Math.round(k)) }); return J(o); }
    if (p === 'products/summary/solar-wind-speed.json') { const v = lastOf(D, 'v', i); return J(v ? [{ proton_speed: Math.round(v[1]), time_tag: isoZ(v[0]) + 'Z' }] : []); }
    if (p === 'products/summary/solar-wind-mag-field.json') { const b = lastOf(D, 'bz', i), t = lastOf(D, 'bt', i); return J(b ? [{ bt: Math.round(t ? t[1] : 0), bz_gsm: Math.round(b[1]), time_tag: isoZ(b[0]) + 'Z' }] : []); }
    if (p === 'json/rtsw/rtsw_mag_1m.json' || p === 'json/rtsw/rtsw_wind_1m.json') { const o = [], mag = p.includes('mag'), g = (k, j) => D[k] ? D[k][j] : null;
      for (let j = i; j >= 0 && j > i - 576; j--) { const t = isoZ(D.t0 + j * D.step), bx = g('bx', j), by = g('by', j);
        o.push(mag ? { time_tag: t, active: true, source: 'OMNI', bt: g('bt', j), bx_gsm: bx, by_gsm: by, bz_gsm: g('bz', j), phi_gsm: bx == null || by == null ? null : (Math.atan2(by, bx) * 180 / Math.PI + 360) % 360 }
          : { time_tag: t, active: true, source: 'OMNI', proton_speed: g('v', j), proton_density: g('n', j), proton_temperature: g('tp', j) }); }
      return J(o); }
    if (p === 'json/ovation_aurora_latest.json') return J(ovation(k));
    if (p === 'products/noaa-scales.json') { const g = k >= 8.99 ? 5 : k >= 4.66 ? Math.min(4, Math.floor(k + .34) - 4) : 0; let big = 0; for (let j = Math.max(0, i - 288); j <= i; j++) if (D.xr && D.xr[j] > big) big = D.xr[j];
      const r = big >= 2e-3 ? 5 : big >= 1e-3 ? 4 : big >= 1e-4 ? 3 : big >= 5e-5 ? 2 : big >= 1e-5 ? 1 : 0, TX = ['none', 'minor', 'moderate', 'strong', 'severe', 'extreme'], d = new RD(AT);
      return J({ 0: { DateStamp: isoZ(AT).slice(0, 10), TimeStamp: isoZ(AT).slice(11), R: { Scale: String(r), Text: TX[r] }, S: { Scale: '0', Text: 'none' }, G: { Scale: String(g), Text: TX[g] } } }); }
    return null; }
  const NOWF = new Set(['json/planetary_k_index_1m.json', 'products/summary/solar-wind-speed.json', 'products/summary/solar-wind-mag-field.json', 'json/rtsw/rtsw_mag_1m.json', 'json/rtsw/rtsw_wind_1m.json', 'json/ovation_aurora_latest.json', 'products/noaa-scales.json', 'products/alerts.json']);

  const F = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = typeof input === 'string' ? input : input && input.url;
    const to = map(u, 'fetch');
    if (moved && typeof u === 'string') { const abs = new URL(u, location.href).href, p = abs.startsWith(SWPC) ? strip(abs.slice(SWPC.length)) : '';
      if (NOWF.has(p)) return now(p, to || u).then(r => r || (to === '' ? new Response('[]', { status: 404 }) : F(to, init))); }
    if (to === '') return Promise.resolve(new Response('[]', { status: 404, statusText: 'not in storm mode', headers: { 'Content-Type': 'application/json' } }));
    return F(to === u ? input : to, init);
  };
  const hook = (proto, kind) => { const d = Object.getOwnPropertyDescriptor(proto, 'src'); if (!d || !d.set) return;
    Object.defineProperty(proto, 'src', { configurable: true, enumerable: d.enumerable, get() { return d.get.call(this); },
      set(v) { const to = map(String(v), kind); d.set.call(this, to === '' ? (kind === 'img' ? NA : '') : to); } }); };
  hook(HTMLImageElement.prototype, 'img'); hook(HTMLMediaElement.prototype, 'media'); hook(HTMLSourceElement.prototype, 'media');
  const sa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (k, v) { if (k === 'src' && (this instanceof HTMLImageElement || this instanceof HTMLMediaElement)) { this.src = v; return; } return sa.call(this, k, v); };

  window.STORM = { id, now: M.now, at: M.now, sun: Object.keys(M.latest), label: id === 'may2024' ? '10 May 2024' : M.title, week: id !== 'may2024', t0: M.t0,
    // the page's clock → "now" of every live number; clock() = that moment, running on (the 3D model's time)
    // settle = the clock stopped there: only then the 3D model's own time jumps (no jerks while the page clock plays)
    setAt(t, settle) { if (!isFinite(t)) return; AT = this.at = Math.min(M.now, t); moved = true; if (settle) { AT3 = AT; atReal = real(); } },
    clock() { return AT3 + (real() - atReal); },
    data: () => dj() };   // the week's 5-min measurements (the 3D shield reads Bz from it)
  document.documentElement.classList.add('storm');
  document.addEventListener('DOMContentLoaded', () => {
    // <img src> written straight into the HTML
    document.querySelectorAll('img[src], video[src], source[src]').forEach(el => { const s = el.getAttribute('src'), to = map(s, el.tagName === 'IMG' ? 'img' : 'media'); if (to !== s) el.src = s; });
  });
})();
