/* F-16 cockpit, the other panels (docs/flight-plan.md, step S4b): ICP, RWR scope, threat-warning prime, MISC / armament column, standby ADI,
   standby compass, pilot fault list, caution light panel, hydraulic pressure, instrument mode, fuel quantity select, landing-gear panel, CMDS.
   Drawn here from scratch on canvas (own shapes, own fonts); layout and legends follow public descriptions of the F-16C Block 50/52 cockpit.
   Nothing is traced or copied from any drawing. Places: ray casts into the scan + RANSAC plane fits (plan, S4b).
   Cost: every panel is drawn once; the standby compass card and the hydraulic needles move as meshes / texture offsets; the caution panel and
   the fault list redraw only when their lit set changes (checked at 2 Hz). Values the flight model does not have (hydraulic pressure, chaff /
   flare counts, threat warnings) are ESTIMATES or fixed, as noted below. */
import { D2R, clamp, FONT, MONO, canvas, fmt } from './draw.js?v=c3b9eb1c';

// faces (craft frame, m): c = centre, n = normal towards the pilot, w / h = size, off = offset along n
export const PANELS = {
  icp: { c: [0.0043, 1.1055, -5.2316], n: [0.028, 0.027, 0.999], w: .1435, h: .1137, off: .016 },   /* above the scan's round knobs */
  rwr: { c: [-0.1468, 1.0267, -5.4818], n: [-0.006, 0.262, 0.965], w: .069, h: .0815, off: .003 },
  twp: { c: [-0.2166, 1.0269, -5.4725], n: [-0.009, 0.266, 0.964], w: .0581, h: .0636, off: .003 },
  misc: { c: [-0.2834, 0.9132, -5.3821], n: [0.015, 0.263, 0.965], w: .0493, h: .1854, off: .0056 },
  adiB: { c: [0.1514, 1.0211, -5.4677], n: [0.04, 0.36, 0.932], w: .0463, h: .0433, off: .0034 },
  compass: { c: [0.2969, 0.7763, -5.3304], n: [0.041, -0.086, 0.995], w: .0461, h: .0429, off: .0074 },
  pfl: { c: [0.3239, 0.728, -5.3079], n: [-0.131, 0.704, 0.698], w: .0666, h: .0313, off: .0032 },
  caut: { c: [0.334, 0.684, -5.2558], n: [-0.127, 0.75, 0.648], w: .0883, h: .0716, off: .0013 },
  hyd: { c: [0.4144, 0.7313, -5.3047], n: [-0.164, 0.659, 0.734], w: .0338, h: .0434, off: .0025 },
  instr: { c: [-0.0679, 0.7276, -5.295], n: [0.001, 0.753, 0.658], w: .0425, h: .0641, off: .0016 },
  fqs: { c: [0.0574, 0.7541, -5.3285], n: [-0.084, 0.789, 0.608], w: .0379, h: .0601, off: .0136 },
  gearP: { c: [-0.3622, 0.7645, -5.2884], n: [0.135, 0.661, 0.738], w: .1019, h: .0682, off: .004 },
  cmds: { c: [-0.3499, 0.6628, -5.1987], n: [0.136, 0.679, 0.721], w: .1187, h: .0715, off: .004 },
  // side consoles: one face each over the flat part (scan points within 4 mm of the plane, 1-99 % extent); 22 mm up, above most of the scan's knobs
  conL: { c: [-0.367, 0.555, -4.894], n: [0.158, 0.984, 0.083], w: .18, h: .44, off: .022 },
  conR: { c: [0.3664, 0.548, -4.898], n: [-0.21, 0.974, 0.081], w: .184, h: .40, off: .022 },
};

