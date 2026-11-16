/* HOTAS input (docs/flight-notes/f16-hotas.md): Thrustmaster HOTAS Warthog stick + throttle and Thrustmaster pedals through the
   Gamepad API, mapped like the user's DCS F-16C profile (GreaseLitenin v8.3 sheet + the user's DCS *.diff.lua bindings, 17 Aug 2025;
   `py -3 tools/hotas_from_dcs.py` prints them). Own code.
   - Devices are found by gamepad.id (USB vendor / product, or the name); with none of them connected nothing here runs and core.js
     keeps keyboard + standard gamepad as before.
   - Axes -> pitch / roll / yaw / throttle / wheel brake (returned to core.js createInput).
   - Buttons act like the keyboard: a synthetic keydown / keyup on window with the same KeyboardEvent.code (one path for core.js and
     every module that listens to keys); a few switches set s.ctl fields (speed brake, landing lights, paddle) or return named
     events (autopilot switch positions 'apAlt' / 'apAtt' / 'apOff' / 'apRollHdg' / 'apRollAtt', read by flight/autopilot.js).
   - Button numbers below = DirectInput / DCS numbers (JOY_BTNn); the Gamepad API index is n - 1 (Chrome / Edge on Windows).
   - Axis indices: Chrome / Edge put a HID axis at index (usage - 0x30): X 0, Y 1, Z 2, Rx 3, Ry 4, Rz 5, Slider 6, hat switch 9
     (hat as one axis: -1 + 2 * dir / 7, dir 0 = up ... 7 = up-left, anything else = centred). Firefox orders axes differently: not
     checked. The user can correct any index / invert in localStorage `aurora.hotas` (see readOverride); hotasCheck() in the
     console prints what the browser sends. */

const TM = '044f';   // Thrustmaster USB vendor id
// DCS axis filter (deadzone, saturation, curvature): DCS does not publish its curve formula; we use a cubic blend with the same end
// points (y = (1 - c) x + c x^3: c > 0 softer around the centre, c < 0 sharper) -> an estimate of the DCS shape, not a copy of it.
const shape = (x, f = {}) => { const s = Math.sign(x), a = Math.abs(x), dz = f.dz || 0; let u = a <= dz ? 0 : (a - dz) / (1 - dz);
  u = Math.min(1, u / (f.satX || 1)); const c = f.curve || 0; return s * ((1 - c) * u + c * u * u * u); };
// DCS user curve: points at input 0, .1, ... 1 (linear between), input scaled by saturation X first
const userCurve = (x, pts, satX = 1) => { const u = Math.min(1, Math.max(0, x / satX)) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(u));
  return pts[i] + (pts[i + 1] - pts[i]) * (u - i); };

// ── devices + axes (DCS source in the comments: device file / command / key / filter)
export const DEVICES = {
  stick: { name: 'HOTAS Warthog stick', vid: TM, pid: '0402', re: /joystick\s*-\s*hotas warthog/i, hat: 9,
    // Roll JOY_X: deadzone 0.05, curvature 0.17; Pitch JOY_Y: deadzone 0.05, curvature 0.23 (stick file, axisDiffs "Roll" / "Pitch")
    axes: { roll: { i: 0, dz: .05, curve: .17 }, pitch: { i: 1, dz: .05, curve: .23 } } },
  throttle: { name: 'HOTAS Warthog throttle', vid: TM, pid: '0404', re: /throttle\s*-\s*hotas warthog/i, hat: 9, mod: 1,
    // Thrust on JOY_Z (right lever) and JOY_RZ (left lever): slider, saturation X 0.98, user curve 0 .05 .11 .25 .35 .42 .49 .56 .64 .75 1
    // (throttle file, axisDiffs "Thrust"). The curve puts the lever's AB detent near our MIL (throttle 0.77, aero.js tgear).
    // Raw -1 = lever fully forward (estimate from the usual DirectInput sense of the Warthog levers: check with hotasCheck()).
    axes: { thr: { i: [2, 5], satX: .98, pts: [0, .05, .11, .25, .35, .42, .49, .56, .64, .75, 1], fwdNeg: true },
      // ANT ELEV: not in the user's DCS profile (there JOY_SLIDER1 = HMCS intensity, no HMCS here). Our choice: the slider (friction
      // lever) = radar antenna elevation +-deg, sent only when it moves (radar.js setElev; auto elevation until then). Sense: estimate.
      antElev: { i: 6, deg: 30, invert: false } } },
  // pedals: one of these. T-Pedals (USB 044f:b678) is the user's set in DCS: Rudder = JOY_RZ (invert) + JOY_SLIDER1, Wheel Brake = JOY_Z
  // (T-Pedals file, axisDiffs "Rudder" / "Wheel Brake"): two pedals for the rudder halves and one for both wheel brakes. Which of Rz / Slider
  // is the right pedal is NOT known (guess: Rz right): check with hotasCheck() and swap in `aurora.hotas` if needed.
  pedals: { name: 'T-Pedals', vid: TM, pid: 'b678', re: /^t-pedals|[^.]t-pedals/i,
    axes: { right: { i: 5 }, left: { i: 6 }, brake: { i: 2 }, rudder: { dz: .05, curve: -.26 } } },
  // other Thrustmaster rudders the PC has known (not in the user's DCS profile; usual axes: X / Y toe brakes, Rz rudder; unverified)
  tfrp: { name: 'T.Flight Rudder Pedals', vid: TM, pid: 'b679', re: /t-rudder|t\.flight rudder/i, role: 'pedals',
    axes: { rudder: { i: 5, dz: .05, curve: -.26 }, toeL: { i: 0 }, toeR: { i: 1 } } },
  tpr: { name: 'T.Pendular Rudder', vid: TM, pid: 'b68f', re: /pendular/i, role: 'pedals',
    axes: { rudder: { i: 5, dz: .05, curve: -.26 }, toeL: { i: 0 }, toeR: { i: 1 } } } };

