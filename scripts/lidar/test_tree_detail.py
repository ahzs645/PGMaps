import unittest
from pathlib import Path
from validate_tree_detail import validate


class TreeDetailTests(unittest.TestCase):
    @unittest.skipUnless(
        Path("public/data/lidar-analysis/bc-093g086/summary.json").exists(),
        "Requires processed tile; deployment always runs validator",
    )
    def test_disjoint_crowns_and_consistent_high_resolution_mask(self):
        result = validate(Path("public/data/lidar-analysis/bc-093g086"))
        self.assertEqual(result["crowns"], 16136)
        self.assertEqual(result["nonoverlapping_crown_cells"], 1720119)
        self.assertEqual(result["native_height_cells"], 2246943)
