/* M61A1 gun (flight/weapons): trigger -> barrel spin-up -> rounds per physics step, ammunition count, recoil. Data: the "gun" block of the
   aircraft json (flight/aircraft/f16.json, sources there). Own code.
   The gun only decides WHEN rounds leave and in WHICH direction (body axes); flight/weapons/weapons.js flies them.
   Model: while the trigger is held and firing is allowed, the barrel speed rises linearly from 0 to the full rate in spinUp seconds (ESTIMATE);
   rounds leave at rate x spin (the M61 feeds in proportion to the barrel speed). On release the feed stops at once (the linkless system
   clears the unfired rounds back into the drum); the barrels coast down in spinDown seconds (used by the sound only). */

const gauss = () => { let u = 0; while (u === 0) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); };

export function createGun(G) {
  const el = (G.elev || 0) * Math.PI / 180, az = (G.az || 0) * Math.PI / 180;
  // gun line in body axes (x right, y up, -z forward): elevation up, azimuth to the right
  const dir = [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
  const R = G.round, sig = (G.dispersionMrad || 0) / 1000;
  // recoil impulse per round (N s): projectile + propellant gas leaving at ~1.5 x the muzzle velocity (ESTIMATE, standard interior-ballistics rule)
  const impulse = R.v0 * (R.mass + 1.5 * (R.charge || 0));
  const st = { rounds: G.rounds, spin: 0, rate: 0, firing: false, fired: 0, acc: 0 };
  return {
    G, dir, impulse, state: st,
    // h = step (s); want = trigger held; ok = interlocks pass. Returns the sub-step fractions (0..1) at which rounds leave in this step
    step(h, want, ok) {
      const go = want && ok && st.rounds > 0;
      st.spin = go ? Math.min(1, st.spin + h / G.spinUp) : Math.max(0, st.spin - h / G.spinDown);
      st.rate = go ? st.spin * G.rpm / 60 : 0; st.firing = go;
      if (!go) { st.acc = 0; return null; }
      const a0 = st.acc; st.acc += st.rate * h; let n = Math.floor(st.acc); if (n > st.rounds) n = st.rounds;
      if (!n) return null;
      const out = []; for (let i = 1; i <= n; i++) out.push(Math.min(.999, Math.max(0, (i - a0) / (st.acc - a0))));   // when in the step each round leaves
      st.acc -= n; st.rounds -= n; st.fired += n; if (!st.rounds) { st.firing = false; st.rate = 0; }
      return out; },
    // one round's direction in body axes with the dispersion (circular normal, sigma per axis)
    aim(out) { const ex = sig * gauss(), ey = sig * gauss(); out[0] = dir[0] + ex; out[1] = dir[1] + ey; out[2] = dir[2];
      const l = Math.hypot(out[0], out[1], out[2]); out[0] /= l; out[1] /= l; out[2] /= l; return out; },
    reload() { st.rounds = G.rounds; st.spin = 0; st.rate = 0; st.firing = false; st.acc = 0; }
  };
}
