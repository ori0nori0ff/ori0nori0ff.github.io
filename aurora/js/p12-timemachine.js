/* LIVE | TIME MACHINE: the time machine = ?storm=<week> (storm.js answers every feed with that week's real data);
   TIME MACHINE opens a small list of the archived weeks (the famous storms here + the weekly bot's weeks in /aurora-replay/) */
(() => { const on = !!window.STORM, set = v => { const u = new URL(location.href); if (v) u.searchParams.set('storm', v); else u.searchParams.delete('storm'); u.hash = ''; location.href = u.href; };
  let pk = null, back = null, IX = null;
  const weeks = async () => { if (IX) return IX; const get = async b => { try { return await (await fetch(b + 'index.json?t=' + Math.floor(Date.now() / 36e5))).json(); } catch (e) { return []; } };
    const [a, w] = await Promise.all([get('replay/'), get('/aurora-replay/')]), ids = new Set(a.map(e => e.id));
    return IX = a.concat(w.filter(e => !ids.has(e.id))).filter(e => e.tm || e.id === 'may2024').sort((x, y) => y.t0 - x.t0); };
  const gOf = k => k >= 8.99 ? 5 : k >= 7.66 ? 4 : k >= 6.66 ? 3 : k >= 5.66 ? 2 : k >= 4.66 ? 1 : 0;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const close = () => { if (!pk || pk.hidden) return; pk.hidden = true; document.querySelectorAll('[aria-haspopup="dialog"][aria-expanded]').forEach(b => b.setAttribute('aria-expanded', 'false')); if (back && back.isConnected && back.offsetParent) back.focus(); };
  window.openTM = async anchor => {
    if (!pk) { pk = document.createElement('div'); pk.id = 'tmPick'; pk.setAttribute('role', 'dialog'); pk.setAttribute('aria-labelledby', 'tmH'); pk.hidden = true; document.body.appendChild(pk);
      pk.addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (b) { if (!on || b.dataset.w !== STORM.id) set(b.dataset.w); else close(); return; }
        if (e.target.closest('.tmlive')) return set(''); if (e.target.closest('.tmx')) close(); });
      addEventListener('keydown', e => { if (e.key === 'Escape' && !pk.hidden) { e.stopPropagation(); close(); } }, true);
      document.addEventListener('pointerdown', e => { if (!pk.hidden && !pk.contains(e.target) && !e.target.closest('[aria-haspopup="dialog"]')) close(); }); }
    if (!pk.hidden) return close();
    back = anchor || document.activeElement;
    const L = await weeks(), fmt = (t, o) => new Date(t).toLocaleDateString(LOC, Object.assign({ day: 'numeric', timeZone: 'UTC' }, o));
    pk.innerHTML = `<button type="button" class="tmx" aria-label="${T('Close')}">✕</button><h2 id="tmH">${T('TIME MACHINE')}</h2><p>${T('Pick a week: the whole page shows its real data — Sun, solar wind, Kp, aurora, 3D. Drag the clock to move through it.')}</p>
      <ul>${L.map(e => { const g = gOf(Math.max(...(e.kp || [0]))), cur = on && STORM.id === e.id;
        return `<li><button type="button" data-w="${esc(e.id)}"${cur ? ' aria-current="true"' : ''}><span class="t">${esc(T(e.title || e.id))}</span><span class="d">${fmt(e.t0, new Date(e.t0).getUTCMonth() !== new Date(e.t1 - 1).getUTCMonth() ? { month: 'long' } : {})} – ${fmt(e.t1 - 1, { month: 'long', year: 'numeric' })}</span><span class="g">${g ? 'G' + g : ''}</span></button></li>`; }).join('') || `<li>${T('No weeks yet.')}</li>`}</ul>
      ${on ? `<button type="button" class="tmlive">${T('Back to live')}</button>` : ''}`;
    pk.hidden = false;
    const r = anchor && anchor.offsetParent && !anchor.closest('#setPane') ? anchor.getBoundingClientRect() : null, W = pk.offsetWidth, H = pk.offsetHeight;
    if (r && innerWidth >= 600) { pk.style.left = Math.max(16, Math.min(innerWidth - W - 16, r.right - W)) + 'px'; pk.style.top = Math.min(r.bottom + 8, innerHeight - H - 16) + 'px'; }
    else { pk.style.left = Math.max(16, (innerWidth - W) / 2) + 'px'; pk.style.top = Math.max(16, (innerHeight - H) / 2) + 'px'; }
    if (anchor && anchor.hasAttribute('aria-haspopup')) anchor.setAttribute('aria-expanded', 'true');
    (pk.querySelector('[aria-current="true"]') || pk.querySelector('[data-w]') || pk.querySelector('.tmx')).focus(); };
  window.tmGo = (v, anchor) => { if (v === 'tm') return openTM(anchor); if (on) set(''); };
  document.querySelectorAll('.stormseg button').forEach(b => { b.setAttribute('aria-pressed', String(on ? b.dataset.storm === 'tm' : !b.dataset.storm)); b.onclick = () => tmGo(b.dataset.storm, b); });
  if (!on) return;
  // TIME MACHINE v2: follow the shared clock (sy) — while it plays every ~1.5 s, after a drag once it stops; NOW = the end of the week
  // the 3D model's time + shield jump only once the clock rests (settled), never while it plays
  { let prev = 0, last = 0, busy = false, done = STORM.at, settled = true, a3 = STORM.at;
    setInterval(async () => { if (busy || typeof sy === 'undefined' || !sy.on || !sy.t || !window.tmNow) return;
      const t = Math.max(STORM.t0 || 0, Math.min(STORM.now, sy.t)), moving = t !== prev, rest = !moving && !sy.timer; prev = t;
      const far = Math.abs(t - done) >= 10 * 6e4;
      // the 3D model open big on screen: no work while the clock plays (each update stole a frame or two → the camera shook)
      const h3 = document.getElementById('s3dHost'), r3 = h3 && h3.getBoundingClientRect(), big3d = r3 && r3.width > 500 && r3.bottom > 0 && r3.top < innerHeight;
      if (rest && !big3d && a3 !== t && !far && settled) { a3 = t; STORM.setAt(t, true); dispatchEvent(new Event('powhau-tm')); return; }   // the 3D closed again: now it catches up
      if (!(far || (rest && !settled)) || (moving && (big3d || performance.now() - last < 1500))) return;
      // the 3D model's own clock moves to the page clock only while it is not open big (moving it under your eyes broke its slider + CMEs)
      busy = true; last = performance.now(); done = t; settled = rest; if (rest && !big3d) a3 = t; STORM.setAt(t, rest && !big3d); try { await tmNow(rest, rest && !big3d); } finally { busy = false; } }, 400); }
  const bar = document.createElement('div'); bar.className = 'stormbar'; bar.setAttribute('role', 'status');
  bar.innerHTML = `<span><b>${T('TIME MACHINE')}</b> · ${STORM.week ? T('Time machine: {w} — real data of that week, not live. Drag the clock to move through it.', { w: T(STORM.label) }) : T('This page shows {t} — the peak of the G5 storm of May 2024. Real data of that day, not live.', { t: new Date(STORM.now).toLocaleString(LOC, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }) })}</span><button type="button">${T('Back to live')}</button>`;
  bar.querySelector('button').onclick = () => set('');
  document.body.prepend(bar);
  // links to other parts of the page keep the storm on
  document.addEventListener('click', e => { const a = e.target.closest('a[href^="?"]'); if (a && !/storm=/.test(a.href)) { const u = new URL(a.href); u.searchParams.set('storm', STORM.id); a.href = u.href; } }, true);
})();
