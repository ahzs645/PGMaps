//! The coverage screen: for one candidate skyline from a landing along a bearing, the longest line
//! that works with at most N intermediate supports. A block-coverage run (PGMaps'
//! `cableCoverage.ts`) sends thousands of these, one per landing and bearing, in batches.
//!
//! The question is the one Sylvaccess's cable module asks of each line (Dupire et al. 2015, Revue
//! forestière française 67(2); Dupire, Bourrier & Berger 2016, J. For. Res. 21(1)): walk out from
//! the yarder, and find how far a skyline reaches before the loaded carriage can no longer clear
//! the ground within the rope's allowable tension, given that supports may be added. The method is
//! this crate's own, not Sylvaccess's:
//!
//! - Spans are judged by `search::evaluate`, the support search's own span check (the elastic
//!   catenary of `context::Ctx::check_catenary` over a grid of pre-tensions), and every line
//!   returned has passed the final analysis (`analysis::analyze` plus `analysis::support_failure`)
//!   as a complete line at one pre-tension. Nothing here adds a check the support search lacks.
//! - Supports are candidates every `candidate_spacing` metres at one height; the tail is a support
//!   end at the tail height with an anchor behind it.
//! - For a tail station, the line is grown by levels: level k holds the candidates reachable with k
//!   supports before them, each with the set of pre-tensions (a bit mask over the grid) at which a
//!   chain of spans reaches it. A pre-tension serves the whole rope, so a chain works only where its
//!   spans' windows overlap; keeping masks rather than intervals keeps that exact. From each kept
//!   candidate the search tries targets farthest first and keeps the first `COVER_TARGETS` that
//!   work; the `COVER_BEAM` farthest candidates go on to the next level. Fewest supports first: the
//!   line ends at the first level whose candidates reach the tail and pass the final analysis.
//! - Tails are tried from the farthest inward. When a tail fails, the next one tried is the
//!   farthest candidate any level reached (each such chain is a shorter line with no more
//!   supports), or one step in, whichever is nearer the yarder.
//!
//! Written from a functional specification of Sylvaccess 3.6 (INRAE, GPL-3.0-or-later); no code
//! from Sylvaccess was used. MIT licensed, as PGMaps.

use std::collections::HashMap;

use crate::analysis::{self, Layout};
use crate::context::{Ctx, Point, Reason};
use crate::params::{self, InputError, Params, Profile, StartKind};
use crate::search::{evaluate, Arc, Node, Role};

/// Candidates kept per level, farthest first.
pub const COVER_BEAM: usize = 5;
/// Working targets kept from each candidate, farthest first.
pub const COVER_TARGETS: usize = 3;
/// Most intermediate supports a coverage line may have.
pub const MAX_COVER_SUPPORTS: usize = 10;
/// Most pre-tension levels; one bit each in a mask.
pub const MAX_COVER_TENSIONS: usize = 64;
/// Pre-tensions tried in the final analysis per complete chain.
const VERIFY_TENSIONS: usize = 3;

