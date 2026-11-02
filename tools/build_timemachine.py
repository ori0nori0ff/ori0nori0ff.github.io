"""TIME MACHINE: one archived week on the main page (like storm mode, for any week of the replay archive).

Reads a baked replay week (<dir>/<id>/data.json + its pictures, made by build_replay.py) and writes <dir>/<id>/tm/: the page's own
NOAA / NASA feeds as they were at the END of that week (so every 7-day chart shows the whole week, and the page's clock can be
scrubbed through it). storm.js (?storm=<id>) then answers the page's requests from these files. No downloads at all: everything
comes from data.json, so it adds no host, key or dependency to the weekly bot.

    python tools/build_timemachine.py --id oct2024                                  # web/aurora/replay/oct2024/tm/
    python tools/build_timemachine.py --id w2026_40 --dir <aurora-replay checkout> --prefix /aurora-replay/

What is estimated (and labelled on the page): Dst = hourly SYM-H, the aurora oval from Kp, the ENLIL "forecast at Earth" = what was
measured, flares from the GOES curve (no regions), NOAA alerts from Kp. Not available: protons, regions, ENLIL speed view.
May 2024 keeps its own richer storm mode (tools/build_storm.py, storm/may2024/).
"""
import argparse, json, math, pathlib
from datetime import datetime, timedelta, timezone
from PIL import Image, ImageDraw

A = argparse.ArgumentParser()
A.add_argument('--id', required=True); A.add_argument('--dir', help='the replay folder (default web/aurora/replay)')
A.add_argument('--prefix', help="how the page reaches the week folder (default 'replay/'; the bot: '/aurora-replay/')")
ARGS = A.parse_args()
ROOT = pathlib.Path(__file__).resolve().parent.parent
WK = pathlib.Path(ARGS.dir or ROOT / 'web/aurora/replay') / ARGS.id
PRE = (ARGS.prefix or 'replay/') + ARGS.id + '/'
OUT = WK / 'tm'; SW = OUT / 'swpc'
UTC = timezone.utc
D = json.loads((WK / 'data.json').read_text(encoding='utf-8'))
T0, T1, STEP = D['t0'], D['t1'], D['step']
NOWMS = T1 - 60000; NOW = datetime.fromtimestamp(NOWMS / 1000, UTC)
ms = lambda d: int(d.timestamp() * 1000)
dt = lambda m: datetime.fromtimestamp(m / 1000, UTC)
iso = lambda d, z='': d.strftime('%Y-%m-%dT%H:%M:%S') + z
def put(path, obj):
    p = SW / path; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(json.dumps(obj, separators=(',', ':')), encoding='utf-8')
N = len(D['v']); TT = [T0 + i * STEP for i in range(N)]
col = lambda k: D.get(k) or [None] * N
phi = lambda bx, by: None if bx is None or by is None else round(math.degrees(math.atan2(by, bx)) % 360, 2)

def gof(k):
    """NOAA G scale from Kp: 5- already counts as Kp 5 (G1), 9- is still G4, only 9 = G5"""
    return 5 if k >= 8.99 else min(4, int(k + .34) - 4) if k >= 4.66 else 0

def hourly(k):
    """hourly means of a 5-min series: {hour start ms: value}"""
    out = {}
    for t, v in zip(TT, col(k)):
        if v is None: continue
        h = t - t % 3600000; out.setdefault(h, []).append(v)
    return {h: sum(L) / len(L) for h, L in out.items()}

