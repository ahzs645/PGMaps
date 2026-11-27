#!/usr/bin/env python3
"""Index EVERY section of an official BC Laws CiviX XML source. No legal interpretation.

Reads only source IDs from packages/legal-rules/catalogue/sources.json.
Optional --xml allows fully offline testing. Produces section headings, hierarchy,
each section's text as numbered blocks (subsections, paragraphs, tables), the
normalized-text SHA256, retrieval timestamp and attribution; never claims compliance.
The text is what the planner's provision preview shows and what rule quotes are
checked against (packages/legal-rules/catalogue/rule-quotes.json).
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

BLOCKS = ("subsection", "paragraph", "subparagraph", "clause", "subclause")

def flat(node: ET.Element) -> str:
    """Text of an inline run: line breaks inside it become spaces."""
    parts: list[str] = []
    def rec(el: ET.Element) -> None:
        if el.text:
            parts.append(el.text)
        for kid in el:
            if local(kid.tag) == "br":
                parts.append(" ")
            if local(kid.tag) == "num":
                # A paragraph number inside a definition prints as "(a)", as BC Laws shows it.
                parts.append(" (" + flat(kid) + ") ")
                if kid.tail:
                    parts.append(kid.tail)
                continue
            rec(kid)
            if kid.tail:
                parts.append(kid.tail)
    rec(node)
    return " ".join("".join(parts).split())

def table_rows(node: ET.Element) -> list[list[str]]:
    rows = []
    for row in node.iter():
        if local(row.tag) != "trow":
            continue
        rows.append([flat(cell) for cell in row if local(cell.tag) == "entry"])
    return rows

LINES = ("lefttext", "centertext", "righttext")

def section_blocks(node: ET.Element, lines: bool = False) -> list[dict]:
    """The section as it prints: one block per run of text, its reference ("(3)(a)") and depth.

    With `lines`, a schedule's plain lines (`lefttext`, `indent1`…) are blocks too: a schedule
    without sections, such as the Water Sustainability Act's list of protected rivers, holds
    nothing else."""
    out: list[dict] = []
    def walk(el: ET.Element, ref: str, depth: int) -> None:
        for kid in el:
            kind = local(kid.tag)
            if lines and (kind in LINES or re.fullmatch(r"indent\d", kind)):
                text = flat(kid)
                if text:
                    out.append({"ref": ref, "depth": depth + (int(kind[-1]) if kind.startswith("indent") else 0), "text": text})
            elif kind in BLOCKS:
                num = child(kid, "num")
                walk(kid, ref + "(" + num + ")", depth + 1)
            elif kind == "text":
                text = flat(kid)
                if text:
                    out.append({"ref": ref, "depth": depth, "text": text})
            elif kind == "definition":
                text = flat(kid)
                if text:
                    out.append({"ref": ref, "depth": depth + 1, "text": text, "kind": "definition"})
            elif kind == "table":
                rows = table_rows(kid)
                if rows:
                    out.append({"ref": ref, "depth": depth + 1, "kind": "table", "rows": rows,
                                "text": " | ".join(" ; ".join(r) for r in rows)})
            elif kind in ("num", "marginalnote", "hnote", "editorialnote"):
                continue
            else:
                walk(kid, ref, depth)
    walk(node, "", 0)
    return out

def index_xml(data: bytes, source_id: str) -> list[dict]:
    parser = ET.XMLParser()
    root = ET.fromstring(data, parser=parser)
    result: list[dict] = []
    def visit(node: ET.Element, hierarchy: list[dict], prefix: str = "") -> None:
        kind = local(node.tag)
        scope = hierarchy
        if kind in ("part", "division", "subdivision"):
            scope = hierarchy + [{"type":kind,"number":child(node,"num"),
                                   "name":child(node,"heading","title","text")}]
        if kind == "schedule":
            # A schedule numbers its own sections from 1: "Schedule 2, section 1" is "Schedule 2.1".
            title = child(node, "scheduletitle")
            label = re.match(r"(Schedule\s+[0-9A-Z]+)", title)
            name = label.group(1) if label else "Schedule"
            scope = hierarchy + [{"type":"schedule","number":name,"name":title}]
            if not any(local(e.tag) == "section" for e in node.iter()):
                blocks = section_blocks(node, lines=True)
                result.append({"id":source_id + "." + name.replace(" ", ""),"number":name,"title":title,
                               "hierarchy":scope,"repealed":False,"blocks":blocks,
                               "canonicalTextSha256":hashlib.sha256(" ".join(b["text"] for b in blocks).encode("utf-8")).hexdigest(),
                               "reviewStatus":"not-interpreted","extractionMethod":"CiviX XML schedule without sections"})
                return
            prefix = name + "."
        if kind == "section":
            number = prefix + child(node,"num")
            if not number:
                raise ValueError("Section without a section number; check XML structure")
            title = child(node,"marginalnote","heading","title")
            canonical = re.sub(r"\s+", " ", " ".join(node.itertext())).strip()
            blocks = section_blocks(node)
            repealed = title == "Repealed" or (bool(blocks) and all(
                re.match(r"\[?Repealed\b", b["text"]) for b in blocks))
            result.append({
                "id":source_id + "." + number,
                "number":number,"title":title,
                "hierarchy":scope,
                "repealed":repealed,
                "blocks":blocks,
                "canonicalTextSha256":hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
                "reviewStatus":"not-interpreted",
                "extractionMethod":"CiviX XML element names section/num/marginalnote"
            })
            return
        for nested in node:
            visit(nested, scope, prefix)
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

def dump(report: dict) -> str:
    """One section per line, so a new consolidation's diff shows which sections changed."""
    head = {k: v for k, v in report.items() if k != "sections"}
    lines = json.dumps(head, indent=2, ensure_ascii=False)[:-2]
    rows = ",\n".join("    " + json.dumps(x, ensure_ascii=False, separators=(",", ":")) for x in report["sections"])
    return lines + ',\n  "sections": [\n' + rows + "\n  ]\n}\n"

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source",required=True,help="Catalogue source ID with a CiviX document, e.g. bc.fppr")
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
      "legalStatus":"TEXT AND INDEX ONLY — NO SECTIONS INTERPRETED",
      "licence":{"name":"King's Printer Licence – British Columbia",
                 "url":"https://www.bclaws.gov.bc.ca/standards/Licence.html","notice":NOTICE}}
    out.write_text(dump(report),encoding="utf-8")
    print("Indexed",len(sections),"sections of",args.source,"=>",out)
    return 0

if __name__=="__main__":
    sys.exit(main())