// side console panels: [title, x0, y0, x1, y1 (fractions of the console width; y from the front), items]; items in the panel's own 0-1 box:
// ['k', x, y, labels...] knob, ['s', x, y, up, down] toggle, ['l', x, y, text] lamp, ['d', x, y, text] display, ['b', x, y, text] button
const CON = {
  conL: [
    ['MAN PITCH', 0, 0, .32, .32, [['s', .5, .55, 'OVRD', 'NORM']]],
    ['UHF', .32, 0, 1, .32, [['d', .5, .25, '305.00'], ['k', .18, .68, 'OFF', 'MAIN', 'BOTH', 'ADF'], ['k', .5, .68, 'MNL', 'PRESET', 'GRD'], ['k', .82, .68, 'VOL']]],
    ['ENG & JET START', 0, .32, .32, .98, [['s', .5, .2, 'START 1', 'START 2'], ['s', .5, .45, 'PRI', 'SEC'], ['s', .5, .7, 'MAX PWR', 'OFF'], ['b', .5, .9, 'AB RESET']]],
    ['AUDIO 1', .32, .32, 1, .52, [['k', .2, .55, 'COMM 1'], ['k', .45, .55, 'COMM 2'], ['k', .7, .55, 'MSL'], ['k', .9, .55, 'TF']]],
    ['AUDIO 2', .32, .52, 1, .66, [['k', .25, .55, 'TACAN'], ['k', .55, .55, 'ILS'], ['k', .82, .55, 'ICS']]],
    ['ECM', .32, .66, 1, .98, [['l', .25, .4, 'ECM|ON'], ['l', .5, .4, 'XMIT'], ['l', .75, .4, 'FAIL'], ['s', .3, .78, 'OPR', 'STBY'], ['s', .7, .78, 'XMIT', 'OFF']]],
    ['EPU', 0, .98, .32, 1.3, [['l', .3, .3, 'HYDRAZN'], ['l', .7, .3, 'AIR'], ['s', .5, .72, 'ON', 'OFF']]],
    ['ELEC', .32, .98, 1, 1.3, [['s', .15, .55, 'MAIN PWR', 'OFF'], ['l', .38, .3, 'FLCS|PMG'], ['l', .58, .3, 'MAIN|GEN'], ['l', .78, .3, 'STBY|GEN'], ['l', .38, .66, 'EPU|GEN'], ['l', .58, .66, 'EPU|PMG'], ['l', .78, .66, 'TO|FLCS'], ['b', .92, .88, 'RESET']]],
    ['FUEL', 0, 1.3, .32, 1.78, [['s', .5, .2, 'MASTER', 'OFF'], ['s', .5, .45, 'TANK|INERT', 'OFF'], ['k', .5, .74, 'OFF', 'NORM', 'AFT', 'FWD']]],
    ['IFF', .32, 1.3, .6, 1.78, [['k', .5, .2, 'MASTER'], ['s', .5, .48, 'M4', 'OFF'], ['d', .5, .76, '1234']]],
    ['MANUAL TRIM', .6, 1.3, 1, 1.78, [['k', .3, .32, 'ROLL'], ['k', .72, .32, 'PITCH'], ['k', .5, .7, 'YAW'], ['s', .86, .8, 'TRIM', 'DISC']]],
    ['FLCS', 0, 1.78, .5, 2.15, [['s', .2, .45, 'DIGITAL|BACKUP', 'OFF'], ['s', .5, .45, 'ALT FLAPS', 'NORM'], ['s', .8, .45, 'LE FLAPS|LOCK', 'AUTO'], ['b', .5, .85, 'BIT']]],
    ['EXT LIGHTING', .5, 1.78, 1, 2.15, [['k', .2, .4, 'ANTI-COLL'], ['s', .45, .45, 'FLASH', 'STEADY'], ['s', .65, .45, 'BRT', 'DIM'], ['k', .85, .4, 'FORM'], ['s', .5, .85, 'MASTER', 'OFF']]],
    ['TEST', 0, 2.15, .6, 2.44, [['s', .15, .5, 'FIRE &|OHEAT', ''], ['s', .38, .5, 'OXY QTY', ''], ['s', .6, .5, 'MAL &|IND LTS', ''], ['s', .84, .5, 'PROBE|HEAT', 'OFF']]],
    ['ANTI-G', .6, 2.15, 1, 2.44, [['b', .5, .55, 'TEST']]]],
  conR: [
    ['SNSR PWR', 0, 0, 1, .2, [['s', .15, .6, 'LEFT HDPT', 'OFF'], ['s', .38, .6, 'RIGHT HDPT', 'OFF'], ['s', .62, .6, 'FCR', 'OFF'], ['s', .85, .6, 'RDR ALT', 'OFF']]],
    ['HUD', 0, .2, 1, .62, [['s', .14, .3, 'SCALES', 'OFF'], ['s', .38, .3, 'FPM', 'OFF'], ['s', .62, .3, 'DED DATA', 'OFF'], ['s', .86, .3, 'DEPR RET', 'OFF'],
      ['s', .14, .75, 'CAS', 'GND SPD'], ['s', .38, .75, 'RDR', 'BARO'], ['s', .62, .75, 'DAY', 'NIGHT'], ['s', .86, .75, 'TEST', 'OFF']]],
    ['INTERIOR LIGHTS', 0, .62, 1, 1.02, [['k', .15, .35, 'PRI CONSL'], ['k', .4, .35, 'PRI INST'], ['k', .65, .35, 'FLOOD CONSL'], ['k', .88, .35, 'FLOOD INST'], ['s', .5, .8, 'MAL & IND|BRT', 'DIM']]],
    ['AIR COND', 0, 1.02, 1, 1.27, [['k', .3, .55, 'TEMP'], ['k', .7, .55, 'OFF', 'NORM', 'DUMP', 'RAM']]],
    ['ZEROIZE', 0, 1.27, .45, 1.6, [['s', .5, .55, 'OFP', 'DATA']]],
    ['AVIONICS POWER', .45, 1.27, 1, 1.6, [['s', .15, .35, 'MMC', 'OFF'], ['s', .38, .35, 'ST STA', 'OFF'], ['s', .62, .35, 'MFD', 'OFF'], ['s', .85, .35, 'UFC', 'OFF'], ['k', .5, .8, 'INS']]],
    ['DATA TRANSFER', 0, 1.6, .55, 2.17, [['d', .5, .45, 'DTC'], ['l', .5, .8, 'LOADED']]],
    ['OXYGEN', .55, 1.6, 1, 2.17, [['d', .5, .2, 'FLOW'], ['s', .25, .55, 'ON', 'OFF'], ['s', .5, .55, 'NORM', '100 %'], ['s', .75, .55, 'EMER', 'NORM'], ['d', .5, .87, 'PRESS']]]],
};

