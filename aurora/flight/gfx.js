/* Craft visuals (docs/flight-plan.md, step S3): the 3D model on the craft (glTF, three.js r170 GLTFLoader), control surfaces moved from the S2
   state, engine plume / afterburner, contrails, navigation / strobe / landing lights, the craft's shadows, a re-entry plasma glow hook (S5),
   a sky environment for the PBR materials, and the free orbit view. Own code (no GPL code).
   Everything is drawn in earthgl's craft layer (api.flight().craftLayer): an ordinary scene in W (R⊕) moved by −camera.position each frame, so
   all positions stay small (S0a: never bake world coordinates into vertices). Inside the craft group: metres, body axes x right, y up, −z forward.
   The ground is not in this layer: the shadow on the ground is the model projected onto the ground's tangent plane (planar shadow), the landing
   light is a light pool drawn on that plane, and both are shown only near the ground. */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { atmosphere } from './atmos.js?v=7ee6d1db';

const R_E = 6371000, D2R = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// per model: points not in the file (metres, craft frame). Estimates read off the model, labelled.
export const MODELS = {
  f16: { url: new URL('models/f16/f16.gltf', import.meta.url), credit: 'F-16D 3D model: alexskyrex-5de5f7 (CGTrader, Royalty Free licence, not redistributable)',
    // the Falcon BMS 4.38 F-16CM-50 airframe (model 1052, tools/build_bms_exterior.py): used instead of `url` unless o.ext === 'old' or it fails to load.
    // Its root is already placed in the craft frame (canopy lined up with the BMS cockpit at `eye`). Lights / lamp / nozzle: read off the BMS model.
    bms: { url: new URL('models/f16-bms/f16-bms.glb', import.meta.url), credit: 'Airframe: Falcon BMS 4.38 F-16CM-50 model (Benchmark Sims), used with permission',
      // light lenses (centres of the Lights_CM50_2 geometry, measured 2026-11-15): wing tips (switch 8), fin tip (switch 7: tail light + strobe)
      nav: { red: [-4.66, .39, 1.59], green: [4.66, .39, 1.59], tail: [0, 3.60, 5.53] }, strobe: [0, 3.62, 5.50],
      land: [.2, -.82, -3.66],    // landing / taxi lamp lenses (switches 9 / 72) on the nose gear door (DOF 22): followed per frame through `lampSw`
      lampSw: [9, 72], gearSw: [20, 21, 22],   // switches holding the nose / left / right gear legs (one branch each: on / off)
      // gear sequence from the sim's gear value G (1 down .. 0 up), measured 2026-11-15 (door points inside each wheel's cylinder):
      // the main doors (hinged on their outer edge) hang at 90 deg with the gear down, right in the wheel's path (overlap from leg 0.7 down);
      // at >= 105 deg the path is clear down to leg 0.2. So, going up: doors 90 -> 110 deg (G 1 .. 0.9), legs 1 -> 0.2 (G 1 .. 0.35),
      // doors shut (G 0.35 .. 0.05) with the legs held at 0.2; legs off once the doors pass 100 deg (hide = 100 / 110): below 90 deg the
      // closing door cuts the tyre at every leg position 0-0.3 (the stowed wheel sits in the shut door's place; BMS hides the legs too).
      // Down = the same reversed.
      gearSeq: { legs: .35, lMin: .2, overAt: .9, over: 110, shut: .05, hide: .91 },
      hideSw: [60, 73],           // ground equipment: 60 boarding ladder, 73 wheel chocks + "remove before flight" streamers (seen 2026-11-15)
      // DOF signs (+1 / -1, our deg -> BMS rad), measured 2026-11-15 by the moved vertices at +0.3 rad: stab / flap + = trailing edge down,
      // lef + = leading edge down, rudder + = trailing edge right (so -1). Nozzle DOF 39: 0 = open (exit ring r 0.50 m), + closes (0.3 -> 0.29 m);
      // noz = the value at MIL (closed; estimate r ~0.35 m, F110 exit ~0.7 x open). Gear DOF values with the gear down (= the DOF's max; 0 = up, the rest pose)
      sign: { stab: 1, flap: 1, lef: 1, rud: -1, noz: .22, gear: { 19: 1.92, 20: 1.48, 21: 1.48, 22: 1.31, 23: 1.62, 24: 1.62 } },
      // gear struts (measured 2026-11-15): lowest tyre point with the gear down and the struts extended (craft frame, m); k = DOF value per metre the
      // wheel moves up (58 nose: translate, -0.1 ft -> 29 mm; 59 / 60 mains: rotate, -0.1 rad -> 109 mm); max = stroke used (estimates; BMS clamps 60 at 0.087 rad)
      // (static on the runway: wheels 31-83 mm below the ground without the struts, within 2 mm with them)
      strut: [{ dof: 58, low: [.005, -1.500, -3.717], k: -1 / .29, max: .15 }, { dof: 59, low: [-1.219, -1.493, .370], k: -1 / 1.09, max: .095 },
        { dof: 60, low: [1.218, -1.493, .371], k: -1 / 1.09, max: .095 }],
      spin: { 50: .218, 51: .369, 52: .369 } },   // wheel DOFs: tyre radius (m); + = rolling forward (bottom moves aft)
    // where the BMS cockpit's origin (its eye) sits in the craft (estimate from S4: ~25 cm in front of the seat's head rest)
    eye: [0, 1.29, -4.70],
    // the pilot's head = eye + BMS head_translation_offset (Data/Art/CkptArt/3dCkpit.dat: forward 0.1 ft, down 0.02 ft); flight/instruments/f16.js
    // uses the same point for the HUD (keep both equal)
    head: [0, 1.29 - .0061, -4.70 - .0305],
    // the Falcon BMS 4.38 cockpit (model 888, tools/build_bms_cockpit.py; loaded the first time the Cockpit view is used): node origin = the BMS eye, placed at `eye`
    cockpit: { url: new URL('models/f16-cockpit/bms-cockpit.glb', import.meta.url),
      credit: 'Cockpit: Falcon BMS 4.38 F-16 cockpit model (Benchmark Sims), used with permission',
      cut: [[-.4, .75, -5.9], [.4, 1.75, -4.25]] },   // box (craft frame) where the F-16D body's own cockpit block is not drawn while the cockpit is shown
    seat: { url: new URL('models/seat/seat.gltf', import.meta.url), credit: 'Ejection seat: "Fighter Jet Ejection Seat" by k.botond431 (Sketchfab), CC BY 4.0, scaled',
      at: [[0, .2, -4.55], [0, .3, -2.75]] },   // estimates: front seat (outside views only), rear seat (raised)
    nav: { red: [-0.82, -0.12, -3.45], green: [0.78, -0.15, -3.51], tail: [0, 1.34, 5.30] },   // the model's light bulbs (intake sides, fin base)
    strobe: [0, 3.5, 5.6],                 // estimate: near the fin tip
    stabDiff: 0.25 }                       // differential stabilator per unit aileron (visual only; S2's model has no rolling tail)
};

