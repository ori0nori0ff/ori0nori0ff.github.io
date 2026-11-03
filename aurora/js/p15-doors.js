/* the three doors: live picture of the Sun (CCOR-1; LASCO C3 in storm mode) + a live line each */
(() => { if (innerWidth < 1000) return; const NO = 'https://services.swpc.noaa.gov/', g = id => document.getElementById(id);
  const setImg = u => { const im = new Image(); im.onload = () => { g('ptSunImg').style.backgroundImage = `url("${im.src}")`; }; im.src = u; };
  // the newest SDO AIA 171 picture at 1024 px from our hourly frame list (AIA 193 in storm mode — what was archived for that day)
  fetch('sun/frames.json?t=' + Math.floor(Date.now() / 3e5)).then(r => r.json()).then(F => { const L = (F.filters || {})['0171'] || (F.filters || {})['0193'] || []; const f = L[L.length - 1]; if (f) setImg(f[1]); }).catch(() => {});
  fetch(NO + 'json/goes/primary/xray-flares-7-day.json').then(r => r.json()).then(fl => { const now = Date.now(), d = fl.filter(f => now - Date.parse(f.max_time) < 864e5);
    const b = d.reduce((a, f) => !a || f.max_xrlong > a.max_xrlong ? f : a, null); if (b) g('ptSun').textContent = T('Biggest flare in 24 h: {c}', { c: b.max_class }); }).catch(() => {});
  Promise.all([fetch(NO + 'products/summary/solar-wind-speed.json').then(r => r.json()), fetch(NO + 'products/summary/solar-wind-mag-field.json').then(r => r.json())])
    .then(([v, m]) => { g('ptEarth').textContent = T('Wind {v} km/s · Bz {b} nT', { v: Math.round(+v[0].proton_speed), b: +m[0].bz_gsm }); }).catch(() => {}); })();
