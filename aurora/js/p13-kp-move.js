/* PC (≥ 1000 px): the Kp chart moves into the answer card; back under the top row on narrower screens */
(() => { const c = document.getElementById('kpChartCard'), v = document.getElementById('vcard'), g = document.querySelector('.grid.top'); if (!c || !v || !g) return;
  const help = v.querySelector(':scope > .help'), home = c.parentNode, next = c.nextSibling;
  const place = () => { const pc = innerWidth >= 1000;
    if (pc && c.parentNode !== v) { v.insertBefore(c, help); v.classList.add('haskp'); } else if (!pc && c.parentNode === v) { home.insertBefore(c, next); v.classList.remove('haskp'); } else return;
    if (window.S && S.kpList && window.drawKpChartAgain) drawKpChartAgain(); else dispatchEvent(new Event('resize')); };
  place(); let q = 0; addEventListener('resize', () => { clearTimeout(q); q = setTimeout(place, 150); }); })();
