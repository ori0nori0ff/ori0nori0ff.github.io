/* Live F-16 cockpit (docs/flight-plan.md, step S4): our own instruments, drawn from scratch on canvas textures, laid over the photogrammetry
   cockpit (flight/models/f16-cockpit, CC BY-NC-SA 4.0) at the places of the real ones: HUD symbology on the combiner glass, ADI, HSI,
   standby airspeed / Mach, altimeter, AOA and VVI tapes, engine gauges (RPM, FTIT, nozzle, oil), fuel flow, fuel quantity, two MFDs, the DED,
   gear lights. Layout, scales and markings follow public descriptions of the F-16C Block 50/52 cockpit; nothing is traced or copied.
   Places: ray casts into the scan from the pilot eye (tools note in the plan, S4): each face = centre, normal, size in the craft frame (metres,
   x right, y up, -z forward); offset = how far the scan's own surface stands in front of that plane (95th percentile) + 1 mm.
   Cost: faces are drawn once; needles, the compass card and the tapes are meshes or texture offsets moved per frame (no redraw); the ADI ball
   is a ray-cast sphere in a shader (no redraw); the HUD canvas is redrawn every frame it is seen (it must match the outside picture); MFDs,
   DED and number windows are redrawn at <= 5 Hz, at most two per frame.
   Data: core.hud (S2 flight model) and the drawn pose. Values S2 does not model (oil pressure, FTIT, nozzle position) are ESTIMATES from the
   engine power, labelled below. */
import { D2R, clamp, FONT, MONO, canvas, fmt, pad, dial, face, needle, windowText } from './draw.js?v=c3b9eb1c';
import { PANELS, buildF16Panels } from './f16-panels.js?v=712c1c95';

const KT = 1.943844, FT = 3.28084, LB = 2.204623;
// pilot eye (craft frame, m): estimate, chosen so the boresight passes through the upper part of the scanned HUD combiner (as in the F-16,
// where the gun cross / waterline sits near the HUD's top) and ~25 cm in front of the scanned seat's head rest
export const EYE = [0, 1.29, -4.70];
// faces: c = centre, n = normal (towards the pilot), w / h = size (m), off = offset along n (m); 'eye' = face turned to the eye (the scan's dial
// there is too rough to fit a plane: a hose crosses it)
const P = {
  mfdL: { c: [-0.1807, 0.9155, -5.4641], n: [-0.008, 0.228, 0.974], w: .104, h: .104, off: .0038 },
  mfdR: { c: [0.1813, 0.9151, -5.4649], n: [-0.007, 0.254, 0.967], w: .104, h: .104, off: .0041 },
  asi: { c: [-0.0466, 0.8813, -5.4033], n: [0, .24, .97], w: .064, h: .064, off: .016 },
  alt: { c: [0.0465, 0.8791, -5.4041], n: [0, .24, .97], w: .064, h: .064, off: .019 },
  adi: { c: [0.0002, 0.8124, -5.3674], n: [0, .40, .917], w: .072, h: .072, off: .007 },
  aoa: { c: [-0.065, 0.8019, -5.3599], n: [0, .504, .863], w: .029, h: .053, off: .0048 },
  vvi: { c: [0.0707, 0.8016, -5.3605], n: [0, .507, .861], w: .029, h: .053, off: .0059 },
  hsi: { c: [0.002, 0.7354, -5.3074], n: [0, .722, .692], w: .070, h: .070, off: .0184 },
  ded: { c: [0.1459, 1.1065, -5.3509], n: [0, .259, .966], w: .087, h: .027, off: .0024 },
  ff: { c: [0.2186, 1.015, -5.473], n: [0, .21, .978], w: .040, h: .020, off: .0034 },
  oil: { c: [0.2793, 0.9702, -5.4546], n: [.018, .489, .872], w: .036, h: .036, off: .0038 },
  noz: { c: [0.2865, 0.937, -5.4365], n: [.03, .478, .878], w: .042, h: .042, off: .0055 },
  rpm: { c: [0.2925, 0.8996, -5.4146], n: [.018, .431, .902], w: .047, h: .047, off: .0046 },
  ftit: { c: [0.2997, 0.8464, -5.384], n: [0, .434, .901], w: .049, h: .049, off: .0052 },
  fuel: { c: [0.3736, 0.7691, -5.3597], n: 'eye', w: .056, h: .056, off: .025 },
  gear: { c: [-0.3563, 0.75, -5.275], n: [0.157, 0.748, 0.644], w: .054, h: .037, off: .018 },
  ...PANELS,
};
// HUD: the canvas covers tangent-plane coordinates (x, y) = (dir.x, dir.y) / -dir.z seen from the eye, centre T0, half size HT
const HUD = { S: 512, T0: [0, -.085], HT: .145 };
const HUD_GREEN = [.32, 1, .5];

// engine values S2 does not model (ESTIMATES from power 0..100 = idle..MIL..max AB, labelled on the ENG page)
export function engineEst(e) { const on = !!(e && e.on), pw = on ? e.power || 0 : 0, st = pw > 50 ? (pw - 50) / 50 : 0, n2 = on ? e.n2 || 0 : 0;
  return { rpm: n2, ftit: on ? 500 + 8.6 * Math.min(pw, 50) + 30 * st : 30, noz: on ? (pw <= 50 ? 85 - 80 * pw / 50 : 5 + 95 * st) : 0, oil: on ? clamp(20 + .6 * (n2 - 60), 0, 100) : 0 }; }

