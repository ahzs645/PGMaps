//! The f64 buffer format shared with `cableLayout.ts`. Change both together and bump `VERSION`.
//!
//! Input: `HEADER` values (see `decode`), then the profile heights, fixed supports as (station,
//! height or NaN) pairs and sectors as (from, to) pairs. `cl_analyze` appends the layout:
//! pre-tension, a complete flag, the number of supports and (station, height) pairs.
//!
//! Output: `OUT_HEADER` values, then supports, spans, profile samples, peaks, candidate sites and
//! the span table, each a fixed number of values per row.

use crate::analysis::{self, Analysis, Layout};
use crate::context::{Ctx, Point, Reason};
use crate::params::{CableSystem, EndKind, FixedSupport, InputError, Model, Params, Profile, Sector, StartKind};
use crate::search::{Job, Outcome, Status};

pub const VERSION: f64 = 1.0;
pub const HEADER: usize = 41;
pub const OUT_HEADER: usize = 34;
pub const SUPPORT_FIELDS: usize = 18;
pub const SPAN_FIELDS: usize = 17;
pub const SAMPLE_FIELDS: usize = 4;
pub const ARC_FIELDS: usize = 11;
/// Spans listed in the result's span table at most (the rest are counted only).
pub const MAX_REPORTED_ARCS: usize = 40_000;

pub struct Decoded {
    pub params: Params,
    pub profile: Profile,
    pub fixed: Vec<FixedSupport>,
    pub sectors: Vec<Sector>,
    pub rest: usize,
}

fn count(v: f64, max: usize) -> Result<usize, InputError> {
    if !v.is_finite() || v < 0.0 || v.fract() != 0.0 || v > max as f64 {
        return Err(InputError::Format);
    }
    Ok(v as usize)
}

pub fn decode(b: &[f64]) -> Result<Decoded, InputError> {
    if b.len() < HEADER || b[0] != VERSION {
        return Err(InputError::Format);
    }
    let model = match b[1] as i64 {
        0 => Model::Catenary,
        1 => Model::Parity,
        _ => return Err(InputError::Format),
    };
    let start_kind = match b[2] as i64 {
        0 => StartKind::Yarder,
        1 => StartKind::Support,
        2 => StartKind::Anchor,
        _ => return Err(InputError::Format),
    };
    let end_kind = match b[3] as i64 {
        0 => EndKind::Support,
        1 => EndKind::Anchor,
        _ => return Err(InputError::Format),
    };
    let system = match b[5] as i64 {
        0 => CableSystem::TwoCable,
        1 => CableSystem::MultiCable,
        _ => return Err(InputError::Format),
    };
    let params = Params {
        model,
        start_kind,
        end_kind,
        tower_height: b[4],
        system,
        traffic_start: b[6],
        traffic_end: b[7],
        min_clearance: b[8],
        clearance_start: b[9],
        clearance_end: b[10],
        zone_clearance: b[11],
        load: b[12],
        rope_weight: b[13],
        running_weight: b[14],
        ea: b[15],
        allowable: b[16],
        tension_low: b[17],
        tension_high: b[18],
        tension_step: b[19],
        min_support_spacing: b[20],
        candidate_spacing: b[21],
        min_height: b[22],
        max_height: b[23],
        height_step: b[24],
        artificial_height: b[25],
        lift_off_deg: b[26],
        hold_down_deg: b[27],
        max_loaded_deg: b[28],
        max_loaded_end_deg: b[29],
        anchor_distance: b[30],
        anchor_ref_height: b[31],
        min_gravity_grade: b[32],
        line_end: b[33],
        max_arcs: count(b[34], 10_000_000)?,
        load_positions: count(b[35], 400)?.max(4),
    };
    let n = count(b[38], 200_000)?;
    let nf = count(b[39], 200)?;
    let ns = count(b[40], 200)?;
    let need = HEADER + n + 2 * nf + 2 * ns;
    if b.len() < need {
        return Err(InputError::Format);
    }
    let profile = Profile { x0: b[36], dx: b[37], z: b[HEADER..HEADER + n].to_vec() };
    let mut at = HEADER + n;
    let mut fixed = Vec::with_capacity(nf);
    for _ in 0..nf {
        let h = b[at + 1];
        fixed.push(FixedSupport { station: b[at], height: if h.is_nan() { None } else { Some(h) } });
        at += 2;
    }
    let mut sectors = Vec::with_capacity(ns);
    for _ in 0..ns {
        sectors.push(Sector { from: b[at], to: b[at + 1] });
        at += 2;
    }
    Ok(Decoded { params, profile, fixed, sectors, rest: at })
}

pub fn encode_error(e: InputError) -> Vec<f64> {
    vec![VERSION, 1.0, e as i32 as f64]
}

fn flag(b: bool) -> f64 {
    if b {
        1.0
    } else {
        0.0
    }
}

struct Head {
    status: Status,
    reason: Reason,
    reason_at: f64,
    reason_value: f64,
    reason_value2: f64,
    tension: f64,
    tie_low: f64,
    tie_high: f64,
    tie_count: usize,
    objective: f64,
    reach: f64,
    arcs_total: usize,
    arcs_evaluated: usize,
    verifications: usize,
}

