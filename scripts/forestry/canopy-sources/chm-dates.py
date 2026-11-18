"""BC subset of Meta CHM v2's per-tile imagery dates (acq_dates.parquet on Source Cooperative).
usage: python -I chm-dates.py <acq_dates.parquet> src/lib/forestry/canopy/metaChmDates.bc.generated.json
then: npx prettier --write src/lib/forestry/canopy/metaChmDates.bc.generated.json"""
import sys, json, math
import pandas as pd
src, out = sys.argv[1], sys.argv[2]
W, S, E, N = -139.1, 48.2, -114.0, 60.0  # BC's box
def tile(lon, lat, z=10):
    s = math.sin(math.radians(lat)); n = 2 ** z
    return int((lon + 180) / 360 * n), int((0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n)
def xy(q):
    x = y = 0
    for ch in q:
        d = int(ch); x = x * 2 + (d & 1); y = y * 2 + (d >> 1)
    return x, y
x0, y0 = tile(W, N); x1, y1 = tile(E, S)
d = pd.read_parquet(src)
rows = {}
for q, a, b, n in zip(d.quadkey, d.acq_start, d.acq_end, d.acq_n):
    x, y = xy(q)
    # A tile with no dated imagery (n = 0, dates NaN) is left out: the reader reports it as unlisted.
    if x0 <= x <= x1 and y0 <= y <= y1 and isinstance(a, str) and isinstance(b, str):
        rows[q] = [a, b, int(n)]
json.dump({"source": "https://data.source.coop/tge-labs/meta-chm-v2/acq_dates.parquet", "box": [W, S, E, N],
           "fields": ["acquiredFrom", "acquiredTo", "images"], "tiles": dict(sorted(rows.items()))},
          open(out, "w"), separators=(",", ":"))
print(len(rows), "tiles")
