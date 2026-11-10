//! The final analysis of a chosen layout at one pre-tension: per span the loaded path, clearance
//! and tension; per support the empty and loaded break angles and saddle forces (Pestal 1961);
//! anchor forces and pull angles; rope lengths.
//!
//! The catenary analysis checks each span with exactly the function the search used, with the
//! real neighbouring spans in place of the search's stand-in chords. The parity analysis follows
//! SEILAPLAN's description: Zweifel's multi-field rope with the load in each field in turn and
//! Zweifel's load-path interpolation.
//!
//! Written from a functional specification of SEILAPLAN 3.8.2, Zweifel (1960) and Pestal (1961);
//! no code from SEILAPLAN (GPL-2.0-or-later) was used.

use crate::catenary::{self, RopeCase};
use crate::context::{Ctx, Point, Verdict};
use crate::params::{EndKind, Model, StartKind};
use crate::span::{self, Field, ZweifelInput};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum SupportKind {
    Yarder = 0,
    Support = 1,
    /// A ground anchor the carriage travels to (an end of height 0).
    GroundAnchor = 2,
    /// The anchor behind a support end; not travelled.
    Anchor = 3,
}

#[derive(Clone, Copy, Debug)]
pub struct SupportOut {
    pub kind: SupportKind,
    pub point: Point,
    pub fixed: bool,
    pub empty_tension: f64,
    /// Rope direction arriving and leaving, degrees above horizontal (NaN where there is no rope).
    pub angle_in: f64,
    pub angle_out: f64,
    pub empty_break: f64,
    pub loaded_break: f64,
    /// The loaded break-angle limit that applies here (NaN: none).
    pub loaded_limit: f64,
    /// Lift-off limit that applies here (NaN: none).
    pub lift_off_limit: f64,
    pub saddle_rope: f64,
    pub saddle_on: f64,
    pub beside_before: f64,
    pub beside_after: f64,
    /// Largest saddle force (supports) or rope tension (anchors).
    pub max_force: f64,
    pub pull_angle: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct SpanOut {
    pub from: f64,
    pub to: f64,
    pub chord: f64,
    pub empty_sag: f64,
    pub loaded_sag: f64,
    pub loaded_tension: f64,
    pub peak: f64,
    pub verdict: Verdict,
}

#[derive(Clone, Debug, Default)]
pub struct LineOut {
    pub t0: f64,
    pub rope_length: f64,
    pub unstrained_length: f64,
    pub max_tension: f64,
    pub max_tension_span: f64,
    pub tension_ok: bool,
    pub min_clear: f64,
    pub min_clear_at: f64,
    pub clear_known: bool,
    pub lift_off: bool,
    pub max_empty_height: f64,
}

#[derive(Clone, Debug, Default)]
pub struct Analysis {
    pub supports: Vec<SupportOut>,
    pub spans: Vec<SpanOut>,
    pub line: LineOut,
    /// Per profile sample from station 0 to the end: station, loaded path, empty rope, ground.
    pub samples: Vec<[f64; 4]>,
}

/// A layout to analyse: support points from the start, which of them are user-fixed, and whether
/// it reaches the end (an incomplete line keeps the rest of the rope as one straight stand-in).
pub struct Layout<'a> {
    pub points: &'a [Point],
    pub fixed: &'a [bool],
    pub complete: bool,
}

fn deg(r: f64) -> f64 {
    r.to_degrees()
}

/// Force on a saddle from one tension and the two rope directions (radians): (vertical, horizontal).
fn saddle(t: f64, a_in: f64, a_out: f64) -> (f64, f64) {
    (t * (a_out.sin() - a_in.sin()), t * (a_out.cos() - a_in.cos()))
}

