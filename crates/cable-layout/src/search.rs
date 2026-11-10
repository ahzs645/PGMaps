//! The intermediate-support optimizer (Bont & Heinimann 2012; Bont et al. 2022): candidate support
//! sites along the profile, a ladder of saddle heights at each, every forward span between them
//! checked for the pre-tensions it works at, then for each pre-tension the cheapest line by
//! dynamic programming over the acyclic graph. Cost is (H + 100)² per support (1 for a ground
//! anchor), which puts fewest supports first and lowest supports second. One pre-tension serves
//! the whole rope, so two spans that each work can fail together when their tension windows do
//! not overlap.
//!
//! The catenary model keeps the method and fixes the reference program's listed defects:
//! - no-support sectors are applied after convexity peaks are added, so no support lands in one;
//! - every start height is charged, not only the lowest;
//! - tension windows are closed integer intervals;
//! - each best line is re-checked with the final analysis, and a span or support pair that fails
//!   there (clearance, tension, gravity, lift-off, loaded break angle) is banned at that tension
//!   and the line searched again, so the angle limits are enforced and the search and the final
//!   check agree;
//! - an incomplete line keeps the farthest support it reached (the cheapest one at that station)
//!   and says why the next span fails;
//! - a span over unknown ground is never proven clear.
//!
//! The parity model reproduces SEILAPLAN 3.8.2's selection, defects included, for the reference
//! vectors.
//!
//! Written from a functional specification of SEILAPLAN 3.8.2; no code from SEILAPLAN
//! (GPL-2.0-or-later) was used.

use std::collections::{HashMap, HashSet};

use crate::analysis::{self, Analysis, Layout};
use crate::context::{Ctx, Point, Reason, Verdict};
use crate::params::{self, EndKind, FixedSupport, InputError, Model, Params, Profile, Sector, StartKind};
use crate::span::Field;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Start,
    Mid,
    End,
}

#[derive(Clone, Copy, Debug)]
pub struct Node {
    pub point: Point,
    pub role: Role,
    pub fixed: bool,
    pub cost: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct Arc {
    pub from: u32,
    pub to: u32,
    pub evaluated: bool,
    pub feasible: bool,
    /// Pre-tensions the span works at: [lo, hi] (catenary) or (lo, hi) (parity), kN.
    pub lo: f64,
    pub hi: f64,
    pub reason: Reason,
    pub at: f64,
    pub value: f64,
    pub value2: f64,
}

/// What a finished run reports.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Status {
    Complete = 0,
    Incomplete = 1,
    NoLayout = 2,
}

pub struct Outcome {
    pub status: Status,
    pub reason: Reason,
    pub reason_at: f64,
    pub reason_value: f64,
    pub reason_value2: f64,
    pub tension: f64,
    pub tie_low: f64,
    pub tie_high: f64,
    pub tie_count: usize,
    pub objective: f64,
    pub reach: f64,
    pub verifications: usize,
    /// Node indices of the reported line.
    pub path: Vec<usize>,
    pub analysis: Analysis,
}

pub struct Job {
    pub params: Params,
    pub profile: Profile,
    pub fixed: Vec<FixedSupport>,
    pub sectors: Vec<Sector>,
    pub peaks: Vec<f64>,
    /// Candidate stations after the convexity filter.
    pub sites: Vec<f64>,
    pub nodes: Vec<Node>,
    pub arcs: Vec<Arc>,
    in_arcs: Vec<Vec<u32>>,
    out_arcs: Vec<Vec<u32>>,
    pub next: usize,
    pub evaluated: usize,
}

/// Convexity peaks: where the ground stands above the chord of the points 10 m either side, a
/// local maximum within 5 m, above a threshold lowered from 1 m in 0.1 m steps until three
/// remain.
pub fn convexity_peaks(prof: &Profile, line_end: f64) -> Vec<f64> {
    let k = (10.0 / prof.dx).round().max(1.0) as usize;
    let look = (5.0 / prof.dx).round().max(1.0) as usize;
    let n = prof.z.len();
    let mut c = vec![f64::NAN; n];
    for i in k..n.saturating_sub(k) {
        let x = prof.station(i);
        if x < 10.0 - 1e-9 || x > line_end - 10.0 + 1e-9 {
            continue;
        }
        c[i] = prof.z[i] - (prof.z[i - k] + prof.z[i + k]) / 2.0;
    }
    let mut maxima = Vec::new();
    for i in 0..n {
        if c[i].is_nan() {
            continue;
        }
        let lo = i.saturating_sub(look);
        let hi = (i + look).min(n - 1);
        let mut peak = true;
        for j in lo..=hi {
            if j == i || c[j].is_nan() {
                continue;
            }
            if (j < i && c[j] >= c[i]) || (j > i && c[j] > c[i]) {
                peak = false;
                break;
            }
        }
        if peak {
            maxima.push(i);
        }
    }
    let mut chosen = Vec::new();
    for step in 0..10 {
        let threshold = 1.0 - 0.1 * step as f64;
        chosen = maxima.iter().filter(|&&i| c[i] > threshold + 1e-12).map(|&i| prof.station(i)).collect();
        if chosen.len() >= 3 {
            break;
        }
    }
    chosen
}

