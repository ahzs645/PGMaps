"""Contact sheet of contrast series (PIL only). Red dots: corridor contrast (ring - road). Green: block contrast (outside - interior).
Blue line: recorded harvest start; grey band: recorded harvest interval; orange band: detected road bracket; dashed: threshold.
Usage: plot_series.py brackets.json out.png [oid ...]
"""
import sys, json, os, datetime as dt
from PIL import Image, ImageDraw
B = json.load(open(sys.argv[1])); out = sys.argv[2]; pick = set(int(x) for x in sys.argv[3:])
if pick: B = [r for r in B if r['oid'] in pick]
HERE = os.path.dirname(os.path.abspath(__file__))
T = float(os.path.basename(sys.argv[1]).split('_T')[1][:4])
W, H, C = 420, 170, 4
rows_n = (len(B) + C - 1) // C
img = Image.new('RGB', (W * C, H * rows_n), 'white'); d = ImageDraw.Draw(img)
D = dt.date.fromisoformat
for n, r in enumerate(B):
    ox, oy = (n % C) * W, (n // C) * H
    s = json.load(open(os.path.join(HERE, 'series', f"{r['oid']}.json")))['rows']
    t0, t1 = D(r['t0']), D(r['t1'])
    X = lambda dd: ox + 30 + (D(dd) - t0).days / max(1, (t1 - t0).days) * (W - 40)
    Y = lambda v: oy + 20 + (0.6 - max(-0.2, min(0.6, v))) / 0.8 * (H - 35)
    d.rectangle([ox, oy, ox + W - 1, oy + H - 1], outline=(200, 200, 200))
    rd = r['road']
    if rd['status'] == 'step': d.rectangle([X(rd['last_before']), oy + 20, X(rd['first_after']), oy + H - 15], fill=(255, 220, 170))
    if r['end']: d.rectangle([X(r['start']), oy + H - 18, X(min(r['end'], r['t1'])), oy + H - 15], fill=(150, 150, 150))
    d.line([X(r['start']), oy + 20, X(r['start']), oy + H - 15], fill=(0, 0, 255))
    for v in (0, T):
        for x in range(ox + 30, ox + W - 10, 6 if v else 2): d.point((x, Y(v)), fill=(120, 120, 120))
    for y in range(t0.year, t1.year + 1):
        jan = dt.date(y, 1, 1)
        if t0 <= jan <= t1: d.text((X(jan.isoformat()) - 10, oy + H - 13), str(y), fill=(0, 0, 0)); d.line([X(jan.isoformat()), oy + H - 15, X(jan.isoformat()), oy + H - 18], fill=(0, 0, 0))
    for row in s:
        if row.get('oring') is not None and row.get('blk') is not None:
            x, y = X(row['date']), Y(row['oring'] - row['blk']); d.ellipse([x - 1, y - 1, x + 1, y + 1], fill=(40, 160, 40))
        if row.get('ring') is not None and row.get('road') is not None:
            x, y = X(row['date']), Y(row['ring'] - row['road'])
            snowy = (row.get('road_snow') or 0) > 0.25 or (row.get('road_red') or 0) > 3000
            d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(200, 200, 200) if snowy else (220, 30, 30))
    lab = f"{r['block']} {r['district']} {r['mode'][:7]} {r['road_len']}m  {r['road_class']}  {r.get('lead_first_after_days', '')}"
    d.text((ox + 4, oy + 3), lab, fill=(0, 0, 0))
img.save(out); print(out, img.size)
