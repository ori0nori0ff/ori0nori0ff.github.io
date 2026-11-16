/* Flight test page (fly.html, steps S0c / S2 / S3 / S4): the 3D Earth + the F-16 on runway 03 of Brașov-Ghimbav (LRBV), run by the same
   flight session as the 3D view's flight menu (flight/session.js). Not part of the live page. ?q=low|medium|high = 3D quality; ?start=cold = cold and dark (N = auto start), runway (default) = engine at idle;
   &tanks=0|2|3 = external tanks (none; 2 x 370 gal on stations 4 / 6; + 300 gal on 5), default 0. &utc=10 = daylight (see below). */
import { startFlight, RWY } from './session.js';

if (window.i18nApply) window.i18nApply();
const qs = new URLSearchParams(location.search), host = document.getElementById('fly3d'), q = qs.get('q'), tanks = ['2', '3'].includes(qs.get('tanks')) ? +qs.get('tanks') : 0;
// &utc=<hour> = the clock starts today at that UTC hour and runs on (tests by day: &utc=10 = local noon at LRBV)
const utc = qs.get('utc'), t0 = Date.now(), d0 = new Date(t0), tBase = utc != null && isFinite(+utc) ? Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) + +utc * 3600e3 : t0;
const earth = window.Earth3D.create(host, { time: () => tBase + (Date.now() - t0), places: [{ name: 'LRBV', lat: RWY.lat, lon: RWY.lon }], realSun: true, ...(q ? { quality: q } : {}) });
earth.show(RWY.lat, RWY.lon);
const S = await startFlight(earth, host, { craft: 'f16', quality: q, tanks, start: qs.get('start') || 'runway' });   // &start=cold: everything off
window.__fly = { earth, S, F: S.F, core: S.core, craft: S.craft, cs: S.cs, cc: S.cc, get gfx() { return S.gfx; }, get cockpit() { return S.cockpit; }, get hud() { return S.hud; } };   // for tests from the console
