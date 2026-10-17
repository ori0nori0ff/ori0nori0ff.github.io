"""Rolling archive of NOAA WSA-ENLIL frames for the aurora page (NOAA serves only the current run, which starts
~2-3 days back, while the Sun loops cover 5 days). Each hour: every frame of the current run up to now is kept
(one per hour, the newest run wins), plus the model's at-Earth series; anything older than 6 days is dropped.
Written into the folder given as argv[1] (a checkout of the history-free "enlil" branch):
  index.json = {updated, run, frames: [[t_ms, "f/YYYYmmddTHH.jpg", run]], ts: [[t_ms, density, speed, cme 0/1]]}
The page reads it from raw.githubusercontent.com (CORS *) and puts it in front of the current run."""
import datetime as dt, json, os, re, sys, time, urllib.request

API = 'https://services.swpc.noaa.gov'
UA = {'User-Agent': 'PowHau aurora page (https://ori0nori0ff.github.io/aurora/)'}
KEEP = 6 * 86400 * 1000
H = 3600 * 1000


def get(url, binary=False):
    err = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                b = r.read()
                return b if binary else json.loads(b)
        except Exception as e:   # noqa: BLE001 — retry any network error
            err = e; time.sleep(4)
    print('FAIL', url, err, file=sys.stderr)
    return None


def frame_t(u):
    m = re.search(r'(\d{8})T(\d{2})(\d{2})(\d{2})', u)
    return int(dt.datetime.strptime(''.join(m.groups()), '%Y%m%d%H%M%S').replace(tzinfo=dt.timezone.utc).timestamp() * 1000) if m else 0


root = sys.argv[1]
os.makedirs(f'{root}/f', exist_ok=True)
try:
    idx = json.load(open(f'{root}/index.json'))
except Exception:   # noqa: BLE001 — first run / broken file → start fresh
    idx = {'frames': [], 'ts': []}
now = int(time.time() * 1000)
frames = {f[0] // H: f for f in idx.get('frames', [])}   # hour → [t, file, run]

an = get(f'{API}/products/animations/enlil.json') or []
run = (re.search(r'enlil_com2_(\d+)_', an[0]['url']) or [None, None])[1] if an else None
got = 0
for f in an:
    t = frame_t(f['url'])
    if not t or t > now + H:
        continue
    h = t // H
    old = frames.get(h)
    if old and old[2] == run and os.path.exists(f"{root}/{old[1]}"):
        continue
    b = get(API + f['url'], binary=True)
    if not b or len(b) < 5000:
        continue
    name = f"f/{dt.datetime.fromtimestamp(t / 1000, dt.timezone.utc):%Y%m%dT%H}.jpg"
    open(f'{root}/{name}', 'wb').write(b)
    frames[h] = [t, name, run]; got += 1

# at-Earth series: one point per 30 min (CME samples kept), current run replaces older rows from its start on
ts = get(f'{API}/json/enlil_time_series.json') or []
cur, last = [], 0
for r in sorted(ts, key=lambda r: r['time_tag']):
    t = int(dt.datetime.fromisoformat(r['time_tag']).replace(tzinfo=dt.timezone.utc).timestamp() * 1000)
    cme = 1 if r.get('cloud') not in (None, 0, '0') and float(r['cloud']) > 0 else 0
    if t - last >= 30 * 60000 or cme:
        cur.append([t, round(float(r['earth_particles_per_cm3']), 2), round(float(r['v_r'])), cme]); last = t
cur = [p for p in cur if p[0] <= now]
start = cur[0][0] if cur else now
series = [p for p in idx.get('ts', []) if p[0] < start] + cur

keep = now - KEEP
frames = {h: f for h, f in frames.items() if f[0] >= keep}
live = {f[1] for f in frames.values()}
for n in os.listdir(f'{root}/f'):
    if f'f/{n}' not in live:
        os.remove(f'{root}/f/{n}')
out = {'updated': now, 'run': run, 'frames': sorted(frames.values()), 'ts': [p for p in series if p[0] >= keep]}
json.dump(out, open(f'{root}/index.json', 'w'), separators=(',', ':'))
print(f'run {run}: {got} new frames, {len(out["frames"])} kept, {len(out["ts"])} series points')