const TOL: f64 = 1e-6;

impl Job {
    pub fn new(
        params: Params,
        profile: Profile,
        fixed: Vec<FixedSupport>,
        sectors: Vec<Sector>,
    ) -> Result<Job, InputError> {
        params::validate(&params, &profile, &fixed, &sectors)?;
        let p = &params;
        let parity = p.model == Model::Parity;
        let end = p.line_end;
        let peaks = convexity_peaks(&profile, end);
        // Candidate stations, tagged fixed (with a height) where the user placed a support.
        let mut cands: Vec<(f64, Option<Option<f64>>)> = Vec::new();
        let add = |cands: &mut Vec<(f64, Option<Option<f64>>)>, x: f64, fixed: Option<Option<f64>>| {
            if let Some(c) = cands.iter_mut().find(|c| (c.0 - x).abs() < TOL) {
                if fixed.is_some() {
                    c.1 = fixed;
                }
            } else {
                cands.push((x, fixed));
            }
        };
        let mut k = 0usize;
        loop {
            let x = k as f64 * p.candidate_spacing;
            if x > end + TOL {
                break;
            }
            add(&mut cands, x.min(end), None);
            k += 1;
        }
        add(&mut cands, end, None);
        let inside = |x: f64, s: &Sector| x > s.from + TOL && x < s.to - TOL;
        if parity {
            // SEILAPLAN removes grid stations in the sectors, then adds peaks and fixed supports.
            cands.retain(|c| !sectors.iter().any(|s| inside(c.0, s)));
        }
        for &x in &peaks {
            add(&mut cands, x, None);
        }
        for f in &fixed {
            add(&mut cands, f.station, Some(f.height));
        }
        if !parity {
            cands
                .retain(|c| c.1.is_some() || c.0 <= TOL || c.0 >= end - TOL || !sectors.iter().any(|s| inside(c.0, s)));
        }
        cands.retain(|c| !profile.ground(c.0).is_nan());
        cands.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        // Convexity filter: a site must stand above the line between its neighbours (the
        // catenary model also keeps sites on it, so straight slopes keep their candidates).
        let m = cands.len();
        let ground: Vec<f64> = cands.iter().map(|c| profile.ground(c.0)).collect();
        let mut valid = vec![true; m];
        for i in 0..m {
            if i < 5 || i + 5 >= m || cands[i].1.is_some() {
                continue;
            }
            let (x0, x1, x2) = (cands[i - 1].0, cands[i].0, cands[i + 1].0);
            let line = ground[i - 1] + (ground[i + 1] - ground[i - 1]) * (x1 - x0) / (x2 - x0);
            valid[i] = if parity { ground[i] > line + 1e-9 } else { ground[i] >= line - 1e-9 };
        }
        let sites: Vec<f64> = cands.iter().zip(&valid).filter(|(_, v)| **v).map(|(c, _)| c.0).collect();
        let ctx = Ctx::new(p, &profile);

        // Nodes, by station then height.
        let mut nodes = Vec::new();
        let start_heights = match p.start_kind {
            StartKind::Yarder => vec![p.tower_height],
            StartKind::Anchor => vec![0.0],
            StartKind::Support => params::ladder(ctx.start_low, p.max_height, p.height_step),
        };
        for h in start_heights {
            nodes.push(Node {
                point: ctx.line_start(h),
                role: Role::Start,
                fixed: false,
                cost: params::support_cost(h, p.artificial_height),
            });
        }
        for (i, c) in cands.iter().enumerate() {
            if !valid[i] || c.0 <= TOL || c.0 >= end - TOL {
                continue;
            }
            let heights = match c.1 {
                Some(Some(h)) => vec![h],
                _ => params::ladder(p.min_height, p.max_height, p.height_step),
            };
            for h in heights {
                let point = Point { station: c.0, ground: profile.ground(c.0), height: h };
                nodes.push(Node {
                    point,
                    role: Role::Mid,
                    fixed: c.1.is_some(),
                    cost: params::support_cost(h, p.artificial_height),
                });
            }
        }
        let end_heights = match p.end_kind {
            EndKind::Anchor => vec![0.0],
            EndKind::Support => params::ladder(ctx.end_low, p.max_height, p.height_step),
        };
        for h in end_heights {
            nodes.push(Node {
                point: ctx.line_end(h),
                role: Role::End,
                fixed: false,
                cost: params::support_cost(h, p.artificial_height),
            });
        }

        // Forward spans.
        let fixed_stations: Vec<f64> = fixed.iter().map(|f| f.station).collect();
        let mut arcs = Vec::new();
        let mut in_arcs = vec![Vec::new(); nodes.len()];
        let mut out_arcs = vec![Vec::new(); nodes.len()];
        for i in 0..nodes.len() {
            let a = nodes[i];
            if a.role == Role::End {
                continue;
            }
            for j in i + 1..nodes.len() {
                let e = nodes[j];
                if e.role == Role::Start || e.point.station <= a.point.station + TOL {
                    continue;
                }
                let gap = e.point.station - a.point.station;
                if a.role != Role::Start && e.role != Role::End {
                    let close =
                        if parity { gap <= p.min_support_spacing + 1e-3 } else { gap < p.min_support_spacing - TOL };
                    if close {
                        continue;
                    }
                }
                if fixed_stations.iter().any(|&s| s > a.point.station + TOL && s < e.point.station - TOL) {
                    continue;
                }
                if arcs.len() >= p.max_arcs {
                    return Err(InputError::TooManySpans);
                }
                let index = arcs.len() as u32;
                arcs.push(Arc {
                    from: i as u32,
                    to: j as u32,
                    evaluated: false,
                    feasible: false,
                    lo: f64::NAN,
                    hi: f64::NAN,
                    reason: Reason::None,
                    at: f64::NAN,
                    value: f64::NAN,
                    value2: f64::NAN,
                });
                out_arcs[i].push(index);
                in_arcs[j].push(index);
            }
        }
        Ok(Job { params, profile, fixed, sectors, peaks, sites, nodes, arcs, in_arcs, out_arcs, next: 0, evaluated: 0 })
    }

