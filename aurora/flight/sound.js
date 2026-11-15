/* F-16 sounds (Web Audio) from Falcon BMS 4.38: files + sound-table rows + F-16CM-50 sound charts made by tools/build_bms_sounds.py
   (sounds/f16-bms/, LICENCE.txt there). Driven per frame by the flight values:
   - engine: rpm (from the engine's power level) -> gain / pitch of each layer through the BMS charts (int1-3, abInt inside; ext1-4, abExt outside)
   - aero: Mach + AoA -> canopy wind, buffet layers (inside), airflow (outside); gear extended + Mach -> gear wind
   - gear: handle click, motor start / loop / end clunks from the gear position; touchdown; tyre roll + wheel brake from the ground speed
   - VMS ("Betty"): PULL UP, OVER G, BINGO; the landing-gear warning beeps
   Inside (cockpit view, camera near the eye) vs outside (chase / far chase / orbit / free camera) follows the BMS flags:
   I inside only, O outside only, E outside + inside x snd_external_vol, S both unattenuated, V always.
   Outside: distance law of the BMS table (full up to minFt, then minFt / d, silent past maxFt), the sound cone (our reading of
   BMS's inside / outside cone, see coneGain) and a left / right pan; no Doppler. BMS (DirectSound) never plays above 0 dB: gains clamp at 1.
   Audio starts on the first click / key (browser rule). The Sound button steps the volume 100 / 60 / 30 % / off (localStorage aurora.flsnd). */
import { R_E } from './core.js?v=9235aa0c';
const DIR = new URL('sounds/f16-bms/', import.meta.url);
const FT = 3.28084, D2R = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const db = v => Math.pow(10, (v || 0) / 2000);   // BMS hundredths of a dB -> amplitude
export function lut(c, x) {   // piecewise linear, clamped at both ends (the BMS chart rule as we read it)
  if (!c || !c.length) return 0; if (x <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) if (x <= c[i][0]) { const [a, va] = c[i - 1], [b, vb] = c[i]; return b > a ? va + (vb - va) * (x - a) / (b - a) : vb; }
  return c[c.length - 1][1]; }
// engine power level (0..100, 50 = MIL, 100 = full AB; flight/aero.js) -> BMS rpm key: core rpm (n2, 65 % idle .. 100 % MIL), then 1 .. 1.03 across
// the afterburner range (the BMS AB charts start at 1.0 and are full at 1.021). Our mapping, not a BMS value.
export const rpmOf = e => !e || !e.on ? 0 : e.power <= 50 ? (e.n2 || 0) / 100 : 1 + .03 * (e.power - 50) / 50;
// source points in the craft frame (m, x right, y up, z aft): estimates from the BMS model's size (nozzle exit ~7.5 m aft of the origin)
const AT = { noz: [0, .4, 7.5], intake: [0, -1, -2.5], gear: [0, -1.5, 0], body: [0, 0, 0] };
const LAYERS = { int1: 'body', int2: 'body', int3: 'body', abInt: 'body', ext1: 'noz', ext2: 'intake', ext3: 'noz', ext4: 'noz', abExt: 'noz' };
const AXIS = { ext1: 1, ext3: 1, ext4: 1, abExt: 1, ext2: -1 };   // cone axis: +1 = aft (+z), -1 = forward
const BINGO_KG = 700;   // estimate (~1500 lb); the pilot sets it in the real jet
const LS = 'aurora.flsnd';
const T = s => (window.T ? window.T(s) : s);

