/* Flight test page (fly.html, steps S0c / S2 / S3 / S4): the 3D Earth + the F-16 on runway 03 of Brașov-Ghimbav (LRBV), run by the same
   flight session as the 3D view's flight menu (flight/session.js). Not part of the live page. ?q=low|medium|high = 3D quality. */
import { startFlight, RWY } from './session.js';

if (window.i18nApply) window.i18nApply();
const host = document.getElementById('fly3d'), q = new URLSearchParams(location.search).get('q');
const earth = window.Earth3D.create(host, { time: () => Date.now(), places: [{ name: 'LRBV', lat: RWY.lat, lon: RWY.lon }], realSun: true, ...(q ? { quality: q } : {}) });
earth.show(RWY.lat, RWY.lon);
const S = await startFlight(earth, host, { craft: 'f16', quality: q });
window.__fly = { earth, S, F: S.F, core: S.core, craft: S.craft, cs: S.cs, cc: S.cc, get gfx() { return S.gfx; }, get cockpit() { return S.cockpit; }, get hud() { return S.hud; } };   // for tests from the console
