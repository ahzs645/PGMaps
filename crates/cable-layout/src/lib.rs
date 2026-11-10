//! Multi-span skyline layout and intermediate-support optimizer for PGMaps' forestry road tool.
//!
//! It implements the method of Bont & Heinimann (2012) as described in Bont et al. (2022,
//! Croatian Journal of Forest Engineering 43(2)): candidate supports on a grid and at convexity
//! peaks, a saddle-height ladder, every forward span checked for clearance, skyline tension and a
//! gravity carriage over a range of pre-tensions, and the line that needs the fewest and lowest
//! supports found at one pre-tension for the whole rope. Span mechanics follow Zweifel (1960) and
//! Irvine (1981); support angles and saddle forces Pestal (1961).
//!
//! Written from a functional specification of SEILAPLAN 3.8.2 (WSL / ETH Zürich); no code from
//! SEILAPLAN (GPL-2.0-or-later) was used. MIT licensed, as PGMaps.
//!
//! The WebAssembly interface is a small C ABI over `f64` buffers in linear memory, so the build
//! needs no binding generator: `cl_alloc` a buffer, write the encoded input (`codec.rs`), call
//! `cl_begin`, then `cl_step` until it returns 1, then `cl_finish` and read `cl_result_ptr`.
//! `cl_analyze` analyses a given layout without searching.

pub mod analysis;
pub mod catenary;
pub mod codec;
pub mod context;
pub mod params;
pub mod search;
pub mod span;

use std::sync::Mutex;

struct State {
    job: Option<search::Job>,
    result: Vec<f64>,
}

static STATE: Mutex<State> = Mutex::new(State { job: None, result: Vec::new() });

fn state() -> std::sync::MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Allocates `len` f64 values in linear memory for the caller to fill.
#[no_mangle]
pub extern "C" fn cl_alloc(len: usize) -> *mut f64 {
    let mut v = vec![0.0f64; len.max(1)];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// Frees a buffer from `cl_alloc`.
///
/// # Safety
/// `ptr` and `len` must come from one `cl_alloc` call, freed once.
#[no_mangle]
pub unsafe extern "C" fn cl_free(ptr: *mut f64, len: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, len.max(1), len.max(1)));
    }
}

fn input<'a>(ptr: *const f64, len: usize) -> &'a [f64] {
    if ptr.is_null() || len == 0 {
        return &[];
    }
    // SAFETY: the caller hands a buffer it filled through `cl_alloc`.
    unsafe { std::slice::from_raw_parts(ptr, len) }
}

/// Starts a search. Returns the number of spans to evaluate, or a negative input-error code (the
/// error is then also the result buffer).
#[no_mangle]
pub extern "C" fn cl_begin(ptr: *const f64, len: usize) -> f64 {
    let mut s = state();
    s.job = None;
    match codec::decode(input(ptr, len)).and_then(|d| search::Job::new(d.params, d.profile, d.fixed, d.sectors)) {
        Ok(job) => {
            let total = job.arcs.len() as f64;
            s.job = Some(job);
            s.result.clear();
            total
        }
        Err(e) => {
            s.result = codec::encode_error(e);
            -(e as i32 as f64)
        }
    }
}

/// Evaluates up to `budget` spans; returns the share of spans done (1 when finished).
#[no_mangle]
pub extern "C" fn cl_step(budget: u32) -> f64 {
    let mut s = state();
    let Some(job) = s.job.as_mut() else { return -1.0 };
    job.step(budget.max(1) as usize);
    if job.arcs.is_empty() {
        1.0
    } else {
        job.next as f64 / job.arcs.len() as f64
    }
}

/// Runs the per-tension search and the final analysis; returns the result's length in f64s.
#[no_mangle]
pub extern "C" fn cl_finish() -> usize {
    let mut s = state();
    let Some(job) = s.job.as_mut() else { return 0 };
    while !job.step(4096) {}
    let outcome = job.finish();
    let encoded = codec::encode_outcome(job, &outcome);
    s.result = encoded;
    s.job = None;
    s.result.len()
}

/// Analyses the layout appended to the input (`codec::decode_layout`) at its pre-tension.
#[no_mangle]
pub extern "C" fn cl_analyze(ptr: *const f64, len: usize) -> usize {
    let mut s = state();
    s.result = match codec::analyze(input(ptr, len)) {
        Ok(v) => v,
        Err(e) => codec::encode_error(e),
    };
    s.result.len()
}

#[no_mangle]
pub extern "C" fn cl_result_ptr() -> *const f64 {
    state().result.as_ptr()
}

#[no_mangle]
pub extern "C" fn cl_result_len() -> usize {
    state().result.len()
}

/// Runs a whole search from an encoded input (native callers and tests).
pub fn run(input: &[f64]) -> Vec<f64> {
    match codec::decode(input).and_then(|d| search::Job::new(d.params, d.profile, d.fixed, d.sectors)) {
        Ok(mut job) => {
            while !job.step(4096) {}
            let outcome = job.finish();
            codec::encode_outcome(&job, &outcome)
        }
        Err(e) => codec::encode_error(e),
    }
}
