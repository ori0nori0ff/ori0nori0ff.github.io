'use strict';
const $ = id => document.getElementById(id);
i18nApply();
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const API = 'https://services.swpc.noaa.gov/';
const q = new URLSearchParams(location.search);
document.querySelectorAll('[data-lang]').forEach(b => { b.setAttribute('aria-pressed', b.dataset.lang === LANG); b.onclick = () => i18nSet(b.dataset.lang); });

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// the place: link (?town=&lat=&lon=) > the one picked on this device > Brașov
let TOWN = (() => {
  if (q.get('lat') && q.get('lon')) return { name: q.get('town') || T('Your place'), lat: +q.get('lat'), lon: +q.get('lon'), sub: q.get('sub') || '' };
  try { const l = JSON.parse(localStorage.getItem('aurora.place') || 'null'); if (l && isFinite(l.lat)) return l; } catch (e) {}
  return { name: 'Brașov', lat: 45.6427, lon: 25.5887, sub: T('Romania') };
})();
let TZ = TOWN.tz || 'Europe/Bucharest';
const need = () => window.AuroraGlobe ? AuroraGlobe.kpNeed(TOWN.lat, TOWN.lon) : 7;
function placeUI() {
  $('place').textContent = T('from {p}', { p: TOWN.name + (TOWN.sub ? ', ' + TOWN.sub : '') }); $('gPlace') && ($('gPlace').textContent = TOWN.name + (TOWN.sub ? ', ' + TOWN.sub : ''));
  $('needWhere').textContent = TOWN.name; $('needKp').textContent = need(); document.querySelectorAll('.needK').forEach(e => e.textContent = need());
}
placeUI();
function setPlace(l) {
  TOWN = l; TZ = l.tz || TZ;
  try { localStorage.setItem('aurora.place', JSON.stringify(l)); } catch (e) {}
  const u = new URL(location.href); u.searchParams.set('town', l.name); u.searchParams.set('lat', (+l.lat).toFixed(4)); u.searchParams.set('lon', (+l.lon).toFixed(4));
  if (l.sub) u.searchParams.set('sub', l.sub); else u.searchParams.delete('sub');
  history.replaceState(null, '', u);   // the address bar = a link to share for this place
  $('locBox').classList.add('hidden'); placeUI(); drawGlobe(); S.wx = null; load();
}
$('locBtn').onclick = () => { const b = $('locBox'); b.classList.toggle('hidden'); if (!b.classList.contains('hidden')) { $('locQ').value = ''; $('locRes').innerHTML = ''; $('locQ').focus(); } };
let locT = 0;
$('locQ').oninput = () => { clearTimeout(locT); const v = $('locQ').value.trim(); if (v.length < 2) { $('locRes').innerHTML = ''; return; }
  locT = setTimeout(async () => { try {
    const r = await j('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(v) + '&count=6&language=' + LANG + '&format=json');
    const L = (r.results || []).map(x => ({ name: x.name, lat: x.latitude, lon: x.longitude, tz: x.timezone, sub: [x.admin1, x.country].filter(Boolean).join(', ') }));
    $('locRes').innerHTML = L.length ? L.map((x, i) => `<button data-i="${i}">${esc(x.name)}<small>${esc(x.sub)}</small></button>`).join('') : '<div class="why">' + T('No place found.') + '</div>';
    $('locRes').onclick = e => { const b = e.target.closest('[data-i]'); if (b) setPlace(L[+b.dataset.i]); };
  } catch (e) { $('locRes').innerHTML = '<div class="why">' + T('No connection.') + '</div>'; } }, 350); };
$('locGps').onclick = () => {
  if (!navigator.geolocation) { $('locRes').innerHTML = '<div class="why">' + T('This browser can\'t share your location.') + '</div>'; return; }
  $('locGps').textContent = T('FINDING YOU…');
  navigator.geolocation.getCurrentPosition(p => { $('locGps').textContent = T('USE MY LOCATION');
      setPlace({ name: T('My location'), lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, sub: '' }); },
    () => { $('locGps').textContent = T('USE MY LOCATION'); $('locRes').innerHTML = '<div class="why">' + T('Location not allowed — search for your town instead.') + '</div>'; },
    { timeout: 15000, maximumAge: 600000 });
};
const hhmm = d => new Date(d).toLocaleTimeString(LOC, { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const day = d => new Date(d).toLocaleDateString(LOC, { timeZone: TZ, weekday: 'short', day: 'numeric' });
const kpColor = k => k >= 9 ? '#8C7CFF' : k >= 8 ? '#D61F3A' : k >= 7 ? '#FF4D4D' : k >= 6 ? '#FF9338' : k >= 5 ? '#FFE14D' : k >= 4 ? '#B8F25C' : '#3FD98A';   // our own spectrum (NOAA uses green / yellow / red): quiet green · active lime · G1 yellow · G2 orange · G3 red · G4 dark red · G5 indigo
async function j(u) { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return r.json(); }
var PHONE = () => innerWidth < 760;   // phones get the compact layout (tonight without tiles, 3D behind a button)
const S = {};

/* ── verdict: tonight 20:00 → 05:00 local ── */
const NOWT = () => window.STORM ? STORM.at : Date.now();   // "now" for the live numbers: the time machine's moment
function tonight() {
  const now = new Date(NOWT()), loc = new Date(now.toLocaleString('en-US', { timeZone: TZ })), off = loc - new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const s = new Date(loc), e = new Date(loc);
  if (loc.getHours() < 5) e.setHours(5, 0, 0, 0); else { s.setHours(Math.max(20, loc.getHours()), 0, 0, 0); e.setDate(e.getDate() + 1); e.setHours(5, 0, 0, 0); }
  return [s - off, e - off];
}
function verdict() {
  if (!S.kpList) return;
  const [s, e] = tonight();
  let kp = S.kpNow || 0;
  S.kpList.forEach(p => { const t = Date.parse(p.time_tag + 'Z'); if (t + 3 * 3.6e6 > s && t < e) kp = Math.max(kp, +p.kp); });
  let clouds = null, dark = null;
  if (S.wx) {
    const H = S.wx.hourly, v = [];
    H.time.forEach((t, i) => { const ms = Date.parse(t + 'Z') - S.wx.utc_offset_seconds * 1000; if (ms >= s && ms < e) v.push(H.cloud_cover[i]); });
    if (v.length) clouds = Math.round(v.reduce((a, x) => a + x, 0) / v.length);
    const ss = S.wx.daily.sunset[0]; if (ss) dark = Date.parse(ss + 'Z') - S.wx.utc_offset_seconds * 1000 + 75 * 60000;
  }
  const N = need();   // Kp needed here (from the geomagnetic latitude)
  const lv = kp >= N + 1 ? [T('Likely'), '#E8283C', 'rgba(220,30,50,.24)'] : kp >= N ? [T('Possible'), '#FFD84D', 'rgba(255,216,77,.16)']
    : kp >= N - 1 ? [T('Unlikely'), '#FFA040', 'rgba(255,160,64,.16)'] : [T('No chance'), '#A3B0C2', 'rgba(163,176,194,.08)'];
  $('vword').textContent = lv[0]; $('vword').style.color = lv[1]; $('vcard').style.setProperty('--glow', lv[2]);
  $('vword').classList.toggle('aur', kp >= N + 1);   // likely: written in aurora colours
  const P = { p: TOWN.name, n: N };
  const so = TOWN.lat < 0;   // southern places: look south, towards the South Pole
  let t = kp >= N + 1 ? T(so ? 'A solar storm strong enough for {p} is forecast — the aurora may be visible to the eye low in the south from dark places.' : 'A solar storm strong enough for {p} is forecast — the aurora may be visible to the eye low in the north from dark places.', P)
    : kp >= N ? T(so ? 'Forecast right at the limit for {p} — a glow on the southern horizon is possible, best caught with a phone\'s night mode.' : 'Forecast right at the limit for {p} — a glow on the northern horizon is possible, best caught with a phone\'s night mode.', P)
    : kp >= N - 1 ? T(so ? 'Close, but usually still too far from the pole for {p}. Worth checking again later tonight.' : 'Close, but usually still too far north for {p}. Worth checking again later tonight.', P)
    : T('{p} needs about Kp {n} to see the aurora. Nothing like that is forecast tonight.', P);
  if (kp >= N - 1 && clouds != null) t += ' ' + (clouds > 70 ? T('Clouds will likely block the view.') : clouds > 40 ? T('Some clouds — look for gaps.') : T('Skies look mostly clear.'));
  $('vtext').textContent = t;
  $('fKp').textContent = kp.toFixed(1); $('fKp').style.color = kpColor(kp);
  $('fCloud').textContent = clouds == null ? '–' : clouds + '%';
  $('fDark').textContent = dark ? hhmm(dark) : '–';
  if (window.AuroraTonight && S.wx) {
    const pl = AuroraTonight.plan({ lat: TOWN.lat, lon: TOWN.lon, need: N, kpList: S.kpList, wx: S.wx, now: NOWT() });
    S.tnPlan = pl; S.tnNeed = N; S.kpT = kp; S.clouds = clouds; AuroraTonight.render($('tonight'), pl, hhmm, kpColor, N, sy.on ? sy.t : 0, { compact: PHONE(), head: false, ...(innerWidth >= 1000 ? { tiles: false, hor: 128 } : {}) }); $('tnTxt').textContent = S.tonight = AuroraTonight.sentence(pl, N, hhmm);
  }
  if (window.redrawDeep) redrawDeep();
 
}

/* ── Kp chart: 3-hour bars, next ~3 days ── */
function kpChart() {
  const now = NOWT(), pts = (S.kpList || []).map(p => ({ t: Date.parse(p.time_tag + 'Z'), k: +p.kp })).filter(p => p.t + 3 * 3.6e6 > now).slice(0, 24);
  if (!pts.length) { $('kp').textContent = 'No forecast right now.'; return; }
  const W = 520, H = 170, L = 24, B = 26, bw = (W - L) / pts.length, y = k => H - B - k / 9 * (H - B - 8);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Kp forecast">`;
  const N = need();
  [3, 5, 7, 9].forEach(k => svg += `<line x1="${L}" x2="${W}" y1="${y(k)}" y2="${y(k)}" stroke="#1E2530"/><text x="0" y="${y(k) + 4}" font-size="11" fill="#6B7280">${k}</text>`);
  svg += `<line x1="${L}" x2="${W}" y1="${y(N)}" y2="${y(N)}" stroke="rgba(255,68,68,.6)" stroke-dasharray="4 4"/><text x="${W}" y="${y(N) - 5}" font-size="10" fill="#FF6B6B" text-anchor="end">NEEDED IN ${esc(TOWN.name.toUpperCase().slice(0, 16))} · KP ${N}</text>`;
  let lastDay = '', lastX = -99;
  pts.forEach((p, i) => {
    const x = L + i * bw + 2, h = Math.max(2, H - B - y(p.k));
    svg += `<rect x="${x}" y="${y(p.k)}" width="${bw - 4}" height="${h}" rx="3" fill="${kpColor(p.k)}"/>`;
    const d = day(p.t); if (d !== lastDay) { lastDay = d; if (x - lastX < 56) return; lastX = x; svg += `<text x="${x}" y="${H - 8}" font-size="11" fill="#8B9BAE">${d.toUpperCase()}</text><line x1="${x - 2}" x2="${x - 2}" y1="${H - B}" y2="8" stroke="#1E2530"/>`; }
  });
  $('kp').className = ''; $('kp').innerHTML = svg + '</svg>';
}

function toast(m, ms) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms || 2200); }

/* ── The Sun now: the app's Sun sheet. Frame lists come from sun/frames.json (GitHub Actions lists NASA's
   archives every hour — NASA allows no browser requests); the pictures themselves load straight from NASA. ── */
const SUNF = [
  ['C3', 'LASCO C3', '#4A7BFF', T('<b>CMEs.</b> The Sun is hidden behind a disk so we can see what it throws into space. A cloud spreading out <b>all around the disk ("halo")</b> is heading our way — aurora chance in 1–4 days.'), 'https://soho.nascom.nasa.gov/data/realtime/c3/512/latest.jpg'],
  ['CCOR1', 'CCOR-1', '#FF7AB6', T('<b>NOAA\'s new coronagraph (GOES-19), close to the Sun.</b> CMEs as they leave — every 15 minutes, the last 24 hours.')],
  ['CCOR2', 'CCOR-2', '#C792FF', T('<b>NOAA\'s wide coronagraph.</b> Follows CMEs further out into space. A cloud all around the disk is coming towards us.')],
  ['C2', 'LASCO C2', '#FF8A4A', T('<b>SOHO\'s inner coronagraph.</b> The first hours of a CME, close to the Sun.')],
  ['0171', 'AIA 171', '#FFB300', T('<b>Quiet corona, ~600,000 °C.</b> The glowing loops follow the Sun\'s magnetic field.')],
  ['0193', 'AIA 193', '#00AAFF', T('<b>Hot corona, ~1 million °C.</b> Dark patches are coronal holes: they blow fast solar wind that reaches Earth 2–4 days later.')],
  ['0304', 'AIA 304', '#FF4400', T('<b>Just above the surface, ~50,000 °C.</b> Dark threads (filaments) can lift off and become CMEs.')],
  ['HA', 'H-alpha', '#FF6F6F', T('<b>The chromosphere in hydrogen light (GONG: six ground telescopes round the world).</b> Dark threads are filaments: when one lifts off, a CME often follows. Bright patches are active regions; a flare flashes white.')],
  ['0094', 'AIA 094', '#44FF88', T('<b>Flaring regions, ~6 million °C.</b> Bright spots are active, flare-prone areas.')],
  ['0131', 'AIA 131', '#00E5CC', T('<b>Hottest flare gas, ~10 million °C.</b> A sudden bright flash is a solar flare.')],
  ['1600', 'AIA 1600', '#FFDD00', T('<b>Upper surface.</b> Bright patches mark strong magnetism around sunspots.')],
  ['HMIIC', 'HMI IC', '#CCCCCC', T('<b>The Sun as your eye would see it.</b> Sunspots are where flares and CMEs come from.')],
  ['HMIB', 'HMI B', '#8888FF', T('<b>Magnetic map.</b> White and black are opposite magnetic poles; tangled, mixed spots flare the most.')],
  ['HMIBC', 'HMI color', '#E8C34A', T('<b>Magnetic field strength, in colour.</b> Yellow / red and green / blue are opposite poles; the strongest knots (red, blue) sit in sunspots and are where big flares start.')],
].filter(f => !window.STORM || STORM.sun.includes(f[0]));
/* one time axis for every slider: the solar wind model run's span (the Sun's 5 days reach back further),
   or the Sun's own range until the model has loaded — so the same moment sits at the same spot on all three */
function axis() {
  const E = (typeof enl !== 'undefined' && enl.frames) || [], fr = (sun.F && sun.F.filters[SUNF[sun.k][0]]) || [];
  const ts = []; if (E.length > 1) ts.push(E[0].t, E[E.length - 1].t); if (fr.length > 1) ts.push(fr[0][0], fr[fr.length - 1][0]);
  return ts.length ? { a: Math.min(...ts), b: Math.max(...ts) } : null;   // oldest Sun frame → end of the forecast
}
const toPos = t => { const x = axis(); return x ? Math.round(Math.max(0, Math.min(1, (t - x.a) / (x.b - x.a))) * 1000) : 0; };
const toTime = v => { const x = axis(); return x ? x.a + (x.b - x.a) * v / 1000 : Date.now(); };
const nearestT = (n, tOf, t) => { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (tOf(m) < t) lo = m + 1; else hi = m; } return lo > 0 && Math.abs(tOf(lo - 1) - t) < Math.abs(tOf(lo) - t) ? lo - 1 : lo; };
const CLIPS = 'https://github.com/ori0nori0ff/ori0nori0ff.github.io/releases/download/sun-clips/';
const hiRes = u => u.replace('_1024_', '_2048_').replace('_M_512.jpg', '_M_1k.jpg').replace('_Ic_flat_512.jpg', '_Ic_flat_1k.jpg').replace('_c3_512.jpg', '_c3_1024.jpg').replace('/HA/hac/', '/HA/hag/');
const latestOf = f => f[4] || 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_' + f[0] + '.jpg';
const sun = { F: null, k: 0, i: 0, play: false, timer: null, imgs: [], seq: 0 };
$('sunPlay').textContent = $('sunFPlay').textContent = '▶';   // nothing plays until asked (one shared clock)
const sunFr = () => (sun.F && sun.F.filters[SUNF[sun.k][0]]) || [];
const sunT = t => new Date(t).toLocaleString(LOC, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ }).replace(',', '');
$('sunChips').innerHTML = SUNF.map((f, i) => `<button data-i="${i}" style="color:${f[2]};border-color:${f[2]}66">${f[1]}</button>`).join('');
$('sunChips').onclick = e => { const b = e.target.closest('button'); if (b) sunPick(+b.dataset.i); };
const flWhere = (RI, f) => { const i = RI && window.SunRegions && SunRegions.flareInfo(RI, f.begin_time); if (!i || !i.region) return '';
  return `<span class="flw">${esc(i.region)}${i.lat != null ? ' · ' + SunRegions.where(i) : ''}${i.earth ? ' · <b>↯ ' + T('faced Earth') + '</b>' : ''}</span>`; };
