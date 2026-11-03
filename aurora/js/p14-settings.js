/* settings drawer (⚙) + the PC tools at the top of the side bar; every control drives the page's own buttons */
(() => { if (innerWidth < 1000) return;
  const $q = q => document.querySelector(q), get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const storm = !!window.STORM, lang = document.documentElement.lang || 'en';
  const goStorm = (v, a) => window.tmGo && tmGo(v, a);
  if (get('aurora.nav') === 'pin') document.documentElement.classList.add('navpin');
  // the hidden side menu (≥ 1280 px) folds back after a pick, even while the mouse is still over it
  { const n = document.querySelector('.sidenav'); if (n) n.addEventListener('click', e => { if (!e.target.closest('a') || document.documentElement.classList.contains('navpin')) return;
      n.classList.add('shut'); const off = () => { n.classList.remove('shut'); n.removeEventListener('mouseleave', off); }; n.addEventListener('mouseleave', off); setTimeout(off, 2500); }); }
  // the drawer
  const sh = document.createElement('div'); sh.id = 'setShade';
  const pn = document.createElement('aside'); pn.id = 'setPane'; pn.setAttribute('aria-label', T('Settings')); pn.setAttribute('aria-hidden', 'true');
  pn.innerHTML = `<h2>⚙ ${T('Settings')}<button type="button" data-x aria-label="${T('Close')}">✕</button></h2>
    <div class="sg"><div class="lbl">${T('Language')}</div><div class="seg" data-noi18n>${['en', 'ro', 'de'].map(l => `<button type="button" data-l="${l}" aria-pressed="${l === lang}">${l.toUpperCase()}</button>`).join('')}</div></div>
    <div class="sg"><div class="lbl">${T('Your place')}</div><div class="row"><span class="place">${($q('#gPlace') || {}).textContent || ''}</span><button type="button" class="sb" data-a="place">${T('CHANGE PLACE')}</button></div>
      <div class="note">${T('The verdict, tonight\'s hours and the Kp you need follow this place. It stays on this device only.')}</div></div>
    <div class="sg"><div class="lbl">${T('Space weather shown')}</div><div class="seg" role="group" aria-label="${T('Live or time machine')}"><button type="button" data-m="" aria-pressed="${!storm}">LIVE</button><button type="button" data-m="tm" aria-pressed="${storm}" aria-haspopup="dialog">${T('TIME MACHINE')}</button></div>
      <div class="note">${T('Time machine = the whole page with the real data of a past week (big storms + every week since 28 Sep 2026). Pick the week from the list.')}</div>
      <button type="button" class="sb storm" data-a="replay">▶ ${T('Storm replay · May 2024')}</button></div>
    <div class="sg"><div class="lbl">${T('Help')}</div><label class="sw">${T('Explain on hover (? How to read)')}<input type="checkbox" data-t="xp"></label><button type="button" class="sb" data-a="guide">${T('How it all works')}</button></div>
    <div class="sg"><div class="lbl">${T('Colour theme')}</div><div class="thm"><button type="button" data-th="" aria-pressed="${(get('aurora.theme') || '') === ''}"><i style="background:linear-gradient(90deg,#0A0A0A 0 40%,#12161C 40% 85%,#39FF9E 85%)"></i>${T('Night')}</button><button type="button" data-th="aurora" aria-pressed="${(get('aurora.theme') || '') === 'aurora'}"><i style="background:linear-gradient(90deg,#050F0C 0 40%,#0D1B17 40% 85%,#39FF9E 85%)"></i>${T('Aurora')}</button><button type="button" data-th="solar" aria-pressed="${(get('aurora.theme') || '') === 'solar'}"><i style="background:linear-gradient(90deg,#0F0905 0 40%,#1B130C 40% 85%,#FFB020 85%)"></i>${T('Solar')}</button><button type="button" data-th="nebula" aria-pressed="${(get('aurora.theme') || '') === 'nebula'}"><i style="background:linear-gradient(90deg,#0B0713 0 40%,#161025 40% 85%,#B9A7FF 85%)"></i>${T('Nebula')}</button><button type="button" data-th="ocean" aria-pressed="${(get('aurora.theme') || '') === 'ocean'}"><i style="background:linear-gradient(90deg,#040A13 0 40%,#0B1525 40% 85%,#7BE0FF 85%)"></i>${T('Ocean')}</button><button type="button" data-th="mono" aria-pressed="${(get('aurora.theme') || '') === 'mono'}"><i style="background:linear-gradient(90deg,#080808 0 40%,#141414 40% 85%,#E6EDF5 85%)"></i>${T('Graphite')}</button></div></div>
    <div class="sg"><div class="lbl">${T('3D model starts on')}</div><div class="seg" style="display:grid;grid-template-columns:1fr 1fr;border-radius:14px">${[['shield', 'Magnetic shield'], ['earth', 'Earth'], ['sys', 'Solar system'], ['last', 'Last view']].map(([k, l]) => `<button type="button" data-s3="${k}" aria-pressed="${(get('aurora.s3dstart') || 'shield') === k}">${T(l)}</button>`).join('')}</div></div>
    <div class="sg"><div class="lbl">${T('3D quality')}</div><div class="seg" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;border-radius:14px">${[['', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']].map(([k, l]) => `<button type="button" data-q3="${k}" aria-pressed="${(get('aurora.q3d') || '') === k}" title="${k ? '' : T('Auto = low in light mode, else high')}">${T(l)}</button>`).join('')}</div></div>
    <div class="sg"><div class="lbl">${T('Display')}</div><label class="sw">${T('Animations')}<input type="checkbox" data-t="mo" ${get('aurora.motion') === 'off' ? '' : 'checked'}></label>
      <label class="sw">${T('Light mode for slower PCs')}<input type="checkbox" data-t="lite" ${document.documentElement.classList.contains('lite') ? 'checked' : ''}></label>
      <div class="sh" style="margin:-4px 0 8px;font-size:12px;color:var(--dim)">${T('Slower clock steps, no autoplay, no blur or animations, fewer Sun frames loaded, the 3D model paused while it is a small tile. The page reloads.')}</div>
      <label class="sw">${T('Sun filters change by themselves')}<input type="checkbox" data-t="sunauto" ${get('aurora.sunauto') === 'off' ? '' : 'checked'}></label>
      <label class="sw">${T('Keep the side menu open')}<input type="checkbox" data-t="nav" ${get('aurora.nav') === 'pin' ? 'checked' : ''}></label></div>
    <div class="sg" id="tlCfgG" hidden><div class="lbl">${T('Board tiles')}</div><div id="tlCfg"></div></div>
    <div class="sg"><div class="lbl">${T('Report')}</div><button type="button" class="sb rep" data-a="rep">⬇ ${T('Save the full report (image)')}</button>
      <a href="#safe" class="note" data-a="safe">${T('No cookies, no tracking, nothing about you is stored')} ›</a></div>`;
  document.body.append(sh, pn);
  const open = () => { { const g = $q('#tlCfgG'); if (g) { g.hidden = !window.tilesCfg; if (window.tilesCfg) tilesCfg($q('#tlCfg')); } } pn.classList.add('on'); sh.classList.add('on'); pn.setAttribute('aria-hidden', 'false'); const xb = $q('#xpBtn'); pn.querySelector('[data-t="xp"]').checked = !!(xb && xb.getAttribute('aria-pressed') === 'true'); pn.querySelector('[data-x]').focus(); };
  const close = () => { pn.classList.remove('on'); sh.classList.remove('on'); pn.setAttribute('aria-hidden', 'true'); };
  sh.onclick = close; addEventListener('keydown', e => { if (e.key === 'Escape' && pn.classList.contains('on')) close(); });
  pn.addEventListener('click', e => { const t = e.target;
    if (t.closest('[data-x]')) return close();
    const l = t.closest('[data-l]'); if (l) { const o = $q(`.seg [data-lang="${l.dataset.l}"]`); if (o) o.click(); return; }
    const m = t.closest('[data-m]'); if (m) { if (m.dataset.m) close(); return goStorm(m.dataset.m, null); }
    const q3 = t.closest('[data-q3]'); if (q3) { if ((get('aurora.q3d') || '') === q3.dataset.q3) return; put('aurora.q3d', q3.dataset.q3 || null); location.reload(); return; }
    const s3 = t.closest('[data-s3]'); if (s3) { put('aurora.s3dstart', s3.dataset.s3 === 'shield' ? null : s3.dataset.s3); pn.querySelectorAll('[data-s3]').forEach(b => b.setAttribute('aria-pressed', b === s3)); return; }
    const th = t.closest('[data-th]'); if (th) { const v = th.dataset.th; if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme; put('aurora.theme', v || null); pn.querySelectorAll('[data-th]').forEach(b => b.setAttribute('aria-pressed', String(b === th))); return; }
    const a = t.closest('[data-a]'); if (!a) return; const k = a.dataset.a;
    if (k === 'place') { close(); const b = $q('#locBtn'); if (b) { b.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => b.click(), 400); } }
    else if (k === 'replay') { close(); window.openReplay && openReplay(); }
    else if (k === 'guide') { close(); const xb = $q('#xpBtn'); if (xb && xb.getAttribute('aria-pressed') !== 'true') xb.click(); setTimeout(() => { const g = $q('#xpBar .go'); if (g) g.click(); }, 50); }
    else if (k === 'rep') { close(); const r = $q('#repSave'); if (r) r.click(); }
    else if (k === 'safe') close(); });
  pn.addEventListener('change', e => { const c = e.target.closest('[data-t]'); if (!c) return;
    if (c.dataset.t === 'xp') { const xb = $q('#xpBtn'); if (xb && (xb.getAttribute('aria-pressed') === 'true') !== c.checked) xb.click(); }
    if (c.dataset.t === 'mo') { put('aurora.motion', c.checked ? null : 'off'); location.reload(); }
    if (c.dataset.t === 'lite') { put('aurora.lite', c.checked ? 'on' : null); const u = new URL(location.href); u.searchParams.delete('lite'); location.replace(u.href); return; }
    if (c.dataset.t === 'sunauto') put('aurora.sunauto', c.checked ? null : 'off');
    if (c.dataset.t === 'nav') { put('aurora.nav', c.checked ? 'pin' : null); document.documentElement.classList.toggle('navpin', c.checked); } });
  // ⚙ in the top row (1000–1279 px) …
  const g1 = document.createElement('button'); g1.id = 'setBtn'; g1.type = 'button'; g1.setAttribute('aria-label', T('Settings')); g1.textContent = '⚙'; g1.onclick = open;
  const top = $q('.topbar'); if (top) top.appendChild(g1);
  if (location.hash === '#settings') setTimeout(open, 0);   // link straight to the settings
  // … and at the top of the side bar (≥ 1280 px): calm / storm, ? how to read, ⚙
  const nav = $q('.sidenav'); if (!nav) return;
  const tl = document.createElement('div'); tl.className = 'sntools';
  tl.innerHTML = `<div class="seg" role="group" aria-label="${T('Live or time machine')}"><button type="button" data-m="" aria-pressed="${!storm}">LIVE</button><button type="button" data-m="tm" aria-pressed="${storm}" aria-haspopup="dialog">${T('TIME MACHINE')}</button></div>
    <div class="row"><button type="button" class="tb" data-a="xp" aria-pressed="false">? ${T('HOW TO READ')}</button><button type="button" class="tb gear" aria-label="${T('Settings')}">⚙</button></div>`;
  nav.prepend(tl); document.documentElement.classList.add('snt');
  tl.addEventListener('click', e => { const m = e.target.closest('[data-m]'); if (m) return goStorm(m.dataset.m, m);
    if (e.target.closest('.gear')) return open();
    const x = e.target.closest('[data-a="xp"]'); if (x) { const xb = $q('#xpBtn'); if (xb) { xb.click(); x.setAttribute('aria-pressed', xb.getAttribute('aria-pressed')); } } });
  // keep the side-bar button in step when explain mode is closed from its own bar / Esc
  new MutationObserver(() => { const xb = $q('#xpBtn'), x = tl.querySelector('[data-a="xp"]'); if (xb && x) x.setAttribute('aria-pressed', xb.getAttribute('aria-pressed') || 'false'); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
})();