fn encode(
    h: &Head,
    a: &Analysis,
    allowable: f64,
    peaks: &[f64],
    sites: &[f64],
    arcs: &[[f64; ARC_FIELDS]],
) -> Vec<f64> {
    let mut out = vec![
        VERSION,
        0.0,
        h.status as u8 as f64,
        h.reason as u8 as f64,
        h.reason_at,
        h.reason_value,
        h.reason_value2,
        h.tension,
        h.tie_low,
        h.tie_high,
        h.tie_count as f64,
        h.objective,
        h.reach,
        h.arcs_total as f64,
        h.arcs_evaluated as f64,
        h.verifications as f64,
        a.supports.len() as f64,
        a.spans.len() as f64,
        a.samples.len() as f64,
        peaks.len() as f64,
        sites.len() as f64,
        arcs.len() as f64,
        a.line.rope_length,
        a.line.unstrained_length,
        a.line.max_tension,
        a.line.max_tension_span,
        flag(a.line.tension_ok),
        a.line.min_clear,
        a.line.min_clear_at,
        flag(a.line.clear_known),
        flag(a.line.lift_off),
        a.line.max_empty_height,
        allowable,
        0.0,
    ];
    debug_assert_eq!(out.len(), OUT_HEADER);
    for s in &a.supports {
        out.extend_from_slice(&[
            s.kind as u8 as f64,
            s.point.station,
            s.point.ground,
            s.point.height,
            flag(s.fixed),
            s.empty_tension,
            s.angle_in,
            s.angle_out,
            s.empty_break,
            s.loaded_break,
            s.loaded_limit,
            s.lift_off_limit,
            s.saddle_rope,
            s.saddle_on,
            s.beside_before,
            s.beside_after,
            s.max_force,
            s.pull_angle,
        ]);
    }
    for s in &a.spans {
        let v = &s.verdict;
        out.extend_from_slice(&[
            s.from,
            s.to,
            s.chord,
            s.empty_sag,
            s.loaded_sag,
            s.loaded_tension,
            s.peak,
            flag(v.solved),
            v.unknown_at,
            v.min_clear,
            v.min_clear_at,
            v.worst_short,
            v.worst_at,
            flag(v.clear_ok),
            flag(v.gravity_ok),
            v.gravity_at,
            flag(v.tension_ok),
        ]);
    }
    for s in &a.samples {
        out.extend_from_slice(s);
    }
    out.extend_from_slice(peaks);
    out.extend_from_slice(sites);
    for r in arcs {
        out.extend_from_slice(r);
    }
    out
}

pub fn encode_outcome(job: &Job, o: &Outcome) -> Vec<f64> {
    let head = Head {
        status: o.status,
        reason: o.reason,
        reason_at: o.reason_at,
        reason_value: o.reason_value,
        reason_value2: o.reason_value2,
        tension: o.tension,
        tie_low: o.tie_low,
        tie_high: o.tie_high,
        tie_count: o.tie_count,
        objective: o.objective,
        reach: o.reach,
        arcs_total: job.arcs.len(),
        arcs_evaluated: job.evaluated,
        verifications: o.verifications,
    };
    let arcs: Vec<[f64; ARC_FIELDS]> = job
        .arcs
        .iter()
        .take(MAX_REPORTED_ARCS)
        .map(|a| {
            let (f, t) = (job.nodes[a.from as usize].point, job.nodes[a.to as usize].point);
            [
                f.station,
                f.height,
                t.station,
                t.height,
                flag(a.feasible),
                a.lo,
                a.hi,
                a.reason as u8 as f64,
                a.at,
                a.value,
                a.value2,
            ]
        })
        .collect();
    encode(&head, &o.analysis, job.params.allowable, &job.peaks, &job.sites, &arcs)
}

/// Analyses a given layout (manual edit) without searching.
pub fn analyze(b: &[f64]) -> Result<Vec<f64>, InputError> {
    let d = decode(b)?;
    crate::params::validate(&d.params, &d.profile, &d.fixed, &d.sectors)?;
    let at = d.rest;
    if b.len() < at + 3 {
        return Err(InputError::Format);
    }
    let t0 = b[at];
    let complete = b[at + 1] != 0.0;
    let n = count(b[at + 2], 200)?;
    if n < 2 || b.len() < at + 3 + 2 * n || !(t0 > 0.0) {
        return Err(InputError::Format);
    }
    let mut points = Vec::with_capacity(n);
    for i in 0..n {
        let (station, height) = (b[at + 3 + 2 * i], b[at + 4 + 2 * i]);
        let ground = d.profile.ground(station);
        if !station.is_finite() || !height.is_finite() || ground.is_nan() || height < 0.0 {
            return Err(InputError::FixedSupport);
        }
        if let Some(prev) = points.last() {
            let prev: &Point = prev;
            if station <= prev.station + 1e-6 {
                return Err(InputError::FixedSupport);
            }
        }
        points.push(Point { station, ground, height });
    }
    let ctx = Ctx::new(&d.params, &d.profile);
    let fixed: Vec<bool> =
        points.iter().map(|p| d.fixed.iter().any(|f| (f.station - p.station).abs() < 1e-6)).collect();
    let a = analysis::analyze(&ctx, &Layout { points: &points, fixed: &fixed, complete }, t0);
    let head = Head {
        status: if complete { Status::Complete } else { Status::Incomplete },
        reason: Reason::None,
        reason_at: f64::NAN,
        reason_value: f64::NAN,
        reason_value2: f64::NAN,
        tension: t0,
        tie_low: f64::NAN,
        tie_high: f64::NAN,
        tie_count: 0,
        objective: f64::NAN,
        reach: points.last().unwrap().station,
        arcs_total: 0,
        arcs_evaluated: 0,
        verifications: 0,
    };
    Ok(encode(&head, &a, d.params.allowable, &[], &[], &[]))
}