(function () { const h = document.getElementById('srHost'); if (!h) return; let done = false; const go = () => { if (!done && window.SunRegions) { done = true; const api = SunRegions.mount(h, { limit: 6 });
    // PC: show as many regions as fit beside the Sun, so both columns end together (golden-ratio columns, equal heights)
    const fit = () => { const l = h.querySelector('.sr-l'), r = h.querySelector('.sr-r'); if (!l || !r || !api.count() || getComputedStyle(h).display !== 'grid') return;
      let best = 3, bd = 1e9; for (let n = 3; n <= api.count(); n++) { api.setLimit(n); const d = Math.abs(r.offsetHeight - l.offsetHeight); if (d < bd) { bd = d; best = n; } } api.setLimit(best); };
    [2500, 6000, 12000].forEach(ms => setTimeout(fit, ms)); addEventListener('resize', () => { clearTimeout(fit.t); fit.t = setTimeout(fit, 300); }); (function x() { window.srXray ? srXray() : setTimeout(x, 800); })(); } };
  if (window.IntersectionObserver) new IntersectionObserver((e, o) => { if (e.some(x => x.isIntersecting)) { o.disconnect(); go(); } }, { rootMargin: '600px' }).observe(h); else go(); })();
async function loadSun() {
  try { sun.F = await j('sun/frames.json?t=' + Math.floor(Date.now() / 300000)); } catch (e) { sun.F = null; }
  if (!sun.F) sun.F = { filters: {} };
  const NO = 'https://services.swpc.noaa.gov', tOf = u => { const m = u.match(/(\d{8})_(\d{4})/); return m ? Date.parse(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}T${m[2].slice(0, 2)}:${m[2].slice(2)}:00Z`) : 0; };
  await Promise.allSettled([['CCOR1', '/products/ccor1/jpegs.json'], ['CCOR2', '/products/ccor2/jpegs.json'], ['C2', '/products/animations/lasco-c2.json']].map(([id, u]) =>
    j(NO + u + '?t=' + Math.floor(Date.now() / 600000)).then(a => { sun.F.filters[id] = a.map(f => [f.time_tag ? Date.parse(f.time_tag) : tOf(f.url), NO + f.url]).filter(f => f[0]).sort((x, y) => x[0] - y[0]);
      if (/^CCOR/.test(id)) { const L = sun.F.filters[id], t0 = L.length ? L[L.length - 1][0] - 7 * 864e5 : 0;   // NOAA keeps ~a month: the last 7 days every 30 min, like the other filters
        sun.F.filters[id] = L.filter((f, i) => f[0] >= t0 && (L.length - 1 - i) % 2 === 0); } })));
  if (!sun.started) { sun.started = true; sunPick(Math.max(0, SUNF.findIndex(f => f[0] === 'CCOR1'))); } else sunStatus();   // starts on CCOR-1 (CMEs as they leave the Sun)
}
function sunStatus() {
  const fr = sunFr(), last = fr.length ? fr[fr.length - 1][0] : 0, age = last ? (Date.now() - last) / 60000 : 0;
  $('sunStat').classList.toggle('stale', !!last && age > 120);
  $('sunStat').textContent = !last ? T('LATEST NASA IMAGE (LOOP NOT READY)') : (age > 120 ? T('⚠ NASA FEED STALE') + ' · ' : T('NEWEST') + ' ') + sunT(last) + ' · ' + (age < 90 ? T('{n} MIN AGO', { n: Math.round(age) }) : T('{n} H AGO', { n: Math.round(age / 60) }));
}
function sunPick(k) {
  sun.k = (k + SUNF.length) % SUNF.length; const f = SUNF[sun.k], fr = sunFr(), seq = ++sun.seq;
  document.querySelectorAll('#sunChips button').forEach((b, i) => { const on = i === sun.k; b.style.background = on ? SUNF[i][2] : 'none'; b.style.color = on ? '#0A0A0A' : SUNF[i][2];
    if (on && b.parentNode.scrollWidth > b.parentNode.clientWidth) { const P = b.parentNode, l = b.offsetLeft - P.offsetLeft, r = l + b.offsetWidth; if (l < P.scrollLeft) P.scrollTo({ left: l - 8, behavior: 'smooth' }); else if (r > P.scrollLeft + P.clientWidth) P.scrollTo({ left: r - P.clientWidth + 8, behavior: 'smooth' }); } });
  $('sunLbl').textContent = f[1]; $('sunDot').style.background = f[2]; $('sunCount').textContent = (sun.k + 1) + ' / ' + SUNF.length;
  const ownClip = !['CCOR1', 'CCOR2', 'C2', 'HMIBC'].includes(f[0]);   // the bot renders clips for its own lists only
  $('sunHelp').innerHTML = f[3]; $('sunClip').href = ownClip ? CLIPS + 'sun-' + f[0] + '.mp4' : VID(f[0]); $('sunClip').setAttribute('download', 'sun-' + f[0] + '.mp4');
  $('sunClip').textContent = /^CCOR/.test(f[0]) ? T('⬇ CLIP · 7 DAYS') : T('⬇ CLIP · 48 H');
  if (/^CCOR/.test(f[0])) $('sunClip').href = VID(f[0]).replace('last_24hrs', 'last_7_days');   // NOAA's 7-day movie covers the whole loop
  $('sunVidB').style.display = 'none';
  sunStatus(); clearInterval(sun.timer); sun.imgs = []; const wasVid = vidOn; vidStop();
  if (wasVid) setTimeout(() => { if (seq === sun.seq) vidStart(); }, 0);   // switching filter keeps the movie going
  if (!fr.length) { const u = latestOf(f) + '?t=' + Math.floor(Date.now() / 600000); sunImgSrc(u); $('sunSave').href = u; $('sunTime').textContent = $('sunFTime').textContent = T('LATEST');
    $('sunSlide').max = $('sunFSlide').max = 0; $('sunLoad').textContent = ''; return; }
  $('sunSlide').max = $('sunFSlide').max = 1000; sun.i = fr.length - 1;
  // preload light (512 px) frames, starting where the clock is and going the way it plays — so a switch while playing catches up fast
  let done = 0; sun.imgs = fr.map(() => null);
  const st = typeof sy !== 'undefined' && sy.on ? nearestT(fr.length, k => fr[k][0], Math.min(sy.t, fr[fr.length - 1][0])) : fr.length - 1, dirn = typeof sy !== 'undefined' && sy.dir < 0 ? -1 : 1;
  const order = st === fr.length - 1 && !(typeof sy !== 'undefined' && sy.timer) ? fr.map((_, i) => fr.length - 1 - i) : fr.map((_, n) => ((st + dirn * n) % fr.length + fr.length) % fr.length);
  const LTp = document.documentElement.classList.contains('lite'); (LTp ? order.slice(0, 80) : order).forEach((i, n) => setTimeout(() => { if (seq !== sun.seq) return;
    const im = new Image(); im.onload = im.onerror = () => { if (seq !== sun.seq) return; done++;
      $('sunLoad').textContent = done < fr.length ? T('LOADING {p}%', { p: Math.round(done / fr.length * 100) }) : '';
      if (done === Math.ceil(fr.length * .6) && sy.on) syShow(sy.t); };
    im.src = lo(fr[i][1]); sun.imgs[i] = im; }, n * (LTp ? 60 : 15)));
  sunShow(sun.i); if (typeof sy !== 'undefined' && sy.on) syShow(sy.t);
}
// two stacked pictures: the next frame is decoded off-screen, then swapped in at once (no half-loaded frames)
// 512 px frames only where they're enough (small phone boxes); 1024 px elsewhere so the loop stays sharp
const small = u => ($('sunBox').clientWidth || 400) * (devicePixelRatio || 1) > 720 ? u : u.replace('_1024_', '_512_');
const lo = u => u.replace('_1024_', '_512_');   // what plays (and is preloaded); a paused frame is shown sharp
let sunTop = 0, sunSeq = 0, sunSwapAt = 0;
function sunImgSrc(u, fade) {
  $('sunFImg').src = u; const A = [$('sunImg'), $('sunImg2')], cur = A[sunTop], nxt = A[1 - sunTop], seq = ++sunSeq;
  if (cur.getAttribute('src') === u) return;
  if (!fade || REDUCED) { cur.src = u; cur.style.opacity = 1; nxt.style.opacity = 0; return; }
  const swap = () => { nxt.src = u; nxt.style.opacity = 1; nxt.style.zIndex = 2; cur.style.zIndex = 1; cur.style.opacity = 0; sunTop = 1 - sunTop; sunSwapAt = performance.now(); };
  // already preloaded → show it now (the clock asks for a new frame every 80 ms, faster than a decode round-trip)
  if (sun.imgs.some(im => im && im.complete && im.naturalWidth && im.src === new URL(u, location.href).href)) { swap(); return; }
  const im = new Image(); im.src = u;
  (im.decode ? im.decode() : new Promise(r => { im.onload = im.onerror = r; })).catch(() => {}).then(() => {
    if (seq !== sunSeq && performance.now() - sunSwapAt < 250) return;   // a newer frame was asked for — unless nothing changed for a while
    swap();
  });
}
function sunShow(i) {
  const fr = sunFr(); if (!fr.length) return; sun.i = (i + fr.length) % fr.length;
  const u = fr[sun.i][1];
  const playing = sun.play || !!sy.timer; sunImgSrc(playing ? lo(u) : u, playing); $('sunSave').href = hiRes(u);   // playing → light 512 px frames, faded; paused → the sharp one
  $('sunTime').textContent = $('sunFTime').textContent = sunT(fr[sun.i][0]); $('sunSlide').value = $('sunFSlide').value = toPos(fr[sun.i][0]);
  const ax = axis(); $('sunLbl').textContent = SUNF[sun.k][1] + (sun.i === fr.length - 1 && ax && ax.b > fr[sun.i][0] + 3600e3 ? ' · ' + T('LATEST') : '');   // later times = only the forecast moves on
}
const VID = id => ({ CCOR1: 'https://services.swpc.noaa.gov/products/ccor1/mp4s/ccor1_last_24hrs.mp4', CCOR2: 'https://services.swpc.noaa.gov/products/ccor2/mp4s/ccor2_last_24hrs.mp4',
  C2: 'https://soho.nascom.nasa.gov/data/LATEST/current_c2.mp4', C3: CLIPS + 'sun-C3.mp4' })[id] || 'https://sdo.gsfc.nasa.gov/assets/img/latest/mpeg/latest_512_' + id + '.mp4';
const VSPAN = id => /^CCOR/.test(id) ? T('LAST 24 H') : T('LAST 48 H');
const HASVID = id => id === 'CCOR1' || id === 'CCOR2';   // NOAA's own CCOR movies
let vidOn = false;
function vidStart() {   // the filter's official movie, smooth (decoded video) — separate from the shared clock
  const v = $('sunVid'), id = SUNF[sun.k][0], u = VID(id); if (!v) return false; vidOn = true; $('sunVidB').setAttribute('aria-pressed', 'true'); $('sunVidB').textContent = '■ VIDEO';
  if (v.dataset.u !== u) { v.dataset.u = u; v.src = u; v.load(); }
  v.onerror = () => { vidStop(); toast(T('This video is not available right now.')); };
  v.ontimeupdate = () => { if (v.duration) { $('sunTime').textContent = VSPAN(id); $('sunSlide').value = Math.round(v.currentTime / v.duration * 1000); } };
  v.onwaiting = () => { $('sunLoad').textContent = T('LOADING VIDEO…'); }; v.onplaying = () => { $('sunLoad').textContent = ''; };
  $('sunBox').classList.add('vid'); $('sunLbl').textContent = SUNF[sun.k][1] + ' · ' + VSPAN(id);
  v.play().catch(() => vidStop()); return true;
}
function vidStop() { const v = $('sunVid'); if (v) v.pause(); vidOn = false; $('sunBox').classList.remove('vid'); $('sunLoad').textContent = '';
  const b = $('sunVidB'); if (b) { b.setAttribute('aria-pressed', 'false'); b.textContent = '▶ VIDEO'; } }
$('sunVidB').onclick = () => { if (vidOn) { vidStop(); sunShow(sun.i); } else { if (typeof syStop === 'function') syStop(); vidStart(); } };
function sunStart() { clearInterval(sun.timer); sun.play = true; $('sunPlay').textContent = $('sunFPlay').textContent = '⏸';
  sun.timer = setInterval(() => { const fr = sunFr(); if (!fr.length) return; let n = sun.i;
    const x = axis(), a0 = x ? x.a : 0;
    for (let k = 0; k < fr.length; k++) { n = (n + 1) % fr.length; if (fr[n][0] < a0 - 3600e3) continue; const im = sun.imgs[n]; if (im && im.complete && im.naturalWidth) break; }
    sunShow(n); }, 110); }
function sunStop() { clearInterval(sun.timer); vidStop(); sun.play = false; $('sunPlay').textContent = $('sunFPlay').textContent = '▶'; sunShow(sun.i); }
$('sunPlay').onclick = $('sunFPlay').onclick = () => sun.play ? sunStop() : sunStart();
$('sunSlide').oninput = $('sunFSlide').oninput = e => { sunStop(); const fr = sunFr(); if (!fr.length) return;
  const t = Math.min(toTime(+e.target.value), fr[fr.length - 1][0]); sunShow(nearestT(fr.length, k => fr[k][0], t)); };
$('sunPrev').onclick = () => sunPick(sun.k - 1); $('sunNext').onclick = () => sunPick(sun.k + 1);
(() => { let x0 = null; const B = $('sunBox');
  B.addEventListener('pointerdown', e => { if (!e.target.closest('button')) x0 = e.clientX; });
  B.addEventListener('pointerup', e => { if (x0 == null) return; const d = e.clientX - x0; x0 = null; if (Math.abs(d) > 50) sunPick(sun.k + (d < 0 ? 1 : -1)); }); })();
$('sunFullB').onclick = () => { if ($('sunBox').classList.contains('vid')) sunStop(); $('sunFull').classList.add('on'); sunShow(sun.i); window.syAuto && syAuto(); };
$('sunFX').onclick = () => $('sunFull').classList.remove('on');
$('sunClip').onclick = () => toast(T(/^CCOR/.test(SUNF[sun.k][0]) ? 'Downloading the last 7 days of {f}…' : 'Downloading the last 48 h of {f}…', { f: SUNF[sun.k][1] }));

/* ── Solar wind forecast: the app's WSA-ENLIL card (NOAA allows browser requests, so frames and clips can be saved) ── */
const enl = { frames: [], i: 0, play: null, cache: {} };
const ENL_ARCH = 'https://raw.githubusercontent.com/ori0nori0ff/ori0nori0ff.github.io/enlil/';
const frameT = u => { const m = u.match(/(\d{8})T(\d{2})(\d{2})(\d{2})/); return m ? Date.parse(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}T${m[2]}:${m[3]}:${m[4]}Z`) : 0; };
const dayHm = t => new Date(t).toLocaleString(LOC, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }).replace(/,/g, '').toUpperCase();
const dayD = t => new Date(t).toLocaleDateString(LOC, { day: 'numeric', month: 'short', timeZone: TZ }).toUpperCase();
function enlSummary() {
  const now = NOWT(), F = S.enl.filter(p => p.t >= now);
  if (!F.length) { $('enlSum').textContent = T('This model run has no forecast left — waiting for the next one.'); return; }
  const pn = F.reduce((a, p) => p.n > a.n ? p : a), pv = F.reduce((a, p) => p.v > a.v ? p : a), cme = F.find(p => p.cme);
  const strong = pn.n >= 20 || pv.v >= 600;
  $('enlSum').innerHTML = (cme ? T('<b style="color:#E05BFF">CME impact predicted ≈ {t}</b> (±7 h).', { t: dayHm(cme.t) }) : `<b style="color:${strong ? '#FFA040' : '#6EE7A0'}">${strong ? T('Faster / denser wind ahead') : T('No CME impact')}</b> ` + T('in this run.')) + ' '
    + T('Peak density <b>{n} /cm³</b> {a} · peak speed <b>{v} km/s</b> {b}.', { n: pn.n.toFixed(0), a: dayHm(pn.t), v: Math.round(pv.v), b: dayHm(pv.t) }) + ' '
    + (cme || strong ? T('Watch the Kp forecast and Bz around then.') : T('Normal is ≈ 5 /cm³ and 350–450 km/s.'));
}
// NOAA frame (960×600): per row (density on top, speed 264 px lower) the view from above (disc), from the side
// (half circle) and NOAA's graphs. We keep the two views, clipped to their shapes, and draw our own graphs.
const ENL = { n: { y: 0, name: T('DENSITY · PARTICLES PER CM³'), col: '#39FF9E' }, v: { y: 264, name: T('SPEED · KM/S'), col: '#FFA040' } };
const ENL_SUN = [202, 184], ENL_EARTH = [275, 183], ENL_SEARTH = [430, 175], ENL_AU = 73;   // px in the density row
let enlView = 'f';   // full screen shows density + speed
const enlImg = src => { let im = enl.cache[src]; if (!im) { im = new Image(); im.crossOrigin = 'anonymous'; im.src = src; enl.cache[src] = im; } return im; };
// STEREO-A = the small red marker near Earth's orbit in the density disc (found once per run)
function enlStereo(im) {
  try { const c = document.createElement('canvas'); c.width = 258; c.height = 258; const g = c.getContext('2d');
    g.drawImage(im, 76, 58, 258, 258, 0, 0, 258, 258); const d = g.getImageData(0, 0, 258, 258).data; let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < 258; y++) for (let x = 0; x < 258; x++) { const r = Math.hypot(x + 76 - ENL_SUN[0], y + 58 - ENL_SUN[1]); if (r < 55 || r > 95) continue;
      const k = (y * 258 + x) * 4, R = d[k], G = d[k + 1], B = d[k + 2]; if (R > 200 && G > 80 && G < 150 && B > 80 && B < 150) { sx += x; sy += y; n++; } }
    return n >= 4 && n < 120 ? [sx / n + 76, sy / n + 58] : null; } catch (e) { return null; }
}
// a boxed label with a leader line; (x, y) = the marker
function enlLabel(g, x, y, txt, col, dx, dy, fs) {
  g.font = `700 ${fs}px "JetBrains Mono", monospace`; const w = g.measureText(txt).width + fs, lx = x + dx, ly = y + dy;
  g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(lx + (dx < 0 ? w : 0), ly); g.stroke();
  g.fillStyle = 'rgba(10,10,10,.85)'; g.fillRect(lx, ly - fs, w, fs * 1.6); g.fillStyle = col; g.fillText(txt, lx + fs / 2, ly + fs * .35);
}
const enlCap = (g, x, y, txt, col, fs, al) => { g.font = `700 ${fs}px "JetBrains Mono", monospace`; g.fillStyle = col || '#8B9BAE'; g.textAlign = al || 'left'; g.fillText(txt, x, y); g.textAlign = 'left'; };
// disc + side view of row k at (x, y), scale s (NOAA px → canvas px), fs = label size
function enlViews(g, im, k, x, y, s, fs) {
  const dy = ENL[k].y, D = ([px, py]) => [x + (px - 76) * s, y + (py - 58) * s];
  g.save(); g.beginPath(); g.arc(x + 126 * s, y + 126 * s, 126 * s, 0, 2 * Math.PI); g.clip();
  g.drawImage(im, 76, 58 + dy, 258, 258, x, y, 258 * s, 258 * s); g.restore();
  const xs = x + 266 * s, ys = y + 7 * s;   // side view: apex (Sun) at NOAA (358, 183) → crop (16, 121)
  g.save(); g.beginPath(); g.moveTo(xs + 16 * s, ys + 121 * s); g.arc(xs + 16 * s, ys + 121 * s, 128 * s, -Math.PI / 3, Math.PI / 3); g.closePath(); g.clip();
  g.drawImage(im, 342, 62 + dy, 148, 244, xs, ys, 148 * s, 244 * s); g.restore();
  enlCap(g, x, y + fs, T('FROM ABOVE'), '#8B9BAE', fs * .85); enlCap(g, xs + 148 * s, y + fs, T('FROM THE SIDE'), '#8B9BAE', fs * .85, 'right');
  // Sun / Earth / STEREO-A (NOAA's markers), labels
  const boxes = [], put = (bx, by, bw, bh) => { boxes.push([bx, by, bw, bh]); }, hit = (bx, by, bw, bh) => boxes.some(q => bx < q[0] + q[2] && bx + bw > q[0] && by < q[1] + q[3] && by + bh > q[1]);
  let q = D(ENL_SUN); enlLabel(g, q[0], q[1], T('SUN'), '#FFE600', -fs * 5.5, -fs * 2.6, fs); put(q[0] - fs * 5.5, q[1] - fs * 3.6, fs * 4.4, fs * 1.6);
  q = D(ENL_EARTH); enlLabel(g, q[0], q[1], T('EARTH'), '#7CFF7C', fs * .8, fs * 3, fs); put(q[0] + fs * .8, q[1] + fs * 2, fs * 6, fs * 1.6);
  if (enl.stereo) { q = D(enl.stereo); enlLabel(g, q[0], q[1], 'STEREO-A', '#FF8A8A', fs, -fs * 2.2, fs); put(q[0] + fs, q[1] - fs * 3.2, fs * 8.8, fs * 1.6); }
  q = [xs + (ENL_SEARTH[0] - 342) * s, ys + (ENL_SEARTH[1] - 62) * s]; enlLabel(g, q[0], q[1], T('EARTH'), '#7CFF7C', -fs * 2, fs * 3.4, fs);
}
// our own graph of the model at Earth for row k, in the app's style
function enlChart(g, k, X, Y, W, H, fs) {
  const P = S.enl; if (!P) return;
  const val = p => k === 'n' ? p.n : p.v, col = ENL[k].col, L = fs * 3.4, B = fs * 2, T = fs * 2.2, from = P[0].t, to = P[P.length - 1].t;
  const lo = k === 'n' ? 0 : 250, hi = k === 'n' ? Math.max(20, ...P.map(val)) * 1.12 : Math.max(700, ...P.map(val)) * 1.06;
  const x = t => X + L + (t - from) / (to - from) * (W - L - fs), y = v => Y + H - B - (v - lo) / (hi - lo) * (H - B - T);
  g.fillStyle = '#0F1216'; g.beginPath(); g.roundRect(X, Y, W, H, 12); g.fill();
  enlCap(g, X + fs, Y + fs * 1.4, k === 'n' ? window.T('AT EARTH · DENSITY /CM³') : window.T('AT EARTH · SPEED KM/S'), col, fs * .9);
  let c0 = null; P.forEach((p, i) => { if (p.cme && c0 == null) c0 = p.t; if ((!p.cme || i === P.length - 1) && c0 != null) { g.fillStyle = 'rgba(224,91,255,.2)'; g.fillRect(x(c0), Y + T, Math.max(2, x(p.t) - x(c0)), H - B - T); c0 = null; } });
  g.lineWidth = 1; g.font = `500 ${fs * .8}px "JetBrains Mono", monospace`;
  (k === 'n' ? [0, 10, 20, 30, 40, 60, 80, 100] : [300, 400, 500, 600, 800, 1000, 1200]).filter(v => v >= lo && v < hi).forEach(v => {
    g.strokeStyle = '#232830'; g.beginPath(); g.moveTo(X + L, y(v)); g.lineTo(X + W - fs, y(v)); g.stroke(); g.fillStyle = '#6B7280'; g.fillText(v, X + fs * .6, y(v) + fs * .3); });
  const d = new Date(from); d.setHours(24, 0, 0, 0);
  for (; d.getTime() < to; d.setDate(d.getDate() + 1)) { const xx = x(d.getTime()); g.strokeStyle = '#1E2530'; g.beginPath(); g.moveTo(xx, Y + T); g.lineTo(xx, Y + H - B); g.stroke();
    g.fillStyle = '#8B9BAE'; g.fillText(dayD(d.getTime()), xx + 3, Y + H - fs * .6); }
  const cut = P[0].old && P.find(p => !p.old);   // archived earlier runs | the current run
  if (cut) { g.setLineDash([4, 4]); g.strokeStyle = '#4B5563'; g.beginPath(); g.moveTo(x(cut.t), Y + T); g.lineTo(x(cut.t), Y + H - B); g.stroke(); g.setLineDash([]);
    enlCap(g, x(cut.t) - 4, Y + T + fs * .9, '◂ ' + window.T('EARLIER RUNS'), '#8B9BAE', fs * .75, 'right'); }
  g.beginPath(); g.moveTo(x(from), y(lo)); P.forEach(p => g.lineTo(x(p.t), y(val(p)))); g.lineTo(x(to), y(lo)); g.closePath();
  g.fillStyle = k === 'n' ? 'rgba(57,255,158,.14)' : 'rgba(255,160,64,.12)'; g.fill();
  g.beginPath(); P.forEach((p, i) => i ? g.lineTo(x(p.t), y(val(p))) : g.moveTo(x(p.t), y(val(p)))); g.strokeStyle = col; g.lineWidth = 1.8; g.stroke();
  const now = Date.now(), inTile = !!g.canvas.closest('.tls'); if (now > from && now < to) { g.setLineDash(inTile ? [] : [2, 3]); g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = inTile ? 3 : 1; g.beginPath(); g.moveTo(x(now), Y + T); g.lineTo(x(now), Y + H - B); g.stroke(); g.setLineDash([]);
    enlCap(g, x(now) + 3, Y + T + fs * .9, window.T('NOW'), '#fff', fs * .8); }
  const f = enl.frames[enl.i]; if (f && f.t >= from && f.t <= to) { const p = P.reduce((a, q) => Math.abs(q.t - f.t) < Math.abs(a.t - f.t) ? q : a);
    g.strokeStyle = '#7FB8FF'; g.lineWidth = g.canvas.closest('.tls') ? 5 : 1.5; g.beginPath(); g.moveTo(x(f.t), Y + T); g.lineTo(x(f.t), Y + H - B); g.stroke();   // thicker in a board tile (shrunk ~3×), or the moving line flickers
    g.fillStyle = '#7FB8FF'; g.beginPath(); g.arc(x(p.t), y(val(p)), fs * .4, 0, 7); g.fill();
    enlCap(g, X + W - fs, Y + fs * 1.4, (k === 'n' ? p.n.toFixed(1) + ' /CM³' : Math.round(p.v) + ' KM/S'), '#CFE3FF', fs * .9, 'right'); }
}
// the card: per row a header, the two views side by side, the graph below
function enlCard(g, im, W, draw) {
  const rows = enlView === 'f' ? ['n', 'v'] : [enlView], s = (W - 8) / 414, fs = 9; let y = 0;
  rows.forEach(k => { if (draw) { enlCap(g, 0, y + 11, ENL[k].name, ENL[k].col, 10); enlViews(g, im, k, 0, y + 20, s, fs); enlChart(g, k, 0, y + 24 + 258 * s, W, 128, fs); }
    y += 24 + 258 * s + 128 + 18; });
  return y;
}
function enlDrawOne(cv, k, im) {
  const W = cv.clientWidth || 340, s = (W - 8) / 414, fs = W > 470 ? 10.5 : 9.5, ch = Math.round(Math.max(130, W * .34)), H = Math.round(8 + 258 * s + 12 + ch);
  const dpr = Math.max(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px'; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.imageSmoothingQuality = 'high'; g.clearRect(0, 0, W, H);
  enlViews(g, im, k, 0, 4, s, fs); enlChart(g, k, 0, 12 + 258 * s, W, ch, fs);
}
function enlDraw() {
  const f = enl.frames[enl.i]; if (!f) return; const im = enlImg(f.u);
  if (!im.complete || !im.naturalWidth) { im.onload = () => enl.frames[enl.i] === f && enlDraw(); return; }
  if (enl.stereoRun !== enl.run) { enl.stereo = enlStereo(im); enl.stereoRun = enl.run; }
  enlDrawOne($('enlCvN'), 'n', im); enlDrawOne($('enlCvV'), 'v', im);
  if ($('enlFull').style.display === 'block') enlFDraw(im);
}
// full screen (landscape): per row the two views on the left, the graph filling the rest
function enlFDraw(im) {
  const cv = $('enlFCv'), W = fz.w, H = fz.h, dpr = Math.max(2, window.devicePixelRatio || 1), rows = enlView === 'f' ? ['n', 'v'] : [enlView];
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.imageSmoothingQuality = 'high'; g.clearRect(0, 0, W, H);
  const rh = (H - 12 * (rows.length - 1)) / rows.length, fs = Math.max(9, Math.min(12, rh / 22));
  rows.forEach((k, i) => { const y = i * (rh + 12), s = Math.min((rh - 22) / 258, (W * .55) / 414), vw = 414 * s;
    enlCap(g, 8, y + 13, ENL[k].name, ENL[k].col, 11); enlViews(g, im, k, 8, y + 20, s, fs); enlChart(g, k, vw + 22, y + 20, W - vw - 30, rh - 24, fs); });
}
function enlShow(i) {
  if (!enl.frames.length) return;
  enl.i = Math.max(0, Math.min(enl.frames.length - 1, i)); const f = enl.frames[enl.i];
  enlDraw(); $('enlSlide').value = $('enlFSlide').value = toPos(f.t); $('enlT').textContent = dayHm(f.t); $('enlRun').textContent = f.old ? T('EARLIER RUN') + (f.run ? ' ' + f.run : '') : enl.run ? T('RUN') + ' ' + enl.run : ''; $('enlFT').textContent = dayHm(f.t) + ' · ' + T('LOCAL TIME');
  // preload a few frames ahead, only while you watch (the whole run is ~16 MB)
  for (let k = 1; k <= (enl.play ? 16 : 3); k++) { const n = enl.frames[(enl.i + k * enl.step) % enl.frames.length]; if (n) enlImg(n.u); }
}
window.addEventListener('resize', () => { enlDraw(); if ($('enlFull').style.display === 'block') fzLayout(); });
// full-screen stage: landscape; on a portrait phone the whole stage (picture + controls) is turned 90°
const fz = { s: 1, x: 0, y: 0, rot: 0, w: 800, h: 340, pts: new Map(), d0: 0, s0: 1 };
function fzApply() { $('enlFCv').style.transform = `translate(${fz.x}px,${fz.y}px) scale(${fz.s})`; }
function fzLayout() {
  const W = innerWidth, H = innerHeight; fz.rot = H > W ? 90 : 0; const sw = fz.rot ? H : W, sh = fz.rot ? W : H, st = $('enlStage');
  st.style.width = sw + 'px'; st.style.height = sh + 'px'; st.style.transform = `translate(-50%,-50%) rotate(${fz.rot}deg)`;
  fz.w = sw - 8; fz.h = sh - 66; fzApply(); const f = enl.frames[enl.i]; if (f && enlImg(f.u).complete) enlFDraw(enlImg(f.u));
}
$('enlCvN').onclick = $('enlCvV').onclick = () => { if (!enl.frames[enl.i]) return; window.syAuto && syAuto(); $('enlFull').style.display = 'block'; fz.s = 1; fz.x = fz.y = 0; fzLayout();
  $('enlFSlide').max = 1000; enlShow(enl.i); };
$('enlX').onclick = () => { $('enlFull').style.display = 'none'; };
$('enlFSlide').oninput = e => { stopEnl(); enlShow(nearestT(enl.frames.length, m => enl.frames[m].t, toTime(+e.target.value))); };
$('enlFPlay').onclick = () => $('enlPlay').onclick();
const V = $('enlView');
V.addEventListener('pointerdown', e => { fz.pts.set(e.pointerId, [e.clientX, e.clientY]); if (fz.pts.size === 2) { const [a, b] = [...fz.pts.values()]; fz.d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); fz.s0 = fz.s; } });
V.addEventListener('pointermove', e => { const p = fz.pts.get(e.pointerId); if (!p) return;
  if (fz.pts.size === 1) { const dx = e.clientX - p[0], dy = e.clientY - p[1];   // screen → stage axes (stage may be turned 90°)
    if (fz.rot) { fz.x += dy; fz.y -= dx; } else { fz.x += dx; fz.y += dy; } }
  fz.pts.set(e.pointerId, [e.clientX, e.clientY]);
  if (fz.pts.size === 2) { const [a, b] = [...fz.pts.values()]; fz.s = Math.max(1, Math.min(5, fz.s0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / (fz.d0 || 1))); if (fz.s === 1) fz.x = fz.y = 0; }
  fzApply(); });
