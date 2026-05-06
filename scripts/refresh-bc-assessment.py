#!/usr/bin/env python3
"""
Refresh Prince George BC Assessment parcel geometries from bcassessment.ca.

The BC Assessment ArcGIS layer exposes Esri polygon rings. Disjoint rings must
be converted to GeoJSON MultiPolygon parts, not holes. This script performs that
conversion, repairs the few remaining invalid shapes, writes the parcel source
GeoJSON, then rebuilds the enriched app dataset.
"""

import argparse
import base64
import json
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.parse
import urllib.request

from shapely import make_valid
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
SOURCE_DIR = os.path.join(SCRIPT_DIR, "bc-assessment-source")
DEFAULT_OUTPUT = os.path.join(SOURCE_DIR, "prince_george_parcels.geojson")
BUILD_SCRIPT = os.path.join(SCRIPT_DIR, "build-bc-assessment.py")

PROPERTY_PAGE = "https://www.bcassessment.ca/Property/Info/{encoded_oid}"
DEFAULT_SEED_OID = "A0000MQUV1"
DEFAULT_WHERE = "JUR='226'"
OUT_FIELDS = ",".join([
    "OBJECTID",
    "AFP_OID",
    "OID_EVBC",
    "AREA_EVBC",
    "JUR",
    "ROLL",
    "UNIT_NUMBER",
    "STREET_NUMBER",
    "STREET_NAME",
    "STREET_TYPE",
    "ADDRESS",
    "SHORT_ADDRESS",
    "DESCRIPTION",
    "TOTAL_ASSESSED",
    "TOTAL_LAND",
    "TOTAL_BUILDING",
    "IS_STRATA",
    "FARM_FLAG",
    "UTILITY_FLAG",
    "MAJ_INDUSTRY_FLAG",
    "MANAGED_FOREST_FLAG",
    "LAST_SALE_DATE",
    "SALE_PRICE",
    "EXTRACT_DATE",
    "SALES_REFRESH_DATE",
])


def fetch_url(url: str, params: dict | None = None) -> bytes:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://www.bcassessment.ca/",
        },
    )
    context = ssl._create_unverified_context()
    with urllib.request.urlopen(request, timeout=60, context=context) as response:
        return response.read()


def fetch_json(url: str, params: dict) -> dict:
    data = json.loads(fetch_url(url, params).decode("utf-8"))
    if "error" in data:
        raise RuntimeError(f"ArcGIS error: {data['error']}")
    return data


def get_arcgis_endpoint(seed_oid: str) -> tuple[str, str]:
    encoded_oid = base64.b64encode(seed_oid.encode("utf-8")).decode("ascii")
    page = fetch_url(PROPERTY_PAGE.format(encoded_oid=encoded_oid)).decode("utf-8")
    token_match = re.search(r"gistoken\s*=\s*'([^']+)'", page)
    mapserver_match = re.search(r"mapserverUrl\s*=\s*'([^']+)'", page)

    if not token_match or not mapserver_match:
        raise RuntimeError("Could not find BC Assessment ArcGIS token and map server URL")

    return mapserver_match.group(1).rstrip("/") + "/0/query", token_match.group(1)


def extract_polygonal(geom):
    if isinstance(geom, (Polygon, MultiPolygon)):
        return geom
    if isinstance(geom, GeometryCollection):
        polygons = []
        for part in geom.geoms:
            polygonal = extract_polygonal(part)
            if isinstance(polygonal, Polygon):
                polygons.append(polygonal)
            elif isinstance(polygonal, MultiPolygon):
                polygons.extend(polygonal.geoms)
        if len(polygons) == 1:
            return polygons[0]
        if polygons:
            return MultiPolygon(polygons)
    return geom


