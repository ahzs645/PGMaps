"""Step detection on the per-pair NDVI series written by fetch_series.py.

Corridor contrast c = NDVI(ring 40-80 m) - NDVI(road 10 m buffer). Block contrast k = NDVI(40-150 m outside block) - NDVI(block interior).
Scenes dropped first: any geometry >10% SCL snow, or road-buffer median red > 3000 (snow or haze SCL called clear).
Step rule (threshold T): the first scene i with c >= T whose next usable scene also has c >= T, where the median of scenes i..i+7
  stays >= T, and the median of the first 4 May-October scenes from i on is >= T (winter snow in open young stands reads like a corridor).
  first_after = date of scene i; last_before = the usable scene before i (its c < T by construction).
  If the first two usable scenes are already >= T: 'cleared_before_series'. If no such pair: 'no_step'.
Usage: detect.py [T] [series_dir] -> prints JSON summary path
"""
import sys, json, glob, os, datetime as dt
T = float(sys.argv[1]) if len(sys.argv) > 1 else 0.10
SNOW = 0.25
HAZE = [(0, 0)]   # per pair: (ring, oring) NDVI cut-offs marking a hazy scene; used only for the May-Oct confirmation
def hazy(r):
    return (r.get('ring') is not None and r['ring'] < HAZE[0][0]) and (r.get('oring') is None or r['oring'] < HAZE[0][1])
SD = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'series')
D = lambda s: dt.date.fromisoformat(s)

def usable(r):
    if any((r.get(k + '_snow') or 0) > SNOW for k in ('road', 'ring')): return False
    if (r.get('road_red') or 0) > 3000: return False
    return True