fn terrain_angle(ctx: &Ctx, x: f64, toward_positive: bool) -> f64 {
    let dx = ctx.prof.dx.max(1.0);
    let a = ctx.prof.ground(x - dx);
    let b = ctx.prof.ground(x + dx);
    let slope = if a.is_nan() || b.is_nan() {
        let c = ctx.prof.ground(x);
        let a2 = if a.is_nan() { c } else { a };
        let b2 = if b.is_nan() { c } else { b };
        (b2 - a2) / dx
    } else {
        (b - a) / (2.0 * dx)
    };
    if toward_positive {
        slope.atan()
    } else {
        (-slope).atan()
    }
}

fn kinds(ctx: &Ctx, layout: &Layout) -> Vec<SupportKind> {
    let n = layout.points.len();
    (0..n)
        .map(|i| {
            if i == 0 {
                match ctx.p.start_kind {
                    StartKind::Yarder => SupportKind::Yarder,
                    StartKind::Anchor => SupportKind::GroundAnchor,
                    StartKind::Support => {
                        if layout.points[0].height > 1e-9 {
                            SupportKind::Support
                        } else {
                            SupportKind::GroundAnchor
                        }
                    }
                }
            } else if i == n - 1 && layout.complete {
                match ctx.p.end_kind {
                    EndKind::Anchor => SupportKind::GroundAnchor,
                    EndKind::Support => {
                        if layout.points[i].height > 1e-9 {
                            SupportKind::Support
                        } else {
                            SupportKind::GroundAnchor
                        }
                    }
                }
            } else {
                SupportKind::Support
            }
        })
        .collect()
}

fn blank_support(kind: SupportKind, point: Point, fixed: bool) -> SupportOut {
    SupportOut {
        kind,
        point,
        fixed,
        empty_tension: f64::NAN,
        angle_in: f64::NAN,
        angle_out: f64::NAN,
        empty_break: f64::NAN,
        loaded_break: f64::NAN,
        loaded_limit: f64::NAN,
        lift_off_limit: f64::NAN,
        saddle_rope: f64::NAN,
        saddle_on: f64::NAN,
        beside_before: f64::NAN,
        beside_after: f64::NAN,
        max_force: f64::NAN,
        pull_angle: f64::NAN,
    }
}

/// Line geometry shared by both analyses: the span fields, the anchor fields and the stand-in.
struct Geometry {
    spans: Vec<Field>,
    start_anchor: Option<Field>,
    end_anchor: Option<Field>,
    rest: Option<Field>,
}

fn geometry(ctx: &Ctx, layout: &Layout) -> Geometry {
    let pts = layout.points;
    let spans: Vec<Field> =
        pts.windows(2).map(|w| Field { xa: w[0].station, za: w[0].top(), xb: w[1].station, zb: w[1].top() }).collect();
    let last = *pts.last().unwrap();
    // SEILAPLAN analyses a line that stops short as it stands, with nothing beyond its last
    // support; the catenary model keeps the rest of the rope as one straight stand-in.
    let parity = ctx.p.model == Model::Parity;
    let rest = if !parity && !layout.complete && last.station < ctx.p.line_end - 1e-9 {
        let e = ctx.line_end(ctx.end_low);
        Some(Field { xa: last.station, za: last.top(), xb: e.station, zb: e.top() })
    } else {
        None
    };
    let end_height = if layout.complete { last.height } else { ctx.end_low };
    let (start_anchor, mut end_anchor) = ctx.anchor_fields(pts[0].height, end_height);
    if parity && !layout.complete {
        end_anchor = None;
    }
    Geometry { spans, start_anchor, end_anchor, rest }
}

