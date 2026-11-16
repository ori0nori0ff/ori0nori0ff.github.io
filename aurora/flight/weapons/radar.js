/* F-16 fire-control radar, game-level AN/APG-68(V)9 (plug-in, docs/flight-notes/weapons-contract.md row "radar"; notes:
   docs/flight-notes/f16-radar.md; numbers: flight/weapons/data/apg68.json). Own code and own drawing (page logic after the DCS F-16C
   FCR format, no copied art).
   Model:
   - Antenna: a bar scan (azimuth sweep at scanDegS, bars barDeg apart, beam beamDeg). CRM (RWS / TWS) is stabilised to the horizon
     (azimuth from the ground track of the nose, elevation from the local horizontal); ACM is stabilised to the fuselage (DCS guide p.384).
   - A target is "looked at" once per bar pass, when the antenna azimuth crosses it inside the beam's elevation. Each look: line of sight
     against the drawn ground (relief + 400 m, F.groundAt), then a detection roll Pd = 1 / (1 + exp(-(SNR - snrRef) / pdSlope)) with
     SNR = snrRef + 40 log10(r50 / R) + 10 log10(rcs) - clutter (radar equation: R ~ rcs^(1/4) at equal SNR).
   - Clutter: look-down (main beam reaches the ground behind the target) costs lookDownDb, a target whose closing speed lies inside the
     sidelobe clutter band (|closing| < own ground speed) slcDb more; in look-down a target whose radial speed over the ground is below
     notchMs is filtered out with the main-lobe clutter (the notch / beaming).
   - Modes on Wp.bus.mode: RWS (search hits that fade), TWS (up to 10 extrapolated tracks, one bugged = bus.lock), ACM (30 x 20 deg box
     ahead, auto-lock the first target within 10 nm), OFF. A lock in RWS / ACM is STT: the antenna dwells on the target (+10 dB dwell
     gain, ESTIMATE), acquisition takes stt.lockS of continuous detection, a lost target is extrapolated for stt.coast s, then dropped.
   - Only targets with team !== 'blue' and alive (Wp.targets, contract target interface: rcs, r1, v).
   Keys: Backquote = mode RWS -> TWS -> ACM -> OFF; Shift+Backquote = range scale; Tab = lock / next target; Backspace = drop the lock.
   Frames as flight/core.js: I (metres, doubles); body x right, y up, -z forward; s.q body -> I. */
import { R_E, OMEGA_I, qIF } from '../core.js';
import { qrot, qconj } from './weapons.js';

const D2R = Math.PI / 180, NM = 1852, FT = .3048, KT = 1.94384, GREEN = '#39FF9E', HUD_D = 1000;
const FONT = 'Inter, system-ui, sans-serif', MONO = 'ui-monospace, Consolas, monospace';
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], unit = a => mul(a, 1 / len(a));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const MODES = ['RWS', 'TWS', 'ACM', 'OFF'];