    pub fn done(&self) -> bool {
        self.next >= self.arcs.len()
    }

    /// Pre-tensions the per-tension search runs over.
    pub fn tensions(&self) -> Vec<f64> {
        let p = &self.params;
        let mut out = Vec::new();
        let mut k = 0usize;
        loop {
            let t = p.tension_low + k as f64 * p.tension_step;
            if t > p.tension_high + 1e-9 {
                break;
            }
            out.push(t);
            k += 1;
        }
        out
    }

    /// Evaluates up to `budget` more spans. Returns true once every span is evaluated.
    pub fn step(&mut self, budget: usize) -> bool {
        let ctx = Ctx::new(&self.params, &self.profile);
        let tensions = self.tensions();
        let stop = (self.next + budget).min(self.arcs.len());
        for i in self.next..stop {
            let arc = self.arcs[i];
            let (a, e) = (self.nodes[arc.from as usize], self.nodes[arc.to as usize]);
            self.arcs[i] = evaluate(&ctx, &a, &e, arc, &tensions);
            self.evaluated += 1;
        }
        self.next = stop;
        self.done()
    }

    fn search_fields(ctx: &Ctx, a: &Node, e: &Node) -> (Vec<Field>, usize, f64) {
        let p = ctx.p;
        let start_h = if a.role == Role::Start { a.point.height } else { ctx.start_low };
        let end_h = if e.role == Role::End { e.point.height } else { ctx.end_low };
        let s = ctx.line_start(start_h);
        let t = ctx.line_end(end_h);
        let (sa, ea) = ctx.anchor_fields(start_h, end_h);
        let mut fields = Vec::with_capacity(5);
        if let Some(f) = sa {
            fields.push(f);
        }
        if a.point.station > TOL {
            fields.push(Field { xa: 0.0, za: s.top(), xb: a.point.station, zb: a.point.top() });
        }
        let loaded = fields.len();
        fields.push(Field { xa: a.point.station, za: a.point.top(), xb: e.point.station, zb: e.point.top() });
        if e.point.station < p.line_end - TOL {
            fields.push(Field { xa: e.point.station, za: e.point.top(), xb: p.line_end, zb: t.top() });
        }
        if let Some(f) = ea {
            fields.push(f);
        }
        (fields, loaded, s.top())
    }

    /// Runs the per-tension search and the final analysis. Call once every span is evaluated.
    pub fn finish(&self) -> Outcome {
        if self.params.model == Model::Parity {
            self.finish_parity()
        } else {
            self.finish_catenary()
        }
    }

    fn analyse_path(&self, path: &[usize], complete: bool, t: f64) -> Analysis {
        let ctx = Ctx::new(&self.params, &self.profile);
        let points: Vec<Point> = path.iter().map(|&i| self.nodes[i].point).collect();
        let fixed: Vec<bool> = path.iter().map(|&i| self.nodes[i].fixed).collect();
        analysis::analyze(&ctx, &Layout { points: &points, fixed: &fixed, complete }, t)
    }

    // --- Parity selection --------------------------------------------------------------------

