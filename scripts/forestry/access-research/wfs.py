import json, sys, urllib.parse, urllib.request, re
W = "https://openmaps.gov.bc.ca/geo/pub/wfs"
def _get(params):
    url = W + "?" + urllib.parse.urlencode({"service": "WFS", "version": "2.0.0", "request": "GetFeature", **params})
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "PGMaps research"}), timeout=120) as r:
        return r.read().decode()
def hits(type_name, cql=None):
    p = {"typeNames": type_name, "resultType": "hits"}
    if cql: p["CQL_FILTER"] = cql
    m = re.search(r'numberMatched="(\d+)"', _get(p))
    return int(m.group(1)) if m else None
def features(type_name, cql=None, props=None, count=None, srs="EPSG:4326"):
    p = {"typeNames": type_name, "outputFormat": "application/json", "srsName": srs}
    if cql: p["CQL_FILTER"] = cql
    if props: p["propertyName"] = ",".join(props)
    if count: p["count"] = str(count)
    return json.loads(_get(p))["features"]

def all_features(type_name, cql=None, props=None, page=10000, sort="OBJECTID", srs="EPSG:4326"):
    out, start = [], 0
    while True:
        p = {"typeNames": type_name, "outputFormat": "application/json", "srsName": srs, "count": str(page), "startIndex": str(start), "sortBy": sort}
        if cql: p["CQL_FILTER"] = cql
        if props: p["propertyName"] = ",".join(props)
        batch = json.loads(_get(p))["features"]
        out += batch; start += len(batch)
        if len(batch) < page: return out
