//! One loaded span of a skyline that runs over several fields, and the checks a span must pass.
//!
//! Two models share the field description:
//!
//! - **Catenary** (default). The loaded span is the elastic catenary of `catenary.rs` with the load
//!   moved along it. Every other field (spans, the stand-in chords of the search and the anchor
//!   fields) is an elastic field with Zweifel's parabolic sag excess. The empty rope's tension is
//!   T0 at the yarder-side support top and rises by w per metre of height; the rope slides freely
//!   over the saddles, so fields on the near side of the loaded span take the tension rise of its
//!   near support and fields on the far side that of its far support. The rope's total unstrained
//!   length is fixed by the empty state.
//! - **Parity**. Zweifel's (1960) fixed-length skyline: one uniform tension rise ΔT, the loaded
//!   field's geometric excess 2b²f²/c³, every field's self-weight excess b²cq²/24T² (a quarter of
//!   it for the loaded field), and elastic stretch over the rope plus the straight anchor fields.
//!   The load path is a parabola through the mid-span sag, as SEILAPLAN's optimizer draws it.
//!
//! Written from a functional specification of SEILAPLAN 3.8.2 and from Zweifel (1960), Pestal
//! (1961) and Irvine (1981); no code from SEILAPLAN (GPL-2.0-or-later) was used.

use crate::catenary::{self, RopeCase, RopeState};

/// A straight stretch of rope between two points (support tops or anchors), absolute heights.
#[derive(Clone, Copy, Debug)]
pub struct Field {
    pub xa: f64,
    pub za: f64,
    pub xb: f64,
    pub zb: f64,
}

impl Field {
    pub fn b(&self) -> f64 {
        self.xb - self.xa
    }
    pub fn h(&self) -> f64 {
        self.zb - self.za
    }
    pub fn chord(&self) -> f64 {
        catenary::norm(self.b(), self.h())
    }
    pub fn z_mid(&self) -> f64 {
        (self.za + self.zb) / 2.0
    }
}

/// Zweifel's excess of a hanging field over its chord at mid-field tension `t` (weight `q`).
pub fn sag_excess(f: &Field, q: f64, t: f64) -> f64 {
    let (b, h, c) = (f.b().abs(), f.h(), f.chord());
    if b < 1e-9 || c < 1e-9 || t <= 0.0 {
        return 0.0;
    }
    let hh = t * b / c;
    (b.powi(4) * q * q) / (24.0 * c * hh * hh)
        * (1.0 + (3.0 * b * b + 8.0 * h * h) / (240.0 * c * c) * (b * q / hh).powi(2))
}

// --- Parity: Zweifel's three-field model -------------------------------------------------------

pub struct ZweifelInput<'a> {
    /// Fields between the line's end supports, in order; `loaded` carries the load at mid-field.
    pub fields: &'a [Field],
    pub loaded: usize,
    /// Height of the start support top: T0 is the empty tension there.
    pub datum: f64,
    pub t0: f64,
    /// Skyline weight, kN/m (the tension solve uses the skyline alone).
    pub q: f64,
    pub ea: f64,
    pub load: f64,
    /// Straight length of the anchor fields, m.
    pub anchor_length: f64,
}

pub struct ZweifelSolution {
    pub delta_t: f64,
    /// Empty mid-field tension of the loaded field.
    pub t_mid: f64,
    /// Empty rope length between the end supports.
    pub empty_length: f64,
}

/// The tension rise ΔT with the load at mid-span of the loaded field. None when the empty rope is
/// already longer than the loaded geometry needs (the span is "impossible").
pub fn zweifel(input: &ZweifelInput) -> Option<ZweifelSolution> {
    let q = input.q;
    let mids: Vec<f64> = input.fields.iter().map(|f| input.t0 + q * (f.z_mid() - input.datum)).collect();
    if mids.iter().any(|t| *t <= 0.0) {
        return None;
    }
    let empty_excess: f64 = input.fields.iter().zip(&mids).map(|(f, t)| sag_excess(f, q, *t)).sum();
    let chords: f64 = input.fields.iter().map(|f| f.chord()).sum();
    let empty_length = chords + empty_excess;
    let lf = &input.fields[input.loaded];
    let (b2, c2) = (lf.b(), lf.chord());
    let t_mid = mids[input.loaded];
    let mismatch = |dt: f64| -> f64 {
        let f = c2 * (input.load + c2 * q / 2.0) / (4.0 * (t_mid + dt));
        let geometric = 2.0 * b2 * b2 * f * f / c2.powi(3);
        let mut weight = 0.0;
        for (j, (fld, t)) in input.fields.iter().zip(&mids).enumerate() {
            let b = fld.b();
            let part = b * b * fld.chord() * q * q / (24.0 * (t + dt) * (t + dt));
            weight += if j == input.loaded { part / 4.0 } else { part };
        }
        geometric + weight - empty_excess - dt * (empty_length + input.anchor_length) / input.ea
    };
    if mismatch(0.0) < 0.0 {
        return None;
    }
    let dt = coarse_root(&mismatch)?;
    Some(ZweifelSolution { delta_t: dt, t_mid, empty_length })
}

