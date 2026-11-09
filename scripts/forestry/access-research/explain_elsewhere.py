"""Count the reasons a built access leg joined somewhere other than the nearest road point (keyed by block OBJECTID).

Separate smaller network: the nearest road's network is not the joined road's, is smaller within the 3 km
window, and does not leave the window.
"""
import os, sys, json, io, contextlib, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get('ACCESS_RESEARCH_CACHE', '/tmp/pgmaps-access-research')
buf = io.StringIO()
with contextlib.redirect_stdout(buf): exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'haul_direction.py')).read())
closer = {r['oid'] for r in rows if r['joined_point'] < r['nearest_point'] - 100}
measurable = {r['oid'] for r in rows}
NC = json.load(open(os.path.join(CACHE, 'network_choice.json')))
def smaller_separate(r):
    return not r['same_network'] and r['nearest']['component_km'] < r['joined']['component_km'] and not r['nearest']['open_ended']
reasons = {}
for r in NC:
    why = []
    if (r['alt_grade'] or 0) > 12: why.append('steep straight alternative (>12%)')
    if smaller_separate(r): why.append('nearest road is a smaller, separate network')
    if r['nearest']['retired']: why.append('nearest road retired')
    if r['same_network'] and r['oid'] in closer: why.append('joined closer to the FSR (shorter haul)')
    reasons[r['oid']] = why
n = len(reasons); ex = sum(1 for w in reasons.values() if w)
print(f'joined elsewhere: {n} | explained {ex} | unexplained {n - ex}')
print(dict(collections.Counter(x for w in reasons.values() for x in w)))
print(f'shorter haul: {len(closer & set(reasons))} of {len(measurable & set(reasons))} measurable same-network cases')
json.dump({str(k): v for k, v in reasons.items()}, open(os.path.join(CACHE, 'elsewhere_reasons.json'), 'w'), indent=1)
