"""Reduce SlideRule output to JSON for the TypeScript bench: snow-free ATL03 ground/canopy photons and ATL08 segments,
heights converted from ITRF2014 ellipsoid to EGM2008 orthometric (PROJ grid us_nga_egm08_25 via the PROJ CDN).
usage: python -I sliderule-export.py <tag> <datadir>"""
import sys, json
import numpy as np, pandas as pd, geopandas as gpd, pyproj
from pyproj import Transformer
tag, d = sys.argv[1], sys.argv[2]
pyproj.network.set_network_enabled(True)
tr = Transformer.from_crs("EPSG:4979", "EPSG:4326+3855", always_xy=True)
SNOW_FREE_MONTHS = {6, 7, 8, 9, 10}
out = {"tag": tag, "heights": "EGM2008 orthometric (from ITRF2014 ellipsoid)", "snowFreeMonths": sorted(SNOW_FREE_MONTHS)}
a3 = gpd.read_parquet(f"{d}/{tag}-atl03x.parquet")
t = pd.to_datetime(a3.index)
a3 = a3[t.month.isin(SNOW_FREE_MONTHS) & a3["atl08_class"].isin([1, 2, 3])]
t = pd.to_datetime(a3.index)
lon, lat = a3.geometry.x.values, a3.geometry.y.values
_, _, h = tr.transform(lon, lat, a3["height"].values.astype(float))
out["photonDates"] = sorted({str(x) for x in t.date})
dates = {s: i for i, s in enumerate(out["photonDates"])}
out["photons"] = [[round(float(x), 7), round(float(y), 7), round(float(z), 2), int(c), dates[str(dd)], int(s)]
                  for x, y, z, c, dd, s in zip(lon, lat, h, a3["atl08_class"].values, t.date, a3["spot"].values)]
out["photonFields"] = ["lon", "lat", "h", "atl08Class(1 ground,2 canopy,3 top)", "dateIndex", "spot"]
a8 = gpd.read_parquet(f"{d}/{tag}-atl08x.parquet")
t8 = pd.to_datetime(a8.index)
lon, lat = a8.geometry.x.values, a8.geometry.y.values
_, _, h8 = tr.transform(lon, lat, a8["h_te_median"].values.astype(float))
rows = []
for i in range(len(a8)):
    r = a8.iloc[i]
    m = r["canopy_h_metrics"]
    rows.append({"lon": round(float(lon[i]), 7), "lat": round(float(lat[i]), 7), "date": str(t8[i].date()),
                 "snow": int(r["segment_snowcover"]), "hTe": None if np.isnan(h8[i]) else round(float(h8[i]), 2),
                 "hTeUnc": None if np.isnan(r["h_te_uncertainty"]) else round(float(r["h_te_uncertainty"]), 2),
                 "nTe": int(r["n_te_photons"]), "nCa": int(r["n_ca_photons"]),
                 "hCanopy": None if np.isnan(r["h_canopy"]) else round(float(r["h_canopy"]), 2),
                 "rh50": None if m is None or len(m) < 9 or np.isnan(m[8]) else round(float(m[8]), 2),
                 "cover": int(r["segment_cover"]), "slope": round(float(r["terrain_slope"]), 3), "spot": int(r["spot"]),
                 "solar": round(float(r["solar_elevation"]), 1)})
out["segments"] = rows
json.dump(out, open(f"{d}/{tag}-icesat2.json", "w"))
print(tag, "photons", len(out["photons"]), "segments", len(rows), "dates", out["photonDates"])
