"""Where the spacecraft that feed the page really are: positions from NASA/JPL Horizons → aurora/data/craft.json.

Run daily by the Pages bot (sun.yml; skips when the file is < 20 h old), or by hand for a local test:
    python tools/craft_pos.py [out.json]          (default: web/aurora/data/craft.json, git-ignored, not published)
Python standard library only. J2000 ecliptic vectors, km. 'E' = from the Earth's centre (L1 craft, SDO), 'S' = from the Sun.
Window: 30 days back → 30 days ahead, cut where Horizons' predicted trajectory ends. SDO (geosynchronous) only for ±3 days
at 30 min: the page repeats it every sidereal day (the same inertial spot). GOES-19 sits at 75.2° W, computed by the page.
"""
import json, os, pathlib, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

# name: (Horizons id, centre, step minutes, days back, days ahead)
CRAFT = {'SOHO': ('-21', 'E', 360, 30, 30), 'ACE': ('-92', 'E', 360, 30, 30), 'DSCOVR': ('-78', 'E', 360, 30, 30),
         'Wind': ('-8', 'E', 360, 30, 30), 'SWFO-L1': ('-231', 'E', 360, 30, 30), 'SDO': ('-136395', 'E', 30, 3, 3),
         'STEREO-A': ('-234', 'S', 360, 30, 30), 'Parker Solar Probe': ('-96', 'S', 60, 30, 30), 'Solar Orbiter': ('-144', 'S', 360, 30, 30)}
API = 'https://ssd.jpl.nasa.gov/api/horizons.api?'
FMT = '%Y-%m-%d %H:%M'


def ask(cid, cen, a, b, step):
    q = {'format': 'json', 'COMMAND': f"'{cid}'", 'EPHEM_TYPE': 'VECTORS', 'CENTER': "'500@399'" if cen == 'E' else "'500@10'",
         'START_TIME': f"'{a.strftime(FMT)}'", 'STOP_TIME': f"'{b.strftime(FMT)}'", 'STEP_SIZE': f"'{step}m'", 'VEC_TABLE': '1',
         'REF_PLANE': 'ECLIPTIC', 'REF_SYSTEM': 'ICRF', 'OUT_UNITS': 'KM-S', 'CSV_FORMAT': 'YES', 'OBJ_DATA': 'NO', 'TIME_TYPE': 'UT'}
    req = urllib.request.Request(API + urllib.parse.urlencode(q), headers={'User-Agent': 'aurora page bot'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def fetch(cid, cen, step, back, ahead):
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    a, b = now - timedelta(days=back), now + timedelta(days=ahead)
    for _ in range(4):
        j = ask(cid, cen, a, b, step)
        if 'result' in j and '$$SOE' in j['result']: break
        m = re.search(r'(?:after|prior to) A\.D\. (\d{4})-(\w{3})-(\d\d) (\d\d):(\d\d)', j.get('error', '') + j.get('result', ''))
        if not m: raise RuntimeError(j.get('error', 'no data')[:200])
        edge = datetime.strptime(f'{m[1]}-{m[2]}-{m[3]} {m[4]}:{m[5]}', '%Y-%b-%d %H:%M').replace(tzinfo=timezone.utc)
        if 'after' in m[0]: b = edge - timedelta(minutes=step)
        else: a = edge + timedelta(minutes=step)
    else: raise RuntimeError('no window')
    rows = j['result'].split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()
    t0, P = None, []
    for r in rows:
        c = [x.strip() for x in r.split(',')]
        if t0 is None: t0 = round((float(c[0]) - 2440587.5) * 864e5)   # JD (UT) → ms
        P += [round(float(c[2])), round(float(c[3])), round(float(c[4]))]
    return {'c': cen, 'id': cid, 't0': t0, 's': step, 'p': P}


def main():
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parent.parent / 'web/aurora/data/craft.json')
    try:   # the bot runs hourly: once a day is enough (the time inside the file, a checkout resets file times)
        last = datetime.strptime(json.loads(out.read_text(encoding='utf-8'))['t'], '%Y-%m-%dT%H:%MZ').replace(tzinfo=timezone.utc)
        if os.environ.get('CI') and datetime.now(timezone.utc) - last < timedelta(hours=20): print('craft.json is fresh'); return
    except (OSError, ValueError, KeyError): pass
    res = {}
    for nm, (cid, cen, step, back, ahead) in CRAFT.items():
        try: res[nm] = fetch(cid, cen, step, back, ahead); print(f'  {nm:20s} {len(res[nm]["p"]) // 3} points')
        except Exception as e: print(f'  {nm:20s} skipped: {e}')
        time.sleep(1)
    if not res: sys.exit('nothing fetched')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({'src': 'NASA/JPL Horizons', 't': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), 'craft': res}, separators=(',', ':')), encoding='utf-8')


if __name__ == '__main__':
    main()
