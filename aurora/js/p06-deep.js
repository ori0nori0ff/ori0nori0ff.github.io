/* ── In depth: the app's NOAA cards (Kp gauge + history/forecast, measured solar wind at L1, space weather at Earth,
   solar cycle), in their own scope so their helpers don't clash with the page's. ── */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const API = 'https://services.swpc.noaa.gov/';
const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BV = { get name() { return TOWN.name; }, get lat() { return TOWN.lat; }, get lon() { return TOWN.lon; } };
const need = () => AuroraGlobe.kpNeed(TOWN.lat, TOWN.lon);
const hhmm = d => d.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const kpColor = k => k >= 9 ? '#8C7CFF' : k >= 8 ? '#D61F3A' : k >= 7 ? '#FF4D4D' : k >= 6 ? '#FF9338' : k >= 5 ? '#FFE14D' : k >= 4 ? '#B8F25C' : '#3FD98A';   // our own spectrum (NOAA uses green / yellow / red): quiet green · active lime · G1 yellow · G2 orange · G3 red · G4 dark red · G5 indigo
const gScale = k => k >= 9 ? 5 : k >= 8 ? 4 : k >= 7 ? 3 : k >= 6 ? 2 : k >= 5 ? 1 : 0;
const G_TXT = ['QUIET', 'MINOR STORM', 'MODERATE STORM', 'STRONG STORM', 'SEVERE STORM', 'EXTREME STORM'].map(x => T(x));
async function j(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return r.json(); }
const S = {};
/* ── gauge ───────────────────────────────────────────── */
for (let i = 0; i < 10; i++) $('gauge').appendChild(document.createElement('span'));
function drawKpNow(k) {
  $('kpNow').textContent = k.toFixed(1); $('kpNow').style.color = kpColor(k);
  const g = gScale(k); $('kpScale').textContent = 'G' + g + ' · ' + G_TXT[g];
  [...$('gauge').children].forEach((s, i) => { s.style.background = i < Math.round(k) || (i === 0 && k > 0) ? kpColor(i + 1) : '#232830'; });
  const N = need();
  $('kpWords').innerHTML = k >= N ? T(BV.lat < 0 ? 'Strong enough for {p} —<br>look south from a dark site!' : 'Strong enough for {p} —<br>look north from a dark site!', { p: esc(BV.name) }) : k >= 5 ? T('Geomagnetic storm.<br>Watch for more.') : k >= 4 ? T('Active field.<br>Not enough here (need {n}).', { n: N }) : T('Quiet field.') + '<br>' + (N >= 6 ? T(BV.lat < 0 ? 'No aurora this far north.' : 'No aurora this far south.') : T('Little aurora tonight.'));
}

