"""Earth data for the aurora page (sources that allow no browser requests, or that need history), run by
.github/workflows/sun.yml every hour. Writes:
  aurora/data/earth.json   = {updated, cosmic: {station, pts: [[t_ms, % vs 7-day mean]]} | null,
                              ongoing: [[name, lat, lon, start 'YYYY-MM-DD', VEI|null]],   (GVP: eruptions with no end date)
                              eruptMonthly: {from: 'YYYY-MM', n: [...]},                   (GVP: eruption starts per month, up to its last update)
                              active: [[name, country, lat, lon, last 'YYYY-MM-DDTHH:MMZ', source, level|null]]}   (ash advisories + US alerts, 14 days)
  aurora/data/journal.json = the daily journal, one column per field, day 0 = `from`:
                              {from: 'YYYY-MM-DD', kp: [max Kp], ssn: [sunspot number], q5: [M5+ quakes],
                               dst: [min Dst], v: [max wind km/s], fl: [biggest flare, log10 W/m²]}
     kp (GFZ Potsdam, CC BY 4.0), ssn (SILSO, Royal Observatory of Belgium), q5 (USGS) go back to 2008;
     dst / v / fl only exist from the day this job started (NOAA keeps ~7 days) — the journal grows by itself.
"""
import csv, datetime as dt, io, json, math, os, re, subprocess, sys, time, urllib.parse, urllib.request

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
# SILSO's daily file is final only up to the end of last month: the days after it come from NOAA SWPC's daily count (provisional, a little higher)
s = get('https://services.swpc.noaa.gov/json/solar-cycle/swpc_observed_ssn.json')
if s:
    for r in s:
        try:
            i = day_index(dt.date.fromisoformat(r['Obsdate'][:10])); v = float(r['swpc_ssn'])
        except (KeyError, TypeError, ValueError):
            continue
        if 0 <= i < n_days and v >= 0 and J['ssn'][i] is None:
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
pl = get(SWPC + 'json/rtsw/rtsw_wind_1m.json', timeout=180) or []
for r in pl:
    try:
        if not r.get('active'):
            continue
        i = day_index(dt.date.fromisoformat(r['time_tag'][:10])); v = float(r['proton_speed'])
    except (KeyError, TypeError, ValueError, AttributeError):
        continue
    if 0 <= i < n_days and 150 < v < 3000:
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
if not E.get('ongoing') or NOW.hour == 3 or full or E.get('gvp') != 4:
    E['gvp'] = 4
    W = 'https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Eruptions&outputFormat=application/json&count=5000&sortBy=StartDateYear+D&cql_filter='
    on = get(W + urllib.parse.quote(f'StartDateYear>={TODAY.year - 30}'))
    if on and on.get('features'):
        def ymd(p, k):
            y = p.get(k + 'Year')
            return dt.date(y, max(1, p.get(k + 'Month') or 1), max(1, min(28, p.get(k + 'Day') or 1))) if y else None
        rows = [(f, ymd(f['properties'], 'StartDate'), ymd(f['properties'], 'EndDate')) for f in on['features'] if f['properties'].get('Activity_Type') == 'Confirmed Eruption']
        asof = max((e for _, _, e in rows if e and e <= TODAY), default=TODAY)
        E['gvpAsOf'] = asof.isoformat()
        out, seen = [], set()
        for f, st_, en in sorted(rows, key=lambda r: r[1] or dt.date(1900, 1, 1), reverse=True):
            p, c = f['properties'], f['geometry']['coordinates']
            if (en is None or (asof - en).days <= 45) and p['Volcano_Name'] not in seen:
                seen.add(p['Volcano_Name'])
                out.append([p['Volcano_Name'], round(c[1], 3), round(c[0], 3), (st_ or asof).isoformat(), p.get('ExplosivityIndexMax')])
        E['ongoing'] = out
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
        asof = dt.date.fromisoformat(E.get('gvpAsOf') or TODAY.isoformat())   # GVP is updated a few times a year: months after its last update are unknown, not 0
        E['eruptMonthly'] = {'from': f'{START.year}-01', 'n': n[:(asof.year - START.year) * 12 + asof.month]}

