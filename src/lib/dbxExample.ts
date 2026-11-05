import type { DbxComponent } from "./leicaDbx"
const encode = (s: string) => [...new TextEncoder().encode(s), 0]
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return [...b] }
const f64 = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, n, true); return [...b] }
const header = (object: number) => [0, 0x48, object, 0, 0, 0, 0, 0]
/** Synthetic positions and code names only. No real survey files are bundled. */
export function makeDbxExample(geographic = false): DbxComponent[] {
  const stem = "DEMO_GRID", components: DbxComponent[] = []
  function table(ext: string, records: Array<{ id: number; key: string; data: number[] }>) {
    const bytes = new Uint8Array(3072), d = new DataView(bytes.buffer)
    for (const [offset, n] of [[4, 86], [8, 1], [16, 65], [20, 76], [24, 73], [68, records.length]]) d.setUint32(offset, n, true)
    for (const [base, kind] of [[1024, 1], [2048, 0x13]]) {
      d.setUint32(base + 4, 0xffffffff, true); d.setUint32(base + 8, 0xffffffff, true); d.setUint16(base + 14, records.length, true)
      let pos = base + 18
      for (const r of records) {
        const payload = kind === 1 ? encode(r.key) : r.data, size = 7 + payload.length
        bytes.set([size - 1, kind, 0x80, ...u32(r.id), ...payload], pos); pos += size
      }
      d.setUint16(base + 16, base + 1024 - pos, true)
    }
    components.push({ name: `${stem}.${ext}`, size: bytes.length, buffer: bytes.buffer })
  }
  const points = [
    { id: 1, name: "DEMO1", n: 5920000, e: 1750000, h: 10.125, code: "CONTROL" },
    { id: 2, name: "DEMO2", n: 5920025, e: 1750010, h: 10.225, code: "KERB" },
    { id: 3, name: "DEMO3", n: 5920035, e: 1750030, h: 10.325, code: "KERB" },
  ]
  table("X01", points.map((p) => {
    const key = `${p.name}\n35\n${geographic ? 0 : 1}`
    return { id: p.id, key, data: [...header(0xbd), ...encode(key), 1, 0, 0, 0xc0, 2, 0, ...u32(p.id), 10, 0, 35, 15, 0, geographic ? 2 : 3, 16, 0, geographic ? 1 : 2, 17, 0, ...f64(geographic ? (-36.85 + p.id * .0001) * Math.PI / 180 : p.n), 18, 0, ...f64(geographic ? (174.76 + p.id * .0001) * Math.PI / 180 : p.e), 19, 0, ...f64(p.h), 0xff, 0xff] }
  }))
  table("X06", ["CONTROL", "KERB"].map((code, i) => ({ id: i + 1, key: `4${code}\n153`, data: [...header(0xbf), 7, 0, ...encode(`4${code}\n153`), 0xff, 0xff] })))
  table("X14", points.map((p) => ({ id: p.id, key: String(p.id), data: [0, 0xb4, 0x19, 0, 0, 0, 0, 0, 1, 2, 0, ...u32(p.id), 3, 0, ...u32(p.code === "CONTROL" ? 1 : 2), 4, 0, ...f64(0), 5, 0, 0xff, 0xff] })))
  if (geographic) {
    const identity = new Uint8Array(84)
    identity[2] = 1; new DataView(identity.buffer).setFloat64(75, 1, true); identity[83] = 1
    table("X18", [
      { id: 1, key: "NZTM Proj", data: [...header(0xd8), ...u32(2), 1, 0, ...u32(3), 2, 0, ...u32(6), 3, 0, ...u32(5), 0xff, 0xff] },
      { id: 2, key: "GRS80", data: [0, 8, 0x8f, 0, 0, 0, 0, 0, ...f64(6378137), 1, 0, ...encode("GRS80"), 2, 0, ...f64(1 / 298.257222101), 0xff, 0xff] },
      { id: 3, key: "NZTM Proj", data: [0, 8, 0x47, 0, 0, 0, 0, 0, ...f64(0), 1, 0, 1, 2, 0, ...encode("NZTM Proj"), 3, 0, 48, 0, ...[1600000, 10000000, 0, 173 * Math.PI / 180, .9996, 16 * Math.PI / 180].flatMap(f64), 0xff, 0xff] },
      { id: 5, key: "L_AUK46_16_v16_01", data: [0, 0x48, 0x7e, 0, 0, 0, 0, 0, 3, 2, 0, 2, 3, 0, ...encode("L_AUK46_16_v16_01"), 0xff, 0xff] },
      { id: 6, key: "WGS84-NZGD2000", data: [0, 8, 0x47, 0, 0, 0, 0, 0, ...f64(0), 1, 0, 1, 2, 0, ...encode("WGS84-NZGD2000"), 3, 0, 84, 0, ...identity, 0xff, 0xff] },
    ])
  }
  const index = new Uint8Array(64)
  new DataView(index.buffer).setUint32(0, 0x0a0b0c0d, true); index[4] = 4; index.set(encode("Demonstration NZVD2016 grid job"), 16)
  components.push({ name: `${stem}.XCF`, size: index.length, buffer: index.buffer })
  return components
}