/* ── Kp chart (SVG) ──────────────────────────────────── */
function drawKpChart(list) {
  const svg = $('kpchart'), W = svg.clientWidth || 340, H = Math.max(150, svg.clientHeight || 0), L = 18, B = 18, T = 8;
  const now = Date.now(), from = now - 7 * 864e5, to = now + 72 * 3.6e6;   // 7 days measured + NOAA's 3-day forecast
  const pts = list.map(p => ({ t: Date.parse(p.time_tag + 'Z'), k: +p.kp, kind: p.observed })).filter(p => p.t + 3 * 3.6e6 > from && p.t < to);
  const x = t => L + (t - from) / (to - from) * (W - L - 4), y = k => H - B - k / 9 * (H - B - T);
  let s = '';
  [0, 3, 5, 7, 9].forEach(k => {
    s += `<line x1="${L}" x2="${W - 4}" y1="${y(k)}" y2="${y(k)}" stroke="#232830"/>`;
    s += `<text x="0" y="${y(k) + 3}" fill="#6B7280" font-size="8" font-family="JetBrains Mono">${k}</text>`;
  });
  const N = need();
  s += `<line x1="${L}" x2="${W - 4}" y1="${y(N)}" y2="${y(N)}" stroke="#FF4444" stroke-dasharray="4 3" stroke-opacity=".6"/>`;
  s += `<text x="${W - 6}" y="${y(N) - 4}" text-anchor="end" fill="#FF6B6B" font-size="8" font-family="JetBrains Mono">${window.T('{p} HORIZON · KP {n}', { p: esc(BV.name.toUpperCase().slice(0, 14)), n: N })}</text>`;
  const bw = (W - L - 4) / ((to - from) / (3 * 3.6e6)) - 1.5;
  pts.forEach(p => {
    const x0 = Math.max(L, x(p.t)), h = Math.max(1.5, H - B - y(p.k));
    const pred = p.kind === 'predicted';
    const hm = t => new Date(t).toLocaleString(LOC, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
    s += `<rect x="${x0 + .75}" y="${H - B - h}" width="${Math.max(1, bw)}" height="${h}" rx="1.5" fill="${kpColor(p.k)}" fill-opacity="${pred ? .45 : .9}"><title>${hm(p.t)} – ${new Date(p.t + 3 * 3.6e6).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit', timeZone: TZ })} · Kp ${p.k.toFixed(1)}${pred ? ' · ' + window.T('forecast') : ''}</title></rect>`;
  });
  // day ticks (local midnight)
  const d = new Date(from); d.setHours(24, 0, 0, 0);
  for (; d.getTime() < to; d.setDate(d.getDate() + 1)) {
    const xx = x(d.getTime());
    s += `<line x1="${xx}" x2="${xx}" y1="${T}" y2="${H - B}" stroke="#2C3542"/>`;
    s += `<text x="${xx + 3}" y="${H - 5}" fill="#8B9BAE" font-size="8" font-family="JetBrains Mono">${(d.toLocaleDateString(LOC, { weekday: 'short', timeZone: TZ }) + (W > 600 ? ' ' + d.toLocaleDateString(LOC, { day: 'numeric', month: 'short', timeZone: TZ }) : '')).toUpperCase()}</text>`;
    // wide chart (PC): the hours 06 · 12 · 18 of each day
    if (W > 600) (x(from + 6 * 3.6e6) - x(from) > 75 ? [6, 12, 18] : [12, 18]).forEach(hh => { const th = d.getTime() + hh * 3.6e6, xh = x(th); if (th > from && th < to) s += `<line x1="${xh}" x2="${xh}" y1="${H - B}" y2="${H - B + 3}" stroke="#4A5565"/><text x="${xh}" y="${H - 5}" text-anchor="middle" fill="#5C6878" font-size="7.5" font-family="JetBrains Mono">${String(hh).padStart(2, '0')}</text>`; });
  }
  const xn = x(now);
  s += `<line x1="${xn}" x2="${xn}" y1="${T}" y2="${H - B}" stroke="#fff" stroke-opacity=".7" stroke-dasharray="2 3"/>`;
  s += `<text x="${xn + 3}" y="${T + 8}" fill="#fff" font-size="8" font-family="JetBrains Mono">${window.T('NOW')} · ${new Date(now).toLocaleString(LOC, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }).toUpperCase()}</text>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = s; svg.dataset.tx = JSON.stringify([from, to, x(from), x(to), H]); window.tcursor && tcursor();
}

/* ── Real-time solar wind (ACE hourly for 3 / 7 days, NOAA RTSW 1-minute for the last day, loaded only when asked) ── */
let wRange = 7;
document.querySelectorAll('[data-wr]').forEach(c => c.onclick = () => { wRange = +c.dataset.wr;
  document.querySelectorAll('[data-wr]').forEach(o => o.classList.toggle('on', o === c)); loadWind(); });
const okv = v => v != null && isFinite(v) && v > -9990;
async function loadWind(force) {
  try {
    if (wRange === 1) {   // ≈ 5 MB: 1-minute data from the spacecraft NOAA uses now (DSCOVR / ACE / IMAP), averaged to 5 min
      if (force || !S.rt || Date.now() - S.rt.at > 15 * 60000) {
        $('wSrc').textContent = T('LOADING 1-MINUTE DATA…');
        const [m, w] = await Promise.all([j(API + 'json/rtsw/rtsw_mag_1m.json'), j(API + 'json/rtsw/rtsw_wind_1m.json')]);
        const bin = new Map(), B = t => Math.floor(t / 3e5) * 3e5, get = t => bin.get(t) || bin.set(t, { t, n: {} }).get(t);
        const add = (o, k, v) => { if (!okv(v)) return; const a = o.n[k] || (o.n[k] = [0, 0]); a[0] += v; a[1]++; };
        m.filter(r => r.active).forEach(r => { const o = get(B(Date.parse(r.time_tag + 'Z'))); add(o, 'bt', r.bt); add(o, 'bz', r.bz_gsm); add(o, 'phi', r.phi_gsm); });
        w.filter(r => r.active).forEach(r => { const o = get(B(Date.parse(r.time_tag + 'Z'))); add(o, 'n', r.proton_density); add(o, 'v', r.proton_speed); add(o, 'T', r.proton_temperature); });
        const src = (m.find(r => r.active) || {}).source || '';
        S.rt = { at: Date.now(), src, pts: [...bin.values()].sort((a, b) => a.t - b.t).map(o => { const r = { t: o.t }; for (const k in o.n) r[k] = o.n[k][0] / o.n[k][1]; return r; }) };
      }
      S.wind = S.rt.pts; $('wSrc').textContent = `${({ SOLAR1: 'SWFO-L1', DSCOVR: 'DSCOVR', ACE: 'ACE', IMAP: 'IMAP' })[S.rt.src] || S.rt.src || 'NOAA'} ${T('SPACECRAFT · 5-MIN AVERAGES')}`;
    } else {
      if (force || !S.ace || Date.now() - S.ace.at > 10 * 60000) {
        const [m, w] = await Promise.all([j(API + 'json/ace/mag/ace_mag_1h.json'), j(API + 'json/ace/swepam/ace_swepam_1h.json')]);
        const by = new Map(), get = t => by.get(t) || by.set(t, { t }).get(t);
        m.forEach(r => { const o = get(Date.parse(r.time_tag + 'Z')); if (okv(r.bt)) o.bt = r.bt; if (okv(r.gsm_bz)) o.bz = r.gsm_bz; if (okv(r.gsm_lon)) o.phi = r.gsm_lon; });
        w.forEach(r => { const o = get(Date.parse(r.time_tag + 'Z')); if (okv(r.dens)) o.n = r.dens; if (okv(r.speed)) o.v = r.speed; if (okv(r.temperature)) o.T = r.temperature; });
        S.ace = { at: Date.now(), pts: [...by.values()].sort((a, b) => a.t - b.t) };
      }
      S.wind = S.ace.pts; $('wSrc').textContent = T('ACE SPACECRAFT · HOURLY AVERAGES');
    }
    drawWind();
  } catch (e) { $('wSrc').textContent = T('COULD NOT LOAD THE SOLAR WIND DATA'); }
}
// guess the kind of solar wind change from its shape (a hint for reading the chart, not an official NOAA call)
function windEvents(P, win) {
  const med = a => { a = a.filter(v => v != null && isFinite(v)).sort((p, q) => p - q); return a.length ? a[a.length >> 1] : null; };
  const val = (k, a, b) => med(P.filter(p => p.t >= a && p.t < b && okv(p[k])).map(p => p[k]));
  const shocks = [];
  P.forEach(p => { if (!okv(p.v)) return; const vB = val('v', p.t - win, p.t), vA = val('v', p.t, p.t + win), nB = val('n', p.t - win, p.t), nA = val('n', p.t, p.t + win), bB = val('bt', p.t - win, p.t), bA = val('bt', p.t, p.t + win);
    if (vB == null || vA == null || nB == null || nA == null) return; const dv = vA - vB;
    if (dv >= 45 && nA >= 1.4 * nB && (bB == null || bA == null || bA >= 1.3 * bB)) shocks.push({ t: p.t, k: 'cme', d: dv }); });
  const out = []; shocks.sort((a, b) => b.d - a.d).forEach(e => { if (!out.some(o => Math.abs(o.t - e.t) < 12 * 3600e3)) out.push(e); });
  const cme = out.slice(0, 2).map(e => {   // the moment = the first point already well above the wind before it
    const p = P.find(q => okv(q.v) && q.t >= e.t - 2 * win && q.t <= e.t + win && q.v - val('v', q.t - win, q.t) >= .6 * e.d); return p ? { ...e, t: p.t } : e; });
  // coronal-hole stream: the 6-h speed climbs ≥ 120 km/s within 36 h from ≤ 450, with no shock nearby
  const H = 3600e3, sm = P.filter(p => okv(p.v)).map(p => ({ t: p.t, v: val('v', p.t - 3 * H, p.t + 3 * H) }));
  let best = null;
  sm.forEach((a, i) => { if (a.v > 450) return; for (let j = i + 1; j < sm.length && sm[j].t - a.t <= 36 * H; j++) { const b = sm[j], rise = b.v - a.v;
    if (rise >= 120 && (!best || rise > best.rise)) best = { a, b, rise }; } });
  if (best) { const mid = (best.a.v + best.b.v) / 2, m = sm.find(p => p.t >= best.a.t && p.v >= mid) || best.b;
    if (!cme.some(c => c.t > best.a.t - 12 * H && c.t < best.b.t + 12 * H)) {
      const pile = P.filter(p => p.t >= best.a.t - 12 * H && p.t <= m.t && okv(p.n)).reduce((q, p) => !q || p.n > q.n ? p : q, null);
      const vmax = Math.round(Math.max(...P.filter(p => p.t >= m.t && p.t <= m.t + 36 * H && okv(p.v)).map(p => p.v)));
      const nAfter = val('n', m.t, m.t + 24 * H), piled = pile && nAfter != null && pile.n >= 1.4 * nAfter;   // the bulge of slow wind pushed ahead of the fast stream
      cme.push({ t: m.t, k: 'ch', pile: piled ? pile.t : null, v: vmax }); } }
  return cme.sort((a, b) => a.t - b.t);
}
function drawWind() {
  const now = Date.now(), from = now - wRange * 864e5, P = S.wind.filter(p => p.t >= from);
  const last = k => { for (let i = P.length - 1; i >= 0; i--) if (okv(P[i][k])) return P[i][k]; return null; };
  const L = { bz: last('bz'), bt: last('bt'), v: last('v'), n: last('n'), T: last('T') };
  const cell = (k, v, u, c, g) => `<div><div class="lbl" style="color:${g}">${k}</div><b style="color:${c}">${v == null ? '–' : v}<span style="font-size:11px;color:${g}"> ${u}</span></b></div>`;   // g = its line colour in the chart, c = value (warns past a threshold)
  $('wNow').innerHTML = cell('Bz', L.bz == null ? null : (L.bz > 0 ? '+' : '') + L.bz.toFixed(1), 'nT', L.bz <= -10 ? '#FF4444' : L.bz < 0 ? '#FF8A8A' : '#E0E0E0', '#FF5A5A')
    + cell('Bt', L.bt == null ? null : L.bt.toFixed(1), 'nT', L.bt >= 15 ? '#FFA040' : '#E0E0E0', '#E0E0E0') + cell(T('Speed'), L.v == null ? null : Math.round(L.v), 'km/s', L.v >= 600 ? '#FF7A3D' : L.v >= 450 ? '#E8C766' : '#E0E0E0', '#E8C766')
    + cell(T('Dens.'), L.n == null ? null : L.n.toFixed(1), '/cm³', L.n >= 20 ? '#FFA040' : '#E0E0E0', '#FFA040') + cell(T('Temp'), L.T == null ? null : Math.round(L.T / 1000), 'k K', '#E0E0E0', '#39FF9E');
  $('wLead').innerHTML = L.v ? T('Measured 1.5 million km upstream — this wind reaches Earth in about <b>{m} minutes</b>.', { m: Math.round(1.5e6 / L.v / 60) }) : '';
  // stacked panels: Bt + Bz · Phi · density · speed · temperature (log)
  const svg = $('windchart'), W = svg.clientWidth || 340, Lm = 30, R = 6, ph = 60, gap = 22, top = 14, panels = 5, H = top + panels * (ph + gap) - gap + 18;
  const x = t => Lm + (t - from) / (now - from) * (W - Lm - R);
  let s = '';
  const panel = (i, name, col, lo, hi, ticks, key, opt = {}) => {
    const y0 = top + i * (ph + gap), yv = v => { const a = opt.log ? Math.log10(v) : v, l = opt.log ? Math.log10(lo) : lo, h = opt.log ? Math.log10(hi) : hi; return y0 + ph - (Math.min(h, Math.max(l, a)) - l) / (h - l) * ph; };
    s += `<rect x="${Lm}" y="${y0}" width="${W - Lm - R}" height="${ph}" rx="6" fill="#0F1216"/>`;
    ticks.forEach(v => { s += `<line x1="${Lm}" x2="${W - R}" y1="${yv(v)}" y2="${yv(v)}" stroke="${v === 0 ? '#3A4350' : '#1E2530'}"/><text x="${Lm - 3}" y="${yv(v) + 3}" text-anchor="end" fill="#6B7280" font-size="7.5" font-family="JetBrains Mono">${opt.fmt ? opt.fmt(v) : v}</text>`; });
    s += `<text x="${Lm}" y="${y0 - 4}" fill="${col}" font-size="8" font-family="JetBrains Mono" font-weight="700">${name}</text>`;
    return { yv, y0 };
  };
  const line = (key, yv, col, w, gapMs) => { let d = '', prev = null; P.forEach(p => { if (!okv(p[key])) { prev = null; return; } d += (prev == null || p.t - prev > gapMs ? 'M' : 'L') + x(p.t).toFixed(1) + ' ' + yv(p[key]).toFixed(1); prev = p.t; });
    return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round"/>`; };
  const gapMs = wRange === 1 ? 20 * 60000 : 3 * 3600e3;
  const bMax = Math.max(10, ...P.map(p => okv(p.bt) ? p.bt : 0)) * 1.1, bt = panel(0, 'Bt · Bz  nT', '#E0E0E0', -bMax, bMax, [-20, -10, 0, 10, 20].filter(v => Math.abs(v) < bMax));
  // south Bz shaded red: the part that feeds storms
  let sh = ''; P.forEach(p => { if (okv(p.bz) && p.bz < 0) sh += `M${x(p.t).toFixed(1)} ${bt.yv(0).toFixed(1)}V${bt.yv(p.bz).toFixed(1)}`; });
  s += `<path d="${sh}" stroke="#FF4444" stroke-opacity=".35" stroke-width="${Math.max(1, (W - Lm - R) / Math.max(1, P.length))}"/>` + line('bt', bt.yv, '#E0E0E0', 1.2, gapMs) + line('bz', bt.yv, '#FF5A5A', 1.4, gapMs);
  const ph1 = panel(1, 'Phi  °', '#B388FF', 0, 360, [90, 180, 270]);
  P.forEach(p => { if (okv(p.phi)) s += `<circle cx="${x(p.t).toFixed(1)}" cy="${ph1.yv(p.phi).toFixed(1)}" r="1.1" fill="#B388FF"/>`; });
  const nMax = Math.max(10, ...P.map(p => okv(p.n) ? p.n : 0)) * 1.15, dn = panel(2, T('Density') + '  /cm³', '#FFA040', 0, nMax, [5, 10, 20, 40, 80].filter(v => v < nMax));
  s += line('n', dn.yv, '#FFA040', 1.4, gapMs);
  const vMax = Math.max(700, ...P.map(p => okv(p.v) ? p.v : 0)) * 1.05, sp = panel(3, T('Speed') + '  km/s', '#E8C766', 250, vMax, [300, 400, 500, 600, 800, 1000].filter(v => v < vMax));
  s += line('v', sp.yv, '#E8C766', 1.4, gapMs);
  const tp = panel(4, T('Temperature') + '  K', '#39FF9E', 1e4, 1e6, [1e4, 1e5, 1e6], 'T', { log: true, fmt: v => v >= 1e6 ? '1M' : v / 1000 + 'k' });
  s += line('T', tp.yv, '#39FF9E', 1.2, gapMs);
  // what the wind looks like: a CME shock (speed, density and field jump together) or a coronal-hole stream (density piles up first, then the speed climbs slowly)
  const EV = windEvents(P, wRange === 1 ? 30 * 60000 : 3 * 3600e3), yEnd = top + panels * (ph + gap) - gap;
  EV.forEach(e => { const xx = x(e.t), c = e.k === 'cme' ? '#FFFFFF' : '#3EE08F', lab = e.k === 'cme' ? T('CME shock?') : T('coronal-hole stream?'), right = xx > W * .7, tw = lab.length * 5.2 + 8;
    s += `<line x1="${xx}" x2="${xx}" y1="${top}" y2="${yEnd}" stroke="${c}" stroke-opacity=".75" stroke-dasharray="4 3"/>`;
    if (e.k === 'ch' && e.pile) { const xp = x(e.pile); s += `<line x1="${xp}" x2="${xp}" y1="${dn.y0}" y2="${dn.y0 + ph}" stroke="#FFA040" stroke-opacity=".8" stroke-dasharray="2 2"/>`; }
    s += `<rect x="${right ? xx - tw - 2 : xx + 2}" y="${top + ph + 4}" width="${tw}" height="12" rx="3" fill="#0B0E12" stroke="${c}" stroke-opacity=".5"/><text x="${right ? xx - tw / 2 - 2 : xx + 2 + tw / 2}" y="${top + ph + 13}" text-anchor="middle" fill="${c}" font-size="8" font-family="JetBrains Mono" font-weight="700">${lab}</text>`; });
  const evTxt = EV.map(e => e.k === 'cme' ? T('<b>{t}</b> looks like a <b>CME shock</b>: speed, density and field jumped at the same moment.', { t: dayHm(e.t) })
    : T(e.pile ? '<b>{t}</b> looks like a <b>coronal-hole stream</b>: the density piled up first, then the speed climbed slowly to {v} km/s.' : '<b>{t}</b> looks like a <b>coronal-hole stream</b>: the speed climbed slowly to {v} km/s, with no sudden jump.', { t: dayHm(e.t), v: e.v })).join('<br>');
  $('wEv').innerHTML = evTxt ? '<span style="color:#8B9BAE">' + T('Our guess from the shape:') + '</span> ' + evTxt : '';
  // day / hour ticks + now
  const yb = top + panels * (ph + gap) - gap, step = wRange === 1 ? 6 * 3600e3 : 864e5, d = new Date(from);
  if (wRange === 1) d.setMinutes(0, 0, 0), d.setHours(Math.ceil(d.getHours() / 6) * 6); else d.setHours(24, 0, 0, 0);
  for (; d.getTime() < now; d.setTime(d.getTime() + step)) { const xx = x(d.getTime());
    s += `<line x1="${xx}" x2="${xx}" y1="${top}" y2="${yb}" stroke="#2C3542" stroke-opacity=".8"/><text x="${xx + 2}" y="${yb + 11}" fill="#8B9BAE" font-size="8" font-family="JetBrains Mono">${wRange === 1 ? hhmm(d) : dayD(d.getTime())}</text>`; }
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.style.height = H + 'px'; svg.innerHTML = s; svg.dataset.tx = JSON.stringify([from, now, x(from), x(now), H]); window.tcursor && tcursor();
}

