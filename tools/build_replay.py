"""Bake a storm replay for the web aurora page: real data + pictures of one week (any week since 2016, when NASA's SDO browse
archive starts). The May 2024 G5 storm (Gannon storm) is the first; the archive picker lists every baked week.

    python tools/build_replay.py                                   # the May 2024 storm → web/aurora/replay/may2024/
    python tools/build_replay.py --id oct2024 --start 2024-10-07 --days 7 --title "The G4 storm of October 2024" --famous

Each run writes web/aurora/replay/<id>/ (data.json + img/…) and updates web/aurora/replay/index.json (the archive list:
title, span, daily max Kp, biggest flare, deepest SYM-H).
Sources (all public): OMNI 1-min (NASA SPDF: solar wind at the bow shock + SYM-H, AE), GFZ Kp (OMNI2 as fallback), GOES XRS 1-min
(LASP LISIRD: GOES-16, -18 or -15, whichever covers the week), NMDB Oulu neutron monitor, SDO AIA / HMI browse pictures, SOHO
LASCO C2 / C3, NASA CCMC WSA-ENLIL runs (the newest run before each moment = what forecasters had then).
Run once per week; the page only reads the baked files (NASA sends no CORS headers for the pictures).
"""
import argparse, io, json, math, pathlib, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
RP = ROOT / 'web/aurora/replay'
A = argparse.ArgumentParser()
A.add_argument('--id', default='may2024'); A.add_argument('--start', default='2024-05-08'); A.add_argument('--days', type=int, default=7)
A.add_argument('--title', default='The G5 storm of May 2024'); A.add_argument('--famous', action='store_true')
A.add_argument('--index-only', action='store_true', help='only add the already baked week to index.json')
A.add_argument('--light', action='store_true', help='weekly bot: fewer, smaller pictures (≈ 3–5 MB a week)')
A.add_argument('--out', help='replay folder to write to (default web/aurora/replay; the bot gives its Pages checkout)')
ARGS = A.parse_args()
RP = pathlib.Path(ARGS.out) if ARGS.out else RP
LX = 3 if ARGS.light else 1   # --light: every 3rd picture slot
OUT = RP / ARGS.id; IMG = OUT / 'img'
T0 = datetime.fromisoformat(ARGS.start).replace(tzinfo=timezone.utc); T1 = T0 + timedelta(days=ARGS.days)
STEP = 5  # minutes
UA = {'User-Agent': 'OrionSpaceObserver-replay/1.0 (+https://ori0nori0ff.github.io/aurora/)'}

def get(u, t=120):
    for k in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=t) as r: return r.read()
        except Exception as e:
            if k == 3: raise
            print('  retry', u, e)