# volcanoes active NOW (every hour; GVP's eruption list above is only updated a few times a year):
# volcanic-ash advisories of VAAC Tokyo (≈ 7 weeks listed) + VAAC Washington (last 24 h) + US alert levels (USGS HANS).
# Kept in E['active'] = [[name, country, lat, lon, last seen 'YYYY-MM-DDTHH:MMZ', source, level]], 14 days.
def active_volcanoes():
    norm = lambda s: re.sub(r'[^A-Z]', '', s.upper())
    seen = {}   # key -> [name, source, iso, level]
    def add(name, src, when, lvl=None):
        k = norm(name)
        if k and (k not in seen or seen[k][2] < when):
            seen[k] = [name, src, when, lvl]
    h = get('https://www.data.jma.go.jp/vaac/data/vaac_list.html', 'text') or ''
    for when, name in re.findall(r'DISPLAY: none">(\d{4}/\d\d/\d\d \d\d:\d\d):\d\d</td>\s*<td>[^<]*</td>\s*<td>([^<]+)</td>', h):
        add(name.strip(), 'VAAC Tokyo', when.replace('/', '-').replace(' ', 'T') + 'Z')
    h = get('https://www.ospo.noaa.gov/products/atmosphere/vaac/messages.html', 'text') or ''
    for name in set(re.findall(r'href="volcanoes/[^"]+\.html">([^<]+)</a>', h)):
        add(name.strip(), 'VAAC Washington', NOW.strftime('%Y-%m-%dT%H:%MZ'))
    for v in get('https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes') or []:
        if v.get('color_code') in ('ORANGE', 'RED') or v.get('alert_level') in ('WATCH', 'WARNING'):
            add(v['volcano_name'], 'USGS', v['sent_utc'].replace(' ', 'T')[:16] + 'Z', f"{v['color_code']} · {v['alert_level']}")
    old = {norm(r[0]): r for r in E.get('active') or []}
    coord = E.setdefault('vcoord', {})   # VAAC name -> [GVP name, country, lat, lon] (or None when not found)
    need = [k for k in seen if k not in coord]
    if need:
        g = get('https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json&propertyName=Volcano_Name,Country,GeoLocation', timeout=120)
        gvp = {}
        for ft in (g or {}).get('features', []):
            p, c = ft['properties'], ft['geometry']['coordinates']
            gvp.setdefault(norm(p['Volcano_Name']), [p['Volcano_Name'], p.get('Country') or '', round(c[1], 3), round(c[0], 3)])
        if gvp:
            for k in need:
                name = seen[k][0]; words = re.sub(r'\(.*?\)', ' ', name).split()
                cands = [norm(m) for m in re.findall(r'\((.*?)\)', name)] + [norm(' '.join(words[:i])) for i in range(len(words), 0, -1)]
                cands += [c2.replace('CALDERA', '') for c2 in cands]
                coord[k] = next((gvp[c2] for c2 in cands if c2 in gvp), None)
    rows = dict(old)
    for k, (name, src, when, lvl) in seen.items():
        g = coord.get(k)
        if g:
            rows[k] = [g[0], g[1], g[2], g[3], when, src, lvl]
    cut = (NOW - dt.timedelta(days=14)).strftime('%Y-%m-%dT%H:%MZ')
    return sorted((r for r in rows.values() if r[4] >= cut), key=lambda r: r[4], reverse=True)

try:
    E['active'] = active_volcanoes(); E['activeAt'] = int(time.time() * 1000)
except Exception as e:   # noqa: BLE001 — keep the last list
    print('active volcanoes failed', e, file=sys.stderr)

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
def donki_get(kind, q):
    """One DONKI list (CCMC first, then api.nasa.gov); None when both fail (DONKI is often down for days)."""
    for u in [f'https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/{kind}?{q}',
              f'https://api.nasa.gov/DONKI/{kind}?{q}&api_key=' + os.environ.get('NASA_KEY', 'DEMO_KEY')]:
        r = get(u, timeout=90, tries=2)
        if not isinstance(r, list):   # CCMC answers only over IPv4 from some runners
            try:
                r = json.loads(subprocess.run(['curl', '-4', '-s', '-m', '90', '-A', UA['User-Agent'], u], capture_output=True, text=True, timeout=100).stdout or 'null')
            except Exception:   # noqa: BLE001
                r = None
        if isinstance(r, list):
            return r
        print('donki: no list from', u.split('?')[0], file=sys.stderr)
    return None


