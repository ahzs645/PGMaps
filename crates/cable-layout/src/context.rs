//! The line a span sits on: anchors, clearance zones, the gravity direction, and the checks every
//! span must pass (clearance, tension, gravity carriage). Both the search and the final analysis
//! check spans here, so they cannot disagree on what "clears" means.
//!
//! Written from a functional specification of SEILAPLAN 3.8.2 and from Bont & Heinimann (2012) and
//! Bont et al. (2022); no code from SEILAPLAN (GPL-2.0-or-later) was used.

use crate::params::{CableSystem, EndKind, Model, Params, Profile, StartKind};
use crate::span::{self, Field, LoadPoint, RopeProps, ZweifelInput};

/// A support or anchor at a station: ground and saddle height above it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub station: f64,
    pub ground: f64,
    pub height: f64,
}

impl Point {
    pub fn top(&self) -> f64 {
        self.ground + self.height
    }
}

/// Why a span (or a layout) fails, with where and by how much.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Reason {
    None = 0,
    Clearance = 1,
    Tension = 2,
    Gravity = 3,
    UnknownGround = 4,
    Unsolvable = 5,
    TensionWindow = 6,
    LiftOff = 7,
    LoadedAngle = 8,
    NoCandidates = 9,
    Budget = 10,
}

/// What one span check found at one pre-tension.
#[derive(Clone, Copy, Debug)]
pub struct Verdict {
    pub solved: bool,
    /// First station with unknown ground under the span, or NaN.
    pub unknown_at: f64,
    /// Smallest clearance inside the enforced zone and where (NaN when none was measured).
    pub min_clear: f64,
    pub min_clear_at: f64,
    /// Largest shortfall against the required clearance and where (≤ 0 when it clears).
    pub worst_short: f64,
    pub worst_at: f64,
    pub clear_ok: bool,
    pub gravity_ok: bool,
    pub gravity_at: f64,
    pub peak: f64,
    pub tension_ok: bool,
    /// How far the clearance and gravity checks pass (negative: fail), and the tension check.
    pub lower_margin: f64,
    pub upper_margin: f64,
}

impl Verdict {
    pub fn unsolved() -> Verdict {
        Verdict {
            solved: false,
            unknown_at: f64::NAN,
            min_clear: f64::NAN,
            min_clear_at: f64::NAN,
            worst_short: f64::NAN,
            worst_at: f64::NAN,
            clear_ok: false,
            gravity_ok: false,
            gravity_at: f64::NAN,
            peak: f64::NAN,
            tension_ok: false,
            lower_margin: f64::NAN,
            upper_margin: f64::NAN,
        }
    }
    /// Clearance and gravity: the checks that improve as the rope tightens.
    pub fn lower_ok(&self) -> bool {
        self.solved && self.clear_ok && self.gravity_ok
    }
    pub fn upper_ok(&self) -> bool {
        self.solved && self.tension_ok
    }
    pub fn ok(&self) -> bool {
        self.lower_ok() && self.upper_ok()
    }
    /// The first failing check, for messages.
    pub fn reason(&self) -> (Reason, f64, f64) {
        if !self.solved {
            return (Reason::Unsolvable, f64::NAN, f64::NAN);
        }
        if !self.unknown_at.is_nan() {
            return (Reason::UnknownGround, self.unknown_at, f64::NAN);
        }
        if !self.clear_ok {
            return (Reason::Clearance, self.worst_at, self.worst_short);
        }
        if !self.gravity_ok {
            return (Reason::Gravity, self.gravity_at, f64::NAN);
        }
        if !self.tension_ok {
            return (Reason::Tension, f64::NAN, self.peak);
        }
        (Reason::None, f64::NAN, f64::NAN)
    }
}

pub struct Ctx<'a> {
    pub p: &'a Params,
    pub prof: &'a Profile,
    pub start_anchor: Point,
    pub end_anchor: Point,
    /// Gravity carriage runs out towards the end (the start is the higher end).
    pub gravity_forward: bool,
    pub fractions: Vec<f64>,
    pub rope: RopeProps,
    /// Lowest start and end saddle heights: the search's stand-ins for the line's far ends.
    pub start_low: f64,
    pub end_low: f64,
}

