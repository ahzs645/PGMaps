#!/usr/bin/env python3
"""Index EVERY section of an official BC Laws CiviX XML source. No legal interpretation.

Reads only source IDs from packages/legal-rules/catalogue/sources.json.
Optional --xml allows fully offline testing. Produces section headings, hierarchy,
normalized-text SHA256, retrieval timestamp and attribution; never claims compliance.
See https://www.bclaws.gov.bc.ca/civix/template/complete/api/API_document.html
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / "packages/legal-rules/catalogue/sources.json"
NOTICE = (
    "These materials contain information that has been derived from information originally "
    "made available by the Province of British Columbia at: http://www.bclaws.gov.bc.ca "
    "and this information is being used in accordance with the King's Printer Licence "
    "– British Columbia available at: https://www.bclaws.gov.bc.ca/standards/Licence.html. "
    "They have not, however, been produced in affiliation with, or with the endorsement of, "
    "the Province of British Columbia and THESE MATERIALS ARE NOT AN OFFICIAL VERSION."
)

def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].rsplit(":", 1)[-1]

def child(node: ET.Element, *names: str) -> str:
    for elt in node:
        if local(elt.tag) in names:
            return " ".join("".join(elt.itertext()).split())
    return ""

def index_xml(data: bytes, source_id: str) -> list[dict]:
    parser = ET.XMLParser()
    root = ET.fromstring(data, parser=parser)
    result: list[dict] = []
    def visit(node: ET.Element, hierarchy: list[dict]) -> None:
        kind = local(node.tag)
        scope = hierarchy
        if kind in ("part", "division", "subdivision"):
            scope = hierarchy + [{"type":kind,"number":child(node,"num"),
                                   "name":child(node,"heading","title","text")}]
        if kind == "section":
            number = child(node,"num")
            if not number:
                raise ValueError("Section without a section number; check XML structure")
            title = child(node,"marginalnote","heading","title")
            canonical = re.sub(r"\s+", " ", " ".join(node.itertext())).strip()
            result.append({
                "id":source_id + "." + number,
                "number":number,"title":title,
                "hierarchy":scope,
                "canonicalTextSha256":hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
                "reviewStatus":"not-interpreted",
                "extractionMethod":"CiviX XML element names section/num/marginalnote"
            })
            return
        for nested in node:
            visit(nested, scope)
    visit(root, [])
    if not result:
        raise ValueError("No sections found in XML; check CiviX document ID and multi-document variants")
    seen: set[str] = set()
    for section in result:
        if section["number"] in seen:
            raise ValueError("Repeated section number " + section["number"] +
                             "; possible multi-document or incorrectly parsed nesting")
        seen.add(section["number"])
    return result

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source",required=True,choices=["bc.frpa","bc.fppr","bc.gar"])
    p.add_argument("--xml",type=Path,help="Use locally downloaded CiviX XML instead of network")
    p.add_argument("--output",type=Path,help="Output path (default: generated JSON under catalogue)")
    p.add_argument("--min-sections",type=int,default=10,help="Fail rather than write incomplete index")
    args = p.parse_args()
    catalog = json.loads(SOURCES.read_text(encoding="utf-8"))
    source = next((s for s in catalog["sources"] if s["id"]==args.source),None)
    if source is None or "civix" not in source: p.error("Source lacks a CiviX XML document")
    url = source["civix"]["xmlUrl"]
    if args.xml:
        data = args.xml.read_bytes()
        method = "local-xml"
    else:
        if not url.startswith("https://www.bclaws.gov.bc.ca/civix/"):
            p.error("Refusing unexpected host")
        req = urllib.request.Request(url,headers={"User-Agent":"PGMapsLegalRuleIndexer/0.1 (public data; contact via repository)"})
        with urllib.request.urlopen(req,timeout=35) as response:
            data = response.read(15_000_001)
            if len(data) > 15_000_000: raise ValueError("Excessive XML size; inspect source")
        method = "official-civix-xml"
    sections = index_xml(data,args.source)
    if len(sections)<args.min_sections:
        raise ValueError(
            "Only %s sections parsed (minimum %s). Check CiviX multi-document variants and XML namespaces; "
            "do not mistake a partial XML for complete legislation."%(len(sections),args.min_sections))
    out = args.output or ROOT / "packages/legal-rules/catalogue/generated" / (args.source+".sections.json")
    out.parent.mkdir(parents=True,exist_ok=True)
    report = {"schemaVersion":"1.0.0","sourceId":args.source,"officialUrl":source["url"],
      "xmlUrl":url,"method":method,"retrievedAt":datetime.now(timezone.utc).isoformat(),
      "sectionCount":len(sections),"sections":sections,
      "legalStatus":"INDEX ONLY — NO SECTIONS INTERPRETED",
      "licence":{"name":"King's Printer Licence – British Columbia",
                 "url":"https://www.bclaws.gov.bc.ca/standards/Licence.html","notice":NOTICE}}
    out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print("Indexed",len(sections),"sections of",args.source,"=>",out)
    return 0

if __name__=="__main__":
    sys.exit(main())
