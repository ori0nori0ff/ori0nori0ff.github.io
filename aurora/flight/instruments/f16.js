/* Live F-16 cockpit (docs/flight-plan.md, step S4) on the Falcon BMS 4.38 cockpit model 888 (models/f16-cockpit, flight/gfx.js loadCockpit,
   used with the site owner's permission, tex/LICENCE.txt). The model brings its own gauge faces, bezels and panels; its moving parts (needles,
   drums, ADI ball, compass card ...) are glb nodes 'dof<N>_<i>' (tools/build_bms_cockpit.py) that this file turns from our flight values.
   On top, drawn here from scratch (canvas): HUD symbology on the combiner, the MFD pages and the DED text (BMS draws those in its own renderer).
   DOF calibration (2026-11-14, close-up frames from the eye): every needle turns about its node's z axis, a positive angle = counter-clockwise
   seen by the pilot; rest pose = the scale's start. Scale tables = tick angles measured on the BMS faces (asi / alt / engine: the 2D cockpit
   faces 8022 / measured crops, same layout as the 3D faces within ~3°). Drums: 36° per digit, a negative angle = digit up (baro drums the other way).
   Places (craft frame, metres, x right, y up, -z forward): MFD / DED = the model's own screen glass (flat quads of material 'Canopy', fitted
   by tools/build_bms_cockpit.py geometry, 2026-11-14); off = 0.5 mm in front of the glass.
   Cost: DOF nodes = a quaternion each per frame (no redraw); the HUD canvas is redrawn every frame it is seen (it must match the outside
   picture); MFDs and DED are redrawn at <= 5 Hz, at most two per frame.
   Data: core.hud (S2 flight model) and the drawn pose. Values S2 does not model (oil pressure, FTIT, nozzle position, hydraulics) are ESTIMATES
   from the engine power, labelled on the ENG page. */
import { D2R, clamp, FONT, MONO, canvas, fmt, pad } from './draw.js?v=c3b9eb1c';

const KT = 1.943844, FT = 3.28084, LB = 2.204623, TAU = 2 * Math.PI;
// pilot eye (craft frame, m) = gfx.js MODELS.f16.head: the BMS cockpit origin + its head offset (forward 30.5 mm, down 6.1 mm)
export const EYE = [0, 1.29 - .0061, -4.70 - .0305];
// screens: c = centre, n = normal (towards the pilot), w / h = size (m), off = offset along n (m)
const P = {
  mfdL: { c: [-0.1737, 0.8988, -5.4593], n: [0, .252, .968], w: .104, h: .104, off: .0005 },   /* glass 113 x 114 mm; page 104 mm (4.1 in display) */
  mfdR: { c: [0.1745, 0.8988, -5.4598], n: [0, .252, .968], w: .104, h: .104, off: .0005 },
  ded: { c: [0.1414, 1.0876, -5.3499], n: [0, .25, .968], w: .083, h: .026, off: .0005 },   /* glass 86 x 30 mm */
};
// HUD: the canvas covers tangent-plane coordinates (x, y) = (dir.x, dir.y) / -dir.z seen from the eye, centre T0, half size HT; drawn on a plane
// HUD.D m in front of the eye (collimated: the distance only decides what can hide it)
const HUD = { S: 512, T0: [0, -.085], HT: .145, D: .42 };
const HUD_GREEN = [.32, 1, .5];

// engine values S2 does not model (ESTIMATES from power 0..100 = idle..MIL..max AB, labelled on the ENG page)
export function engineEst(e) { const on = !!(e && e.on), pw = on ? e.power || 0 : 0, st = pw > 50 ? (pw - 50) / 50 : 0, n2 = on ? e.n2 || 0 : 0;
  return { rpm: n2, ftit: on ? 500 + 8.6 * Math.min(pw, 50) + 30 * st : 30, noz: on ? (pw <= 50 ? 85 - 80 * pw / 50 : 5 + 95 * st) : 0, oil: on ? clamp(20 + .6 * (n2 - 60), 0, 100) : 0,
    hyd: on ? 3000 : 0 }; }

// scale tables [[value, deg clockwise], ...] -> angle (rad) from the scale's first entry
const lut = T => v => { v = clamp(v, T[0][0], T[T.length - 1][0]); let i = 1; while (i < T.length - 1 && v > T[i][0]) i++; const [a0, b0] = T[i - 1], [a1, b1] = T[i]; return (b0 + (b1 - b0) * (v - a0) / (a1 - a0) - T[0][1]) * D2R; };
const ASI = lut([[0, -.75], [80, 22.6], [90, 32.6], [100, 42.7], [110, 52.6], [120, 62.5], [130, 72.3], [140, 82.1], [150, 91.8], [160, 101.7], [170, 111.3], [180, 119.5], [190, 129.2], [200, 137.0],
  [210, 145.0], [220, 150.9], [230, 156.7], [240, 162.1], [290, 186.6], [300, 191.1], [310, 195.4], [320, 199.7], [330, 203.7], [360, 215.2], [370, 218.9], [380, 222.5], [390, 225.9], [400, 229.4],
  [450, 245.5], [500, 260.6], [550, 274.2], [600, 287.4], [650, 299.8], [700, 311.7], [750, 322.8], [800, 333.2], [850, 343.0]]);
