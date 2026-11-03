/* tiny header switches (PC): LIVE | TIME MACHINE and HOVER HELP OFF | ON, driving the page's own buttons */
(() => { if (innerWidth < 1000) return; const h = document.querySelector('main h1'); if (!h) return;
  const w = document.createElement('span'); w.className = 'hdwrap'; h.parentNode.insertBefore(w, h); w.appendChild(h); h.style.display = 'inline-block';
  const storm = !!window.STORM, t = document.createElement('div'); t.className = 'hdtools';
  const lX = T('Explain on hover (? How to read)');
  t.innerHTML = `<div class="hs" role="group" aria-label="${T('Live or time machine')}"><button type="button" class="c" aria-pressed="${!storm}">LIVE</button><button type="button" class="s" aria-pressed="${storm}" aria-haspopup="dialog" aria-expanded="false">${T('TIME MACHINE')}</button></div><button type="button" class="hx" aria-pressed="false" aria-label="${lX}"><b>?</b><i></i></button><button type="button" class="hg" aria-label="${T('Settings')}">⚙</button>`;
  (h.closest('main') || w).appendChild(t);
  t.querySelector('.hg').onclick = () => { const b = document.getElementById('setBtn'); if (b) b.click(); };
  if (storm) { const sb = document.querySelector('.stormbar'); if (sb) sb.style.display = 'none'; const n = document.createElement('div'); n.className = 'stormnote'; n.textContent = STORM.week ? T('Time machine: {w} · real data, not live', { w: T(STORM.label) }) : T('Peak of the May 2024 G5 storm · real data, not live'); t.after(n); }   // storm mode: a small note under the switches, not a band over the page
  // the one clock (Sun + ENLIL) as a small bar under the switches: drives the page's own clock buttons
  const ck = document.createElement('div'); ck.className = 'hdclock' + (storm ? ' st' : ''); ck.setAttribute('role', 'group'); ck.setAttribute('aria-label', T('One clock · Sun + solar wind'));
  ck.innerHTML = `<span class="ct"><i></i><b>–</b></span><button type="button" data-k="syPrev" aria-label="${T('One hour back')}"><svg viewBox="0 0 16 16"><path d="M3 3v10M13 3 6 8l7 5z"/></svg></button><button type="button" data-k="syRev" aria-label="${T('Play backwards')}"><svg viewBox="0 0 16 16"><path d="M12 3 4 8l8 5z"/></svg></button><button type="button" class="pp" data-k="syPlay" aria-label="${T('Play / pause')}"><svg viewBox="0 0 16 16"><path class="pl" d="M5 3l8 5-8 5z"/><path class="pa" d="M4 3h2.4v10H4zM9.6 3H12v10H9.6z"/></svg></button><button type="button" data-k="syNext" aria-label="${T('One hour forward')}"><svg viewBox="0 0 16 16"><path d="M13 3v10M3 3l7 5-7 5z"/></svg></button><button type="button" class="sp" data-k="sySpd" aria-label="${T('Playback speed')}">1×</button><button type="button" class="nw" data-now aria-label="${T('Stop and go back to now')}">${T('NOW')}</button><input type="range" class="rg" min="0" max="1000" value="1000" aria-label="${T('Date and time shown in every chart')}">`;
  t.prepend(ck);
  const rg = ck.querySelector('.rg'); let drag = false;
  rg.addEventListener('input', () => { drag = true; const s = document.getElementById('sySlide'); if (s && s.oninput) { s.value = rg.value; s.oninput({ target: s }); } sync2(); });
  rg.addEventListener('change', () => { drag = false; });
  ck.addEventListener('click', e => { if (e.target.closest('[data-now]')) { if (window.syNow) syNow(); sync2(); return; } const b = e.target.closest('[data-k]'); if (!b) return; const o = document.getElementById(b.dataset.k); if (o) o.click(); sync2(); });
  const sync2 = () => { const pl = document.getElementById('syPlay'), on = !!pl && pl.textContent.trim() === '⏸', rv = document.getElementById('syRev'), sl = document.getElementById('sySlide'), tt = document.getElementById('syT'), sd = document.getElementById('sySpd');
    ck.classList.toggle('on', on); ck.querySelector('[data-k="syRev"]').classList.toggle('a', !!rv && rv.getAttribute('aria-pressed') === 'true' && on);
    if (tt) ck.querySelector('.ct b').textContent = tt.textContent.trim(); if (sd) ck.querySelector('.sp').textContent = sd.textContent.trim();
    if (sl && !drag) rg.value = sl.value; rg.style.setProperty('--p', (+rg.value / 10) + '%'); };
  sync2(); setInterval(sync2, 400);
  t.querySelector('.hs .c').onclick = () => window.tmGo && tmGo(''); t.querySelector('.hs .s').onclick = e => window.tmGo && tmGo('tm', e.currentTarget);
  const hx = t.querySelector('.hx'), sync = () => hx.setAttribute('aria-pressed', String(document.documentElement.classList.contains('xp')));
  hx.onclick = () => { const b = document.getElementById('xpBtn'); if (b) b.click(); sync(); };
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }); sync(); })();