['pointerup', 'pointercancel'].forEach(t => V.addEventListener(t, e => fz.pts.delete(e.pointerId)));
function stopEnl() { clearInterval(enl.play); enl.play = null; $('enlPlay').textContent = $('enlFPlay').textContent = '▶'; }
$('enlSlide').oninput = e => { stopEnl(); enlShow(nearestT(enl.frames.length, m => enl.frames[m].t, toTime(+e.target.value))); };
$('enlPlay').onclick = () => { if (enl.play) { stopEnl(); return; } $('enlPlay').textContent = $('enlFPlay').textContent = '❚❚';
  enl.play = setInterval(() => { const k = (enl.i + enl.step) % enl.frames.length, im = enlImg(enl.frames[k].u); if (im.complete) enlShow(k); }, 85); };
enl.step = 1;
document.querySelectorAll('.spd').forEach(b => b.onclick = () => { enl.step = enl.step === 1 ? 2 : enl.step === 2 ? 4 : 1;
  document.querySelectorAll('.spd').forEach(o => o.textContent = enl.step + '×'); });
async function loadEnlil() {
  const [ts, an, ar] = await Promise.all([j(API + 'json/enlil_time_series.json'), j(API + 'products/animations/enlil.json'), j(ENL_ARCH + 'index.json').catch(() => null)]);
  // ~2-min samples → one point per 30 min (every CME sample kept)
  const P = []; let last = 0;
  ts.map(r => ({ t: Date.parse(r.time_tag + 'Z'), n: +r.earth_particles_per_cm3, v: +r.v_r, cme: r.cloud != null && +r.cloud > 0 })).sort((a, b) => a.t - b.t)
    .forEach(p => { if (p.t - last >= 30 * 60000 || p.cme) { P.push(p); last = p.t; } });
  if (P.length < 2) throw new Error('empty');
  // NOAA keeps only the current run (starts ~2-3 days back); our hourly archive of earlier runs fills the Sun's 5 days
  const t0 = P[0].t, arT = ar && ar.ts ? ar.ts.filter(p => p[0] < t0 - 15 * 60000).map(p => ({ t: p[0], n: p[1], v: p[2], cme: !!p[3], old: true })) : [];
  S.enl = arT.concat(P); if (window.space3d) space3d.setWind(S.enl);
  const first = !enl.frames.length;
  enl.frames = an.map(f => ({ u: API + f.url.replace(/^\//, ''), t: frameT(f.url) })).filter(f => f.t);
  const f0 = enl.frames.length ? enl.frames[0].t : Infinity;
  if (ar && ar.frames) enl.frames = ar.frames.filter(f => f[0] < f0 - 30 * 60000).map(f => ({ u: ENL_ARCH + f[1], t: f[0], run: f[2], old: true })).concat(enl.frames);
  $('enlSlide').max = 1000; setTimeout(() => { const fr = sunFr(); if (fr.length) sunShow(sun.i); }, 0);   // the Sun's slider moves to the shared axis
  const run = (an[0] && an[0].url.match(/enlil_com2_(\d+)_/) || [])[1];
  $('enlRun').textContent = run ? T('RUN') + ' ' + run : ''; enl.run = run;
  enlSummary(); enlDraw();
  if (first && enl.frames.length) { const now = Date.now(); let k = 0; enl.frames.forEach((f, i) => { if (Math.abs(f.t - now) < Math.abs(enl.frames[k].t - now)) k = i; }); enlShow(k); }
}


function enlFile(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
function enlComposite(c) {
  const a = $('enlCvN'), b = $('enlCvV'), gap = 24 * Math.max(2, devicePixelRatio || 1), W = a.width + b.width + gap, H = Math.max(a.height, b.height);
  c = c || document.createElement('canvas'); if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d'); g.fillStyle = '#12161C'; g.fillRect(0, 0, W, H); g.drawImage(a, 0, 0); g.drawImage(b, a.width + gap, 0); return c;
}
$('enlSave').onclick = () => { const cv = enlComposite(); if (!enl.frames.length) return;
  try { cv.toBlob(b => b ? enlFile(b, 'solar-wind-' + (enl.run || 'enlil') + '-' + enl.i + '.png') : toast(T('Could not save the picture')), 'image/png'); } catch (e) { toast(T('Could not save the picture')); } };
const enlLoaded = im => new Promise(r => { if (im.complete && im.naturalWidth) return r(); im.addEventListener('load', () => r(), { once: true }); im.addEventListener('error', () => r(), { once: true }); });
$('enlClipB').onclick = async () => {
  const b = $('enlClipB'); if (b.classList.contains('busy') || !enl.frames.length) return;
  const cv = enlComposite(); if (!window.MediaRecorder || !cv.captureStream) { toast(T('This browser cannot record clips — try Chrome.')); return; }
  const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  if (!type) { toast(T('This browser cannot record clips.')); return; }
  stopEnl(); b.classList.add('busy'); const keep = enl.i, chunks = [];
  const rec = new MediaRecorder(cv.captureStream(12), { mimeType: type, videoBitsPerSecond: 5e6 });
  rec.ondataavailable = e => e.data.size && chunks.push(e.data); const stopped = new Promise(r => rec.onstop = r);
  rec.start();
  for (let i = 0; i < enl.frames.length; i++) { b.textContent = T('RECORDING {p}%', { p: Math.round(i / enl.frames.length * 100) });
    await enlLoaded(enlImg(enl.frames[i].u)); enlShow(i); enlComposite(cv); await new Promise(r => setTimeout(r, 85)); }
  rec.stop(); await stopped; b.classList.remove('busy'); b.textContent = T('⬇ SAVE CLIP');
  enlFile(new Blob(chunks, { type }), 'solar-wind-' + (enl.run || 'enlil') + (type.includes('mp4') ? '.mp4' : '.webm')); enlShow(keep);
};

/* ── Sun → Earth together: one clock drives the Sun viewer and the ENLIL card ── */
const sy = { on: false, t: 0, a: 0, b: 0, timer: null, spd: 1, dir: 1 };
function syRange() {
  const x = axis(); if (!x) return false; const fr = sunFr();
  sy.a = x.a; sy.b = x.b; sy.sunEnd = fr.length ? fr[fr.length - 1][0] : 0;
  return sy.b > sy.a;
}
const nearestIdx = (n, tOf, t) => { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (tOf(m) < t) lo = m + 1; else hi = m; } return lo > 0 && Math.abs(tOf(lo - 1) - t) < Math.abs(tOf(lo) - t) ? lo - 1 : lo; };
function syShow(t) {
  if (!syRange()) return;
  sy.t = Math.max(sy.a, Math.min(sy.b, t));
  $('sySlide').value = Math.round((sy.t - sy.a) / (sy.b - sy.a) * 1000);
  const fr = sunFr(), after = fr.length && sy.t > sy.sunEnd + 45 * 60000;
  $('syT').textContent = dayHm(sy.t) + (sy.t > Date.now() + 30 * 60000 ? ' · ' + T('FORECAST') : '');
  let su = '';
  if (fr.length) { const i = after ? fr.length - 1 : nearestIdx(fr.length, k => fr[k][0], sy.t); clearInterval(sun.timer); sun.play = false; sunShow(i); su = fr[i][1]; }
  $('sunLbl').textContent = SUNF[sun.k][1] + (after ? ' · ' + T('LATEST') : '');
  if (enl.frames.length) { const k = nearestIdx(enl.frames.length, m => enl.frames[m].t, sy.t); if (k !== enl.i) { clearInterval(enl.play); enl.play = null; enlShow(k); } }
  if (sy.timer) playLabel(true);
  // the 3D keeps its own clock (⏸ / NOW / speed); the page clock moves it only when set by hand, not while it plays the Sun loop
  if (window.space3d && !sy.timer) space3d.setTime(sy.t);
  const di = $('syDate'); if (di && document.activeElement !== di) { di.min = locStr(sy.a); di.max = locStr(sy.b); di.value = locStr(sy.t); }
  const pos = Math.round((sy.t - sy.a) / (sy.b - sy.a) * 1000); SLIDES.forEach(id => { const el = $(id); if (el) { el.max = 1000; el.value = pos; } });
  tcursor();
}
// the from-above disc of the current ENLIL frame (+ Sun / Earth dots), for the phone's side-by-side view
function miniEnl() {}
function tcursor() {
  const t = sy.on ? sy.t : 0;
  document.querySelectorAll('svg[data-tx]').forEach(svg => { const [a, b, xa, xb, h] = JSON.parse(svg.dataset.tx); let ln = svg.querySelector('.tcur');
    if (!ln) { ln = document.createElementNS('http://www.w3.org/2000/svg', 'line'); ln.setAttribute('class', 'tcur'); ln.setAttribute('stroke', '#FFE600'); ln.setAttribute('stroke-width', '1.5'); svg.appendChild(ln); }
    if (!t || t < a || t > b) { ln.style.display = 'none'; return; }
    const x = xa + (t - a) / (b - a) * (xb - xa); ln.setAttribute('x1', x); ln.setAttribute('x2', x); ln.setAttribute('y1', 0); ln.setAttribute('y2', h); ln.style.display = ''; });
  const tnK = Math.floor(t / 36e5); if (S.tnPlan && (tcursor.k !== tnK || tcursor.p !== S.tnPlan)) tcursor.k = tnK, tcursor.p = S.tnPlan, AuroraTonight.render($('tonight'), S.tnPlan, hhmm, kpColor, S.tnNeed, t, { compact: PHONE(), head: false, ...(innerWidth >= 1000 ? { tiles: false, hor: 128 } : {}) });
}
window.tcursor = tcursor;
// tap a chart → the shared clock jumps to that moment
document.addEventListener('click', e => { const fr = e.target.closest && e.target.closest('.flr[data-t]'); if (fr) { syStop(); sy.on = true; syShow(+fr.dataset.t); return; }   // a flare in the list → the clock (X-ray chart cursor) at its peak
  const svg = e.target.closest && e.target.closest('svg[data-tx]'); if (!svg) return;
  const [a, b, xa, xb] = JSON.parse(svg.dataset.tx), r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, x = (e.clientX - r.left) / r.width * (vb && vb.width || r.width);
  if (x < xa || x > xb) return; const t = a + (x - xa) / (xb - xa) * (b - a); syStop(); sy.on = true; syShow(t); });
const PLAYS = ['syPlay', 'sunPlay', 'sunFPlay', 'enlPlay', 'enlFPlay'], SLIDES = ['sySlide', 'sunSlide', 'sunFSlide', 'enlSlide', 'enlFSlide'];
const playLabel = on => PLAYS.forEach(id => { const b = $(id); if (b) { b.textContent = on ? '⏸' : '▶'; b.setAttribute('aria-label', on ? T('Pause') : T('Play')); } });
function syStop() { clearInterval(sy.timer); sy.timer = null; playLabel(false); }
const syShowStill = syShow; syShow = t => { if (vidOn) vidStop(); syShowStill(t); };
const done = im => !im || im.complete;   // loaded, or failed (don't wait forever)
function syReady(t) {
  const fr = sunFr(); if (fr.length && t <= sy.sunEnd + 45 * 60000 && !done(sun.imgs[nearestIdx(fr.length, k => fr[k][0], t)])) return false;
  if (enl.frames.length) { const f = enl.frames[nearestIdx(enl.frames.length, m => enl.frames[m].t, t)]; if (!done(enlImg(f.u))) return false; }
  return true;
}
function syStart() {
  if (!syRange()) { toast(T('Still loading the pictures…')); return; }
  sy.on = true; playLabel(true); if (sy.dir > 0 && (!sy.t || sy.t >= sy.b)) sy.t = sy.a; if (sy.dir < 0 && (!sy.t || sy.t <= sy.a)) sy.t = sy.b;
  clearInterval(sy.timer); let wait = 0; const LT = document.documentElement.classList.contains('lite'), TK = LT ? 320 : 80; sy.timer = setInterval(() => { let t = sy.t + sy.dir * 60 * 60000 * sy.spd * TK / 80; if (t > sy.b) t = sy.a; if (t < sy.a) t = sy.b; if (!syReady(t) && wait++ < 40) { if (wait === 4) $('sunLoad').textContent = T('LOADING…'); return; } if (wait >= 4) $('sunLoad').textContent = ''; wait = 0; syShow(t); }, TK);
}
// one control for everything: any play button plays the shared clock, any slider moves every view
const revLabel = () => $('syRev').setAttribute('aria-pressed', sy.dir < 0);
// sy.held = the user stopped the clock (pause, NOW, a step, a date): nothing starts it again by itself until they press play
const syToggle = () => { if (sy.timer && sy.dir < 0) { sy.dir = 1; revLabel(); return; } sy.dir = 1; revLabel(); sy.held = !!sy.timer; sy.timer ? syStop() : syStart(); };
$('syRev').onclick = () => { sy.held = false; sy.dir = sy.dir < 0 && sy.timer ? 1 : -1; revLabel(); if (!sy.timer) syStart(); };
const syStep = d => { sy.held = true; syStop(); sy.on = true; if (syRange()) syShow((sy.t || Date.now()) + d); };
$('syPrev').onclick = () => syStep(-3600e3); $('syNext').onclick = () => syStep(3600e3);
const pad2 = v => String(v).padStart(2, '0'), locStr = t => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
$('syDate').onchange = e => { const t = Date.parse(e.target.value); if (isFinite(t)) { sy.held = true; syStop(); sy.on = true; if (syRange()) syShow(t); } };
PLAYS.forEach(id => { const b = $(id); if (b) b.onclick = syToggle; });
// autoplay: the shared clock starts by itself (PC at load, the Sun / ENLIL full screen, the Sun window of the board) — not under reduced motion or animations off
window.syAuto = fromStart => { let off = false; try { off = localStorage.getItem('aurora.motion') === 'off'; } catch (e) {} if (REDUCED || off || sy.timer || sy.held) return;
  // a retry still waiting for the pictures also respects a stop by hand
  let n = 0; const go = () => { if (sy.timer || sy.held) return; if (syRange()) { if (fromStart) { sy.dir = 1; sy.t = sy.a; } syStart(); } else if (n++ < 40) setTimeout(go, 1500); }; go(); };
if (innerWidth >= 1000 && !document.documentElement.classList.contains('lite') && !window.STORM) setTimeout(() => syAuto(true), 2500);   // time machine: the clock waits for you (one clock for the page + 3D)   // on opening the page the clock plays from the start of the loop
// the Sun viewer moves to the next filter by itself every 45 s (⚙ → off: aurora.sunauto=off); a pick by hand pauses it for 3 minutes
(() => { let hold = 0; const off = () => { try { return localStorage.getItem('aurora.sunauto') === 'off'; } catch (e) { return false; } };
  $('sunChips').addEventListener('click', e => { if (e.isTrusted) hold = Date.now() + 180e3; });
  setInterval(() => { if (innerWidth < 1000 || document.documentElement.classList.contains('lite') || off() || document.hidden || Date.now() < hold || !sun.started || $('sunFull').classList.contains('on')) return; sunPick(sun.k + 1); }, 45000); })();   // only the setting turns it off (it is a change of picture, not motion)
window.syNow = () => { sy.held = true; syStop(); sy.on = true; if (syRange()) syShow(Math.min(sy.b, Math.max(sy.a, Date.now()))); };   // stop and come back to the present
const sySpeed = () => { sy.spd = sy.spd === 1 ? 2 : sy.spd === 2 ? 4 : 1; document.querySelectorAll('#sySpd, .spd').forEach(o => o.textContent = sy.spd + '×'); };
$('sySpd').onclick = sySpeed; document.querySelectorAll('.spd').forEach(o => o.onclick = sySpeed);
SLIDES.forEach(id => { const el = $(id); if (el) el.oninput = e => { syStop(); sy.on = true; if (syRange()) syShow(toTime(+e.target.value)); }; });
addEventListener('resize', () => miniEnl());
// first picture: "now" once both have loaded
let syInit = setInterval(() => { if (sunFr().length && enl.frames.length) { clearInterval(syInit); if (syRange()) { sy.on = true; if (!vidOn) syShow(Math.min(Date.now(), sy.b));
  } } }, 500);

/* ── share card: verdict + the Sun and the solar wind at the same moment (Sun pictures via a CORS image proxy) ── */
const viaProxy = u => 'https://wsrv.nl/?url=' + encodeURIComponent(u.replace(/^https?:\/\//, '')) + '&w=640&output=jpg';
const loadImg = (src, cors) => new Promise(r => { const im = new Image(); if (cors) im.crossOrigin = 'anonymous'; im.onload = () => r(im); im.onerror = () => r(null); im.src = src; });
async function makeCard() {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0E1A24'); gr.addColorStop(1, '#0A0A0A'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const Tr = window.T, T = (t, x, y, sz, col, font, al) => { g.font = `${sz}px ${font || '"JetBrains Mono", monospace'}`; g.fillStyle = col; g.textAlign = al || 'left'; g.fillText(t, x, y); g.textAlign = 'left'; };
  const word = $('vword').textContent, col = getComputedStyle($('vword')).color;
  T(Tr('AURORA TONIGHT') + ' · ' + TOWN.name.toUpperCase(), 70, 120, 32, '#8B9BAE');
  T(new Date().toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }).toUpperCase(), 70, 166, 28, '#6B7280');
  g.font = '600 190px "Barlow Condensed", Barlow, sans-serif'; let fs = 190; while (g.measureText(word.toUpperCase()).width > W - 140 && fs > 100) { fs -= 10; g.font = `600 ${fs}px "Barlow Condensed", Barlow, sans-serif`; }
  T(word.toUpperCase(), 64, 340, fs, col, '"Barlow Condensed", Barlow, sans-serif');
  [[Tr('KP TONIGHT'), $('fKp').textContent, getComputedStyle($('fKp')).color], [Tr('CLOUDS'), $('fCloud').textContent, '#fff'], [Tr('DARK FROM'), $('fDark').textContent, '#fff']].forEach(([k, v, cc], i) => {
    T(k, 70 + i * 320, 420, 26, '#8B9BAE'); T(v, 70 + i * 320, 505, 84, cc, '"Barlow Condensed", Barlow, sans-serif'); });
  // the two pictures at the shared clock's moment (or now)
  const t = sy.t || Date.now(), fr = sunFr(), si = fr.length ? nearestIdx(fr.length, k => fr[k][0], Math.min(t, fr[fr.length - 1][0])) : -1;
  const sunU = si >= 0 ? fr[si][1] : latestOf(SUNF[sun.k]), ek = enl.frames.length ? nearestIdx(enl.frames.length, m => enl.frames[m].t, t) : -1;
  const [sunIm, enlIm] = await Promise.all([loadImg(viaProxy(sunU), true), ek >= 0 ? loadImg(enl.frames[ek].u, true) : null]);
  const P = 460, y0 = 580, x1 = 70, x2 = W - 70 - P;
  [x1, x2].forEach(x => { g.fillStyle = '#000'; g.beginPath(); g.roundRect ? g.roundRect(x, y0, P, P, 28) : g.rect(x, y0, P, P); g.fill(); });
  if (sunIm) { g.save(); g.beginPath(); g.roundRect ? g.roundRect(x1, y0, P, P, 28) : g.rect(x1, y0, P, P); g.clip(); const k = Math.min(P / sunIm.width, P / sunIm.height);
    g.drawImage(sunIm, x1 + (P - sunIm.width * k) / 2, y0 + (P - sunIm.height * k) / 2, sunIm.width * k, sunIm.height * k); g.restore(); }
  else T(Tr('Sun picture not available'), x1 + P / 2, y0 + P / 2, 24, '#6B7280', null, 'center');
  if (enlIm) { g.save(); g.beginPath(); g.arc(x2 + P / 2, y0 + P / 2, P / 2 - 4, 0, 2 * Math.PI); g.clip(); g.drawImage(enlIm, 76, 58, 258, 258, x2, y0, P, P); g.restore(); }
  T(Tr('THE SUN') + ' · ' + SUNF[sun.k][1] + (si >= 0 ? ' · ' + sunT(fr[si][0]) : ''), x1, y0 + P + 40, 22, '#8B9BAE');
  T(Tr('SOLAR WIND FORECAST') + (ek >= 0 ? ' · ' + dayHm(enl.frames[ek].t) : ''), x2, y0 + P + 40, 22, '#8B9BAE');
  // one line from the forecast summary
  const sum = S.tonight || ($('enlSum').textContent || '').split('.')[0];
  g.font = '34px system-ui, sans-serif'; g.fillStyle = '#C9D1DB'; let line = sum; while (g.measureText(line).width > W - 140 && line.length > 10) line = line.slice(0, -2);
  g.fillText(line + (line !== sum ? '…' : ''), 70, y0 + P + 110);
  T('Live: ori0nori0ff.github.io/aurora', 70, H - 60, 26, '#06B6D4'); T('PowHau', W - 70, H - 60, 40, 'rgba(255,255,255,.8)', '"Barlow Condensed", Barlow, sans-serif', 'right');
  T('NOAA SWPC · NASA SDO · SOHO (ESA/NASA)', 70, H - 100, 20, '#6B7280');
  return c;
}
$('cardSave').onclick = async () => {
  const b = $('cardSave'); if (b.classList.contains('busy')) return; b.classList.add('busy'); b.textContent = T('MAKING THE CARD…');
  try {
    const c = await makeCard(), blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'aurora-' + TOWN.name.toLowerCase().replace(/\W+/g, '-') + '.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text: T('Aurora tonight from {p}: {w} — live: {u}', { p: TOWN.name, w: $('vword').textContent, u: location.href }) }).catch(() => {});
    else enlFile(blob, file.name);
  } catch (e) { toast(T('Could not make the card')); }
  b.classList.remove('busy'); b.textContent = T('⬇ SHARE CARD');
};
$('linkShare').onclick = async () => {
  const d = { title: T('Aurora tonight') + ' · ' + TOWN.name, text: T('Aurora tonight from {p}: {w}. The Sun, the solar wind and how to read it:', { p: TOWN.name, w: $('vword').textContent }), url: location.href };
  if (navigator.share) { navigator.share(d).catch(() => {}); return; }
  try { await navigator.clipboard.writeText(d.url); toast(T('Link copied')); } catch (e) { prompt(T('Copy this link'), d.url); }
};

/* ── the full report: every card on one tall picture, made on this device ── */
const b64 = buf => { let s = '', a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
let fontCss = null;
async function svgFonts() {   // the page's fonts, embedded, so chart text keeps them inside a picture
  if (fontCss != null) return fontCss;
  try { const f = async n => b64(await (await fetch('fonts/' + n)).arrayBuffer());
    const [a, b, c] = await Promise.all([f('inter-latin-500-normal.woff2'), f('inter-latin-700-normal.woff2'), f('inter-latin-ext-500-normal.woff2')]);
    fontCss = ['Inter', 'JetBrains Mono'].map(n => `@font-face{font-family:'${n}';font-weight:400 600;src:url(data:font/woff2;base64,${a})}@font-face{font-family:'${n}';font-weight:700 900;src:url(data:font/woff2;base64,${b})}@font-face{font-family:'${n}';src:url(data:font/woff2;base64,${c});unicode-range:U+0100-02AF}`).join('');
  } catch (e) { fontCss = ''; }
  return fontCss;
}
async function svgImg(svg) {   // an on-page SVG chart → an image (2× for a sharp picture)
  if (!svg || !svg.viewBox || !svg.viewBox.baseVal || !svg.viewBox.baseVal.width || svg.style.display === 'none') return null;
  const vb = svg.viewBox.baseVal, c = svg.cloneNode(true), css = await svgFonts();
  c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); c.setAttribute('width', vb.width * 2); c.setAttribute('height', vb.height * 2);
  c.setAttribute('style', 'font-family:Inter,sans-serif'); c.querySelectorAll('title').forEach(t => t.remove());
  const st = document.createElementNS('http://www.w3.org/2000/svg', 'style'); st.textContent = css; c.insertBefore(st, c.firstChild);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(c)], { type: 'image/svg+xml' }));
  const im = await loadImg(url); URL.revokeObjectURL(url); return im ? { im, w: vb.width, h: vb.height } : null;
}
async function makeReport() {
  await Promise.all(['500 16px Inter', '700 16px Inter', '800 40px Inter'].map(f => document.fonts.load(f).catch(() => {})));
  const W = 1800, P = 48, G = 24, cv = document.createElement('canvas'); cv.width = W; cv.height = 9000; const g = cv.getContext('2d');
  g.fillStyle = '#0A0A0A'; g.fillRect(0, 0, W, cv.height);
  const font = (w, sz) => `${w} ${sz}px Inter, system-ui, sans-serif`;
  const text = (t, x, y, w, sz, col, al) => { g.font = font(w, sz); g.fillStyle = col; g.textAlign = al || 'left'; g.fillText(t, x, y); g.textAlign = 'left'; };
  const wrap = (t, x, y, mw, w, sz, col, lh) => { g.font = font(w, sz); g.fillStyle = col; let line = '', n = 0;
    String(t || '').split(/\s+/).forEach(word => { const tt = line ? line + ' ' + word : word; if (g.measureText(tt).width > mw && line) { g.fillText(line, x, y + n * lh); n++; line = word; } else line = tt; });
    if (line) { g.fillText(line, x, y + n * lh); n++; } return n * lh; };
  const card = (x, y, w, h, lbl) => { g.fillStyle = '#12161C'; g.strokeStyle = '#232830'; g.lineWidth = 2; g.beginPath(); g.roundRect(x, y, w, h, 22); g.fill(); g.stroke();
    if (lbl) text(lbl.toUpperCase(), x + 26, y + 40, 600, 15, '#A3B0C2'); };
  const fit = (im, mw, mh) => { const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height, k = Math.min(mw / iw, mh ? mh / ih : 1e9); return [iw * k, ih * k]; };
  const cardH = (inner) => inner + 72;
  let y = P;
  // header
  const word = $('vword').textContent, col = getComputedStyle($('vword')).color;
  text(T('AURORA TONIGHT').toUpperCase() + ' · ' + TOWN.name.toUpperCase() + (TOWN.sub ? ', ' + TOWN.sub.toUpperCase() : ''), P, y + 26, 600, 20, '#A3B0C2');
  text(new Date().toLocaleString(LOC, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }), P, y + 58, 500, 20, '#6B7788');
  text(word, P - 4, y + 160, 800, 110, col);
  const vh = wrap($('vtext').textContent, P, y + 210, W * .56, 500, 24, '#C9D1DB', 34);
  const facts = [[T('KP TONIGHT'), $('fKp').textContent, getComputedStyle($('fKp')).color], [T('CLOUDS'), $('fCloud').textContent, '#fff'], [T('DARK FROM'), $('fDark').textContent, '#fff'], [T('Kp index now'), $('kpNow').textContent, getComputedStyle($('kpNow')).color]];
  const fx = W * .62, fw = (W - P - fx - G) / 2;
  facts.forEach(([k, v, c], i) => { const x = fx + (i % 2) * (fw + G), yy = y + 90 + Math.floor(i / 2) * 120; card(x, yy, fw, 104); text(k.toUpperCase(), x + 22, yy + 34, 600, 14, '#A3B0C2'); text(v, x + 22, yy + 86, 800, 46, c); });
  y += Math.max(210 + vh, 330) + G;
  // tonight | globe
  const lw = Math.round((W - 2 * P - G) * .62), rw = W - 2 * P - G - lw, tn = $('tonight'), tnSvg = await svgImg(tn.querySelector('svg'));
  const cells = [...tn.querySelectorAll(':scope > div:nth-child(2) > div')], headTxt = tn.firstElementChild ? tn.firstElementChild.textContent : '';
  const cw = (lw - 52 - 3 * 12) / 4, tsvH = tnSvg ? (lw - 52) / tnSvg.w * tnSvg.h : 0, tnH = 50 + 110 + 20 + tsvH + 60;
  const gl = $('globe'), [gw, gh] = gl.width ? fit(gl, rw - 52, tnH - 30) : [0, 0], rowH = cardH(Math.max(tnH, gh + 50));
  card(P, y, lw, rowH, T('Tonight hour by hour'));
  text(headTxt, P + 26, y + 80, 700, 22, getComputedStyle(tn.firstElementChild || tn).color);
  cells.forEach((c, i) => { const x = P + 26 + i * (cw + 12), yy = y + 100, d = c.children; g.fillStyle = '#0F1318'; g.beginPath(); g.roundRect(x, yy, cw, 104, 12); g.fill();
    g.fillStyle = c.style.borderTopColor || '#39FF9E'; g.fillRect(x, yy, cw, 4);
    text((d[0] && d[0].textContent || '').toUpperCase(), x + 14, yy + 30, 600, 13, '#A3B0C2'); text(d[1] ? d[1].textContent : '', x + 14, yy + 64, 700, 26, '#F1F4F8');
    g.save(); g.beginPath(); g.rect(x, yy, cw - 6, 104); g.clip(); text(d[2] ? d[2].textContent : '', x + 14, yy + 90, 500, 15, d[2] ? getComputedStyle(d[2]).color : '#A3B0C2'); g.restore(); });
  if (tnSvg) g.drawImage(tnSvg.im, P + 26, y + 228, lw - 52, tsvH);
  wrap($('tnTxt').textContent, P + 26, y + 228 + tsvH + 36, lw - 52, 500, 18, '#C9D1DB', 26);
  card(P + lw + G, y, rw, rowH, T('NOAA aurora forecast'));
  if (gw) g.drawImage(gl, P + lw + G + (rw - gw) / 2, y + 60, gw, gh);
  y += rowH + G;
  // Sun | density | speed
  const w3 = (W - 2 * P - 2 * G) / 3, t0 = sy.t || Date.now(), fr = sunFr(), si = fr.length ? nearestIdx(fr.length, k => fr[k][0], Math.min(t0, fr[fr.length - 1][0])) : -1;
  const sunIm = await loadImg(viaProxy(si >= 0 ? fr[si][1] : latestOf(SUNF[sun.k])), true);
  const eN = $('enlCvN'), eV = $('enlCvV'), [ew, eh] = eN.width ? fit(eN, w3 - 52) : [0, 0], h3 = cardH(Math.max(w3 - 52, eh) + 40);
  card(P, y, w3, h3, T('The Sun') + ' · ' + SUNF[sun.k][1] + (si >= 0 ? ' · ' + sunT(fr[si][0]) : ''));
  if (sunIm) { const [sw, sh] = fit(sunIm, w3 - 52, h3 - 110); g.save(); g.beginPath(); g.roundRect(P + 26, y + 60, sw, sh, 16); g.clip(); g.drawImage(sunIm, P + 26 + (w3 - 52 - sw) / 2, y + 60, sw, sh); g.restore(); }
  else text(T('Sun picture not available'), P + w3 / 2, y + h3 / 2, 500, 18, '#6B7788', 'center');
  [[eN, T('Density')], [eV, T('Speed')]].forEach(([c, n], i) => { const x = P + (i + 1) * (w3 + G); card(x, y, w3, h3, T('Solar wind forecast') + ' · ' + n + ' · ' + ($('enlT').textContent || ''));
    if (ew) g.drawImage(c, x + 26, y + 60, ew, eh); });
  y += h3 + G;
  const sumH = cardH(wrap($('enlSum').textContent, -9999, 0, W - 2 * P - 52, 500, 19, '#000', 28) + 10);
  card(P, y, W - 2 * P, sumH, T('Solar wind forecast') + ' · WSA-ENLIL'); wrap($('enlSum').textContent, P + 26, y + 80, W - 2 * P - 52, 500, 19, '#E6EBF1', 28);
  y += sumH + G;
  // Kp chart | space weather
  document.body.classList.add('reporting'); await new Promise(r => setTimeout(r, 250));   // grown charts back to their natural height
  const hw = (W - 2 * P - G) / 2, kp = await svgImg($('kpchart')), sw2 = await svgImg($('swChart')), wd = await svgImg($('windchart')), cy = await svgImg($('cycchart'));
  document.body.classList.remove('reporting');
  const ih = s2 => s2 ? (hw - 52) / s2.w * s2.h : 0, swTxt = $('swNow').textContent, ladder = [...document.querySelectorAll('#gLadder .glr')];
  const swInner = 40 + 30 + (sw2 ? ih(sw2) : ladder.length * 46), rH = cardH(Math.max(ih(kp) + 10, swInner));
  card(P, y, hw, rH, T('Kp · past 7 days + 3-day forecast')); if (kp) g.drawImage(kp.im, P + 26, y + 60, hw - 52, ih(kp));
  const x2 = P + hw + G; card(x2, y, hw, rH, T('Space weather at Earth') + ' · ' + ['scG', 'scS', 'scR', 'scE'].map(id => $(id).textContent).join(' · '));
  wrap(swTxt, x2 + 26, y + 80, hw - 52, 500, 17, '#E6EBF1', 24);
  if (sw2) g.drawImage(sw2.im, x2 + 26, y + 110, hw - 52, ih(sw2));
  else ladder.forEach((r, i) => { const yy = y + 110 + i * 46, now = r.classList.contains('now'); g.fillStyle = now ? 'rgba(255,230,0,.08)' : '#0F1318'; g.beginPath(); g.roundRect(x2 + 26, yy, hw - 52, 40, 10); g.fill();
    const b = r.querySelector('b'); text(b.textContent, x2 + 42, yy + 27, 800, 18, getComputedStyle(b).color); text(r.querySelector('.glk').textContent, x2 + 100, yy + 27, 600, 15, '#DCE3EB');
    g.save(); g.beginPath(); g.rect(x2 + 300, yy, hw - 330, 40); g.clip(); text(r.querySelector('.glt').textContent, x2 + 300, yy + 27, 500, 15, '#A3B0C2'); g.restore(); });
  y += rH + G;
  // measured wind | solar cycle
  const cycTxtH = wrap($('cycSum').textContent, -9999, 0, hw - 52, 500, 16, '#000', 23), r2 = cardH(Math.max(ih(wd), ih(cy) + cycTxtH + 20) + 40);
  card(P, y, hw, r2, T('Solar wind · measured at L1') + ' · ' + $('wSrc').textContent); if (wd) g.drawImage(wd.im, P + 26, y + 70, hw - 52, ih(wd));
  card(x2, y, hw, r2, T('Solar cycle · sunspots')); const ch2 = wrap($('cycSum').textContent, x2 + 26, y + 80, hw - 52, 500, 16, '#E6EBF1', 23); if (cy) g.drawImage(cy.im, x2 + 26, y + 90 + ch2, hw - 52, ih(cy));
  y += r2 + G;
  // footer
  text('ori0nori0ff.github.io/aurora', P, y + 30, 700, 24, '#5EE6FF');
  text('NOAA SWPC · NASA SDO · SOHO (ESA/NASA) · Open-Meteo · PowHau', W - P, y + 30, 500, 18, '#6B7788', 'right');
  y += 60;
  const out = document.createElement('canvas'); out.width = W; out.height = y; out.getContext('2d').drawImage(cv, 0, 0); return out;
}
$('repSave').onclick = async () => {
  const b = $('repSave'); if (b.classList.contains('busy')) return; const keep = b.textContent; b.classList.add('busy'); b.textContent = T('MAKING THE REPORT…');
  try {
    const c = await makeReport(), blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const name = 'aurora-report-' + TOWN.name.toLowerCase().replace(/\W+/g, '-') + '-' + new Date().toISOString().slice(0, 10) + '.png', file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) await navigator.share({ files: [file], text: T('Aurora report') + ' · ' + TOWN.name + ' — ' + location.href }).catch(() => {});
    else enlFile(blob, name);
  } catch (e) { console.error(e); toast(T('Could not make the report')); }
  b.classList.remove('busy'); b.textContent = keep;
};
/* ── 3D: planets + solar wind + CMEs (space3d.js), driven by the shared clock ── */
// PC: in the page. Phone: a button opens it full screen (built on the first open; it hides again when you leave)
function make3d() { if (window.space3d || !window.Space3D) return;
  window.space3d = Space3D.create($('s3dHost'), { paused: () => document.documentElement.classList.contains('lite') && !!$('s3dHost').closest('.tls'), wind: S.enl || [], time: sy.on ? sy.t : Date.now(), tz: () => TZ, places: () => [{ name: TOWN.name, lat: TOWN.lat, lon: TOWN.lon }], aurora: () => S.ov });
  j('data/cme.json?t=' + Math.floor(Date.now() / 600000)).then(c => { if (window.space3d) space3d.setCmes(c.cmes); }).catch(() => {}); }