const ALT = v => v / 1000 * TAU;   /* 1 000 ft per turn */
const RPM = lut([[0, 1.2], [10, 18.3], [20, 35.0], [30, 51.1], [40, 69.5], [50, 86.6], [60, 107.3], [70, 129.7], [75, 150.3], [80, 173.1], [85, 196.8], [90, 221.9], [95, 249.6], [100, 277.8], [105, 303.5], [110, 329.1]]);
const FTIT = lut([[200, 116.7], [300, 139.2], [400, 159.9], [500, 179.5], [600, 199.7], [700, 217.7], [750, 242.3], [800, 267.2], [850, 292.1], [900, 319.0], [950, 347.6], [1000, 381.0], [1050, 392.8], [1100, 404.6], [1150, 416.9], [1200, 428.8]]);
const NOZ = lut([[0, 60.7], [10, 82.0], [20, 103.4], [30, 127.2], [40, 151.8], [50, 177.8], [60, 204.3], [80, 255.6], [90, 278.5], [100, 301.1]]);
const OIL = lut([[0, 110.0], [20, 174.2], [40, 240.1], [60, 303.5], [80, 369.2], [100, 431.4]]);
const FUEL = v => clamp(v, 0, 4200) / 4000 * 238 * D2R;   /* per pointer: 0-4 000 lb over 238° */
const HYD = v => clamp(v, 0, 4000) / 4000 * 4.32;   /* ESTIMATE: 0-4 000 psi over the DOF's 4.32 rad limit (not checked against the face) */
const COURSE = 36;   /* the runway's 036 (no navigation aid yet) */

