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
    const cloudAt = t => { const w = o.wx; if (!w || !w.hourly) return null; const off = (w.utc_offset_seconds || 0) * 1000;
      let best = null, bd = 1e12; w.hourly.time.forEach((s, i) => { const d = Math.abs(Date.parse(s + 'Z') - off - t); if (d < bd) { bd = d; best = w.hourly.cloud_cover[i]; } });
      return bd <= 1.5 * H ? best : null; };
    const kpAt = t => { let k = null; (o.kpList || []).forEach(p => { const s = Date.parse(p.time_tag + 'Z'); if (t >= s && t < s + 3 * H) k = +p.kp; }); return k; };
    for (let i = 0; i < 15; i++) {
      const t = t0 + i * H, sun = sunAlt(t, o.lat, o.lon);
      if (i > 2 && sun > -3) break;   // dawn: the night is over
      const ma = moonAlt(t, o.lat, o.lon), ill = moonIll(t), cloud = cloudAt(t), kp = kpAt(t);
      const dark = sun < -15 ? 1 : sun < -10 ? .6 : sun < -6 ? .25 : 0, N = o.need;
      const kf = kp == null ? 0 : kp >= N + 1 ? 1 : kp >= N ? .75 : kp >= N - 1 ? .35 : kp >= N - 2 ? .1 : .02;
      const clear = cloud == null ? .6 : 1 - cloud / 100, moon = ma > 0 ? 1 - .45 * ill : 1;
      hours.push({ t, sun, cloud, kp, moonUp: ma > 0, ill, score: dark * kf * clear * moon });
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
   * Draw tonight into el: first four plain checks (dark · clear sky · aurora strong enough · Moon), each ✓ / ✗ with one
   * line, then one hour-by-hour picture — sky shade = how dark, grey clouds hanging from the top, green chance bars
   * rising from the bottom, the Moon on top, Kp per hour below (✓ when it reaches what's needed), best window in yellow.
   * fmt = hour formatter, need = Kp needed here, cur = time to mark (optional). Self-styled (works in the app too).
   */
  function render(el, p, fmt, kpColor, need, cur) {
    const hs = p.hours, H = 3600e3; if (!hs.length) { el.innerHTML = ''; return; }
    const darkH = hs.filter(h => h.sun < -12), dk = darkH.length > 0;
    const cl = (dk ? darkH : hs).filter(h => h.cloud != null), avgC = cl.length ? Math.round(cl.reduce((a, h) => a + h.cloud, 0) / cl.length) : null;
    const maxKp = Math.max(0, ...hs.map(h => h.kp || 0)), mh = dk ? darkH : hs, moonUp = mh.filter(h => h.moonUp).length > mh.length / 2, ill = Math.round(hs[0].ill * 100);
    const good = p.best && p.best.score >= .1;
    const checks = [
      ['🌑', tr('Dark'), dk, tr('darkness'), dk ? tr('from {t}', { t: fmt(darkH[0].t) }) : tr('not dark enough')],
      ['☁️', tr('Clear sky'), avgC != null && avgC < 50, tr('a clear sky'), avgC == null ? tr('no cloud data') : avgC >= 85 ? tr('{c}% clouds — covered', { c: avgC }) : avgC >= 50 ? tr('{c}% clouds — mostly covered', { c: avgC }) : avgC >= 20 ? tr('{c}% clouds — some gaps', { c: avgC }) : tr('{c}% clouds — clear', { c: avgC })],
      ['🧲', tr('Aurora strong enough'), maxKp >= need, tr('a stronger aurora'), tr('Kp {k} · needs {n} here', { k: maxKp.toFixed(1), n: need })],
      ['🌙', tr('Moon'), !moonUp || ill < 50, tr('a darker sky (the Moon)'), moonUp ? tr('{p}% full, up — brightens the sky', { p: ill }) : tr('down — dark sky')],
    ];
    const chip = ([ic, name, ok, , txt]) => `<div style="flex:1 1 140px;min-width:0;display:flex;gap:9px;align-items:center;padding:9px 11px;border-radius:12px;background:${ok ? 'rgba(57,255,158,.07)' : 'rgba(255,107,107,.08)'};border:1px solid ${ok ? 'rgba(57,255,158,.35)' : 'rgba(255,107,107,.45)'}">`
      + `<span style="font-size:20px;line-height:1" aria-hidden="true">${ic}</span><div style="min-width:0"><div style="font:600 15px/1.1 'Barlow Condensed',Barlow,sans-serif;text-transform:uppercase;color:#E6EBF1">${name} <b style="color:${ok ? '#39FF9E' : '#FF6B6B'}">${ok ? '✓' : '✗'}</b></div>`
      + `<div style="font:500 11px/1.35 'JetBrains Mono',monospace;color:#B4BFCC;margin-top:2px">${txt}</div></div></div>`;
    const head = good ? `<div style="font:600 13px 'JetBrains Mono',monospace;color:#39FF9E;margin:2px 0 8px">★ ${tr('Best time: {a}–{b}', { a: fmt(p.best.from), b: fmt(p.best.to) })}</div>`
      : `<div style="font:600 13px 'JetBrains Mono',monospace;color:#FF8A8A;margin:2px 0 8px">${tr('Missing tonight')}: ${checks.filter(c => !c[2]).map(c => c[3]).join(' · ') || tr('better timing')}</div>`;
    // the hour-by-hour picture
    const W = Math.max(280, el.clientWidth || 340), Lw = 62, top = 22, ch = 64, cb = 62, gap = 4, kpY = top + ch + cb + 16, Hh = kpY + 30;
    const cw = (W - Lw) / hs.length, X = i => Lw + i * cw;
    const sky = s => s > -6 ? '#3A4E78' : s > -12 ? '#22304F' : s > -18 ? '#141C33' : '#0A0F1E';
    let g = '';
    const txt = (x, y, t, col, sz, anc, w) => `<text x="${x}" y="${y}" fill="${col}" font-size="${sz}" font-family="JetBrains Mono, monospace" text-anchor="${anc || 'start'}" font-weight="${w || 500}">${t}</text>`;
    g += txt(0, top + 14, '☁ ' + tr('CLOUDS'), '#AEB8C6', 9.5, 'start', 700) + txt(0, top + ch + cb - 6, '★ ' + tr('CHANCE'), '#39FF9E', 9.5, 'start', 700) + txt(0, kpY + 4, tr('AURORA'), '#C9D1DB', 9.5, 'start', 700) + txt(0, kpY + 15, tr('Kp · need {n}', { n: need }), '#8E9AAB', 8.5);
    hs.forEach((h, i) => { const x = X(i) + 1, w = cw - 2;
      g += `<rect x="${x}" y="${top}" width="${w}" height="${ch + cb}" rx="4" fill="${sky(h.sun)}"><title>${tr('Sun {d}° below the horizon', { d: Math.round(-h.sun) })}</title></rect>`;
      if (h.cloud != null) { const cH = h.cloud / 100 * ch; g += `<rect x="${x}" y="${top}" width="${w}" height="${Math.max(0, cH)}" rx="4" fill="#9AA6B8" fill-opacity=".6"/>`;
        if (cw >= 22) g += txt(x + w / 2, top + Math.max(11, Math.min(ch - 3, cH - 4)), Math.round(h.cloud) + (cw >= 34 ? '%' : ''), '#fff', 9, 'middle', 700); }
      const v = Math.min(1, h.score / .5), bH = v * (cb - 4);
      if (bH > .5) g += `<rect x="${x + w * .14}" y="${top + ch + cb - bH}" width="${w * .72}" height="${bH}" rx="3" fill="#39FF9E" fill-opacity="${(.35 + .65 * v).toFixed(2)}"/>`;
      if (h.moonUp) g += txt(x + w / 2, top - 7, h.ill > .5 ? '●' : '◐', h.ill > .5 ? '#FFF3C4' : '#9AA3B0', 11, 'middle');
      if (h.kp != null) g += txt(x + w / 2, kpY + 6, h.kp.toFixed(0) + (h.kp >= need ? '✓' : ''), kpColor(h.kp), 10, 'middle', 700);
      g += txt(x + w / 2, Hh - 2, fmt(h.t).slice(0, 2), '#A3B0C2', 9.5, 'middle');
      if (cur && cur >= h.t && cur < h.t + H) g += `<rect x="${x - 1}" y="${top - 1}" width="${w + 2}" height="${ch + cb + 2}" rx="5" fill="none" stroke="#FFE600" stroke-width="2"/>`;
    });
    if (good) { const a = hs.findIndex(h => h.t >= p.best.from), b = hs.findIndex(h => h.t >= p.best.to), x0 = X(a) + 1, x1 = b < 0 ? W - 1 : X(b) - 1;
      g += `<rect x="${x0}" y="${top + ch + 1}" width="${x1 - x0}" height="${cb - 2}" rx="5" fill="none" stroke="#FFE600" stroke-width="1.5" stroke-dasharray="4 3"/>`; }
    else g += txt(Lw + (W - Lw) / 2, top + ch + cb / 2 + 4, tr('NO CHANCE IN ANY HOUR'), '#FF8A8A', 10.5, 'middle', 700);
    const legend = [tr('sky shade = how dark'), tr('grey = clouds'), tr('green = chance'), '● ' + tr('bright Moon') + ' · ◐ ' + tr('thin'), '✓ ' + tr('Kp enough')].join(' · ');
    el.innerHTML = head + `<div style="display:flex;flex-wrap:wrap;gap:6px">${checks.map(chip).join('')}</div>`
      + `<svg viewBox="0 0 ${W} ${Hh}" width="100%" style="display:block;margin-top:12px;height:auto" role="img" aria-label="${tr('Tonight hour by hour: darkness, clouds and aurora chance')}">${g}</svg>`
      + `<div style="font:500 10.5px/1.5 'JetBrains Mono',monospace;color:#8E9AAB;margin-top:4px">${legend}</div>`;
  }

  window.AuroraTonight = { plan, sentence, render, sunAlt, moonAlt, moonIll };
})();