def cmes():
    a, b = TODAY - dt.timedelta(days=12), TODAY + dt.timedelta(days=1)
    r = donki_get('CMEAnalysis', f'startDate={a}&endDate={b}&mostAccurateOnly=true&speed=0&halfAngle=0&catalog=ALL')
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

# The DONKI event log (flares, CMEs, particle storms, shocks at L1 / Earth, geomagnetic storms, fast streams), linked into
# chains by DONKI's own `linkedEvents`. aurora/data/donki.json = {updated, ev: {id: [kind, t_ms, info, [linked ids]]}}, 60 days,
# merged with the last file so a DONKI outage keeps what we had.
def ms(s):
    try:
        return int(dt.datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp() * 1000)
    except (TypeError, ValueError):
        return None

def donki_log():
    old = load('aurora/data/donki.json', {}).get('ev', {})
    a, b = TODAY - dt.timedelta(days=30), TODAY + dt.timedelta(days=1)
    q, ev, got = f'startDate={a}&endDate={b}', {}, 0
    def add(i, kind, t, info, links):
        if i and t:
            ev[i] = [kind, t, info, [l.get('activityID') for l in (links or []) if l.get('activityID')]]
    for kind in ['FLR', 'CME', 'SEP', 'IPS', 'GST', 'HSS']:
        r = donki_get(kind, q)
        if r is None:
            continue
        got += 1
        for e in r:
            L = e.get('linkedEvents')
            if kind == 'FLR':
                add(e.get('flrID'), 'FLR', ms(e.get('peakTime') or e.get('beginTime')), {'c': e.get('classType'), 'loc': e.get('sourceLocation'), 'ar': e.get('activeRegionNum')}, L)
            elif kind == 'CME':
                an = next((x for x in (e.get('cmeAnalyses') or []) if x.get('isMostAccurate')), None) or ((e.get('cmeAnalyses') or [None])[0] or {})
                hit = any((im.get('location') or '') == 'Earth' for x in (e.get('cmeAnalyses') or []) for en in (x.get('enlilList') or []) for im in (en.get('impactList') or []) if im) \
                    or any((en.get('isEarthGB') or en.get('isEarthMinorImpact')) for x in (e.get('cmeAnalyses') or []) for en in (x.get('enlilList') or []))
                add(e.get('activityID'), 'CME', ms(e.get('startTime')), {'loc': e.get('sourceLocation'), 'ar': e.get('activeRegionNum'), 'v': an.get('speed'), 'half': an.get('halfAngle'), 'earth': bool(hit)}, L)
            elif kind == 'SEP':
                add(e.get('sepID'), 'SEP', ms(e.get('eventTime')), {}, L)
            elif kind == 'IPS':
                add(e.get('activityID'), 'IPS', ms(e.get('eventTime')), {'at': e.get('location')}, L)
            elif kind == 'GST':
                kp = max([float(k.get('kpIndex') or 0) for k in (e.get('allKpIndex') or [])] or [0])
                add(e.get('gstID'), 'GST', ms(e.get('startTime')), {'kp': kp}, L)
            elif kind == 'HSS':
                add(e.get('hssID'), 'HSS', ms(e.get('eventTime')), {}, L)
    if not got:
        print('donki log: DONKI down, keeping', len(old), 'events', file=sys.stderr)
        return
    cut = (time.time() - 60 * 86400) * 1000
    old.update(ev)
    keep = {i: v for i, v in old.items() if v[1] >= cut}
    json.dump({'updated': int(time.time() * 1000), 'ev': keep}, open('aurora/data/donki.json', 'w'), separators=(',', ':'))
    print('donki log', len(keep), 'events,', got, 'of 6 lists')

try:
    donki_log()
except Exception as e:   # noqa: BLE001 — never stop the rest of the job
    print('donki log failed', e, file=sys.stderr)

cm = cmes()
if cm is not None:
    json.dump({'updated': int(time.time() * 1000), 'cmes': cm}, open('aurora/data/cme.json', 'w'), separators=(',', ':'))
c = cosmic()
if c or 'cosmic' not in E:
    E['cosmic'] = c
json.dump(E, open('aurora/data/earth.json', 'w'), separators=(',', ':'))
print('earth.json: ongoing', len(E.get('ongoing') or []), 'eruptions; cosmic', bool(E.get('cosmic')))
