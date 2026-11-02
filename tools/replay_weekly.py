"""Weekly storm-replay bot (runs on the owner's home server, outbound only; also runs anywhere with Python 3 + Pillow).

Bakes every Monday-to-Sunday week, from FIRST on, that the measured solar wind already covers (NASA OMNI 1-min data come
out ~3-4 weeks late), with the light picture set, into aurora/replay/<id>/ + aurora/replay/index.json of this Pages repo.
At most MAX weeks per run, so a weak machine never works for long; weeks missed earlier are picked up on the next run.
Committing and pushing is left to the caller (the systemd service), so this script never touches git or keys.

  python3 replay_weekly.py --repo <checkout>          bake what is due into <checkout>/<replay dir>
  python3 replay_weekly.py --repo <checkout> --dry    only print what is due
build_replay.py + build_timemachine.py + enlil_digits.json must sit next to this file; code is never run from the checkout (on the server all three
live root-owned in /usr/local/lib/orion-replay/).
"""
import datetime as dt, json, pathlib, subprocess, sys, urllib.request

HERE = pathlib.Path(__file__).resolve().parent
def arg(k, d=None):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
REPO = pathlib.Path(arg('--repo', HERE.parent))
RP = REPO / arg('--dir', 'aurora/replay')   # the aurora-replay repo uses --dir .
FIRST = dt.date(2026, 9, 28)   # first week of the automatic archive (a Monday)
MAX = 2
OMNI = 'https://spdf.gsfc.nasa.gov/pub/data/omni/high_res_omni/monthly_1min/omni_min{:%Y%m}.asc'
MONTHS = 'January February March April May June July August September October November December'.split()


def omni_last_day():
    """the last day with measured solar-wind speed in OMNI 1-min (column 22 = flow speed, 99999.9 = no data)"""
    today = dt.date.today(); best = None
    for k in range(3):
        y, m = today.year, today.month - k
        while m < 1: y, m = y - 1, m + 12
        try:
            with urllib.request.urlopen(urllib.request.Request(OMNI.format(dt.date(y, m, 1)), headers={'User-Agent': 'orion-replay-bot'}), timeout=300) as r:
                for line in r.read().decode().splitlines():
                    f = line.split()
                    if len(f) > 21 and float(f[21]) < 9000:
                        d = dt.date(int(f[0]), 1, 1) + dt.timedelta(days=int(f[1]) - 1)
                        if best is None or d > best: best = d
        except Exception as e:
            print('  no OMNI for', y, m, e)
        if best: return best
    return best


def main():
    dry = '--dry' in sys.argv
    last = omni_last_day()
    if not last: print('OMNI unreachable - nothing to do'); return
    ix = RP / 'index.json'
    have = {e['id'] for e in json.loads(ix.read_text(encoding='utf-8'))} if ix.exists() else set()
    w, done = FIRST, 0
    while w + dt.timedelta(days=6) <= last and done < MAX:
        iy, iw, _ = w.isocalendar(); wid = f'w{iy}_{iw:02d}'   # '_' (not '-': #replay=<id>-<step>)
        if wid not in have:
            title = f'Week of {w.day} {MONTHS[w.month - 1]} {w.year}'
            print('bake', wid, title, '(OMNI until', last, ')')
            if not dry:
                subprocess.run([sys.executable, str(HERE / 'build_replay.py'), '--id', wid, '--start', w.isoformat(), '--days', '7',
                                '--title', title, '--light', '--out', str(RP)], check=True)
                # the same week on the main page (time machine): no downloads, made from data.json
                subprocess.run([sys.executable, str(HERE / 'build_timemachine.py'), '--id', wid, '--dir', str(RP), '--prefix', arg('--prefix', '/aurora-replay/')], check=True)
            done += 1
        w += dt.timedelta(days=7)
    if not done: print('up to date (OMNI until', last, ')')


if __name__ == '__main__':
    main()