    fn finish_parity(&self) -> Outcome {
        let tensions = self.tensions();
        let n = self.nodes.len();
        let lowest_start = 0usize;
        let mut best: Option<(usize, f64, f64, Vec<usize>)> = None; // (farthest, cost, t, path)
        let mut ties: Vec<f64> = Vec::new();
        for &t in &tensions {
            let mut dist = vec![f64::INFINITY; n];
            let mut pred = vec![usize::MAX; n];
            for (i, node) in self.nodes.iter().enumerate() {
                if node.role == Role::Start {
                    dist[i] = 0.0;
                }
            }
            for i in 0..n {
                if !dist[i].is_finite() {
                    continue;
                }
                for &ai in &self.out_arcs[i] {
                    let arc = &self.arcs[ai as usize];
                    if !(arc.feasible && arc.lo < t && t < arc.hi) {
                        continue;
                    }
                    let j = arc.to as usize;
                    let w = self.nodes[j].cost + if i == lowest_start { self.nodes[i].cost } else { 0.0 };
                    if dist[i] + w <= dist[j] {
                        dist[j] = dist[i] + w;
                        pred[j] = i;
                    }
                }
            }
            // Farthest reached: the sink (any end node), else the reachable node of largest index.
            let mut end_best: Option<usize> = None;
            for (i, node) in self.nodes.iter().enumerate() {
                if node.role == Role::End && dist[i].is_finite() && end_best.is_none_or(|b| dist[i] < dist[b]) {
                    end_best = Some(i);
                }
            }
            let (far, node, cost) = match end_best {
                Some(i) => (usize::MAX, i, dist[i] + 1.0),
                None => {
                    let i = (0..n).rev().find(|&i| dist[i].is_finite()).unwrap_or(0);
                    (i, i, dist[i])
                }
            };
            let mut path = vec![node];
            while pred[*path.last().unwrap()] != usize::MAX {
                path.push(pred[*path.last().unwrap()]);
            }
            path.reverse();
            let better = match &best {
                None => true,
                Some((bf, bc, _, _)) => far > *bf || (far == *bf && cost < *bc),
            };
            let same = matches!(&best, Some((bf, bc, _, _)) if far == *bf && cost == *bc);
            if better {
                best = Some((far, cost, t, path));
                ties = vec![t];
            } else if same {
                ties.push(t);
            }
        }
        let (far, cost, t, mut path) = best.unwrap();
        let complete = far == usize::MAX;
        if !complete {
            // SEILAPLAN drops the farthest node it reached.
            path.pop();
        }
        let reach = path.last().map(|&i| self.nodes[i].point.station).unwrap_or(0.0);
        if path.len() < 2 {
            let (reason, at, value, value2) = self.blocking_reason(&path, t, &HashMap::new());
            return Outcome {
                status: Status::NoLayout,
                reason,
                reason_at: at,
                reason_value: value,
                reason_value2: value2,
                tension: f64::NAN,
                tie_low: f64::NAN,
                tie_high: f64::NAN,
                tie_count: 0,
                objective: f64::NAN,
                reach: 0.0,
                verifications: 0,
                path: Vec::new(),
                analysis: Analysis::default(),
            };
        }
        let analysis = self.analyse_path(&path, complete, t);
        let (reason, at, value, value2) = if complete {
            (Reason::None, f64::NAN, f64::NAN, f64::NAN)
        } else {
            self.blocking_reason(&path, t, &HashMap::new())
        };
        Outcome {
            status: if complete { Status::Complete } else { Status::Incomplete },
            reason,
            reason_at: at,
            reason_value: value,
            reason_value2: value2,
            tension: t,
            tie_low: ties.iter().cloned().fold(f64::INFINITY, f64::min),
            tie_high: ties.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
            tie_count: ties.len(),
            objective: cost,
            reach,
            verifications: 0,
            path,
            analysis,
        }
    }

    // --- Catenary selection --------------------------------------------------------------------

