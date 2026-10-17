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
    return { hours, best };
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
   * Draw tonight into el, meteogram-style (like meteoblue): one line saying the answer, four conditions in a row
   * (each with a coloured bar: green = fine, red = the problem), then one chart on a shared time axis —
   * cloud layers (high / mid / low, darker grey = more cloud), the Kp forecast as a line against the Kp needed here
   * on a sky that darkens with the night, the chance curve, and the Moon. The best window is a lit band through all.
   * fmt = hour formatter, need = Kp needed here, cur = time to mark (optional). Fonts inherit from the page.
   */
  function render(el, p, fmt, kpColor, need, cur) {
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
    const OK = '#39FF9E', BAD = '#FF6B6B';
    const head = good ? `<div style="font-weight:700;font-size:15px;color:${OK};margin:2px 0 10px">${tr('Best time tonight: {a}–{b}', { a: fmt(p.best.from), b: fmt(p.best.to) })}</div>`
      : `<div style="font-weight:700;font-size:15px;color:#FF9B9B;margin:2px 0 10px">${tr('Missing tonight')}: ${C.filter(c => !c[1]).map(c => c[4]).join(', ') || tr('better timing')}</div>`;
    const cells = C.map(([n, ok, v, note]) => `<div style="min-width:0;padding:8px 10px 9px;background:#0F1318;border-radius:10px;border-top:3px solid ${ok ? OK : BAD}">`
      + `<div style="font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#A3B0C2">${n}</div>`
      + `<div style="font-size:20px;font-weight:700;color:#F1F4F8;margin-top:2px;font-variant-numeric:tabular-nums">${v}</div>`
      + `<div style="font-size:11.5px;color:${ok ? '#A3B0C2' : '#FF9B9B'};margin-top:1px;line-height:1.3">${note}</div></div>`).join('');
    // ── the chart ──
    const W = Math.max(300, el.clientWidth || 340), Lw = 54, Rw = 6, n = hs.length, cw = (W - Lw - Rw) / n;
    const X = i => Lw + (i + .5) * cw, xt = t => Lw + ((t - hs[0].t) / H + .5) * cw;
    const layers = hs.some(h => h.cl != null || h.cm != null || h.ch != null);
    let y = 16; const yCl = y, rowH = 13, hCl = layers ? rowH * 3 : rowH * 2; y += hCl + 10;
    const yKp = y, hKp = 92; y += hKp + 8; const yCh = y, hCh = 46; y += hCh + 6; const yMo = y, hMo = 14; y += hMo + 6; const yAx = y + 10, Hh = yAx + 4;
    const t = (x, yy, s, col, sz, anc, w) => `<text x="${x}" y="${yy}" fill="${col}" font-size="${sz}" text-anchor="${anc || 'start'}" font-weight="${w || 500}">${s}</text>`;
    const smooth = pts => { if (!pts.length) return ''; let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
      for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`; }
      return d; };
    const sky = s => s > -6 ? '#3A4E78' : s > -12 ? '#22304F' : s > -18 ? '#141C33' : '#0A0F1E';
    const uid = 'tn' + Math.random().toString(36).slice(2, 7);
    let g = `<defs><linearGradient id="${uid}s" x1="0" x2="1">` + hs.map((h, i) => `<stop offset="${((i + .5) / n).toFixed(3)}" stop-color="${sky(h.sun)}"/>`).join('') + `</linearGradient>`
      + `<linearGradient id="${uid}c" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#39FF9E" stop-opacity=".75"/><stop offset="1" stop-color="#39FF9E" stop-opacity=".05"/></linearGradient></defs>`;
    // best window: a lit band through every row
    if (good) { const x0 = xt(p.best.from) - cw / 2, x1 = xt(p.best.to) - cw / 2;
      g += `<rect x="${x0}" y="${yCl - 4}" width="${x1 - x0}" height="${yMo + hMo - yCl + 6}" rx="6" fill="#FFE600" fill-opacity=".07" stroke="#FFE600" stroke-opacity=".45" stroke-dasharray="3 3"/>`
        + t((x0 + x1) / 2, yCl - 6, tr('best {a}–{b}', { a: fmt(p.best.from), b: fmt(p.best.to) }), '#FFE600', 10, 'middle', 700); }
    // clouds: high / mid / low (or total), grey = cover
    const rows = layers ? [[tr('High'), 'ch'], [tr('Mid'), 'cm'], [tr('Low'), 'cl']] : [[tr('Clouds'), 'cloud']];
    g += t(0, yCl + 9, tr('Clouds'), '#C9D1DB', 10.5, 'start', 700);
    rows.forEach(([lab, k], r) => { const yy = yCl + (layers ? r * rowH : 0), hh = layers ? rowH - 2 : hCl - 2;
      if (layers) g += t(Lw - 5, yy + 9.5, lab, '#8E9AAB', 9, 'end');
      hs.forEach((h, i) => { const v = h[k]; if (v == null) return; g += `<rect x="${Lw + i * cw + .5}" y="${yy}" width="${cw - 1}" height="${hh}" fill="#D7DEE8" fill-opacity="${(.06 + .84 * v / 100).toFixed(2)}"><title>${lab} ${Math.round(v)}%</title></rect>`; }); });
    if (cw >= 24) hs.forEach((h, i) => { if (h.cloud != null) g += t(X(i), yCl + hCl + 8, Math.round(h.cloud) + '%', '#A3B0C2', 8.5, 'middle'); });
    // Kp on the night sky
    const kY = k => yKp + hKp - Math.min(9, k) / 9 * hKp;
    g += `<rect x="${Lw}" y="${yKp}" width="${W - Lw - Rw}" height="${hKp}" rx="6" fill="url(#${uid}s)"/>`;
    [3, 6, 9].forEach(k => { g += `<line x1="${Lw}" x2="${W - Rw}" y1="${kY(k)}" y2="${kY(k)}" stroke="#fff" stroke-opacity=".07"/>` + t(Lw - 5, kY(k) + 3, k, '#6B7788', 8.5, 'end'); });
    g += t(0, yKp + 11, tr('Aurora'), '#C9D1DB', 10.5, 'start', 700) + t(0, yKp + 24, 'Kp', '#8E9AAB', 9.5);
    const kp = hs.map((h, i) => h.kp == null ? null : [X(i), kY(h.kp)]).filter(Boolean);
    if (kp.length) { const d = smooth(kp);
      g += `<path d="${d} L${kp[kp.length - 1][0]} ${yKp + hKp} L${kp[0][0]} ${yKp + hKp} Z" fill="#7FB8FF" fill-opacity=".14"/><path d="${d}" fill="none" stroke="#CFE3FF" stroke-width="2"/>`;
      hs.forEach((h, i) => { if (h.kp != null) g += `<circle cx="${X(i)}" cy="${kY(h.kp)}" r="2.6" fill="${kpColor(h.kp)}"/>`; }); }
    g += `<line x1="${Lw}" x2="${W - Rw}" y1="${kY(need)}" y2="${kY(need)}" stroke="${BAD}" stroke-width="1.4" stroke-dasharray="5 4"/>`
      + t(W - Rw - 4, kY(need) - 4, tr('needed here: Kp {n}', { n: need }), '#FF9B9B', 9.5, 'end', 700);
    // chance curve 0–100 %
    const cY = v => yCh + hCh - v * (hCh - 4);
    g += `<rect x="${Lw}" y="${yCh}" width="${W - Lw - Rw}" height="${hCh}" rx="6" fill="#0F1318"/>` + t(0, yCh + 11, tr('Chance'), '#C9D1DB', 10.5, 'start', 700);
    const cp = hs.map((h, i) => [X(i), cY(Math.min(1, h.score / .5))]), any = hs.some(h => h.score / .5 >= .04);
    if (any) { const d = smooth(cp); g += `<path d="${d} L${cp[cp.length - 1][0]} ${yCh + hCh} L${cp[0][0]} ${yCh + hCh} Z" fill="url(#${uid}c)"/><path d="${d}" fill="none" stroke="#39FF9E" stroke-width="1.8"/>`;
      const top = hs.reduce((a, h, i) => h.score > hs[a].score ? i : a, 0), pc = Math.round(Math.min(1, hs[top].score / .5) * 100);
      g += t(X(top), Math.max(yCh + 10, cY(pc / 100) - 4), pc + '%', '#CFFFE6', 9.5, 'middle', 700); }
    else g += t(Lw + (W - Lw - Rw) / 2, yCh + hCh / 2 + 4, tr('no chance in any hour'), '#FF9B9B', 10.5, 'middle', 700);
    // Moon: band while it's up, brighter = fuller
    g += t(0, yMo + 10, tr('Moon'), '#C9D1DB', 10.5, 'start', 700);
    let first = -1; hs.forEach((h, i) => { if (!h.moonUp) return; if (first < 0) first = i;
      g += `<rect x="${Lw + i * cw}" y="${yMo + 2}" width="${cw + .5}" height="${hMo - 4}" fill="#FFF3C4" fill-opacity="${(.12 + .55 * h.ill).toFixed(2)}"/>`; });
    g += first >= 0 ? t(Lw + first * cw + 4, yMo + 10.5, tr('Moon up · {p}% lit', { p: ill }), '#0A0A0A', 9, 'start', 700) : t(Lw + 4, yMo + 10.5, tr('Moon down all night'), '#8E9AAB', 9);
    // time axis + the clock's moment
    const every = cw >= 26 ? 1 : 2;
    hs.forEach((h, i) => { if (i % every === 0) g += t(X(i), yAx, fmt(h.t), '#A3B0C2', 9.5, 'middle'); });
    if (cur && cur >= hs[0].t && cur < hs[n - 1].t + H) { const xc = xt(cur - H / 2); g += `<line x1="${xc}" x2="${xc}" y1="${yCl - 2}" y2="${yMo + hMo}" stroke="#FFE600" stroke-width="1.5"/>`; }
    el.innerHTML = head + `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px">${cells}</div>`
      + `<svg viewBox="0 0 ${W} ${Hh}" width="100%" style="display:block;margin-top:14px;height:auto;font-family:inherit" role="img" aria-label="${tr('Tonight hour by hour: darkness, clouds and aurora chance')}">${g}</svg>`;
  }

  window.AuroraTonight = { plan, sentence, render, sunAlt, moonAlt, moonIll };
})();