export function createSound(F, core, ui) {
  const st = { vol: 60, off: false }; try { const v = JSON.parse(localStorage.getItem(LS) || 'null'); if (v) Object.assign(st, v); } catch (e) {}
  let ac = null, man = null, master = null, bufs = {}, loops = {}, ready = false, failed = false, tLast = -1, rpmS = 0, t0 = performance.now();
  let gearCmd = null, gearPos = null, gnd = null, vsPrev = 0, bettyEnd = 0, bingoArmed = true, lastDbg = null;
  // ── UI: Sound on / off + volume (in the controls bar, before Keys)
  const ctl = ui.querySelector('.fl-ctl'), kb = ctl && ctl.querySelector('[data-a="keys"]');
  // one button (the bar is full on narrow screens): each click steps the volume 100 -> 60 -> 30 % -> off -> 100 %
  const STEPS = [100, 60, 30];
  const btn = document.createElement('button'); btn.dataset.snd = '1'; btn.title = T('Sound starts with your first click or key');
  if (ctl) ctl.insertBefore(btn, kb || null); const wrap = btn;
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) {} };
  const label = () => { btn.textContent = failed ? T('Sound not available') : st.off ? T('Sound off') : T('Sound') + ' ' + st.vol + ' %';
    btn.setAttribute('aria-pressed', String(!st.off && !failed)); btn.setAttribute('aria-label', T('Sound volume') + ': ' + (st.off ? T('Sound off') : st.vol + ' %')); };
  const setMaster = () => { if (master) master.gain.setTargetAtTime(st.off ? 0 : Math.pow(st.vol / 100, 2), ac.currentTime, .05); label(); };
  btn.addEventListener('click', e => { e.stopPropagation(); btn.blur();
    if (st.off) { st.off = false; st.vol = STEPS[0]; } else { const i = STEPS.indexOf(st.vol); if (i < 0 || i === STEPS.length - 1) st.off = true; else st.vol = STEPS[i + 1]; }
    save(); if (!st.off) start(); setMaster(); });
  if (!STEPS.includes(st.vol)) st.vol = STEPS[1]; label();

  // ── start on the first user gesture: AudioContext, manifest, all buffers (~3.8 MB)
  const gesture = () => { if (ac && ac.state === 'suspended') ac.resume(); if (!st.off) start(); };
  addEventListener('pointerdown', gesture, true); addEventListener('keydown', gesture, true);
  async function start() {
    if (ac || failed) return;
    try {
      ac = new AudioContext(); master = ac.createGain(); master.gain.value = 0;
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -6; comp.knee.value = 6; comp.ratio.value = 8; comp.attack.value = .003; comp.release.value = .2;
      master.connect(comp).connect(ac.destination);
      man = await (await fetch(new URL('sounds.json', DIR))).json();
      const keys = Object.keys(man.sounds);
      await Promise.all(keys.map(async k => { const r = await fetch(new URL(man.sounds[k].file, DIR)); if (!r.ok) throw new Error(k + ' ' + r.status); bufs[k] = await ac.decodeAudioData(await r.arrayBuffer()); }));
      for (const k of keys) if (man.sounds[k].flags.includes('L')) loops[k] = voice(k, true);
      ready = true; setMaster();
    } catch (e) { console.warn('flight sound', e); failed = true; label(); btn.disabled = true; }
  }
  function voice(k, loop) {   // buffer -> gain -> pan -> master
    const src = ac.createBufferSource(), g = ac.createGain(), p = ac.createStereoPanner();
    src.buffer = bufs[k]; src.loop = loop; g.gain.value = 0; src.connect(g).connect(p).connect(master); src.start(); return { src, g, p, k }; }
  function oneShot(k, gain, pan = 0) {
    if (!ready || !bufs[k] || gain <= 0) return; const v = voice(k, false); v.g.gain.value = Math.min(1, gain); v.p.pan.value = pan;
    v.src.onended = () => v.g.disconnect(); return v; }

  // ── geometry: listener (camera) in the craft frame
  const L = { pos: [0, 0, 0], right: [1, 0, 0], inside: false };
  // onPose runs before earthgl places the camera for this frame: while piloting, take the pilot camera's pose from the core (the look turn,
  // added later by earthgl, only changes the pan); otherwise the free camera (one frame old)
  function listener(P, t) {
    const THREE = F.THREE, cam = F.camera, qi = P.quat.clone().invert(), cp = F.piloting ? core.camPose(t) : null;
    const rel = (cp ? cp.pos : cam.position).clone().sub(P.pos).multiplyScalar(R_E).applyQuaternion(qi);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cp ? cp.quat : cam.quaternion).applyQuaternion(qi);
    L.pos = [rel.x, rel.y, rel.z]; L.right = [right.x, right.y, right.z];
    const eye = core.def.views[0].eye; L.inside = core.view === 0 && Math.hypot(rel.x - eye[0], rel.y - eye[1], rel.z - eye[2]) < 2; }
  // our reading of the BMS cone: full inside coneIn / 2 of the axis, then a dB-linear fade reaching coneAtt only at 180 deg (the opposite
  // direction). coneOut is not used: BMS gives it smaller than coneIn, which DirectSound does not define. The first reading (fade over
  // coneOut / 2) left the side of the jet 10-17 dB under the rear (afterburner roar -17 dB at 90 deg): muffled, user 2026-11-15.
  function coneGain(m, ang) { if (m.coneIn == null) return 1; const a = m.coneIn / 2;
    return ang <= a ? 1 : db((m.coneAtt || 0) * clamp((ang - a) / Math.max(1, 180 - a), 0, 1)); }
  // flags + distance + cone -> amplitude factor and pan for sound k at point `at`
  function place(k, at, axis) {
    const m = man.sounds[k], f = m.flags[0], I = L.inside;
    if (f === 'I') return { g: I ? db(m.vol) : 0, pan: 0 };
    if (f === 'O' && I) return { g: 0, pan: 0 };
    if (f === 'V' || (f === 'S' && I)) return { g: Math.min(1, db(m.vol)), pan: 0 };
    const p = AT[at] || AT.body, d = [p[0] - L.pos[0], p[1] - L.pos[1], p[2] - L.pos[2]], dm = Math.max(.5, Math.hypot(...d)), dft = dm * FT;
    const minFt = m.minFt > 0 ? m.minFt : (m.maxFt || 0) / 20; if (m.maxFt && dft > m.maxFt) return { g: 0, pan: 0 };
    let g = db(m.vol) * Math.min(1, minFt / dft);
    if (axis) { const c = -(d[2] * axis) / dm; g *= coneGain(m, Math.acos(clamp(c, -1, 1)) / D2R); }   // angle between the cone axis and the source -> listener line
    if (f === 'E' && I) g *= db(man.externalVol);
    return { g: Math.min(1, g), pan: I ? 0 : clamp((d[0] * L.right[0] + d[1] * L.right[1] + d[2] * L.right[2]) / dm, -1, 1) * .8 }; }

  // ── the mix for the current flight values (pure: also used by the tests to log gain curves)
  function mix(h, s, rpm) {
    const out = {}, put = (k, g, rate = 1, at = 'body', axis = 0) => { if (!man.sounds[k]) return; const p = place(k, at, axis); out[k] = { g: Math.min(1, clamp(g, 0, 1) * p.g), rate: clamp(rate, .05, 4), pan: p.pan }; };
    for (const k in man.engine) { const c = man.engine[k]; put(k, lut(c.gain, rpm), lut(c.pitch, rpm), LAYERS[k], AXIS[k] || 0); }
    const M = h.mach || 0, aoa = h.aoa || 0, A = man.aero;
    for (const k of ['aero', 'aoaLow', 'aoaHigh', 'airflow']) if (A[k]) put(k, lut(A[k].gain, M) * lut(A[k].aoa, aoa), lut(A[k].pitch, M));
    const gs = h.onGround ? Math.max(0, (h.gs || 0) - 1) : 0, gear   /* 1 m/s dead band: the hud reads ~0.7 m/s with the parking brake set */ = s.srf ? s.srf.gear : 1;
    put('gearWind', h.onGround ? 0 : gear * clamp(M / .3, 0, 1), 1, 'gear');                           // estimate
    put('rumble', clamp(gs / 30, 0, 1), .7 + .6 * clamp(gs / 80, 0, 1), 'gear');                     // estimate: tyre roll vs ground speed
    put('rumbleInt', clamp(gs / 30, 0, 1), .7 + .6 * clamp(gs / 80, 0, 1), 'gear');
    put('brake', h.onGround && (s.ctl.brake > 0) && gs > 1 ? clamp(gs / 20, 0, 1) : 0, .8 + .4 * clamp(gs / 60, 0, 1), 'gear');
    // landing-gear warning (F-16: below 10 000 ft, below 190 kt, sinking faster than 250 ft/min, gear handle up)
    put('gearBeeps', !h.onGround && !s.ctl.gear && (h.altMSL || 0) * FT < 10000 && (h.ias || 0) * 1.94384 < 190 && (h.vs || 0) * FT * 60 < -250 ? 1 : 0);
    put('gDnLoop', gearPos != null && s.ctl.gear && gear > 0 && gear < 1 ? 1 : 0, 1, 'gear');
    put('gUpLoop', gearPos != null && !s.ctl.gear && gear > 0 && gear < 1 ? 1 : 0, 1, 'gear');
    return out; }

  function betty(k, gap) { const now = ac.currentTime; if (now < bettyEnd) return; const v = oneShot(k, db(man.sounds[k].vol)); if (v) bettyEnd = now + bufs[k].duration + gap; }

  // ── per frame (session.js onPose)
  function update(P, t) {
    if (!ready || !P) return; const dt = tLast < 0 ? 0 : clamp((t - tLast) / 1e3, 0, .2); tLast = t;
    const h = core.hud, s = core.state, e = s.eng && s.eng[0], now = ac.currentTime;
    listener(P, t);
    const want = core.hold ? 0 : rpmOf(e); rpmS += (want - rpmS) * (1 - Math.exp(-dt / (want < rpmS ? 1.2 : .15)));   // spool-down slower than up (estimate)
    const m = mix(h, s, rpmS); lastDbg = { rpm: rpmS, inside: L.inside, at: L.pos.map(x => +x.toFixed(2)), mix: m };
    for (const k in loops) { const v = loops[k], x = m[k] || { g: 0, rate: 1, pan: 0 }, g = core.hold ? 0 : x.g;
      v.g.gain.setTargetAtTime(g, now, .06); v.src.playbackRate.setTargetAtTime(x.rate, now, .06); v.p.pan.setTargetAtTime(x.pan, now, .06); }
    if (core.hold) return;
    // gear: handle, motor start / end clunks (the loops above run while the legs move)
    const gc = s.ctl.gear ? 1 : 0, gp = s.srf.gear;
    if (gearCmd != null && gc !== gearCmd) {
      const hk = gc ? 'handleDn' : 'handleUp'; oneShot(hk, place(hk).g);
      const sk = gc ? 'gDnStart' : 'gUpStart'; const p = place(sk, 'gear'); oneShot(sk, p.g, p.pan);
      if (gc) oneShot('gDnStartInt', place('gDnStartInt').g); }
    if (gearPos != null) {
      const end = (gp >= 1 && gearPos < 1) ? ['gDnEnd', 'gDnEndL', 'gDnEndInt', 'gDnEndLInt'] : (gp <= 0 && gearPos > 0) ? ['gUpEnd', 'gUpEndL', 'gUpEndInt'] : null;
      if (end) for (const k of end) { const p = place(k, 'gear'); oneShot(k, p.g, p.pan); } }
    gearCmd = gc; gearPos = gp;
    // touchdown: ground contact begins while sinking (not the placement on the runway at the start)
    if (gnd === false && h.onGround && vsPrev < -.3 && performance.now() - t0 > 3000) { const p = place('touchdown', 'gear'); oneShot('touchdown', p.g * clamp(-vsPrev / 2.5, .3, 1), p.pan); }
    gnd = !!h.onGround; vsPrev = h.vs || 0;
    // VMS: one message at a time, repeated while the condition holds (gaps: estimates)
    if (!h.onGround && !h.crash) {
      if ((h.vs || 0) < -15 && (h.agl || 0) / -h.vs < 5) betty('pullup', .4);
      else if ((h.g || 0) > 9) betty('maxg', .6); }
    if (h.fuel != null) { if (bingoArmed && h.fuel < BINGO_KG) { betty('bingo', .5); bingoArmed = false; } else if (h.fuel > BINGO_KG + 50) bingoArmed = true; }
  }
  function dispose() {
    removeEventListener('pointerdown', gesture, true); removeEventListener('keydown', gesture, true); wrap.remove();
    for (const k in loops) try { loops[k].src.stop(); } catch (e) {} loops = {}; ready = false; if (ac) ac.close(); ac = null; }
  // tests: gain curves vs throttle at fixed flight values (same mix as the frame loop), state of the last frame
  const curve = (pws, h = {}, inside = false) => { const save = L.inside; L.inside = inside; L.pos = inside ? core.def.views[0].eye.slice() : [0, 4, 24]; L.right = [1, 0, 0];
    const r = pws.map(pw => { const e = { on: true, power: pw, n2: pw < 50 ? 65 + .7 * pw : 100 }, mx = mix({ mach: 0, onGround: true, gs: 0, ...h }, core.state, rpmOf(e));
      return { pw, rpm: +rpmOf(e).toFixed(3), ...Object.fromEntries(Object.entries(mx).filter(([k, v]) => v.g > 1e-4).map(([k, v]) => [k, +v.g.toFixed(3) + '@' + v.rate.toFixed(2)])) }; });
    L.inside = save; return r; };
  return { update, dispose, curve, get ready() { return ready; }, get ac() { return ac; }, get dbg() { return lastDbg; }, start };
}
