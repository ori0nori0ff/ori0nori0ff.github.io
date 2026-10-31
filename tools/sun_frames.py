"""Builds aurora/sun/frames.json for the live aurora page (NASA's archives allow no browser requests, so
GitHub Actions lists them): the last 7 days of frames per filter, thinned like the PowHau app
(SDO every 4th ≈ 40 min, SOHO C3 every 3rd ≈ 36 min, HMI from Stanford JSOC every 3rd ≈ 45 min).
With --clips it also renders the last 48 h of each filter as a small MP4 into clips/ (512 px, ffmpeg)."""
import datetime as dt, json, os, re, subprocess, sys, time, urllib.request

UTC = dt.timezone.utc
NOW = dt.datetime.now(UTC)
HIST = 7 * 86400
UA = {'User-Agent': 'PowHau aurora page (https://ori0nori0ff.github.io/aurora/)'}
SDO_IDS = ['0171', '0193', '0304', '0094', '0131', '1600', 'HMIBC']


def get(url, binary=False):
    err = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=45) as r:
                b = r.read()
                return b if binary else b.decode('latin-1')
        except Exception as e:   # noqa: BLE001 — retry any network error
            err = e; time.sleep(4)
    print('FAIL', url, err, file=sys.stderr)
    return b'' if binary else ''


def thin(found, step):
    """found: {epoch: url}. Keep every step-th, anchored on the newest so 'now' is always in."""
    items = sorted(found.items())[::-1][::step][::-1]
    return [[int(t * 1000), u] for t, u in items]


def days():
    return [NOW - dt.timedelta(days=d) for d in range(8)]


def ts(s, fmt):
    return dt.datetime.strptime(s, fmt).replace(tzinfo=UTC).timestamp()


out = {'updated': int(time.time() * 1000), 'filters': {}}
cut = time.time() - HIST

# SDO / AIA: one listing per day (all 1024 px files), split per filter
sdo = {i: {} for i in SDO_IDS}
for d in days():
    path = d.strftime('%Y/%m/%d')
    html = get(f'https://sdo.gsfc.nasa.gov/assets/img/browse/{path}/?P=*_1024_*.jpg')
    for m in re.finditer(r'(\d{8}_\d{6})_1024_(\w{4,5})\.jpg', html):
        fid = m.group(2)
        if fid in sdo:
            t = ts(m.group(1), '%Y%m%d_%H%M%S')
            if t >= cut:
                sdo[fid][t] = f'https://sdo.gsfc.nasa.gov/assets/img/browse/{path}/{m.group(0)}'
for fid, found in sdo.items():
    out['filters'][fid] = thin(found, 4)

# SOHO LASCO C3 (512 px, ~12 min cadence)
c3 = {}
for d in days():
    base = f'https://soho.nascom.nasa.gov/data/REPROCESSING/Completed/{d:%Y}/c3/{d:%Y%m%d}/'
    for m in re.finditer(r'(\d{8}_\d{4})_c3_512\.jpg', get(base + '?P=*_c3_512.jpg')):
        t = ts(m.group(1), '%Y%m%d_%H%M')
        if t >= cut:
            c3[t] = base + m.group(0)
out['filters']['C3'] = thin(c3, 3)

# HMI (Stanford JSOC): continuum (sunspots) + magnetogram, 15-min stills
hmi = {'HMIIC': {}, 'HMIB': {}}
for d in days():
    base = f'https://jsoc1.stanford.edu/data/hmi/images/{d:%Y/%m/%d}/'
    html = get(base)
    for m in re.finditer(r'(\d{8}_\d{6})_(Ic_flat|M)_512\.jpg', html):
        t = ts(m.group(1), '%Y%m%d_%H%M%S')
        if t >= cut:
            hmi['HMIIC' if m.group(2) == 'Ic_flat' else 'HMIB'][t] = base + m.group(0)
for fid, found in hmi.items():
    out['filters'][fid] = thin(found, 3)

# GONG H-alpha (NSO, six ground telescopes round the world): 650 px colour stills every minute -> every 30 min
ha = {}
for d in days():
    base = f'https://gong2.nso.edu/HA/hac/{d:%Y%m}/{d:%Y%m%d}/'
    for m in re.finditer(r'(\d{14})\wh\.jpg', get(base)):
        t = ts(m.group(1), '%Y%m%d%H%M%S')
        if t >= cut:
            ha[t] = base + m.group(0)
out['filters']['HA'] = thin(ha, 30)

for k, v in out['filters'].items():
    print(f'{k:6s} {len(v):4d} frames', (dt.datetime.fromtimestamp(v[-1][0] / 1000, UTC).strftime('%d.%m %H:%M') if v else '-'))
os.makedirs('aurora/sun', exist_ok=True)
with open('aurora/sun/frames.json', 'w') as f:
    json.dump(out, f, separators=(',', ':'))

if '--clips' in sys.argv:
    os.makedirs('clips', exist_ok=True)
    for fid, frames in out['filters'].items():
        recent = [u for t, u in frames if t >= (time.time() - 48 * 3600) * 1000]
        if len(recent) < 10:
            continue
        work = f'/tmp/f_{fid}'; os.makedirs(work, exist_ok=True)
        n = 0
        for u in recent:
            small = u.replace('_1024_', '_512_')   # SDO has 512 px versions; C3 / HMI lists are already 512
            b = get(small, binary=True)
            if len(b) > 5000:
                open(f'{work}/{n:04d}.jpg', 'wb').write(b); n += 1
        if n < 10:
            continue
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '12', '-i', f'{work}/%04d.jpg',
                        '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
                        '-c:v', 'libx264', '-crf', '25', '-movflags', '+faststart', f'clips/sun-{fid}.mp4'], check=False)
        print('clip', fid, n, 'frames')
