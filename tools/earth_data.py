"""Earth data for the aurora page (sources that allow no browser requests, or that need history), run by
.github/workflows/sun.yml every hour. Writes:
  aurora/data/earth.json   = {updated, cosmic: {station, pts: [[t_ms, % vs 7-day mean]]} | null,
                              ongoing: [[name, lat, lon, start 'YYYY-MM-DD', VEI|null]],   (GVP: eruptions with no end date)
                              eruptMonthly: {from: 'YYYY-MM', n: [...]}}                   (GVP: eruption starts per month)
  aurora/data/journal.json = the daily journal, one column per field, day 0 = `from`:
                              {from: 'YYYY-MM-DD', kp: [max Kp], ssn: [sunspot number], q5: [M5+ quakes],
                               dst: [min Dst], v: [max wind km/s], fl: [biggest flare, log10 W/m²]}
     kp (GFZ Potsdam, CC BY 4.0), ssn (SILSO, Royal Observatory of Belgium), q5 (USGS) go back to 2008;
     dst / v / fl only exist from the day this job started (NOAA keeps ~7 days) — the journal grows by itself.
"""
import csv, datetime as dt, io, json, math, os, re, sys, time, urllib.parse, urllib.request

UTC = dt.timezone.utc
NOW = dt.datetime.now(UTC)
TODAY = NOW.date()
START = dt.date(2008, 1, 1)
UA = {'User-Agent': 'PowHau aurora page (https://ori0nori0ff.github.io/aurora/)'}
SWPC = 'https://services.swpc.noaa.gov/'
os.makedirs('aurora/data', exist_ok=True)


def get(url, kind='json', tries=3, timeout=90):
    err = None
    for _ in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                b = r.read().decode('utf-8', 'replace')
                return json.loads(b) if kind == 'json' else b
        except Exception as e:   # noqa: BLE001 — retry any network error
            err = e; time.sleep(3)
    print('FAIL', url[:120], err, file=sys.stderr)
    return None


def day_index(d):
    return (d - START).days


def load(path, default):
    try:
        return json.load(open(path))
    except Exception:   # noqa: BLE001
        return default


# ── the journal ──────────────────────────────────────────────────────────────────────────────────────────
J = load('aurora/data/journal.json', None)
n_days = day_index(TODAY) + 1
FIELDS = ['kp', 'ssn', 'q5', 'dst', 'v', 'fl']
if not J or J.get('from') != START.isoformat():
    J = {'from': START.isoformat(), **{k: [] for k in FIELDS}}
for k in FIELDS:
    J[k] = (J.get(k) or []) + [None] * (n_days - len(J.get(k) or []))
    J[k] = J[k][:n_days]
full = all(x is None for x in J['kp'][:-40])   # first run: back-fill the history

# Kp — GFZ Potsdam (3-hourly), daily max
since = START if full else TODAY - dt.timedelta(days=40)
k = get(f"https://kp.gfz.de/app/json/?start={since.isoformat()}T00:00:00Z&end={TODAY.isoformat()}T23:59:59Z&index=Kp")
if k and k.get('Kp'):
    for t, v in zip(k['datetime'], k['Kp']):
        i = day_index(dt.date.fromisoformat(t[:10]))
        if 0 <= i < n_days and v is not None and v >= 0:
            J['kp'][i] = round(max(J['kp'][i] or 0, v), 2)

# sunspot number — SILSO daily (whole file, small enough)
s = get('https://www.sidc.be/SILSO/INFO/sndtotcsv.php', 'text')
if s:
    for line in s.splitlines():
        p = line.split(';')
        if len(p) < 5:
            continue
        try:
            d = dt.date(int(p[0]), int(p[1]), int(p[2])); v = float(p[4])
        except ValueError:
            continue
        i = day_index(d)
        if 0 <= i < n_days and v >= 0:
            J['ssn'][i] = round(v)

