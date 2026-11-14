/* Orbit test page (fly.html?craft=orbiter, steps S1 / S4): the PLACEHOLDER test spacecraft (flight/orbit.js ORBITER) in a circular orbit over
   Brașov, run by the same flight session as the 3D view's flight menu (flight/session.js: missions panel, navball, orbit lines).
   Not part of the live page. ?alt=400 (km over the drawn sea), ?inc=51.6 (°), ?q=low|medium|high = 3D quality. */
import { startFlight } from './session.js';

const P = new URLSearchParams(location.search), q = P.get('q');
const host = document.getElementById('fly3d');
const earth = window.Earth3D.create(host, { time: () => Date.now(), places: [], realSun: true, ...(q ? { quality: q } : {}) });
earth.show(45.64, 25.59);
const S = await startFlight(earth, host, { craft: 'orbiter', quality: q, alt: +(P.get('alt') || 400), inc: +(P.get('inc') || 51.6) });
window.__orb = { earth, S, F: S.F, core: S.core, orb: S.ctx.orb, ctx: S.ctx, view: S.orbitView, craft: S.craft, cs: S.cs, cc: S.cc, repredict: S.repredict };   // for tests from the console
