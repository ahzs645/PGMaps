#!/usr/bin/env python3
"""Package measured analysis, source-grid GeoTIFFs and web map previews."""

import argparse, hashlib, json, shutil
from pathlib import Path
import numpy as np
from scipy import ndimage as ndi
import rasterio
from rasterio.transform import array_bounds
from rasterio.warp import calculate_default_transform, reproject, Resampling
from pyproj import Transformer
from PIL import Image
from matplotlib import colormaps
import shapefile

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--analysis", type=Path, required=True)
p.add_argument("--output", type=Path, required=True)
args = p.parse_args()
root = args.analysis
out = args.output
out.mkdir(parents=True, exist_ok=True)
summary = json.loads((root / "summary.json").read_text())
g = np.load(root / "analysis-grids.npz")
with rasterio.open(root / "height-1m.tif") as src:
    transform = src.transform
    crs = src.crs
    source_bounds = src.bounds
    web_transform, width, height = calculate_default_transform(
        crs, "EPSG:3857", src.width, src.height, *src.bounds, resolution=3
    )
web_bounds = list(array_bounds(height, width, web_transform))
ll = Transformer.from_crs(3857, 4326, always_xy=True)
west, south = ll.transform(web_bounds[0], web_bounds[1])
east, north = ll.transform(web_bounds[2], web_bounds[3])
summary["bounds_wgs84"] = [west, south, east, north]
summary["image_coordinates"] = [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
]


def warped(a, nearest=False):
    target = np.full((height, width), np.nan, dtype="float32")
    reproject(
        a.astype("float32"),
        target,
        src_transform=transform,
        src_crs=crs,
        dst_transform=web_transform,
        dst_crs="EPSG:3857",
        src_nodata=np.nan,
        dst_nodata=np.nan,
        resampling=Resampling.nearest if nearest else Resampling.bilinear,
    )
    return target


def read(name):
    with rasterio.open(root / name) as src:
        a = src.read(1).astype(float)
        a[a == src.nodata] = np.nan
        return a


rasters = {}


def preview(key, a, title, vmin, vmax, cmap, unit, shade=None):
    data = warped(a)
    valid = np.isfinite(data)
    colors = colormaps[cmap](
        np.clip((np.nan_to_num(data, nan=vmin) - vmin) / (vmax - vmin), 0, 1)
    )
    if shade is not None:
        brightness = np.clip(warped(shade) / 255, 0, 1) * 0.55 + 0.45
        colors[:, :, :3] *= np.nan_to_num(brightness, nan=1)[:, :, None]
    colors[:, :, 3] = valid * 0.94
    Image.fromarray((colors * 255).astype("uint8"), "RGBA").save(out / (key + ".png"))
    palette = [
        "#" + "".join(f"{int(c * 255):02x}" for c in colormaps[cmap](v)[:3])
        for v in np.linspace(0, 1, 6)
    ]
    rasters[key] = {
        "file": key + ".png",
        "title": title,
        "min": vmin,
        "max": vmax,
        "unit": unit,
        "colors": palette,
    }
    return data


height_web = preview(
    "height", g["chm"], "Height above ground · canopy proxy", 0, 40, "viridis", "m"
)
height_web.astype("<f4").tofile(out / "height-samples.bin")
preview(
    "terrain",
    g["dtm"],
    "Ground terrain · GeoLibre hillshade",
    float(np.nanpercentile(g["dtm"], 1)),
    float(np.nanpercentile(g["dtm"], 99)),
    "gist_earth",
    "m elevation",
    shade=read("hillshade.tif"),
)
preview(
    "slope", read("slope.tif"), "Terrain slope · GeoLibre", 0, 45, "magma", "degrees"
)
preview("cover", g["cover"], "Elevated first-return cover >2 m", 0, 100, "YlGn", "%")
preview(
    "support",
    np.where(g["valid"], g["distance"], np.nan),
    "Ground interpolation distance",
    0,
    30,
    "inferno",
    "m",
)
crowns = warped(np.where(g["crowns"] > 0, g["crowns"], np.nan), nearest=True)
labels = np.nan_to_num(crowns, nan=0).astype("uint32")
rgb = np.empty((height, width, 4), dtype="uint8")
for i, mul in enumerate([97, 57, 137]):
    rgb[:, :, i] = ((labels * mul) % 180 + 60).astype("uint8")