if (!PHONE()) make3d();
else { const host = $('s3dHost'); host.style.display = 'none';
  // full screen lives on <body> (a card's styles would trap position:fixed); back into its card when you leave
  new MutationObserver(() => { if (PHONE() && !host.classList.contains('s3d-fs')) { host.style.display = 'none'; $('s3dGo').before(host); } }).observe(host, { attributes: true, attributeFilter: ['class'] }); }
$('s3dGo').onclick = () => { const host = $('s3dHost'); document.body.appendChild(host); host.style.display = 'block'; make3d(); if (window.space3d) { if (!host.classList.contains('s3d-fs')) host.querySelector('.s3d-full').click(); space3d.setTime(sy.on ? sy.t : Date.now()); } };
function drawGlobe() { if (window.AuroraGlobe) AuroraGlobe.draw($('globe'), { ov: S.ov, lat0: TOWN.lat < 0 ? Math.max(-75, Math.min(-50, TOWN.lat - 13)) : Math.min(75, Math.max(50, TOWN.lat + 13)), lon0: TOWN.lon - 7, viewLine: true, label: true, here: TOWN });
  const so = TOWN.lat < 0, h = $('gHelpT'); if (h) h.textContent = T(so ? "is NOAA's live aurora map around the South Pole (the southern lights, aurora australis). The yellow dot is you. The further north the green reaches towards it, the better our chances." : "is NOAA's live aurora map around the North Pole. The yellow dot is you. The further south the green reaches towards it, the better our chances.");   // southern places: the globe turns to the South Pole
  $('globe').setAttribute('aria-label', T(so ? 'Globe with the NOAA live aurora forecast around the South Pole and your place marked' : 'Globe with the NOAA live aurora forecast around the North Pole and your place marked')); }