// ── buttons -> keys (key codes of the flight mode; most come from the parallel F-16 sessions). mod: 1 = with the MODIFIER held
// (throttle button 1, slew push: DCS modifiers.lua "JOY_BTN1"), 0 = without it. press = one key press, hold = key down while held.
export const BINDS = [
  { dev: 'stick', btn: 6, mod: 0, hold: 'Space', dcs: 'CAMERA/GUN Trigger - SECOND DETENT', what: 'gun trigger' },
  { dev: 'stick', btn: 4, mod: 1, hold: 'KeyB', dcs: 'Wheel Brake - ON/OFF (+ modifier)', what: 'wheel brakes' },
  { dev: 'stick', hat: 'U', mod: 0, hold: 'BracketLeft', dcs: 'TRIM Button - NOSE DOWN', what: 'pitch trim nose down' },
  { dev: 'stick', hat: 'D', mod: 0, hold: 'BracketRight', dcs: 'TRIM Button - NOSE UP', what: 'pitch trim nose up' },
  { dev: 'stick', hat: 'L', mod: 0, hold: 'Semicolon', dcs: 'TRIM Button - LEFT WING DOWN', what: 'roll trim left wing down' },
  { dev: 'stick', hat: 'R', mod: 0, hold: 'Quote', dcs: 'TRIM Button - RIGHT WING DOWN', what: 'roll trim right wing down' },
  { dev: 'stick', hat: 'U', mod: 1, press: 'Digit1', dcs: 'F1 Cockpit view (+ modifier)', what: 'cockpit view' },
  { dev: 'stick', hat: 'D', mod: 1, press: 'Digit2', dcs: 'F2 Aircraft view (+ modifier)', what: 'outside view (chase)' },
  // weapons plug-ins (weapons/radar.js, missiles.js own these keys): TMS up = lock / next target, TMS down = drop the lock (Dash-1 / DCS
  // F-16 guide: TMS up designates, TMS down returns), WPN REL (pickle) = missile launch; the trigger stays the gun
  { dev: 'stick', btn: 7, mod: 0, press: 'Tab', dcs: 'Target Management Switch - Up', what: 'radar: lock / next target' },
  { dev: 'stick', btn: 9, mod: 0, press: 'Backspace', dcs: 'Target Management Switch - Down', what: 'radar: drop the lock' },
  { dev: 'stick', btn: 2, mod: 0, press: 'Enter', dcs: 'WPN REL Button - Depress', what: 'launch the selected missile' },
  { dev: 'throttle', btn: 21, mod: 0, press: 'KeyG', dcs: 'LG Handle - UP/DN', what: 'gear up / down' },
  { dev: 'throttle', btn: 26, mod: 0, press: 'Digit0', dcs: 'EMER STORES JETTISON Button', what: 'jettison (press twice, as the key)' }];