/// The tension rise at which the length mismatch first falls under 1/64 m: bracketed from 32 kN
/// by doubling, then halved. The reference program stops there rather than at the exact root,
/// which puts ΔT on a coarse grid; the parity model does the same.
fn coarse_root(mismatch: &dyn Fn(f64) -> f64) -> Option<f64> {
    let tolerance = 1.0 / 64.0;
    let (mut lo, mut hi) = (0.0, 32.0);
    let mut m = mismatch(hi);
    if m.abs() < tolerance {
        return Some(hi);
    }
    while m > 0.0 {
        lo = hi;
        hi *= 2.0;
        if hi > 1e8 {
            return None;
        }
        m = mismatch(hi);
        if m.abs() < tolerance {
            return Some(hi);
        }
    }
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        let m = mismatch(mid);
        if m.abs() < tolerance {
            return Some(mid);
        }
        if m > 0.0 {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    Some(0.5 * (lo + hi))
}

/// Loaded mid-span sag with the running lines (Zweifel 8).
pub fn zweifel_loaded_sag(chord: f64, load: f64, q_with_running: f64, tension: f64) -> f64 {
    chord * (load + chord * q_with_running / 2.0) / (4.0 * tension)
}

// --- Catenary model ----------------------------------------------------------------------------

#[derive(Clone, Copy, Debug)]
pub struct RopeProps {
    /// Skyline plus half the running lines, kN per unstrained metre (as `cableMechanics.ts`).
    pub w: f64,
    pub ea: f64,
    pub load: f64,
}

/// One load position on the loaded span.
#[derive(Clone, Copy, Debug)]
pub struct LoadPoint {
    /// Absolute station and height of the carriage.
    pub x: f64,
    pub z: f64,
    pub t_near: f64,
    pub t_far: f64,
    pub h: f64,
    pub v_near: f64,
    pub v_far: f64,
    /// Largest tension anywhere in the rope with the load here.
    pub peak: f64,
}

pub struct CatenarySpan {
    pub empty_l0: f64,
    pub empty_state: RopeState,
    pub empty_near: f64,
    pub empty_far: f64,
    /// Load positions from the near support (index 0, the empty rope) to the far one.
    pub points: Vec<LoadPoint>,
    /// Largest tension over every load position.
    pub peak: f64,
}

/// Cosine-spaced fractions of the rope, denser near the supports, with 0.5 exactly in the middle.
pub fn load_fractions(n: usize) -> Vec<f64> {
    let n = n.max(2) & !1;
    let mut out: Vec<f64> =
        (0..=n).map(|i| (1.0 - (core::f64::consts::PI * i as f64 / n as f64).cos()) / 2.0).collect();
    out[n / 2] = 0.5;
    out[0] = 0.0;
    out[n] = 1.0;
    out
}

/// Unstrained length of a non-loaded field at mid-field tension `t`.
fn field_rope(f: &Field, w: f64, ea: f64, t: f64) -> f64 {
    (f.chord() + sag_excess(f, w, t)) / (1.0 + t / ea)
}

/// The loaded span `fields[loaded]` with the load moved along it at `fractions`.
pub fn catenary_span(
    fields: &[Field],
    loaded: usize,
    datum: f64,
    t0: f64,
    rope: RopeProps,
    fractions: &[f64],
) -> Option<CatenarySpan> {
    let span = fields[loaded];
    let (b, h) = (span.b(), span.h());
    if !(b > 0.0) {
        return None;
    }
    let w = rope.w;
    let z_low = span.za.min(span.zb);
    let t_low = t0 + w * (z_low - datum);
    if !(t_low > 0.0) {
        return None;
    }
    let empty = catenary::empty_for_lower_tension(b, h, w, rope.ea, t_low)?;
    let empty_case = RopeCase { b, h, l0: empty.l0, w, ea: rope.ea, load: 0.0, at: 0.0 };
    let ed = catenary::describe(&empty_case, empty.state);
    let mids: Vec<f64> = fields.iter().map(|f| t0 + w * (f.z_mid() - datum)).collect();
    if mids.iter().enumerate().any(|(j, t)| j != loaded && *t <= 0.0) {
        return None;
    }
    let others: f64 =
        fields.iter().enumerate().filter(|(j, _)| *j != loaded).map(|(j, f)| field_rope(f, w, rope.ea, mids[j])).sum();
    let total = empty.l0 + others;
    let has_others = fields.len() > 1;
    let z_max_left = fields[..loaded].iter().map(|f| f.za.max(f.zb)).fold(span.za, f64::max);
    let z_max_right = fields[loaded + 1..].iter().map(|f| f.za.max(f.zb)).fold(span.zb, f64::max);
    let peak_of =
        |t_near: f64, t_far: f64| (t_near + w * (z_max_left - span.za)).max(t_far + w * (z_max_right - span.zb));

    // Rope length balance: the loaded span takes what the other fields give up as they stretch.
    let balance = |l: f64, state: RopeState, at: f64| -> f64 {
        let c = RopeCase { b, h, l0: l, w, ea: rope.ea, load: rope.load, at: at * l };
        let d = catenary::describe(&c, state);
        let (dn, df) = (d.near_tension - ed.near_tension, d.far_tension - ed.far_tension);
        let mut sum = l;
        for (j, f) in fields.iter().enumerate() {
            if j == loaded {
                continue;
            }
            let rise = if j < loaded { dn } else { df };
            sum += field_rope(f, w, rope.ea, mids[j] + rise);
        }
        sum - total
    };

    // Unstrained rope in the fields on each side at a tension rise, and its derivative.
    let side = |rise: f64, left: bool| -> (f64, f64) {
        let mut sum = 0.0;
        let mut slope = 0.0;
        for (j, f) in fields.iter().enumerate() {
            if j == loaded || (j < loaded) != left {
                continue;
            }
            let t = mids[j] + rise;
            let d = 1e-4 * t.abs().max(1.0);
            sum += field_rope(f, w, rope.ea, t);
            slope += (field_rope(f, w, rope.ea, t + d) - field_rope(f, w, rope.ea, t - d)) / (2.0 * d);
        }
        (sum, slope)
    };
    let newton3 = |u: f64, start: RopeState, l_start: f64| -> Option<(f64, RopeState)> {
        let chord = span.chord();
        let residual = |x: &[f64; 3]| -> Option<([f64; 3], [[f64; 3]; 3])> {
            let (hh, v0, l) = (x[0], x[1], x[2]);
            if !(hh > 0.0) || !(l > 0.0) {
                return None;
            }
            let c = RopeCase { b, h, l0: l, w, ea: rope.ea, load: rope.load, at: u * l };
            let (r, dxdl, dzdl) = catenary::closure_and_length(&c, RopeState { h: hh, v0 }, u);
            let vend = v0 + w * l + rope.load;
            let (tn, tf) = (catenary::norm(hh, v0), catenary::norm(hh, vend));
            let (sl, dl) = side(tn - ed.near_tension, true);
            let (sr, dr) = side(tf - ed.far_tension, false);
            let f = [r.fx / chord, r.fz / chord, (l + sl + sr - total) / chord];
            let j = [
                [r.j[0] / chord, r.j[1] / chord, dxdl / chord],
                [r.j[2] / chord, r.j[3] / chord, dzdl / chord],
                [
                    (dl * hh / tn + dr * hh / tf) / chord,
                    (dl * v0 / tn + dr * vend / tf) / chord,
                    (1.0 + dr * w * vend / tf) / chord,
                ],
            ];
            if f.iter().all(|v| v.is_finite()) && j.iter().flatten().all(|v| v.is_finite()) {
                Some((f, j))
            } else {
                None
            }
        };
        let norm = |f: &[f64; 3]| (f[0] * f[0] + f[1] * f[1] + f[2] * f[2]).sqrt();
        let mut x = [start.h, start.v0, l_start];
        let (mut f, mut j) = residual(&x)?;
        let mut size = norm(&f);
        for _ in 0..60 {
            if size < 1e-11 {
                return Some((x[2], RopeState { h: x[0], v0: x[1] }));
            }
            let step = catenary::solve3(&j, &[-f[0], -f[1], -f[2]])?;
            let mut t = 1.0;
            let mut moved = false;
            for _ in 0..30 {
                let cand = [x[0] + t * step[0], x[1] + t * step[1], x[2] + t * step[2]];
                if let Some((fc, jc)) = residual(&cand) {
                    let sc = norm(&fc);
                    if sc < size {
                        x = cand;
                        f = fc;
                        j = jc;
                        size = sc;
                        moved = true;
                        break;
                    }
                }
                t /= 2.0;
            }
            if !moved {
                break;
            }
        }
        if size < 1e-9 {
            Some((x[2], RopeState { h: x[0], v0: x[1] }))
        } else {
            None
        }
    };

    let mut points = Vec::with_capacity(fractions.len());
    let chord = span.chord();
    let mut guess = Some(empty.state);
    let mut last_l = empty.l0;
    let solve_at = |u: f64, guess: &mut Option<RopeState>, last_l: &mut f64| -> Option<(f64, RopeState)> {
        let make = |l: f64| RopeCase { b, h, l0: l, w, ea: rope.ea, load: rope.load, at: u * l };
        if !has_others {
            let s = catenary::solve(&make(empty.l0), *guess)?;
            return Some((empty.l0, s));
        }
        // Newton on H, V0 and the span's length together: the two closure equations and the
        // length balance. Falls back to a secant on the length alone if it stalls.
        let start = match *guess {
            Some(g) if *last_l > empty.l0 => Some(g),
            // First loaded position: start from the loaded rope at the empty length.
            _ => catenary::solve(&make(empty.l0), None),
        };
        if let Some(g) = start {
            if let Some((l, s)) = newton3(u, g, (*last_l).max(empty.l0)) {
                *guess = Some(s);
                *last_l = l;
                return Some((l, s));
            }
        }
        let eval = |l: f64, g: &mut Option<RopeState>| -> Option<(f64, RopeState)> {
            let s = catenary::solve(&make(l), *g)?;
            *g = Some(s);
            Some((balance(l, s, u), s))
        };
        // Safeguarded secant from the neighbouring position's length. The balance rises with
        // the span's length at a slope of at least 1, and is negative at the empty length.
        let tol = 1e-10 * chord;
        let (mut lo, mut hi) = (empty.l0, f64::INFINITY);
        let mut x0 = if *last_l > empty.l0 { *last_l } else { empty.l0 + 1e-4 * chord };
        let (mut g0, mut s0) = eval(x0, guess)?;
        let mut slope = 1.0f64;
        for _ in 0..80 {
            if g0.abs() < tol {
                *last_l = x0;
                return Some((x0, s0));
            }
            if g0 < 0.0 {
                lo = lo.max(x0);
            } else {
                hi = hi.min(x0);
            }
            let mut x1 = x0 - g0 / slope;
            if !(x1 > lo && x1 < hi) {
                x1 = if hi.is_finite() { 0.5 * (lo + hi) } else { lo + 2.0 * (lo - empty.l0).max(1e-4 * chord) };
            }
            if x1 > 1.6 * chord + empty.l0 {
                return None;
            }
            let (g1, s1) = eval(x1, guess)?;
            let secant = (g1 - g0) / (x1 - x0);
            if secant.is_finite() && secant > 0.0 {
                slope = secant;
            }
            x0 = x1;
            g0 = g1;
            s0 = s1;
            if hi - lo < 1e-13 * chord {
                break;
            }
        }
        *last_l = x0;
        Some((x0, s0))
    };

    let n = fractions.len() - 1;
    let middle = n / 2;
    let mut solved: Vec<Option<LoadPoint>> = vec![None; n + 1];
    let at_support = |i: usize| -> LoadPoint {
        let near = i == 0;
        LoadPoint {
            x: if near { span.xa } else { span.xb },
            z: if near { span.za } else { span.zb },
            t_near: ed.near_tension,
            t_far: ed.far_tension,
            h: ed.h,
            v_near: ed.v_near,
            v_far: ed.v_far,
            peak: peak_of(ed.near_tension, ed.far_tension),
        }
    };
    solved[0] = Some(at_support(0));
    solved[n] = Some(at_support(n));
    let mut point = |i: usize, guess: &mut Option<RopeState>, last_l: &mut f64| -> Option<()> {
        let u = fractions[i];
        let (l, s) = solve_at(u, guess, last_l)?;
        let c = RopeCase { b, h, l0: l, w, ea: rope.ea, load: rope.load, at: u * l };
        let d = catenary::describe(&c, s);
        *guess = Some(s);
        solved[i] = Some(LoadPoint {
            x: span.xa + d.load_x,
            z: span.za + d.load_z,
            t_near: d.near_tension,
            t_far: d.far_tension,
            h: d.h,
            v_near: d.v_near,
            v_far: d.v_far,
            peak: peak_of(d.near_tension, d.far_tension),
        });
        Some(())
    };
    point(middle, &mut guess, &mut last_l)?;
    let mid_guess = guess;
    let mid_l = last_l;
    for i in (1..middle).rev() {
        point(i, &mut guess, &mut last_l)?;
    }
    guess = mid_guess;
    last_l = mid_l;
    for i in middle + 1..n {
        point(i, &mut guess, &mut last_l)?;
    }
    for p in solved.into_iter() {
        points.push(p?);
    }
    let peak = points.iter().map(|p| p.peak).fold(0.0, f64::max);
    Some(CatenarySpan {
        empty_l0: empty.l0,
        empty_state: empty.state,
        empty_near: ed.near_tension,
        empty_far: ed.far_tension,
        points,
        peak,
    })
}

/// Height of the load path at station `x` by quadratic interpolation through three neighbouring
/// load positions (the path is smooth; a straight line between positions would sit above it).
pub fn path_height(points: &[LoadPoint], x: f64) -> f64 {
    let n = points.len();
    if n < 2 {
        return f64::NAN;
    }
    if x <= points[0].x {
        return points[0].z;
    }
    if x >= points[n - 1].x {
        return points[n - 1].z;
    }
    let mut lo = 0usize;
    let mut hi = n - 1;
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        if points[mid].x <= x {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    if n < 3 {
        let t = (x - points[lo].x) / (points[hi].x - points[lo].x);
        return points[lo].z + (points[hi].z - points[lo].z) * t;
    }
    // The third point on the side nearer to x.
    let (i0, i1, i2) = if lo == 0 {
        (0, 1, 2)
    } else if hi == n - 1 {
        (n - 3, n - 2, n - 1)
    } else if x - points[lo].x < points[hi].x - x {
        (lo - 1, lo, hi)
    } else {
        (lo, hi, hi + 1)
    };
    let (a, b, c) = (points[i0], points[i1], points[i2]);
    let l0 = (x - b.x) * (x - c.x) / ((a.x - b.x) * (a.x - c.x));
    let l1 = (x - a.x) * (x - c.x) / ((b.x - a.x) * (b.x - c.x));
    let l2 = (x - a.x) * (x - b.x) / ((c.x - a.x) * (c.x - b.x));
    a.z * l0 + b.z * l1 + c.z * l2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_span_matches_the_fixed_length_rope() {
        // One span, no other rope: the loaded tension rises with the load and the mid-span carriage
        // hangs below the chord.
        let fields = [Field { xa: 0.0, za: 1012.0, xb: 200.0, zb: 954.0 }];
        let rope = RopeProps { w: 0.0232, ea: 26_609.3, load: 35.0 };
        let span = catenary_span(&fields, 0, 954.0, 60.0, rope, &load_fractions(40)).unwrap();
        assert!((span.empty_far - 60.0).abs() < 1e-6);
        let mid = span.points[20];
        assert!(mid.t_near > 150.0 && mid.t_near < 220.0);
        let chord = 1012.0 + (954.0 - 1012.0) * (mid.x / 200.0);
        assert!(chord - mid.z > 3.0);
    }

    #[test]
    fn rope_beyond_the_span_lowers_the_loaded_tension() {
        let rope = RopeProps { w: 0.0232, ea: 26_609.3, load: 35.0 };
        let alone = [Field { xa: 0.0, za: 1012.0, xb: 200.0, zb: 954.0 }];
        let with_more =
            [Field { xa: 0.0, za: 1012.0, xb: 200.0, zb: 954.0 }, Field { xa: 200.0, za: 954.0, xb: 400.0, zb: 900.0 }];
        let f = load_fractions(20);
        let a = catenary_span(&alone, 0, 954.0, 60.0, rope, &f).unwrap();
        let b = catenary_span(&with_more, 0, 954.0, 60.0, rope, &f).unwrap();
        assert!(b.points[10].t_near < a.points[10].t_near - 5.0);
    }
}
