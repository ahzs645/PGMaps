/* Offline search recovered from Flatten SF by Drew Edwards. */
import DEFAULT_DATA from "./data.json";

/* -------------------------------------------------------- text matching */
/* Street-type words collapse to their abbreviations on both the index and
 * the query, so "Geary Blvd", "Geary Boulevard" and "geary" all match. */
const ABBREV = { street: "st", avenue: "ave", boulevard: "blvd", drive: "dr", road: "rd",
  court: "ct", place: "pl", lane: "ln", terrace: "ter", highway: "hwy", parkway: "pkwy",
  circle: "cir", alley: "aly", square: "sq", stairway: "stwy", stairs: "stwy", way: "wy",
  north: "n", south: "s", east: "e", west: "w", saint: "st", mount: "mt" };
const norm = (s) => s.toLowerCase()
  .replace(/[’']/g, "")
  .replace(/[^\p{L}\p{N}\s]/gu, " ")
  .replace(/\s+/g, " ").trim()
  .split(" ").map((w) => ABBREV[w] || w).join(" ");

/* 0 exact, 1 starts with, 2 every token is a word prefix, 3 substring, -1 none */
function matchScore(nn, q, toks) {
  if (nn === q) return 0;
  if (nn.startsWith(q)) return 1;
  let all = true;
  for (const t of toks) { if (!(" " + nn).includes(" " + t)) { all = false; break; } }
  if (all) return 2;
  if (q.length >= 3 && nn.includes(q)) return 3;
  return -1;
}

/* -------------------------------------------------------- search index */
class Index {
  constructor(graph, geom, bundle, DATA = DEFAULT_DATA) {
    this.graph = graph; this.geom = geom;
    this.buildIntersections();
    this.places = [];
    if (DATA.manifest.strings.places) {
      const p = JSON.parse(bundle.text("places"));
      for (let i = 0; i < p.names.length; i++) {
        this.places.push({ name: p.names[i], nn: norm(p.names[i]), kind: p.groups[p.group[i]],
          lon: p.lon[i], lat: p.lat[i] });
      }
    }
    this.addr = null;
    if (DATA.addr && DATA.manifest.strings.addr_streets) {
      const streets = JSON.parse(bundle.text("addr_streets"));
      const st = bundle.array("addr_street");
      const start = new Int32Array(streets.length + 1);
      for (let i = 0; i < st.length; i++) start[st[i] + 1]++;
      for (let i = 0; i < streets.length; i++) start[i + 1] += start[i];
      this.addr = {
        streets, nn: streets.map(norm), start,
        number: bundle.array("addr_number"),
        lon: bundle.array("addr_lon"), lat: bundle.array("addr_lat"),
        origin: DATA.addr.origin, step: DATA.addr.step,
      };
    }
  }

  /* "24th St & Mission St": a node with two or more distinct street names */
  buildIntersections() {
    const g = this.graph, geom = this.geom;
    const per = new Array(g.n);
    const add = (node, nameIdx) => {
      if (!nameIdx) return;
      let s = per[node];
      if (!s) { s = per[node] = []; }
      if (s.indexOf(nameIdx) < 0) s.push(nameIdx);
    };
    for (let u = 0; u < g.n; u++) {
      for (let a = g.indptr[u]; a < g.indptr[u + 1]; a++) {
        const ni = geom.name[g.arcEdge[a]];
        add(u, ni); add(g.head[a], ni);
      }
    }
    this.nodeNames = per;
    const seen = new Map();
    const items = [];
    for (let u = 0; u < g.n; u++) {
      const s = per[u];
      if (!s || s.length < 2) continue;
      const names = s.map((i) => geom.names[i - 1]).sort();
      const key = names.join("|");
      if (seen.has(key)) continue;
      seen.set(key, items.length);
      items.push({ name: names.slice(0, 3).join(" & "), parts: names.map(norm), node: u,
        lon: g.nodeLon(u), lat: g.nodeLat(u), kind: "intersection" });
    }
    this.intersections = items;
  }

  /* nearest named corner, for labelling a dropped pin */
  describe(node, grid) {
    const g = this.graph;
    const corner = (s) => s.slice(0, 2).map((i) => this.geom.names[i - 1]).join(" & ");
    const s = this.nodeNames[node];
    if (s && s.length >= 2) return corner(s);
    const near = grid ? grid.nearest(g.nodeLon(node), g.nodeLat(node),
      (i) => this.nodeNames[i] && this.nodeNames[i].length >= 2) : -1;
    if (near >= 0) return corner(this.nodeNames[near]);
    if (s && s.length === 1) return this.geom.names[s[0] - 1];
    return g.nodeLat(node).toFixed(4) + ", " + g.nodeLon(node).toFixed(4);
  }

  search(raw, limit = 8) {
    const q = norm(raw);
    if (!q) return [];
    const toks = q.split(" ");
    const qq = q.replace(/ /g, "");
    const out = [];

    // "1234 Valencia" -- a street address
    const am = /^(\d+)\s+(\D.*)$/.exec(q);
    if (am && this.addr) {
      const want = +am[1], sq = am[2], stoks = sq.split(" ");
      const hits = [];
      for (let i = 0; i < this.addr.streets.length; i++) {
        const sc = matchScore(this.addr.nn[i], sq, stoks);
        if (sc >= 0 && sc <= 2) hits.push([sc, i]);
      }
      hits.sort((a, b) => a[0] - b[0] || this.addr.streets[a[1]].length - this.addr.streets[b[1]].length);
      for (const [sc, si] of hits.slice(0, 4)) {
        const a = this.addr, lo = a.start[si], hi = a.start[si + 1];
        // numbers are sorted within a street: binary search for the nearest
        let l = lo, h = hi - 1;
        while (l < h) { const m = (l + h) >> 1; if (a.number[m] < want) l = m + 1; else h = m; }
        let best = l;
        if (l > lo && Math.abs(a.number[l - 1] - want) < Math.abs(a.number[l] - want)) best = l - 1;
        const num = a.number[best];
        const exact = num === want;
        out.push({ score: exact ? -1 : sc, name: num + " " + a.streets[si],
          kind: exact ? "address" : "nearest address", rank: 0,
          lon: a.origin[0] + a.lon[best] * a.step, lat: a.origin[1] + a.lat[best] * a.step });
      }
    }

    // "24th & mission" -- an intersection
    const parts = raw.toLowerCase().split(/\s+(?:and|at)\s+|\s*[&\/@+]\s*/).map(norm).filter(Boolean);
    if (parts.length === 2) {
      for (const it of this.intersections) {
        let ok = 0;
        for (const p of parts) { if (it.parts.some((n) => n.startsWith(p) || (" " + n).includes(" " + p))) ok++; }
        if (ok === 2) out.push({ score: 1, rank: 1, ...it });
      }
    } else if (parts.length === 1) {
      for (const it of this.intersections) {
        if (it.parts.some((n) => n.startsWith(q))) out.push({ score: 2, rank: 3, ...it });
      }
    }

    // places
    // mapped features and landmarks first, then everyday places
    const KIND_RANK = { landmark: 1, transit: 1, civic: 1, shop: 2, food: 2, lodging: 2 };
    for (const p of this.places) {
      let sc = matchScore(p.nn, q, toks);
      if (sc < 0 && qq.length >= 4 && p.nn.replace(/ /g, "").startsWith(qq)) sc = 2;
      if (sc >= 0) out.push({ score: sc, rank: 1 + (KIND_RANK[p.kind] || 0), ...p });
    }

    out.sort((a, b) => a.score - b.score || a.rank - b.rank || a.name.length - b.name.length);
    // one intersection per pair of streets is already guaranteed; dedupe places by name
    const seen = new Set(), res = [];
    for (const r of out) {
      const k = r.kind + "|" + r.name;
      if (seen.has(k)) continue;
      seen.add(k); res.push(r);
      if (res.length >= limit) break;
    }
    return res;
  }
}

export { Index };