def step(rows, a, b, T, alt=None):
    s = [(r['date'], r[a] - r[b], r) for r in rows if r.get(a) is not None and r.get(b) is not None]
    if len(s) < 4: return {'status': 'too_few_scenes', 'n': len(s)}
    med = lambda v: sorted(v)[len(v) // 2]
    for i in range(len(s) - 1):
        if not (s[i][1] >= T and s[i + 1][1] >= T): continue
        # persistence: the median of this and the next 7 usable scenes stays >= T
        # (for an in-block road, a scene also counts as cleared when the block itself reads cleared)
        nxt = s[i:i + 8]
        vals = [v if v >= T or alt is None or not alt(r) else T for _, v, r in nxt]
        if len(nxt) >= 3 and med(vals) < T: continue
        # summer confirmation: the first 4 snow-free-season (May-Oct) scenes from i on must also have median >= T
        summer = [(v if v >= T or alt is None or not alt(r) else T) for dd, v, r in s[i:] if 5 <= int(dd[5:7]) <= 10 and not hazy(r)][:4]
        if summer and med(summer) < T: continue
        if not summer: continue
        if i == 0: return {'status': 'cleared_before_series', 'first_after': s[0][0], 'n': len(s), 'pre_n': 0}
        pre = [v for _, v, _ in s[:i]]
        post = [v for _, v, _ in s[i:i + 8]]
        p80 = sorted(pre)[int(0.8 * (len(pre) - 1))]
        flags = []
        if i < 4 or (D(s[i - 1][0]) - D(s[0][0])).days < 90: flags.append('short_baseline')
        if (p80 >= T or med(pre) > T / 2) and med(post) - med(pre) < 0.15: flags.append('noisy_baseline')
        mu = sum(pre) / len(pre); sd = (sum((v - mu) ** 2 for v in pre) / len(pre)) ** 0.5
        return {'status': 'step', 'flags': flags, 'pre_sd': round(sd, 3), 'pre_p80': round(p80, 3),
                'last_before': s[i - 1][0], 'first_after': s[i][0], 'before_val': round(s[i - 1][1], 3), 'after_val': round(s[i][1], 3),
                'pre_median': round(med(pre), 3), 'pre_max': round(max(pre), 3), 'post_median': round(med(post), 3),
                'n': len(s), 'pre_n': i, 'bracket_days': (D(s[i][0]) - D(s[i - 1][0])).days}
    vals = [v for _, v, _ in s]
    return {'status': 'no_step', 'n': len(s), 'max': round(max(vals), 3), 'median': round(med(vals), 3)}

def classify(res, start):
    if res['status'] == 'cleared_before_series': return 'before_series'
    if res['status'] != 'step': return res['status']
    if 'short_baseline' in res['flags']: return 'open_near_series_start'
    if 'noisy_baseline' in res['flags']: return 'noisy_baseline'
    lb, fa = D(res['last_before']), D(res['first_after'])
    if fa <= start - dt.timedelta(days=183): return 'well_ahead'          # visible >6 months before harvest start
    if lb >= start - dt.timedelta(days=14): return 'at_harvest'    # still absent 2 weeks before start
    if fa <= start + dt.timedelta(days=14) and lb >= start - dt.timedelta(days=183): return 'within_6_months'
    if fa <= start + dt.timedelta(days=14): return 'ahead_bracket_spans_6m'
    return 'bracket_spans_start'

out = []
for f in sorted(glob.glob(os.path.join(SD, '*.json'))):
    if 'test' in os.path.basename(f): continue
    d = json.load(open(f)); m = d['meta']; rows = [r for r in d['rows'] if usable(r)]
    # haze/smoke/thin cloud: SCL calls it clear but every NDVI is depressed, which shrinks the contrast. In the May-Oct confirmation,
    # skip scenes whose ring NDVI is below 0.7 x the pair's 75th-percentile ring NDVI.
    # A scene is hazy only if BOTH the road ring and the block's outside ring are depressed (harvest or a new road lowers only one).
    def p75(k):
        v = sorted(r[k] for r in rows if r.get(k) is not None)
        return v[int(0.75 * (len(v) - 1))] if v else 0
    HAZE[0] = (0.7 * p75('ring'), 0.7 * p75('oring'))
    start = D(m['start'])
    blk_cleared = lambda r: r.get('oring') is not None and r.get('blk') is not None and r['oring'] - r['blk'] >= T
    road = step(rows, 'ring', 'road', T, alt=blk_cleared if m['mode'].startswith('inside') else None)
    if road['status'] == 'step':
        # disturbance check: corridor clearing leaves the ring's NDVI alone; fire or a neighbour's harvest drops it.
        sm = lambda r: 6 <= int(r['date'][5:7]) <= 9 and r.get('ring') is not None
        pre_r = [r['ring'] for r in rows if sm(r) and r['date'] < road['last_before']]
        post_r = [r['ring'] for r in rows if sm(r) and r['date'] >= road['first_after']][:8]
        if pre_r and post_r:
            drop = sorted(pre_r)[len(pre_r) // 2] - sorted(post_r)[len(post_r) // 2]
            road['ring_drop'] = round(drop, 3)
            # informational only: it also fires when a neighbour block is cut at the same time, and missed a burn
            pass
    blk = step(rows, 'oring', 'blk', T)
    rec = dict(m); rec.pop('areas', None)
    rec.update(n_scenes=len(d['rows']), n_usable=len(rows), road=road, blockclear=blk, road_class=classify(road, start))
    if road['status'] == 'step':
        rec['lead_first_after_days'] = (D(road['first_after']) - start).days
        rec['lead_last_before_days'] = (D(road['last_before']) - start).days
    if road['status'] == 'step' and blk['status'] == 'step':
        # imagery-only order: road before block if road's first scene after <= block's last scene before
        rf, rl = D(road['first_after']), D(road['last_before']); bf, bl = D(blk['first_after']), D(blk['last_before'])
        rec['road_vs_block'] = 'road_first' if rf <= bl else ('block_first' if bf <= rl else 'same_bracket')
    out.append(rec)
p = os.path.join(os.path.dirname(SD), f'brackets_T{T:.2f}.json')
json.dump(out, open(p, 'w'), indent=1)
print(p, len(out))
