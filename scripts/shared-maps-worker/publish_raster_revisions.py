"""Publish reviewed raster repairs without changing a map's ground footprint.

Private catalogues, source files, evidence and owner settings stay outside git.
Supports a bounded alpha mask or a source-backed finer export of a frozen model.
The latter requires a scientific review of the hashed recipe; this validator
checks identity, frames and publication scope, not ground accuracy.

Validation regenerates delivery derivatives locally with build_catalog.py and
requires its dependencies: GDAL CLI (gdalwarp/gdaladdo), rasterio, NumPy,
Pillow, pmtiles and httpx. Use the same toolchain that prepared the reviewed
derivatives; a toolchain change may require preparing and reviewing them again.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
from itertools import zip_longest
import json
import mmap
from pathlib import Path
import re
import stat
import tempfile

import numpy as np
from PIL import Image
from pmtiles.reader import MmapSource, Reader, all_tiles
import rasterio
from rasterio.warp import transform_bounds

import build_catalog
from publish_image_variants import catalogue_records, digest, publish_validated, same_json
from update_image_variants_catalogue import collection_base

SHA = re.compile(r"[a-f0-9]{64}")
OBJECT_TYPES = {
    "raster": ("raw", ".tif", "image/tiff"),
    "tiles": ("tiles", ".pmtiles", "application/vnd.pmtiles"),
    "thumbnail": ("previews", ".webp", "image/webp"),
}
TEXT_LIMITS = {"title": 500, "dateLabel": 500, "description": 12000, "caveat": 12000}


def checked_file(root: Path, reference: dict) -> Path:
    if not isinstance(reference, dict) or not SHA.fullmatch(str(reference.get("sha256", ""))):
        raise ValueError("A reviewed file needs its exact SHA-256")
    name = reference.get("path")
    if not isinstance(name, str) or Path(name).is_absolute():
        raise ValueError("Reviewed files must use relative paths")
    path = (root / name).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("A reviewed file escapes its stage directory")
    if digest(path) != reference["sha256"]:
        raise ValueError("A reviewed input changed")
    return path


def object_entry(root: Path, revision: dict, role: str) -> dict:
    entry = revision[role]
    path = checked_file(root, entry)
    folder, suffix, content_type = OBJECT_TYPES[role]
    key = f"{folder}/{entry['sha256']}{suffix}"
    size = path.stat().st_size
    if type(entry.get("bytes")) is not int or entry["bytes"] != size or not 0 < size < 95_000_000:
        raise ValueError("A prepared object's size is invalid")
    return {"key": key, "sha256": entry["sha256"], "bytes": size,
            "contentType": content_type, "localPath": path}


def validate_pixels(root: Path, revision: dict, before_path: Path, after_path: Path) -> dict:
    """Require fixed extent; independently verify every alpha-mask pixel."""
    with rasterio.open(before_path) as old, rasterio.open(after_path) as new:
        if old.crs != new.crs or old.bounds != new.bounds:
            raise ValueError("A raster repair must preserve its exact CRS and outer extent")
        if old.count != 4 or new.count != 4 or set(old.dtypes + new.dtypes) != {"uint8"}:
            raise ValueError("Raster repairs require byte RGBA inputs")
        if old.colorinterp != new.colorinterp or tuple(c.name for c in new.colorinterp) != ("red", "green", "blue", "alpha"):
            raise ValueError("Raster repairs must retain explicit RGBA channel semantics")
        if revision["kind"] == "alpha-mask":
            if old.shape != new.shape or old.transform != new.transform:
                raise ValueError("An alpha mask must preserve the exact pixel grid")
            mask_path = checked_file(root, revision["mask"])
            with Image.open(mask_path) as image:
                mask = np.asarray(image)
            if mask.shape != old.shape or mask.dtype != np.uint8 or not np.isin(mask, [0, 255]).all():
                raise ValueError("An alpha mask must be a binary image in the native frame")
            selected = mask == 255
            if not 0 < np.count_nonzero(selected) <= old.width * old.height * 0.05:
                raise ValueError("An alpha repair is limited to five percent of the native frame")
            a, b = old.read(), new.read()
            expected_alpha = np.where(selected, 0, a[3])
            if not np.array_equal(a[:3], b[:3]) or not np.array_equal(expected_alpha, b[3]):
                raise ValueError("A mask repair changed RGB or pixels outside the reviewed mask")
            if np.array_equal(a[3], b[3]):
                raise ValueError("The alpha repair makes no change")
        elif revision["kind"] == "source-resolution":
            checked_file(root, revision["sourceImage"])
            checked_file(root, revision["frozenModel"])
            checked_file(root, revision["rebuildRecipe"])
            ratio_x, ratio_y = new.width / old.width, new.height / old.height
            if ratio_x != ratio_y or not ratio_x.is_integer() or not 1 < ratio_x <= 16:
                raise ValueError("A finer export must evenly subdivide the existing grid")
            if new.transform != old.transform * rasterio.Affine.scale(1 / ratio_x):
                raise ValueError("A finer export shifted the original pixel grid")
        else:
            raise ValueError("Unsupported raster repair kind")
        return {"width": new.width, "height": new.height, "crs": str(new.crs),
                "pixelSize": list(new.res),
                "bounds": list(transform_bounds(new.crs, 4326, *new.bounds, densify_pts=41))}


def validate_tiles(path: Path, supplied: dict, bounds: list) -> None:
    if not isinstance(supplied, dict) or set(supplied) != {"minZoom", "maxZoom", "tileCount", "width", "format"}:
        raise ValueError("Tile metadata needs the five supported delivery fields")
    with path.open("rb") as handle:
        header = Reader(MmapSource(handle)).header()
    if any(type(supplied[k]) is not int for k in ("minZoom", "maxZoom", "tileCount", "width")):
        raise ValueError("Tile counts and zooms must be integers")
    if (supplied["minZoom"] != header["min_zoom"] or supplied["maxZoom"] != header["max_zoom"]
            or supplied["tileCount"] != header["addressed_tiles_count"]
            or supplied["width"] != 256 or supplied["format"] != "webp"
            or header["tile_type"].name != "WEBP"):
        raise ValueError("Tile metadata differs from the prepared archive")
    actual = [header[k] / 1e7 for k in ("min_lon_e7", "min_lat_e7", "max_lon_e7", "max_lat_e7")]
    if not np.allclose(actual, bounds, rtol=0, atol=1e-7):
        raise ValueError("The prepared tile archive has a different geographic footprint")


def validate_derivatives(raster: Path, tiles: Path, thumbnail: Path, supplied: dict) -> None:
    """Check actual delivery content against regeneration from the new raster.

    PMTiles metadata and gzip timestamps are not image content. Compare every
    addressed tile coordinate and its encoded bytes, streaming in tile-id order,
    rather than requiring the whole archive to have the same checksum.
    Temporary regeneration files are removed on success and failure.
    """
    with tempfile.TemporaryDirectory(prefix="pgmaps-raster-delivery-") as temporary:
        directory = Path(temporary)
        regenerated_tiles = directory / "tiles.pmtiles"
        regenerated_thumbnail = directory / "thumbnail.webp"
        geometry = build_catalog.create_tiles(raster, regenerated_tiles, "Raster delivery verification")
        if not same_json({key: geometry[key] for key in supplied}, supplied):
            raise ValueError("Prepared tile metadata does not match delivery from the repaired raster")
        with tiles.open("rb") as actual, regenerated_tiles.open("rb") as expected:
            with mmap.mmap(actual.fileno(), 0, access=mmap.ACCESS_READ) as actual_map, \
                    mmap.mmap(expected.fileno(), 0, access=mmap.ACCESS_READ) as expected_map:
                actual_tiles = all_tiles(lambda offset, length: actual_map[offset:offset + length])
                expected_tiles = all_tiles(lambda offset, length: expected_map[offset:offset + length])
                count = 0
                for actual_tile, expected_tile in zip_longest(actual_tiles, expected_tiles):
                    if actual_tile is None or expected_tile is None or actual_tile != expected_tile:
                        raise ValueError("Prepared tile coordinates or bytes differ from the repaired raster")
                    count += 1
                if count != supplied["tileCount"]:
                    raise ValueError("Prepared tile count differs from the repaired raster")
        build_catalog.thumbnail(raster, regenerated_thumbnail)
        if digest(thumbnail) != digest(regenerated_thumbnail):
            raise ValueError("Prepared thumbnail differs from the repaired raster")


def revised_catalogue(root: Path, stage: dict, before: dict) -> tuple[dict, list[dict], list[str]]:
    """Construct the only allowed result, including all aliases of each raster."""
    base = collection_base(stage.get("collectionBase"))
    expected = copy.deepcopy(before)
    records = catalogue_records(expected)
    revisions = stage.get("revisions")
    if not isinstance(revisions, list) or not 1 <= len(revisions) <= 8:
        raise ValueError("A raster publication needs one to eight explicit repairs")
    objects, protected, seen = {}, [], set()
    byte_delta, tile_delta = 0, 0
    for revision in revisions:
        item = records.get(("items", revision.get("itemId")))
        if not item or len(item.get("assets", [])) != 1 or not isinstance(item.get("download"), dict):
            raise ValueError("Each repair must identify a native single-raster record")
        original, asset = copy.deepcopy(item["download"]), copy.deepcopy(item["assets"][0])
        original_thumbnail = item.get("thumbnail")
        checksum = original.get("sha256")
        if checksum in seen:
            raise ValueError("A raster may only be repaired once in a publication")
        seen.add(checksum)
        old_path = checked_file(root, revision["beforeRaster"])
        if revision["beforeRaster"]["sha256"] != checksum:
            raise ValueError("The reviewed old raster differs from the catalogue")
        evidence_path = checked_file(root, revision["evidence"])
        prepared = {role: object_entry(root, revision, role) for role in OBJECT_TYPES}
        if prepared["raster"]["sha256"] == checksum:
            raise ValueError("The replacement raster must have a new immutable identity")
        if prepared["tiles"]["sha256"] == asset.get("sha256"):
            raise ValueError("A raster repair cannot retain the unchanged tile archive")
        frame = validate_pixels(root, revision, old_path, prepared["raster"]["localPath"])
        if not np.allclose(frame["bounds"], item["bounds"], rtol=0, atol=1e-9):
            raise ValueError("The raster extent differs from the catalogue footprint")
        validate_tiles(prepared["tiles"]["localPath"], revision["tileMetadata"], item["bounds"])
        with Image.open(prepared["thumbnail"]["localPath"]) as image:
            if image.format != "WEBP" or max(image.size) > 1800:
                raise ValueError("The thumbnail is not a bounded WebP image")
            image.verify()
        validate_derivatives(prepared["raster"]["localPath"], prepared["tiles"]["localPath"],
                             prepared["thumbnail"]["localPath"], revision["tileMetadata"])
        note = revision.get("note")
        if not isinstance(note, str) or not 1 <= len(note) <= 4000:
            raise ValueError("A raster repair needs a bounded evidence note")
        new_asset = {**asset, **revision["tileMetadata"],
                     **{k: prepared["tiles"][k] for k in ("sha256", "bytes")},
                     "url": base + prepared["tiles"]["key"]}
        # Preserve the stored bounds byte for byte, including floating-point representation.
        new_asset["bounds"] = copy.deepcopy(asset["bounds"])
        touched = []
        for (group, identifier), record in records.items():
            raw_fields = [("download", record["download"])] if isinstance(record.get("download"), dict) else []
            raw_fields += [(f"downloads/{i}", d) for i, d in enumerate(record.get("downloads", []))]
            matching = [(field, d) for field, d in raw_fields if d.get("sha256") == checksum]
            matching_assets = [i for i, a in enumerate(record.get("assets", [])) if a.get("sha256") == asset.get("sha256")]
            if not matching and not matching_assets:
                continue
            if len(matching) != 1 or len(matching_assets) != 1:
                raise ValueError("Raster/download aliases must match exactly once in every record")
            field, old_download = matching[0]
            prior_asset = record["assets"][matching_assets[0]]
            for key in ("bytes", "url", "bounds", "minZoom", "maxZoom", "tileCount", "width", "format"):
                if not same_json(prior_asset.get(key), asset.get(key)):
                    raise ValueError("Aliases of one raster have conflicting core tile metadata")
            replacement = {**old_download, **{k: frame[k] for k in ("width", "height", "crs", "pixelSize")},
                           **{k: prepared["raster"][k] for k in ("sha256", "bytes")},
                           "url": base + prepared["raster"]["key"]}
            if field == "download":
                record["download"] = replacement
            else:
                record["downloads"][int(field.split("/")[1])] = replacement
            record["assets"][matching_assets[0]] = {**prior_asset, **{
                key: copy.deepcopy(new_asset[key]) for key in
                ("sha256", "bytes", "url", "bounds", "minZoom", "maxZoom", "tileCount", "width", "format")
            }}
            previous_thumbnail = record.get("thumbnail")
            if previous_thumbnail == original_thumbnail or (group == "items" and identifier == revision["itemId"]):
                record["thumbnail"] = base + prepared["thumbnail"]["key"]
            record["rasterRevision"] = {
                "kind": revision["kind"], "note": note,
                "previousRaster": copy.deepcopy(old_download), "previousAsset": copy.deepcopy(prior_asset),
                "previousThumbnail": previous_thumbnail, "evidenceSha256": revision["evidence"]["sha256"],
                "sourceModelChanged": False, "groundAccuracyCertified": False,
            }
            touched.append({"group": group, "id": identifier})
            if group == "items":
                byte_delta += replacement["bytes"] - old_download["bytes"]
                tile_delta += new_asset["bytes"] - asset["bytes"]
        if not same_json(touched, revision.get("records")):
            raise ValueError("The explicit review must cover every raster alias in order")
        for entry in prepared.values():
            if entry["key"] in objects and objects[entry["key"]] != entry:
                raise ValueError("Conflicting immutable objects")
            objects[entry["key"]] = entry
        protected.extend([str(old_path), str(evidence_path)])
        for key in ("mask", "sourceImage", "frozenModel", "rebuildRecipe"):
            if key in revision:
                protected.append(str(checked_file(root, revision[key])))
    for field, delta in (("storageBytes", byte_delta), ("tileBytes", tile_delta)):
        if field in expected:
            if type(expected[field]) is not int:
                raise ValueError("Catalogue storage counters must be integers")
            expected[field] += delta
    text_updates = stage.get("textUpdates", [])
    if not isinstance(text_updates, list) or len(text_updates) > 64:
        raise ValueError("Too many text updates")
    seen_updates = set()
    for update in text_updates:
        if set(update) != {"group", "id", "field", "before", "after"}:
            raise ValueError("Text updates need exact before and after values")
        key = (update["group"], update["id"], update["field"])
        record = records.get(key[:2])
        if key in seen_updates or not record or key[2] not in TEXT_LIMITS or record.get(key[2]) != update["before"]:
            raise ValueError("A text update is stale, repeated or unsupported")
        value = update["after"]
        if not isinstance(value, str) or not 1 <= len(value) <= TEXT_LIMITS[key[2]] or value == update["before"]:
            raise ValueError("A reviewed text update must make a bounded change")
        record[key[2]] = value
        seen_updates.add(key)
    return expected, list(objects.values()), protected


def validate_stage(stage_path: Path) -> tuple[dict, bytes, list[dict]]:
    stage = json.loads(stage_path.read_text())
    if stage.get("schema") != "pgmaps-raster-revision-publication-v1":
        raise ValueError("Unsupported raster revision stage")
    root = stage_path.parent
    before_path = checked_file(root, {"path": stage["beforeCatalogue"], "sha256": stage["beforeSha256"]})
    after_path = checked_file(root, {"path": stage["afterCatalogue"], "sha256": stage["afterSha256"]})
    before_bytes, body = before_path.read_bytes(), after_path.read_bytes()
    # Use exactly the bytes passed to publication, rejecting a local change after the file check.
    if hashlib.sha256(before_bytes).hexdigest() != stage["beforeSha256"] or hashlib.sha256(body).hexdigest() != stage["afterSha256"]:
        raise ValueError("A catalogue changed while validating its snapshot")
    before, after = json.loads(before_bytes), json.loads(body)
    if before.get("schema") != "raster-catalog-v1" or not 0 < len(body) <= 6_000_000:
        raise ValueError("Invalid or oversized raster catalogue")
    expected, objects, protected = revised_catalogue(root, stage, before)
    if not same_json(expected, after):
        raise ValueError("The catalogue contains changes beyond the reviewed raster repairs")
    stage["protectedInputs"] = protected
    return stage, body, objects


def publish(stage_path: Path, config: dict, *, client=None, receipt_path: Path | None = None) -> dict:
    validated = validate_stage(stage_path)
    return publish_validated(
        stage_path, config, validated, client=client, receipt_path=receipt_path,
        receipt_metadata={"schema": "pgmaps-raster-revision-publication-receipt-v1",
                          "groundFootprintsChanged": False, "sourceModelsChanged": False,
                          "savedProjectsChanged": False, "groundAccuracyCertified": False,
                          "reviewedRasterCount": len(validated[0]["revisions"]),
                          "reviewedTextUpdateCount": len(validated[0].get("textUpdates", []))},
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", required=True, type=Path)
    parser.add_argument("--owner-config-file", type=Path)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.apply:
        stage, _, objects = validate_stage(args.stage)
        print(json.dumps({"validated": True, "rasters": len(stage["revisions"]), "objects": len(objects)}))
        return
    if not args.owner_config_file or not args.receipt:
        parser.error("Publication requires owner settings and a receipt path")
    if args.receipt.resolve() == args.owner_config_file.resolve():
        parser.error("Publication receipt must preserve owner settings")
    if stat.S_IMODE(args.owner_config_file.stat().st_mode) & 0o077:
        parser.error("Owner configuration must be readable only by its owner")
    result = publish(args.stage, json.loads(args.owner_config_file.read_text()), receipt_path=args.receipt)
    print(json.dumps({key: result[key] for key in ("activated", "verifiedObjectCount", "uploadedObjectCount", "afterSha256")}))


if __name__ == "__main__":
    main()
