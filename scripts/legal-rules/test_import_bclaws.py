import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

modpath = Path(__file__).with_name("import_bclaws.py")
spec = importlib.util.spec_from_file_location("import_bclaws", modpath)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class IndexerTest(unittest.TestCase):
    def test_extract_number_title_hierarchy_and_fingerprint(self):
        xml = b"""<?xml version='1.0'?>
        <act:act xmlns:act='http://www.gov.bc.ca/2013/legislation/act'
                 xmlns:bcl='http://www.gov.bc.ca/2013/bclegislation'>
          <act:content><bcl:part><bcl:num>4</bcl:num><bcl:text>Planning</bcl:text>
            <bcl:section><bcl:marginalnote>Maximum cutblock size</bcl:marginalnote>
            <bcl:num>64</bcl:num><bcl:text>Example only</bcl:text></bcl:section>
            <bcl:section><bcl:marginalnote>Adjacent cutblocks</bcl:marginalnote>
            <bcl:num>65</bcl:num><bcl:text>Example only</bcl:text></bcl:section>
          </bcl:part></act:content></act:act>"""
        sections=mod.index_xml(xml,"bc.fppr")
        self.assertEqual([s["number"] for s in sections],["64","65"])
        self.assertEqual(sections[0]["title"],"Maximum cutblock size")
        self.assertEqual(sections[0]["hierarchy"][0]["number"],"4")
        self.assertEqual(len(sections[0]["canonicalTextSha256"]),64)
    def test_empty_or_duplicated_fails_closed(self):
        with self.assertRaises(ValueError):
            mod.index_xml(b"<root/>","bc.frpa")
        xml=b"<root><section><num>5</num></section><section><num>5</num></section></root>"
        with self.assertRaisesRegex(ValueError,"Repeated section"):
            mod.index_xml(xml,"bc.frpa")
if __name__ == "__main__":
    unittest.main()
