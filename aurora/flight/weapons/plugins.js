/* Weapons plug-ins (docs/flight-notes/weapons-contract.md): each file below is built by its own session and touches nothing outside its
   own files. A missing file is skipped (its import fails quietly), so the list can name modules that do not exist yet.
   A plug-in exports attach(ctx) -> { dispose() } (anything else it returns lands in S.plugins[name]).
   ctx = { S, F, core, def, Wp, bus: Wp.bus, cs (craft-layer scene), ui (flight UI element), key(code, help, down, up), mfdPage(name, draw),
           onPose(fn) }. Own code. */
const PLUGINS = ['stations', 'ai', 'radar', 'missiles', 'damage', 'ew', 'ai-weapons'];   // S12: the F-16 as a target, RWR + countermeasures, AI guns + missiles   // load order = the order their systems run in each physics step

export async function loadPlugins(S, base) {
  const keys = new Map(), poses = [], out = {}, help = [];
  const kd = e => { const k = keys.get(e.code); if (!k || !base.F.piloting || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input,textarea,select')) return;
    e.preventDefault(); if (k.down) k.down(e); };
  const ku = e => { const k = keys.get(e.code); if (k && k.up) k.up(e); };
  addEventListener('keydown', kd); addEventListener('keyup', ku);
  for (const name of PLUGINS) {
    let m; try { m = await import('./' + name + '.js'); } catch (e) { if (!/Failed to fetch|Importing a module|404/.test(String(e))) console.error('plug-in ' + name, e); continue; }
    const ctx = { ...base, bus: base.Wp.bus,
      // key(code, help, down(e), up(e)): one owner per key code (a second claim is refused with an error: see the contract's key table)
      key(code, h, down, up) { if (keys.has(code)) { console.error(`plug-in ${name}: key ${code} already taken by ${keys.get(code).by}`); return false; }
        keys.set(code, { by: name, down, up }); if (h) help.push([h[0], h[1]]); return true; },
      mfdPage(pg, draw) { if (S.cockpit && S.cockpit.addPage) S.cockpit.addPage(pg, draw); },
      onPose(fn) { poses.push(fn); } };
    try { out[name] = m.attach(ctx) || {}; } catch (e) { console.error('plug-in ' + name, e); }
  }
  return { list: out, help, update(P, t) { for (const f of poses) try { f(P, t); } catch (e) { console.error('plug-in pose', e); } },
    dispose() { removeEventListener('keydown', kd); removeEventListener('keyup', ku); for (const k in out) try { out[k].dispose && out[k].dispose(); } catch (e) { console.error(e); } } };
}
