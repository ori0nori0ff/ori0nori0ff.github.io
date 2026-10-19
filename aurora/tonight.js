/* PowHau · tonight hour by hour — shared by noaa/aurora.html (app) and web/aurora (public page).
   For each hour of the coming night: darkness (Sun altitude), cloud cover (Open-Meteo), the Kp forecast against the Kp
   needed at the place, and the Moon (up? how bright?) → a 0–1 viewing score, the best window and a plain sentence.
   Sun / Moon positions: low-precision formulas (as in SunCalc, Meeus) — minutes-level accuracy, plenty for this. */
(function () {
  'use strict';
  const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
  const toDays = t => t / dayMs - 0.5 + J1970 - J2000;
  const ra = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const altOf = (H, phi, d) => Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H));
  const sidereal = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
  function sunC(d) { const M = rad * (357.5291 + 0.98560028 * d), C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)), L = M + C + rad * 102.9372 + Math.PI; return { dec: dec(L, 0), ra: ra(L, 0) }; }
  function moonC(d) { const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.229350 * d);
    const l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F); return { ra: ra(l, b), dec: dec(l, b), dist: 385001 - 20905 * Math.cos(M) }; }
  const sunAlt = (t, lat, lon) => { const d = toDays(t), c = sunC(d); return altOf(sidereal(d, rad * -lon) - c.ra, rad * lat, c.dec) / rad; };
  const moonAlt = (t, lat, lon) => { const d = toDays(t), c = moonC(d); return altOf(sidereal(d, rad * -lon) - c.ra, rad * lat, c.dec) / rad; };
  // star altitude (RA hours, Dec degrees) at time t — for the constellations drawn in tonight's sky
  const starAlt = (t, lat, lon, raH, decD) => altOf(sidereal(toDays(t), rad * -lon) - raH * 15 * rad, rad * lat, decD * rad) / rad;
  // [name, highlight, stars [RA h, Dec °], lines [i, j]] — Orion is the highlighted one
  const CONS = [
    ['Orion', 1, [[5.919, 7.41], [5.418, 6.35], [5.585, 9.93], [5.533, -.30], [5.603, -1.20], [5.679, -1.94], [5.242, -8.20], [5.796, -9.67]], [[0, 2], [2, 1], [0, 1], [1, 3], [3, 4], [4, 5], [0, 5], [3, 6], [5, 7], [6, 7]]],
    ['Big Dipper', 0, [[11.062, 61.75], [11.031, 56.38], [11.897, 53.69], [12.257, 57.03], [12.900, 55.96], [13.399, 54.93], [13.792, 49.31]], [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]]],
    ['Cassiopeia', 0, [[0.153, 59.15], [0.675, 56.54], [0.945, 60.72], [1.430, 60.24], [1.906, 63.67]], [[0, 1], [1, 2], [2, 3], [3, 4]]],
    ['Pleiades', 0, [[3.791, 24.11], [3.747, 24.11], [3.763, 24.37], [3.819, 24.05], [3.772, 23.95], [3.749, 24.47]], []]];
  function moonIll(t) { const d = toDays(t), s = sunC(d), m = moonC(d), sd = 149598000;
    const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    return (1 + Math.cos(Math.atan2(sd * Math.sin(phi), m.dist - sd * Math.cos(phi)))) / 2; }

  /**
   * plan({lat, lon, need, kpList (NOAA Kp forecast rows), wx (Open-Meteo response with hourly.cloud_cover)})
   * → { hours: [{t, sun, cloud, kp, moonUp, ill, score}], best: {from, to, score, hour} | null }
   * Hours: from now (or 17:00 if it's still day) for 15 hours.
   */
  function plan(o) {
    const now = Date.now(), H = 3600e3, hours = [];
    let t0 = Math.floor(now / H) * H;
    for (let k = 0; k < 14 && sunAlt(t0, o.lat, o.lon) > -3; k++) t0 += H;   // still daytime → start at dusk
    const wxAt = (t, key) => { const w = o.wx; if (!w || !w.hourly || !w.hourly[key]) return null; const off = (w.utc_offset_seconds || 0) * 1000;
      let best = null, bd = 1e12; w.hourly.time.forEach((s, i) => { const d = Math.abs(Date.parse(s + 'Z') - off - t); if (d < bd) { bd = d; best = w.hourly[key][i]; } });
      return bd <= 1.5 * H ? best : null; };
    const cloudAt = t => wxAt(t, 'cloud_cover');
    const kpAt = t => { let k = null; (o.kpList || []).forEach(p => { const s = Date.parse(p.time_tag + 'Z'); if (t >= s && t < s + 3 * H) k = +p.kp; }); return k; };
    for (let i = 0; i < 15; i++) {
      const t = t0 + i * H, sun = sunAlt(t, o.lat, o.lon);
      if (i > 2 && sun > -3) break;   // dawn: the night is over
      const ma = moonAlt(t, o.lat, o.lon), ill = moonIll(t), cloud = cloudAt(t), kp = kpAt(t);
      const dark = sun < -15 ? 1 : sun < -10 ? .6 : sun < -6 ? .25 : 0, N = o.need;
      const kf = kp == null ? 0 : kp >= N + 1 ? 1 : kp >= N ? .75 : kp >= N - 1 ? .35 : kp >= N - 2 ? .1 : .02;
      const clear = cloud == null ? .6 : 1 - cloud / 100, moon = ma > 0 ? 1 - .45 * ill : 1;
      hours.push({ t, sun, cloud, cl: wxAt(t, 'cloud_cover_low'), cm: wxAt(t, 'cloud_cover_mid'), ch: wxAt(t, 'cloud_cover_high'), kp, ma, moonUp: ma > 0, ill, score: dark * kf * clear * moon });
    }
    const top = hours.reduce((a, h) => h.score > a.score ? h : a, hours[0]);
    let best = null;
    if (top && top.score > .005) { let a = hours.indexOf(top), b = a; while (a > 0 && hours[a - 1].score >= top.score * .7) a--; while (b < hours.length - 1 && hours[b + 1].score >= top.score * .7) b++;
      best = { from: hours[a].t, to: hours[b].t + H, score: top.score, hour: top }; }
    return { hours, best, lat: o.lat, lon: o.lon };
  }

  // translation hook: the public page defines window.T (EN / RO / DE); the app page doesn't → English
  const tr = (t, o) => window.T ? window.T(t, o) : String(t).replace(/\{(\w+)\}/g, (m, k) => o && o[k] != null ? o[k] : m);

  /** One plain sentence about tonight. fmt = hour formatter. */
  function sentence(p, need, fmt) {
    const darkH = p.hours.filter(h => h.sun < -12), maxKp = Math.max(0, ...p.hours.map(h => h.kp || 0));
    if (!darkH.length) return tr('It does not get properly dark in the coming hours.');
    const avgCloud = darkH.filter(h => h.cloud != null).reduce((a, h, i, A) => a + h.cloud / A.length, 0);
    const moonUp = darkH.filter(h => h.moonUp).length / darkH.length, ill = darkH[0].ill;
    const moonTxt = moonUp > .5 && ill > .5 ? tr('a bright Moon ({p}%) is up', { p: Math.round(ill * 100) }) : moonUp > .5 ? tr('the Moon is up but thin') : tr('the Moon is down');
    if (!p.best || p.best.score < .1) {   // below .1 the aurora is too weak or the sky too bad to name a window
      const why = maxKp < need - 1 ? tr('the aurora forecast is too weak here (Kp {k}, need {n})', { k: maxKp.toFixed(1), n: need }) : avgCloud > 70 ? tr('clouds (~{c}%) cover the sky', { c: Math.round(avgCloud) }) : tr('nothing lines up');
      return tr('No good window tonight — {why}; {moon}.', { why, moon: moonTxt });
    }
    const h = p.best.hour;
    return tr('Best window {a}–{b}: Kp {k}', { a: fmt(p.best.from), b: fmt(p.best.to), k: h.kp == null ? '–' : h.kp.toFixed(1) }) +
      (h.cloud == null ? '' : tr(', clouds {c}%', { c: Math.round(h.cloud) })) + ', ' + (h.moonUp ? (h.ill > .5 ? tr('bright Moon up') : tr('thin Moon up')) : tr('Moon down')) + '.';
  }

  /**
   * Draw tonight into el: one line saying the answer, four conditions in a row (green = fine, red = the problem),
   * then one picture of the night above the mountains on a shared time axis — the sky darkens with the Sun, clouds
   * drift over, the Moon on its arc, a thin Kp line per hour inside a green aurora glow against the red line of the
   * Kp needed here; cloud % and the chance ribbon under the horizon. The best window is a lit dashed band.
   * fmt = hour formatter, need = Kp needed here, cur = time to mark (optional). Fonts inherit from the page.
   */
  function render(el, p, fmt, kpColor, need, cur, o) {
    o = o || {};
    const hs = p.hours, H = 3600e3; if (!hs.length) { el.innerHTML = ''; return; }
    const darkH = hs.filter(h => h.sun < -12), dk = darkH.length > 0;
    const cl = (dk ? darkH : hs).filter(h => h.cloud != null), avgC = cl.length ? Math.round(cl.reduce((a, h) => a + h.cloud, 0) / cl.length) : null;
    const maxKp = Math.max(0, ...hs.map(h => h.kp || 0)), mh = dk ? darkH : hs, moonUp = mh.filter(h => h.moonUp).length > mh.length / 2, ill = Math.round(hs[0].ill * 100);
    const good = p.best && p.best.score >= .1;
    const C = [   // name, ok, value, note, what's missing
      [tr('Dark'), dk, dk ? tr('from {t}', { t: fmt(darkH[0].t) }) : '–', dk ? tr('astronomical night') : tr('not dark enough'), tr('darkness')],
      [tr('Clouds'), avgC != null && avgC < 50, avgC == null ? '–' : avgC + '%', avgC == null ? tr('no cloud data') : avgC >= 85 ? tr('covered') : avgC >= 50 ? tr('mostly covered') : avgC >= 20 ? tr('some gaps') : tr('clear'), tr('a clear sky')],
      [tr('Aurora (Kp)'), maxKp >= need, maxKp.toFixed(1), tr('needs {n} here', { n: need }), tr('a stronger aurora')],
      [tr('Moon'), !moonUp || ill < 50, moonUp ? ill + '%' : tr('down'), moonUp ? (ill >= 50 ? tr('brightens the sky') : tr('thin, little light')) : tr('dark sky'), tr('a darker sky (the Moon)')],
    ];
    const OK = '#39FF9E', BAD = '#FF6B6B', WEAK = '#E8A15A';   // tiles: green = fine, amber = the weak point (no red text)
    const head = good ? `<div style="font-weight:700;font-size:15px;color:#F1F4F8;margin:2px 0 10px">${tr('Best time tonight: {a}–{b}', { a: `<span style="color:${OK}">${fmt(p.best.from)}`, b: `${fmt(p.best.to)}</span>` })}</div>`
      : `<div style="font-weight:600;font-size:15px;color:#F1F4F8;margin:2px 0 10px">${tr('No aurora tonight')} <span style="color:#8E9AAB;font-weight:400">· ${tr('missing')}: ${C.filter(c => !c[1]).map(c => c[4]).join(', ') || tr('better timing')}</span></div>`;
    // condition tiles: a small drawn scene from tonight's own hours (sky darkening, clouds, the aurora vs the line
    // needed here — rays in each hour's Kp colour, gently moving — and the Moon on its arc), then label, value, note
    const SW = 200, SH = 92, sid = 'tc' + Math.random().toString(36).slice(2, 7), sn = hs.length, sX = i => (i + .5) / sn * SW;
    const skyS = s => s > -6 ? '#3A4E78' : s > -12 ? '#22304F' : s > -18 ? '#141C33' : '#0A0F1E';
    const ridge = `<path d="M0 ${SH} L0 ${SH - 9} L20 ${SH - 14} L42 ${SH - 8} L66 ${SH - 16} L90 ${SH - 9} L118 ${SH - 15} L146 ${SH - 8} L170 ${SH - 13} L200 ${SH - 9} L200 ${SH} Z" fill="#06080C"/>`;
    let sr = 5; const srnd = () => (sr = (sr * 9301 + 49297) % 233280) / 233280;
    const sStars = op => { let s = ''; for (let k = 0; k < 44; k++) { const x = srnd() * SW, y = srnd() * (SH - 22), h = hs[Math.min(sn - 1, Math.floor(x / SW * sn))], a = srnd(), b = srnd();
      if (h.sun < -12 && a > op(h)) s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(.4 + b * .7).toFixed(2)}" fill="#fff" fill-opacity="${(.35 + b * .6).toFixed(2)}"/>`; } return s; };
    const skyGrad = `<linearGradient id="${sid}k" x1="0" x2="1">` + hs.map((h, i) => `<stop offset="${((i + .5) / sn).toFixed(3)}" stop-color="${skyS(h.sun)}"/>`).join('') + `</linearGradient>`;
    const frame = inner => `<svg viewBox="0 0 ${SW} ${SH}" width="100%" style="display:block;border-radius:9px" aria-hidden="true"><defs>${skyGrad}`
      + `<linearGradient id="${sid}a" x1="0" x2="0" y1="1" y2="0"><stop offset="0" stop-color="#39FF9E" stop-opacity=".85"/><stop offset=".65" stop-color="#39FF9E" stop-opacity=".16"/><stop offset="1" stop-color="#C77DFF" stop-opacity=".18"/></linearGradient>`
      + `<filter id="${sid}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></defs><rect width="${SW}" height="${SH}" fill="url(#${sid}k)"/>${inner}${ridge}</svg>`;
    const scKY = k => SH - 14 - Math.min(9, Math.max(0, k)) / 9 * (SH - 24);
    const SC = [
      // dark: the night's own sky, stars once it's dark
      frame(sStars(() => .15)),
      // clouds: one soft blob per hour, thicker = more cover; stars only through the gaps
      frame(sStars(h => h.cloud == null ? .4 : h.cloud / 100) + hs.map((h, i) => h.cloud == null || h.cloud < 8 ? '' : `<ellipse cx="${sX(i).toFixed(1)}" cy="${(16 + 6 * Math.sin(i * 2)).toFixed(1)}" rx="${(SW / sn * .9 + 18 * h.cloud / 100).toFixed(1)}" ry="${(7 + 15 * h.cloud / 100).toFixed(1)}" fill="#CAD3DF" fill-opacity="${(h.cloud / 100 * .6).toFixed(2)}" filter="url(#${sid}b)"/>`).join('')),
      // aurora: green curtain up to each hour's Kp, rays + crest in that hour's Kp colour, shimmering; the line needed here
      frame(sStars(() => .3) + (() => { const pts = hs.map((h, i) => [sX(i), scKY(h.kp || 0)]); let d = `M0 ${SH} L0 ${pts[0][1].toFixed(1)}`; pts.forEach(q => { d += ` L${q[0].toFixed(1)} ${q[1].toFixed(1)}`; }); d += ` L${SW} ${pts[sn - 1][1].toFixed(1)} L${SW} ${SH} Z`;
        let s = `<path d="${d}" fill="url(#${sid}a)"/>`;
        for (let x = 3, k = 0; x < SW; x += 5, k++) { const h = hs[Math.min(sn - 1, Math.floor(x / SW * sn))], y = scKY(h.kp || 0) + 3 + 3 * Math.sin(x * 1.7);
          s += `<line class="tc-ray" style="animation-delay:${(-(k % 9) * .37).toFixed(2)}s" x1="${x}" x2="${x}" y1="${SH}" y2="${y.toFixed(1)}" stroke="${kpColor(h.kp || 0)}" stroke-opacity="${h.kp >= need ? .5 : .28}" stroke-width="1.6"/>`; }
        s += `<path d="${pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ')}" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="3"/>`;
        hs.forEach((h, i) => { if (h.kp != null) s += `<circle cx="${sX(i).toFixed(1)}" cy="${scKY(h.kp).toFixed(1)}" r="1.8" fill="${kpColor(h.kp)}"/>`; });
        const yn = scKY(need); return s + `<line x1="0" x2="${SW}" y1="${yn.toFixed(1)}" y2="${yn.toFixed(1)}" stroke="#E8C766" stroke-width="1.1" stroke-dasharray="4 3"/>`
          + `<text x="${SW - 6}" y="${(yn - 4).toFixed(1)}" fill="#E8C766" font-size="9" font-weight="700" text-anchor="end">${tr('Kp {n} here', { n: need })}</text>`; })()),
      // Moon: its real arc through the night, the disc where it's highest, phase from the illumination
      frame(sStars(() => .2) + (() => { const my = h => SH - 12 - Math.max(0, h.ma || 0) / 90 * (SH - 24), up = hs.map((h, i) => h.moonUp ? i : -1).filter(i => i >= 0);
        let s = `<path d="${hs.map((h, i) => (i ? 'L' : 'M') + sX(i).toFixed(1) + ' ' + (h.moonUp ? my(h) : SH - 6).toFixed(1)).join(' ')}" fill="none" stroke="#FFF3C4" stroke-opacity=".22" stroke-dasharray="2 4"/>`;
        const top = up.length ? up.reduce((a, i) => (hs[i].ma || 0) > (hs[a].ma || 0) ? i : a, up[0]) : -1, mx = top >= 0 ? sX(top) : SW * .7, myy = top >= 0 ? my(hs[top]) : SH - 10, il = hs[0].ill;
        return s + `<circle cx="${mx.toFixed(1)}" cy="${myy.toFixed(1)}" r="8.5" fill="#FFF3C4" fill-opacity="${top >= 0 ? 1 : .35}"/>` + (il < .97 ? `<circle cx="${(mx + 17 * il).toFixed(1)}" cy="${(myy - 1).toFixed(1)}" r="8" fill="${top >= 0 ? skyS(hs[top].sun) : '#0A0F1E'}"/>` : ''); })())];
    const css = `<style>.tc-ray{animation:tcRay 3.4s ease-in-out infinite}@keyframes tcRay{0%,100%{opacity:.55}50%{opacity:1}}.tn-rigel{transform-box:fill-box;transform-origin:center;animation:tnRigel 2.8s ease-in-out infinite}@keyframes tnRigel{0%,100%{transform:scale(.8);opacity:.75}50%{transform:scale(1.25);opacity:1}}.tn-betel{transform-box:fill-box;transform-origin:center;animation:tnRigel 4.3s ease-in-out -1.6s infinite}@media (prefers-reduced-motion:reduce){.tc-ray,.tn-rigel,.tn-betel{animation:none}}</style>`;
    const cells = css + C.map(([n, ok, v, note], i) => `<div style="min-width:0;background:#0F1318;border:1px solid #1E2530;border-radius:12px;padding:7px">${SC[i]}`
      + `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 4px 0"><div style="font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#A3B0C2">${n}</div><span style="flex:none;width:7px;height:7px;border-radius:50%;background:${ok ? OK : WEAK}"></span></div>`
      + `<div style="padding:0 4px 3px"><div style="font-size:20px;font-weight:800;color:#F1F4F8;line-height:1.2;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${v}</div>`
      + `<div style="font-size:11.5px;color:#8E9AAB;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${note}</div></div></div>`).join('');
    // ── the chart: one picture of the night above the mountains ──
    // sky darkens with the Sun, stars only where dark + clear, clouds drift over, the Moon on its arc,
    // a thin line per hour = Kp forecast (colour = strength, number on top) inside a green aurora glow
    // that has to reach the red line to be seen from here; chance ribbon + cloud % + hours under the horizon
    const W = Math.max(280, el.clientWidth || 340), n = hs.length, cw = W / n, sm = W < 520;
    const hor = sm ? 150 : 180, X = i => (i + .5) * cw, xt = tt => ((tt - hs[0].t) / H + .5) * cw;
    const kY = k => hor - Math.min(9, Math.max(0, k)) / 9 * (hor - 34);
    const t = (x, yy, s, col, sz, anc, w) => `<text x="${x}" y="${yy}" fill="${col}" font-size="${sz}" text-anchor="${anc || 'start'}" font-weight="${w || 500}">${s}</text>`;
    const sky = s => s > -6 ? '#2C3C5E' : s > -12 ? '#18223A' : s > -18 ? '#0D1326' : '#05080F';
    const uid = 'tn' + Math.random().toString(36).slice(2, 7);
    let g = `<defs><linearGradient id="${uid}s" x1="0" x2="1">` + hs.map((h, i) => `<stop offset="${((i + .5) / n).toFixed(3)}" stop-color="${sky(h.sun)}"/>`).join('') + `</linearGradient>`
      + `<linearGradient id="${uid}a" x1="0" x2="0" y1="1" y2="0"><stop offset="0" stop-color="#39FF9E" stop-opacity=".7"/><stop offset=".6" stop-color="#39FF9E" stop-opacity=".18"/><stop offset="1" stop-color="#C77DFF" stop-opacity=".1"/></linearGradient>`
      + `<radialGradient id="${uid}g"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".35" stop-color="#DDE8FF" stop-opacity=".18"/><stop offset="1" stop-color="#DDE8FF" stop-opacity="0"/></radialGradient>`
      + `<radialGradient id="${uid}r"><stop offset="0" stop-color="#E6F2FF" stop-opacity="1"/><stop offset=".25" stop-color="#7DB8FF" stop-opacity=".75"/><stop offset=".6" stop-color="#3D7BFF" stop-opacity=".22"/><stop offset="1" stop-color="#3D7BFF" stop-opacity="0"/></radialGradient>`
      + `<radialGradient id="${uid}o"><stop offset="0" stop-color="#FFF1DC" stop-opacity="1"/><stop offset=".25" stop-color="#FFB15C" stop-opacity=".75"/><stop offset=".6" stop-color="#FF7A2E" stop-opacity=".2"/><stop offset="1" stop-color="#FF7A2E" stop-opacity="0"/></radialGradient>`
      + `<filter id="${uid}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${(cw * .2).toFixed(1)}"/></filter>`
      + `<clipPath id="${uid}c"><rect width="${W}" height="${hor}" rx="14"/></clipPath></defs><g clip-path="url(#${uid}c)">`
      + `<rect width="${W}" height="${hor}" fill="url(#${uid}s)"/>`;
    let r = 7; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
    // a dense star field: clear hours bright, cloudy hours still show a faint few through the gaps; ~1 in 12 glows (smaller than Rigel)
    for (let k = 0; k < (sm ? 320 : 600); k++) { const x = rnd() * W, y = rnd() * hor * .88, h = hs[Math.min(n - 1, Math.floor(x / cw))], a = rnd(), b = rnd(), c = rnd(), cv = h.cloud == null ? .4 : h.cloud / 100;
      if (h.sun < -12 && a > cv * .55) { const vis = 1 - cv * .65;
        if (c > .92) g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(2.4 + b * 2).toFixed(1)}" fill="url(#${uid}g)" opacity="${vis.toFixed(2)}"/>`;
        g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(.3 + b * .7).toFixed(2)}" fill="#fff" fill-opacity="${((.25 + c * .7) * vis).toFixed(2)}"/>`; } }
    // constellations where they really are tonight: each one drawn at the hour it stands highest (dark hours only),
    // height = its altitude; dimmed by the clouds of that hour; Orion lightly highlighted
    if (p.lat != null) CONS.forEach(([name, hl, st, ln]) => {
      const cra = st.reduce((a, q) => a + q[0], 0) / st.length, cde = st.reduce((a, q) => a + q[1], 0) / st.length;
      // others: the hour they stand highest; Orion: the hour nearest the middle of the chart while it's up (> 12°)
      let bi = -1, ba = 8, bd = 1e9; hs.forEach((h, i) => { if (h.sun > -12) return; const a = starAlt(h.t, p.lat, p.lon, cra, cde), dm = Math.abs(i - (n - 1) / 2);
        if (hl ? a > 12 && dm < bd : a > ba) { ba = a; bi = i; bd = dm; } });
      if (bi < 0) return; const h = hs[bi], cx = hl ? W / 2 : X(bi), cy = hl ? hor * .36 : hor * .6 - ba / 90 * hor * .42,   // Orion (when it is up tonight) sits in the middle of the sky
        dim = 1 - (hl ? .25 : .5) * (h.cloud == null ? .3 : h.cloud / 100);
      const sc = (sm ? 1.7 : 2.2) * (name === 'Pleiades' ? 4 : hl ? 1.45 : 1), P = st.map(q => [cx - (q[0] - cra) * 15 * Math.cos(cde * rad) * sc, cy - (q[1] - cde) * sc]);
      const lc = hl ? '#FFC773' : '#8EA3C0', lo = (hl ? .85 : .22) * dim;   // Orion in the warm yellow of the 3D Nearby stars view
      ln.forEach(([i, j]) => { g += `<line x1="${P[i][0].toFixed(1)}" y1="${P[i][1].toFixed(1)}" x2="${P[j][0].toFixed(1)}" y2="${P[j][1].toFixed(1)}" stroke="${lc}" stroke-opacity="${lo.toFixed(2)}" stroke-width="${hl ? 1.4 : .8}" stroke-linecap="round"/>`; });
      if (hl) g += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(14 * sc).toFixed(1)}" ry="${(14 * sc).toFixed(1)}" fill="#FFC773" fill-opacity="${(.07 * dim).toFixed(3)}"/>`;
      if (hl) g += `<circle class="tn-rigel" cx="${P[6][0].toFixed(1)}" cy="${P[6][1].toFixed(1)}" r="${(sm ? 9 : 12).toFixed(1)}" fill="url(#${uid}r)" opacity="${dim.toFixed(2)}"/>`;   // Rigel: blue, pulsing
      if (hl) g += `<circle class="tn-betel" cx="${P[0][0].toFixed(1)}" cy="${P[0][1].toFixed(1)}" r="${(sm ? 9 : 12).toFixed(1)}" fill="url(#${uid}o)" opacity="${dim.toFixed(2)}"/>`;   // Betelgeuse: orange, slower pulse
      P.forEach(([x, y], k) => { if (hl && (k === 6 || k === 0)) { g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="${k ? '#CFE6FF' : '#FFE2BF'}"/>`; return; }
        g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${hl && (k === 0 || k === 6) ? 1.9 : 1.3}" fill="${hl && k === 0 ? '#FFC58A' : '#fff'}" fill-opacity="${(.9 * dim).toFixed(2)}"/>`; });
      const ly = hl ? Math.min(...P.map(q => q[1])) - 7 : Math.max(...P.map(q => q[1])) + 11;   // Orion's name above it, clear of the Kp numbers
      g += t(cx.toFixed(1), Math.max(10, Math.min(hor - 22, ly)).toFixed(1), tr(name), hl ? '#FFD98F' : '#8E9AAB', hl ? 10 : 9, 'middle', hl ? 700 : 500).replace('<text ', `<text fill-opacity="${(hl ? .9 : .7) * dim}" `); });
    // aurora glow up to the Kp level (smooth), faint rays
    const kp = hs.map((h, i) => h.kp == null ? null : [X(i), kY(h.kp)]).filter(Boolean);
    const smooth = pts => { let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
      for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`; }
      return d; };
    if (kp.length > 1) g += `<path d="M0 ${hor} L0 ${kp[0][1].toFixed(1)} L${smooth(kp).slice(1)} L${W} ${kp[kp.length - 1][1].toFixed(1)} L${W} ${hor} Z" fill="url(#${uid}a)"/>`;
    for (let x = 3; x < W; x += 6) { const h = hs[Math.min(n - 1, Math.floor(x / cw))]; if (h.kp == null) continue;
      g += `<line x1="${x}" x2="${x}" y1="${hor}" y2="${(kY(h.kp) + 8).toFixed(1)}" stroke="#7CFFC4" stroke-opacity="${h.kp >= need ? .2 : .06}"/>`; }
    // clouds: soft blobs, bigger + whiter = more cover
    hs.forEach((h, i) => { if (h.cloud == null || h.cloud < 8) return; const o = h.cloud / 100;
      g += `<g filter="url(#${uid}b)" fill="#CAD3DF" fill-opacity="${(o * .55).toFixed(2)}"><ellipse cx="${X(i).toFixed(1)}" cy="${(24 + 8 * Math.sin(i * 1.7)).toFixed(1)}" rx="${(cw * .9).toFixed(1)}" ry="${(10 + 20 * o).toFixed(1)}"/><ellipse cx="${(X(i) + cw * .45).toFixed(1)}" cy="44" rx="${(cw * .7).toFixed(1)}" ry="${(6 + 14 * o).toFixed(1)}"/></g>`; });
    // the Moon on its real arc (altitude), drawn where it's highest, phase from illumination
    const mi = hs.map((h, i) => h.moonUp ? i : -1).filter(i => i >= 0), mY = h => hor - 14 - Math.max(0, h.ma || 0) / 90 * (hor - 40);
    if (mi.length) { g += `<path d="${mi.map((i, k) => (k ? 'L' : 'M') + X(i).toFixed(1) + ' ' + mY(hs[i]).toFixed(1)).join('')}" fill="none" stroke="#FFF3C4" stroke-opacity=".3" stroke-dasharray="2 4"/>`;
      const top = mi.reduce((a, i) => (hs[i].ma || 0) > (hs[a].ma || 0) ? i : a, mi[0]), mx = X(top), my = mY(hs[top]), ill2 = hs[top].ill;
      g += `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="7.5" fill="#FFF3C4"/>` + (ill2 < .97 ? `<circle cx="${(mx + 15 * ill2).toFixed(1)}" cy="${(my - 1).toFixed(1)}" r="7" fill="${sky(hs[top].sun)}"/>` : ''); }
    // thin Kp line per hour, colour = strength, value on top
    hs.forEach((h, i) => { if (h.kp == null) return; const y = kY(h.kp), c = kpColor(h.kp);
      g += `<line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="${hor}" y2="${y.toFixed(1)}" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-opacity="${h.kp >= need ? 1 : .8}"/>`
        + `<circle cx="${X(i).toFixed(1)}" cy="${y.toFixed(1)}" r="2.8" fill="${c}"/>`
        + (cw >= 24 || i % 2 === 0 ? t(X(i).toFixed(1), (y - 6).toFixed(1), h.kp.toFixed(cw >= 30 ? 1 : 0), c, sm ? 9.5 : 10.5, 'middle', 700) : ''); });
    // mountains
    let m = `M0 ${hor}`; for (let x = 0; x <= W + 1; x += W / 24) m += ` L${x.toFixed(1)} ${(hor - 7 - 9 * Math.abs(Math.sin(x / 61)) - 5 * Math.abs(Math.sin(x / 23))).toFixed(1)}`;
    g += `<path d="${m} L${W} ${hor} Z" fill="#06080C"/></g>`;
    g += `<line x1="0" x2="${W}" y1="${kY(need).toFixed(1)}" y2="${kY(need).toFixed(1)}" stroke="${BAD}" stroke-width="1.3" stroke-dasharray="5 4"/>`
      // its label sits as a fixed legend in the top-right corner, so it never collides with the hourly Kp numbers
      + `<rect x="${W - (sm ? 196 : 232)}" y="6" width="${sm ? 188 : 224}" height="18" rx="9" fill="#06080C" fill-opacity=".55"/>`
      + `<line x1="${W - (sm ? 188 : 224)}" x2="${W - (sm ? 170 : 204)}" y1="15" y2="15" stroke="${BAD}" stroke-width="1.3" stroke-dasharray="4 3"/>`
      + t(W - 14, 19, tr('seen from here above this line · Kp {n}', { n: need }), '#FF9B9B', sm ? 9 : 10, 'end', 700);
    if (good) { const x0 = xt(p.best.from) - cw / 2, x1 = xt(p.best.to) - cw / 2;
      g += `<rect x="${x0.toFixed(1)}" y="2" width="${(x1 - x0).toFixed(1)}" height="${hor - 4}" rx="10" fill="#FFE600" fill-opacity=".05" stroke="#FFE600" stroke-width="1.5" stroke-dasharray="4 3"/>`
        + t(((x0 + x1) / 2).toFixed(1), 16, tr('best {a}–{b}', { a: fmt(p.best.from), b: fmt(p.best.to) }), '#FFE600', 10.5, 'middle', 700); }
    // under the horizon: cloud % · chance ribbon · hours
    const yCl = hor + 14, yCh = hor + 22, yAx = hor + 48, Hh = yAx + 6;
    hs.forEach((h, i) => { if (h.cloud != null && (cw >= 26 || i % 2 === 0)) g += t(X(i).toFixed(1), yCl, '☁ ' + Math.round(h.cloud) + '%', '#8E9AAB', sm ? 8.5 : 9.5, 'middle');
      const pc = Math.min(1, h.score / .5);
      g += `<rect x="${(i * cw + 1).toFixed(1)}" y="${yCh}" width="${(cw - 2).toFixed(1)}" height="10" rx="5" fill="${pc >= .1 ? OK : '#1E2530'}" fill-opacity="${pc >= .1 ? (.3 + .7 * pc).toFixed(2) : 1}"><title>${Math.round(pc * 100)}%</title></rect>`; });
    const every = cw >= 34 ? 1 : 2;
    hs.forEach((h, i) => { if (i % every === 0) g += t(X(i).toFixed(1), yAx, fmt(h.t), '#A3B0C2', sm ? 9.5 : 10.5, 'middle'); });
    if (cur && cur >= hs[0].t && cur < hs[n - 1].t + H) { const xc = xt(cur - H / 2); g += `<line x1="${xc.toFixed(1)}" x2="${xc.toFixed(1)}" y1="0" y2="${yCh + 10}" stroke="#FFE600" stroke-width="1.5"/>`; }
    const leg = `<div style="display:flex;gap:6px 14px;flex-wrap:wrap;font-size:11.5px;color:#A3B0C2;margin-top:6px"><span><b style="color:${OK}">│</b> ${tr('aurora forecast (Kp) each hour')}</span><span>☁ ${tr('cloud cover')}</span><span>${tr('stars = dark and clear')}</span><span><b style="color:${OK}">▬</b> ${tr('chance')}</span></div>`;
    // tiles always shown (they replace the old Kp / clouds / dark facts): 4 in a row when there's room, else 2 × 2 — never 3 + 1
    el.innerHTML = head + `<div style="display:grid;grid-template-columns:repeat(${W >= 600 ? 4 : 2},minmax(0,1fr));gap:8px">${cells}</div>`
      + `<svg viewBox="0 0 ${W} ${Hh}" width="100%" style="display:block;margin-top:14px;height:auto;font-family:inherit" role="img" aria-label="${tr('Tonight hour by hour: darkness, clouds and aurora chance')}">${g}</svg>` + leg;
  }

  window.AuroraTonight = { plan, sentence, render, sunAlt, moonAlt, moonIll };
})();
