/* Weapon state for both HUDs (S12: + RWR warning, CMS counts, health / damage cautions from h.ew) (screen HUD flight/hud.js, cockpit HUD flight/instruments/f16.js): selected weapon + count, master arm,
   why the selected missile cannot launch, the short-range pick (body direction + range), the radar lock (range, closure), KILL / MISS for
   2 s after a missile detonation (a gun kill flashes KILL too). Data: the HUD object h, filled each tick by weapons.js (h.wsel, h.gun) and
   its plug-ins (h.sms stations.js, h.msl missiles.js, h.radar radar.js); after bind(S) also the weapons events (S.wpn.weapons.on) and
   S.plugins.list.missiles.pickTarget. Missing parts are skipped. Own code. */
const FLASH_MS = 2000;
const qrotC = (q, v) => { const x = -q[0], y = -q[1], z = -q[2], w = q[3], tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx]; };   // rotate by the conjugate of q (I -> body)

export function createWeaponHud() {
  let S = null, off = [], flash = null;
  const unbind = () => { for (const f of off) try { f(); } catch (e) { /* listener list gone with the session */ } off = []; };
  function bind(s) { unbind(); S = s; const Wp = s && s.wpn && s.wpn.weapons; if (!Wp || !Wp.on) return;
    off.push(Wp.on('detonate', d => { if (d.team === 'red') return; flash = { text: d.killed ? 'KILL' : 'MISS', t: performance.now() }; }));   // S12: AI missiles do not flash
    off.push(Wp.on('kill', d => { if (d && d.target && d.target.team === 'blue') return; flash = { text: 'KILL', t: performance.now() }; })); }

  // h = core.hud, s = core.state -> null (no weapons) or { sel, n, arm, warn, tgt: { b (unit, body axes), d (m), name } | null, lock: { range, closing } | null, flash }
  function read(h, s) { const g = h.gun, sel = h.wsel || (h.msl && h.msl.sel) || (g ? 'GUN' : null); if (!sel) return null;
    const m = h.msl && h.msl.sel === sel ? h.msl : null, Wp = S && S.wpn && S.wpn.weapons;
    const arm = g ? !!g.arm : !!(Wp && Wp.state && Wp.state.arm);
    let n = null; if (sel === 'GUN') n = g ? g.rounds : null; else if (h.sms) n = sel === 'AIM-9' ? h.sms.aim9 : sel === 'AIM-120' ? h.sms.aim120 : null;
    if (n == null && m) n = m.left;
    let warn = '';
    if (m) warn = n != null && n <= 0 ? 'EMPTY' : m.msg || (m.cls === 'long' && !(h.radar && h.radar.lock) ? 'NO LOCK' : '');
    else if (sel === 'GUN' && g && g.inhibit === 'EMPTY') warn = 'EMPTY';
    let tgt = null; const ms = S && S.plugins && S.plugins.list && S.plugins.list.missiles;
    if (m && m.cls === 'short' && ms && ms.pickTarget && s && s.ref === 'Earth') { const T = ms.pickTarget('short', s);
      if (T && T.r1) { const rel = [T.r1[0] - s.r[0], T.r1[1] - s.r[1], T.r1[2] - s.r[2]], d = Math.hypot(...rel), b = qrotC(s.q, rel); tgt = { b: b.map(c => c / d), d, name: T.name }; } }
    const L = h.radar && h.radar.lock, lock = L && isFinite(L.range) ? { range: L.range, closing: L.closing || 0 } : null;
    const fl = flash && performance.now() - flash.t < FLASH_MS ? flash.text : '';
    // S12 (flight/weapons/ew.js + damage.js, h.ew): RWR warning (LAUNCH / MISSILE / LOCK), countermeasures left, health and damage cautions
    const E = h.ew || null, ew = E ? { warn: E.warn || '', flares: E.flares ?? '-', chaff: E.chaff ?? '-', hp: E.hp ?? 100, cautions: E.cautions || [], dead: !!E.dead } : null;
    return { sel, n, arm, warn, tgt, lock, flash: fl, ew }; }

  return { bind, read, dispose: unbind, get session() { return S; } };
}
