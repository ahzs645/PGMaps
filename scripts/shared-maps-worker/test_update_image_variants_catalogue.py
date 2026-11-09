"""Additive catalogue updates must retain exact native and source identities."""

import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import update_image_variants_catalogue as updater


NATIVE_A = "a" * 64
NATIVE_B = "b" * 64
EDIT_SOURCE = "c" * 64
FULL_SCAN = "d" * 64
UNLISTED_NATIVE = "e" * 64


def download(sha, name, size=1234):
    return {"url": f"https://example.org/collection/native/{name}.tif", "sha256": sha, "bytes": size}


def native_record(record_id, sha):
    return {
        "id": record_id, "title": "A repeated document title", "dateLabel": "1950",
        "description": "A synthetic map panel", "caveat": "Historical proposal; retain this caveat.",
        "confidence": "approximate", "bounds": [-125, 53, -124, 54],
        "assets": [{"url": f"https://example.org/tiles/{record_id}.pmtiles", "bounds": [-125, 53, -124, 54], "minZoom": 2, "maxZoom": 15}],
        "sources": [{"title": "Source document", "url": "https://example.org/source.pdf"}],
        "fullSheets": [{"image": "https://example.org/preview.jpg", "label": "Reading preview"}],
        "organization": {"sourceGroupId": "same-document", "pageLabel": "2"},
        "download": download(sha, record_id), "ownerLegacyField": {"keep": [1, "verbatim", False]},
    }


class CatalogueVariantsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        first = native_record("panel-a", NATIVE_A)
        first["georeferenceProject"] = {
            "url": "https://example.org/projects/panel-a.json", "sha256": "1" * 64,
            "nativeSha256": NATIVE_A, "sourceSha256": EDIT_SOURCE,
            "label": "Reopen saved correction", "summary": "Its image frame is a specific crop.",
        }
        first["alignmentReview"] = {"label": "Reviewed", "summary": "Preserve this placement."}
        second = native_record("panel-b", NATIVE_B)
        second["downloads"] = [second.pop("download")]
        featured = native_record("multi-panel-selection", NATIVE_A)
        featured.pop("download")
        featured["downloads"] = [download(NATIVE_A, "panel-a"), download(NATIVE_B, "panel-b")]
        other = native_record("unrelated-selection", UNLISTED_NATIVE)
        other["downloads"] = [other.pop("download")]
        self.catalogue = {
            "schema": "raster-catalog-v1", "title": "Synthetic collection", "items": [first, second],
            "featured": [featured, other], "storageBytes": 2468, "tileBytes": 900,
            "representationCount": 2, "notes": "Preserve all catalogue notes.",
            "rectificationRevision": {"id": "existing-revision", "reviewUrl": "https://example.org/review.html"},
            "unplacedSources": [{"id": "unplaced-page", "image": "https://example.org/unplaced.jpg"}],
            "unknownFutureField": {"nested": [1, 2, "unaltered"]},
        }
        self.inventory = [
            {"id": "panel-a", "sha256": NATIVE_A, "nativeFileBytes": 1234, "status": "read",
             "width": 300, "height": 200, "epsg": 3005, "pixelScale": [2.0, 3.0, 0.0]},
            {"id": "panel-b", "sha256": NATIVE_B, "nativeFileBytes": 1234, "status": "read",
             "width": 400, "height": 180, "epsg": 26910, "pixelScale": [4.0, 4.0, 0.0]},
        ]
        self.variant = {
            "id": "original-page-2", "label": "Original scan, page 2", "role": "original-scan",
            "image": {"url": f"raw/{FULL_SCAN}.jpg", "width": 1025, "height": 769, "sha256": FULL_SCAN, "bytes": 1000, "mimeType": "image/jpeg"},
            "preview": {"url": "previews/preview.webp", "width": 800, "height": 600, "sha256": "2" * 64, "bytes": 400},
            "thumbnail": {"url": "previews/thumb.webp", "width": 200, "height": 150, "sha256": "3" * 64, "bytes": 100},
            "pyramid": {"format": "pmtiles-image-v1", "url": "sheets/source.pmtiles", "width": 1025, "height": 769,
                        "tileSize": 512, "maxZoom": 2, "sha256": "4" * 64, "bytes": 2000},
            "source": {"title": "Original document", "url": "https://example.org/document.pdf", "page": 2, "sha256": "5" * 64},
            "note": "A full page, not the crop used in the saved correction.",
        }
        self.write_variant()
        self.manifest = {
            "schema": "pgmaps-source-variant-bindings-v1", "collectionBase": "https://example.org/collection/",
            "bindings": [{"variantPath": "prepared/page/variant.json",
                          "targets": [{"id": "panel-a", "expectedNativeSha256": NATIVE_A}],
                          "featuredIds": ["multi-panel-selection"], "includeFeaturedByNativeSha256": True}],
        }

    def tearDown(self):
        self.temporary.cleanup()

    def write_variant(self, value=None, relative="prepared/page/variant.json"):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value if value is not None else self.variant))
        return path

    def update(self, **kwargs):
        return updater.update_catalogue(
            kwargs.get("catalogue", self.catalogue), kwargs.get("inventory", self.inventory),
            kwargs.get("bindings", self.manifest), self.root, kwargs.get("base_url"),
        )

    def enable_verified_edit_source(self):
        self.variant["id"] = "edit-crop"
        self.variant["role"] = "edit-source"
        self.variant["image"]["sha256"] = EDIT_SOURCE
        self.variant["image"]["url"] = f"raw/{EDIT_SOURCE}.png"
        self.write_variant()
        self.manifest["bindings"][0]["targets"][0]["sourceFrame"] = {
            "kind": "published-project-source", "expectedSourceSha256": EDIT_SOURCE,
        }

    def test_native_and_featured_header_metadata_is_exact_and_all_other_fields_are_preserved(self):
        old = copy.deepcopy(self.catalogue)
        after, receipt = self.update()
        self.assertEqual(self.catalogue, old)
        self.assertEqual(updater.protected_snapshot(after), updater.protected_snapshot(old))
        self.assertEqual(after["storageBytes"], 2468)
        self.assertEqual(after["tileBytes"], 900)
        native = after["items"][0]["download"]
        self.assertEqual((native["width"], native["height"], native["crs"], native["pixelSize"]), (300, 200, "EPSG:3005", [2.0, 3.0]))
        self.assertEqual((native["role"], native["mimeType"], native["label"]), ("rectified", "image/tiff", "Rectified GeoTIFF"))
        self.assertEqual(after["featured"][0]["downloads"][1]["width"], 400)
        self.assertNotIn("download", after["items"][1])
        self.assertNotIn("downloads", after["items"][0])
        self.assertEqual(after["items"][0]["georeferenceProject"], old["items"][0]["georeferenceProject"])
        self.assertEqual(receipt["counts"]["nativeDownloadsEnriched"], 2)
        self.assertEqual(receipt["counts"]["featuredDownloadsEnriched"], 2)
        self.assertEqual(receipt["counts"]["downloadsChanged"], 4)
        self.assertEqual(receipt["counts"]["recordsChanged"], 3)
        self.assertEqual(receipt["protectedCanonicalSha256"], updater.digest(updater.protected_snapshot(old)))

    def test_original_association_does_not_claim_the_saved_project_pixel_frame(self):
        after, receipt = self.update()
        for record in after["items"] + after["featured"]:
            for native in updater.downloads(record):
                self.assertNotIn("sourceVariantId", native)
        self.assertEqual(after["items"][0]["imageVariants"][0]["role"], "original-scan")
        self.assertNotIn("imageVariants", after["items"][1])
        self.assertEqual(receipt["counts"]["verifiedNativeSourceFrames"], 0)

    def test_verified_edit_source_links_only_the_exact_panel_of_multi_panel_selection(self):
        self.enable_verified_edit_source()
        after, receipt = self.update()
        self.assertEqual(after["items"][0]["download"]["sourceVariantId"], "edit-crop")
        panels = after["featured"][0]["downloads"]
        self.assertEqual(panels[0]["sourceVariantId"], "edit-crop")
        self.assertNotIn("sourceVariantId", panels[1])
        self.assertEqual(receipt["counts"]["verifiedNativeSourceFrames"], 1)
        self.assertEqual(receipt["bindings"][0]["verifiedSourceFrameNativeShas"], [NATIVE_A])

    def test_auto_featured_matching_requires_opt_in_and_exact_download_hash(self):
        self.manifest["bindings"][0]["featuredIds"] = []
        self.manifest["bindings"][0]["includeFeaturedByNativeSha256"] = False
        after, _ = self.update()
        self.assertTrue(all("imageVariants" not in row for row in after["featured"]))
        self.manifest["bindings"][0]["includeFeaturedByNativeSha256"] = True
        after, _ = self.update()
        self.assertIn("imageVariants", after["featured"][0])
        self.assertNotIn("imageVariants", after["featured"][1])
        # All records share the same title and document group; those are not matching evidence.
        self.assertEqual(after["featured"][1], self.catalogue["featured"][1])

    def test_relative_variant_urls_resolve_only_in_output_and_receipt_contains_no_urls(self):
        self.variant["source"]["page"] = "Map body, page 2"
        self.write_variant()
        after, receipt = self.update(base_url="https://example.org/private-sample/catalog.json")
        variant = after["items"][0]["imageVariants"][0]
        self.assertEqual(variant["image"]["url"], f"https://example.org/private-sample/raw/{FULL_SCAN}.jpg")
        self.assertEqual(variant["pyramid"]["url"], "https://example.org/private-sample/sheets/source.pmtiles")
        self.assertEqual(variant["source"]["page"], "Map body, page 2")
        self.assertEqual(json.loads((self.root / "prepared/page/variant.json").read_text()), self.variant)
        self.assertNotIn("https://", json.dumps(receipt))
        self.assertNotIn("private-sample", json.dumps(receipt))

    def test_unknown_featured_hash_is_left_unchanged_and_reported(self):
        after, receipt = self.update()
        self.assertEqual(after["featured"][1], self.catalogue["featured"][1])
        self.assertEqual(receipt["counts"]["featuredDownloadsWithoutInventory"], 1)

    def test_replay_is_idempotent_and_keeps_existing_download_labels(self):
        self.catalogue["items"][0]["download"]["label"] = "Rectified north panel"
        first, _ = self.update()
        second, receipt = self.update(catalogue=first)
        self.assertEqual(first, second)
        self.assertEqual(second["items"][0]["download"]["label"], "Rectified north panel")
        self.assertEqual(receipt["changes"], [])
        self.assertEqual(receipt["counts"]["nativeVariantAttachmentsAdded"], 0)
        self.assertEqual(receipt["counts"]["featuredVariantAttachmentsAdded"], 0)
        self.assertEqual(receipt["counts"]["recordsChanged"], 0)

    def test_stale_inventory_hash_size_missing_id_and_failed_header_are_rejected(self):
        for field, value in (("sha256", NATIVE_B), ("nativeFileBytes", 999), ("id", "different-id"), ("status", "failed")):
            with self.subTest(field=field):
                inventory = copy.deepcopy(self.inventory)
                inventory[0][field] = value
                with self.assertRaises(ValueError):
                    self.update(inventory=inventory)

    def test_stale_binding_hash_and_wrong_target_id_are_rejected_without_mutating_input(self):
        original = copy.deepcopy(self.catalogue)
        for field, value in (("expectedNativeSha256", NATIVE_B), ("id", "missing-native")):
            with self.subTest(field=field):
                manifest = copy.deepcopy(self.manifest)
                manifest["bindings"][0]["targets"][0][field] = value
                with self.assertRaisesRegex(ValueError, "missing or.*stale"):
                    self.update(bindings=manifest)
        self.assertEqual(self.catalogue, original)

    def test_explicit_featured_target_must_have_a_bound_native_hash(self):
        self.manifest["bindings"][0]["featuredIds"] = ["unrelated-selection"]
        with self.assertRaisesRegex(ValueError, "does not contain an exact bound native SHA"):
            self.update()

    def test_source_frame_requires_matching_project_native_and_source_hashes(self):
        self.enable_verified_edit_source()
        for field in ("nativeSha256", "sourceSha256"):
            with self.subTest(field=field):
                catalogue = copy.deepcopy(self.catalogue)
                catalogue["items"][0]["georeferenceProject"][field] = "f" * 64
                with self.assertRaisesRegex(ValueError, "exact native-raster/source-image frame"):
                    self.update(catalogue=catalogue)
        self.variant["image"]["sha256"] = FULL_SCAN
        self.write_variant()
        with self.assertRaisesRegex(ValueError, "exact native-raster/source-image frame"):
            self.update()

    def test_missing_project_or_preview_cannot_establish_source_frame(self):
        self.enable_verified_edit_source()
        missing = copy.deepcopy(self.catalogue)
        del missing["items"][0]["georeferenceProject"]
        with self.assertRaisesRegex(ValueError, "Published alignment project"):
            self.update(catalogue=missing)
        self.variant["role"] = "reading-preview"
        self.write_variant()
        with self.assertRaisesRegex(ValueError, "exact native-raster/source-image frame"):
            self.update()

    def test_conflicting_variant_id_and_ambiguous_source_variant_are_rejected(self):
        existing = updater.prepared_variant(self.variant, self.manifest["collectionBase"])
        existing["image"]["sha256"] = "6" * 64
        self.catalogue["items"][0]["imageVariants"] = [existing]
        with self.assertRaisesRegex(ValueError, "different or ambiguous source metadata"):
            self.update()
        del self.catalogue["items"][0]["imageVariants"]
        self.enable_verified_edit_source()
        other = copy.deepcopy(self.variant)
        other["id"] = "second-frame-name"
        self.write_variant(other, "prepared/other/variant.json")
        binding = copy.deepcopy(self.manifest["bindings"][0])
        binding["variantPath"] = "prepared/other/variant.json"
        self.manifest["bindings"].append(binding)
        with self.assertRaisesRegex(ValueError, "ambiguously bound to two"):
            self.update()

    def test_distinct_full_scan_and_edit_source_can_coexist_without_ambiguous_link(self):
        self.write_variant(self.variant, "prepared/full/variant.json")
        original_binding = copy.deepcopy(self.manifest["bindings"][0])
        original_binding["variantPath"] = "prepared/full/variant.json"
        self.enable_verified_edit_source()
        self.manifest["bindings"].insert(0, original_binding)
        after, _ = self.update()
        variants = after["items"][0]["imageVariants"]
        self.assertEqual([value["role"] for value in variants], ["original-scan", "edit-source"])
        self.assertEqual(after["items"][0]["download"]["sourceVariantId"], "edit-crop")
        self.assertEqual(len(after["featured"][0]["imageVariants"]), 2)

    def test_duplicate_record_or_binding_targets_are_rejected(self):
        catalogue = copy.deepcopy(self.catalogue)
        catalogue["items"].append(copy.deepcopy(catalogue["items"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate identifiers"):
            self.update(catalogue=catalogue)
        target = self.manifest["bindings"][0]["targets"][0]
        self.manifest["bindings"][0]["targets"].append(copy.deepcopy(target))
        with self.assertRaisesRegex(ValueError, "repeats a native target"):
            self.update()

    def test_wrong_frame_zoom_unsafe_url_and_malformed_roles_are_rejected(self):
        mutations = [
            lambda value: value["pyramid"].update(width=1024),
            lambda value: value["pyramid"].update(maxZoom=1),
            lambda value: value["pyramid"].update(tileSize=2048),
            lambda value: value["image"].update(url="http://example.org/source.jpg"),
            lambda value: value["image"].update(url="https://localhost/source.jpg"),
            lambda value: value["image"].update(width=True),
            lambda value: value["image"].update(sha256="short"),
            lambda value: value["image"].update(mimeType=[]),
            lambda value: value["thumbnail"].update(width=2000),
            lambda value: value.update(role=["original-scan"]),
            lambda value: value["source"].update(page=0),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index):
                variant = copy.deepcopy(self.variant)
                mutate(variant)
                with self.assertRaises(ValueError):
                    updater.prepared_variant(variant, self.manifest["collectionBase"])

    def run_cli(self, output="after.json", receipt="receipt.json"):
        paths = {"catalogue": self.catalogue, "inventory": self.inventory, "bindings": self.manifest}
        for name, value in paths.items():
            (self.root / f"{name}.json").write_text(json.dumps(value))
        return subprocess.run([
            sys.executable, str(Path(updater.__file__)), "--catalogue", str(self.root / "catalogue.json"),
            "--inventory", str(self.root / "inventory.json"), "--bindings", str(self.root / "bindings.json"),
            "--output", str(self.root / output), "--receipt", str(self.root / receipt),
        ], capture_output=True, text=True)

    def test_cli_writes_hashed_candidate_and_receipt_without_printing_private_urls(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        after = (self.root / "after.json").read_bytes()
        receipt = json.loads((self.root / "receipt.json").read_text())
        self.assertEqual(receipt["afterFileSha256"], hashlib.sha256(after).hexdigest())
        self.assertEqual(receipt["beforeFileSha256"], hashlib.sha256((self.root / "catalogue.json").read_bytes()).hexdigest())
        self.assertTrue(json.loads(result.stdout)["prepared"])
        self.assertNotIn("https://", result.stdout)
        self.assertNotIn("https://", result.stderr)

    def test_cli_fails_before_writing_on_stale_binding_and_never_overwrites_inputs(self):
        self.manifest["bindings"][0]["targets"][0]["expectedNativeSha256"] = NATIVE_B
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "after.json").exists())
        self.assertFalse((self.root / "receipt.json").exists())
        self.manifest["bindings"][0]["targets"][0]["expectedNativeSha256"] = NATIVE_A
        result = self.run_cli(output="catalogue.json")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("preserve every input", result.stderr)
        result = self.run_cli(output="prepared/page/variant.json")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("preserve every prepared variant input", result.stderr)
        self.assertEqual(json.loads((self.root / "prepared/page/variant.json").read_text()), self.variant)


if __name__ == "__main__":
    unittest.main()