#[derive(Clone, Debug)]
pub struct CoverParams {
    /// The rope, load and line rules. `start_kind` must be a yarder; `min_height`, `max_height`
    /// are the support height, `line_end` is set per tail.
    pub base: Params,
    pub tail_height: f64,
    pub max_supports: usize,
    /// Distance between tails tried, m.
    pub tail_step: f64,
    /// Shortest line kept, m (horizontal).
    pub min_length: f64,
    /// Most spans one line may evaluate before it is reported at its budget.
    pub max_arcs: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum CoverStatus {
    /// A line of `length` works.
    Feasible = 0,
    /// No line at least the minimum length works.
    None = 1,
    /// The span budget ran out before a line was found.
    Budget = 2,
}

#[derive(Clone, Debug)]
pub struct CoverLine {
    pub status: CoverStatus,
    /// Horizontal length of the line found (0 when none).
    pub length: f64,
    pub tension: f64,
    /// Yarder, supports and tail.
    pub points: Vec<Point>,
    /// Why the longest tail tried did not work, and where.
    pub reason: Reason,
    pub reason_at: f64,
    pub arcs: usize,
    pub verifications: usize,
}

/// Checks the shared settings once for a batch.
pub fn validate_cover(cp: &CoverParams) -> Result<(), InputError> {
    let p = &cp.base;
    if p.start_kind != StartKind::Yarder || p.model != params::Model::Catenary {
        return Err(InputError::Format);
    }
    if !(cp.tail_height >= 0.0) || !cp.tail_height.is_finite() || !(cp.tail_step > 0.0) || !(cp.min_length >= 0.0) {
        return Err(InputError::Format);
    }
    if cp.max_supports > MAX_COVER_SUPPORTS || cp.max_arcs == 0 {
        return Err(InputError::Format);
    }
    let levels = ((p.tension_high - p.tension_low) / p.tension_step + 1e-9).floor() as usize + 1;
    if !(p.tension_step > 0.0)
        || !(p.tension_low > 0.0)
        || p.tension_low > p.tension_high
        || levels > MAX_COVER_TENSIONS
    {
        return Err(InputError::TensionRange);
    }
    if !(p.min_height > 0.0) || p.min_height != p.max_height || !(p.candidate_spacing > 0.0) {
        return Err(InputError::HeightLadder);
    }
    if p.min_clearance > p.min_height + 1e-9 {
        return Err(InputError::ClearanceAboveSupport);
    }
    Ok(())
}

fn tensions(p: &Params) -> Vec<f64> {
    let mut out = Vec::new();
    let mut k = 0usize;
    loop {
        let t = p.tension_low + k as f64 * p.tension_step;
        if t > p.tension_high + 1e-9 || out.len() >= MAX_COVER_TENSIONS {
            break;
        }
        out.push(t);
        k += 1;
    }
    out
}

/// One tail's search state: nodes, memoised span masks.
struct Tail<'a> {
    ctx: Ctx<'a>,
    nodes: Vec<Node>,
    memo: HashMap<u64, (u64, Arc)>,
    tensions: &'a [f64],
}

impl<'a> Tail<'a> {
    fn mask(&mut self, from: usize, to: usize, arcs: &mut usize) -> u64 {
        let key = ((from as u64) << 32) | to as u64;
        if let Some(&(m, _)) = self.memo.get(&key) {
            return m;
        }
        *arcs += 1;
        let blank = Arc {
            from: from as u32,
            to: to as u32,
            evaluated: false,
            feasible: false,
            lo: f64::NAN,
            hi: f64::NAN,
            reason: Reason::None,
            at: f64::NAN,
            value: f64::NAN,
            value2: f64::NAN,
        };
        let arc = evaluate(&self.ctx, &self.nodes[from], &self.nodes[to], blank, self.tensions);
        let mut m = 0u64;
        if arc.feasible {
            let t0 = self.tensions[0];
            let step = if self.tensions.len() > 1 { self.tensions[1] - t0 } else { 1.0 };
            let lo = ((arc.lo - t0) / step).round().max(0.0) as usize;
            let hi = (((arc.hi - t0) / step).round() as usize).min(self.tensions.len() - 1);
            for k in lo..=hi {
                m |= 1u64 << k;
            }
        }
        self.memo.insert(key, (m, arc));
        m
    }
    fn reason(&self, from: usize, to: usize) -> Option<(Reason, f64)> {
        let key = ((from as u64) << 32) | to as u64;
        self.memo.get(&key).map(|(_, a)| (a.reason, a.at))
    }
}

