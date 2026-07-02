#!/usr/bin/env python3
import argparse
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


ACCESS_TOKEN = "pk.eyJ1IjoicGhheWVzIiwiYSI6InNHMlkzQUkifQ.C9wmsbr-8tAtViMNb1wEcA"
APP_JS_URL = "http://www.bcforestmap.com/js/app.775f4591.js"

TILESETS = {
    "vri_forest_data": "phayes.vri",
    "planned_logging_results_openings": "phayes.7k5f6zdt",
    "planned_logging_fta_cutblocks_next_5_years": "phayes.ften_cut_block_n5y",
    "species_at_risk_habitat": "phayes.species_at_risk",
    "inaturalist_species_at_risk": "phayes.inaturalist_species_at_risk",
}


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_bytes(url):
    req = urllib.request.Request(url, headers={"User-Agent": "PGMaps research downloader"})
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.read()


def lon_to_tile_x(lon, zoom):
    return int(math.floor((lon + 180.0) / 360.0 * (1 << zoom)))


def lat_to_tile_y(lat, zoom):
    lat_rad = math.radians(lat)
    return int(
        math.floor(
            (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * (1 << zoom)
        )
    )


def clamp(value, low, high):
    return max(low, min(high, value))


def tile_ranges(bounds, minzoom, maxzoom):
    west, south, east, north = bounds
    for zoom in range(minzoom, maxzoom + 1):
        limit = (1 << zoom) - 1
        x_min = clamp(lon_to_tile_x(west, zoom), 0, limit)
        x_max = clamp(lon_to_tile_x(east, zoom), 0, limit)
        y_min = clamp(lat_to_tile_y(north, zoom), 0, limit)
        y_max = clamp(lat_to_tile_y(south, zoom), 0, limit)
        for x in range(min(x_min, x_max), max(x_min, x_max) + 1):
            for y in range(min(y_min, y_max), max(y_min, y_max) + 1):
                yield zoom, x, y


def tile_url(tilejson, z, x, y):
    template = tilejson["tiles"][0]
    return template.format(z=z, x=x, y=y)


def download_tile(tilejson, tile_dir, tile):
    z, x, y = tile
    out = tile_dir / str(z) / str(x) / f"{y}.pbf"
    if out.exists() and out.stat().st_size > 0:
        return "exists", out.stat().st_size
    url = tile_url(tilejson, z, x, y)
    tmp = out.with_suffix(".pbf.tmp")
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = fetch_bytes(url)
    except urllib.error.HTTPError as exc:
        if exc.code in (204, 404, 410):
            return "empty", 0
        return f"http_{exc.code}", 0
    except Exception:
        return "error", 0
    if not data:
        return "empty", 0
    tmp.write_bytes(data)
    tmp.replace(out)
    return "downloaded", len(data)


def download_tileset(name, tileset_id, dest, workers):
    tileset_dir = dest / name
    tiles_dir = tileset_dir / "tiles"
    tileset_dir.mkdir(parents=True, exist_ok=True)
    url = f"https://api.mapbox.com/v4/{tileset_id}.json?secure&access_token={ACCESS_TOKEN}"
    tilejson = fetch_json(url)
    (tileset_dir / "tilejson.json").write_text(json.dumps(tilejson, indent=2), encoding="utf-8")

    tiles = list(tile_ranges(tilejson["bounds"], int(tilejson["minzoom"]), int(tilejson["maxzoom"])))
    status_counts = {}
    error_tiles = []
    total_bytes = 0
    started = time.time()
    print(f"{name}: {len(tiles):,} candidate tiles, expected tileset filesize {tilejson.get('filesize'):,} bytes")

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(download_tile, tilejson, tiles_dir, tile) for tile in tiles]
        for idx, future in enumerate(as_completed(futures), 1):
            status, size = future.result()
            status_counts[status] = status_counts.get(status, 0) + 1
            total_bytes += size
            if status.startswith("error") or status.startswith("http_"):
                # Find the tile from the original future for resumable diagnostics.
                # This is O(n) only for rare error cases.
                for original_tile, original_future in zip(tiles, futures):
                    if original_future is future:
                        error_tiles.append({"z": original_tile[0], "x": original_tile[1], "y": original_tile[2], "status": status})
                        break
            if idx % 500 == 0 or idx == len(futures):
                elapsed = max(1, time.time() - started)
                print(
                    f"{name}: {idx:,}/{len(futures):,} tiles, "
                    f"{total_bytes / 1024 / 1024:.1f} MiB written, "
                    f"{idx / elapsed:.1f} tiles/sec"
                )
                sys.stdout.flush()

    summary = {
        "name": name,
        "tileset_id": tileset_id,
        "tilejson_filesize_bytes": tilejson.get("filesize"),
        "candidate_tiles": len(tiles),
        "status_counts": status_counts,
        "error_tiles": error_tiles,
        "downloaded_or_existing_bytes": total_bytes,
    }
    (tileset_dir / "download-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def extract_bigtrees(dest):
    app_dir = dest / "bc_bigtree_registry"
    app_dir.mkdir(parents=True, exist_ok=True)
    app_js = fetch_bytes(APP_JS_URL).decode("utf-8")
    (app_dir / "bcforestmap-app.775f4591.js").write_text(app_js, encoding="utf-8")
    match = re.search(r"e\.exports=JSON\.parse\('(\{\"type\":\"FeatureCollection\".*?\})'\)\},", app_js)
    if not match:
        raise RuntimeError("Could not find embedded BigTree FeatureCollection in app bundle")
    encoded_json = match.group(1)
    decoded_json = bytes(encoded_json, "utf-8").decode("unicode_escape")
    data = json.loads(decoded_json)
    out = app_dir / "bc_bigtree_registry.geojson"
    out.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return {
        "features": len(data.get("features", [])),
        "geojson_bytes": out.stat().st_size,
        "app_bundle_bytes": (app_dir / "bcforestmap-app.775f4591.js").stat().st_size,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dest", type=Path)
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--skip-tiles", action="store_true")
    parser.add_argument("--only", action="append", choices=sorted(TILESETS.keys()))
    args = parser.parse_args()

    dest = args.dest / "bcforestmap_sources"
    dest.mkdir(parents=True, exist_ok=True)

    manifest_path = dest / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest.setdefault("tilesets", {})
        manifest["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    else:
        manifest = {
            "source_site": "http://www.bcforestmap.com/",
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "format_note": "Mapbox-hosted processed layers are mirrored as z/x/y vector PBF tiles plus TileJSON metadata.",
            "tilesets": {},
        }

    manifest["bc_bigtree_registry"] = extract_bigtrees(dest)

    if not args.skip_tiles:
        selected = args.only if args.only else TILESETS.keys()
        for name in selected:
            tileset_id = TILESETS[name]
            manifest["tilesets"][name] = download_tileset(name, tileset_id, dest, args.workers)
            manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Done: {dest}")


if __name__ == "__main__":
    main()