def wind():
    R = [dict(t=dt(t), bt=bt, bx=bx, by=by, bz=bz, v=v, n=n, T=tp) for t, bt, bx, by, bz, v, n, tp in zip(TT, col('bt'), col('bx'), col('by'), col('bz'), col('v'), col('n'), col('tp'))]
    past = [r for r in R if NOW - timedelta(days=2) <= r['t'] <= NOW][::-1]   # NOAA lists the newest first
    put('json/rtsw/rtsw_mag_1m.json', [{'time_tag': iso(r['t']), 'active': True, 'source': 'OMNI', 'bt': r['bt'], 'bx_gsm': r['bx'], 'by_gsm': r['by'], 'bz_gsm': r['bz'], 'phi_gsm': phi(r['bx'], r['by'])} for r in past])
    put('json/rtsw/rtsw_wind_1m.json', [{'time_tag': iso(r['t']), 'active': True, 'source': 'OMNI', 'proton_speed': r['v'], 'proton_density': r['n'], 'proton_temperature': r['T']} for r in past])
    H = {k: hourly(k) for k in ('bt', 'bx', 'by', 'bz', 'v', 'n', 'tp', 'sym')}
    hrs = sorted(H['v'].keys() | H['bt'].keys())[::-1]
    g = lambda k, h: (round(H[k][h], 2) if h in H[k] else None)
    put('json/ace/mag/ace_mag_1h.json', [{'time_tag': iso(dt(h)), 'dsflag': 0, 'bt': g('bt', h), 'gsm_bx': g('bx', h), 'gsm_by': g('by', h), 'gsm_bz': g('bz', h), 'gsm_lon': phi(g('bx', h), g('by', h))} for h in hrs])
    put('json/ace/swepam/ace_swepam_1h.json', [{'time_tag': iso(dt(h)), 'dsflag': 0, 'dens': g('n', h), 'speed': g('v', h), 'temperature': g('tp', h)} for h in hrs])
    lv = next((r for r in reversed(R) if r['v'] is not None), None); lm = next((r for r in reversed(R) if r['bz'] is not None), None)
    if lv: put('products/summary/solar-wind-speed.json', [{'proton_speed': round(lv['v']), 'time_tag': iso(lv['t'], 'Z')}])
    if lm: put('products/summary/solar-wind-mag-field.json', [{'bt': round(lm['bt'] or 0), 'bz_gsm': round(lm['bz']), 'time_tag': iso(lm['t'], 'Z')}])
    put('products/kyoto-dst.json', [{'time_tag': iso(dt(h)), 'dst': int(round(v))} for h, v in sorted(H['sym'].items())])   # SYM-H hourly ≈ Dst
    CL = cme_hours(H)
    put('json/enlil_time_series.json', [{'time_tag': iso(dt(h)), 'earth_particles_per_cm3': round(H['n'][h], 2), 'v_r': round(H['v'][h]), 'cloud': 1 if h in CL else 0}
                                        for h in sorted(H['v']) if h in H['n']])   # what was measured, not a forecast; cloud = a CME passing (found below)

def cme_hours(H):
    """the hours a CME passed Earth, found in the measured wind: a shock (speed up >= 60 km/s and >= 12 % within the hour, the field
    up too) → until the field calms (Bt back under 45 % of its peak, at least 6 h, at most 48 h). A shape guess like the page's
    windEvents(); the 3D model launches each one from the Sun at the speed it arrived with."""
    V, B = H['v'], H['bt']; hs = sorted(V); out, shocks, last = set(), [], -1e18
    mean = lambda d, h0, h1: (lambda L: sum(L) / len(L) if L else None)([d[h] for h in range(h0, h1, 3600000) if h in d])
    for h in hs:
        vb, va = mean(V, h - 3 * 3600000, h), mean(V, h, h + 2 * 3600000); bb, ba = mean(B, h - 3 * 3600000, h), mean(B, h, h + 2 * 3600000)
        if None in (vb, va, bb, ba): continue
        if va - vb >= 60 and va >= vb * 1.12 and ba >= bb * 1.3 and h - last >= 12 * 3600000:
            shocks.append(h); last = h
    for i, h in enumerate(shocks):
        pk = max([B.get(h + k * 3600000, 0) for k in range(36)]); end = h + 6 * 3600000
        for k in range(6, 48):
            if B.get(h + k * 3600000, 0) >= max(6, .45 * pk): end = h + k * 3600000
        if i + 1 < len(shocks): end = min(end, shocks[i + 1] - 2 * 3600000)   # the next CME starts its own (a gap keeps them apart)
        out.update(range(h, end + 1, 3600000))
        print('  CME at Earth', iso(dt(h)), '→', iso(dt(end)), 'Bt peak', round(pk))
    return out

def kp():
    P = [(dt(t), v) for t, v in D['kp']]
    scale = lambda k: 'G' + str(gof(k)) if gof(k) else None
    put('products/noaa-planetary-k-index-forecast.json', [{'time_tag': iso(t), 'kp': round(k, 2), 'observed': 'observed' if t + timedelta(hours=3) <= NOW else 'estimated', 'noaa_scale': scale(k)} for t, k in P])
    rows, t = [], NOW - timedelta(hours=6)
    while t <= NOW:
        k = ([v for s, v in P if s <= t] or [0])[-1]; rows.append({'time_tag': iso(t), 'kp_index': int(round(k)), 'estimated_kp': round(k, 2), 'kp': f'{int(round(k))}'}); t += timedelta(minutes=1)
    put('json/planetary_k_index_1m.json', rows)
    return P

