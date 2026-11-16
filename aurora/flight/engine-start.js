/* F-16 engine start, electrics, JFS, EPU and shutdown (docs/flight-notes/f16-engine-start.md). Own code; numbers from Falcon BMS 4.38
   (Data/Sim/Acdata/F-16A-15.txtpb `engine` block) and its T.O. 1F-16CM/AM-1 BMS + checklist; every number and its source sits in
   aircraft/f16.json (`start`, `electric`, `epu`). Estimates are labelled there.
   createEngineStart(J, { start: 'cold' | 'runway' }) -> {
     init(s)                       systems at the start of a flight (cold = everything off; runway = engine at idle, generators on line)
     tick(s, env, h, x) -> es      once per physics step, called by aero.js BEFORE its engine part. x = { fuel (kg), wow, pw (power level
                                   0..100 of the running engine), mach, altFt, kt }. es = { run, lit, rpm (%), ftit (deg C), ff (kg/s, while
                                   not run), thrustK (0..1 share of the idle thrust while starting) }. run = combustion + DEEC governing:
                                   aero.js then runs its normal engine (power lag, thrust tables) unchanged.
     mod                           a core module: keys (KeyN = auto start / shutdown, Equal = EPU on / off), key(), hud() }
   State for the cockpit and the sound (read only for them):
     s.ctl.cutoff                   throttle in OFF (cut-off) below IDLE
     s.sys.engine { state, lit, run, rpm %, ftit degC, seq (auto sequence step or null), msg }
     s.sys.elec   { main: 'off' | 'batt' | 'main' (MAIN PWR switch), stbyGen, mainGen (on line), epuGen, flcsPmg, bus: 'none' | 'batt' | 'stby' | 'main' | 'epu' }
     s.sys.jfs    { sw: 'off' | 'start2', spd 0..1 of governed speed, run (JFS RUN light), acc 0..1 (brake / JFS accumulators), tRun s }
     s.sys.epu    { sw: 'off' | 'norm' | 'on', auto (latched automatic start), spd 0..1, run (EPU RUN light), fuel 0..1 (hydrazine), hyd (burning hydrazine) } */

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lin = (c, x) => { if (x <= c[0][0]) return c[0][1]; for (let i = 1; i < c.length; i++) if (x <= c[i][0]) { const [a, va] = c[i - 1], [b, vb] = c[i]; return va + (vb - va) * (x - a) / (b - a); }
  return c[c.length - 1][1]; };
const T = s => (window.T ? window.T(s) : s);

