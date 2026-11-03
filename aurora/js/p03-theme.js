try { const t = new URLSearchParams(location.search).get('theme') || localStorage.getItem('aurora.theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
