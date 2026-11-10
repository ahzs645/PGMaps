//! SEILAPLAN parity: the reference vectors A–G (reference run of SEILAPLAN 3.8.2, 10 November
//! 2026). Supports, heights, objective, peaks and the number of spans checked are exact; the
//! chosen pre-tension is within 2 kN (see `docs/forestry-road-design/cable-supports.md`).
mod common;

use cable_layout::analysis::{analyze, Layout, SupportKind};
use cable_layout::context::{Ctx, Point};
use cable_layout::params::*;
use cable_layout::search::Status;
use common::*;

struct Expect {
    supports: &'static [(f64, f64)],
    tension: f64,
    objective: f64,
    arcs: usize,
    peaks: &'static [f64],
}

fn check(name: &str, p: Params, prof: Profile, fixed: Vec<FixedSupport>, sectors: Vec<Sector>, want: Expect) {
    let (job, o) = run(p, prof, fixed, sectors);
    assert_eq!(job.arcs.len(), want.arcs, "{name}: spans checked");
    assert_eq!(job.peaks, want.peaks, "{name}: convexity peaks");
    assert_eq!(layout(&job, &o), want.supports, "{name}: supports");
    assert_eq!(o.objective, want.objective, "{name}: objective");
    assert!((o.tension - want.tension).abs() <= 2.0, "{name}: tension {} vs {}", o.tension, want.tension);
}

#[test]
fn vector_a_straight_slope() {
    check(
        "A",
        standard(Model::Parity, 250.0),
        profile(slope, 250.0),
        vec![],
        vec![],
        Expect {
            supports: &[(0.0, 12.0), (210.0, 22.0), (250.0, 0.0)],
            tension: 83.0,
            objective: 27_430.0,
            arcs: 2252,
            peaks: &[],
        },
    );
}

#[test]
fn vector_b_concave_valley() {
    check(
        "B",
        standard(Model::Parity, 400.0),
        profile(valley, 400.0),
        vec![],
        vec![],
        Expect { supports: &[(0.0, 12.0), (400.0, 6.0)], tension: 66.0, objective: 23_781.0, arcs: 2252, peaks: &[] },
    );
}

#[test]
fn vector_c_convex_ridge() {
    let (job, o) = run(standard(Model::Parity, 400.0), profile(ridge, 400.0), vec![], vec![]);
    assert_eq!(layout(&job, &o), [(0.0, 12.0), (200.0, 10.0), (400.0, 10.0)]);
    assert_eq!(o.objective, 36_745.0);
    assert_eq!(job.arcs.len(), 7524);
    assert_eq!(job.peaks, [200.0]);
    assert!((o.tension - 83.0).abs() <= 2.0 && o.tie_high == 105.0);
    // Per-span windows: the reference's (lo, hi) to its bisection resolution, 81/128 kN.
    let window = |f: f64, t: f64, hf: f64, ht: f64| {
        let a = job.arcs.iter().find(|a| {
            let (x, y) = (job.nodes[a.from as usize].point, job.nodes[a.to as usize].point);
            x.station == f && y.station == t && x.height == hf && y.height == ht
        });
        a.map(|a| (a.feasible, a.lo, a.hi)).unwrap()
    };
    let close = |a: f64, b: f64| (a - b).abs() <= 81.0 / 64.0 + 1e-9;
    let w = window(0.0, 30.0, 12.0, 8.0);
    assert!(w.0 && close(w.1, 60.0) && close(w.2, 135.9375), "{w:?}");
    assert!(!window(0.0, 200.0, 12.0, 8.0).0);
    let w = window(0.0, 200.0, 12.0, 10.0);
    assert!(w.0 && w.1 == 60.0 && w.2 == 105.5625, "{w:?}");
    let w = window(200.0, 400.0, 10.0, 10.0);
    assert!(w.0 && close(w.1, 82.7812) && w.2 == 105.5625, "{w:?}");
    assert!(!window(200.0, 400.0, 10.0, 0.0).0);
    assert!(!window(0.0, 400.0, 12.0, 22.0).0);
    assert!(!window(190.0, 230.0, 10.0, 8.0).0);
}

