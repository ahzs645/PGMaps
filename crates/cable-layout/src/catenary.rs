//! Elastic catenary with one point load (Irvine 1981, "Cable Structures", ch. 2–3), the same
//! rope PGMaps' `cableMechanics.ts` solves: for an unstrained length L0 the horizontal tension H is
//! constant, the vertical tension rises by the weight per unstrained metre w and steps up by the
//! load where it hangs. Integrating the stretched rope's slope gives two closure equations for H
//! and the vertical tension V0 at the near support, solved by Newton's method with an analytic
//! Jacobian.
//!
//! Pure arithmetic. Lengths m, forces kN.

#[derive(Clone, Copy, Debug)]
pub struct RopeCase {
    /// Horizontal distance and rise from the near support to the far one, m.
    pub b: f64,
    pub h: f64,
    /// Unstrained length, m.
    pub l0: f64,
    pub w: f64,
    pub ea: f64,
    /// Point load, kN, at unstrained distance `at` from the near support.
    pub load: f64,
    pub at: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct RopeState {
    pub h: f64,
    pub v0: f64,
}

/// √(a² + b²) without `hypot`'s overflow guard, which WebAssembly runs in software; the
/// magnitudes here (kN, m) are far from overflow.
#[inline(always)]
pub fn norm(a: f64, b: f64) -> f64 {
    (a * a + b * b).sqrt()
}

/// asinh by its logarithm, odd-symmetric and through `ln_1p` near zero.
#[inline(always)]
fn asinh(x: f64) -> f64 {
    let a = x.abs();
    let r = (a + a * a / (1.0 + (1.0 + a * a).sqrt())).ln_1p();
    if x < 0.0 {
        -r
    } else {
        r
    }
}

struct Piece {
    dx: f64,
    dz: f64,
    dxdh: f64,
    dxdv: f64,
    dzdh: f64,
    dzdv: f64,
}

fn piece(h: f64, va: f64, vb: f64, length: f64, w: f64, ea: f64) -> Piece {
    let ra = norm(h, va);
    let rb = norm(h, vb);
    let as_a = asinh(va / h);
    let as_b = asinh(vb / h);
    Piece {
        dx: (h * length) / ea + (h / w) * (as_b - as_a),
        dz: ((va + vb) / 2.0) * (length / ea) + (rb - ra) / w,
        dxdh: length / ea + (as_b - vb / rb - as_a + va / ra) / w,
        dxdv: (h / rb - h / ra) / w,
        dzdh: (h / rb - h / ra) / w,
        dzdv: length / ea + (vb / rb - va / ra) / w,
    }
}

pub struct Closure {
    pub fx: f64,
    pub fz: f64,
    pub j: [f64; 4],
    pub load_x: f64,
    pub load_z: f64,
}

pub fn closure(c: &RopeCase, s: RopeState) -> Closure {
    let at_load = s.v0 + c.w * c.at;
    let a = piece(s.h, s.v0, at_load, c.at, c.w, c.ea);
    let b = piece(s.h, at_load + c.load, s.v0 + c.w * c.l0 + c.load, c.l0 - c.at, c.w, c.ea);
    Closure {
        fx: a.dx + b.dx - c.b,
        fz: a.dz + b.dz - c.h,
        j: [a.dxdh + b.dxdh, a.dxdv + b.dxdv, a.dzdh + b.dzdh, a.dzdv + b.dzdv],
        load_x: a.dx,
        load_z: a.dz,
    }
}

/// Closure residuals plus their derivatives with respect to the unstrained length when the load
/// sits at the fixed fraction `u` of it (`c.at = u · c.l0`).
pub fn closure_and_length(c: &RopeCase, s: RopeState, u: f64) -> (Closure, f64, f64) {
    let r = closure(c, s);
    let (hh, w, ea, l) = (s.h, c.w, c.ea, c.l0);
    let va = s.v0;
    let vb = s.v0 + w * u * l;
    let va2 = vb + c.load;
    let vb2 = s.v0 + w * l + c.load;
    let (tb, ta2, tb2) = (norm(hh, vb), norm(hh, va2), norm(hh, vb2));
    let dxdl = hh * u / ea + hh * u / tb + hh * (1.0 - u) / ea + hh / tb2 - hh * u / ta2;
    let len_a = u * l;
    let len_b = (1.0 - u) * l;
    let dzdl = ((w * u / 2.0) * len_a + (va + vb) / 2.0 * u) / ea
        + vb / tb * u
        + (((w * u + w) / 2.0) * len_b + (va2 + vb2) / 2.0 * (1.0 - u)) / ea
        + vb2 / tb2
        - u * va2 / ta2;
    (r, dxdl, dzdl)
}

/// A parabolic starting estimate: sag from the spare length, H from the sag.
fn seed(c: &RopeCase) -> RopeState {
    let chord = c.b.hypot(c.h);
    let spare = (c.l0 * (1.0 + 1e-4) - chord).max(chord * 1e-5);
    let sag = ((3.0 * c.b * spare) / 8.0).sqrt().max(c.b * 1e-3);
    let weight = c.w * c.l0;
    let h = (c.load * c.b * (c.at / c.l0) * (1.0 - c.at / c.l0) + (weight * c.b) / 8.0) / sag;
    RopeState { h, v0: (h * c.h) / c.b - c.load * (1.0 - c.at / c.l0) - weight / 2.0 }
}

fn attempt(c: &RopeCase, start: RopeState, scale: f64) -> Option<RopeState> {
    let mut s = start;
    let mut r = closure(c, s);
    let mut size = norm(r.fx, r.fz);
    if !size.is_finite() {
        return None;
    }
    for _ in 0..80 {
        if size < 1e-9 * scale {
            return Some(s);
        }
        let [a, b, cc, d] = r.j;
        let det = a * d - b * cc;
        if !det.is_finite() || det == 0.0 {
            return None;
        }
        let dh = (-d * r.fx + b * r.fz) / det;
        let dv = (cc * r.fx - a * r.fz) / det;
        let mut step = 1.0;
        let mut moved = false;
        for _ in 0..40 {
            let candidate = RopeState { h: s.h + step * dh, v0: s.v0 + step * dv };
            if candidate.h > 0.0 && candidate.v0.is_finite() {
                let trial = closure(c, candidate);
                let trial_size = norm(trial.fx, trial.fz);
                if trial_size.is_finite() && trial_size < size {
                    s = candidate;
                    r = trial;
                    size = trial_size;
                    moved = true;
                    break;
                }
            }
            step /= 2.0;
        }
        if !moved {
            return if size < 1e-6 * scale { Some(s) } else { None };
        }
    }
    if size < 1e-6 * scale {
        Some(s)
    } else {
        None
    }
}

/// Solves the rope for H and V0, from `guess` when given, else from a parabolic estimate.
pub fn solve(c: &RopeCase, guess: Option<RopeState>) -> Option<RopeState> {
    if !(c.b > 0.0) || !(c.l0 > 0.0) {
        return None;
    }
    let scale = c.b.hypot(c.h).max(1.0);
    if let Some(g) = guess {
        if let Some(s) = attempt(c, g, scale) {
            return Some(s);
        }
    }
    attempt(c, seed(c), scale)
}

/// Support tensions and the load point for a solved rope.
#[derive(Clone, Copy, Debug)]
pub struct Described {
    pub load_x: f64,
    pub load_z: f64,
    pub near_tension: f64,
    pub far_tension: f64,
    pub h: f64,
    /// Vertical tension components at the near and far supports (upward along the rope).
    pub v_near: f64,
    pub v_far: f64,
}

pub fn describe(c: &RopeCase, s: RopeState) -> Described {
    let r = closure(c, s);
    let v_end = s.v0 + c.w * c.l0 + c.load;
    Described {
        load_x: r.load_x,
        load_z: r.load_z,
        near_tension: norm(s.h, s.v0),
        far_tension: norm(s.h, v_end),
        h: s.h,
        v_near: s.v0,
        v_far: v_end,
    }
}

/// The rope's line for a solved state, `count + 1` points along its unstrained length.
pub fn rope_line(c: &RopeCase, s: RopeState, count: usize) -> Vec<(f64, f64)> {
    let mut out = Vec::with_capacity(count + 1);
    for i in 0..=count {
        let p = c.l0 * i as f64 / count as f64;
        let first = p.min(c.at);
        let a = piece(s.h, s.v0, s.v0 + c.w * first, first, c.w, c.ea);
        if p <= c.at {
            out.push((a.dx, a.dz));
            continue;
        }
        let vb = s.v0 + c.w * c.at + c.load;
        let b = piece(s.h, vb, vb + c.w * (p - c.at), p - c.at, c.w, c.ea);
        out.push((a.dx + b.dx, a.dz + b.dz));
    }
    out
}

/// The empty rope whose tension at its lower end is `target`: unknowns H, V0 and L0, solved
/// together by Newton's method (two closure equations and the tension condition).
#[derive(Clone, Copy, Debug)]
pub struct EmptySpan {
    pub l0: f64,
    pub state: RopeState,
}

pub fn empty_for_lower_tension(b: f64, h: f64, w: f64, ea: f64, target: f64) -> Option<EmptySpan> {
    if !(b > 0.0) || !(target > 0.0) {
        return None;
    }
    let chord = b.hypot(h);
    let near_is_lower = h >= 0.0;
    // Parabolic start: horizontal force from the target at mid-height, sag from that.
    let h0 = (target * b / chord).max(1e-6);
    let sag = w * b * chord / (8.0 * h0);
    let l_start = (chord + 8.0 * sag * sag / (3.0 * chord) * (b / chord).powi(2)) / (1.0 + target / ea);
    let mut x = [h0, h0 * h / b - w * l_start / 2.0, l_start];
    let residual = |x: &[f64; 3]| -> Option<([f64; 3], [[f64; 3]; 3])> {
        let (hh, v0, l0) = (x[0], x[1], x[2]);
        if !(hh > 0.0) || !(l0 > 0.0) {
            return None;
        }
        let vb = v0 + w * l0;
        let p = piece(hh, v0, vb, l0, w, ea);
        let ta = norm(hh, v0);
        let tb = norm(hh, vb);
        let (t_low, dt) =
            if near_is_lower { (ta, [hh / ta, v0 / ta, 0.0]) } else { (tb, [hh / tb, vb / tb, w * vb / tb]) };
        let f = [(p.dx - b) / chord, (p.dz - h) / chord, (t_low - target) / target];
        let j = [
            [p.dxdh / chord, p.dxdv / chord, (hh / ea + hh / tb) / chord],
            [p.dzdh / chord, p.dzdv / chord, ((v0 + vb) / (2.0 * ea) + w * l0 / (2.0 * ea) + vb / tb) / chord],
            [dt[0] / target, dt[1] / target, dt[2] / target],
        ];
        if f.iter().all(|v| v.is_finite()) {
            Some((f, j))
        } else {
            None
        }
    };
    let norm = |f: &[f64; 3]| (f[0] * f[0] + f[1] * f[1] + f[2] * f[2]).sqrt();
    let (mut f, mut j) = residual(&x)?;
    let mut size = norm(&f);
    for _ in 0..100 {
        if size < 1e-12 {
            break;
        }
        let step = solve3(&j, &[-f[0], -f[1], -f[2]])?;
        let mut t = 1.0;
        let mut moved = false;
        for _ in 0..50 {
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
    if size < 1e-8 {
        Some(EmptySpan { l0: x[2], state: RopeState { h: x[0], v0: x[1] } })
    } else {
        None
    }
}

pub fn solve3(a: &[[f64; 3]; 3], b: &[f64; 3]) -> Option<[f64; 3]> {
    let det = |m: &[[f64; 3]; 3]| {
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    };
    let d = det(a);
    if !d.is_finite() || d.abs() < 1e-300 {
        return None;
    }
    let mut out = [0.0; 3];
    for (col, slot) in out.iter_mut().enumerate() {
        let mut m = *a;
        for row in 0..3 {
            m[row][col] = b[row];
        }
        *slot = det(&m) / d;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_rope_meets_its_lower_tension() {
        let e = empty_for_lower_tension(200.0, -58.0, 0.0232, 26_609.0, 60.0).unwrap();
        let c = RopeCase { b: 200.0, h: -58.0, l0: e.l0, w: 0.0232, ea: 26_609.0, load: 0.0, at: e.l0 / 2.0 };
        let d = describe(&c, e.state);
        // Far end is the lower one here.
        assert!((d.far_tension - 60.0).abs() < 1e-6);
        assert!(d.near_tension > d.far_tension);
        let r = closure(&c, e.state);
        assert!(r.fx.abs() < 1e-6 && r.fz.abs() < 1e-6);
    }

    #[test]
    fn tension_rises_with_height_by_the_rope_weight() {
        let e = empty_for_lower_tension(300.0, 90.0, 0.03, 30_000.0, 80.0).unwrap();
        let c = RopeCase { b: 300.0, h: 90.0, l0: e.l0, w: 0.03, ea: 30_000.0, load: 0.0, at: 0.0 };
        let d = describe(&c, e.state);
        // dT/dz = w / (1 + T/EA) for the elastic catenary.
        assert!((d.far_tension - d.near_tension - 0.03 * 90.0 / (1.0 + 81.0 / 30_000.0)).abs() < 2e-3);
    }
}
