//! The default model: the reference program's defects fixed, the search and the final check
//! agreeing, and unknown ground kept unknown.
mod common;

use cable_layout::context::Reason;
use cable_layout::params::*;
use cable_layout::search::Status;
use common::*;

fn assert_layout_passes(o: &cable_layout::search::Outcome) {
    for s in &o.analysis.spans {
        assert!(s.verdict.ok(), "span {}–{} fails its final check: {:?}", s.from, s.to, s.verdict);
    }
    for s in &o.analysis.supports {
        if !s.lift_off_limit.is_nan() {
            assert!(s.empty_break >= s.lift_off_limit - 1e-9, "lift-off at {}", s.point.station);
        }
        if !s.loaded_limit.is_nan() && !s.loaded_break.is_nan() {
            assert!(s.loaded_break <= s.loaded_limit + 1e-9, "loaded angle {} at {}", s.loaded_break, s.point.station);
        }
    }
}

#[test]
fn every_span_and_support_of_the_layout_passes_the_final_check() {
    for (f, len) in [(ridge as fn(f64) -> f64, 400.0), (valley, 400.0), (slope, 250.0)] {
        let (_, o) = run(standard(Model::Catenary, len), profile(f, len), vec![], vec![]);
        assert_eq!(o.status, Status::Complete);
        assert_layout_passes(&o);
        // The concave valley clears by the full 7 m on the catenary's own load path.
        assert!(o.analysis.line.min_clear >= 7.0 - 1e-6, "min clearance {}", o.analysis.line.min_clear);
    }
}

#[test]
fn no_support_lands_in_an_excluded_sector() {
    let p = Params { end_kind: EndKind::Anchor, ..standard(Model::Catenary, 400.0) };
    let (job, o) = run(p, profile(ridge, 400.0), vec![], vec![Sector { from: 170.0, to: 230.0 }]);
    assert_eq!(o.status, Status::Complete);
    assert!(layout(&job, &o).iter().all(|(s, _)| *s <= 170.0 || *s >= 230.0), "{:?}", layout(&job, &o));
    assert!(!job.sites.iter().any(|s| *s > 170.0 && *s < 230.0));
    assert_layout_passes(&o);
}

#[test]
fn every_start_height_is_charged() {
    let p = Params { start_kind: StartKind::Support, ..standard(Model::Catenary, 400.0) };
    let (job, o) = run(p, profile(valley, 400.0), vec![], vec![]);
    let pts = layout(&job, &o);
    let cost: f64 = pts.iter().map(|(_, h)| support_cost(*h, 22.0)).sum();
    assert_eq!(o.objective, cost);
}

#[test]
fn an_incomplete_line_keeps_its_farthest_support_and_says_why() {
    let fixed = vec![FixedSupport { station: 150.0, height: Some(14.0) }];
    let (job, o) = run(standard(Model::Catenary, 400.0), profile(ridge, 400.0), fixed, vec![]);
    assert_eq!(o.status, Status::Incomplete);
    let pts = layout(&job, &o);
    assert!(pts.len() >= 3 && pts[1] == (150.0, 14.0), "{pts:?}");
    assert_eq!(o.reach, pts.last().unwrap().0);
    // The objective is the cost of the line it reports.
    let cost: f64 = pts.iter().map(|(_, h)| support_cost(*h, 22.0)).sum();
    assert_eq!(o.objective, cost);
    assert_ne!(o.reason, Reason::None);
    assert!(o.reason_at.is_finite());
    // The reported partial line passes its own tension check.
    assert!(o.analysis.line.tension_ok);
}

