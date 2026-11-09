"""Boundary and provenance checks for the source-reading image pyramid."""

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw
from pmtiles.reader import MmapSource, Reader

import prepare_image_variants as pipeline


class ImageVariantsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root/"asymmetric.png"
        image = Image.new("RGBA", (1025, 769), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, 511, 511), fill=(230, 30, 20, 255))
        draw.rectangle((512, 0, 1023, 511), fill=(20, 210, 40, 255))
        draw.rectangle((0, 512, 511, 768), fill=(20, 40, 220, 255))
        draw.rectangle((512, 512, 1023, 768), fill=(230, 210, 20, 255))
        draw.rectangle((200, 200, 250, 250), fill=(0, 0, 0, 0))
        draw.line((1024, 0, 1024, 768), fill=(255, 0, 255, 255))
        image.save(self.source)
        image.close()
        self.digest = pipeline.sha256(self.source)
        self.metadata = {"id": "synthetic-page-2", "label": "Synthetic original, page 2", "role": "original-scan",
                         "source": {"title": "Synthetic multi-page document", "url": "https://example.org/document.pdf", "page": 2, "sha256": "a"*64}}

    def tearDown(self):
        self.temp.cleanup()

    def prepare(self, destination="out", **kwargs):
        return pipeline.prepare_image_variant(self.source, self.root/destination, self.digest, self.metadata, **kwargs)

    def test_native_edge_cells_and_source_identity(self):
        original = self.source.read_bytes()
        result = self.prepare()
        variant, manifest = result["variant"], result["manifest"]
        self.assertEqual(self.source.read_bytes(), original)
        self.assertEqual((self.root/"out"/variant["image"]["url"]).read_bytes(), original)
        self.assertEqual((variant["image"]["width"], variant["image"]["height"]), (1025, 769))
        self.assertEqual(variant["source"]["page"], 2)
        self.assertEqual(variant["source"]["sha256"], "a"*64)
        self.assertEqual(variant["image"]["sha256"], self.digest)
        self.assertEqual(variant["thumbnail"]["width"], 480)
        self.assertEqual(variant["preview"]["width"], 1025)  # Never upscale.
        self.assertEqual(variant["pyramid"]["maxZoom"], 2)
        self.assertEqual(manifest["validation"]["tileCount"], 9)  # 1 + 2 + 6, not a padded square.
        for entry in manifest["objects"]:
            obj = self.root/"out"/entry["path"]
            self.assertEqual(entry["bytes"], obj.stat().st_size)
            self.assertEqual(entry["sha256"], pipeline.sha256(obj))
            self.assertIn(entry["sha256"], entry["key"])
        with (self.root/"out"/variant["pyramid"]["url"]).open("rb") as handle:
            reader = Reader(MmapSource(handle))
            self.assertEqual(reader.metadata()["kind"], "pgmaps-image-pyramid-v1")
            self.assertEqual(reader.metadata()["sourceSha256"], self.digest)
            self.assertEqual(reader.header()["min_zoom"], 0)
            self.assertEqual(reader.header()["max_lon_e7"], 0)  # Deliberately not a geographic overlay.
            self.assertIsNone(reader.get(2, 3, 0))
            with Image.open(io.BytesIO(reader.get(2, 2, 1))) as edge:
                self.assertEqual(edge.size, (1, 257))
                pixel = edge.convert("RGB").getpixel((0, 128))
                self.assertLess(max(abs(a-b) for a,b in zip(pixel, (255, 0, 255))), 8)
            with Image.open(io.BytesIO(reader.get(2, 0, 0))) as tile:
                self.assertEqual(tile.convert("RGBA").getpixel((225, 225))[3], 0)
            with Image.open(io.BytesIO(reader.get(1, 1, 0))) as edge:
                self.assertEqual(edge.size, (1, 385))
            with Image.open(io.BytesIO(reader.get(0, 0, 0))) as overview:
                self.assertEqual(overview.size, (257, 193))

    def test_overview_sampling_keeps_exact_power_of_two_frame(self):
        # A one-pixel partial edge is not expanded to an opaque full output cell.
        image = Image.new("RGBA", (513, 257), (255, 0, 255, 255))
        try:
            reduced = pipeline.level_image(image, 1, 0)
            try:
                self.assertEqual(reduced.size, (257, 129))
                self.assertGreater(reduced.getpixel((256, 50))[3], 80)
                self.assertLess(reduced.getpixel((256, 50))[3], 180)
                self.assertEqual(reduced.getpixel((100, 50))[3], 255)
            finally:
                reduced.close()
        finally:
            image.close()

    def test_streaming_retains_native_pixels_transparency_and_partial_grid(self):
        # Force the bounded decoder on a small fixture: no full Pillow decode.
        with patch.object(pipeline, "display_image", side_effect=AssertionError("Unbounded decoder used")):
            result = self.prepare(streaming=True)
        variant, manifest = result["variant"], result["manifest"]
        self.assertEqual((self.root/"out"/variant["image"]["url"]).read_bytes(), self.source.read_bytes())
        self.assertEqual(manifest["recipe"]["gdalCacheMaxBytes"], 64*1024*1024)
        self.assertEqual(manifest["validation"]["tileCount"], 9)
        self.assertIn("native level is not resampled", manifest["recipe"]["resampling"])
        with (self.root/"out"/variant["pyramid"]["url"]).open("rb") as handle:
            reader = Reader(MmapSource(handle))
            self.assertEqual(reader.metadata()["sourceSha256"], self.digest)
            with Image.open(io.BytesIO(reader.get(2, 2, 1))) as edge:
                self.assertEqual(edge.size, (1, 257))
                pixel = edge.convert("RGBA").getpixel((0, 128))
                self.assertLess(max(abs(a-b) for a,b in zip(pixel, (255, 0, 255, 255))), 8)
            with Image.open(io.BytesIO(reader.get(2, 0, 0))) as tile:
                self.assertEqual(tile.convert("RGBA").getpixel((225, 225))[3], 0)
            with Image.open(io.BytesIO(reader.get(1, 1, 0))) as edge:
                self.assertEqual(edge.size, (1, 385))
                # One native pixel occupies half a factor-2 overview cell.
                self.assertEqual(edge.convert("RGBA").getpixel((0, 100))[3], 128)
            with Image.open(io.BytesIO(reader.get(0, 0, 0))) as overview:
                self.assertEqual(overview.size, (257, 193))
                self.assertEqual(overview.convert("RGBA").getpixel((256, 100))[3], 64)
        self.assertFalse(any((self.root/"out").glob(".image-variant-*")))
        second = self.prepare("again", streaming=True)
        self.assertEqual(result, second)

    def test_streaming_palette_and_bilevel_images_keep_colours(self):
        for mode in ("P", "1"):
            with self.subTest(mode=mode):
                image = Image.new(mode, (513, 257))
                if mode == "P":
                    image.putpalette([255, 0, 255, 0, 255, 0] + [0]*762)
                    image.paste(1, (0, 0, 256, 257))
                    image.info["transparency"] = 1
                    filename = self.root/"palette.png"
                    expected = (255, 0, 255, 255)
                else:
                    image.paste(1, (256, 0, 513, 257))
                    filename = self.root/"bilevel.tif"
                    expected = (255, 255, 255, 255)
                image.save(filename)
                image.close()
                destination = self.root/f"mode-{mode}"
                result = pipeline.prepare_image_variant(filename, destination, pipeline.sha256(filename), self.metadata, streaming=True)
                with (destination/result["variant"]["pyramid"]["url"]).open("rb") as handle:
                    reader = Reader(MmapSource(handle))
                    with Image.open(io.BytesIO(reader.get(1, 1, 0))) as tile:
                        pixel = tile.convert("RGBA").getpixel((0, 100))
                        self.assertLess(max(abs(a-b) for a,b in zip(pixel, expected)), 8)
                    with Image.open(io.BytesIO(reader.get(1, 0, 0))) as tile:
                        pixel = tile.convert("RGBA").getpixel((100, 100))
                        self.assertEqual(pixel[3], 0 if mode == "P" else 255)
                        if mode == "1":
                            self.assertLess(max(pixel[:3]), 8)

    def test_explicit_pixel_budget_is_still_enforced(self):
        with self.assertRaisesRegex(ValueError, "explicit pixel budget"):
            self.prepare(max_source_pixels=1000)
        self.assertFalse((self.root/"out").exists())
        with self.assertRaisesRegex(ValueError, "Pixel budget must"):
            self.prepare(max_source_pixels=1_000_000_001)
        # Raising the budget selects streaming once the normal threshold is
        # crossed; it must never turn off the large-image guard globally.
        previous_limit = Image.MAX_IMAGE_PIXELS
        with patch.object(pipeline, "MAX_SOURCE_PIXELS", 1000), patch.object(pipeline, "display_image", side_effect=AssertionError("Unbounded decoder used")):
            result = self.prepare(max_source_pixels=1_000_000)
        self.assertIn("rasterio/GDAL", result["manifest"]["recipe"]["decoder"])
        self.assertEqual(Image.MAX_IMAGE_PIXELS, previous_limit)

    def test_cmyk_requires_opt_in_and_preserves_exact_original(self):
        source = self.root/"cmyk.jpg"
        image = Image.new("CMYK", (513, 257), (0, 255, 255, 0))
        image.save(source, quality=100)
        image.close()
        digest = pipeline.sha256(source)
        with self.assertRaisesRegex(ValueError, "allow-cmyk-display"):
            pipeline.prepare_image_variant(source, self.root/"cmyk-no", digest, self.metadata)
        destination = self.root/"cmyk"
        result = pipeline.prepare_image_variant(source, destination, digest, self.metadata, allow_cmyk_display=True)
        self.assertEqual((destination/result["variant"]["image"]["url"]).read_bytes(), source.read_bytes())
        self.assertEqual(result["manifest"]["recipe"]["sourceMode"], "CMYK")
        self.assertFalse(result["manifest"]["recipe"]["colourConversion"]["calibrated"])
        self.assertIn("uncalibrated CMYK-to-RGB", result["variant"]["note"])
        with (destination/result["variant"]["pyramid"]["url"]).open("rb") as handle:
            reader = Reader(MmapSource(handle))
            self.assertIn("uncalibrated", reader.metadata()["colourConversion"]["method"])
            with Image.open(io.BytesIO(reader.get(1, 0, 0))) as tile:
                pixel = tile.convert("RGB").getpixel((100, 100))
                self.assertLess(max(abs(a-b) for a,b in zip(pixel, (255, 0, 0))), 8)

    def test_cmyk_invalid_profile_is_not_silently_ignored(self):
        source = self.root/"invalid-profile.jpg"
        image = Image.new("CMYK", (20, 10), (0, 255, 255, 0))
        image.save(source, icc_profile=b"invalid ICC profile")
        image.close()
        with self.assertRaises((pipeline.ImageCms.PyCMSError, OSError)):
            pipeline.prepare_image_variant(source, self.root/"invalid-profile", pipeline.sha256(source), self.metadata, allow_cmyk_display=True)
        self.assertFalse((self.root/"invalid-profile"/"upload-manifest.json").exists())

    def test_streaming_rejects_unsafe_decoder_layout_or_insufficient_disk(self):
        source = self.root/"progressive.jpg"
        image = Image.new("RGB", (513, 257), "white")
        image.save(source, progressive=True)
        image.close()
        with self.assertRaisesRegex(ValueError, "progressive JPEG decoding"):
            pipeline.prepare_image_variant(source, self.root/"progressive", pipeline.sha256(source), self.metadata, streaming=True)
        self.assertFalse((self.root/"progressive"/"upload-manifest.json").exists())
        with patch("image_variant_streaming.shutil.disk_usage", return_value=type("Disk", (), {"free": 0})()), self.assertRaisesRegex(ValueError, "free temporary bytes"):
            self.prepare("no-space", streaming=True)
        self.assertFalse((self.root/"no-space"/"upload-manifest.json").exists())
        self.assertFalse(any((self.root/"no-space").glob(".image-variant-*")))

    def test_deterministic_objects_across_process_hash_seeds(self):
        first = self.prepare("first")
        metadata = self.root/"metadata.json"
        metadata.write_text(json.dumps(self.metadata))
        process = subprocess.run([sys.executable, str(Path(pipeline.__file__)), "--input", str(self.source), "--sha256", self.digest,
                                  "--metadata", str(metadata), "--output-dir", str(self.root/"second")],
                                 env={**os.environ, "PYTHONHASHSEED": "123"}, capture_output=True, text=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        second = json.loads((self.root/"second"/"upload-manifest.json").read_text())
        self.assertEqual(first["manifest"], second)
        self.assertEqual((self.root/"first"/"variant.json").read_bytes(), (self.root/"second"/"variant.json").read_bytes())
        for entry in second["objects"]:
            self.assertEqual((self.root/"first"/entry["path"]).read_bytes(), (self.root/"second"/entry["path"]).read_bytes())

    def test_hash_mismatch_does_not_create_ready_output(self):
        with self.assertRaisesRegex(ValueError, "expected source SHA-256"):
            pipeline.prepare_image_variant(self.source, self.root/"out", "0"*64, self.metadata)
        self.assertFalse((self.root/"out").exists())

    def test_staged_source_copy_is_verified_before_rendering(self):
        real_copy = pipeline.shutil.copyfile
        def changed_copy(source, destination):
            result = real_copy(source, destination)
            if Path(source) == self.source:
                Path(destination).write_bytes(b"changed during copy")
            return result
        with patch.object(pipeline.shutil, "copyfile", side_effect=changed_copy), self.assertRaisesRegex(ValueError, "changed while copying"):
            self.prepare()
        self.assertFalse((self.root/"out"/"upload-manifest.json").exists())

    def test_small_source_deduplicates_equal_preview_and_thumbnail(self):
        image = Image.new("RGB", (80, 40), "navy")
        image.save(self.source)
        image.close()
        self.digest = pipeline.sha256(self.source)
        result = self.prepare()
        self.assertEqual(result["variant"]["preview"], result["variant"]["thumbnail"])
        self.assertEqual(len(result["manifest"]["objects"]), 3)
        self.assertEqual(result["variant"]["pyramid"]["maxZoom"], 0)

    def test_oversized_derived_object_leaves_no_ready_manifest(self):
        image = Image.new("RGB", (8, 8), "navy")
        image.save(self.source)
        image.close()
        self.digest = pipeline.sha256(self.source)
        with patch.object(pipeline, "MAX_OBJECT_BYTES", 300), self.assertRaisesRegex(ValueError, "smaller than"):
            self.prepare()
        self.assertFalse((self.root/"out"/"variant.json").exists())
        self.assertFalse((self.root/"out"/"upload-manifest.json").exists())
        self.assertFalse(any((self.root/"out").glob(".image-variant-*")))

    def test_ambiguous_multiframe_orientation_and_numeric_sources_are_rejected(self):
        frame = Image.new("RGB", (40, 30), "navy")
        tiff = self.root/"pages.tif"
        frame.save(tiff, save_all=True, append_images=[frame])
        with self.assertRaisesRegex(ValueError, "identified page"):
            pipeline.prepare_image_variant(tiff, self.root/"out-pages", pipeline.sha256(tiff), self.metadata)
        oriented = self.root/"oriented.jpg"
        exif = Image.Exif()
        exif[274] = 6
        frame.save(oriented, exif=exif)
        with self.assertRaisesRegex(ValueError, "EXIF orientation"):
            pipeline.prepare_image_variant(oriented, self.root/"out-oriented", pipeline.sha256(oriented), self.metadata)
        frame.close()
        numeric = self.root/"elevations.tif"
        image = Image.new("I;16", (40, 30))
        image.save(numeric)
        image.close()
        with self.assertRaisesRegex(ValueError, "display stretch"):
            pipeline.prepare_image_variant(numeric, self.root/"out-numeric", pipeline.sha256(numeric), self.metadata)


if __name__ == "__main__":
    unittest.main()