/* ── Space weather at Earth: G (geomagnetic) · S (radiation, GOES protons) · R (radio blackouts, GOES X-rays) · satellites (GOES electrons) ── */
let swTab = 'g';
document.querySelectorAll('[data-sw]').forEach(c => c.onclick = () => { swTab = c.dataset.sw;
  document.querySelectorAll('[data-sw]').forEach(o => o.classList.toggle('on', o === c)); drawSw(); });
const GOES = { r: 'json/goes/primary/xrays-7-day.json', s: 'json/goes/primary/integral-protons-7-day.json', e: 'json/goes/primary/integral-electrons-7-day.json' };   // 7 days like every other chart (the archive keeps weeks)
async function goes(k, force) {   // loaded only when its tab is opened (X-rays ≈ 4.6 MB), then kept 10 min
  if (!force && S['g' + k] && Date.now() - S['g' + k].at < 10 * 60000) return S['g' + k];
  const a = await j(API + GOES[k]), by = {};
  a.forEach(r => { if (!(r.flux > 0)) return; const t = Date.parse(r.time_tag), b = Math.floor(t / 3e5) * 3e5, key = r.energy;   // 5-min bins, keep the max (flares are short)
    const m = by[key] || (by[key] = new Map()); m.set(b, Math.max(m.get(b) || 0, r.flux)); });
  const ser = {}; for (const key in by) ser[key] = [...by[key].entries()].sort((x, y) => x[0] - y[0]);
  return S['g' + k] = { at: Date.now(), ser };
}
const xClass = f => { const c = f >= 1e-4 ? ['X', 1e-4] : f >= 1e-5 ? ['M', 1e-5] : f >= 1e-6 ? ['C', 1e-6] : f >= 1e-7 ? ['B', 1e-7] : ['A', 1e-8]; return c[0] + (f / c[1]).toFixed(1); };
const sciT = v => { const e = Math.round(Math.log10(v)); return e === 0 ? '1' : e === 1 ? '10' : '10' + String(e).replace('-', '⁻').replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]); };
// log-scale chart over the last 7 days: series [{pts, col, w}], threshold lines [{v, label, col}], right-side band labels
function logChart(series, lo, hi, lines, bands, svg) {
  svg = svg || $('swChart'); const W = svg.clientWidth || 340, H = Math.max(190, svg.clientHeight || 0), L = 34, R = bands ? 16 : 6, T = 8, B = 18, now = Date.now(), from = now - 7 * 864e5;
  const x = t => L + (t - from) / (now - from) * (W - L - R), y = v => T + (Math.log10(hi) - Math.log10(Math.max(lo, Math.min(hi, v)))) / (Math.log10(hi) - Math.log10(lo)) * (H - T - B);
  let s = `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" rx="6" fill="#0F1216"/>`;
  for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e++) { const v = 10 ** e;
    s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#1E2530"/><text x="${L - 3}" y="${y(v) + 3}" text-anchor="end" fill="#6B7280" font-size="7.5" font-family="JetBrains Mono">${sciT(v)}</text>`; }
  if (bands) bands.forEach(([v, l]) => { s += `<text x="${W - 4}" y="${y(v * 3.2) + 3}" text-anchor="end" fill="#8B9BAE" font-size="9" font-family="JetBrains Mono" font-weight="700">${l}</text>`; });
  const d = new Date(from); d.setHours(24, 0, 0, 0);
  for (; d.getTime() < now; d.setDate(d.getDate() + 1)) { const xx = x(d.getTime()); s += `<line x1="${xx}" x2="${xx}" y1="${T}" y2="${H - B}" stroke="#2C3542"/><text x="${xx + 2}" y="${H - 5}" fill="#8B9BAE" font-size="8" font-family="JetBrains Mono">${dayD(d.getTime())}</text>`; }
  lines.forEach(l => { s += `<line x1="${L}" x2="${W - R}" y1="${y(l.v)}" y2="${y(l.v)}" stroke="${l.col}" stroke-dasharray="4 3" stroke-opacity=".8"/><text x="${L + 4}" y="${y(l.v) - 3}" fill="${l.col}" font-size="7.5" font-family="JetBrains Mono">${l.label}</text>`; });
  series.forEach(sr => { let dd = '', prev = 0; sr.pts.forEach(([t, v]) => { if (t < from) return; dd += (t - prev > 20 * 60000 ? 'M' : 'L') + x(t).toFixed(1) + ' ' + y(v).toFixed(1); prev = t; });
    s += `<path d="${dd}" fill="none" stroke="${sr.col}" stroke-width="${sr.w || 1.3}" stroke-linejoin="round"/>`; });
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.style.height = H + 'px'; svg.innerHTML = s; svg.dataset.tx = JSON.stringify([from, now, x(from), x(now), H]); window.tcursor && tcursor();
}
const legend = items => `<div class="enlleg" style="margin-top:6px">${items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('')}</div>`;
async function srXray() {   // X-rays (GOES, last 7 days) + the biggest flares of 7 days, under the region lists
  const box = document.querySelector('#srHost .sr-x'); if (!box) return;
  if (!box.firstChild) box.innerHTML = `<div class="sr-h">${T('X-RAYS · GOES · LAST 7 DAYS')}</div><div class="swnow" id="srXNow">${T('Loading GOES data…')}</div><svg id="srXChart" role="img" aria-label="${T('X-ray flux of the last 7 days')}"></svg><div id="srXList"></div>`;
  try { const D = await goes('r'), lg = D.ser['0.1-0.8nm'] || [], sh = D.ser['0.05-0.4nm'] || [], cur = lg.length ? lg[lg.length - 1][1] : 0, mx = lg.reduce((a, p) => p[1] > a[1] ? p : a, [0, 0]);
    logChart([{ pts: sh, col: '#5AA9FF', w: 1 }, { pts: lg, col: '#FF5A5A', w: 1.4 }], 1e-9, 1e-2, [{ v: 1e-5, label: 'R1 · M-CLASS', col: '#FFA040' }, { v: 1e-4, label: 'R3 · X-CLASS', col: '#FF4444' }], [[1e-8, 'A'], [1e-7, 'B'], [1e-6, 'C'], [1e-5, 'M'], [1e-4, 'X']], $('srXChart'));
    $('srXNow').innerHTML = T('X-rays now <b>{a}</b> · strongest in 7 days <b style="color:{c}">{b}</b> {t}.', { a: xClass(cur), c: mx[1] >= 1e-5 ? '#FFA040' : '#E0E0E0', b: xClass(mx[1]), t: dayHm(mx[0]) });
    const fl = await j(API + 'json/goes/primary/xray-flares-7-day.json').catch(() => []), RI = await SunRegions.load().catch(() => null);
    const big = fl.filter(f => /^[MX]/.test(f.max_class)), show = (big.length ? big : fl.filter(f => /^C/.test(f.max_class)).sort((a, b) => b.max_xrlong - a.max_xrlong).slice(0, 3)).sort((a, b) => Date.parse(b.max_time) - Date.parse(a.max_time)).slice(0, 6);
    $('srXList').innerHTML = legend([['#FF5A5A', T('0.1–0.8 NM · SETS THE CLASS')], ['#5AA9FF', '0.05–0.4 NM']])
      + `<div class="lbl" style="margin-top:12px">${big.length ? T('M / X flares') : T('Biggest flares')} · ${T('last 7 days')}</div>`
      + (show.length ? show.map(f => `<div class="flr" role="button" tabindex="0" data-t="${Date.parse(f.max_time)}" title="${T('Show this moment on the clock')}"><b style="color:${/^X/.test(f.max_class) ? '#FF4444' : /^M/.test(f.max_class) ? '#FFA040' : '#E0E0E0'}">${esc(f.max_class)}</b>${flWhere(RI, f)}<span>${dayHm(Date.parse(f.max_time))}</span></div>`).join('') : '<div class="loading">' + T('NO FLARES') + '</div>');
  } catch (e) { $('srXNow').textContent = T('GOES data unavailable right now.'); }
}
window.srXray = srXray;
const HOW = {
  g: T(`<p><b>G = geomagnetic storms</b>: the solar wind shaking Earth's magnetic field (the measured solar wind and Kp above show it building). G1 = Kp 5 … G5 = Kp 9.</p>
    <p><b>What it affects:</b> G1–G2: weak power-grid fluctuations, satellite orientation, aurora in the far north. G3: GPS / HF radio problems, satellite drag, aurora into central Europe. G4–G5: power grids at risk, GPS degraded for hours, aurora overhead in Romania (May 2024 was G5).</p>
    <p>The alerts below are NOAA's own messages: <b>WATCH</b> = forecast, <b>WARNING</b> = expected soon, <b>ALERT</b> = happening now.</p>`),
  s: T(`<p><b>S = solar radiation storms</b>: high-energy protons from a big flare / CME shock, measured by the GOES satellites. They arrive <b>minutes to hours</b> after the flare — much faster than the CME itself.</p>
    <p><b>Read the yellow line (≥ 10 MeV)</b> against the dashed levels: crossing <b>10</b> = S1, <b>100</b> = S2, <b>1 000</b> = S3, each step ten times stronger. ≥ 100 MeV (blue) rising too means the hardest particles — the dangerous kind.</p>
    <p><b>What it affects:</b> astronauts, satellite electronics and solar panels, passengers on polar flights (extra dose), HF radio near the poles. On the ground you're shielded — no effect on people in Romania.</p>`),
  r: T(`<p><b>R = radio blackouts</b> from solar flares — X-rays reach Earth in 8 minutes, so this is <b>instant</b>. The red line (long wavelength) sets the flare class: <b>A, B, C</b> = small, <b>M</b> = medium (R1–R2), <b>X</b> = big (R3+). Each letter is ten times stronger; the number is the multiplier (M5 = 5 × M1).</p>
    <p><b>What it affects:</b> shortwave (HF) radio and GPS accuracy on the <b>sunlit side</b> of Earth, for minutes to an hour. The blue line (short wavelength) jumps with it during a flare.</p>
    <p><b>Why it matters for storms:</b> M and X flares often launch a <b>CME</b> — then watch the solar wind forecast: it can hit Earth 1–3 days later.</p>`),
  e: T(`<p><b>Electrons ≥ 2 MeV</b> in Earth's outer radiation belt, at the GOES satellites' orbit. Not a NOAA scale, but NOAA alerts above <b>1 000</b> (dashed line).</p>
    <p>They usually <b>build up 1–3 days after a fast solar wind stream or a geomagnetic storm</b> and stay high for days. High values charge up satellites inside — glitches, failures (they're behind some satellite losses).</p>
    <p>The daily up-and-down wave is normal: the satellite passes through denser and thinner parts of the belt as Earth turns. No effect on the ground.</p>`) };