const PLATE = '#2c2f34', INK = '#E6E9EC', DIM = '#8C949E', KEY = '#B9C2CC', AMBER = '#FFB000', GREEN = '#4BFF7A';

// a small drawing kit on one canvas: positions and sizes are fractions of the canvas width (W)
function kit(x, W, H) {
  const k = {
    W, H,
    plate() { x.fillStyle = PLATE; x.fillRect(0, 0, W, H); x.strokeStyle = '#1a1c1f'; x.lineWidth = W * .012; x.strokeRect(0, 0, W, H);
      x.fillStyle = '#4a4e55'; for (const [a, b] of [[.03, .03], [.97, .03], [.03, H / W - .03], [.97, H / W - .03]]) { x.beginPath(); x.arc(a * W, b * W, W * .011, 0, 7); x.fill(); } },
    t(s, fx, fy, fs, o = {}) { x.fillStyle = o.c || INK; x.font = `${o.w || 700} ${Math.max(6, fs * W)}px ${o.mono ? MONO : FONT}`; x.textAlign = o.a || 'center'; x.textBaseline = 'middle';
      if (o.rot) { x.save(); x.translate(fx * W, fy * W); x.rotate(o.rot); x.fillText(s, 0, 0); x.restore(); } else x.fillText(s, fx * W, fy * W); },
    // a push button / key: rounded box with a legend (two lines split by '|')
    key(s, fx, fy, fw, fh, o = {}) { x.fillStyle = o.bg || KEY; x.strokeStyle = '#15171a'; x.lineWidth = W * .004; x.beginPath(); x.roundRect((fx - fw / 2) * W, (fy - fh / 2) * W, fw * W, fh * W, W * .008); x.fill(); x.stroke();
      const L = s.split('|'), fs = o.fs || fh * .34; L.forEach((l, i) => k.t(l, fx, fy + (i - (L.length - 1) / 2) * fs * 1.1, fs, { c: o.c || '#15171a', w: 800 })); },
    // round push button
    btn(s, fx, fy, r, o = {}) { x.fillStyle = '#3c4046'; x.beginPath(); x.arc(fx * W, fy * W, r * 1.25 * W, 0, 7); x.fill(); x.fillStyle = o.bg || '#9aa3ad'; x.beginPath(); x.arc(fx * W, fy * W, r * W, 0, 7); x.fill();
      if (s) k.t(s, fx, fy, o.fs || r * .62, { c: o.c || '#15171a', w: 800 }); },
    // toggle switch seen from the front: bezel nut + lever (up / mid / down), legends above / below
    tog(fx, fy, pos, up, dn, fs = .028) { const r = .022; x.fillStyle = '#4a4e55'; x.beginPath(); x.arc(fx * W, fy * W, r * W, 0, 7); x.fill(); x.fillStyle = '#1b1d20'; x.beginPath(); x.arc(fx * W, fy * W, r * .55 * W, 0, 7); x.fill();
      const dy = pos === 'up' ? -1 : pos === 'down' ? 1 : 0; x.fillStyle = '#d7dce1'; x.beginPath(); x.ellipse(fx * W, (fy + dy * r * .9) * W, r * .42 * W, r * (dy ? .7 : .42) * W, 0, 0, 7); x.fill();
      if (up) k.t(up, fx, fy - r - fs * .9, fs); if (dn) k.t(dn, fx, fy + r + fs * .9, fs); },
    // rotary knob with an index line at angle a (deg, clockwise from up) and labels around it: [[deg, text], ...]
    knob(fx, fy, r, a, labs = [], fs = .024) { x.fillStyle = '#121416'; x.beginPath(); x.arc(fx * W, fy * W, r * W, 0, 7); x.fill(); x.strokeStyle = '#5a5f66'; x.lineWidth = W * .004; x.stroke();
      x.strokeStyle = INK; x.lineWidth = W * .006; x.beginPath(); x.moveTo(fx * W, fy * W); x.lineTo((fx + Math.sin(a * D2R) * r * .9) * W, (fy - Math.cos(a * D2R) * r * .9) * W); x.stroke();
      for (const [d, s] of labs) k.t(s, fx + Math.sin(d * D2R) * (r + fs * 1.6), fy - Math.cos(d * D2R) * (r + fs * 1.1), fs); },
    // indicator tile (lamp): dark when off, coloured when on
    lamp(s, fx, fy, fw, fh, on, col = AMBER, fs) { x.fillStyle = on ? col : '#16181b'; x.fillRect((fx - fw / 2) * W, (fy - fh / 2) * W, fw * W, fh * W); x.strokeStyle = '#000'; x.lineWidth = W * .003; x.strokeRect((fx - fw / 2) * W, (fy - fh / 2) * W, fw * W, fh * W);
      const L = s.split('|'), f = fs || fh * .32; L.forEach((l, i) => k.t(l, fx, fy + (i - (L.length - 1) / 2) * f * 1.1, f, { c: on ? '#111' : '#5d636b', w: 800 })); },
    line(a, b, c, d, col = INK, lw = .004) { x.strokeStyle = col; x.lineWidth = lw * W; x.beginPath(); x.moveTo(a * W, b * W); x.lineTo(c * W, d * W); x.stroke(); },
    hatch(fx, fy, r) { for (let i = 0; i < 12; i++) { x.fillStyle = i % 2 ? '#111' : '#F2C200'; x.beginPath(); x.moveTo(fx * W, fy * W); x.arc(fx * W, fy * W, r * W, i * Math.PI / 6, (i + 1) * Math.PI / 6); x.fill(); } },
  };
  return k;
}

