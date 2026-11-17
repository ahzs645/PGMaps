//! Decodes the primary image of a HEIC/HEIF photo to 8-bit sRGB pixels, for PGMaps' photo tools in
//! browsers that cannot show HEIC themselves (every browser but Safari).
//!
//! A thin interface over the `heifer` crate (MIT OR Apache-2.0, pure Rust, no `unsafe`), built
//! without its encoder. The crop, rotation and mirror stored in the file are applied, so the pixels
//! come out upright, and Display P3 photos (iPhones) are converted to sRGB from their ICC profile,
//! which is what a browser gives for the same photo exported as JPEG.
//!
//! The WebAssembly interface is a small C ABI over byte buffers in linear memory, so the build needs
//! no binding generator: `hd_alloc` a buffer, write the file's bytes, call `hd_decode`, then read
//! `hd_width`, `hd_height` and `hd_pixels_len` bytes of RGBA at `hd_pixels_ptr`; `hd_release` frees
//! the pixels. On failure `hd_decode` returns 1 and `hd_message_ptr`/`hd_message_len` hold why.
//! A panic aborts (a trap in WebAssembly), which the caller reports as a failed decode.

use std::sync::Mutex;

/// What one decode left behind for the caller to read.
struct State {
    width: u32,
    height: u32,
    /// 1 when the pixels were converted to sRGB, 0 when they are as coded (an HDR transfer or an
    /// ICC profile heifer cannot convert).
    srgb: u32,
    pixels: Vec<u8>,
    message: String,
}

static STATE: Mutex<State> =
    Mutex::new(State { width: 0, height: 0, srgb: 0, pixels: Vec::new(), message: String::new() });

fn state() -> std::sync::MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

/// The decoded picture: its size, RGBA bytes, and whether they are sRGB.
pub struct Decoded {
    pub width: u32,
    pub height: u32,
    pub srgb: bool,
    pub rgba: Vec<u8>,
}

/// Decodes `bytes` on one thread, refusing a picture of more than `max_pixels` (0: heifer's own
/// limit, 2^28).
pub fn decode(bytes: &[u8], max_pixels: u64) -> Result<Decoded, String> {
    let options = heifer::Options::new().with_max_threads(1).with_max_pixels(max_pixels);
    let (image, srgb) = match heifer::decode_srgb_rgba8(bytes, &options) {
        Ok(image) => (image, true),
        // A colour space heifer cannot bring to sRGB still decodes; the caller says so.
        Err(heifer::Error::Unsupported(_)) => {
            (heifer::decode_rgba8(bytes, &options).map_err(|e| e.to_string())?, false)
        }
        Err(error) => return Err(error.to_string()),
    };
    Ok(Decoded { width: image.width, height: image.height, srgb, rgba: image.data })
}

/// Allocates `len` bytes in linear memory for the caller to fill.
#[no_mangle]
pub extern "C" fn hd_alloc(len: usize) -> *mut u8 {
    let mut v = vec![0u8; len.max(1)];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// Frees a buffer from `hd_alloc`.
///
/// # Safety
/// `ptr` and `len` must come from one `hd_alloc` call, freed once.
#[no_mangle]
pub unsafe extern "C" fn hd_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, len.max(1), len.max(1)));
    }
}

/// Decodes the file at `ptr`. Returns 0 with the picture ready to read, or 1 with a message.
///
/// # Safety
/// `ptr` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn hd_decode(ptr: *const u8, len: usize, max_pixels: u32) -> u32 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let result = decode(bytes, u64::from(max_pixels));
    let mut s = state();
    match result {
        Ok(decoded) => {
            s.width = decoded.width;
            s.height = decoded.height;
            s.srgb = u32::from(decoded.srgb);
            s.pixels = decoded.rgba;
            s.message.clear();
            0
        }
        Err(message) => {
            s.width = 0;
            s.height = 0;
            s.srgb = 0;
            s.pixels = Vec::new();
            s.message = message;
            1
        }
    }
}

#[no_mangle]
pub extern "C" fn hd_width() -> u32 {
    state().width
}

#[no_mangle]
pub extern "C" fn hd_height() -> u32 {
    state().height
}

#[no_mangle]
pub extern "C" fn hd_srgb() -> u32 {
    state().srgb
}

#[no_mangle]
pub extern "C" fn hd_pixels_ptr() -> *const u8 {
    state().pixels.as_ptr()
}

#[no_mangle]
pub extern "C" fn hd_pixels_len() -> usize {
    state().pixels.len()
}

#[no_mangle]
pub extern "C" fn hd_message_ptr() -> *const u8 {
    state().message.as_ptr()
}

#[no_mangle]
pub extern "C" fn hd_message_len() -> usize {
    state().message.len()
}

/// Frees the decoded pixels.
#[no_mangle]
pub extern "C" fn hd_release() {
    let mut s = state();
    s.pixels = Vec::new();
    s.width = 0;
    s.height = 0;
}
