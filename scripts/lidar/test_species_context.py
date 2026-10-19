import json
import unittest
from pathlib import Path
from shapely.geometry import shape, Point
from validate_species_context import validate_context


class SpeciesContextTests(unittest.TestCase):
    def test_linkage_and_provenance(self):
        self.assertEqual(validate_context()["linked"], 688)

    def test_review_coordinates_lie_in_supported_stands(self):
        base = Path("src/pages/dev-lidar")
        data = json.loads((base / "species-context.generated.json").read_text())
        species = json.loads((base / "species.generated.json").read_text())
        for f in species["stands"]["features"]:
            self.assertTrue(
                shape(f["geometry"]).covers(
                    Point(data["field_points"][f["properties"]["id"]])
                )
            )