// G0–G5 with the Kp they need and how far south the aurora gets; now and "visible from your place" marked
function gLadder(g) {
  const N = need(), rows = [[5, '9', T('Extreme'), T('aurora overhead in Romania, power grids at risk')], [4, '8', T('Severe'), T('aurora high in the sky over Romania')],
    [3, '7', T('Strong'), T('aurora low in the north from Romania')], [2, '6', T('Moderate'), T('aurora over Poland and northern Germany')],
    [1, '5', T('Minor'), T('aurora over Scandinavia and Scotland')], [0, '0–4', T('Quiet'), T('aurora only near the Arctic Circle')]];
  $('gLadder').innerHTML = rows.map(([lv, kp, name, txt]) => { const here = lv ? +kp >= N && (lv === 1 || +kp - 1 < N) : N <= 4;
    return `<div class="glr${lv === g ? ' now' : ''}"><b style="color:${lv ? kpColor(lv + 4) : '#6EE7A0'}">G${lv}</b><span class="glk">Kp ${kp} · ${name}</span><span class="glt">${txt}${here ? ' <em>' + T('← visible from {p}', { p: esc(BV.name) }) + '</em>' : ''}</span>${lv === g ? '<i>' + T('NOW') + '</i>' : ''}</div>`; }).join('');
}
async function drawSw() {
  vis2('swG', swTab === 'g'); $('swHowTxt').innerHTML = HOW[swTab]; $('swList').innerHTML = '';
  $('swChart').style.display = swTab === 'g' ? 'none' : '';
  if (swTab === 'g') { $('swChart').innerHTML = ''; delete $('swChart').dataset.tx;
    const g = +($('scG').textContent.slice(1)) || 0;
    gLadder(g);
    $('swNow').innerHTML = T('Now <b>G{g}</b>, Kp {k}.', { g, k: S.kpNow != null ? S.kpNow.toFixed(1) : '–' }) + ' ' + (g ? T('<b style="color:{c}">{s}</b> under way.', { c: kpColor(g + 4), s: G_TXT[g] }) : T('Earth\'s magnetic field is quiet or only unsettled.')) + ' ' + T('The Kp charts above show where it\'s heading.'); return; }
  $('swNow').textContent = T('Loading GOES data…');
  try { const D = await goes(swTab); if (swTab !== (D === S.gr ? 'r' : D === S.gs ? 's' : 'e')) return;
    if (swTab === 'r') {
      const lg = D.ser['0.1-0.8nm'] || [], cur = lg.length ? lg[lg.length - 1][1] : 0, mx = lg.reduce((a, p) => p[1] > a[1] ? p : a, [0, 0]);
      $('swChart').style.display = 'none'; $('swChart').innerHTML = ''; delete $('swChart').dataset.tx;
      $('swNow').innerHTML = T('X-rays now <b>{a}</b> · strongest in 7 days <b style="color:{c}">{b}</b> {t}.', { a: xClass(cur), c: mx[1] >= 1e-5 ? '#FFA040' : '#E0E0E0', b: xClass(mx[1]), t: dayHm(mx[0]) });
      $('swList').innerHTML = `<button class="swjump" id="swJump">${T('↑ X-RAY CHART, FLARES AND WHERE ON THE SUN THEY CAME FROM')}</button>`;
      $('swJump').onclick = () => $('secReg').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
    } else if (swTab === 's') {
      const p10 = D.ser['>=10 MeV'] || [], cur = p10.length ? p10[p10.length - 1][1] : 0, lvl = cur >= 1e5 ? 5 : cur >= 1e4 ? 4 : cur >= 1e3 ? 3 : cur >= 100 ? 2 : cur >= 10 ? 1 : 0;
      logChart([{ pts: D.ser['>=100 MeV'] || [], col: '#5AA9FF', w: 1 }, { pts: D.ser['>=50 MeV'] || [], col: '#B388FF', w: 1 }, { pts: p10, col: '#E8C766', w: 1.5 }], 1e-2, 1e5,
        [{ v: 10, label: 'S1', col: '#FFA040' }, { v: 100, label: 'S2', col: '#FF7A3D' }, { v: 1000, label: 'S3', col: '#FF4444' }, { v: 1e4, label: 'S4', col: '#E05BFF' }]);
      $('swNow').innerHTML = T('≥ 10 MeV protons now <b>{v}</b> pfu', { v: cur < 1 ? cur.toFixed(2) : Math.round(cur) }) + ` → <b style="color:${lvl ? '#FFA040' : '#6EE7A0'}">S${lvl}${lvl ? '' : ' · ' + T('NO RADIATION STORM')}</b>.`;
      $('swList').innerHTML = legend([['#E8C766', T('≥ 10 MEV · SETS THE S LEVEL')], ['#B388FF', '≥ 50 MEV'], ['#5AA9FF', '≥ 100 MEV']]);
    } else {
      const e2 = D.ser['>=2 MeV'] || [], cur = e2.length ? e2[e2.length - 1][1] : 0, mx = e2.reduce((a, p) => Math.max(a, p[1]), 0);
      logChart([{ pts: e2, col: '#FF8A5A', w: 1.4 }], 1e-1, 1e6, [{ v: 1000, label: T('NOAA ALERT · 1000'), col: '#FFA040' }]);
      $('swNow').innerHTML = T('≥ 2 MeV electrons now <b>{v}</b> pfu · 7-day high <b style="color:{c}">{m}</b>', { v: Math.round(cur), c: mx >= 1000 ? '#FFA040' : '#E0E0E0', m: Math.round(mx) }) + ' — ' + (mx >= 1000 ? T('satellite charging risk elevated.') : T('below the alert level, normal.'));
      $('swList').innerHTML = legend([['#FF8A5A', '≥ 2 MEV · GOES']]);
    }
  } catch (e) { $('swNow').textContent = T('Could not load the GOES data.'); }
}
function vis2(id, on) { $(id).style.display = on ? '' : 'none'; }