// switches with code below (button numbers here, the DCS lines in docs/flight-notes/f16-hotas.md)
export const SWITCHES = {
  speedbrake: { dev: 'throttle', fwd: 7, aft: 8 },          // SPD BRK Switch - Fwd/RETRACT, Aft/EXTEND (Momentary), OFF
  lights: { dev: 'throttle', fwd: 13, aft: 14 },            // LANDING TAXI LIGHTS Switch - LANDING / OFF / TAXI (pinky)
  apPitch: { dev: 'throttle', up: 11, dn: 12 },             // Autopilot PITCH Switch - Up (ALT HOLD) / centre (A/P OFF) / Down (ATT HOLD)
  apRoll: { dev: 'throttle', up: 22, dn: 23 },              // Autopilot ROLL Switch - HDG SEL / ATT HOLD / STRG SEL
  paddle: { dev: 'stick', btn: 4 },                         // Paddle Switch - Depress ("PADDLE (INTERRUPT A/P)" on the sheet)
  masterArm: { dev: 'throttle', on: 16 },                   // MASTER ARM Switch - MASTER ARM / OFF (with modifier: SIMULATE = off here)
  dogfight: { dev: 'throttle', mrm: 9, dgft: 10 } };        // DOGFIGHT/Missile Override Switch - MISSILE OVERRIDE / DOGFIGHT / CENTER

// the weapons (flight/session.js builds them after the input): S = the flight session, given by hotasLink(S) (or window.__fly.S on
// fly.html); read at each use. -> { bus (Wp.bus), radar, missiles } or null
let linkS = null;
export function hotasLink(S) { linkS = S; }
function weaponsOf() { const S = linkS || (typeof window !== 'undefined' && window.__fly && window.__fly.S) || null;
  const bus = S && S.wpn && S.wpn.weapons && S.wpn.weapons.bus; if (!bus) return null;
  const L = (S.plugins && S.plugins.list) || {}; return { bus, radar: L.radar || null, missiles: L.missiles || null }; }
// DOGFIGHT / MISSILE OVERRIDE (TO 1F-16CM-1: override modes; DCS F-16 guide): DGFT = radar ACM + AIM-9 (gun on the trigger as always),
// MRM = radar CRM RWS + AIM-120; centre = back to the radar mode and weapon in use before the override
function override(pos, W, save) { const bus = W.bus, rad = W.radar, has = k => !bus.pick || bus.pick(k) > 0;
  if (pos === 'CTR') { if (save.v) { if (rad && rad.setMode) rad.setMode(save.v.mode); bus.sel = save.v.sel; save.v = null; } return; }
  if (!save.v) save.v = { mode: bus.mode, sel: bus.sel };
  if (pos === 'DGFT') { if (rad && rad.setMode) rad.setMode('ACM'); bus.sel = has('AIM-9') ? 'AIM-9' : 'GUN'; }
  else { if (rad && rad.setMode) rad.setMode('RWS'); bus.sel = has('AIM-120') ? 'AIM-120' : has('AIM-9') ? 'AIM-9' : bus.sel; } }

// user corrections, localStorage `aurora.hotas` = JSON, e.g. {"pedals": {"axes": {"right": {"i": 6}, "left": {"i": 5}}}, "throttle": {"axes": {"thr": {"fwdNeg": false}}},
// "binds": [{"dev": "throttle", "btn": 29, "mod": 0, "press": "KeyN"}]}: device entries are merged per axis, binds are added
function readOverride() { try { return JSON.parse(localStorage.getItem('aurora.hotas') || 'null') || {}; } catch (e) { return {}; } }
function config() { const o = readOverride(), dev = {};
  for (const [k, d] of Object.entries(DEVICES)) { const od = o[k] || {}, axes = {};
    for (const [a, v] of Object.entries(d.axes)) axes[a] = { ...v, ...((od.axes || {})[a] || {}) };
    dev[k] = { ...d, ...od, axes }; }
  return { dev, binds: BINDS.concat(Array.isArray(o.binds) ? o.binds : []) }; }

// vendor / product from the id: Chrome "Name (Vendor: 044f Product: 0402)", Firefox "44f-402-Name"
export function usbOf(id) { let m = /vendor:\s*([0-9a-f]{1,4})\s+product:\s*([0-9a-f]{1,4})/i.exec(id) || /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
  return m ? { vid: m[1].toLowerCase().padStart(4, '0'), pid: m[2].toLowerCase().padStart(4, '0') } : null; }