#[test]
fn unknown_ground_is_never_proven_clear() {
    let mut prof = profile(slope, 250.0);
    for i in 140..160 {
        prof.z[i] = f64::NAN; // stations 120–139 m
    }
    let (job, o) = run(standard(Model::Catenary, 250.0), prof, vec![], vec![]);
    assert_ne!(o.status, Status::Complete);
    // No span over the gap is feasible, and the gap is the reason given.
    for a in &job.arcs {
        let (x, y) = (job.nodes[a.from as usize].point.station, job.nodes[a.to as usize].point.station);
        if x < 120.0 && y > 139.0 {
            assert!(!a.feasible);
        }
    }
    assert_eq!(o.reason, Reason::UnknownGround);
}

#[test]
fn full_load_on_the_standard_rope_is_refused_with_a_reason() {
    let p = Params { load: 35.0, ..standard(Model::Catenary, 400.0) };
    let (_, o) = run(p, profile(ridge, 400.0), vec![], vec![]);
    assert_ne!(o.status, Status::Complete);
    assert_ne!(o.reason, Reason::None);
}

#[test]
fn invalid_inputs_are_refused() {
    let base = || standard(Model::Catenary, 400.0);
    let prof = || profile(ridge, 400.0);
    let refuse = |p: Params, fixed: Vec<FixedSupport>, sectors: Vec<Sector>| {
        cable_layout::search::Job::new(p, prof(), fixed, sectors).err()
    };
    assert_eq!(
        refuse(Params { min_clearance: 9.0, ..base() }, vec![], vec![]),
        Some(InputError::ClearanceAboveSupport)
    );
    assert_eq!(
        refuse(base(), vec![FixedSupport { station: 200.0, height: None }], vec![Sector { from: 170.0, to: 230.0 }]),
        Some(InputError::FixedInSector)
    );
    assert_eq!(
        refuse(Params { end_kind: EndKind::Anchor, clearance_end: 0.0, ..base() }, vec![], vec![]),
        Some(InputError::AnchorZoneZero)
    );
    let uphill = Profile { x0: -20.0, dx: 1.0, z: (0..441).map(|i| 900.0 + 0.3 * (i as f64 - 20.0)).collect() };
    assert_eq!(cable_layout::search::Job::new(base(), uphill, vec![], vec![]).err(), Some(InputError::TwoCableUphill));
    assert_eq!(refuse(Params { max_arcs: 100, ..base() }, vec![], vec![]), Some(InputError::TooManySpans));
}

#[test]
fn the_buffer_interface_round_trips() {
    // Encoded input → run → encoded output, as the TypeScript wrapper does it.
    let p = standard(Model::Catenary, 400.0);
    let prof = profile(ridge, 400.0);
    let mut input = vec![0.0; cable_layout::codec::HEADER];
    let h = &mut input;
    h[0] = cable_layout::codec::VERSION;
    let vals = [
        0.0,
        0.0,
        0.0,
        p.tower_height,
        0.0,
        p.traffic_start,
        p.traffic_end,
        p.min_clearance,
        p.clearance_start,
        p.clearance_end,
        p.zone_clearance,
        p.load,
        p.rope_weight,
        p.running_weight,
        p.ea,
        p.allowable,
        p.tension_low,
        p.tension_high,
        p.tension_step,
        p.min_support_spacing,
        p.candidate_spacing,
        p.min_height,
        p.max_height,
        p.height_step,
        p.artificial_height,
        p.lift_off_deg,
        p.hold_down_deg,
        p.max_loaded_deg,
        p.max_loaded_end_deg,
        p.anchor_distance,
        p.anchor_ref_height,
        p.min_gravity_grade,
        p.line_end,
        p.max_arcs as f64,
        p.load_positions as f64,
        prof.x0,
        prof.dx,
        prof.z.len() as f64,
        0.0,
        0.0,
    ];
    h[1..].copy_from_slice(&vals);
    input.extend_from_slice(&prof.z);
    let out = cable_layout::run(&input);
    assert_eq!(out[0], cable_layout::codec::VERSION);
    assert_eq!(out[1], 0.0, "result, not an error");
    assert_eq!(out[2], 0.0, "complete");
}
