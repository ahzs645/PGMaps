"""Bounded original-return segmentation comparison; disagreements are not accuracy.

Use --help for reproducible preparation/run commands. No point sampling occurs
before segmentation. The small checked-in snapshot samples only the display.
"""

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import time

import numpy as np


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def canonical_sha(value):
    return hashlib.sha256(
        json.dumps(value, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()


def original_flags(las):
    """LAS uint8 flag arrays must be Boolean BEFORE logical negation/indexing."""
    withheld = np.asarray(las.withheld, dtype=bool)
    overlap = (
        np.asarray(las.overlap, dtype=bool)
        if hasattr(las, "overlap")
        else np.zeros(len(las.points), dtype=bool)
    )
    return withheld, overlap


def sample_indexes(count, maximum=2800):
    return np.linspace(0, count - 1, min(count, maximum), dtype=np.int64)


def inside(x, y, bounds):
    return (x >= bounds[0]) & (x < bounds[2]) & (y >= bounds[1]) & (y < bounds[3])


def intersecting_nodes(meta, hierarchy, bounds):
    b = meta["bounds"]
    nodes = []
    for key, count in sorted(hierarchy.items()):
        depth, ix, iy, _ = map(int, key.split("-"))
        dx = (b[3] - b[0]) / 2**depth
        dy = (b[4] - b[1]) / 2**depth
        west, south = b[0] + ix * dx, b[1] + iy * dy
        if (
            count > 0
            and west <= bounds[2]
            and west + dx >= bounds[0]
            and south <= bounds[3]
            and south + dy >= bounds[1]
        ):
            nodes.append((key, count))
    return nodes


def prepare(root, work):
    import laspy
    import rasterio
    from pyproj import Transformer

    crowns_path = root / "src/pages/dev-lidar/treeIsolation.generated.json"
    crowns = json.loads(crowns_path.read_text())
    ept = root / "public/data/lidar/bc-093g086"
    dtm_path = root / "public/data/lidar-analysis/bc-093g086/dtm-1m.tif"
    meta = json.loads((ept / "ept.json").read_text())
    if meta["points"] != 84608005:
        raise ValueError("Expected complete 84,608,005-return original EPT")
    hierarchy = json.loads((ept / "ept-hierarchy/0-0-0-0.json").read_text())
    metric = Transformer.from_crs(3857, 3157, always_xy=True)
    web = Transformer.from_crs(3157, 3857, always_xy=True)
    geographic = Transformer.from_crs(3157, 4326, always_xy=True)
    with rasterio.open(dtm_path) as src:
        if src.crs.to_epsg() != 3157:
            raise ValueError("Source DTM must be EPSG:3157")
        dtm, transform, nodata = src.read(1), src.transform, src.nodata

    def polygon(bounds):
        x0, y0, x1, y1 = bounds
        return {
            "type": "Polygon",
            "coordinates": [
                [
                    list(geographic.transform(x, y))
                    for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
                ]
            ],
        }

    results = []
    work.mkdir(parents=True, exist_ok=True)
    for crown_id, north in [("crown-3146", 20), ("crown-85", 0), ("crown-1", 0)]:
        anchor = next(
            f["properties"]
            for f in crowns["crowns"]["features"]
            if f["properties"]["id"] == crown_id
        )
        cx, cy = anchor["centre_utm"]
        cy += north
        plot_id = crown_id + ("-north" if north else "")
        core = [cx - 12.5, cy - 12.5, cx + 12.5, cy + 12.5]
        buffer = [cx - 22.5, cy - 22.5, cx + 22.5, cy + 22.5]
        xx, yy = web.transform(
            [buffer[0], buffer[2], buffer[2], buffer[0]],
            [buffer[1], buffer[1], buffer[3], buffer[3]],
        )
        nodes = intersecting_nodes(
            meta, hierarchy, [min(xx), min(yy), max(xx), max(yy)]
        )
        examined = sum(n for _, n in nodes)
        if examined > 750000:
            raise ValueError(
                f"{plot_id}: {examined} input returns exceed 750000 budget"
            )
        rows = []
        node_hashes = {}
        for ni, (key, count) in enumerate(nodes):
            node_path = ept / "ept-data" / f"{key}.laz"
            node_hashes[key] = sha(node_path)
            las = laspy.read(node_path)
            assert len(las.points) == count
            x, y = metric.transform(np.asarray(las.x), np.asarray(las.y))
            selected = np.flatnonzero(inside(x, y, buffer))
            rr, cc = rasterio.transform.rowcol(transform, x[selected], y[selected])
            rr, cc = np.asarray(rr), np.asarray(cc)
            valid = (rr >= 0) & (rr < dtm.shape[0]) & (cc >= 0) & (cc < dtm.shape[1])
            selected, rr, cc = selected[valid], rr[valid], cc[valid]
            ground = dtm[rr, cc]
            z = np.asarray(las.z)[selected]
            height = z - ground
            withheld, overlap = original_flags(las)
            cls = np.asarray(las.classification)[selected]
            valid = (
                (ground != nodata)
                & np.isfinite(height)
                & (height >= -0.5)
                & (height <= 80)
                & ~np.isin(cls, [7, 12, 18])
                & ~withheld[selected]
                & ~overlap[selected]
            )
            ix = selected[valid]
            rows.append(
                np.column_stack(
                    (
                        x[ix] - cx,
                        y[ix] - cy,
                        z[valid],
                        height[valid],
                        np.full(len(ix), ni),
                        ix,
                        cls[valid],
                    )
                )
            )
        points = np.concatenate(rows)
        assert len(points) > 0
        assert len({(int(p[4]), int(p[5])) for p in points}) == len(points)
        identity = dict(
            nodes=node_hashes,
            bounds=buffer,
            dtm=sha(dtm_path),
            accepted_array_sha256=hashlib.sha256(
                points.astype("<f8").tobytes()
            ).hexdigest(),
        )
        product = dict(
            id=plot_id,
            anchor_crown=crown_id,
            anchor_centre=anchor["centre"],
            centre=list(geographic.transform(cx, cy)),
            centre_utm=[cx, cy],
            core_bounds_utm=core,
            buffer_bounds_utm=buffer,
            core_polygon=polygon(core),
            buffer_polygon=polygon(buffer),
            input_sha256=canonical_sha(identity),
            input_identity=identity,
            examined_returns=examined,
            accepted_returns=len(points),
            nodes=[key for key, _ in nodes],
        )
        np.savez_compressed(work / f"{plot_id}.npz", points=points)
        (work / f"{plot_id}.json").write_text(json.dumps(product))
        # Local XY avoids cancellation; point row is the stable cross-language join key.
        np.savetxt(
            work / f"{plot_id}.csv",
            np.column_stack((np.arange(len(points)), points[:, :4])),
            delimiter=",",
            header="row,X,Y,Z,height",
            comments="",
            fmt="%.9f",
        )
        results.append(product)
        print(
            json.dumps(dict(plot=plot_id, examined=examined, accepted=len(points))),
            flush=True,
        )
    manifest = dict(
        schema_version=1,
        source_sha256=crowns["source_sha256"],
        segmentation_sha256=sha(crowns_path),
        label_grid_sha256=crowns["label_grid_sha256"],
        input_sha256={"dtm-1m.tif": sha(dtm_path)},
        plots=results,
    )
    (work / "manifest.json").write_text(json.dumps(manifest))


R_WORKER = r"""
suppressPackageStartupMessages(library(lidR))
suppressPackageStartupMessages(library(terra))
args <- commandArgs(trailingOnly=TRUE)
d <- read.csv(args[1])
method <- args[2]
set_lidr_threads(1L)
# Every row survives: normalized non-ground heights are not rounded to a LAS Z scale.
las <- LAS(data.frame(X=d$X,Y=d$Y,Z=pmax(0,d$height)), check=FALSE)
las@data$SourceRow <- d$row
start <- proc.time()[[3]]
if (method == "dalponte2016") {
  chm <- rasterize_canopy(las, res=1, algorithm=p2r(subcircle=0.2))
  chm <- terra::focal(chm, w=matrix(1,3,3), fun=mean, na.rm=TRUE, fillvalue=0)
  tt <- locate_trees(chm, lmf(ws=3,hmin=5))
  out <- segment_trees(las,dalponte2016(chm,tt,th_tree=2,th_seed=0.45,th_cr=0.55,max_cr=10))
} else {
  out <- segment_trees(las,li2012(dt1=1.5,dt2=2,R=2,Zu=15,hmin=2,speed_up=10))
}
elapsed <- proc.time()[[3]]-start
# lidR preserves row order; prove it before joining labels to original EPT node/index.
stopifnot(nrow(out@data)==nrow(d),all(out@data$X==d$X),all(out@data$Y==d$Y),
          all(out@data$SourceRow==d$row))
ids <- out@data$treeID
ids[is.na(ids)] <- -1L
ids[d$height < 2] <- -1L
write.table(ids,args[3],row.names=FALSE,col.names=FALSE,quote=FALSE)
jsonlite::write_json(list(version=as.character(packageVersion("lidR")),runtime_seconds=elapsed),args[4],auto_unbox=TRUE)
"""


def pointtree_worker(input_path, output_path, metadata_path):
    from pointtree.instance_segmentation import TreeXAlgorithm, TreeXPresetULS

    points = np.load(input_path)["points"]
    xyz = points[:, :3].copy()
    xyz[:, 2] -= np.min(xyz[:, 2])
    start = time.perf_counter()
    preset = TreeXPresetULS(num_workers=1, random_seed=42)
    algorithm = TreeXAlgorithm(**dict(preset))
    labels, stems, _ = algorithm(xyz)
    np.savetxt(output_path, labels, fmt="%d")
    Path(metadata_path).write_text(
        json.dumps(
            dict(
                version=importlib.metadata.version("pointtree"),
                runtime_seconds=time.perf_counter() - start,
                peak_rss_mb=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
                parameters=dict(preset),
                detected_stems=len(stems),
                normalization="TreeX internal CSF and inverse-distance DTM on original local coordinates; source DTM used only for display/comparison",
            )
        )
    )


def baseline_labels(root, points, product):
    data = json.loads(
        (root / "src/pages/dev-lidar/treeIsolation.generated.json").read_text()
    )
    grid = data["grid"]
    rows = np.floor(
        grid["bounds"][3] - (points[:, 1] + product["centre_utm"][1])
    ).astype(int)
    cols = np.floor(points[:, 0] + product["centre_utm"][0] - grid["bounds"][0]).astype(
        int
    )
    lookup = {}
    wanted = set((rows * grid["width"] + cols).tolist())
    for feature in data["crowns"]["features"]:
        c = feature["properties"]
        label = int(c["id"].split("-")[-1])
        for row, start, length in c["runs"]:
            for col in range(start, start + length):
                key = row * grid["width"] + col
                if key in wanted:
                    lookup[key] = label
    return np.array(
        [
            lookup.get(int(key), -1) if h >= 2 and cls != 2 else -1
            for key, h, cls in zip(
                rows * grid["width"] + cols, points[:, 3], points[:, 6]
            )
        ]
    )


def method_summary(labels, points, product, geographic):
    cx, cy = product["centre_utm"]
    core = inside(points[:, 0] + cx, points[:, 1] + cy, product["core_bounds_utm"])
    eligible = points[:, 3] >= 2
    tops = []
    for label in np.unique(labels[labels >= 0]):
        indexes = np.flatnonzero(labels == label)
        top = indexes[np.argmax(points[indexes, 3])]
        lon, lat = geographic.transform(points[top, 0] + cx, points[top, 1] + cy)
        tops.append(
            dict(
                id=int(label),
                lon=float(lon),
                lat=float(lat),
                height_m=round(float(points[top, 3]), 3),
                edge=not bool(core[top]),
            )
        )
    return dict(
        instances_buffer=len(tops),
        instances_core=sum(not t["edge"] for t in tops),
        assigned_points=int(np.sum((labels >= 0) & eligible & core)),
        unassigned_points=int(np.sum((labels < 0) & eligible & core)),
        eligible_core_points=int(np.sum(eligible & core)),
        tops=tops,
    )


def run(root, work, rscript, pointtree_python, output):
    from pyproj import Transformer
    from sklearn.metrics import adjusted_rand_score

    manifest = json.loads((work / "manifest.json").read_text())
    if manifest["segmentation_sha256"] != sha(
        root / "src/pages/dev-lidar/treeIsolation.generated.json"
    ):
        raise ValueError("Source segmentation changed; rerun --prepare")
    if manifest["input_sha256"]["dtm-1m.tif"] != sha(
        root / "public/data/lidar-analysis/bc-093g086/dtm-1m.tif"
    ):
        raise ValueError("Source DTM changed; rerun --prepare")
    geographic = Transformer.from_crs(3157, 4326, always_xy=True)
    r_worker = work / "lidr-worker.R"
    r_worker.write_text(R_WORKER)
    plots = []
    for product in manifest["plots"]:
        plot_id = product["id"]
        points = np.load(work / f"{plot_id}.npz")["points"]
        if (
            hashlib.sha256(points.astype("<f8").tobytes()).hexdigest()
            != product["input_identity"]["accepted_array_sha256"]
        ):
            raise ValueError(f"Prepared original points changed: {plot_id}")
        indexes = sample_indexes(len(points))
        product = dict(product)
        product["sample"] = dict(
            strategy="deterministic evenly spaced original node/index order; display only; algorithms used all accepted returns",
            total=len(points),
            sampled=len(indexes),
            nodes=product.pop("nodes"),
            columns=[
                "dx_m",
                "dy_m",
                "z_m",
                "height_m",
                "node",
                "index",
                "classification",
            ],
            points=[
                [
                    round(float(v), 3) if j < 4 else int(v)
                    for j, v in enumerate(points[i])
                ]
                for i in indexes
            ],
        )
        methods, full_labels = [], {}
        for method_id, name in [
            ("watershed", "Current 1 m CHM watershed"),
            ("dalponte2016", "lidR Dalponte 2016"),
            ("li2012", "lidR Li 2012"),
            ("pointtree-treex", "PointTree treeX ULS preset"),
        ]:
            start = time.perf_counter()
            method = dict(id=method_id, name=name, status="completed", parameters={})
            try:
                if method_id == "watershed":
                    labels = baseline_labels(root, points, product)
                    method.update(
                        version="PGMaps source snapshot",
                        runtime_seconds=time.perf_counter() - start,
                        parameters=dict(
                            grid_resolution_m=1,
                            height_min_m=2,
                            segmentation="exact existing crown cell memberships",
                            timing_scope="existing membership lookup only; not original full watershed preparation",
                            exclude_class_2=True,
                        ),
                    )
                else:
                    labels_path = work / f"{plot_id}-{method_id}.labels"
                    metadata_path = work / f"{plot_id}-{method_id}.metadata.json"
                    if method_id == "pointtree-treex":
                        command = [
                            str(pointtree_python),
                            str(Path(__file__).resolve()),
                            "--worker",
                            str(work / f"{plot_id}.npz"),
                            str(labels_path),
                            str(metadata_path),
                        ]
                    else:
                        command = [
                            str(rscript),
                            str(r_worker),
                            str(work / f"{plot_id}.csv"),
                            method_id,
                            str(labels_path),
                            str(metadata_path),
                        ]
                    environment = dict(
                        os.environ,
                        OMP_NUM_THREADS="1",
                        OPENBLAS_NUM_THREADS="1",
                        NUMBA_NUM_THREADS="1",
                        PROJ_DATA=str(Path(rscript).parent.parent / "share/proj"),
                    )
                    resources_path = work / f"{plot_id}-{method_id}.resources.json"
                    with (work / f"{plot_id}-{method_id}.log").open("w") as log:
                        completed = subprocess.run(
                            [
                                sys.executable,
                                str(Path(__file__).resolve()),
                                "--execute",
                                json.dumps(command),
                                str(resources_path),
                            ],
                            stdout=log,
                            stderr=subprocess.STDOUT,
                            timeout=180,
                            env=environment,
                        )
                    if completed.returncode:
                        raise RuntimeError(
                            f"process exited {completed.returncode}; see {plot_id}-{method_id}.log"
                        )
                    labels = np.loadtxt(labels_path, dtype=np.int64, ndmin=1)
                    assert len(labels) == len(points)
                    method.update(json.loads(metadata_path.read_text()))
                    method["peak_rss_mb"] = json.loads(resources_path.read_text())[
                        "peak_rss_mb"
                    ]
                    if method_id == "dalponte2016":
                        method["parameters"] = dict(
                            chm_resolution_m=1,
                            p2r_subcircle_m=0.2,
                            chm_focal_mean_cells=3,
                            lmf_window_m=3,
                            lmf_min_height_m=5,
                            th_tree=2,
                            th_seed=0.45,
                            th_cr=0.55,
                            max_cr=10,
                        )
                    elif method_id == "li2012":
                        method["parameters"] = dict(
                            dt1=1.5, dt2=2, R=2, Zu=15, hmin=2, speed_up=10
                        )
                assert labels.shape == (len(points),)
                method.update(method_summary(labels, points, product, geographic))
                method["labels"] = labels[indexes].tolist()
                method["input_sha256"] = product["input_sha256"]
                method["output_sha256"] = hashlib.sha256(
                    labels.astype("<i8").tobytes()
                ).hexdigest()
                if method_id == "pointtree-treex" and method["instances_buffer"] == 0:
                    method["warning"] = (
                        "Completed with no detected stems and all points unassigned; do not substitute crown peaks for measured stems."
                    )
                full_labels[method_id] = labels
            except (
                RuntimeError,
                ValueError,
                AssertionError,
                subprocess.TimeoutExpired,
            ) as error:
                method.update(
                    status="failed",
                    reason=str(error),
                    runtime_seconds=time.perf_counter() - start,
                    version="unavailable",
                    labels=[-1] * len(indexes),
                    tops=[],
                )
            methods.append(method)
            print(
                json.dumps(
                    dict(
                        plot=plot_id,
                        method=method_id,
                        status=method["status"],
                        instances=method.get("instances_core"),
                        reason=method.get("reason"),
                    )
                ),
                flush=True,
            )
        cx, cy = product["centre_utm"]
        eligible = inside(
            points[:, 0] + cx, points[:, 1] + cy, product["core_bounds_utm"]
        ) & (points[:, 3] >= 2)
        pairs = []
        for i, (left, a) in enumerate(full_labels.items()):
            for right, b in list(full_labels.items())[i + 1 :]:
                common = eligible & (a >= 0) & (b >= 0)
                pairs.append(
                    dict(
                        left=left,
                        right=right,
                        common_assigned_points=int(common.sum()),
                        eligible_core_points=int(eligible.sum()),
                        core_instance_delta_right_minus_left=(
                            next(
                                m["instances_core"] for m in methods if m["id"] == right
                            )
                            - next(
                                m["instances_core"] for m in methods if m["id"] == left
                            )
                        ),
                        adjusted_rand_index=(
                            round(float(adjusted_rand_score(a[common], b[common])), 6)
                            if common.sum() >= 2
                            else None
                        ),
                        interpretation="Agreement of partitions on commonly assigned core returns, not accuracy",
                    )
                )
        product.update(methods=methods, pairwise_agreement=pairs)
        plots.append(product)
    result = dict(
        manifest,
        plots=plots,
        generator_sha256=sha(Path(__file__)),
        screening=dict(
            input_budget_per_plot=750000,
            core_width_m=25,
            buffer_width_m=10,
            exclude_classes=[7, 12, 18],
            excluded_withheld=True,
            excluded_overlap_flag=True,
            retain_ground_class_2=True,
            source_dtm_height_range_m=[-0.5, 80],
            identity="EPT node key and decoded point index; not index in original single LAS file",
            normalization="lidR uses source DTM height, negative values clamped to zero; TreeX runs internal CSF/DTM on original local XYZ; display uses source DTM",
        ),
        limitations=[
            "Three purposively selected plots, no reviewed tree-instance ground truth; disagreement is not accuracy.",
            "Counts are instances whose highest return lies inside the 25 m core; 10 m buffer reduces but cannot remove edge effects.",
            "Ground and low returns retained in common input; core coverage counts only source-DTM heights >=2 m.",
            "PointTree treeX is stem-oriented and its ULS preset is not an airborne LiDAR validation.",
            "No species, DBH, complete stems, carbon or timber volume inferred.",
            "Display sample is deterministic, not random, and is not used for statistics or segmentation.",
            "Baseline inherits the existing height/roof/support masks and excludes class 2; new methods use the common screened raw input without baseline crown or roof masks.",
        ],
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n")
    print(json.dumps(dict(output=str(output), bytes=output.stat().st_size)), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--work", type=Path, default=Path("/workspace/scratch/tree-benchmarks")
    )
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--run", action="store_true")
    parser.add_argument(
        "--rscript", type=Path, default=Path("/workspace/scratch/lidar-r/bin/Rscript")
    )
    parser.add_argument(
        "--pointtree-python",
        type=Path,
        default=Path("/workspace/scratch/pointtree-venv/bin/python"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("src/pages/dev-lidar/treeBenchmarks.generated.json"),
    )
    parser.add_argument(
        "--worker", nargs=3, metavar=("INPUT_NPZ", "LABELS", "METADATA")
    )
    parser.add_argument(
        "--execute", nargs=2, metavar=("COMMAND_JSON", "RESOURCES_JSON")
    )
    args = parser.parse_args()
    if args.execute:
        command, resources = args.execute
        completed = subprocess.run(json.loads(command), timeout=165)
        Path(resources).write_text(
            json.dumps(
                dict(
                    peak_rss_mb=round(
                        resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024, 3
                    )
                )
            )
        )
        raise SystemExit(completed.returncode)
    if args.worker:
        pointtree_worker(*args.worker)
        return
    if args.prepare:
        prepare(args.root.resolve(), args.work)
    if args.run:
        run(
            args.root.resolve(),
            args.work,
            args.rscript,
            args.pointtree_python,
            args.output,
        )


if __name__ == "__main__":
    main()
