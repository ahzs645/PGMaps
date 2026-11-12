import csv

rows = list(csv.reader(open('fora-trees.csv', encoding='utf-8-sig')))
h = rows[0]
print(h[:16])
print(len(rows) - 1, 'trees')


def col(name):
    idx = [k for k, x in enumerate(h) if x.strip().lower() == name]
    if not idx:
        return []
    out = []
    for r in rows[1:]:
        try:
            out.append(float(r[idx[0]]))
        except ValueError:
            pass
    return out


for name in [x.strip().lower() for x in h]:
    v = sorted(col(name))
    if len(v) > 100 and name not in ('x', 'y', '#', 'id'):
        n = len(v)
        print(name, 'n', n, 'p10', round(v[n // 10], 1), 'p50', round(v[n // 2], 1), 'p90', round(v[9 * n // 10], 1), 'max', round(v[-1], 1))
