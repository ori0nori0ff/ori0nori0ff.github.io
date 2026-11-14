/* Flight menu (docs/flight-plan.md, steps S4 + S7): opened by the craft button in the 3D Earth view (earthgl.js, loaded on the first click).
   Craft picker (F-16 on a runway, test spacecraft in orbit, rockets on a real pad), what each one is, Start. Nothing of the flight code, models
   or wind is loaded before a craft is picked. While a craft flies, the button ends the flight. EN only for now (RO / DE later). */
let current = null, box = null;

export function openMenu(earth, host, btn) {
  if (current) { current.stop(); return; }
  if (box) { close(); return; }
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const phone = matchMedia('(pointer: coarse)').matches, q = earth.flight().quality;
  const lite = phone || q === 'low';   // S7: no scanned cockpit (~10 MB) unless asked
  box = document.createElement('div'); box.className = 'fl-menu'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Fly a craft');
  box.style.cssText = 'position:absolute;z-index:6;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,calc(100% - 32px));max-height:calc(100% - 32px);overflow:auto;padding:14px 16px;border-radius:14px;background:rgba(8,11,16,.94);border:1px solid rgba(255,255,255,.2);color:#E6EBF1;font:500 13px Inter,system-ui,sans-serif;line-height:1.5';
  const B = 'border:1px solid rgba(255,255,255,.25);background:rgba(10,14,20,.85);color:#E6EBF1;border-radius:12px;padding:10px 12px;font:600 13px Inter,system-ui,sans-serif;cursor:pointer;text-align:left;width:100%;margin-top:8px';
  const SEL = 'background:#0A0E14;color:#E6EBF1;border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:4px 6px;font:500 13px Inter,system-ui,sans-serif;min-height:32px';
  const keys = phone ? 'Touch: stick on the left, throttle on the right.' : 'Keys: R throttle, B brakes, S pull up, C views.';
  box.innerHTML = `<b style="font-size:15px">Fly a craft</b>
    <button data-c="f16" style="${B}">F-16 fighter jet<br><span style="font-weight:500;color:#AEB8C4">On runway 03 of Brașov-Ghimbav. Flight model from NASA wind-tunnel data; ${lite ? 'chase view with the flight data on the screen.' : 'a live cockpit (HUD, MFDs, gauges).'} ${keys}</span></button>
    ${lite ? `<label style="display:flex;gap:8px;align-items:center;margin-top:6px;color:#AEB8C4;font-size:12px"><input type="checkbox" data-k="cockpit" style="width:20px;height:20px;accent-color:#39FF9E"> Load the full F-16 cockpit too (~10 MB more, heavy for a phone)</label>` : ''}
    <button data-c="orbiter" style="${B}">Test spacecraft<br><span style="font-weight:500;color:#AEB8C4">In orbit 400 km over Brașov. Real orbital mechanics; pick a mission and it flies itself. A placeholder shape for now.</span></button>
    <button data-c="rocket" style="${B}">Rocket to orbit<br><span style="font-weight:500;color:#AEB8C4">A multi-stage launcher on a real pad: the autopilot flies to orbit, then a capsule comes back under parachutes. Placeholder shapes.</span></button>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;font-size:12px;color:#AEB8C4">
      <label>Rocket <select data-k="rocket" style="${SEL}"><option value="falcon9">Falcon 9</option><option value="saturn5">Saturn V</option></select></label>
      <label>Pad <select data-k="pad" style="${SEL}"><option value="">usual one</option><option value="lc39a">Kennedy LC-39A</option><option value="slc40">Cape Canaveral SLC-40</option><option value="baikonur">Baikonur</option><option value="kourou">Kourou</option></select></label></div>
    <p style="color:#AEB8C4;margin:10px 0 0;font-size:12px">The flight takes the camera; press Esc or ✕ Exit flight to come back. The craft loads on start (F-16: ${lite ? '~6' : q === 'medium' ? '~15' : '~21'} MB; spacecraft and rockets: ~0.3 MB). 3D quality: ${q} (⚙ settings).</p>
    <div style="text-align:right;margin-top:8px"><button data-c="close" style="${B};width:auto;text-align:center;border-radius:999px;padding:6px 14px">Cancel</button></div>`;
  host.appendChild(box); if (btn) btn.setAttribute('aria-expanded', 'true');
  box.querySelector('[data-c="f16"]').focus();
  const val = k => { const e = box.querySelector(`[data-k="${k}"]`); return !e ? null : e.type === 'checkbox' ? e.checked : e.value; };
  box.onclick = async e => { const b = e.target.closest('button'); if (!b) return; const c = b.dataset.c; if (!c) return;
    const o = { craft: c, rocket: val('rocket'), pad: val('pad') || (val('rocket') === 'saturn5' ? 'lc39a' : 'slc40'), cockpit: lite ? val('cockpit') : undefined };
    close(); if (c === 'close') return;
    const { startFlight } = await import('./session.js?v=b696f929');
    current = await startFlight(earth, host, { ...o, onExit: () => { current = null; } }); };
  function close() { if (box) box.remove(); box = null; if (btn) btn.setAttribute('aria-expanded', 'false'); }
  box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
}
