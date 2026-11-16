/* F-16 trim + autopilot (docs/flight-notes/f16-trim-ap.md). Own code; behaviour after TO 1F-16CM/AM-1 BMS (Falcon BMS 4.38 docs,
   sect. 17.13 Autopilot, 35.5 Autopilot, 35.6 Trim) and BMS data (Data/Sim/Acdata/F-16CM-50.txtpb), see the json's _src; loop gains are ours.
   Trim: s.ctl.trim = pitch trim (g added to the FLCS g command, -2.4..+2.4 = full nose down / up = -1.4 / +3.4 g hands-off),
   s.ctl.trimRoll = roll trim (deg/s added to the roll-rate command, 1/5 of the full stick command). aero.js fcs() applies both in the air.
   Input (core.js passes these in s.ctl.ev; held trim keys in s.ctl.trimAx; the paddle switch is s.ctl.paddle, held = true):
     [ / ] nose down / up, ; / ' left / right wing down, \ trim to 0 (stick trim: inoperative while the A/P is engaged, as the jet);
     Y = cycle OFF -> ATT HOLD -> ALT HOLD -> ALT HOLD + HDG SEL -> OFF;
     'apAlt' / 'apAtt' / 'apOff' = PITCH switch positions, 'apRollAtt' / 'apRollHdg' / 'apRollToggle' = ROLL switch (HOTAS, cockpit clicks).
   Output: s.ap = { nz (g) | null, p (deg/s) | null } while engaged; fcs() adds the stick to it (the A/P command is additive to stick
   commands); an axis = null -> the normal stick law (+ trim) flies that axis. s.ap = null when off or interrupted. */
import { toF, latLonOf, OMEGA_I } from './core.js?v=d29b8afa';

const D2R = Math.PI / 180, G0 = 9.80665, FT = .3048;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const qrot = (q, v) => { const t = cross(q, v).map(x => 2 * x), u = cross(q, t); return [v[0] + t[0] * q[3] + u[0], v[1] + t[1] * q[3] + u[1], v[2] + t[2] * q[3] + u[2]]; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrap = a => ((a + 540) % 360) - 180;   // deg -> -180..180
export const AP_EVENTS = ['KeyY', 'apAlt', 'apAtt', 'apOff', 'apRollAtt', 'apRollHdg', 'apRollToggle'];
const TEXT = { att: 'ATT HOLD', alt: 'ALT HOLD' }, RTEXT = { att: '', hdg: ' · HDG SEL' };

// attitude (deg), heading (deg true), altitude MSL (m) and vertical speed relative to the turning ground (m/s) of a state
export function attitudeOf(s, env) {
  const U = env.nUp, fw = qrot(s.q, [0, 0, -1]), rt = qrot(s.q, [1, 0, 0]), up = qrot(s.q, [0, 1, 0]);
  const f = toF(s.t, s.r), [la, lo] = latLonOf(f), fF = toF(s.t, fw);
  const E = [-Math.sin(lo), 0, -Math.cos(lo)], N = [-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo)];
  const wr = cross(OMEGA_I, s.r), vg = [s.v[0] - wr[0], s.v[1] - wr[1], s.v[2] - wr[2]];
  return { theta: Math.asin(clamp(dot(fw, U), -1, 1)) / D2R, phi: Math.atan2(-dot(rt, U), dot(up, U)) / D2R,
    hdg: (Math.atan2(dot(fF, E), dot(fF, N)) / D2R + 360) % 360, alt: env.altMSL, vs: dot(vg, U), cth: Math.sqrt(Math.max(0, 1 - dot(fw, U) ** 2)) }; }