export function createEngineStart(J, o = {}) {
  const C = J.start, EL = J.electric, EP = J.epu, mode = o.start === 'cold' ? 'cold' : 'runway', idle = C.idleRpm;
  const say = (s, m) => { s.sys.engine.msg = m; s.sys.engine.msgT = 4; };

  function init(s) {
    const run = mode === 'runway';
    s.ctl.cutoff = !run;
    s.sys.engine = { state: run ? 'run' : 'off', lit: run, run, rpm: run ? idle : 0, ftit: run ? C.ftit.idle : null, seq: null, msg: '', msgT: 0, tIgn: 0, tSeq: 0, tStby: run ? 99 : 0 };
    s.sys.elec = { main: run ? 'main' : 'off', stbyGen: run, mainGen: run, epuGen: false, flcsPmg: run, bus: run ? 'main' : 'none' };
    s.sys.jfs = { sw: 'off', spd: 0, run: false, acc: 1, tRun: 0, tGround: 0 };
    s.sys.epu = { sw: 'norm', auto: false, spd: 0, run: false, fuel: 1, hyd: false };
  }

  // ── once per physics step
  function tick(s, env, h, x) {
    const E = s.sys.engine, L = s.sys.elec, Jf = s.sys.jfs, P = s.sys.epu, ctl = s.ctl;
    if (E.ftit == null) E.ftit = env.air.T - 273.15;   // a cold engine starts at the air temperature
    sequence(s, h, x);
    // fuel reaches the burner: throttle out of OFF, fuel in the tanks, rpm high enough for the main fuel pump
    const fuelOk = x.fuel > 0 && !s.crash, sched = !ctl.cutoff && fuelOk && E.rpm >= C.minFuelRpm;
    if (E.lit && !(fuelOk && !ctl.cutoff)) { E.lit = false; E.run = false; }   // cut-off or flameout
    if (!E.lit) { E.tIgn = sched ? E.tIgn + h : 0; if (E.tIgn >= C.lightoffDelay) { E.lit = true; E.tIgn = 0; } }
    // JFS: START 2 spins it to governed speed (JFS RUN); it stops by itself at the cut-out rpm or after its longest run; spools down otherwise
    if (Jf.sw === 'start2') { Jf.spd = Math.min(1, Jf.spd + h / C.jfsSpinUp); Jf.tRun += h;
      if (E.rpm >= C.jfsCutout || Jf.tRun > C.jfsMaxRun) Jf.sw = 'off'; }
    else Jf.spd = Math.max(0, Jf.spd - h / C.jfsSpinDown);
    Jf.run = Jf.sw === 'start2' && Jf.spd >= 1;
    // brake / JFS accumulators: recharge while the engine turns at >= 12 %; on the ground with the engine stopped the ground crew recharges them (our convenience)
    if (Jf.acc < 1) { const crew = x.wow && E.rpm < C.minFuelRpm && Jf.spd === 0; Jf.tGround = crew ? Jf.tGround + h : 0;
      if (E.rpm >= C.minFuelRpm || Jf.tGround > 0) Jf.acc = Math.min(1, Jf.acc + h / C.accRecharge); }
    // rpm
    const wm = x.wow ? 0 : Math.min(C.windmill.max, C.windmill.rpmPerMach * x.mach);   // ram air turns a dead engine in flight (estimate)
    if (E.lit && E.run) E.rpm = idle + (100 - idle) * Math.min(x.pw, 50) / 50;   // governed: the same mapping as aero.js n2
    else if (E.lit) { E.rpm = Math.min(idle, E.rpm + Math.min(C.accelMax, (idle - E.rpm) / C.accelTau) * h);   // start schedule: light-off -> idle
      if (E.rpm >= idle - .5) { E.run = true; E.rpm = idle; } }
    else { const drive = Math.max(Jf.spd * C.jfsCrankRpm, wm);
      if (E.rpm < drive) E.rpm += (drive - E.rpm) * (1 - Math.exp(-h / C.crankTau));
      else E.rpm = Math.max(drive, E.rpm - ((E.rpm - drive) / C.spoolDownTau + C.spoolDownDrag) * h); }
    // FTIT: start schedule vs rpm, then idle .. MIL with the power level; cools to the air temperature when not burning (estimates in f16.json)
    const amb = env.air.T - 273.15, F = C.ftit;
    const ft = E.lit ? (E.run ? F.idle + (F.mil - F.idle) * Math.min(x.pw, 50) / 50 : lin(F.start, E.rpm)) : amb;
    E.ftit += (ft - E.ftit) * (1 - Math.exp(-h / (E.lit ? F.tau : F.coolTau)));
    // electrics: standby generator on line at its rpm, main generator at its rpm and some seconds after the standby one; both need MAIN PWR
    const sw = L.main === 'main', hy = EL.genHyst;
    L.stbyGen = sw && (L.stbyGen ? E.rpm >= EL.stbyGenRpm - hy : E.rpm >= EL.stbyGenRpm);
    E.tStby = L.stbyGen ? E.tStby + h : 0;
    L.mainGen = sw && (L.mainGen ? E.rpm >= EL.mainGenRpm - hy : E.rpm >= EL.mainGenRpm && E.tStby >= EL.mainGenDelay);
    L.flcsPmg = E.rpm >= EL.flcsPmgRpm;
    // EPU: automatic when both generators are off line in flight (switch NORM, battery power on); manual ON anywhere. Hydrazine unless the
    // running engine gives enough bleed air; it keeps running (latched) until the switch is reset
    if (P.sw === 'off') P.auto = false;
    else if (P.sw === 'norm' && !x.wow && L.main !== 'off' && !L.mainGen && !L.stbyGen && !P.auto) { P.auto = true; say(s, T('EPU started by itself: no generator on line')); }
    const want = P.sw === 'on' || (P.sw === 'norm' && P.auto), bleed = E.lit && E.rpm >= lin(EP.bleedRpm, x.altFt);
    P.hyd = want && !bleed && P.fuel > 0;
    if (want && (bleed || P.fuel > 0)) P.spd = Math.min(1, P.spd + h / EP.spinUp); else P.spd = Math.max(0, P.spd - h / EP.spinDown);
    if (P.hyd) P.fuel = Math.max(0, P.fuel - h / EP.burnTime);
    P.run = P.spd >= 1; L.epuGen = P.run;
    L.bus = L.mainGen ? 'main' : L.stbyGen ? 'stby' : L.epuGen ? 'epu' : L.main !== 'off' ? 'batt' : 'none';
    // engine state (a name for the HUD / cockpit)
    E.state = E.run ? 'run' : E.lit ? 'start' : E.rpm < .5 ? 'off' : Jf.spd > 0 && E.rpm <= Jf.spd * C.jfsCrankRpm + .5 ? 'motor' : x.wow ? 'spooldown' : 'windmill';
    if (E.msgT > 0) E.msgT -= h;
    const ffOut = E.lit && !E.run ? J.engine.tsfc.idleKgS * E.rpm / idle : sched ? J.engine.tsfc.idleKgS * .5 * E.rpm / idle : 0;   // estimate
    const tk = E.lit && !E.run ? Math.pow(clamp((E.rpm - C.throttleIdleAt) / (idle - C.throttleIdleAt), 0, 1), 2) : 0;   // estimate: thrust share of idle
    return { run: E.lit && E.run, lit: E.lit, rpm: E.rpm, ftit: E.ftit, ff: ffOut, thrustK: tk };
  }

  // ── the auto sequence (key N): cold -> idle, idle -> off; one step at a time, as the checklist
  function sequence(s, h, x) {
    const E = s.sys.engine, L = s.sys.elec, Jf = s.sys.jfs, ctl = s.ctl; if (!E.seq) return; E.tSeq += h;
    const next = q => { E.seq = q; E.tSeq = 0; };
    switch (E.seq) {
      case 'batt': L.main = 'batt'; if (E.tSeq > 1) next('main'); break;
      case 'main': L.main = 'main'; if (E.tSeq > 1) next('jfs'); break;
      case 'jfs':
        if (Jf.sw === 'off' && Jf.spd > 0) { if (E.tSeq < h * 1.5) say(s, T('JFS spooling down: waiting')); break; }   // it does not re-engage while spooling down
        if (Jf.acc < .99) { if (E.tSeq < h * 1.5) say(s, T('JFS accumulators recharging: waiting')); break; }
        if (!x.wow && (x.altFt > C.jfsEnvelope.altFt || x.kt > C.jfsEnvelope.kt)) { say(s, T('JFS start: only below 20 000 ft and 400 kt')); next('air'); break; }   // spooldown airstart
        if (E.rpm < C.jfsCutout) { Jf.sw = 'start2'; Jf.tRun = 0; Jf.acc = 0; }
        next(x.wow ? 'crank' : 'air'); break;
      case 'crank': if (E.rpm >= C.throttleIdleAt) { ctl.cutoff = false; ctl.throttle = 0; next('light'); } break;   // throttle OFF -> IDLE
      case 'air': if (E.rpm >= C.minFuelRpm) { ctl.cutoff = false; ctl.throttle = 0; next('light'); } break;           // airstart: IDLE at once
      case 'light': if (E.lit) next('idle'); else if (E.tSeq > C.noStart) { ctl.cutoff = true; Jf.sw = 'off'; say(s, T('No light-off in 20 s: start stopped')); next(null); } break;
      case 'idle': if (E.run && L.mainGen) { say(s, T('Engine at idle')); next(null); } break;
      case 'shut': if (E.rpm < C.offRpm) { L.main = 'off'; say(s, T('Engine off')); next(null); } break;
    }
  }

  // ── keys (through core.js, the normal key path): N = auto start when not running / shutdown at idle on the ground; = EPU on / off
  function key(s, code) {
    const E = s.sys.engine, P = s.sys.epu, wow = s.contact.some(c => c.force > 0);
    if (code === 'KeyN') {
      if (E.seq && E.seq !== 'shut') { s.ctl.cutoff = true; s.sys.jfs.sw = 'off'; E.seq = null; say(s, T('Start stopped')); }
      else if (E.run || (E.lit && E.seq !== 'shut')) {
        if (!wow) say(s, T('In flight the engine stays on (N shuts it down only on the ground)'));
        else if (s.ctl.throttle > .05) say(s, T('Throttle to idle first (X), then N'));
        else { s.ctl.cutoff = true; E.seq = 'shut'; E.tSeq = 0; say(s, T('Shutdown: throttle OFF')); } }
      else if (E.seq === 'shut' && E.rpm >= C.offRpm) say(s, T('Spooling down: wait'));
      else { E.seq = s.sys.elec.main === 'main' ? 'jfs' : 'batt'; E.tSeq = 0; say(s, wow ? T('Auto start') : T('Airstart')); } }
    else if (code === 'Equal') {
      if (P.sw === 'on') { P.sw = 'norm'; P.auto = false; say(s, T('EPU off (switch NORM)')); }
      else if (P.auto) { P.auto = false; say(s, T('EPU reset (it starts again if no generator is on line)')); }
      else { P.sw = 'on'; say(s, P.fuel > 0 ? T('EPU on') : T('EPU on: no hydrazine left')); } }
  }

  // ── one HUD line while something is not normal (starting, off, EPU running, generator off line, a message)
  function hud(s, env, hd) {
    const E = s.sys.engine, L = s.sys.elec, Jf = s.sys.jfs, P = s.sys.epu; if (!E) return;
    Object.assign(hd, { rpm: E.rpm, ftit: E.ftit, engState: E.state });
    const normal = E.run && !E.seq && L.mainGen && P.spd === 0 && Jf.spd === 0 && E.msgT <= 0;
    if (normal) { hd.engLine = ''; return; }
    const name = { off: T('ENGINE OFF'), motor: T('JFS MOTORING'), start: T('STARTING'), run: T('ENGINE RUN'), spooldown: T('SPOOL-DOWN'), windmill: T('FLAMEOUT') }[E.state];
    const p = [name, 'RPM ' + Math.round(E.rpm) + ' %', 'FTIT ' + Math.round(E.ftit) + ' °C'];
    if (Jf.spd > 0) p.push(Jf.run ? 'JFS RUN' : 'JFS ' + Math.round(Jf.spd * 100) + ' %');
    if (L.main === 'off') p.push(T('MAIN PWR OFF')); else { if (!L.stbyGen) p.push('STBY GEN'); if (!L.mainGen) p.push('MAIN GEN'); }
    if (P.spd > 0) p.push((P.run ? 'EPU RUN' : 'EPU') + ' · ' + T('hydrazine') + ' ' + Math.round(P.fuel * 100) + ' %');
    if (E.state === 'off' && !E.seq) p.push(T('N = auto start'));
    if (E.msgT > 0 && E.msg) p.push(E.msg);
    hd.engLine = p.join(' · ');
  }

  return { init, tick, mode, mod: { name: 'engine start (F-16)', keys: ['KeyN', 'Equal'], key, hud } };
}
