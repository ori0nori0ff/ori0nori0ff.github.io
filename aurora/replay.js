/* Storm replay — the real 8–14 May 2024 G5 storm (Gannon storm), step by step, on one clock.
   Data baked by tools/build_replay.py into replay/may2024/ (OMNI solar wind + SYM-H, GFZ Kp, GOES X-rays, NMDB cosmic rays,
   SDO / SOHO pictures, NASA CCMC WSA-ENLIL run). Loaded on demand by index.html: window.StormReplay.open() */
(() => {
  const T = (s, o) => window.T ? window.T(s, o) : String(s).replace(/\{(\w+)\}/g, (m, k) => o && o[k] != null ? o[k] : m);
  let ID = 'may2024', BASE = 'replay/may2024/', IX = null; const H = 3600e3, NS = 'http://www.w3.org/2000/svg';
  let D = null, root = null, t = 0, play = false, speed = 1, raf = 0, last = 0, step = -1, SUNK = 'HMIIF', story = [];
  // guided tour (default): one step at a time — the clock glides to the next step, the rest of the screen dims, a pause to read, then on; after the last step (or ⇄) the viewer drives
  let guide = true, hold = 0, glide = 0;
  const $ = q => root.querySelector(q), esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const utc = x => new Date(x).toISOString().slice(5, 16).replace('T', ' ').replace('-', '.') + ' UTC';
  const ro = x => new Date(x).toLocaleString(document.documentElement.lang || 'en', { timeZone: 'Europe/Bucharest', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const idx = x => Math.max(0, Math.min(D.v.length - 1, Math.floor((x - D.t0) / D.step)));
  const near = (L, x) => { let b = L[0]; for (const p of L) { if (p[0] <= x) b = p; else break; } return b; };
  const kpAt = x => (near(D.kp, x) || [0, 0])[1];
  const peak = (k, a, b, f) => { let bi = -1, bv = null; for (let i = idx(a); i <= idx(b); i++) { const v = D[k][i]; if (v != null && (bv == null || f(v, bv))) { bv = v; bi = i; } } return [D.t0 + bi * D.step, bv]; };
  const xcls = v => v >= 1e-4 ? 'X' + (v / 1e-4).toFixed(1) : v >= 1e-5 ? 'M' + (v / 1e-5).toFixed(1) : 'C' + (v / 1e-6).toFixed(1);

  const SUNF = [['HMIIF', 'HMI · sunspots', '#FFB347'], ['0131', 'AIA 131 · flares', '#3FD2FF'], ['0193', 'AIA 193 · corona', '#FFC34D'], ['C2', 'LASCO C2', '#FF8A4A'], ['C3', 'LASCO C3', '#4A7BFF']];

  /* the story: times found in the data (flare peaks, the shock, the deepest SYM-H), words from what happened */
  function buildStory() {
    const d = s => Date.UTC(2024, 4, +s.slice(0, 2), +s.slice(3, 5), +s.slice(6, 8));
    const fl = (a, b) => peak('xr', d(a), d(b), (v, w) => v > w);
    const f1 = fl('08 04:00', '08 07:00'), f2 = fl('09 08:00', '09 11:00'), f3 = fl('09 16:30', '09 19:30'), f4 = fl('10 05:30', '10 08:30'), f5 = fl('11 00:30', '11 03:00'), f6 = fl('14 16:00', '14 18:30');
    const v2 = peak('v', d('11 12:00'), d('13 00:00'), (v, w) => v > w);   // the fast wind after the X5.8 CME (its flank)
    const c0 = (D.cr.filter(p => p[0] < f5[0]).pop() || [0, 0])[1], gle = D.cr.filter(p => p[0] >= f5[0] && p[0] <= f5[0] + 4 * H).reduce((a, p) => p[1] > a[1] ? p : a, [0, -99]);   // GLE: the ground count jumps right after the flare
    // the shock at L1 = the biggest 15-minute jump in speed on 10 May
    let sh = d('10 16:30'), bj = 0; for (let i = idx(d('10 10:00')); i < idx(d('10 23:00')); i++) { const a = D.v[i], b = D.v[i + 3]; if (a != null && b != null && b - a > bj) { bj = b - a; sh = D.t0 + (i + 1) * D.step; } }
    const sym = peak('sym', d('10 18:00'), d('12 00:00'), (v, w) => v < w), bz = peak('bz', sh, sh + 12 * H, (v, w) => v < w), vmax = peak('v', sh, d('12 12:00'), (v, w) => v > w);
    const kmax = D.kp.find(p => p[1] >= 8.6) || D.kp.reduce((a, p) => p[1] > a[1] ? p : a);   // NOAA G5 = Kp 9− (8.67)
    const crmin = D.cr.reduce((a, p) => p[1] < a[1] ? p : a, [0, 0]);
    const L = (k, o) => ({ k, o });   // text key (EN = the dictionary key) + its values
    return [
      { t: d('08 00:00'), sun: 'HMIIF', hi: ['sun'], c: '#FFB347', h: L('Meet sunspot region 3664'),
        p: L('Early May 2024: a sunspot group about 15 times wider than Earth turns towards us — as big as the region behind the Carrington storm of 1859. Its tangled magnetic field is ready to snap.') },
      { t: f1[0], sun: '0131', hi: ['sun', 'xr'], c: '#3FD2FF', h: L('First flare: {x}', { x: xcls(f1[1]) }),
        p: L('A flash in the X-ray chart and on the Sun (AIA 131 shows gas at 10 million °C). The light reached Earth in 8 minutes; a cloud of plasma — a CME — has just been thrown out.'), fx: ['Radio blackout on the day side'] },
      { t: f1[0] + 3 * H, sun: 'C3', hi: ['sun'], c: '#4A7BFF', h: L('The CME leaves the Sun'),
        p: L('In the LASCO coronagraphs the disc hides the Sun. Watch the cloud spread around it: when it surrounds the disc, it is coming towards us (a "halo" CME). More follow over the next day.') },
      { t: f2[0], sun: '0131', hi: ['sun', 'xr'], c: '#3FD2FF', h: L('Flare {x} — a faster CME', { x: xcls(f2[1]) }),
        p: L('The same region erupts again. This CME is faster than the ones before it: it will catch up with them on the way and they will hit Earth together.') },
      { t: f3[0], sun: 'C2', hi: ['sun', 'enl'], c: '#FFA040', h: L('The forecast: a pile-up of CMEs'),
        p: L("Another flare ({x}) and another CME. NASA's and NOAA's WSA-ENLIL runs show the clouds merging into one wall of plasma, arriving on 10 May. NOAA issues its first severe (G4) storm watch since 2005.", { x: xcls(f3[1]) }) },
      { t: f4[0], sun: '0131', hi: ['sun', 'xr'], c: '#3FD2FF', h: L('Flare {x} while we wait', { x: xcls(f4[1]) }),
        p: L('The region keeps firing. Strong X-ray flares black out shortwave radio over the sunlit half of Earth — this one over Asia and Australia — while the CMEs are still on the way.'), fx: ['R3 radio blackout'] },
      { t: sh, sun: 'C3', hi: ['v', 'n', 'bz'], c: '#7BE0FF', h: L('The shock reaches L1'),
        p: L('{t}: at L1, 1.5 million km away, the probes see speed, density and the magnetic field jump all at once. Earth has about 30–40 minutes of warning.', { t: utc(sh) }) },
      { t: sh + 0.6 * H, sun: 'C3', hi: ['sym', 'bz'], c: '#7BE0FF', h: L('Impact: the shield is squeezed'),
        p: L("The cloud hits Earth's magnetic field: SYM-H jumps up (a \"sudden commencement\"). Then the cloud's field turns south — Bz down to {b} nT — and the shield opens.", { b: Math.round(bz[1]) }) },
      { t: kmax[0], sun: 'C3', hi: ['kp', 'globe'], c: '#FF4D4D', h: L('G5 — Kp {k}, extreme', { k: kmax[1].toFixed(1).replace('.0', '') }),
        p: L('The first extreme (G5) storm since October 2003. Energy pours into the upper air; the aurora oval swells far south. Power grids watch their transformers; GPS gets metres of error — precision tractors in the US stop in the middle of sowing.'), fx: ['G5 geomagnetic storm', 'GPS errors', 'Starlink degraded', 'Power grids on alert'] },
      { t: d('10 20:30'), sun: 'C3', hi: ['globe', 'kp'], c: '#39FF9E', h: L('Auroras over Romania'),
        p: L('Night falls over Europe with the storm at its peak: red and pink auroras are seen all over Romania, Italy and Spain — and far further south, in Mexico and northern India. Phone cameras see them even better than the eye.') },
      { t: f5[0], sun: '0131', hi: ['sun', 'xr'], c: '#3FD2FF', h: L('The biggest flare: {x}', { x: xcls(f5[1]) }),
        p: L("In the middle of the storm the region fires its strongest flare of the week. Its CME leaves at an angle: the ENLIL run of 11 May shows Earth catching only its flank."), fx: ['R3 radio blackout'] },
      ...(gle[1] - c0 >= 1 ? [{ t: gle[0], sun: '0131', hi: ['cr'], c: '#FFE14D', h: L('Particles from the flare reach the ground'),
        p: L("Protons from the flare, sped up to almost the speed of light, reach Earth within minutes and are counted at the ground: the Oulu neutron monitor jumps by {c} % in the middle of the Forbush decrease. A ground level enhancement (GLE 74) is rare — the first since 2021.", { c: (gle[1] - c0).toFixed(1) }), fx: ['S2 radiation storm', 'More radiation on polar flights'] }] : []),
      { t: v2[0], sun: 'C3', hi: ['v', 'bz', 'enl'], c: '#FFA040', h: L('Fast wind, but Bz north'),
        p: L("The flank of the X5.8 CME and the tail of the earlier clouds keep the wind at L1 very fast — up to {v} km/s on 12 May. But their magnetic field points north (Bz above 0), so the shield stays closed and the storm fades instead of starting again.", { v: Math.round(v2[1]) }) },
      { t: sym[0], sun: 'C3', hi: ['sym'], c: '#7BE0FF', h: L('The deepest point: SYM-H {v} nT', { v: Math.round(sym[1]) }),
        p: L("Earth's field at the equator is weakened the most since 2003 (the hourly Dst index reached −412 nT). The ring of current around Earth is full of storm particles.") },
      { t: crmin[0], sun: 'C3', hi: ['v', 'cr'], c: '#B9A7FF', h: L('Cosmic rays swept away'),
        p: L('The fast cloud (up to {v} km/s) carries its own magnetic field past Earth and pushes cosmic rays aside: the neutron count drops by {c} % — a Forbush decrease.', { v: Math.round(vmax[1]), c: Math.abs(crmin[1]).toFixed(1) }) },
      { t: d('13 12:00'), sun: 'HMIIF', hi: ['sym', 'kp', 'cr'], c: '#8E9AAB', h: L('Slow recovery'),
        p: L('The wind calms, Bz turns north, Kp falls. Dst and cosmic rays need days to come back. Region 3664 rotates away — and two weeks later, on the far side, it fires an X12 flare.') },
      { t: f6[0], sun: '0131', hi: ['sun', 'xr'], c: '#3FD2FF', h: L('The biggest flare of the cycle: {x}', { x: xcls(f6[1]) }),
        p: L("On 14 May, as region 3664 turns over the Sun's western edge, it fires the strongest flare of solar cycle 25. Its CME flies away from Earth — the region's farewell before it rotates out of view."), fx: ['R3 radio blackout'] },
      { t: D.t1 - 2 * H, sun: 'HMIIF', hi: [], c: '#39FF9E', h: L('What we learn'),
        p: L('Every warning on this page worked in order: the region on the Sun → the flares → the CMEs in the coronagraphs → the ENLIL forecast → the shock at L1 → Kp, Dst and the aurora. The same chain, live, is what the rest of this page shows every day.') },
    ].sort((a, b) => a.t - b.t);
  }

  /* any other week: the story is written from the data — the biggest flares, shocks at L1, Bz south, the storm's peak, the deepest
     SYM-H, a Forbush decrease or particles at the ground — plus a short hand-written note for the famous storms */
  const NOTES = {
    sep2017: 'Region 2673 fired the two biggest flares of solar cycle 24: X9.3 on 6 September and X8.2 on 10 September, from the Sun\'s western edge. The CMEs of 4 and 6 September drove a severe (G4) storm on 7–8 September, in the middle of the Atlantic hurricane season — the radio blackouts also hit emergency radio in the Caribbean.',
    apr2023: 'On 21 April 2023 a long filament erupted with an M1.7 flare and threw a CME straight at Earth. It arrived on 23 April and set off a severe (G4) storm, with auroras far south over Europe and the US.',
    oct2024: 'On 9 October 2024 an X1.8 flare from region 3848 launched a fast CME straight at Earth. It arrived on 10 October and drove a severe (G4) storm; red auroras were seen across Europe, Romania included, and as far south as Mexico.',
    nov2025: 'Region 4274 fired three X flares in three days, the strongest an X5.1 on 11 November 2025. Their CMEs reached Earth on 12 November and set off a severe (G4) storm, with auroras across Europe, Romania included.',
  };
  function autoStory() {
    const L = (k, o) => ({ k, o }), out = [], n = D.v.length, day = x => new Date(x).toLocaleDateString(document.documentElement.lang || 'en', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    out.push({ t: D.t0 + 2 * H, sun: 'HMIIF', hi: ['sun'], c: '#FFB347', h: L(D.title || 'The week of {d}', { d: day(D.t0) }),
      p: NOTES[ID] ? L(NOTES[ID]) : L('A week of real data from {d}. The steps were found automatically in the data: the biggest flares, shocks at L1, the storm\'s peak and its deepest point.', { d: day(D.t0) }) });
    // flares: peaks of the long channel ≥ M1, the highest within ±3 h; every X flare + the biggest M flares, at most 4
    const F = []; for (let i = 0; i < n; i++) { const v = D.xr[i]; if (v == null || v < 1e-5) continue; let top = true;
      for (let j = Math.max(0, i - 36); j <= Math.min(n - 1, i + 36); j++) if ((D.xr[j] || 0) > v || ((D.xr[j] || 0) === v && j < i)) { top = false; break; } if (top) F.push([D.t0 + i * D.step, v]); }
    F.sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([tt, v], fi) => { const X = v >= 1e-4;
      out.push({ t: tt, sun: '0131', hi: ['sun', 'xr'], c: '#3FD2FF', h: L('Flare {x}', { x: xcls(v) }),
        p: L(X ? 'An X-class flare: its X-rays reach Earth in 8 minutes and black out shortwave radio over the sunlit half of the planet. Watch the coronagraph a few hours later for a CME.' : 'An M-class flare: a minor to moderate radio blackout on the day side. Strong ones can also throw out a CME.'),
        fx: [X ? 'R3 radio blackout' : 'R1–R2 radio blackout'] });
      if (X && !fi) out.push({ t: tt + 3 * H, sun: 'C3', hi: ['sun'], c: '#4A7BFF', h: L('After the flare: a CME?'),   // once, after the biggest one
        p: L('In LASCO C3 a disc hides the Sun. A cloud that spreads all around the disc (a "halo") is coming our way; one that leaves to one side will miss us.') }); });
    // shocks at L1: speed up ≥ 80 km/s within 15 min with the density or the field jumping too; the 2 biggest, 12 h apart
    const S = []; for (let i = 0; i + 3 < n; i++) { const a = D.v[i], b = D.v[i + 3]; if (a == null || b == null || b - a < 80) continue;
      const na = D.n[i], nb = D.n[i + 3], ba = D.bt[i], bb = D.bt[i + 3]; if (!((na != null && nb != null && nb > na * 1.4) || (ba != null && bb != null && bb > ba * 1.4))) continue; S.push([i, b - a, a, b]); }
    S.sort((x, y) => y[1] - x[1]); const SH = []; S.forEach(q => { if (SH.length < 2 && SH.every(o => Math.abs(o[0] - q[0]) > 144)) SH.push(q); });
    SH.forEach(([i, , a, b]) => { const tt = D.t0 + (i + 1) * D.step;
      out.push({ t: tt, sun: 'C3', hi: ['v', 'n', 'bz'], c: '#7BE0FF', h: L('A shock reaches L1'),
        p: L('{t}: at L1, 1.5 million km away, the wind jumps from {a} to {b} km/s and the density and field jump with it — a CME has arrived. Earth gets about {m} minutes of warning.', { t: utc(tt), a: Math.round(a), b: Math.round(b), m: Math.round(1.5e6 / b / 60) }) }); });
    const bz = peak('bz', D.t0, D.t1, (v, w) => v < w), sym = peak('sym', D.t0, D.t1, (v, w) => v < w), km = D.kp.reduce((a, p) => p[1] > a[1] ? p : a, [D.t0, 0]);
    if (bz[1] != null && bz[1] <= -10) out.push({ t: bz[0], sun: 'C3', hi: ['bz', 'sym'], c: '#7BE0FF', h: L('Bz turns south: {b} nT', { b: Math.round(bz[1]) }),
      p: L('The cloud\'s magnetic field points south, against Earth\'s: the shield opens and energy pours in. The longer and stronger Bz stays south, the bigger the storm.') });
    if (gOf(km[1])) { const g = gOf(km[1]);
      out.push({ t: km[0], sun: 'C3', hi: ['kp', 'globe'], c: kpc(km[1]), h: L('G{g} — Kp {k}', { g, k: km[1].toFixed(1).replace('.0', '') }),
        p: L(g >= 5 ? 'An extreme storm, the rarest kind: the aurora oval swells far south, power grids and GPS feel it.' : g === 4 ? 'A severe storm: the aurora comes far south of its usual home — on good nights even over Romania. GPS and HF radio suffer.' : g === 3 ? 'A strong storm: aurora over Scandinavia, Scotland, northern Germany and Poland; satellites feel more drag.' : 'A minor to moderate storm: aurora over the north of Europe and Canada.'),
        fx: [g >= 4 ? 'G' + g + ' geomagnetic storm' : 'Aurora in the north'] }); }
    else out.push({ t: km[0], sun: 'C3', hi: ['kp', 'globe'], c: kpc(km[1]), h: L('No big storm this week'), p: L('Kp only reached {k}. The Sun was active, but nothing hit Earth hard enough for a storm.', { k: km[1].toFixed(1).replace('.0', '') }) });
    if (sym[1] != null && sym[1] <= -50) out.push({ t: sym[0], sun: 'C3', hi: ['sym'], c: '#7BE0FF', h: L('The deepest point: SYM-H {v} nT', { v: Math.round(sym[1]) }),
      p: L('The ring of current around Earth is at its strongest: the field at the equator is weakened by {v} nT. Below −100 nT is a strong storm, below −250 an extreme one.', { v: Math.abs(Math.round(sym[1])) }) });
    if (D.cr.length) { const c0 = D.cr[0][1], mn = D.cr.reduce((a, p) => p[1] < a[1] ? p : a), X = F.filter(f => f[1] >= 1e-4);
      let gl = null; X.forEach(([tt]) => { const b = (D.cr.filter(p => p[0] < tt).pop() || [0, c0])[1]; D.cr.filter(p => p[0] >= tt && p[0] <= tt + 4 * H).forEach(p => { if (p[1] - b >= 2 && (!gl || p[1] - b > gl[1])) gl = [p[0], p[1] - b]; }); });
      if (gl) out.push({ t: gl[0], sun: '0131', hi: ['cr'], c: '#FFE14D', h: L('Particles from the flare reach the ground'),
        p: L('Protons from the flare, sped up to almost the speed of light, reach Earth within minutes and are counted at the ground: the Oulu neutron monitor jumps by {c} %. A ground level enhancement is rare — a few per solar cycle.', { c: gl[1].toFixed(1) }), fx: ['Radiation storm'] });
      if (mn[1] <= -2) out.push({ t: mn[0], sun: 'C3', hi: ['v', 'cr'], c: '#B9A7FF', h: L('Cosmic rays swept away'),
        p: L('The cloud carries its own magnetic field past Earth and pushes cosmic rays aside: the neutron count drops by {c} % — a Forbush decrease.', { c: Math.abs(mn[1]).toFixed(1) }) }); }
    out.push({ t: D.t1 - 2 * H, sun: 'HMIIF', hi: [], c: '#39FF9E', h: L('What we learn'),
      p: L('The same chain as every day on this page: the Sun → flares and CMEs → the wind at L1 → Kp, SYM-H and the aurora. Open ☰ Archive to compare with another week.') });
    out.sort((a, b) => a.t - b.t); for (let i = 1; i < out.length; i++) if (out[i].t - out[i - 1].t < 20 * 60e3) out[i].t = out[i - 1].t + 20 * 60e3;   // steps never on the same minute
    return out;
  }

  /* charts: one SVG per strip, drawn once; the cursor moves */
  const STRIPS = [
    ['xr', 'X-rays (GOES)', '#FF5A5A', 'log', [1e-8, 1e-3], v => xcls(v)],
    ['v', 'Wind speed', '#FFA040', 'lin', [250, 1100], v => Math.round(v) + ' km/s'],
    ['n', 'Density', '#39FF9E', 'lin', [0, 60], v => v.toFixed(0) + ' /cm³'],
    ['bz', 'Bz (Bt grey)', '#7BE0FF', 'lin', [-60, 60], v => (v > 0 ? '+' : '') + v.toFixed(0) + ' nT'],
    ['kp', 'Kp', '#FF4D4D', 'kp', [0, 9], v => 'Kp ' + v.toFixed(1).replace('.0', '')],
    ['sym', 'SYM-H (Dst)', '#FF8A8A', 'lin', [-560, 80], v => Math.round(v) + ' nT'],
    ['cr', 'Cosmic rays', '#B9A7FF', 'lin', [-12, 2], v => v.toFixed(1) + ' %'],
  ];
  const gOf = k => k >= 8.99 ? 5 : k >= 7.66 ? 4 : k >= 6.66 ? 3 : k >= 5.66 ? 2 : k >= 4.66 ? 1 : 0;   // NOAA: G1 = Kp 5 … G4 = Kp 8 including 9−, G5 = Kp 9
  const kpc = k => k >= 8.6 ? '#8C7CFF' : k >= 7.6 ? '#D61F3A' : k >= 6.6 ? '#FF4D4D' : k >= 5.6 ? '#FF9338' : k >= 4.6 ? '#FFE14D' : k >= 3.6 ? '#B8F25C' : '#3FD98A';   // the page's Kp spectrum (G5 indigo)
  function drawStrips() {
    const box = $('.rpcharts'); box.innerHTML = '';
    const W = 1000, x = tt => (tt - D.t0) / (D.t1 - D.t0) * W;
    const ext = (k, f) => { const a = k === 'cr' ? D.cr.map(p => p[1]) : D[k]; return a.reduce((m, v) => v == null ? m : f(m, v), f === Math.min ? 1e9 : -1e9); };
    const RANGE = { v: [250, Math.max(700, ext('v', Math.max) * 1.05)], n: [0, Math.max(20, ext('n', Math.max) * 1.05)], bz: (e => [-e, e])(Math.max(20, ext('bt', Math.max) * 1.1, -ext('bz', Math.min) * 1.1)),
      sym: [Math.min(-100, ext('sym', Math.min) * 1.08), Math.max(40, ext('sym', Math.max) * 1.2)], cr: [Math.min(-3, ext('cr', Math.min) * 1.15), Math.max(1, ext('cr', Math.max) * 1.15)] };
    const nd = Math.round((D.t1 - D.t0) / (24 * H));
    STRIPS.forEach(([k, name, col, sc, rg]) => { if (k === 'cr' && !D.cr.length) return;   // no neutron data baked for this week
      const [lo, hi] = ID === 'may2024' || !RANGE[k] ? rg : RANGE[k];
      const Hh = k === 'xr' ? 160 : 56;   // the X-ray chart is the big one, like the live page's
      const y = sc === 'log' ? v => Hh - (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * Hh : v => Hh - (v - lo) / (hi - lo) * Hh;
      let s = '';
      for (let d = 1; d < nd; d++) s += `<line x1="${x(D.t0 + d * 24 * H)}" x2="${x(D.t0 + d * 24 * H)}" y1="0" y2="${Hh}" stroke="#1F2630"/>`;
      if (k === 'xr') { [1e-8, 1e-7, 1e-6].forEach(v => s += `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#1C232D"/>`);
        [[1e-5, '#FFB347'], [1e-4, '#FF5A5A']].forEach(([v, c]) => s += `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="${c}" stroke-opacity=".7" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>`);
        let d2 = '', pen = false; D.xs.forEach((v, i) => { if (v == null) { pen = false; return; } d2 += (pen ? 'L' : 'M') + x(D.t0 + i * D.step).toFixed(1) + ' ' + y(Math.max(lo, Math.min(hi, v))).toFixed(1); pen = true; });
        s += `<path d="${d2}" fill="none" stroke="#4FA8FF" stroke-width="1.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`; }
      if (k === 'bz' || k === 'sym' || k === 'cr') s += `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#3A4350"/>`;
      if (k === 'kp') D.kp.forEach(([tt, v]) => s += `<rect x="${x(tt) + 1}" y="${y(v)}" width="${x(tt + 3 * H) - x(tt) - 2}" height="${Hh - y(v)}" fill="${kpc(v)}" rx="1.5"/>`);
      else {
        const L = k === 'cr' ? D.cr.map(p => [p[0], p[1]]) : D[k].map((v, i) => [D.t0 + i * D.step, v]);
        const path = arr => { let d = '', pen = false; arr.forEach(([tt, v]) => { if (v == null) { pen = false; return; } const vv = Math.max(lo, Math.min(hi, v)); d += (pen ? 'L' : 'M') + x(tt).toFixed(1) + ' ' + y(vv).toFixed(1); pen = true; }); return d; };
        if (k === 'bz') { s += `<path d="${path(D.bt.map((v, i) => [D.t0 + i * D.step, v]))}" fill="none" stroke="#5C6878" stroke-width="1"/>`;
          let sh = ''; D.bz.forEach((v, i) => { if (v != null && v < 0) sh += `M${x(D.t0 + i * D.step).toFixed(1)} ${y(0).toFixed(1)}V${y(Math.max(lo, v)).toFixed(1)}`; }); s += `<path d="${sh}" stroke="#7BE0FF" stroke-opacity=".28" stroke-width="2.4"/>`; }
        s += `<path d="${path(L)}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
      }
      box.insertAdjacentHTML('beforeend', `<div class="rpst" data-k="${k}"><div class="rpsl"><b style="color:${col}">${T(name)}</b><span data-v="${k}">–</span></div>
        <svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" aria-hidden="true">${s}<line class="rpcur" x1="0" x2="0" y1="0" y2="${Hh}" stroke="#FFE600" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></div>`);
      if (k === 'xr') {
        const pc = v => ((Math.log10(hi) - Math.log10(v)) / (Math.log10(hi) - Math.log10(lo)) * 100).toFixed(1) + '%';
        const st = box.lastElementChild, w = document.createElement('div'); w.className = 'rpxw'; const sv = st.querySelector('svg'); sv.replaceWith(w); w.appendChild(sv);
        w.insertAdjacentHTML('beforeend', [['A', 3e-8], ['B', 3e-7], ['C', 3e-6], ['M', 3e-5], ['X', 3e-4]].map(([l, v]) => `<i class="rpb" style="top:${pc(v)}">${l}</i>`).join('')
          + `<i class="rpr" style="top:${pc(1e-4)};color:#FF5A5A">R3 · ${T('X-CLASS')}</i><i class="rpr" style="top:${pc(1e-5)};color:#FFB347">R1 · ${T('M-CLASS')}</i>`);
        // M / X flares = peaks of the long channel ≥ 1e-5, the highest within ±1 hour
        const F = []; for (let i = 0; i < D.xr.length; i++) { const v = D.xr[i]; if (v == null || v < 1e-5) continue; let top = true; for (let j = Math.max(0, i - 12); j <= Math.min(D.xr.length - 1, i + 12); j++) if ((D.xr[j] || 0) > v || ((D.xr[j] || 0) === v && j < i)) { top = false; break; } if (top) F.push([D.t0 + i * D.step, v]); }
        box.insertAdjacentHTML('beforeend', `<div class="rpxf"><span class="lg"><i style="background:#FF5A5A"></i>0.1–0.8 nm · ${T('sets the class')}</span><span class="lg"><i style="background:#4FA8FF"></i>0.05–0.4 nm</span>
          <span class="lbl">${T('X flares')} · ${F.filter(f => f[1] >= 1e-4).length} · ${T('M flares')} · ${F.filter(f => f[1] < 1e-4).length}</span>${F.filter(f => f[1] >= 1e-4).map(([tt, v]) => `<button type="button" data-t="${tt}" class="x"><b>${xcls(v)}</b> ${utc(tt).replace(' UTC', '')}</button>`).join('')}</div>`);
      }
    });
    box.addEventListener('click', e => { const b = e.target.closest('.rpxf [data-t]'); if (b) { e.stopPropagation(); pause(); seek(+b.dataset.t); } });
    // day labels under the strips
    let lab = ''; for (let d = 0; d < nd; d++) lab += `<span style="left:${(d + .5) * 100 / nd}%">${new Date(D.t0 + d * 24 * H).toLocaleDateString(document.documentElement.lang || 'en', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>`;
    box.insertAdjacentHTML('beforeend', `<div class="rpdays">${lab}</div>`);
    box.onpointerdown = e => { const r = box.querySelector('svg').getBoundingClientRect(); const go = ev => seek(D.t0 + Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * (D.t1 - D.t0)); pause(); go(e);
      const mv = ev => go(ev), up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); };
  }

  /* an OVATION-like oval from Kp (the real OVATION archive isn't public): brighter and further south as Kp rises */
  const PLAT = 80.8 * Math.PI / 180, PLON = -72.6 * Math.PI / 180;
  function oval(kp, tt) {
    const G = new Float32Array(360 * 181), c = 66.5 - 2.3 * kp, w = 2.6 + .55 * kp, amp = Math.min(100, 12 + 10 * kp);
    const ss = new Date(tt), sunLon = -((ss.getUTCHours() + ss.getUTCMinutes() / 60) - 12) * 15;
    for (let lo = 0; lo < 360; lo++) for (let la = 0; la <= 180; la++) {
      const f = (la - 90) * Math.PI / 180, l = (lo > 180 ? lo - 360 : lo) * Math.PI / 180;
      const ml = Math.asin(Math.sin(f) * Math.sin(PLAT) + Math.cos(f) * Math.cos(PLAT) * Math.cos(l - PLON)) * 180 / Math.PI;
      const night = .55 + .45 * -Math.cos(l - sunLon * Math.PI / 180), cc = c + 2.5 * (night - .5) * -1;
      const a = Math.abs(ml), v = amp * night * Math.exp(-Math.pow((a - cc) / w, 2));
      G[lo * 181 + la] = v > 3 ? v : 0;
    }
    return G;
  }
  let gT = -1;
  function drawGlobe(force) {
    if (!window.AuroraGlobe) return; const k = kpAt(t), key = Math.round(t / (1800e3));
    if (!force && key === gT) return; gT = key;
    AuroraGlobe.draw($('#rpGlobe'), { ov: oval(k, t), t, lat0: 60, lon0: 18, viewLine: true, label: true, here: { lat: 45.65, lon: 25.6, name: 'Brașov' } });
  }

  /* pictures: nearest frame at or before the clock; preloaded around the clock */
  const cache = new Map();
  const img = u => { if (!cache.has(u)) { const i = new Image(); i.decoding = 'async'; i.src = BASE + u; cache.set(u, i); } return cache.get(u); };
  function pics() {
    const L = D.sun[SUNK] || [], f = near(L, t) || L[0];
    if (f) { const el = $('#rpSun'); if (el.dataset.u !== f[1]) { el.src = BASE + f[1]; el.dataset.u = f[1]; } $('#rpSunT').textContent = utc(f[0]); }
    const i = L.indexOf(f); for (let k = 1; k < 6; k++) if (L[i + k]) img(L[i + k][1]);
    const e = D.enl.length ? near(D.enl, t) : null, en = $('#rpEnl');
    if (e && t >= D.enl[0][0]) { const u = `url("${BASE}${e[1]}")`; if (en.dataset.u !== e[1]) { en.style.backgroundImage = u; en.dataset.u = e[1]; } $('#rpEnlT').textContent = utc(e[0]); en.classList.remove('wait'); const rc = $('#rpEnlRun'); if (rc) rc.textContent = e[2] ? T('NASA CCMC run of {d} UTC: what forecasters had at that moment. Sun in the centre, Earth = the yellow dot on the right.', { d: new Date(e[2]).toLocaleString(document.documentElement.lang || 'en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) }) : T(e[0] >= Date.UTC(2024, 4, 11) ? 'NASA CCMC run of 11 May 06:00 UTC (with the CME of the X5.8 flare). Sun in the centre, Earth = the yellow dot on the right.' : 'NASA CCMC run of 9 May 20:27 UTC. Sun in the centre, Earth = the yellow dot on the right.'); }
    else { en.classList.add('wait'); $('#rpEnlT').textContent = !D.enl.length ? T('no ENLIL run for this week') : ID === 'may2024' ? T('the run starts on 9 May') : T('the run starts on {d}', { d: new Date(D.enl[0][0]).toLocaleDateString(document.documentElement.lang || 'en', { day: 'numeric', month: 'short', timeZone: 'UTC' }) }); }
  }

  function values() {
    const i = idx(t);
    STRIPS.forEach(([k, , , , , fmt]) => { if (!root.querySelector(`[data-v="${k}"]`)) return; let v = k === 'kp' ? kpAt(t) : k === 'cr' ? (near(D.cr, t) || [0, null])[1] : D[k][i];
      for (let j = 1; v == null && k !== 'kp' && k !== 'cr' && j <= 12 && i - j >= 0; j++) v = D[k][i - j]; /* short data gaps (the probes saturated in the storm): last value within an hour */ root.querySelector(`[data-v="${k}"]`).textContent = v == null ? '–' : fmt(v); });
    root.querySelectorAll('.rpcur').forEach(l => { const x = (t - D.t0) / (D.t1 - D.t0) * 1000; l.setAttribute('x1', x); l.setAttribute('x2', x); });
    $('#rpClock').innerHTML = `<b>${utc(t)}</b><span>${T('Romania')}: ${ro(t)}</span>`;
    $('#rpSlide').value = Math.round((t - D.t0) / (D.t1 - D.t0) * 1000);
  }

  function setStep(n, jump) {
    n = Math.max(0, Math.min(story.length - 1, n)); const s = story[n];
    if (jump) { t = s.t; glide = 0; if (s.sun) setSun(s.sun); }
    if (n === step && !jump) return; step = n;
    $('#rpStep').style.setProperty('--c', s.c);
    $('#rpStep').innerHTML = `<div class="rpn">${T('Step {a} of {b}', { a: n + 1, b: story.length })} · ${utc(s.t)}</div><h3>${esc(T(s.h.k, s.h.o))}</h3><p>${esc(T(s.p.k, s.p.o))}</p>` +
      (s.fx ? `<div class="rpfx">${s.fx.map(f => `<span>${esc(T(f))}</span>`).join('')}</div>` : '') + (guide ? '<div class="rpread"><i></i></div>' : '');
    root.querySelectorAll('.rpli button').forEach((b, i) => b.classList.toggle('on', i === n));
    $('#rpGP').innerHTML = `<b>${T('Step {a} of {b}', { a: n + 1, b: story.length })}</b>${story.map((x, i) => `<i class="${i < n ? 'd' : i === n ? 'n' : ''}" style="--c:${x.c}"></i>`).join('')}`;
    root.querySelectorAll('[data-hi]').forEach(el => el.classList.toggle('hi', s.hi.includes(el.dataset.hi)));
    root.querySelectorAll('.rpst').forEach(el => el.classList.toggle('hi', s.hi.includes(el.dataset.k)));
    root.classList.toggle('focus', guide && s.hi.length > 0); root.classList.toggle('guide', guide); root.classList.toggle('fch', guide && !!root.querySelector('.rpst.hi'));   // guided: only the charts of this step stay, so they sit next to the pictures
    if (guide) { $('#rpTip').innerHTML = $('#rpStep').innerHTML; $('#rpTip').style.setProperty('--c', s.c); requestAnimationFrame(placeTip); }
    if (!jump && s.sun && play) setSun(s.sun);
  }
  function placeTip() {   // beside the first highlighted panel that has room (right, else left); a full-width chart → above it, else under it; never under the control bar
    const hs = [...root.querySelectorAll('.rpcharts .hi')]; if (hs.length) { hs[hs.length - 1].scrollIntoView({ block: 'nearest' }); hs[0].scrollIntoView({ block: 'nearest' }); }   // the charts the step is about come into view
    const tip = $('#rpTip'), box = $('.rpleft').getBoundingClientRect(), g = 14; tip.style.width = '';
    let H0 = tip.offsetHeight, W0 = tip.offsetWidth;
    const bot = Math.min(box.bottom, $('.rpctl').getBoundingClientRect().top) - 8, top = box.top + 8;
    const R = [...root.querySelectorAll('.rpleft .hi')].map(e => e.getBoundingClientRect()).filter(r => r.width && r.bottom > top && r.top < bot);
    let x, y, side = 'c', ay = 34;
    // a card beside a panel (right, else left; narrower down to 300 px if needed) that covers no other highlighted panel
    const hit = (x0, y0, w, h) => R.some(q => x0 < q.right && x0 + w > q.left && y0 < q.bottom && y0 + h > q.top);
    let r = null;
    for (const q of R) { for (const sd of ['l', 'r']) { const rm = (sd === 'l' ? box.right - q.right : q.left - box.left) - g, w = Math.min(W0, Math.floor(rm)); if (w < 300) continue;
        const x0 = sd === 'l' ? q.right + g : q.left - g - w; if (hit(x0, q.top, w, Math.min(H0, 200))) continue; r = q; side = sd; if (w < W0) { W0 = w; tip.style.width = w + 'px'; H0 = tip.offsetHeight; } x = x0; break; }
      if (r) break; }
    if (r) y = r.top;
    else if (R.length) { const r0 = R[0]; x = Math.max(box.left, Math.min(box.right - W0, r0.left + 24));
      if (r0.top - g - H0 >= top) { y = r0.top - g - H0; side = 'b'; } else { y = r0.bottom + g; side = 't'; } }
    else { x = box.left + (box.width - W0) / 2; y = box.top + (box.height - H0) / 2; }
    const y1 = Math.max(top, Math.min(bot - H0, y)); if (side === 'l' || side === 'r') ay = Math.max(18, Math.min(H0 - 24, r.top + 30 - y1));
    tip.style.left = Math.round(x) + 'px'; tip.style.top = Math.round(y1) + 'px'; tip.style.setProperty('--ay', ay + 'px'); tip.dataset.side = side; tip.classList.add('on');
  }
  function setSun(k) { if (!(D.sun[k] || []).length) return; SUNK = k; root.querySelectorAll('.rpsf button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); pics(); }

  function render(force) { values(); pics(); drawGlobe(force); if (guide && play) return;   // the tour moves the steps itself (arrival → read → glide)
    let n = 0; story.forEach((s, i) => { if (s.t <= t + 60e3) n = i; }); setStep(n); }
  function seek(x) { t = Math.max(D.t0, Math.min(D.t1, x)); render(); }
  function pause() { play = false; cancelAnimationFrame(raf); $('#rpPlay').textContent = '▶'; $('#rpPlay').setAttribute('aria-label', T('Play')); }
  const readMs = s => Math.max(7000, Math.min(16000, T(s.p.k, s.p.o).split(/\s+/).length * 330));   // time to read a step
  function start() { if (t >= D.t1 - 1) { t = D.t0; if (guide) setStep(0, true); } play = true; last = performance.now(); hold = guide && story[step] && Math.abs(t - story[step].t) < 60e3 ? readMs(story[step]) : 0;   // on a step: read it first $('#rpPlay').textContent = '⏸'; $('#rpPlay').setAttribute('aria-label', T('Pause'));
    const tick = now => { if (!play) return; const dt = Math.min(guide ? 250 : 100, now - last); last = now;
      if (guide) {
        if (hold > 0) { hold -= dt; bar(1 - hold / readMs(story[step])); if (hold > 0) { raf = requestAnimationFrame(tick); return; } }
        const nx = story[step + 1];
        if (!nx) { t = Math.min(D.t1, t + dt / 1000 * 2 * H); render(); if (t >= D.t1) { pause(); freeMode(true); return; } raf = requestAnimationFrame(tick); return; }
        if (!glide || glide.to !== nx) { const gap = nx.t - t; glide = { to: nx, r: gap / Math.max(4000, Math.min(9000, gap / (2 * H) * 1000)) }; }   // ms of clock per ms of screen
        t += dt * glide.r;
        if (t >= nx.t) { t = nx.t; glide = 0; setStep(step + 1, true); render(true); hold = readMs(story[step]); bar(0); }
        else render();
        raf = requestAnimationFrame(tick); return;
      }
      t += dt / 1000 * speed * 2 * H;   // free: 1× = 2 hours per second, straight through
      if (t >= D.t1) { t = D.t1; render(); pause(); return; } render(); raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); }
  function bar(f) { root.querySelectorAll('.rpread i').forEach(b => b.style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%'); }
  function freeMode(end) { guide = false; glide = 0; root.classList.remove('focus', 'guide'); $('#rpTip').classList.remove('on'); root.classList.add('free'); $('#rpMode').textContent = T('↺ Guided tour');
    if (end) $('#rpStep').insertAdjacentHTML('beforeend', `<div class="rpyou">${T("Now it's yours: drag the slider, change the speed, click any step or chart.")}</div>`); }
  function guideMode() { guide = true; root.classList.remove('free'); $('#rpMode').textContent = T('⇄ Explore freely'); setStep(0, true); render(true); start(); }

  /* the archive: every baked week (replay/index.json) with its daily Kp, biggest flare and deepest SYM-H; a pick reloads the replay */
  async function archive() {
    pause(); let box = $('#rpArc');
    if (!box) { root.insertAdjacentHTML('beforeend', `<div id="rpArc" class="rparcw" role="dialog" aria-label="${T('Storm archive')}"><div class="rparch"><h3>${T('Storm archive')}</h3>
      <label><input type="checkbox" id="rpArcS"> ${T('storms only (G1+)')}</label><button type="button" class="rpx" aria-label="${T('Close')}">✕</button></div><div class="rparcl"></div></div>`);
      box = $('#rpArc'); box.querySelector('.rpx').onclick = () => box.classList.remove('on'); $('#rpArcS').onchange = list; box.onclick = e => { if (e.target === box) box.classList.remove('on'); }; }
    if (!IX) try { IX = await (await fetch('replay/index.json?t=' + Math.floor(Date.now() / 36e5))).json(); } catch (e) { IX = []; }
    list(); box.classList.add('on'); (box.querySelector('.rparcl button') || box.querySelector('.rpx')).focus();
  }
  function list() {
    const only = $('#rpArcS').checked, fmt = x => new Date(x).toLocaleDateString(document.documentElement.lang || 'en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    $('#rpArc .rparcl').innerHTML = (IX || []).filter(e => !only || gOf(Math.max(...e.kp))).map(e => { const km = Math.max(...e.kp), g = gOf(km) ? 'G' + gOf(km) : '', W = e.kp.length * 14;
      const bars = e.kp.map((k, i) => `<rect x="${i * 14 + 1}" y="${36 - k / 9 * 36}" width="12" height="${Math.max(1.5, k / 9 * 36)}" rx="1.5" fill="${kpc(k)}"/>`).join('');
      return `<button type="button" data-id="${e.id}" class="${e.id === ID ? 'on' : ''}"><svg viewBox="0 0 ${W} 36" width="${W}" height="36" aria-hidden="true">${bars}</svg>
        <span class="t"><b>${esc(T(e.title))}</b><span>${fmt(e.t0)} – ${fmt(e.t1 - 1)}${e.famous ? ' · ★' : ''}</span></span>
        <span class="bd">${g ? `<i style="background:${kpc(km)}">${g}</i>` : ''}${e.xr >= 1e-5 ? `<i class="fl">${xcls(e.xr)}</i>` : ''}<i class="sy">SYM-H ${Math.round(e.sym)}</i></span></button>`; }).join('')
      || `<p>${T('Nothing here yet.')}</p>`;
    $('#rpArc .rparcl').onclick = ev => { const b = ev.target.closest('[data-id]'); if (b) { $('#rpArc').classList.remove('on'); if (b.dataset.id !== ID) open(0, b.dataset.id); } };
  }

  function build() {
    root = document.createElement('div'); root.id = 'rp'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', ID === 'may2024' ? T('Storm replay · May 2024') : T(D.title));
    root.className = 'guide'; root.innerHTML = `<div class="rpbar"><span class="rptag">${ID === 'may2024' ? T('REPLAY · REAL DATA FROM MAY 2024 · NOT LIVE') : T('REPLAY · REAL DATA · NOT LIVE')}</span><h2>${ID === 'may2024' ? T('The G5 storm of May 2024, step by step') : esc(T(D.title))}</h2><button type="button" class="rparc" aria-haspopup="dialog">☰ ${T('Archive')}</button><button type="button" class="rpx" aria-label="${T('Close')}">✕</button></div>
    <div class="rpgrid">
      <div class="rpleft">
        <div class="rpmedia">
          <figure data-hi="sun"><div class="rpsq"><img id="rpSun" alt="${T('The Sun at the replay time')}"></div><figcaption><b>${T('The Sun')}</b><span id="rpSunT"></span></figcaption>
            <div class="rpsf">${SUNF.filter(f => (D.sun[f[0]] || []).length).map(f => `<button type="button" data-k="${f[0]}" style="--c:${f[2]}">${T(f[1])}</button>`).join('')}</div></figure>
          <figure data-hi="enl"><div class="rpsq"><div id="rpEnl" role="img" aria-label="${T('NASA WSA-ENLIL solar wind density, seen from above')}"></div></div><figcaption><b>${T('WSA-ENLIL · density from above')}</b><span id="rpEnlT"></span></figcaption>
            <p class="rpcap" id="rpEnlRun">${ID === 'may2024' ? T('NASA CCMC run of 9 May 20:27 UTC. Sun in the centre, Earth = the yellow dot on the right.') : T('Sun in the centre, Earth = the yellow dot on the right.')}</p></figure>
          <figure data-hi="globe"><div class="rpsq"><canvas id="rpGlobe" aria-label="${T('Aurora oval estimated from Kp')}"></canvas></div><figcaption><b>${T('Aurora oval')}</b><span>${T('estimated from Kp')}</span></figcaption>
            <p class="rpcap">${T('The yellow dot is Brașov. The further south the glow, the stronger the storm.')}</p></figure>
        </div>
        <div class="rpcharts"></div>
      </div>
      <div id="rpTip" class="rpstep rptip" aria-live="polite"></div>
      <aside class="rpright"><div id="rpStep" class="rpstep"></div><ol class="rpli">${story.map((s, i) => `<li><button type="button" data-i="${i}" style="--c:${s.c}"><i></i><span>${esc(T(s.h.k, s.h.o))}</span></button></li>`).join('')}</ol>
        <p class="rpsrc">${T('Data: NASA OMNI (solar wind, SYM-H), GFZ Potsdam (Kp), NOAA GOES-16 via LASP (X-rays), NMDB Oulu (cosmic rays), NASA SDO, ESA / NASA SOHO, NASA CCMC (ENLIL).')}</p></aside>
    </div>
    <div class="rpctl"><button type="button" id="rpPrev" aria-label="${T('Previous step')}">⏮</button><button type="button" id="rpPlay" class="pl" aria-label="${T('Play')}">▶</button><button type="button" id="rpNext" aria-label="${T('Next step')}">⏭</button>
      <button type="button" id="rpMode" class="rpmode">${T('⇄ Explore freely')}</button><div class="rpsp" role="group" aria-label="${T('Speed')}">${[1, 2, 4].map(v => `<button type="button" data-s="${v}" class="${v === 1 ? 'on' : ''}">${v}×</button>`).join('')}</div>
      <div id="rpGP" class="rpgp"></div><input type="range" id="rpSlide" min="0" max="1000" value="0" aria-label="${T('Replay time')}"><div id="rpClock" class="rpclock"></div></div>`;
    document.body.appendChild(root);
    $('.rpx').onclick = close; $('.rparc').onclick = archive;
    $('#rpPlay').onclick = () => play ? pause() : start();
    $('#rpMode').onclick = () => { if (guide) { pause(); freeMode(); } else guideMode(); };
    const hop = d => { const was = play; pause(); setStep(step + d, true); render(true); if (was) { start(); } };   // guided: one step back / on, the tour goes on reading from there
    $('#rpPrev').onclick = () => { if (guide) return hop(-1); pause(); setStep(step - (t - story[step].t > 30 * 60e3 ? 0 : 1), true); render(true); };
    $('#rpNext').onclick = () => { if (guide) return hop(1); pause(); setStep(step + 1, true); render(true); };
    $('#rpSlide').oninput = e => { pause(); if (guide) freeMode(); seek(D.t0 + e.target.value / 1000 * (D.t1 - D.t0)); };
    root.querySelector('.rpsp').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; speed = +b.dataset.s; if (guide) freeMode(); root.querySelectorAll('.rpsp button').forEach(x => x.classList.toggle('on', x === b)); };
    root.querySelector('.rpsf').onclick = e => { const b = e.target.closest('[data-k]'); if (b) setSun(b.dataset.k); };
    if (!(D.sun[SUNK] || []).length) { const f = SUNF.find(f => (D.sun[f[0]] || []).length); if (f) setSun(f[0]); }
    root.querySelector('.rpli').onclick = e => { const b = e.target.closest('[data-i]'); if (b) { pause(); setStep(+b.dataset.i, true); render(true); } };
    root.addEventListener('keydown', e => { if (e.key === 'Escape') close(); else if (e.key === ' ' && !e.target.closest('button, input')) { e.preventDefault(); play ? pause() : start(); }
      else if (e.key === 'ArrowRight' && !e.target.closest('input')) $('#rpNext').click(); else if (e.key === 'ArrowLeft' && !e.target.closest('input')) $('#rpPrev').click(); });
    drawStrips(); addEventListener('resize', () => { if (guide && root.classList.contains('on')) placeTip(); });
  }
  function close() { pause(); if (root) root.classList.remove('on'); document.documentElement.classList.remove('rpon'); if (location.hash === '#replay') history.replaceState(null, '', location.pathname + location.search); }

  async function open(n, id) {
    if (id && id !== ID) { if (root) { pause(); root.remove(); } root = null; D = null; ID = id; BASE = 'replay/' + id + '/'; cache.clear(); gT = -1; step = -1; guide = true; SUNK = 'HMIIF'; }
    document.documentElement.classList.add('rpon');
    if (!D) { const w = document.createElement('div'); w.id = 'rpLoad'; w.textContent = ID === 'may2024' ? T('Loading the May 2024 storm…') : T('Loading the storm…'); document.body.appendChild(w);
      try { D = await (await fetch(BASE + 'data.json')).json(); } catch (e) { w.textContent = T('Could not load the replay.'); setTimeout(() => w.remove(), 2500); document.documentElement.classList.remove('rpon'); return; }
      w.remove(); story = ID === 'may2024' ? buildStory() : autoStory(); build(); t = story[0].t; setStep(0, true); }
    if (n > 0) setStep(n, true);
    root.classList.add('on'); render(true); $('#rpPlay').focus();
    if (guide && !play && !matchMedia('(prefers-reduced-motion: reduce)').matches) { hold = 0; setTimeout(() => { if (root.classList.contains('on') && !play) start(); }, 900); }
  }
  window.StormReplay = { open, close };
})();