rgb[:, :, 3] = np.where(np.isfinite(crowns), 220, 0)
Image.fromarray(rgb, "RGBA").save(out / "crowns.png")
rasters["crowns"] = {
    "file": "crowns.png",
    "title": "Candidate crown regions · watershed",
    "min": 0,
    "max": int(labels.max()),
    "unit": "categorical regions",
    "colors": ["#87b854", "#da807c", "#8b8fde", "#d7b357", "#68b5ba"],
}
summary["rasters"] = rasters
summary["sample_grid"] = {
    "file": "height-samples.bin",
    "width": width,
    "height": height,
    "bounds_mercator": web_bounds,
    "resolution_mercator_m": 3,
}
# Keep source-grid quantitative rasters, not resampled previews, for downloads.
for filename in [
    "dtm-1m.tif",
    "dsm-1m.tif",
    "height-1m.tif",
    "elevated-first-return-cover.tif",
    "ground-support-distance.tif",
    "slope.tif",
]:
    with rasterio.open(root / filename) as src:
        profile = src.profile.copy()
        profile.update(
            driver="GTiff", compress="deflate", predictor=3, tiled=True, dtype="float32"
        )
        with rasterio.open(out / filename, "w", **profile) as dst:
            dst.write(src.read().astype("float32"))
# Remove repeated prose from each feature; common method/limits live in the manifest.
for name, fields in [
    (
        "tree-candidates.geojson",
        ["id", "height_m", "crown_area_m2", "ground_support_m", "edge"],
    ),
    ("building-candidates.geojson", ["id", "area_m2", "height_m", "roughness_m"]),
]:
    fc = json.loads((root / name).read_text())
    for f in fc["features"]:
        f["properties"] = {k: f["properties"][k] for k in fields}
    (out / name).write_text(json.dumps(fc, separators=(",", ":")) + "\n")
trees = json.loads((out / "tree-candidates.geojson").read_text())["features"]
roofs = json.loads((out / "building-candidates.geojson").read_text())["features"]
# GeoLibre's true point-cloud tree tool is a bounded method comparison.
runs = json.loads((root / "geolibre-runs.json").read_text())
shutil.copyfile(root / "geolibre-runs.json", out / "geolibre-runs.json")
if (root / "roof-regularized.geojson").exists():
    shutil.copyfile(root / "roof-regularized.geojson", out / "roof-regularized.geojson")
if any(
    r["tool"] == "individual_tree_segmentation" and r["exit_code"] != 0 for r in runs
):
    summary["limitations"].append(
        "GeoLibre 1.7.1 WASI mean-shift tree segmentation failed because the runtime cannot build its thread pool. No output from that tool is displayed; full-tile crown regions use watershed instead."
    )
scope = json.loads((root / "reference-scope.json").read_text())
shutil.copyfile(root / "reference-scope.json", out / "reference-scope.json")
actual = []
reader = shapefile.Reader(str(root / "geolibre-trees.shp"))
to_ll = Transformer.from_crs(3157, 4326, always_xy=True)
for i, s in enumerate(reader.shapes()):
    x, y = s.points[0]
    lon, lat = to_ll.transform(x, y)
    actual.append(
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "id": f"geolibre-{i + 1}",
                "scope": "1ha derived surface reference sample",
                "height_m": float(reader.record(i)["Z"]),
            },
        }
    )
(out / "geolibre-tree-reference.geojson").write_text(
    json.dumps({"type": "FeatureCollection", "features": actual}, separators=(",", ":"))
    + "\n"
)
from shapely.geometry import box, mapping
from shapely.ops import transform as transform_geom