    /// Cheapest line at tension `t` over span states, honouring banned spans and support pairs.
    fn dp(&self, t: f64, bans: Option<&Bans>) -> Best {
        let n_arcs = self.arcs.len();
        let mut best = vec![f64::INFINITY; n_arcs];
        let mut pred = vec![u32::MAX; n_arcs];
        let usable = |ai: usize| {
            let a = &self.arcs[ai];
            a.feasible && a.lo <= t + 1e-9 && t <= a.hi + 1e-9 && !bans.is_some_and(|b| b.arcs.contains(&(ai as u32)))
        };
        for (i, node) in self.nodes.iter().enumerate() {
            if node.role == Role::End {
                continue;
            }
            let mut incoming: Vec<(f64, u32)> = Vec::new();
            if node.role != Role::Start {
                for &p in &self.in_arcs[i] {
                    if best[p as usize].is_finite() {
                        incoming.push((best[p as usize], p));
                    }
                }
                if incoming.is_empty() {
                    continue;
                }
                incoming.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap().then(a.1.cmp(&b.1)));
            }
            for &ai in &self.out_arcs[i] {
                if !usable(ai as usize) {
                    continue;
                }
                let to_cost = self.nodes[self.arcs[ai as usize].to as usize].cost;
                if node.role == Role::Start {
                    best[ai as usize] = node.cost + to_cost;
                    continue;
                }
                let choice = incoming.iter().find(|(_, p)| !bans.is_some_and(|b| b.pairs.contains(&pair_key(*p, ai))));
                if let Some(&(c, p)) = choice {
                    best[ai as usize] = c + to_cost;
                    pred[ai as usize] = p;
                }
            }
        }
        // Complete if an end node is reached; else the farthest station, cheapest node there.
        let mut chosen: Option<(bool, f64, f64, u32)> = None;
        for (ai, arc) in self.arcs.iter().enumerate() {
            if !best[ai].is_finite() {
                continue;
            }
            let to = &self.nodes[arc.to as usize];
            let key = (to.role == Role::End, to.point.station, best[ai], ai as u32);
            let better = match chosen {
                None => true,
                Some((c, r, cost, idx)) => {
                    (key.0 && !c)
                        || (key.0 == c
                            && (key.1 > r + TOL
                                || ((key.1 - r).abs() <= TOL && (key.2 < cost || (key.2 == cost && key.3 < idx)))))
                }
            };
            if better {
                chosen = Some(key);
            }
        }
        match chosen {
            None => {
                // Nothing beyond the start: the cheapest start node.
                let start = (0..self.nodes.len())
                    .filter(|&i| self.nodes[i].role == Role::Start)
                    .min_by(|&a, &b| self.nodes[a].cost.partial_cmp(&self.nodes[b].cost).unwrap())
                    .unwrap();
                Best { complete: false, reach: 0.0, cost: self.nodes[start].cost, arcs: Vec::new(), start }
            }
            Some((complete, reach, cost, last)) => {
                let mut arcs = vec![last];
                while pred[*arcs.last().unwrap() as usize] != u32::MAX {
                    arcs.push(pred[*arcs.last().unwrap() as usize]);
                }
                arcs.reverse();
                let start = self.arcs[arcs[0] as usize].from as usize;
                Best { complete, reach, cost, arcs, start }
            }
        }
    }

    fn path_nodes(&self, b: &Best) -> Vec<usize> {
        let mut out = vec![b.start];
        for &a in &b.arcs {
            out.push(self.arcs[a as usize].to as usize);
        }
        out
    }

    /// Re-checks a best line with the final analysis; returns the bans its failures call for.
    fn verify(&self, b: &Best, t: f64) -> (Analysis, Vec<Ban>) {
        let path = self.path_nodes(b);
        let analysis = self.analyse_path(&path, b.complete, t);
        let mut bans = Vec::new();
        for (k, s) in analysis.spans.iter().enumerate() {
            if !s.verdict.ok() {
                let (reason, at, value) = s.verdict.reason();
                bans.push(Ban::Arc(b.arcs[k], reason, at, value));
            }
        }
        // Supports: the analysis lists the anchor behind a support start first.
        let offset = usize::from(analysis.supports.first().is_some_and(|s| s.kind == analysis::SupportKind::Anchor));
        let n = path.len();
        for i in 0..n {
            let s = &analysis.supports[offset + i];
            let lift = !s.lift_off_limit.is_nan() && !(s.empty_break >= s.lift_off_limit - 1e-9);
            let loaded = !s.loaded_limit.is_nan() && !s.loaded_break.is_nan() && s.loaded_break > s.loaded_limit + 1e-9;
            if !(lift || loaded) {
                continue;
            }
            // The frontier of an incomplete line has no next span to judge it by.
            if !b.complete && i == n - 1 {
                continue;
            }
            let (reason, value) =
                if lift { (Reason::LiftOff, s.empty_break) } else { (Reason::LoadedAngle, s.loaded_break) };
            let at = s.point.station;
            if i == 0 {
                bans.push(Ban::Arc(b.arcs[0], reason, at, value));
            } else if i == n - 1 {
                bans.push(Ban::Arc(b.arcs[n - 2], reason, at, value));
            } else {
                bans.push(Ban::Pair(b.arcs[i - 1], b.arcs[i], reason, at, value));
            }
        }
        (analysis, bans)
    }

    fn finish_catenary(&self) -> Outcome {
        let tensions = self.tensions();
        let mut bans: HashMap<usize, Bans> = HashMap::new();
        let mut results: Vec<Option<Best>> = tensions.iter().map(|&t| Some(self.dp(t, None))).collect();
        let mut repairs = vec![0usize; tensions.len()];
        let mut verified: Vec<Option<Analysis>> = vec![None; tensions.len()];
        let mut verifications = 0usize;
        let mut accepted: Option<(usize, Key)> = None;
        let mut ties: Vec<usize> = Vec::new();
        loop {
            // The best remaining key; keys only get worse with bans, so it is a lower bound.
            let mut pick: Option<(usize, Key)> = None;
            for (i, r) in results.iter().enumerate() {
                let Some(r) = r else { continue };
                if verified[i].is_some() && accepted.is_some() {
                    continue;
                }
                let key = Key::of(r);
                if pick.as_ref().is_none_or(|(_, k)| key.better(k)) {
                    pick = Some((i, key));
                }
            }
            let Some((i, key)) = pick else { break };
            if let Some((_, best_key)) = &accepted {
                if !key.same(best_key) {
                    break;
                }
            }
            if verified[i].is_some() {
                if accepted.is_none() {
                    accepted = Some((i, key));
                    ties.push(i);
                }
                continue;
            }
            let best = results[i].as_ref().unwrap();
            let (analysis, found) =
                if best.arcs.is_empty() { (Analysis::default(), Vec::new()) } else { self.verify(best, tensions[i]) };
            verifications += 1;
            if found.is_empty() {
                verified[i] = Some(analysis);
                if accepted.is_none() {
                    accepted = Some((i, key));
                }
                ties.push(i);
                continue;
            }
            repairs[i] += 1;
            if repairs[i] > MAX_REPAIRS || verifications > MAX_VERIFICATIONS {
                results[i] = None;
                continue;
            }
            let entry = bans.entry(i).or_default();
            for ban in found {
                match ban {
                    Ban::Arc(a, r, at, v) => {
                        entry.arcs.insert(a);
                        entry.why.insert(a as u64, (r, at, v));
                    }
                    Ban::Pair(a, b, r, at, v) => {
                        entry.pairs.insert(pair_key(a, b));
                        entry.why.insert(b as u64, (r, at, v));
                    }
                }
            }
            results[i] = Some(self.dp(tensions[i], bans.get(&i)));
        }
        let empty = HashMap::new();
        let Some((i, _)) = accepted else {
            let (reason, at, value, value2) =
                self.blocking_reason(&[], tensions.first().copied().unwrap_or(f64::NAN), &empty);
            return Outcome {
                status: Status::NoLayout,
                reason: if verifications > MAX_VERIFICATIONS { Reason::Budget } else { reason },
                reason_at: at,
                reason_value: value,
                reason_value2: value2,
                tension: f64::NAN,
                tie_low: f64::NAN,
                tie_high: f64::NAN,
                tie_count: 0,
                objective: f64::NAN,
                reach: 0.0,
                verifications,
                path: Vec::new(),
                analysis: Analysis::default(),
            };
        };
        let best = results[i].as_ref().unwrap();
        let t = tensions[i];
        let path = self.path_nodes(best);
        let tie_t: Vec<f64> = ties.iter().map(|&k| tensions[k]).collect();
        let why = bans.get(&i).map(|b| &b.why).unwrap_or(&empty);
        if best.arcs.is_empty() {
            let (reason, at, value, value2) = self.blocking_reason(&path, t, why);
            return Outcome {
                status: Status::NoLayout,
                reason,
                reason_at: at,
                reason_value: value,
                reason_value2: value2,
                tension: f64::NAN,
                tie_low: f64::NAN,
                tie_high: f64::NAN,
                tie_count: 0,
                objective: f64::NAN,
                reach: 0.0,
                verifications,
                path: Vec::new(),
                analysis: Analysis::default(),
            };
        }
        let analysis = verified[i].take().unwrap_or_else(|| self.analyse_path(&path, best.complete, t));
        let (reason, at, value, value2) = if best.complete {
            (Reason::None, f64::NAN, f64::NAN, f64::NAN)
        } else {
            self.blocking_reason(&path, t, why)
        };
        Outcome {
            status: if best.complete { Status::Complete } else { Status::Incomplete },
            reason,
            reason_at: at,
            reason_value: value,
            reason_value2: value2,
            tension: t,
            tie_low: tie_t.iter().cloned().fold(f64::INFINITY, f64::min),
            tie_high: tie_t.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
            tie_count: tie_t.len(),
            objective: best.cost,
            reach: best.reach,
            verifications,
            path,
            analysis,
        }
    }

    /// Why the line cannot go past its last support: the limit that stops most of the spans out of
    /// it (by the span check, the tension window or a ban), placed at the nearest such span.
    fn blocking_reason(
        &self,
        path: &[usize],
        t: f64,
        why: &HashMap<u64, (Reason, f64, f64)>,
    ) -> (Reason, f64, f64, f64) {
        let froms: Vec<usize> = match path.last() {
            Some(&i) => vec![i],
            None => (0..self.nodes.len()).filter(|&i| self.nodes[i].role == Role::Start).collect(),
        };
        // Each span out of the frontier with its reason, where, and its far station and height.
        let mut found: Vec<((Reason, f64, f64, f64), f64, f64)> = Vec::new();
        for &f in &froms {
            for &ai in &self.out_arcs[f] {
                let arc = &self.arcs[ai as usize];
                let to = self.nodes[arc.to as usize].point;
                let reason = if !arc.feasible {
                    (arc.reason, arc.at, arc.value, arc.value2)
                } else if let Some(&(r, at, v)) = why.get(&(ai as u64)) {
                    (r, at, v, f64::NAN)
                } else if !(arc.lo <= t && t <= arc.hi) {
                    (Reason::TensionWindow, to.station, arc.lo, arc.hi)
                } else {
                    continue;
                };
                found.push((reason, to.station, to.height));
            }
        }
        if found.is_empty() {
            return (Reason::NoCandidates, f64::NAN, f64::NAN, f64::NAN);
        }
        let mut counts: Vec<(Reason, usize)> = Vec::new();
        for (r, _, _) in &found {
            match counts.iter_mut().find(|(c, _)| *c == r.0) {
                Some(entry) => entry.1 += 1,
                None => counts.push((r.0, 1)),
            }
        }
        let common = counts.iter().max_by_key(|(_, n)| *n).map(|(r, _)| *r).unwrap();
        found
            .iter()
            .filter(|(r, _, _)| r.0 == common)
            .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap().then(b.2.partial_cmp(&a.2).unwrap()))
            .map(|(r, _, _)| *r)
            .unwrap()
    }
}