export function createAutopilot(J) {
  const T = J.trim, A = J.autopilot, FC = J.fcs, rollTrimMax = T.rollMaxShare * FC.rollRate;
  // pitchSw: PITCH switch 'off' | 'att' | 'alt'; rollSw: ROLL switch 'att' | 'hdg'; ref = references; cssP / cssR = stick steering active
  let pitchSw = 'off', rollSw = 'att', ref = null, iPhi = 0, msg = '', msgT = 0, heldP = 0, heldR = 0, paddle = false, cssP = false, cssR = false, state = 'off';
  const say = m => { msg = m; msgT = 5; };
  // conditions that put the PITCH switch back to A/P OFF (and refuse engagement); ad = { al (deg), M }
  function trip(s, ad, wow) {
    if (wow || s.onGround) return 'on the ground';
    if (s.ctl.gear || s.srf.gear > .05) return 'gear handle down';
    if (ad.al > A.maxAoA) return 'AOA > ' + A.maxAoA + '°';
    if (ad.al > FC.alphaMax + 2) return 'low speed warning';
    if (ad.M > A.maxMach) return 'Mach > ' + A.maxMach;
    if (s.crash) return 'crash';
    return null; }
  const off = (s, why) => { if (pitchSw !== 'off' && why) say('A/P OFF: ' + why); pitchSw = 'off'; ref = null; s.ap = null; };
  function setPitch(s, sw, ad, wow, at) {
    if (sw === 'off') { off(s, 'switch'); return; }
    const why = trip(s, ad, wow); if (why) { if (pitchSw !== 'off') off(s, why); else say('A/P will not engage: ' + why); return; }
    if (pitchSw === 'off') { iPhi = 0; ref = { theta: at.theta, alt: at.alt, phi: at.phi, hdg: bug != null ? bug : at.hdg }; }   // first engagement: all references
    else if (sw !== pitchSw) { ref.theta = at.theta; ref.alt = at.alt; }   // the new pitch mode catches its reference now
    pitchSw = sw; msg = ''; msgT = 0; }
  let bug = null;   // heading bug (deg); null = none set: HDG SEL then holds the heading it was engaged at
  function setRoll(sw, at) { if (sw === rollSw) return; rollSw = sw; if (ref) { ref.phi = at.phi; ref.hdg = bug != null ? bug : at.hdg; iPhi = 0; } }
  function trimStep(s, h, ev) {
    const c = s.ctl, ax = c.trimAx || [0, 0];
    if (pitchSw !== 'off') { heldP = heldR = 0; return; }   // stick trim is inoperative with the autopilot engaged (TO sect. 17.13.1)
    for (const e of ev) {
      if (e === 'BracketRight') c.trim += T.pitchStep; else if (e === 'BracketLeft') c.trim -= T.pitchStep;
      else if (e === 'Quote') c.trimRoll += T.rollStep; else if (e === 'Semicolon') c.trimRoll -= T.rollStep;
      else if (e === 'Backslash') { c.trim = 0; c.trimRoll = 0; } }
    heldP = ax[0] ? heldP + h : 0; heldR = ax[1] ? heldR + h : 0;
    if (heldP > T.holdDelay) c.trim += ax[0] * T.pitchRate * h; if (heldR > T.holdDelay) c.trimRoll += ax[1] * T.rollRate * h;
    c.trim = clamp(c.trim, T.pitchMin, T.pitchMax); c.trimRoll = clamp(c.trimRoll, -rollTrimMax, rollTrimMax); }

  return { name: 'trim + autopilot', step(s, env, h) {
    const c = s.ctl, ev = c.ev ? c.ev.splice(0) : [];
    if (c.trim == null) c.trim = 0; if (c.trimRoll == null) c.trimRoll = 0;
    msgT = Math.max(0, msgT - h);
    const at = attitudeOf(s, env), V = Math.max(env.aero.vTas, 40), ad = { al: env.aero.alpha / D2R, M: env.aero.mach }, wow = s.contact.some(x => x.force > 0);
    for (const e of ev) {
      if (e === 'KeyY') { if (pitchSw === 'off') { setRoll('att', at); setPitch(s, 'att', ad, wow, at); } else if (pitchSw === 'att') setPitch(s, 'alt', ad, wow, at);
        else if (rollSw === 'att') setRoll('hdg', at); else { off(s, 'switch'); setRoll('att', at); } }
      else if (e === 'apAlt') setPitch(s, 'alt', ad, wow, at); else if (e === 'apAtt') setPitch(s, 'att', ad, wow, at); else if (e === 'apOff') setPitch(s, 'off', ad, wow, at);
      else if (e === 'apRollAtt') setRoll('att', at); else if (e === 'apRollHdg') setRoll('hdg', at); else if (e === 'apRollToggle') setRoll(rollSw === 'att' ? 'hdg' : 'att', at); }
    trimStep(s, h, ev);
    state = pitchSw === 'off' ? 'off' : 'on';
    if (pitchSw === 'off') { s.ap = null; paddle = !!c.paddle; return; }
    const why = trip(s, ad, wow); if (why) { off(s, why); state = 'off'; return; }
    // paddle switch: interrupts the A/P while held; on release the attitude / altitude references are taken anew (heading: the bug stays)
    if (c.paddle) { paddle = true; s.ap = null; state = 'paddle'; return; }
    if (paddle) { paddle = false; ref.theta = at.theta; ref.alt = at.alt; ref.phi = at.phi; iPhi = 0; }
    // stick steering (ATT HOLD axes only): a stick force beyond the threshold drops the reference, the stick flies; released -> new reference
    const sp = Math.abs(c.pitch) > A.stickSteer, sr = Math.abs(c.roll) > A.stickSteer;
    if (pitchSw === 'att') { if (sp) cssP = true; else if (cssP) { cssP = false; ref.theta = at.theta; } } else cssP = false;
    if (rollSw === 'att') { if (sr) cssR = true; else if (cssR) { cssR = false; ref.phi = at.phi; iPhi = 0; } } else cssR = false;
    // the modes do not work beyond +-60 deg pitch / bank (the switch stays engaged; they resume inside the limits)
    const pOk = Math.abs(at.theta) <= A.maxPitch, rOk = Math.abs(at.phi) <= A.maxRoll;
    // pitch: a load-factor command; ref g = cos(theta) / cos(phi) holds the flight path (the FLCS's own neutral in this model)
    const nRef = at.cth / Math.max(.5, Math.cos(at.phi * D2R));
    let nz = null;
    if (pOk && rOk && !cssP) {
      if (pitchSw === 'att') nz = clamp(nRef + V / G0 * (ref.theta - at.theta) * D2R / A.tauTheta, A.attNz[0], A.attNz[1]);
      else { const vsMax = A.vsMaxFpm * FT / 60, vsC = clamp((ref.alt - at.alt) / A.tauH, -vsMax, vsMax);
        nz = clamp(nRef + (vsC - at.vs) / (G0 * A.tauVs), A.altNz[0], A.altNz[1]); } }
    // roll: a roll-rate command from the bank error (PI, integral only near the aim); HDG SEL: bank from the heading error, <= 30 deg, <= 20 deg/s
    let p = null;
    if (rOk && !cssR) { const hdgM = rollSw === 'hdg', phiC = hdgM ? clamp(A.kHdg * wrap(ref.hdg - at.hdg), -A.hdgBank, A.hdgBank) : ref.phi, e = phiC - at.phi;
      iPhi = Math.abs(e) < 3 ? clamp(iPhi + e * h, -20, 20) : iPhi;
      p = clamp(e / A.tauPhi + A.kiPhi * iPhi, -A.pMax, A.pMax); }
    s.ap = nz == null && p == null ? null : { nz, p };
    if (!pOk || !rOk) state = 'limit'; },
  hud(s, env, hud) { const on = pitchSw !== 'off';
    Object.assign(hud, { ap: on ? 'A/P ' + TEXT[pitchSw] + RTEXT[rollSw] + (state === 'paddle' ? ' (PADDLE)' : state === 'limit' ? ' (OUT OF LIMITS)' : cssP || cssR ? ' (STICK)' : '') : null,
      apMode: { pitch: pitchSw, roll: rollSw, state }, apRef: ref ? { ...ref } : null, apMsg: msgT > 0 ? msg : '', trim: s.ctl.trim || 0, trimRoll: s.ctl.trimRoll || 0 }); },
  reset(s) { pitchSw = 'off'; rollSw = 'att'; ref = null; iPhi = 0; msg = ''; msgT = 0; heldP = heldR = 0; paddle = cssP = cssR = false; bug = null; s.ap = null; s.ctl.trim = 0; s.ctl.trimRoll = 0; },
  setHeading(deg) { bug = ((deg % 360) + 360) % 360; if (ref) ref.hdg = bug; },   // the heading bug (an HSI HDG knob can drive it later)
  get bug() { return bug; },
  get mode() { return pitchSw === 'off' ? 'off' : pitchSw + '/' + rollSw; } };
}
