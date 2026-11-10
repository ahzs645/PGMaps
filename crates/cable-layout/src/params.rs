//! Inputs of one layout run: the ground profile, the line's end elements, the rope and every
//! search setting. Units are kN, kN/m and m throughout; stations are horizontal metres from the
//! yarder-side start of the line.
//!
//! Written from a functional specification of SEILAPLAN's inputs; no code from SEILAPLAN
//! (GPL-2.0-or-later) was used.

/// Which span model the search and the final analysis use.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Model {
    /// Elastic catenary for the loaded span (Irvine 1981), as PGMaps' `cableMechanics.ts`; the
    /// search and the final check use the same model, so a layout the search accepts is the one
    /// the final check reports. The default.
    Catenary,
    /// Zweifel's three-field fixed-length skyline with a parabolic load path, and SEILAPLAN 3.8.2's
    /// search semantics, defects included. For reproducing the reference run only.
    Parity,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StartKind {
    /// A tower of fixed height; no anchor field is modelled behind it.
    Yarder,
    /// A support whose height is chosen, with a ground anchor behind it.
    Support,
    /// A ground anchor the carriage travels to.
    Anchor,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EndKind {
    Support,
    Anchor,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CableSystem {
    /// Skyline and mainline; the carriage runs out by gravity, so the loaded path must descend.
    TwoCable,
    /// Skyline, mainline and haulback; no gravity check.
    MultiCable,
}

/// A support the user placed. Without a height the search picks one from the ladder.
#[derive(Clone, Copy, Debug)]
pub struct FixedSupport {
    pub station: f64,
    pub height: Option<f64>,
}

#[derive(Clone, Copy, Debug)]
pub struct Sector {
    pub from: f64,
    pub to: f64,
}

/// Ground heights at a fixed spacing; `NaN` is unknown ground.
#[derive(Clone, Debug)]
pub struct Profile {
    /// Station of the first sample (negative when the profile runs behind the start).
    pub x0: f64,
    pub dx: f64,
    pub z: Vec<f64>,
}

impl Profile {
    pub fn station(&self, i: usize) -> f64 {
        self.x0 + i as f64 * self.dx
    }
    pub fn last_station(&self) -> f64 {
        self.station(self.z.len().saturating_sub(1))
    }
    /// Linear interpolation between samples; `NaN` outside the profile or next to unknown ground.
    pub fn ground(&self, x: f64) -> f64 {
        if self.z.is_empty() || !x.is_finite() {
            return f64::NAN;
        }
        let t = (x - self.x0) / self.dx;
        let n = self.z.len();
        if t < -1e-9 || t > (n - 1) as f64 + 1e-9 {
            return f64::NAN;
        }
        let t = t.clamp(0.0, (n - 1) as f64);
        let i = (t.floor() as usize).min(n.saturating_sub(2));
        if n == 1 {
            return self.z[0];
        }
        let f = t - i as f64;
        if f < 1e-12 {
            return self.z[i];
        }
        if f > 1.0 - 1e-12 {
            return self.z[i + 1];
        }
        self.z[i] + (self.z[i + 1] - self.z[i]) * f
    }
    /// Index range of the samples strictly between two stations.
    pub fn between(&self, a: f64, b: f64) -> core::ops::Range<usize> {
        let n = self.z.len() as isize;
        let lo = ((a - self.x0) / self.dx + 1e-9).floor() as isize + 1;
        let hi = ((b - self.x0) / self.dx - 1e-9).ceil() as isize;
        let lo = lo.clamp(0, n) as usize;
        let hi = hi.clamp(0, n) as usize;
        lo..hi.max(lo)
    }
}

#[derive(Clone, Debug)]
pub struct Params {
    pub model: Model,
    pub start_kind: StartKind,
    pub end_kind: EndKind,
    /// Fixed height of a yarder start, m.
    pub tower_height: f64,
    pub system: CableSystem,
    /// Gravity check applies only between these distances from the start and before the end, m.
    pub traffic_start: f64,
    pub traffic_end: f64,
    /// Required loaded-path clearance, m.
    pub min_clearance: f64,
    /// Lengths at the start and end where `zone_clearance` replaces `min_clearance`, m.
    pub clearance_start: f64,
    pub clearance_end: f64,
    /// Clearance required inside those end zones (SEILAPLAN: −1 m), m.
    pub zone_clearance: f64,
    /// Carriage and turn, kN.
    pub load: f64,
    /// Skyline weight, kN/m.
    pub rope_weight: f64,
    /// Running lines (mainline + haulback as used), kN/m.
    pub running_weight: f64,
    /// Axial stiffness E·A, kN.
    pub ea: f64,
    /// Allowable skyline tension, kN.
    pub allowable: f64,
    /// Pre-tension range searched, kN, at `tension_step`.
    pub tension_low: f64,
    pub tension_high: f64,
    pub tension_step: f64,
    /// Smallest horizontal distance between two intermediate supports, m.
    pub min_support_spacing: f64,
    /// Candidate grid spacing, m.
    pub candidate_spacing: f64,
    pub min_height: f64,
    pub max_height: f64,
    pub height_step: f64,
    /// Above this saddle height a support is built, not a tree: its cost is ×5.
    pub artificial_height: f64,
    /// Smallest empty break angle at an intermediate support (lift-off), degrees.
    pub lift_off_deg: f64,
    /// Below this empty break angle a hold-down lug is needed (reported only), degrees.
    pub hold_down_deg: f64,
    /// Largest loaded break angle at an intermediate support, degrees.
    pub max_loaded_deg: f64,
    /// Largest loaded break angle at the first and last support, degrees.
    pub max_loaded_end_deg: f64,
    /// Anchor distance behind a support end, m.
    pub anchor_distance: f64,
    /// Parity only: support height used for the anchor rope length before optimization, m.
    pub anchor_ref_height: f64,
    /// Catenary only: smallest descent of the loaded path for a gravity carriage, m per m.
    pub min_gravity_grade: f64,
    /// Station of the end point, m.
    pub line_end: f64,
    /// Largest number of spans the search may evaluate.
    pub max_arcs: usize,
    /// Catenary only: load positions solved per span (cosine-spaced).
    pub load_positions: usize,
}

/// Why a run is refused before it starts. The TypeScript wrapper words each code.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum InputError {
    Format = 1,
    Profile = 2,
    EndGroundUnknown = 3,
    TwoCableUphill = 4,
    ClearanceAboveSupport = 5,
    AnchorZoneZero = 6,
    FixedSupport = 7,
    Sector = 8,
    HeightLadder = 9,
    TensionRange = 10,
    Rope = 11,
    TooManySpans = 12,
    FixedInSector = 13,
}

pub fn validate(p: &Params, prof: &Profile, fixed: &[FixedSupport], sectors: &[Sector]) -> Result<(), InputError> {
    let finite = [
        p.tower_height,
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
    ];
    if finite.iter().any(|v| !v.is_finite()) {
        return Err(InputError::Format);
    }
    if !(prof.dx > 0.0)
        || prof.z.len() < 3
        || p.line_end < 2.0 * prof.dx
        || prof.x0 > 1e-9
        || prof.last_station() < p.line_end - 1e-6
    {
        return Err(InputError::Profile);
    }
    if prof.ground(0.0).is_nan() || prof.ground(p.line_end).is_nan() {
        return Err(InputError::EndGroundUnknown);
    }
    if !(p.rope_weight > 0.0) || !(p.ea > 0.0) || !(p.load > 0.0) || !(p.allowable > 0.0) || p.running_weight < 0.0 {
        return Err(InputError::Rope);
    }
    if !(p.tension_step > 0.0) || !(p.tension_low > 0.0) || p.tension_low > p.tension_high {
        return Err(InputError::TensionRange);
    }
    if !(p.height_step > 0.0) || !(p.min_height > 0.0) || p.min_height > p.max_height || !(p.candidate_spacing > 0.0) {
        return Err(InputError::HeightLadder);
    }
    if p.min_clearance > p.min_height + 1e-9 {
        return Err(InputError::ClearanceAboveSupport);
    }
    if (p.start_kind == StartKind::Anchor && p.clearance_start <= 0.0)
        || (p.end_kind == EndKind::Anchor && p.clearance_end <= 0.0)
    {
        return Err(InputError::AnchorZoneZero);
    }
    if p.system == CableSystem::TwoCable && prof.ground(0.0) < prof.ground(p.line_end) {
        return Err(InputError::TwoCableUphill);
    }
    let mut stations: Vec<f64> = Vec::new();
    for f in fixed {
        if !f.station.is_finite()
            || f.station <= 1e-6
            || f.station >= p.line_end - 1e-6
            || prof.ground(f.station).is_nan()
        {
            return Err(InputError::FixedSupport);
        }
        if let Some(h) = f.height {
            if !h.is_finite() || h <= 0.0 || h > 100.0 {
                return Err(InputError::FixedSupport);
            }
        }
        if stations.iter().any(|s| (s - f.station).abs() < 1e-6) {
            return Err(InputError::FixedSupport);
        }
        stations.push(f.station);
    }
    for s in sectors {
        if !s.from.is_finite() || !s.to.is_finite() || s.from >= s.to {
            return Err(InputError::Sector);
        }
        if p.model == Model::Catenary && fixed.iter().any(|f| f.station > s.from + 1e-9 && f.station < s.to - 1e-9) {
            return Err(InputError::FixedInSector);
        }
    }
    Ok(())
}

/// Ground the start is compared with to call the line downhill. SEILAPLAN compares the 100th
/// candidate (the last one on shorter lines), which in practice is the end point; the catenary
/// model compares the end point directly.
pub fn gravity_reference(p: &Params, prof: &Profile) -> f64 {
    if p.model == Model::Parity {
        let count = (p.line_end / p.candidate_spacing + 1e-9).floor() as usize;
        let station = if count >= 99 { 99.0 * p.candidate_spacing } else { p.line_end };
        return prof.ground(station);
    }
    prof.ground(p.line_end)
}

/// Saddle heights from `low` to `high` in `step`, built by multiplication so they do not drift.
pub fn ladder(low: f64, high: f64, step: f64) -> Vec<f64> {
    let mut out = Vec::new();
    let mut k = 0usize;
    loop {
        let h = low + k as f64 * step;
        if h > high + 1e-9 {
            break;
        }
        out.push(h);
        k += 1;
        if k > 10_000 {
            break;
        }
    }
    out
}

/// Node cost: 1 for a ground anchor, otherwise (H + 100)², five times that for a built support.
/// Bont & Heinimann (2012): fewest supports first, then lowest.
pub fn support_cost(height: f64, artificial_height: f64) -> f64 {
    if height <= 1e-9 {
        return 1.0;
    }
    let c = (height + 100.0) * (height + 100.0);
    if height > artificial_height + 1e-9 {
        5.0 * c
    } else {
        c
    }
}