const MAX_REPAIRS: usize = 60;
const MAX_VERIFICATIONS: usize = 4000;

#[derive(Default)]
struct Bans {
    arcs: HashSet<u32>,
    pairs: HashSet<u64>,
    why: HashMap<u64, (Reason, f64, f64)>,
}

enum Ban {
    Arc(u32, Reason, f64, f64),
    Pair(u32, u32, Reason, f64, f64),
}

fn pair_key(a: u32, b: u32) -> u64 {
    ((a as u64) << 32) | b as u64
}

struct Best {
    complete: bool,
    reach: f64,
    cost: f64,
    arcs: Vec<u32>,
    start: usize,
}

#[derive(Clone, Copy, Debug)]
struct Key {
    complete: bool,
    reach: f64,
    cost: f64,
}

impl Key {
    fn of(b: &Best) -> Key {
        Key { complete: b.complete, reach: b.reach, cost: b.cost }
    }
    /// Complete first, then farther, then cheaper. Ties keep the earlier (lower) tension.
    fn better(&self, o: &Key) -> bool {
        if self.complete != o.complete {
            return self.complete;
        }
        if (self.reach - o.reach).abs() > TOL {
            return self.reach > o.reach;
        }
        self.cost < o.cost
    }
    fn same(&self, o: &Key) -> bool {
        self.complete == o.complete && (self.reach - o.reach).abs() <= TOL && self.cost == o.cost
    }
}