def xrays():
    out = []
    for t, l, s in zip(TT, D.get('xr') or [], D.get('xs') or []):
        if l: out.append({'time_tag': iso(dt(t), 'Z'), 'satellite': 16, 'flux': l, 'energy': '0.1-0.8nm'})
        if s: out.append({'time_tag': iso(dt(t), 'Z'), 'satellite': 16, 'flux': s, 'energy': '0.05-0.4nm'})
    put('json/goes/primary/xrays-7-day.json', out); put('json/goes/primary/xrays-3-day.json', [r for r in out if r['time_tag'] >= iso(NOW - timedelta(days=3), 'Z')])
    # flares from the curve: each peak ≥ C1 that stands out of its ±1 h, begin / end where it falls to half its rise
    x = D.get('xr') or []; F = []
    for i in range(1, len(x) - 1):
        v = x[i]
        if not v or v < 1e-6: continue
        w = [q for q in x[max(0, i - 12):i + 13] if q]
        if v < max(w) or any(F and abs(i - f[0]) < 12 for f in F[-1:]): continue
        base = min(w); half = base + (v - base) / 2
        a = i
        while a > 0 and x[a - 1] and x[a - 1] > half and i - a < 24: a -= 1
        b = i
        while b < len(x) - 1 and x[b + 1] and x[b + 1] > half and b - i < 36: b += 1
        F.append((i, a, b, v))
    cls = lambda v: next(f'{c}{v / s:.1f}' for c, s in (('X', 1e-4), ('M', 1e-5), ('C', 1e-6), ('B', 1e-7), ('A', 1e-8)) if v >= s)
    X = [{'time_tag': iso(dt(TT[a]), 'Z'), 'begin_time': iso(dt(TT[a]), 'Z'), 'max_time': iso(dt(TT[i]), 'Z'), 'max_class': cls(v), 'max_xrlong': v, 'end_time': iso(dt(TT[b]), 'Z'), 'satellite': 16} for i, a, b, v in F]
    put('json/goes/primary/xray-flares-7-day.json', X)
    put('json/solar_regions.json', []); put('json/edited_events.json', [])   # not archived per week: the Sun card shows the X-rays + flares without regions
    return X

def ovation(k):
    PL, PO = math.radians(80.8), math.radians(-72.6); c = 66.5 - 2.3 * k; w = 2.6 + .55 * k; amp = min(100, 12 + 10 * k)
    sun = -((NOW.hour + NOW.minute / 60) - 12) * 15; co = []
    for lo in range(360):
        for la in range(-90, 91):
            f, l = math.radians(la), math.radians(lo if lo <= 180 else lo - 360)
            ml = math.degrees(math.asin(math.sin(f) * math.sin(PL) + math.cos(f) * math.cos(PL) * math.cos(l - PO)))
            night = .55 + .45 * -math.cos(l - math.radians(sun)); cc = c - 2.5 * (night - .5)
            v = amp * night * math.exp(-((abs(ml) - cc) / w) ** 2)
            co.append([lo, la, int(round(v)) if v > 3 else 0])
    put('json/ovation_aurora_latest.json', {'Observation Time': iso(NOW, 'Z'), 'Forecast Time': iso(NOW + timedelta(minutes=35), 'Z'), 'Data Format': '[Longitude, Latitude, Aurora]', 'coordinates': co, 'type': 'MultiPoint', 'note': 'time machine: estimated from Kp'})

def scales_alerts(P, xr):
    k_now = ([v for t, v in P if t <= NOW] or [0])[-1]
    g = gof(k_now)
    big = max([f['max_xrlong'] for f in xr if f['max_time'] > iso(NOW - timedelta(hours=24), 'Z')] or [0])
    r = 5 if big >= 2e-3 else 4 if big >= 1e-3 else 3 if big >= 1e-4 else 2 if big >= 5e-5 else 1 if big >= 1e-5 else 0
    T = {0: 'none', 1: 'minor', 2: 'moderate', 3: 'strong', 4: 'severe', 5: 'extreme'}
    put('products/noaa-scales.json', {'0': {'DateStamp': NOW.strftime('%Y-%m-%d'), 'TimeStamp': NOW.strftime('%H:%M:%S'), 'R': {'Scale': str(r), 'Text': T[r]}, 'S': {'Scale': '0', 'Text': 'none'}, 'G': {'Scale': str(g), 'Text': T[g]}}})
    al, seen = [], set()
    for t, v in P:
        for lv in (5, 6, 7, 8, 9):
            if v >= (8.99 if lv == 9 else lv - .34) and lv not in seen:
                seen.add(lv); tt = t + timedelta(minutes=30)
                al.append({'product_id': f'K0{lv}A', 'issue_datetime': tt.strftime('%Y-%m-%d %H:%M:%S.000'),
                           'message': f'ALERT: Geomagnetic K-index of {lv} (time machine: reconstructed from GFZ Kp)\r\nThreshold Reached: {tt:%Y %b %d %H%M} UTC\r\nNOAA Scale: G{lv - 4}'})
    put('products/alerts.json', al[::-1])

