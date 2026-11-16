/* S12 electronic warfare plug-in (docs/flight-notes/weapons-contract.md row "ew"; notes docs/flight-notes/s12-combat.md): a GAME-level RWR
   and countermeasures for the F-16. Every number is an invented game value in data/combat.json (no real sensor or decoy data).
   RWR: every live red target within rwr.range is a contact (game rule: the bandits' radars are always on). Per contact: bearing (body
   azimuth), "lock" when it is in MERGE (ai.js), within lockRange and the F-16 lies within lockCone of its nose, "launch" while a red
   long-class game missile (missiles.js fireAt) homes on the F-16. Red short-class missiles give no RWR cue (IR, passive, as in reality);
   a GAME missile warning "MISSILE" shows when one is within mwsRange. Cues: BMS ALR-56 tones (sound.js cue: rwrNew / rwrLock / rwrLaunch).
   Drawn on the MFD page RWR (scope: own ship in the centre, symbol at the bearing, distance from the centre = range / rwr.range; GAME
   layout, not the ALR-56 priority rings) with the CMS counts and the caution lamps of damage.js; the warning goes to both HUDs (h.ew).
   Countermeasures: key Slash = one program (one flare + one chaff, at most every cms.gap s); each release makes every game missile homing on
   the F-16 roll once with the chance table cms.decoy (missiles.js bus.decoy). drop(w, vw, kind) draws flares / chaff for anyone (ai-weapons.js
   uses it for the bandits). Drawing: soft billboards in a W-aligned group at the craft, vertices in metres relative to it (S0a rules).
   Shader chunks: no // comments after code. Own code. */
import { R_E, OMEGA_I } from '../core.js';
import { qrot, qconj } from './weapons.js';

