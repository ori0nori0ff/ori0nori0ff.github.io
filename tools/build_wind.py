"""Real wind for the web 3D (flight + moving clouds): NOAA GFS (NCEP, public domain) u / v wind, 1° grid, from the NOMADS grib filter
(nomads.ncep.noaa.gov, filter_gfs_1p00.pl). Levels: 10 m above ground + 1000 850 700 500 300 250 200 100 hPa; forecast hours 0-12 every 3 h.
Out: wind.bin.gz = int8 [hour 5][level 9][u, v][lat 181 (90 ... -90)][lon 360 (0 ... 359 E)], value = q * scale (m/s), one scale per
(hour, level, comp) in wind.json {run, hours, levels, hPa, scale}. u = toward east, v = toward north (GFS grid-relative = earth-relative on
a regular lat / lon grid).
NOMADS etiquette: 5 requests per run, 3 s apart, one retry after 60 s; NOMADS blocks clients that exceed its hit-rate limit
(https://nomads.ncep.noaa.gov/info.php, "usage" notes).
The GRIB2 decoder below reads only what GFS sends here (grid template 3.0, data template 5.3 = complex packing + spatial differencing,
no bitmap); anything else stops with an error. Own code, no GRIB library (eccodes / pygrib have no Windows wheels for this Python).
    python tools/build_wind.py [--out DIR] [--run YYYYMMDDHH] [--grib FILE (decode one local file and print its fields; for tests)]"""
import datetime as dt, gzip, json, pathlib, struct, sys, time, urllib.request
import numpy as np

arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
LEV = ['10_m_above_ground', '1000_mb', '850_mb', '700_mb', '500_mb', '300_mb', '250_mb', '200_mb', '100_mb']
HPA = [None, 1000, 850, 700, 500, 300, 250, 200, 100]
HOURS = [0, 3, 6, 9, 12]
NI, NJ = 360, 181

def bits(buf, off, w):
    """big-endian unsigned integers of widths w (<= 32) at bit offsets off, vectorised"""
    b = np.unpackbits(np.frombuffer(buf, np.uint8)); b = np.concatenate([b, np.zeros(33, np.uint8)])
    idx = off[:, None] + np.arange(32)[None, :]; win = b[idx].astype(np.uint64)
    v = (win << np.arange(31, -1, -1, dtype=np.uint64)[None, :]).sum(1)
    return np.where(w > 0, v >> (32 - w).astype(np.uint64), 0).astype(np.int64)

def sm(raw, n):   # sign-magnitude integer of n octets
    v = int.from_bytes(raw[:n], 'big'); s = 1 << (8 * n - 1)
    return -(v - s) if v & s else v

def run_bits(buf, pos, n, w):   # n values of w bits each from bit pos; returns values and the next octet boundary (bits)
    if w == 0: return np.zeros(n, np.int64), pos
    off = pos + np.arange(n, dtype=np.int64) * w
    return bits(buf, off, np.full(n, w)), -(-(pos + n * w) // 8) * 8

def decode(msg):
    """one GRIB2 message -> (discipline, category, parameter, surface type, surface value, 2D array [lat][lon])"""
    p, sec = 16, {}
    while msg[p:p + 4] != b'7777':
        L = struct.unpack('>I', msg[p:p + 4])[0]; sec[msg[p + 4]] = msg[p:p + L]; p += L
    s3, s4, s5, s6, s7 = sec[3], sec[4], sec[5], sec[6], sec[7]
    assert struct.unpack('>H', s3[12:14])[0] == 0, 'grid template is not 3.0'
    ni, nj = struct.unpack('>II', s3[30:38]); la1, lo1 = struct.unpack('>iI', s3[46:54]); scan = s3[71]
    assert (ni, nj, la1, lo1, scan) == (NI, NJ, 90_000_000, 0, 0), (ni, nj, la1, lo1, scan)
    assert s6[5] == 255, 'bitmap present'
    assert struct.unpack('>H', s5[9:11])[0] == 3, 'data template is not 5.3'
    n = struct.unpack('>I', s5[5:9])[0]; R = struct.unpack('>f', s5[11:15])[0]; E = sm(s5[15:17], 2); D = sm(s5[17:19], 2)
    nb = s5[19]; mm = s5[22]; ng = struct.unpack('>I', s5[31:35])[0]; wref = s5[35]; wbits = s5[36]
    lref = struct.unpack('>I', s5[37:41])[0]; linc = s5[41]; llast = struct.unpack('>I', s5[42:46])[0]; lbits = s5[46]
    order = s5[47]; no = s5[48]
    assert mm == 0, 'missing values in the field'
    d = s7[5:]; ex = [sm(d[i * no:(i + 1) * no], no) for i in range(order + 1)]   # first value(s) + minimum of the differences
    pos = (order + 1) * no * 8
    gref, pos = run_bits(d, pos, ng, nb)
    gw, pos = run_bits(d, pos, ng, wbits); gw = gw + wref
    gl, pos = run_bits(d, pos, ng, lbits); gl = lref + gl * linc; gl[-1] = llast
    assert gl.sum() == n, (gl.sum(), n)
    w = np.repeat(gw, gl); off = pos + np.concatenate([[0], np.cumsum(w)[:-1]])
    x = bits(d, off, w) + np.repeat(gref, gl) + ex[-1]
    f = np.empty(n, np.float64)   # undo the spatial differencing (integers, exact)
    if order == 1:
        x[0] = ex[0]; f = np.cumsum(x).astype(np.float64)
    else:
        x[0], x[1] = ex[0], ex[1]; g = np.empty(n, np.int64); g[0], g[1] = ex[0], ex[1]
        h = x.copy(); h[1] = ex[1] - ex[0]   # second differences: g[k] - g[k-1] = cumsum of x[2..] + (g1 - g0)
        dlt = np.cumsum(h[1:]); g[1:] = ex[0] + np.cumsum(dlt); f = g.astype(np.float64)
    y = (R + f * 2.0 ** E) / 10.0 ** D
    return sec[0][6] if 0 in sec else msg[6], s4[9], s4[10], s4[22], struct.unpack('>I', s4[24:28])[0], y.reshape(nj, ni)

def messages(b):
    o = 0
    while o < len(b):
        assert b[o:o + 4] == b'GRIB', 'not GRIB at %d' % o
        L = struct.unpack('>Q', b[o + 8:o + 16])[0]; yield b[o:o + L]; o += L

def get(url):
    for k in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'aurora-wind-bot'}), timeout=120) as r:
                b = r.read()
            if b[:4] == b'GRIB': return b
            raise IOError('not GRIB: ' + b[:80].decode('latin1'))
        except Exception as e:
            if k: raise
            print('  retry in 60 s:', e); time.sleep(60)