/// Finds the pre-tensions span `a → e` works at.
fn evaluate(ctx: &Ctx, a: &Node, e: &Node, mut arc: Arc, tensions: &[f64]) -> Arc {
    arc.evaluated = true;
    // Below the chord a cable hangs by M(x)/H, M the simply supported moment of its loads, and
    // H never exceeds the allowable tension on a span that passes. With the load at x and the
    // skyline's own weight that bound is a path the real one can only be below.
    let (xa, za, xb, zb) = (a.point.station, a.point.top(), e.point.station, e.point.top());
    let span = xb - xa;
    let (load, weight, allowable) = (ctx.p.load, ctx.p.rope_weight, ctx.p.allowable);
    let best_case = ctx.clearance(xa, xb, |x| {
        let (u, v) = (x - xa, xb - x);
        za + (zb - za) * u / span - (load * u * v / span + weight * u * v / 2.0) / allowable
    });
    if !best_case.clear_ok {
        let (reason, at, value) = best_case.reason();
        arc.feasible = false;
        arc.reason = reason;
        arc.at = at;
        arc.value = value;
        return arc;
    }
    let parity = ctx.p.model == Model::Parity;
    let (fields, loaded, datum) = Job::search_fields(ctx, a, e);
    let check = |t: f64| -> Verdict {
        if parity {
            ctx.check_parity(a.point, e.point, t, a.role == Role::Start)
        } else {
            ctx.check_catenary(&fields, loaded, datum, t).0
        }
    };
    let set_fail = |arc: &mut Arc, v: &Verdict| {
        let (reason, at, value) = v.reason();
        arc.feasible = false;
        arc.reason = reason;
        arc.at = at;
        arc.value = value;
    };
    if parity {
        // SEILAPLAN: two bisections over [lowest, allowable] to steps of 1 kN, the window being
        // the smallest and largest evaluated tensions where the span passed every check.
        let (lo_t, hi_t) = (ctx.p.tension_low, ctx.p.tension_high);
        let mut seen: Vec<(f64, Verdict)> = Vec::new();
        let ev = |t: f64, seen: &mut Vec<(f64, Verdict)>| -> Verdict {
            if let Some((_, v)) = seen.iter().find(|(x, _)| *x == t) {
                return *v;
            }
            let v = check(t);
            seen.push((t, v));
            v
        };
        let top = ev(hi_t, &mut seen);
        if !top.solved {
            set_fail(&mut arc, &top);
            return arc;
        }
        let bottom = ev(lo_t, &mut seen);
        if !bottom.upper_ok() {
            set_fail(&mut arc, if bottom.solved { &bottom } else { &top });
            if bottom.solved {
                arc.reason = Reason::Tension;
                arc.value = bottom.peak;
            }
            return arc;
        }
        if !top.upper_ok() {
            let (mut lo, mut hi) = (lo_t, hi_t);
            while hi - lo > 1.0 {
                let mid = 0.5 * (lo + hi);
                if ev(mid, &mut seen).upper_ok() {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
        }
        if !bottom.lower_ok() {
            if !top.lower_ok() {
                set_fail(&mut arc, &top);
                return arc;
            }
            let (mut lo, mut hi) = (lo_t, hi_t);
            while hi - lo > 1.0 {
                let mid = 0.5 * (lo + hi);
                if ev(mid, &mut seen).lower_ok() {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }
        }
        let ok: Vec<f64> = seen.iter().filter(|(_, v)| v.ok()).map(|(t, _)| *t).collect();
        if ok.is_empty() {
            arc.feasible = false;
            arc.reason = Reason::TensionWindow;
            return arc;
        }
        arc.feasible = true;
        arc.lo = ok.iter().cloned().fold(f64::INFINITY, f64::min);
        arc.hi = ok.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        return arc;
    }
    // Catenary: bisection over the pre-tension grid for the lowest tension that clears and the
    // highest within the allowable; the span works over the closed interval between them.
    let last = tensions.len() - 1;
    let mut seen: Vec<Option<Verdict>> = vec![None; tensions.len()];
    let ev = |k: usize, seen: &mut Vec<Option<Verdict>>| -> Verdict {
        if let Some(v) = seen[k] {
            return v;
        }
        let v = check(tensions[k]);
        seen[k] = Some(v);
        v
    };
    let top = ev(last, &mut seen);
    if !top.lower_ok() {
        set_fail(&mut arc, &top);
        return arc;
    }
    let bottom = ev(0, &mut seen);
    if !bottom.upper_ok() {
        set_fail(&mut arc, &bottom);
        if !bottom.solved {
            arc.reason = Reason::Unsolvable;
        }
        return arc;
    }
    // The window's ends by false position on the checks' margins, which change smoothly with
    // tension, closing on the integer grid.
    let low = if bottom.lower_ok() {
        0
    } else {
        let mut probe = |k: usize| {
            let v = ev(k, &mut seen);
            (v.lower_ok(), v.lower_margin)
        };
        first_ok(0, last, bottom.lower_margin, top.lower_margin, &mut probe)
    };
    let high = if top.upper_ok() {
        last
    } else {
        // Mirror the grid so the tension check becomes "ok from here up".
        let mut probe = |k: usize| {
            let v = ev(last - k, &mut seen);
            (v.upper_ok(), v.upper_margin)
        };
        last - first_ok(0, last, top.upper_margin, bottom.upper_margin, &mut probe)
    };
    if low > high {
        arc.feasible = false;
        arc.reason = Reason::TensionWindow;
        arc.at = e.point.station;
        arc.value = tensions[low];
        arc.value2 = tensions[high];
        return arc;
    }
    arc.feasible = true;
    arc.lo = tensions[low];
    arc.hi = tensions[high];
    arc
}

/// Smallest index in (fail, ok] whose check passes, given that checks pass from some index up and
/// `margin` grows with the index. Illinois false position with a neighbour probe once the estimate
/// is close, bisection as a fallback.
fn first_ok(
    mut fail: usize,
    mut ok: usize,
    mut m_fail: f64,
    mut m_ok: f64,
    probe: &mut dyn FnMut(usize) -> (bool, f64),
) -> usize {
    let mut rounds = 0;
    let mut last_side = 0i8;
    while ok - fail > 1 {
        rounds += 1;
        let usable = m_fail.is_finite() && m_ok.is_finite() && m_ok > 0.0 && m_fail < 0.0;
        let k = if rounds <= 8 && usable {
            let est = fail as f64 + (ok - fail) as f64 * (-m_fail) / (m_ok - m_fail);
            (est.ceil() as usize).clamp(fail + 1, ok - 1)
        } else {
            (fail + ok) / 2
        };
        let (good, m) = probe(k);
        if good {
            ok = k;
            m_ok = m;
            if last_side == 1 {
                m_fail /= 2.0;
            }
            last_side = 1;
        } else {
            fail = k;
            m_fail = m;
            if last_side == -1 {
                m_ok /= 2.0;
            }
            last_side = -1;
        }
        // Close a one-step gap at once when the estimate landed next to the boundary.
        if ok - fail == 2 {
            let (g2, m2) = probe(fail + 1);
            if g2 {
                ok = fail + 1;
                m_ok = m2;
            } else {
                fail += 1;
                m_fail = m2;
            }
        }
    }
    ok
}