impl<'a> Ctx<'a> {
    pub fn new(p: &'a Params, prof: &'a Profile) -> Ctx<'a> {
        let sa = (-p.anchor_distance).max(prof.x0);
        let ea = (p.line_end + p.anchor_distance).min(prof.last_station());
        let start_low = match p.start_kind {
            StartKind::Yarder => p.tower_height,
            StartKind::Anchor => 0.0,
            StartKind::Support => {
                if p.clearance_start <= 0.0 {
                    p.min_clearance
                } else {
                    0.0
                }
            }
        };
        let end_low = match p.end_kind {
            EndKind::Anchor => 0.0,
            EndKind::Support => {
                if p.clearance_end <= 0.0 {
                    p.min_clearance
                } else {
                    0.0
                }
            }
        };
        let reference = crate::params::gravity_reference(p, prof);
        Ctx {
            p,
            prof,
            start_anchor: Point { station: sa, ground: prof.ground(sa), height: 0.0 },
            end_anchor: Point { station: ea, ground: prof.ground(ea), height: 0.0 },
            gravity_forward: prof.ground(0.0) >= reference,
            fractions: span::load_fractions(p.load_positions),
            rope: RopeProps { w: p.rope_weight + p.running_weight / 2.0, ea: p.ea, load: p.load },
            start_low,
            end_low,
        }
    }

    /// Clearance the loaded path must keep at station `x`.
    pub fn required(&self, x: f64) -> f64 {
        if x < self.p.clearance_start - 1e-9 || x > self.p.line_end - self.p.clearance_end + 1e-9 {
            self.p.zone_clearance
        } else {
            self.p.min_clearance
        }
    }

    pub fn enforced(&self, x: f64) -> bool {
        !(x < self.p.clearance_start - 1e-9 || x > self.p.line_end - self.p.clearance_end + 1e-9)
    }

    fn trafficable(&self, x: f64) -> bool {
        x >= self.p.traffic_start - 1e-9 && x <= self.p.line_end - self.p.traffic_end + 1e-9
    }

    pub fn line_start(&self, height: f64) -> Point {
        Point { station: 0.0, ground: self.prof.ground(0.0), height }
    }
    pub fn line_end(&self, height: f64) -> Point {
        Point { station: self.p.line_end, ground: self.prof.ground(self.p.line_end), height }
    }

    /// Straight anchor fields as SEILAPLAN's optimizer counts them: computed once, with a support
    /// end at the reference height.
    pub fn parity_anchor_length(&self) -> f64 {
        let mut total = 0.0;
        if self.p.start_kind == StartKind::Support {
            let s = self.line_start(self.p.anchor_ref_height);
            total += (s.station - self.start_anchor.station).hypot(s.top() - self.start_anchor.ground);
        }
        if self.p.end_kind == EndKind::Support {
            let e = self.line_end(self.p.anchor_ref_height);
            total += (self.end_anchor.station - e.station).hypot(self.end_anchor.ground - e.top());
        }
        total
    }

    /// The anchor fields behind support ends of the given heights (none behind a ground anchor).
    pub fn anchor_fields(&self, start_height: f64, end_height: f64) -> (Option<Field>, Option<Field>) {
        let start = if self.p.start_kind == StartKind::Support && start_height > 1e-9 {
            let s = self.line_start(start_height);
            Some(Field { xa: self.start_anchor.station, za: self.start_anchor.ground, xb: 0.0, zb: s.top() })
        } else {
            None
        };
        let end = if self.p.end_kind == EndKind::Support && end_height > 1e-9 {
            let e = self.line_end(end_height);
            Some(Field { xa: e.station, za: e.top(), xb: self.end_anchor.station, zb: self.end_anchor.ground })
        } else {
            None
        };
        (start, end)
    }

    /// Checks the span `a → e` of a line whose fields are `fields`, loaded at `loaded`.
    pub fn check_catenary(
        &self,
        fields: &[Field],
        loaded: usize,
        datum: f64,
        t0: f64,
    ) -> (Verdict, Option<span::CatenarySpan>) {
        let solved = span::catenary_span(fields, loaded, datum, t0, self.rope, &self.fractions);
        let Some(s) = solved else {
            return (Verdict::unsolved(), None);
        };
        let f = fields[loaded];
        let mut v = self.clearance(f.xa, f.xb, |x| span::path_height(&s.points, x));
        v.peak = s.peak;
        v.tension_ok = s.peak <= self.p.allowable * (1.0 + 1e-9);
        v.gravity_ok = true;
        let mut gravity_margin = f64::INFINITY;
        if self.p.system == CableSystem::TwoCable {
            let g = self.p.min_gravity_grade;
            for pair in s.points.windows(2) {
                let (p0, p1): (&LoadPoint, &LoadPoint) = (&pair[0], &pair[1]);
                let dx = p1.x - p0.x;
                if !(dx > 0.0) {
                    continue;
                }
                // The carriage runs out away from the yarder: the path must fall that way.
                let (to, rise) = if self.gravity_forward { (p1, p1.z - p0.z) } else { (p0, p0.z - p1.z) };
                if !self.trafficable(to.x) {
                    continue;
                }
                // As a slope, so short steps near the supports do not dominate.
                let margin = -rise / dx - g;
                gravity_margin = gravity_margin.min(margin);
                if !(margin > 0.0) && v.gravity_ok {
                    v.gravity_ok = false;
                    v.gravity_at = to.x;
                }
            }
        }
        v.lower_margin = if v.unknown_at.is_nan() { (-v.worst_short).min(gravity_margin) } else { f64::NEG_INFINITY };
        v.upper_margin = self.p.allowable - s.peak;
        (v, Some(s))
    }

    /// Clearance of a loaded path over the profile samples strictly between two stations.
    pub fn clearance(&self, xa: f64, xb: f64, path: impl Fn(f64) -> f64) -> Verdict {
        let mut v = Verdict {
            solved: true,
            unknown_at: f64::NAN,
            min_clear: f64::NAN,
            min_clear_at: f64::NAN,
            worst_short: f64::NEG_INFINITY,
            worst_at: f64::NAN,
            clear_ok: true,
            gravity_ok: true,
            gravity_at: f64::NAN,
            peak: f64::NAN,
            tension_ok: true,
            lower_margin: f64::NAN,
            upper_margin: f64::NAN,
        };
        for i in self.prof.between(xa, xb) {
            let x = self.prof.station(i);
            let ground = self.prof.z[i];
            if ground.is_nan() {
                if v.unknown_at.is_nan() {
                    v.unknown_at = x;
                }
                v.clear_ok = false;
                continue;
            }
            let clear = path(x) - ground;
            let need = self.required(x);
            let ok = if self.p.model == Model::Parity { parity_clears(clear, need) } else { clear >= need - 1e-9 };
            if !ok {
                v.clear_ok = false;
            }
            if need - clear > v.worst_short {
                v.worst_short = need - clear;
                v.worst_at = x;
            }
            if self.enforced(x) && (v.min_clear.is_nan() || clear < v.min_clear) {
                v.min_clear = clear;
                v.min_clear_at = x;
            }
        }
        v
    }

    /// SEILAPLAN's span check: Zweifel's three fields with a parabolic load path.
    pub fn check_parity(&self, a: Point, e: Point, t0: f64, a_is_start: bool) -> Verdict {
        let p = self.p;
        let start_top = if a_is_start { a.top() } else { self.line_start(self.start_low).top() };
        let end_top = self.line_end(self.end_low).top();
        let mut fields = Vec::with_capacity(3);
        if a.station > 1e-9 {
            fields.push(Field { xa: 0.0, za: start_top, xb: a.station, zb: a.top() });
        }
        let loaded = fields.len();
        fields.push(Field { xa: a.station, za: a.top(), xb: e.station, zb: e.top() });
        if e.station < p.line_end - 1e-9 {
            fields.push(Field { xa: e.station, za: e.top(), xb: p.line_end, zb: end_top });
        }
        let input = ZweifelInput {
            fields: &fields,
            loaded,
            datum: start_top,
            t0,
            q: p.rope_weight,
            ea: p.ea,
            load: p.load,
            anchor_length: self.parity_anchor_length(),
        };
        let Some(sol) = span::zweifel(&input) else {
            return Verdict::unsolved();
        };
        let f = fields[loaded];
        let (b, h, c) = (f.b(), f.h(), f.chord());
        let sag = span::zweifel_loaded_sag(c, p.load, p.rope_weight + p.running_weight / 2.0, sol.t_mid + sol.delta_t);
        let path = |x: f64| {
            let u = (x - f.xa) / b;
            f.za + h * u - 4.0 * sag * u * (1.0 - u)
        };
        let mut v = self.clearance(f.xa, f.xb, path);
        let z_top = fields.iter().map(|g| g.za.max(g.zb)).fold(f64::NEG_INFINITY, f64::max);
        v.peak = t0 + p.rope_weight * (z_top - start_top) + sol.delta_t;
        v.tension_ok = v.peak <= p.allowable + 1e-9;
        v.gravity_ok = true;
        if p.system == CableSystem::TwoCable {
            let dx = self.prof.dx;
            if self.gravity_forward {
                if self.trafficable(e.station) && !(path(e.station - dx) > e.top()) {
                    v.gravity_ok = false;
                    v.gravity_at = e.station;
                }
            } else if self.trafficable(a.station) && !(path(a.station + dx) > a.top()) {
                v.gravity_ok = false;
                v.gravity_at = a.station;
            }
        }
        v
    }
}

/// SEILAPLAN compares clearance with the requirement in whole decimetres. Truncating the clearance
/// reproduces the most reference tensions; the exact rounding is not documented.
pub fn parity_clears(clear: f64, need: f64) -> bool {
    (clear * 10.0).floor() >= (need * 10.0).round()
}