addEventListener('resize', () => { drawGlobe(); });

let wxDay = '';
const nowParts = (full = true) => [
    j(API + 'json/planetary_k_index_1m.json').then(a => { S.kpNow = +a[a.length - 1].estimated_kp; }),
    (d => d === wxDay ? 0 : j('https://api.open-meteo.com/v1/forecast?latitude=' + TOWN.lat + '&longitude=' + TOWN.lon + '&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high&daily=sunset&forecast_days=2&timezone=auto').then(w => { S.wx = w; wxDay = d; if (w.timezone) TZ = w.timezone; }))(window.STORM ? new Date(STORM.at).toISOString().slice(0, 10) : 'live:' + Math.floor(Date.now() / 6e5)),
    full && j(API + 'json/ovation_aurora_latest.json').then(o => { S.ov = AuroraGlobe.grid(o); $('ovTime').textContent = T('NOAA forecast for {t}.', { t: hhmm(o['Forecast Time']) }); drawGlobe(); }),
    j(API + 'products/summary/solar-wind-speed.json').then(a => { const v = +a[0].proton_speed;
      $('swV').innerHTML = Math.round(v) + '<span style="font-size:13px;color:#8B9BAE"> km/s</span>'; $('swV').style.color = v >= 600 ? '#FF7A3D' : v >= 450 ? '#E8C766' : '#E0E0E0';
      $('swVt').textContent = v >= 600 ? T('Fast — storm fuel.') : v >= 450 ? T('A bit fast.') : T('Calm (300–450 is normal).'); S.swV = v; }),
    j(API + 'products/summary/solar-wind-mag-field.json').then(a => { const bz = +a[0].bz_gsm;
      $('swBz').innerHTML = (bz > 0 ? '+' : '') + bz + '<span style="font-size:13px;color:#8B9BAE"> nT</span>'; $('swBz').style.color = bz <= -10 ? '#FF4444' : bz <= -5 ? '#FFA040' : '#E0E0E0';
      $('swBzt').textContent = bz <= -10 ? T('Strongly south — aurora ON.') : bz <= -5 ? T('South — helps the aurora.') : bz < 0 ? T('Slightly south.') : T('North — aurora stays quiet.'); S.bz = bz; })];