// ── engine plume: an open cylinder along +z (0..1) shaped and lit in the shader, additive, HDR (the bloom makes it glow). Exported for S5 rockets.
export function makePlume(THREE) {
  const g = new THREE.CylinderGeometry(1, 1, 1, 32, 48, true); g.rotateX(Math.PI / 2); g.translate(0, 0, .5);
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uLen: { value: 1 }, uR0: { value: .4 }, uWide: { value: 1 }, uBright: { value: 0 }, uStage: { value: 0 }, uDiam: { value: 0 }, uTime: { value: 0 },
      uHot: { value: new THREE.Color(1, .78, .45) }, uMid: { value: new THREE.Color(1, .42, .1) }, uCool: { value: new THREE.Color(.35, .45, 1) } },
    vertexShader: `uniform float uLen, uR0, uWide; varying float vS; varying vec3 vN, vV;
      void main() { float s = position.z, r = uR0 * (1. + (uWide - 1.) * smoothstep(0., .4, s)) * (1. - .8 * s * s) + .01;
        vec4 mv = modelViewMatrix * vec4(position.xy * r, s * uLen, 1.); vS = s; vN = normalMatrix * vec3(position.xy, 0.); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uBright, uStage, uDiam, uTime; uniform vec3 uHot, uMid, uCool; varying float vS; varying vec3 vN, vV;
      void main() { float f = abs(dot(normalize(vN), normalize(vV))), core = pow(f, 3.), halo = pow(f, 1.2), s = vS;
        float ax = smoothstep(0., .04, s) * pow(1. - s, 1.6), dia = uDiam * pow(max(0., cos(s * 31.4)), 8.) * (1. - s);
        float fl = .92 + .08 * sin(uTime * 61. + s * 20.);
        vec3 col = mix(uMid, uHot, core * (1. - s)); col = mix(col, uCool, (1. - uStage) * .55 * (1. - core));
        gl_FragColor = vec4(col * uBright * ax * fl * (.35 * halo + 1.2 * core + 2.5 * dia * core), 1.); }` });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 3; return mesh;
}