def rings_to_geometry(rings: list) -> tuple[dict, str]:
    shells: list[dict] = []

    for ring in rings:
        ring_polygon = Polygon(ring)
        if ring_polygon.is_empty:
            continue

        point = ring_polygon.representative_point()
        containers = [
            (shell["polygon"].area, idx)
            for idx, shell in enumerate(shells)
            if shell["polygon"].contains(point)
        ]

        if containers:
            _, idx = min(containers)
            shells[idx]["holes"].append(ring)
        else:
            shells.append({"polygon": ring_polygon, "holes": []})

    polygons = [
        Polygon(shell["polygon"].exterior.coords, shell["holes"])
        for shell in shells
    ]
    geom = polygons[0] if len(polygons) == 1 else MultiPolygon(polygons)
    action = "grouped_rings" if len(polygons) > 1 else "unchanged"

    if not geom.is_valid:
        geom = extract_polygonal(make_valid(geom))
        action = "make_valid"

    if geom.is_empty or not isinstance(geom, (Polygon, MultiPolygon)) or not geom.is_valid:
        raise ValueError("Could not convert Esri rings to a valid polygonal geometry")

    return mapping(geom), action


def compact_properties(attributes: dict) -> dict:
    return {
        "oid_evbc": attributes.get("OID_EVBC") or "",
        "address": attributes.get("ADDRESS") or "",
        "roll": attributes.get("ROLL") or "",
        "afp_oid": attributes.get("AFP_OID") or "",
        "jur": attributes.get("JUR") or "",
    }


def fetch_count(query_url: str, token: str, where: str) -> int:
    data = fetch_json(query_url, {
        "f": "json",
        "where": where,
        "returnCountOnly": "true",
        "token": token,
    })
    return int(data["count"])


def fetch_page(query_url: str, token: str, where: str, offset: int, page_size: int) -> list[dict]:
    data = fetch_json(query_url, {
        "f": "json",
        "where": where,
        "returnGeometry": "true",
        "outFields": OUT_FIELDS,
        "outSR": "4326",
        "orderByFields": "OBJECTID",
        "resultOffset": str(offset),
        "resultRecordCount": str(page_size),
        "token": token,
    })
    return data.get("features", [])


def refresh_parcels(args) -> None:
    query_url, token = get_arcgis_endpoint(args.seed_oid)
    total = fetch_count(query_url, token, args.where)
    print(f"BC Assessment query: {query_url}")
    print(f"Where: {args.where}")
    print(f"Expected features: {total}")

    features = []
    grouped = 0
    repaired = 0

    for offset in range(0, total, args.page_size):
        page = fetch_page(query_url, token, args.where, offset, args.page_size)
        if not page:
            break

        for item in page:
            geometry, action = rings_to_geometry(item["geometry"]["rings"])
            if action == "grouped_rings":
                grouped += 1
            elif action == "make_valid":
                repaired += 1
            features.append({
                "type": "Feature",
                "geometry": geometry,
                "properties": compact_properties(item["attributes"]),
            })

        print(f"  Fetched {len(features)}/{total}")
        if args.delay:
            time.sleep(args.delay)

    if len(features) != total:
        raise RuntimeError(f"Fetched {len(features)} features, expected {total}")

    geojson = {
        "type": "FeatureCollection",
        "name": "prince_george_parcels",
        "features": features,
    }

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(geojson, f, separators=(",", ":"))

    print(f"Wrote {args.output}")
    print(f"Geometry fixes while refreshing: grouped rings={grouped}, make_valid={repaired}")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--where", default=DEFAULT_WHERE, help="ArcGIS where clause")
    parser.add_argument("--seed-oid", default=DEFAULT_SEED_OID, help="OID_EVBC used to obtain the ArcGIS token")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Source parcel GeoJSON path")
    parser.add_argument("--page-size", type=int, default=1000, help="ArcGIS page size")
    parser.add_argument("--delay", type=float, default=0.0, help="Delay between page requests")
    parser.add_argument("--skip-build", action="store_true", help="Only refresh source parcels")
    return parser.parse_args()


def main():
    args = parse_args()
    refresh_parcels(args)

    if not args.skip_build:
        print("Rebuilding enriched BC Assessment dataset...")
        subprocess.run([sys.executable, BUILD_SCRIPT], cwd=PROJECT_ROOT, check=True)


if __name__ == "__main__":
    main()