/// Analyses a layout at pre-tension `t0` with the context's model.
pub fn analyze(ctx: &Ctx, layout: &Layout, t0: f64) -> Analysis {
    if ctx.p.model == Model::Parity {
        return analyze_parity(ctx, layout, t0);
    }
    let pts = layout.points;
    let n = pts.len();
    let kinds = kinds(ctx, layout);
    let g = geometry(ctx, layout);
    let mut fields: Vec<Field> = Vec::new();
    if let Some(f) = g.start_anchor {
        fields.push(f);
    }
    let offset = fields.len();
    fields.extend_from_slice(&g.spans);
    if let Some(f) = g.rest {
        fields.push(f);
    }
    if let Some(f) = g.end_anchor {
        fields.push(f);
    }
    let datum = pts[0].top();
    let w = ctx.rope.w;
    let mut spans = Vec::with_capacity(g.spans.len());
    let mut solved = Vec::with_capacity(g.spans.len());
    let mut empty_lines: Vec<Vec<(f64, f64)>> = Vec::with_capacity(g.spans.len());
    let mut line = LineOut {
        t0,
        tension_ok: true,
        clear_known: true,
        min_clear: f64::NAN,
        min_clear_at: f64::NAN,
        ..Default::default()
    };
    for (k, f) in g.spans.iter().enumerate() {
        let (v, s) = ctx.check_catenary(&fields, offset + k, datum, t0);
        let mut out = SpanOut {
            from: f.xa,
            to: f.xb,
            chord: f.chord(),
            empty_sag: f64::NAN,
            loaded_sag: f64::NAN,
            loaded_tension: f64::NAN,
            peak: v.peak,
            verdict: v,
        };
        if let Some(s) = &s {
            let case = RopeCase { b: f.b(), h: f.h(), l0: s.empty_l0, w, ea: ctx.rope.ea, load: 0.0, at: 0.0 };
            let rope: Vec<(f64, f64)> =
                catenary::rope_line(&case, s.empty_state, 96).into_iter().map(|(x, z)| (f.xa + x, f.za + z)).collect();
            let length: f64 = rope.windows(2).map(|q| (q[1].0 - q[0].0).hypot(q[1].1 - q[0].1)).sum();
            line.rope_length += length;
            line.unstrained_length += s.empty_l0;
            let mid_x = f.xa + f.b() / 2.0;
            out.empty_sag = (f.za + f.h() / 2.0) - interpolate(&rope, mid_x);
            let m = s.points[s.points.len() / 2];
            out.loaded_sag = (f.za + f.h() * (m.x - f.xa) / f.b()) - m.z;
            out.loaded_tension = (m.t_near + m.t_far) / 2.0;
            empty_lines.push(rope);
        } else {
            empty_lines.push(Vec::new());
            line.tension_ok = false;
        }
        if v.solved && !(v.peak <= line.max_tension) {
            line.max_tension = v.peak;
            line.max_tension_span = k as f64;
        }
        if !v.tension_ok {
            line.tension_ok = false;
        }
        if !v.unknown_at.is_nan() || !v.solved {
            line.clear_known = false;
        }
        if !v.min_clear.is_nan() && (line.min_clear.is_nan() || v.min_clear < line.min_clear) {
            line.min_clear = v.min_clear;
            line.min_clear_at = v.min_clear_at;
        }
        spans.push(out);
        solved.push(s);
    }

    // Supports: empty and loaded rope directions on either side.
    let mut supports: Vec<SupportOut> =
        (0..n).map(|i| blank_support(kinds[i], pts[i], layout.fixed.get(i).copied().unwrap_or(false))).collect();
    let anchor_slope = |f: &Field| f.h().atan2(f.b());
    for i in 0..n {
        let before = if i > 0 { solved[i - 1].as_ref() } else { None };
        let after = if i + 1 < n { solved[i].as_ref() } else { None };
        let s = &mut supports[i];
        // Empty directions (radians).
        let empty_in = if i == 0 {
            g.start_anchor.as_ref().map(anchor_slope)
        } else {
            before.map(|b| b.points[0].v_far.atan2(b.points[0].h))
        };
        let empty_out = if i + 1 == n {
            if layout.complete {
                g.end_anchor.as_ref().map(anchor_slope)
            } else {
                None
            }
        } else {
            after.map(|a| a.points[0].v_near.atan2(a.points[0].h))
        };
        let tension = match (before, after) {
            (Some(b), _) => b.empty_far,
            (_, Some(a)) => a.empty_near,
            _ => f64::NAN,
        };
        s.empty_tension = tension;
        s.angle_in = empty_in.map(deg).unwrap_or(f64::NAN);
        s.angle_out = empty_out.map(deg).unwrap_or(f64::NAN);
        if matches!(s.kind, SupportKind::GroundAnchor) {
            continue;
        }
        let (Some(ein), Some(eout)) = (empty_in, empty_out) else {
            continue;
        };
        s.empty_break = deg(ein - eout);
        let mut loaded = f64::NEG_INFINITY;
        let mut beside_before = f64::NAN;
        let mut beside_after = f64::NAN;
        if let Some(b) = before {
            for p in &b.points {
                let a_in = p.v_far.atan2(p.h);
                loaded = loaded.max(deg(a_in - eout));
                let (v, hz) = saddle(p.t_far, a_in, eout);
                beside_before = nan_max(beside_before, v.hypot(hz));
            }
        }
        if let Some(a) = after {
            for p in &a.points {
                let a_out = p.v_near.atan2(p.h);
                loaded = loaded.max(deg(ein - a_out));
                let (v, hz) = saddle(p.t_near, ein, a_out);
                beside_after = nan_max(beside_after, v.hypot(hz));
            }
        }
        s.loaded_break = loaded;
        s.beside_before = beside_before;
        s.beside_after = beside_after;
        let (rv, rh) = saddle(tension, ein, eout);
        s.saddle_rope = rv.hypot(rh);
        let intermediate = before.is_some() && after.is_some();
        if intermediate {
            let lengths = solved[i - 1].as_ref().map(|x| x.empty_l0).unwrap_or(0.0)
                + solved[i].as_ref().map(|x| x.empty_l0).unwrap_or(0.0);
            // Carriage on the saddle: the load, half the skyline of both spans, and half the running
            // lines from the yarder out to here.
            let run: f64 = g.spans[..i].iter().map(|f| f.chord()).sum();
            let added = ctx.p.load + ctx.p.rope_weight * lengths / 2.0 + ctx.p.running_weight * run / 2.0;
            s.saddle_on = (rv - added).hypot(rh);
            s.loaded_limit = ctx.p.max_loaded_deg;
            s.lift_off_limit = ctx.p.lift_off_deg;
            s.max_force = s.saddle_on.max(beside_before.max(beside_after));
        } else {
            s.loaded_limit = ctx.p.max_loaded_end_deg;
            s.max_force = nan_max(beside_before, beside_after);
        }
    }

    // Anchors: the largest tension that reaches them, and the pull angle against the terrain.
    let tension_at = |z: f64, near_side: bool| -> f64 {
        let mut best = f64::NAN;
        for (k, s) in solved.iter().enumerate() {
            let Some(s) = s else { continue };
            let f = g.spans[k];
            for p in &s.points {
                let t = if near_side { p.t_near + w * (z - f.za) } else { p.t_far + w * (z - f.zb) };
                best = nan_max(best, t);
            }
        }
        best
    };
    if supports[0].kind == SupportKind::GroundAnchor {
        let s0 = pts[0];
        supports[0].max_force = tension_at(s0.ground, true);
        if let Some(a) = solved.first().and_then(|s| s.as_ref()) {
            let rope = a.points[0].v_near.atan2(a.points[0].h);
            supports[0].pull_angle = deg((rope - terrain_angle(ctx, s0.station, true)).abs());
        }
    }
    if layout.complete && supports[n - 1].kind == SupportKind::GroundAnchor && n > 1 {
        let e = pts[n - 1];
        supports[n - 1].max_force = tension_at(e.ground, false);
        if let Some(a) = solved.last().and_then(|s| s.as_ref()) {
            let rope = (-a.points[0].v_far).atan2(a.points[0].h);
            supports[n - 1].pull_angle = deg((rope - terrain_angle(ctx, e.station, false)).abs());
        }
    }
    let mut anchors = Vec::new();
    if let Some(f) = g.start_anchor {
        let mut a = blank_support(SupportKind::Anchor, ctx.start_anchor, false);
        a.max_force = tension_at(f.za, true);
        a.pull_angle = deg((f.h().atan2(f.b()) - terrain_angle(ctx, f.xa, true)).abs());
        anchors.push((0usize, a));
    }
    if let Some(f) = g.end_anchor {
        let mut a = blank_support(SupportKind::Anchor, ctx.end_anchor, false);
        a.max_force = tension_at(f.zb, false);
        a.pull_angle = deg(((-f.h()).atan2(f.b()) - terrain_angle(ctx, f.xb, false)).abs());
        anchors.push((usize::MAX, a));
    }
    for (place, a) in anchors {
        if place == 0 {
            supports.insert(0, a);
        } else {
            supports.push(a);
        }
    }
    line.lift_off = supports.iter().any(|s| !s.lift_off_limit.is_nan() && !(s.empty_break >= s.lift_off_limit));
    let samples = sample_line(
        ctx,
        &g.spans,
        |k, x| solved[k].as_ref().map(|s| span::path_height(&s.points, x)).unwrap_or(f64::NAN),
        |k, x| {
            if empty_lines[k].is_empty() {
                f64::NAN
            } else {
                interpolate(&empty_lines[k], x)
            }
        },
    );
    line.max_empty_height =
        samples.iter().filter(|s| !s[2].is_nan() && !s[3].is_nan()).map(|s| s[2] - s[3]).fold(f64::NAN, nan_max);
    Analysis { supports, spans, line, samples }
}

