/* motion (PC, no reduced motion) */
(() => { let off = false; try { off = localStorage.getItem('aurora.motion') === 'off'; } catch (e) {}
  if (off || document.documentElement.classList.contains('lite') || innerWidth < 1000 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const root = document.documentElement; root.classList.add('mo');
  // cards + chapter openings rise in once; their charts draw themselves the first time
  const io = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; const el = e.target; el.classList.add('in'); io.unobserve(el);
    el.querySelectorAll('svg').forEach(sv => { if (sv.closest('.chx')) return; sv.classList.add('draw'); setTimeout(() => sv.classList.remove('draw'), 2600); }); }), { rootMargin: '0px 0px -8% 0px', threshold: .06 });
  document.querySelectorAll('main .card, main .chx').forEach(el => io.observe(el));
  // safety net (e.g. a background tab, where observers can stall): reveal whatever is on screen on every scroll / load
  const seen = () => document.querySelectorAll('main .card:not(.in), main .chx:not(.in)').forEach(el => { const r = el.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) el.classList.add('in'); });
  let sq = 0; addEventListener('scroll', () => { if (!sq) sq = requestAnimationFrame(() => { sq = 0; seen(); }); }, { passive: true }); addEventListener('load', seen); setTimeout(seen, 1200);
  document.addEventListener('visibilitychange', seen);
  // chapter images + the flower of life drift with the scroll (slow parallax)
  const chx = [...document.querySelectorAll('.chx')]; let q = 0;
  const par = () => { q = 0; const vh = innerHeight; chx.forEach(c => { const r = c.getBoundingClientRect(); if (r.bottom < 0 || r.top > vh) return; c.style.setProperty('--py', ((r.top + r.height / 2 - vh / 2) * -.12).toFixed(1) + 'px'); });
    document.body.style.backgroundPosition = 'center, center ' + (-scrollY * .06).toFixed(1) + 'px'; };
  addEventListener('scroll', () => { if (!q) q = requestAnimationFrame(par); }, { passive: true }); par();
  // live numbers count to their new value and glow briefly when they change
  const NUM = /-?\d+(?:\.\d+)?/, busy = new WeakSet(), last = new WeakMap();
  const count = el => { if (busy.has(el)) return; const txt = el.textContent, m = txt.match(NUM); if (!m) return; const to = +m[0], from = last.has(el) ? last.get(el) : 0; last.set(el, to);
    if (from === to) return; const dec = (m[0].split('.')[1] || '').length, t0 = performance.now(), D = 900; busy.add(el);
    const step = now => { const k = Math.min(1, (now - t0) / D), v = from + (to - from) * (1 - Math.pow(1 - k, 3)); el.textContent = txt.replace(m[0], v.toFixed(dec)); if (k < 1) requestAnimationFrame(step); else { el.textContent = txt; busy.delete(el); el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); } };
    requestAnimationFrame(step); };
  ['kpNow', 'swV', 'swBz'].forEach(id => { const el = document.getElementById(id); if (!el) return; new MutationObserver(() => count(el)).observe(el, { childList: true, characterData: true, subtree: true }); if (NUM.test(el.textContent)) count(el); });
  // a jump from the side nav or a chapter link lights up where you landed
  document.addEventListener('click', e => { const a = e.target.closest('.sidenav a, .chlinks a'); if (!a) return; const t = document.getElementById(a.hash.slice(1)); if (!t) return;
    setTimeout(() => { t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash'); }, 650); });
})();
