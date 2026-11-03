/* side nav: ids for the chapter rows, smooth jumps, highlight the section on screen */
(() => { const ch = [...document.querySelectorAll('.chap')]; ch.forEach((c, i) => { if (!c.id) c.id = 'chap' + (i + 1); });
  const links = [...document.querySelectorAll('.sidenav a')], tg = links.map(a => document.getElementById(a.hash.slice(1))).filter(Boolean);
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  links.forEach(a => a.onclick = e => { const t = document.getElementById(a.hash.slice(1)); if (!t) return; e.preventDefault(); t.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'start' }); history.replaceState(null, '', location.search + a.hash); });
  const upd = () => { let best = null, bd = 1e9; tg.forEach(t => { const r = t.getBoundingClientRect(), d = Math.abs(r.top - innerHeight * .25); if (r.bottom > 80 && d < bd) { bd = d; best = t; } });
    links.forEach(a => a.classList.toggle('on', !!best && a.hash === '#' + best.id)); };
  let q = 0; addEventListener('scroll', () => { if (!q) q = requestAnimationFrame(() => { q = 0; upd(); }); }, { passive: true }); upd(); })();
