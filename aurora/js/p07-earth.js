/* ── 4 · Earth: Dst, cosmic rays, earthquakes, volcanoes and the daily journal (aurora/data/*.json by the hourly job) ── */
(function () {
'use strict';
const $ = id => document.getElementById(id), API = 'https://services.swpc.noaa.gov/';
const D = {}, j = async u => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return r.json(); };
const fmtD = t => new Date(t).toLocaleDateString(LOC, { day: 'numeric', month: 'short', timeZone: TZ }).toUpperCase();
const fmtDT = t => new Date(t).toLocaleString(LOC, { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ });
const txt = (x, y, s, col, sz, anc, w) => `<text x="${x}" y="${y}" fill="${col}" font-size="${sz}" text-anchor="${anc || 'start'}" font-weight="${w || 500}">${s}</text>`;
function frame(svg, H, from, to, L, R, T, B) {   // shared bits of a time chart: day ticks, now line, cursor map
  const W = svg.clientWidth || 340, x = t => L + (t - from) / (to - from) * (W - L - R); let s = '';
  const d = new Date(from); d.setHours(24, 0, 0, 0);
  for (; d.getTime() < to; d.setDate(d.getDate() + 1)) { const xx = x(d.getTime()); s += `<line x1="${xx}" x2="${xx}" y1="${T}" y2="${H - B}" stroke="#2C3542"/>` + txt(xx + 3, H - 5, fmtD(d.getTime()), '#8E9AAB', 9); }
  return { W, x, s, done: inner => { svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = s + inner; svg.dataset.tx = JSON.stringify([from, to, x(from), x(to), H]); window.tcursor && tcursor(); } };
}
// Dst: last 7 days
function drawDst() {
  const P = D.dst; if (!P || !P.length) return; const svg = $('dstChart'), H = Math.max(200, svg.clientHeight || 0), L = 36, R = 8, T = 10, B = 18;
  const from = P[0][0], to = Date.now(), lo = Math.min(-120, ...P.map(p => p[1])) * 1.08, hi = 40;
  const f = frame(svg, H, from, to, L, R, T, B), y = v => T + (hi - v) / (hi - lo) * (H - T - B); let s = '';
  [[0, '#3A4350', '0'], [-50, '#FFE14D', '−50 ' + T_('storm')], [-100, '#FF9338', '−100 ' + T_('strong')], [-250, '#FF4D4D', '−250 ' + T_('extreme')]].filter(l => l[0] > lo).forEach(([v, c, l]) => {
    s += `<line x1="${L}" x2="${f.W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${c}" stroke-opacity="${v ? .55 : 1}" stroke-dasharray="${v ? '4 3' : ''}"/>` + txt(L - 4, y(v) + 3, v, '#6B7788', 8.5, 'end') + (v ? txt(f.W - R - 4, y(v) - 3, l, c, 9, 'end', 700) : ''); });
  let d = ''; P.forEach((p, i) => { d += (i ? 'L' : 'M') + f.x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1); });
  s += `<path d="${d} L${f.x(P[P.length - 1][0])} ${y(0)} L${f.x(P[0][0])} ${y(0)} Z" fill="#FF6B6B" fill-opacity=".14"/><path d="${d}" fill="none" stroke="#FF8A8A" stroke-width="1.8"/>`;
  f.done(s);
  const mn = P.reduce((a, p) => p[1] < a[1] ? p : a), now = P[P.length - 1][1], lvl = v => v <= -250 ? T_('an extreme storm') : v <= -100 ? T_('a strong storm') : v <= -50 ? T_('a storm') : v <= -30 ? T_('unsettled') : T_('calm');
  $('dstSum').innerHTML = T_('Now <b>{v} nT</b> — {l}. Lowest this week <b>{m} nT</b> ({t}).', { v: now, l: lvl(now), m: mn[1], t: fmtDT(mn[0]) });
}
// cosmic rays: % against the 7-day mean
function drawCr() {
  const C = D.earth && D.earth.cosmic; if (!C || !C.pts || C.pts.length < 10) { $('secCr').style.display = 'none'; return; }
  $('secCr').style.display = ''; const P = C.pts, svg = $('crChart'), H = Math.max(200, svg.clientHeight || 0), L = 36, R = 8, T = 10, B = 18;
  const from = P[0][0], to = Math.max(Date.now(), P[P.length - 1][0]), lo = Math.min(-3, ...P.map(p => p[1])) * 1.1, hi = Math.max(3, ...P.map(p => p[1])) * 1.1;
  const f = frame(svg, H, from, to, L, R, T, B), y = v => T + (hi - v) / (hi - lo) * (H - T - B); let s = '';
  [-4, -2, 0, 2, 4].filter(v => v > lo && v < hi).forEach(v => { s += `<line x1="${L}" x2="${f.W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v ? '#1E2530' : '#3A4350'}"/>` + txt(L - 4, y(v) + 3, (v > 0 ? '+' : '') + v + '%', '#6B7788', 8.5, 'end'); });
  let d = ''; P.forEach((p, i) => { d += (i ? 'L' : 'M') + f.x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1); });
  s += `<path d="${d}" fill="none" stroke="#7FB8FF" stroke-width="1.6"/>`; f.done(s);
  const mn = P.reduce((a, p) => p[1] < a[1] ? p : a);
  $('crSum').innerHTML = T_('Station {s}. Lowest this week <b>{v}%</b> below normal ({t}).', { s: C.station, v: Math.abs(mn[1]).toFixed(1), t: fmtDT(mn[0]) }) + ' ' + (mn[1] <= -3 ? T_('A drop like that usually means a CME went past.') : T_('No clear Forbush decrease this week.'));
}
// quakes near the place (EMSC, ≈ 670 km): great-circle distance in km
const NEAR_DEG = 6, kmTo = (la, lo) => { const r = Math.PI / 180, a = Math.sin((la - TOWN.lat) * r / 2) ** 2 + Math.cos(la * r) * Math.cos(TOWN.lat * r) * Math.sin((lo - TOWN.lon) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(a)); };
const ttl = s => (s || '').toLowerCase().replace(/(^|[\s,/-])\S/g, c => c.toUpperCase());
// world map (equirectangular, Natural Earth land) with quakes and erupting volcanoes
function drawMap() {
  const cv = $('eqMap'), W = cv.clientWidth || 340, H = Math.round(W / 2), dpr = Math.max(2, devicePixelRatio || 1);
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px'; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#0B1220'; g.fillRect(0, 0, W, H);
  const X = lon => (lon + 180) / 360 * W, Y = lat => (90 - lat) / 180 * H;
  g.fillStyle = '#1F2A3A'; (window.LAND || []).forEach(r => { g.beginPath(); r.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.closePath(); g.fill(); });
  g.strokeStyle = 'rgba(255,255,255,.05)'; for (let la = -60; la <= 60; la += 30) { g.beginPath(); g.moveTo(0, Y(la)); g.lineTo(W, Y(la)); g.stroke(); }
  const AV = (D.earth && D.earth.active) || [], tri = (x, y, s) => { g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y + s * .8); g.lineTo(x - s, y + s * .8); g.closePath(); g.fill(); };
  ((D.earth && D.earth.ongoing) || []).forEach(v => { const x = X(v[2]), y = Y(v[1]), s = AV.length ? 3.5 : 4.5; g.fillStyle = AV.length ? 'rgba(255,77,77,.4)' : '#FF4D4D'; g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y + s * .8); g.lineTo(x - s, y + s * .8); g.closePath(); g.fill(); });
  AV.forEach(v => { g.fillStyle = '#FF4D4D'; tri(X(v[3]), Y(v[2]), 5.5); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke(); });   // active now: ash advisories / US alerts
  (D.eq || []).slice().sort((a, b) => a.m - b.m).forEach(q => { const r = Math.max(2, (q.m - 4) * 3.2); g.fillStyle = q.m >= 6 ? 'rgba(255,147,56,.85)' : 'rgba(255,179,71,.55)'; g.beginPath(); g.arc(X(q.lon), Y(q.lat), r, 0, 7); g.fill();
    if (q.m >= 6) { g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke(); } });
  (D.near || []).forEach(q => { if (q.m >= 4.5) return; g.fillStyle = 'rgba(123,224,255,.75)'; g.beginPath(); g.arc(X(q.lon), Y(q.lat), 1.6, 0, 7); g.fill(); });   // the small ones around you
  g.fillStyle = '#FFE08A'; g.beginPath(); g.arc(X(TOWN.lon), Y(TOWN.lat), 3, 0, 7); g.fill();
}
// the week's quakes on the clock, Kp bars behind them
function drawEqTime() {
  const svg = $('eqTime'), H = 130, L = 36, R = 8, T = 10, B = 18, to = Date.now(), from = to - 7 * 864e5, f = frame(svg, H, from, to, L, R, T, B);
  const y = m => T + (8 - Math.min(8, m)) / (8 - 4.5) * (H - T - B); let s = '';
  ((typeof S !== 'undefined' && S.kpList) || []).forEach(p => { const t = Date.parse(p.time_tag + 'Z'); if (t < from || t > to) return; const k = +p.kp, x0 = f.x(t), w = f.x(t + 3 * 3600e3) - x0;
    s += `<rect x="${x0}" y="${H - B - k / 9 * (H - T - B)}" width="${Math.max(1, w - 1)}" height="${k / 9 * (H - T - B)}" fill="${kpColor(k)}" fill-opacity=".18"/>`; });
  [5, 6, 7].forEach(m => { s += `<line x1="${L}" x2="${f.W - R}" y1="${y(m)}" y2="${y(m)}" stroke="#1E2530"/>` + txt(L - 4, y(m) + 3, 'M' + m, '#6B7788', 8.5, 'end'); });
  (D.eq || []).forEach(q => { if (q.t >= from) s += `<circle cx="${f.x(q.t).toFixed(1)}" cy="${y(q.m).toFixed(1)}" r="${Math.max(2, (q.m - 4) * 2.2)}" fill="${q.m >= 6 ? '#FF9338' : '#FFB347'}" fill-opacity=".8"/>`; });
  s += txt(f.W - R - 4, T + 9, T_('dots = earthquakes · coloured bars = Kp'), '#8E9AAB', 9, 'end'); f.done(s);
}
function drawEq() {
  const Q = D.eq || []; if (!Q.length) return; drawMap(); drawEqTime();
  const n6 = Q.filter(q => q.m >= 6).length, top = Q.slice().sort((a, b) => b.m - a.m).slice(0, 6);
  $('eqSum').innerHTML = T_('<b>{n}</b> earthquakes of magnitude 4.5 or more in the last 7 days, <b>{b}</b> of them 6+. A normal week has about 100–150 and two or three 6+.', { n: Q.length, b: n6 });
  $('eqList').innerHTML = top.map(q => `<div class="eqr"><b style="color:${q.m >= 6 ? '#FF9338' : '#FFB347'}">M${q.m.toFixed(1)}</b><div>${esc(q.place || '')}</div><span>${fmtDT(q.t)}</span></div>`).join('');
  drawNear();
}
function drawNear() {   // EMSC: every quake ≥ M2.5 within ≈ 670 km of the place, newest first
  const N = D.near, box = $('eqNear'); if (!N) { box.innerHTML = ''; return; }
  const nm = esc(TOWN.name), big = N.reduce((a, q) => !a || q.m > a.m ? q : a, null);
  let s = `<div class="lbl">${T_('Near {p} · M2.5+ within {k} km · EMSC', { p: nm, k: Math.round(NEAR_DEG * 111.2) })}</div>`;
  s += N.length ? N.slice().sort((a, b) => b.t - a.t).slice(0, 8).map(q => `<div class="eqr"><b${q.m >= 4.5 ? ' style="color:#FFB347"' : ''}>M${q.m.toFixed(1)}</b><div>${esc(ttl(q.place))} · ${T_('{k} km away', { k: q.km })}</div><span>${fmtDT(q.t)}</span></div>`).join('')
    : `<div class="eqr"><div>${T_('No earthquakes of M2.5 or more near {p} in the last 7 days.', { p: nm })}</div></div>`;
  box.innerHTML = s;
  if (big) $('eqSum').innerHTML += ' ' + T_('Near {p}: <b>{n}</b> of M2.5 or more, the strongest <b>M{m}</b> ({k} km away).', { p: nm, n: N.length, m: big.m.toFixed(1), k: big.km });
}
function drawVo() {
  const V = (D.earth && D.earth.ongoing) || [], A = (D.earth && D.earth.active) || []; if (!V.length && !A.length) { $('voSum').textContent = T_('Volcano data not available right now.'); return; }
  const wk = A.filter(a => Date.now() - Date.parse(a[4]) < 7 * 864e5);
  $('voSum').innerHTML = T_('<b>{n}</b> eruptions going on, according to the Smithsonian database (last update {d}).', { n: V.length, d: D.earth.gvpAsOf ? new Date(D.earth.gvpAsOf + 'T00:00:00Z').toLocaleDateString(LOC, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '–' });
  if (A.length) $('voSum').innerHTML = T_('<b>{n}</b> volcanoes active in the last 7 days — ash advisories for aircraft (VAAC Tokyo, Washington) and US alert levels (USGS), checked every hour.', { n: wk.length }) + ' ' + $('voSum').innerHTML;
  const src = a => a[6] ? 'USGS · ' + esc(a[6]) : T_('ash advisory') + ' · ' + esc(a[5]);
  $('voList').innerHTML = (A.length ? `<div class="lbl" style="margin:4px 0 6px">${T_('Active now')}</div>` + A.map(a => `<div class="vor"><b>▲</b><div>${esc(a[0])} <span>${esc(a[1])} · ${src(a)}</span></div><span>${fmtDT(Date.parse(a[4]))}</span></div>`).join('')
    + `<div class="lbl" style="margin:14px 0 6px">${T_('Ongoing eruptions · Smithsonian database')}</div>` : '') + V.map(v => `<div class="vor"><b>▲</b><div>${esc(v[0])}${v[4] != null ? ' <span>VEI ' + v[4] + '</span>' : ''}</div><span>${T_('since {d}', { d: new Date(v[3] + 'T00:00:00Z').toLocaleDateString(LOC, { month: 'short', year: 'numeric', timeZone: 'UTC' }) })}</span></div>`).join('');
}
// the journal: panels over the chosen range (daily, weekly or monthly bins) + the storm-day test
let lgDays = 365;
document.querySelectorAll('[data-lr]').forEach(c => c.onclick = () => { lgDays = +c.dataset.lr; document.querySelectorAll('[data-lr]').forEach(o => o.classList.toggle('on', o === c)); drawLong(); });
function drawLong() {
  const J = D.journal; if (!J) return; const n = J.kp.length, d0 = Date.parse(J.from + 'T00:00:00Z'), a = lgDays ? Math.max(0, n - lgDays) : 0, days = n - a;
  const bin = days > 2000 ? 30 : days > 400 ? 7 : 1, nb = Math.ceil(days / bin), avg = (arr, i0) => { let s = 0, c = 0; for (let i = i0; i < Math.min(n, i0 + bin); i++) if (arr[i] != null) { s += arr[i]; c++; } return c ? s / c : null; };
  const mx = (arr, i0) => { let m = null; for (let i = i0; i < Math.min(n, i0 + bin); i++) if (arr[i] != null) m = m == null ? arr[i] : Math.max(m, arr[i]); return m; };
  const mn = (arr, i0) => { let m = null; for (let i = i0; i < Math.min(n, i0 + bin); i++) if (arr[i] != null) m = m == null ? arr[i] : Math.min(m, arr[i]); return m; };
  const B = Array.from({ length: nb }, (_, k) => { const i0 = a + k * bin; return { t: d0 + i0 * 864e5, kp: mx(J.kp, i0), kpa: avg(J.kp, i0), ssn: avg(J.ssn, i0), q5: avg(J.q5, i0), dst: mn(J.dst, i0) }; });
  // eruption starts per month (only for ranges of a year or more)
  const EM = D.earth && D.earth.eruptMonthly, eru = EM && days >= 365 ? (() => { const [y0, m0] = EM.from.split('-').map(Number), out = [];
    EM.n.forEach((c, i) => { const t = Date.UTC(y0, m0 - 1 + i, 1); if (t >= d0 + a * 864e5) out.push([t, c]); }); return out; })() : null;
  const hasDst = B.some(b => b.dst != null), panels = [['kp', T_('Strongest Kp'), 9], ['ssn', T_('Sunspots'), null], ['q5', T_('M5+ earthquakes per day'), null]].concat(eru ? [['eru', T_('Eruptions started per month'), null]] : []).concat(hasDst ? [['dst', 'Dst (nT)', null]] : []);
  const svg = $('lgChart'), W = svg.clientWidth || 340, L = 40, R = 8, ph = 74, gap = 24, top = 16, H = top + panels.length * (ph + gap) - gap + 20, from = B[0].t, to = d0 + n * 864e5;
  const x = t => L + (t - from) / (to - from) * (W - L - R), bw = Math.max(1, (W - L - R) / nb - (bin > 1 ? .6 : .2)); let s = '';
  panels.forEach(([k, name], pi) => {
    const y0 = top + pi * (ph + gap); s += `<rect x="${L}" y="${y0}" width="${W - L - R}" height="${ph}" rx="6" fill="#0F1318"/>` + txt(L, y0 - 5, name, '#C9D1DB', 10.5, 'start', 700);
    if (k === 'eru') { const asOf = D.earth.gvpAsOf ? Date.parse(D.earth.gvpAsOf + 'T00:00:00Z') : to, m = Math.max(4, ...eru.filter(e => e[0] < asOf).map(e => e[1]));
      eru.forEach(([t, c]) => { if (t >= asOf) return; const wd = x(t + 30 * 864e5) - x(t), gp = Math.min(3, wd * .25), h = c / m * (ph - 4); s += `<rect x="${(x(t) + gp / 2).toFixed(1)}" y="${y0 + ph - h}" width="${Math.max(1, wd - gp).toFixed(1)}" height="${h}" rx="1.5" fill="#FF6B6B" fill-opacity=".75"/>`; });
      // after the Smithsonian database's last update there is no data (not "no eruptions"): hatched + labelled
      if (asOf < to) { const xa = Math.max(L, x(asOf)); s += `<defs><pattern id="nodata" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#3A4350" stroke-width="2"/></pattern></defs><rect x="${xa}" y="${y0}" width="${W - R - xa}" height="${ph}" fill="url(#nodata)" fill-opacity=".6"/>`
        + txt(Math.min(xa + 6, W - R - 150), y0 + ph / 2 + 4, T_('no update since {d}', { d: new Date(asOf).toLocaleDateString(LOC, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) }), '#A3B0C2', 10); }
      s += txt(L - 4, y0 + 9, m, '#6B7788', 8.5, 'end'); return; }
    const vals = B.map(b => b[k]).filter(v => v != null); if (!vals.length) { s += txt(L + 8, y0 + ph / 2 + 4, T_('collected from October 2026 on'), '#6B7788', 10); return; }
    if (k === 'dst') { const lo = Math.min(-100, ...vals); B.forEach(b => { if (b.dst == null) return; const h = b.dst / lo * (ph - 4); s += `<rect x="${x(b.t)}" y="${y0}" width="${bw}" height="${h}" fill="#FF8A8A" fill-opacity=".7"/>`; }); s += txt(L - 4, y0 + ph, Math.round(lo), '#6B7788', 8.5, 'end'); if (vals.length < 60) s += txt(L + 8, y0 + ph / 2 + 4, T_('collected from October 2026 on'), '#6B7788', 10); return; }
    const m = k === 'kp' ? 9 : Math.max(1, ...vals) * 1.1, yv = v => y0 + ph - v / m * (ph - 4);
    s += txt(L - 4, y0 + 9, Math.round(m), '#6B7788', 8.5, 'end') + txt(L - 4, y0 + ph, 0, '#6B7788', 8.5, 'end');
    if (k === 'ssn') { let d = ''; B.forEach((b, i) => { if (b.ssn != null) d += (d ? 'L' : 'M') + (x(b.t) + bw / 2).toFixed(1) + ' ' + yv(b.ssn).toFixed(1); }); s += `<path d="${d}" fill="none" stroke="#FFD24D" stroke-width="1.6"/>`; }
    else B.forEach(b => { const v = b[k]; if (v == null) return; s += `<rect x="${x(b.t).toFixed(1)}" y="${yv(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y0 + ph - yv(v)).toFixed(1)}" fill="${k === 'kp' ? kpColor(v) : '#FFB347'}" fill-opacity="${k === 'kp' ? .85 : .7}"/>`; });
  });
  const yb = top + panels.length * (ph + gap) - gap, yr = new Date(from).getUTCFullYear();
  if (days > 400) for (let Y = yr + 1; Date.UTC(Y, 0, 1) < to; Y++) { const xx = x(Date.UTC(Y, 0, 1)); s += `<line x1="${xx}" x2="${xx}" y1="${top}" y2="${yb}" stroke="#2C3542"/>` + txt(xx + 3, yb + 13, Y, '#8E9AAB', 9); }
  else { const d = new Date(from); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); for (; d.getTime() < to; d.setUTCMonth(d.getUTCMonth() + 1)) { const xx = x(d.getTime()); s += `<line x1="${xx}" x2="${xx}" y1="${top}" y2="${yb}" stroke="#2C3542"/>` + txt(xx + 3, yb + 13, d.toLocaleDateString(LOC, { month: 'short', timeZone: 'UTC' }).toUpperCase(), '#8E9AAB', 9); } }
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = s; svg.dataset.tx = JSON.stringify([from, to, x(from), x(to), H]); window.tcursor && tcursor();
  // the honest test: quakes on storm days vs quiet days, and sunspots vs quakes month by month
  let sq = 0, sn = 0, qq = 0, qn = 0; for (let i = a; i < n; i++) { const k = J.kp[i], q = J.q5[i]; if (k == null || q == null) continue; if (k >= 5) { sq += q; sn++; } else if (k < 4) { qq += q; qn++; } }
  const ms = [], mq = []; for (let i = a; i < n; i += 30) { const s1 = avg(J.ssn, i), q1 = avg(J.q5, i); if (s1 != null && q1 != null) { ms.push(s1); mq.push(q1); } }
  const r = (() => { if (ms.length < 6) return null; const mx_ = ms.reduce((p, c) => p + c, 0) / ms.length, my = mq.reduce((p, c) => p + c, 0) / mq.length; let num = 0, dx = 0, dy = 0; ms.forEach((v, i) => { num += (v - mx_) * (mq[i] - my); dx += (v - mx_) ** 2; dy += (mq[i] - my) ** 2; }); return num / Math.sqrt(dx * dy); })();
  const st = sn ? sq / sn : null, qu = qn ? qq / qn : null, diff = st != null && qu ? (st - qu) / qu : null;
  $('lgCorr').innerHTML = `<div>${st != null && qu != null ? T_('Storm days (Kp 5+): <b>{a}</b> M5+ earthquakes a day ({n} days). Quiet days (Kp under 4): <b>{b}</b> a day ({m} days).', { a: st.toFixed(2), n: sn, b: qu.toFixed(2), m: qn }) + ' ' + (Math.abs(diff) < .15 ? T_('<b>No clear difference.</b>') : diff > 0 ? T_('Storm days have a bit more — with this few days that can easily be chance.') : T_('Storm days have a bit fewer — with this few days that can easily be chance.')) : T_('Not enough storm days in this range for the test.')}</div>`
    + `<div>${r != null ? T_('Sunspots vs earthquakes, month by month: correlation <b>r = {r}</b>.', { r: r.toFixed(2) }) + ' ' + (Math.abs(r) < .2 ? T_('Close to 0 means no link.') : Math.abs(r) < .4 ? T_('A weak link — it may be chance.') : T_('A noticeable link in this range — worth a closer look, but it is not proof.')) : T_('Choose a longer range for the month-by-month test.')}</div>`;
}
const T_ = (s, o) => window.T(s, o);
// the field at the nearest live INTERMAGNET observatory (BGS GIN, CORS *): horizontal component H over 3 days, minus its median
const MAGS = [['PAG', 'Panagyurishte, Bulgaria', 42.51, 24.18], ['THY', 'Tihany, Hungary', 46.90, 17.89], ['BEL', 'Belsk, Poland', 51.84, 20.79], ['FUR', 'Fürstenfeldbruck, Germany', 48.17, 11.28],
  ['WNG', 'Wingst, Germany', 53.74, 9.07], ['LER', 'Lerwick, Shetland', 60.13, -1.18], ['ABK', 'Abisko, Sweden', 68.36, 18.82], ['SOD', 'Sodankylä, Finland', 67.37, 26.63],
  ['BOU', 'Boulder, USA', 40.14, -105.24], ['FRD', 'Fredericksburg, USA', 38.20, -77.37], ['CMO', 'College, Alaska', 64.87, -147.86], ['KAK', 'Kakioka, Japan', 36.23, 140.19],
  ['CNB', 'Canberra, Australia', -35.32, 149.36], ['HER', 'Hermanus, South Africa', -34.43, 19.23], ['EYR', 'Eyrewell, New Zealand', -43.42, 172.35]];