const J = await (await fetch(new URL('data/combat.json', import.meta.url))).json();
const D2R = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], len = a => Math.hypot(a[0], a[1], a[2]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mv = (M, x) => [M[0] * x[0] + M[1] * x[1] + M[2] * x[2], M[3] * x[0] + M[4] * x[1] + M[5] * x[2], M[6] * x[0] + M[7] * x[1] + M[8] * x[2]];
const BB_V = 'attribute vec3 iP; attribute vec4 iC; attribute float iS; uniform float uPx; varying vec2 vQ; varying vec4 vC;\n' +
  'void main() { vec4 c = modelViewMatrix * vec4(iP, 1.); c.xy += position.xy * max(iS, -c.z * uPx); vQ = position.xy; vC = iC; gl_Position = projectionMatrix * c; }';
const BB_F = 'varying vec2 vQ; varying vec4 vC;\n' +
  'void main() { float r = length(vQ); if (r > 1.) discard; float f = 1. - r; f = f * f * (3. - 2. * f); gl_FragColor = vec4(vC.rgb, vC.a * f); }';

export function attach(ctx) {
  const { S, F, Wp, bus, core } = ctx, THREE = F.THREE, RW = J.rwr, CM = J.cms;
  const me = () => { const d = S.plugins && S.plugins.list && S.plugins.list.damage; return d ? d.target : null; };   // damage.js (after all plug-ins attached)
  const st = { flares: CM.flares, chaff: CM.chaff, released: 0, decoyed: 0, contacts: [], warn: '', lastRel: -1e9, want: 0, cues: { new: 0, lock: 0, launch: 0 } };
  const seen = new Set(); let tNew = -1e9, tLock = -1e9, tLaunch = -1e9, MWlast = null;
  const snd = k => { if (S.snd && S.snd.cue) S.snd.cue(k); };

  // ── per physics step: contacts, warnings, cues, the countermeasure program
  function step(s, env, h, MW) { MWlast = MW;
    if (s.ref !== 'Earth') { st.contacts = []; st.warn = ''; return; }
    const T0 = me(), qc = qconj(s.q), out = []; let lock = false, launch = false, mws = false;
    for (const T of Wp.targets) { if (!T.alive || !T.r1 || T.team !== 'red') continue; const rel = sub(T.r1, s.r), d = len(rel); if (d > RW.range) continue;
      const b = qrot(qc, rel), az = Math.atan2(b[0], -b[2]), nose = T.q1 ? qrot(T.q1, [0, 0, -1]) : null;
      const off = nose ? Math.acos(Math.max(-1, Math.min(1, -dot(nose, rel) / d))) / D2R : 180;
      const lk = T.state === 'MERGE' && d < RW.lockRange && off < RW.lockCone;
      const ln = (bus.missiles || []).some(m => m.team === 'red' && m.cls === 'long' && m.state !== 'gone' && m.target && m.target === T0 && m.shooter === T);
      out.push({ T, name: T.name, az, d, lock: lk || ln, launch: ln }); lock = lock || lk; launch = launch || ln;
      if (!seen.has(T)) { seen.add(T); if (s.t - tNew > RW.newGap * 1e3) { tNew = s.t; snd('rwrNew'); st.cues.new++; } } }
    // missiles homing on the F-16 that the scope shows as their own symbol (long: RWR launch; short: game MWS within mwsRange)
    for (const m of bus.missiles || []) { if (m.team !== 'red' || m.state === 'gone' || !m.r || !T0 || m.target !== T0) continue; const rel = sub(m.r, s.r), d = len(rel);
      if (m.cls === 'long') launch = true; else if (d < RW.mwsRange) mws = true; else continue;
      const b = qrot(qc, rel); out.push({ missile: true, cls: m.cls, az: Math.atan2(b[0], -b[2]), d, launch: m.cls === 'long' }); }
    st.contacts = out; st.warn = launch ? 'LAUNCH' : mws ? 'MISSILE' : lock ? 'LOCK' : '';
    if (launch && s.t - tLaunch > RW.launchGap * 1e3) { tLaunch = s.t; snd('rwrLaunch'); st.cues.launch++; }
    else if (!launch && lock && s.t - tLock > RW.lockGap * 1e3) { tLock = s.t; snd('rwrLock'); st.cues.lock++; }
    for (const T of seen) if (!T.alive || !Wp.targets.includes(T)) seen.delete(T);
    // countermeasures: one program per press, spaced by cms.gap
    if (st.want > 0 && s.t - st.lastRel >= CM.gap * 1e3 && !s.crash) { st.want--; release(s, T0, MW); } }

  // one program from the F-16: a flare and a chaff bundle (each only while some are left)
  function release(s, T0, MW) { const kinds = []; if (st.flares > 0) { st.flares--; kinds.push('flare'); } if (st.chaff > 0) { st.chaff--; kinds.push('chaff'); }
    if (!kinds.length) return; st.lastRel = s.t; st.released++;
    for (const k of kinds) { if (T0 && bus.decoy) st.decoyed += bus.decoy(T0, k, CM.decoy);
      const w = mv(MW, s.r), vw = mv(MW, sub(s.v, cross(OMEGA_I, s.r))); drop(w, vw, k); }
    snd('cmRelease'); if (st.released === 1 || st.released % 4 === 0) snd('cmBetty'); }

  function hud(s, env, h) { const E = h.ew || (h.ew = {}); E.warn = st.warn; E.flares = st.flares; E.chaff = st.chaff; E.contacts = st.contacts.length; }
  const sys = Wp.addSystem({ name: 'ew', step, hud });
  ctx.key('Slash', ['/', 'Countermeasures: one flare + one chaff (S12; counts on the HUD and the RWR page)'], e => { if (!e.repeat) st.want = Math.min(st.want + 1, 4); });

  // ── MFD page RWR: scope + CMS + caution lamps
  const FONT = 'system-ui, sans-serif', MONO = 'ui-monospace, Consolas, monospace';
  function page(x) { const cx = 256, cy = 230, R = 150, t = performance.now();
    x.strokeStyle = '#2E5E46'; x.lineWidth = 2; for (const f of [1, .5]) { x.beginPath(); x.arc(cx, cy, R * f, 0, 7); x.stroke(); }
    x.beginPath(); for (let a = 0; a < 360; a += 30) { const c = Math.cos(a * D2R), sn = Math.sin(a * D2R); x.moveTo(cx + sn * R * .93, cy - c * R * .93); x.lineTo(cx + sn * R, cy - c * R); } x.stroke();
    x.strokeStyle = '#39FF9E'; x.beginPath(); x.moveTo(cx, cy - 10); x.lineTo(cx, cy + 8); x.moveTo(cx - 9, cy); x.lineTo(cx + 9, cy); x.stroke();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    for (const c of st.contacts) { const rr = Math.min(1, c.d / RW.range) * R * .9, px = cx + Math.sin(c.az) * rr, py = cy - Math.cos(c.az) * rr, blink = (t / 250 | 0) % 2;
      if (c.missile) { x.fillStyle = '#FF5A5A'; x.font = `700 26px ${MONO}`; x.fillText(c.cls === 'long' ? 'M' : 'I', px, py); continue; }
      x.fillStyle = c.lock ? '#FFB347' : '#39FF9E'; x.font = `700 28px ${MONO}`; x.fillText('29', px, py);
      if (c.lock) { x.strokeStyle = '#FFB347'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(px, py - 24); x.lineTo(px + 24, py); x.lineTo(px, py + 24); x.lineTo(px - 24, py); x.closePath(); x.stroke(); }
      if (c.launch && blink) { x.strokeStyle = '#FF5A5A'; x.lineWidth = 3; x.beginPath(); x.arc(px, py, 30, 0, 7); x.stroke(); } }
    if (st.warn) { x.font = `700 34px ${FONT}`; x.fillStyle = st.warn === 'LOCK' ? '#FFB347' : '#FF5A5A'; x.fillText(st.warn, cx, 82); }
    x.font = `700 26px ${MONO}`; x.fillStyle = '#F2F4F6'; x.textAlign = 'left'; x.fillText('FLR ' + st.flares, 30, 412); x.textAlign = 'right'; x.fillText('CHF ' + st.chaff, 482, 412);
    const dm = S.plugins && S.plugins.list && S.plugins.list.damage, lamps = [['ENGINE', 'engine'], ['FLT CONT', 'controls'], ['FUEL LEAK', 'fuel']];
    lamps.forEach(([lb, k], i) => { const on = dm && dm.state.sev[k] > .02, x0 = 30 + i * 154; x.fillStyle = on ? '#FFB347' : '#1C2329'; x.fillRect(x0, 432, 144, 34);
      x.fillStyle = on ? '#1A1206' : '#5D6878'; x.font = `700 20px ${FONT}`; x.textAlign = 'center'; x.fillText(lb, x0 + 72, 450); });
    if (dm) { x.textAlign = 'center'; x.font = `700 24px ${MONO}`; x.fillStyle = dm.state.dead ? '#FF5A5A' : dm.state.hp < 40 ? '#FFB347' : '#9AA4B2'; x.fillText(dm.state.dead ? 'DESTROYED' : 'HP ' + Math.round(dm.state.hp), cx, 412); } }
  ctx.mfdPage('RWR', page);

  // ── flares / chaff drawing (W metres, sim clock): a flare = a hot point that slows in the air and falls; chaff = a grey cloud that blooms
  const NP = 400, root = new THREE.Group(); root.scale.setScalar(1 / R_E); ctx.cs.add(root); const uPx = { value: 0 };
  const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
  const A = { iP: 3, iC: 4, iS: 1 }; for (const k in A) { const a = new THREE.InstancedBufferAttribute(new Float32Array(NP * A[k]), A[k]); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); A[k] = a; }
  g.instanceCount = 0; const mt = new THREE.ShaderMaterial({ vertexShader: BB_V, fragmentShader: BB_F, uniforms: { uPx }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const g2 = g.clone(), A2 = {}; for (const k in A) { A2[k] = g2.getAttribute(k); } const mt2 = mt.clone(); mt2.blending = THREE.NormalBlending; mt2.uniforms = { uPx };
  const mesh = new THREE.Mesh(g, mt), mesh2 = new THREE.Mesh(g2, mt2); for (const m of [mesh, mesh2]) { m.frustumCulled = false; m.renderOrder = 3; root.add(m); }
  const parts = [];   // { w, vw, t0 (sim s, stamped on the first frame), kind }
  function drop(w, vw, kind) { if (parts.length >= NP) parts.shift(); parts.push({ w: w.slice(), vw: vw.slice(), t0: null, kind }); }
  ctx.onPose((P, t) => { if (!P) return; const tS = t / 1e3, cc = S.cc, Hpx = Math.max(1, F.renderer.domElement.clientHeight); root.position.copy(P.pos);
    const base = [P.pos.x * R_E, P.pos.y * R_E, P.pos.z * R_E]; uPx.value = 2 * Math.tan(cc.fov * D2R / 2) / Hpx * 1.5; let n = 0, n2 = 0, far = 0;
    for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; if (p.t0 == null) p.t0 = tS; const age = tS - p.t0, life = p.kind === 'flare' ? CM.flareLife : CM.chaffLife;
      if (age > life || age < 0) { parts.splice(i, 1); continue; }
      const tau = p.kind === 'flare' ? 1.2 : .35, k = tau * (1 - Math.exp(-age / tau)), ul = len(p.w), fall = (p.kind === 'flare' ? 4.9 : 1.5) * age * age;   /* drag time constant + fall: look ESTIMATE */
      const x = p.w[0] + p.vw[0] * k - p.w[0] / ul * fall - base[0], y = p.w[1] + p.vw[1] * k - p.w[1] / ul * fall - base[1], z = p.w[2] + p.vw[2] * k - p.w[2] / ul * fall - base[2], u = age / life;
      far = Math.max(far, Math.hypot(x, y, z) + 10);
      if (p.kind === 'flare') { if (n >= NP) continue; A.iP.array.set([x, y, z], 3 * n); A.iC.array.set([3.2, 2.4, 1.4, 1 - u * u], 4 * n); A.iS.array[n] = (1.6 + .5 * Math.random()) / R_E; n++; }
      else { if (n2 >= NP) continue; A2.iP.array.set([x, y, z], 3 * n2); A2.iC.array.set([.75, .75, .78, .55 * (1 - u)], 4 * n2); A2.iS.array[n2] = (1 + 7 * u) / R_E; n2++; } }
    g.instanceCount = n; g2.instanceCount = n2; for (const k in A) { A[k].needsUpdate = true; A2[k].needsUpdate = true; }
    if (far > 0) cc.far = Math.max(cc.far, Math.min(80000, far + 200) / R_E); });

  function reset() { st.flares = CM.flares; st.chaff = CM.chaff; st.released = 0; st.decoyed = 0; st.want = 0; parts.length = 0; seen.clear(); }
  const onClick = e => { if (e.target.closest && e.target.closest('[data-a="reset"]')) reset(); };
  if (ctx.ui) ctx.ui.addEventListener('click', onClick);
  function dispose() { Wp.removeSystem(sys); if (ctx.ui) ctx.ui.removeEventListener('click', onClick); ctx.cs.remove(root); g.dispose(); g2.dispose(); mt.dispose(); mt2.dispose(); }
  return { dispose, state: st, drop, page, reset, release: () => { st.want++; }, data: J };
}
