import json, numpy as np, laspy, rasterio
from pathlib import Path
from pyproj import Transformer
import argparse

parser = argparse.ArgumentParser(
    description="Check an original EPT crown-column crop offline; no species or stem inference."
)
parser.add_argument("--crown", default="crown-1")
args = parser.parse_args()
root = Path.cwd()
d = json.loads((root / "src/pages/dev-lidar/treeIsolation.generated.json").read_text())
c = next(
    f["properties"]
    for f in d["crowns"]["features"]
    if f["properties"]["id"] == args.crown
)
grid = d["grid"]
cells = {r * grid["width"] + x for r, col, n in c["runs"] for x in range(col, col + n)}
xmin, ymin, xmax, ymax = grid["bounds"]
xx = [xmin + col for r, col, n in c["runs"]] + [
    xmin + col + n for r, col, n in c["runs"]
]
yy = [ymax - r for r, col, n in c["runs"]] + [ymax - r - 1 for r, col, n in c["runs"]]
web = Transformer.from_crs(3157, 3857, always_xy=True)
px, py = web.transform([min(xx), max(xx)], [min(yy), max(yy)])
bounds = [min(px), min(py), max(px), max(py)]
ept = root / "public/data/lidar/bc-093g086"
meta = json.loads((ept / "ept.json").read_text())
hier = json.loads((ept / "ept-hierarchy/0-0-0-0.json").read_text())
b = meta["bounds"]
nodes = []
for key, count in hier.items():
    depth, x, y, z = map(int, key.split("-"))
    dx = (b[3] - b[0]) / (2**depth)
    dy = (b[4] - b[1]) / (2**depth)
    west = b[0] + x * dx
    south = b[1] + y * dy
    if (
        count > 0
        and west <= bounds[2]
        and west + dx >= bounds[0]
        and south <= bounds[3]
        and south + dy >= bounds[1]
    ):
        nodes.append((key, count))
assert (
    sum(n for _, n in nodes) <= 750000
), "Offline check is bounded to 750,000 input returns; choose a smaller crown"
metric = Transformer.from_crs(3857, 3157, always_xy=True)
accepted = 0
points = 0
with rasterio.open(root / "public/data/lidar-analysis/bc-093g086/dtm-1m.tif") as src:
    dtm = src.read(1)
for key, n in nodes:
    las = laspy.read(ept / "ept-data" / f"{key}.laz")
    points += len(las.points)
    x, y = metric.transform(np.asarray(las.x), np.asarray(las.y))
    cols = np.floor(x - xmin).astype(int)
    rows = np.floor(ymax - y).astype(int)
    keep = (cols >= 0) & (cols < grid["width"]) & (rows >= 0) & (rows < grid["height"])
    indexes = np.where(keep)[0]
    indexes = np.array(
        [i for i in indexes if rows[i] * grid["width"] + cols[i] in cells], dtype=int
    )
    h = np.asarray(las.z)[indexes] - dtm[rows[indexes], cols[indexes]]
    cls = np.asarray(las.classification)[indexes]
    keep = (
        (h >= 2)
        & (h <= 80)
        & ~np.isin(cls, [2, 7, 12, 18])
        & ~np.asarray(las.withheld)[indexes]
    )
    accepted += int(keep.sum())
assert accepted > 0
print(
    json.dumps(
        {
            "candidate": c["id"],
            "intersecting_nodes": len(nodes),
            "examined_original_returns": points,
            "crop_returns_after_height_class_withheld_screen": accepted,
            "browser_point_budget": 750000,
            "all_nodes_fit_budget": points <= 750000,
        }
    )
)
