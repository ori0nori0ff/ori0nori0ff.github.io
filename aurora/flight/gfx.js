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
    // estimate (S4; was (0, 1.42, -4.55) in S3b, 11° over the HUD glass, so a horizon could never lie on it): ~25 cm in front of the scanned
    // seat's head rest; the boresight crosses the scanned HUD combiner 2.5° under its top (the F-16's waterline sits near the HUD's top)
    eye: [0, 1.29, -4.70],
    // S3b: the photogrammetry cockpit (loaded the first time the Cockpit view is used) and the ejection seat (rear seat; front seat seen from outside)
    cockpit: { url: new URL('models/f16-cockpit/f16-cockpit.gltf', import.meta.url),
      credit: 'Cockpit: "F-16C Cockpit Photogrammetry" by VTX (Sketchfab), CC BY-NC-SA 4.0, reduced and placed (same licence)',
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
  const t0 = performance.now(), gltf = await new GLTFLoader().loadAsync(M.url.href); stats.loadMs = performance.now() - t0;
  const model = gltf.scene, nodes = {}; craft.add(model);
  // S3b: ejection seats (front + rear, one geometry); a missing seat file only drops the seats
  const seats = [];
  if (M.seat) try { const sg = (await new GLTFLoader().loadAsync(M.seat.url.href)).scene;
    for (const p of M.seat.at) { const s = seats.length ? sg.clone() : sg; s.position.set(...p); s.name = 'Seat' + seats.length; model.add(s); seats.push(s); } }
  catch (e) { console.warn('seat model', e); }
  model.traverse(n => { nodes[n.name] = n;
    if (!n.isMesh) return; const m = n.material; n.castShadow = m.name !== 'Glass'; n.receiveShadow = true; stats.tris += (n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3; });
  // materials (our look, not the source's Cycles values): the paint is a dielectric semi-matte grey; the texture's gloss map is remapped to 0.38-0.8 roughness
  const mats = {}; model.traverse(n => { if (n.isMesh) mats[n.material.name] = n.material; });
  if (mats.Paint) { const p = mats.Paint; p.metalness = .12; p.roughness = 1;
    p.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>',
      'float roughnessFactor = roughness;\n#ifdef USE_ROUGHNESSMAP\nroughnessFactor = mix(.38, .8, texture2D(roughnessMap, vRoughnessMapUv).g);\n#endif'); }; }
  if (nodes.Nozzle && mats.Paint) { const nm = mats.Paint.clone(); nm.onBeforeCompile = mats.Paint.onBeforeCompile; nm.metalness = .85; nm.color.setRGB(.55, .52, .5); nodes.Nozzle.traverse(n => { if (n.isMesh) n.material = nm; }); }
  if (mats.Glass) { mats.Glass.depthWrite = false; mats.Glass.envMapIntensity = 1.4; mats.Glass.opacity = .16; }
  // S3b: while the scanned cockpit is shown, the body's own cockpit block (inside the cut box, craft frame) is not drawn (fragment discard)
  const cutU = { value: 0 }, cutA = new THREE.Vector3(), cutB = new THREE.Vector3();
  if (M.cockpit && nodes.Body) { cutA.set(...M.cockpit.cut[0]); cutB.set(...M.cockpit.cut[1]); model.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    nodes.Body.traverse(n => { if (!n.isMesh) return; const m0 = n.material, m = m0.clone(), prev = m0.onBeforeCompile, cutM = { value: new THREE.Matrix4().multiplyMatrices(inv, n.matrixWorld) };
      m.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r); Object.assign(sh.uniforms, { uCut: cutU, uCutA: { value: cutA }, uCutB: { value: cutB }, uCutM: cutM });
        sh.vertexShader = 'uniform mat4 uCutM; varying vec3 vCut;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCut = (uCutM * vec4(position, 1.)).xyz;');
        sh.fragmentShader = 'uniform float uCut; uniform vec3 uCutA, uCutB; varying vec3 vCut;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>',
          'if (uCut > .5 && all(greaterThan(vCut, uCutA)) && all(lessThan(vCut, uCutB))) discard;\n#include <clipping_planes_fragment>'); };
      m.customProgramCacheKey = () => 'bodycut'; n.material = m; }); }
  // S3b: the scanned cockpit, loaded the first time the Cockpit view is used (10 MB); its texture holds the scan's own (baked) light
  const ck = { obj: null, loading: null, off: false, scan: null };
  function loadCockpit() { const t1 = performance.now();
    ck.loading = new GLTFLoader().loadAsync(M.cockpit.url.href).then(g => { const c = g.scene, st = { loadMs: performance.now() - t1, tris: 0, gpuBytes: 0 }, t2 = performance.now(), geo = new Set(), tex = new Set();
      c.name = 'Cockpit'; c.traverse(n => { if (!n.isMesh) return; const m = n.material; geo.add(n.geometry); st.tris += n.geometry.index.count / 3;
        if (m.name === 'HudGlass') { m.transparent = true; m.opacity = .12; m.depthWrite = false; m.metalness = 0; m.roughness = .05; n.castShadow = false; n.renderOrder = 6; }
        else { m.metalness = 0; m.roughness = .85; m.emissive.setRGB(1, 1, 1); m.emissiveMap = m.map; ck.scan = m; n.castShadow = n.receiveShadow = true; if (m.map) { m.map.anisotropy = Math.min(8, R.capabilities.getMaxAnisotropy()); tex.add(m.map); } } });
      for (const t of tex) { R.initTexture(t); st.gpuBytes += t.image.width * t.image.height * 4 * 4 / 3; }
      for (const gg of geo) { for (const a of Object.values(gg.attributes)) st.gpuBytes += a.array.byteLength; st.gpuBytes += gg.index.array.byteLength; }
      model.add(c); c.visible = false; ck.obj = c; st.uploadMs = performance.now() - t2; stats.cockpit = st;
      // high quality on a PC: the 8192² texture (6 MB more, ~360 MB GPU memory instead of ~90 MB) replaces the 4096² one once loaded
      const q = o.quality || (() => { try { return localStorage.getItem('aurora.q3d'); } catch (e) { return null; } })() || 'high';
      if ((o.scan ? o.scan === 'hi' : q === 'high') && ck.scan && R.capabilities.maxTextureSize >= 8192 && !matchMedia('(pointer: coarse)').matches) {
        const t3 = performance.now(); new THREE.TextureLoader().loadAsync(new URL('cockpit_base_8k.jpg', M.cockpit.url).href).then(tx => { const m = ck.scan, old = m.map;
          tx.flipY = false; tx.colorSpace = old.colorSpace; tx.anisotropy = old.anisotropy; tx.wrapS = old.wrapS; tx.wrapT = old.wrapT; R.initTexture(tx);
          m.map = m.emissiveMap = tx; m.needsUpdate = true; old.dispose(); st.hiMs = performance.now() - t3; st.gpuBytes += (8192 * 8192 - 4096 * 4096) * 4 * 4 / 3; })
          .catch(e => console.warn('cockpit 8k texture', e)); } })
      .catch(e => { console.warn('cockpit model', e); }); }
  // hinged parts (glTF extras.hinge = axis in the craft frame, node origin on the hinge line)
  const hinge = {}; model.traverse(n => { if (n.userData && n.userData.hinge) hinge[n.name] = { n, ax: new THREE.Vector3(...n.userData.hinge).normalize(), q0: n.quaternion.clone() }; });
  const turn = (name, deg) => { const h = hinge[name]; if (h) h.n.quaternion.copy(h.q0).multiply(qT.setFromAxisAngle(h.ax, deg * D2R)); };
  // nozzle iris: scaled about its own axis
  const exitP = nodes.NozzleExit ? nodes.NozzleExit.position.clone() : new THREE.Vector3(0, .5, 6), nozR = (nodes.Nozzle && nodes.Nozzle.userData.radius) || .33;
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
  navR.position.set(...M.nav.red); navG.position.set(...M.nav.green); navT.position.set(...M.nav.tail); strobe.position.set(...M.strobe);
  const landP = nodes.LandingLight ? nodes.LandingLight.position.clone() : new THREE.Vector3(0, -.9, -3.8); land.position.copy(landP).add(new THREE.Vector3(0, 0, -.15));
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
  const poolM = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uI: { value: 0 } },
    vertexShader: 'varying vec2 vU; void main() { vU = uv * 2. - 1.; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform float uI; varying vec2 vU; void main() { float r = dot(vU, vU); gl_FragColor = vec4(vec3(1., .95, .85) * uI * exp(-r * 3.5) * step(r, 1.), 1.); }' });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), poolM); pool.renderOrder = 2; pool.frustumCulled = false; craft.add(pool);
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
  const def = o.def; if (def) { const v = def.views; v[0] = { ...v[0], eye: M.eye.slice(), tilt: -.19, fov: 62 }; /* S3b / S4: cockpit 62° vertical (Earth camera 35°), 11° down: HUD + MFDs + ADI in view */ if (!v.some(x => x.name === 'Orbit')) v.push(orbit); }
  const onWheel = e => { if (!F.piloting || !def || def.views[core.view] !== orbit) return; orbit.dist = clamp(orbit.dist * Math.exp(Math.sign(e.deltaY) * .15), 6, 3000); };
  R.domElement.addEventListener('wheel', onWheel, { passive: true });

  // ── per frame: P = core's draw pose (W), t = earthgl time (ms)
  const camRel = new THREE.Vector3(), nW = new THREE.Vector3(), lB = new THREE.Vector3(), uB = new THREE.Vector3(), qInv = new THREE.Quaternion(), S4 = new THREE.Matrix4(), rel = new THREE.Matrix4();
  function update(P, t) {
    const s = core.state, h = core.hud, srf = s.srf || {}, e = (s.eng && s.eng[0]) || {}, up = nW.copy(P.pos).normalize(), sun = F.sun().clone().normalize();
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
    const tr = trail.length > 1; o.camera.near = (tr ? Math.max(.05, Math.min(d - 20, 1)) : Math.max(.05, d - 20)) / R_E; o.camera.far = (d + (tr ? 25000 : 60)) / R_E;
    if (!stats.modelOn) return;
    // control surfaces (deg; signs: elev +, flaperon + = trailing edge down; S&L aileron + = right flaperon down; rudder + = trailing edge left)
    const el = srf.elev || 0, ai = srf.ail || 0, ru = srf.rud || 0, aoa = h.aoa || 0, gear = srf.gear == null ? 1 : srf.gear;
    const tef = gear > .5 && (h.ias || 0) < 124 ? 20 : 0;   // F-16 flaperons droop with the gear down at low speed (simplified schedule)
    const lef = s.onGround ? 0 : clamp(1.38 * aoa, 0, 25);    // leading-edge flaps ~1.38 × AoA (published schedule without its Mach / qbar term)
    turn('Stab_L', el - M.stabDiff * ai); turn('Stab_R', el + M.stabDiff * ai);
    turn('Flaperon_L', clamp(tef - ai, -23, 20)); turn('Flaperon_R', clamp(tef + ai, -23, 20));
    turn('LEF_L', -lef); turn('LEF_R', -lef); turn('Rudder', -ru);
    // gear: telescoped into the wells (a stand-in for the real retraction paths), doors closed when up
    for (const n of gearN) { n.visible = gear > .01; n.scale.set(1, Math.max(.01, gear), 1); }
    if (nodes.Doors_Up) nodes.Doors_Up.visible = gear <= .01;
    // engine: power 0..100 (S2: < 50 dry, 50..100 afterburner); nozzle open at idle and in AB, closed at MIL
    const pw = e.power || 0, on = !!e.on, ab = on && pw > 50, st = ab ? (pw - 50) / 50 : 0, wide = clamp(Math.pow(101325 / Math.max(1, air.p), .3), 1, 8);
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
    if (ck.scan) ck.scan.emissiveIntensity = .04 + .3 * dl;   // estimate: instrument / flood light at night + sky light through the canopy by day
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
    // landing light pool: where the beam (3° down from the nose line) meets the plane, within 400 m, gear down
    { const dir = vT.set(0, -Math.sin(3 * D2R), -Math.cos(3 * D2R)), den = uB.dot(dir), dist = den < -1e-3 ? -(uB.dot(landP) + hO) / den : -1;
      pool.visible = land.visible && dist > 0 && dist < 400 && hO < 200; if (inCock) land.visible = false;
      if (pool.visible) { const c = vS.copy(landP).addScaledVector(dir, dist).addScaledVector(uB, .05), w = 2 * dist * Math.tan(9 * D2R) + 2, l = w / Math.max(.08, -den);
        pool.position.copy(c); const fwd = dir.clone().addScaledVector(uB, -dir.dot(uB)).normalize(), X = new THREE.Vector3().crossVectors(fwd, uB);
        pool.quaternion.setFromRotationMatrix(mT.makeBasis(X, fwd, uB)); pool.scale.set(w, Math.min(l, 6 * w), 1);
        poolM.uniforms.uI.value = 1.5 * Math.pow(1 - dl, 2) * clamp(400 / (dist * dist + 40), 0, 1.5); } }   // ~10-50 lx vs 10⁴-10⁵ lx of daylight: seen only at dusk / night
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

  const credit = [M.credit, M.cockpit && M.cockpit.credit, seats.length && M.seat.credit].filter(Boolean).join(' · ');
  const api = { model, nodes, hinge, stats, update, plume, orbit, credit, trail, trailMesh: trailM, seats,
    get cockpit() { return ck.obj; }, set cockpitOff(v) { ck.off = !!v; },   // tests: cockpitOff = true shows the cockpit view without the scan
    set modelVisible(on) { stats.modelOn = on; model.visible = on; shG.visible = false; pool.visible = false; }, get modelVisible() { return stats.modelOn; },
    plasma(k) { plasmaK = k; },   // S5: k 0..1 forces the glow, null = automatic
    dispose() { R.domElement.removeEventListener('wheel', onWheel); craft.remove(model, shG, pool); cs.remove(trailM); if (envRT) envRT.dispose(); pm.dispose();
      R.shadowMap.enabled = shadowWas; if (sunL.shadow.map) { sunL.shadow.map.dispose(); sunL.shadow.map = null; } } };
  return api;
}