export function classify(gp, dev = DEVICES) { if (!gp || !gp.id) return null; const u = usbOf(gp.id);
  for (const [k, d] of Object.entries(dev)) if (u ? u.vid === d.vid && u.pid === d.pid : d.re.test(gp.id)) return k;
  return null; }
const roleOf = (k, dev) => dev[k].role || k;
const HAT = ['U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL'];
export function hatOf(v) { if (v == null || !isFinite(v)) return null; const x = (v + 1) * 3.5, d = Math.round(x);
  return d >= 0 && d <= 7 && Math.abs(x - d) < .2 ? HAT[d] : null; }
const KEYCH = { Space: ' ', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\', Equal: '=', Comma: ',', Period: '.' };
const keyOf = c => KEYCH[c] || (c.startsWith('Key') ? c.slice(3).toLowerCase() : c.startsWith('Digit') ? c.slice(5) : c);
function send(type, code) { try { window.dispatchEvent(new KeyboardEvent(type, { code, key: keyOf(code), bubbles: true, cancelable: true })); } catch (e) { } }

// ── the poller (one per core); poll() runs inside core.js input.update before the key events are read
export function createHotas() {
  let cfg = config(), seen = '', prev = {}, held = new Set(), thrLast = null, thrIdx = 0, thrRaw = null, rest = {};
  // weapons switches wait here until the plug-ins exist: dg = { want, done } override position, el = { last raw, want deg, done }
  let dg = { want: null, done: null }, el = { last: null, want: null, done: null }; const ovSave = { v: null };
  const bindOn = new Map();   // bind -> active at the last poll
  const pads = () => { try { return navigator.getGamepads ? [...navigator.getGamepads()].filter(g => g && g.connected) : []; } catch (e) { return []; } };
  const found = () => { const out = {}; for (const g of pads()) { const k = classify(g, cfg.dev); if (k && !out[roleOf(k, cfg.dev)]) out[roleOf(k, cfg.dev)] = { k, g }; } return out; };
  const press = c => { send('keydown', c); send('keyup', c); };
  const setHeld = (c, on) => { if (on && !held.has(c)) { held.add(c); send('keydown', c); } else if (!on && held.has(c)) { held.delete(c); send('keyup', c); } };
  const releaseAll = () => { for (const c of [...held]) setHeld(c, false); };
  return {
    owns(g) { return !!classify(g, cfg.dev); },
    // ctl = s.ctl; keysOn = the F-16's keys may be sent (piloting it); craft = s (read only: s.wpn.arm). -> null (no HOTAS) or
    // { pitch, roll, yaw, throttle (null = lever not moved), brake, ev (named one-shot events), names }
    poll(ctl, keysOn, craft) {
      const F = found(), sig = Object.values(F).map(x => x.k + ':' + x.g.index).sort().join(',');
      if (sig !== seen) { releaseAll(); cfg = config(); prev = {}; bindOn.clear(); thrLast = null; thrRaw = null; thrIdx = 0; rest = {}; seen = sig;
        dg = { want: null, done: null }; el = { last: null, want: null, done: null }; }   // (re)connected: start over (an override in use stays saved)
      if (!sig) return null;
      const r = { pitch: 0, roll: 0, yaw: 0, throttle: null, brake: 0, ev: [], names: Object.values(F).map(x => cfg.dev[x.k].name) };
      const S = F.stick && F.stick.g, T = F.throttle && F.throttle.g, P = F.pedals, ax = (g, i) => g && g.axes[i] != null && isFinite(g.axes[i]) ? g.axes[i] : 0;
      if (S) { const A = cfg.dev.stick.axes; r.roll = shape(ax(S, A.roll.i), A.roll) * (A.roll.invert ? -1 : 1); r.pitch = shape(ax(S, A.pitch.i), A.pitch) * (A.pitch.invert ? -1 : 1); }
      if (T) { const A = cfg.dev.throttle.axes.thr, ii = [].concat(A.i), raws = ii.map(i => ax(T, i));
        // two levers on one command (as DCS binds both): the lever that moved last drives it
        if (thrRaw) raws.forEach((v, j) => { if (Math.abs(v - thrRaw[j]) > .004) thrIdx = j; }); thrRaw = raws;
        const pos = (A.fwdNeg ? 1 - raws[thrIdx] : 1 + raws[thrIdx]) / 2, v = userCurve(pos, A.pts, A.satX);
        if (thrLast == null || Math.abs(v - thrLast) > .004) { r.throttle = Math.max(0, Math.min(1, v)); thrLast = v; } }   // only when the lever moved: R / F keys still work
      if (P) { const A = cfg.dev[P.k].axes, g = P.g;
        // a pedal axis: 0 released .. 1 pressed; the released end = the end nearest the first reading (pedals rest at load), or A.x.rest
        const ped = (n) => { const a = A[n]; if (!a || a.i == null) return 0; const v = ax(g, a.i); if (rest[n] == null) rest[n] = a.rest != null ? a.rest : v >= 0 ? 1 : -1;
          return Math.max(0, Math.min(1, Math.abs(v - rest[n]) / 2)); };
        if (A.right) r.yaw = shape(ped('right') - ped('left'), A.rudder); else r.yaw = shape(ax(g, A.rudder.i), A.rudder) * (A.rudder.invert ? -1 : 1);
        r.brake = Math.max(ped('brake'), ped('toeL'), ped('toeR')); }
      // buttons: states this poll vs. the last one
      const st = {}; for (const [role, x] of Object.entries(F)) st[role] = { b: x.g.buttons.map(q => !!(q && q.pressed)), hat: cfg.dev[x.k].hat != null ? hatOf(x.g.axes[cfg.dev[x.k].hat]) : null };
      const B = (dev, n) => !!(st[dev] && st[dev].b[n - 1]), Bp = (dev, n) => !!(prev[dev] && prev[dev].b[n - 1]), first = !prev.done;
      const mod = B('throttle', cfg.dev.throttle.mod || 1), hatNow = dev => st[dev] && st[dev].hat;
      const active = bd => { if (!st[bd.dev] || !!bd.mod !== mod) return false; return bd.hat ? hatNow(bd.dev) === bd.hat : B(bd.dev, bd.btn); };
      const tb = n => B('throttle', n), tp = n => Bp('throttle', n), chg = n => first || tb(n) !== tp(n);
      if (keysOn && ctl) {
        for (const bd of cfg.binds) { const on = active(bd);
          if (bd.hold) setHeld(bd.hold, on);
          if (bd.press && on && !bindOn.get(bd) && !first) press(bd.press);
          bindOn.set(bd, on); }
        if (st.throttle) {
          // speed brake: aft = extend while held (past the 43 deg gear-down limit too), fwd = retract, centre = stays (aero.js, ctl.sbSw)
          const sw = SWITCHES.speedbrake; if (!mod && (chg(sw.fwd) || chg(sw.aft))) { const k = tb(sw.aft) ? 1 : tb(sw.fwd) ? -1 : 0; ctl.sbSw = k; if (k) ctl.speedbrake = k > 0 ? 1 : 0; }
          // landing / taxi lights (pinky): ctl.lights (auto / off / taxi / land, key T); at connect only LAND / TAXI are taken over (the
          // centre keeps our default 'auto'), after that every change, centre = OFF as on the real switch
          const L = SWITCHES.lights; if ('lights' in ctl && (first ? tb(L.fwd) || tb(L.aft) : tb(L.fwd) !== tp(L.fwd) || tb(L.aft) !== tp(L.aft))) ctl.lights = tb(L.fwd) ? 'land' : tb(L.aft) ? 'taxi' : 'off';
          // master arm: the key 7 toggles (weapons/fx.js). At connect and on each switch change, 7 is sent only if the weapons state
          // (craft.wpn.arm, gun session) differs from the switch; without that state: on each change (+ at connect if at ARM; starts SAFE)
          const M = SWITCHES.masterArm, wantArm = tb(M.on), wpn = craft && craft.wpn;
          if (first || wantArm !== tp(M.on)) { if (wpn && 'arm' in wpn) { if (!!wpn.arm !== wantArm) press('Digit7'); } else if (!first || wantArm) press('Digit7'); }
          // autopilot switch positions as events for flight/autopilot.js (trim + autopilot session): PITCH on a change only (its
          // solenoid holds it only in flight), ROLL also at connect (STRG SEL is not modelled there: sent as ATT HOLD)
          const ap = SWITCHES.apPitch, ar = SWITCHES.apRoll;
          if (!first && (tb(ap.up) !== tp(ap.up) || tb(ap.dn) !== tp(ap.dn))) r.ev.push(tb(ap.up) ? 'apAlt' : tb(ap.dn) ? 'apAtt' : 'apOff');
          if (chg(ar.up) || chg(ar.dn)) r.ev.push(tb(ar.up) ? 'apRollHdg' : 'apRollAtt');
          // DOGFIGHT / MISSILE OVERRIDE: a position (with or without MOD: no MOD binding in DCS); at connect only DGFT / MRM count
          const D = SWITCHES.dogfight, dp = tb(D.dgft) ? 'DGFT' : tb(D.mrm) ? 'MRM' : 'CTR';
          if (chg(D.dgft) || chg(D.mrm)) { if (!(first && dp === 'CTR')) dg.want = dp; }
          // ANT ELEV (slider): only when it moved (> 2 % of its travel) since the first reading
          const AE = cfg.dev.throttle.axes.antElev;
          if (AE && AE.i != null) { const v = ax(T, AE.i); if (el.last == null) el.last = v;
            else if (Math.abs(v - el.last) > .02) { el.last = v; const d = -v * (AE.deg || 30) * (AE.invert ? -1 : 1); el.want = Math.round((Math.abs(d) < 1 ? 0 : d) * 10) / 10; } } }
        // apply to the plug-ins once they exist (radar.setMode / bus.sel / radar.setElev)
        if (dg.want !== dg.done || (el.want != null && el.want !== el.done)) { const W = weaponsOf();
          if (W) { if (dg.want !== dg.done) { override(dg.want, W, ovSave); dg.done = dg.want; }
            if (el.want != null && el.want !== el.done && W.radar && W.radar.setElev) { W.radar.setElev(el.want); el.done = el.want; } } }
        // paddle: interrupts the autopilot while held (autopilot.js reads ctl.paddle; TO 1F-16CM-1 17.13)
        if (st.stick) ctl.paddle = B('stick', SWITCHES.paddle.btn) && !mod; }
      else { releaseAll(); return r; }   // not flying the F-16: no keys; the last states stay, so changes meanwhile count once keys are on again
      st.done = true; prev = st; return r; },
    dispose() { releaseAll(); } };
}

// ── check on the user's hardware (browser console on fly.html; Chrome shows a pad only after one of its buttons was pressed once):
//   hotasCheck()      one snapshot: every pad, what we take it for, raw axes (index: value), pressed buttons as DX numbers (= DCS JOY_BTNn), hat
//   hotasWatch(30)    for 30 s, prints every button / hat change and every axis move > 0.05 (move one control at a time)
export function hotasReport() { const cfg = config(), rows = [];
  for (const g of (navigator.getGamepads ? [...navigator.getGamepads()] : [])) { if (!g) continue; const k = classify(g, cfg.dev), d = k && cfg.dev[k];
    rows.push({ index: g.index, id: g.id, mapping: g.mapping || '(none)', is: d ? d.name : 'not a HOTAS device (standard gamepad path)', usb: usbOf(g.id),
      axes: g.axes.map((v, i) => i + ': ' + v.toFixed(3)).join('  '), buttonsDX: g.buttons.map((b, i) => b.pressed ? i + 1 : 0).filter(Boolean).join(' ') || '-',
      hat: d && d.hat != null ? hatOf(g.axes[d.hat]) || 'centre' : '' }); }
  return rows; }
if (typeof window !== 'undefined') {
  window.hotasCheck = () => { const r = hotasReport(); if (!r.length) console.log('No gamepad seen yet: press any button on each device, then run hotasCheck() again.'); else console.table(r); return r; };
  window.hotasWatch = (sec = 30) => { let last = null; const t0 = performance.now(), id = setInterval(() => {
    const now = (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter(Boolean).map(g => ({ i: g.index, id: g.id, a: g.axes.slice(), b: g.buttons.map(b => b.pressed) }));
    if (last) for (const g of now) { const p = last.find(x => x.i === g.i); if (!p) { console.log('connected', g.i, g.id); continue; }
      g.b.forEach((v, j) => { if (v !== p.b[j]) console.log(`${g.id}: button DX ${j + 1} ${v ? 'pressed' : 'released'}`); });
      g.a.forEach((v, j) => { if (Math.abs(v - p.a[j]) > .05) { console.log(`${g.id}: axis ${j} = ${v.toFixed(3)}${hatOf(v) ? ' (hat ' + hatOf(v) + ')' : ''}`); } else g.a[j] = p.a[j]; }); }
    last = now; if (performance.now() - t0 > sec * 1e3) { clearInterval(id); console.log('hotasWatch: done'); } }, 50); return 'watching for ' + sec + ' s'; };
}
