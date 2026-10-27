"""Today's real clouds for the web 3D: NOAA GMGSI (Global Mosaic of Geostationary Satellite Imagery, long-wave IR, hourly, all
geostationary satellites incl. Meteosat, ±72.7°, public on AWS noaa-gmgsi-pds) → web/aurora/img/earth/clouds_now.jpg (4096×2048 grey,
equirectangular like clouds.jpg) + clouds_now.json {t}.
IR sees cold, not clouds: cold ground (Siberia, Tibet, winter land) looks white too. So each pixel's clear-sky background = its warmest
value over the last ~2 days (16 files, 3 h apart); a cloud = how much colder than that it is now, plus very cold tops always.
No data (fill, over the poles, the seam gaps) → the NASA cloud composite clouds.jpg, blended softly.
    python tools/build_clouds.py [--out DIR] [--base clouds.jpg]   (needs h5py; the Pages repo bot runs it every 3 h → branch "clouds")"""
import datetime as dt, io, json, pathlib, re, sys, urllib.request
import numpy as np, h5py
from PIL import Image, ImageFilter

arg = lambda k, d: pathlib.Path(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
OUT = arg('--out', pathlib.Path(__file__).resolve().parents[1] / 'web/aurora/img/earth'); OUT.mkdir(parents=True, exist_ok=True)
BASE = arg('--base', OUT / 'clouds.jpg')
B = 'https://noaa-gmgsi-pds.s3.amazonaws.com/'
def get(u, t=120):
    for k in range(4):
        try:
            with urllib.request.urlopen(u, timeout=t) as r: return r.read()
        except Exception as e:
            if k == 3: raise
def keys(day):
    x = get(f'{B}?list-type=2&prefix=GMGSI_LW/{day:%Y/%m/%d}/').decode()
    return re.findall(r'<Key>([^<]+\.nc)</Key>', x)

def frames(days=10):
    """the newest file + the same UTC hour on each of the days before (ground warms by day and cools by night: compare like with like)"""
    now = dt.datetime.now(dt.timezone.utc); ks = sorted(keys(now - dt.timedelta(days=1)) + keys(now)); k0 = ks[-1]
    hh = re.search(r'_s\d{8}(\d{2})', k0).group(1); out = [k0]
    for i in range(1, days + 1):
        same = [k for k in keys(now - dt.timedelta(days=i)) if re.search(r'_s\d{8}' + hh, k) and k != k0]
        if same: out.append(same[0])
    for k in reversed(out):
        with h5py.File(io.BytesIO(get(B + k)), 'r') as f:
            d = f['data'][0].astype(np.float32); d[(f['dqf'][0] != 0) | (d < 0)] = np.nan   # dqf ≠ 0 = no data
            yield k, d

def build():
    stack = []
    for k, d in frames():
        stack.append(d); print(' ', re.search(r'_s(\d{10})', k).group(1))
    S = np.stack(stack); now = S[-1]
    bg = np.nanpercentile(S, 10, axis=0)            # the warmest (clear) look of each place at this hour
    c = np.clip((now - bg - 8) / 75, 0, 1)          # colder than the clear background → cloud, thin ones stay grey
    c = np.maximum(c, np.clip((now - 185) / 60, 0, 1))   # very cold tops are always cloud
    ok = np.isfinite(now) & np.isfinite(bg); c[~ok] = 0
    ok = ok & (np.abs(np.linspace(72.7, -72.7, now.shape[0]))[:, None] < 69)   # fade out before the edge of the mosaic
    H, W = now.shape                                # 3000 × 4999, lat 72.7 … -72.7, lon -180 … 180
    big = Image.fromarray((c * 255).astype(np.uint8)).resize((4096, int(4096 * H / W)), Image.LANCZOS)
    okm = Image.fromarray((ok * 255).astype(np.uint8)).resize(big.size, Image.BILINEAR).filter(ImageFilter.GaussianBlur(14))
    base = Image.open(BASE).convert('L')     # 4096 × 2048, lat 90 … -90
    y0 = round((90 - 72.72) / 180 * 2048); band = Image.new('L', (4096, 2048), 0); band.paste(big, (0, y0))
    m = Image.new('L', (4096, 2048), 0); m.paste(okm, (0, y0)); m = m.filter(ImageFilter.GaussianBlur(24))
    out = Image.composite(band, base, m)
    out.save(OUT / 'clouds_now.jpg', quality=85, optimize=True)
    t = re.search(r'_s(\d{12})', k).group(1)
    (OUT / 'clouds_now.json').write_text(json.dumps({'t': f'{t[:4]}-{t[4:6]}-{t[6:8]}T{t[8:10]}:{t[10:12]}Z'}))
    print('clouds_now.jpg', f'{(OUT / "clouds_now.jpg").stat().st_size / 1e6:.1f} MB', t)

if __name__ == '__main__': build()