// ── re-entry plasma shell (unit sphere of diameter 1; scale it to the craft): uniforms uK (0..1 glow) and uW (windward direction, body axes).
// Used by createGfx (S3) and by the rockets / capsule (S5, flight/rocket.js).
export function makePlasma(THREE) {
  const plM = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uK: { value: 0 }, uW: { value: new THREE.Vector3(0, 0, -1) } },
    vertexShader: 'varying vec3 vN, vV, vB; void main() { vB = normal; vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform float uK; uniform vec3 uW; varying vec3 vN, vV, vB;
      void main() { float f = 1. - abs(dot(normalize(vN), normalize(vV))), w = .25 + .75 * max(0., dot(normalize(vB), uW));
        gl_FragColor = vec4(mix(vec3(1., .35, .55), vec3(1., .7, .4), w) * uK * 3. * w * (.3 + pow(f, 2.)), 1.); }` });
  const m = new THREE.Mesh(new THREE.SphereGeometry(.5, 32, 16), plM); m.visible = false; m.renderOrder = 5; return m;
}

// ── a soft round glow texture (canvas; no blob / data URL needed)
function glowTex(THREE) { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.2, 'rgba(255,255,255,.55)'); gr.addColorStop(.5, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); }

// F = api.flight(); core = createCore(); o = { scene (craft layer), camera (craft layer), craft (Group: position W, scale 1/R_E), sun (DirectionalLight),
// amb (HemisphereLight), model ('f16'), def (craft definition: views, rest) }
export async function createGfx(F, core, o) {
  const THREE = F.THREE, R = F.renderer, M = MODELS[o.model || 'f16'], cs = o.scene, craft = o.craft, sunL = o.sun, amb = o.amb;
  const stats = { loadMs: 0, uploadMs: 0, gpuBytes: 0, tris: 0, envMs: 0, envN: 0, modelOn: true };
  const qT = new THREE.Quaternion(), vT = new THREE.Vector3(), vU = new THREE.Vector3(), vS = new THREE.Vector3(), mT = new THREE.Matrix4();
  // shadows on the craft itself: the sun's shadow map (only this layer has shadow-casting lights; earthgl's scenes are not affected)
  // S7 quality levels (earthgl's 3D quality, o.quality): shadow map size, contrail samples / life; o.scan = 'none' | 'std' (4096²) | 'hi' (8192²) cockpit
  const QL = { low: { sh: 1024, chz: 8, cage: 25 }, medium: { sh: 2048, chz: 12, cage: 35 }, high: { sh: 2048, chz: 20, cage: 45 } }[o.quality] || { sh: 2048, chz: 20, cage: 45 };
  const shadowWas = R.shadowMap.enabled; R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  sunL.castShadow = true; sunL.shadow.mapSize.set(QL.sh, QL.sh);
  { const c = sunL.shadow.camera, h = 10 / R_E; c.left = -h; c.right = h; c.top = h; c.bottom = -h; c.near = 1 / R_E; c.far = 80 / R_E; c.updateProjectionMatrix(); }
  sunL.shadow.bias = -.0004; sunL.shadow.normalBias = .02 / R_E;

  // ── the model
  const t0 = performance.now(); let gltf = null, bms = null;
  if (M.bms && o.ext !== 'old') try { gltf = await new GLTFLoader().loadAsync(M.bms.url.href); bms = await bmsLook(gltf.scene); } catch (e) { console.warn('BMS airframe', e); gltf = bms = null; }
  if (!gltf) gltf = await new GLTFLoader().loadAsync(M.url.href);
  stats.loadMs = performance.now() - t0; stats.airframe = bms ? 'bms' : 'old';
  const model = gltf.scene, nodes = {}; craft.add(model);
  // the BMS airframe: PBR materials from its textures (o.scan 'hi' = tex/4k ~8 MB, else tex/2k ~2.5 MB; waited for, so the first frame is complete),
  // switches show branch 0, DOF nodes collected by number (driven in update with BMS's own limits / reverse / offset flags)
  async function bmsLook(sc) { const dir = new URL('models/f16-bms/tex/' + (o.scan === 'hi' ? '4k' : '2k') + '/', import.meta.url), tl = new THREE.TextureLoader();
    const aniso = Math.min(8, R.capabilities.getMaxAnisotropy()), texs = new Map(), waits = [];
    const T = (f, srgb) => { if (texs.has(f)) return texs.get(f); let ok; waits.push(new Promise(r => { ok = r; }));
      const t = tl.load(new URL(f, dir).href, ok, undefined, e => { console.warn('airframe texture', f, e); ok(); }); t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(2, 2); t.offset.set(-.5, -.5); t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; texs.set(f, t); return t; };   /* stored uv = (uv + .5) / 2 */
    const pbr = (k, ext = 'jpg') => { const orm = T(k + '_orm.jpg'), m = new THREE.MeshStandardMaterial({ map: T(k + '_alb.' + ext, true), normalMap: T(k + '_nrm.jpg'),
      aoMap: orm, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, aoMapIntensity: .8 }); m.normalScale.set(1, 1); return m; };   /* DirectX normal maps, as the cockpit */
    const lamp = () => new THREE.MeshStandardMaterial({ color: 0x111111, emissiveMap: T('emm.jpg', true), emissive: new THREE.Color(0, 0, 0), roughness: .2, metalness: 0 });
    const MAT = { 'F-16CM_50_1': () => pbr('skin'), 'PilotUS': () => pbr('pilot'),
      'Serial_CM50_1': () => { const m = pbr('set2', 'png'); m.alphaTest = .5; return m; },
      'Glass_CM50': () => { const m = pbr('set2', 'png'); m.transparent = true; m.opacity = .25; m.depthWrite = false; m.envMapIntensity = 1.4; return m; },
      'Lights_CM50_2': lamp, 'Lights_CM50_3': lamp, 'Lights_CM50': () => { const m = lamp(); m.visible = false; return m; } };   /* afterburner shell: our plume draws the flame */
    const made = {}, dofs = {}, sw = [];
    sc.traverse(n => { const u = n.userData;
      if (u && u.dof != null) { u.q0 = n.quaternion.clone(); u.p0 = n.position.clone(); (dofs[u.dof] = dofs[u.dof] || []).push(n); }
      if (u && u.sw != null) { sw.push(n); n.visible = u.branch === 0 && !M.bms.hideSw.includes(u.sw); }
      if (!n.isMesh) return; const nm = n.material.name; n.material = made[nm] || (made[nm] = (MAT[nm] || (() => new THREE.MeshStandardMaterial({ color: 0x777777 })))());
      n.material.name = nm; if (nm === 'Glass_CM50') n.renderOrder = 6; });
    await Promise.all(waits); return { dofs, sw, mats: made }; }
  // a BMS DOF value v (rad, or ft for translate DOFs) on each of its nodes: flags 2 = reverse, 1 = clamp to [min, max], × multiplier;
  // 4 = normalised: one step of a sequence (gear legs, doors), turns `mul` DEGREES while v crosses its window [min, max]
  // (measured 2026-11-15: the steps of one chain sum to 81-89 deg, the real wheel / door swing; read as rad × mul they gave 5-7 rad per step)
  const dofX = (u, v) => { let x = u.flags & 2 ? -v : v; if (u.flags & 1) x = clamp(x, u.min, u.max);
    if (u.flags & 4) return u.max > u.min ? (x - u.min) / (u.max - u.min) * u.mul * D2R : 0; return x * u.mul; };
  const zA = new THREE.Vector3(0, 0, 1), vD = new THREE.Vector3(), BS = M.bms ? M.bms.sign : null;
  const setDof = (k, v) => { const L = bms && bms.dofs[k]; if (!L) return; for (const n of L) { const u = n.userData, x = dofX(u, v);
    if (u.type === 1) n.position.copy(u.p0).add(vD.set(...u.axis).multiplyScalar(x * .3048)); else if (u.type === 0) n.quaternion.copy(u.q0).multiply(qT.setFromAxisAngle(zA, -x)); } };
  /* -x: BMS is left-handed, the z flip reverses the turn (measured 2026-11-15: +x swung the gear legs up into the body, -x puts them down) */
  // BMS draws every DOF at value 0 unless something drives it; the file's rest pose is not that state (e.g. 41 air-refuelling door: open at rest, closed at 0)
  if (bms) for (const k in bms.dofs) setDof(k, 0);
  // S3b: ejection seats (front + rear, one geometry); a missing seat file only drops the seats. The BMS airframe has its own seat and pilot.
  const seats = [];
  if (M.seat && !bms) try { const sg = (await new GLTFLoader().loadAsync(M.seat.url.href)).scene;
    for (const p of M.seat.at) { const s = seats.length ? sg.clone() : sg; s.position.set(...p); s.name = 'Seat' + seats.length; model.add(s); seats.push(s); } }
  catch (e) { console.warn('seat model', e); }
  model.traverse(n => { nodes[n.name] = n;
    if (!n.isMesh) return; const m = n.material; n.castShadow = !/^(Glass|Lights)/.test(m.name); n.receiveShadow = true; stats.tris += (n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3; });
  // materials (our look, not the source's Cycles values): the paint is a dielectric semi-matte grey; the texture's gloss map is remapped to 0.38-0.8 roughness
  const mats = {}; model.traverse(n => { if (n.isMesh) mats[n.material.name] = n.material; });
  if (mats.Paint) { const p = mats.Paint; p.metalness = .12; p.roughness = 1;
    p.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>',
      'float roughnessFactor = roughness;\n#ifdef USE_ROUGHNESSMAP\nroughnessFactor = mix(.38, .8, texture2D(roughnessMap, vRoughnessMapUv).g);\n#endif'); }; }
  if (nodes.Nozzle && mats.Paint) { const nm = mats.Paint.clone(); nm.onBeforeCompile = mats.Paint.onBeforeCompile; nm.metalness = .85; nm.color.setRGB(.55, .52, .5); nodes.Nozzle.traverse(n => { if (n.isMesh) n.material = nm; }); }
  if (mats.Glass) { mats.Glass.depthWrite = false; mats.Glass.envMapIntensity = 1.4; mats.Glass.opacity = .16; }
  // S3b: while the scanned cockpit is shown, the body's own cockpit block (inside the cut box, craft frame) is not drawn (fragment discard)
  const cutU = { value: 0 }, cutA = new THREE.Vector3(), cutB = new THREE.Vector3();
  const cutRoot = bms ? model : nodes.Body;   // the BMS airframe: all of it (its cockpit tub, seat and pilot sit inside the box)
  if (M.cockpit && cutRoot) { cutA.set(...M.cockpit.cut[0]); cutB.set(...M.cockpit.cut[1]); model.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    cutRoot.traverse(n => { if (!n.isMesh) return; const m0 = n.material, m = m0.clone(), prev = m0.onBeforeCompile, cutM = { value: new THREE.Matrix4().multiplyMatrices(inv, n.matrixWorld) };
      m.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r); Object.assign(sh.uniforms, { uCut: cutU, uCutA: { value: cutA }, uCutB: { value: cutB }, uCutM: cutM });
        sh.vertexShader = 'uniform mat4 uCutM; varying vec3 vCut;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCut = (uCutM * vec4(position, 1.)).xyz;');
        sh.fragmentShader = 'uniform float uCut; uniform vec3 uCutA, uCutB; varying vec3 vCut;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>',
          'if (uCut > .5 && all(greaterThan(vCut, uCutA)) && all(lessThan(vCut, uCutB))) discard;\n#include <clipping_planes_fragment>'); };
      m.customProgramCacheKey = () => 'bodycut'; n.material = m; }); }
  // the BMS cockpit, loaded the first time the Cockpit view is used: geometry 7.5 MB + textures (o.scan 'hi' = tex/4k ~17 MB, else tex/2k ~5 MB).
  // Night: the 'lit' map holds the backlit lettering (R) and BMS's baked flood light (G); ck.back / ck.flood (0..1) scale them.
  const ck = { obj: null, loading: null, off: false, back: { value: 0 }, flood: { value: 0 } };
  function loadCockpit() { const t1 = performance.now(), dir = new URL('models/f16-cockpit/tex/' + (o.scan === 'hi' ? '4k' : '2k') + '/', import.meta.url), tl = new THREE.TextureLoader();
    const aniso = Math.min(8, R.capabilities.getMaxAnisotropy()), texs = new Map(), waits = [];
    const T = (f, srgb) => { if (texs.has(f)) return texs.get(f); let ok; waits.push(new Promise(r => { ok = r; }));
      const t = tl.load(new URL(f, dir).href, ok, undefined, e => { console.warn('cockpit texture', f, e); ok(); }); t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(2, 2); t.offset.set(-.5, -.5); t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; texs.set(f, t); return t; };   /* stored uv = (uv + .5) / 2 (build script) */
    const nightHook = m => { m.onBeforeCompile = sh => { sh.uniforms.uBack = ck.back; sh.uniforms.uFlood = ck.flood;
      sh.fragmentShader = 'uniform float uBack, uFlood;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
        'vec4 litT = texture2D(emissiveMap, vEmissiveMapUv); totalEmissiveRadiance = uBack * litT.r * vec3(.55, 1., .62) + uFlood * litT.g * diffuseColor.rgb * vec3(1., .93, .8);'); };
      m.customProgramCacheKey = () => 'bmsnight'; };
    const pbr = (k, lit, nrm = true) => { const orm = T(k + '_orm.jpg'), m = new THREE.MeshStandardMaterial({ map: T(k + '_alb.' + (k === 'canopy' ? 'png' : 'jpg'), true),
      aoMap: orm, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, aoMapIntensity: .8 });
      if (nrm) { m.normalMap = T(k + '_nrm.jpg'); m.normalScale.set(1, 1); }   /* DirectX maps (green = down the image; measured 2026-11-14: corr(dR/drow, dG/dcol) > 0 on pit1 / pit2 / seat); flipY false -> +v = down = three's +B, so no flip */
      if (lit) { m.emissiveMap = T(k + '_lit.jpg'); m.emissive.setRGB(1, 1, 1); nightHook(m); } return m; };
    const MAT = { 'CM50Pit1': () => pbr('pit1', true), 'CM50pit1Main': () => pbr('pit1', true), 'CM50Pit2': () => pbr('pit2', true), 'CM50Pit2Main': () => pbr('pit2', true),
      'Seat': () => pbr('seat'), 'F-16CM_50_1': () => pbr('skin'),
      'Canopy': () => { const m = pbr('canopy'); m.alphaTest = .5; return m; },
      'CM50Pit LIghts': () => { const t = T('lights.png', true); return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: new THREE.Color(.25, .25, .25), transparent: true, alphaTest: .02, roughness: .3, metalness: 0 }); },
      'Canopy Glass': () => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(.43, .42, .35), transparent: true, opacity: .1, depthWrite: false, roughness: .05, metalness: 0, side: THREE.DoubleSide }) };
    ck.loading = new GLTFLoader().loadAsync(M.cockpit.url.href).then(g => { const c = g.scene, st = { loadMs: performance.now() - t1, tris: 0, gpuBytes: 0 }, t2 = performance.now(), made = {};
      c.name = 'Cockpit'; c.position.set(...M.eye); c.traverse(n => { if (!n.isMesh) return; const nm = n.material.name; st.tris += n.geometry.index.count / 3;
        for (const a of Object.values(n.geometry.attributes)) st.gpuBytes += a.array.byteLength; st.gpuBytes += n.geometry.index.array.byteLength;
        n.material = made[nm] || (made[nm] = (MAT[nm] || (() => new THREE.MeshStandardMaterial({ color: 0x333333 })))());
        const glass = nm === 'Canopy Glass'; n.castShadow = !glass && nm !== 'CM50Pit LIghts'; n.receiveShadow = !glass; if (glass) n.renderOrder = 6; });
      Promise.all(waits).then(() => { for (const t of texs.values()) { if (!t.image || !t.image.width) continue; R.initTexture(t); st.gpuBytes += t.image.width * t.image.height * 4 * 4 / 3; } st.texMs = performance.now() - t1; st.texN = texs.size; });
      model.add(c); c.visible = false; ck.obj = c; st.uploadMs = performance.now() - t2; stats.cockpit = st; })
      .catch(e => { console.warn('cockpit model', e); }); }
  // hinged parts (glTF extras.hinge = axis in the craft frame, node origin on the hinge line)
  const hinge = {}; model.traverse(n => { if (n.userData && n.userData.hinge) hinge[n.name] = { n, ax: new THREE.Vector3(...n.userData.hinge).normalize(), q0: n.quaternion.clone() }; });
  const turn = (name, deg) => { const h = hinge[name]; if (h) h.n.quaternion.copy(h.q0).multiply(qT.setFromAxisAngle(h.ax, deg * D2R)); };
  // nozzle iris: scaled about its own axis
  let exitP = nodes.NozzleExit ? nodes.NozzleExit.position.clone() : new THREE.Vector3(0, .5, 6), nozR = (nodes.Nozzle && nodes.Nozzle.userData.radius) || .33;
  if (bms && bms.dofs[39]) { const b = new THREE.Box3(); model.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();   // the nozzle petals (DOF 39), model frame
    for (const n of bms.dofs[39]) n.traverse(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld))); } });
    const c = b.getCenter(new THREE.Vector3()); exitP = new THREE.Vector3(c.x, c.y, b.max.z); nozR = .4 * Math.min(b.max.x - b.min.x, b.max.y - b.min.y); stats.nozzle = { exit: exitP.toArray(), r: nozR }; }
  let iris = null; if (nodes.Nozzle) { iris = new THREE.Group(); iris.position.set(exitP.x, exitP.y, 0); nodes.Nozzle.parent.add(iris); iris.attach(nodes.Nozzle); }
  const gearN = ['Gear_N', 'Gear_L', 'Gear_R', 'Doors_Down'].map(n => nodes[n]).filter(Boolean);
  // upload to the GPU now (else it happens on the first frame) and estimate the GPU memory (vertex + index buffers, textures with mip-maps)
  { const t1 = performance.now(), tex = new Set(), geo = new Set();
    model.traverse(n => { if (!n.isMesh) return; geo.add(n.geometry); for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (n.material[k]) tex.add(n.material[k]); });
    for (const t of tex) { R.initTexture(t); stats.gpuBytes += t.image.width * t.image.height * 4 * 4 / 3; }
    for (const g of geo) { for (const a of Object.values(g.attributes)) stats.gpuBytes += a.array.byteLength; if (g.index) stats.gpuBytes += g.index.array.byteLength; }
    R.compile(cs, o.camera); stats.uploadMs = performance.now() - t1; stats.textures = tex.size; stats.geometries = geo.size; }

  // ── sky environment for reflections (PMREM from a small gradient sky turned to the local vertical), rebuilt every few seconds
  const pm = new THREE.PMREMGenerator(R), skyS = new THREE.Scene();
  const skyU = { up: { value: new THREE.Vector3(0, 1, 0) }, sun: { value: new THREE.Vector3(0, 1, 0) }, zen: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, gnd: { value: new THREE.Color() }, sunC: { value: new THREE.Color() } };
  skyS.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: skyU,
    vertexShader: 'varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform vec3 up, sun, zen, hor, gnd, sunC; varying vec3 vD;
      void main() { float h = dot(vD, up); vec3 c = h > 0. ? mix(hor, zen, pow(h, .5)) : mix(hor, gnd, smoothstep(0., .15, -h));
        c += sunC * (pow(max(0., dot(vD, sun)), 600.) * 60. + pow(max(0., dot(vD, sun)), 8.) * .25); gl_FragColor = vec4(c, 1.); }` })));
  let envRT = null, envAt = -1, envRho = 1;
  function envUpdate(up, sun, rho) { const t1 = performance.now(), se = sun.dot(up), dl = smooth(-.1, .1, se), thin = .2 + .8 * Math.sqrt(clamp(rho / 1.225, 0, 1));
    skyU.up.value.copy(up); skyU.sun.value.copy(sun);
    skyU.zen.value.setRGB(.002 + .12 * dl * thin, .003 + .25 * dl * thin, .006 + .6 * dl * thin);
    const dusk = smooth(.05, .3, se); skyU.hor.value.setRGB(.002 + dl * (.8 + (.55 - .8) * dusk), .003 + dl * (.45 + (.65 - .45) * dusk), .006 + dl * (.25 + (.8 - .25) * dusk));
    skyU.gnd.value.setRGB(.12 * dl + .002, .11 * dl + .002, .09 * dl + .002); skyU.sunC.value.copy(sunL.color).multiplyScalar(sunL.intensity / 3);
    const rt = pm.fromScene(skyS, 0, .1, 100); if (envRT) envRT.dispose(); envRT = rt; cs.environment = rt.texture;
    stats.envMs += (performance.now() - t1 - stats.envMs) * .3; stats.envN++; }

  // ── plume + afterburner light
  const plume = makePlume(THREE); plume.position.copy(exitP); model.add(plume);
  const abL = new THREE.PointLight(0xff8a3a, 0, 14 / R_E, 2);   // the layer's units are R⊕: distance and (physical, 1/d²) intensity scaled abL.position.copy(exitP).add(new THREE.Vector3(0, 0, 1.2)); model.add(abL);
  // ── navigation + strobe + landing lights (glow sprites; real light only on the ground pool)
  const gt = glowTex(THREE), spr = (c, s) => { const m = new THREE.SpriteMaterial({ map: gt, color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const x = new THREE.Sprite(m); x.userData.s = s; x.renderOrder = 4; model.add(x); return x; };
  const navR = spr(0xff2020, .35), navG = spr(0x20ff50, .35), navT = spr(0xffffff, .3), strobe = spr(0xffffff, .6), land = spr(0xfff2dd, .5);
  const NAV = bms ? M.bms.nav : M.nav; navR.position.set(...NAV.red); navG.position.set(...NAV.green); navT.position.set(...NAV.tail); strobe.position.set(...(bms ? M.bms.strobe : M.strobe));
  // BMS: the landing / taxi lenses ride on the nose gear door; their geometry centres (mesh frame), carried to the model frame every frame
  const lampM = []; if (bms) for (const n of bms.sw) if (n.userData.branch === 0 && M.bms.lampSw.includes(n.userData.sw)) n.traverse(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); lampM.push([m, m.geometry.boundingBox.getCenter(new THREE.Vector3())]); } });
  const relM = (n, out) => { out.identity(); for (let p = n; p && p !== model; p = p.parent) { p.updateMatrix(); out.premultiply(p.matrix); } return out; };
  const landP = bms ? new THREE.Vector3(...M.bms.land) : nodes.LandingLight ? nodes.LandingLight.position.clone() : new THREE.Vector3(0, -.9, -3.8); land.position.copy(landP).add(new THREE.Vector3(0, 0, -.15));
  // ground: planar shadow (each model mesh re-drawn flattened; depthFunc Less draws every pixel once) + the landing light pool
  // the shadow darkens each pixel once, however many triangles overlap: pass 1 writes the opacity into the target's alpha (colour kept), pass 2
  // multiplies the colour by (1 − alpha) and sets alpha 0 (a second overlapping triangle then multiplies by 1), pass 3 puts alpha back to 1
  const shG = new THREE.Group(); craft.add(shG);
  const shPass = (sf, df, saf, daf, a) => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: sf, blendDst: df, blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: saf, blendDstAlpha: daf, uniforms: { uA: { value: a } },
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }', fragmentShader: 'uniform float uA; void main() { gl_FragColor = vec4(0., 0., 0., uA); }' });
  const shMs = [shPass(THREE.ZeroFactor, THREE.OneFactor, THREE.OneFactor, THREE.ZeroFactor, .5), shPass(THREE.ZeroFactor, THREE.OneMinusDstAlphaFactor, THREE.OneFactor, THREE.ZeroFactor, 0),
    shPass(THREE.ZeroFactor, THREE.OneFactor, THREE.OneFactor, THREE.ZeroFactor, 1)], shM = shMs[0].uniforms.uA;
  const shadows = []; model.traverse(n => { if (n.isMesh && n.castShadow) shadows.push([n, shMs.map((mt, k) => { const m = new THREE.Mesh(n.geometry, mt); m.matrixAutoUpdate = false;
    m.renderOrder = 1 + k * .1; m.frustumCulled = false; shG.add(m); return m; })]); });
  // landing / taxi light on the ground: per pixel E = I(beam angles) cos(incidence) / d² from the lamp on the nose gear, all in craft metres.
  // Beam I(ax, ay) = I0 [flat-topped core e^(−r³/2), r = angle / σ, + 2 % gaussian spill at 2σ]; screen value = colour · uMax · (1 − e^(−E·uK)) (soft roll-off, never a flat white disc).
  const poolU = { uM: { value: new THREE.Matrix4() }, uL: { value: new THREE.Vector3() }, uN: { value: new THREE.Vector3() }, uD: { value: new THREE.Vector3() },
    uX: { value: new THREE.Vector3(1, 0, 0) }, uY: { value: new THREE.Vector3() }, uS: { value: new THREE.Vector2() }, uI0: { value: 0 }, uR: { value: 600 } };
  const poolM = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: poolU,
    vertexShader: 'uniform mat4 uM; varying vec3 vP; void main() { vP = (uM * vec4(position, 1.)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform vec3 uL, uN, uD, uX, uY; uniform vec2 uS; uniform float uI0, uR; varying vec3 vP;\n' +
      'void main() { vec3 v = vP - uL; float d = length(v); vec3 l = v / d; float ca = dot(l, uD); if (ca < .05) discard;\n' +
      '  vec2 a = vec2(atan(dot(l, uX), ca), atan(dot(l, uY), ca)) / uS; float r2 = dot(a, a);\n' +
      '  float I = exp(-.5 * r2 * sqrt(r2)) + .02 * exp(-.5 * r2 / 4.); float E = uI0 * I * max(0., -dot(l, uN)) / (d * d) * (1. - smoothstep(.7 * uR, uR, d));\n' +
      '  gl_FragColor = vec4(vec3(1., .9, .76) * .7 * (1. - exp(-E * .02)), 1.); }' });   /* .7 = uMax, .02 = uK (1/lx): tuned by pixel reads */
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), poolM); pool.renderOrder = 2; pool.frustumCulled = false; craft.add(pool);
  // the two lamps (estimates; the F-16 LANDING / TAXI switch is not modelled: taxi below 6 m and 30 m/s, else landing): depression below the body
  // axis, σ horizontal / vertical, peak intensity I0 (cd; PAR-46-class sealed beams are ~10⁵ cd). Landing is aimed low for the ~13° approach AoA.
  const LAMPS = { taxi: { dep: 1.5, sh: 9, sv: 2.5, I0: 8e4 }, land: { dep: 14, sh: 4.5, sv: 3, I0: 2e5 } };   /* 14°: at 13° AoA on a 3° path the beam axis meets the ground ~14 heights ahead */
  // ── contrail: a camera-facing ribbon through the nozzle's past positions (W, doubles), vertices relative to the craft (metres, float32-safe)
  const CN = 900, CHZ = QL.chz, CAGE = QL.cage;   // samples, Hz, life in s (estimate: persistence depends on the humidity, unknown here)
  const trail = [], tPos = new Float32Array(CN * 2 * 3), tSide = new Float32Array(CN * 2), tA = new Float32Array(CN * 2), tIdx = [];
  for (let i = 0; i < CN - 1; i++) { const a = i * 2; tIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  for (let i = 0; i < CN; i++) { tSide[i * 2] = -1; tSide[i * 2 + 1] = 1; }
  const tGeo = new THREE.BufferGeometry(); tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
  tGeo.setAttribute('aSide', new THREE.BufferAttribute(tSide, 1)); tGeo.setAttribute('aA', new THREE.BufferAttribute(tA, 1).setUsage(THREE.DynamicDrawUsage)); tGeo.setIndex(tIdx);
  const tMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uC: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: 'attribute float aSide, aA; varying float vS, vA; void main() { vS = aSide; vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform vec3 uC; varying float vS, vA; void main() { float a = vA * pow(max(0., 1. - vS * vS), 1.5); gl_FragColor = vec4(uC, a); }' });
  const trailM = new THREE.Mesh(tGeo, tMat); trailM.frustumCulled = false; trailM.renderOrder = 2; trailM.scale.setScalar(1 / R_E); cs.add(trailM);
  let lastSample = -1e9;
  // ── re-entry plasma (hook for S5): a glowing shell, brighter on the windward side; k = 0..1, null = automatic from the heating (Sutton-Graves, nose radius 1 m)
  const bb = new THREE.Box3().setFromObject(model), bs = bb.getSize(new THREE.Vector3()), bc = bb.getCenter(new THREE.Vector3());
  const plasma = makePlasma(THREE), plM = plasma.material; plasma.scale.set(bs.x * 1.15, bs.y * 1.6, bs.z * 1.1); plasma.position.copy(bc); model.add(plasma);
  let plasmaK = null;

  // ── views: cockpit eye from the model, chase, far chase, free orbit (drag = turn around the craft, wheel = distance)
  const orbit = { name: 'Orbit', dist: 24, pose(P, cam, look) {
    const up = vU.copy(P.pos).normalize(), fw = vT.set(0, 0, -1).applyQuaternion(P.quat); fw.addScaledVector(up, -fw.dot(up));
    if (fw.lengthSq() < 1e-8) fw.set(0, 0, -1).applyQuaternion(P.quat).cross(up); fw.normalize();
    const Z = fw.negate(), X = vS.crossVectors(up, Z).normalize(); cam.quat.setFromRotationMatrix(mT.makeBasis(X, up, Z)).multiply(qT.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -.25));
    const q = qT.copy(cam.quat); if (look) q.multiply(look); cam.pos.set(0, 0, orbit.dist / R_E).applyQuaternion(q).add(P.pos); } };
  const def = o.def; if (def) { const v = def.views; v[0] = { ...v[0], eye: (M.head || M.eye).slice(), tilt: -.19, fov: 62 }; /* S3b / S4: cockpit 62° vertical (Earth camera 35°), 11° down: HUD + MFDs + ADI in view */ if (!v.some(x => x.name === 'Orbit')) v.push(orbit); }
  const onWheel = e => { if (!F.piloting || !def || def.views[core.view] !== orbit) return; orbit.dist = clamp(orbit.dist * Math.exp(Math.sign(e.deltaY) * .15), 6, 3000); };
  R.domElement.addEventListener('wheel', onWheel, { passive: true });
  // flyby, ground, onboard and free cameras (flight/cams.js): onboard eyes from the airframe's bounds in the model frame (plasma glow left out)
  let cams = null;
  if (def) { const bbM = new THREE.Box3(), bx = new THREE.Box3(), mR = new THREE.Matrix4();
    model.traverse(n => { if (!n.isMesh || n === plasma || !n.geometry) return; for (let p = n; p && p !== model; p = p.parent) if (p.visible === false) return;
      if (!n.geometry.boundingBox) n.geometry.computeBoundingBox(); bbM.union(bx.copy(n.geometry.boundingBox).applyMatrix4(relM(n, mR))); });
    if (!bbM.isEmpty()) cams = (await import('./cams.js?v=fa335c7b')).addCameraViews(F, core, def, { bb: bbM, head: (M.head || M.eye).slice() }); }

  // ── per frame: P = core's draw pose (W), t = earthgl time (ms)
  const roll = { d: 0, t: -1 }, wB = new THREE.Vector3();   // wheels: metres rolled on the ground; last frame time
  const camRel = new THREE.Vector3(), nW = new THREE.Vector3(), lB = new THREE.Vector3(), uB = new THREE.Vector3(), qInv = new THREE.Quaternion(), S4 = new THREE.Matrix4(), rel = new THREE.Matrix4();
  function update(P, t) {
    const s = core.state, h = core.hud, srf = s.srf || {}, e = (s.eng && s.eng[0]) || {}, up = nW.copy(P.pos).normalize(), sun = F.sun().clone().normalize();
    if (cams) cams.tick(P, t);   // the craft's ground track for the flyby / ground / free cameras
    // the camera of this frame (earthgl moves its camera after the frame callbacks): the pilot camera pose, else earthgl's
    const cpp = F.piloting ? core.camPose(t) : null, cp = cpp ? cpp.pos : F.camera.position;
    const altMSL = h.altMSL || 0, air = atmosphere(altMSL), se = sun.dot(up), dl = smooth(-.1, .1, se), d = cp.distanceTo(P.pos) * R_E;
    // sun light: reddened near the horizon, off below it; hemisphere = sky / ground bounce (its direction comes from its position: + the layer's offset)
    sunL.position.copy(P.pos).addScaledVector(sun, 40 / R_E); sunL.target.position.copy(P.pos);
    const red = smooth(0, .35, se); sunL.color.setRGB(1, .5 + .47 * red, .25 + .67 * red); sunL.intensity = 3 * smooth(-.02, .08, se);
    amb.position.copy(cp).add(up); amb.intensity = .05 + .25 * dl;
    // the sky map (~20 ms to build): only when the local vertical or the Sun moved by > 1° (≥ 7 min of flight at 250 m/s), or the air thinned by > 10 %
    if (envAt < 0 || skyU.up.value.dot(up) < .99985 || skyU.sun.value.dot(sun) < .99985 || Math.abs(air.rho - envRho) > .1 * envRho + 1e-4) { envAt = t; envRho = air.rho; envUpdate(up, sun, air.rho); }
    // camera layer near / far (the contrail reaches ~20 km behind)
    const tr = trail.length > 1; o.camera.near = (tr ? Math.max(.05, Math.min(d - 20, 1)) : Math.max(.05, d - 20)) / R_E; o.camera.far = (d + (tr ? 25000 : pool.visible ? 60 + pool.scale.y : 60)) / R_E;   /* the light on the ground: last frame's quad length */
    if (!stats.modelOn) return;
    // control surfaces (deg; signs: elev +, flaperon + = trailing edge down; S&L aileron + = right flaperon down; rudder + = trailing edge left)
    const el = srf.elev || 0, ai = srf.ail || 0, ru = srf.rud || 0, aoa = h.aoa || 0, gear = srf.gear == null ? 1 : srf.gear;
    const tef = gear > .5 && (h.ias || 0) < 124 ? 20 : 0;   // F-16 flaperons droop with the gear down at low speed (simplified schedule)
    const lef = s.onGround ? 0 : clamp(1.38 * aoa, 0, 25);    // leading-edge flaps ~1.38 × AoA (published schedule without its Mach / qbar term)
    turn('Stab_L', el - M.stabDiff * ai); turn('Stab_R', el + M.stabDiff * ai);
    turn('Flaperon_L', clamp(tef - ai, -23, 20)); turn('Flaperon_R', clamp(tef + ai, -23, 20));
    turn('LEF_L', -lef); turn('LEF_R', -lef); turn('Rudder', -ru);
    // BMS airframe: Falcon's DOF numbers (0 / 1 stabilators, 2 / 3 flaperons, 4 rudder, 9 / 10 LEFs, 19-24 gear + doors, 39 nozzle petals); signs: BS
    if (bms) { const g = BS.gear, r = D2R;
      setDof(0, BS.stab * (el - M.stabDiff * ai) * r); setDof(1, BS.stab * (el + M.stabDiff * ai) * r);
      setDof(2, BS.flap * clamp(tef - ai, -23, 20) * r); setDof(3, BS.flap * clamp(tef + ai, -23, 20) * r);
      setDof(9, BS.lef * lef * r); setDof(10, BS.lef * lef * r); setDof(4, BS.rud * ru * r);
      // gear sequence (M.bms.gearSeq): legs 19 / 20 / 21, nose door 22, main doors 23 / 24 (opened past their 90 deg DOF limit while the wheels pass)
      const GS = M.bms.gearSeq, gUp = gear <= GS.legs, shut = clamp((gear - GS.shut) / (GS.legs - GS.shut), 0, 1);
      const L = gUp ? GS.lMin : GS.lMin + (1 - GS.lMin) * (gear - GS.legs) / (1 - GS.legs), on = !gUp || shut > GS.hide;   /* legs held in the well, off once the doors pass `hide` */
      const dA = (gear >= GS.overAt ? 90 + (GS.over - 90) * (1 - gear) / (1 - GS.overAt) : !gUp ? GS.over : GS.over * shut) * D2R;
      for (const k of [19, 20, 21]) setDof(k, g[k] * L);
      setDof(22, g[22] * shut);
      for (const k of [23, 24]) { setDof(k, dA); for (const n of bms.dofs[k] || []) { const u = n.userData; if (u.type === 0 && u.mul === 1 && dA > u.max) n.quaternion.copy(u.q0).multiply(qT.setFromAxisAngle(zA, -dA)); } }
      for (const n of bms.sw) if (M.bms.gearSw.includes(n.userData.sw)) n.visible = on;
      // struts: each tyre pushed up to the ground plane (origin height agl + rest, local vertical in body axes), within its stroke; wheels roll on the ground
      const hG = (h.agl || 0) + (def ? def.rest || 0 : 0); wB.copy(up).applyQuaternion(qInv.copy(P.quat).invert());
      for (const S of M.bms.strut) { const pen = gear > .95 ? -(wB.dot(vD.set(...S.low)) + hG) : 0; setDof(S.dof, S.k * clamp(pen, 0, S.max)); }
      if (s.onGround && roll.t >= 0) roll.d += (h.tas || 0) * clamp((t - roll.t) / 1000, 0, .2); roll.t = t;
      for (const k in M.bms.spin) setDof(k, (roll.d / M.bms.spin[k]) % (2 * Math.PI));
      if (lampM.length) { landP.set(0, 0, 0); for (const [m, c] of lampM) landP.add(vS.copy(c).applyMatrix4(relM(m, mT))); landP.multiplyScalar(1 / lampM.length);
        land.position.copy(landP); land.position.z -= .15; } }
    // gear: telescoped into the wells (a stand-in for the real retraction paths), doors closed when up
    for (const n of gearN) { n.visible = gear > .01; n.scale.set(1, Math.max(.01, gear), 1); }
    if (nodes.Doors_Up) nodes.Doors_Up.visible = gear <= .01;
    // engine: power 0..100 (S2: < 50 dry, 50..100 afterburner); nozzle open at idle and in AB, closed at MIL
    const pw = e.power || 0, on = !!e.on, ab = on && pw > 50, st = ab ? (pw - 50) / 50 : 0, wide = clamp(Math.pow(101325 / Math.max(1, air.p), .3), 1, 8);
    if (bms) setDof(39, BS.noz * (1 - (ab ? .6 + .4 * st : .7 - .7 * clamp(pw / 50, 0, 1))));   // openness 0 = closed (MIL) .. 1 = open (estimate; same schedule as iris); DOF 0 = open
    if (iris) { const f = ab ? 1.0 + .12 * st : 1.08 - .16 * clamp(pw / 50, 0, 1); iris.scale.set(f, f, 1); }
    const U = plume.material.uniforms; U.uTime.value = t / 1000; U.uStage.value = st; U.uWide.value = wide;
    if (ab) { U.uLen.value = (2.5 + 5.5 * st) * (1 + .3 * (wide - 1)); U.uR0.value = nozR * 1.15; U.uBright.value = 1.6 + 2.4 * st; U.uDiam.value = clamp(2 - wide, 0, 1); }
    else { U.uLen.value = .9; U.uR0.value = nozR * .9; U.uBright.value = on ? .15 + .35 * clamp(pw / 50, 0, 1) : 0; U.uDiam.value = 0; }
    plume.visible = U.uBright.value > 0; abL.intensity = ab ? (60 + 140 * st) / (R_E * R_E) : 0;
    // lights: sprites keep a few pixels at any distance; the strobe flashes 60 ms every 1.2 s
    const pxm = Math.max(1, d) * .004, night = 1 + 3 * (1 - dl);
    for (const x of [navR, navG, navT, strobe, land]) x.scale.setScalar(Math.max(x.userData.s, pxm * x.userData.s / .35));
    navR.material.color.setRGB(1.6 * night, .1, .1); navG.material.color.setRGB(.1, 1.6 * night, .3); navT.material.color.setScalar(1.2 * night);
    const inCock = F.piloting && def && core.view === 0;   // from the seat: the own light bulbs are not seen (only the light pool on the ground)
    for (const x of [navR, navG, navT]) x.visible = !inCock;
    if (M.cockpit && inCock && !ck.loading && o.scan !== 'none') loadCockpit();
    const ckOn = inCock && !!ck.obj && !ck.off; if (ck.obj) ck.obj.visible = ckOn; cutU.value = ckOn ? 1 : 0; if (seats[0]) seats[0].visible = !ckOn;
    ck.back.value = .6 * (1 - dl); ck.flood.value = .12 * (1 - dl);   // estimates: backlit lettering + flood light, faded in with the dusk
    if (nodes.Canopy) nodes.Canopy.visible = !inCock;   // its two halves overlap on the centre line: a dark seam right in the pilot's view
    strobe.visible = !inCock && (t / 1000) % 1.2 < .06; strobe.material.color.setScalar(8 * night); land.visible = gear > .95; land.material.color.setRGB(3 * night, 2.9 * night, 2.6 * night);
    // ground: tangent plane under the craft in body axes (origin height = agl + rest), sun direction in body axes
    const hO = (h.agl || 0) + (def ? def.rest || 0 : 0); qInv.copy(P.quat).invert(); uB.copy(up).applyQuaternion(qInv); lB.copy(sun).applyQuaternion(qInv);
    const ul = uB.dot(lB), shOn = hO < 300 && ul > .05 && sunL.intensity > .1; shG.visible = shOn;
    if (shOn) { const k = 1 / ul, hh = hO - .03;   // x' = x − l (u·x + h) / (u·l): projection along the sun ray onto the plane u·x + h = 0
      S4.set(1 - lB.x * uB.x * k, -lB.x * uB.y * k, -lB.x * uB.z * k, -lB.x * hh * k, -lB.y * uB.x * k, 1 - lB.y * uB.y * k, -lB.y * uB.z * k, -lB.y * hh * k,
        -lB.z * uB.x * k, -lB.z * uB.y * k, 1 - lB.z * uB.z * k, -lB.z * hh * k, 0, 0, 0, 1);
      shM.value = .55 * (1 - hO / 300) * smooth(.05, .3, ul);
      for (const [n, ms] of shadows) { const v = n.visible && n.parent.visible; for (const m of ms) m.visible = v; if (!v) continue;
        rel.copy(n.matrix); for (let p = n.parent; p && p !== model; p = p.parent) { p.updateMatrix(); rel.premultiply(p.matrix); } for (const m of ms) m.matrix.multiplyMatrices(S4, rel); } }
    // landing / taxi light on the ground: a quad on the ground plane under the beam (from below the lamp to the beam's upper 3.5σ edge, ≤ uR),
    // lit per pixel; gear down, lamp < 300 m above the ground. Night only: ~1-100 lx vs 10⁴-10⁵ lx of daylight
    { const L = LAMPS[hO < 6 && (h.tas || 0) < 30 ? 'taxi' : 'land'], a = L.dep * D2R, dir = vT.set(0, -Math.sin(a), -Math.cos(a)), hL = uB.dot(landP) + hO, Rm = poolU.uR.value;
      const fwd = vU.copy(dir).addScaledVector(uB, -dir.dot(uB)), fl = fwd.length();
      pool.visible = land.visible && hL > .05 && hL < 300 && fl > .2 && dl < .9; if (inCock) land.visible = false;
      if (pool.visible) { fwd.multiplyScalar(1 / fl); const X = new THREE.Vector3().crossVectors(fwd, uB);
        const eUp = Math.asin(clamp(-uB.dot(dir), -1, 1)) - 3.5 * L.sv * D2R;   // depression below the ground plane of the beam's upper edge
        const far = eUp > .002 ? Math.min(Rm, hL / Math.tan(eUp)) : Rm, w = 2 * (far * Math.tan(Math.min(60, 5 * L.sh) * D2R) + 1);
        pool.position.copy(landP).addScaledVector(uB, .03 - hL).addScaledVector(fwd, far / 2); pool.quaternion.setFromRotationMatrix(mT.makeBasis(X, fwd, uB));
        pool.scale.set(w, far + 2, 1); pool.updateMatrix(); poolU.uM.value.copy(pool.matrix);
        poolU.uL.value.copy(landP); poolU.uN.value.copy(uB); poolU.uD.value.copy(dir); poolU.uY.value.set(0, Math.cos(a), -Math.sin(a));
        poolU.uS.value.set(L.sh * D2R, L.sv * D2R); poolU.uI0.value = L.I0 * Math.pow(1 - dl, 2); } }
    // contrail (Schmidt-Appleman criterion simplified: T < 235 K, i.e. above ~8.2 km in the US 1976 atmosphere; engine running)
    const want = on && air.T < 235 && altMSL > 7500 && !s.onGround;
    if (want && t - lastSample > 1000 / CHZ) { const x = vT.copy(exitP).applyQuaternion(P.quat).multiplyScalar(1 / R_E).add(P.pos);
      trail.push({ x: x.x, y: x.y, z: x.z, t, brk: t - lastSample > 1500 }); lastSample = t; if (trail.length > CN) trail.shift(); }
    while (trail.length && (t - trail[0].t > CAGE * 1000 || t < trail[0].t)) trail.shift();
    trailM.visible = trail.length > 1;
    if (trailM.visible) { trailM.position.copy(P.pos); camRel.copy(cp).sub(P.pos).multiplyScalar(R_E);
      const n = trail.length, px = i => (trail[i].x - P.pos.x) * R_E, py = i => (trail[i].y - P.pos.y) * R_E, pz = i => (trail[i].z - P.pos.z) * R_E;
      for (let i = 0; i < CN; i++) { const a = i * 6, b = i * 2;
        if (i >= n) { tA[b] = tA[b + 1] = 0; tPos.fill(0, a, a + 6); continue; }
        const x = px(i), y = py(i), z = pz(i), i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1), tx = px(i1) - px(i0), ty = py(i1) - py(i0), tz = pz(i1) - pz(i0);
        const cx = camRel.x - x, cy = camRel.y - y, cz = camRel.z - z; let sx = ty * cz - tz * cy, sy = tz * cx - tx * cz, sz = tx * cy - ty * cx; const sl = Math.hypot(sx, sy, sz) || 1;
        const age = (t - trail[i].t) / 1000, w = (1.5 + 30 * Math.pow(age / CAGE, .6)) / 2 / sl; sx *= w; sy *= w; sz *= w;
        tPos[a] = x - sx; tPos[a + 1] = y - sy; tPos[a + 2] = z - sz; tPos[a + 3] = x + sx; tPos[a + 4] = y + sy; tPos[a + 5] = z + sz;
        const al = (trail[i].brk || (i + 1 < n && trail[i + 1].brk) || i === n - 1 ? 0 : 1) * smooth(.05, .2, age) * Math.pow(1 - age / CAGE, 1.3) * .75; tA[b] = tA[b + 1] = al; }
      tGeo.attributes.position.needsUpdate = true; tGeo.attributes.aA.needsUpdate = true;
      tMat.uniforms.uC.value.setRGB(.06 + .94 * dl * sunL.color.r, .06 + .94 * dl * sunL.color.g, .07 + .93 * dl * sunL.color.b); }
    // re-entry plasma (hook): automatic from the convective heating q = 1.74e-4 sqrt(rho / 1 m) V³ (W/m²)
    const V = h.tas || 0, q = 1.74e-4 * Math.sqrt(air.rho) * V * V * V, k = plasmaK != null ? plasmaK : clamp((q - 2e5) / 1.5e6, 0, 1);
    plasma.visible = k > .002; if (plasma.visible) { plM.uniforms.uK.value = k;   // windward = the velocity direction in body axes
      const v = s.v, qq = s.q; if (v && qq) plM.uniforms.uW.value.set(v[0], v[1], v[2]).applyQuaternion(qT.set(qq[0], qq[1], qq[2], qq[3]).invert()).normalize(); }
  }

  const credit = [bms ? M.bms.credit : M.credit, M.cockpit && M.cockpit.credit, seats.length && M.seat.credit].filter(Boolean).join(' · ');
  const api = { model, nodes, hinge, stats, update, plume, orbit, credit, trail, trailMesh: trailM, seats, bms, setDof,   // setDof(n, v): tests (the next update overrides driven DOFs)
    get cockpit() { return ck.obj; }, set cockpitOff(v) { ck.off = !!v; },   // tests: cockpitOff = true shows the cockpit view without the scan
    set modelVisible(on) { stats.modelOn = on; model.visible = on; shG.visible = false; pool.visible = false; }, get modelVisible() { return stats.modelOn; },
    plasma(k) { plasmaK = k; },   // S5: k 0..1 forces the glow, null = automatic
    dispose() { R.domElement.removeEventListener('wheel', onWheel); if (cams) cams.dispose(); craft.remove(model, shG, pool); cs.remove(trailM); if (envRT) envRT.dispose(); pm.dispose();
      R.shadowMap.enabled = shadowWas; if (sunL.shadow.map) { sunL.shadow.map.dispose(); sunL.shadow.map = null; } } };
  return api;
}