fn nan_max(a: f64, b: f64) -> f64 {
    if a.is_nan() {
        b
    } else if b.is_nan() {
        a
    } else {
        a.max(b)
    }
}

fn interpolate(line: &[(f64, f64)], x: f64) -> f64 {
    if line.is_empty() {
        return f64::NAN;
    }
    if x <= line[0].0 {
        return line[0].1;
    }
    for w in line.windows(2) {
        if x <= w[1].0 {
            let t = if w[1].0 > w[0].0 { (x - w[0].0) / (w[1].0 - w[0].0) } else { 0.0 };
            return w[0].1 + (w[1].1 - w[0].1) * t;
        }
    }
    line[line.len() - 1].1
}

/// Loaded path and empty rope at every profile sample from the start to the end.
fn sample_line(
    ctx: &Ctx,
    spans: &[Field],
    load: impl Fn(usize, f64) -> f64,
    empty: impl Fn(usize, f64) -> f64,
) -> Vec<[f64; 4]> {
    let mut out = Vec::new();
    for i in 0..ctx.prof.z.len() {
        let x = ctx.prof.station(i);
        if x < -1e-9 || x > ctx.p.line_end + 1e-9 {
            continue;
        }
        let k = spans.iter().position(|f| x >= f.xa - 1e-9 && x <= f.xb + 1e-9);
        let (l, e) = match k {
            Some(k) => (load(k, x), empty(k, x)),
            None => (f64::NAN, f64::NAN),
        };
        out.push([x, l, e, ctx.prof.z[i]]);
    }
    out
}

