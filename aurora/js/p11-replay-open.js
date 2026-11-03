/* storm replay: lazy-loaded, opened from the guide / the explain bar / #replay */
window.openReplay = (n, id) => { if (window.StormReplay) return StormReplay.open(n, id); const s = document.createElement('script'); s.src = 'replay.js?v=63396e92'; s.onload = () => StormReplay.open(n, id); document.body.appendChild(s); };
{ const m = location.hash.match(/^#replay(?:=(\w+))?(?:-(\d+))?$/); if (m) setTimeout(() => openReplay(m[2] ? m[2] - 1 : 0, m[1]), 0); }   // #replay / #replay-9 = open at that step; #replay=oct2024 = another week of the archive
document.addEventListener('click', e => { const b = e.target.closest('[data-replay]'); if (!b) return; e.preventDefault(); const o = document.getElementById('xpOv'); if (o) o.classList.remove('on'); openReplay(); });