export function createF16Cockpit(F, core, gfx, o = {}) {
  const THREE = F.THREE, R = F.renderer, group = new THREE.Group(); group.name = 'Instruments'; group.visible = false; gfx.model.add(group);
  const stats = { hudMs: 0, dynMs: 0, uploads: 0, frames: 0, on: true };
  // S7 quality levels (o.quality): HUD canvas redrawn every frame (high / medium) or every 2nd (low); MFD / DED at 100 / 60 / 40 % of their rate
  const hudEvery = o.quality === 'low' ? 2 : 1, dynK = o.quality === 'low' ? .4 : o.quality === 'medium' ? .6 : 1; let hudN = 0;
  const aniso = Math.min(8, R.capabilities.getMaxAnisotropy()), eyeV = new THREE.Vector3(...EYE);
  const tex = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; return t; };
  const displays = [];
  // a screen frame: Object3D at the centre, x = craft right projected on the screen, y up on it, z = normal
  function frame(k) { const p = P[k], c = new THREE.Vector3(...p.c), n = new THREE.Vector3(...p.n).normalize();
    const x = new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize(), y = new THREE.Vector3().crossVectors(n, x);
    const g = new THREE.Object3D(); g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n)); g.position.copy(c).addScaledVector(n, p.off); group.add(g); return g; }
  // a display redrawn when due (<= hz per s); self-lit (no scene light)
  function win(k, cw, ch, draw, hz) { const p = P[k], c = canvas(cw, ch), t = tex(c), m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
    m.renderOrder = 7; frame(k).add(m); const d = { c, x: c.getContext('2d'), t, last: -1e9, hz, draw }; displays.push(d); return d; }

  // ── BMS moving parts: dof number -> nodes (found once the model has loaded)
  let dof = null;
  const zA = new THREE.Vector3(0, 0, 1), qT = new THREE.Quaternion();
  function findDofs(ck) { dof = {}; ck.traverse(n => { const u = n.userData; if (!u || u.dof == null) return; u.q0 = n.quaternion.clone(); u.p0 = n.position.clone(); (dof[u.dof] = dof[u.dof] || []).push(n); });
    for (const k of [106, 107]) for (const n of dof[k] || []) n.visible = false;   /* ILS bars of the ADI: stowed (no ILS yet) */ }
  const rot = (k, a) => { const L = dof[k]; if (!L) return; qT.setFromAxisAngle(zA, a); for (const n of L) n.quaternion.copy(n.userData.q0).multiply(qT); };
  const drum = (k, d, s) => rot(k, -s * d * TAU / 10);   /* digit d (0..10, fractions roll) */
  const digits = (ks, v, roll, s = 1) => { v = Math.max(0, v); ks.forEach((k, i) => { const p = 10 ** (ks.length - 1 - i), d = Math.floor(v / p) % 10;
    drum(k, i === ks.length - 1 && roll ? (v / p) % 10 : d, s); }); };

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
  const mL = win('mfdL', 512, 512, mfdDraw('L'), 5), mR = win('mfdR', 512, 512, mfdDraw('R'), 5);
  const onKey = e => { if (e.code !== 'KeyM' || e.ctrlKey || e.metaKey || e.altKey || !group.visible || e.target.closest?.('input,textarea,select')) return;
    const s = e.shiftKey ? 'R' : 'L'; mfd[s] = (mfd[s] + 1) % PAGES.length; (s === 'L' ? mL : mR).last = -1e9; };
  addEventListener('keydown', onKey);

  // DED: five lines of own flight data (green on black)
  win('ded', 512, 160, (x, h, t) => { x.fillStyle = '#030403'; x.fillRect(0, 0, 512, 160); x.fillStyle = '#A6FF5A'; x.font = `600 25px ${MONO}`; x.textBaseline = 'top'; x.textAlign = 'left';
    const d = new Date(t || 0), hh = pad(d.getUTCHours(), 2) + ':' + pad(d.getUTCMinutes(), 2) + ':' + pad(d.getUTCSeconds(), 2);
    const L = [`ALT ${pad((h.altMSL || 0) * FT, 5)}  HDG ${pad(h.heading || 0, 3)}`, `IAS ${pad((h.ias || 0) * KT, 3)}  TAS ${pad((h.tas || 0) * KT, 3)}  M${fmt(h.mach, 2)}`,
      `FUEL ${pad((h.fuel || 0) * LB, 4)}  FF ${pad((h.ff || 0) * 7936.64, 5)}`, `G ${fmt(h.g, 1).padStart(4)}  AOA ${fmt(h.aoa, 1).padStart(5)}  ${h.fcs || ''}`, `${hh}Z  TIME x${fmt(h.warp, 0)}`];
    L.forEach((s, i) => x.fillText(s, 10, 6 + i * 30)); }, 4);

  // ── HUD: collimated (the canvas is indexed by the view direction from the eye, so symbols lie at infinity) and additive, on a plane HUD.D in
  // front of the eye that covers the canvas (the BMS model has no combiner glass mesh)
  const hc = canvas(HUD.S, HUD.S), hx = hc.getContext('2d'), ht = tex(hc);
  const hudU = { uT: { value: ht }, uEye: { value: eyeV }, uT0: { value: new THREE.Vector2(...HUD.T0) }, uK: { value: 1 / (2 * HUD.HT) }, uC: { value: new THREE.Color(...HUD_GREEN) }, uB: { value: 1.3 } };
  const hudM = new THREE.ShaderMaterial({ uniforms: hudU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uT; uniform vec3 uEye, uC; uniform vec2 uT0; uniform float uK, uB; varying vec3 vP;
      void main() { vec3 d = vP - uEye; vec2 uv = (d.xy / -d.z - uT0) * uK + 0.5;
        if (d.z >= 0.0 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
        float a = texture2D(uT, uv).a; gl_FragColor = vec4(uC * a * uB, 1.0); }` });
  const hudMesh = (() => { const s = 2 * HUD.HT * HUD.D * 1.02, g = new THREE.PlaneGeometry(s, s); g.translate(EYE[0] + HUD.T0[0] * HUD.D, EYE[1] + HUD.T0[1] * HUD.D, EYE[2] - HUD.D);
    const m = new THREE.Mesh(g, hudM); m.renderOrder = 8; m.frustumCulled = false; group.add(m); return m; })();
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
    const box = (cx, s) => { const w = .036, hh = .0085; x.clearRect(tcx(cx - w / 2), tcy(yc + hh), w * PXT, 2 * hh * PXT); x.strokeRect(tcx(cx - w / 2), tcy(yc + hh), w * PXT, 2 * hh * PXT); text(s, cx, yc, 'center', 26); };
    box(-.1, fmt(ias, 0)); box(.1, fmt(Math.round(alt / 10) * 10, 0));
    const hd = (A.hdg / D2R + 360) % 360, yh = -.195; x.save(); x.beginPath(); x.rect(tcx(-.055), tcy(yh + .03), tcx(.055) - tcx(-.055), .06 * PXT); x.clip();
    for (let a = Math.floor((hd - 15) / 5) * 5; a <= hd + 15; a += 5) { const xx = (a - hd) * .055 / 15, big = a % 10 === 0; line(xx, yh, xx, yh + (big ? .007 : .004)); if (big) text(pad(((a % 360) + 360) % 360 / 10, 2), xx, yh + .016, 'center', 22); }
    x.restore(); x.beginPath(); x.moveTo(tcx(0), tcy(yh - .001)); x.lineTo(tcx(-.004), tcy(yh - .008)); x.lineTo(tcx(.004), tcy(yh - .008)); x.closePath(); x.fill();
    // numbers: G (top left), Mach / AOA under the speed scale, vertical speed / radar altitude under the altitude scale
    text('G ' + fmt(h.g, 1), -.125, .03, 'left', 26); text('M ' + fmt(h.mach, 2), -.125, -.145, 'left', 24); text('α ' + fmt(h.aoa, 1), -.125, -.162, 'left', 24);
    text('VS ' + fmt((h.vs || 0) * FT * 60, 0), .125, -.145, 'right', 24); if ((h.agl || 0) * FT < 5000) text('R ' + pad((h.agl || 0) * FT, 5), .125, -.162, 'right', 24);
    if (h.stall) text('STALL', 0, -.12, 'center', 30); if (h.crash) text('CRASH', 0, -.12, 'center', 30);
    ht.needsUpdate = true; }

  // ── per frame (after gfx.update): Pp = the draw pose (W), t = time (ms)
  const vS = new THREE.Vector3();
  function update(Pp, t) { const ck = gfx.cockpit; const on = stats.on && !!ck && ck.visible; group.visible = on;
    if (!on) return;
    if (!dof) findDofs(ck);
    const h = core.hud, A = attitude(Pp), e = (h.eng && h.eng[0]) || {}, est = engineEst(e);
    const se = vS.copy(F.sun()).normalize().dot(vU), dl = clamp((se + .1) / .2, 0, 1); hudU.uB.value = 1.1 + .6 * dl;   /* HUD brighter by day */
    // BMS moving parts (signs: see the header)
    const ft = (h.altMSL || 0) * FT, hdg = A.hdg;
    rot(102, -ASI((h.ias || 0) * KT));
    rot(105, -ALT(((Math.abs(ft) % 1000) + 1000) % 1000)); digits([111, 112, 113], Math.abs(ft) / 100, true);
    digits([172, 171, 170, 169], 2992, false, -1);   /* barometric setting 29.92 in Hg (these drums turn the other way) */
    rot(100, A.roll); rot(101, A.pitch); rot(103, A.roll); rot(104, A.pitch);   /* ADI + standby ADI: roll (outer gimbal), pitch (inner) */
    rot(114, hdg); rot(115, -COURSE * D2R); rot(116, -COURSE * D2R); digits([122, 123, 124], COURSE);   /* HSI card; course arrow + heading bug ride on it (children); course window */
    rot(108, -hdg);   /* standby compass card */
    rot(132, (h.aoa || 0) * .012); rot(133, -clamp((h.vs || 0) * FT * 60, -6500, 6500) / 13800);   /* AOA / VVI drums, measured on frames: 0.012 rad per degree; 13 800 ft/min per rad (0.1 / 0.2 / 0.4 rad -> 1 370 / 2 700 / 5 590) */
    rot(130, -RPM(est.rpm)); rot(131, -FTIT(est.ftit)); rot(129, -NOZ(est.noz)); rot(128, -OIL(est.oil)); rot(134, -HYD(est.hyd)); rot(135, -HYD(est.hyd));
    const lb = (h.fuel || 0) * LB; rot(142, -FUEL(lb / 2)); rot(143, -FUEL(lb / 2)); digits([137, 138, 139, 140, 141], lb);   /* pointers AL / FR = half each (ESTIMATE: one tank), totaliser */
    digits([125, 126, 127], (h.ff || 0) * 7936.64 / 100);   /* fuel flow window: 3 drums x 100 pph */
    // HUD every frame; displays at their own rate, at most two per frame
    let t0 = performance.now(); if (++hudN % hudEvery === 0) drawHud(h, A); stats.hudMs += (performance.now() - t0 - stats.hudMs) * .05;
    t0 = performance.now(); let n = 0; const now = performance.now();
    for (const d of displays) { if (n >= 2) break; if (now - d.last < 1000 / (d.hz * dynK)) continue; d.last = now; d.draw(d.x, h, t); d.t.needsUpdate = true; n++; stats.uploads++; }
    stats.dynMs += (performance.now() - t0 - stats.dynMs) * .05; stats.frames++; }

  return { group, update, stats, mfd, PAGES, hudCanvas: hc, get dofs() { return dof; }, set on(v) { stats.on = !!v; }, get on() { return stats.on; },
    dispose() { removeEventListener('keydown', onKey); gfx.model.remove(group); } };
}