#[test]
fn vector_d_fixed_support_drops_the_farthest_node() {
    let fixed = vec![FixedSupport { station: 150.0, height: Some(14.0) }];
    let (job, o) = run(standard(Model::Parity, 400.0), profile(ridge, 400.0), fixed, vec![]);
    assert_eq!(o.status, Status::Incomplete);
    assert_eq!(layout(&job, &o), [(0.0, 12.0), (150.0, 14.0)]);
    // The objective still counts the hidden 8 m support beyond 150 m.
    assert_eq!(o.objective, 37_204.0);
    assert_eq!(job.arcs.len(), 4357);
    assert!((o.tension - 106.0).abs() <= 2.0 && o.tie_high == 115.0);
}

#[test]
fn vector_e_sector_peak_and_ground_anchor_end() {
    let p = Params { end_kind: EndKind::Anchor, ..standard(Model::Parity, 400.0) };
    let (job, o) = run(p, profile(ridge, 400.0), vec![], vec![Sector { from: 170.0, to: 230.0 }]);
    // SEILAPLAN re-adds the 200 m peak inside the excluded sector and places a support there.
    assert_eq!(layout(&job, &o), [(0.0, 12.0), (200.0, 10.0), (380.0, 10.0), (400.0, 0.0)]);
    assert_eq!(o.objective, 36_746.0);
    assert_eq!(job.arcs.len(), 3313);
    assert!((o.tension - 66.0).abs() <= 2.0);
}

#[test]
fn vector_f_free_start_height_is_not_charged() {
    let p = Params { start_kind: StartKind::Support, ..standard(Model::Parity, 400.0) };
    let (job, o) = run(p, profile(valley, 400.0), vec![], vec![]);
    assert_eq!(layout(&job, &o), [(0.0, 22.0), (400.0, 6.0)]);
    assert_eq!(o.objective, 11_237.0);
    assert_eq!(job.arcs.len(), 3088);
    assert_eq!((o.tension, o.tie_low, o.tie_high), (61.0, 61.0, 72.0));
}

#[test]
fn vector_g_full_load_has_no_layout() {
    let p = Params { load: 35.0, ..standard(Model::Parity, 400.0) };
    let (job, o) = run(p, profile(ridge, 400.0), vec![], vec![]);
    assert_eq!(o.status, Status::NoLayout);
    assert_eq!(job.peaks, [200.0]);
}

fn final_analysis(
    p: Params,
    prof: Profile,
    pts: &[(f64, f64)],
    complete: bool,
    t0: f64,
) -> cable_layout::analysis::Analysis {
    let ctx = Ctx::new(&p, &prof);
    let points: Vec<Point> =
        pts.iter().map(|&(s, h)| Point { station: s, ground: prof.ground(s), height: h }).collect();
    let fixed = vec![false; points.len()];
    analyze(&ctx, &Layout { points: &points, fixed: &fixed, complete }, t0)
}

fn near(a: f64, b: f64, rel: f64) -> bool {
    (a - b).abs() <= rel * b.abs().max(1.0)
}

