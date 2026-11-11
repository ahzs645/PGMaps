# LASzip adaptation

`lazChunkTable.ts` is a TypeScript port of the decompression side of four parts of
[LASzip](https://github.com/LASzip/LASzip): `read_chunk_table` in `lasreadpoint.cpp`, and the
arithmetic decoder, symbol and bit models, and integer decompressor in `arithmeticdecoder.cpp`,
`arithmeticmodel.cpp` and `integercompressor.cpp`.

LASzip is © 2007–2022 rapidlasso GmbH and licensed under the
[Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0).

Changes in this adaptation: TypeScript; decompression only; unsigned 32-bit arithmetic is written
out with `>>> 0` and divisions rather than C integer overflow; and the decoded table is checked
against the file (chunk sizes must end exactly at the table, and the point counts must match the
header) before any chunk is decoded. The chunks themselves are decoded by
[laz-perf](https://github.com/hobuinc/laz-perf) (Apache-2.0), unchanged.
