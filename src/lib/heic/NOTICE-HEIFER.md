# Heifer

`heic_decode.wasm` in this folder is built from `crates/heic-decode`, a thin interface over the
[heifer](https://github.com/HarpeLm/Heifer) crate, version 0.5.1 (with its `heifer-isobmff` and
`heifer-hevc-dec` crates), built without its encoder. Heifer is a HEIF/HEIC decoder written in
Rust with no C code and no `unsafe`, licensed under either of the MIT licence or the Apache
License 2.0, at your option. PGMaps uses it under the MIT licence.

Copyright (c) 2026 heifer contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

HEVC, the codec inside HEIC, is covered by patents. Heifer is an independent implementation;
whoever deploys this build is responsible for any patent licensing that applies to them.