# M5+ earthquakes — USGS, per year on the first run, then the last 40 days
def quakes(a, b):
    t = get('https://earthquake.usgs.gov/fdsnws/event/1/query?' + urllib.parse.urlencode(
        {'format': 'csv', 'starttime': a.isoformat(), 'endtime': (b + dt.timedelta(days=1)).isoformat(), 'minmagnitude': 5, 'orderby': 'time-asc'}), 'text', timeout=180)
    if t is None:
        return False
    cnt = {}
    for r in csv.DictReader(io.StringIO(t)):
        cnt[r['time'][:10]] = cnt.get(r['time'][:10], 0) + 1
    d = a
    while d <= b:
        i = day_index(d)
        if 0 <= i < n_days:
            J['q5'][i] = cnt.get(d.isoformat(), 0)
        d += dt.timedelta(days=1)
    return True

if full:
    for y in range(START.year, TODAY.year + 1):
        quakes(dt.date(y, 1, 1), min(dt.date(y, 12, 31), TODAY))
else:
    quakes(TODAY - dt.timedelta(days=40), TODAY)

# NOAA's last ~7 days: Dst (min), solar wind speed (max), flares (biggest)
dst = get(SWPC + 'products/kyoto-dst.json') or []
for r in dst:
    try:
        i = day_index(dt.date.fromisoformat(r['time_tag'][:10])); v = float(r['dst'])
    except (KeyError, TypeError, ValueError):
        continue
    if 0 <= i < n_days:
        J['dst'][i] = v if J['dst'][i] is None else min(J['dst'][i], v)
pl = get(SWPC + 'products/solar-wind/plasma-7-day.json') or []
for r in pl:
    try:   # rows are lists (header first) or objects, depending on the product version
        tt, sp = (r.get('time_tag'), r.get('speed')) if isinstance(r, dict) else (r[0], r[2])
        i = day_index(dt.date.fromisoformat(str(tt)[:10])); v = float(sp)
    except (TypeError, ValueError, IndexError, AttributeError):
        continue
    if 0 <= i < n_days and v > 0:
        J['v'][i] = round(max(J['v'][i] or 0, v))
fl = get(SWPC + 'json/goes/primary/xray-flares-7-day.json') or []
for f in fl:
    try:
        i = day_index(dt.date.fromisoformat(f['max_time'][:10])); v = math.log10(float(f['max_xrlong']))
    except (KeyError, TypeError, ValueError):
        continue
    if 0 <= i < n_days:
        J['fl'][i] = round(max(J['fl'][i] if J['fl'][i] is not None else -99, v), 2)

json.dump(J, open('aurora/data/journal.json', 'w'), separators=(',', ':'))
print('journal', n_days, 'days; kp', sum(x is not None for x in J['kp']), 'ssn', sum(x is not None for x in J['ssn']), 'q5', sum(x is not None for x in J['q5']))

# ── earth.json ───────────────────────────────────────────────────────────────────────────────────────────
E = load('aurora/data/earth.json', {})
E['updated'] = int(time.time() * 1000)

# volcanoes (Smithsonian GVP): once a day is plenty
if not E.get('ongoing') or NOW.hour == 3 or full or E.get('gvp') != 2:
    E['gvp'] = 2
    W = 'https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Eruptions&outputFormat=application/json&count=5000&sortBy=StartDateYear+D&cql_filter='
    on = get(W + urllib.parse.quote('EndDateYear IS NULL AND StartDateYear>=1990'))
    if on and on.get('features'):
        out = []
        for f in on['features']:
            p, c = f['properties'], f['geometry']['coordinates']
            if p.get('Activity_Type') not in ('Confirmed Eruption', None):
                continue
            st = f"{p['StartDateYear']:04d}-{max(1, p.get('StartDateMonth') or 1):02d}-{max(1, p.get('StartDateDay') or 1):02d}"
            out.append([p['Volcano_Name'], round(c[1], 3), round(c[0], 3), st, p.get('ExplosivityIndexMax')])
        E['ongoing'] = sorted(out, key=lambda r: r[3], reverse=True)
    st = get(W + urllib.parse.quote(f'StartDateYear>={START.year}'))
    if st and st.get('features'):
        n = [0] * ((TODAY.year - START.year) * 12 + TODAY.month)
        for f in st['features']:
            p = f['properties']
            if p.get('Activity_Type') not in ('Confirmed Eruption', None) or not p.get('StartDateMonth'):
                continue
            i = (p['StartDateYear'] - START.year) * 12 + p['StartDateMonth'] - 1
            if 0 <= i < len(n):
                n[i] += 1
        E['eruptMonthly'] = {'from': f'{START.year}-01', 'n': n}

