/* PowHau · active regions + flares on the Sun — shared by noaa/aurora.html (app, space weather R tab) and web/aurora (public page, chapter 1).
   NOAA SWPC (CORS *): json/solar_regions.json (daily region report, ~2 weeks of history per region), json/edited_events.json (a month of
   GOES X-ray events XRA with their region + optical flares FLA with exact positions), json/solar_probabilities.json (whole-Sun chances).
   Positions: NOAA's daily locations match the next 00 UTC; a region's newest optical flare (< 2 days) is used instead when there is one,
   then rotated to "now" at ~13.2°/day. Images: latest SDO stills copied by the Pages bot (enlil branch), HMI colour straight from NASA. */
(function () {
  'use strict';
  const NO = 'https://services.swpc.noaa.gov', SB = 'https://raw.githubusercontent.com/ori0nori0ff/ori0nori0ff.github.io/enlil/sun/';
  const tr = (t, o) => window.T ? window.T(t, o) : String(t).replace(/\{(\w+)\}/g, (m, k) => o && o[k] != null ? o[k] : m);
  const D2R = Math.PI / 180, ROT = 13.2 / 864e5, DAY = 864e5;
  // [id, label, disc radius / image width]
  const FILT = [['HMIIC', 'VISIBLE', .468], ['HMIBC', 'HMI COLOR', .468], ['0171', '171 Å', .393], ['0193', '193 Å', .393], ['0304', '304 Å', .393]];
  const imgUrl = id => id === 'HMIBC' ? 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIBC.jpg?h=' + Math.floor(Date.now() / 36e5) : SB + id + '.jpg?h=' + Math.floor(Date.now() / 36e5);
  const pos = s => { const m = /([NS])(\d+)([EW])(\d+)/.exec(s || ''); return m ? [(m[1] === 'N' ? 1 : -1) * +m[2], (m[3] === 'W' ? 1 : -1) * +m[4]] : null; };
  const utc = s => Date.parse(/Z$/.test(s) ? s : s + 'Z');
  // solar B0: the Sun's equator tilts up to 7.25° towards / away from us during the year
  function B0(t) { const d = t / DAY - 10957.5, L = 280.46 + .9856474 * d, g = (357.528 + .9856003 * d) * D2R, lam = L + 1.915 * Math.sin(g) + .02 * Math.sin(2 * g), om = 73.6667 + 1.3958 * (d / 36525 + 50);
    return Math.asin(Math.sin((lam - om) * D2R) * Math.sin(7.25 * D2R)); }
  // heliographic lat / lon (west +, from the central meridian) → disc x, y (−1…1, north up, west right), z > 0 = on our side
  function xy(lat, lon, b0) { lat *= D2R; lon *= D2R; return [Math.cos(lat) * Math.sin(lon), Math.sin(lat) * Math.cos(b0) - Math.cos(lat) * Math.cos(lon) * Math.sin(b0), Math.cos(lat) * Math.cos(lon) * Math.cos(b0) + Math.sin(lat) * Math.sin(b0)]; }
  const magW = m => (m || '').replace('A', 'α').replace('B', 'β').replace('G', 'γ').replace('D', 'δ');
  const fcol = c => c[0] === 'X' ? '#FF4444' : c[0] === 'M' ? '#FFA040' : '#FFE600';
  const risk = r => r.m >= 30 || /D/.test(r.mag) ? ['#FF4444', tr('HIGH')] : r.m >= 10 || /G/.test(r.mag) ? ['#FFA040', tr('MEDIUM')] : ['#6EE7A0', tr('QUIET')];
  const EARTH = 30;   // ° from the central meridian: a flare here can send its CME our way

  let cache = null, cacheT = 0;
  async function load() {
    if (cache && Date.now() - cacheT < 10 * 60e3) return cache;
    const j = u => fetch(NO + u).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    const [reg, ev, pr] = await Promise.all([j('/json/solar_regions.json'), j('/json/edited_events.json').catch(() => []), j('/json/solar_probabilities.json').catch(() => [])]);
    const hist = {};   // region → [[t, lat, lon]] (NOAA daily positions + optical flares)
    reg.forEach(r => { const p = pos(r.location); if (p) (hist[r.region] = hist[r.region] || []).push([utc(r.observed_date + 'T00:00:00') + DAY, p[0], p[1]]); });
    const fla = ev.filter(e => e.type === 'FLA' && e.region && pos(e.location));
    fla.forEach(e => { const p = pos(e.location); (hist[e.region] = hist[e.region] || []).push([utc(e.begin_datetime), p[0], p[1], 1]); });
    const at = (id, t) => {   // where region id was at time t (closest fix, optical flares preferred, rotated)
      const h = hist[id]; if (!h) return null;
      let best = null, bd = 1e15; h.forEach(f => { const d = Math.abs(f[0] - t) * (f[3] ? .5 : 1); if (d < bd) { bd = d; best = f; } });
      return best && bd < 4 * DAY ? [best[1], best[2] + ROT * (t - best[0])] : null; };
    const last = reg.reduce((a, r) => r.observed_date > a ? r.observed_date : a, '');
    const now = Date.now();
    const regions = reg.filter(r => r.observed_date === last).map(r => ({ id: r.region, area: r.area || 0, cls: r.spot_class, mag: r.mag_class || '', n: r.number_spots,
      c: r.c_flare_probability || 0, m: r.m_flare_probability || 0, x: r.x_flare_probability || 0, first: r.first_date }));
    // X-ray flares (GOES), one per event (NOAA lists updates of the same event), C and up
    const seen = {}, flares = [];
    ev.filter(e => e.type === 'XRA' && /^[CMX]/.test(e.particulars1 || '')).forEach(e => { const k = e.begin_datetime;
      if (seen[k]) { if (e.particulars1 > seen[k].cls) seen[k].cls = e.particulars1; return; }
      const t = utc(e.begin_datetime), o = fla.find(f => f.region === e.region && Math.abs(utc(f.begin_datetime) - t) < 30 * 60e3);
      const p = o ? pos(o.location) : e.region ? at(e.region, t) : null;
      flares.push(seen[k] = { t, peak: e.max_datetime ? utc(e.max_datetime) : t, cls: e.particulars1, region: e.region || null, lat: p ? p[0] : null, lon: p ? p[1] : null }); });
    flares.forEach(f => f.earth = f.lon != null && Math.abs(f.lon) < EARTH);
    regions.forEach(r => { const p = at(r.id, now); r.lat = p ? p[0] : null; r.lon = p ? p[1] : null; r.fl = flares.filter(f => f.region === r.id && now - f.t < DAY); });
    regions.sort((a, b) => (b.m * 3 + b.c * .2 + b.area / 50 + b.fl.length * 4) - (a.m * 3 + a.c * .2 + a.area / 50 + a.fl.length * 4));
    cache = { regions, flares, prob: pr[0] || null, at, t: now }; cacheT = now;
    return cache;
  }

  // ── coronal holes: the darkest areas of GOES-19 SUVI 195 Å (NOAA, CORS *, every 4 min). NOAA's own thematic map (suvi-primary-map)
  // often labels obvious holes "quiet Sun", so it's only used for the disc size and to drop its filaments (also dark, but thin).
  let hc = null, hcT = 0;
  async function holes() {
    if (hc && Date.now() - hcT < 10 * 60e3) return hc;
    const last = async w => { const a = await fetch(NO + '/products/animations/suvi-primary-' + w + '.json').then(r => r.json()); return NO + a[a.length - 1].url; };
    const ld = u => new Promise((ok, no) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = no; i.src = u; });
    const [u195, um] = await Promise.all([last('195'), last('map')]), [i195, im] = await Promise.all([ld(u195), ld(um)]);
    const m = /_s(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)/.exec(u195), t = m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : Date.now();
    const S = 640, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(i195, 0, 0, S, S);
    const px = x.getImageData(0, 0, S, S).data, cx = S / 2, cy = S / 2;
    // thematic map 1600×1280 with the same plate scale and centre as the 1280² composite → at 800×640 it matches our 640² copy
    const mc = document.createElement('canvas'); mc.width = 800; mc.height = 640; const mx = mc.getContext('2d', { willReadFrequently: true }); mx.drawImage(im, 0, 0, 800, 640); const mp = mx.getImageData(0, 0, 800, 640).data;
    let l = 0, r = 799; while (l < 400 && mp[(320 * 800 + l) * 4 + 2] < 60) l++; while (r > 400 && mp[(320 * 800 + r) * 4 + 2] < 60) r--;
    const RR = (r - l) / 2 * .985, mcx = (l + r) / 2;   // the off-limb prominence band makes the map disc a little wider
    if (!(RR > 120 && RR < 260)) throw new Error('SUVI disc');
    const lum = new Float32Array(S * S), on = [];
    for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) { const d = Math.hypot(xx - cx, yy - cy) / RR, k = yy * S + xx;
      if (d < .96) { const i = k * 4, v = px[i] * .3 + px[i + 1] * .55 + px[i + 2] * .15; lum[k] = v; on.push(v); } else lum[k] = -1; }
    on.sort((a, b) => a - b); const thr = on[on.length >> 1] * .55;
    // 4-px cells: "hole" when ≥ 60 % of the pixels are darker than 55 % of the disc median (thin filaments drop out, NOAA filaments removed)
    const G = 4, N = S / G, mask = new Uint8Array(N * N);
    for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) { let dark = 0, tot = 0, fil = 0;
      for (let yy = gy * G; yy < gy * G + G; yy++) for (let xx = gx * G; xx < gx * G + G; xx++) { const v = lum[yy * S + xx]; if (v < 0) continue; tot++; if (v < thr) dark++;
        const k = (Math.round(320 + (yy - cy)) * 800 + Math.round(mcx + (xx - cx))) * 4; if (Math.abs(mp[k] - 213) < 30 && Math.abs(mp[k + 1] - 94) < 30 && mp[k + 2] < 40) fil++; }
      mask[gy * N + gx] = tot > 8 && dark / tot >= .6 && fil < tot * .3 ? 1 : 0; }
    const lab = new Int32Array(N * N), disc = Math.PI * (RR / G) ** 2, b0 = B0(t), list = []; let id = 0;
    for (let s = 0; s < N * N; s++) { if (!mask[s] || lab[s]) continue; id++; const st = [s], cells = []; lab[s] = id;
      while (st.length) { const c0 = st.pop(); cells.push(c0); const gx = c0 % N, gy = (c0 / N) | 0;
        for (let ay = -1; ay <= 1; ay++) for (let ax = -1; ax <= 1; ax++) { const nx = gx + ax, ny = gy + ay, n = ny * N + nx; if (nx >= 0 && ny >= 0 && nx < N && ny < N && mask[n] && !lab[n]) { lab[n] = id; st.push(n); } } }
      if (cells.length < disc * .0025) { cells.forEach(c0 => { lab[c0] = 0; }); continue; }
      let sx = 0, sy = 0, area = 0; cells.forEach(c0 => { const X = ((c0 % N + .5) * G - cx) / RR, Y = (cy - (((c0 / N) | 0) + .5) * G) / RR; sx += X; sy += Y; area += 1 / Math.max(.2, Math.sqrt(Math.max(0, 1 - X * X - Y * Y))); });
      const X = sx / cells.length, Y = sy / cells.length, Z = Math.sqrt(Math.max(0, 1 - X * X - Y * Y));
      const lat = Math.asin(Y * Math.cos(b0) + Z * Math.sin(b0)) / D2R, lon = Math.atan2(X, Z * Math.cos(b0) - Y * Math.sin(b0)) / D2R;
      list.push({ lab: id, lat, lon, X, Y, pct: area / (2 * disc) * 100, tcm: t - lon / ROT }); }   // tcm = when its centre crosses the middle of the Sun
    list.sort((a, b) => b.pct - a.pct); list.forEach((h, i) => { h.id = i + 1; });
    const keep = new Map(list.map(h => [h.lab, h])), cellsOf = new Int16Array(N * N);   // cell → hole id
    for (let s = 0; s < N * N; s++) { const h = keep.get(lab[s]); cellsOf[s] = h ? h.id : 0; }
    hc = { t, list, N, cell: G / RR, cells: cellsOf, cx: cx / RR, cy: cy / RR }; hcT = Date.now();
    return hc;
  }
  // a GOES flare (xray-flares-7-day row) → our flare with region + position, matched by start time
  function flareInfo(D, begin) { const t = utc(begin); let b = null; D.flares.forEach(f => { if (Math.abs(f.t - t) <= 4 * 60e3 && (!b || Math.abs(f.t - t) < Math.abs(b.t - t))) b = f; }); return b; }
  const where = f => f.lat == null ? '' : `${f.lat < 0 ? 'S' : 'N'}${String(Math.abs(Math.round(f.lat))).padStart(2, '0')}${f.lon < 0 ? 'E' : 'W'}${Math.abs(f.lon) >= 89 ? ' ' + tr('LIMB') : String(Math.abs(Math.round(f.lon))).padStart(2, '0')}`;   // just behind the edge: X-rays still reach us

  const CSS = `.sr-bar{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}.sr-sep{flex:0 0 6px}.sr-bar::-webkit-scrollbar{display:none}
.sr-b{flex:none;font:700 10.5px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.05em;color:#C9D1DB;background:none;border:1px solid #3A414D;border-radius:99px;padding:8px 10px;cursor:pointer}
.sr-b[aria-pressed=true]{background:#FFE600;color:#0A0A0A;border-color:#FFE600}.sr-b:focus-visible{outline:2px solid #FFE600;outline-offset:2px}
.sr-box{position:relative;width:100%;aspect-ratio:1;background:#000;border-radius:10px;overflow:hidden;max-width:560px;margin:0 auto}.sr-box img,.sr-box canvas{position:absolute;inset:0;width:100%;height:100%}
.sr-meta{font:10.5px 'JetBrains Mono',ui-monospace,monospace;color:#8E9AAB;margin-top:6px;letter-spacing:.04em}
.sr-sum{font-size:13px;color:#A3B0C2;margin:10px 0 2px}.sr-sum b{font-weight:700}
.sr-rg{display:grid;grid-template-columns:52px 1fr auto;gap:2px 10px;padding:9px 6px;border-top:1px solid #1E232B;cursor:pointer;border-radius:8px;width:100%;text-align:left;background:none;color:inherit;font:inherit;border-left:0;border-right:0;border-bottom:0}
.sr-rg:first-child{border-top:0}.sr-rg.on{background:#1A1F27}.sr-n{font:700 14px 'JetBrains Mono',ui-monospace,monospace}
.sr-p{font:700 10px 'JetBrains Mono',ui-monospace,monospace;padding:3px 7px;border-radius:99px;white-space:nowrap;align-self:start}
.sr-s{grid-column:2/4;color:#8E9AAB;font-size:12px}.sr-t{font-size:13px}.sr-more{font:700 10.5px 'JetBrains Mono',ui-monospace,monospace;color:#7BE0FF;background:none;border:0;padding:8px 6px;cursor:pointer}
.sr-h{font:700 10.5px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#8E9AAB;margin:14px 0 2px}
.sr-lg{display:flex;flex-wrap:wrap;gap:4px 12px;font:10.5px 'JetBrains Mono',ui-monospace,monospace;color:#A3B0C2;margin-top:8px}.sr-lg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}`;

  /** mount(el, {limit}) → { select(regionId), refresh() } — the disc with the overlay + the region list */
  function mount(el, o) {
    o = o || {};
    if (!document.getElementById('srCss')) { const s = document.createElement('style'); s.id = 'srCss'; s.textContent = CSS; document.head.appendChild(s); }
    let F = 0, D = null, HO = null, sel = null, selH = null, mk = true, ch = true, zone = true, all = false;
    el.innerHTML = `<div class="sr-l"><div class="sr-bar">${FILT.map((f, i) => `<button class="sr-b" data-f="${i}" aria-pressed="${i === F}">${tr(f[1])}</button>`).join('')}
      <span class="sr-sep"></span><button class="sr-b" data-k="mk" aria-pressed="true">◎ ${tr('REGIONS')}</button><button class="sr-b" data-k="ch" aria-pressed="true">◐ ${tr('CORONAL HOLES')}</button><button class="sr-b" data-k="zone" aria-pressed="true">↯ ${tr('EARTH-FACING')}</button></div>
      <div class="sr-box"><img alt="${tr('The Sun now with its active regions')}"><canvas role="img" aria-label="${tr('Active regions and flares of the last 24 hours on the Sun')}"></canvas></div>
      <div class="sr-meta">${tr('LOADING…')}</div>
      <div class="sr-lg"><span><i style="background:#FFE600"></i>${tr('C flare')}</span><span><i style="background:#FFA040"></i>${tr('M flare')}</span><span><i style="background:#FF4444"></i>${tr('X flare')}</span><span><i style="background:#3EE08F"></i>${tr('coronal hole')}</span><span><i style="background:#7BE0FF;opacity:.6"></i>${tr('faces Earth')}</span></div></div><div class="sr-r">
      <div class="sr-sum"></div><div class="sr-list"></div><div class="sr-h">${tr('CORONAL HOLES · FAST SOLAR WIND')}</div><div class="sr-holes"><div class="sr-s">${tr('LOADING…')}</div></div><div class="sr-x"></div></div>`;
    const q = s => el.querySelector(s), im = q('img'), cv = q('canvas'), g = cv.getContext('2d');
    el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { F = +b.dataset.f; el.querySelectorAll('[data-f]').forEach(x => x.setAttribute('aria-pressed', +x.dataset.f === F)); im.src = imgUrl(FILT[F][0]); });
    el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { const kk = b.dataset.k; if (kk === 'mk') mk = !mk; else if (kk === 'ch') ch = !ch; else zone = !zone; b.setAttribute('aria-pressed', kk === 'mk' ? mk : kk === 'ch' ? ch : zone); draw(); });
    im.onload = draw; im.onerror = () => { q('.sr-meta').textContent = tr('No image from NASA right now.'); };
    im.src = imgUrl(FILT[F][0]);
    function list() {
      if (!D) return; const now = Date.now(), rs = all || !o.limit ? D.regions : D.regions.slice(0, o.limit);
      q('.sr-list').innerHTML = rs.map(r => { const [c, w] = risk(r), lon = r.lon, side = lon == null ? '' : Math.abs(lon) < EARTH ? ` · <b style="color:#7BE0FF">↯ ${tr('faces Earth')}</b>` : lon > 70 ? ` · ${tr('leaving over the edge')}` : lon < -70 ? ` · ${tr('just turned into view')}` : '';
        return `<button class="sr-rg${sel === r.id ? ' on' : ''}" data-id="${r.id}"><span class="sr-n" style="color:${c}">${r.id}</span><span class="sr-t">${r.cls ? magW(r.mag) + ' · ' + (r.n === 1 ? tr('1 spot') : tr('{n} spots', { n: r.n || '?' })) : tr('bright patch, no spots')}${side}</span>
          <span class="sr-p" style="color:${c};border:1px solid ${c}66">M ${r.m}% · ${w}</span>
          <span class="sr-s">${r.fl.length ? tr('Flares 24 h:') + ' ' + r.fl.map(f => `<b style="color:${fcol(f.cls)}">${f.cls}</b>`).join(' ') : tr('no flares in 24 h')}${r.area ? ' · ' + tr('size {a} MSH', { a: r.area }) : ''}</span></button>`; }).join('')
        + (o.limit && D.regions.length > o.limit ? `<button class="sr-more">${all ? tr('SHOW FEWER') : tr('ALL {n} REGIONS ›', { n: D.regions.length })}</button>` : '');
      const p = D.prob, n24 = D.flares.filter(f => now - f.t < DAY).length;
      holeList();
      q('.sr-sum').innerHTML = (p ? tr('Whole Sun, next 24 h: M flare <b style="color:#FFA040">{m}%</b> · X flare <b style="color:#FF4444">{x}%</b>', { m: p.m_class_1_day, x: p.x_class_1_day }) + ' · ' : '') + tr('{n} C/M/X flares in the last 24 h', { n: n24 });
    }
    function holeList() {
      if (!HO) return; const day = t => new Date(t).toLocaleDateString(window.LOC || 'en-GB', { day: 'numeric', month: 'short' }), now = Date.now();
      if (HO.err) { q('.sr-holes').innerHTML = `<div class="sr-s">${tr('No SUVI image from NOAA right now.')}</div>`; return; }
      q('.sr-holes').innerHTML = !HO.list.length ? `<div class="sr-s">${tr('No large coronal hole on the visible side now.')}</div>` : HO.list.map(h => {
        const a0 = h.tcm + 2 * DAY, a1 = h.tcm + 4 * DAY, polar = Math.abs(h.lat) > 50;   // fast wind reaches us ~2–4 days after the hole crosses the middle
        const [c, w] = a1 < now ? ['#8E9AAB', tr('PASSED')] : Math.abs(h.lon) < EARTH ? ['#7BE0FF', '↯ ' + tr('FACES EARTH')] : ['#FFE600', tr('TURNING TOWARDS US')];
        const s = polar ? tr('far from the equator: little effect at Earth') : a1 < now ? tr('its fast wind has already passed') : tr('fast wind at Earth around <b>{a} – {b}</b>', { a: day(a0), b: day(a1) });
        return `<button class="sr-rg${selH === h.id ? ' on' : ''}" data-ch="${h.id}"><span class="sr-n" style="color:#3EE08F">CH${h.id}</span><span class="sr-t">${where(h)} · ${tr('{p}% of the disc', { p: h.pct.toFixed(1) })}${polar ? ' · ' + tr('polar hole') : ''}</span>
          <span class="sr-p" style="color:${c};border:1px solid ${c}66">${w}</span><span class="sr-s">${s}</span></button>`; }).join('');
    }
    el.addEventListener('click', e => { const hb = e.target.closest('[data-ch]'); if (hb) { selH = +hb.dataset.ch === selH ? null : +hb.dataset.ch; holeList(); draw(); return; }
      const r = e.target.closest('.sr-rg'); if (r) { sel = +r.dataset.id === sel ? null : +r.dataset.id; list(); draw(); }
      if (e.target.closest('.sr-more')) { all = !all; list(); } });
    function draw() {
      const k = window.devicePixelRatio || 1, W = cv.width = Math.round(cv.clientWidth * k), H = cv.height = W; if (!W) return;
      const rr = FILT[F][2] * W, cx = W / 2, cy = H / 2, now = Date.now(), b0 = B0(now), mono = "'JetBrains Mono', ui-monospace, monospace";
      g.clearRect(0, 0, W, H);
      if (!D) return;
      q('.sr-meta').textContent = `SDO ${FILT[F][0]} · NOAA SWPC · ${D.regions.length} ${tr('regions')}`;
      const P = (lat, lon) => { const [x, y, z] = xy(lat, lon, b0); return [cx + x * rr, cy - y * rr, z]; };
      if (zone) {
        g.save(); g.beginPath(); g.arc(cx, cy, rr, 0, 2 * Math.PI); g.clip();
        const edge = s => { const a = []; for (let la = -90; la <= 90; la += 3) a.push(P(la, s * EARTH)); return a; }, a = edge(-1), b = edge(1).reverse();
        g.fillStyle = 'rgba(123,224,255,.10)'; g.beginPath(); [...a, ...b].forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(123,224,255,.5)'; g.lineWidth = 1.2 * k; g.setLineDash([5 * k, 5 * k]); [a, b].forEach(l => { g.beginPath(); l.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); });
        g.restore(); g.setLineDash([]);
        g.font = `700 ${10.5 * k}px ${mono}`; g.fillStyle = '#7BE0FF'; g.textAlign = 'center'; g.fillText('↯ ' + tr('FACES EARTH'), cx, Math.min(H - 8 * k, cy + rr + 15 * k));
      }
      if (ch && HO && !HO.err) {   // SUVI cells → this image (both near-Earth views, north up, centred: only the scale differs)
        const N = HO.N, cs = HO.cell * rr, C = HO.cells, x0 = cx - HO.cx * rr, y0 = cy - HO.cy * rr;
        for (let s = 0; s < N * N; s++) { const id = C[s]; if (!id) continue; const x = x0 + (s % N) * cs, y = y0 + ((s / N) | 0) * cs, on = selH === id;
          g.fillStyle = on ? 'rgba(62,224,143,.45)' : 'rgba(62,224,143,.2)'; g.fillRect(x, y, cs + .6, cs + .6); g.fillStyle = '#3EE08F'; const w = (on ? 2 : 1.2) * k;
          if (C[s + 1] !== id) g.fillRect(x + cs - w, y, w, cs); if (C[s - 1] !== id) g.fillRect(x, y, w, cs); if (C[s + N] !== id) g.fillRect(x, y + cs - w, cs, w); if (C[s - N] !== id) g.fillRect(x, y, cs, w); }
        g.font = `700 ${11 * k}px ${mono}`; g.textAlign = 'center';
        HO.list.forEach(h => { const x = cx + h.X * rr, y = cy - h.Y * rr, t = 'CH' + h.id, tw = g.measureText(t).width; g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(x - tw / 2 - 4 * k, y - 10 * k, tw + 8 * k, 15 * k); g.fillStyle = '#3EE08F'; g.fillText(t, x, y + 2 * k); });
      }
      if (!mk) return;
      D.flares.filter(f => now - f.t < DAY && f.lat != null).forEach(f => { const [px, py, z] = P(f.lat, f.lon + ROT * (now - f.t)); if (z < 0) return; const s = (f.cls[0] === 'X' ? 13 : f.cls[0] === 'M' ? 10 : 7) * k;
        g.fillStyle = fcol(f.cls); g.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, d = i % 2 ? s * .42 : s; g.lineTo(px + d * Math.cos(a), py + d * Math.sin(a)); } g.closePath(); g.fill(); g.strokeStyle = '#000'; g.lineWidth = k; g.stroke(); });
      const used = [], free = (x, y, w, h) => !used.some(u => x < u[0] + u[2] && x + w > u[0] && y < u[1] + u[3] && y + h > u[1]);
      D.regions.forEach(r => { if (r.lat == null) return; const [px, py, z] = P(r.lat, r.lon); if (z < .05) return;
        const rad = Math.max(9, Math.sqrt(r.area) * 1.5) * k * Math.max(.5, z) * W / (560 * k) * 1.4, [c] = risk(r), on = sel === r.id;
        g.lineWidth = (on ? 3 : 1.7) * k; g.strokeStyle = c; g.setLineDash(r.cls ? [] : [3 * k, 3 * k]); g.beginPath(); g.arc(px, py, rad, 0, 2 * Math.PI); g.stroke(); g.setLineDash([]);
        const lab = r.id + (r.mag ? ' ' + magW(r.mag) : ''); g.font = `700 ${(on ? 12.5 : 11) * k}px ${mono}`; g.textAlign = 'left';
        const lw = g.measureText(lab).width, lh = (r.m >= 10 ? 27 : 15) * k; let tx = px + rad + 4 * k > cx + rr * .78 ? px - rad - 4 * k - lw : px + rad + 4 * k, ty = py;
        for (let i = 0; i < 12 && !free(tx - 3 * k, ty - 10 * k, lw + 6 * k, lh); i++) ty += (i % 2 ? -1 : 1) * (i + 1) * 9 * k;
        used.push([tx - 3 * k, ty - 10 * k, lw + 6 * k, lh]);
        if (ty !== py) { g.strokeStyle = c; g.lineWidth = k; g.beginPath(); g.moveTo(px, py); g.lineTo(tx - 3 * k, ty - 3 * k); g.stroke(); }
        g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(tx - 3 * k, ty - 10 * k, lw + 6 * k, lh); g.fillStyle = c; g.fillText(lab, tx, ty + 2 * k);
        if (r.m >= 10) { g.font = `700 ${9.5 * k}px ${mono}`; g.fillStyle = '#fff'; g.fillText('M ' + r.m + '%', tx, ty + 14 * k); } });
    }
    let ro; if (window.ResizeObserver) { ro = new ResizeObserver(() => draw()); ro.observe(cv); }
    const refresh = () => load().then(d => { D = d; list(); draw(); }).catch(() => { q('.sr-meta').textContent = tr('NOAA region data unavailable right now.'); });
    refresh();
    holes().then(h => { HO = h; holeList(); draw(); }).catch(() => { HO = { err: 1 }; holeList(); });
    return { refresh, select(id) { sel = id; list(); draw(); } };
  }
  window.SunRegions = { load, holes, mount, flareInfo, where };
})();