export function attach(ctx) {
  const { S, F, Wp, bus, def } = ctx, THREE = F.THREE;
  let C = null;
  fetch(new URL('./data/apg68.json', import.meta.url)).then(r => r.json()).then(j => { C = j; }).catch(e => console.error('radar: apg68.json', e));

  // ── state
  const st = { t: 0, ant: { az: 0, el: 0, bar: 0, dir: 1, barDir: 1, frame: 0 }, list: new Map(), acq: null, stt: null, bug: null,
    reject: new Map(), rangeIx: 1, elIx: 0, elMan: null, hitsFrame: 0, manualRange: false, lastMode: bus.mode, own: null, gOwn: 0, gT: -1, tLockStart: 0, lockTime: 0, events: [] };
  const stats = { ms: 0, msMax: 0, looks: 0, hits: 0, los: 0, losMs: 0, blocked: 0, notched: 0 };
  if (!MODES.includes(bus.mode)) bus.mode = 'RWS';
  bus.tracks = []; bus.lock = null;
  const log = (k, d) => { st.events.push({ t: +st.t.toFixed(3), k, ...d }); if (st.events.length > 50) st.events.shift(); };

  // ── own frame for this step: horizon (stab) axes fh (ahead), rt (right), u (up); body conjugate
  function ownFrame(s, tMs) {
    const R = s.r, u = unit(R), fI = qrot(s.q, [0, 0, -1]);
    let fh = sub(fI, mul(u, dot(fI, u))); if (len(fh) < 1e-6) { const up = qrot(s.q, [0, 1, 0]); fh = mul(sub(up, mul(u, dot(up, u))), -Math.sign(dot(fI, u))); }
    fh = unit(fh); const rt = cross(fh, u), vG = sub(s.v, cross(OMEGA_I, R));
    // the horizon's dip below the local horizontal (ground radius under the jet, refreshed every 0.5 s)
    const qf = qIF(tMs);
    if (st.t - st.gT > .5) { st.gT = st.t; const f = qrot(qf, R), fl = len(f), g = F.groundAt(Math.asin(f[1] / fl), Math.atan2(-f[2], f[0])); if (g != null) st.gOwn = g; }
    const Rg = R_E + 400 + st.gOwn, rl = len(R), dip = rl > Rg ? Math.acos(Rg / rl) : 0;
    return { R, V: s.v, qc: qconj(s.q), u, fh, rt, gs: len(vG), dip, qf, tMs };
  }

  // geometry of a point r (I) moving at v (I) seen from the own frame O
  function geo(O, r, v) {
    const rel = sub(r, O.R), d = len(rel), b = qrot(O.qc, rel);
    const az = Math.atan2(b[0], -b[2]), el = Math.asin(clamp(b[1] / d, -1, 1)), off = Math.acos(clamp(-b[2] / d, -1, 1));
    const saz = Math.atan2(dot(rel, O.rt), dot(rel, O.fh)), sel = Math.asin(clamp(dot(rel, O.u) / d, -1, 1));
    const closing = -dot(rel, sub(v, O.V)) / d, vTG = sub(v, cross(OMEGA_I, r)), vrG = dot(vTG, rel) / d;
    const down = sel - C.beamDeg / 2 * D2R < -O.dip;
    return { rel, d, az, el, off, saz, sel, closing, vTG, vrG, down };
  }
  // SNR (dB) of target T at geometry g; notch -> -Infinity
  function snr(T, g) {
    let x = C.snrRef + 40 * Math.log10(C.r50nm * NM / g.d) + 10 * Math.log10(Math.max(1e-4, T.rcs || 1));
    if (g.down) { if (Math.abs(g.vrG) < C.clutter.notchMs) return -Infinity; x -= C.clutter.lookDownDb; if (Math.abs(g.closing) < st.own.gs) x -= C.clutter.slcDb; }
    return x; }
  const pd = x => 1 / (1 + Math.exp(-(x - C.snrRef) / C.pdSlope));
  // line of sight from the jet to r (I) against the drawn ground (relief + 400 m); no height tile -> clear
  function losClear(O, r) {
    const t0 = performance.now(), rel = sub(r, O.R), d = len(rel), n = clamp(Math.ceil(d / 500), 8, 160); stats.los++;
    let ok = true;
    for (let k = 1; k < n && ok; k++) { const p = [O.R[0] + rel[0] * k / n, O.R[1] + rel[1] * k / n, O.R[2] + rel[2] * k / n], f = qrot(O.qf, p), fl = len(f);
      const g = F.groundAt(Math.asin(f[1] / fl), Math.atan2(-f[2], f[0])); if (g != null && fl < R_E + 400 + g) ok = false; }
    stats.losMs += performance.now() - t0; if (!ok) stats.blocked++; return ok; }

  // scan pattern of the mode: { body (ACM) | horizon, azC, azW (half width), els: bar centres } (rad)
  function pattern(O) {
    const bw = C.barDeg * D2R;
    if (bus.mode === 'ACM') { const n = C.acm.bars, lo = C.acm.elLo * D2R, hi = C.acm.elHi * D2R;
      return { body: true, azC: 0, azW: C.acm.az * D2R, els: Array.from({ length: n }, (_, k) => lo + (k + .5) * (hi - lo) / n) }; }
    const M = bus.mode === 'TWS' ? C.tws : C.rws; let azC = 0, elC = 0;
    if (bus.mode === 'TWS' && st.bug) { azC = clamp(st.bug.saz, -(C.gimbalDeg - M.az) * D2R, (C.gimbalDeg - M.az) * D2R); elC = clamp(st.bug.sel, -30 * D2R, 30 * D2R); }
    else elC = (st.elMan != null ? st.elMan : C.autoEl[st.elIx % C.autoEl.length] || 0) * D2R;
    return { body: false, azC, azW: M.az * D2R, els: Array.from({ length: M.bars }, (_, k) => elC + (k - (M.bars - 1) / 2) * bw) };
  }
  const frameTime = m => { const M = m === 'TWS' ? C.tws : m === 'ACM' ? C.acm : C.rws; return M.bars * 2 * M.az / C.scanDegS; };

  // a track for T (created on the first hit)
  function hit(T, g) {
    let k = st.list.get(T);
    if (!k) { if (bus.mode === 'TWS' && st.list.size >= C.tws.max) return null; k = { T, r: T.r1.slice(), v: T.v.slice(), range: g.d, closing: g.closing, az: g.az, el: g.el, age: 0, n: 0, tHit: st.t, t0: st.t }; st.list.set(T, k); }
    k.rm = T.r1.slice(); k.vm = T.v.slice(); k.tHit = st.t; k.n++; stats.hits++; st.hitsFrame++; return k; }
  // refresh a track's estimate: extrapolated position, geometry, age
  function refresh(O, k) {
    k.age = st.t - k.tHit; const rm = k.rm || k.r, vm = k.vm || k.v;
    k.r = [rm[0] + vm[0] * k.age, rm[1] + vm[1] * k.age, rm[2] + vm[2] * k.age]; k.v = vm.slice();
    const g = geo(O, k.r, k.v); k.range = g.d; k.closing = g.closing; k.az = g.az; k.el = g.el; k.saz = g.saz; k.sel = g.sel; k.off = g.off;
    k.alt = len(k.r) - R_E - 400; k.tx = dot(g.vTG, O.rt); k.ty = dot(g.vTG, O.fh);
    const vl = len(g.vTG); if (vl > 1) { const c = clamp(dot(g.vTG, g.rel) / (vl * g.d), -1, 1); k.aspect = Math.acos(c); k.aspSide = Math.sign(dot(cross(g.vTG, mul(g.rel, -1)), O.u)) >= 0 ? 'L' : 'R'; }
    return k; }

  const live = T => T.alive && T.r1 && T.team !== 'blue' && Wp.targets.includes(T);

  // ── STT: acquisition and track (antenna on the target)
  function startAcq(T, lockS) { st.acq = { T, dwell: 0, miss: 0, lockS, t0: st.t, losT: -1, los: true }; st.stt = null; st.tLockStart = st.t; log('acq', { name: T.name }); }
  function dropLock(why) { if (st.stt || st.acq) log('drop', { why }); st.stt = null; st.acq = null; }
  function sttStep(O, h) {
    const A = st.acq || st.stt, T = A.T;
    if (!live(T)) { dropLock('dead'); return; }
    const g = geo(O, T.r1, T.v);
    if (g.off > C.gimbalDeg * D2R) { dropLock('gimbal'); return; }
    if (bus.mode === 'ACM' && g.d > C.acm.range * NM * 1.5) { dropLock('range'); return; }
    if (st.t - (A.losT ?? -1) > .25) { A.losT = st.t; A.los = losClear(O, T.r1); }
    const x = snr(T, g); if (x === -Infinity) stats.notched++;
    const ok = A.los && pd(x + 10) > .5;
    if (st.acq) { if (ok) { A.dwell += h; A.miss = 0; } else A.miss += h;
      if (A.miss > 1) { dropLock('acq-fail'); return; }
      if (A.dwell >= A.lockS) { const k = st.list.get(T) || hit(T, g) || { T, n: 0 }; if (!st.list.has(T)) st.list.set(T, k);
        k.rm = T.r1.slice(); k.vm = T.v.slice(); k.tHit = st.t; st.stt = k; st.acq = null; st.lockTime = st.t - st.tLockStart; log('lock', { name: T.name, s: +st.lockTime.toFixed(2), nm: +(g.d / NM).toFixed(2) }); }
      return; }
    if (ok) { st.stt.rm = T.r1.slice(); st.stt.vm = T.v.slice(); st.stt.tHit = st.t; }
    else if (st.t - st.stt.tHit > C.stt.coast) dropLock('lost'); }

  // ── search: move the antenna one step, look at every target it crosses
  function searchStep(O, h) {
    const P = pattern(O), a = st.ant, bars = P.els.length;
    if (a.bar >= bars) { a.bar = bars - 1; a.barDir = -1; }
    const lo = P.azC - P.azW, hi = P.azC + P.azW;
    if (a.az < lo - .01 || a.az > hi + .01) a.az = clamp(a.az, lo, hi);
    const a0 = a.az; let a1 = a0 + a.dir * C.scanDegS * D2R * h, turn = false;
    if (a1 > hi) { a1 = hi; turn = true; } else if (a1 < lo) { a1 = lo; turn = true; }
    const elB = P.els[a.bar], hb = C.beamDeg / 2 * D2R, amin = Math.min(a0, a1), amax = Math.max(a0, a1);
    a.az = a1; a.el = elB;
    for (const T of Wp.targets) { if (!live(T)) continue;
      const g = geo(O, T.r1, T.v), ta = P.body ? g.az : g.saz, te = P.body ? g.el : g.sel;
      if (g.off > C.gimbalDeg * D2R || Math.abs(te - elB) > hb || ta < amin || ta >= amax + (turn ? 1e-9 : 0)) continue;
      stats.looks++;
      const x = snr(T, g), seen = x !== -Infinity && Math.random() <= pd(x), los = seen && losClear(O, T.r1);
      if (st.lookLog && st.lookLog.length < 2e4) st.lookLog.push([T.name, Math.round(g.d), +x.toFixed(1), seen ? (los ? 1 : -1) : 0]);   /* test log: [name, m, SNR dB, 1 hit / 0 miss / -1 hidden by the ground] */
      if (x === -Infinity) { stats.notched++; continue; }
      if (!los) continue;
      if (bus.mode === 'ACM') { if (g.d <= C.acm.range * NM && !(st.reject.get(T) > st.t)) { startAcq(T, C.stt.acmLockS); return; } continue; }
      hit(T, g); }
    if (turn) { a.dir = -a.dir; let end = bars <= 1;
      if (bars > 1) { a.bar += a.barDir; if (a.bar >= bars || a.bar < 0) { a.barDir = -a.barDir; a.bar += 2 * a.barDir; end = true; } }
      // end of a frame: no hit in it and nothing bugged -> next automatic elevation centre (game aid: no ANT ELEV control yet)
      if (end) { a.frame++; if (!P.body && !st.bug && !st.hitsFrame) st.elIx = (st.elIx + 1) % C.autoEl.length; st.hitsFrame = 0; } } }

  // ── the physics step (weapons.js: after the targets moved, before the gun)
  function step(s, env, h) {
    if (!C || s.ref !== 'Earth') return;
    const tp = performance.now(); st.t += h;
    if (bus.mode !== st.lastMode) modeChanged(st.lastMode, bus.mode);
    if (bus.mode === 'OFF') { st.list.clear(); bus.tracks = []; bus.lock = null; return; }
    const O = st.own = ownFrame(s, s.t + h * 1e3);
    if (st.acq || st.stt) sttStep(O, h); else searchStep(O, h);
    // tracks: refresh + fade / coast
    const keep = bus.mode === 'TWS' ? C.tws.coast : bus.mode === 'RWS' ? C.rws.fade * frameTime('RWS') : 0;
    for (const [T, k] of st.list) { if (!live(T) || (k !== st.stt && k !== st.bug && st.t - k.tHit > keep)) { st.list.delete(T); continue; } refresh(O, k); }
    if (st.bug && !st.list.has(st.bug.T)) st.bug = null;
    if (st.bug && st.t - st.bug.tHit > C.tws.coast) { st.list.delete(st.bug.T); st.bug = null; }
    const all = [...st.list.values()].sort((p, q) => p.saz - q.saz);
    bus.tracks = st.stt ? [st.stt] : bus.mode === 'ACM' ? [] : all;
    bus.lock = st.stt || (bus.mode === 'TWS' ? st.bug : null);
    // range scale: up when the lock nears the top, down when it is in the lower 40 % (manual choice kept otherwise)
    if (bus.lock) { const R = C.ranges; while (st.rangeIx < R.length - 1 && bus.lock.range > .95 * R[st.rangeIx] * NM) st.rangeIx++; while (st.rangeIx > 0 && bus.lock.range < .4 * R[st.rangeIx - 1] * NM) st.rangeIx--; }
    const ms = performance.now() - tp; stats.ms += (ms - stats.ms) * .02; stats.msMax = Math.max(stats.msMax * .999, ms); }

  function modeChanged(from, to) {
    st.lastMode = to; st.ant.bar = 0; st.ant.barDir = 1;
    const keepT = st.stt ? st.stt.T : st.bug ? st.bug.T : null; st.acq = null;
    if (from === 'ACM' && st.rangeSave != null) { st.rangeIx = st.rangeSave; st.rangeSave = null; }
    if (to === 'ACM' || to === 'OFF') { st.stt = null; st.bug = null; st.list.clear(); if (to === 'ACM') { st.rangeSave = st.rangeIx; st.rangeIx = 0; } return; }
    if (from === 'ACM' && st.stt) { if (to === 'RWS') return; }
    if (to === 'TWS') { st.bug = keepT ? st.list.get(keepT) || null : null; st.stt = null; }
    if (to === 'RWS') { st.stt = keepT ? st.list.get(keepT) || null : null; st.bug = null; } }

  // ── keys
  const setMode = m => { if (MODES.includes(m)) { bus.mode = m; if (C) modeChanged(st.lastMode, m); } };
  function tab() {
    if (!C || bus.mode === 'OFF') return;
    if (bus.mode === 'ACM') { const T = (st.stt || st.acq || {}).T; if (T) { st.reject.set(T, st.t + 3); dropLock('reject'); } return; }
    const L = [...st.list.values()].filter(k => live(k.T)).sort((p, q) => p.saz - q.saz); if (!L.length) return;
    const cur = bus.mode === 'TWS' ? st.bug : (st.stt || (st.acq && st.list.get(st.acq.T)));
    let nx;
    if (!cur) nx = L.reduce((b, k) => (!b || Math.abs(k.saz) < Math.abs(b.saz) ? k : b), null);
    else { const i = L.indexOf(cur); nx = L[(i + 1) % L.length]; }
    if (bus.mode === 'TWS') { st.bug = nx; log('bug', { name: nx.T.name }); }
    else if (!st.stt || nx !== st.stt) startAcq(nx.T, C.stt.lockS); }
  function drop() { if (!C) return; if (bus.mode === 'TWS') { st.bug = null; return; }
    const T = (st.stt || st.acq || {}).T; if (T && bus.mode === 'ACM') st.reject.set(T, st.t + 3); dropLock('pilot'); }
  ctx.key('Backquote', ['`', 'radar mode RWS / TWS / ACM / OFF (Shift: range scale)'], e => { if (e.repeat) return;
    if (e.shiftKey) { if (C) { st.rangeIx = (st.rangeIx + 1) % C.ranges.length; st.manualRange = true; } return; }
    setMode(MODES[(MODES.indexOf(bus.mode) + 1) % MODES.length]); });
  ctx.key('Tab', ['Tab', 'radar: lock / next target (ACM: reject)'], e => { if (!e.repeat) tab(); });
  ctx.key('Backspace', ['Backspace', 'radar: drop the lock'], e => { if (!e.repeat) drop(); });

  // ── HUD data for the core's hud object (anyone may read h.radar)
  function hud(s, env, h) { const L = bus.lock; h.radar = { mode: bus.mode, acq: !!st.acq, lock: L ? { range: L.range, closing: L.closing, alt: L.alt } : null }; }
  const sys = Wp.addSystem({ name: 'radar', step, hud });

  // ── MFD page FCR (canvas 512 x 512, y 52..470): B-scope range vs azimuth
  const X0 = 64, X1 = 448, Y0 = 108, Y1 = 424, XC = (X0 + X1) / 2;
  function tri(x, cx, cy, r, ang) { x.beginPath(); for (let k = 0; k < 3; k++) { const a = ang + k * 2 * Math.PI / 3; x.lineTo(cx + r * Math.sin(a), cy - r * Math.cos(a)); } x.closePath(); x.fill(); }
  function drawFCR(x) {
    const mode = bus.mode, cfg = C;
    x.textBaseline = 'middle';
    if (!cfg) { x.fillStyle = '#9AA4B2'; x.font = `600 26px ${FONT}`; x.textAlign = 'center'; x.fillText('FCR LOADING', 256, 260); return; }
    // header: master mode, sub-mode, azimuth / bars, range scale
    const sm = mode === 'OFF' ? 'OFF' : st.stt ? (mode === 'ACM' ? 'ACM STT' : 'STT') : st.acq ? 'ACQ' : mode === 'ACM' ? '30x20' : mode;
    x.font = `700 24px ${FONT}`; x.textAlign = 'left'; x.fillStyle = '#7FD8FF'; x.fillText(mode === 'ACM' ? 'ACM' : 'CRM', 20, 70);
    x.fillStyle = '#F2F4F6'; x.fillText(sm, 84, 70);
    const M = mode === 'TWS' ? cfg.tws : mode === 'ACM' ? cfg.acm : cfg.rws;
    x.textAlign = 'right'; x.fillStyle = '#B8C2CC'; x.fillText(mode === 'OFF' ? '' : `A${Math.round(M.az / 10)} ${M.bars}B`, 492, 70);
    const rng = mode === 'ACM' ? cfg.acm.range : cfg.ranges[st.rangeIx];
    x.textAlign = 'center'; x.font = `700 22px ${MONO}`; x.fillStyle = '#F2F4F6'; x.fillText(String(rng), 34, Y0 + 4);
    x.fillStyle = '#B8C2CC'; tri(x, 34, Y0 - 18, 7, 0); tri(x, 34, Y0 + 26, 7, Math.PI);
    if (mode === 'OFF') { x.fillStyle = '#5D6878'; x.font = `700 34px ${FONT}`; x.fillText('RDR OFF', 256, 266); keysLine(x); return; }
    // scope frame + ticks (azimuth +-30 dashed, range quarters)
    x.strokeStyle = '#3A4654'; x.lineWidth = 2; x.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
    x.setLineDash([6, 10]); x.beginPath(); for (const a of [-30, 0, 30]) { const px = XC + a / 60 * (X1 - X0) / 2; x.moveTo(px, Y0); x.lineTo(px, Y1); } x.stroke(); x.setLineDash([]);
    x.beginPath(); for (let k = 1; k < 4; k++) { const py = Y1 - k / 4 * (Y1 - Y0); x.moveTo(X0, py); x.lineTo(X0 + 14, py); x.moveTo(X1 - 14, py); x.lineTo(X1, py); } x.stroke();
    const P = pattern(st.own || { }), body = P.body;
    // scan width lines (search) and antenna carets (azimuth below, elevation left)
    if (!st.stt && !st.acq) { x.strokeStyle = '#5D6878'; x.beginPath(); for (const a of [P.azC - P.azW, P.azC + P.azW]) { const px = XC + a / D2R / 60 * (X1 - X0) / 2; x.moveTo(px, Y0 + 4); x.lineTo(px, Y1 - 4); } x.stroke(); }
    const antAz = (st.stt || st.acq) ? (st.stt ? (body ? st.stt.az : st.stt.saz) : 0) : st.ant.az, antEl = (st.stt || st.acq) ? (st.stt ? (body ? st.stt.el : st.stt.sel) : 0) : st.ant.el;
    x.fillStyle = '#F2F4F6'; tri(x, XC + clamp(antAz / D2R / 60, -1, 1) * (X1 - X0) / 2, Y1 + 12, 8, 0);
    tri(x, X0 - 12, (Y0 + Y1) / 2 - clamp(antEl / D2R / 30, -1, 1) * (Y1 - Y0) / 2, 8, Math.PI / 2);
    // targets
    const toXY = k => [XC + clamp((body ? k.az : k.saz) / D2R / 60, -1, 1) * (X1 - X0) / 2, Y1 - clamp(k.range / (rng * NM), 0, 1.02) * (Y1 - Y0)];
    const fade = cfg.rws.fade * frameTime('RWS');
    for (const k of bus.tracks) { if (k.range == null) continue; const [px, py] = toXY(k), isL = k === bus.lock;
      if (mode === 'RWS' && !st.stt) { x.globalAlpha = clamp(1 - k.age / fade, .25, 1); x.fillStyle = GREEN; x.fillRect(px - 8, py - 5, 16, 10); x.globalAlpha = 1; continue; }
      x.fillStyle = k.age > 2 ? '#F2C14E' : GREEN; x.fillRect(px - 7, py - 7, 14, 14);
      const tl = Math.hypot(k.tx || 0, k.ty || 0); if (tl > 1) { x.strokeStyle = x.fillStyle; x.lineWidth = 3; x.beginPath(); x.moveTo(px, py); x.lineTo(px + k.tx / tl * 22, py - k.ty / tl * 22); x.stroke(); }
      if (isL) { x.strokeStyle = '#F2F4F6'; x.lineWidth = 2; x.beginPath(); x.arc(px, py, 15, 0, 2 * Math.PI); x.stroke(); }
      if (isL || mode === 'TWS') { x.fillStyle = '#F2F4F6'; x.font = `600 18px ${MONO}`; x.textAlign = 'center'; x.fillText(String(Math.round(k.alt / FT / 1000)), px, py + 26); } }
    if (st.acq) { const g = st.own ? geo(st.own, st.acq.T.r1, st.acq.T.v) : null;
      if (g && Math.floor(st.t * 4) % 2) { const [px, py] = toXY({ az: g.az, saz: g.saz, range: g.d }); x.strokeStyle = GREEN; x.lineWidth = 2; x.strokeRect(px - 9, py - 9, 18, 18); } }
    // lock data (top): aspect, closing, range, target altitude
    const L = bus.lock;
    if (L) { x.font = `600 20px ${MONO}`; x.fillStyle = '#F2F4F6'; x.textAlign = 'left';
      const asp = L.aspect != null ? String(Math.round(18 - L.aspect / D2R / 10)).padStart(2, '0') + L.aspSide : '--';
      x.fillText(`${asp}  ${(L.range / NM).toFixed(1)}NM  VC ${Math.round(L.closing * KT)}  ${Math.round(L.alt / FT / 100) * 100}FT`, X0, 94); }
    keysLine(x); }
  function keysLine(x) { x.fillStyle = '#5D6878'; x.font = `600 17px ${FONT}`; x.textAlign = 'center'; x.fillText('` MODE   TAB LOCK   BKSP DROP   SHIFT+` RNG', 256, 456); }
  ctx.mfdPage('FCR', drawFCR);

  // ── HUD target box (own overlay: children of the craft group, body axes, metres, as fx.js draws the gun symbols)
  const eye = (def.views && def.views[0] && def.views[0].eye) || [0, 0, 0], hudG = new THREE.Group(); hudG.position.set(...eye); hudG.visible = false;
  if (S.craft) S.craft.add(hudG);
  const lm = new THREE.LineBasicMaterial({ color: 0x39ff9e, depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
  const Tm = m => Math.tan(m / 1000) * HUD_D;
  const mk = pts => { const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p[0], p[1], 0))); const l = new THREE.LineSegments(g, lm); l.renderOrder = 1001; l.frustumCulled = false; return l; };
  const b = Tm(22), box = mk([[-b, -b], [b, -b], [b, -b], [b, b], [b, b], [-b, b], [-b, b], [-b, -b]]), xs = mk([[-b, -b], [b, b], [-b, b], [b, -b]]);
  const tdc = new THREE.Group(); tdc.add(box); tdc.add(xs); hudG.add(tdc);
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64; const cx2 = cv.getContext('2d'), tex = new THREE.CanvasTexture(cv);
  const sm = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }), txt = new THREE.Sprite(sm);
  txt.renderOrder = 1001; txt.center.set(0, .5); txt.scale.set(Tm(160), Tm(20), 1); txt.position.set(Tm(40), -Tm(95), -HUD_D); hudG.add(txt);
  let txtKey = '';
  const drawTxt = s => { if (s === txtKey) return; txtKey = s; cx2.clearRect(0, 0, 512, 64); cx2.font = `600 40px ${FONT}`; cx2.fillStyle = GREEN; cx2.textBaseline = 'middle'; cx2.fillText(s, 4, 34); tex.needsUpdate = true; };
  const LIM = 13 * D2R;   /* ESTIMATE: the box stays inside a 13 deg cone (HUD field of view); at the limit it shows an X */
  ctx.onPose(() => {
    const core = S.core, show = !!C && core && !core.hold && bus.mode !== 'OFF'; hudG.visible = show; if (!show) return;
    const L = bus.lock, s = core.state;
    tdc.visible = !!L;
    if (L) { const rel = sub(L.r, s.r), d = len(rel), bb = qrot(qconj(s.q), rel), off = Math.acos(clamp(-bb[2] / d, -1, 1));
      let dir = bb.map(c => c / d); const lim = off > LIM;
      if (lim) { const k = Math.hypot(dir[0], dir[1]) || 1; dir = [dir[0] / k * Math.sin(LIM), dir[1] / k * Math.sin(LIM), -Math.cos(LIM)]; }
      tdc.position.set(dir[0] * HUD_D, dir[1] * HUD_D, dir[2] * HUD_D); xs.visible = lim; }
    drawTxt(bus.mode + (st.acq ? ' ACQ' : '') + (L ? `  ${(L.range / NM).toFixed(1)}  VC ${Math.round(L.closing * KT)}` : ''));
  });

  function dispose() { Wp.removeSystem(sys); if (S.craft) S.craft.remove(hudG); for (const o of [box, xs]) o.geometry.dispose(); lm.dispose(); sm.dispose(); tex.dispose(); bus.tracks = []; bus.lock = null; }
  // test API (S.plugins.list.radar)
  // setElev(deg | null): manual antenna elevation of the CRM scan centre (for an ANT ELEV knob / HOTAS axis; null = automatic)
  const setElev = deg => { st.elMan = deg == null ? null : clamp(+deg, -30, 30); };
  return { dispose, st, stats, get cfg() { return C; }, setMode, tab, drop, setElev, drawFCR, geo: (r, v) => geo(st.own, r, v), snr, pd, losClear: r => losClear(st.own, r), frameTime };
}
