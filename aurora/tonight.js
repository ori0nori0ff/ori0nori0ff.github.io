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

  /** One plain sentence about tonight. fmt = hour formatter. */
  function sentence(p, need, fmt) {
    const darkH = p.hours.filter(h => h.sun < -12), maxKp = Math.max(0, ...p.hours.map(h => h.kp || 0));
    if (!darkH.length) return 'It does not get properly dark in the coming hours.';
    const avgCloud = darkH.filter(h => h.cloud != null).reduce((a, h, i, A) => a + h.cloud / A.length, 0);
    const moonUp = darkH.filter(h => h.moonUp).length / darkH.length, ill = darkH[0].ill;
    const moonTxt = moonUp > .5 && ill > .5 ? 'a bright Moon (' + Math.round(ill * 100) + '%) is up' : moonUp > .5 ? 'the Moon is up but thin' : 'the Moon is down';
    if (!p.best || p.best.score < .05) {
      const why = maxKp < need - 1 ? 'the aurora forecast is too weak here (Kp ' + maxKp.toFixed(1) + ', need ' + need + ')' : avgCloud > 70 ? 'clouds (~' + Math.round(avgCloud) + '%) cover the sky' : 'nothing lines up';
      return 'No good window tonight — ' + why + '; ' + moonTxt + '.';
    }
    const h = p.best.hour;
    return 'Best window ' + fmt(p.best.from) + '–' + fmt(p.best.to) + ': Kp ' + (h.kp == null ? '–' : h.kp.toFixed(1)) +
      (h.cloud == null ? '' : ', clouds ' + Math.round(h.cloud) + '%') + ', ' + (h.moonUp ? (h.ill > .5 ? 'bright Moon up' : 'thin Moon up') : 'Moon down') + '.';
  }

  /** Draw the strip into el: one column per hour (bar = score, colour = Kp), cloud %, moon. */
  function render(el, p, fmt, kpColor) {
    const hs = p.hours, mx = Math.max(.05, ...hs.map(h => h.score));
    el.innerHTML = `<div class="tn-grid" style="grid-template-columns:repeat(${hs.length},1fr)">` + hs.map(h => {
      const best = p.best && h.t >= p.best.from && h.t < p.best.to, hgt = Math.round(6 + 46 * h.score / mx);
      const col = h.kp == null ? '#2C3542' : kpColor(h.kp), dark = h.sun < -12 ? 1 : h.sun < -6 ? .55 : .2;
      return `<div class="tn-c${best ? ' tn-best' : ''}" title="Kp ${h.kp == null ? '–' : h.kp.toFixed(1)} · clouds ${h.cloud == null ? '–' : Math.round(h.cloud) + '%'}">
        <div class="tn-bar"><i style="height:${hgt}px;background:${col};opacity:${.35 + .65 * dark}"></i></div>
        <b>${h.cloud == null ? '' : Math.round(h.cloud)}</b><span class="tn-m">${h.moonUp ? (h.ill > .5 ? '●' : '◐') : ''}</span><em>${fmt(h.t).slice(0, 2)}</em></div>`;
    }).join('') + '</div>';
  }

  window.AuroraTonight = { plan, sentence, render, sunAlt, moonAlt, moonIll };
})();