// h = API from f16.js: { THREE, frame(k), quad(w, h, m, z), basic(t, lit), tex(c, dyn), win(...), adiBall(g, r) }
export function buildF16Panels(A) {
  const { THREE, frame, quad, basic, tex, win } = A, P = PANELS;
  const panel = (k, cw, draw, lit = true) => { const p = P[k], c = canvas(cw, Math.round(cw * p.h / p.w)), x = c.getContext('2d'); draw(kit(x, c.width, c.height), x);
    const g = frame(k); g.add(quad(p.w, p.h, basic(tex(c), lit))); return g; };

  // ICP (integrated control panel): override buttons, keypad, rockers and wheels (all static)
  panel('icp', 1024, k => { k.plate(); const R = k.H / k.W;
    ['COM|1', 'IFF', 'COM|2', 'LIST', 'A-A', 'A-G'].forEach((s, i) => k.btn(s, .2 + i * .12, .1, .042, { fs: .022 }));
    const rows = [['T-ILS|1', 'ALOW|2', '3', 'RCL'], ['STPT|4', 'CRUS|5', 'TIME|6', 'ENTR'], ['MARK|7', 'FIX|8', 'A-CAL|9', 'M-SEL|0']];
    rows.forEach((r, j) => r.forEach((s, i) => k.key(s, .3 + i * .105, .27 + j * .15, .085, .1, { fs: .025 })));
    for (const [fx, a, b] of [[.08, 'SYM', 'BRT'], [.92, 'DEPR|R', 'CONT']]) { x_wheel(k, fx, .36, .22); k.t(a.split('|')[0], fx, .17, .022); k.t(b, fx, .58, .022); }
    k.key('▲|▼', .76, .39, .05, .14, { fs: .026, bg: '#7d8690' }); k.t('FLIR', .76, .29, .022); k.btn('WX', .855, .3, .03, { fs: .02 });
    // DCS 4-way rocker
    k.btn('', .42, .7, .045, { bg: '#7d8690' }); k.t('▲', .42, .64, .024, { c: '#15171a' }); k.t('▼', .42, .76, .024, { c: '#15171a' }); k.t('RTN', .33, .7, .022); k.t('SEQ', .51, .7, .022);
    k.tog(.62, .7, 'mid', 'DRIFT C/O', 'NORM', .021); k.t('WARN RESET', .62, .77, .021);
    k.knob(.8, .69, .035, 0, [[-50, 'GAIN'], [50, 'LVL']], .02); k.t('AUTO', .8, .76, .021);
    k.t('ICP', .5, R - .03, .022, { c: DIM }); });
  function x_wheel(k, fx, fy, fh) { const g = k; for (let i = 0; i < 9; i++) g.line(fx - .025, fy - fh / 2 + i * fh / 8, fx + .025, fy - fh / 2 + i * fh / 8, '#6d737b', .006); g.line(fx - .028, fy - fh / 2, fx - .028, fy + fh / 2, '#1a1c1f', .004); }

  // RWR azimuth indicator: own scope rings, no threats (the simulation has none); display glow is not lit by the sun
  panel('rwr', 512, (k, x) => { k.plate(); const cx = .5, cy = k.H / k.W / 2 + .02, r = .38;
    x.fillStyle = '#030805'; x.beginPath(); x.arc(cx * k.W, cy * k.W, r * k.W, 0, 7); x.fill();
    x.strokeStyle = 'rgba(75,255,122,.55)'; x.lineWidth = 2; for (const f of [1, .66, .33]) { x.beginPath(); x.arc(cx * k.W, cy * k.W, r * f * k.W, 0, 7); x.stroke(); }
    for (let a = 0; a < 360; a += 30) { const t = a * D2R; k.line(cx + Math.sin(t) * r * .92, cy - Math.cos(t) * r * .92, cx + Math.sin(t) * r, cy - Math.cos(t) * r, 'rgba(75,255,122,.7)', .006); }
    k.line(cx - .03, cy, cx + .03, cy, GREEN, .006); k.line(cx, cy - .03, cx, cy + .03, GREEN, .006);
    k.t('INT', .09, .06, .045, { c: DIM }); k.t('RWR', .9, .06, .045, { c: DIM }); }, false);

  // threat warning prime: six lamps (all dark: no threats are simulated)
  panel('twp', 512, k => { k.plate(); const L = [['HANDOFF', 'LAUNCH'], ['MODE|PRI', 'SYS TEST'], ['UNKNOWN|SHIP', 'T|TGT SEP']];
    L.forEach((r, j) => r.forEach((s, i) => k.lamp(s, .3 + i * .4, .2 + j * .3, .34, .24, false, AMBER, .055)));
    k.t('THREAT WARNING PRIME', .5, k.H / k.W - .05, .055, { c: DIM }); });

  // MISC / armament column (static): RF, laser arm, ALT REL, master arm, advanced mode, autopilot
  panel('misc', 512, k => { k.plate(); const s = .075;
    k.tog(.62, .17, 'up', 'NORM', 'SILENT', s * .75); k.t('RF', .28, .17, s * .9); k.t('QUIET', .9, .17, s * .55, { rot: Math.PI / 2 });
    k.btn('IFF|', .25, .5, .07, { fs: .045 }); k.t('IDENT', .25, .59, .05, { c: DIM });
    k.tog(.62, .5, 'down', 'LASER ARM', 'OFF', s * .7);
    k.t('ALT REL', .5, .82, s * .8); k.btn('', .5, .95, .085, { bg: '#D7262B' });
    k.tog(.5, 1.3, 'mid', 'MASTER ARM', 'SIMULATE', s * .75); k.t('OFF', .82, 1.3, s * .7);
    k.lamp('ACTIVE', .35, 1.68, .38, .1, false, GREEN, .05); k.lamp('STBY', .35, 1.79, .38, .1, false, AMBER, .05); k.t('ADV|MODE'.split('|')[0], .75, 1.7, .065); k.t('MODE', .75, 1.78, .065);
    k.line(.08, 1.95, .92, 1.95, DIM, .006); k.t('MISC', .08, 2.4, .07, { rot: -Math.PI / 2 });
    k.tog(.4, 2.3, 'mid', 'ROLL HDG SEL', 'STRG SEL', s * .6); k.t('ATT HOLD', .4, 2.39, s * .55, { c: DIM });
    k.tog(.4, 2.82, 'mid', 'PITCH ALT HOLD', 'ATT HOLD', s * .6); k.t('A/P OFF', .78, 2.82, s * .6); k.t('AUTOPILOT', .5, 3.4, s * .7, { c: DIM });
    k.t('RADIO CALL', .5, 3.58, s * .6, { c: DIM }); k.t('— — — — —', .5, 3.66, s * .7, { mono: true }); });

  // standby ADI: the same ray-cast ball as the main ADI (shared attitude), smaller case
  { const g = panel('adiB', 512, (k, x) => { k.plate(); const cx = .5, cy = k.H / k.W / 2, rw = .33;
      x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(cx * k.W, cy * k.W, rw * k.W, 0, 7); x.fill(); x.globalCompositeOperation = 'source-over';
      x.strokeStyle = '#000'; x.lineWidth = k.W * .02; x.beginPath(); x.arc(cx * k.W, cy * k.W, rw * k.W, 0, 7); x.stroke();
      x.fillStyle = '#FFB347'; x.fillRect((cx - .2) * k.W, (cy - .008) * k.W, .13 * k.W, .016 * k.W); x.fillRect((cx + .07) * k.W, (cy - .008) * k.W, .13 * k.W, .016 * k.W);
      x.beginPath(); x.arc(cx * k.W, cy * k.W, .015 * k.W, 0, 7); x.fill();
      k.t('PULL TO CAGE', .82, k.H / k.W - .06, .045, { c: DIM }); k.t('STBY', .14, .07, .05, { c: DIM }); });
    if (A.adiBall) A.adiBall(g, P.adiB.w * .33, -.0004); }

  // standby compass: a heading card strip moving behind a window (texture offset), lubber line
  let cardT = null;
  { const g = panel('compass', 512, (k, x) => { k.plate(); x.clearRect(.16 * k.W, (k.H / k.W / 2 - .17) * k.W, .68 * k.W, .34 * k.W); k.line(.5, k.H / k.W / 2 - .2, .5, k.H / k.W / 2 + .2, '#FF5A3C', .012);
      k.t('STBY COMPASS', .5, .07, .05, { c: DIM }); });
    const c = canvas(2048, 128), x = c.getContext('2d'); x.fillStyle = '#E9E3D2'; x.fillRect(0, 0, 2048, 128); x.fillStyle = x.strokeStyle = '#151515';
    for (let a = 0; a < 360; a += 5) { const px = a / 360 * 2048; x.lineWidth = a % 10 ? 2 : 4; x.beginPath(); x.moveTo(px, 0); x.lineTo(px, a % 10 ? 22 : 36); x.stroke();
      if (a % 30 === 0) { x.font = `800 52px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a] || String(a / 10), px, 80); } }
    cardT = tex(c); cardT.wrapS = THREE.RepeatWrapping; cardT.repeat.set(60 / 360, 1);
    g.add(quad(P.compass.w * .68, P.compass.w * .34, basic(cardT), -.0006)); }

  // hydraulic pressure A and B: two small dials (ESTIMATE: 3 000 psi with the engine above ~55 % RPM, else falling)
  const hydN = [];
  { const g = panel('hyd', 512, (k, x) => { k.plate(); const ys = [.33, .93];
      ys.forEach((cy, i) => { x.fillStyle = '#0c0d0f'; x.beginPath(); x.arc(.5 * k.W, cy * k.W, .3 * k.W, 0, 7); x.fill();
        for (let v = 0; v <= 4000; v += 500) { const a = (v / 4000 * 270 - 135) * D2R; k.line(.5 + Math.sin(a) * .26, cy - Math.cos(a) * .26, .5 + Math.sin(a) * .3, cy - Math.cos(a) * .3, INK, v % 1000 ? .006 : .012);
          if (v % 1000 === 0) k.t(String(v / 1000), .5 + Math.sin(a) * .19, cy - Math.cos(a) * .19, .07); }
        k.t(i ? 'B' : 'A', .5, cy + .14, .08, { c: AMBER }); });
      k.t('HYD PRESS', .5, k.H / k.W - .03, .07, { c: DIM }); });
    for (const cy of [.33, .93]) { const c = canvas(128, 128), x = c.getContext('2d'); x.fillStyle = '#F2F4F6'; x.fillRect(61, 18, 6, 50); x.beginPath(); x.arc(64, 64, 8, 0, 7); x.fill();
      const m = quad(P.hyd.w * .6, P.hyd.w * .6, basic(tex(c)), .0008); m.position.y = (P.hyd.h / 2 - cy * P.hyd.w); g.add(m); hydN.push(m); } }

  // instrument mode + heading / course knobs (static)
  panel('instr', 512, k => { k.plate(); k.knob(.5, .32, .14, -40, [[-75, 'TCN'], [-30, 'ILS/TCN'], [30, 'NAV'], [75, 'ILS/NAV']], .055); k.t('MODE', .5, .08, .06);
    k.knob(.3, 1.05, .1, 0, [], .05); k.t('HDG', .3, .9, .055); k.t('PUSH', .3, 1.2, .045, { c: DIM }); k.knob(.72, 1.05, .1, 0, [], .05); k.t('CRS', .72, .9, .055);
    k.t('INSTR', .08, .75, .06, { rot: -Math.PI / 2, c: DIM }); });

  // fuel quantity select + external fuel transfer (static at NORM)
  panel('fqs', 512, k => { k.plate(); k.knob(.5, .38, .15, 0, [[-80, 'TEST'], [0, 'NORM'], [50, 'RSVR'], [95, 'INT WING'], [140, 'EXT WING'], [-140, 'EXT CTR']], .05);
    k.t('FUEL QTY SEL', .5, .08, .06, { c: DIM }); k.tog(.5, 1.18, 'up', 'EXT FUEL TRANS', 'WING FIRST', .05); k.t('NORM', .5, 1.05, .045, { c: DIM }); });

  // landing-gear panel (the lamps are the separate live 'gear' face of f16.js): hook, jettison, brakes, stores, horn, landing lights
  panel('gearP', 1024, (k, x) => { k.plate(); const R = k.H / k.W;
    k.t('EMER STORES', .2, .07, .022); k.t('JETTISON', .2, .1, .022); k.hatch(.2, .2, .065); k.btn('', .2, .2, .035, { bg: '#5a5f66' });
    k.tog(.88, .14, 'up', 'HOOK', 'DN', .022); k.lamp('HOOK', .88, .04, .08, .04, false, AMBER, .018);
    k.tog(.12, .44, 'up', 'GND JETT', 'OFF', .02); k.tog(.28, .44, 'up', 'BRAKES|', 'CHAN 2', .02); k.tog(.43, .44, 'up', 'PARKING', 'OFF', .02); k.t('ANTI-SKID', .43, .53, .018, { c: DIM });
    k.tog(.12, .58, 'up', 'STORES CAT I', 'CAT III', .02); k.btn('', .3, .58, .022, { bg: '#E6E9EC' }); k.t('HORN SIL', .3, .63, .018);
    k.tog(.47, .58, 'mid', 'LANDING', 'TAXI', .02); k.t('LIGHTS', .58, .58, .018, { c: DIM });
    k.btn('DN LOCK|', .86, .5, .03, { bg: '#F2C200', fs: .014 }); k.t('DN LOCK REL', .86, .57, .018); k.t('LG', .7, .62, .03, { c: DIM }); k.line(.02, R - .02, .98, R - .02, '#1a1c1f', .004); });

  // CMDS (countermeasures dispenser): status window + counters (FIXED numbers: no countermeasures are simulated), switches, knobs
  panel('cmds', 1024, (k, x) => { k.plate();
    x.fillStyle = '#020502'; x.fillRect(.05 * k.W, .04 * k.W, .9 * k.W, .14 * k.W);
    const g = { c: GREEN, mono: true, w: 700 }; k.t('STATUS', .14, .08, .028, g); k.t('NO GO', .3, .08, .028, g); k.t('NO GO', .46, .08, .028, g); k.t('DISPENSE RDY', .74, .08, .028, g);
    ['30', 'Lo 0', '45', '15'].forEach((s, i) => k.t(s, .2 + i * .2, .14, .028, g));
    k.tog(.1, .32, 'up', 'RWR', 'OFF', .02); k.tog(.1, .48, 'up', 'JMR', 'OFF', .02);
    ['01', '02', 'CH', 'FL'].forEach((s, i) => k.tog(.26 + i * .14, .32, 'up', s, 'OFF', .02)); k.t('CMDS', .88, .32, .03);
    k.tog(.26, .5, 'mid', 'JETT', 'OFF', .02); k.knob(.48, .5, .045, 0, [[-60, 'BIT'], [0, '1 2 3'], [60, '4']], .018); k.t('PRGM', .48, .42, .02);
    k.knob(.72, .5, .045, 30, [[-90, 'OFF'], [-40, 'STBY'], [0, 'MAN'], [40, 'SEMI'], [80, 'AUTO']], .018); k.t('MODE', .72, .42, .02); });

  // side consoles (static): framed panels with legends, knobs, switches, lamps (all dark), little displays
  for (const key of ['conL', 'conR']) panel(key, 768, (k, x) => { x.fillStyle = '#1b1d20'; x.fillRect(0, 0, k.W, k.H);
    for (const [title, x0, y0, x1, y1, items] of CON[key]) { const pw = x1 - x0, ph = y1 - y0, m = .008;
      x.fillStyle = PLATE; x.fillRect((x0 + m) * k.W, (y0 + m) * k.W, (pw - 2 * m) * k.W, (ph - 2 * m) * k.W);
      const fs = Math.min(.034, pw * .1, ph * .2); k.t(title, x0 + pw / 2, y0 + m + fs * .9, fs, { c: DIM });
      for (const [t, fx, fy, ...s] of items) { const X = x0 + fx * pw, Y = y0 + fy * ph, f = Math.min(.026, pw * .075);
        if (t === 'k') { k.knob(X, Y, Math.min(.035, pw * .1, ph * .18), s.length > 1 ? -30 : 20, s.length > 1 ? s.map((l, i) => [-60 + i * 120 / (s.length - 1), l]) : [], f * .8); if (s.length === 1) k.t(s[0], X, Y + Math.min(.035, pw * .1, ph * .18) + f, f); }
        else if (t === 's') { const L = String(s[0]).split('|'); k.tog(X, Y, 'up', L[L.length - 1], s[1], f); if (L.length > 1) k.t(L[0], X, Y - .022 - f * 2, f); }
        else if (t === 'l') k.lamp(s[0], X, Y, Math.min(.13, pw * .22), f * 2.4, false, AMBER, f * .8);
        else if (t === 'd') { x.fillStyle = '#050607'; x.fillRect((X - pw * .3) * k.W, (Y - f * 1.1) * k.W, pw * .6 * k.W, f * 2.2 * k.W); k.t(s[0], X, Y, f * 1.2, { c: '#9AA4B2', mono: true }); }
        else if (t === 'b') { k.btn('', X, Y, f * .9, { bg: '#C9D1DB' }); k.t(s[0], X, Y + f * 2, f); } } } });

  // pilot fault list + caution panel: lit sets from the flight state (checked at 2 Hz, redrawn only on a change)
  const CAUT = [['FLCS|FAULT', 'ENGINE|FAULT', 'AVIONICS|FAULT', 'SEAT NOT|ARMED'], ['ELEC SYS', 'SEC', 'EQUIP|HOT', 'NWS FAIL'], ['PROBE|HEAT', 'FUEL/OIL|HOT', 'RADAR|ALT', 'ANTI|SKID'],
    ['C ADC', 'INLET|ICING', 'IFF', 'HOOK'], ['STORES|CONFIG', 'OVERHEAT', 'NUCLEAR', 'OXY LOW'], ['ATF NOT|ENGAGED', 'EEC', '', 'CABIN|PRESS'], ['FWD FUEL|LOW', 'BUC', '', ''], ['AFT FUEL|LOW', '', '', '']];
  const eng = h => (h.eng && h.eng[0]) || null;
  const lit = h => { const L = new Set(), lb = (h.fuel || 0) * 2.204623, e = eng(h); if (lb < 800) { L.add('FWD FUEL|LOW'); L.add('AFT FUEL|LOW'); }
    if (e && !e.on) L.add('ENGINE|FAULT'); if (h.stall) L.add('FLCS|FAULT'); return L; };
  const gC = frame('caut'), cW = win(gC, P.caut.w, P.caut.h, 768, Math.round(768 * P.caut.h / P.caut.w), [0, 0, 0], (x, h) => { const k = kit(x, x.canvas.width, x.canvas.height), L = lit(h); k.plate();
    const cw = .23, ch = (k.H / k.W - .06) / 8; CAUT.forEach((r, j) => r.forEach((s, i) => k.lamp(s, .035 + cw / 2 + i * cw, .03 + ch / 2 + j * ch, cw - .012, ch - .01, L.has(s), AMBER, ch * .3))); }, 2, true);
  cW.keyOf = h => [...lit(h)].join();
  const gF = frame('pfl'), fW = win(gF, P.pfl.w, P.pfl.h, 512, Math.round(512 * P.pfl.h / P.pfl.w), [0, 0, 0], (x, h) => { const W = x.canvas.width, H = x.canvas.height; x.fillStyle = '#020502'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#3a3e44'; x.lineWidth = 10; x.strokeRect(0, 0, W, H); const L = [...lit(h)].map(s => s.replace('|', ' '));
    x.fillStyle = GREEN; x.font = `700 30px ${MONO}`; x.textAlign = 'left'; x.textBaseline = 'top';
    (L.length ? L.slice(0, 4) : ['', '   NO FAULTS']).forEach((s, i) => x.fillText(s, 22, 18 + i * 44)); }, 2);
  fW.keyOf = cW.keyOf;

  // per frame: compass card + hydraulic needles; h = core.hud
  return function update(h) { if (cardT) cardT.offset.x = ((h.heading || 0) - 30) / 360;
    const e = eng(h), n2 = e && e.on ? e.n2 || 0 : 0, psi = clamp((n2 - 20) / 35, 0, 1) * 3000, a = (psi / 4000 * 270 - 135) * D2R;
    for (const m of hydN) m.rotation.z = -a; };
}
