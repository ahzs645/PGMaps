//! Shared fixtures: the reference-run profiles and SEILAPLAN's Standard parameter set with a
//! 20 kN load (reference run of SEILAPLAN 3.8.2, 10 November 2026).
#![allow(dead_code)]

use cable_layout::params::*;
use cable_layout::search::{Job, Outcome};

pub fn standard(model: Model, line_end: f64) -> Params {
    Params {
        model,
        start_kind: StartKind::Yarder,
        end_kind: EndKind::Support,
        tower_height: 12.0,
        system: CableSystem::TwoCable,
        traffic_start: 0.0,
        traffic_end: 0.0,
        min_clearance: 7.0,
        clearance_start: 20.0,
        clearance_end: 20.0,
        zone_clearance: if model == Model::Parity { -1.0 } else { 0.0 },
        load: 20.0,
        rope_weight: 0.0232,
        running_weight: 0.0073,
        ea: 100.0 * 266.093,
        allowable: 141.0,
        tension_low: 60.0,
        tension_high: 141.0,
        tension_step: 1.0,
        min_support_spacing: 10.0,
        candidate_spacing: 10.0,
        min_height: 8.0,
        max_height: 22.0,
        height_step: 2.0,
        artificial_height: 22.0,
        lift_off_deg: 1.0,
        hold_down_deg: 3.0,
        max_loaded_deg: 30.0,
        max_loaded_end_deg: 60.0,
        anchor_distance: 20.0,
        anchor_ref_height: 12.0,
        min_gravity_grade: 0.0,
        line_end,
        max_arcs: 5_000_000,
        load_positions: 32,
    }
}

pub fn profile(f: impl Fn(f64) -> f64, line_end: f64) -> Profile {
    let x0 = -20.0;
    let n = (line_end + 20.0 - x0) as usize + 1;
    Profile { x0, dx: 1.0, z: (0..n).map(|i| f(x0 + i as f64)).collect() }
}

pub fn slope(x: f64) -> f64 {
    1000.0 - 0.40 * x
}
pub fn valley(x: f64) -> f64 {
    1000.0 - 0.6 * x + 0.0006 * x * x
}
pub fn ridge(x: f64) -> f64 {
    1000.0 - 0.30 * x + 18.0 * (-((x - 200.0) / 45.0).powi(2)).exp()
}

pub fn run(p: Params, prof: Profile, fixed: Vec<FixedSupport>, sectors: Vec<Sector>) -> (Job, Outcome) {
    let mut job = Job::new(p, prof, fixed, sectors).expect("valid input");
    while !job.step(1000) {}
    let o = job.finish();
    (job, o)
}

/// (station, height) of every support of the reported line, anchors left out.
pub fn layout(job: &Job, o: &Outcome) -> Vec<(f64, f64)> {
    o.path.iter().map(|&i| (job.nodes[i].point.station, job.nodes[i].point.height)).collect()
}
