"""Fetch ICESat-2 (ATL08 segments, ATL03 photons with ATL08 classes) and GEDI L2A/L4A over a box via SlideRule's public cluster.
usage: python -I sliderule-fetch.py <tag> W S E N <outdir>"""
import sys, time, json
from sliderule import sliderule, gedi
tag, W, S, E, N, out = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6]
sliderule.init(verbose=False)
aoi = [{"lon": W, "lat": S}, {"lon": E, "lat": S}, {"lon": E, "lat": N}, {"lon": W, "lat": N}, {"lon": W, "lat": S}]
meta = {}
def go(name, fn):
    t = time.time()
    try:
        df = fn()
        meta[name] = {"rows": len(df), "seconds": round(time.time() - t, 1)}
        if len(df): df.to_parquet(f"{out}/{tag}-{name}.parquet")
    except Exception as e:
        meta[name] = {"error": str(e)}
    print(name, meta[name], flush=True)
go("atl08x", lambda: sliderule.run("atl08x", {"poly": aoi}))
go("atl03x", lambda: sliderule.run("atl03x", {"poly": aoi, "cnf": 0, "srt": -1, "atl08_class": ["atl08_ground", "atl08_canopy", "atl08_top_of_canopy", "atl08_unclassified"]}))
gedi.init()
go("gedi02a", lambda: gedi.gedi02ap({"poly": aoi, "asset": "gedil2a", "degrade_filter": False, "quality_filter": False, "l2_quality_filter": False}))
go("gedi04a", lambda: gedi.gedi04ap({"poly": aoi, "asset": "gedil4a", "degrade_filter": False, "quality_filter": False, "l2_quality_filter": False}))
json.dump(meta, open(f"{out}/{tag}-meta.json", "w"), indent=1)
