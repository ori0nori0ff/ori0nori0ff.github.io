/* Rocket test page (fly.html?craft=rocket, step S5): a launcher on a real pad, run by the flight session (flight/session.js + flight/rocket.js).
   Not part of the live page. ?rocket=falcon9 | saturn5, ?pad=slc40 | lc39a | baikonur | kourou, ?inc=<deg>, ?alt=<km, target orbit>,
   ?entry=1 = start as the capsule at 120 km (re-entry test), ?q=low|medium|high = 3D quality. */
import { startFlight } from './session.js';
import { PADS } from './rocket.js';

const P = new URLSearchParams(location.search), q = P.get('q'), rocket = P.get('rocket') || 'falcon9';
const pad = PADS[P.get('pad')] ? P.get('pad') : rocket === 'saturn5' ? 'lc39a' : 'slc40', pd = PADS[pad];
const host = document.getElementById('fly3d');
const earth = window.Earth3D.create(host, { time: () => Date.now(), places: [], realSun: true, ...(q ? { quality: q } : {}) });
earth.show(pd.lat, pd.lon);
const S = await startFlight(earth, host, { craft: 'rocket', rocket, pad, quality: q, inc: P.get('inc') != null ? +P.get('inc') : undefined, alt: +(P.get('alt') || 200), entry: P.get('entry') === '1' });
window.__rk = { earth, S, F: S.F, core: S.core, K: S.rocket.K, rocket: S.rocket, ctx: S.ctx, craft: S.craft, cs: S.cs, cc: S.cc };   // for tests from the console