/// Builds the yarder, the candidate supports and the tail for a line ending at `tail`.
fn nodes_for(cp: &CoverParams, ctx: &Ctx, prof: &Profile, tail: f64) -> Vec<Node> {
    let p = &cp.base;
    let mut nodes = vec![Node { point: ctx.line_start(p.tower_height), role: Role::Start, fixed: false, cost: 0.0 }];
    let mut k = 1usize;
    loop {
        let x = k as f64 * p.candidate_spacing;
        if x >= tail - 1e-6 {
            break;
        }
        let ground = prof.ground(x);
        if !ground.is_nan() {
            nodes.push(Node {
                point: Point { station: x, ground, height: p.min_height },
                role: Role::Mid,
                fixed: false,
                cost: 0.0,
            });
        }
        k += 1;
    }
    nodes.push(Node { point: ctx.line_end(cp.tail_height), role: Role::End, fixed: false, cost: 0.0 });
    nodes
}

/// What one tail found: a verified line, or the farthest candidate reached and the arcs used.
enum TailOutcome {
    Line { tension: f64, points: Vec<Point>, verifications: usize },
    Short { farthest: f64, reason: Reason, reason_at: f64, verifications: usize },
}

/// Searches one tail station. `arcs` counts spans evaluated; stops at `budget`.
fn search_tail(
    cp: &CoverParams,
    prof: &Profile,
    tail: f64,
    ts: &[f64],
    arcs: &mut usize,
    budget: usize,
) -> TailOutcome {
    let mut p = cp.base.clone();
    p.line_end = tail;
    let ctx = Ctx::new(&p, prof);
    let nodes = nodes_for(cp, &ctx, prof, tail);
    let end = nodes.len() - 1;
    let min_gap = p.min_support_spacing;
    let mut t = Tail { ctx, nodes, memo: HashMap::new(), tensions: ts };
    let all: u64 = if ts.len() >= 64 { u64::MAX } else { (1u64 << ts.len()) - 1 };
    // levels[k]: the kept candidates with k supports up to and including them (the yarder alone
    // at level 0), each with its pre-tension mask and the predecessors that contribute to it.
    let mut levels: Vec<HashMap<usize, (u64, Vec<(usize, u64)>)>> = Vec::new();
    let mut zero = HashMap::new();
    zero.insert(0usize, (all, Vec::new()));
    levels.push(zero);
    let mut farthest = 0.0f64;
    let mut verifications = 0usize;
    let mut first_reason: Option<(Reason, f64)> = None;
    for level in 0..=cp.max_supports {
        let mut frontier: Vec<(usize, u64)> = levels[level].iter().map(|(&j, (m, _))| (j, *m)).collect();
        frontier.sort_by(|a, b| b.0.cmp(&a.0));
        // Does a kept candidate reach the tail?
        let mut done: Vec<(usize, u64)> = Vec::new();
        for &(i, m) in &frontier {
            if *arcs >= budget {
                break;
            }
            let w = t.mask(i, end, arcs) & m;
            if w != 0 {
                done.push((i, w));
            } else if first_reason.is_none() {
                first_reason = t.reason(i, end).filter(|r| r.0 != Reason::None);
            }
        }
        for (i, w) in done {
            // The lowest pre-tension first, as the support search prefers it; then the highest, which
            // straightens the rope over the supports (smaller loaded break angles); then the middle.
            let bits: Vec<usize> = (0..ts.len()).filter(|k| w & (1u64 << k) != 0).collect();
            let mut order: Vec<usize> = Vec::with_capacity(VERIFY_TENSIONS);
            for k in [bits[0], bits[bits.len() - 1], bits[bits.len() / 2]] {
                if !order.contains(&k) {
                    order.push(k);
                }
            }
            for k in order.into_iter().take(VERIFY_TENSIONS) {
                let bit = 1u64 << k;
                let mut chain = vec![end, i];
                let mut node = i;
                for back in (1..=level).rev() {
                    let Some(&(pred, _)) = levels[back][&node].1.iter().find(|(_, c)| c & bit != 0) else {
                        break;
                    };
                    chain.push(pred);
                    node = pred;
                }
                if node != 0 {
                    continue;
                }
                chain.reverse();
                let points: Vec<Point> = chain.iter().map(|&n| t.nodes[n].point).collect();
                let fixed = vec![false; points.len()];
                verifications += 1;
                let a = analysis::analyze(&t.ctx, &Layout { points: &points, fixed: &fixed, complete: true }, ts[k]);
                let spans_ok = a.spans.len() + 1 == points.len() && a.spans.iter().all(|s| s.verdict.ok());
                let supports_ok = a.supports.iter().all(|s| analysis::support_failure(s).is_none());
                if spans_ok && supports_ok {
                    return TailOutcome::Line { tension: ts[k], points, verifications };
                }
            }
        }
        if level == cp.max_supports || *arcs >= budget {
            break;
        }
        // Grow: from each kept candidate, its farthest working targets.
        let mut next: HashMap<usize, (u64, Vec<(usize, u64)>)> = HashMap::new();
        for &(i, m) in &frontier {
            let from = t.nodes[i].point.station;
            let mut found = 0;
            for j in (i + 1..end).rev() {
                if found >= COVER_TARGETS || *arcs >= budget {
                    break;
                }
                if i != 0 && t.nodes[j].point.station - from < min_gap - 1e-6 {
                    break;
                }
                let c = t.mask(i, j, arcs) & m;
                if c == 0 {
                    continue;
                }
                found += 1;
                let entry = next.entry(j).or_insert((0, Vec::new()));
                entry.0 |= c;
                entry.1.push((i, c));
            }
        }
        if next.is_empty() {
            break;
        }
        let mut kept: Vec<usize> = next.keys().copied().collect();
        kept.sort_by(|a, b| b.cmp(a));
        kept.truncate(COVER_BEAM);
        farthest = farthest.max(t.nodes[kept[0]].point.station);
        let stored: HashMap<usize, (u64, Vec<(usize, u64)>)> =
            kept.iter().map(|j| (*j, next.remove(j).unwrap())).collect();
        levels.push(stored);
    }
    let (reason, reason_at) = first_reason.unwrap_or((Reason::NoCandidates, f64::NAN));
    TailOutcome::Short { farthest, reason, reason_at, verifications }
}