def url(run, fh):
    d, h = run.strftime('%Y%m%d'), run.strftime('%H')
    q = '&'.join(['var_UGRD=on', 'var_VGRD=on'] + [f'lev_{l}=on' for l in LEV])
    return f'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl?dir=%2Fgfs.{d}%2F{h}%2Fatmos&file=gfs.t{h}z.pgrb2.1p00.f{fh:03d}&{q}'

def field_key(cat, par, st, sv):   # -> (level index, comp) for UGRD (0,2,2) / VGRD (0,2,3)
    lev = 0 if (st, sv) == (103, 10) else (HPA.index(sv // 100) if st == 100 and sv // 100 in HPA else None)
    return (lev, par - 2) if cat == 2 and par in (2, 3) and lev is not None else None

def build():
    out = pathlib.Path(arg('--out', pathlib.Path(__file__).resolve().parents[1] / 'web/aurora/img/earth')); out.mkdir(parents=True, exist_ok=True)
    if '--run' in sys.argv: runs = [dt.datetime.strptime(arg('--run', ''), '%Y%m%d%H')]
    else:   # newest cycle first; a cycle is complete on NOMADS ~3.5-4 h after its hour
        now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None) - dt.timedelta(hours=4)
        r0 = now.replace(hour=now.hour // 6 * 6, minute=0, second=0, microsecond=0); runs = [r0, r0 - dt.timedelta(hours=6)]
    t0 = time.time()
    for run in runs:
        try:
            A = np.zeros((len(HOURS), len(LEV), 2, NJ, NI), np.float32); seen = 0
            for i, fh in enumerate(HOURS):
                if i: time.sleep(3)
                for m in messages(get(url(run, fh))):
                    _, cat, par, st, sv, y = decode(m); k = field_key(cat, par, st, sv)
                    if k: A[i, k[0], k[1]] = y; seen += 1
            assert seen == len(HOURS) * len(LEV) * 2, f'{seen} fields'
            break
        except Exception as e:
            print('run', run, 'failed:', e)
    else: sys.exit(1)
    sc = np.maximum(np.abs(A).max(axis=(3, 4)), 1e-3) / 127   # [hour][level][comp]
    q = np.clip(np.round(A / sc[..., None, None]), -127, 127).astype(np.int8)
    (out / 'wind.bin.gz').write_bytes(gzip.compress(q.tobytes(), 9, mtime=0))
    (out / 'wind.json').write_text(json.dumps({'run': run.strftime('%Y-%m-%dT%HZ'), 'hours': HOURS, 'levels': LEV, 'hPa': HPA,
        'shape': list(q.shape), 'scale': np.round(sc, 5).tolist()}))
    err = np.abs(q * sc[..., None, None] - A).max()
    print(f'run {run:%Y-%m-%d %HZ}, {time.time() - t0:.0f} s, wind.bin.gz {(out / "wind.bin.gz").stat().st_size / 1e6:.2f} MB, max quantisation error {err:.2f} m/s')

if __name__ == '__main__':
    if '--grib' in sys.argv:
        for m in messages(pathlib.Path(arg('--grib', '')).read_bytes()):
            _, cat, par, st, sv, y = decode(m)
            print(cat, par, st, sv, 'min %.2f max %.2f' % (y.min(), y.max()), 'Brasov(46N,26E) %.2f' % y[90 - 46, 26], 'Tromso(70N,19E) %.2f' % y[90 - 70, 19])
    else: build()
