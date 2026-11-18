"""Summarise GEDI L2A/L4A shots from SlideRule: usage: python -I gedi-summary.py <tag> <datadir>"""
import sys, json, os
import numpy as np, pandas as pd, geopandas as gpd
tag, d = sys.argv[1], sys.argv[2]
out = {"tag": tag}
for name in ["gedi02a", "gedi04a"]:
    p = f"{d}/{tag}-{name}.parquet"
    if not os.path.exists(p):
        out[name] = {"shots": 0}; continue
    g = gpd.read_parquet(p)
    t = pd.to_datetime(g.index)
    elev = g["elevation_lm"] if "elevation_lm" in g else g["elevation"]
    plausible = (elev > -500) & (elev < 5000)
    q = {"shots": int(len(g)), "dates": sorted({str(x) for x in t.date}), "orbits": sorted({int(x) for x in g["orbit"]}),
         "plausibleElevation": int(plausible.sum()), "solarElevationMedian": round(float(g["solar_elevation"].median()), 1),
         "flags": {str(k): int(v) for k, v in g["flags"].value_counts().items()},
         "latRange": [round(float(g.geometry.y.min()), 4), round(float(g.geometry.y.max()), 4)]}
    if "agbd" in g: q["agbdValid"] = int((g["agbd"] >= 0).sum())
    if "sensitivity" in g: q["sensitivityOver0.9"] = int((g["sensitivity"] > 0.9).sum())
    out[name] = q
json.dump(out, open(f"{d}/{tag}-gedi.json", "w"), indent=1)
print(json.dumps(out, indent=1))
