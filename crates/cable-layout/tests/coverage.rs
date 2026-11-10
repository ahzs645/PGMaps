//! The coverage screen on the profiles of the `cable_concave` case (reference run of Sylvaccess
//! 3.6, 10 November 2026): a valley floor with a concave slope rising to the north,
//! `z = 500 + 0.0015·(y − 400)²`, and a 5 % rise to the south, from a landing 2.5 m north of the
//! floor. Sylvaccess's trailer preset with a 300 m skyline (276 m usable after the anchor
//! allowance). The reference's numbers are in `docs/forestry-road-design/extraction-reach.md`,
//! Provenance; the side-slope and other cuts before the mechanics are PGMaps' TypeScript side.
use cable_layout::context::Reason;
use cable_layout::coverage::{screen_line, CoverParams, CoverStatus};
use cable_layout::params::*;

const G: f64 = 9.80665;

fn ground(x: f64, y: f64) -> f64 {
    let _ = x;
    if y >= 400.0 {
        500.0 + 0.0015 * (y - 400.0).powi(2)
    } else {
        500.0 + 0.05 * (400.0 - y)
    }
}

/// Sylvaccess 3.6's trailer preset as the dictionary sets it: 18 mm, 1.85 kg/m, 35,000 kgF at a
/// safety factor of 2.5, E = 100 kN/mm² on the full circle, 2,500 kg payload and a 400 kg
/// carriage, 0.5 kg/m mainline and haulback, 3.5 m clearance, 10.5 m tower, 12 m supports and tail,
/// 50 m between supports, at most 3.
fn trailer(max_supports: usize) -> CoverParams {
    let allowable = 35_000.0 * G / 1000.0 / 2.5;
    let base = Params {
        model: Model::Catenary,
        start_kind: StartKind::Yarder,
        end_kind: EndKind::Support,
        tower_height: 10.5,
        system: CableSystem::MultiCable,
        traffic_start: 0.0,
        traffic_end: 0.0,
        min_clearance: 3.5,
        clearance_start: 10.0,
        clearance_end: 10.0,
        zone_clearance: 0.0,
        load: 2_900.0 * G / 1000.0,
        rope_weight: 1.85 * G / 1000.0,
        running_weight: 1.0 * G / 1000.0,
        ea: 100.0 * std::f64::consts::PI * 81.0,
        allowable,
        tension_low: allowable / 32.0,
        tension_high: allowable,
        tension_step: allowable / 32.0,
        min_support_spacing: 50.0,
        candidate_spacing: 5.0,
        min_height: 12.0,
        max_height: 12.0,
        height_step: 1.0,
        artificial_height: 100.0,
        lift_off_deg: 0.0,
        hold_down_deg: 0.0,
        max_loaded_deg: 30.0,
        max_loaded_end_deg: 90.0,
        anchor_distance: 17.0,
        anchor_ref_height: 12.0,
        min_gravity_grade: 0.0,
        line_end: 0.0,
        max_arcs: 1_000_000,
        load_positions: 32,
    };
    CoverParams { base, tail_height: 12.0, max_supports, tail_step: 5.0, min_length: 100.0, max_arcs: 20_000 }
}

/// Ground along a bearing from the landing at (497.5, 402.5), every `dx` m out to `len`.
fn profile(bearing_deg: f64, len: f64, dx: f64) -> Profile {
    let (s, c) = bearing_deg.to_radians().sin_cos();
    let n = (len / dx).floor() as usize + 1;
    Profile { x0: 0.0, dx, z: (0..n).map(|i| ground(497.5 + s * i as f64 * dx, 402.5 + c * i as f64 * dx)).collect() }
}

/// The horizontal distance at which the 3D chord from the landing reaches `usable` m.
fn usable_tail(prof: &Profile, usable: f64) -> f64 {
    let z0 = prof.z[0];
    let mut last = 0.0;
    for (i, z) in prof.z.iter().enumerate() {
        let x = prof.station(i);
        if (x * x + (z - z0) * (z - z0)).sqrt() > usable {
            break;
        }
        last = x;
    }
    last
}

fn chord_length(points: &[cable_layout::context::Point]) -> f64 {
    points.windows(2).map(|w| (w[1].station - w[0].station).hypot(w[1].top() - w[0].top())).sum()
}

fn run(bearing: f64, max_supports: usize) -> (cable_layout::coverage::CoverLine, f64) {
    let cp = trailer(max_supports);
    let prof = profile(bearing, 320.0, 2.5);
    let tail = usable_tail(&prof, 300.0 - 2f64.sqrt() * 17.0);
    let t = std::time::Instant::now();
    let line = screen_line(&cp, &prof, tail);
    let ms = t.elapsed().as_secs_f64() * 1000.0;
    eprintln!(
        "bearing {bearing}: {:?} {:.0} m horizontal, {:.0} m chord, {} supports, {} arcs, {} checks, {:.1} ms, reason {:?} at {:.0}",
        line.status,
        line.length,
        chord_length(&line.points),
        line.points.len().saturating_sub(2),
        line.arcs,
        line.verifications,
        ms,
        line.reason,
        line.reason_at
    );
    (line, ms)
}

#[test]
fn concave_slope_one_span() {
    // Reference: 274 m of skyline, no support, ending at 599 m.
    let (line, _) = run(0.0, 3);
    assert_eq!(line.status, CoverStatus::Feasible);
    assert_eq!(line.points.len(), 2);
}

#[test]
fn valley_floor_needs_a_support() {
    // Reference: 275 m along the flat floor with one support.
    let (line, _) = run(90.0, 3);
    assert_eq!(line.status, CoverStatus::Feasible);
    assert!(line.points.len() >= 3, "{:?}", line.points);
    let (none, _) = run(90.0, 0);
    assert!(none.length < line.length, "without supports the floor line is shorter");
}

#[test]
fn south_rise_one_support() {
    // Reference: 275 m up the 5 % side, one support at 125 m.
    let (line, _) = run(180.0, 3);
    assert_eq!(line.status, CoverStatus::Feasible);
    assert!(line.points.len() >= 3);
}

#[test]
fn unknown_ground_is_never_crossed() {
    let cp = trailer(3);
    let mut prof = profile(90.0, 320.0, 2.5);
    for z in &mut prof.z[60..64] {
        *z = f64::NAN;
    }
    let line = screen_line(&cp, &prof, 250.0);
    assert!(line.length < 150.0, "{}", line.length);
    if line.status == CoverStatus::None {
        assert_ne!(line.reason, Reason::None);
    }
}

#[test]
fn every_bearing_settles_within_a_small_span_budget() {
    let mut arcs = 0;
    for b in (0..360).step_by(2) {
        let cp = trailer(3);
        let prof = profile(b as f64, 320.0, 2.5);
        let tail = usable_tail(&prof, 300.0 - 2f64.sqrt() * 17.0);
        let line = screen_line(&cp, &prof, tail);
        assert_eq!(line.status, CoverStatus::Feasible, "bearing {b}");
        assert!(line.points.len() <= 3, "bearing {b}: at most one support on this ground");
        arcs += line.arcs;
    }
    // About 40 spans a line on this ground (0.5 s for all 180 natively).
    assert!(arcs < 180 * 100, "{arcs} spans");
}
