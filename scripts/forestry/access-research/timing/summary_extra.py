"""Extra tallies for FINDINGS.md: lead relative to the block's own clearing in imagery, seasons, and late records."""
import csv, collections, datetime as dt, sys
D = dt.date.fromisoformat
R = list(csv.DictReader(open(sys.argv[1] if len(sys.argv) > 1 else 'brackets_T0.10.csv')))
dated = [r for r in R if r['final'] == 'dated']
def cls_vs(r, ref_lb, ref_fa):
    lb, fa = D(r['last_before']), D(r['first_after'])
    if fa <= ref_lb - dt.timedelta(days=183): return 'a road >6 months before'
    if fa <= ref_lb: return 'b road before, <6 months'
    if lb >= ref_fa: return 'd road after'
    return 'c same bracket'
c = collections.Counter(); widths = []
for r in dated:
    if r['block_status'] == 'step':
        c[cls_vs(r, D(r['block_last_before']), D(r['block_first_after']))] += 1
    else: c['no block step'] += 1
print('road vs block clearing seen in the same imagery:', sorted(c.items()))
# recorded start vs imagery: records where the corridor and block were both still absent in a usable scene > 60 d after the recorded start
late = [r for r in dated if (D(r['last_before']) - D(r['harvest_start'])).days > 60]
print('dated pairs whose corridor was still absent in a usable scene >60 d after recorded start:', len(late), [ (r['block'], r['harvest_start'], r['last_before']) for r in late])
late_b = [r for r in dated if r['block_status'] == 'step' and (D(r['block_last_before']) - D(r['harvest_start'])).days > 60]
print('... and whose block interior was still uncut >60 d after recorded start:', len(late_b))
# ahead-of-harvest roads: season of the bracket, by harvest season
ahead = [r for r in dated if int(r['lead_first_after_days']) < -14]
print('roads ahead (first_after < start-14):', len(ahead))
for r in sorted(ahead, key=lambda r: r['harvest_start']):
    print('  ', r['block'], r['district'], 'harvest', r['harvest_start'], 'bracket', r['last_before'], r['first_after'])
win = [r for r in ahead if D(r['harvest_start']).month in (11, 12, 1, 2, 3)]
print('ahead roads for Nov-Mar harvests:', len(win), 'bracket ends Jun-Nov of the previous year:', sum(D(r['first_after']).month in (6, 7, 8, 9, 10, 11) for r in win))
# share of all dated with corridor visible before recorded start (first_after < start)
print('first_after before start:', sum(int(r['lead_first_after_days']) < 0 for r in dated), 'of', len(dated))
print('last_before >= start - 14 (absent until harvest):', sum(int(r['lead_last_before_days']) >= -14 for r in dated))
print('bracket contains start (last_before < start <= first_after):', sum(int(r['lead_last_before_days']) < 0 <= int(r['lead_first_after_days']) for r in dated))
# ratio ahead by groups
def share(name, key):
    g = collections.defaultdict(list)
    for r in dated: g[key(r)].append(int(r['lead_first_after_days']) < -14)
    print(name, {k: f'{sum(v)}/{len(v)}' for k, v in sorted(g.items())})
share('ahead by district', lambda r: r['district'])
share('ahead by spur outside', lambda r: '<300' if int(r['spur_out_m']) < 300 else ('300-1000' if int(r['spur_out_m']) < 1000 else '>=1000'))
share('ahead by joins_fsr', lambda r: r['joins_fsr'])
share('ahead by host', lambda r: r['host_kind'])
share('ahead by client (n>=6)', lambda r: r['client'][:20] if sum(x['client'] == r['client'] for x in dated) >= 6 else 'other')
share('ahead by harvest season', lambda r: {12: 'winter', 1: 'winter', 2: 'winter', 3: 'spring', 4: 'spring', 5: 'spring', 6: 'summer', 7: 'summer', 8: 'summer'}.get(D(r['harvest_start']).month, 'fall'))
