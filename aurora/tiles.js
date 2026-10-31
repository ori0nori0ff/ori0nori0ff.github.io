/* PC (≥ 1000 px; ?tiles=0 = the old long page): one screen, no scroll — the aurora forecast in the middle, the Sun's modules on the left,
   the Earth's on the right (columns 1 : φ : 1). Each tile IS its module, laid out at full size and shrunk into the tile (a live
   miniature). A click moves it into a big window over a dimmed, blurred page; ⊞ puts a second module beside it (side by side,
   each with its own scroll); ‹ › / the strip go to the next one; Esc / ✕ / the backdrop close and it shrinks back. */
(() => {
  if (new URLSearchParams(location.search).get('tiles') === '0' || innerWidth < 1000) return;   // ?tiles=0 = the old long page
  const $ = id => document.getElementById(id), T = window.T || (s => s), H = document.documentElement;
  const P = [   // key, panel, colour, title, side, live line
    ['sun', 'sunEarth', '#FFE600', 'The Sun Now', 'L', () => first('#enlSum')], ['flares', 'frSun', '#FFB020', 'Flares and coronal holes', 'L', () => txt('ptSun')],
    ['wind', 'frWind', '#7BE0FF', 'Solar wind and storm levels', 'L', () => txt('ptEarth')], ['shield', 'frShield', '#5AC8FF', 'Magnetic shield and cosmic rays', 'L', () => first('#dstSum')],
    ['forecast', 'frForecast', '#39FF9E', 'NOAA Aurora Forecast', 'C'],
    ['earth', 'frEarth', '#3EE08F', 'Sun–Earth record · earthquakes', 'R', () => first('#eqSum')], ['replay', null, '#FF5A5A', 'Storm replay', 'R', () => T('The May 2024 G5 storm, step by step')],
    ['cycle', 'secCyc', '#FFD24A', 'Solar cycle', 'R', () => first('#cycSum')], ['3d', 'sec3d', '#B9A7FF', '3D model', 'R', () => first('#s3dHost .s3d-sub') || T('Planets, wind and CMEs on one clock')]];
  const FCW = 900;   // the forecast is laid out this wide, then shrunk to the middle column
  const txt = id => { const e = $(id); return e && e.textContent.trim() || ''; };
  const first = sel => { const e = typeof sel === 'string' ? document.querySelector(sel) : sel; const s = e && e.textContent.replace(/\s+/g, ' ').trim() || ''; return s.split(/(?<=[.!?])\s|;\s| — /)[0].replace(/[.;]$/, '').slice(0, 90); };
  H.classList.add('tiles');
  const css = document.createElement('style');
  css.textContent = `
  html.tiles .chx, html.tiles #portals, html.tiles #safe { display: none !important; }
  #tiles { display: grid; grid-template-columns: 1fr 1.618fr 1fr; gap: 16px; margin: 16px 0 8px; height: var(--gh, 760px); }
  #tiles .col { display: grid; grid-auto-rows: minmax(0, 1fr); gap: 16px; min-height: 0; }
  .tl { position: relative; display: block; min-width: 0; min-height: 0; padding: 0; border-radius: 13px; overflow: hidden; cursor: pointer; text-align: left;
    border: 1px solid #1F2630; border-left: 3px solid var(--c); background: var(--tile); color: #E6EDF5; font: inherit; transition: transform .25s, border-color .25s, box-shadow .25s; }
  .tl[hidden] { display: none !important; }
  #tiles { position: relative; }
  html.tledit .tl { cursor: grab; outline: 1px dashed rgba(255,255,255,.35); outline-offset: 3px; touch-action: none; } html.tledit .tl:hover { transform: none; }
  .tl.drg { opacity: .55; cursor: grabbing; } .tl.ovr { outline: 2px solid var(--c) !important; } .tl.ovt { box-shadow: 0 -6px 0 0 var(--acc, #7BE0FF) !important; } .tl.ovb { box-shadow: 0 6px 0 0 var(--acc, #7BE0FF) !important; }
  #tiles .col { overflow: visible; } html.tledit #tiles .col:empty { outline: 1px dashed rgba(255,255,255,.25); }
  .tlx { display: none; position: absolute; top: 8px; right: 8px; z-index: 3; width: 28px; height: 28px; border-radius: 50%; background: rgba(0,0,0,.75); color: #fff; text-align: center; line-height: 28px; font-size: 13px; cursor: pointer; } html.tledit .tlx { display: block; }
  .tlh { position: absolute; z-index: 4; touch-action: none; } .tlh.v { cursor: col-resize; } .tlh.h { cursor: row-resize; }
  .tlh::after { content: ''; position: absolute; inset: 0; margin: auto; border-radius: 3px; background: var(--acc, #7BE0FF); opacity: .55; } .tlh.v::after { width: 4px; height: 64px; } .tlh.h::after { height: 4px; width: 64px; } .tlh:hover::after { opacity: 1; }
  #tlEd { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 45; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; max-width: 92vw; padding: 10px 14px; border-radius: 14px; background: var(--head, #10151C); border: 1px solid var(--line, #2A323D); box-shadow: 0 20px 60px rgba(0,0,0,.6); font: 500 12.5px Inter, sans-serif; color: #C9D3DF; }
  #tlEd button { height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid #2A323D; background: none; color: #E6EDF5; cursor: pointer; font: inherit; } #tlEd .ok { background: var(--acc, #7BE0FF); color: #0A0A0A; border-color: transparent; font-weight: 700; }
  .tl.fc { border-left-width: 1px; border-top: 3px solid var(--c); background: none; }
  .tl:hover, .tl:focus-visible { transform: none; border-color: var(--c); box-shadow: 0 14px 40px rgba(0,0,0,.45); outline: none; }
  .tls { position: absolute; top: 0; left: 0; transform-origin: 0 0; padding: 21px 26px; } html.tledit .tls { pointer-events: none; }
  .tl.fc .tls { padding: 0; }
  .tls > section { margin: 0 !important; } .tls #syncCard { position: static !important; }
  .tls .tcur { stroke-width: 5px; }   /* the clock's line: thick enough to survive the shrink without flickering */
  .tl { cursor: default; } .tl.tlgo, .tl .cap { cursor: pointer; }
  .tlo { position: absolute; top: 8px; right: 8px; z-index: 3; width: 30px; height: 30px; border-radius: 9px; border: 1px solid var(--c); background: rgba(6,8,11,.82); color: #fff; font-size: 15px; cursor: pointer; opacity: .55; transition: opacity .2s; } .tl:hover .tlo, .tlo:focus-visible { opacity: 1; } html.tledit .tlo { display: none; } .tl:not(.tlgo):hover .cap { opacity: 0; pointer-events: none; } .tl .cap { transition: opacity .2s; }   /* the caption steps aside so the controls under it can be used */
  .tl .cap { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: baseline; gap: 10px; padding: 24px 14px 10px; background: linear-gradient(180deg, rgba(6,8,11,0), rgba(6,8,11,.94) 55%); }
  .tl.fc .cap { display: none; }
  .tl .cap strong { font: 700 14px Inter, sans-serif; color: #F1F4F8; white-space: nowrap; } .tl .cap .lv { font: 600 11px 'JetBrains Mono', monospace; color: var(--c); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tl .cap i { margin-left: auto; font-style: normal; color: var(--c); transition: transform .25s; } .tl:hover .cap i { transform: translateX(3px); }
  .tlrp { position: absolute; inset: 0; background: #000 url(replay/may2024/img/C3/0511_0300.jpg) 50% 50% / 115% auto no-repeat; }
  .tlrp::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(0,0,0,.75), rgba(0,0,0,.15) 55%, rgba(0,0,0,0)), linear-gradient(0deg, rgba(0,0,0,.85), transparent 45%); }
  .tlrp b { position: absolute; left: 16px; top: 14px; z-index: 1; font: 700 10.5px 'JetBrains Mono', monospace; letter-spacing: .08em; color: #FFB3B3; }
  #tlOv { position: fixed; inset: 0; z-index: 46; display: none; background: rgba(4,6,9,.66); -webkit-backdrop-filter: blur(9px) saturate(.8); backdrop-filter: blur(9px) saturate(.8); }
  #tlOv.on { display: block; animation: tlFade .25s ease; }
  #tlWin { position: absolute; inset: 2.5vh 2.5vw; display: flex; flex-direction: column; border-radius: 16px; background: var(--tile); border: 1px solid var(--line); box-shadow: 0 30px 90px rgba(0,0,0,.6); overflow: hidden; animation: tlGrow .3s cubic-bezier(.2,.8,.2,1); }
  @keyframes tlFade { from { opacity: 0; } } @keyframes tlGrow { from { transform: scale(.94); opacity: 0; } }
  #tlHead { display: flex; align-items: center; gap: 8px; padding: 10px 13px; border-bottom: 1px solid var(--line); background: var(--head); }
  #tlStrip { flex: 1; display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; padding: 0 2px; }
  #tlStrip button { flex: none; display: flex; align-items: center; gap: 6px; padding: 0 9px; min-height: 30px; border-radius: 999px; border: 1px solid #2A323D; background: none; color: #AAB6C4; font: 500 11.5px Inter, sans-serif; cursor: pointer; white-space: nowrap; }
  #tlStrip button i { width: 7px; height: 7px; border-radius: 50%; background: var(--c); } #tlStrip button:hover { color: #fff; border-color: var(--c); }
  #tlStrip button[aria-current="true"] { background: var(--c); border-color: var(--c); color: #0A0A0A; font-weight: 700; } #tlStrip button[aria-current="true"] i { background: #0A0A0A; }
  #tlStrip button.b2 { box-shadow: inset 0 0 0 2px var(--c); color: #fff; }
  #tlHead .tb { flex: none; height: 34px; min-width: 34px; padding: 0 10px; border-radius: 999px; border: 1px solid #2A323D; background: none; color: #E6EDF5; font: 500 15px Inter, sans-serif; cursor: pointer; white-space: nowrap; } #tlHead .tb:hover { border-color: #E6EDF5; }
  #tlHead .tb[aria-pressed="true"] { background: #E6EDF5; color: #0A0A0A; border-color: #E6EDF5; }
  #tlPanes { flex: 1; display: flex; min-height: 0; }
  .tlp { flex: 1; min-width: 0; display: flex; flex-direction: column; } .tlp + .tlp { border-left: 1px solid #1F2630; }
  .tlp .ph { display: none; align-items: center; gap: 8px; padding: 7px 16px; border-bottom: 1px solid #1F2630; font: 600 12px Inter, sans-serif; color: var(--c, #E6EDF5); }
  .tlp .ph button { margin-left: auto; border: 0; background: none; color: #8B9BAE; font-size: 15px; cursor: pointer; } #tlOv.split .tlp .ph { display: flex; }
  .tlp.act .ph { background: color-mix(in srgb, var(--c) 12%, transparent); }
  .tlb { flex: 1; overflow: auto; padding: 21px 26px 34px; overscroll-behavior: contain; }
  .tlb > section { margin: 0 !important; }
  #tlOv:not(.split) #tlP2 { display: none; }
  #tlOv.split .tlb .grid.two-col, #tlOv.split .tlb .grid.top { grid-template-columns: minmax(0, 1fr) !important; } #tlOv.split .tlb .grid.two-col > *, #tlOv.split .tlb .grid.top > * { grid-column: auto !important; }
  .tlb #cycchart { max-height: calc(95vh - 270px); }
  .tlb #s3dHost { aspect-ratio: auto; height: calc(95vh - 230px); max-height: none; }
  `;
  document.head.appendChild(css);
  // the board: Sun column · forecast · Earth column
  const tile = p => `<div role="region" class="tl${p[4] === 'C' ? ' fc' : ''}${p[1] ? '' : ' tlgo'}" style="--c:${p[2]}" data-p="${p[0]}" aria-label="${T(p[3])}">${p[1] ? '<div class="tls"></div>' : '<div class="tlrp"></div>'}<span class="cap"><strong>${T(p[3])}</strong><span class="lv"></span><i>↗</i></span><button type="button" class="tlo" aria-label="${T('Open large')}" title="${T('Open large')}">⤢</button></div>`;
  const box = document.createElement('nav'); box.id = 'tiles'; box.setAttribute('aria-label', T('The chapters'));
  box.innerHTML = ['L', 'C', 'R'].map(s => `<div class="col">${P.filter(p => p[4] === s).map(tile).join('')}</div>`).join('');
  $('frForecast').before(box);
  const st = key => box.querySelector(`[data-p="${key}"] .tls`);
  const stageW = () => Math.round(innerWidth * .95 - 2);   // = the window's width; the stage's padding = the window body's
  const fit = () => {
    box.style.setProperty('--gh', Math.max(560, innerHeight - box.getBoundingClientRect().top - scrollY - 18) + 'px');
    const W = stageW();
    box.querySelectorAll('.tl').forEach(t => { const s = t.querySelector('.tls'); if (!s) return;
      if (t.classList.contains('fc')) { s.style.width = FCW + 'px'; const k = Math.min(t.clientWidth / FCW, t.clientHeight / Math.max(1, s.scrollHeight)); s.style.transform = `scale(${k})`; s.style.left = Math.max(0, (t.clientWidth - FCW * k) / 2) + 'px'; s.style.top = Math.max(0, (t.clientHeight - s.scrollHeight * k) / 2) + 'px'; }
      else { s.style.width = W + 'px'; s.style.transform = `scale(${t.clientWidth / W})`; } }); };
  P.forEach(p => { if (!p[1]) return; const el = $(p[1]); if (!el) return; el.inert = false; st(p[0]).appendChild(el); });
  // the viewer's own board (⚙ → ✎ Arrange the board): drag a tile onto another = swap (the forecast too), drag the lines between
  // them = resize (1 : 1 and 1 : φ pull the line), ✕ = hide, ＋ = show again; kept in this browser only
  const CK = 'aurora.tiles', cols = [...box.querySelectorAll('.col')], PHI = 1.618, tl = k => box.querySelector(`.tl[data-p="${k}"]`);
  let CF = { w: [1, PHI, 1], h: {}, hide: [] }, drag = null;
  const vis = c => [...c.children].filter(t => t.classList.contains('tl') && !t.hidden);
  const cur = () => ({ cols: cols.map(c => [...c.children].filter(t => t.classList.contains('tl')).map(t => t.dataset.p)), w: CF.w, h: CF.h, hide: CF.hide });
  const layout = () => { const ed = H.classList.contains('tledit'); box.style.gridTemplateColumns = CF.w.map((w, i) => `minmax(0, ${vis(cols[i]).length || ed ? w : 0}fr)`).join(' ');
    box.style.columnGap = cols.filter((c, i) => CF.w[i] > .001 && (vis(c).length || ed)).length > 1 ? '' : '0px';
    cols.forEach(c => { c.style.gridTemplateRows = vis(c).map(t => `minmax(0, ${CF.h[t.dataset.p] || 1}fr)`).join(' ') || 'none'; }); };
  const apply = c => { if (c && c.cols) { CF = { w: c.w && c.w.length === 3 ? c.w : CF.w, h: c.h || {}, hide: c.hide || [] }; c.cols.forEach((ks, i) => ks.forEach(k => { const t = tl(k); if (t && cols[i]) cols[i].appendChild(t); })); }
    box.querySelectorAll('.tl[data-p]').forEach(t => { t.hidden = CF.hide.includes(t.dataset.p); }); layout(); };
  const save = () => { try { localStorage.setItem(CK, JSON.stringify(cur())); } catch (e) {} };
  try { apply(JSON.parse(localStorage.getItem(CK))); } catch (e) {}
  const handles = () => { box.querySelectorAll('.tlh').forEach(h => h.remove()); if (!H.classList.contains('tledit')) return; const B = box.getBoundingClientRect();
    const mk = (cls, x, y, w, h, d) => { const e = document.createElement('div'); e.className = 'tlh ' + cls; Object.assign(e.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); Object.assign(e.dataset, d); box.appendChild(e); };
    for (let i = 0; i < 2; i++) { const a = cols[i].getBoundingClientRect(), b = cols[i + 1].getBoundingClientRect(); mk('v', a.right - B.left, 0, Math.max(10, b.left - a.right), B.height, { c: i }); }
    cols.forEach(c => { const v = vis(c); for (let i = 0; i + 1 < v.length; i++) { const a = v[i].getBoundingClientRect(), b = v[i + 1].getBoundingClientRect(); mk('h', a.left - B.left, a.bottom - B.top, a.width, Math.max(10, b.top - a.bottom), { a: v[i].dataset.p, b: v[i + 1].dataset.p }); } }); };
  const bar = document.createElement('div'); bar.id = 'tlEd';
  const name = k => T((P.find(p => p[0] === k) || [])[3] || k);
  const drawBar = () => { bar.innerHTML = `<span>${T('Drag a tile onto another to swap them · drag the lines between them to resize')}</span>${CF.hide.map(k => `<button type="button" data-show="${k}">＋ ${name(k)}</button>`).join('')}<button type="button" data-ed="r">${T('Reset the board')}</button><button type="button" data-ed="x" class="ok">${T('Done')}</button>`; if (!bar.isConnected) document.body.appendChild(bar); };
  const redo = () => { layout(); save(); fit(); handles(); if (bar.isConnected) drawBar(); };
  const edit = on => { H.classList.toggle('tledit', on); layout(); if (on) { box.querySelectorAll('.tl').forEach(t => { if (!t.querySelector('.tlx')) t.insertAdjacentHTML('beforeend', `<span class="tlx" title="${T('Hide')}">✕</span>`); }); drawBar(); } else bar.remove(); fit(); handles(); };
  bar.onclick = e => { const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.show) { CF.hide = CF.hide.filter(k => k !== b.dataset.show); apply(); redo(); }
    else if (b.dataset.ed === 'r') { try { localStorage.removeItem(CK); } catch (x) {} location.reload(); } else edit(false); };
  const snap = q => { for (const v of [0, .5, 1 / (1 + PHI), PHI / (1 + PHI), 1]) if (Math.abs(q - v) < .03) return v; return q; };
  box.addEventListener('pointerdown', e => { if (!H.classList.contains('tledit')) return; const x = e.target.closest('.tlx'), h = e.target.closest('.tlh'), t = e.target.closest('.tl');
    e.preventDefault();
    if (x && t) { CF.hide.push(t.dataset.p); apply(); redo(); return; }
    if (h) { h.setPointerCapture(e.pointerId); if (h.dataset.c != null) { const i = +h.dataset.c; drag = { k: 'c', i, x: e.clientX, a: cols[i].offsetWidth, b: cols[i + 1].offsetWidth, s: CF.w[i] + CF.w[i + 1] }; }
      else { const A = h.dataset.a, Bk = h.dataset.b; drag = { k: 'r', A, B: Bk, y: e.clientY, a: tl(A).offsetHeight, b: tl(Bk).offsetHeight, s: (CF.h[A] || 1) + (CF.h[Bk] || 1) }; } return; }
    if (t) { t.setPointerCapture(e.pointerId); drag = { k: 't', t }; t.classList.add('drg'); } });
  box.addEventListener('pointermove', e => { if (!drag) return;
    if (drag.k === 'c') { const q = snap(Math.max(0, Math.min(1, (drag.a + e.clientX - drag.x) / (drag.a + drag.b)))); CF.w = CF.w.slice(); CF.w[drag.i] = drag.s * q; CF.w[drag.i + 1] = drag.s * (1 - q); layout(); fit(); }
    else if (drag.k === 'r') { const q = Math.max(.04, Math.min(.96, snap((drag.a + e.clientY - drag.y) / (drag.a + drag.b)))); CF.h[drag.A] = drag.s * q; CF.h[drag.B] = drag.s * (1 - q); layout(); fit(); }
    else { box.querySelectorAll('.ovr, .ovt, .ovb').forEach(t => t.classList.remove('ovr', 'ovt', 'ovb')); const o = document.elementFromPoint(e.clientX, e.clientY), t = o && o.closest('.tl');
      if (t && t !== drag.t) { const R = t.getBoundingClientRect(), y = (e.clientY - R.top) / R.height; t.classList.add(y < .25 ? 'ovt' : y > .75 ? 'ovb' : 'ovr'); } } });
  const up = e => { if (!drag) return; const d = drag; drag = null;
    if (d.k === 't') { d.t.classList.remove('drg'); const o = box.querySelector('.tl.ovr, .tl.ovt, .tl.ovb');
      if (o) { const z = o.classList.contains('ovt') ? 't' : o.classList.contains('ovb') ? 'b' : 'r'; o.classList.remove('ovr', 'ovt', 'ovb');
        if (z === 't') o.before(d.t); else if (z === 'b') o.after(d.t); else { const m = document.createComment(''); d.t.replaceWith(m); o.replaceWith(d.t); m.replaceWith(o); } }
      else { const el = document.elementFromPoint(e.clientX, e.clientY), c = el && el.closest('.col'); if (c && !c.contains(d.t)) c.appendChild(d.t); } }
    redo(); };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  addEventListener('resize', () => { if (!drag) handles(); });
  window.tilesCfg = el => { el.innerHTML = `<button type="button" class="sb" data-m="e">✎ ${T('Arrange the board')}</button><button type="button" class="sb" data-m="r" style="margin-top:8px">${T('Reset the board')}</button>`;
    el.onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; if (b.dataset.m === 'r') { try { localStorage.removeItem(CK); } catch (x) {} location.reload(); return; }
      const xb = document.querySelector('#setPane [data-x]'); if (xb) xb.click(); edit(true); }; };
  fit(); addEventListener('resize', fit); H.classList.remove('tpre'); setTimeout(fit, 1500); setTimeout(fit, 5000);   // the forecast grows as its data comes in
  const live = () => P.forEach(p => { if (!p[5]) return; const v = p[5](), el = box.querySelector(`[data-p="${p[0]}"] .lv`); if (el && v && el.textContent !== v) el.textContent = v; });
  live(); setInterval(live, 4000);
  // the replay tile: the CME of 11 May 2024 in SOHO LASCO C3 (from the replay) — a picture, so it is not mistaken for today's Kp
  box.querySelector('.tlrp').innerHTML = `<b>${T('CME · 11 MAY 2024 · SOHO LASCO C3')}</b>`;
  // the window: one module, or two side by side
  const ov = document.createElement('div'); ov.id = 'tlOv'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  const pane = n => `<div class="tlp" id="tlP${n}"><div class="ph"><span></span><button type="button" data-shut="${n}" aria-label="${T('Close')}">✕</button></div><div class="tlb"></div></div>`;
  ov.innerHTML = `<div id="tlWin"><div id="tlHead"><button type="button" class="tb" data-go="-1" aria-label="${T('Previous')}">‹</button><div id="tlStrip">${P.filter(p => p[1]).map(p => `<button type="button" data-p="${p[0]}" style="--c:${p[2]}"><i></i>${T(p[3])}</button>`).join('')}</div><button type="button" class="tb" data-go="1" aria-label="${T('Next')}">›</button><button type="button" class="tb" data-split aria-pressed="false" title="${T('Read two modules side by side')}">⊞ ${T('Side by side')}</button><button type="button" class="tb" data-x aria-label="${T('Close')}">✕</button></div><div id="tlPanes">${pane(1)}${pane(2)}</div></div>`;
  document.body.appendChild(ov);
  const S = [null, null], pn = i => $('tlP' + (i + 1)); let act = 0, split = false;
  const home = el => { const p = P.find(q => q[1] === el.id); st(p[0]).appendChild(el); el.inert = false; };
  const relayout = () => requestAnimationFrame(() => { dispatchEvent(new Event('resize')); });
  function show(i, key, target) {   // put module `key` into pane i
    const p = P.find(q => q[0] === key); if (!p || !p[1]) return; const o = 1 - i;
    if (S[o] === key) { act = o; mark(); return; }   // already in the other pane: just focus it
    const el = $(p[1]), b = pn(i).querySelector('.tlb');
    if (S[i] && S[i] !== key) home($(P.find(q => q[0] === S[i])[1]));
    b.appendChild(el); el.inert = false; S[i] = key; b.scrollTop = 0;
    pn(i).style.setProperty('--c', p[2]); pn(i).querySelector('.ph span').textContent = T(p[3]);
    if (target) requestAnimationFrame(() => { b.scrollTop += target.getBoundingClientRect().top - b.getBoundingClientRect().top - 8; });
    mark(); relayout();
  }
  const mark = () => { ov.querySelectorAll('#tlStrip button').forEach(b => { b.setAttribute('aria-current', String(b.dataset.p === S[act])); b.classList.toggle('b2', split && b.dataset.p === S[1 - act]); if (b.dataset.p === S[act]) { const sp = b.parentNode; if (sp.scrollWidth > sp.clientWidth) sp.scrollLeft = b.offsetLeft - (sp.clientWidth - b.offsetWidth) / 2; } });
    [0, 1].forEach(i => pn(i).classList.toggle('act', split && i === act)); ov.querySelector('[data-split]').setAttribute('aria-pressed', String(split)); ov.classList.toggle('split', split); };
  const hash = () => { const h = '#p-' + S[0] + (split && S[1] ? '+' + S[1] : ''); if (location.hash !== h) history.pushState({}, '', h); };
  function open(key, push = true, target) {
    const p = P.find(q => q[0] === key); if (!p) return;
    if (!p[1]) { close(); if (window.openReplay) openReplay(); return; }   // the replay has its own full screen
    ov.classList.add('on'); document.body.style.overflow = 'hidden'; show(act, key, target); if (key === 'sun' && window.syAuto) syAuto(); ov.setAttribute('aria-label', T(p[3])); if (push) hash();
  }
  function setSplit(on, key) {
    if (on === split) return; split = on;
    if (on) { const k = key || P.filter(p => p[1]).map(p => p[0]).find(q => q !== S[0]); act = 1; show(1, k); }
    else { if (S[1]) home($(P.find(q => q[0] === S[1])[1])); S[1] = null; act = 0; mark(); relayout(); }
    hash();
  }
  function close(push = true) { if (!ov.classList.contains('on')) return; ov.classList.remove('on'); document.body.style.overflow = '';
    S.forEach((k, i) => { if (k) home($(P.find(q => q[0] === k)[1])); S[i] = null; }); split = false; act = 0; mark(); relayout();
    if (push && /^#p-/.test(location.hash)) history.pushState({}, '', location.pathname + location.search); }
  const step = d => { const ks = P.filter(p => p[1]).map(p => p[0]); let j = ks.indexOf(S[act]); do { j = (j + d + ks.length) % ks.length; } while (split && ks[j] === S[1 - act]); show(act, ks[j]); hash(); };
  box.addEventListener('click', e => { if (!e.isTrusted || H.classList.contains('tledit')) return; const b = e.target.closest('.tl[data-p]'); if (b && (e.target.closest('.tlo, .cap') || b.classList.contains('tlgo'))) open(b.dataset.p); });   // a script pressing a button inside a tile (the header clock) must not open it
  ov.addEventListener('click', e => {
    const b = e.target.closest('#tlStrip [data-p]'); if (b) { show(act, b.dataset.p); hash(); return; }
    const g = e.target.closest('[data-go]'); if (g) return step(+g.dataset.go);
    if (e.target.closest('[data-split]')) return setSplit(!split);
    const sh = e.target.closest('[data-shut]'); if (sh) { const i = +sh.dataset.shut - 1; if (i === 0) { home($(P.find(q => q[0] === S[0])[1])); S[0] = S[1]; pn(0).querySelector('.tlb').append(...pn(1).querySelector('.tlb').childNodes); const p = P.find(q => q[0] === S[0]); pn(0).style.setProperty('--c', p[2]); pn(0).querySelector('.ph span').textContent = T(p[3]); S[1] = null; split = false; act = 0; mark(); relayout(); hash(); } else setSplit(false); return; }
    const pp = e.target.closest('.tlp'); if (pp && split) { act = pp.id === 'tlP1' ? 0 : 1; mark(); }
    if (e.target === ov || e.target.closest('[data-x]')) close(); });
  addEventListener('keydown', e => { if (!S[0] || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (e.key === 'Escape' && !document.querySelector('#sunFull[style*="flex"], #enlFull[style*="block"], #xpOv.on')) close(); });
  window.tlOpen = k => open(k);   // alerts.js: open the tile an alert is about
  const fromHash = () => { const m = location.hash.match(/^#p-(\w+)(?:\+(\w+))?/); if (!m) return close(false); open(m[1], false); if (m[2]) setSplit(true, m[2]); else if (split) setSplit(false); };
  addEventListener('popstate', fromHash);
  // any link to a part of a module (side menu, chapter links, the guide's "See it") opens that module there
  document.addEventListener('click', e => { const a = e.target.closest('a[href^="#"]'); if (!a || a.closest('#tlHead')) return; const t = document.getElementById(a.hash.slice(1)); if (!t) return;
    const p = P.find(q => q[1] && $(q[1]) && ($(q[1]) === t || $(q[1]).contains(t))); if (!p) return;
    e.preventDefault(); e.stopPropagation(); open(p[0], true, t !== $(p[1]) ? t : null); }, true);
  if (/^#p-/.test(location.hash)) setTimeout(fromHash, 0);
  if (window.xpAdd) xpAdd([[".hdtools .hs", "#FF5A5A", "Calm or storm", "Switches the whole page to the peak of the real G5 storm of 10 May 2024, with that day's data.", "Green ☀ = today, live. Red ⚡ = storm mode. Click again to come back."], [".hdtools .hx", "#7BE0FF", "Explanations on hover", "This help: point at anything to learn what it is and how to read it.", "Cyan = on. The ? HOW TO READ guide explains the whole chain from the Sun to your sky."], ["[data-p=\"sun\"].tl", "#FFE600", "The Sun Now", "Live pictures of the Sun (SDO, SOHO, CCOR) and NOAA's ENLIL solar-wind forecast on one clock.", "Open it and drag the clock: the Sun's picture and the forecast wind at Earth move together. A CME leaving the Sun shows up days later as a bulge at Earth."], ["[data-p=\"flares\"].tl", "#FFB020", "Flares and coronal holes", "Where flares and fast wind come from: NOAA's active regions, the flares of the last days and the coronal holes in SUVI pictures.", "Regions marked ⚠ δ flare the most. A coronal hole crossing the middle of the Sun sends fast wind to Earth 2–4 days later."], ["[data-p=\"wind\"].tl", "#7BE0FF", "Solar wind and storm levels", "The wind measured at L1, 1.5 million km towards the Sun, and NOAA's S / G scales and satellite alerts.", "Watch Bz: south (below 0) for hours together with fast wind means a storm. The dashed marks guess CME shocks and coronal-hole streams."], ["[data-p=\"shield\"].tl", "#5AC8FF", "Magnetic shield and cosmic rays", "How hard storms squeeze Earth's magnetic field (Dst) and how many cosmic rays reach the ground.", "Dst below −50 nT = a storm, −100 strong, −250 extreme. A sudden drop in cosmic rays (a Forbush decrease) means a CME is passing."], ["[data-p=\"forecast\"].tl", "#39FF9E", "NOAA Aurora Forecast", "Tonight's answer for your place: the verdict, hour by hour, the Kp index and NOAA's aurora oval.", "Click to open it big — there you can also change your place."], ["[data-p=\"earth\"].tl", "#3EE08F", "Sun–Earth record · earthquakes", "Every day since 2008 side by side — sunspots, solar wind, Kp — and this week's earthquakes and volcanoes.", "Compare the lines to see how the Sun's cycle drives the storms. A link between the Sun and earthquakes is still debated."], ["[data-p=\"replay\"].tl", "#FF5A5A", "Storm replay", "The real G5 storm of 8–13 May 2024 on one clock: flares, CMEs, the shock at L1 and the storm at Earth.", "Press play: the clock stops at the 15 key moments and explains each one."], ["[data-p=\"cycle\"].tl", "#FFD24A", "Solar cycle", "The smoothed sunspot number of cycle 25 against cycles 21–24, and NOAA's prediction.", "The higher the curve, the more flares and storms. Cycle 25 peaked around 2024–2025."], ["[data-p=\"3d\"].tl", "#B9A7FF", "3D model", "The planets, the Sun's magnetic field, the solar wind and the CMEs in flight — real positions on a real clock.", "Open it, drag to turn, scroll to zoom, tap a planet to fly there."], ["[data-split]", "#E6EDF5", "Side by side", "Reads two modules at once, each with its own scroll.", "Click a half to make it the active one: the buttons on top then change that half. ✕ on a half closes only that one."]]);   // explain on hover
})();
