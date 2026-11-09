"""Prepare a verified source image and display derivatives for the shared viewer.

This command never downloads, publishes, georeferences, or modifies an input.
Keep its output and real metadata outside the public repository. PMTiles here
addresses a flat image grid, not geographic XYZ map coordinates.
Requires Pillow with WebP support and pmtiles==3.8.1.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import struct
import tempfile
from urllib.parse import urlparse

from PIL import Image, ImageCms, features
from pmtiles.reader import MmapSource, Reader
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import write

MAX_OBJECT_BYTES = 95_000_000
MAX_SOURCE_PIXELS = 200_000_000
MAX_EXPLICIT_SOURCE_PIXELS = 1_000_000_000
MAX_SOURCE_SIDE = 200_000
DEFAULT_TILE_SIZE = 512
DEFAULT_THUMBNAIL_SIDE = 480
DEFAULT_PREVIEW_SIDE = 1800
DEFAULT_QUALITY = 92
ROLES = {"original-scan", "edit-source", "reading-preview"}
FORMAT_INFO = {
    "JPEG": (".jpg", "image/jpeg"),
    "PNG": (".png", "image/png"),
    "TIFF": (".tif", "image/tiff"),
}
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


def sha256(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def check_object_size(path: Path) -> None:
    if not 0 < path.stat().st_size < MAX_OBJECT_BYTES:
        raise ValueError(f"Object must be smaller than {MAX_OBJECT_BYTES:,} bytes: {path.name}")


def level_size(width: int, height: int, max_zoom: int, zoom: int) -> tuple[int, int]:
    if not 0 <= zoom <= max_zoom:
        raise ValueError("Pyramid level is outside its range")
    factor = 1 << (max_zoom - zoom)
    return ((width + factor - 1) // factor, (height + factor - 1) // factor)


def level_image(image: Image.Image, max_zoom: int, zoom: int) -> Image.Image:
    """Keep a power-of-two image-pixel grid, with partial edge cells transparent."""
    if zoom == max_zoom:
        return image
    factor = 1 << (max_zoom - zoom)
    width, height = level_size(*image.size, max_zoom, zoom)
    padded_size = (width * factor, height * factor)
    if padded_size == image.size:
        return image.resize((width, height), Image.Resampling.LANCZOS)
    # Resize the exact grid extent, rather than stretching width/ceil(width/factor).
    # This preserves the original-pixel coordinates used by the detail viewer.
    padded = Image.new("RGBA", padded_size)
    try:
        padded.paste(image, (0, 0))
        return padded.resize((width, height), Image.Resampling.LANCZOS)
    finally:
        padded.close()


def webp_bytes(image: Image.Image, quality: int, icc_profile: bytes | None) -> bytes:
    output = io.BytesIO()
    options = {"format": "WEBP", "quality": quality, "method": 4, "exact": True}
    if icc_profile:
        options["icc_profile"] = icc_profile
    image.save(output, **options)
    return output.getvalue()


def inspect_source(source: Path, max_source_pixels: int, allow_cmyk_display: bool) -> dict:
    """Inspect headers without decoding large images or silently changing frames."""
    if not 1 <= max_source_pixels <= MAX_EXPLICIT_SOURCE_PIXELS:
        raise ValueError(f"Pixel budget must be between 1 and {MAX_EXPLICIT_SOURCE_PIXELS:,}")
    previous_limit = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = MAX_EXPLICIT_SOURCE_PIXELS
    try:
        with Image.open(source) as opened:
            if opened.format not in FORMAT_INFO:
                raise ValueError("Use a PNG, JPEG or TIFF image; extract PDF pages first")
            width, height = opened.size
            if not width or not height or max(width, height) > MAX_SOURCE_SIDE or width * height > max_source_pixels:
                raise ValueError("Source image exceeds the explicit pixel budget; inspect it before increasing --max-source-pixels")
            if getattr(opened, "n_frames", 1) != 1:
                raise ValueError("Extract an explicitly identified page from this multi-frame image first")
            orientation = int(opened.getexif().get(274, 1))
            if orientation != 1:
                raise ValueError("Source has non-native EXIF orientation; prepare an explicitly documented upright source first")
            if opened.mode == "CMYK" and not allow_cmyk_display:
                raise ValueError("CMYK requires --allow-cmyk-display for an explicit display colour conversion")
            if opened.mode not in {"1", "L", "LA", "P", "RGB", "RGBA", "CMYK"}:
                raise ValueError("Source needs an explicit colour conversion or numeric display stretch before preparation")
            mode = "RGBA" if opened.mode in {"RGBA", "LA"} or "transparency" in opened.info else "RGB"
            return {
                "format": opened.format,
                "width": width,
                "height": height,
                "sourceMode": opened.mode,
                "displayMode": mode,
                "iccProfile": opened.info.get("icc_profile"),
                "transparency": opened.info.get("transparency"),
                "progressiveJpeg": bool(opened.info.get("progressive") or opened.info.get("progression")),
            }
    finally:
        Image.MAX_IMAGE_PIXELS = previous_limit


def display_image(source: Path, source_info: dict) -> tuple[Image.Image, dict]:
    """Decode the bounded in-memory path; CMYK conversion affects displays only."""
    info = dict(source_info)
    previous_limit = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = MAX_SOURCE_PIXELS
    try:
        with Image.open(source) as opened:
            if opened.mode != "CMYK":
                return opened.convert(info["displayMode"]), info
            if info["iccProfile"]:
                source_profile = ImageCms.ImageCmsProfile(io.BytesIO(info["iccProfile"]))
                target_profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
                decoded = ImageCms.profileToProfile(opened, source_profile, target_profile, outputMode="RGB")
                info["colourConversion"] = {
                    "method": "LittleCMS embedded CMYK ICC profile to sRGB; rendering intent perceptual",
                    "sourceIccProfileSha256": hashlib.sha256(info["iccProfile"]).hexdigest(),
                    "calibrated": True,
                }
                # LittleCMS stamps a newly generated profile with the current
                # time. Canonicalize only its header date and optional ID so
                # identical colour transforms produce deterministic WebP bytes.
                profile_bytes = bytearray(target_profile.tobytes())
                profile_bytes[24:36] = struct.pack(">6H", 2000, 1, 1, 0, 0, 0)
                profile_bytes[84:100] = bytes(16)
                info["iccProfile"] = bytes(profile_bytes)
            else:
                decoded = opened.convert("RGB")
                info["colourConversion"] = {
                    "method": "Pillow CMYK to RGB without an embedded ICC profile; uncalibrated display conversion",
                    "calibrated": False,
                }
            info["displayMode"] = "RGB"
            return decoded, info
    finally:
        Image.MAX_IMAGE_PIXELS = previous_limit


def validate_metadata(metadata: dict) -> dict:
    if not isinstance(metadata, dict):
        raise ValueError("Variant metadata must be an object")
    variant_id = metadata.get("id")
    if not isinstance(variant_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}", variant_id):
        raise ValueError("Supply a stable image-variant id")
    label = metadata.get("label")
    if not isinstance(label, str) or not label.strip() or len(label) > 6000:
        raise ValueError("Supply a non-empty image-variant label")
    if metadata.get("role") not in ROLES:
        raise ValueError("Role must be original-scan, edit-source or reading-preview")
    result = {"id": variant_id, "label": label, "role": metadata["role"]}
    if "note" in metadata:
        if not isinstance(metadata["note"], str) or len(metadata["note"]) > 6000:
            raise ValueError("Variant note must be text up to 6,000 characters")
        result["note"] = metadata["note"]
    if "source" in metadata:
        source = metadata["source"]
        if not isinstance(source, dict) or not isinstance(source.get("title"), str) or not source["title"].strip():
            raise ValueError("Source document needs a title")
        url = urlparse(source.get("url", ""))
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            raise ValueError("Source document needs an HTTPS URL without credentials")
        clean_source = {"title": source["title"], "url": source["url"]}
        if "page" in source:
            page = source["page"]
            if not isinstance(page, (str, int)) or isinstance(page, bool) or (isinstance(page, int) and page < 1):
                raise ValueError("Source page must be a positive number or explicit page label")
            clean_source["page"] = page
        if "sha256" in source:
            if not isinstance(source["sha256"], str) or not SHA256_RE.fullmatch(source["sha256"]):
                raise ValueError("Source document hash must be a lowercase SHA-256")
            clean_source["sha256"] = source["sha256"]
        result["source"] = clean_source
    return result


def prepare_image_variant(
    source: Path | str,
    output_dir: Path | str,
    expected_sha256: str,
    metadata: dict,
    *,
    tile_size: int = DEFAULT_TILE_SIZE,
    thumbnail_side: int = DEFAULT_THUMBNAIL_SIDE,
    preview_side: int = DEFAULT_PREVIEW_SIDE,
    quality: int = DEFAULT_QUALITY,
    max_source_pixels: int = MAX_SOURCE_PIXELS,
    streaming: bool = False,
    allow_cmyk_display: bool = False,
) -> dict:
    """Prepare and verify all local objects, then atomically write ready manifests."""
    source, output_dir = Path(source).resolve(), Path(output_dir).resolve()
    variant = validate_metadata(metadata)
    if not SHA256_RE.fullmatch(expected_sha256 or ""):
        raise ValueError("An exact lowercase source SHA-256 is required")
    if tile_size not in {256, 512, 1024}:
        raise ValueError("Tile size must be 256, 512 or 1024")
    if not 64 <= thumbnail_side <= preview_side <= 4096 or not 1 <= quality <= 100:
        raise ValueError("Invalid preview dimensions or WebP quality")
    if not features.check("webp"):
        raise ValueError("This Pillow installation does not support WebP")
    check_object_size(source)
    actual_sha256 = sha256(source)
    if actual_sha256 != expected_sha256:
        raise ValueError("Input bytes do not match the expected source SHA-256")
    source_info = inspect_source(source, max_source_pixels, allow_cmyk_display)
    width, height = source_info["width"], source_info["height"]
    use_streaming = streaming or width * height > MAX_SOURCE_PIXELS
    if use_streaming and source_info["sourceMode"] == "CMYK":
        raise ValueError("CMYK sources above the in-memory pixel budget need separately documented bounded colour conversion")
    max_zoom = max(0, math.ceil(math.log2(max(width, height) / tile_size)))
    suffix, mime_type = FORMAT_INFO[source_info["format"]]
    recipe = {
        "schema": "pgmaps-image-variant-recipe-v1",
        "sourceSha256": actual_sha256,
        "width": width,
        "height": height,
        "tileSize": tile_size,
        "maxZoom": max_zoom,
        "thumbnailMaxSide": thumbnail_side,
        "previewMaxSide": preview_side,
        "encoding": {"format": "webp", "quality": quality, "lossless": False, "method": 4},
        "resampling": "Lanczos; exact power-of-two grid with transparent partial edge cells",
        "sourceMode": source_info["sourceMode"],
        "displayMode": source_info["displayMode"],
        "orientation": "native encoded pixel orientation; nontrivial EXIF orientation is rejected",
        "pillowVersion": Image.__version__,
        "webpVersion": features.version("webp"),
        "pmtilesVersion": importlib.metadata.version("pmtiles"),
        "maxSourcePixels": max_source_pixels,
        "decoder": "Pillow; bounded in-memory preparation",
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    uploads = []
    image = None
    streamed = None
    try:
        with tempfile.TemporaryDirectory(prefix=".image-variant-", dir=output_dir) as temp:
            staged = Path(temp)

            def stage_object(path: Path, folder: str, extension: str, content_type: str) -> dict:
                check_object_size(path)
                digest = sha256(path)
                key = f"{folder}/{digest}{extension}"
                target = staged/key
                target.parent.mkdir(parents=True, exist_ok=True)
                if path != target:
                    shutil.copyfile(path, target)
                if sha256(target) != digest:
                    raise ValueError("Object changed while copying its verified bytes")
                check_object_size(target)
                entry = {"key": key, "path": key, "sha256": digest, "bytes": target.stat().st_size, "contentType": content_type}
                uploads.append(entry)
                return {"url": key, "sha256": digest, "bytes": entry["bytes"]}

            original = stage_object(source, "raw", suffix, mime_type)
            if original["sha256"] != expected_sha256:
                raise ValueError("Source changed while preparing the exact copy")
            variant["image"] = {**original, "width": width, "height": height, "mimeType": mime_type}
            # Decode the verified staged copy, so a concurrent source-file edit
            # cannot make displays differ from the downloadable input.
            if use_streaming:
                from image_variant_streaming import StreamedImage
                streamed = StreamedImage(staged/original["url"], staged, source_info, max_zoom)
                recipe.update(streamed.recipe)
            else:
                image, source_info = display_image(staged/original["url"], source_info)
                if "colourConversion" in source_info:
                    recipe["colourConversion"] = source_info["colourConversion"]
                    recipe["littleCmsVersion"] = features.version("littlecms2")
                    conversion = "an embedded ICC profile to sRGB" if source_info["colourConversion"]["calibrated"] else "an uncalibrated CMYK-to-RGB conversion"
                    display_note = f"Display previews and tiles use {conversion}; the original download retains its CMYK bytes."
                    variant["note"] = " ".join(filter(None, (variant.get("note"), display_note)))
                    if len(variant["note"]) > 6000:
                        raise ValueError("Shorten the source note to leave room for the explicit CMYK display-conversion note")
            if source_info["iccProfile"]:
                recipe["iccProfileSha256"] = hashlib.sha256(source_info["iccProfile"]).hexdigest()
            for field, max_side in (("thumbnail", thumbnail_side), ("preview", preview_side)):
                ratio = min(1, max_side / max(width, height))
                size = (max(1, round(width*ratio)), max(1, round(height*ratio)))
                display = streamed.preview(size) if streamed else image.resize(size, Image.Resampling.LANCZOS) if size != image.size else image
                try:
                    path = staged/f"{field}.webp"
                    path.write_bytes(webp_bytes(display, quality, source_info["iccProfile"]))
                    variant[field] = {**stage_object(path, "previews", ".webp", "image/webp"), "width": size[0], "height": size[1], "mimeType": "image/webp"}
                finally:
                    if display is not image:
                        display.close()

            pyramid_file = staged/"pyramid.pmtiles"
            expected_tiles = []
            pyramid_metadata = {
                "kind": "pgmaps-image-pyramid-v1",
                "sourceSha256": expected_sha256,
                "width": width,
                "height": height,
                "tileSize": tile_size,
                "maxZoom": max_zoom,
                "format": "webp",
                "encoding": recipe["encoding"],
                "coordinates": "image pixels; origin top-left; not geographic map tiles",
            }
            if "colourConversion" in recipe:
                pyramid_metadata["colourConversion"] = recipe["colourConversion"]
            header = {"tile_type": TileType.WEBP, "tile_compression": Compression.NONE,
                      "min_lon_e7": 0, "min_lat_e7": 0, "max_lon_e7": 0, "max_lat_e7": 0,
                      "center_lon_e7": 0, "center_lat_e7": 0, "center_zoom": 0}
            with write(pyramid_file) as writer:
                for zoom in range(max_zoom+1):
                    level = None if streamed else level_image(image, max_zoom, zoom)
                    try:
                        level_width, level_height = level_size(width, height, max_zoom, zoom)
                        nx, ny = math.ceil(level_width/tile_size), math.ceil(level_height/tile_size)
                        coordinates = sorted(((x, y) for x in range(nx) for y in range(ny)), key=lambda xy: zxy_to_tileid(zoom, *xy))
                        for x, y in coordinates:
                            tile = streamed.tile(zoom, x, y, tile_size) if streamed else level.crop((x*tile_size, y*tile_size, min((x+1)*tile_size, level_width), min((y+1)*tile_size, level_height)))
                            try:
                                data = webp_bytes(tile, quality, source_info["iccProfile"])
                                writer.write_tile(zxy_to_tileid(zoom, x, y), data)
                                expected_tiles.append((zoom, x, y, tile.size, hashlib.sha256(data).digest()))
                            finally:
                                tile.close()
                    finally:
                        if level is not None and level is not image:
                            level.close()
                writer.finalize(header, pyramid_metadata)
            check_object_size(pyramid_file)
            with pyramid_file.open("rb") as handle:
                reader = Reader(MmapSource(handle))
                if reader.metadata() != pyramid_metadata:
                    raise ValueError("Pyramid metadata did not round-trip")
                h = reader.header()
                if h["min_zoom"] != 0 or h["max_zoom"] != max_zoom or h["addressed_tiles_count"] != len(expected_tiles):
                    raise ValueError("Pyramid tile directory did not round-trip")
                for zoom, x, y, size, digest in expected_tiles:
                    data = reader.get(zoom, x, y)
                    if data is None or hashlib.sha256(data).digest() != digest:
                        raise ValueError("Pyramid tile bytes did not round-trip")
                    with Image.open(io.BytesIO(data)) as decoded:
                        if decoded.size != size:
                            raise ValueError("Pyramid tile dimensions did not round-trip")
            variant["pyramid"] = {**stage_object(pyramid_file, "sheets", ".pmtiles", "application/vnd.pmtiles"),
                                  "format": "pmtiles-image-v1", "width": width, "height": height,
                                  "tileSize": tile_size, "maxZoom": max_zoom}
            # Two equal preview sizes may intentionally reference one immutable object.
            uploads = list({item["key"]: item for item in uploads}.values())
            receipt = {"schema": "pgmaps-image-variant-upload-v1", "sourceSha256": expected_sha256,
                       "variantId": variant["id"], "objects": uploads, "recipe": recipe,
                       "validation": {"exactSourceCopy": True, "tileCount": len(expected_tiles), "everyTileReadBack": True},
                       "catalogueChanges": "Attach the variant to the exact map/panel record; this preparation does not change georeferencing."}
            # Stage all objects first; only ready manifests advertise a complete result.
            for entry in uploads:
                destination = output_dir/entry["key"]
                destination.parent.mkdir(parents=True, exist_ok=True)
                if destination.exists():
                    if sha256(destination) != entry["sha256"]:
                        raise ValueError("An existing immutable object differs from its content hash")
                else:
                    os.replace(staged/entry["key"], destination)
            for name, value in (("variant.json", variant), ("upload-manifest.json", receipt)):
                temporary = staged/name
                temporary.write_bytes(json_bytes(value))
                os.replace(temporary, output_dir/name)
            return {"variant": variant, "manifest": receipt}
    finally:
        if image is not None:
            image.close()
        if streamed is not None:
            streamed.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--sha256", required=True, help="Expected SHA-256 of the exact input image")
    parser.add_argument("--metadata", required=True, type=Path, help="Private JSON containing id, label, role and optional source/note")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--tile-size", type=int, default=DEFAULT_TILE_SIZE)
    parser.add_argument("--thumbnail-side", type=int, default=DEFAULT_THUMBNAIL_SIDE)
    parser.add_argument("--preview-side", type=int, default=DEFAULT_PREVIEW_SIDE)
    parser.add_argument("--quality", type=int, default=DEFAULT_QUALITY)
    parser.add_argument("--max-source-pixels", type=int, default=MAX_SOURCE_PIXELS,
                        help="Explicit verified-source pixel budget (default 200 million, maximum 1 billion); larger sources use bounded GDAL decoding")
    parser.add_argument("--streaming", action="store_true", help="Use the bounded rasterio/GDAL display cache even for a small source")
    parser.add_argument("--allow-cmyk-display", action="store_true", help="Allow documented ICC-to-sRGB or uncalibrated CMYK display conversion; preserve the original bytes")
    args = parser.parse_args()
    result = prepare_image_variant(args.input, args.output_dir, args.sha256, json.loads(args.metadata.read_text()),
                                   tile_size=args.tile_size, thumbnail_side=args.thumbnail_side,
                                   preview_side=args.preview_side, quality=args.quality,
                                   max_source_pixels=args.max_source_pixels, streaming=args.streaming,
                                   allow_cmyk_display=args.allow_cmyk_display)
    print(json.dumps({"prepared": True, "variantId": result["variant"]["id"],
                      "objects": len(result["manifest"]["objects"]),
                      "bytes": sum(item["bytes"] for item in result["manifest"]["objects"]),
                      "tiles": result["manifest"]["validation"]["tileCount"]}))


if __name__ == "__main__":
    main()