ms = lambda d: int(d.timestamp() * 1000)
N = int((T1 - T0).total_seconds() // 60 // STEP)
def bins(): return [[] for _ in range(N)]
def bi(d): return int((d - T0).total_seconds() // 60 // STEP)
def months():
    m, out = T0.replace(day=1, hour=0), []
    while m < T1: out.append(m); m = (m + timedelta(days=32)).replace(day=1)
    return out

def omni():
    print('OMNI 1-min'); b = {k: bins() for k in ('bt', 'bz', 'v', 'n', 'sym', 'ae')}
    for m in months():
        for line in get(f'https://spdf.gsfc.nasa.gov/pub/data/omni/high_res_omni/monthly_1min/omni_min{m:%Y%m}.asc', 300).decode().splitlines():
            c = line.split()
            if len(c) < 45: continue
            d = datetime(int(c[0]), 1, 1, tzinfo=timezone.utc) + timedelta(days=int(c[1]) - 1, hours=int(c[2]), minutes=int(c[3]))
            if not T0 <= d < T1: continue
            i = bi(d)
            for k, col, bad in (('bt', 13, 9999), ('bz', 18, 9999), ('v', 21, 99999), ('n', 25, 999), ('sym', 41, 99999), ('ae', 37, 99999)):
                x = float(c[col])
                if abs(x) < bad: b[k][i].append(x)
    r = {}
    for k, L in b.items():
        # Bz keeps its most southward minute (what drives the storm), SYM-H its lowest, the rest the mean
        r[k] = [None if not v else round(min(v) if k in ('bz', 'sym') else sum(v) / len(v), 1) for v in L]
    return r

def xray():
    e0 = datetime(2000, 1, 1, 12, tzinfo=timezone.utc)
    # before 2020 the flares were classed from GOES-15 with NOAA's old 0.7 scaling (X9.3 of 6 Sep 2017 = 13.3e-4 in LISIRD's
    # rescaled data): use GOES-15 × 0.7 then, so the classes match the names the flares are known by
    old = T0 < datetime(2020, 1, 1, tzinfo=timezone.utc)
    for ds in (('noaa_goes15_xrs_1m', 'noaa_goes16_xrs_1m') if old else ('noaa_goes16_xrs_1m', 'noaa_goes18_xrs_1m', 'noaa_goes15_xrs_1m')):   # whichever spacecraft covers the week
        k7 = .7 if old and '15' in ds else 1
        print('XRS', ds, k7); L = bins(); S = bins()
        q = f'https://lasp.colorado.edu/lisird/latis/dap/{ds}.csv?time>={T0:%Y-%m-%dT%H:%M}&time<{T1:%Y-%m-%dT%H:%M}'
        for line in get(q, 300).decode().splitlines()[1:]:
            c = line.split(',')
            try: d = e0 + timedelta(seconds=float(c[0])); v = float(c[2]); w = float(c[1])
            except Exception: continue
            if not T0 <= d < T1: continue
            if v > 0 and (len(c) < 5 or c[4] in ('0', '0.0')): L[bi(d)].append(v * k7)
            if w > 0 and (len(c) < 4 or c[3] in ('0', '0.0')): S[bi(d)].append(w * k7)
        if sum(1 for v in L if v) > N * .6: break
    f = lambda B: [float(f'{max(v):.3g}') if v else None for v in B]
    return f(L), f(S)   # long 0.1–0.8 nm (sets the class), short 0.05–0.4 nm

def kp():
    print('GFZ Kp')
    try: j = json.loads(get(f'https://kp.gfz.de/app/json/?start={T0:%Y-%m-%dT%H:%M:%SZ}&end={T1 - timedelta(seconds=1):%Y-%m-%dT%H:%M:%SZ}&index=Kp'))
    except Exception as e:   # GFZ unreachable: the same Kp from NASA's hourly OMNI2 (Kp×10 in thirds: 87 = 9− = 8.67)
        print('  GFZ failed, Kp from OMNI2', e); out = []
        for y in sorted({T0.year, (T1 - timedelta(seconds=1)).year}):
            for line in get(f'https://spdf.gsfc.nasa.gov/pub/data/omni/low_res_omni/omni2_{y}.dat', 300).decode().splitlines():
                c = line.split(); d = datetime(int(c[0]), 1, 1, tzinfo=timezone.utc) + timedelta(days=int(c[1]) - 1, hours=int(c[2]))
                if T0 <= d < T1 and d.hour % 3 == 0 and int(c[38]) < 99:
                    v = int(c[38]); out.append([ms(d), round(v // 10 + {3: 1 / 3, 7: 2 / 3}.get(v % 10, 0), 2)])
        return out
    return [[ms(datetime.fromisoformat(t.replace('Z', '+00:00'))), round(v, 2)] for t, v in zip(j['datetime'], j['Kp'])]

def cosmic():
    print('NMDB Oulu')
    u = ('https://www.nmdb.eu/nest/draw_graph.php?formchk=1&stations[]=OULU&tabchoice=revori&dtype=corr_for_efficiency&tresolution=60&force=1&yunits=0'
         f'&date_choice=bydate&start_day={T0.day}&start_month={T0.month}&start_year={T0.year}&start_hour=0&start_min=0'
         f'&end_day={T1.day}&end_month={T1.month}&end_year={T1.year}&end_hour=0&end_min=0&output=ascii')
    P = []
    try: txt = get(u).decode()
    except Exception as e:   # NMDB is sometimes unreachable: keep the series baked last time
        print('  NMDB failed, keeping the old cosmic rays', e)
        try: return json.loads((OUT / 'data.json').read_text(encoding='utf-8')).get('cr', [])
        except Exception: return []
    for line in txt.splitlines():
        m = re.match(r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d);\s*([\d.]+)', line)
        if m: P.append([ms(datetime.fromisoformat(m.group(1)).replace(tzinfo=timezone.utc)), float(m.group(2))])
    base = [v for t, v in P if t < ms(T0 + timedelta(days=2 if ARGS.id == 'may2024' else 1))] or [v for t, v in P]   # the first day(s), before the storm = the reference
    if not base: return []
    base = sum(base) / len(base)
    return [[t, round((v / base - 1) * 100, 2)] for t, v in P]

def listing(u, pat):
    try: return re.findall(pat, get(u).decode())
    except Exception as e: print('  no listing', u, e); return []

def pick(files, parse, every):
    """files → {slot time: url} nearest file to every slot (minutes)"""
    have = sorted((parse(f), f) for f in files)
    out = {}; t = T0
    while t < T1:
        best = min(have, key=lambda x: abs((x[0] - t).total_seconds()), default=None)
        if best and abs((best[0] - t).total_seconds()) < every * 30: out[t] = best[1]
        t += timedelta(minutes=every)
    return out

def sun_sets():
    S = {}
    days = [T0 + timedelta(days=k) for k in range((T1 - T0).days)]
    for fid, every in (('0131', 30 * LX), ('0193', 120 * LX), ('HMIIF', 180 * LX)):
        files = []
        for d in days:
            base = f'https://sdo.gsfc.nasa.gov/assets/img/browse/{d:%Y/%m/%d}/'
            files += [base + f for f in set(listing(base + f'?P=*_1024_{fid}.jpg', rf'href="(\d{{8}}_\d{{6}}_1024_{fid}\.jpg)"'))]
        S[fid] = pick(files, lambda u: datetime.strptime(u.rsplit('/', 1)[1][:15], '%Y%m%d_%H%M%S').replace(tzinfo=timezone.utc), every)
    for cam in ('c2', 'c3'):
        files = []
        for d in days:
            base = f'https://soho.nascom.nasa.gov/data/REPROCESSING/Completed/{d:%Y}/{cam}/{d:%Y%m%d}/'
            files += [base + f for f in set(listing(base, rf'href="(\d{{8}}_\d{{4}}_{cam}_512\.jpg)"'))]
        S[cam.upper()] = pick(files, lambda u: datetime.strptime(u.rsplit('/', 1)[1][:13], '%Y%m%d_%H%M').replace(tzinfo=timezone.utc), 60 * LX)
    return S

def save_img(job):
    fid, t, u = job; p = IMG / fid / f'{t:%m%d_%H%M}.jpg'
    if p.exists(): return fid, t, True
    try:
        im = Image.open(io.BytesIO(get(u))).convert('RGB')
        px = 384 if ARGS.light else 512
        if im.width > px: im = im.resize((px, px), Image.LANCZOS)
        p.parent.mkdir(parents=True, exist_ok=True); im.save(p, quality=60 if ARGS.light else 68, optimize=True, progressive=True); return fid, t, True
    except Exception as e:
        print('  skip', u, e); return fid, t, False

# ── WSA-ENLIL: CCMC's runs, 41 frames every 6 h; each run's first frame date is printed on the picture (it is the run's day,
#    the day before or the day after), read here with digit shapes taken from known runs (tools/enlil_digits.json)
DIG = [(k, [int(c) for c in v]) for k, v in json.load(open(pathlib.Path(__file__).resolve().parent / 'enlil_digits.json'))]
def enl_start(im, run):
    g = im.convert('L').crop((0, 0, 240, 30)); px = g.load()
    ink = [x for x in range(240) if any(px[x, y] < 128 for y in range(30))]
    runs, s, p = [], ink[0], ink[0]
    for x in ink[1:]:
        if x > p + 1: runs.append((s, p)); s = x
        p = x
    runs.append((s, p)); txt = ''
    for i, (a, b) in enumerate(runs[:10]):
        if i in (4, 7): txt += '-'; continue
        c = g.crop((a, 0, b + 1, 30)).point(lambda v: 255 if v < 128 else 0); c = c.crop(c.getbbox())
        v = [1 if q > 100 else 0 for q in c.resize((8, 12), Image.BILINEAR).getdata()]
        k, t = min(DIG, key=lambda q: sum(x != y for x, y in zip(v, q[1])))
        txt += k if sum(x != y for x, y in zip(v, t)) <= 10 else '8'   # 8 = the one digit no known run has shown yet
    day = run.replace(hour=0, minute=0, second=0)
    try:
        d = datetime.fromisoformat(txt).replace(tzinfo=timezone.utc)
        if abs((d - day).days) <= 3: return d   # a run starts up to a few days before it was made
        if d.year != day.year: print('  ENLIL run', run, 'is labelled', txt, '- skipped'); return None   # a stray test run
    except ValueError: pass
    print('  ENLIL date unread', txt, 'for run', run); return day

def enlil():
    print('ENLIL'); B = 'https://iswa.gsfc.nasa.gov/iswa_data_tree/model/heliosphere/wsa-enlil-cone/animation-cme-density/'
    if ARGS.id == 'may2024':   # hand-picked: the run of 9 May 20:27 (the CMEs of 8–9 May), then 11 May 06:00 (adds the X5.8 CME)
        runs = [datetime(2024, 5, 9, 20, 27, tzinfo=timezone.utc), datetime(2024, 5, 11, 6, tzinfo=timezone.utc)]
    else:   # the last run of each day from 2 days before the week to its end
        names = []
        for m in sorted({(T0 - timedelta(days=2)).replace(day=1, hour=0), *months()}):
            names += listing(f'{B}{m:%Y/%m}/', r'href="(\d{8}_\d{6})_2\.0_anim\.tim-den\.gif"')
        allr = sorted({datetime.strptime(n, '%Y%m%d_%H%M%S').replace(tzinfo=timezone.utc) for n in names})
        per = {}
        for r in allr:
            if T0 - timedelta(days=2) <= r < T1: per[r.date()] = r
        runs = sorted(per.values())
    if not runs: return [], []
    gifs = {}
    for r in runs:
        try: im = Image.open(io.BytesIO(get(f'{B}{r:%Y/%m}/{r:%Y%m%d_%H%M%S}_2.0_anim.tim-den.gif', 300))); im.seek(0)
        except Exception as e: print('  no run', r, e); continue
        s0 = enl_start(im, r)
        if s0: gifs[r] = (im, s0)
    out, used = [], []; (IMG / 'ENL').mkdir(parents=True, exist_ok=True)
    t = T0
    while t <= T1:   # each 6-hour frame from the newest run already made at that time (else the first run we have)
        have = [r for r in gifs if r <= t] or sorted(gifs)[:1]
        if have:
            r = max(have); im, s0 = gifs[r]; k = round((t - s0).total_seconds() / 21600)
            if 0 <= k < im.n_frames:
                im.seek(k); p = f'img/ENL/{t:%m%d_%H%M}.jpg'; im.convert('RGB').save(OUT / p, quality=58 if ARGS.light else 80, optimize=True)
                out.append([ms(t), p, ms(r)])
                if ms(r) not in used: used.append(ms(r))
        t += timedelta(hours=6)
    return out, used

def summary(D):
    """the archive card: daily max Kp, biggest flare, deepest SYM-H"""
    t0 = D.get('t0') or ms(T0); t1 = D.get('t1') or ms(T1); nd = round((t1 - t0) / 864e5)   # --index-only: the week's own span from data.json
    days = [max([v for t, v in D['kp'] if t0 + k * 864e5 <= t < t0 + (k + 1) * 864e5] or [0]) for k in range(nd)]
    xr = max([v for v in D['xr'] if v] or [0]); sym = min([v for v in D['sym'] if v is not None] or [0])
    return {'id': ARGS.id, 'title': D.get('title') or ARGS.title, 't0': t0, 't1': t1, 'kp': [round(v, 2) for v in days], 'xr': xr, 'sym': sym,
            'famous': ARGS.famous or ARGS.id == 'may2024', 'mb': round(sum(f.stat().st_size for f in OUT.rglob('*') if f.is_file()) / 1e6, 1)}

def index(D):
    ix = RP / 'index.json'
    L = [e for e in (json.loads(ix.read_text(encoding='utf-8')) if ix.exists() else []) if e['id'] != ARGS.id] + [summary(D)]
    ix.write_text(json.dumps(sorted(L, key=lambda e: -e['t0']), separators=(',', ':')), encoding='utf-8')

def main():
    if ARGS.index_only: index(json.loads((OUT / 'data.json').read_text(encoding='utf-8'))); print('index updated'); return
    OUT.mkdir(parents=True, exist_ok=True)
    D = {'id': ARGS.id, 'title': ARGS.title, 't0': ms(T0), 't1': ms(T1), 'step': STEP * 60000, **omni(), **dict(zip(('xr', 'xs'), xray())), 'kp': kp(), 'cr': cosmic()}
    S = sun_sets(); jobs = [(fid, t, u) for fid, m in S.items() for t, u in m.items()]
    print('pictures', {k: len(v) for k, v in S.items()})
    with ThreadPoolExecutor(8) as ex: ok = list(ex.map(save_img, jobs))
    D['sun'] = {fid: [[ms(t), f'img/{fid}/{t:%m%d_%H%M}.jpg'] for f2, t, good in ok if f2 == fid and good] for fid in S}
    for k in D['sun']: D['sun'][k].sort()
    D['enl'], D['enlRuns'] = enlil()
    (OUT / 'data.json').write_text(json.dumps(D, separators=(',', ':')), encoding='utf-8')
    index(D)
    print('done', OUT, f"{summary(D)['mb']} MB")

if __name__ == '__main__': main()
