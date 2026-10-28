/* The Earth view of the 3D module, cinematic (three.js r170, MIT, bundled in lib/three/): NASA Blue Marble / Black Marble + clouds (today's from
   NOAA GMGSI or the NASA composite), ray-marched air, volumetric OVATION aurora + curtains, HD close-ups (Sentinel-2 cloudless by EOX + Terrarium
   relief), water with sky + glint + waves, NASA SVS star map, studio light or the real Sun. Same interface as the old earth3d.js:
   Earth3D.create(host, { places: [{name, lat, lon}], time: () => ms, onBack, onOut, quality, storm, paused }) → { show(lat, lon, far), hide(), setTime(), flyTo(), setPlaces() }
   Preview page: web/earthprev/. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { createSolar } from './solar.js';

const tr = (s, o) => window.T ? window.T(s, o) : String(s).replace(/\{(\w+)\}/g, (m, k) => o && o[k] != null ? o[k] : m);
const D2R = Math.PI / 180, BASE = new URL('./', import.meta.url).href, T = BASE + 'img/earth/';
const CSS = `.e3g{position:absolute;inset:0;display:none;background:#000;overflow:hidden}.e3g.on{display:block}.e3g canvas{position:absolute;left:0;top:0;z-index:0;display:block;touch-action:none;opacity:0;transition:opacity 1s}.e3g canvas.on{opacity:1}
.e3g-go,.e3g-nav{position:absolute;z-index:2;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:6px}.e3g-go{left:10px}.e3g-nav{right:10px}
.e3g-go button,.e3g-nav button{width:40px;height:40px;padding:0;border-radius:50%;font-size:16px;display:grid;place-items:center}.e3g-nav svg{transition:transform .1s linear}
.e3g-bl{position:absolute;z-index:3;left:58px;top:50%;transform:translateY(-50%);list-style:none;margin:0;padding:6px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(10,14,20,.92);display:grid;gap:2px}.e3g-bl[hidden]{display:none}
.e3g-bl button{width:100%;text-align:left;border:0;background:none;border-radius:8px;min-height:32px;padding:6px 12px}.e3g-bl button:hover,.e3g-bl button[aria-current=true]{background:rgba(57,255,158,.14)}
.e3g-lay{position:absolute;z-index:3;left:10px;bottom:30px}.e3g-lp{position:absolute;left:48px;bottom:0;width:250px;padding:8px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(10,14,20,.92);display:flex;flex-direction:column;gap:6px}.e3g-lp[hidden]{display:none}
.e3g-lp>button,.e3g-row button{text-align:left}.e3g-row{display:flex;gap:6px}.e3g-row button{flex:1}
.e3g-time{position:absolute;z-index:2;left:50%;bottom:30px;transform:translateX(-50%);width:max-content;display:flex;gap:6px;align-items:center;max-width:calc(100% - 140px);flex-wrap:wrap;justify-content:center}
.e3g.nf .eo{display:none}
.e3g button,.e3g-date{border:1px solid rgba(255,255,255,.18);background:rgba(10,14,20,.78);color:#E6EBF1;border-radius:999px;padding:7px 12px;min-height:36px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}
.e3g-date{padding:6px 10px;color-scheme:dark}.e3g button[aria-pressed=true]{border-color:#39FF9E;color:#39FF9E}
.e3g-tod{display:flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.18);background:rgba(10,14,20,.78);color:#FFE600;border-radius:999px;padding:0 12px;min-height:36px;font:600 12px Inter,system-ui,sans-serif}
.e3g-tod input{width:170px;accent-color:#FFB020}.e3g-tod button{border:0;background:none;color:#E6EBF1;font:700 16px Inter,system-ui,sans-serif;padding:0 4px;min-height:30px;cursor:pointer;user-select:none;touch-action:none}.e3g-tod button:hover{color:#FFE600}.e3g-tod span{color:#E6EBF1;min-width:86px;font-variant-numeric:tabular-nums}
.e3g-alt{position:absolute;z-index:2;left:12px;top:56px;font:700 15px Inter,system-ui,sans-serif;color:#FFE600;text-shadow:0 1px 3px #000;pointer-events:none}
.e3g-alt small{display:block;font:500 12px Inter,system-ui,sans-serif;color:#C9D1DB}
.e3g-load{position:absolute;z-index:2;inset:0;display:grid;place-items:center;color:#8B9BAE;font:600 12px 'JetBrains Mono',monospace;letter-spacing:.08em;pointer-events:none}
.e3g-pnl{position:absolute;z-index:3;right:58px;top:50%;transform:translateY(-50%);width:240px;padding:12px 14px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(10,14,20,.9);color:#E6EBF1;font:600 12px Inter,system-ui,sans-serif;display:flex;flex-direction:column;gap:10px}.e3g-pnl[hidden]{display:none}
@media (max-width:640px){.e3g-go,.e3g-nav{gap:4px}.e3g-go button,.e3g-nav button{width:36px;height:36px}.e3g-time{left:56px;right:10px;transform:none;max-width:none;width:auto;justify-content:flex-end}.e3g-tod input{width:96px}.e3g-tod span{min-width:0}.e3g-lp{width:min(250px,calc(100vw - 40px))}.e3g-pnl{width:min(240px,calc(100% - 120px))}}
.e3g-info{position:absolute;z-index:3;right:58px;top:104px;width:264px;max-height:calc(100% - 190px);overflow:auto;padding:12px 14px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(10,14,20,.92);color:#E6EBF1;font:500 13px/1.45 Inter,system-ui,sans-serif;display:flex;flex-direction:column;gap:10px}.e3g-info[hidden]{display:none}
.e3g-ih{display:flex;justify-content:space-between;align-items:center}.e3g-ih b{font-size:17px}.e3g-ih button{width:30px;height:30px;padding:0;border-radius:50%}
.e3g-if{display:grid;grid-template-columns:1fr 1fr;gap:6px}.e3g-if div{background:rgba(255,255,255,.06);border-radius:8px;padding:6px 8px}.e3g-if small{display:block;color:#8B9BAE;font-size:11px}
.e3g-im{border-left:2px solid #39FF9E;padding-left:8px;color:#C8D2DC}.e3g-iph small{color:#8B9BAE;font-size:11px}.e3g-iph div{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:4px}
.e3g-iph a{position:relative;display:block;aspect-ratio:1;border-radius:6px;overflow:hidden;background:rgba(255,255,255,.06)}.e3g-iph img{width:100%;height:100%;object-fit:cover}.e3g-iph span{position:absolute;left:0;right:0;bottom:0;color:#fff;font-size:10.5px;padding:1px 4px;background:rgba(0,0,0,.6)}
.e3g-ib{display:flex;gap:6px}.e3g-ib button{flex:1}
@media (max-width:640px){.e3g-info{left:56px;right:56px;width:auto;top:auto;bottom:76px;max-height:45%}}
.e3g-pnl label{display:grid;grid-template-columns:64px 1fr;align-items:center;gap:8px}.e3g-pnl input{accent-color:#39FF9E;width:100%}.e3g-pnl button{align-self:flex-end}.e3g-pnl small{font-weight:500;color:#8B9BAE}
.e3g-find{position:absolute;z-index:3;right:10px;top:56px;width:280px;font:600 13px Inter,system-ui,sans-serif}.e3g-find input{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.18);background:rgba(10,14,20,.85);color:#E6EBF1;border-radius:999px;padding:9px 14px;min-height:38px;font:inherit;outline:none}.e3g-find input:focus{border-color:#39FF9E}
.e3g-find ul{list-style:none;margin:6px 0 0;padding:4px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(10,14,20,.94);max-height:300px;overflow:auto}.e3g-find ul:empty{display:none}.e3g-find li{padding:8px 10px;border-radius:8px;cursor:pointer;color:#E6EBF1}.e3g-find li small{display:block;font-weight:500;color:#8B9BAE}.e3g-find li:hover,.e3g-find li[aria-selected=true]{background:rgba(57,255,158,.14)}
@media (max-width:640px){.e3g-find{right:auto;left:12px;top:104px;width:calc(100% - 80px)}}
.e3g-pl{position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden}.e3g-pl span{position:absolute;left:0;top:0;font:700 12px Inter,system-ui,sans-serif;text-shadow:0 1px 3px #000,0 0 2px #000;white-space:nowrap;opacity:0;transition:opacity .25s}
.e3g-ms{position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden}.e3g-ms span{position:absolute;left:0;top:0;padding:2px 7px;border-radius:4px;background:rgba(0,0,0,.55);font:700 11px Inter,system-ui,sans-serif;color:#8FD3FF;white-space:nowrap;opacity:0;transition:opacity .25s}.e3g-ms span:nth-child(1){color:#F3E6D2}.e3g-ms span:nth-child(4){color:#C9B8FF}.e3g-ms span:nth-child(5){color:#96C8FF}.e3g-ms span:nth-child(6){color:#DCE3EB}.e3g-ms span:nth-child(7){color:#8E9AAB;font-weight:500}
.e3g-attr{position:absolute;z-index:2;right:10px;bottom:6px;font:500 10px Inter,system-ui,sans-serif;color:rgba(220,227,235,.7);text-shadow:0 1px 2px #000;pointer-events:none;max-width:55%;text-align:right}`;

// sub-solar point (low precision is plenty for day / night) → direction in the Earth's own frame (x = lon 0, y = north, z = lon −90°)
function sunDir(t) { const d = new Date(t), doy = (t - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5, dec = 23.44 * Math.sin(2 * Math.PI * (doy - 81) / 365.25);
  const B = 2 * Math.PI * (doy - 81) / 364, eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B), lon = (12 - d.getUTCHours() - d.getUTCMinutes() / 60 - eot / 60) * 15;
  const a = dec * D2R, b = lon * D2R; return new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b)); }

function create(host, opts) {
  if (!document.getElementById('e3g-css')) { const st = document.createElement('style'); st.id = 'e3g-css'; st.textContent = CSS; document.head.appendChild(st); }
  const el = document.createElement('div'); el.className = 'e3g'; host.appendChild(el);
  el.innerHTML = `<div class="e3g-find eo"><input type="search" data-k="find" placeholder="🔍 ${tr('Search a place or lat, lon')}" aria-label="${tr('Search a place or lat, lon')}" autocomplete="off"><ul role="listbox"></ul></div><div class="e3g-load">${tr('Loading the Earth…')} 0%</div><div class="e3g-alt">–</div>
    <div class="e3g-go"><button data-k="home" aria-label="${tr('Earth')}" title="${tr('Earth')}">🌍</button><button data-k="sys" aria-label="${tr('Solar system')}" title="${tr('Solar system')}">☀</button><button data-k="bodies" aria-expanded="false" aria-label="${tr('Go to')}" title="${tr('Go to')}">🪐</button></div>
    <ul class="e3g-bl" hidden>${['Sun', 'Mercury', 'Venus', 'Earth', 'Moon', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'].map(n => `<li><button data-b="${n}">${tr(n)}</button></li>`).join('')}</ul>
    <div class="e3g-lay"><button data-k="layers" aria-expanded="false">☰ ${tr('Layers')} ▾</button><div class="e3g-lp" hidden>
      <button class="eo" data-k="cl" aria-pressed="true">${tr('Clouds')}</button><button class="eo" data-k="cn" aria-pressed="false">${tr('Clouds: NASA')}</button><button class="eo" data-k="au" aria-pressed="true">${tr('Aurora')}</button>
      <div class="e3g-row eo"><button data-k="ms" aria-pressed="false">🧲 ${tr('Magnetic shield')}</button><button data-k="cme">💥 ${tr('CME impact')}</button></div>
      <button data-k="sun" aria-pressed="false">${tr('Real Sun')}</button><button data-k="sp" aria-pressed="true">${tr('Auto-rotate')}</button><button data-k="rs" aria-pressed="false">${tr('Real scale')}</button><button data-k="gd" aria-pressed="false">${tr('Names and orbits')}</button><button data-k="sw" aria-pressed="false">${tr('Solar wind + CMEs')}</button><div class="e3g-row"><button data-k="sf" aria-pressed="false">${tr('Sun’s magnetic field')}</button><button data-k="dw" aria-pressed="false">🌀 ${tr('Without the solar wind')}</button></div></div></div>
    <div class="e3g-time"><input type="datetime-local" class="e3g-date" data-k="date" aria-label="${tr('Date and time')}"><button data-k="now">${tr('Now')}</button>
      <div class="e3g-tod eo" title="${tr('Time of day here (local Sun time)')}">☀<button data-k="todB" aria-label="${tr('Earlier')}">‹</button><input type="range" data-k="tod" min="0" max="1435" step="5" aria-label="${tr('Time of day here (local Sun time)')}"><button data-k="todF" aria-label="${tr('Later')}">›</button><span></span></div></div>
    <div class="e3g-nav"><button data-k="ang" aria-pressed="false" aria-label="${tr('Tilt')} / ${tr('Heading')}">∠</button><button data-k="cmp" aria-label="${tr('Reset to north')}"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3l4 9h-8z" fill="#FF4D4D"/><path d="M12 21l-4-9h8z" fill="#E6EBF1"/></svg></button><button data-k="3d" aria-pressed="true" aria-label="${tr('3D view')}">3D</button><button data-k="zout" aria-label="${tr('Zoom out')}">−</button><button data-k="zin" aria-label="${tr('Zoom in')}">+</button></div>
    <div class="e3g-info" hidden aria-live="polite"></div>
    <div class="e3g-pnl" hidden><label>${tr('Tilt')}<input type="range" data-s="tilt" min="0" max="100" value="100"></label><label>${tr('Heading')}<input type="range" data-s="head" min="-180" max="180" value="0"></label><button data-k="north">${tr('Reset to north')}</button><small>${tr('Shift + drag or right-drag: tilt and turn')}</small></div>
    <div class="e3g-attr">NASA Blue Marble · Black Marble · SVS star map · NOAA GMGSI · OVATION · ${tr('close-up')}: Sentinel-2 cloudless 2023 by EOX (CC BY-NC-SA 4.0) · Mapzen Terrarium / AWS · ${tr('Moon')}: JAXA Kaguya TC · NASA LRO LOLA (Moon Trek) · ${tr('Mars')}: MRO CTX (NASA/JPL/MSSS/Caltech Murray Lab/Esri) · Viking · MOLA / HRSC (Mars Trek)</div>`;
  let W = 800, H = 600;
  const Q = opts.quality || (document.documentElement.classList.contains('lite') ? 'low' : 'high');   // low | medium | high (light mode → low)
  const renderer = new THREE.WebGLRenderer({ antialias: Q !== 'low', powerPreference: 'high-performance' });
  // a pixel budget: big / high-dpi screens would otherwise shade 8–15 M pixels a frame through the air and aurora ray-marches
  const PXB = Q === "high" ? 4.2e6 : Q === "medium" ? 2.6e6 : 1.4e6, prCap = () => Math.min(devicePixelRatio || 1, Q === "high" ? 1.5 : 1, Math.sqrt(PXB / (W * H)));
  renderer.setPixelRatio(prCap());
  renderer.setSize(W, H); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, W / H, .01, 2000);
  camera.position.set(0, 1.1, 4.2);
  // ── the camera, like Google Earth: it looks at a point on the ground (tgt, world frame) from `rng` Earth radii away,
  // tilted `tilt` from straight down, turned `head` from north. In 3D mode the tilt grows as you come down (tk = how much of the allowed tilt).
  const Yax = new THREE.Vector3(0, 1, 0), tgt = new THREE.Vector3(0, 0, 1), cE = new THREE.Vector3(), cN = new THREE.Vector3(), cF = new THREE.Vector3(), cR = new THREE.Vector3();
  let rng = 3.2, rngTo = 3.2, head = 0, headTo = 0, tk = 1, tkTo = 1, tilt = 0, vel = [0, 0], dragAt = 0;
  const RMIN = .12 / 6371, RFAR = 5e7;   // R⊕: down to 120 m over the Earth, out to ~2 100 AU (room for the Oort cloud later)
  let focus = 'Earth', Rf = 1;   // the body the camera turns around (its radius in R⊕); ranges are in its radii
  const rMin = () => focus === 'Earth' ? RMIN : solar.hdHas(focus) ? 2000 / (Rf * 6371000) : .015, rMax = () => RFAR / Rf;
  const maxTilt = r => (1.36 + .12 * (1 - smooth(Math.log(1.5), Math.log(25), Math.log(r * 6371)))) * (1 - smooth(Math.log(250), Math.log(16000), Math.log(r * 6371)));   // ≈ 85° low over the ground, 78° at 25 km, 0 seen from far away
  const frameAt = () => { const t = tgt; cE.crossVectors(Yax, t); if (cE.lengthSq() < 1e-8) cE.set(1, 0, 0); cE.normalize(); cN.crossVectors(t, cE).normalize();
    cF.copy(cN).multiplyScalar(Math.cos(head)).addScaledVector(cE, Math.sin(head)); cR.copy(cE).multiplyScalar(Math.cos(head)).addScaledVector(cN, -Math.sin(head)); };
  const zoomBy = f => { rngTo = Math.max(rMin(), Math.min(rMax(), rngTo * f)); };
  const panBy = (dx, dy) => { const k = Math.min(rng * 2 * Math.tan(camera.fov * D2R / 2), 3) / H; frameAt();   // the ground follows the pointer; far out: at most ~half a turn per screen height
    tgt.addScaledVector(cR, -dx * k).addScaledVector(cF, dy * k / Math.max(.35, Math.cos(tilt))).normalize();
    if (Math.abs(tgt.y) > .9999) { tgt.y = Math.sign(tgt.y) * .9999; tgt.normalize(); } };
  const turnBy = (dx, dy) => { headTo += dx * .006; tkTo = Math.max(0, Math.min(1, tkTo - dy * .004)); };
  renderer.domElement.addEventListener('wheel', e => { e.preventDefault(); goal = null; zoomBy(Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 150) * .0022)); }, { passive: false });
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
  const pins = new Map(); let pinch = 0, twist = 0, midY = 0, mode = '';
  renderer.domElement.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });   // middle button = tilt + turn, not the browser's autoscroll
  let downAt = null; renderer.domElement.addEventListener('pointerup', e => { if (downAt && performance.now() - downAt[2] < 350 && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 6) { const r = renderer.domElement.getBoundingClientRect(), b = solar.pick(e.clientX - r.left, e.clientY - r.top, W, H); if (b && b.name !== focus) flyToBody(b.name); } downAt = null; });
  renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY, performance.now()]; renderer.domElement.setPointerCapture(e.pointerId); pins.set(e.pointerId, [e.clientX, e.clientY]); vel = [0, 0]; spinOff(); goal = null;
    mode = pins.size === 2 ? 'two' : (e.shiftKey || e.ctrlKey || e.button === 2 || e.button === 1) ? 'turn' : 'pan'; pinch = 0; });
  renderer.domElement.addEventListener('pointermove', e => { const o = pins.get(e.pointerId); if (!o) return; const dx = e.clientX - o[0], dy = e.clientY - o[1]; pins.set(e.pointerId, [e.clientX, e.clientY]);
    if (pins.size === 2) { const [a, b] = [...pins.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), an = Math.atan2(b[1] - a[1], b[0] - a[0]), my = (a[1] + b[1]) / 2;
      if (pinch) { zoomBy(pinch / d); let da = an - twist; da = Math.atan2(Math.sin(da), Math.cos(da)); headTo -= da; turnBy(0, (my - midY) * 1.4); } pinch = d; twist = an; midY = my; return; }   // pinch = zoom, twist = turn, both fingers up / down = tilt
    if (mode === 'turn') turnBy(dx, dy); else if (mode === 'pan') { panBy(dx, dy); vel = [dx, dy]; dragAt = performance.now(); } });
  const unpin = e => { pins.delete(e.pointerId); pinch = 0; if (!pins.size) { if (mode !== 'pan' || performance.now() - dragAt > 80) vel = [0, 0]; mode = ''; } }; renderer.domElement.addEventListener('pointerup', unpin); renderer.domElement.addEventListener('pointercancel', unpin);
  const smooth = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  
  // textures: everything loads first, then the globe fades in (never a half-built Earth)
  const mgr = new THREE.LoadingManager(), tl = new THREE.TextureLoader(mgr), aniso = renderer.capabilities.getMaxAnisotropy();
  mgr.onProgress = (u, n, total) => { el.querySelector('.e3g-load').textContent = tr('Loading the Earth…') + ` ${Math.round(n / total * 100)}%`; };
  const tex = (f, srgb) => { const t = tl.load(T + f); t.anisotropy = Q === 'low' ? 1 : Math.min(8, aniso); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const TX = { day: tex('day.jpg', true), night: tex('night.jpg', true), clouds: tex('clouds.jpg'), normal: tex('normal.jpg'), water: tex('water.png') };
  
  const U = { day: { value: TX.day }, night: { value: TX.night }, clouds: { value: TX.clouds }, nrm: { value: TX.normal }, water: { value: TX.water },
    sun: { value: new THREE.Vector3(1, 0, 0) }, rsun: { value: new THREE.Vector3(1, 0, 0) }, lightsOn: { value: 0 }, camO: { value: new THREE.Vector3() }, morph: { value: 0 }, cloudOn: { value: 1 }, cloudShift: { value: 0 },
    cloudFade: { value: 1 }, aumap: { value: null }, auOn: { value: 1 }, hdA: { value: 0 }, pxk: { value: 1000 }, wtime: { value: 0 } };
  // one light model for the globe and the close-up tiles: n = up, P = the point, N = relief normal, Nw = water-surface normal, rough = wave slope variance,
  // d = colour, w = water 0…1, g = map uv, rk = how strongly the relief shades
  // the sunlight that reaches the ground through the air (Rayleigh + Mie, the same air as the shell): white at noon, gold then red at sunrise / sunset.
  // Real Sun only (lightsOn): with the studio light the Sun is a lamp, not low in anyone's sky
  const SUNT = /* glsl */`
    uniform float lightsOn;
    vec3 sunT(float mu) { float m = max(mu, 0.) + .035; vec3 t = exp(-(vec3(12.3, 28.8, 70.6) * .0042 + 21. * 1.1 * .0011) * (1. / m - 1. / 1.035));
      return mix(vec3(1.), t * smoothstep(-.03, .02, mu) + vec3(.02, .01, .005) * (1. - smoothstep(-.03, .02, mu)), lightsOn); }`;
  const SHADE = /* glsl */`${SUNT}
    uniform sampler2D night, clouds, aumap; uniform vec3 sun, camO; uniform float morph, cloudOn, cloudShift, cloudFade, auOn;
    vec3 shade(vec3 n, vec3 P, vec3 N, vec3 Nw, float rough, vec3 d, float w, vec2 g, float rk) {
      vec3 ea = normalize(vec3(n.z, 0., -n.x) + vec3(1e-5)), no = cross(n, ea);
      vec3 Vd = camO - P; float dist = length(Vd); vec3 V = Vd / dist;
      float mu = dot(n, sun), vn = max(dot(n, V), 0.), dl = pow(smoothstep(-.02, .62, mu), 1.5);
      vec2 cu = g + vec2(cloudShift, 0.); float cf = cloudOn * cloudFade, c = smoothstep(.12, .85, texture2D(clouds, cu).r) * cf;
      float zen = clamp(sqrt(max(1. - mu * mu, 0.)) / max(mu, .08), 0., 9.);   // tan of the Sun's zenith angle
      float cs = smoothstep(.1, .8, texture2D(clouds, cu - vec2(dot(sun, ea), dot(sun, no)) * (.0006 + .00035 * zen), 2.5).r) * cf * smoothstep(-.05, .25, mu);
      float dif = dl * clamp(1. + (dot(N, sun) - mu) * rk, 1. - .5 * rk, 1. + .45 * rk);
      vec3 sT = sunT(mu), col = d * dif * 1.6 * (1. - .72 * cs) * sT;
      if (w > .001) {   // water: the sky mirrored in it (Fresnel) + the Sun's glint, spread by the wave slopes (Beckmann / Cox–Munk)
        vec3 Hh = normalize(sun + V); float nh = max(dot(Nw, Hh), .01), nv = max(dot(Nw, V), .03), nl = dot(Nw, sun);
        float F = .02 + .98 * pow(1. - max(dot(V, Hh), 0.), 5.), Fv = .02 + .98 * pow(1. - nv, 5.), c2 = nh * nh;
        float Dm = exp((c2 - 1.) / (c2 * rough)) / (3.1416 * rough * c2 * c2);
        vec3 skyc = vec3(.22, .42, .9) * smoothstep(-.04, .35, mu) * .45;   // no sky to mirror at night
        col = mix(col, col * (1. - Fv) + skyc * Fv, w);
        col += vec3(1., .94, .82) * sT * min(5. * F * Dm / (4. * nv), 6.) * smoothstep(0., .06, nl) * w * (1. - c) * (1. - .8 * cs) * (.35 + .65 * lightsOn) * smoothstep(-.02, .1, mu);
      }
      // aerial perspective: a blue veil, thicker toward the edge and with distance (Google-Earth look); clear right under you
      float hz = (.08 + .3 * pow(1. - vn, 2.)) * (1. - exp(-dist * 40.));
      col = mix(col, vec3(.36, .58, 1.) * 1.05 * max(mu * .9 + .1, 0.) * mix(vec3(1.), sT * vec3(1.6, 1.2, 1.), lightsOn * (1. - smoothstep(.1, .5, mu))), hz * dl * (1. - morph * .7));   // the veil turns warm at dusk
      float deep = 1. - smoothstep(-.32, -.05, mu);   // city lights only where it is really night, not at dusk
      vec3 lights = pow(texture2D(night, g).rgb, vec3(1.35)) * vec3(1., .8, .55) * 1.5 * deep * lightsOn * (1. - c * .75);
      // the aurora above lights the ground and the clouds under it a little — green, only in the dark
      float av = texture2D(aumap, vec2(fract(g.x + .5), g.y), 2.).r * auOn * (1. - smoothstep(-.2, .05, mu));
      col += vec3(.1, 1., .35) * av * (.12 * dot(d, vec3(.33)) + .05 * c);
      return col + lights; }`;
  // one vertex shader for every layer: the globe, or (morph → 1) the flat map in front of the camera
  const VS = /* glsl */`
    uniform float morph; varying vec2 vUv; varying vec3 vO; varying vec3 vW;
    void main() { vUv = uv; vO = normalize(position);
      vec3 w3 = (modelMatrix * vec4(position, 1.)).xyz, w2 = vec3((uv.x - .5) * 3.1416 * 2., (uv.y - .5) * 3.1416, 0.);
      vW = mix(w3, w2, morph); gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }`;
  const earthMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: /* glsl */`
    uniform sampler2D day, nrm, water; varying vec2 vUv; varying vec3 vO; ${SHADE}
    void main() {
      vec3 n = normalize(vO), ea = normalize(vec3(n.z, 0., -n.x) + vec3(1e-5)), no = cross(n, ea);
      vec3 tn = texture2D(nrm, vUv).xyz * 2. - 1., N = normalize(ea * tn.x * .45 + no * tn.y * .45 + n * tn.z);
      vec3 d = texture2D(day, vUv).rgb; float w = texture2D(water, vUv).r;
      d = mix(d, vec3(.02, .085, .3), w * .6) * 1.08 + .01;   // oceans a clean mid blue, land a little lifted
      gl_FragColor = vec4(shade(n, n, N, n, .045, d, w, vUv, .9), 1.); }` });
  const geo = new THREE.SphereGeometry(1, Q === 'low' ? 96 : 192, Q === 'low' ? 48 : 96), earth = new THREE.Mesh(geo, earthMat);
  earth.rotation.y = -Math.PI / 2;   // lon 0 faces +z, like the map
  scene.add(earth);
  // clouds: their own layer just above the ground — puffy relief from the cloud density, bright tops toward the Sun, dark undersides
  const cloudMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, transparent: true, depthWrite: false, fragmentShader: /* glsl */`
    uniform sampler2D clouds, aumap; uniform vec3 sun, camO; uniform float morph, cloudOn, cloudShift, cloudFade, auOn; varying vec2 vUv; varying vec3 vO; ${SUNT}
    float C(vec2 u) { return smoothstep(.1, .85, texture2D(clouds, u).r); }
    float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
    void main() { vec3 n = normalize(vO), ea = normalize(vec3(n.z, 0., -n.x) + vec3(1e-5)), no = cross(n, ea);
      vec2 u = vUv + vec2(cloudShift, 0.), e = vec2(1. / 4096., 1. / 2048.);
      // close up the map is ~10 km a pixel: fine detail from noise erodes the edges and puffs the tops (the shapes stay the real ones); off when far
      float tx = length(fwidth(u * vec2(4096., 2048.))), kd = smoothstep(1.2, .2, tx), cd = 0.;
      if (kd > 0.) { vec2 p = u * vec2(4096., 2048.) * .45; float a = .5; for (int i = 0; i < 5; i++) { cd += a * (n2(p) - .5); p = p * 2.07 + vec2(1.7, 9.2); a *= .5; } cd *= kd; }
      float b0 = texture2D(clouds, u).r, c = smoothstep(.1, .85, b0 + cd * .7 * sqrt(b0)) * cloudOn * cloudFade; if (c < .004) discard;
      float gx = C(u + vec2(e.x, 0.)) - C(u - vec2(e.x, 0.)), gy = C(u + vec2(0., e.y)) - C(u - vec2(0., e.y));
      vec3 N = normalize(n - (ea * gx + no * gy) * 4.5);
      float self = smoothstep(.1, .85, texture2D(clouds, u + vec2(dot(sun, ea), dot(sun, no)) * .0012, 1.5).r) * cloudOn; float mu = dot(n, sun), lit = pow(smoothstep(-.02, .62, mu), 1.5) * clamp(1. + (dot(N, sun) - mu) * .7, .6, 1.3) * (1. - .35 * max(self - c, 0.) - .2 * c * c), V = max(dot(n, normalize(camO - n)), 0.);
      lit *= 1. + cd * .45;   // puffy light and shade inside the clouds
      vec3 col = mix(vec3(.5, .56, .68), vec3(1.04, 1.03, 1.) * sunT(mu), lit) * (lit * 1.25 + .002);   // pink and gold clouds at sunrise
      col = mix(col, vec3(.36, .58, 1.) * 1.05 * max(mu * .9 + .1, 0.), (.06 + .25 * pow(1. - V, 2.)) * smoothstep(-.3, .45, mu));
      col += vec3(.1, 1., .35) * texture2D(aumap, vec2(fract(vUv.x + .5), vUv.y), 2.).r * auOn * (1. - smoothstep(-.2, .05, mu)) * .07;   // lit green from the aurora above
      gl_FragColor = vec4(col * c, c * (1. - morph * .2)); }` });
  cloudMat.blending = THREE.CustomBlending; cloudMat.blendSrc = THREE.OneFactor; cloudMat.blendDst = THREE.OneMinusSrcAlphaFactor;   // premultiplied
  const cloudLayer = new THREE.Mesh(new THREE.SphereGeometry(1.0035, Q === 'low' ? 96 : 192, Q === 'low' ? 48 : 96), cloudMat); cloudLayer.rotation.y = -Math.PI / 2; cloudLayer.renderOrder = 2; scene.add(cloudLayer);
  
  // the air: single-scattering Rayleigh + Mie, ray-marched through a shell (the real reason the limb is blue and dusk is orange)
  const AIR_R = 1.025, STEPS = Q === 'low' ? 6 : Q === 'medium' ? 8 : 10;
  const air = { visible: true };   // the air is a full-screen pass after the scene (see airPass), so it can stop at the real ground
  const AIRFS = /* glsl */`
    uniform sampler2D tDiffuse, tDepth; uniform mat4 projInv, camW; uniform mat3 toObj; uniform vec2 cn; uniform vec3 sun, camO; uniform float morph; varying vec2 vUv;
    const float RA = ${AIR_R.toFixed(4)}, HR = .0042, HM = .0011, G = .76;
    const vec3 BR = vec3(12.3, 28.8, 70.6); const float BM = 21.;
    vec2 hit(vec3 o, vec3 d, float r) { float b = dot(o, d), c = dot(o, o) - r * r, h = b * b - c; if (h < 0.) return vec2(1e9, -1e9); h = sqrt(h); return vec2(-b - h, -b + h); }
    vec2 depthTo(vec3 p) {   // optical depth toward the Sun, analytic (Chapman-like): scale height over the slant of the path
      float h = max(length(p) - 1., 0.), c = dot(normalize(p), sun); vec2 H = vec2(HR, HM);
      return H * exp(-h / H) / (max(c, 0.) + .035); }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv); vec4 v = projInv * vec4(vUv * 2. - 1., 1., 1.); vec3 dv = normalize(v.xyz / v.w);
      vec3 o = camO, d = normalize(toObj * (mat3(camW) * dv)); vec2 a = hit(o, d, RA); if (a.x > a.y || a.y < 0.) { gl_FragColor = base; return; }
      // the air ends where the picture's ground is (mountains included), not at the sea-level ball: from the depth of the pixel
      float z = texture2D(tDepth, vUv).x, ts = 1e9; if (z < 1.) { float vz = 2. * cn.x * cn.y / ((cn.y + cn.x) - (z * 2. - 1.) * (cn.y - cn.x)); ts = vz / max(-dv.z, 1e-4); }
      vec2 g = hit(o, d, 1.); float t0 = max(a.x, 0.), t1 = min(g.x > 0. && g.x < a.y ? g.x : a.y, ts); if (t1 <= t0) { gl_FragColor = base; return; }
      float L = (t1 - t0) / float(${STEPS});
      vec3 sr = vec3(0.), sm = vec3(0.); vec2 odC = vec2(0.);
      float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));   // a different start in each pixel: no steps that line up into bands
      for (int i = 0; i < ${STEPS}; i++) { vec3 p = o + d * (t0 + (float(i) + j) * L); float h = max(length(p) - 1., 0.);
        vec2 den = exp(-h / vec2(HR, HM)) * L; odC += den;
        // the Earth's shadow, soft and continuous: the Sun's height seen from that point against its horizon (lower the higher you are; refraction + the
        // Sun's disc blur the edge ±0.7°); and since our air is
        // ~3× thicker than the real one (so the limb shows), its light also fades over ~10° past the day-night line instead of ending in a hard band
        float rp = length(p), el = asin(clamp(dot(p, sun) / rp, -1., 1.)), dip = acos(min(1. / rp, 1.)), lit = smoothstep(-dip - .012, -dip + .012, el) * smoothstep(-.17, .03, el);
        if (lit <= 0.) continue;
        den *= vec2(lit, lit);
        vec2 odS = depthTo(p); vec3 tr = exp(-(BR * (odC.x + odS.x) + BM * 1.1 * (odC.y + odS.y)));
        sr += tr * den.x; sm += tr * den.y; }
      float mu = dot(d, sun), pr = .0596831 * (1. + mu * mu), pm = .1193662 * (1. - G * G) * (1. + mu * mu) / ((2. + G * G) * pow(1. + G * G - 2. * G * mu, 1.5));
      pm = pm * .88 + .12 * .0795775 * (1. - .9409) / pow(1. + .9409 - 1.94 * mu, 1.5);   // + the aerosols' narrow forward peak: the limb lights up round the Sun like in orbit photos
      vec3 col = 7. * (sr * BR * pr + sm * BM * pm);
      gl_FragColor = vec4(base.rgb + col * (1. - morph), 1.); }`;
  // the Sun itself (Real Sun only): a disc 0.53° wide with limb darkening + a soft glow, seen through the air in front of it — white from space, orange
  // to red at sunset; hidden behind the Earth only a faint glow round the limb is left. A quad 16° wide far away, facing the camera; the Earth hides it by depth.
  const SUNLIB = `
      const float RA = ${AIR_R.toFixed(4)}, HR = .0042, HM = .0011, RD = .004653; const vec3 BR = vec3(12.3, 28.8, 70.6); const float BM = 21.;
      vec2 hit(vec3 o, vec3 d, float r) { float b = dot(o, d), c = dot(o, o) - r * r, h = b * b - c; if (h < 0.) return vec2(1e9, -1e9); h = sqrt(h); return vec2(-b - h, -b + h); }
      vec3 trans(vec3 o, vec3 d) { vec2 a = hit(o, d, RA); if (a.y <= 0.) return vec3(1.); float t0 = max(a.x, 0.), L = (a.y - t0) / 12.; vec2 od = vec2(0.);
        for (int i = 0; i < 12; i++) { vec3 p = o + d * (t0 + (float(i) + .5) * L); od += exp(-max(length(p) - 1., 0.) / vec2(HR, HM)) * L; }
        return exp(-(BR * od.x + BM * 1.1 * od.y)); }`;
  const SUNA = 8 * D2R, sunQ = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: { sun: U.sun, camO: U.camO, toObj: { value: new THREE.Matrix3() } },
    vertexShader: `varying vec3 vW; varying vec2 vQ; void main() { vQ = position.xy; vW = (modelMatrix * vec4(position, 1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }`,
    fragmentShader: `uniform vec3 sun, camO; uniform mat3 toObj; varying vec3 vW; varying vec2 vQ;
${SUNLIB}
      void main() { vec3 d = normalize(toObj * normalize(vW - cameraPosition)); float r = acos(clamp(dot(d, sun), -1., 1.)), x = r / RD;
        float disc = smoothstep(1.08, .92, x) * (1. - .6 * (1. - sqrt(max(1. - x * x, 0.))));
        float ang = acos(clamp(dot(sun, -normalize(camO)), -1., 1.)), er = asin(min(1. / length(camO), 1.)), vis = smoothstep(er - RD, er + RD, ang);   // how much of the disc clears the Earth
        // a tight glare like a camera sees it: bright close to the disc, falling fast, + six faint rays (camera-aligned); no wide grey fog in a vacuum
        float ph = atan(vQ.y, vQ.x), k = floor(ph * 1.9099 + .5), ln = .008 + .03 * fract(sin(k * 12.9898 + 4.1) * 43758.55);   // 12 thin rays, each its own length
        float ray = pow(abs(cos(6. * ph)), 220.) * exp(-r / ln) * .45 * vis * vis;
        float glow = (1.4 * exp(-r / .0022) + .22 * exp(-r / .009) + .035 * exp(-r / .04) + ray) * mix(.1, 1., vis) * smoothstep(${SUNA.toFixed(4)}, ${(SUNA * .5).toFixed(4)}, r);
        // the disc is ~100 000× brighter than the sky: even through the thick air at sunset (a few % gets through, mostly red) it stays a clear red-orange disc;
        // the clean pass caps the brightness keeping the colour. The glare is light already scattered, so it dims less (sqrt)
        vec3 tr = trans(camO, d), c = vec3(1., .98, .95) * disc * 400. * tr + vec3(1., .9, .76) * glow * sqrt(tr);
        gl_FragColor = vec4(c, 1.); }`, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sunQ.renderOrder = 2; sunQ.frustumCulled = false; scene.add(sunQ);
  // the crisp disc on top of the finished picture (after the bloom, which would melt a 0.5° disc into a blob): red-orange through the air at the horizon,
  // white from space, limb-darkened; hidden by the Earth's ball (mountains do not hide it)
  const sunDepth = { value: null }, sunRes = { value: new THREE.Vector2(1, 1) };   // the scene's depth (filled by the air pass each frame): mountains hide the disc too
  const sunScene = new THREE.Scene(), sunD = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: { ...sunQ.material.uniforms, tDepth: sunDepth, res: sunRes },
    vertexShader: sunQ.material.vertexShader, fragmentShader: `uniform vec3 sun, camO; uniform mat3 toObj; uniform sampler2D tDepth; uniform vec2 res; varying vec3 vW; varying vec2 vQ; ${SUNLIB}
      void main() { if (texture2D(tDepth, gl_FragCoord.xy / res).r > .5) discard; vec3 d = normalize(toObj * normalize(vW - cameraPosition)); float x = acos(clamp(dot(d, sun), -1., 1.)) / RD, px = max(fwidth(x), .02);
        float cov = smoothstep(1. + px, 1. - px, x); if (cov <= 0.) discard;
        float b = dot(camO, d), cd = sqrt(max(dot(camO, camO) - b * b, 0.)), vis = b < 0. ? smoothstep(1.00005, 1.0004, cd) : 1.;
        vec3 tr = trans(camO, d); float m = max(tr.r, max(tr.g, tr.b)), a = cov * vis * clamp(m * 300., 0., 1.);
        float ld = 1. - .4 * (1. - sqrt(max(1. - x * x, 0.)));
        vec3 hue = pow(tr / max(m, 1e-6), vec3(1. / 2.2)), col = mix(hue, vec3(1., .97, .9), .55 * ld * ld) * ld;   // white-gold middle, the air's colour toward the rim
        gl_FragColor = vec4(col * a, 1.); }`, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));   // added on top: always the brightest thing
  sunD.frustumCulled = false; sunScene.add(sunD);
  const sunW = new THREE.Vector3();
  
  // aurora, from NOAA OVATION (both hemispheres): (1) a diffuse plasma glow painted from the probability map, shimmering,
  // (2) continuous curtains along the oval — a sharp bright green lower edge ~100 km, rays, folds that drift, red tops
  const AU = { time: { value: 0 }, auB: { value: 1 } };   // auB: brighter during a CME hit
  const NOISE = /* glsl */`float hs(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hs(i), hs(i + vec2(1, 0)), f.x), mix(hs(i + vec2(0, 1)), hs(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * vn(p); p *= 2.03; a *= .5; } return s; }`;
  // (1) the diffuse glow as real light in a volume: emission between 85 and 330 km, ray-marched — green oxygen 557.7 nm peaking ~110 km with a sharp
  // bottom (Chapman profile), red oxygen 630 nm high up ~230 km, a faint violet N2+ fringe at the very bottom. Seen from above it is a soft veil,
  // at the limb the long path makes the bright layered band; it only adds light, so over the night side it melts into the dark
  const AU_LO = 1 + 85 / 6371, AU_HI = 1 + 520 / 6371, AUS = Q === "low" ? 48 : Q === "medium" ? 72 : 96;   // max steps; each ray takes ~25 km steps
  const glow = new THREE.Mesh(new THREE.SphereGeometry(AU_HI, 160, 80), new THREE.ShaderMaterial({ uniforms: { ...U, ...AU }, vertexShader: VS, transparent: true, side: THREE.BackSide, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fragmentShader: /* glsl */`
    uniform sampler2D aumap; uniform vec3 rsun, camO; uniform float time, morph, auB; varying vec3 vO; ${NOISE}
    const float RI = ${AU_LO.toFixed(5)}, RO = ${AU_HI.toFixed(5)};
    vec2 hit(vec3 o, vec3 d, float r) { float b = dot(o, d), c = dot(o, o) - r * r, h = b * b - c; if (h < 0.) return vec2(1e9, -1e9); h = sqrt(h); return vec2(-b - h, -b + h); }
    vec3 em(vec3 p) { float r = length(p); vec3 n = p / r; float h = (r - 1.) * 6371.;
      float lat = asin(clamp(n.y, -1., 1.)), lon = atan(-n.z, n.x);
      float v = texture2D(aumap, vec2(fract(lon / 6.2831853 + 1.), lat / 3.1415927 + .5)).r; if (v < .004) return vec3(0.);
      float zg = (h - 110.) / 15., zr = (h - 230.) / 50., zb = (h - 97.) / 7.;
      float g = exp(1. - zg - exp(-zg)), rd = exp(1. - zr - exp(-zr)), b = exp(-zb * zb);
      float arcs = (.7 + .6 * vn(vec2(lon * 6. - time * .12, lat * 22. + sin(lon * 3. + time * .2) * .6))) * (.85 + .15 * sin(time * .5 + lon * 4.));   // broad brighter arcs that drift and breathe slowly
      float dark = (1. - smoothstep(-.16, .06, dot(n, rsun))) * (1. - smoothstep(380., 500., h));   // daylight outshines it; the red tail fades out before the top
      return (vec3(.12, 1., .38) * g + vec3(1., .1, .16) * rd * (.06 + .14 * v) + vec3(.55, .3, 1.) * b * .35 * v) * v * arcs * dark; }
    void main() {
      vec3 o = camO, d = normalize(vO * RO - camO); vec2 a = hit(o, d, RO); if (a.x > a.y) discard;
      float t0 = max(a.x, 0.), t1 = a.y; vec2 g = hit(o, d, 1.); if (g.x < g.y && g.x > 0.) t1 = min(t1, g.x); if (t1 <= t0) discard;
      { float s3 = .5736 * RI; if (abs(o.y + d.y * t0) < s3 && abs(o.y + d.y * t1) < s3 && abs(o.y + d.y * (t0 + t1) * .5) < s3) discard; }   // the ray never gets near the ovals (|lat| > 35°): nothing to add
      vec2 ri = hit(o, d, RI); float s0 = t0, e0 = t1, s1 = 0., e1 = 0.;   // skip the empty hollow under 85 km: two pieces of path
      if (ri.x < ri.y) { if (ri.x > t0) { e0 = min(t1, ri.x); s1 = ri.y; e1 = t1; } else if (ri.y > t0) s0 = min(ri.y, t1); }
      float L0 = max(e0 - s0, 0.), L1 = max(e1 - s1, 0.), Lt = L0 + L1; if (Lt <= 0.) discard;
      float ns = clamp(ceil(Lt / .004), 8., float(${AUS})), j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715)))), dt = Lt / ns;   // ~25 km steps, dithered: no banding, no dots at the limb
      vec3 acc = vec3(0.);
      for (int i = 0; i < ${AUS}; i++) { if (float(i) >= ns) break; float s = (float(i) + j) * dt; acc += em(o + d * (s < L0 ? s0 + s : s1 + s - L0)); }
      vec3 col = acc * dt * 30.; col *= 1.2 / (1.2 + max(col.r, col.g)); col *= min(1., .82 / max(max(col.r, col.g), 1e-4));   // soft cap at the limb, colour kept, below the bloom threshold (no pumping)
      col = any(isnan(col)) || any(isinf(col)) ? vec3(0.) : col * auB; gl_FragColor = vec4(col * (1. - morph), 1.); }` }));
  glow.rotation.y = -Math.PI / 2; glow.renderOrder = 3; scene.add(glow);
  const curtMat = new THREE.ShaderMaterial({ uniforms: { ...U, ...AU }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`attribute vec3 b; attribute float pr; attribute float hgt; uniform float time, morph; varying float vP; varying float vH; varying float vL; varying vec3 vO; ${NOISE}
      void main() { vP = pr; vH = hgt; vL = b.x + b.z * 1.7; float lat = b.y + (fbm(vec2(b.x * 5. + time * .035, b.z * 3.)) - .5) * 2.6 * .01745 + sin(b.x * 23. + time * .2 + b.z) * .12 * .01745;   // folds that wander
        float r = 1. + (95. + hgt * 230.) / 6371.; vec3 p = vec3(r * cos(lat) * cos(b.x), r * sin(lat), -r * cos(lat) * sin(b.x)); vO = p;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.); gl_Position.w += morph * 1e4; }`,
    fragmentShader: /* glsl */`uniform vec3 rsun, camO; uniform float time, auB; varying float vP; varying float vH; varying float vL; varying vec3 vO; ${NOISE}
      void main() {
        // no detail finer than a pixel (that is what blinked): the fine rays fade out once they get smaller than a pixel
        float aS = 1. - smoothstep(.3, 1., fwidth(vL * 900.)), aR = 1. - smoothstep(.3, 1., fwidth(vL * 160.));
        float st = mix(.5, vn(vec2(vL * 900., 0.)), aS), rays = (.25 + 1.1 * pow(mix(.5, fbm(vec2(vL * 160. + time * .15, time * .05)), aR), 1.6)) * (.55 + .45 * st);
        float wave = .7 + .3 * sin(vL * 40. - time * .5) * sin(vL * 13. + time * .25);   // slow pulses running along the curtain
        float prof = smoothstep(0., .035, vH) * exp(-vH * 3.6);   // bright sharp bottom edge, fading up
        vec3 c = mix(vec3(.12, 1., .42), vec3(.95, .15, .3), smoothstep(.35, .85, vH)); c = mix(vec3(.7, .25, 1.), c, smoothstep(0., .05, vH));   // pink-violet fringe at the very bottom
        float dark = 1. - smoothstep(-.2, .1, dot(normalize(vO), rsun));
        // a sheet seen edge-on or only a few pixels tall is thinner than a pixel and would blink on / off frame to frame (and the bloom with it): fade it, the soft glow carries it
        vec3 n = normalize(vO), ea = normalize(vec3(n.z, 0., -n.x) + vec3(1e-5)), no = cross(n, ea);
        float face = smoothstep(.05, .3, abs(dot(no, normalize(camO - vO)))), tall = smoothstep(3., 10., 1. / max(fwidth(vH), 1e-4));
        vec3 col = c * vP * rays * wave * prof * dark * 2.4 * face * tall;
        col = any(isnan(col)) || any(isinf(col)) ? vec3(0.) : col * auB; gl_FragColor = vec4(col * min(1., .8 / max(max(col.r, col.g), 1e-4)), 1.); }` });
  const curtains = new THREE.Mesh(new THREE.BufferGeometry(), curtMat); curtains.rotation.y = -Math.PI / 2; curtains.renderOrder = 3; scene.add(curtains);
  const aurora = { get visible() { return glow.visible; }, set visible(v) { glow.visible = curtains.visible = v; U.auOn.value = v ? 1 : 0; } };
  fetch('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json').then(r => r.json()).then(j => {
    const M = new Float32Array(360 * 181); j.coordinates.forEach(([lon, lat, v]) => { if (Math.abs(lat) < 40) return; M[(Math.round(lat) + 90) * 360 + (Math.round(lon) % 360)] = Math.min(1, v / 60); });
    // soften the 1° grid: three box passes ≈ a Gaussian of ~2° lat × 4° lon — the oval is a glow, not pixels
    const W = 360, H = 181, Bf = new Float32Array(M.length);
    for (let p = 0; p < 3; p++) {
      for (let y = 0; y < H; y++) { let s = 0; for (let i = -2; i <= 2; i++) s += M[y * W + (i + W) % W];
        for (let x = 0; x < W; x++) { Bf[y * W + x] = s / 5; s += M[y * W + (x + 3) % W] - M[y * W + (x - 2 + W) % W]; } }
      for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { let s = 0, c = 0; for (let k = -1; k <= 1; k++) { const yy = y + k; if (yy >= 0 && yy < H) { s += Bf[yy * W + x]; c++; } } M[y * W + x] = s / c; } }
    const px = new Uint8Array(360 * 181 * 4); for (let i = 0; i < M.length; i++) { px[i * 4] = Math.min(255, M[i] * 300); px[i * 4 + 3] = 255; }
    const tx = new THREE.DataTexture(px, 360, 181, THREE.RGBAFormat); tx.magFilter = THREE.LinearFilter; tx.minFilter = THREE.LinearMipmapLinearFilter; tx.generateMipmaps = true; tx.wrapS = THREE.RepeatWrapping; tx.needsUpdate = true; U.aumap.value = tx;
    // one continuous curtain per hemisphere: at each longitude, the brightest latitude of the oval
    const B = [], A = [], Hh = [], I = []; let k = 0;
    [1, -1].forEach(hemi => { let first = k;
      // the oval's brightest latitude per longitude, refined between grid rows (parabola) and smoothed along the oval — a flowing line, no 1° steps
      const PL = [], PV = [];
      for (let L = 0; L < 360; L++) { let best = 0, bi = 66;
        for (let la = 50; la <= 85; la++) { const v = M[(la * hemi + 90) * 360 + L]; if (v > best) { best = v; bi = la; } }
        const a = M[((bi - 1) * hemi + 90) * 360 + L] || 0, c = M[((bi + 1) * hemi + 90) * 360 + L] || 0, den = a - 2 * best + c;
        PL.push(bi + (den < 0 ? Math.max(-.5, Math.min(.5, .5 * (a - c) / den)) : 0)); PV.push(best); }
      const sm = (X, r) => X.map((_, i) => { let s = 0; for (let q = -r; q <= r; q++) s += X[(i + q + 360) % 360]; return s / (2 * r + 1); });
      const SL = sm(sm(PL, 5), 5), SV = sm(PV, 3);
      for (let lo = 0; lo <= 360; lo++) { const L = lo % 360, best = SV[L], bl = SL[L] * hemi;
        const lonR = (L > 180 ? L - 360 : L) * D2R; B.push(lonR, bl * D2R, hemi, lonR, bl * D2R, hemi); A.push(best, best); Hh.push(0, 1);
        if (lo > 0) I.push(k - 2, k - 1, k, k - 1, k + 1, k); k += 2; } });
    // two more sheets, a little poleward and equatorward, fainter — curtains come in layers
    const n0 = B.length / 3; [[.9, .55, 1], [-.7, .4, 2]].forEach(([dl, f, seed]) => { const off = k;
      for (let v = 0; v < n0; v++) { B.push(B[v * 3], B[v * 3 + 1] + dl * D2R * Math.sign(B[v * 3 + 2]), B[v * 3 + 2] * (1 + seed * .37)); A.push(A[v] * f); Hh.push(Hh[v]); }
      for (let q = 0, m = I.length / (seed === 1 ? 1 : 2); q < m; q++) I.push(I[q] + off); k += n0; });
    const g = curtains.geometry; g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(B.length), 3)); g.setAttribute('b', new THREE.Float32BufferAttribute(B, 3));
    g.setAttribute('pr', new THREE.Float32BufferAttribute(A, 1)); g.setAttribute('hgt', new THREE.Float32BufferAttribute(Hh, 1)); g.setIndex(I); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
  }).catch(() => {});
  const auMat = { uniforms: AU };
  
  // the real sky: NASA SVS Deep Star Maps 2020 (Tycho-2 + Gaia) on a big sphere, turned by the sidereal time so the stars stand where they really are
  const skyT = tl.load(BASE + 'img/sky/stars.jpg'); skyT.colorSpace = THREE.SRGBColorSpace; skyT.anisotropy = Q === 'low' ? 1 : 4;
  const stars = new THREE.Mesh(new THREE.SphereGeometry(900, 64, 32), new THREE.MeshBasicMaterial({ map: skyT, side: THREE.BackSide, depthWrite: false, color: new THREE.Color(.5, .5, .52) }));
  stars.scale.x = -1; earth.add(stars);   // inside the Earth's own frame: RA α sits over longitude α − GMST
  stars.material.depthTest = false; stars.renderOrder = -1;   // always the background; it follows the camera (see the loop)
  
  // ── close up: Sentinel-2 cloudless 2023 (EOX, 10 m) + Terrarium heights, streamed as a quadtree of tiles in Web-Mercator. A tile is drawn only
  // once its picture and heights are in; until all four children are ready the parent stays, and a new tile fades from its parent's picture — no holes, no pops
  const HD = { img: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/${z}/${y}/${x}.jpg`,
    dem: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
    ZMAX: Q === 'low' ? 12 : Q === 'medium' ? 13 : 14, ZT: 12, EX: 1.5, PX: Q === 'low' ? 520 : Q === 'medium' ? 400 : 320, G: Q === 'low' ? 16 : 32 };
  const hd = new THREE.Group(); hd.rotation.y = -Math.PI / 2; scene.add(hd);
  const tileGeo = (() => { const G = HD.G, P = [], UV = [], SK = [], I = [], id = (i, j) => j * (G + 1) + i, ring = [];
    for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) { P.push(0, 0, 0); UV.push(i / G, j / G); SK.push(0); }
    for (let i = 0; i < G; i++) ring.push([i, 0]); for (let j = 0; j < G; j++) ring.push([G, j]); for (let i = G; i > 0; i--) ring.push([i, G]); for (let j = G; j > 0; j--) ring.push([0, j]);
    const base = (G + 1) * (G + 1); ring.forEach(([i, j]) => { P.push(0, 0, 0); UV.push(i / G, j / G); SK.push(1); });   // skirts: the border again, pulled down — cracks never show
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1); I.push(a, c, b, b, c, d); }
    for (let k = 0; k < ring.length; k++) { const k2 = (k + 1) % ring.length, a = id(...ring[k]), b = id(...ring[k2]); I.push(a, base + k, b, b, base + k, base + k2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    g.setAttribute('sk', new THREE.Float32BufferAttribute(SK, 1)); g.setIndex(I); return g; })();
  const TVS = /* glsl */`
    uniform vec4 rect; uniform sampler2D hmap; uniform vec3 hsub; uniform float skirt; attribute float sk;
    varying vec2 vT; varying vec2 vG; varying vec3 vO; varying vec3 vP; varying float vLat;
    void main() { vT = uv; float lon = rect.x + uv.x * rect.y, my = rect.z - uv.y * rect.w, lat = 2. * atan(exp(my)) - 1.5707963;
      float h = max(texture2D(hmap, hsub.xy + (uv * 255. + .5) / 256. * hsub.z).r, 0.);
      vec3 n = vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon));
      float r = 1. + (h * ${HD.EX.toFixed(2)} + 400.) / 6371000. - sk * skirt;
      vO = n; vP = n * r; vLat = lat; vG = vec2(lon / 6.2831853 + .5, lat / 3.1415927 + .5);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(vP, 1.); }`;
  const TFS = /* glsl */`
    uniform sampler2D img, pimg, nmap; uniform vec3 psub, hsub; uniform vec4 rect, wo; uniform float fade, hdA, pxk, wtime;
    varying vec2 vT; varying vec2 vG; varying vec3 vO; varying vec3 vP; varying float vLat; ${SHADE}
    // waves: a few gravity waves (deep-water speeds), wavelengths 1000 m / |k| so the pattern repeats every kilometre and never seams between tiles
    vec2 W(vec2 q, vec2 k, float t) { float kk = 6.2831853 * length(k) / 1000.; return normalize(k) * .055 * cos(6.2831853 * dot(k, q) / 1000. + t * sqrt(9.81 * kk)); }
    vec2 waves(vec2 q, float t) { return W(q, vec2(7., 3.), t) + W(q, vec2(-5., 9.), t) + W(q, vec2(13., -4.), t) + W(q, vec2(3., 17.), t) + W(q, vec2(-19., -8.), t) + W(q, vec2(23., 11.), t) + W(q, vec2(-29., 17.), t); }
    void main() { vec3 n = normalize(vO), ea = normalize(vec3(n.z, 0., -n.x) + vec3(1e-5)), no = cross(n, ea);
      vec3 d = mix(texture2D(pimg, psub.xy + vT * psub.z).rgb, texture2D(img, vT).rgb, fade) * 1.15;
      vec4 nm = texture2D(nmap, hsub.xy + vT * hsub.z); vec3 tn = nm.xyz * 2. - 1.;
      float w = nm.a * (1. - smoothstep(.05, .12, dot(d, vec3(.3, .59, .11))));   // sea level and dark = water
      vec3 N = normalize(mix(normalize(ea * tn.x + no * tn.y + n * tn.z), n, w));
      float foot = length(camO - vP) * 6371000. / pxk, wf = (1. - smoothstep(6., 30., foot)) * w;   // metres per pixel → waves only when you can see them
      float latN = 2. * atan(exp(rect.z)) - 1.5707963;
      vec2 sl = waves(vec2(wo.x + vT.x * wo.z, wo.y + (vLat - latN) * 6371000.), wtime) * wf;
      vec3 Nw = normalize(n - ea * sl.x - no * sl.y);
      gl_FragColor = vec4(shade(n, vP, N, Nw, mix(.045, .008, wf), d, w, vG, 1.3), hdA); }`;
  const tiles = new Map(), cv2 = new OffscreenCanvas(256, 256), cx2 = cv2.getContext('2d', { willReadFrequently: true });
  const tileOf = (z, x, y) => { const k = z + '/' + x + '/' + y; let t = tiles.get(k); if (!t) { t = { k, z, x, y, used: 0 }; geomOf(t); tiles.set(k, t); } return t; };
  const latOf = (y, n) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
  const nrmOf = (lat, lon) => new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
  function geomOf(t) { const n = 1 << t.z, l0 = t.x / n * 2 * Math.PI - Math.PI, l1 = l0 + 2 * Math.PI / n, a0 = latOf(t.y, n), a1 = latOf(t.y + 1, n);
    t.lon0 = l0; t.dlon = l1 - l0; t.my0 = Math.PI * (1 - 2 * t.y / n); t.dmy = 2 * Math.PI / n; t.latN = a0;
    t.c = nrmOf((a0 + a1) / 2, (l0 + l1) / 2); t.rho = Math.max(...[[a0, l0], [a0, l1], [a1, l0], [a1, l1], [a0, (l0 + l1) / 2]].map(([a, b]) => t.c.angleTo(nrmOf(a, b)))); }
  const demOf = t => t.z <= HD.ZT ? t : tileOf(HD.ZT, t.x >> (t.z - HD.ZT), t.y >> (t.z - HD.ZT));
  const ready = t => t.img && demOf(t).dem;
  let act = 0, frameNo = 0; const demQ = [];
  async function getBitmap(u) { const r = await fetch(u); if (!r.ok) throw r.status; return createImageBitmap(await r.blob()); }
  function loadImg(t) { t.imgP = true; act++; getBitmap(HD.img(t.z, t.x, t.y)).then(bm => { const tx = new THREE.Texture(bm); tx.flipY = false; tx.colorSpace = THREE.SRGBColorSpace;
      tx.anisotropy = Math.min(8, aniso); tx.minFilter = THREE.LinearMipmapLinearFilter; tx.generateMipmaps = true; tx.needsUpdate = true; t.img = tx; })
    .catch(() => { t.fail = (t.fail || 0) + 1; }).finally(() => { act--; setTimeout(() => t.imgP = false, t.img ? 0 : 3000 * (t.fail || 1)); }); }
  function loadDem(t) { t.demP = true; act++; getBitmap(HD.dem(t.z, t.x, t.y)).then(bm => demQ.push([t, bm]))
    .catch(() => { t.fail = (t.fail || 0) + 1; setTimeout(() => t.demP = false, 3000 * t.fail); }).finally(() => act--); }
  // the Terrarium tiles have broken lines in places (rows up to 32 km high or 2 km deep, e.g. off Yemen): a pixel more than 250 m away from
  // the median of the 9 pixels along a column (then a row, then a column again) takes that median. Real peaks and cliffs (Matterhorn, Eiger, Yosemite) are untouched.
  const win = new Float32Array(9);
  function despike(h) { for (const st of [256, 1, 256]) for (let k = 0; k < 65536; k++) { const q = st === 1 ? k & 255 : k >> 8, v = h[k];
      const at = d => h[k + (Math.max(0, Math.min(255, q + d)) - q) * st];
      if (Math.abs(v - at(-4)) < 250 && Math.abs(v - at(4)) < 250 && Math.abs(v - at(-1)) < 250 && Math.abs(v - at(1)) < 250) continue;   // quick: nothing odd here
      for (let d = -4; d <= 4; d++) win[d + 4] = at(d); win.sort(); if (Math.abs(v - win[4]) > 250) h[k] = win[4]; } }
  function decodeDem(t, bm) {   // heights (metres) for the mesh + a normal map (east / north / up, alpha = sea) for the light
    cx2.drawImage(bm, 0, 0); bm.close(); const p = cx2.getImageData(0, 0, 256, 256).data, h = new Float32Array(65536), nm = new Uint8Array(65536 * 4), n = 1 << t.z;
    for (let i = 0; i < 65536; i++) h[i] = Math.max(-11000, Math.min(8900, p[i * 4] * 256 + p[i * 4 + 1] + p[i * 4 + 2] / 256 - 32768));
    despike(h);
    for (let j = 0; j < 256; j++) { const mpp = 2 * Math.PI * 6371000 * Math.cos(latOf(t.y + (j + .5) / 256, n)) / (n * 256), ju = Math.max(j - 1, 0) * 256, jd = Math.min(j + 1, 255) * 256;
      for (let i = 0; i < 256; i++) { const k = j * 256 + i, gx = (h[j * 256 + Math.min(i + 1, 255)] - h[j * 256 + Math.max(i - 1, 0)]) / (2 * mpp) * HD.EX, gy = (h[ju + i] - h[jd + i]) / (2 * mpp) * HD.EX;
        const nz = 1 / Math.sqrt(gx * gx + gy * gy + 1); nm[k * 4] = (-gx * nz * .5 + .5) * 255; nm[k * 4 + 1] = (-gy * nz * .5 + .5) * 255; nm[k * 4 + 2] = (nz * .5 + .5) * 255; nm[k * 4 + 3] = h[k] <= 0 ? 255 : 0; } }
    const ht = new THREE.DataTexture(h, 256, 256, THREE.RedFormat, THREE.FloatType); ht.needsUpdate = true;
    const nt = new THREE.DataTexture(nm, 256, 256, THREE.RGBAFormat); nt.magFilter = THREE.LinearFilter; nt.minFilter = THREE.LinearMipmapLinearFilter; nt.generateMipmaps = true; nt.needsUpdate = true;
    t.dem = { h, ht, nt }; }
  function groundAt(lat, lon) {   // metres under a point, from the finest heights we have
    const my = Math.log(Math.tan(Math.PI / 4 + Math.max(-1.48, Math.min(1.48, lat)) / 2));
    for (let z = HD.ZT; z >= 2; z--) { const n = 1 << z, fx = (lon + Math.PI) / (2 * Math.PI) * n, fy = (1 - my / Math.PI) / 2 * n, t = tiles.get(z + '/' + (fx | 0) + '/' + (fy | 0));
      if (t && t.dem) { const h = t.dem.h, u = Math.min(254.999, Math.max(0, (fx % 1) * 256 - .5)), v = Math.min(254.999, Math.max(0, (fy % 1) * 256 - .5)), i = u | 0, j = v | 0, a = u - i, b = v - j, k = j * 256 + i;   // bilinear, like the mesh
        return Math.max(0, (h[k] * (1 - a) + h[k + 1] * a) * (1 - b) + (h[k + 256] * (1 - a) + h[k + 257] * a) * b); } } return 0; }
  const gR = (lat, lon) => (groundAt(lat, lon) * HD.EX + 400) / 6371000;   // the drawn ground, Earth radii above the sea-level sphere
  const gMax = v => { const la = Math.asin(Math.max(-1, Math.min(1, v.y))), lo = Math.atan2(-v.z, v.x), e = 9e-6; let m = gR(la, lo);   // a few metres around too: the mesh between its vertices
    for (const [a, b] of [[e, 0], [-e, 0], [0, e], [0, -e]]) m = Math.max(m, gR(la + a, lo + b / Math.max(.05, Math.cos(la)))); return m; };
  let gT = 0, hAG = 1, gL = 0;   // ground height under the target (smoothed), camera height above the ground
  function meshOf(t) { if (t.mesh && t.mesh.material.uniforms.hmap.value === demOf(t).dem.ht) return t.mesh; t.mesh?.material.dispose(); const d = demOf(t), s = t.z > HD.ZT ? 1 / (1 << (t.z - HD.ZT)) : 1, m = t.z > HD.ZT ? 1 << (t.z - HD.ZT) : 1;
    const p = t.z > 2 ? tiles.get((t.z - 1) + '/' + (t.x >> 1) + '/' + (t.y >> 1)) : null, pok = p && p.img;
    const mat = new THREE.ShaderMaterial({ uniforms: { ...U, img: { value: t.img }, pimg: { value: pok ? p.img : t.img }, psub: { value: new THREE.Vector3(pok ? (t.x & 1) * .5 : 0, pok ? (t.y & 1) * .5 : 0, pok ? .5 : 1) },
        hmap: { value: d.dem.ht }, nmap: { value: d.dem.nt }, hsub: { value: new THREE.Vector3((t.x % m) * s, (t.y % m) * s, s) }, rect: { value: new THREE.Vector4(t.lon0, t.dlon, t.my0, t.dmy) },
        fade: { value: pok ? 0 : 1 }, skirt: { value: t.rho * .05 }, wo: { value: new THREE.Vector4() } }, vertexShader: TVS, fragmentShader: TFS, transparent: true, side: THREE.DoubleSide });
    t.mesh = new THREE.Mesh(tileGeo, mat); t.mesh.frustumCulled = false; t.mesh.renderOrder = 1; t.born = 0; return t.mesh; }
  const fr = new THREE.Frustum(), fm = new THREE.Matrix4(), sph = new THREE.Sphere(), camN = new THREE.Vector3();
  let need = [], drawn = [], pxK = 1000;
  function culled(t, D, hor) { if (t.c.angleTo(camN) - t.rho > hor) return true; sph.center.copy(t.c); sph.radius = 2 * Math.sin(Math.min(t.rho, 1.5) / 2) + .002; return !fr.intersectsSphere(sph); }
  function walk(t, D, hor) {
    if (culled(t, D, hor)) return; t.used = frameNo;
    const dist = Math.max(U.camO.value.distanceTo(t.c) - 2 * Math.sin(Math.min(t.rho, 1.5) / 2), (D - 1) * .7, 1e-5), px = t.rho * 1.41 / dist * pxK;
    if (t.z < HD.ZMAX && (t.z < 3 || px > HD.PX)) { const ch = [0, 1, 2, 3].map(i => tileOf(t.z + 1, t.x * 2 + (i & 1), t.y * 2 + (i >> 1)));
      const vis = ch.filter(k => !culled(k, D, hor)); vis.forEach(k => { k.used = frameNo; if (!ready(k)) need.push(k); });
      if (vis.every(ready)) { vis.forEach(k => walk(k, D, hor)); return; } }
    if (ready(t)) { drawn.push(t); demOf(t).used = frameNo; } else need.push(t); }
  function hdUpdate(D) {
    frameNo++; need = []; drawn = []; camN.copy(U.camO.value).normalize();
    fm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(hd.matrixWorld); fr.setFromProjectionMatrix(fm);
    const hor = Math.acos(Math.min(1, 1 / D)) + .03; pxK = renderer.domElement.height / (2 * Math.tan(camera.fov * D2R / 2));
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) walk(tileOf(2, x, y), D, hor);
    for (const t0 = performance.now(); demQ.length && performance.now() - t0 < 6;) decodeDem(...demQ.shift());   // ~6 ms of decoding per frame keeps it smooth
    need.sort((a, b) => a.z - b.z);
    for (const t of need) { if (act >= 16) break; const d = demOf(t); if (!d.dem && !d.demP) loadDem(d); if (!t.img && !t.imgP && act < 16) loadImg(t); }
    hd.clear(); const now = performance.now(), cl = Math.cos(Math.asin(camN.y)), R = 6371000;
    for (const t of drawn) { const m = meshOf(t), u = m.material.uniforms; if (!t.born) t.born = now;
      const f = Math.min(1, (now - t.born) / 400); u.fade.value = f * f * (3 - 2 * f); if (f >= 1) u.pimg.value = t.img;
      u.wo.value.set(((t.lon0 * R * cl) % 1000 + 1000) % 1000, ((t.latN * R) % 1000 + 1000) % 1000, t.dlon * R * cl, 0); hd.add(m); }
    if (tiles.size > 900) for (const t of [...tiles.values()].sort((a, b) => a.used - b.used).slice(0, 200)) { if (t.used > frameNo - 120) break;   // forget what you have not looked at for ~2 s
      t.img?.dispose(); t.dem?.ht.dispose(); t.dem?.nt.dispose(); t.mesh?.material.dispose(); tiles.delete(t.k); }
    return drawn.length; }
  const gmst = t => ((280.46061837 + 360.98564736629 * (t / 864e5 + 2440587.5 - 2451545)) % 360) * D2R;
  
  // bloom: city lights, the glint and the aurora glow a little (off on low)
  let PR = renderer.getPixelRatio(); const rt = new THREE.WebGLRenderTarget(W * renderer.getPixelRatio(), H * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: Q === "high" && renderer.getPixelRatio() <= 1.05 ? 4 : 0 });   // MSAA only when pixels are big
  rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height);   // the air pass reads how far the ground is in each pixel
  const solar = createSolar({ THREE, renderer, camera, Q, tr, el, nrmOf, gmst, quatW: earth.quaternion, dayTex: TX.day });
  earth.remove(stars); { const sg = new THREE.Group(); sg.quaternion.copy(earth.quaternion); sg.add(stars); solar.scene.add(sg); stars.position.set(0, 0, 0); }   // the sky is the far layer's background
  const composer = new EffectComposer(renderer, rt); composer.addPass(new RenderPass(solar.scene, solar.cam));
  { const np = new RenderPass(scene, camera), r0 = np.render.bind(np); np.clear = false; np.render = (r, w, rb, ...a) => { r.setRenderTarget(rb); r.clearDepth(); r0(r, w, rb, ...a); }; composer.addPass(np); }   // the Earth's scene: its own depth, over the far layer
  composer.renderTarget2.depthTexture = new THREE.DepthTexture(rt.width, rt.height);   // its own depth: a clone shares one GL texture, and without MSAA the air pass would read the depth it is drawing into (black screen)
  const airPass = new ShaderPass({ uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, projInv: { value: camera.projectionMatrixInverse }, camW: { value: camera.matrixWorld },
      toObj: { value: new THREE.Matrix3() }, cn: { value: new THREE.Vector2() }, camO: U.camO, sun: U.sun, morph: U.morph },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`, fragmentShader: AIRFS });
  { const r0 = airPass.render.bind(airPass); airPass.render = (r, w, rb, dt, m) => { airPass.uniforms.tDepth.value = rb.depthTexture; r0(r, w, rb, dt, m); }; }
  // a mask "ground here" saved right after the scene (the disc of the Sun reads it at the very end of the frame, when that depth may have changed)
  { const maskRT = new THREE.WebGLRenderTarget(rt.width, rt.height, { type: THREE.UnsignedByteType, depthBuffer: false });
    const q = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { tDepth: { value: null } }, depthTest: false, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
      fragmentShader: `uniform sampler2D tDepth; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tDepth, vUv).x < 1. ? 1. : 0., 0., 0., 1.); }` }));
    sunDepth.value = maskRT.texture;
    composer.addPass({ enabled: true, needsSwap: false, clear: false, renderToScreen: false, setSize(w, h) { maskRT.setSize(w, h); sunRes.value.set(w, h); }, dispose() {},
      render(r, w, rb) { q.material.uniforms.tDepth.value = rb.depthTexture; const o = r.getRenderTarget(); r.setRenderTarget(maskRT); q.render(r); r.setRenderTarget(o); } }); }
  { }   // the buffer the scene went into this frame
  Object.assign(airPass.uniforms, { camO: U.camO, sun: U.sun, morph: U.morph });   // ShaderPass copies its uniforms: hand it the live ones
  composer.addPass(airPass);
  // a safety net: a single NaN / Inf pixel from any shader would be smeared by the bloom into black blocks and a whole-screen flicker — clean it first
  composer.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); vec3 k = any(isnan(c.rgb)) || any(isinf(c.rgb)) ? vec3(0.) : max(c.rgb, 0.); k *= min(1., 4. / max(max(k.r, k.g), max(k.b, 1e-4))); gl_FragColor = vec4(k, 1.); }` }));
  if (Q !== 'low') composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), .35, .6, .88));
  composer.addPass(new OutputPass());
  { const sp = new RenderPass(sunScene, camera); sp.clear = false; composer.addPass(sp);   // the Sun's disc over the finished picture, then out to the screen
    composer.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }` })); }
  for (const p of composer.passes) if (p.material) { p.material.depthTest = false; p.material.depthWrite = false; }   // full-screen passes: never tested against an old depth

  

  // ── Earth's magnetic shield, to scale, seen as you leave the globe: magnetopause + bow shock from the solar wind now (NOAA, Shue et al. 1998),
  // dipole field lines squeezed on the day side and stretched into the tail, Van Allen belts, solar-wind particles flowing round, the Moon at its true distance
  const MSH = (() => {
    const g = new THREE.Group(); g.rotation.y = -Math.PI / 2; scene.add(g);   // the Earth's own frame, like the globe
    const sw = new THREE.Group(), dip = new THREE.Group(); g.add(sw, dip); sw.matrixAutoUpdate = false;   // sw: x = to the Sun, y = magnetic north square to it · dip: y = the dipole axis
    const Mg = nrmOf(80.7 * D2R, -72.7 * D2R);   // geomagnetic north pole (IGRF dipole)
    const S = { R0: 10.5, Rw: 10.5, alw: .58, n: 5, v: 420, bz: 0, P: 1.5, ok: 0, cme: -1, fade: 0 };
    const shue = (n, v, bz) => { const P = Math.max(.1, 1.6726e-6 * n * v * v); return { P, R: Math.max(4.5, Math.min(14, (10.22 + 1.29 * Math.tanh(.184 * (bz + 8.14))) * Math.pow(P, -1 / 6.6))), al: Math.max(.45, Math.min(.8, (.58 - .007 * bz) * (1 + .024 * Math.log(P)))) }; };
    // the solar wind at L1 now (NOAA real-time, newest first; the spacecraft in use = active, else any good row)
    const pick = (j, ks) => { const ok = r => ks.every(k => r[k] != null && isFinite(r[k])); return j.find(r => r.active && ok(r)) || j.find(ok); };
    Promise.all(['wind', 'mag'].map(k => fetch(`https://services.swpc.noaa.gov/json/rtsw/rtsw_${k}_1m.json`).then(r => r.json()))).then(([w, m]) => {
      const a = pick(w, ['proton_speed', 'proton_density']), b = pick(m, ['bz_gsm']); if (a) { S.n = a.proton_density; S.v = a.proton_speed; } if (b) S.bz = b.bz_gsm; S.ok = 1;
      const s = shue(S.n, S.v, S.bz); S.Rw = s.R; S.alw = s.al; S.P = s.P; }).catch(() => {});
    const U2 = { time: U.wtime, fade: { value: 0 }, R0: { value: 10.5 }, al: { value: .58 }, cme: { value: 0 }, px: { value: 1 } };
    const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    // a glowing shell: bright at the rim, faint streaks flowing tailward (tail = how far down the tail it stays visible, in its own units)
    const shellMat = (col, k, bs, tail) => new THREE.ShaderMaterial({ ...add, side: THREE.DoubleSide, uniforms: { ...U2, col: { value: new THREE.Color(...col) }, k: { value: k }, gate: { value: 1 } },
      vertexShader: `varying vec3 vN, vV, vP; void main() { vP = position; vec4 w = modelMatrix * vec4(position, 1.); vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 col; uniform float k, fade, time, cme, gate; varying vec3 vN, vV, vP; ${NOISE}
        void main() { float f = 1. - abs(dot(normalize(vN), normalize(vV))), a = ${bs ? 'pow(f, 4.5) * 1.2 + .008' : 'pow(f, 2.6) * 1.3 + .03'};
          float st = .55 + .45 * vn(vec2(atan(vP.z, vP.y) * ${bs ? '4.' : '7.'}, vP.x * ${bs ? '2.' : '5.'} + time * (.5 + 1.5 * cme)));
          a *= st * k * fade * gate * ${tail ? `smoothstep(${(-tail[0]).toFixed(2)}, ${(-tail[1]).toFixed(2)}, vP.x)` : '1.'} * smoothstep(2.5, 12., length(vV)) * (1. + cme * ${bs ? '1.6' : '.9'});
          gl_FragColor = vec4(mix(col, vec3(1., .72, .45), cme * ${bs ? '.7' : '.25'}) * a, 1.); }` });
    const lathe = (al, k) => { const P = []; for (let th = 0; th < 2.9; th += .035) { const r = k * Math.pow(2 / (1 + Math.cos(th)), al); if (r * Math.cos(th) < -6.5) break; P.push(new THREE.Vector2(r * Math.sin(th), r * Math.cos(th))); }
      const geo = new THREE.LatheGeometry(P, 72); geo.rotateZ(-Math.PI / 2); return geo; };   // the lathe's axis (y) → x, toward the Sun
    const mp = new THREE.Mesh(lathe(.58, 1), shellMat([.35, .7, 1], .4, 0, [3.2, 1])), bs = new THREE.Mesh(lathe(.75, 1.3), shellMat([1, .9, .78], .16, 1, [1.6, .3]));
    mp.renderOrder = bs.renderOrder = 4; sw.add(mp, bs); let alBuilt = .58;
    // field lines as screen-facing ribbons, laid out in the shader from dipole coordinates so a CME can squeeze them every frame
    const FL = { p: [], q: [], s: [], sd: [] }, NS = 64;
    const line = (kind, a1, a2, a3, seed) => { for (let i = 0; i <= NS; i++) for (const sd of [-1, 1]) { FL.p.push(kind, a1, a2, a3); FL.q.push(seed); FL.s.push(i / NS); FL.sd.push(sd); } };
    for (let k = 0; k < 12; k++) [2.2, 3.4, 5, 7, 9].forEach((L, li) => line(0, L, k * Math.PI / 6 + (li % 2) * .26, li, Math.random()));   // closed loops
    for (let k = -2; k <= 2; k++) [1, -1].forEach(hs => line(1, hs, k, 0, Math.random()));   // open: polar caps → the tail
    for (let k = 0; k < 6; k++) [1, -1].forEach(hs => line(2, hs, (k - 2.5) * .5, 0, Math.random()));   // open on the day side, swept over the poles
    const fg = new THREE.BufferGeometry(), nV = FL.s.length, idx = [];
    for (let v = 0; v + 3 < nV; v += 2) if (FL.s[v + 2] > FL.s[v]) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    fg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(nV * 3), 3)); fg.setAttribute('prm', new THREE.Float32BufferAttribute(FL.p, 4));
    fg.setAttribute('seed', new THREE.Float32BufferAttribute(FL.q, 1)); fg.setAttribute('s', new THREE.Float32BufferAttribute(FL.s, 1)); fg.setAttribute('sd', new THREE.Float32BufferAttribute(FL.sd, 1));
    fg.setIndex(idx);
    const fl = new THREE.Mesh(fg, new THREE.ShaderMaterial({ ...add, side: THREE.DoubleSide, uniforms: U2,
      vertexShader: `attribute vec4 prm; attribute float seed, s, sd; uniform float R0, cme, px, time; varying float vS, vK, vA, vSeed;
        vec3 at(float u) { float kind = prm.x;
          if (kind < .5) { float L = prm.y, a = prm.z, lf = acos(sqrt(1. / L)), la = -lf + 2. * lf * u, r = L * cos(la) * cos(la);
            vec3 p = vec3(r * cos(la) * cos(a), r * sin(la), r * cos(la) * sin(a)); float ca = cos(a);
            p.x *= mix(1., min(1., .9 * R0 / L), max(ca, 0.)) * (1. + max(-ca, 0.) * .3 * L / 8. * (10.5 / R0)); return p; }
          float hs = prm.y, k = prm.z, w0 = (1. - u) * (1. - u), w1 = 2. * u * (1. - u), w2 = u * u, sq = R0 / 10.5;
          if (kind < 1.5) return w0 * vec3(.22, hs * .97, k * .15) + w1 * vec3(.8, hs * 6., k * .9) + w2 * vec3(-60., hs * 8.5 * sq, k * 4.5 * sq);
          return w0 * vec3(.3, hs * .95, k * .12) + w1 * vec3(R0 * .95, hs * R0 * 1.25, k * 1.6) + w2 * vec3(-45., hs * 9. * sq, k * 5. * sq); }
        void main() { vec3 p = at(s), q = at(min(1., s + .01)) - at(max(0., s - .01)); vec4 w = modelMatrix * vec4(p, 1.), t = modelMatrix * vec4(q, 0.);
          vec3 vd = cameraPosition - w.xyz; vec3 side = normalize(cross(t.xyz, vd)); w.xyz += side * sd * px * length(vd) * (prm.x < .5 && prm.w < 1.5 ? 1.5 : 1.1);
          vS = s; vK = prm.x; vA = prm.w; vSeed = seed; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float fade, time, cme; varying float vS, vK, vA, vSeed;
        void main() { float sp = vK < .5 ? .18 : .1, n = vK < .5 ? 2. : 3.; float pulse = pow(fract(vS * n - time * sp * (1. + 2. * cme) + vSeed), 10.);
          float end = smoothstep(0., .04, vS) * smoothstep(1., .9, vS) * (vK > .5 ? smoothstep(1., .6, vS) : 1.);
          vec3 c = vK < .5 ? (vA < 1.5 ? vec3(.47, .78, 1.) : vec3(.35, .59, 1.)) : vec3(.36, .55, 1.);
          float a = (vK < .5 ? (vA < 1.5 ? .34 : .22) : .13) * (.55 + 2.2 * pulse) * end * fade;
          gl_FragColor = vec4(mix(c, vec3(1., .8, .55), cme * pulse * .6) * a, 1.); }` }));
    fl.renderOrder = 4; fl.frustumCulled = false; sw.add(fl);
    // Van Allen belts: glowing shells shaped like field lines (inner ≈ 1.2–2 R⊕, mostly protons; outer ≈ 3–6 R⊕, electrons)
    const belt = (L, col, k) => { const P = [], lf = Math.acos(Math.sqrt(1 / L)) * .78; for (let i = 0; i <= 40; i++) { const la = -lf + 2 * lf * i / 40, r = L * Math.cos(la) ** 2; P.push(new THREE.Vector2(r * Math.cos(la), r * Math.sin(la))); }
      const m = new THREE.Mesh(new THREE.LatheGeometry(P, 72), shellMat(col, k, 0, 0)); m.renderOrder = 4; dip.add(m); return m; };
    const belts = [belt(1.6, [1, .55, .35], .3), belt(2.1, [1, .55, .35], .15), belt(3.8, [.6, .5, 1], .25), belt(5, [.6, .5, 1], .18)];
    // the solar wind: particles from the Sun's side, sliding round the magnetopause and down the tail (sped up; the real speed sets the pace)
    const NP = Q === 'low' ? 1800 : 4000, pa = new Float32Array(NP * 3);
    for (let i = 0; i < NP; i++) { pa[i * 3] = Math.sqrt(Math.random()) * 22; pa[i * 3 + 1] = Math.random() * 6.2832; pa[i * 3 + 2] = Math.random(); }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(NP * 3), 3)); pg.setAttribute('pr', new THREE.Float32BufferAttribute(pa, 3));
    const U3 = { ...U2, spd: { value: 7 }, dpr: { value: 1 } };
    const pts = new THREE.Points(pg, new THREE.ShaderMaterial({ ...add, uniforms: U3,
      vertexShader: `attribute vec3 pr; uniform float R0, al, time, spd, dpr, cme; varying float vA;
        float rho(float x, float R) { float lo = 0., hi = 2.95; for (int i = 0; i < 14; i++) { float th = .5 * (lo + hi), r = R * pow(2. / (1. + cos(th)), al); if (r * cos(th) > x) lo = th; else hi = th; }
          float th = .5 * (lo + hi); return R * pow(2. / (1. + cos(th)), al) * sin(th); }
        void main() { float x = 32. - mod(pr.z * 85. + time * spd, 85.), R = R0 * 1.12, rr = x > R ? pr.x : sqrt(pr.x * pr.x + pow(rho(x, R) * 1.04, 2.));
          vec3 p = vec3(x, rr * sin(pr.y), rr * cos(pr.y)); vA = smoothstep(32., 26., x) * smoothstep(-53., -40., x);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.); gl_PointSize = dpr * (1.6 + cme * .8); }`,
      fragmentShader: `uniform float fade, cme; varying float vA; void main() { float d = 1. - smoothstep(.2, .5, length(gl_PointCoord - .5));
        gl_FragColor = vec4(mix(vec3(.55, .76, 1.), vec3(1., .74, .45), cme) * d * vA * fade * .75, 1.); }` }));
    pts.renderOrder = 4; pts.frustumCulled = false; sw.add(pts);
    // the CME: a bright curved front sweeping in from the Sun; it hits, squeezes the shield and lights the aurora
    const front = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, .9), shellMat([1, .78, .5], 1.4, 1, 0));
    front.geometry.rotateZ(Math.PI / 2); front.renderOrder = 4; front.visible = false; sw.add(front);   // the cap faces −x, toward the Earth
    // the Moon at its true place and size (low-precision Meeus), lit by the real Sun; grey with maria-like patches
    const moon = new THREE.Mesh(new THREE.SphereGeometry(.2727, 48, 24), new THREE.ShaderMaterial({ uniforms: { rsun: U.rsun, fade: U2.fade },
      vertexShader: `varying vec3 vN; void main() { vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform vec3 rsun; uniform float fade; varying vec3 vN; ${NOISE}
        void main() { vec3 n = normalize(vN); vec2 q = vec2(atan(n.z, n.x) * 2., asin(n.y) * 2.); float alb = .62 + .18 * fbm(q * 4.) - .32 * smoothstep(.5, .66, fbm(q * 1.3 + 7.));
          float l = max(dot(n, rsun), 0.); gl_FragColor = vec4(vec3(alb * (l * 1.35 + .015)) * fade, 1.); }` }));
    const moonAt = t => { const d = t / 864e5 - 10957.5, L = (218.316 + 13.176396 * d) * D2R, M = (134.963 + 13.064993 * d) * D2R, F = (93.272 + 13.229350 * d) * D2R;
      const l = L + 6.289 * D2R * Math.sin(M), b = 5.128 * D2R * Math.sin(F), r = (385001 - 20905 * Math.cos(M)) / 6371, e = 23.4393 * D2R;
      const x = Math.cos(b) * Math.cos(l), y = Math.cos(b) * Math.sin(l), z = Math.sin(b), ye = y * Math.cos(e) - z * Math.sin(e), ze = y * Math.sin(e) + z * Math.cos(e);
      return nrmOf(Math.asin(ze), Math.atan2(ye, x) - gmst(t)).multiplyScalar(r); };   // right ascension − sidereal time = the longitude under the Moon
    // labels in the page, so they stay crisp
    const lab = document.createElement('div'); lab.className = 'e3g-ms'; el.appendChild(lab);
    const LB = [0, 1, 2, 3, 4, 5, 6].map(() => lab.appendChild(document.createElement('span')));
    const wp = new THREE.Vector3(), pv = new THREE.Vector3();
    const hidden = p => { const d = pv.copy(p).sub(camera.position), len = d.length(); d.divideScalar(len); const b = camera.position.dot(d), h = b * b - camera.position.lengthSq() + 1; if (h <= 0) return false; const t0 = -b - Math.sqrt(h); return t0 > 0 && t0 < len; };
    const put = (s, obj, x, y, z, txt) => { wp.set(x, y, z).applyMatrix4(obj.matrixWorld); pv.copy(wp).project(camera);
      if (pv.z > 1 || Math.abs(pv.x) > 1.05 || Math.abs(pv.y) > 1.05 || hidden(wp)) { s.style.opacity = 0; return; }
      s.style.opacity = S.fade; s.style.transform = `translate(${Math.round((pv.x * .5 + .5) * W + 8)}px, ${Math.round((.5 - pv.y * .5) * H - 9)}px)`; if (s.textContent !== txt) s.textContent = txt; };
    let on = false;   // off until 🧲 (or the "3D starts on: shield" setting)
    function update(dt, t, D) {
      const want = on ? smooth(5, 12, D - 1) * (1 - smooth(250, 500, D)) : 0; S.fade += (want - S.fade) * Math.min(1, dt * 3); U2.fade.value = S.fade;
      g.visible = S.fade > .003; lab.style.display = g.visible ? '' : 'none'; if (!g.visible) { AU.auB.value = 1; return 0; }
      const ex = U.rsun.value.clone().normalize(), ey = Mg.clone().addScaledVector(ex, -Mg.dot(ex)).normalize(), ez = new THREE.Vector3().crossVectors(ex, ey);
      sw.matrix.makeBasis(ex, ey, ez); dip.quaternion.setFromUnitVectors(Yax, Mg);
      // CME impact: 0–3 s the front sweeps in, then the shield is squeezed, holds, and relaxes
      let c = 0, R = S.Rw, al = S.alw;
      if (S.cme >= 0) { S.cme += dt; const u = S.cme; front.visible = u < 4.2;
        if (front.visible) { const x = 45 - u * 15; front.position.set(x + 14, 0, 0); front.scale.setScalar(14 + u * 3); front.material.uniforms.gate.value = Math.min(1, u * 2) * (1 - smooth(3, 4.2, u)); }
        c = smooth(2.6, 3.4, u) * (1 - smooth(16, 24, u)); if (u > 24) S.cme = -1;
        const h = shue(25, 1100, -25); R = S.Rw + (h.R - S.Rw) * c; al = S.alw + (h.al - S.alw) * c; }
      S.R0 += (R - S.R0) * Math.min(1, dt * (S.cme >= 0 ? 4 : 1.5)); U2.R0.value = S.R0; U2.cme.value = c; U2.al.value = al;
      if (Math.abs(al - alBuilt) > .02) { mp.geometry.dispose(); mp.geometry = lathe(al, 1); alBuilt = al; }
      mp.scale.setScalar(S.R0); bs.scale.setScalar(S.R0);
      U2.px.value = 1.1 * Math.tan(camera.fov * D2R / 2) * 2 / H; U3.dpr.value = renderer.getPixelRatio(); U3.spd.value = (c > .2 ? 1500 : S.v) / 60;
      AU.auB.value = 1 + 3.5 * c; belts[2].material.uniforms.k.value = .25 + .5 * c;
      g.updateMatrixWorld(true);
      put(LB[0], sw, S.R0 * 1.34, -1.6, 0, tr('Bow shock')); put(LB[1], sw, S.R0 * .2, S.R0 * 1.28, 0, tr('Magnetopause · {r} Earth radii', { r: S.R0.toFixed(1) }));
      put(LB[2], sw, -40, 8.5 * S.R0 / 10.5, 0, tr('Magnetic tail')); put(LB[3], dip, 0, 0, 4.4, tr('Van Allen belts'));
      put(LB[4], sw, 26, -8, 0, (c > .2 ? 'CME 1500 km/s' : tr('solar wind') + ' ' + Math.round(S.v) + ' km/s') + ' ← ' + tr('from the Sun'));
      put(LB[6], sw, -10, -13, 0, tr('to scale · particle flow sped up ~100×'));
      return 75; }   // how far past the Earth the camera must see (the Moon, the tail)
    return { update, S, get on() { return on; }, set on(v) { on = v; }, impact() { S.cme = 0; } };
  })();

  // ── controls: the buttons of the Earth view
  let spin = true, realSun = !!opts.realSun, tOver = null, visible = false, shownAt = 0; const clock = new THREE.Clock();
  const AUr = 1.495978707e8 / 6371, DAYms = 864e5, $ = k => el.querySelector('[data-k="' + k + '"]'), press = (b, on) => b.setAttribute('aria-pressed', !!on);
  const now = () => tOver != null ? tOver : (opts.time ? opts.time() : Date.now());
  const spinOff = () => { if (spin) { spin = false; press($('sp'), false); } };
  // Google Earth's 3D switch (tilts as you come down) + compass (tap = north up, flat) + the tilt / heading sliders
  const b3 = $('3d'), cmp = $('cmp'), pnl = el.querySelector('.e3g-pnl'), sT = pnl.querySelector('[data-s="tilt"]'), sH = pnl.querySelector('[data-s="head"]');
  press(b3, true); b3.onclick = () => { tkTo = tkTo > .05 ? 0 : 1; };
  cmp.onclick = () => { headTo = Math.round(headTo / (2 * Math.PI)) * 2 * Math.PI; };
  $('ang').onclick = e => { pnl.hidden = !pnl.hidden; press(e.currentTarget, !pnl.hidden); if (!pnl.hidden) info.hidden = true; else if (infoOf) info.hidden = false; };
  pnl.querySelector('[data-k="north"]').onclick = () => { headTo = Math.round(headTo / (2 * Math.PI)) * 2 * Math.PI; tkTo = 0; };
  sT.oninput = () => { tkTo = sT.value / 100; }; sH.oninput = () => { const w = ((headTo % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; headTo += sH.value * D2R - w; };
  $('zin').onclick = () => zoomBy(.5); $('zout').onclick = () => zoomBy(2);
  $('cl').onclick = e => { U.cloudOn.value = U.cloudOn.value ? 0 : 1; press(e.currentTarget, U.cloudOn.value); };
  // today's real clouds (NOAA GMGSI infrared mosaic, every 3 h by the Pages bot → branch "clouds") or the NASA composite; today's by default (not in storm mode), NASA if they can't load
  const CLN = 'https://raw.githubusercontent.com/ori0nori0ff/ori0nori0ff.github.io/clouds/', hr3 = Math.floor(Date.now() / 108e5);
  let cNow = null, cNowT = ''; const bCn = $('cn');
  const cUse = on => { U.clouds.value = on ? cNow : TX.clouds; bCn.textContent = on ? tr('Clouds: today') + (cNowT ? ' ' + cNowT : '') : tr('Clouds: NASA'); press(bCn, on); };
  const cLoad = (base, done, fail) => { fetch(base + 'clouds_now.json?' + hr3).then(r => r.json()).then(j => { cNowT = j.t.slice(11, 16) + ' UTC'; if (cNow && U.clouds.value === cNow) cUse(true); }).catch(() => {});
    new THREE.TextureLoader().load(base + 'clouds_now.jpg?' + hr3, t => { t.anisotropy = TX.clouds.anisotropy; cNow = t; done(); }, undefined, fail); };
  if (!(opts.storm ?? window.STORM)) cLoad(CLN, () => cUse(true), () => {}); else bCn.hidden = true;   // a storm replay is in the past: today's clouds would be wrong
  bCn.onclick = () => { if (cNow) cUse(U.clouds.value !== cNow); };
  $('au').onclick = e => { aurora.visible = !aurora.visible; press(e.currentTarget, aurora.visible); };
  press($('sun'), realSun); $('sun').onclick = e => { realSun = !realSun; press(e.currentTarget, realSun); };
  $('sp').onclick = e => { spin = !spin; press(e.currentTarget, spin); };
  // the shield: on / off; switched on close to the ground, the camera flies out to a side view (Sun on one side, the tail on the other)
  const shieldView = () => { const ex = U.rsun.value.clone().normalize(), Mg = nrmOf(80.7 * D2R, -72.7 * D2R), ey = Mg.addScaledVector(ex, -Mg.dot(ex)).normalize(), ez = new THREE.Vector3().crossVectors(ex, ey);
    const d = ez.multiplyScalar(.95).addScaledVector(ex, .05).addScaledVector(ey, .3).normalize(); goTo(Math.asin(d.y) / D2R, Math.atan2(-d.z, d.x) / D2R, 48 * 6371, ''); };
  const saveView = v => { try { localStorage.setItem('aurora.s3dlast', v); } catch (e) {} };
  const shield = () => { saveView('shield'); MSH.on = true; press($('ms'), true); if (focus !== 'Earth') flyToBody('Earth', 48); else if (rng < 20) shieldView(); };
  // fly to another body: the focus changes at once (the camera stays where it is), then it comes in to a sunlit side
  function flyToBody(name, r1, dir, keep) { const B = solar.bodies[name]; if (!B) return; const t = now(); solar.eclToWorld(t);
    const c = name === 'Earth' ? O3.clone() : solar.toWorld(solar.helio(name, t).map((v, i) => v - hE[i])), off = camera.position.clone().sub(c), d = off.length();
    look0.copy(camera.getWorldDirection(new THREE.Vector3())); lookU = 0;
    focus = name; Rf = B.R; Mprev = solar.eclToWorld(t).clone(); headTo = 0; if (name !== 'Earth') tkTo = 0;
    const a = off.normalize(), sunD = solar.toWorld(hE.map(v => -v)).sub(c).normalize();   // from the body toward the Sun
    const b = dir ? dir.clone().normalize() : name === 'Sun' ? solar.toWorld([0, 0, 1]).multiplyScalar(.75).addScaledVector(a, .66).normalize() : sunD.clone().multiplyScalar(.75).addScaledVector(a, .5).normalize();
    tgt.copy(a); rng = rngTo = Math.max(rMin(), d / Rf - 1);
    const ax = b.clone().addScaledVector(a, -a.dot(b)); if (ax.lengthSq() < 1e-9) ax.set(0, 1, 0); ax.normalize();
    const want = r1 != null ? r1 : name === 'Sun' ? 3.6 * 23481 / Rf : name === 'Earth' ? 3.2 : name === 'Saturn' ? 5 : 3;
    goal = { a, b, ax, ang: a.angleTo(b), u: 0, r0: rng, r1: want, hop: 0, dur: 2 + Math.min(3.5, Math.log10(1 + rng / want)) };
    spinOff(); vel = [0, 0]; plN = tr(name); plT = performance.now() + 6000; if (r1 == null) saveView(name); if (keep) return; if (r1 == null) showInfo(name); else hideInfo(); }
  // the info card of the focused body: facts, its magnetic field, the latest NASA pictures, Closer / Follow the orbit
  const FACT = { Sun: [1392700, 609.1, 0, 8], Mercury: [4879, 1407.6, 87.97, 0], Venus: [12104, -5832.5, 224.7, 0], Earth: [12742, 23.934, 365.256, 1],
    Moon: [3474.8, 655.7, 27.322, 0], Mars: [6779, 24.623, 686.98, 2], Jupiter: [139820, 9.925, 4332.6, 97], Saturn: [116460, 10.656, 10759, 274],
    Uranus: [50724, -17.24, 30687, 29], Neptune: [49244, 16.11, 60190, 16] };
  const FIELD = { Sun: 'Closed loops near the Sun (orange); beyond ~2.5 solar radii the wind drags the lines into spirals that reach every planet (blue = towards the Sun, red = away). The wavy violet sheet is where they flip; bright dots ride the lines at the wind’s speed.',
    Mercury: 'A weak field, 1% of Earth’s; the solar wind almost touches the ground.', Venus: 'No global magnetic field: the solar wind strips its upper air directly.',
    Earth: 'Our shield: the magnetopause stands ~10 Earth radii towards the Sun, the tail stretches past the Moon. Where the field lines reach the poles: auroras.',
    Moon: 'No global field today; old lunar rocks show it had one billions of years ago.',
    Mars: 'Lost its global field ~4 billion years ago — and most of its atmosphere with it.', Jupiter: 'The biggest magnetosphere in the system: if we could see it, it would look bigger than the full Moon in our sky.',
    Saturn: 'Its field is almost perfectly lined up with its spin axis.', Uranus: 'Tilted ~60° and off-centre: its magnetosphere tumbles as it turns.', Neptune: 'Tilted ~47° and off-centre, like Uranus.' };
  const MOONS = { Earth: 'the Moon', Mars: 'Phobos, Deimos' }, PHOTO = {}, PHN = {}, info = el.querySelector('.e3g-info'), nf = v => Math.round(v).toLocaleString(window.LOC || 'en-GB');
  const span = h => { const a = Math.abs(h); return a < 48 ? `${Math.floor(a)} h ${Math.round(a % 1 * 60)} m` : a < 24 * 1000 ? `${(a / 24).toFixed(a < 240 ? 1 : 0)} ${tr('days')}` : `${(a / 8766).toFixed(1)} ${tr('years')}`; };
  async function photos(nm, host) { try {
      if (!PHOTO[nm]) {
        if (nm === 'Earth') { const r = await (await fetch('https://epic.gsfc.nasa.gov/api/natural')).json();
          PHOTO[nm] = r.slice(-3).reverse().map(x => { const d = x.date.slice(0, 10).replace(/-/g, '/'); return { t: x.date.slice(0, 10), cap: tr('Earth from DSCOVR, 1.5 million km away'), src: `https://epic.gsfc.nasa.gov/archive/natural/${d}/thumbs/${x.image}.jpg`, href: `https://epic.gsfc.nasa.gov/archive/natural/${d}/png/${x.image}.png` }; }); }
        else { const r = await (await fetch(`https://images-api.nasa.gov/search?keywords=${encodeURIComponent(nm)}&media_type=image&year_start=2012`)).json(), seen = new Set();
          PHOTO[nm] = r.collection.items.filter(x => x.links && x.data[0].title.toLowerCase().includes(nm.toLowerCase()) && !seen.has(x.data[0].title) && seen.add(x.data[0].title))
            .sort((a, b) => b.data[0].date_created.localeCompare(a.data[0].date_created)).slice(0, 3)
            .map(x => ({ t: x.data[0].date_created.slice(0, 10), cap: x.data[0].title, src: x.links[0].href, href: `https://images.nasa.gov/details/${encodeURIComponent(x.data[0].nasa_id)}` })); } }
      const L = PHOTO[nm], q = v => v.replace(/[<>&"]/g, c => '&#' + c.charCodeAt(0) + ';'); if (!L.length) { host.innerHTML = ''; return; }
      host.innerHTML = `<small>${tr('Latest pictures')} · NASA</small><div>` + L.map(x => `<a href="${q(x.href)}" target="_blank" rel="noopener" title="${q(x.cap)}"><img src="${q(x.src)}" alt="${q(x.cap)}" loading="lazy"><span>${x.t}</span></a>`).join('') + '</div>';
    } catch (e) { host.innerHTML = ''; } }
  const photoNode = nm => { if (PHN[nm]) return PHN[nm]; const h = PHN[nm] = document.createElement('div'); h.className = 'e3g-iph'; h.innerHTML = `<small>${tr('Latest pictures')} · ${tr('loading…')}</small>`; photos(nm, h); return h; };
  let infoOf = null, orbitOn = 0, orbitWait = 0, infoAt = 0, orbView = false;
  function liveInfo(t) { const o = info.querySelector('.e3g-il'); if (!o || !infoOf) return; const E = solar.helio('Earth', t), P = infoOf === 'Earth' ? E : solar.helio(infoOf, t);
    const de = Math.hypot(P[0] - E[0], P[1] - E[1], P[2] - E[2]) / AUr, ds = Math.hypot(...P) / AUr;
    o.innerHTML = infoOf === 'Earth' ? `<small>${tr('From the Sun')}</small>${ds.toFixed(3)} AU · ${(ds * 8.317).toFixed(1)} ${tr('light min')}`
      : infoOf === 'Moon' ? `<small>${tr('From Earth')}</small>${nf(de * 1.495978707e8)} km · ${(de * 499).toFixed(2)} ${tr('light s')}`
      : `<small>${tr('From Earth')}</small>${de.toFixed(2)} AU · ${(de * 8.317).toFixed(1)} ${tr('light min')}`; }
  function showInfo(nm) { infoOf = nm; orbitOn = orbitWait = 0; const F = FACT[nm]; pnl.hidden = true; press($('ang'), false);
    info.innerHTML = `<div class="e3g-ih"><b>${tr(nm)}</b><button aria-label="${tr('Close')}">✕</button></div>
      <div class="e3g-if"><div><small>${tr('Diameter')}</small>${nf(F[0])} km</div><div class="e3g-il"></div>
      <div><small>${nm === 'Sun' ? tr('Turns once in') : tr('Day / year')}</small>${span(F[1])}${F[1] < 0 ? ' ↺' : ''}${F[2] ? ' · ' + span(F[2] * 24) : ''}</div>
      <div><small>${nm === 'Sun' ? tr('Planets') : tr('Moons')}</small>${MOONS[nm] ? tr(MOONS[nm]) : F[3] || '—'}</div></div>
      <div class="e3g-im">🧲 ${tr(FIELD[nm])}</div>
      <div class="e3g-ib"><button data-i="near">${tr('Closer')}</button>${F[2] ? `<button data-i="orb" aria-pressed="false">${tr('Follow the orbit')}</button>` : ''}</div>`;
    info.insertBefore(photoNode(nm), info.querySelector('.e3g-ib')); liveInfo(now()); info.hidden = false;
    info.querySelector('.e3g-ih button').onclick = hideInfo;
    info.querySelector('[data-i="near"]').onclick = () => { if (focus !== nm || orbView) { orbView = false; flyToBody(nm, undefined, null, true); } else zoomBy(.3); };
    const ob = info.querySelector('[data-i="orb"]'); if (ob) ob.onclick = () => { const on = !(orbitOn || orbitWait), rate = F[2] * DAYms / 40; orbitOn = orbitWait = 0; press(ob, on); if (!on) return; spinOff();
      // the camera stays on the planet, steps back outward + up: the Sun and the inner orbits stay in view behind it, so you see it move
      const t = now(), E = solar.helio('Earth', t), P = solar.helio(nm, t), rel = nm === 'Moon' ? P.map((v, i) => v - E[i]) : P,
        a = Math.hypot(...rel), u = rel.map(v => v / a), dir = solar.toWorld([u[0] * .55, u[1] * .55, .65]), back = a * 2.6 / solar.bodies[nm].R;
      if (focus !== nm || Math.abs(rng - back) > back * .2) { flyToBody(nm, back, dir, true); orbitWait = rate; } else orbitOn = rate; orbView = true; }; }
  function hideInfo() { info.hidden = true; infoOf = null; orbitOn = orbitWait = 0; }
  $('sys').onclick = () => flyToBody('Sun'); $('home').onclick = () => flyToBody('Earth');
  const bl = el.querySelector('.e3g-bl'), lp = el.querySelector('.e3g-lp'), pop = (b, p, on) => { p.hidden = !on; b.setAttribute('aria-expanded', on); };
  $('bodies').onclick = () => { pop($('bodies'), bl, bl.hidden); bl.querySelectorAll('[data-b]').forEach(o => o.setAttribute('aria-current', o.dataset.b === focus)); };
  bl.onclick = e => { const b = e.target.closest('[data-b]'); if (!b) return; pop($('bodies'), bl, false); if (b.dataset.b !== focus) flyToBody(b.dataset.b); };
  $('layers').onclick = () => pop($('layers'), lp, lp.hidden);
  el.addEventListener('pointerdown', e => { if (!e.target.closest('.e3g-bl,[data-k="bodies"]')) pop($('bodies'), bl, false); if (!e.target.closest('.e3g-lay')) pop($('layers'), lp, false); });
  $('rs').onclick = e => { solar.realScale = !solar.realScale; press(e.currentTarget, solar.realScale); };
  $('gd').onclick = e => { solar.guides = !solar.guides; press(e.currentTarget, solar.guides); };
  $('sw').onclick = e => { solar.wind = !solar.wind; press(e.currentTarget, solar.wind); };
  $('sf').onclick = e => { solar.field = !solar.field; press(e.currentTarget, solar.field); if (!solar.field) { solar.bare = false; press($('dw'), false); } };
  $('dw').onclick = e => { solar.bare = !solar.bare; press(e.currentTarget, solar.bare); if (!solar.bare) return; solar.field = true; press($('sf'), true); flyToBody('Sun', 110 * 23481 / solar.bodies.Sun.R, null, true); };
  // the wind + CME data come from the page (space3d: ENLIL at Earth + DONKI); a CME reaching the Earth squeezes the shield once
  let wSeen = null, cSeen = null, feedAt = 0, hitC = null;
  function feed(t) { if (performance.now() - feedAt > 1000) { feedAt = performance.now();
      const w = opts.wind && opts.wind(), c = opts.cmes && opts.cmes(); if (w && w !== wSeen) { wSeen = w; solar.setWind(w); } if (c && c !== cSeen) { cSeen = c; solar.setCmes(c); } }
    const st = solar.cmeAtEarth(t); if (st.hit && st.f > .3 && st.hit !== hitC) { hitC = st.hit; if (MSH.on) MSH.impact(); } }
  $('ms').onclick = () => { if (MSH.on && rng >= 20) { MSH.on = false; press($('ms'), false); } else shield(); };
  $('cme').onclick = () => { const far = rng >= 20; shield(); setTimeout(() => MSH.impact(), far ? 0 : 2600); };
  const pad = v => String(v).padStart(2, '0'), localStr = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const di = $('date'); di.onchange = () => { const t = Date.parse(di.value); if (isFinite(t)) tOver = t; };
  $('now').onclick = () => { tOver = null; di.value = localStr(now()); };
  // time of day at the place you look at: local Sun time (UTC + longitude / 15) on the same day; moving it switches the real Sun on
  const tod = $('tod'), todL = el.querySelector('.e3g-tod span'), lonHere = () => { const o = tgt.clone().applyQuaternion(earth.quaternion.clone().invert()); return Math.atan2(-o.z, o.x) / D2R; };
  const solarMin = t => ((t / 6e4 + lonHere() * 4) % 1440 + 1440) % 1440, hm = m => pad(Math.floor(m / 60) % 24) + ':' + pad(Math.floor(m % 60));
  let todDrag = false;
  tod.oninput = () => { todDrag = true; const base = now(), want = +tod.value; let t = base + ((want - solarMin(base) + 2160) % 1440 - 720) * 6e4;   // the nearest moment with that Sun time
    tOver = t; di.value = localStr(t); if (!realSun) { realSun = true; press($('sun'), true); } };
  tod.onchange = () => { todDrag = false; };
  // ‹ › : a click = 10 minutes; held, the time runs, faster the longer you hold
  // ── search any place (Open-Meteo geocoding = GeoNames) or type "lat, lon"; the camera flies there
  let goal = null, plN = '', plT = 0;
  const kmFor = c => /^PCL/.test(c) ? 2600 : /^ADM1/.test(c) ? 700 : /^ADM2/.test(c) ? 250 : /^(MT|PK|VLC|HLL|PASS|CNYN|GLCR)/.test(c) ? 9 : /^PPLC|PPLA$/.test(c) ? 35 : 22;
  function goTo(lat, lon, km, name) { const b = nrmOf(lat * D2R, lon * D2R).applyQuaternion(earth.quaternion), a = tgt.clone(), ang = a.angleTo(b);
    const ax = b.clone().addScaledVector(a, -a.dot(b)); if (ax.lengthSq() < 1e-9) ax.copy(cE); ax.normalize();
    goal = { a, b, ax, ang, u: 0, r0: rng, r1: Math.max(RMIN * 4, km / 6371), hop: Math.min(2.2, ang * .9) * Math.min(1, ang * 6), dur: 1.6 + Math.min(3, ang * 1.6) };
    spinOff(); vel = [0, 0]; headTo = 0; tkTo = 1; plN = name; plT = performance.now() + 9000; }
  { const fi = $('find'), ul = fi.nextElementSibling; let hits = [], sel = -1, qn = 0, tmr = 0;
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const draw = () => { ul.innerHTML = hits.map((h, i) => `<li role="option" data-i="${i}" aria-selected="${i === sel}">${esc(h.name)}<small>${esc([h.admin1, h.country].filter(Boolean).join(', '))}${h.elevation != null ? ' · ' + Math.round(h.elevation) + ' m' : ''}</small></li>`).join(''); };
    const pick = h => { if (!h) return; fi.value = h.name; hits = []; draw(); fi.blur(); goTo(h.latitude, h.longitude, h.km || kmFor(h.feature_code || ''), h.name); };
    const ask = async v => { const n = ++qn, m = v.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (m) { const la = +m[1], lo = +m[2]; if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) { hits = [{ name: la.toFixed(4) + ', ' + lo.toFixed(4), latitude: la, longitude: lo, km: 15 }]; sel = 0; draw(); } return; }
      if (v.trim().length < 2) { hits = []; draw(); return; }
      const lang = (typeof LANG === 'string' && LANG) || document.documentElement.lang || 'en';
      try { const r = await (await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(v.trim()) + '&count=8&language=' + lang + '&format=json')).json();
        if (n !== qn) return; hits = r.results || []; sel = hits.length ? 0 : -1; if (!hits.length) { ul.innerHTML = `<li aria-disabled="true"><small>${esc(tr('No place found'))}</small></li>`; return; } draw(); } catch (e) {} };
    fi.oninput = () => { clearTimeout(tmr); tmr = setTimeout(() => ask(fi.value), 250); };
    fi.onkeydown = e => { e.stopPropagation(); if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (hits.length) { sel = (sel + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; draw(); } }
      else if (e.key === 'Enter') { e.preventDefault(); pick(hits[Math.max(0, sel)]); } else if (e.key === 'Escape') { hits = []; draw(); fi.blur(); } };
    ul.onpointerdown = e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pick(hits[+li.dataset.i]); } };
    fi.onblur = () => setTimeout(() => { hits = []; draw(); }, 150); }
  for (const [k, dir] of [['todB', -1], ['todF', 1]]) { const b = $(k); let iv = null, n = 0;
    const step = () => { const t = now() + dir * 6e5 * (n < 8 ? 1 : n < 30 ? 2 : 4); tOver = t; di.value = localStr(t); n++; if (!realSun) { realSun = true; press($('sun'), true); } };
    const stop = () => { clearInterval(iv); iv = null; };
    b.onpointerdown = e => { e.preventDefault(); b.setPointerCapture(e.pointerId); n = 0; step(); stop(); iv = setInterval(step, 90); };
    b.onpointerup = b.onpointercancel = b.onlostpointercapture = stop;
    b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); n = 0; step(); } }; }
  const todShow = t => { const m = solarMin(t); if (!todDrag) tod.value = Math.round(m / 5) * 5; todL.textContent = hm(m) + ' ' + tr('Sun time'); };
  const lm = new THREE.Matrix4(), O3 = new THREE.Vector3();
  function resize() { W = Math.max(200, host.clientWidth); H = Math.max(200, host.clientHeight); PRMAX = prCap(); PR = Math.min(PR, PRMAX);
    camera.aspect = W / H; camera.updateProjectionMatrix(); renderer.setPixelRatio(PR); renderer.setSize(W, H); composer.setPixelRatio(PR); composer.setSize(W, H); pHold = Math.max(pHold, 3); }
  if (window.ResizeObserver) new ResizeObserver(() => visible && resize()).observe(host);
  mgr.onLoad = () => { readyAt = performance.now(); el.querySelector('.e3g-load').remove(); renderer.domElement.classList.add('on'); };
  // zooming out past ~700 000 km leaves for the solar system
  const out = () => { if (visible && opts.onOut && performance.now() - shownAt > 900) opts.onOut(); };
  renderer.domElement.addEventListener('wheel', e => { if (e.deltaY > 0 && rngTo >= rMax() * .999) out(); }, { passive: true });


  const inv = new THREE.Matrix4();
  let qBprev = null, qBname = null;
  let fpsN = 60, slow = 0, fast = 0, readyAt = 0, msX = 0, hE = [0, 0, 0], Mprev = null, lookU = 1; const fc = new THREE.Vector3(), look = new THREE.Vector3(), look0 = new THREE.Vector3(); const PRMIN = Math.min(Q === "low" ? .6 : 1, prCap()); let PRMAX = prCap();
  function frame() {
    if (startV && ++startN > 20) { const v = startV; startV = null; goStart(v); }
    const P = !!(opts.paused && opts.paused());
    if (P) { if (!wasP) { wasP = true; pHold = Math.max(pHold, 120); } if (pHold <= 0) return; pHold--; } else wasP = false;
    const dt0 = clock.getDelta(); fpsN += (1 / Math.max(dt0, 1e-3) - fpsN) * .05;
    // adaptive resolution: if frames run long for a while, render fewer pixels; give them back when it is smooth again
    if (readyAt && performance.now() - readyAt > 3000) { if (dt0 > .03) { slow++; fast = 0; } else if (dt0 < .016) { fast++; slow = Math.max(0, slow - 2); } }
    if (slow > 90 && PR > PRMIN) { PR = Math.max(PRMIN, PR - .1); resize(); slow = 0; }
    else if (fast > 180 && PR < PRMAX) { PR = Math.min(PR + .1, PRMAX); resize(); fast = 0; }
    if (orbitWait && !goal) { orbitOn = orbitWait; orbitWait = 0; }
    if (orbitOn) { tOver = now() + Math.min(.1, dt0) * orbitOn; if (performance.now() - infoAt > 250) di.value = localStr(tOver); }
    const dt = Math.min(.05, dt0), t = now(); hE = solar.helio('Earth', t);
    if (infoOf && performance.now() - infoAt > 250) { infoAt = performance.now(); liveInfo(t); }
    {
      const kk = Math.min(1, dt * 6);
      solar.eclToWorld(t); fc.copy(focus === 'Earth' ? O3 : solar.toWorld(solar.helio(focus, t).map((v, i) => v - hE[i])));
      const fB = focus !== 'Earth' && rng < 2 && solar.bodies[focus];   // close to a body: it alone turns the camera (its rotation already holds the frame's)
      if (focus !== 'Earth' && Mprev && !(fB && qBname === focus)) { const qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(solar.eclToWorld(t).clone().multiply(Mprev.clone().invert()))); tgt.applyQuaternion(qd); if (goal) { goal.a.applyQuaternion(qd); goal.b.applyQuaternion(qd); goal.ax.applyQuaternion(qd); } }   // away from the Earth the view stays still among the stars
      Mprev = solar.eclToWorld(t).clone();
      // close to another body (within 2 radii) the camera turns with it, so its ground doesn't slide away under you
      { const B = fB; if (B) { if (qBprev && qBname === focus) { const qd = B.mesh.quaternion.clone().multiply(qBprev.clone().invert());
            frameAt(); const F = cF.clone().applyQuaternion(qd), h0 = head; tgt.applyQuaternion(qd);
            head = 0; frameAt(); let dh = Math.atan2(F.dot(cE), F.dot(cN)) - h0; dh -= 2 * Math.PI * Math.round(dh / (2 * Math.PI)); head = h0 + dh; headTo += dh; if (goal) { goal.a.applyQuaternion(qd); goal.b.applyQuaternion(qd); goal.ax.applyQuaternion(qd); } }
          qBprev = (qBprev || new THREE.Quaternion()).copy(B.mesh.quaternion); qBname = focus; } else qBname = null; }
      if (spin && rng > .4) tgt.applyAxisAngle(Yax, dt * .02 * Math.min(1, rng));   // a slow turn seen from far away
      if (!pins.size && (vel[0] || vel[1])) { panBy(vel[0], vel[1]); vel = vel.map(v => Math.abs(v *= Math.pow(.05, dt)) < .05 ? 0 : v); }   // the throw glides on
      if (goal) { goal.u = Math.min(1, goal.u + dt / goal.dur); const e = goal.u * goal.u * (3 - 2 * goal.u);   // fly: up, across, down (log range + a hop that grows with the distance)
        tgt.copy(goal.a).lerp(goal.b, e).normalize(); if (goal.ang > 3.1) tgt.copy(goal.a).multiplyScalar(Math.cos(e * goal.ang)).addScaledVector(goal.ax, Math.sin(e * goal.ang)).normalize();
        rng = rngTo = Math.exp(Math.log(goal.r0) * (1 - e) + Math.log(goal.r1) * e) + goal.hop * Math.sin(Math.PI * e); if (goal.u >= 1) goal = null; }
      rng *= Math.pow(rngTo / rng, kk); head += (headTo - head) * kk; tk += (tkTo - tk) * kk; tilt = tk * maxTilt(rng * Rf);
      frameAt(); const ct = Math.cos(tilt), st = Math.sin(tilt);
      // the camera looks at the ground itself (not the sea-level sphere under it) and never goes below 40 m over the drawn relief
      const qi = earth.quaternion.clone().invert(), tO = tgt.clone().applyQuaternion(qi), gt = focus === 'Earth' && rng < .5 ? gMax(tO) : rng < .5 && solar.hdOn(focus) ? solar.hdGround(focus, tgt) : 0;
      gT += (gt - gT) * (focus === 'Earth' && Math.abs(gt - gT) > 3e-4 ? 1 : Math.min(1, dt * (focus === 'Earth' ? 5 : 3)));   // other bodies: always glide (steep relief)
      const pos = new THREE.Vector3(), place = r => pos.copy(tgt).multiplyScalar(Rf * (1 + gT + r * ct)).addScaledVector(cF, -r * st * Rf).add(fc), MARG = 40 / 6371000;
      let gc = 0; if (focus !== 'Earth') { place(rng);   // a body with an HD close-up: stay ~300 m over its relief
        if (rng < .5 && solar.hdOn(focus)) { const dv = pos.clone().sub(fc), g = solar.hdGround(focus, dv.clone().normalize()), need = Rf * (1 + g + 300 / (Rf * 6371000));
          gL = Math.max(gL - dt * Rf * 2e-3, need); if (dv.length() < gL) pos.copy(fc).addScaledVector(dv.normalize(), gL); } else gL = 0; }   // only lift the camera itself, smoothly down again
      else for (let n = 0; n < 24; n++) { place(rng); gc = rng < .5 ? gMax(pos.clone().normalize().applyQuaternion(qi)) : 0; if (pos.length() - 1 >= gc + MARG) break; rng *= 1.12; rngTo = Math.max(rngTo, rng); }
      hAG = Math.max(MARG * .5, pos.length() - 1 - gc);
      camera.position.copy(pos); camera.up.copy(tgt).multiplyScalar(st).addScaledVector(cF, ct); look.copy(tgt).multiplyScalar(Rf * (1 + gT)).add(fc);
      if (lookU < 1) { lookU = Math.min(1, lookU + dt / 1.4); const e = lookU * lookU * (3 - 2 * lookU), dn = look.clone().sub(pos).normalize(); look.copy(pos).add(look0.clone().lerp(dn, e).normalize()); }   // after a change of focus the view turns smoothly to the new body
      camera.lookAt(look);
      sH.value = Math.round((((head % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) / D2R); sT.value = Math.round(tkTo * 100);
      cmp.firstChild.style.transform = `rotate(${-head / D2R}deg)`; press(b3, tkTo > .05); }
    const D = camera.position.length();
    air.visible = true;
    U.cloudFade.value = smooth(.02, .1, D - 1); cloudLayer.visible = !!U.cloudOn.value && U.cloudFade.value > 0;   // clouds clear away as you come down
    U.hdA.value = 1 - smooth(.4, .7, D - 1);
    stars.rotation.y = -gmst(t) - Math.PI;
    solar.eclToWorld(t); const s = solar.toWorld(hE.map(v => -v)).normalize().applyQuaternion(earth.quaternion.clone().invert()); U.rsun.value.copy(s);   // in the Earth's own frame
    if (realSun) U.sun.value.copy(s);
    // studio light from the untilted view (looking at the centre), so tilting does not swing the light
    else { camera.updateMatrixWorld(); const m = lm.lookAt(camera.position, O3, Math.abs(camera.position.clone().normalize().y) > .98 ? cF : Yax).elements, R = new THREE.Vector3(m[0], m[1], m[2]), Up = new THREE.Vector3(m[4], m[5], m[6]), B = new THREE.Vector3(m[8], m[9], m[10]);
      const Lw = R.multiplyScalar(-.5).add(Up.multiplyScalar(.52)).add(B.multiplyScalar(.69)).normalize();   // studio light: mostly from the front, a little from the upper left
      U.sun.value.copy(Lw.applyQuaternion(earth.quaternion.clone().invert())); }
    if (!realSun && MSH.S.fade > 0) U.sun.value.lerp(s, MSH.S.fade).normalize();   // the shield points at the real Sun: so does the light, out there
    U.lightsOn.value += ((realSun ? 1 : MSH.S.fade) - U.lightsOn.value) * Math.min(1, dt * 3);
    camera.near = Math.max(Math.min(D - 1, hAG, msX ? 1.5 : 1e9) * .3, 3e-7); camera.far = Math.max(D + 1.2, msX ? D + msX : 0);   // the far side of the air and aurora shells too
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(); msX = MSH.update(dt, t, D);
    const pix = 2 * Math.tan(camera.fov * D2R / 2) / H, nearOn = 1 / (D * pix) > 2.5;   // the detailed Earth until it is a few pixels across
    scene.visible = nearOn; el.classList.toggle('nf', focus !== 'Earth');
    { const ch = solar.fromWorld(camera.position); solar.update(t, [hE[0] + ch.x, hE[1] + ch.y, hE[2] + ch.z], W, H, nearOn, renderer.getPixelRatio()); feed(t); }
    { const k = solar.cam.far * .45 / 900; stars.scale.set(-k, k, k); }
    inv.copy(earth.matrixWorld).invert(); U.camO.value.copy(camera.position).applyMatrix4(inv);
    sunQ.visible = sunD.visible = realSun;
    { const up = U.camO.value.clone().normalize(), dayK = realSun ? smooth(-.12, .06, up.dot(U.sun.value)) * (1 - smooth(25, 110, (D - 1) * 6371)) : 0;   // no stars in a daytime sky
      stars.material.color.setRGB(.5, .5, .52).multiplyScalar(1 - .97 * dayK); }
    if (sunQ.visible) { const dd = camera.far - .05;   // just beyond the far side of the Earth, so the globe hides it
      sunW.copy(U.sun.value).applyQuaternion(earth.quaternion); sunQ.position.copy(camera.position).addScaledVector(sunW, dd);
      sunQ.quaternion.copy(camera.quaternion); sunQ.scale.setScalar(dd * Math.tan(SUNA));
      sunD.position.copy(sunQ.position); sunD.quaternion.copy(camera.quaternion); sunD.scale.setScalar(dd * Math.tan(.0075)); sunQ.material.uniforms.toObj.value.setFromMatrix4(inv); }
    hd.visible = U.hdA.value > 0; if (hd.visible) hdUpdate(D); U.pxk.value = pxK; U.wtime.value += dt;
    U.cloudShift.value = (t % 864e5) / 864e5 * .002;   // a slow drift so the clouds feel alive
    auMat.uniforms.time.value += dt;
    const km = focus === 'Earth' ? (D - 1) * 6371 : rng * Rf * 6371, cl = U.camO.value.clone().normalize();
    if (focus !== 'Earth' && solar.bodies[focus]) cl.copy(camera.position).sub(fc).applyQuaternion(solar.bodies[focus].mesh.quaternion.clone().invert()).normalize();   // another body: its own latitude / longitude
    todShow(t);
    el.querySelector('.e3g-alt').innerHTML = `${focus !== 'Earth' ? tr(focus) + ' · ' : ''}${tr('Altitude')} ${km >= 1000 ? Math.round(km).toLocaleString(window.LOC || 'en-GB') : km.toFixed(km < 10 ? 1 : 0)} km${focus === 'Earth' && hAG * 6371 < 3 ? ' · ' + Math.round(hAG * 6371000) + ' m ' + tr('above the ground') : ''}<small>${plN && performance.now() < plT ? '<b style="color:#39FF9E">' + plN + '</b> · ' : ''}${(Math.asin(cl.y) / D2R).toFixed(2)}°, ${(Math.atan2(-cl.z, cl.x) / D2R).toFixed(2)}° · ${new Date(t).toLocaleString(window.LOC || 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${tOver != null ? '' : ' · ' + tr('live')}</small>`;
    airPass.uniforms.projInv.value.copy(camera.projectionMatrixInverse); airPass.uniforms.camW.value.copy(camera.matrixWorld); airPass.uniforms.toObj.value.setFromMatrix4(inv); airPass.uniforms.cn.value.set(camera.near, camera.far); airPass.enabled = air.visible && scene.visible;
    composer.render();
    if (P && pHold === 0 && readyAt) try { localStorage.setItem('aurora.s3dsnap', renderer.domElement.toDataURL('image/jpeg', .7)); } catch (e) {}
  }
  let wasP = false, pHold = 0;
  const api = {
    show(lat, lon, far) { shownAt = performance.now(); el.classList.add('on'); visible = true; resize(); di.value = localStr(now()); clock.getDelta();
      const p = nrmOf((lat ?? 45.6) * D2R, (lon ?? 25.6) * D2R).applyQuaternion(earth.quaternion);
      focus = 'Earth'; Rf = 1; Mprev = null; tgt.copy(p); head = headTo = 0; vel = [0, 0]; rng = far ? 110 : 3.2; rngTo = 3.2;   // arriving from the solar system: come down to the globe
      renderer.setAnimationLoop(frame); },
    hide() { el.classList.remove('on'); visible = false; renderer.setAnimationLoop(null); },
    setTime() {}, flyTo() {}, setPlaces(p) { opts.places = p; }, shield() { shield(); },
    start(v) { startV = v; startN = 0; } };
  let startV = null, startN = 0;
  function goStart(v) { if (v === 'shield') shield(); else if (v === 'sys') flyToBody('Sun', undefined, null, true); else if (v && v !== 'Earth' && v !== 'earth' && solar.bodies[v]) flyToBody(v, undefined, null, true); }
  return api;
}
window.Earth3D = { create, sunDir: t => { const v = sunDir(t); return [v.x, v.y, v.z]; } };