area = transform_geom(to_ll.transform, box(*scope["bounds_utm"]))
(out / "reference-area.geojson").write_text(
    json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": mapping(area),
                    "properties": {"scope": "1 ha GeoLibre reference area"},
                }
            ],
        },
        separators=(",", ":"),
    )
    + "\n"
)
summary["geolibre"] = {
    "tools": [r["tool"] for r in runs if r["exit_code"] == 0],
    "tree_candidate_count": len(actual),
    "tree_scope": f"Individual tree detection was run on a fixed 1 ha forest reference area ({scope['points']:,} normalized 1 m surface samples); it returned {len(actual):,} candidates. The full-tile crown layer uses the separate local-maxima/watershed pipeline. A full-surface GeoLibre tree attempt was stopped at its exploratory runtime budget.",
}
# Meaningful viewpoints chosen from the actual outputs.
high = max(
    (
        f
        for f in trees
        if f["properties"]["crown_area_m2"] >= 15
        and f["properties"]["ground_support_m"] <= 2
    ),
    key=lambda f: f["properties"]["height_m"],
)
opening = g["valid"] & (g["chm"] < 2)
dist = ndi.distance_transform_edt(opening)
row, col = np.unravel_index(np.argmax(dist), dist.shape)
x, y = transform * (float(col) + 0.5, float(row) + 0.5)
op = list(to_ll.transform(x, y))
summary["highlights"] = [
    {
        "label": "High canopy",
        "center": high["geometry"]["coordinates"],
        "zoom": 17,
        "note": f"Crown candidate {high['properties']['height_m']} m above terrain; not independently measured.",
    },
    {
        "label": "Open ground",
        "center": op,
        "zoom": 16.5,
        "note": "Interior of an observed low-height opening.",
    },
]
if roofs:
    from shapely.geometry import shape

    largest = max(roofs, key=lambda f: f["properties"]["area_m2"])
    center = shape(largest["geometry"]).representative_point()
    summary["highlights"].append(
        {
            "label": "Roof candidates",
            "center": [center.x, center.y],
            "zoom": 17,
            "note": "Largest detected planar patch; unvalidated building candidate.",
        }
    )
refcenter = list(
    to_ll.transform(
        (scope["bounds_utm"][0] + scope["bounds_utm"][2]) / 2,
        (scope["bounds_utm"][1] + scope["bounds_utm"][3]) / 2,
    )
)
summary["highlights"].append(
    {
        "label": "GeoLibre test area",
        "center": refcenter,
        "zoom": 17.5,
        "note": "Fixed 100×100 m reference area for the actual GeoLibre tree detector.",
    }
)
summary["downloads"] = [
    {"file": file, "label": label}
    for file, label in [
        ("dtm-1m.tif", "Ground DTM · 1 m"),
        ("dsm-1m.tif", "Surface DSM · 1 m"),
        ("height-1m.tif", "Height above ground · 1 m"),
        ("slope.tif", "GeoLibre slope · GeoTIFF"),
        ("tree-candidates.geojson", "Crown candidates · GeoJSON"),
        ("building-candidates.geojson", "Roof-like patches · GeoJSON"),
        ("roof-regularized.geojson", "GeoLibre-regularized patches · GeoJSON"),
        ("geolibre-tree-reference.geojson", "GeoLibre tree test · GeoJSON"),
        ("geolibre-runs.json", "Actual engine execution log"),
        ("elevated-first-return-cover.tif", "Elevated return cover · GeoTIFF"),
        ("ground-support-distance.tif", "Ground support distance · GeoTIFF"),
        ("summary.json", "Metrics & parameters · JSON"),
    ]
]
summary["web_preview_note"] = (
    "Web previews use a 3m Web Mercator display grid; GeoTIFF downloads retain 1m metric UTM source grids."
)
(out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
checksums = {
    f.name: {
        "bytes": f.stat().st_size,
        "sha256": hashlib.sha256(f.read_bytes()).hexdigest(),
    }
    for f in out.iterdir()
    if f.is_file() and f.name != "checksums.json"
}
(out / "checksums.json").write_text(json.dumps(checksums, indent=2) + "\n")
print(
    json.dumps(
        {
            "files": len(checksums),
            "bytes": sum(f["bytes"] for f in checksums.values()),
            "geolibre_reference_trees": len(actual),
            "metrics": {
                k: summary[k]
                for k in [
                    "tree_candidate_count",
                    "building_candidate_count",
                    "supported_area_ha",
                ]
            },
        },
        indent=2,
    )
)