/* ── Solar cycle: cycles 21–25 aligned on their start (SILSO minima), smoothed monthly sunspot number ── */
const CYC = [[21, '1976-03', '1986-09', '#7FB8FF'], [22, '1986-09', '1996-08', '#8B9BAE'], [23, '1996-08', '2008-12', '#FF6B6B'], [24, '2008-12', '2019-12', '#E05BFF'], [25, '2019-12', null, '#39FF9E']];
const mIdx = tag => { const [y, m] = tag.split('-').map(Number); return y * 12 + m - 1; };
const mName = i => new Date(Date.UTC(Math.floor(i / 12), i % 12, 1)).toLocaleDateString(LOC, { month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
function drawCycles() {
  const svg = $('cycchart'), cw = svg.clientWidth || 340, W = Math.min(cw, 760), H = cw > 760 ? 330 : 230, L = 26,   // wide screens: drawn at 760 × 330 and scaled up, text grows with it
    B = 20, T = 10, R = 6, C = S.cyc;
  const x = m => L + m / 144 * (W - L - R), y = v => H - B - v / 260 * (H - B - T);
  let s = '';
  [0, 50, 100, 150, 200, 250].forEach(v => { s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#232830"/><text x="0" y="${y(v) + 3}" fill="#6B7280" font-size="8" font-family="JetBrains Mono">${v}</text>`; });
  for (let yr = 0; yr <= 12; yr += 2) s += `<line x1="${x(yr * 12)}" x2="${x(yr * 12)}" y1="${T}" y2="${H - B}" stroke="#1E2530"/><text x="${x(yr * 12)}" y="${H - 6}" text-anchor="middle" fill="#8B9BAE" font-size="8" font-family="JetBrains Mono">${yr}${yr === 12 ? ' Y' : ''}</text>`;
  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join('');
  C.cycles.forEach(c => { if (c.n === 25) return; s += `<path d="${path(c.pts)}" fill="none" stroke="${c.col}" stroke-width="1.4" stroke-opacity=".75"/>`; });
  const c25 = C.cycles.find(c => c.n === 25);
  C.raw.forEach(p => { s += `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="1.6" fill="#39FF9E" fill-opacity=".35"/>`; });
  if (C.pred.length) s += `<path d="${path(C.pred)}" fill="none" stroke="#39FF9E" stroke-width="1.6" stroke-dasharray="4 3" stroke-opacity=".8"/>`;
  s += `<path d="${path(c25.pts)}" fill="none" stroke="#39FF9E" stroke-width="2.6"/>`;
  const pk = c25.pts.reduce((a, p) => p[1] > a[1] ? p : a, [0, 0]);
  s += `<circle cx="${x(pk[0])}" cy="${y(pk[1])}" r="3.5" fill="#39FF9E"/><text x="${x(pk[0])}" y="${y(pk[1]) - 7}" text-anchor="middle" fill="#CFFFE6" font-size="8" font-family="JetBrains Mono">${window.T('PEAK')} ${Math.round(pk[1])}</text>`;
  const nx = x(C.nowM); s += `<line x1="${nx}" x2="${nx}" y1="${T}" y2="${H - B}" stroke="#fff" stroke-opacity=".7" stroke-dasharray="2 3"/><text x="${nx + 3}" y="${T + 8}" fill="#fff" font-size="8" font-family="JetBrains Mono">${window.T('NOW')}</text>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = s;
}
async function loadCycles() {
  const [obs, pred] = await Promise.all([j(API + 'json/solar-cycle/observed-solar-cycle-indices.json'), j(API + 'json/solar-cycle/predicted-solar-cycle.json')]);
  const cycles = CYC.map(([n, a, b, col]) => { const s0 = mIdx(a), s1 = b ? mIdx(b) : 1e9;
    return { n, col, s0, a, b, pts: obs.filter(o => o.smoothed_ssn >= 0 && mIdx(o['time-tag']) >= s0 && mIdx(o['time-tag']) <= s1).map(o => [mIdx(o['time-tag']) - s0, o.smoothed_ssn]) }; });
  const c25 = cycles[4], last = obs[obs.length - 1], lastS = c25.pts[c25.pts.length - 1];
  const raw = obs.filter(o => mIdx(o['time-tag']) >= c25.s0 && o.ssn >= 0).map(o => [mIdx(o['time-tag']) - c25.s0, o.ssn]);
  const predPts = [lastS].concat(pred.filter(p => mIdx(p['time-tag']) - c25.s0 > lastS[0]).map(p => [mIdx(p['time-tag']) - c25.s0, p.predicted_ssn])).filter(p => p[0] <= 144);
  const now = new Date(), nowM = now.getUTCFullYear() * 12 + now.getUTCMonth() - c25.s0;
  S.cyc = { cycles, raw, pred: predPts, nowM };
  drawCycles();
  const pk = c25.pts.reduce((a, p) => p[1] > a[1] ? p : a, [0, 0]);
  $('cycSum').innerHTML = T('We\'re in <b style="color:#39FF9E">cycle 25</b>, year {y} (month {m}). It peaked at <b>{p}</b> (smoothed) in {d} and is now on the way down — last month\'s sunspot number: <b>{n}</b> ({l}).',
    { y: Math.floor(nowM / 12) + 1, m: nowM, p: Math.round(pk[1]), d: mName(c25.s0 + pk[0]), n: Math.round(last.ssn), l: mName(mIdx(last['time-tag'])) });
  $('cycLeg').innerHTML = cycles.map(c => `<span><i style="background:${c.col}"></i>${c.n} · ${c.a.slice(0, 4)}–${c.b ? c.b.slice(0, 4) : T('NOW')}</span>`).join('');
}


/* ── NOAA's 27-day outlook (largest Kp per day) + the forecaster's 3-day notes (text products, same server) ── */
function drawO27() { const R = S.o27; if (!R || !R.length) return; $('o27').classList.remove('hidden');
  const svg = $('o27svg'), W = svg.clientWidth || 340, H = 70, L = 18, B = 14, Tp = 6, n = R.length, bw = (W - L - 4) / n;
  const y = k => H - B - k / 9 * (H - B - Tp), N = need(); let s = '';
  [0, 5, 9].forEach(k => { s += `<line x1="${L}" x2="${W - 4}" y1="${y(k)}" y2="${y(k)}" stroke="#232830"/><text x="0" y="${y(k) + 3}" fill="#6B7280" font-size="8" font-family="JetBrains Mono">${k}</text>`; });
  R.forEach((r, i) => { const x0 = L + i * bw, h = Math.max(1.5, H - B - y(r.k)), d = new Date(r.t);
    const lab = d.toLocaleDateString(LOC, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    s += `<rect x="${x0 + .75}" y="${H - B - h}" width="${Math.max(1, bw - 1.5)}" height="${h}" rx="1.5" fill="${kpColor(r.k)}" fill-opacity=".8"><title>${lab} · ${window.T('max Kp')} ${r.k} · Ap ${r.a} · F10.7 ${r.f}</title></rect>`;
    if (d.getUTCDay() === 1 || i === 0) s += `<text x="${x0 + 1}" y="${H - 3}" fill="#8B9BAE" font-size="8" font-family="JetBrains Mono">${d.toLocaleDateString(LOC, { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase()}</text>`; });
  s += `<line x1="${L}" x2="${W - 4}" y1="${y(N)}" y2="${y(N)}" stroke="#FF4444" stroke-dasharray="4 3" stroke-opacity=".6"/>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = s;
  const mx = R.reduce((a, r) => r.k > a.k ? r : a, R[0]);
  $('o27i').textContent = window.T('MAX KP {k}', { k: mx.k }) + ' · ' + new Date(mx.t).toLocaleDateString(LOC, { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase(); }
async function loadO27() { const r = await fetch(API + 'text/27-day-outlook.txt', { cache: 'no-store' }); if (!r.ok) return;
  const M = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }, out = [];
  (await r.text()).split('\n').forEach(l => { const m = l.match(/^(\d{4}) (\w{3}) (\d\d)\s+(\d+)\s+(\d+)\s+(\d+)/); if (m && m[2] in M) out.push({ t: Date.UTC(+m[1], M[m[2]], +m[3]), f: +m[4], a: +m[5], k: +m[6] }); });
  S.o27 = out.filter(o => o.t > Date.now() - 864e5); drawO27(); }
async function loadO3d() { const r = await fetch(API + 'text/3-day-forecast.txt', { cache: 'no-store' }); if (!r.ok) return;
  const t = await r.text(), one = s => s.replace(/\s+/g, ' ').trim(), rat = [...t.matchAll(/Rationale:\s*([\s\S]*?)(?:\n\s*\n|$)/g)].map(m => one(m[1]));
  const g = t.match(/greatest expected 3 hr Kp[^]*?is ([\d.]+)( \(NOAA Scale\s+(G\d)\))?/), s1 = t.match(/S1 or greater\s+([^\n]+)/), r12 = t.match(/R1-R2\s+([^\n]+)/), r3 = t.match(/R3 or greater\s+([^\n]+)/);
  const row = (k, c, head, txt) => `<p style="margin:6px 0 0"><b style="color:${c}">${k}</b> · ${esc(head)}${txt ? ' — ' + esc(txt) : ''}</p>`;
  $('o3dTxt').innerHTML = row('G', '#3FD98A', 'max Kp ' + (g ? g[1] + (g[3] ? ' (' + g[3] + ')' : '') : '?'), rat[0])
    + row('S', '#FFB347', 'S1+ ' + (s1 ? one(s1[1]) : '?'), rat[1]) + row('R', '#FFE600', 'R1–R2 ' + (r12 ? one(r12[1]) : '?') + ' · R3+ ' + (r3 ? one(r3[1]) : '?'), rat[2])
    + `<p style="margin:6px 0 0;opacity:.7">${esc(one((t.match(/:Issued:([^\n]+)/) || ['', ''])[1]))}</p>`;
  $('o3d').classList.remove('hidden'); }
const deepParts = () => [
    j(API + 'json/planetary_k_index_1m.json').then(a => { S.kpNow = +a[a.length - 1].estimated_kp; drawKpNow(S.kpNow); }),
    j(API + 'products/noaa-scales.json').then(sc => { const n = sc['0'];
      $('scG').textContent = 'G' + (n.G.Scale || 0); $('scS').textContent = 'S' + (n.S.Scale || 0); $('scR').textContent = 'R' + (n.R.Scale || 0);
      $('scG').style.color = +n.G.Scale ? kpColor(+n.G.Scale + 4) : '#6EE7A0'; $('scGt').textContent = n.G.Text && n.G.Text !== 'none' ? T(n.G.Text) : T('Geomagnetic'); }),
    j(API + 'products/alerts.json').then(al => { const since = NOWT() - 3 * 864e5, out = [];
      al.forEach(a => { const t = Date.parse(a.issue_datetime.replace(' ', 'T') + 'Z'); if (t < since || !/geomagnetic/i.test(a.message)) return;
        const m = a.message.match(/^(ALERT|WARNING|WATCH|EXTENDED WARNING|CANCEL WATCH|SUMMARY)[^\r\n]*/m); if (m) out.push({ t, line: m[0] }); });
      $('alerts').innerHTML = out.length ? out.slice(0, 5).map(a => `<div class="alert"><b>${esc(a.line)}</b><span>${new Date(a.t).toLocaleString(LOC, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }).toUpperCase()}</span></div>`).join('')
        : '<div class="loading">' + T('NO GEOMAGNETIC ALERTS') + '</div>'; })];
window.deepNow = full => Promise.allSettled([...deepParts(), full && loadWind(true).then(() => drawSw())]);
async function loadDeep(force) {
  loadO27().catch(() => {}); loadO3d().catch(() => {});
  await Promise.allSettled([...deepParts(),
    j(API + 'products/noaa-planetary-k-index-forecast.json').then(a => { S.kpList = a; drawKpChart(a); }),
    loadWind(force),
    goes('e', force).then(D => { const e2 = D.ser['>=2 MeV'] || [], mx = e2.reduce((a, p) => Math.max(a, p[1]), 0);
      $('scE').textContent = mx >= 1000 ? 'HIGH' : 'OK'; $('scE').style.color = mx >= 1000 ? '#FFA040' : '#6EE7A0'; }).catch(() => {}),
    loadCycles().catch(() => { $('cycSum').textContent = T('Could not load the sunspot data.'); }),
  ]);
  drawSw();
}
if (window.ResizeObserver) { const seen = new WeakMap(); const ro = new ResizeObserver(es => es.forEach(e => { const h = Math.round(e.contentRect.height), w = Math.round(e.contentRect.width), k = w + 'x' + h;
    if (seen.get(e.target) === k) return; seen.set(e.target, k);
    if (e.target.id === 'kpchart' && S.kpList) { drawKpChart(S.kpList); drawO27(); } if (e.target.id === 'swChart' && swTab !== 'g') drawSw(); if (e.target.id === 'srXChart' && S.gr) srXray(); })); ['kpchart', 'swChart'].forEach(id => ro.observe($(id)));
  const sx = () => { const c = $('srXChart'); if (c) ro.observe(c); else setTimeout(sx, 1500); }; sx(); }
addEventListener('resize', () => { if (S.kpList) drawKpChart(S.kpList); drawO27(); if (S.cyc) drawCycles(); if (S.wind) drawWind(); if (swTab !== 'g') drawSw(); });
window.redrawDeep = () => { if (S.kpNow != null) drawKpNow(S.kpNow); if (S.kpList) drawKpChart(S.kpList); };
loadDeep(); setInterval(loadDeep, 10 * 60000);
})();