export function createF16Cockpit(F, core, gfx, o = {}) {
  const THREE = F.THREE, R = F.renderer, group = new THREE.Group(); group.name = 'Instruments'; group.visible = false; gfx.model.add(group);
  const stats = { hudMs: 0, dynMs: 0, uploads: 0, frames: 0, on: true };
  // S7 quality levels (o.quality): HUD canvas redrawn every frame (high / medium) or every 2nd (low); MFD / DED / windows at 100 / 60 / 40 % of their rate
  const hudEvery = o.quality === 'low' ? 2 : 1, dynK = o.quality === 'low' ? .4 : o.quality === 'medium' ? .6 : 1; let hudN = 0;
  const aniso = Math.min(8, R.capabilities.getMaxAnisotropy()), eyeV = new THREE.Vector3(...EYE);
  const tex = (c, dyn) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
    if (dyn) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; } return t; };
  const mats = [];   // basic materials of the lit (non-emissive) faces: their brightness follows the light in the cockpit
  const basic = (t, lit = true) => { const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: true, alphaTest: .02 }); if (lit) mats.push(m); return m; };
  const displays = [];
  // a face frame: Object3D at the centre, x = craft right projected on the face, y up on the face, z = normal; children in metres on the face
  function frame(k) { const p = P[k], c = new THREE.Vector3(...p.c), n = p.n === 'eye' ? eyeV.clone().sub(c) : new THREE.Vector3(...p.n); n.normalize();
    const x = new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize(), y = new THREE.Vector3().crossVectors(n, x);
    const g = new THREE.Object3D(); g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n)); g.position.copy(c).addScaledVector(n, p.off); group.add(g); return g; }
  const quad = (w, h, m, z = 0) => { const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); q.position.z = z; q.renderOrder = 7; return q; };
  // a rotating part (needle, card): canvas drawn once, mesh turned about the face centre (rotation.z = −angle clockwise)
  function rotor(g, size, draw, z, lit = true) { const c = canvas(256, 256); draw(c.getContext('2d'), 256); const m = quad(size, size, basic(tex(c), lit), z); g.add(m); return m; }
  // a window redrawn when its text changes (≤ hz per s): { c, x, t, key, last }
  function win(g, w, h, cw, ch, pos, draw, hz = 5, lit = false) { const c = canvas(cw, ch), t = tex(c, true), m = quad(w, h, basic(t, lit), pos[2]); m.position.x = pos[0]; m.position.y = pos[1]; g.add(m);
    const d = { c, x: c.getContext('2d'), t, key: null, last: -1e9, hz, draw }; displays.push(d); return d; }

  // ── faces drawn once
  function staticFace(k, draw, round = true, lit = true) { const p = P[k], s = 512, c = canvas(s, Math.round(s * p.h / p.w)), x = c.getContext('2d');
    face(x, c.width, c.height, round); draw(x, c.width, c.height); const g = frame(k); g.add(quad(p.w, p.h, basic(tex(c), lit))); return g; }

  // standby airspeed (own scale: kt, non-linear) + Mach window
  const ASI = [[0, 0], [100, 50], [200, 140], [300, 195], [400, 235], [500, 265], [600, 290], [700, 312], [800, 330]];
  const asiAng = v => { v = clamp(v, 0, 800); for (let i = 1; i < ASI.length; i++) if (v <= ASI[i][0]) { const [a0, b0] = ASI[i - 1], [a1, b1] = ASI[i]; return (b0 + (b1 - b0) * (v - a0) / (a1 - a0)) * D2R; } return 330 * D2R; };
  const gAsi = staticFace('asi', (x, w) => { dial(x, { cx: w / 2, cy: w / 2, r: w * .43, from: 0, to: 200, step: 10, major: 50, ang: asiAng, label: v => v && v < 200 ? String(v) : null, fs: .13 });
    dial(x, { cx: w / 2, cy: w / 2, r: w * .43, from: 200, to: 800, step: 50, major: 100, ang: asiAng, label: v => String(v), fs: .13 });
    x.fillStyle = '#C9D1DB'; x.font = `600 ${w * .06}px ${FONT}`; x.textAlign = 'center'; x.fillText('KNOTS', w / 2, w * .34); x.fillText('MACH', w / 2, w * .76); });
  const asiN = rotor(gAsi, .064, (x, s) => needle(x, s, { len: .4 }), .0012);
  const asiM = win(gAsi, .022, .009, 128, 52, [0, -.0115, .0008], (x, h) => windowText(x, 128, 52, fmt(h.mach, 2)));

  // altimeter: needle = hundreds of ft (1 000 ft per turn), counter = ft, baro window 29.92 (fixed: standard pressure)
  const gAlt = staticFace('alt', (x, w) => { dial(x, { cx: w / 2, cy: w / 2, r: w * .43, from: 0, to: 980, step: 20, major: 100, ang: v => v / 1000 * 2 * Math.PI, label: v => v < 1000 ? String(v / 100) : null, fs: .16 });
    x.fillStyle = '#C9D1DB'; x.font = `600 ${w * .055}px ${FONT}`; x.textAlign = 'center'; x.fillText('ALT', w / 2, w * .25); x.fillText('IN HG 29.92', w / 2, w * .8); });
  const altN = rotor(gAlt, .064, (x, s) => needle(x, s, { len: .4 }), .0012);
  const altC = win(gAlt, .03, .009, 160, 48, [0, .0085, .0008], (x, h) => { const ft = Math.round((h.altMSL || 0) * FT / 20) * 20; windowText(x, 160, 48, (ft < 0 ? '-' : '') + pad(Math.abs(ft), 5).replace(/(\d\d)(\d\d\d)$/, '$1 $2')); });

  // ADI: a ray-cast ball (shader) behind a face with a round window, the aircraft symbol, a roll scale and a slip ball
  const ballC = canvas(2048, 1024); { const x = ballC.getContext('2d'), W = 2048, H = 1024, ye = e => (90 - e) / 180 * H, xa = a => (a + 180) / 360 * W;
    x.fillStyle = '#A5AFBA'; x.fillRect(0, 0, W, H / 2); x.fillStyle = '#17130f'; x.fillRect(0, H / 2, W, H / 2);
    x.fillStyle = '#F4F6F8'; x.fillRect(0, H / 2 - 3, W, 6);
    for (let e = -85; e <= 85; e += 5) { if (!e) continue; const big = e % 10 === 0, half = big ? 22 : 9, y = ye(e);
      x.strokeStyle = x.fillStyle = e > 0 ? '#1b1f24' : '#F4F6F8'; x.lineWidth = big ? 4 : 3;
      x.beginPath(); x.moveTo(xa(-half), y); x.lineTo(xa(half), y); x.stroke();
      if (big) { x.font = `700 ${30}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; for (const s of [-1, 1]) x.fillText(String(Math.abs(e)), xa(s * 30), y); } }
    x.strokeStyle = '#1b1f24'; x.lineWidth = 3; for (let a = -180; a < 180; a += 30) { x.beginPath(); x.moveTo(xa(a), ye(3)); x.lineTo(xa(a), ye(-3)); x.stroke(); } }
  const ballT = tex(ballC); ballT.wrapS = THREE.RepeatWrapping;
  const gAdi = frame('adi'), rWin = .025;
  const adiU = { uBall: { value: ballT }, uR: { value: new THREE.Matrix3() }, uK: { value: 2.2 }, uL: { value: 1 } };
  const adiM = new THREE.ShaderMaterial({ uniforms: adiU, transparent: false,
    vertexShader: 'varying vec2 vP; void main() { vP = position.xy * 2.0 / ' + (2 * rWin).toFixed(4) + '; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uBall; uniform mat3 uR; uniform float uK, uL; varying vec2 vP;
      void main() { float r2 = dot(vP, vP); if (r2 > 1.0) discard; float zf = sqrt(1.0 - r2);
        vec3 d = uR * normalize(vec3(vP, -uK * zf)); float el = asin(clamp(d.y, -1.0, 1.0)), az = atan(d.x, -d.z);
        vec3 c = texture2D(uBall, vec2(az / 6.2831853 + 0.5, el / 3.1415927 + 0.5)).rgb;
        gl_FragColor = vec4(c * uL * (0.55 + 0.45 * zf), 1.0); }` });
  adiM.toneMapped = true; { const b = quad(2 * rWin, 2 * rWin, adiM, -.0005); gAdi.add(b); }
  // a second ball of another size sharing the same uniforms (standby ADI: same attitude, no extra per-frame work)
  const adiBall = (g, r, z) => { const m = adiM.clone(); m.uniforms = adiU; m.vertexShader = adiM.vertexShader.replace((2 * rWin).toFixed(4), (2 * r).toFixed(4)); g.add(quad(2 * r, 2 * r, m, z)); };
  { const s = 512, c = canvas(s, s), x = c.getContext('2d'), cx = s / 2, rw = rWin / P.adi.w * s;
    face(x, s, s, false); x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(cx, cx, rw, 0, 7); x.fill(); x.globalCompositeOperation = 'source-over';
    x.strokeStyle = '#E8ECF0'; x.lineWidth = 4; for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const r1 = rw + 6, r2 = rw + (a % 30 ? 16 : 26), t = a * D2R;
      x.beginPath(); x.moveTo(cx + Math.sin(t) * r1, cx - Math.cos(t) * r1); x.lineTo(cx + Math.sin(t) * r2, cx - Math.cos(t) * r2); x.stroke(); }
    x.fillStyle = '#FFB347'; x.fillRect(cx - rw * .62, cx - 4, rw * .42, 8); x.fillRect(cx + rw * .2, cx - 4, rw * .42, 8); x.beginPath(); x.arc(cx, cx, 7, 0, 7); x.fill();
    x.fillRect(cx - rw * .2 - 4, cx - 4, 8, 22); x.fillRect(cx + rw * .2 - 4, cx - 4, 8, 22);
    x.fillStyle = '#050607'; x.fillRect(cx - 70, s * .9, 140, 26); x.strokeStyle = '#E8ECF0'; x.lineWidth = 2; x.beginPath(); x.moveTo(cx - 13, s * .9); x.lineTo(cx - 13, s * .9 + 26); x.moveTo(cx + 13, s * .9); x.lineTo(cx + 13, s * .9 + 26); x.stroke();
    gAdi.add(quad(P.adi.w, P.adi.h, basic(tex(c)), .0004)); }
  const slip = rotor(gAdi, .006, (x, s) => { x.fillStyle = '#F2F4F6'; x.beginPath(); x.arc(s / 2, s / 2, s * .42, 0, 7); x.fill(); }, .0008);
  slip.position.y = -P.adi.h * (.9 + 26 / 512 / 2 - .5);

  // AOA and VVI: moving tapes (texture offset, no redraw) behind a fixed index
  function tape(k, lo, hi, view, draw, label) { const p = P[k], c = canvas(128, 2048), x = c.getContext('2d'); x.fillStyle = '#0c0d0f'; x.fillRect(0, 0, 128, 2048); draw(x, v => (hi - v) / (hi - lo) * 2048);
    const t = tex(c); t.repeat.set(1, view / (hi - lo)); const g = frame(k); g.add(quad(p.w * .8, p.h, basic(t)));
    const o = canvas(128, 256), y = o.getContext('2d'); y.fillStyle = '#26292d'; y.fillRect(0, 0, 128, 256); y.clearRect(14, 22, 100, 212);
    y.fillStyle = '#FFB347'; y.beginPath(); y.moveTo(0, 116); y.lineTo(22, 128); y.lineTo(0, 140); y.fill(); y.fillRect(14, 126, 100, 4);
    y.fillStyle = '#C9D1DB'; y.font = `700 18px ${FONT}`; y.textAlign = 'center'; y.fillText(label, 64, 16);
    g.add(quad(p.w, p.h, basic(tex(o)), .0006)); return v => { t.offset.y = (clamp(v, lo, hi) - lo) / (hi - lo) - t.repeat.y / 2; }; }
  const aoaSet = tape('aoa', -5, 35, 14, (x, Y) => { x.fillStyle = 'rgba(57,255,158,.35)'; x.fillRect(64, Y(15), 64, Y(11) - Y(15));
    x.strokeStyle = x.fillStyle = '#E8ECF0'; for (let v = -5; v <= 35; v++) { const big = v % 5 === 0; x.lineWidth = big ? 4 : 2; x.beginPath(); x.moveTo(big ? 70 : 92, Y(v)); x.lineTo(128, Y(v)); x.stroke();
      if (big) { x.font = `700 34px ${FONT}`; x.textAlign = 'right'; x.textBaseline = 'middle'; x.fillText(String(v), 62, Y(v)); } } }, 'AOA');
  const vviSet = tape('vvi', -6, 6, 3, (x, Y) => { x.strokeStyle = x.fillStyle = '#E8ECF0';
    for (let v = -60; v <= 60; v++) { const u = v / 10, big = v % 5 === 0; x.lineWidth = big ? 4 : 2; x.beginPath(); x.moveTo(big ? 70 : 96, Y(u)); x.lineTo(128, Y(u)); x.stroke();
      if (v % 10 === 0) { x.font = `700 34px ${FONT}`; x.textAlign = 'right'; x.textBaseline = 'middle'; x.fillText(String(Math.abs(u)), 62, Y(u)); } } }, 'VVI');

  // HSI: rotating compass card + course arrow (course = the runway's 036, no navigation aid yet) under a fixed lubber line / aircraft symbol
  const gHsi = staticFace('hsi', (x, w) => { x.fillStyle = '#C9D1DB'; x.font = `600 ${w * .05}px ${FONT}`; x.textAlign = 'left'; x.fillText('CRS 036', w * .05, w * .07); x.textAlign = 'right'; x.fillText('---.- NM', w * .95, w * .07); }, false);
  const card = rotor(gHsi, .058, (x, s) => { const c = s / 2, r = s * .48; x.fillStyle = '#0c0d0f'; x.beginPath(); x.arc(c, c, r, 0, 7); x.fill(); x.strokeStyle = x.fillStyle = '#E8ECF0';
    for (let a = 0; a < 360; a += 5) { const t = a * D2R, l = a % 10 ? r * .07 : r * .13; x.lineWidth = a % 10 ? 1.2 : 2; x.beginPath(); x.moveTo(c + Math.sin(t) * r, c - Math.cos(t) * r); x.lineTo(c + Math.sin(t) * (r - l), c - Math.cos(t) * (r - l)); x.stroke(); }
    x.font = `700 ${s * .085}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let a = 0; a < 360; a += 30) { const t = a * D2R, rr = r * .74; x.save(); x.translate(c + Math.sin(t) * rr, c - Math.cos(t) * rr); x.rotate(t); x.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a] || String(a / 10), 0, 0); x.restore(); } }, .0008);
  const crs = rotor(gHsi, .058, (x, s) => { const c = s / 2; x.fillStyle = '#FFE066'; x.fillRect(c - 2.5, s * .1, 5, s * .22); x.beginPath(); x.moveTo(c, s * .05); x.lineTo(c - 9, s * .14); x.lineTo(c + 9, s * .14); x.fill();
    x.fillRect(c - 2.5, s * .68, 5, s * .22); x.fillRect(c - 2, s * .36, 4, s * .28); }, .0012);
  rotor(gHsi, .058, (x, s) => { const c = s / 2; x.fillStyle = '#F2F4F6'; x.beginPath(); x.moveTo(c, s * .015); x.lineTo(c - 6, s * .04); x.lineTo(c + 6, s * .04); x.fill();
    x.fillStyle = '#FFB347'; x.fillRect(c - 22, c - 2, 44, 4); x.fillRect(c - 2, c - 16, 4, 32); x.fillRect(c - 9, c + 12, 18, 3); }, .0016);

  // engine gauges (estimates where S2 has no value: see engineEst)
  const gauge = (k, title, from, to, step, major, sweep, label) => { const ang = v => (clamp(v, from, to) - from) / (to - from) * sweep * D2R - sweep / 2 * D2R;
    const g = staticFace(k, (x, w) => { dial(x, { cx: w / 2, cy: w / 2, r: w * .43, from, to, step, major, ang, label, fs: .17 });
      x.fillStyle = '#C9D1DB'; x.font = `700 ${w * .085}px ${FONT}`; x.textAlign = 'center'; x.fillText(title, w / 2, w * .72); });
    return { n: rotor(g, P[k].w, (x, s) => needle(x, s, { len: .38, w: .045 }), .0012), ang }; };
  const gRpm = gauge('rpm', 'RPM %', 0, 110, 5, 10, 300, v => v % 20 === 0 ? String(v) : null);
  const gFt = gauge('ftit', 'FTIT', 200, 1200, 50, 100, 300, v => v % 200 === 0 ? String(v / 100) : null);
  const gNoz = gauge('noz', 'NOZ POS', 0, 100, 5, 20, 270, v => String(v));
  const gOil = gauge('oil', 'OIL PSI', 0, 100, 5, 20, 300, v => String(v));
  // fuel quantity (lb × 1 000) + total window; fuel flow window
  const gFuel = gauge('fuel', 'FUEL ×1000 LB', 0, 7, .25, 1, 300, v => String(v));
  const fuelW = win(frameOf(gFuel), .026, .008, 160, 48, [0, -.013, .0008], (x, h) => windowText(x, 160, 48, fmt((h.fuel || 0) * LB, 0)), 2);
  function frameOf(gg) { return gg.n.parent; }
  const gFf = frame('ff'); gFf.add(quad(P.ff.w, P.ff.h, basic(tex((() => { const c = canvas(256, 128), x = c.getContext('2d'); face(x, 256, 128, false); return c; })()))));
  const ffW = win(gFf, .034, .013, 256, 96, [0, 0, .0006], (x, h) => { windowText(x, 256, 96, pad((h.ff || 0) * 7936.64 / 10, 4) + '0', { fs: .62 });
    x.fillStyle = '#9AA4B2'; x.font = `600 16px ${FONT}`; x.textAlign = 'left'; x.fillText('FUEL FLOW PPH', 8, 14); }, 4);

  // gear lights: NOSE / LEFT / RIGHT green when down and locked; red WHEELS while moving; PARK / BRAKE amber
  const gGear = frame('gear');
  const gearW = win(gGear, P.gear.w, P.gear.h, 256, 176, [0, 0, 0], (x, h) => { const s = h.srf || {}, g = s.gear == null ? 1 : s.gear, down = g >= .95, move = g > .02 && g < .95;
    face(x, 256, 176, false); const lamp = (cx, cy, on, col, t) => { x.fillStyle = on ? col : '#2a2d31'; x.beginPath(); x.arc(cx, cy, 22, 0, 7); x.fill(); x.fillStyle = on ? '#0A0A0A' : '#7A828C'; x.font = `700 13px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, cx, cy); };
    lamp(128, 40, down, '#39FF6A', 'NOSE'); lamp(70, 92, down, '#39FF6A', 'LEFT'); lamp(186, 92, down, '#39FF6A', 'RIGHT');
    lamp(128, 140, move, '#FF4040', 'GEAR'); lamp(40, 150, !!h.park, '#FFB347', 'PARK'); lamp(216, 150, !h.park && h.brake > 0, '#FFB347', 'BRK'); }, 10);

  // the other panels (f16-panels.js): ICP, RWR, threat warning, MISC, standby ADI / compass, PFL, caution, hydraulics, gear panel, CMDS ...
  const panelsUpd = buildF16Panels({ THREE, frame, quad, basic, tex, win, adiBall });

  // DED: five lines of own flight data (green on black)
  const gDed = frame('ded');
  const dedW = win(gDed, P.ded.w, P.ded.h, 512, 160, [0, 0, 0], (x, h, t) => { x.fillStyle = '#030403'; x.fillRect(0, 0, 512, 160); x.fillStyle = '#A6FF5A'; x.font = `600 25px ${MONO}`; x.textBaseline = 'top'; x.textAlign = 'left';
    const d = new Date(t || 0), hh = pad(d.getUTCHours(), 2) + ':' + pad(d.getUTCMinutes(), 2) + ':' + pad(d.getUTCSeconds(), 2);
    const L = [`ALT ${pad((h.altMSL || 0) * FT, 5)}  HDG ${pad(h.heading || 0, 3)}`, `IAS ${pad((h.ias || 0) * KT, 3)}  TAS ${pad((h.tas || 0) * KT, 3)}  M${fmt(h.mach, 2)}`,
      `FUEL ${pad((h.fuel || 0) * LB, 4)}  FF ${pad((h.ff || 0) * 7936.64, 5)}`, `G ${fmt(h.g, 1).padStart(4)}  AOA ${fmt(h.aoa, 1).padStart(5)}  ${h.fcs || ''}`, `${hh}Z  TIME x${fmt(h.warp, 0)}`];
    L.forEach((s, i) => x.fillText(s, 10, 6 + i * 30)); }, 4);

  // ── MFDs: pages (ENG / FUEL / FLT / SYS), five labels along the top; M = next page left, Shift+M = right
  const PAGES = ['ENG', 'FUEL', 'FLT', 'SYS'], mfd = { L: 0, R: 1 }, gmax = { v: 1 };
  function mfdDraw(side) { return (x, h) => { const S = 512, pg = PAGES[mfd[side]], e = (h.eng && h.eng[0]) || {}, est = engineEst(e);
    x.fillStyle = '#020303'; x.fillRect(0, 0, S, S); x.font = `700 26px ${FONT}`; x.textBaseline = 'middle'; x.textAlign = 'center';
    PAGES.forEach((p, i) => { const cx = 62 + i * 96; x.fillStyle = '#B8C2CC'; x.fillText(p, cx, 26); if (i === mfd[side]) { x.strokeStyle = '#39FF9E'; x.lineWidth = 3; x.strokeRect(cx - 40, 8, 80, 36); } });
    const row = (i, k, v, u, col) => { const y = 92 + i * 50; x.textAlign = 'left'; x.fillStyle = '#7FD8FF'; x.font = `600 30px ${FONT}`; x.fillText(k, 30, y);
      x.textAlign = 'right'; x.fillStyle = col || '#F2F4F6'; x.font = `700 38px ${MONO}`; x.fillText(v, 400, y); x.textAlign = 'left'; x.fillStyle = '#9AA4B2'; x.font = `600 24px ${FONT}`; x.fillText(u || '', 412, y); };
    if (pg === 'ENG') { row(0, 'RPM', fmt(est.rpm, 0), '%'); row(1, 'FTIT', fmt(est.ftit, 0), '°C est.'); row(2, 'NOZ', fmt(est.noz, 0), '% est.'); row(3, 'OIL', fmt(est.oil, 0), 'psi est.');
      row(4, 'FF', fmt((h.ff || 0) * 7936.64, 0), 'pph'); row(5, 'THRUST', fmt((h.thrust || 0) / 1e3, 1), 'kN'); row(6, 'POWER', fmt(h.power, 0), h.ab ? '% AB' : '%', h.ab ? '#FFB347' : null);
      row(7, 'ENGINE', e.on ? 'RUN' : 'OFF', '', e.on ? '#39FF9E' : '#FF5A5A'); }
    else if (pg === 'FUEL') { const lb = (h.fuel || 0) * LB, ff = (h.ff || 0) * 7936.64, end = ff > 1 ? lb / ff * 60 : NaN;
      row(0, 'TOTAL', fmt(lb, 0), 'lb'); row(1, '', fmt(h.fuel, 0), 'kg'); row(2, 'FLOW', fmt(ff, 0), 'pph'); row(3, 'ENDUR', isFinite(end) ? fmt(end, 0) : '–', 'min');
      row(4, 'RANGE', isFinite(end) ? fmt(end / 60 * (h.gs || 0) * KT, 0) : '–', 'nm'); row(5, 'GROSS', fmt((h.mass || 0) * LB, 0), 'lb');
      x.fillStyle = '#1b2a22'; x.fillRect(30, 420, 450, 34); x.fillStyle = lb < 1000 ? '#FF5A5A' : '#39FF9E'; x.fillRect(30, 420, 450 * clamp(lb / 6970, 0, 1), 34);
      x.fillStyle = '#9AA4B2'; x.font = `600 22px ${FONT}`; x.textAlign = 'left'; x.fillText('internal 6 970 lb (estimate)', 30, 476); }
    else if (pg === 'FLT') { gmax.v = Math.max(gmax.v, h.g || 0);
      row(0, 'IAS', fmt((h.ias || 0) * KT, 0), 'kt'); row(1, 'GS', fmt((h.gs || 0) * KT, 0), 'kt'); row(2, 'MACH', fmt(h.mach, 2)); row(3, 'ALT', fmt((h.altMSL || 0) * FT, 0), 'ft');
      row(4, 'VS', fmt((h.vs || 0) * FT * 60, 0), 'ft/min'); row(5, 'AOA', fmt(h.aoa, 1), '°'); row(6, 'G', fmt(h.g, 1) + ' / ' + fmt(gmax.v, 1), 'max'); row(7, 'FCS', h.fcs || '–'); }
    else { const s = h.srf || {}; row(0, 'GEAR', s.gear >= .95 ? 'DOWN' : s.gear <= .02 ? 'UP' : 'MOVING', '', s.gear > .02 && s.gear < .95 ? '#FF5A5A' : null);
      row(1, 'BRAKE', h.park ? 'PARK' : h.brake > 0 ? 'ON' : 'OFF'); row(2, 'FLAPS', fmt((s.flap || 0), 0), '°'); row(3, 'GROUND', h.onGround ? 'YES' : 'NO');
      row(4, 'AGL', fmt((h.agl || 0) * FT, 0), 'ft'); row(5, 'TIME', '×' + fmt(h.warp, 0)); row(6, 'STATUS', h.crash ? 'CRASH' : h.stall ? 'STALL' : 'OK', '', h.crash || h.stall ? '#FF5A5A' : '#39FF9E'); }
    x.fillStyle = '#5D6878'; x.font = `600 20px ${FONT}`; x.textAlign = 'center'; x.fillText(side === 'L' ? 'M = NEXT PAGE' : 'SHIFT+M = NEXT PAGE', S / 2, S - 18); }; }
  const mL = win(frame('mfdL'), P.mfdL.w, P.mfdL.h, 512, 512, [0, 0, 0], mfdDraw('L'), 5), mR = win(frame('mfdR'), P.mfdR.w, P.mfdR.h, 512, 512, [0, 0, 0], mfdDraw('R'), 5);
  const onKey = e => { if (e.code !== 'KeyM' || e.ctrlKey || e.metaKey || e.altKey || !group.visible || e.target.closest?.('input,textarea,select')) return;
    const s = e.shiftKey ? 'R' : 'L'; mfd[s] = (mfd[s] + 1) % PAGES.length; (s === 'L' ? mL : mR).last = -1e9; };
  addEventListener('keydown', onKey);

  // ── HUD on the combiner: collimated (the canvas is indexed by the view direction from the eye, so symbols lie at infinity) and additive
  const hc = canvas(HUD.S, HUD.S), hx = hc.getContext('2d'), ht = tex(hc, true); let hudMesh = null;
  const hudU = { uT: { value: ht }, uEye: { value: eyeV }, uT0: { value: new THREE.Vector2(...HUD.T0) }, uK: { value: 1 / (2 * HUD.HT) }, uC: { value: new THREE.Color(...HUD_GREEN) }, uB: { value: 1.3 } };
  const hudM = new THREE.ShaderMaterial({ uniforms: hudU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uT; uniform vec3 uEye, uC; uniform vec2 uT0; uniform float uK, uB; varying vec3 vP;
      void main() { vec3 d = vP - uEye; vec2 uv = (d.xy / -d.z - uT0) * uK + 0.5;
        if (d.z >= 0.0 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
        float a = texture2D(uT, uv).a; gl_FragColor = vec4(uC * a * uB, 1.0); }` });
  const tcx = t => ((t - HUD.T0[0]) / (2 * HUD.HT) + .5) * HUD.S, tcy = t => (.5 - (t - HUD.T0[1]) / (2 * HUD.HT)) * HUD.S, PXT = HUD.S / (2 * HUD.HT);   // tangent -> canvas px
  const vU = new THREE.Vector3(), vE = new THREE.Vector3(), vN = new THREE.Vector3(), qi = new THREE.Quaternion(), Ub = new THREE.Vector3(), Eb = new THREE.Vector3(), Nb = new THREE.Vector3(), tmp = new THREE.Vector3();
  function attitude(Pp) { vU.copy(Pp.pos).normalize(); vN.set(0, 1, 0).applyQuaternion(F.earthQuat); vE.crossVectors(vN, vU).normalize(); vN.crossVectors(vU, vE);
    qi.copy(Pp.quat).invert(); Ub.copy(vU).applyQuaternion(qi); Eb.copy(vE).applyQuaternion(qi); Nb.copy(vN).applyQuaternion(qi);
    return { pitch: Math.asin(clamp(-Ub.z, -1, 1)), roll: Math.atan2(-Ub.x, Ub.y), hdg: Math.atan2(-Eb.z, -Nb.z) }; }
  function drawHud(h, A) { const x = hx, S = HUD.S; x.clearRect(0, 0, S, S); x.strokeStyle = x.fillStyle = '#fff'; x.lineWidth = 3; x.lineCap = 'round'; x.lineJoin = 'round';
    const line = (a, b, c, d) => { x.beginPath(); x.moveTo(tcx(a), tcy(b)); x.lineTo(tcx(c), tcy(d)); x.stroke(); };
    const text = (s, tx, ty, al = 'center', sz = 26) => { x.font = `600 ${sz}px ${FONT}`; x.textAlign = al; x.textBaseline = 'middle'; x.fillText(s, tcx(tx), tcy(ty)); };
    // gun cross (boresight)
    line(-.008, 0, -.003, 0); line(.003, 0, .008, 0); line(0, .008, 0, .003); line(0, -.003, 0, -.008);
    // flight path marker: the air velocity in body axes (tan β / cos α, −tan α)
    const al = (h.aoa || 0) * D2R, be = (h.beta || 0) * D2R, slow = (h.tas || 0) < 15, fx = slow ? 0 : clamp(Math.tan(be) / Math.cos(al), -.2, .2), fy = slow ? 0 : clamp(-Math.tan(al), -.4, .2);
    const fr = .0065; x.beginPath(); x.arc(tcx(fx), tcy(fy), fr * PXT, 0, 7); x.stroke(); line(fx - fr, fy, fx - fr * 2.6, fy); line(fx + fr, fy, fx + fr * 2.6, fy); line(fx, fy + fr, fx, fy + fr * 2);
    // AOA bracket with the gear down: spans 11-15° AOA below the boresight (the FPM sits in it at the approach AOA)
    if ((h.srf ? h.srf.gear : 1) > .5) { const y1 = -Math.tan(11 * D2R), y2 = -Math.tan(15 * D2R), bx = fx - .028; line(bx, y1, bx, y2); line(bx, y1, bx + .006, y1); line(bx, y2, bx + .006, y2); }
    // pitch ladder: lines every 5°, centred on the FPM laterally, rolled with the horizon; conformal (each centre is a true direction)
    x.save(); x.beginPath(); x.rect(tcx(-.075), 0, tcx(.075) - tcx(-.075), tcy(-.175)); x.clip();
    const cr = Math.cos(A.roll), sr = Math.sin(A.roll), hv = [cr, sr], nv = [-sr, cr];
    const azF = A.hdg + Math.atan2(fx, 1);   // azimuth of the ladder centre (FPM lateral offset, small-angle)
    for (let k = -18; k <= 18; k++) { const th = k * 5 * D2R, ce = Math.cos(th);
      tmp.copy(Eb).multiplyScalar(ce * Math.sin(azF)).addScaledVector(Nb, ce * Math.cos(azF)).addScaledVector(Ub, Math.sin(th));
      if (tmp.z > -.05) continue; const cx = tmp.x / -tmp.z, cy = tmp.y / -tmp.z; if (Math.abs(cy - fy) > .3) continue;
      const L = k ? .036 : .07, G = k ? .012 : .008;
      if (k < 0) x.setLineDash([10, 8]); else x.setLineDash([]);
      line(cx - hv[0] * L, cy - hv[1] * L, cx - hv[0] * G, cy - hv[1] * G); line(cx + hv[0] * G, cy + hv[1] * G, cx + hv[0] * L, cy + hv[1] * L);
      x.setLineDash([]);
      if (k) { const tk = -Math.sign(k) * .006; line(cx - hv[0] * L, cy - hv[1] * L, cx - hv[0] * L + nv[0] * tk, cy - hv[1] * L + nv[1] * tk); line(cx + hv[0] * L, cy + hv[1] * L, cx + hv[0] * L + nv[0] * tk, cy + hv[1] * L + nv[1] * tk);
        const lx = cx + hv[0] * (L + .012), ly = cy + hv[1] * (L + .012); x.save(); x.translate(tcx(lx), tcy(ly)); x.rotate(-A.roll); x.font = `600 22px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(k * 5), 0, 0); x.restore(); } }
    x.restore();
    // airspeed (left) and altitude (right) scales with boxes; heading scale at the bottom
    const ias = (h.ias || 0) * KT, alt = (h.altMSL || 0) * FT, yc = -.07, half = .06;
    x.save(); x.beginPath(); x.rect(0, tcy(yc + half), S, tcy(yc - half) - tcy(yc + half)); x.clip();
    for (let v = Math.floor((ias - 60) / 10) * 10; v <= ias + 60; v += 10) { if (v < 0) continue; const y = yc + (v - ias) * half / 60, big = v % 50 === 0; line(-.088, y, big ? -.096 : -.092, y); if (big) text(String(v), -.104, y, 'right', 22); }
    for (let v = Math.floor((alt - 600) / 100) * 100; v <= alt + 600; v += 100) { const y = yc + (v - alt) * half / 600, big = v % 500 === 0; line(.088, y, big ? .096 : .092, y); if (big) text(fmt(v / 1000, 1), .104, y, 'left', 22); }
    x.restore();
    const box = (cx, s, al) => { const w = .036, hh = .0085; x.fillStyle = '#000'; x.clearRect(tcx(cx - w / 2), tcy(yc + hh), w * PXT, 2 * hh * PXT); x.strokeRect(tcx(cx - w / 2), tcy(yc + hh), w * PXT, 2 * hh * PXT); x.fillStyle = '#fff'; text(s, cx, yc, 'center', 26); };
    box(-.1, fmt(ias, 0)); box(.1, fmt(Math.round(alt / 10) * 10, 0));
    const hd = (A.hdg / D2R + 360) % 360, yh = -.195; x.save(); x.beginPath(); x.rect(tcx(-.055), tcy(yh + .03), tcx(.055) - tcx(-.055), .06 * PXT); x.clip();
    for (let a = Math.floor((hd - 15) / 5) * 5; a <= hd + 15; a += 5) { const xx = (a - hd) * .055 / 15, big = a % 10 === 0; line(xx, yh, xx, yh + (big ? .007 : .004)); if (big) text(pad(((a % 360) + 360) % 360 / 10, 2), xx, yh + .016, 'center', 22); }
    x.restore(); x.beginPath(); x.moveTo(tcx(0), tcy(yh - .001)); x.lineTo(tcx(-.004), tcy(yh - .008)); x.lineTo(tcx(.004), tcy(yh - .008)); x.closePath(); x.fill();
    // numbers: G (top left), Mach / AOA under the speed scale, vertical speed / radar altitude under the altitude scale
    text('G ' + fmt(h.g, 1), -.125, .03, 'left', 26); text('M ' + fmt(h.mach, 2), -.125, -.145, 'left', 24); text('α ' + fmt(h.aoa, 1), -.125, -.162, 'left', 24);
    text('VS ' + fmt((h.vs || 0) * FT * 60, 0), .125, -.145, 'right', 24); if ((h.agl || 0) * FT < 5000) text('R ' + pad((h.agl || 0) * FT, 5), .125, -.162, 'right', 24);
    if (h.stall) text('STALL', 0, -.12, 'center', 30); if (h.crash) text('CRASH', 0, -.12, 'center', 30);
    ht.needsUpdate = true; }

  // ── per frame (after gfx.update): P = the draw pose (W), t = time (ms)
  const vS = new THREE.Vector3(), mR3 = new THREE.Matrix3(), Hx = new THREE.Vector3(), Hz = new THREE.Vector3(); let tLast = 0;
  function update(Pp, t) { const ck = gfx.cockpit; const on = stats.on && !!ck && ck.visible; group.visible = on;
    if (!on) { if (hudMesh) hudMesh.visible = false; return; }
    if (!hudMesh) { const hg = ck.getObjectByName('HudGlass'); if (hg && hg.isMesh) { hudMesh = new THREE.Mesh(hg.geometry, hudM); hudMesh.renderOrder = 8; hudMesh.frustumCulled = false; group.add(hudMesh); } }
    if (hudMesh) hudMesh.visible = true;
    const h = core.hud, A = attitude(Pp), e = (h.eng && h.eng[0]) || {}, est = engineEst(e);
    // light on the lit faces: daylight from the Sun's height (estimate: 0.3 at night = panel lighting, 0.9 by day)
    const se = vS.copy(F.sun()).normalize().dot(vU), dl = clamp((se + .1) / .2, 0, 1), lum = .3 + .6 * dl; for (const m of mats) m.color.setScalar(lum); adiU.uL.value = lum * 1.1;
    hudU.uB.value = 1.1 + .6 * dl;
    // moving parts (no redraw)
    asiN.rotation.z = -asiAng((h.ias || 0) * KT); altN.rotation.z = -(((h.altMSL || 0) * FT % 1000 + 1000) % 1000) / 1000 * 2 * Math.PI;
    card.rotation.z = A.hdg; crs.rotation.z = -(36 * D2R - A.hdg);
    aoaSet(h.aoa || 0); vviSet((h.vs || 0) * FT * 60 / 1000);
    slip.position.x = -clamp((h.beta || 0) / 8, -1, 1) * 11 / 512 * P.adi.w;
    gRpm.n.rotation.z = -gRpm.ang(est.rpm); gFt.n.rotation.z = -gFt.ang(est.ftit); gNoz.n.rotation.z = -gNoz.ang(est.noz); gOil.n.rotation.z = -gOil.ang(est.oil);
    gFuel.n.rotation.z = -gFuel.ang((h.fuel || 0) * LB / 1000);
    // ADI ball: body -> level frame (x right-level, y up, z aft-level)
    Hz.set(Ub.z * Ub.x, Ub.z * Ub.y, -1 + Ub.z * Ub.z); if (Hz.lengthSq() > 1e-8) { Hz.normalize().negate(); Hx.crossVectors(Ub, Hz);
      mR3.set(Hx.x, Hx.y, Hx.z, Ub.x, Ub.y, Ub.z, Hz.x, Hz.y, Hz.z); adiU.uR.value.copy(mR3); }
    // HUD every frame; windows at their own rate, at most two per frame
    let t0 = performance.now(); if (++hudN % hudEvery === 0) drawHud(h, A); stats.hudMs += (performance.now() - t0 - stats.hudMs) * .05;
    t0 = performance.now(); let n = 0; const now = performance.now();
    panelsUpd(h);
    for (const d of displays) { if (n >= 2) break; if (now - d.last < 1000 / (d.hz * dynK)) continue; d.last = now;
      if (d.keyOf) { const kk = d.keyOf(h); if (kk === d.key) continue; d.key = kk; }   /* lamp panels: redraw only on a change */
      d.draw(d.x, h, t); d.t.needsUpdate = true; n++; stats.uploads++; }
    stats.dynMs += (performance.now() - t0 - stats.dynMs) * .05; stats.frames++; tLast = t; }

  return { group, update, stats, mfd, PAGES, hudCanvas: hc, set on(v) { stats.on = !!v; }, get on() { return stats.on; },
    dispose() { removeEventListener('keydown', onKey); gfx.model.remove(group); } };
}
