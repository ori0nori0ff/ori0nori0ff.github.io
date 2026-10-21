/* STORM MODE (?storm=may2024): the whole page as it was at the peak of the G5 storm, 10 May 2024 20:30 UTC (23:30 in Romania).
   Loaded first in <head>; does nothing in calm mode. It moves the page's clock to that moment (time keeps running from there),
   answers the page's NOAA / NASA / Open-Meteo / USGS requests with the real data of that day (baked by tools/build_storm.py into
   storm/may2024/) and shows a placeholder for what did not exist yet (CCOR coronagraphs). The page draws everything as usual. */
(() => {
  const id = new URLSearchParams(location.search).get('storm');
  if (id !== 'may2024') return;
  const BASE = 'storm/may2024/', SWPC = 'https://services.swpc.noaa.gov/', NA = BASE + 'na.svg';
  let M = { now: Date.UTC(2024, 4, 10, 20, 30), swpc: [], latest: {} };
  try { const x = new XMLHttpRequest(); x.open('GET', BASE + 'manifest.json', false); x.send(); if (x.status === 200) M = JSON.parse(x.responseText); } catch (e) {}
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
      if (p.startsWith('__replay/')) return 'replay/may2024/' + p.slice(9);
      if (!have.has(p) && have.has(p.replace('-7-day', '-3-day'))) return BASE + 'swpc/' + p.replace('-7-day', '-3-day');   // the page asks for 7 days, the storm copy has 3
      return have.has(p) || (kind === 'img' && p.startsWith('images/animations/enlil/')) ? BASE + 'swpc/' + p : '';
    }
    if (abs.startsWith(location.origin)) {
      const p = strip(abs.slice(location.origin.length)).replace(/^.*\/aurora\//, '');
      if (p === 'sun/frames.json' || p === 'data/earth.json' || p === 'data/cme.json' || p === 'data/journal.json') return BASE + p;
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
      q.searchParams.set('start_date', day(M.now)); q.searchParams.set('end_date', day(M.now + 2 * 864e5)); return q.href;
    }
    if (/earthquake\.usgs\.gov\/earthquakes\/feed\/v1\.0\/summary\/4\.5_week\.geojson/.test(abs))
      return `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=4.5&starttime=${new RD(M.now - 7 * 864e5).toISOString().slice(0, 19)}&endtime=${new RD(M.now).toISOString().slice(0, 19)}`;
    if (/^https:\/\/epic\.gsfc\.nasa\.gov\/api\/natural\/?$/.test(abs)) return 'https://epic.gsfc.nasa.gov/api/natural/date/' + day(M.now);
    return u;
  }

  const F = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = typeof input === 'string' ? input : input && input.url;
    const to = map(u, 'fetch');
    if (to === '') return Promise.resolve(new Response('[]', { status: 404, statusText: 'not in storm mode', headers: { 'Content-Type': 'application/json' } }));
    return F(to === u ? input : to, init);
  };
  const hook = (proto, kind) => { const d = Object.getOwnPropertyDescriptor(proto, 'src'); if (!d || !d.set) return;
    Object.defineProperty(proto, 'src', { configurable: true, enumerable: d.enumerable, get() { return d.get.call(this); },
      set(v) { const to = map(String(v), kind); d.set.call(this, to === '' ? (kind === 'img' ? NA : '') : to); } }); };
  hook(HTMLImageElement.prototype, 'img'); hook(HTMLMediaElement.prototype, 'media'); hook(HTMLSourceElement.prototype, 'media');
  const sa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (k, v) { if (k === 'src' && (this instanceof HTMLImageElement || this instanceof HTMLMediaElement)) { this.src = v; return; } return sa.call(this, k, v); };

  window.STORM = { id, now: M.now, sun: Object.keys(M.latest), label: '10 May 2024' };
  document.documentElement.classList.add('storm');
  document.addEventListener('DOMContentLoaded', () => {
    // <img src> written straight into the HTML
    document.querySelectorAll('img[src], video[src], source[src]').forEach(el => { const s = el.getAttribute('src'), to = map(s, el.tagName === 'IMG' ? 'img' : 'media'); if (to !== s) el.src = s; });
  });
})();