async function loadMag() {
  if (window.STORM) { $('secMag').style.display = 'none'; return; }   // storm mode: no archive for this one
  const d0 = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), near = MAGS.slice().sort((a, b) => kmTo(a[2], a[3]) - kmTo(b[2], b[3]));
  for (const [code, name, la, lo] of near.slice(0, 3)) {
    try { const r = await j(`https://imag-data.bgs.ac.uk/GIN_V1/GINServices?Request=GetData&observatoryIagaCode=${code}&samplesPerDay=minute&dataStartDate=${d0}&dataDuration=3&publicationState=best-avail&Format=json`);
      const ok = v => v != null && Math.abs(v) < 88000, pts = [];
      r.datetime.forEach((t, i) => { const h = r.H ? r.H[i] : ok(r.X && r.X[i]) && ok(r.Y && r.Y[i]) ? Math.hypot(r.X[i], r.Y[i]) : null; if (ok(h)) pts.push([Date.parse(t), h]); });
      if (pts.length < 300 || Date.now() - pts[pts.length - 1][0] > 3 * 3.6e6) continue;   // no fresh data from this one: try the next
      const md = pts.map(p => p[1]).sort((a, b) => a - b)[pts.length >> 1], P = [];
      for (let i = 0; i < pts.length; i += 5) P.push([pts[i][0], +(pts[i][1] - md).toFixed(1)]);   // 5-minute steps are enough for the chart
      D.mag = { code, name, km: Math.round(kmTo(la, lo)), P, last: pts.slice(-180) }; drawMag(); return;
    } catch (e) { /* try the next observatory */ }
  }
  $('secMag').style.display = 'none';
}
function drawMag() {
  const M = D.mag; if (!M) return; $('secMag').style.display = ''; const P = M.P, svg = $('magChart'), H = Math.max(200, svg.clientHeight || 0), L = 36, R = 8, T = 10, B = 18;
  const from = P[0][0], to = Math.max(Date.now(), P[P.length - 1][0]), ext = Math.max(60, ...P.map(p => Math.abs(p[1]))) * 1.1;
  const f = frame(svg, H, from, to, L, R, T, B), y = v => T + (ext - v) / (2 * ext) * (H - T - B); let s = '';
  [-100, -50, 0, 50, 100].filter(v => Math.abs(v) < ext).forEach(v => { s += `<line x1="${L}" x2="${f.W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v ? '#1E2530' : '#3A4350'}"/>` + txt(L - 4, y(v) + 3, (v > 0 ? '+' : '') + v, '#6B7788', 8.5, 'end'); });
  let d = ''; P.forEach((p, i) => { d += (i ? 'L' : 'M') + f.x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1); });
  s += `<path d="${d}" fill="none" stroke="#C9A7FF" stroke-width="1.5"/>`; f.done(s);
  const v = M.last.map(p => p[1]), rg = Math.round(Math.max(...v) - Math.min(...v)), lv = rg >= 100 ? T_('storm-level shaking') : rg >= 50 ? T_('active') : rg >= 20 ? T_('a little unsettled') : T_('calm');
  $('magSum').innerHTML = T_('{s} ({k} km away). Swing in the last 3 hours <b>{r} nT</b> — {l}.', { s: esc(M.name), k: M.km, r: rg, l: lv });
}
async function loadEarth() {
  loadMag().catch(() => {});
  await Promise.allSettled([
    j(API + 'products/kyoto-dst.json').then(a => { D.dst = a.map(r => [Date.parse(r.time_tag + 'Z'), +r.dst]).filter(p => isFinite(p[1])); drawDst(); }),
    j('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson').then(g => { D.eq = g.features.map(f => ({ t: f.properties.time, m: f.properties.mag, place: f.properties.place, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })); }),
    j(`https://www.seismicportal.eu/fdsnws/event/1/query?format=json&lat=${TOWN.lat}&lon=${TOWN.lon}&maxradius=${NEAR_DEG}&minmag=2.5&starttime=${new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19)}&endtime=${new Date().toISOString().slice(0, 19)}&limit=300`)
      .then(g => { D.near = g.features.map(f => { const q = f.properties; return { t: Date.parse(q.time), m: q.mag, place: q.flynn_region, lat: q.lat, lon: q.lon, km: Math.round(kmTo(q.lat, q.lon)) }; }).filter(q => q.m != null); }).catch(() => { D.near = null; }),
    j('data/earth.json?t=' + Math.floor(Date.now() / 600000)).then(e => { D.earth = e; }),
    j('data/journal.json?t=' + Math.floor(Date.now() / 3600000)).then(J => { D.journal = J; }),
  ]);
  drawCr(); drawEq(); drawVo(); drawLong();
}
const redraw = () => { drawDst(); drawCr(); drawMag(); if (D.eq) { drawMap(); drawEqTime(); } drawLong(); };
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(redraw, 150); });
if (window.ResizeObserver) { const seen = new WeakMap(); const ro = new ResizeObserver(es => es.forEach(e => { const k = Math.round(e.contentRect.width) + 'x' + Math.round(e.contentRect.height); if (seen.get(e.target) === k) return; seen.set(e.target, k); e.target.id === 'dstChart' ? drawDst() : e.target.id === 'magChart' ? drawMag() : drawCr(); })); ro.observe($('dstChart')); ro.observe($('magChart')); }
loadEarth(); setInterval(loadEarth, 15 * 60000);
window.earthReport = () => ({ dst: $('dstChart'), cr: $('secCr').style.display === 'none' ? null : $('crChart'), map: $('eqMap'), eqt: $('eqTime'), lg: $('lgChart'), sums: ['dstSum', 'crSum', 'eqSum', 'voSum'].map(id => $(id).textContent), corr: [...$('lgCorr').children].map(d => d.textContent), vo: (D.earth && D.earth.ongoing) || [] });
})();