#[test]
fn final_analysis_matches_the_reference_at_its_tension() {
    // Vector A at 83 kN.
    let a = final_analysis(
        standard(Model::Parity, 250.0),
        profile(slope, 250.0),
        &[(0.0, 12.0), (210.0, 22.0), (250.0, 0.0)],
        true,
        83.0,
    );
    let loaded: Vec<f64> = a.spans.iter().map(|s| s.loaded_tension).collect();
    assert!(near(loaded[0], 140.14, 0.005) && near(loaded[1], 96.84, 0.005), "{loaded:?}");
    assert!(near(a.spans[0].loaded_sag, 9.131, 0.005) && near(a.spans[1].empty_sag, 0.109, 0.01));
    assert!((a.spans[0].verdict.min_clear - 6.89).abs() < 0.02 && (a.spans[1].verdict.min_clear - 8.05).abs() < 0.02);
    let s = &a.supports[1];
    assert!((s.empty_break - 26.16).abs() < 0.02 && (s.loaded_break - 33.74).abs() < 0.02);
    assert!(near(s.saddle_on, 58.75, 0.005) && near(s.saddle_rope, 36.8, 0.005));
    assert!(near(a.line.max_tension, 141.0, 0.005));
    assert!(near(a.line.rope_length, 277.86, 0.001) && near(a.line.unstrained_length, 278.73, 0.001));
    let anchor = a.supports.last().unwrap();
    assert_eq!(anchor.kind, SupportKind::GroundAnchor);
    assert!(near(anchor.max_force, 138.4, 0.005) && (anchor.pull_angle - 21.4).abs() < 0.2);

    // Vector B at 66 kN: Zweifel's load path clears by 4.55 m where the parabola met 7 m.
    let b = final_analysis(
        standard(Model::Parity, 400.0),
        profile(valley, 400.0),
        &[(0.0, 12.0), (400.0, 6.0)],
        true,
        66.0,
    );
    assert!(near(b.spans[0].loaded_tension, 136.26, 0.005) && near(b.spans[0].loaded_sag, 20.171, 0.005));
    assert!((b.spans[0].verdict.min_clear - 4.55).abs() < 0.02);
    assert!((b.supports[1].empty_break - 5.88).abs() < 0.02 && (b.supports[1].loaded_break - 12.36).abs() < 0.02);

    // Vector C at 83 kN.
    let c = final_analysis(
        standard(Model::Parity, 400.0),
        profile(ridge, 400.0),
        &[(0.0, 12.0), (200.0, 10.0), (400.0, 10.0)],
        true,
        83.0,
    );
    assert!(near(c.spans[0].loaded_tension, 126.49, 0.005) && near(c.spans[1].loaded_tension, 124.07, 0.005));
    assert!((c.spans[0].verdict.min_clear - 7.34).abs() < 0.02 && (c.spans[1].verdict.min_clear - 6.46).abs() < 0.02);
    assert!((c.supports[1].empty_break - 12.14).abs() < 0.02 && (c.supports[1].loaded_break - 20.87).abs() < 0.02);
    assert!(near(c.supports[1].saddle_on, 42.50, 0.005));

    // Vector D: the truncated line re-analysed as one span with no anchor, at 106 kN — over the
    // allowable, which the reference program never re-checks.
    let d = final_analysis(
        standard(Model::Parity, 400.0),
        profile(ridge, 400.0),
        &[(0.0, 12.0), (150.0, 14.0)],
        false,
        106.0,
    );
    assert!(near(d.spans[0].loaded_tension, 161.56, 0.005));
    assert!(!d.line.tension_ok);

    // Vector E at 66 kN.
    let p = Params { end_kind: EndKind::Anchor, ..standard(Model::Parity, 400.0) };
    let e = final_analysis(
        p,
        profile(ridge, 400.0),
        &[(0.0, 12.0), (200.0, 10.0), (380.0, 10.0), (400.0, 0.0)],
        true,
        66.0,
    );
    let saddles: Vec<f64> = e.supports[1..3].iter().map(|s| s.saddle_on).collect();
    assert!(near(saddles[0], 39.98, 0.005) && near(saddles[1], 43.39, 0.005), "{saddles:?}");
    assert!((e.supports[2].loaded_break - 29.48).abs() < 0.02);

    // Vector F at 61 kN: the start support's angles next to its anchor.
    let p = Params { start_kind: StartKind::Support, ..standard(Model::Parity, 400.0) };
    let f = final_analysis(p, profile(valley, 400.0), &[(0.0, 22.0), (400.0, 6.0)], true, 61.0);
    let start = f.supports.iter().find(|s| s.point.station == 0.0).unwrap();
    assert!((start.empty_break - 52.16).abs() < 0.02 && (start.loaded_break - 57.50).abs() < 0.02);
    assert!(near(f.spans[0].loaded_tension, 130.64, 0.005) && (f.spans[0].verdict.min_clear - 4.59).abs() < 0.02);
}
