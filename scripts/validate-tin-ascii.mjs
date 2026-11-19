import assert from "node:assert/strict"
import { parseTinAscii } from "../src/lib/tinAscii.ts"
import { checkBottomSurfaceThickness } from "../src/lib/pavementBottomSurface.ts"
import { checkPavementDesign } from "../src/lib/pavementDesign.ts"

const source = `TIN
BEGT
TNAM Basecourse
MAT 1
VERT 4
1755000 5923000 10 0
1755010 5923000 10 0
1755010 5923010 10 0
1755000 5923010 10 0
TRI 2
1 2 3
1 3 4
ENDT`
const doc = parseTinAscii(source, "basecourse.tin")
assert.equal(doc.units, "meter")
assert.equal(doc.surfaces[0].name, "Basecourse")
assert.equal(doc.surfaces[0].faces.length, 2)
assert.deepEqual(doc.surfaces[0].faces[0], ["1", "2", "3"])
assert.ok(doc.warnings.some((note) => note.includes("Metres are assumed")))
const points = [{ id: "AC-1", easting: 1755005, northing: 5923005, elevation: 10.075, code: "AC20" }, { id: "OUTSIDE", easting: 1755020, northing: 5923005, elevation: 10.075, code: "AC20" }]
const bottom = checkBottomSurfaceThickness({ surface: doc.surfaces[0], units: doc.units, points, targetMm: 75, toleranceMm: 0, rule: "minimum" })
assert.equal(bottom.results.length, 1)
assert.ok(Math.abs(bottom.results[0].thicknessMm - 75) < 1e-9)
assert.equal(bottom.results[0].status, "pass")
assert.equal(bottom.unassessed[0].reason, "OUTSIDE")
const design = checkPavementDesign({ points, surface: doc.surfaces[0], lowerMm: -10, upperMm: 10 })
assert.equal(design.rows[0].status, "HIGH")
assert.equal(design.rows[1].designLevel, null)

const zeroBased = parseTinAscii(source.replace("1 2 3\n1 3 4", "0 1 2\n0 2 3"), "zero.tin")
assert.deepEqual(zeroBased.surfaces[0].faces, doc.surfaces[0].faces)
const multi = parseTinAscii(`${source}\n${source.split("\n").slice(1).join("\n").replace("Basecourse", "FSL")}`, "both.tin")
assert.equal(multi.surfaces.length, 2)
assert.equal(multi.surfaces[1].name, "FSL")
assert.throws(() => parseTinAscii("\u0000\u0001TIN", "binary.tin"), /binary TIN/)
assert.throws(() => parseTinAscii("Not TIN data", "unknown.tin"), /Unsupported/)
assert.throws(() => parseTinAscii(source.replace("1 2 3", "1 2 9"), "bad.tin"), /invalid or duplicate vertices/)
assert.throws(() => parseTinAscii(source.replace("1755010 5923010 10 0", "invalid"), "bad.tin"), /Invalid TIN vertex/)
console.log("ASCII TIN import passed: correct triangulation, 0/1-based indices, multiple surfaces, thickness and FSL interpolation, outside coverage, and malformed/binary file rejection.")