// --- Parity: Zweifel's multi-field analysis -----------------------------------------------------

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

/// SEILAPLAN's final analysis: Zweifel's fixed-length rope over all fields, the load at mid-span of
/// each field in turn, Zweifel's load-path interpolation and Pestal's support angles.
pub fn analyze_parity(ctx: &Ctx, layout: &Layout, t0: f64) -> Analysis {
    let p = ctx.p;
    let pts = layout.points;
    let n = pts.len();
    let kinds = kinds(ctx, layout);
    let g = geometry(ctx, layout);
    let q = p.rope_weight;
    let q_sag = p.rope_weight + p.running_weight / 2.0;
    let datum = pts[0].top();
    // Fields as the analysis sees them: widths and rises to 0.1 m.
    let rounded: Vec<Field> = g
        .spans
        .iter()
        .map(|f| {
            let b = round1(f.b());
            let h = round1(f.h());
            Field { xa: f.xa, za: f.za, xb: f.xa + b, zb: f.za + h }
        })
        .collect();
    let anchor_length =
        g.start_anchor.map(|f| f.chord()).unwrap_or(0.0) + g.end_anchor.map(|f| f.chord()).unwrap_or(0.0);
    let mids: Vec<f64> = rounded.iter().map(|f| t0 + q * (f.z_mid() - datum)).collect();
    let horizontal: Vec<f64> = rounded.iter().zip(&mids).map(|(f, t)| t * f.b() / f.chord()).collect();
    let empty_sag: Vec<f64> =
        rounded.iter().zip(&horizontal).map(|(f, hh)| f.b() * f.chord() * q / (8.0 * hh)).collect();
    let z_max = pts.iter().map(|x| x.top()).fold(f64::NEG_INFINITY, f64::max);
    let mut spans = Vec::new();
    let mut loaded_sag = Vec::new();
    let mut line = LineOut {
        t0,
        tension_ok: true,
        clear_known: true,
        min_clear: f64::NAN,
        min_clear_at: f64::NAN,
        ..Default::default()
    };
    let mut worst = (f64::NEG_INFINITY, 0usize);
    let mut paths: Vec<Box<dyn Fn(f64) -> f64>> = Vec::new();
    for k in 0..rounded.len() {
        let input = ZweifelInput { fields: &rounded, loaded: k, datum, t0, q, ea: p.ea, load: p.load, anchor_length };
        let f = g.spans[k];
        let fr = rounded[k];
        let sol = span::zweifel(&input);
        let (dt, length) = match &sol {
            Some(s) => (s.delta_t, s.empty_length),
            None => (f64::NAN, f64::NAN),
        };
        if k == 0 {
            line.rope_length = length;
            line.unstrained_length = length * (1.0 + t0 / p.ea);
        }
        let t_loaded = mids[k] + dt;
        let hm = fr.b() / fr.chord() * t_loaded;
        let hs = horizontal[k];
        let sag = span::zweifel_loaded_sag(fr.chord(), p.load, q_sag, t_loaded);
        loaded_sag.push(sag);
        let (xa, za, b, h) = (f.xa, f.za, f.b(), f.h());
        let path = move |x: f64| {
            let u = (x - xa) / b;
            let s = 1.0 - 2.0 * u;
            let hx = hm * (1.0 - (1.0 - (hs / hm).powi(2)) * s * s).sqrt();
            za + h * u - sag * (hm / hx) * (1.0 - s * s)
        };
        let mut v = if sol.is_some() { ctx.clearance(f.xa, f.xb, &path) } else { Verdict::unsolved() };
        let peak = t_loaded + q * (z_max - fr.z_mid());
        v.peak = peak;
        v.tension_ok = peak <= p.allowable + 1e-9;
        v.gravity_ok = true;
        if t_loaded > worst.0 {
            worst = (t_loaded, k);
        }
        if !v.min_clear.is_nan() && (line.min_clear.is_nan() || v.min_clear < line.min_clear) {
            line.min_clear = v.min_clear;
            line.min_clear_at = v.min_clear_at;
        }
        if !v.unknown_at.is_nan() {
            line.clear_known = false;
        }
        spans.push(SpanOut {
            from: f.xa,
            to: f.xb,
            chord: fr.chord(),
            empty_sag: empty_sag[k],
            loaded_sag: sag,
            loaded_tension: t_loaded,
            peak,
            verdict: v,
        });
        paths.push(Box::new(path));
    }
    if !rounded.is_empty() {
        let (t, k) = worst;
        line.max_tension = t + q * (z_max - rounded[k].z_mid());
        line.max_tension_span = k as f64;
        line.tension_ok = line.max_tension <= p.allowable + 1e-9;
    }
    // Pestal's slopes: (h ± 4y)/b at the near (−) and far (+) end.
    let near = |k: usize, y: f64| ((rounded[k].h() - 4.0 * y) / rounded[k].b()).atan();
    let far = |k: usize, y: f64| ((rounded[k].h() + 4.0 * y) / rounded[k].b()).atan();
    let mut supports: Vec<SupportOut> =
        (0..n).map(|i| blank_support(kinds[i], pts[i], layout.fixed.get(i).copied().unwrap_or(false))).collect();
    for i in 0..n {
        let s = &mut supports[i];
        s.empty_tension = t0 + q * (pts[i].top() - datum);
        let empty_in =
            if i == 0 { g.start_anchor.map(|f| f.h().atan2(f.b())) } else { Some(far(i - 1, empty_sag[i - 1])) };
        let empty_out = if i + 1 == n {
            if layout.complete {
                g.end_anchor.map(|f| f.h().atan2(f.b()))
            } else {
                None
            }
        } else {
            Some(near(i, empty_sag[i]))
        };
        s.angle_in = empty_in.map(deg).unwrap_or(f64::NAN);
        s.angle_out = empty_out.map(deg).unwrap_or(f64::NAN);
        let (Some(ein), Some(eout)) = (empty_in, empty_out) else { continue };
        if s.kind == SupportKind::GroundAnchor {
            continue;
        }
        s.empty_break = deg(ein - eout);
        let mut loaded = f64::NEG_INFINITY;
        if i > 0 {
            loaded = loaded.max(deg(far(i - 1, loaded_sag[i - 1]) - eout));
        }
        if i + 1 < n {
            loaded = loaded.max(deg(ein - near(i, loaded_sag[i])));
        }
        s.loaded_break = loaded;
        let (rv, rh) = saddle(s.empty_tension, ein, eout);
        s.saddle_rope = rv.hypot(rh);
        if i > 0 && i + 1 < n {
            let lengths = rounded[i - 1].chord() + rounded[i].chord();
            let run: f64 = rounded[..i].iter().map(|f| f.chord()).sum();
            let added = p.load + q * lengths / 2.0 + p.running_weight * run / 2.0;
            s.saddle_on = (rv - added).hypot(rh);
            s.max_force = s.saddle_on;
            s.loaded_limit = p.max_loaded_deg;
            s.lift_off_limit = p.lift_off_deg;
        } else {
            s.loaded_limit = p.max_loaded_end_deg;
        }
    }
    if !rounded.is_empty() {
        let (t, k) = worst;
        let at = |z: f64| t + q * (z - rounded[k].z_mid());
        if layout.complete && supports[n - 1].kind == SupportKind::GroundAnchor {
            let e = pts[n - 1];
            supports[n - 1].max_force = at(e.ground);
            let rope = -far(n - 2, empty_sag[n - 2]);
            supports[n - 1].pull_angle = deg((rope - terrain_angle(ctx, e.station, false)).abs());
        }
        if let Some(f) = g.end_anchor {
            let mut a = blank_support(SupportKind::Anchor, ctx.end_anchor, false);
            a.max_force = at(f.zb);
            a.pull_angle = deg(((-f.h()).atan2(f.b()) - terrain_angle(ctx, f.xb, false)).abs());
            supports.push(a);
        }
        if let Some(f) = g.start_anchor {
            let mut a = blank_support(SupportKind::Anchor, ctx.start_anchor, false);
            a.max_force = at(f.za);
            a.pull_angle = deg((f.h().atan2(f.b()) - terrain_angle(ctx, f.xa, true)).abs());
            supports.insert(0, a);
        }
    }
    line.lift_off = supports.iter().any(|s| !s.lift_off_limit.is_nan() && !(s.empty_break >= s.lift_off_limit));
    let empty_at = |k: usize, x: f64| {
        let f = g.spans[k];
        let u = (x - f.xa) / f.b();
        f.za + f.h() * u - 4.0 * empty_sag[k] * u * (1.0 - u)
    };
    let samples = sample_line(ctx, &g.spans, |k, x| paths[k](x), empty_at);
    line.max_empty_height =
        samples.iter().filter(|s| !s[2].is_nan() && !s[3].is_nan()).map(|s| s[2] - s[3]).fold(f64::NAN, nan_max);
    Analysis { supports, spans, line, samples }
}
