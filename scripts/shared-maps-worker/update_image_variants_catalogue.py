"""Add verified source-image variants and native raster metadata to a private catalogue.

This owner-side command performs no network requests and changes no alignment.
Keep its inputs, outputs and receipts outside the public repository. Collection
capabilities are read from a private JSON/text file, never a command argument.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urljoin, urlparse


SHA256 = re.compile(r"^[a-fA-F0-9]{64}$")
ROLES = {"original-scan", "edit-source", "reading-preview"}
DOWNLOAD_METADATA = {
    "label", "role", "width", "height", "crs", "pixelSize", "sourceVariantId", "mimeType",
}


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def object_value(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def identifier(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 6000:
        raise ValueError(f"{label} needs a non-empty identifier")
    return value


def checksum(value: object, label: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise ValueError(f"{label} needs an exact SHA256")
    return value.lower()


def positive_integer(value: object, label: str, maximum: int = 2**53 - 1) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 < value <= maximum:
        raise ValueError(f"{label} must be a positive bounded integer")
    return value


def https_url(value: object, label: str, base: str | None = None) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 12000:
        raise ValueError(f"{label} needs an HTTPS URL")
    resolved = urljoin(base, value) if base else value
    try:
        url = urlparse(resolved)
        host = (url.hostname or "").lower()
        if (
            url.scheme != "https" or not host or url.username or url.password
            or host == "localhost" or host.endswith((".localhost", ".local"))
            or ":" in host or re.fullmatch(r"\d+(?:\.\d+){0,3}", host)
        ):
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError(f"{label} needs a public HTTPS URL without credentials") from None
    return resolved


def collection_base(value: object) -> str:
    url = https_url(value, "Collection base")
    parsed = urlparse(url)
    if parsed.query or parsed.fragment:
        raise ValueError("Collection base must not contain a query or fragment")
    if parsed.path.endswith("/catalog.json"):
        return urljoin(url, "./")
    return url if url.endswith("/") else url + "/"


def image_file(value: object, label: str, base: str) -> dict:
    image = copy.deepcopy(object_value(value, label))
    image["url"] = https_url(image.get("url"), label, base)
    for key in ("width", "height"):
        positive_integer(image.get(key), f"{label} {key}", 200_000)
    if "sha256" in image:
        checksum(image["sha256"], label)
    if "bytes" in image:
        positive_integer(image["bytes"], f"{label} byte count")
    if "mimeType" in image and (
        not isinstance(image["mimeType"], str) or not image["mimeType"].strip() or len(image["mimeType"]) > 200
    ):
        raise ValueError(f"{label} MIME type must be non-empty text up to 200 characters")
    return image


def prepared_variant(value: object, base: str) -> dict:
    variant = copy.deepcopy(object_value(value, "Prepared image variant"))
    variant_id = identifier(variant.get("id"), "Prepared image variant")
    if len(variant_id) > 200:
        raise ValueError("Prepared image-variant identifier exceeds 200 characters")
    if not isinstance(variant.get("role"), str) or variant["role"] not in ROLES:
        raise ValueError("Prepared variant has an unknown source-image role")
    identifier(variant.get("label"), "Prepared image label")
    variant["image"] = image_file(variant.get("image"), "Source image", base)
    # Prepared original identity is required even though older reading-only
    # catalogues may omit a hash. This command binds new owner-published objects.
    checksum(variant["image"].get("sha256"), "Prepared source image")
    for key in ("preview", "thumbnail"):
        if key in variant:
            variant[key] = image_file(variant[key], f"Source {key}", base)
            if any(variant[key][axis] > variant["image"][axis] for axis in ("width", "height")):
                raise ValueError("A source display derivative exceeds the source pixel dimensions")
    if "pyramid" in variant:
        pyramid = object_value(variant["pyramid"], "Source pyramid")
        if pyramid.get("format") != "pmtiles-image-v1":
            raise ValueError("Prepared source pyramid has an unsupported format")
        pyramid["url"] = https_url(pyramid.get("url"), "Source pyramid", base)
        if any(pyramid.get(axis) != variant["image"][axis] for axis in ("width", "height")):
            raise ValueError("Prepared source pyramid and image use different pixel frames")
        if isinstance(pyramid.get("tileSize"), bool) or pyramid.get("tileSize") not in (128, 256, 512, 1024):
            raise ValueError("Prepared source pyramid has an unsupported tile size")
        expected_zoom = max(0, math.ceil(math.log2(max(pyramid["width"], pyramid["height"]) / pyramid["tileSize"])))
        if isinstance(pyramid.get("maxZoom"), bool) or pyramid.get("maxZoom") != expected_zoom:
            raise ValueError("Prepared source pyramid does not retain its declared native resolution")
        if "sha256" in pyramid:
            checksum(pyramid["sha256"], "Source pyramid")
        if "bytes" in pyramid:
            positive_integer(pyramid["bytes"], "Source pyramid byte count")
    if "source" in variant:
        source = object_value(variant["source"], "Original source document")
        identifier(source.get("title"), "Original source document")
        source["url"] = https_url(source.get("url"), "Original source document", base)
        if "sha256" in source:
            checksum(source["sha256"], "Original source document")
        if "page" in source:
            page = source["page"]
            if isinstance(page, str):
                if not page.strip() or len(page) > 1000:
                    raise ValueError("Original source page label is invalid")
            else:
                positive_integer(page, "Original source page", 100_000)
    if "note" in variant and (not isinstance(variant["note"], str) or not variant["note"].strip() or len(variant["note"]) > 6000):
        raise ValueError("Prepared source note must be non-empty text up to 6000 characters")
    return variant


def downloads(record: dict) -> list[dict]:
    result = []
    if "download" in record:
        result.append(object_value(record["download"], "Native download"))
    if "downloads" in record:
        if not isinstance(record["downloads"], list):
            raise ValueError("Downloads must be an array")
        result.extend(object_value(entry, "Native download") for entry in record["downloads"])
    return result


def indexed_records(values: object, label: str) -> dict[str, dict]:
    if not isinstance(values, list):
        raise ValueError(f"{label} must be an array")
    result = {}
    for value in values:
        row = object_value(value, label)
        row_id = identifier(row.get("id"), label)
        if row_id in result:
            raise ValueError(f"{label} contains duplicate identifiers")
        result[row_id] = row
    return result


def raster_metadata(row: dict) -> dict:
    if row.get("status") != "read":
        raise ValueError("Only successfully read native headers can supply raster metadata")
    width = positive_integer(row.get("width"), "Native raster width", 200_000)
    height = positive_integer(row.get("height"), "Native raster height", 200_000)
    epsg = positive_integer(row.get("epsg"), "Native raster EPSG", 999_999)
    scale = row.get("pixelScale")
    if not isinstance(scale, list) or len(scale) < 2 or any(
        isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0
        for value in scale[:2]
    ):
        raise ValueError("Native raster inventory needs positive finite pixel scales")
    return {
        "width": width, "height": height, "crs": f"EPSG:{epsg}",
        "pixelSize": scale[:2], "mimeType": "image/tiff", "role": "rectified",
    }


def protected_snapshot(catalogue: dict) -> dict:
    """Canonical evidence that every field outside this additive change stayed intact."""
    protected = copy.deepcopy(catalogue)
    for key in ("items", "featured"):
        for record in protected.get(key, []):
            record.pop("imageVariants", None)
            for download in downloads(record):
                for field in DOWNLOAD_METADATA:
                    download.pop(field, None)
    return protected


def catalogue_diff(before: dict, after: dict) -> list[dict]:
    """Record the precise additive fields without repeating private asset URLs."""
    changes = []
    for group in ("items", "featured"):
        for old, new in zip(before.get(group, []), after.get(group, [])):
            entry = {"group": group, "id": new["id"]}
            old_variant_ids = {value["id"] for value in old.get("imageVariants", [])}
            added = [value["id"] for value in new.get("imageVariants", []) if value["id"] not in old_variant_ids]
            if added:
                entry["addedImageVariantIds"] = added
            download_changes = []
            for index, (old_download, new_download) in enumerate(zip(downloads(old), downloads(new))):
                fields = [
                    field for field in sorted(DOWNLOAD_METADATA)
                    if old_download.get(field) != new_download.get(field)
                ]
                if fields:
                    download_changes.append({
                        "index": index, "fields": fields,
                        "before": {key: old_download[key] for key in fields if key in old_download},
                        "after": {key: new_download[key] for key in fields if key in new_download},
                    })
            if download_changes:
                entry["downloads"] = download_changes
            if len(entry) > 2:
                changes.append(entry)
    return changes


def attach_variant(record: dict, variant: dict) -> bool:
    variants = record.setdefault("imageVariants", [])
    if not isinstance(variants, list):
        raise ValueError("Existing image variants must be an array")
    matches = [value for value in variants if isinstance(value, dict) and value.get("id") == variant["id"]]
    if len(matches) > 1 or (matches and matches[0] != variant):
        raise ValueError("An image-variant identifier is already bound to different or ambiguous source metadata")
    if matches:
        return False
    if len(variants) >= 64:
        raise ValueError("A record cannot exceed 64 image variants")
    variants.append(copy.deepcopy(variant))
    return True


def bind_source_frame(record: dict, native_sha: str, variant: dict, evidence: object) -> None:
    proof = object_value(evidence, "Source-frame evidence")
    if proof.get("kind") != "published-project-source":
        raise ValueError("Source-frame evidence must name the published-project-source method")
    source_sha = checksum(proof.get("expectedSourceSha256"), "Expected project source")
    project = object_value(record.get("georeferenceProject"), "Published alignment project")
    if (
        checksum(project.get("nativeSha256"), "Published project native raster") != native_sha
        or checksum(project.get("sourceSha256"), "Published project source") != source_sha
        or checksum(variant["image"].get("sha256"), "Prepared source image") != source_sha
        or variant["role"] == "reading-preview"
    ):
        raise ValueError("Published project does not verify this exact native-raster/source-image frame")


def assign_source_variant(download: dict, variant_id: str) -> None:
    if download.get("sourceVariantId") not in (None, variant_id):
        raise ValueError("A rectified download is ambiguously bound to two source-image variants")
    download["sourceVariantId"] = variant_id


def update_catalogue(catalogue: dict, inventory: list, bindings: dict, manifest_dir: Path, base_url: str | None = None) -> tuple[dict, dict]:
    before = object_value(catalogue, "Catalogue")
    if before.get("schema") != "raster-catalog-v1":
        raise ValueError("Only raster-catalog-v1 catalogues are supported")
    manifest = object_value(bindings, "Bindings manifest")
    if manifest.get("schema") != "pgmaps-source-variant-bindings-v1" or not isinstance(manifest.get("bindings"), list):
        raise ValueError("Use a pgmaps-source-variant-bindings-v1 manifest with a bindings array")
    base = collection_base(base_url if base_url is not None else manifest.get("collectionBase"))
    after = copy.deepcopy(before)
    items = indexed_records(after.get("items"), "Native records")
    featured = indexed_records(after.get("featured", []), "Featured records")
    inventory_ids = indexed_records(inventory, "Native inventory")
    if not items:
        raise ValueError("Catalogue contains no native records")
    by_sha = {}
    for row in inventory_ids.values():
        sha = checksum(row.get("sha256"), "Inventory native raster")
        metadata = raster_metadata(row)
        if sha in by_sha and metadata != by_sha[sha]:
            raise ValueError("One native SHA has contradictory inventory dimensions or sampling")
        by_sha[sha] = metadata
    counts = {
        "nativeRecords": len(items), "featuredRecords": len(featured),
        "nativeDownloadsEnriched": 0, "featuredDownloadsEnriched": 0,
        "featuredDownloadsWithoutInventory": 0, "nativeVariantAttachmentsAdded": 0,
        "featuredVariantAttachmentsAdded": 0, "verifiedNativeSourceFrames": 0,
    }
    native_sha_by_id = {}
    for record_id, record in items.items():
        if record_id not in inventory_ids:
            raise ValueError("A native record has no exact-ID header inventory entry")
        row = inventory_ids[record_id]
        expected_sha = checksum(row.get("sha256"), "Inventory native raster")
        record_downloads = downloads(record)
        if not record_downloads or any(checksum(value.get("sha256"), "Native download") != expected_sha for value in record_downloads):
            raise ValueError("Native catalogue identity differs from its header inventory; refresh the inventory")
        native_sha_by_id[record_id] = expected_sha
        for download in record_downloads:
            if "nativeFileBytes" in row and "bytes" in download and row["nativeFileBytes"] != download["bytes"]:
                raise ValueError("Native catalogue size differs from its header inventory")
            download.update(copy.deepcopy(by_sha[expected_sha]))
            download.setdefault("label", "Rectified GeoTIFF")
            counts["nativeDownloadsEnriched"] += 1
    featured_hashes = {}
    for record_id, record in featured.items():
        hashes = set()
        for download in downloads(record):
            sha = checksum(download.get("sha256"), "Featured native download")
            hashes.add(sha)
            if sha in by_sha:
                download.update(copy.deepcopy(by_sha[sha]))
                download.setdefault("label", "Rectified GeoTIFF")
                counts["featuredDownloadsEnriched"] += 1
            else:
                counts["featuredDownloadsWithoutInventory"] += 1
        featured_hashes[record_id] = hashes
    results = []
    verified_frames = set()
    for entry in manifest["bindings"]:
        binding = object_value(entry, "Variant binding")
        path_value = identifier(binding.get("variantPath"), "Prepared variant path")
        path = (manifest_dir / path_value).resolve()
        variant = prepared_variant(json.loads(path.read_text()), base)
        targets = binding.get("targets")
        if not isinstance(targets, list) or not targets:
            raise ValueError("Every variant binding needs explicit native targets")
        target_hashes = set()
        bound_ids = []
        verified_hashes = set()
        for target_value in targets:
            target = object_value(target_value, "Native target")
            target_id = identifier(target.get("id"), "Native target")
            expected_sha = checksum(target.get("expectedNativeSha256"), "Expected native target")
            if target_id in bound_ids:
                raise ValueError("A variant binding repeats a native target")
            if target_id not in items or native_sha_by_id[target_id] != expected_sha:
                raise ValueError("Native target is missing or its expected SHA is stale")
            record = items[target_id]
            if attach_variant(record, variant):
                counts["nativeVariantAttachmentsAdded"] += 1
            if "sourceFrame" in target:
                bind_source_frame(record, expected_sha, variant, target["sourceFrame"])
                for download in downloads(record):
                    assign_source_variant(download, variant["id"])
                verified_frames.add((target_id, variant["id"]))
                verified_hashes.add(expected_sha)
            target_hashes.add(expected_sha)
            bound_ids.append(target_id)
        explicit_featured = binding.get("featuredIds", [])
        if not isinstance(explicit_featured, list) or any(not isinstance(value, str) for value in explicit_featured):
            raise ValueError("Explicit featuredIds must be an array of identifiers")
        if len(set(explicit_featured)) != len(explicit_featured):
            raise ValueError("Explicit featured identifiers must be unique")
        selected_featured = set(explicit_featured)
        for record_id in explicit_featured:
            if record_id not in featured or not featured_hashes[record_id].intersection(target_hashes):
                raise ValueError("Explicit featured target does not contain an exact bound native SHA")
        auto_featured = binding.get("includeFeaturedByNativeSha256", False)
        if not isinstance(auto_featured, bool):
            raise ValueError("includeFeaturedByNativeSha256 must be a boolean")
        if auto_featured:
            selected_featured.update(record_id for record_id, hashes in featured_hashes.items() if hashes.intersection(target_hashes))
        for record_id in sorted(selected_featured):
            record = featured[record_id]
            if attach_variant(record, variant):
                counts["featuredVariantAttachmentsAdded"] += 1
            for download in downloads(record):
                if checksum(download.get("sha256"), "Featured download") in verified_hashes:
                    assign_source_variant(download, variant["id"])
        results.append({
            "variantId": variant["id"], "role": variant["role"], "imageSha256": variant["image"]["sha256"],
            "nativeIds": bound_ids, "featuredIds": sorted(selected_featured),
            "verifiedSourceFrameNativeShas": sorted(verified_hashes),
        })
    before_protected = protected_snapshot(before)
    if protected_snapshot(after) != before_protected:
        raise AssertionError("An unrelated catalogue field changed")
    counts["verifiedNativeSourceFrames"] = len(verified_frames)
    counts["nativeRecordsWithImageVariants"] = sum(bool(record.get("imageVariants")) for record in items.values())
    counts["featuredRecordsWithImageVariants"] = sum(bool(record.get("imageVariants")) for record in featured.values())
    changes = catalogue_diff(before, after)
    counts["recordsChanged"] = len(changes)
    counts["downloadsChanged"] = sum(len(entry.get("downloads", [])) for entry in changes)
    receipt = {
        "schema": "pgmaps-source-variant-catalogue-receipt-v1",
        "beforeCanonicalSha256": digest(before), "afterCanonicalSha256": digest(after),
        "protectedCanonicalSha256": digest(before_protected),
        "preserved": ["assets", "bounds", "caveats", "confidence", "project pointers", "existing download URLs/hashes/bytes", "all unrelated catalogue fields"],
        "changedFields": ["imageVariants", "download metadata", "verified sourceVariantId links"],
        "counts": counts, "bindings": results, "changes": changes,
        "scope": "Additive source/derivative associations and header metadata only. No reprojection, georeferencing fit, geographic asset change, publication or network request.",
    }
    return after, receipt


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as handle:
        temporary = Path(handle.name)
        try:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    os.replace(temporary, path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalogue", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--bindings", type=Path, required=True)
    parser.add_argument("--collection-base-file", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    inputs = {args.catalogue.resolve(), args.inventory.resolve(), args.bindings.resolve()}
    if args.collection_base_file:
        inputs.add(args.collection_base_file.resolve())
    if args.output.resolve() in inputs or args.receipt.resolve() in inputs or args.output.resolve() == args.receipt.resolve():
        raise ValueError("Output and receipt must be separate files and preserve every input")
    before_bytes = args.catalogue.read_bytes()
    inventory_bytes = args.inventory.read_bytes()
    bindings_bytes = args.bindings.read_bytes()
    manifest = object_value(json.loads(bindings_bytes), "Bindings manifest")
    for binding in manifest.get("bindings", []):
        if isinstance(binding, dict) and isinstance(binding.get("variantPath"), str):
            inputs.add((args.bindings.resolve().parent / binding["variantPath"]).resolve())
    if args.output.resolve() in inputs or args.receipt.resolve() in inputs:
        raise ValueError("Output and receipt must preserve every prepared variant input")
    after, receipt = update_catalogue(
        json.loads(before_bytes), json.loads(inventory_bytes), manifest, args.bindings.resolve().parent,
        args.collection_base_file.read_text().strip() if args.collection_base_file else None,
    )
    after_bytes = json_bytes(after)
    receipt.update({
        "beforeFileSha256": hashlib.sha256(before_bytes).hexdigest(),
        "afterFileSha256": hashlib.sha256(after_bytes).hexdigest(),
        "inventoryFileSha256": hashlib.sha256(inventory_bytes).hexdigest(),
        "bindingsFileSha256": hashlib.sha256(bindings_bytes).hexdigest(),
    })
    atomic_write(args.output, after_bytes)
    atomic_write(args.receipt, json_bytes(receipt))
    print(json.dumps({"prepared": True, "counts": receipt["counts"], "catalogueSha256": receipt["afterFileSha256"]}))


if __name__ == "__main__":
    main()
