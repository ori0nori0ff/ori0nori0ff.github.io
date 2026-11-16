/* F-16 fuel system and external stores (flight/aero.js uses it): the 7 internal tanks of the F-16CM-50 (Falcon BMS 4.38 data), external
   tanks on stations 4 / 5 / 6, transfer and engine feed after the flight manual (TO 1F-16CM-1 BMS ch. 3), mass / CG / inertia of fuel +
   stores as point masses, stores drag, emergency jettison. Sources and estimates: aircraft/f16.json blocks "fuel" and "stores".
   Written as a station list so guns / missiles / bombs can add store types later (types with "lb", "drag", "cm", "jett", "model").
   createStores(J, load) -> ST; load = { tanks: 0 | 2 | 3, fuel: internal kg at the start (default J.fuel.start) }.
   State (core state s): s.sys.fuel = kg per tank (ST.tanks order: 7 internal, then one per external tank), s.sys.stores = { on: [per load
   entry attached], live: [per tank], drops: [jettisoned stores, for the drawing], ... }, s.ctl.jett = jettison key presses (core.js, key 0).
   Frames: body axes of core (x right, y up, z aft), metres from the reference CG. */
const LB = 0.45359237, KLBH = 1000 * LB / 3600;   // kg per lb; kg/s per 1000 lb/h
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createStores(J, load = {}) {
  const FU = J.fuel, SD = J.stores, RT = FU.rates, MS = J.mass;
  const nT = load.tanks == null ? 0 : +load.tanks, want = SD.loads[String(nT)];
  if (!want) throw new Error('stores: no load "' + nT + '" (tanks = 0, 2 or 3)');
  // ── tanks: internal (fixed), then the external ones of this load
  const tanks = FU.tanks.map((t, i) => ({ i, name: t.name, sys: t.sys, cap: t.lb * LB, p: t.pos, ext: false }));
  const I = Object.fromEntries(tanks.map(t => [t.name, t.i])), nInt = tanks.length;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  // ── stations and the load: entries { n, type, S (type data), p (mass point), slot (attachment point), rack, tank (index) }
  const stations = SD.stations.map(s => ({ n: s.n, p: s.pos, sys: s.sys || null }));
  const items = want.map(([n, type]) => { const S = SD.types[type], st = stations.find(x => x.n === n);
    if (!S || !st) throw new Error('stores: bad load entry ' + n + ' ' + type);
    const rack = S.rack ? { type: S.rack, S: SD.types[S.rack], p: add(st.p, SD.types[S.rack].cm) } : null;
    const slot = rack ? add(st.p, rack.S.slot) : st.p, it = { n, type, S, slot, p: add(slot, S.cm), rack, tank: -1, m0: S.lb * LB };
    if (S.fuelLb) { it.tank = tanks.length; tanks.push({ i: tanks.length, name: 'ext' + n, sys: st.sys, cap: S.fuelLb * LB, p: it.p, ext: true, station: n }); }
    return it; });
  const extIdx = sys => tanks.filter(t => t.ext && t.sys === sys).map(t => t.i);
  const eC = extIdx('C'), eA = extIdx('A'), eF = extIdx('F');

  // ── flow: engine feed, then transfer (all in kg; live[i] false = tank gone, capacity 0)
  const capOf = (i, live) => live[i] ? tanks[i].cap : 0;
  const move = (f, live, a, b, max) => { const x = Math.max(0, Math.min(max, f[a], capOf(b, live) - f[b])); f[a] -= x; f[b] += x; return x; };
  // FFP (Dash-1 3.4): equal flow from each reservoir; with one empty the other gives all (bypass lines). Returns the kg delivered.
  function feed(f, need) { const r = [I.fwdRes, I.aftRes]; let a = Math.min(need / 2, f[r[0]]), b = Math.min(need / 2, f[r[1]]), rest = need - a - b;
    if (rest > 0) { const x = Math.min(rest, f[r[0]] - a); a += x; rest -= x; b += Math.min(rest, f[r[1]] - b); }
    f[r[0]] -= a; f[r[1]] -= b; return a + b; }
  function transfer(f, live, h) {
    const sy = RT.syphon * KLBH * h, wi = RT.wingInt * KLBH * h;
    move(f, live, I.F2, I.fwdRes, sy); move(f, live, I.F1, I.F2, sy); move(f, live, I.A1, I.aftRes, sy);   // fuselage -> reservoirs (siphon)
    move(f, live, I.wingR, I.F1, wi); move(f, live, I.wingL, I.A1, wi);                                    // internal wings -> fuselage
    // external (EXT FUEL TRANS NORM): the centreline first, into both internal wing tanks; then each wing tank into its own side
    const cl = eC.find(i => live[i] && f[i] > 0);
    if (cl != null) { const r = RT.cline * KLBH * h, x = move(f, live, cl, I.wingL, r / 2); move(f, live, cl, I.wingR, r - x); }
    else { const r = RT.extWing * KLBH * h; for (const i of eA) if (live[i]) move(f, live, i, I.wingL, r); for (const i of eF) if (live[i]) move(f, live, i, I.wingR, r); }
  }
  // internal fuel for a start quantity: burned down from full with the same logic (wings first, then the fuselage, reservoirs last)
  function internalFor(kg) { const f = tanks.map(t => t.ext ? 0 : t.cap), live = tanks.map(t => !t.ext); let tot = f.reduce((a, b) => a + b, 0);
    kg = Math.max(0, Math.min(kg, tot)); const h = .5;
    for (let k = 0; k < 20000 && tot > kg + 1e-9; k++) { const need = Math.min(2 * h, tot - kg); tot -= feed(f, need); transfer(f, live, h); }
    return f; }

  // ── mass properties: dry airframe from the reference state (tanks = 0, J.fuel.start): there m, I and CG equal the report's values exactly
  const ref = internalFor(FU.start), mDry = MS.mRef - FU.start;
  function sums(f, on, live) { const a = { m: 0, x: 0, y: 0, z: 0, r: 0, p: 0, w: 0 };
    const pm = (m, p) => { a.m += m; a.x += m * p[0]; a.y += m * p[1]; a.z += m * p[2]; a.r += m * (p[0] * p[0] + p[1] * p[1]); a.p += m * (p[1] * p[1] + p[2] * p[2]); a.w += m * (p[0] * p[0] + p[2] * p[2]); };
    for (let i = 0; i < tanks.length; i++) if (live[i] && f[i] > 0) pm(f[i], tanks[i].p);
    if (on) items.forEach((it, k) => { if (on[k]) pm(it.m0, it.p); if (it.rack) pm(it.rack.S.lb * LB, it.rack.p); });
    return a; }
  const r0 = sums(ref.concat(tanks.slice(nInt).map(() => 0)), null, tanks.map(t => !t.ext));
  const dry = { x: -r0.x / mDry, y: -r0.y / mDry, z: -r0.z / mDry, r: MS.Jx - r0.r, p: MS.Jy - r0.p, w: MS.Jz - r0.w };
  // core's I: [[pitch (about x), 0, 0], [0, yaw (about y), -Jxz], [0, -Jxz, roll (about z)]] as aero.js before (inertia about the body origin)
  function massOf(s) { const S = s.sys.stores, a = sums(s.sys.fuel, S.on, S.live), m = mDry + a.m;
    return { m, cg: [(mDry * dry.x + a.x) / m, (mDry * dry.y + a.y) / m, (mDry * dry.z + a.z) / m],
      I: [[dry.p + a.p, 0, 0], [0, dry.w + a.w, -MS.Jxz], [0, -MS.Jxz, dry.r + a.r]] }; }

  // ── drag of the stores (CD increment, S = wing area): drag units x the BMS LIM_STORES_DRAG line (clamped)
  const [m0, m1] = SD.dragMach, [k0, k1] = SD.dragPerUnit;
  let cur = null;   // the state the aero tables read (one craft per aircraft instance)
  function dragUnits(S) { let u = 0; items.forEach((it, k) => { if (S.on[k]) u += it.S.drag; if (it.rack) u += it.rack.S.drag; }); return u; }
  const dCD = M => { if (!cur) return 0; const u = cur.sys.stores.units; if (!u) return 0; const t = Math.max(0, Math.min(1, (M - m0) / (m1 - m0))); return u * (k0 + (k1 - k0) * t); };

  // ── jettison: key 0 twice within 1 s (real time); inhibited with weight on wheels (Dash-1 34-1-1 3.1.1.2.4, no GND JETT switch here).
  // Emergency jettison releases stations 3-7; with stores on 3 or 7 and tanks on 4 and 6, station 6 goes 150 ms later (same section).
  function jettison(s, wow) { const S = s.sys.stores;
    if (wow) { S.msg = { text: 'JETTISON INHIBITED: WEIGHT ON WHEELS', until: now() + 2500 }; return; }
    const wing37 = items.some((it, k) => S.on[k] && (it.n === 3 || it.n === 7)), both = [4, 6].every(n => items.some((it, k) => S.on[k] && it.n === n && it.tank >= 0));
    let any = false;
    items.forEach((it, k) => { if (!S.on[k] || !it.S.jett || it.n < 3 || it.n > 7) return; any = true;
      S.pend.push({ k, t: s.t + (wing37 && both && it.n === 6 ? 150 : 0) }); });
    S.msg = { text: any ? 'STORES JETTISONED' : 'NOTHING TO JETTISON', until: now() + 3000 }; }
  function release(s, k) { const S = s.sys.stores, it = items[k]; if (!S.on[k]) return;
    S.on[k] = false; const fuel = it.tank >= 0 ? s.sys.fuel[it.tank] : 0;
    if (it.tank >= 0) { s.sys.fuel[it.tank] = 0; S.live[it.tank] = false; }
    S.drops.push({ n: it.n, type: it.type, model: it.S.model, slot: it.slot, cm: it.S.cm, mass: it.m0 + fuel, fuel, cdA: it.S.cdA || .15, t: s.t });
    S.units = dragUnits(S); }

  const ST = { tanks, items, stations, nInt, LB,
    // the start: internal fuel (load.fuel kg, default the reference 1 800 kg) distributed as after a burn-down from full; external tanks full
    init(s) { const f = internalFor(load.fuel != null ? +load.fuel : FU.start);
      for (const t of tanks) if (t.ext) f[t.i] = t.cap;
      s.sys.fuel = f; s.sys.stores = { on: items.map(() => true), live: tanks.map(() => true), drops: [], pend: [], arm: 0, jettSeen: s.ctl.jett || 0, msg: null, trpT: 0, units: 0 };
      s.sys.stores.units = dragUnits(s.sys.stores); cur = s; },
    // engine fuel available (both reservoirs empty = flame-out)
    feeds(s) { const f = s.sys.fuel; return f[I.fwdRes] + f[I.aftRes] > 0; },
    // once per physics step: jettison key, pending releases, feed ff (kg/s) for h s, transfer, warnings; returns kg delivered.
    // s.sys.fuelHold (tests): no fuel used, nothing moves (constant mass as the old "endless fuel")
    step(s, ff, h, wow) { const S = s.sys.stores, f = s.sys.fuel; cur = s;
      const jp = s.ctl.jett || 0; if (jp !== S.jettSeen) { S.jettSeen = jp; const t = now();
        if (S.arm && t - S.arm <= 1000) { S.arm = 0; jettison(s, wow); } else { S.arm = t; S.msg = { text: 'JETTISON: PRESS 0 AGAIN', until: t + 1000 }; } }
      if (S.pend.length) { S.pend = S.pend.filter(p => { if (s.t >= p.t) { release(s, p.k); return false; } return true; }); }
      if (s.sys.fuelHold) return ff * h;
      const got = feed(f, ff * h); transfer(f, S.live, h);
      // TRP FUEL (Dash-1 3.9): fuselage >= 500 lb below its capacity, total >= 500 lb above the fuselage, ff < 18 000 pph, all for 30 s
      const T = FU.trp, fus = ST.fuselage(s), cap = ST.fuselageCap, tot = f.reduce((a, b) => a + b, 0);
      S.trpT = fus <= cap - T.marginLb * LB && tot >= fus + T.marginLb * LB && ff < T.ffMaxPph * LB / 3600 ? S.trpT + h : 0;
      return got; },
    massOf, dCD,
    fuselage(s) { const f = s.sys.fuel; return f[I.F1] + f[I.F2] + f[I.A1] + f[I.fwdRes] + f[I.aftRes]; },
    fuselageCap: ['F1', 'F2', 'A1', 'fwdRes', 'aftRes'].reduce((a, n) => a + tanks[I[n]].cap, 0),
    // HUD / cockpit values (kg): total = the totaliser (internal + external), FR / AL = the fuselage pointers in NORM (fwd / aft systems)
    hud(s, hud) { const f = s.sys.fuel, S = s.sys.stores; let int = 0, ext = 0; for (const t of tanks) { if (t.ext) ext += f[t.i]; else int += f[t.i]; }
      const L = FU.lowLb, msg = S.msg && now() < S.msg.until ? S.msg.text : null;
      Object.assign(hud, { fuel: int + ext, fuelInt: int, fuelExt: ext, fuelFR: f[I.F1] + f[I.F2] + f[I.fwdRes], fuelAL: f[I.A1] + f[I.aftRes],
        fuelWingL: f[I.wingL], fuelWingR: f[I.wingR], fuelLowFwd: f[I.fwdRes] < L.fwd * LB, fuelLowAft: f[I.aftRes] < L.aft * LB,
        trpFuel: S.trpT >= FU.trp.time, storesMsg: msg, stores: items.filter((it, k) => S.on[k]).map(it => it.n + ':' + it.type) }); } };
  return ST;
}
