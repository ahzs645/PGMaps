//! Decodes the synthetic fixture the browser tests also read: four flat quadrants, 96 × 64, written
//! by macOS's HEIC encoder (`sips`), so the decoder is checked against a file it did not write.

const FIXTURE: &[u8] = include_bytes!("../../../src/lib/heic/fixtures/quadrants.heic");

fn pixel(rgba: &[u8], width: u32, x: u32, y: u32) -> [u8; 3] {
    let i = ((y * width + x) * 4) as usize;
    [rgba[i], rgba[i + 1], rgba[i + 2]]
}

fn near(got: [u8; 3], want: [u8; 3]) -> bool {
    got.iter().zip(want).all(|(g, w)| (i32::from(*g) - i32::from(w)).abs() <= 6)
}

#[test]
fn decodes_the_fixture_upright_in_srgb() {
    let decoded = heic_decode::decode(FIXTURE, 0).expect("the fixture decodes");
    assert_eq!((decoded.width, decoded.height), (96, 64));
    assert!(decoded.srgb);
    assert_eq!(decoded.rgba.len(), 96 * 64 * 4);
    assert!(near(pixel(&decoded.rgba, 96, 10, 10), [220, 30, 30]), "top left is red");
    assert!(near(pixel(&decoded.rgba, 96, 85, 10), [30, 200, 30]), "top right is green");
    assert!(near(pixel(&decoded.rgba, 96, 10, 55), [30, 30, 220]), "bottom left is blue");
    assert!(near(pixel(&decoded.rgba, 96, 85, 55), [240, 240, 240]), "bottom right is white");
}

#[test]
fn refuses_a_picture_over_the_pixel_limit() {
    assert!(heic_decode::decode(FIXTURE, 1000).is_err());
}

#[test]
fn refuses_bytes_that_are_not_heif() {
    assert!(heic_decode::decode(b"\xff\xd8\xff\xe0 not a heif file at all", 0).is_err());
    assert!(heic_decode::decode(&FIXTURE[..200], 0).is_err());
}
