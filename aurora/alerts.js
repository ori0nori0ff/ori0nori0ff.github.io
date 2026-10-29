/* Alerts on the PC board: what changed in space weather (since your last visit too), each one opens the tile it is about.
   Only NOAA SWPC (CORS *) + our own data/cme.json; polled while the page is open and visible. "Seen" / switches stay in
   localStorage on this device; browser notifications only after the user turns them on (permission asked on that click). */
(() => {
  const H = document.documentElement; if (!H.classList.contains('tiles')) return;
  const T = window.T || (s => s), API = 'https://services.swpc.noaa.gov/', storm = !!window.STORM;
  const $q = s => document.querySelector(s), esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const jget = (k, d) => { try { return JSON.parse(get(k)) || d; } catch (e) { return d; } };
  // kind → tile, colour, name in ⚙
  const KD = { flare: ['flares', '#FFB020', 'M / X flares'], radio: ['flares', '#FF8A3D', 'Radio blackouts R2+'], cme: ['sun', '#FFE600', 'CMEs heading to Earth'],
    aurora: ['forecast', '#39FF9E', 'Aurora for your place'], geo: ['forecast', '#FF5A5A', 'Geomagnetic storm alerts (G)'],
    wind: ['wind', '#7BE0FF', 'Solar wind jumps · Bz south'], proton: ['wind', '#C77DFF', 'Proton storms S1+'] };
  const TILE = { flares: 'Flares and coronal holes', sun: 'The Sun Now', forecast: 'NOAA Aurora Forecast', wind: 'Solar wind and storm levels' };
  const PK = 'aurora.alerts', SK = 'aurora.alSeen' + (storm ? '.storm' : '');
  let pref = jget(PK, {}), st = jget(SK, { seen: [], gone: [], last: 0 }), items = [], first = true;
  const savePref = () => put(PK, JSON.stringify(pref)), saveSt = () => { st.seen = st.seen.slice(-300); st.gone = st.gone.slice(-300); put(SK, JSON.stringify(st)); };
  const on = k => pref.on !== false && !(pref.off || []).includes(k);
  if (Date.now() - (st.last || 0) > 18e5) st.prev = st.last || 0;   // a new visit after 30 min away: remember when the one before ended
  const lastVisit = st.prev || 0; st.last = Date.now(); saveSt();
  setInterval(() => { st.last = Date.now(); saveSt(); }, 6e4);

  // the place (same rule as the page: link > picked on this device > Brașov) and the Kp it needs
  const place = () => { const q = new URLSearchParams(location.search);
    if (q.get('lat') && q.get('lon')) return { name: q.get('town') || T('Your place'), lat: +q.get('lat'), lon: +q.get('lon') };
    const l = jget('aurora.place', null); return l && isFinite(l.lat) ? l : { name: 'Brașov', lat: 45.6427, lon: 25.5887, tz: 'Europe/Bucharest' }; };
  const need = p => window.AuroraGlobe ? AuroraGlobe.kpNeed(p.lat, p.lon) : 7;
  const hourIn = (t, tz) => { try { return +new Date(t).toLocaleString('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }); } catch (e) { return new Date(t).getHours(); } };
  const j = u => fetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw r.status; return r.json(); });
  const utc = s => Date.parse(/Z$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  const med = a => { a = a.filter(v => v != null && isFinite(v)).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };

  // ── sources → items { id, k (kind), t (when), title, line }
  const src = {};
  async function fast() {
    const P = place(), N = need(P), now = Date.now(), out = [];
    await Promise.allSettled([
      j(API + 'json/goes/primary/xray-flares-7-day.json').then(fl => { const M = {};   // X flares one by one; M flares one line per UTC day
        fl.forEach(f => { const c = f.max_class || ''; if (!/^[MX]/.test(c)) return; const t = utc(f.max_time); if (now - t > 3 * 864e5 || t > now + 6e5) return;
          if (c[0] === 'X') return out.push({ id: 'fl:' + f.max_time, k: 'flare', t, title: T('{c} flare', { c }), line: T('A major flare: radio fades on the dayside, maybe a fast CME.') });
          const d = f.max_time.slice(0, 10), g = M[d] || (M[d] = { n: 0, t: 0, c: 'M0', v: 0 }); g.n++; g.t = Math.max(g.t, t); if (+f.max_xrlong > g.v) { g.v = +f.max_xrlong; g.c = c; } });
        Object.entries(M).forEach(([d, g]) => out.push({ id: 'flm:' + d + ':' + g.n, k: 'flare', t: g.t, title: g.n > 1 ? T('{n} M flares · biggest {c}', { n: g.n, c: g.c }) : T('{c} flare', { c: g.c }), line: T('A strong flare: short radio fades on the dayside.') })); }),
      j(API + 'products/noaa-scales.json').then(sc => { const n = sc['0'], t = utc(n.DateStamp + 'T' + n.TimeStamp), r = +n.R.Scale || 0, s = +n.S.Scale || 0;
        if (r >= 2) out.push({ id: 'r:' + n.DateStamp + ':' + r, k: 'radio', t, title: T('Radio blackout R{n}', { n: r }), line: T('Shortwave radio and GPS falter on the side of Earth facing the Sun.') });
        if (s >= 1) out.push({ id: 's:' + n.DateStamp + ':' + s, k: 'proton', t, title: T('Solar radiation storm S{n}', { n: s }), line: T('Fast protons from the Sun: a risk for satellites and polar flights.') }); }),
      j(API + 'products/alerts.json').then(al => al.slice().sort((a, b) => utc(b.issue_datetime) - utc(a.issue_datetime)).filter(a => /^(ALERT|WARNING|WATCH): Geomagnetic/m.test(a.message)).slice(0, 3).forEach(a => { const t = utc(a.issue_datetime); if (now - t > 2 * 864e5) return;
        const m = a.message.match(/^(ALERT|WARNING|WATCH): Geomagnetic[^\r\n]*/m); if (!m) return; const g = (a.message.match(/NOAA Scale: (G\d)/) || [])[1];
        out.push({ id: 'g:' + a.product_id + ':' + a.issue_datetime, k: 'geo', t, title: (g ? g + ' · ' : '') + m[0].replace(/\s+/g, ' ').slice(0, 80), line: T('From NOAA SWPC. Open the forecast to see what it means for your place.') }); })),
      Promise.all([j(API + 'products/noaa-planetary-k-index-forecast.json'), j(API + 'json/planetary_k_index_1m.json').catch(() => [])]).then(([fc, k1]) => {
        // observed in the last 2 days (the ones you may have missed), now, and tonight's forecast
        let best = null; fc.forEach(r => { const t = utc(r.time_tag), kp = +r.kp; if (r.observed === 'observed' && now - t < 2 * 864e5 && kp >= N && (!best || kp > best.kp)) best = { t, kp }; });
        if (best) out.push({ id: 'kpo:' + best.t, k: 'aurora', t: best.t, title: T('Kp {k} reached — enough for {p}', { k: best.kp.toFixed(1), p: P.name }), line: T('{p} needs Kp {n}. If the sky was clear and dark, the aurora could be seen.', { p: P.name, n: N }) });
        const l = k1[k1.length - 1]; if (l && +l.estimated_kp >= N) { const t = utc(l.time_tag);
          out.push({ id: 'kpn:' + Math.floor(t / 108e5), k: 'aurora', t, title: T('Kp {k} now — aurora possible from {p}', { k: (+l.estimated_kp).toFixed(1), p: P.name }), line: T('Look north from a dark place, away from city lights.') }); }
        let tn = null; fc.forEach(r => { const t = utc(r.time_tag) + 54e5, kp = +r.kp, h = hourIn(t, P.tz || undefined);
          if (r.observed !== 'observed' && t > now && t - now < 864e5 && (h >= 18 || h < 6) && kp >= N && (!tn || kp > tn.kp)) tn = { t, kp }; });
        if (tn) out.push({ id: 'kpf:' + new Date(tn.t - 216e5).toISOString().slice(0, 10) + ':' + Math.round(tn.kp), k: 'aurora', t: tn.t, title: T('Kp {k} expected tonight — enough for {p}', { k: tn.kp.toFixed(1), p: P.name }), line: T('NOAA forecast. Check the clouds and the best hours in the forecast.') }); }),
      j('data/cme.json').then(c => (c.cmes || []).forEach(m => { if (now - m.t > 3 * 864e5 || m.t > now) return;
        const earth = Math.abs(m.lat) < m.half && Math.abs(m.lon) < m.half + 10;   // cone pointed near the Sun–Earth line
        if (earth) out.push({ id: 'cm:' + m.t, k: 'cme', t: m.t, title: T('CME towards Earth, {v} km/s', { v: Math.round(m.v) }), line: T('NASA DONKI analysis. The ENLIL model shows if and when it arrives.') }); })).catch(() => {}),
    ]);
    src.fast = out;
  }
  async function wind() {
    const [mg, wd] = await Promise.all([j(API + 'json/rtsw/rtsw_mag_1m.json'), j(API + 'json/rtsw/rtsw_wind_1m.json')]), out = [], now = Date.now();
    const M = mg.filter(r => r.active).map(r => ({ t: utc(r.time_tag), bz: r.bz_gsm })).filter(p => now - p.t < 864e5).sort((a, b) => a.t - b.t);
    const W = wd.filter(r => r.active).map(r => ({ t: utc(r.time_tag), v: r.proton_speed, n: r.proton_density })).filter(p => now - p.t < 864e5 && p.v > 0).sort((a, b) => a.t - b.t);
    // Bz: the last 30 minutes, median ≤ −10 nT
    const bz = med(M.filter(p => M.length && p.t > M[M.length - 1].t - 18e5).map(p => p.bz));
    if (bz != null && bz <= -10) { const t = M[M.length - 1].t;
      out.push({ id: 'bz:' + Math.floor(t / 108e5), k: 'wind', t, title: T('Bz far south: {b} nT', { b: Math.round(bz) }), line: T('The field at L1 points south: it opens Earth\'s shield, aurora chances go up.') }); }
    // a jump in the last 12 h: speed +60 km/s and density ×1.4 between the hour before and the half hour after (the page's CME shock rule)
    const vals = (k, a, b) => med(W.filter(p => p.t >= a && p.t < b).map(p => p[k]));
    let sh = null; W.forEach(p => { if (now - p.t > 432e5 || p.t > now - 18e5) return;
      const vB = vals('v', p.t - 36e5, p.t), vA = vals('v', p.t, p.t + 18e5), nB = vals('n', p.t - 36e5, p.t), nA = vals('n', p.t, p.t + 18e5);
      if (vB == null || vA == null || nB == null || nA == null) return; const d = vA - vB; if (d >= 60 && nA >= 1.4 * nB && (!sh || d > sh.d)) sh = { t: p.t, d, v: vA }; });
    if (sh) out.push({ id: 'sh:' + Math.floor(sh.t / 36e5), k: 'wind', t: sh.t, title: T('Solar wind jump at L1: +{d} km/s', { d: Math.round(sh.d) }), line: T('A shock passed the L1 spacecraft, often a CME. It reaches Earth about {m} min later.', { m: Math.round(1.5e6 / sh.v / 60) }) });
    src.wind = out;
  }
  async function enlil() {   // NOAA's WSA-ENLIL run: CME plasma (cloud) at Earth
    const ts = await j(API + 'json/enlil_time_series.json'), out = [], now = Date.now(); let prev = false;
    ts.map(r => ({ t: utc(r.time_tag), c: r.cloud != null && +r.cloud > 0 })).sort((a, b) => a.t - b.t).forEach(p => {
      if (p.c && !prev && p.t > now - 2 * 864e5) { const fut = p.t > now;
        out.push({ id: 'en:' + Math.floor(p.t / 216e5), k: 'cme', t: p.t, title: fut ? T('CME expected at Earth') : T('CME reached Earth (model)'), line: T('NOAA\'s ENLIL model. Arrival times are often off by ±7 hours.') }); }
      prev = p.c; });
    src.enlil = out;
  }

  // ── UI: 🔔 next to ⚙ with a count, the list under it, a dot on each tile with something new
  const css = document.createElement('style');
  css.textContent = `
  .hdtools .ha { position: relative; width: 32px; justify-content: center; font-size: 14px; color: #C9D3DF; } .hdtools .ha:hover, .hdtools .ha[aria-expanded="true"] { border-color: #FFD24A; }
  .hdtools .ha em { position: absolute; top: -5px; right: -6px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: #FF5A5A; color: #0A0A0A; font: 700 10.5px Inter, sans-serif; font-style: normal; display: grid; place-items: center; }
  .hdtools .ha em:empty { display: none; }
  #alPan { position: fixed; z-index: 60; letter-spacing: normal; text-transform: none; width: 380px; max-height: min(70vh, 560px); display: none; flex-direction: column; border-radius: 14px; border: 1px solid var(--line, #1F2630); background: var(--tile, #0F1318); box-shadow: 0 24px 70px rgba(0,0,0,.6); overflow: hidden; text-align: left; }
  #alPan.on { display: flex; }
  #alPan .h { display: flex; align-items: baseline; gap: 10px; padding: 13px 16px 10px; border-bottom: 1px solid var(--line, #1F2630); background: var(--head, #0D1116); }
  #alPan .h b { font: 700 14px Inter, sans-serif; color: #F1F4F8; } #alPan .h span { font: 500 11.5px Inter, sans-serif; color: #8E9AAB; flex: 1; }
  #alPan button { height: auto; min-height: 0; border-radius: 0; letter-spacing: normal; }
  #alPan .h button, #alPan .f button { border: 0; background: none; color: #7BE0FF; font: 600 11.5px Inter, sans-serif; cursor: pointer; padding: 2px 0; }
  #alPan .l { overflow: auto; overscroll-behavior: contain; }
  #alPan .i { display: flex; align-items: stretch; border-bottom: 1px solid #161B22; border-left: 3px solid var(--c); }
  #alPan .i .g { flex: 1; display: flex; flex-direction: column; gap: 3px; padding: 10px 6px 10px 13px; border: 0; background: none; text-align: left; color: #C9D3DF; cursor: pointer; font: 500 12px/1.45 Inter, sans-serif; }
  #alPan .i .g:hover, #alPan .i .g:focus-visible { background: color-mix(in srgb, var(--c) 8%, transparent); outline: none; }
  #alPan .i .g b { font: 600 13px Inter, sans-serif; color: #F1F4F8; } #alPan .i.n .g b::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: var(--c); vertical-align: 1px; }
  #alPan .i .g small { font: 600 10.5px 'JetBrains Mono', monospace; color: var(--c); letter-spacing: .02em; }
  #alPan .i .x { flex: none; width: 34px; border: 0; background: none; color: #5E6B7A; cursor: pointer; font-size: 12px; } #alPan .i .x:hover { color: #E6EDF5; }
  #alPan .e { padding: 26px 16px; text-align: center; font: 500 12.5px/1.5 Inter, sans-serif; color: #8E9AAB; }
  #alPan .f { display: flex; justify-content: space-between; gap: 10px; padding: 9px 16px; border-top: 1px solid var(--line, #1F2630); background: var(--head, #0D1116); }
  .tl.al::after { content: ''; position: absolute; top: 10px; right: 10px; z-index: 2; width: 10px; height: 10px; border-radius: 50%; background: var(--alc, #FF5A5A); box-shadow: 0 0 0 3px rgba(6,8,11,.85); animation: alP 2s ease-in-out infinite; }
  @keyframes alP { 50% { box-shadow: 0 0 0 3px rgba(6,8,11,.85), 0 0 0 8px color-mix(in srgb, var(--alc, #FF5A5A) 25%, transparent); } }
  @media (prefers-reduced-motion: reduce) { .tl.al::after { animation: none; } } html.lite .tl.al::after { animation: none; }
  #setPane .alk { padding-left: 12px; } #setPane .alk[aria-disabled="true"] { opacity: .45; pointer-events: none; }`;
  document.head.appendChild(css);
  const tools = $q('.hdtools'); if (!tools) return;
  const bell = document.createElement('button'); bell.type = 'button'; bell.className = 'ha'; bell.setAttribute('aria-haspopup', 'true'); bell.setAttribute('aria-expanded', 'false');
  bell.innerHTML = '🔔<em></em>'; tools.insertBefore(bell, tools.querySelector('.hg'));
  const pan = document.createElement('div'); pan.id = 'alPan'; pan.setAttribute('role', 'dialog'); pan.setAttribute('aria-label', T('Alerts')); document.body.appendChild(pan);
  const place_ = () => { const r = bell.getBoundingClientRect(); pan.style.top = Math.round(r.bottom + 10) + 'px'; pan.style.right = Math.max(12, Math.round(innerWidth - r.right)) + 'px'; };
  addEventListener('resize', () => { if (pan.classList.contains('on')) place_(); }); addEventListener('scroll', () => { if (pan.classList.contains('on')) place_(); }, { passive: true });
  const rtf = (() => { try { return new Intl.RelativeTimeFormat(window.LOC || undefined, { numeric: 'auto' }); } catch (e) { return null; } })();
  const rel = t => { const d = (t - Date.now()) / 6e4, a = Math.abs(d); if (!rtf) return new Date(t).toLocaleString();
    return a < 60 ? rtf.format(Math.round(d), 'minute') : a < 2880 ? rtf.format(Math.round(d / 60), 'hour') : rtf.format(Math.round(d / 1440), 'day'); };
  const seen = id => st.seen.includes(id), shown = () => items.filter(i => on(i.k) && !st.gone.includes(i.id));
  function paint() {
    const L = shown(), nw = L.filter(i => !seen(i.id));
    bell.querySelector('em').textContent = nw.length ? String(Math.min(nw.length, 99)) : '';
    bell.setAttribute('aria-label', T('Alerts') + (nw.length ? ' · ' + T('{n} new', { n: nw.length }) : ''));
    document.querySelectorAll('#tiles .tl[data-p]').forEach(b => { const a = nw.find(i => KD[i.k][0] === b.dataset.p); b.classList.toggle('al', !!a); if (a) b.style.setProperty('--alc', KD[a.k][1]); });
    if (!pan.classList.contains('on')) return;
    pan.innerHTML = `<div class="h"><b>🔔 ${T('Alerts')}</b><span>${lastVisit ? T('Last visit {t}', { t: rel(lastVisit) }) : ''}</span>${L.length ? `<button type="button" data-clr>${T('Clear all')}</button>` : ''}</div>
      <div class="l">${pref.on === false ? `<div class="e">${T('Alerts are off. Turn them on in ⚙ Settings.')}</div>` : !L.length ? `<div class="e">${T('Nothing new in space weather right now. The page checks NOAA every 5 minutes while it is open.')}</div>` :
      L.map(i => `<div class="i${seen(i.id) ? '' : ' n'}" style="--c:${KD[i.k][1]}"><button type="button" class="g" data-go="${esc(i.id)}"><b>${esc(i.title)}</b>${esc(i.line)}<small>${esc(rel(i.t))} · ${esc(T(TILE[KD[i.k][0]]))} ›</small></button><button type="button" class="x" data-x="${esc(i.id)}" aria-label="${T('Dismiss')}">✕</button></div>`).join('')}</div>
      <div class="f"><button type="button" data-set>⚙ ${T('Alert settings')}</button><span></span></div>`;
  }
  const markSeen = f => { let ch = false; items.forEach(i => { if (f(i) && !seen(i.id)) { st.seen.push(i.id); ch = true; } }); if (ch) { saveSt(); } };
  const openTile = key => { if (window.tlOpen) tlOpen(key); else location.hash = '#p-' + key; markSeen(i => KD[i.k][0] === key); paint(); };
  const toggle = o => { o = o == null ? !pan.classList.contains('on') : o; pan.classList.toggle('on', o); bell.setAttribute('aria-expanded', String(o));
    if (o) { place_(); paint(); } else { markSeen(i => on(i.k)); paint(); } };
  bell.onclick = e => { e.stopPropagation(); toggle(); };
  document.addEventListener('click', e => { if (pan.classList.contains('on') && !pan.contains(e.target) && e.target !== bell) toggle(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && pan.classList.contains('on')) { toggle(false); bell.focus(); } });
  pan.addEventListener('click', e => { e.stopPropagation(); const t = e.target;
    const g = t.closest('[data-go]'); if (g) { const i = items.find(x => x.id === g.dataset.go); toggle(false); if (i) openTile(KD[i.k][0]); return; }
    const x = t.closest('[data-x]'); if (x) { st.gone.push(x.dataset.x); saveSt(); paint(); return; }
    if (t.closest('[data-clr]')) { shown().forEach(i => st.gone.push(i.id)); saveSt(); paint(); return; }
    if (t.closest('[data-set]')) { toggle(false); const b = document.getElementById('setBtn'); if (b) b.click(); setTimeout(() => { const s = $q('#setPane .alg'); if (s) s.scrollIntoView({ block: 'start' }); }, 60); } });
  addEventListener('hashchange', () => { const m = location.hash.match(/^#p-(\w+)/); if (m) { markSeen(i => KD[i.k][0] === m[1]); paint(); } });

  // ── browser notifications: only after the user turns them on, only while the page is open, only for alerts that appear now
  const canN = () => 'Notification' in window && !storm;
  const notify = list => { if (!pref.ntf || !canN() || Notification.permission !== 'granted') return;
    list.slice(0, 3).forEach(i => { try { const n = new Notification(i.title, { body: i.line, tag: i.id, icon: 'icon-192.png' }); n.onclick = () => { focus(); openTile(KD[i.k][0]); n.close(); }; } catch (e) {} }); };

  // ── ⚙ Settings: all on / off, per kind, browser notifications
  const sp = document.getElementById('setPane');
  if (sp) { const g = document.createElement('div'); g.className = 'sg alg';
    const ntfLbl = () => !canN() ? T('Not available here') : Notification.permission === 'denied' ? T('Blocked in the browser') : pref.ntf ? T('On') : T('Off');
    const draw = () => { g.innerHTML = `<div class="lbl">🔔 ${T('Alerts')}</div><label class="sw">${T('Show alerts')}<input type="checkbox" data-alk="*" ${pref.on !== false ? 'checked' : ''}></label>
      ${Object.entries(KD).map(([k, d]) => `<label class="sw alk" aria-disabled="${pref.on === false}"><span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${d[1]};margin-right:8px"></i>${T(d[2])}</span><input type="checkbox" data-alk="${k}" ${!(pref.off || []).includes(k) ? 'checked' : ''}></label>`).join('')}
      <div class="row"><button type="button" class="sb" data-aln>${T('Browser notifications')}: ${ntfLbl()}</button></div>
      <div class="note">${T('Checked every 5 minutes while this page is open. A notification only for alerts that appear while you are here; nothing is sent anywhere, it all stays on this device.')}</div>`; };
    draw(); const rep = [...sp.querySelectorAll('.sg')].pop(); sp.insertBefore(g, rep || null);
    g.addEventListener('change', e => { const c = e.target.closest('[data-alk]'); if (!c) return; e.stopPropagation(); const k = c.dataset.alk;
      if (k === '*') pref.on = c.checked ? undefined : false; else { pref.off = (pref.off || []).filter(x => x !== k); if (!c.checked) pref.off.push(k); }
      savePref(); draw(); paint(); });
    g.addEventListener('click', async e => { if (!e.target.closest('[data-aln]')) return; e.stopPropagation(); if (!canN()) return;
      if (pref.ntf) pref.ntf = false; else { const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission(); pref.ntf = p === 'granted'; }
      savePref(); draw(); }); }

  // ── polling: fast sources every 5 min, the L1 wind every 30 min, ENLIL every hour; nothing while the tab is hidden
  const due = { fast: 0, wind: 0, enlil: 0 }, every = { fast: 3e5, wind: 18e5, enlil: 36e5 }, fn = { fast, wind, enlil };
  async function poll() {
    if (document.hidden || pref.on === false) return; const now = Date.now(), run = Object.keys(due).filter(k => now >= due[k]);
    if (!run.length) return; run.forEach(k => { due[k] = now + every[k]; });
    await Promise.allSettled(run.map(k => fn[k]()));
    const before = new Set(items.map(i => i.id)), all = [].concat(src.fast || [], src.wind || [], src.enlil || []);
    const seenId = new Set(); items = all.filter(i => !seenId.has(i.id) && seenId.add(i.id)).sort((a, b) => b.t - a.t);
    if (!first) notify(items.filter(i => on(i.k) && !before.has(i.id) && !seen(i.id) && !st.gone.includes(i.id)));
    first = false; paint();
  }
  due.wind = Date.now() + 15e3; due.enlil = Date.now() + 25e3;   // the heavy ones after the page has loaded
  setTimeout(poll, 4e3); setInterval(poll, 15e3); document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  if (window.xpAdd) xpAdd([['.hdtools .ha', '#FFD24A', 'Alerts', 'What changed in space weather, also since your last visit: strong flares, CMEs heading to Earth, aurora for your place, solar wind jumps, storms.', 'A number = new ones; a dot on a tile = something new there. Click an alert to open its part of the page. Turn kinds off in ⚙.']]);
  window.auroraAlerts = { poll: () => { Object.keys(due).forEach(k => { due[k] = 0; }); return poll(); }, items: () => items };
})();