/// The longest line from the profile's start along it, out to `t_max`.
pub fn screen_line(cp: &CoverParams, prof: &Profile, t_max: f64) -> CoverLine {
    let ts = tensions(&cp.base);
    let mut out = CoverLine {
        status: CoverStatus::None,
        length: 0.0,
        tension: f64::NAN,
        points: Vec::new(),
        reason: Reason::None,
        reason_at: f64::NAN,
        arcs: 0,
        verifications: 0,
    };
    let mut tail = t_max.min(prof.last_station());
    let mut first = true;
    while tail >= cp.min_length - 1e-6 && tail > 0.0 {
        let mut p = cp.base.clone();
        p.line_end = tail;
        let refused = params::validate(&p, prof, &[], &[]).err();
        let outcome = if let Some(e) = refused {
            let reason = if e == InputError::EndGroundUnknown { Reason::UnknownGround } else { Reason::Unsolvable };
            TailOutcome::Short { farthest: 0.0, reason, reason_at: tail, verifications: 0 }
        } else {
            search_tail(cp, prof, tail, &ts, &mut out.arcs, cp.max_arcs)
        };
        match outcome {
            TailOutcome::Line { tension, points, verifications } => {
                out.verifications += verifications;
                out.status = CoverStatus::Feasible;
                out.length = tail;
                out.tension = tension;
                out.points = points;
                return out;
            }
            TailOutcome::Short { farthest, reason, reason_at, verifications } => {
                out.verifications += verifications;
                if first {
                    out.reason = reason;
                    out.reason_at = reason_at;
                    first = false;
                }
                if out.arcs >= cp.max_arcs {
                    out.status = CoverStatus::Budget;
                    return out;
                }
                let step_in = tail - cp.tail_step;
                tail = if farthest > 0.0 && farthest < step_in { farthest } else { step_in };
            }
        }
    }
    out
}