def enlil():
    """the week's CCMC density frames (already in the replay) recomposed into NOAA's 960×600 layout; the speed row stays dark"""
    L = []; (SW / 'images/animations/enlil').mkdir(parents=True, exist_ok=True)
    def paste(dst, src, sc, sx, sy, dx, dy, r, half=False):
        q = src.crop((int(sx - r / sc), int(sy - r / sc), int(sx + r / sc), int(sy + r / sc))).resize((2 * r, 2 * r), Image.LANCZOS)
        m = Image.new('L', (2 * r, 2 * r), 0); dr = ImageDraw.Draw(m)
        if half: dr.pieslice((0, 0, 2 * r, 2 * r), -62, 62, fill=255)
        else: dr.ellipse((0, 0, 2 * r, 2 * r), fill=255)
        dst.paste(q, (dx - r, dy - r), m)
    for e in D.get('enl') or []:
        t, p = dt(e[0]), e[1]
        src = Image.open(WK / p).convert('RGB'); out = Image.new('RGB', (960, 600), (0, 0, 0))
        paste(out, src, 73 / 97, 240, 312, 202, 184, 125); paste(out, src, 72 / 94, 493, 312, 358, 184, 125, half=True)
        run = dt(e[2]).strftime('%Y-%m-%d %H:%MZ') if len(e) > 2 else '?'
        ImageDraw.Draw(out).text((300, 20), t.strftime('%Y-%m-%d %H:%MZ') + f'   NASA CCMC run {run} (time machine)', fill=(255, 238, 0))
        name = f'enlil_com2_{t:%Y%m%dT%H%M%S}.jpg'; out.save(SW / 'images/animations/enlil' / name, quality=70, optimize=True)
        L.append({'url': '/images/animations/enlil/' + name})
    put('products/animations/enlil.json', L)

def sun():
    F = {('HMIIC' if k == 'HMIIF' else k): [[t, PRE + u] for t, u in L] for k, L in D['sun'].items() if k != 'C2' and L}
    p = OUT / 'sun/frames.json'; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(json.dumps({'updated': NOWMS, 'filters': F}, separators=(',', ':')), encoding='utf-8')
    put('products/animations/lasco-c2.json', [{'url': '/__replay/' + u, 'time_tag': iso(dt(t), 'Z')} for t, u in D['sun'].get('C2') or []])
    q = OUT / 'data/earth.json'; q.parent.mkdir(parents=True, exist_ok=True)
    q.write_text(json.dumps({'updated': NOWMS, 'ongoing': [], 'cosmic': {'station': 'OULU', 'pts': D.get('cr') or []}, 'gvpAsOf': NOW.strftime('%Y-%m-%d')}, separators=(',', ':')), encoding='utf-8')
    (OUT / 'data/cme.json').write_text('{"cmes":[]}', encoding='utf-8')
    L = {('HMIIC' if k == 'HMIIF' else k): PRE + fr[-1][1] for k, fr in D['sun'].items() if fr}
    (OUT / 'na.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#07090C"/><circle cx="256" cy="256" r="150" fill="none" stroke="#2C3542" stroke-width="4" stroke-dasharray="10 10"/>'
        f'<text x="256" y="246" fill="#8E9AAB" font-family="sans-serif" font-size="26" text-anchor="middle">not available</text><text x="256" y="282" fill="#5C6878" font-family="sans-serif" font-size="20" text-anchor="middle">for this week</text></svg>', encoding='utf-8')
    return L

def main():
    wind(); P = kp(); xr = xrays()
    ovation(([v for t, v in P if t <= NOW] or [0])[-1]); scales_alerts(P, xr)
    enlil(); latest = sun()
    files = sorted(str(f.relative_to(SW)).replace('\\', '/') for f in SW.rglob('*') if f.is_file())
    (OUT / 'manifest.json').write_text(json.dumps({'now': NOWMS, 't0': T0, 'swpc': files, 'latest': latest, 'prefix': PRE, 'title': D.get('title', ARGS.id),
                                                   'live': ['json/solar-cycle/']}, separators=(',', ':')), encoding='utf-8')
    ix = WK.parent / 'index.json'   # the archive list: this week can open on the main page
    if ix.exists():
        L = json.loads(ix.read_text(encoding='utf-8'))
        for e in L:
            if e['id'] == ARGS.id: e['tm'] = True
        ix.write_text(json.dumps(L, separators=(',', ':')), encoding='utf-8')
    tot = sum(f.stat().st_size for f in OUT.rglob('*') if f.is_file())
    print('time machine', ARGS.id, f'{tot / 1e6:.1f} MB', len(xr), 'flares')

if __name__ == '__main__': main()
