import re
LIC = re.compile(r'\b(A\d{5}|FLA\d{5}|TFL\s?\d{1,2}|TSL\s?A?\d{4,5})\b')
CP = re.compile(r'\bC\.?P\.?\s*#?\s*(\d{1,4}[A-Z]?)(?:\s*[-/_ ]\s*(?:BLK\s*|BLOCK\s*)?(\d{1,3}[A-Z]?)\b)?')
BLK = re.compile(r'\bBL(?:OC)?K\.?\s*#?\s*(\d{1,3}[A-Z]?)\b')
SID = re.compile(r'(\d{1,4}[A-Z]?)-(\d{1,3}[A-Z]?)[A-Z]?')
def parse(name, section_id):
    n = (name or '').upper(); out = {}
    m = LIC.search(n)
    if m:
        lic = m.group(1).replace(' ', '')
        out['licence'] = lic
    cps = CP.findall(n)
    if cps:
        out['cps'] = sorted({c[0] for c in cps})
        blocks = {c[1] for c in cps if c[1]}
        b = BLK.search(n)
        if b: blocks.add(b.group(1))
        if blocks: out['blocks'] = sorted(blocks)
        out['source'] = 'name'
    else:
        m = SID.fullmatch(section_id or '')
        if m:
            out.update(cps=[m.group(1)], blocks=[m.group(2)], source='section_id')
    return out