# cosmic rays: Oulu neutron monitor via NMDB (several URL forms; the card hides itself without data)
def cosmic():
    a = TODAY - dt.timedelta(days=7)
    q = dict(formchk=1, tabchoice='revori', dtype='corr_for_efficiency', tresolution=60, force=1, yunits=0, date_choice='bydate',
             start_day=a.day, start_month=a.month, start_year=a.year, start_hour=0, start_min=0,
             end_day=TODAY.day, end_month=TODAY.month, end_year=TODAY.year, end_hour=23, end_min=59, output='ascii')
    for st in ['OULU', 'KERG', 'JUNG1']:
        for extra in [{}, {'tabchoice': 'ori'}, {'tabchoice': '1h'}]:
            qs = urllib.parse.urlencode({**q, **extra}) + f'&stations[]={st}'
            t = get('https://www.nmdb.eu/nest/draw_graph.php?' + qs, 'text', tries=1, timeout=60)
            pts = []
            for line in (t or '').splitlines():
                m = re.match(r'\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2});\s*([-\d.]+)', line)
                if m:
                    v = float(m.group(2))
                    if v > 0:
                        pts.append([int(dt.datetime.fromisoformat(m.group(1)).replace(tzinfo=UTC).timestamp() * 1000), v])
            if len(pts) > 24:
                mean = sum(p[1] for p in pts) / len(pts)
                print('cosmic', st, extra, len(pts))
                return {'station': st, 'pts': [[p[0], round((p[1] / mean - 1) * 100, 2)] for p in pts]}
    print('cosmic: no data', file=sys.stderr)
    return None

# CMEs for the 3D view: NASA DONKI (CCMC) analyses — when each cloud passed 21.5 solar radii, its direction,
# width and speed (the cone model NOAA's ENLIL runs use)
def cmes():
    a, b = TODAY - dt.timedelta(days=12), TODAY + dt.timedelta(days=1)
    r = get(f'https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/CMEAnalysis?startDate={a}&endDate={b}&mostAccurateOnly=true&speed=0&halfAngle=0&catalog=ALL', timeout=90)
    if not isinstance(r, list):
        return None
    out = []
    for c in r:
        try:
            t = int(dt.datetime.fromisoformat(c['time21_5'].replace('Z', '+00:00')).timestamp() * 1000)
            out.append({'t': t, 'lat': float(c.get('latitude') or 0), 'lon': float(c.get('longitude') or 0), 'half': float(c.get('halfAngle') or 30),
                        'v': float(c['speed']), 'type': c.get('type') or '', 'id': c.get('associatedCMEID') or ''})
        except (KeyError, TypeError, ValueError):
            continue
    print('cmes', len(out))
    return sorted(out, key=lambda c: c['t'])

cm = cmes()
if cm is not None:
    json.dump({'updated': int(time.time() * 1000), 'cmes': cm}, open('aurora/data/cme.json', 'w'), separators=(',', ':'))
c = cosmic()
if c or 'cosmic' not in E:
    E['cosmic'] = c
json.dump(E, open('aurora/data/earth.json', 'w'), separators=(',', ':'))
print('earth.json: ongoing', len(E.get('ongoing') or []), 'eruptions; cosmic', bool(E.get('cosmic')))
