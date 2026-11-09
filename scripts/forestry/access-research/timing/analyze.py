"""Join step brackets with pair_metrics; write brackets_T*.csv and print the tables used in FINDINGS.md.
Usage: analyze.py brackets_T0.10.json
Final class per pair (column `final`):
  fire                 a fire perimeter (BC historical/current fire polygons) crosses the corridor in the step's year or the year before
  too_short            measured road < 100 m (stub beside another road; the 10 m buffer is a few pixels and mixes with that road)
  undatable            no_step / noisy_baseline / open_near_series_start / too_few_scenes
  open_before_series   corridor already cleared in the first usable scenes (>= ~2 years before harvest start)
  dated                a step with a clean baseline -> bracket [last_before, first_after]
"""
import os, sys, json, csv, statistics as st, collections, datetime as dt
B = json.load(open(sys.argv[1]))
PM = {x['oid']: x for x in json.load(open(os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research') + '/pair_metrics.json'))}
D = dt.date.fromisoformat
def q(v, p):
    v = sorted(v); i = (len(v) - 1) * p; lo = int(i); return v[lo] + (v[min(lo + 1, len(v) - 1)] - v[lo]) * (i - lo)
SEASON = {12: 'winter', 1: 'winter', 2: 'winter', 3: 'spring', 4: 'spring', 5: 'spring', 6: 'summer', 7: 'summer', 8: 'summer', 9: 'fall', 10: 'fall', 11: 'fall'}

FIRES = {int(k): v for k, v in json.load(open(os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research') + '/agents/timing/fires.json')).items()}
rows = []
for r in B:
    pm = PM.get(r['oid'], {}); rd, bc = r['road'], r['blockclear']
    cls = r['road_class']
    if r['road_len'] < 100: final = 'too_short'
    elif cls in ('no_step', 'noisy_baseline', 'open_near_series_start', 'too_few_scenes'): final = 'undatable'
    elif cls == 'before_series': final = 'open_before_series'
    else: final = 'dated'
    # wildfire across the road corridor in the step's year or the year before (any year up to the first scene for 'open_before_series') can make the step: exclude
    end_year = int((rd.get('first_after') or r['t1'])[:4])
    lo_year = end_year - 1 if rd.get('first_after') and rd['status'] == 'step' else int(r['t0'][:4])
    burn = sorted({f['year'] for f in FIRES.get(r['oid'], []) if f['overlap_spur80_m2'] > 0 and lo_year <= f['year'] <= end_year})
    if burn and final in ('dated', 'open_before_series'): final = 'fire'
    row = dict(oid=r['oid'], block=r['block'], licence=r['licence'], district=r['district'], client=r['client'], spur_names='; '.join(r['spur_names']),
               harvest_start=r['start'], harvest_end=r['end'], series_from=r['t0'], series_to=r['t1'], mode=r['mode'], measured_road_m=r['road_len'],
               spur_len_m=r['spur_len'], spur_out_m=r['spur_out_len'], host_kind=pm.get('host_kind'), joins_fsr=pm.get('host_kind') == 'fsr',
               n_scenes=r['n_scenes'], n_usable=r['n_usable'], road_status=rd['status'], road_class=cls, final=final,
               last_before=rd.get('last_before'), first_after=rd.get('first_after'), bracket_days=rd.get('bracket_days'),
               before_contrast=rd.get('before_val'), after_contrast=rd.get('after_val'), pre_median=rd.get('pre_median'), pre_p80=rd.get('pre_p80'),
               post_median=rd.get('post_median'), ring_drop=rd.get('ring_drop'), fire_years_on_corridor=' '.join(str(f['year']) for f in FIRES.get(r['oid'], []) if f['overlap_spur80_m2'] > 0), burn_before_step=' '.join(map(str, burn)), flags=' '.join(rd.get('flags', [])),
               lead_first_after_days=r.get('lead_first_after_days'), lead_last_before_days=r.get('lead_last_before_days'),
               block_status=bc['status'], block_last_before=bc.get('last_before'), block_first_after=bc.get('first_after'),
               road_vs_block=r.get('road_vs_block'))
    if final == 'dated' and bc['status'] == 'step':
        bm = D(bc['last_before']) + (D(bc['first_after']) - D(bc['last_before'])) / 2
        row['lead_vs_block_imagery_days'] = (D(rd['first_after']) - bm).days
    else: row['lead_vs_block_imagery_days'] = None
    if bc['status'] == 'step':
        row['block_imagery_minus_record_days'] = (D(bc['first_after']) - D(r['start'])).days
    else: row['block_imagery_minus_record_days'] = None
    rows.append(row)
out = sys.argv[1].replace('.json', '.csv')
with open(out, 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
print('wrote', out, len(rows))

def show(title, counter):
    print(f'\n## {title}'); n = sum(counter.values())
    for k, v in counter.most_common(): print(f'  {k}: {v} ({100 * v / n:.0f}%)')
def dist(name, v):
    if not v: return
    print(f'  {name}: n={len(v)} p10 {q(v,.1):.0f} p25 {q(v,.25):.0f} median {q(v,.5):.0f} p75 {q(v,.75):.0f} p90 {q(v,.9):.0f}')

show('final', collections.Counter(r['final'] for r in rows))
show('road class (all)', collections.Counter(r['road_class'] for r in rows))
show('road class among measured >= 100 m', collections.Counter(r['road_class'] for r in rows if r['final'] != 'too_short'))
dated = [r for r in rows if r['final'] == 'dated']
show('dated: class vs recorded harvest start', collections.Counter(r['road_class'] for r in dated))
print('\n## dated distributions (days)')
dist('first_after - start', [r['lead_first_after_days'] for r in dated])
dist('last_before - start', [r['lead_last_before_days'] for r in dated])
dist('bracket width', [r['bracket_days'] for r in dated])
dist('first_after - block clearing midpoint (imagery)', [r['lead_vs_block_imagery_days'] for r in dated if r['lead_vs_block_imagery_days'] is not None])
bw = [r['bracket_days'] for r in dated]
print('  bracket <=14 d', sum(b <= 14 for b in bw), '<=30', sum(b <= 30 for b in bw), '<=60', sum(b <= 60 for b in bw), '<=120', sum(b <= 120 for b in bw), '>180', sum(b > 180 for b in bw))
print('  bracket width by season of first_after:')
g = collections.defaultdict(list)
for r in dated: g[SEASON[D(r['first_after']).month]].append(r['bracket_days'])
for k, v in g.items(): print(f'    {k}: n={len(v)} median {st.median(v):.0f}')
show('dated: road vs block in imagery', collections.Counter(r['road_vs_block'] for r in dated))
print('\n## block clearing in imagery minus recorded start (all pairs with a block step)')
dist('days', [r['block_imagery_minus_record_days'] for r in rows if r['block_imagery_minus_record_days'] is not None])
v = [r['block_imagery_minus_record_days'] for r in rows if r['block_imagery_minus_record_days'] is not None]
print('  imagery first-cleared scene earlier than record by >60 d:', sum(x < -60 for x in v), 'of', len(v))

show('district (all)', collections.Counter(r['district'] for r in rows))
show('district (dated)', collections.Counter(r['district'] for r in dated))
def split(name, key, pool=dated):
    print(f'\n## first_after - start by {name}')
    g = collections.defaultdict(list)
    for r in pool: g[key(r)].append(r)
    for k, rs in sorted(g.items(), key=lambda kv: str(kv[0])):
        v = [r['lead_first_after_days'] for r in rs]
        ahead = sum(r['road_class'] in ('well_ahead', 'within_6_months', 'ahead_bracket_spans_6m') for r in rs)
        wa = sum(r['road_class'] == 'well_ahead' for r in rs); ah = sum(r['road_class'] == 'at_harvest' for r in rs)
        print(f'  {k}: n={len(v)} median {st.median(v):.0f} p25 {q(v,.25):.0f} p75 {q(v,.75):.0f} | ahead {ahead} (well_ahead {wa}) at_harvest {ah} spans_start {sum(r["road_class"] == "bracket_spans_start" for r in rs)}')
split('district', lambda r: r['district'])
split('client', lambda r: (r['client'] or '')[:28])
split('spur length outside block', lambda r: 'a <300 m' if r['spur_out_m'] < 300 else ('b 300-1000 m' if r['spur_out_m'] < 1000 else 'c >=1000 m'))
split('joins FSR', lambda r: r['joins_fsr'])
split('host kind', lambda r: r['host_kind'])
split('measured part', lambda r: r['mode'].split('+')[0])
split('harvest start season', lambda r: SEASON[D(r['harvest_start']).month])
split('harvest year', lambda r: r['harvest_start'][:4])
print('\n## final class by district')
for k in sorted({r['district'] for r in rows}):
    print(' ', k, dict(collections.Counter(r['final'] for r in rows if r['district'] == k)))
print('\n## open_before_series by joins_fsr / host kind')
print(' ', collections.Counter(r['host_kind'] for r in rows if r['final'] == 'open_before_series'), 'of', collections.Counter(r['host_kind'] for r in rows if r['final'] != 'too_short'))
print('\n## season: month of first_after for roads ahead of harvest (first_after < start - 14 d)')
ah = [r for r in dated if r['lead_first_after_days'] < -14]
print('  first_after month', dict(sorted(collections.Counter(D(r['first_after']).month for r in ah).items())))
print('  last_before month', dict(sorted(collections.Counter(D(r['last_before']).month for r in ah).items())))
print('  harvest start season of those', dict(collections.Counter(SEASON[D(r['harvest_start']).month] for r in ah)))
print('  harvest start season, all dated', dict(collections.Counter(SEASON[D(r['harvest_start']).month] for r in dated)))
print('\n## dated table')
for r in sorted(dated, key=lambda r: r['lead_first_after_days']):
    print(f"  | {r['block']} | {r['district']} | {(r['client'] or '')[:22]} | {r['measured_road_m']} | {r['harvest_start']} | {r['last_before']} | {r['first_after']} | {r['bracket_days']} | {r['lead_first_after_days']} | {r['road_class']} | {r['lead_vs_block_imagery_days']} |")
