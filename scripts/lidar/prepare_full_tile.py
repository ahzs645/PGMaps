#!/usr/bin/env python3
"""Stream every original LAZ return into non-overlapping spatial core shards."""

import argparse
import hashlib
import itertools
import json
import time
from pathlib import Path

import laspy
import numpy as np

DTYPE = np.dtype([("X", "<i4"), ("Y", "<i4"), ("Z", "<i4"), ("row", "<u4")])
SOURCE_SHA = "f5246f351e8d5923bf8a5dfddc0753032dbe8cb6e687ae58818cc701cb398ecf"


def atomic_json(path, data):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, indent=2) + "\n")
    temp.replace(path)


def prepare(source, output, size=50.0):
    output.mkdir(parents=True, exist_ok=True)
    ready = output / "manifest.json"
    if ready.exists():
        data = json.loads(ready.read_text())
        if data["source_sha256"] != SOURCE_SHA or data["tile_size_m"] != size:
            raise ValueError("Existing input manifest has different provenance")
        for tile in data["tiles"]:
            if (output / tile["file"]).stat().st_size != tile[
                "returns"
            ] * DTYPE.itemsize:
                raise ValueError("Incomplete source shard")
        return data
    # A failed streaming preparation is rebuilt, never appended a second time.
    for shard in output.glob("tile-*.bin"):
        shard.unlink()
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != SOURCE_SHA:
        raise ValueError("LAZ differs from the previously processed source")
    start = time.monotonic()
    with laspy.open(source) as reader:
        header = reader.header
        if header.point_count >= 2**32:
            raise ValueError("Source row dtype must be widened")
        origin = np.floor(header.mins[:2] / size) * size
        shape = np.floor((header.maxs[:2] - origin) / size).astype(int) + 1
        counts = np.zeros(tuple(shape), dtype=np.int64)
        row = 0
        for chunk in reader.chunk_iterator(1_000_000):
            n = len(chunk)
            x = np.asarray(chunk.x)
            y = np.asarray(chunk.y)
            ix = np.floor((x - origin[0]) / size).astype(int)
            iy = np.floor((y - origin[1]) / size).astype(int)
            key = ix * shape[1] + iy
            order = np.argsort(key, kind="stable")
            boundaries = np.r_[0, np.flatnonzero(np.diff(key[order])) + 1, n]
            records = np.empty(n, dtype=DTYPE)
            for name in ["X", "Y", "Z"]:
                records[name] = getattr(chunk, name)
            records["row"] = np.arange(row, row + n, dtype=np.uint32)
            for begin, end in itertools.pairwise(boundaries):
                indices = order[begin:end]
                tx, ty = int(ix[indices[0]]), int(iy[indices[0]])
                with (output / f"tile-{tx}-{ty}.bin").open("ab") as stream:
                    records[indices].tofile(stream)
                counts[tx, ty] += end - begin
            row += n
            atomic_json(
                output / "preparation-progress.json",
                {
                    "stage": "preparing_all_source_returns",
                    "read": row,
                    "total": header.point_count,
                    "elapsed_seconds": time.monotonic() - start,
                },
            )
            print(f"Prepared {row:,}/{header.point_count:,} returns", flush=True)
        assert row == header.point_count and int(counts.sum()) == row
        data = {
            "schema_version": 1,
            "source_sha256": SOURCE_SHA,
            "source_path": str(source.resolve()),
            "point_count": row,
            "tile_size_m": size,
            "origin_xy": origin.tolist(),
            "shape": shape.tolist(),
            "scales": header.scales.tolist(),
            "offsets": header.offsets.tolist(),
            "bounds": [header.mins.tolist(), header.maxs.tolist()],
            "horizontal_crs": "EPSG:3157",
            "vertical_crs": "EPSG:6647",
            "point_filters": "none; every original source return retained",
            "dtype": DTYPE.descr,
            "tiles": [
                {
                    "x": int(x),
                    "y": int(y),
                    "returns": int(counts[x, y]),
                    "file": f"tile-{x}-{y}.bin",
                }
                for x, y in zip(*np.nonzero(counts))
            ],
        }
    atomic_json(ready, data)
    return data


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = prepare(args.source, args.output)
    print(
        json.dumps(
            {
                "points": result["point_count"],
                "nonempty_core_tiles": len(result["tiles"]),
            }
        ),
        flush=True,
    )