const setUpd = () => { $('upd').textContent = window.STORM ? T('Time machine · {w} · {t}', { w: STORM.week ? T(STORM.label) : new Date(STORM.now).toLocaleDateString(LOC, { day: 'numeric', month: 'long', year: 'numeric' }), t: dayHm(NOWT()) }) : T('Live · updated {t} local time', { t: hhmm(Date.now()) }); };
// time machine: the clock moved → the live numbers, the verdict, the ENLIL summary, the 3D shield follow that moment
// while the clock plays only the light numbers (no OVATION globe, no 1-min wind): heavy work every second made the 3D model stutter
window.tmNow = async (settle, move3d) => { await Promise.allSettled([...nowParts(settle), window.deepNow ? deepNow(settle) : 0]); verdict(); if (S.enl && S.enl.length) enlSummary(); setUpd(); if (move3d) dispatchEvent(new Event('powhau-tm')); };
async function load() {
  await Promise.allSettled([...nowParts(),
    j(API + 'products/noaa-planetary-k-index-forecast.json').then(a => { S.kpList = a; }),
    loadEnlil().catch(() => { $('enlSum').textContent = T('The solar wind model could not be loaded right now.'); }),
    loadSun(),
  ]);
  verdict(); if (!S.kpList) { $('vword').textContent = T('No data'); $('vtext').textContent = T('NOAA could not be reached. Try again in a minute.'); }
  setUpd();
}
load(); setInterval(load, 10 * 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
