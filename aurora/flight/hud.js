/* Screen HUD (docs/flight-plan.md, step S4): a 2D canvas over the 3D view for the outside views (chase / far chase / orbit) and for
   spacecraft. Aircraft: attitude ball, speed and altitude scales with boxes, heading scale, vertical speed, Mach, G, AOA, throttle.
   Spacecraft: navball (centre = the nose; sky = away from the body, ground = towards it; prograde / retrograde, normal / anti-normal,
   radial out / in and the manoeuvre node marked), orbit data (Ap / Pe / period / inclination / eccentricity from flight/orbit.js), delta-v
   left, burn timer, time speed. Own code and own look; text on a dark plate (contrast > 4.5:1), labels ≥ 12 px. */
import { D2R, clamp, FONT, MONO, fmt, pad } from './instruments/draw.js?v=c3b9eb1c';

const KT = 1.943844, FT = 3.28084;
const qrot = (q, v) => { const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx]; };
const qconj = q => [-q[0], -q[1], -q[2], q[3]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]), unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const EPS = 23.4393 * D2R, POLE_E = [0, Math.sin(EPS), Math.cos(EPS)];   // the Earth's axis in the ecliptic frame I (as core.js OMEGA_I)
export const dur = s => !isFinite(s) ? '–' : s >= 86400 ? fmt(s / 86400, 2) + ' d' : s >= 3600 ? Math.floor(s / 3600) + ' h ' + pad(Math.floor(s % 3600 / 60), 2) + ' min' : s >= 60 ? Math.floor(s / 60) + ' min ' + pad(Math.floor(s % 60), 2) + ' s' : fmt(s, 1) + ' s';
export const km = m => fmt(m / 1e3, Math.abs(m) < 1e7 ? 1 : 0);

// core = createCore(); host = the element over the 3D view; o = { kind: 'air' | 'space', ctx (orbit ctx for spacecraft), hideInView: [view indices] }
export function createScreenHud(core, host, o = {}) {
  const cv = document.createElement('canvas'); cv.className = 'fl-shud'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', o.kind === 'space' ? 'Navball and orbit data' : 'Flight instruments');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3'; host.appendChild(cv);
  const x = cv.getContext('2d'), stats = { ms: 0, nbMs: 0, frames: 0, on: true };
  let W = 0, H = 0, dpr = 1;
  function size() { dpr = Math.min(2, window.devicePixelRatio || 1); const r = cv.getBoundingClientRect(), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr); if (w !== cv.width || h !== cv.height) { cv.width = w; cv.height = h; } W = r.width; H = r.height; }
  const plate = (px, py, w, h) => { x.fillStyle = 'rgba(8,11,16,.78)'; x.strokeStyle = 'rgba(255,255,255,.16)'; x.lineWidth = 1; x.beginPath(); x.roundRect(px, py, w, h, 10); x.fill(); x.stroke(); };
  const txt = (s, px, py, o2 = {}) => { x.font = `${o2.w || 600} ${o2.s || 13}px ${o2.mono ? MONO : FONT}`; x.fillStyle = o2.c || '#E6EBF1'; x.textAlign = o2.a || 'left'; x.textBaseline = 'middle'; x.fillText(s, px, py); };

  // ── aircraft: a compact flight display at the bottom centre
  function air(h) { const cx = W / 2, R = Math.min(54, W * .1), pw = Math.min(W - 24, 720), compact = pw < 700, ph = 2 * R + 64 + (compact ? 78 : 0), by = H - 16 - ph + R + 34, px = cx - pw / 2;
    plate(px, by - R - 34, pw, ph);
    // attitude ball: horizon rotated by the roll, moved by the pitch (2 px per degree × scale)
    const k = R / 30; x.save(); x.beginPath(); x.arc(cx, by, R, 0, 7); x.clip(); x.translate(cx, by); x.rotate(-(h.roll || 0) * D2R);
    const py = (h.pitch || 0) * k; x.fillStyle = '#3d6fa8'; x.fillRect(-2 * R, -3 * R + py, 4 * R, 3 * R); x.fillStyle = '#5b4026'; x.fillRect(-2 * R, py, 4 * R, 3 * R);
    x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.moveTo(-2 * R, py); x.lineTo(2 * R, py); x.stroke(); x.lineWidth = 1.5;
    for (let p = -30; p <= 30; p += 10) { if (!p) continue; const y = py - p * k, w = R * .32; x.beginPath(); x.moveTo(-w, y); x.lineTo(w, y); x.stroke(); }
    x.restore(); x.strokeStyle = '#FFB347'; x.lineWidth = 3; x.beginPath(); x.moveTo(cx - R * .55, by); x.lineTo(cx - R * .15, by); x.lineTo(cx, by + R * .12); x.lineTo(cx + R * .15, by); x.lineTo(cx + R * .55, by); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.5)'; x.lineWidth = 1; x.beginPath(); x.arc(cx, by, R, 0, 7); x.stroke();
    // speed (left) and altitude (right) boxes with small scales
    // speed (left) and altitude (right) columns: a moving scale, the value in a box over its middle, the unit on top
    const ias = (h.ias || 0) * KT, alt = (h.altMSL || 0) * FT, sx = cx - R - 66, ax = cx + R + 70;
    const scale = (bx, v, step, lab, side) => { x.save(); x.beginPath(); x.rect(bx - 48, by - R, 96, 2 * R); x.clip(); x.strokeStyle = '#C9D1DB'; x.lineWidth = 1;
      for (let s = Math.floor((v - 3 * step) / step) * step; s <= v + 3 * step; s += step) { if (s < 0 && side < 0) continue; const y = by - (s - v) / step * R / 3;
        x.beginPath(); x.moveTo(bx - side * 46, y); x.lineTo(bx - side * 40, y); x.stroke(); txt(lab(s), bx - side * 37, y, { a: side > 0 ? 'left' : 'right', s: 12, c: '#AEB8C4' }); }
      x.restore(); };
    scale(sx, ias, 10, s => String(s), 1); scale(ax, alt, 100, s => fmt(s, 0), -1);
    const box = (bx, s, u, w) => { x.fillStyle = '#05080c'; x.strokeStyle = '#39FF9E'; x.lineWidth = 1.5; x.beginPath(); x.roundRect(bx - w / 2, by - 13, w, 26, 5); x.fill(); x.stroke();
      txt(s, bx, by, { a: 'center', s: 16, w: 700, mono: true }); txt(u, bx, by - R - 10, { a: 'center', s: 12, c: '#AEB8C4' }); };
    box(sx, fmt(ias, 0), 'IAS kt', 64); box(ax, fmt(alt, 0), 'ALT ft', 84);
    // heading scale on top of the ball, the heading itself in a box at its middle
    const hd = h.heading || 0, ty = by - R - 16; x.save(); x.beginPath(); x.rect(cx - 90, ty - 14, 180, 28); x.clip();
    for (let a = Math.floor((hd - 30) / 10) * 10; a <= hd + 30; a += 10) { const xx = cx + (a - hd) * 3; x.strokeStyle = '#C9D1DB'; x.beginPath(); x.moveTo(xx, ty + 9); x.lineTo(xx, ty + 14); x.stroke();
      if (Math.abs(a - hd) > 8) txt(pad(((a % 360) + 360) % 360, 3), xx, ty, { a: 'center', s: 12, c: '#C9D1DB' }); }
    x.restore(); x.fillStyle = '#05080c'; x.beginPath(); x.roundRect(cx - 24, ty - 10, 48, 20, 4); x.fill(); txt(pad(Math.round(hd) % 360, 3) + '°', cx, ty, { a: 'center', s: 14, w: 700, c: '#39FF9E' });
    // numbers left / right (below the ball on narrow screens)
    const L = [['M', fmt(h.mach, 2)], ['G', fmt(h.g, 1)], ['AOA', fmt(h.aoa, 1) + '°']], Rr = [['VS', fmt((h.vs || 0) * FT * 60, 0) + ' ft/min'], ['AGL', fmt((h.agl || 0) * FT, 0) + ' ft'], ['THR', fmt((h.throttle || 0) * 100, 0) + ' %' + (h.ab ? ' AB' : '')]];
    // S6: GFS mean wind (from / kt) and its crosswind (L / R = from the left / right) and head / tail component, in kt
    if (h.wind) { const W = h.wind, KT = 1.943844; L.push(['WIND', pad(Math.round(W.from) % 360, 3) + '°/' + fmt(W.spd * KT, 0)]);
      Rr.push(['XW', (W.cross >= 0 ? 'R ' : 'L ') + fmt(Math.abs(W.cross) * KT, 0) + (W.head >= 0 ? ' H ' : ' T ') + fmt(Math.abs(W.head) * KT, 0) + ' kt']); }
    const y0 = compact ? by + R + 26 : by - 24, lx = compact ? px + 14 : px + 16, rx = px + pw - 14;
    L.forEach(([k2, v], i) => { txt(k2, lx, y0 + i * 24, { c: '#9AA4B2', s: 12 }); txt(v, lx + 38, y0 + i * 24, { s: 15, w: 700, mono: true }); });
    Rr.forEach(([k2, v], i) => { txt(k2, rx - (compact ? 150 : 140), y0 + i * 24, { c: '#9AA4B2', s: 12 }); txt(v, rx, y0 + i * 24, { a: 'right', s: 15, w: 700, mono: true }); });
    const flags = [h.stall && 'STALL', h.crash && 'CRASH: ' + h.crash, h.park && 'PARKING BRAKE', h.onGround && 'ON GROUND'].filter(Boolean).join(' · ');
    if (flags) txt(flags, cx, by + R + 18, { a: 'center', s: 13, w: 700, c: h.crash || h.stall ? '#FF6B6B' : '#FFB347' }); }

  // ── spacecraft: navball + orbit data
  const nb = document.createElement('canvas'), nx = nb.getContext('2d'); let nbAt = 0, nbImg = null;
  function navball(s, R) {   // per pixel: view direction on the ball (centre = nose) -> frame I -> local sky / ground + a 30° / 15° grid
    const n = Math.round(2 * R * dpr); if (nb.width !== n) { nb.width = nb.height = n; nbImg = nx.createImageData(n, n); }
    const t0 = performance.now(), d = nbImg.data, up = unit(s.r), pole = s.ref === 'Earth' ? POLE_E : [0, 0, 1];
    let east = cross(pole, up); if (len(east) < 1e-6) east = cross([1, 0, 0], up); east = unit(east); const north = cross(up, east);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const u = (2 * (i + .5) / n - 1), v = (1 - 2 * (j + .5) / n), r2 = u * u + v * v, k = (j * n + i) * 4;
      if (r2 > 1) { d[k + 3] = 0; continue; }
      const z = Math.sqrt(1 - r2), dI = qrot(s.q, [u, v, -z]), el = Math.asin(clamp(dot(dI, up), -1, 1)) / D2R, az = Math.atan2(dot(dI, east), dot(dI, north)) / D2R;
      const sky = el >= 0, shade = .55 + .45 * z, gl = (Math.abs(el % 15) < .9 || Math.abs(Math.abs(el % 15) - 15) < .9) || (Math.abs(az % 30) < 1.2 / Math.max(.2, Math.cos(el * D2R)) && Math.abs(el) < 80);
      let rC = sky ? 70 : 150, gC = sky ? 140 : 96, bC = sky ? 210 : 52; if (Math.abs(el) < .8) { rC = gC = bC = 245; } else if (gl) { rC = rC * .62 + 90; gC = gC * .62 + 90; bC = bC * .62 + 90; }
      d[k] = rC * shade; d[k + 1] = gC * shade; d[k + 2] = bC * shade; d[k + 3] = 255; }
    nx.putImageData(nbImg, 0, 0); stats.nbMs += (performance.now() - t0 - stats.nbMs) * .1; }
  function marker(s, R, cx, cy, vI, kind) { const b = qrot(qconj(s.q), unit(vI)); if (b[2] > 0) return; const px = cx + b[0] * R, py = cy - b[1] * R;
    const col = { pro: '#FFE066', retro: '#FFE066', normal: '#E07CFF', anti: '#E07CFF', radial: '#5FE3FF', antirad: '#5FE3FF', node: '#4D9BFF' }[kind];
    x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 2.5; x.beginPath();
    if (kind === 'pro' || kind === 'node') { x.arc(px, py, 7, 0, 7); x.moveTo(px - 7, py); x.lineTo(px - 13, py); x.moveTo(px + 7, py); x.lineTo(px + 13, py); x.moveTo(px, py - 7); x.lineTo(px, py - 13); }
    else if (kind === 'retro') { x.arc(px, py, 7, 0, 7); x.moveTo(px - 5, py - 5); x.lineTo(px + 5, py + 5); x.moveTo(px + 5, py - 5); x.lineTo(px - 5, py + 5); }
    else if (kind === 'normal' || kind === 'anti') { x.moveTo(px, py - 8); x.lineTo(px + 7, py + 5); x.lineTo(px - 7, py + 5); x.closePath(); if (kind === 'anti') { x.moveTo(px, py + 2); x.arc(px, py, 2, 0, 7); } }
    else { x.arc(px, py, 7, 0, 7); x.moveTo(px, py - 3); x.arc(px, py, 3, 0, 7); if (kind === 'antirad') { x.moveTo(px - 10, py); x.lineTo(px - 7, py); x.moveTo(px + 7, py); x.lineTo(px + 10, py); } }
    x.stroke(); }
  function space(h) { const s = core.state, ctx = o.ctx || {}, N = ctx.node, R = Math.min(70, W * .13), cx = W / 2, cy = H - R - 26, pw = Math.min(W - 24, 640), px = cx - pw / 2;
    plate(px, cy - R - 14, pw, 2 * R + 28);
    const now = performance.now(); if (now - nbAt > 33) { nbAt = now; navball(s, R); } x.drawImage(nb, cx - R, cy - R, 2 * R, 2 * R);
    x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 1; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.stroke();
    const v = s.v, r = s.r, hh = cross(r, v), rad = unit(cross(v, hh));
    if (len(v) > 1) { marker(s, R, cx, cy, v, 'pro'); marker(s, R, cx, cy, v.map(a => -a), 'retro'); marker(s, R, cx, cy, hh, 'normal'); marker(s, R, cx, cy, hh.map(a => -a), 'anti'); marker(s, R, cx, cy, rad, 'radial'); marker(s, R, cx, cy, rad.map(a => -a), 'antirad'); }
    if (N && (N.rem || N.dvI) && N.phase !== 'done') marker(s, R, cx, cy, N.phase === 'burn' && N.rem ? N.rem : N.dvI, 'node');
    x.strokeStyle = '#FFB347'; x.lineWidth = 3; x.beginPath(); x.moveTo(cx - 18, cy); x.lineTo(cx - 6, cy); x.lineTo(cx, cy + 6); x.lineTo(cx + 6, cy); x.lineTo(cx + 18, cy); x.stroke();
    // orbit data (left) and burn / delta-v / time (right)
    const L = [['Around', h.ref || '–'], ['Altitude', km(h.altRef) + ' km'], ['Speed', fmt(h.vOrb, 0) + ' m/s'], ['Ap', km(h.apo) + ' km · ' + dur(h.tApo)], ['Pe', km(h.peri) + ' km · ' + dur(h.tPeri)],
      ['Period', isFinite(h.period) ? dur(h.period) : 'open orbit'], ['Incl.', fmt(h.inc, 1) + '° · e ' + fmt(h.ecc, 3)]];
    const lx = px + 12, rx = cx + R + 16, ly = cy - R + 2, step = (2 * R - 4) / 6;
    L.forEach(([k2, v2], i) => { txt(k2, lx, ly + i * step, { c: '#9AA4B2', s: 12 }); txt(v2, cx - R - 12, ly + i * step, { a: 'right', s: 13, w: 700, mono: true }); });
    const B = h.burn, tl = B ? (B.phase === 'burn' ? 'burning' : 'in ' + dur((B.tStart - s.t) / 1e3)) : 'no node';
    const Rr = [['Δv left', fmt(h.dvLeft, 0) + ' m/s'], ['Node Δv', B ? fmt(B.dv, 1) + ' m/s' : '–'], ['Burn', B ? dur(B.dur) + ' · ' + tl : tl], ['Throttle', fmt((h.throttle || 0) * 100, 0) + ' %'],
      ['Attitude', (ctx.sas || 'off').toUpperCase()], ['Time', '×' + fmt(h.warp, 0) + (h.onRails ? ' on rails' : '')], ['Next SOI', h.soiNext ? h.soiNext.body + ' · ' + dur((h.soiNext.t - s.t) / 1e3) : '–']];
    Rr.forEach(([k2, v2], i) => { txt(k2, rx, ly + i * step, { c: '#9AA4B2', s: 12 }); txt(v2, px + pw - 12, ly + i * step, { a: 'right', s: 13, w: 700, mono: true, c: k2 === 'Burn' && B && B.phase === 'burn' ? '#FFB347' : '#E6EBF1' }); }); }

  function update() { if (!stats.on || core.hold) { if (cv.width) { x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height); } return; }
    const t0 = performance.now(); size(); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    const hide = (o.hideInView || []).includes(core.view) && core.def.views[core.view] && !o.forceShow;
    if (!hide) (o.kind === 'space' ? space : air)(core.hud);
    stats.ms += (performance.now() - t0 - stats.ms) * .05; stats.frames++; }
  return { canvas: cv, update, stats, set on(v) { stats.on = !!v; }, get on() { return stats.on; }, dispose() { cv.remove(); } };
}
